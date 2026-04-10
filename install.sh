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
    # Verify sudo works before proceeding
    if ! sudo -n true 2>/dev/null; then
      warn "Sudo requires a password — you may be prompted during installation"
    fi
  fi

  INSTALL_DIR="${INSTALL_DIR:-$HOME/vps-manager}"
  APP_PORT="${APP_PORT:-5756}"
  FRONTEND_PORT="${FRONTEND_PORT:-5000}"
  APP_NAME="vps-manager"

  # ── Step 1: System packages ───────────────────────────────────────────────────
  step "Checking system packages"
  $SUDO apt-get update -qq 2>/dev/null

  for pkg in git curl unzip zip build-essential nginx sshpass dnsutils; do
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

  # ── Step 3b: Python3 + ffmpeg ─────────────────────────────────────────────────
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
    mkdir -p "$INSTALL_DIR"
    git clone https://github.com/mauricegift/vps-manager.git "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  fi

  APP_DIR="$INSTALL_DIR"
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
    $SUDO ufw allow ssh >/dev/null 2>&1 || true
    $SUDO ufw allow "$APP_PORT"/tcp >/dev/null 2>&1 || true
    $SUDO ufw allow 80/tcp >/dev/null 2>&1 || true
    $SUDO ufw allow 443/tcp >/dev/null 2>&1 || true
    $SUDO ufw --force enable >/dev/null 2>&1 || true
    log "UFW rules set: SSH, HTTP(80), HTTPS(443), App($APP_PORT)"
  else
    warn "UFW not found — skipping firewall configuration"
  fi

  # ── Step 8: Start with PM2 ────────────────────────────────────────────────────
  step "Starting application with PM2"
  pm2 delete "$APP_NAME" 2>/dev/null || true
  cd "$APP_DIR"
  pm2 start npm --name "$APP_NAME" -- run dev
  # Configure PM2 to start on system boot
  PM2_STARTUP_CMD=$(pm2 startup 2>/dev/null | grep -E '^s*sudo|^s*env' | head -1 || true)
  if [[ -n "$PM2_STARTUP_CMD" ]]; then
    if [[ $EUID -eq 0 ]]; then
      bash -c "$PM2_STARTUP_CMD" || true
    else
      $SUDO bash -c "$PM2_STARTUP_CMD" || true
    fi
  fi
  pm2 save
  log "VPS Manager started via PM2 (name: $APP_NAME)"
  log "  App running → http://localhost:$APP_PORT  (proxied via nginx on port 80)"

  # ── Step 9: Nginx reverse proxy ───────────────────────────────────────────────
  step "Configuring Nginx reverse proxy"

  SERVER_IP=$(curl -s --max-time 5 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')

  NGINX_CONF="/etc/nginx/sites-available/$APP_NAME"
  NGINX_LINK="/etc/nginx/sites-enabled/$APP_NAME"

  if [[ -f /etc/nginx/sites-enabled/default ]]; then
    $SUDO rm -f /etc/nginx/sites-enabled/default
    log "Disabled nginx default site"
  fi

  $SUDO tee "$NGINX_CONF" > /dev/null << NGINXEOF
  # VPS Manager — generated by install.sh
  map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
  }

  server {
    listen 80;
    server_name _;

    location /socket.io/ {
      proxy_pass         http://127.0.0.1:$APP_PORT;
      proxy_http_version 1.1;
      proxy_set_header   Upgrade \$http_upgrade;
      proxy_set_header   Connection \$connection_upgrade;
      proxy_set_header   Host \$host;
      proxy_cache_bypass \$http_upgrade;
    }

    location /api/ {
      proxy_pass         http://127.0.0.1:$APP_PORT;
      proxy_http_version 1.1;
      proxy_set_header   Host \$host;
      proxy_set_header   X-Real-IP \$remote_addr;
      proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
      proxy_read_timeout 120s;
    }

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

  $SUDO ln -sf "$NGINX_CONF" "$NGINX_LINK"

  if $SUDO nginx -t 2>/dev/null; then
    $SUDO systemctl reload nginx
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
      # ── Auto DNS polling via dig ──────────────────────────────────────────────
      DNS_TIMEOUT=300   # 5 minutes max
      DNS_INTERVAL=10   # poll every 10 seconds
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
          printf "${YELLOW}[!]${RESET}  DNS mismatch — $DOMAIN resolves to $DOMAIN_IP (want $SERVER_IP)  [${DNS_WAITED}s / ${DNS_TIMEOUT}s]\r"
        else
          printf "${YELLOW}[!]${RESET}  DNS not propagated yet for $DOMAIN  [${DNS_WAITED}s / ${DNS_TIMEOUT}s]\r"
        fi

        sleep $DNS_INTERVAL
        DNS_WAITED=$(( DNS_WAITED + DNS_INTERVAL ))
      done
      echo ""  # newline after \r line

      if [[ "$DNS_OK" == false ]]; then
        DOMAIN_IP=$(dig +short "$DOMAIN" A 2>/dev/null | grep -E '^[0-9]+\.' | tail -1 || echo "unresolved")
        warn "DNS did not resolve within ${DNS_TIMEOUT}s."
        warn "Current:  $DOMAIN → $DOMAIN_IP"
        warn "Expected: $DOMAIN → $SERVER_IP"
        warn "Make sure your DNS A record points to this server, then re-run:"
        warn "  sudo certbot --nginx -d $DOMAIN"
      else
        read -rp "Your email for Let's Encrypt notifications: " SSL_EMAIL
        SSL_EMAIL="${SSL_EMAIL:-admin@$DOMAIN}"

        if ! command -v certbot &>/dev/null; then
          warn "Installing certbot + nginx plugin..."
          $SUDO apt-get install -y -qq certbot python3-certbot-nginx 2>/dev/null
        fi

        $SUDO certbot --nginx \
          -d "$DOMAIN" \
          --email "$SSL_EMAIL" \
          --agree-tos --non-interactive --redirect \
          && log "SSL certificate issued + nginx updated for $DOMAIN!" \
          || warn "Certbot failed — verify DNS and try: sudo certbot --nginx -d $DOMAIN"

        $SUDO sed -i "s/server_name _;/server_name $DOMAIN;/" "$NGINX_CONF"
        $SUDO nginx -t 2>/dev/null && $SUDO systemctl reload nginx || true

        if ! crontab -l 2>/dev/null | grep -q certbot; then
          (crontab -l 2>/dev/null; echo "0 3 * * * $SUDO certbot renew --quiet --nginx && $SUDO systemctl reload nginx") | crontab -
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
  echo -e "    ${CYAN}sudo nginx -t${RESET}            — test nginx config"
  echo -e "    ${CYAN}sudo systemctl reload nginx${RESET}  — reload nginx"
  echo -e "    ${CYAN}sudo certbot renew --dry-run${RESET}  — test SSL renewal"
  echo ""
  