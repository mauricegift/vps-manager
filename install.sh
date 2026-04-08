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
FRONTEND_PORT="${FRONTEND_PORT:-5000}"
APP_NAME="vps-manager"

# ── Root check ────────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  err "This installer must be run as root. Try: sudo bash install.sh"
fi

# ── Step 1: System packages ───────────────────────────────────────────────────
step "Checking system packages"
apt-get update -qq 2>/dev/null

for pkg in git curl unzip zip build-essential nginx sshpass; do
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
  log "PM2 $(pm2 --version) installed"
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

# ── Step 6: Environment setup ─────────────────────────────────────────────────
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

# ── Step 7: UFW firewall ──────────────────────────────────────────────────────
step "Configuring firewall (UFW)"
if command -v ufw &>/dev/null; then
  ufw allow ssh >/dev/null 2>&1 || true
  ufw allow "$APP_PORT"/tcp >/dev/null 2>&1 || true
  ufw allow "$FRONTEND_PORT"/tcp >/dev/null 2>&1 || true
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  ufw --force enable >/dev/null 2>&1 || true
  log "UFW rules set: SSH, HTTP(80), HTTPS(443), API($APP_PORT), Frontend($FRONTEND_PORT)"
else
  warn "UFW not found — skipping firewall configuration"
fi

# ── Step 8: Start with PM2 ────────────────────────────────────────────────────
# NOTE: We use 'npm run dev' because the backend runs via tsx (TypeScript directly).
# The dev command starts the Express API on PORT ($APP_PORT) and
# the Vite dev server on FRONTEND_PORT ($FRONTEND_PORT).
step "Starting application with PM2"
pm2 delete "$APP_NAME" 2>/dev/null || true
cd "$APP_DIR"
pm2 start npm --name "$APP_NAME" -- run dev
pm2 startup systemd -u root --hp /root 2>/dev/null | grep -E '^sudo|^env' | bash || true
pm2 save
log "VPS Manager started via PM2 (name: $APP_NAME)"
log "  API backend → http://localhost:$APP_PORT"
log "  Frontend     → http://localhost:$FRONTEND_PORT"

# ── Step 9: Nginx reverse proxy ───────────────────────────────────────────────
step "Configuring Nginx reverse proxy"

