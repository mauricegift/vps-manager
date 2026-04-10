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

# ── Privilege detection ───────────────────────────────────────────────────────
if [[ $EUID -eq 0 ]]; then
  SUDO=""
  log "Running as root"
else
  SUDO="sudo"
  warn "Running as non-root user ($(whoami)) — sudo will be used for system commands"
  warn "Run as root for the smoothest experience: sudo -i"
  if ! sudo -n true 2>/dev/null; then
    warn "Sudo requires a password — you may be prompted during installation"
  fi
fi

INSTALL_DIR="${INSTALL_DIR:-$HOME/vps-manager}"
APP_PORT="${APP_PORT:-5756}"
APP_NAME="vps-manager"

# ── Step 1: System packages ───────────────────────────────────────────────────
step "Checking system packages"
$SUDO apt-get update -qq 2>/dev/null

for pkg in git curl unzip zip build-essential nginx sshpass dnsutils postgresql postgresql-contrib; do
  if ! dpkg -s "$pkg" &>/dev/null; then
    warn "$pkg not found — installing..."
    $SUDO apt-get install -y -qq "$pkg" 2>/dev/null
  else
    log "$pkg already installed"
  fi
done

# ── Step 2: Node.js via NVM ───────────────────────────────────────────────────
step "Checking Node.js"

install_node_nvm() {
  warn "Installing NVM and Node.js 24..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  nvm install 24
  nvm use 24
  nvm alias default 24
  log "Node.js $(node --version) installed via NVM"
}

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

if ! command -v node &>/dev/null; then
  install_node_nvm
