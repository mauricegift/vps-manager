#!/usr/bin/env bash
set -euo pipefail

# VPS Manager — Installation Script
# https://github.com/mauricegift/vps-manager

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

log()  { echo -e "${GREEN}[✓]${RESET} $*"; }
warn() { echo -e "${YELLOW}[!]${RESET} $*"; }
err()  { echo -e "${RED}[✗]${RESET} $*"; exit 1; }
step() { echo -e "\n${BOLD}${CYAN}── $* ──${RESET}"; }

echo -e "${BOLD}${CYAN}"
echo "  ╔══════════════════════════════════════╗"
echo "  ║       VPS Manager Installer          ║"
echo "  ║  github.com/mauricegift/vps-manager  ║"
echo "  ╚══════════════════════════════════════╝"
echo -e "${RESET}"

INSTALL_DIR="${INSTALL_DIR:-/root/web/vps-manager}"
APP_PORT="${APP_PORT:-5756}"
APP_NAME="vps-manager"

# ── Root check ────────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  err "This installer must be run as root. Try: sudo bash install.sh"
fi

# ── Step 1: System packages ───────────────────────────────────────────────────
step "Checking system packages"
apt-get update -qq 2>/dev/null

for pkg in git curl unzip zip build-essential; do
  if ! dpkg -s "$pkg" &>/dev/null; then
    warn "$pkg not found — installing..."
    apt-get install -y -qq "$pkg" 2>/dev/null
  else
    log "$pkg already installed"
  fi
done

# ── Step 2: Node.js ───────────────────────────────────────────────────────────
step "Checking Node.js"
if ! command -v node &>/dev/null; then
  warn "Node.js not found — installing Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - &>/dev/null
  apt-get install -y -qq nodejs 2>/dev/null
  log "Node.js $(node --version) installed"
else
  NODE_MAJOR=$(node --version | sed 's/v//' | cut -d. -f1)
  if [[ $NODE_MAJOR -lt 18 ]]; then
    warn "Node.js $(node --version) is too old — upgrading to 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - &>/dev/null
    apt-get install -y -qq nodejs 2>/dev/null
  fi
  log "Node.js $(node --version)"
fi

# ── Step 3: PM2 ───────────────────────────────────────────────────────────────
step "Checking PM2"
if ! command -v pm2 &>/dev/null; then
  warn "PM2 not found — installing globally..."
  npm install -g pm2 --quiet
  # Enable startup on boot
  pm2 startup systemd -u root --hp /root 2>/dev/null | grep -E '^sudo|^env' | bash || true
  log "PM2 $(pm2 --version) installed and startup configured"
else
  log "PM2 $(pm2 --version) already installed"
fi

# ── Step 4: Clone / update repo ───────────────────────────────────────────────
step "Setting up VPS Manager"
if [[ -d "$INSTALL_DIR/.git" ]]; then
  log "Repository found at $INSTALL_DIR — pulling latest..."
  cd "$INSTALL_DIR"
  git fetch origin
  git checkout -- .
  git pull
else
  log "Cloning repository to $INSTALL_DIR..."
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone https://github.com/mauricegift/vps-manager.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# The actual app lives in the vps-manager subdirectory of the repo
APP_DIR="$INSTALL_DIR/vps-manager"
if [[ ! -d "$APP_DIR" ]]; then
  APP_DIR="$INSTALL_DIR"
fi
cd "$APP_DIR"
log "App directory: $APP_DIR"

# ── Step 5: Install dependencies ─────────────────────────────────────────────
step "Installing dependencies"
npm install --quiet
log "Dependencies installed"

# ── Step 6: Build frontend ────────────────────────────────────────────────────
step "Building frontend"
npm run build
log "Frontend built successfully"

# ── Step 7: Environment setup ─────────────────────────────────────────────────
step "Configuring environment"
ENV_FILE="$APP_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  SESSION_SECRET=$(openssl rand -hex 32)
  cat > "$ENV_FILE" << EOF
PORT=$APP_PORT
NODE_ENV=production
SESSION_SECRET=$SESSION_SECRET
EOF
  log "Created .env with auto-generated session secret"
else
  log ".env already exists — skipping"
fi