SERVER_IP=$(curl -s --max-time 5 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')

NGINX_CONF="/etc/nginx/sites-available/$APP_NAME"
NGINX_LINK="/etc/nginx/sites-enabled/$APP_NAME"

# Disable default site to free port 80
if [[ -f /etc/nginx/sites-enabled/default ]]; then
  rm -f /etc/nginx/sites-enabled/default
  log "Disabled nginx default site"
fi

cat > "$NGINX_CONF" << NGINXEOF
# VPS Manager — generated by install.sh
map \$http_upgrade \$connection_upgrade {
  default upgrade;
  ''      close;
}

server {
  listen 80;
  server_name _;

  # Proxy WebSocket (terminal / socket.io)
  location /socket.io/ {
    proxy_pass         http://127.0.0.1:$APP_PORT;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade \$http_upgrade;
    proxy_set_header   Connection \$connection_upgrade;
    proxy_set_header   Host \$host;
    proxy_cache_bypass \$http_upgrade;
  }

  # Proxy API calls to backend
  location /api/ {
    proxy_pass         http://127.0.0.1:$APP_PORT;
    proxy_http_version 1.1;
    proxy_set_header   Host \$host;
    proxy_set_header   X-Real-IP \$remote_addr;
    proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_read_timeout 120s;
  }

  # Proxy all other requests to Vite frontend
  location / {
    proxy_pass         http://127.0.0.1:$FRONTEND_PORT;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade \$http_upgrade;
    proxy_set_header   Connection \$connection_upgrade;
    proxy_set_header   Host \$host;
    proxy_cache_bypass \$http_upgrade;
  }
}
NGINXEOF

ln -sf "$NGINX_CONF" "$NGINX_LINK"

if nginx -t 2>/dev/null; then
  systemctl reload nginx
  log "Nginx configured — app accessible on port 80"
else
  warn "Nginx config test failed — check $NGINX_CONF"
fi

# ── Step 10: Optional SSL via Let's Encrypt ───────────────────────────────────
step "SSL / HTTPS setup (optional)"
echo -e "${YELLOW}Do you want to set up a free SSL certificate via Let's Encrypt?${RESET}"
read -rp "Set up SSL now? (y/N): " SETUP_SSL

if [[ "${SETUP_SSL,,}" == "y" ]]; then
  read -rp "Enter your domain name (e.g. vps.example.com): " DOMAIN
  if [[ -z "${DOMAIN:-}" ]]; then
    warn "No domain entered — skipping SSL"
  else
    # DNS verification
    log "Checking DNS for $DOMAIN..."
    DOMAIN_IP=$(dig +short "$DOMAIN" 2>/dev/null | grep -E '^[0-9]+\.' | tail -1 || true)
    if [[ -n "$DOMAIN_IP" && "$DOMAIN_IP" != "$SERVER_IP" ]]; then
      warn "DNS mismatch: $DOMAIN → $DOMAIN_IP (this server is $SERVER_IP)"
      warn "Make sure your DNS A record points to this server before issuing SSL."
      read -rp "Continue anyway? (y/N): " CONTINUE_SSL
    elif [[ -z "$DOMAIN_IP" ]]; then
      warn "Could not resolve $DOMAIN — DNS may not be propagated yet."
      read -rp "Continue anyway? (y/N): " CONTINUE_SSL
    else
      log "DNS OK: $DOMAIN → $SERVER_IP"
      CONTINUE_SSL="y"
    fi

    if [[ "${CONTINUE_SSL:-n}" == "y" ]]; then
      read -rp "Your email for Let's Encrypt notifications: " SSL_EMAIL
      SSL_EMAIL="${SSL_EMAIL:-admin@$DOMAIN}"

      # Install certbot with nginx plugin
      if ! command -v certbot &>/dev/null; then
        warn "Installing certbot + nginx plugin..."
        apt-get install -y -qq certbot python3-certbot-nginx 2>/dev/null
      fi

      # Issue certificate using nginx plugin (no downtime)
      certbot --nginx \
        -d "$DOMAIN" \
        --email "$SSL_EMAIL" \
        --agree-tos --non-interactive --redirect \
        && log "SSL certificate issued + nginx updated for $DOMAIN!" \
        || warn "Certbot failed — verify DNS and try: certbot --nginx -d $DOMAIN"

      # Update nginx server_name to match domain
      sed -i "s/server_name _;/server_name $DOMAIN;/" "$NGINX_CONF"
      nginx -t 2>/dev/null && systemctl reload nginx || true

      # Auto-renewal cron (if not already set)
      if ! crontab -l 2>/dev/null | grep -q certbot; then
        (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet --nginx && systemctl reload nginx") | crontab -
        log "Auto-renewal cron job added (runs daily at 03:00)"
      else
        log "Auto-renewal cron already exists"
      fi
    fi
  fi
else
  log "Skipping SSL setup"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}══════════════════════════════════════════${RESET}"
echo -e "${BOLD}${GREEN}     VPS Manager is now running!          ${RESET}"
echo -e "${BOLD}${GREEN}══════════════════════════════════════════${RESET}"
echo ""
echo -e "  ${BOLD}Access URL:${RESET}      http://${SERVER_IP}  (via Nginx on port 80)"
echo -e "  ${BOLD}Direct URL:${RESET}      http://${SERVER_IP}:${FRONTEND_PORT}  (Vite)"
echo -e "  ${BOLD}PM2 name:${RESET}        $APP_NAME"
echo -e "  ${BOLD}Install dir:${RESET}     $APP_DIR"
echo ""
echo -e "  Useful commands:"
echo -e "    ${CYAN}pm2 status${RESET}               — check all PM2 processes"
echo -e "    ${CYAN}pm2 logs $APP_NAME${RESET}    — view app logs"
echo -e "    ${CYAN}pm2 restart $APP_NAME${RESET}  — restart the app"
echo -e "    ${CYAN}pm2 stop $APP_NAME${RESET}     — stop the app"
echo -e "    ${CYAN}nginx -t${RESET}                 — test nginx config"
echo -e "    ${CYAN}systemctl reload nginx${RESET}   — reload nginx"
echo -e "    ${CYAN}certbot renew --dry-run${RESET}  — test SSL renewal"
echo ""