else
  NODE_MAJOR=$(node --version | sed 's/v//' | cut -d. -f1)
  if [[ $NODE_MAJOR -lt 24 ]]; then
    warn "Node.js $(node --version) is too old — upgrading to 24 via NVM..."
    if [ ! -s "$NVM_DIR/nvm.sh" ]; then
      curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
      [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    fi
    nvm install 24
    nvm use 24
    nvm alias default 24
    log "Node.js $(node --version) upgraded via NVM"
  else
    log "Node.js $(node --version)"
  fi
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

# ── Step 3b: Python3 + ffmpeg ────────────────────────────────────────────────
step "Checking Python & ffmpeg"
if ! command -v python3 &>/dev/null; then
  warn "python3 not found — installing..."
  $SUDO apt-get install -y -qq python3 python3-pip 2>/dev/null
fi
log "Python $(python3 --version 2>&1 | grep -oE '[0-9.]+' | head -1)"

mkdir -p "$HOME/bin"
if ! grep -q 'export PATH="$HOME/bin' "$HOME/.bashrc" 2>/dev/null; then
  echo 'export PATH="$HOME/bin:$PATH"' >> "$HOME/.bashrc"
fi
if [[ ! -e "$HOME/bin/python" ]]; then
  ln -sf "$(which python3)" "$HOME/bin/python"
  log "Created ~/bin/python → $(which python3)"
else
  log "~/bin/python already exists"
fi

if ! command -v ffmpeg &>/dev/null; then
  warn "ffmpeg not found — installing..."
  $SUDO apt-get install -y -qq ffmpeg 2>/dev/null
  log "ffmpeg $(ffmpeg -version 2>&1 | grep -oE '[0-9]+\.[0-9]+' | head -1) installed"
else
  log "ffmpeg already installed"
fi

# ── Step 4: Clone repo ───────────────────────────────────────────────────────
step "Cloning VPS Manager"

# Back up existing .env so credentials survive a re-install
if [[ -f "$INSTALL_DIR/.env" ]]; then
  cp "$INSTALL_DIR/.env" "/tmp/.vpsmanager_env_backup"
  log "Backed up existing .env"
fi

# Always clone fresh
if [[ -d "$INSTALL_DIR" ]]; then
  warn "Existing installation found — removing for fresh clone..."
  rm -rf "$INSTALL_DIR"
fi

log "Cloning repository to $INSTALL_DIR..."
git clone https://github.com/mauricegift/vps-manager.git "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Restore .env backup if it existed
if [[ -f "/tmp/.vpsmanager_env_backup" ]]; then
  cp "/tmp/.vpsmanager_env_backup" "$INSTALL_DIR/.env"
  rm -f "/tmp/.vpsmanager_env_backup"
  log "Restored .env from backup"
fi

APP_DIR="$INSTALL_DIR"
cd "$APP_DIR"
log "App directory: $APP_DIR"

# ── Step 5: Install dependencies ─────────────────────────────────────────────
step "Installing dependencies"
npm install --quiet

# ── Step 5c: Build frontend ──────────────────────────────────────────────────
step "Building frontend (React → dist/public)"
npm run build
log "Frontend built successfully"
log "Dependencies installed"

# ── Step 5b: PostgreSQL setup ───────────────────────────────────────────────
step "Setting up PostgreSQL database"
$SUDO systemctl enable postgresql 2>/dev/null || true
$SUDO systemctl start  postgresql 2>/dev/null || true
# Wait up to 10s for postgres to be ready
for i in 1 2 3 4 5 6 7 8 9 10; do
  $SUDO -u postgres psql -c "SELECT 1;" &>/dev/null && break
  sleep 1
done
PG_PASS=$(openssl rand -hex 16)
$SUDO -u postgres psql -c "CREATE USER vpsmanager WITH PASSWORD '$PG_PASS';" 2>/dev/null || \
  $SUDO -u postgres psql -c "ALTER  USER vpsmanager WITH PASSWORD '$PG_PASS';"
$SUDO -u postgres psql -c "CREATE DATABASE vpsmanager OWNER vpsmanager;" 2>/dev/null || true
$SUDO -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE vpsmanager TO vpsmanager;" 2>/dev/null || true
log "PostgreSQL ready (user: vpsmanager)"


# ── Step 6: Environment setup ────────────────────────────────────────────────
step "Configuring environment"
ENV_FILE="$APP_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  SESSION_SECRET=$(openssl rand -hex 32)
  printf 'PORT=%s\nSESSION_SECRET=%s\nPGHOST=localhost\nPGUSER=vpsmanager\nPGPASSWORD=%s\nPGDATABASE=vpsmanager\n' "$APP_PORT" "$SESSION_SECRET" "$PG_PASS" > "$ENV_FILE"
  log "Created .env with auto-generated session secret"
else
  log ".env already exists — skipping"
fi

# ── Step 7: UFW firewall ─────────────────────────────────────────────────────
step "Configuring firewall (UFW)"
if command -v ufw &>/dev/null; then
  $SUDO ufw allow ssh >/dev/null 2>&1 || true
  $SUDO ufw allow "$APP_PORT"/tcp >/dev/null 2>&1 || true
  $SUDO ufw allow 80/tcp >/dev/null 2>&1 || true
  $SUDO ufw allow 443/tcp >/dev/null 2>&1 || true
  $SUDO ufw --force enable >/dev/null 2>&1 || true
  log "UFW rules set: SSH, HTTP(80), HTTPS(443), App($APP_PORT)"
else
  warn "UFW not found — skipping firewall configuration"
fi

# ── Step 8: Start with PM2 ───────────────────────────────────────────────────
step "Starting application with PM2"
pm2 delete "$APP_NAME" 2>/dev/null || true
cd "$APP_DIR"
pm2 start npm --name "$APP_NAME" -- run start
PM2_STARTUP_CMD=$(pm2 startup 2>/dev/null | grep -E '^\s*sudo|^\s*env' | head -1 || true)
if [[ -n "$PM2_STARTUP_CMD" ]]; then
  if [[ $EUID -eq 0 ]]; then
    bash -c "$PM2_STARTUP_CMD" || true
  else
    $SUDO bash -c "$PM2_STARTUP_CMD" || true
  fi
fi
pm2 save
log "VPS Manager started via PM2 (name: $APP_NAME)"
log "  → http://localhost:$APP_PORT  (proxied via nginx on port 80)"

# ── Step 9: Nginx reverse proxy ──────────────────────────────────────────────
step "Configuring Nginx reverse proxy"

SERVER_IP=$(curl -4 -s --max-time 8 ifconfig.me 2>/dev/null \
  || ip -4 addr show scope global 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | grep -v '^127\.' | head -1 \
  || hostname -I | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | grep -v '^127\.' | head -1)

NGINX_CONF="/etc/nginx/sites-available/$APP_NAME"
NGINX_LINK="/etc/nginx/sites-enabled/$APP_NAME"

if [[ -f /etc/nginx/sites-enabled/default ]]; then
  $SUDO rm -f /etc/nginx/sites-enabled/default
  log "Disabled nginx default site"
fi

$SUDO tee "$NGINX_CONF" > /dev/null <<'NGINXEOF'
# VPS Manager — generated by install.sh
map $http_upgrade $connection_upgrade {
  default upgrade;
  ''      close;
}

server {
  listen 80;
  server_name _;

  location /socket.io/ {
    proxy_pass         http://127.0.0.1:APP_PORT_PLACEHOLDER;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade $http_upgrade;
    proxy_set_header   Connection $connection_upgrade;
    proxy_set_header   Host $host;
    proxy_cache_bypass $http_upgrade;
  }

  location /api/ {
    proxy_pass         http://127.0.0.1:APP_PORT_PLACEHOLDER;
    proxy_http_version 1.1;
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 120s;
  }

  # Let's Encrypt ACME challenge — served from disk, NOT proxied to the app
  # Without this, certbot's .well-known requests get proxied → 404 → cert fails
  location /.well-known/acme-challenge/ {
    root /var/www/html;
    try_files $uri =404;
  }

  location / {
    proxy_pass         http://127.0.0.1:APP_PORT_PLACEHOLDER;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade $http_upgrade;
    proxy_set_header   Connection $connection_upgrade;
    proxy_set_header   Host $host;
    proxy_cache_bypass $http_upgrade;
  }
}
NGINXEOF

# Replace port placeholders with actual values
$SUDO sed -i "s/APP_PORT_PLACEHOLDER/$APP_PORT/g" "$NGINX_CONF"

$SUDO ln -sf "$NGINX_CONF" "$NGINX_LINK"

if $SUDO nginx -t 2>/dev/null; then
  $SUDO systemctl reload nginx
  log "Nginx configured — app accessible on port 80"
else
  warn "Nginx config test failed — check $NGINX_CONF"
fi

# ── Step 10: Optional SSL via Let's Encrypt ──────────────────────────────────
step "SSL / HTTPS setup (optional)"
echo -e "${CYAN}Enter your domain name to enable free SSL via Let's Encrypt.${RESET}"
echo -e "${YELLOW}Leave blank and press Enter to skip SSL (IP-only access).${RESET}"
read -rp "Domain (e.g. vps.example.com) [blank = skip]: " DOMAIN </dev/tty

if [[ -z "${DOMAIN:-}" ]]; then
  log "No domain provided — skipping SSL (app accessible via IP on port 80)"
  # Open the frontend port directly so the app is reachable without a domain
  if command -v ufw &>/dev/null; then
  fi
else
  DNS_TIMEOUT=300
  DNS_INTERVAL=10
  DNS_WAITED=0
  DNS_OK=false

  log "Checking DNS for ${DOMAIN} → expected IP: ${SERVER_IP}"
  log "Polling every ${DNS_INTERVAL}s (timeout ${DNS_TIMEOUT}s) — please wait..."

  while [[ $DNS_WAITED -lt $DNS_TIMEOUT ]]; do
    DOMAIN_IP=$(dig +short "$DOMAIN" A 2>/dev/null | grep -E '^[0-9]+\.' | tail -1 || true)
    if [[ "$DOMAIN_IP" == "$SERVER_IP" ]]; then
      log "DNS OK: $DOMAIN → $SERVER_IP ✓"
      DNS_OK=true
      break
    elif [[ -n "$DOMAIN_IP" ]]; then
      printf "${YELLOW}[!]${RESET}  DNS mismatch — $DOMAIN → $DOMAIN_IP (want $SERVER_IP)  [${DNS_WAITED}s / ${DNS_TIMEOUT}s]\r"
    else
      printf "${YELLOW}[!]${RESET}  DNS not propagated yet for $DOMAIN  [${DNS_WAITED}s / ${DNS_TIMEOUT}s]\r"
    fi
    sleep $DNS_INTERVAL
    DNS_WAITED=$(( DNS_WAITED + DNS_INTERVAL ))
  done
  echo ""

  if [[ "$DNS_OK" == false ]]; then
    DOMAIN_IP=$(dig +short "$DOMAIN" A 2>/dev/null | grep -E '^[0-9]+\.' | tail -1 || echo "unresolved")
    warn "DNS did not resolve within ${DNS_TIMEOUT}s."
    warn "Current:  $DOMAIN → $DOMAIN_IP"
    warn "Expected: $DOMAIN → $SERVER_IP"
    warn "Re-run after DNS propagates: sudo certbot --nginx -d $DOMAIN"
  else
    read -rp "Your email for Let's Encrypt notifications: " SSL_EMAIL </dev/tty
    SSL_EMAIL="${SSL_EMAIL:-admin@$DOMAIN}"

    # Install certbot with webroot plugin (not nginx plugin) for reliable challenges
    if ! command -v certbot &>/dev/null; then
      warn "Installing certbot..."
      $SUDO apt-get install -y -qq certbot 2>/dev/null
    fi

    # Create webroot so certbot can serve the ACME challenge file from disk
    $SUDO mkdir -p /var/www/html/.well-known/acme-challenge

    # Reload nginx now so the ACME location block is live before certbot runs
    $SUDO nginx -t 2>/dev/null && $SUDO systemctl reload nginx

    # If a cert for this domain already exists (e.g. from a failed previous run),
    # delete it first so certbot can issue a clean new certificate
    if $SUDO certbot certificates 2>/dev/null | grep -q "Domains:.*$DOMAIN"; then
      warn "Existing cert found for $DOMAIN — revoking and deleting before reissue..."
      $SUDO certbot revoke --cert-name "$DOMAIN" --non-interactive 2>/dev/null || true
      $SUDO certbot delete  --cert-name "$DOMAIN" --non-interactive 2>/dev/null || true
      log "Old certificate removed"
    fi

    # Issue the certificate using the webroot authenticator
    if $SUDO certbot certonly --webroot -w /var/www/html \
        -d "$DOMAIN" \
        --email "$SSL_EMAIL" \
        --agree-tos --non-interactive; then

      log "SSL certificate issued for $DOMAIN!"

      # Patch nginx config: set server_name, add SSL listen, and ssl_certificate paths
      $SUDO sed -i "s/server_name _;/server_name $DOMAIN;/" "$NGINX_CONF"

      # Append SSL server block to nginx config
      $SUDO tee -a "$NGINX_CONF" > /dev/null <<SSLEOF

server {
  listen 443 ssl;
  server_name $DOMAIN;

  ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
  include             /etc/letsencrypt/options-ssl-nginx.conf;
  ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

  location /.well-known/acme-challenge/ {
    root /var/www/html;
    try_files \$uri =404;
  }

  location /socket.io/ {
    proxy_pass         http://127.0.0.1:APP_PORT_PLACEHOLDER;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade \$http_upgrade;
    proxy_set_header   Connection \$connection_upgrade;
    proxy_set_header   Host \$host;
    proxy_cache_bypass \$http_upgrade;
  }

  location /api/ {
    proxy_pass         http://127.0.0.1:APP_PORT_PLACEHOLDER;
    proxy_http_version 1.1;
    proxy_set_header   Host \$host;
    proxy_set_header   X-Real-IP \$remote_addr;
    proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_read_timeout 120s;
  }

  location / {
    proxy_pass         http://127.0.0.1:APP_PORT_PLACEHOLDER;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade \$http_upgrade;
    proxy_set_header   Connection \$connection_upgrade;
    proxy_set_header   Host \$host;
    proxy_cache_bypass \$http_upgrade;
  }
}
SSLEOF

      # Substitute port placeholders in the SSL server block too
      $SUDO sed -i "s/APP_PORT_PLACEHOLDER/$APP_PORT/g" "$NGINX_CONF"

      # Add HTTP → HTTPS redirect to the port-80 block
      $SUDO sed -i "/listen 80;/{n; /server_name $DOMAIN;/{ n; a\  return 301 https://\$host\$request_uri;}}}" "$NGINX_CONF" 2>/dev/null || true

      $SUDO nginx -t 2>/dev/null && $SUDO systemctl reload nginx
      log "Nginx updated — HTTPS enabled for $DOMAIN"

      # Auto-renewal cron
      if ! crontab -l 2>/dev/null | grep -q certbot; then
        (crontab -l 2>/dev/null; echo "0 3 * * * $SUDO certbot renew --quiet --webroot -w /var/www/html && $SUDO systemctl reload nginx") | crontab -
        log "Auto-renewal cron added (runs daily at 03:00)"
      else
        log "Auto-renewal cron already exists"
      fi

    else
      warn "Certbot failed to issue certificate for $DOMAIN."
      warn "Check that $DOMAIN resolves to this server's IP: $SERVER_IP"
      warn "Manual retry: sudo certbot certonly --webroot -w /var/www/html -d $DOMAIN"
    fi
  fi
fi

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}══════════════════════════════════════════${RESET}"
echo -e "${BOLD}${GREEN}     VPS Manager is now running!          ${RESET}"
echo -e "${BOLD}${GREEN}══════════════════════════════════════════${RESET}"
echo ""
echo -e "  ${BOLD}Access URL:${RESET}      http://${SERVER_IP}  (via Nginx on port 80)"
echo -e "  ${BOLD}Direct URL:${RESET}      http://${SERVER_IP}:${APP_PORT}  "
echo -e "  ${BOLD}PM2 name:${RESET}        $APP_NAME"
echo -e "  ${BOLD}Install dir:${RESET}     $APP_DIR"
echo ""
echo -e "  Useful commands:"
echo -e "    ${CYAN}pm2 status${RESET}                   — check all PM2 processes"
echo -e "    ${CYAN}pm2 logs $APP_NAME${RESET}       — view app logs"
echo -e "    ${CYAN}pm2 restart $APP_NAME${RESET}    — restart the app"
echo -e "    ${CYAN}pm2 stop $APP_NAME${RESET}       — stop the app"
echo -e "    ${CYAN}sudo nginx -t${RESET}                — test nginx config"
echo -e "    ${CYAN}sudo systemctl reload nginx${RESET}  — reload nginx"
echo -e "    ${CYAN}sudo certbot renew --dry-run${RESET} — test SSL renewal"
echo ""