# ── Step 8: UFW firewall ──────────────────────────────────────────────────────
step "Configuring firewall (UFW)"
if command -v ufw &>/dev/null; then
  ufw allow ssh >/dev/null 2>&1 || true
  ufw allow "$APP_PORT"/tcp >/dev/null 2>&1 || true
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  ufw --force enable >/dev/null 2>&1 || true
  log "UFW rules set: SSH, HTTP(80), HTTPS(443), App($APP_PORT)"
else
  warn "UFW not found — skipping firewall configuration"
fi

# ── Step 9: Start with PM2 ────────────────────────────────────────────────────
step "Starting application with PM2"
pm2 delete "$APP_NAME" 2>/dev/null || true
cd "$APP_DIR"
pm2 start npm --name "$APP_NAME" -- start
pm2 save
log "VPS Manager started via PM2 (name: $APP_NAME)"

# ── Step 10: Optional SSL ─────────────────────────────────────────────────────
step "SSL / HTTPS setup (optional)"
echo -e "${YELLOW}Do you want to set up a free SSL certificate via Let's Encrypt?${RESET}"
read -rp "Set up SSL now? (y/N): " SETUP_SSL
CONTINUE_SSL="y"

if [[ "${SETUP_SSL,,}" == "y" ]]; then
  read -rp "Enter your domain name (e.g. vps.example.com): " DOMAIN
  if [[ -z "${DOMAIN:-}" ]]; then
    warn "No domain entered — skipping SSL"
    CONTINUE_SSL="n"
  else
    # DNS verification
    log "Checking DNS for $DOMAIN..."
    DOMAIN_IP=$(dig +short "$DOMAIN" 2>/dev/null | grep -E '^[0-9]+\.' | tail -1 || true)
    SERVER_IP=$(curl -s --max-time 5 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
    if [[ -n "$DOMAIN_IP" && "$DOMAIN_IP" != "$SERVER_IP" ]]; then
      warn "DNS mismatch: $DOMAIN → $DOMAIN_IP (this server is $SERVER_IP)"
      warn "Make sure your DNS A record points to this server before issuing SSL."
      read -rp "Continue anyway? (y/N): " CONTINUE_SSL
    elif [[ -z "$DOMAIN_IP" ]]; then
      warn "Could not resolve $DOMAIN — DNS may not be propagated yet."
      read -rp "Continue anyway? (y/N): " CONTINUE_SSL
    else
      log "DNS OK: $DOMAIN → $SERVER_IP"
    fi

    if [[ "${CONTINUE_SSL:-y,,}" == "y" ]]; then
      read -rp "Your email for Let's Encrypt notifications: " SSL_EMAIL
      SSL_EMAIL="${SSL_EMAIL:-admin@$DOMAIN}"

      # Install certbot if needed
      if ! command -v certbot &>/dev/null; then
        warn "Installing certbot..."
        apt-get install -y -qq certbot python3-certbot-nginx 2>/dev/null || \
        apt-get install -y -qq certbot 2>/dev/null
      fi

      # Stop any service on port 80 temporarily (standalone mode)
      certbot certonly --standalone --preferred-challenges http \
        -d "$DOMAIN" \
        --email "$SSL_EMAIL" \
        --agree-tos --non-interactive \
        && log "SSL certificate issued for $DOMAIN!" \
        || warn "Certbot failed — verify DNS and try: certbot certonly -d $DOMAIN"
    fi
  fi
else
  log "Skipping SSL setup"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
SERVER_IP=$(curl -s --max-time 5 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
echo ""
echo -e "${BOLD}${GREEN}══════════════════════════════════════════${RESET}"
echo -e "${BOLD}${GREEN}     VPS Manager is now running!          ${RESET}"
echo -e "${BOLD}${GREEN}══════════════════════════════════════════${RESET}"
echo ""
echo -e "  ${BOLD}Access URL:${RESET}      http://${SERVER_IP}:${APP_PORT}"
echo -e "  ${BOLD}PM2 name:${RESET}        $APP_NAME"
echo -e "  ${BOLD}Install dir:${RESET}     $APP_DIR"
echo ""
echo -e "  Useful commands:"
echo -e "    ${CYAN}pm2 status${RESET}              — check all PM2 processes"
echo -e "    ${CYAN}pm2 logs $APP_NAME${RESET}   — view app logs"
echo -e "    ${CYAN}pm2 restart $APP_NAME${RESET} — restart the app"
echo -e "    ${CYAN}pm2 stop $APP_NAME${RESET}    — stop the app"
echo ""
