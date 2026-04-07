#!/bin/bash
# VPS Manager — Installation Script by Gifted Tech
# https://github.com/mauricegift/vps-manager

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║       VPS Manager Setup              ║${NC}"
echo -e "${BLUE}║       by Gifted Tech                 ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════╝${NC}"
echo ""

# ── Check for Node.js ─────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo -e "${RED}Node.js is required but not found.${NC}"
  echo -e "${YELLOW}Install Node.js 18+ from https://nodejs.org and re-run this script.${NC}"
  exit 1
fi
NODE_VER=$(node -e "process.stdout.write(process.version)" 2>/dev/null)
echo -e "${GREEN}✓ Node.js ${NODE_VER} found${NC}"

# ── PostgreSQL — install if missing, use if present ───────────────────────────
echo ""
echo -e "${YELLOW}Checking for PostgreSQL...${NC}"

PG_INSTALLED=false
PG_RUNNING=false

if command -v psql &>/dev/null; then
  PG_INSTALLED=true
  echo -e "${GREEN}✓ PostgreSQL is already installed$(psql --version 2>/dev/null | grep -oP '\d+\.\d+[\.\d]*' | head -1 | xargs printf ' (v%s)')${NC}"
else
  echo -e "${YELLOW}PostgreSQL not found — installing...${NC}"

  OS=$(uname -s)
  DISTRO=""
  [ -f /etc/os-release ] && { . /etc/os-release; DISTRO=$ID; }

  if [[ "$DISTRO" == "ubuntu" || "$DISTRO" == "debian" ]]; then
    apt-get update -qq
    apt-get install -y postgresql postgresql-contrib
    systemctl enable postgresql 2>/dev/null || true
    systemctl start postgresql 2>/dev/null || service postgresql start 2>/dev/null || true
    PG_INSTALLED=true
    echo -e "${GREEN}✓ PostgreSQL installed${NC}"
  elif [[ "$DISTRO" == "centos" || "$DISTRO" == "rhel" || "$DISTRO" == "rocky" || "$DISTRO" == "almalinux" || "$DISTRO" == "fedora" ]]; then
    dnf install -y postgresql-server postgresql-contrib 2>/dev/null || \
      yum install -y postgresql-server postgresql-contrib
    postgresql-setup --initdb 2>/dev/null || true
    systemctl enable postgresql
    systemctl start postgresql
    PG_INSTALLED=true
    echo -e "${GREEN}✓ PostgreSQL installed${NC}"
  elif [[ "$OS" == "Darwin" ]]; then
    if command -v brew &>/dev/null; then
      brew install postgresql@16
      brew services start postgresql@16
      PG_INSTALLED=true
      echo -e "${GREEN}✓ PostgreSQL installed via Homebrew${NC}"
    else
      echo -e "${RED}Homebrew not found. Install PostgreSQL manually then re-run.${NC}"
      exit 1
    fi
  else
    echo -e "${RED}Cannot auto-install PostgreSQL for your OS (${OS}/${DISTRO}).${NC}"
    echo -e "${YELLOW}Install PostgreSQL manually then re-run this script.${NC}"
    exit 1
  fi
fi

# ── Ensure PostgreSQL service is running ──────────────────────────────────────
if $PG_INSTALLED; then
  if pg_isready -q 2>/dev/null; then
    PG_RUNNING=true
    echo -e "${GREEN}✓ PostgreSQL is running${NC}"
  else
    echo -e "${YELLOW}Starting PostgreSQL service...${NC}"
    systemctl start postgresql 2>/dev/null || \
      service postgresql start 2>/dev/null || \
      pg_ctl start -D /var/lib/pgsql/data 2>/dev/null || true
    sleep 2
    if pg_isready -q 2>/dev/null; then
      PG_RUNNING=true
      echo -e "${GREEN}✓ PostgreSQL started${NC}"
    else
      echo -e "${YELLOW}⚠ Could not start PostgreSQL automatically. Please start it manually.${NC}"
    fi
  fi
fi

# ── Create database user & database (skip if already exist) ───────────────────
DB_NAME="${PGDATABASE:-vpsmanager}"
DB_USER="${PGUSER:-vpsmanager}"
DB_PASS="${PGPASSWORD:-vpsmanager_$(openssl rand -hex 8 2>/dev/null || echo 'secret')}"
DB_HOST="${PGHOST:-localhost}"
DB_PORT="${PGPORT:-5432}"

if $PG_RUNNING; then
  echo ""
  echo -e "${YELLOW}Setting up database '${DB_NAME}'...${NC}"

  # Check if user already exists
  USER_EXISTS=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" 2>/dev/null || echo "")
  if [ "$USER_EXISTS" != "1" ]; then
    sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';" 2>/dev/null && \
      echo -e "${GREEN}✓ Database user '${DB_USER}' created${NC}" || \
      echo -e "${YELLOW}⚠ Could not create user (may need manual setup)${NC}"
  else
    echo -e "${GREEN}✓ Database user '${DB_USER}' already exists${NC}"
  fi

  # Check if database already exists
  DB_EXISTS=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" 2>/dev/null || echo "")
  if [ "$DB_EXISTS" != "1" ]; then
    sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};" 2>/dev/null && \
      echo -e "${GREEN}✓ Database '${DB_NAME}' created${NC}" || \
      echo -e "${YELLOW}⚠ Could not create database (may need manual setup)${NC}"
    sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};" 2>/dev/null || true
  else
    echo -e "${GREEN}✓ Database '${DB_NAME}' already exists${NC}"
    # Ensure user has privileges even if DB existed
    sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};" 2>/dev/null || true
  fi
else
  echo -e "${YELLOW}⚠ Skipping database setup (PostgreSQL not running). Set up DB manually.${NC}"
fi

# ── Create .env if it doesn't exist ──────────────────────────────────────────
echo ""
if [ ! -f .env ]; then
  echo -e "${YELLOW}Creating .env file...${NC}"
  cat > .env <<EOF
DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}
PGHOST=${DB_HOST}
PGPORT=${DB_PORT}
PGUSER=${DB_USER}
PGPASSWORD=${DB_PASS}
PGDATABASE=${DB_NAME}
SESSION_SECRET=$(openssl rand -hex 32 2>/dev/null || node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")
PORT=5756
EOF
  echo -e "${GREEN}✓ .env file created${NC}"
else
  echo -e "${GREEN}✓ .env already exists — skipping${NC}"
fi

# ── Install npm dependencies ──────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}Installing npm dependencies...${NC}"
npm install --silent && echo -e "${GREEN}✓ Dependencies installed${NC}" || {
  echo -e "${RED}npm install failed. Check your Node.js installation.${NC}"
  exit 1
}

# ── Build frontend ────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}Building frontend...${NC}"
npm run build 2>&1 && echo -e "${GREEN}✓ Frontend built${NC}" || {
  echo -e "${RED}Build failed. Check the output above for errors.${NC}"
  exit 1
}

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   VPS Manager setup complete!                ║${NC}"
echo -e "${GREEN}║                                              ║${NC}"
echo -e "${GREEN}║   Start:  npm start                          ║${NC}"
echo -e "${GREEN}║   Dev:    npm run dev                        ║${NC}"
echo -e "${GREEN}║   PM2:    pm2 start dist/server/index.js     ║${NC}"
echo -e "${GREEN}║           --name vps-manager                 ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
