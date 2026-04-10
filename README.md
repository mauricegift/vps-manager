# VPS Manager

A modern, self-hosted web control panel for managing your Linux VPS — PM2 processes, Docker, Nginx, databases, files and a full interactive terminal, all from one clean dashboard.

[![GitHub](https://img.shields.io/badge/GitHub-mauricegift%2Fvps--manager-blue?logo=github)](https://github.com/mauricegift/vps-manager)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green?logo=node.js)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-18-blue?logo=react)](https://react.dev)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-blue?logo=postgresql)](https://postgresql.org)

---

## Features

### Dashboard
- Real-time CPU, RAM, disk usage and uptime
- System info: OS, kernel version, hostname, public IP, load average, process count
- Live memory breakdown and swap stats
- Quick-links to all modules

### PM2 — Process Manager
- List all processes with status, CPU %, memory and uptime
- Start, stop, restart, reload and delete processes
- View live logs (stdout and stderr combined)
- Launch a new process from a file path **or** a command (`npm start`, `bun run dev`, `python3 app.py`, etc.)
- Clone and deploy directly from a **GitHub repository** — auto-installs deps, auto-starts with the correct pm2 command
- Configure **environment variables** and **PORT** at launch time (written to `.env` in the working directory)
- Choose package manager (npm / bun) and optionally auto-run `install` before start
- Built-in **mini terminal** tab for quick commands without leaving the PM2 page
- **Self-update**: pull the latest VPS Manager release from GitHub, rebuild and restart in one click

### Docker
- List containers with status, image, ports and resource usage
- Start, stop, restart, remove containers
- Browse **images** — pull new ones, remove unused
- **Docker Compose** — view and manage compose files

### Databases
- Visual browser for **PostgreSQL**, **MySQL** and **SQLite**
- Browse databases → tables → paginated row viewer with search
- Run arbitrary **SQL queries** with results displayed in a table
- Create and drop databases and tables
- **Connection string generator** — one-click copy of PostgreSQL URL, psql CLI, MySQL URL, MySQL CLI, MongoDB URI and mongosh CLI
- Per-database username context (saves credentials per database)

### File Manager
- Browse the full file system with directory navigation
- **Upload files** (button or drag-and-drop), up to 200 MB per file
- **Download** individual files or entire folders as a ZIP archive
- **Create** new files (with optional content) and new folders
- **Edit** any text/code file with a **syntax-highlighted editor** (auto-detects language)
- **Rename**, **delete**, cut, copy and paste files and folders
- Paste a **copy** to the same directory → auto-generates a unique name (`file-1.txt`, `folder-1`, …) and lets you rename before confirming
- **Import from GitHub** — clone any public or private repo directly into a chosen path, with optional auto-install of dependencies
- Full **remote file management** over SSH when a remote server is active

### Terminal
- Full **interactive bash shell** (local server)
- **SSH terminal** for any saved remote server — opens a real PTY session
- Colour output: `ls`, `grep`, `diff` and `ll` are colorized automatically
- Keyboard shortcuts: `Ctrl+C`, `Ctrl+D`, `Ctrl+Z`, `ESC`, `Tab` completion, `↑ / ↓` history
- Adjustable **font size**
- **User context switching** — when you switch to a system user in Extras, the terminal automatically reconnects as that user (`su - username`) so the shell, home directory and PATH are all correct

### Nginx
- List all nginx **config files** — view, edit and save with syntax highlighting
- **Create new** site configs with a built-in template (reverse proxy, static, PHP)
- **Test** (`nginx -t`) and **reload** nginx after every save
- **SSL certificate** management — list Let's Encrypt certs, issue new ones (certbot webroot), view expiry dates

### Extras — System Management

**System tab**
- **System updates**: `apt update` and `apt upgrade` with live output
- **Self-update VPS Manager** from GitHub (downloads zip, rsyncs, rebuilds, restarts)
- **Hostname**: view and change the server hostname
- **Swap**: create, resize or remove swap space
- **MOTD**: set a custom message-of-the-day shown at login

**Software tab** — one-click install, update and uninstall for:
- *Runtimes*: Node.js (NVM), npm, Bun, Deno, PM2, pnpm, Yarn, Python, Go, Rust
- *Servers & SSL*: Nginx, Apache, Certbot
- *Dev Tools*: Git, curl, wget, rsync, Vim, Neovim
- *System Tools*: htop, tmux, screen, UFW, Fail2ban, jq, unzip, Python venv, FFmpeg
- *Browsers*: Chromium/Chrome (headless)
- *Cloud*: Cloudflare Wrangler, Cloudflared tunnel, Tailscale VPN

**Users tab** — full Linux user management
- List all system users with UID, GID, home dir and shell
- **Create users**: regular, system or sudo, with custom home dir and shell
- Set or change **passwords**
- Grant or revoke **sudo** access
- **Delete users** (optionally remove their home directory)
- **Switch active user context** — sets the working user for FileManager, Terminal and PM2 defaults across the entire UI

### Servers — Remote VPS Management
- Save **unlimited** remote server connections (IP, port, username, password or SSH key)
- **Connect** to any saved server — all pages (PM2, Docker, Files, Terminal, Databases, Nginx, Extras) transparently proxy operations over SSH
- View remote system info on connect
- **Disconnect** to return to local mode instantly

### Settings
- **SMTP email** configuration — supports Resend and Brevo; save via UI (takes priority over `.env`)
- **Send test email** to verify settings
- **User management** — create additional login accounts, list and delete users
- **Account settings** — change your own username and password

### Authentication
- First-visit registration for the admin account (permanently disabled once created)
- Login with **email address or username** — inline per-field errors (wrong user vs wrong password)
- **JWT** access tokens (24 h) with silent auto-refresh via rotating refresh tokens (7 days, stored in PostgreSQL)
- **Forgot password** — sends a 6-digit code (valid 10 min); falls back to PM2 log if SMTP is not configured
- Logout immediately invalidates the refresh token server-side
- WebSocket terminal connections also verify the JWT before accepting

---

## Quick Install

### As root

```bash
curl -4 -fsSL https://vps-manager.giftedtech.co.ke/install.sh | bash
```

### As a non-root sudo user

```bash
curl -4 -fsSL https://vps-manager.giftedtech.co.ke/install.sh | sudo bash
```

> **SMTP is optional.** If you skip it, password reset codes are printed to the PM2 log instead of emailed.

---

## What the installer does

1. Installs system packages: `git`, `curl`, `nginx`, `postgresql`, `dnsutils`, `build-essential`, `sshpass`
2. Installs **Node.js 20** via NVM (skips if already installed)
3. Installs **PM2** globally
4. Clones this repo to `/root/vps-manager` (or `~/vps-manager` for non-root)
5. Runs `npm install`
6. Runs `npm run build` — compiles the React frontend to `dist/public/`
7. Sets up **PostgreSQL**: creates user `vpsmanager`, database `vpsmanager`, grants privileges
8. Writes `.env` with auto-generated `SESSION_SECRET` and database credentials
9. Prompts for SMTP (Resend or Brevo) — optional, press Enter to skip
10. Configures **UFW** firewall: SSH, HTTP (80), HTTPS (443), API (5756)
11. Generates an **Nginx** reverse-proxy config on port 80
12. Starts the app with **PM2** (`npm run start`) and saves on-boot startup
13. Optionally issues a free **SSL certificate** via Let's Encrypt with DNS polling and auto-renewal
    - Rewrites the port-80 Nginx block to redirect all HTTP traffic to HTTPS
    - Appends a clean port-443 SSL server block with `X-Forwarded-Proto` headers
    - Writes `ALLOWED_ORIGIN=https://<domain>` to `.env` — required so CORS allows module script requests
    - Removes port `5756` from the UFW firewall — all access goes through Nginx on 443
    - Restarts the PM2 app with `--update-env` to apply the new env vars immediately
    - Prints `https://<domain>` as the access URL in the final summary

---

## Ports

| Port | Purpose |
|---|---|
| `5756` | Backend API + frontend static files (Express) |
| `80` | Nginx — HTTP (redirects to HTTPS when SSL is active) |
| `443` | Nginx — HTTPS (after SSL setup) |

> After SSL is issued, port `5756` is **removed from the firewall**. All traffic must go through Nginx.  
> Direct access without Nginx (pre-SSL only): `http://YOUR_SERVER_IP:5756`

---

## Manual Install

```bash
# 1. Clone
git clone https://github.com/mauricegift/vps-manager.git
cd vps-manager

# 2. Install dependencies
npm install

# 3. Copy and edit the environment file
cp .env.example .env
# At minimum set SESSION_SECRET and PostgreSQL credentials

# 4. Build the frontend
npm run build

# 5. Start
npm start
```

### Development mode (Replit / local)

```bash
npm run dev
```

Starts the Express backend on port 5756 and the Vite dev server on port 5000 concurrently.

### Run with PM2

```bash
# Production (uses built frontend from dist/public/)
pm2 start npm --name vps-manager -- run start
pm2 save && pm2 startup
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in your values.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5756` | Backend API + frontend port |
| `SESSION_SECRET` | — | **Required** — JWT signing secret. Generate: `openssl rand -hex 32` |
| `DATABASE_URL` | — | Full PostgreSQL connection string (overrides individual vars below) |
| `PGHOST` | `localhost` | PostgreSQL host |
| `PGPORT` | `5432` | PostgreSQL port |
| `PGUSER` | `vpsmanager` | PostgreSQL user |
| `PGPASSWORD` | `vpsmanager_secret` | PostgreSQL password |
| `PGDATABASE` | `vpsmanager` | PostgreSQL database name |
| `EMAIL_PROVIDER` | `none` | Email provider: `resend`, `brevo`, or `none` |
| `EMAIL_FROM_NAME` | `VPS Manager` | Sender display name |
| `EMAIL_FROM_ADDRESS` | — | Sender address (must be verified with your provider) |
| `RESEND_API_KEY` | — | API key from [resend.com](https://resend.com) (if `EMAIL_PROVIDER=resend`) |
| `BREVO_SMTP_USER` | — | Brevo SMTP login (if `EMAIL_PROVIDER=brevo`) |
| `BREVO_SMTP_PASS` | — | Brevo SMTP password / API key (if `EMAIL_PROVIDER=brevo`) |
| `ALLOWED_ORIGIN` | — | Public domain for CORS (e.g. `https://vps.yourdomain.com`). **Set automatically by the installer when SSL is issued.** |

> **Note:** SMTP settings saved through the Settings page are stored in the database and always take priority over `.env` values.

---

## Authentication

### First-time setup

On first visit — when no users exist — `/register` is available to create the admin account.  
Once created, **registration is permanently disabled** (returns 404 for all visitors).

### Login

- Accepts **email address or username** — either works
- Shows **inline field-level errors** for specific failures:
  - Unknown email or username → error shown below the identifier field
  - Wrong password → error shown below the password field
- Backend returns `404` for unknown user and `401` for wrong password, so the UI always puts the error in the right place

### Additional users

Only the logged-in admin can create additional accounts via **Manage Users** in the header dropdown.  
New accounts do not receive a session — the admin provides credentials manually.

### Password reset

1. Click **Forgot password?** on the login page
2. Enter your email — if no account is found, an **inline error** is shown immediately
3. If the account exists, a 6-digit code is sent (valid 10 minutes)
4. Enter the code on the reset page and choose a new password
5. All active sessions are immediately invalidated

> If SMTP is not configured, the reset code is printed to the PM2 log as a fallback.

### JWT tokens

| Token | Lifetime | Storage |
|---|---|---|
| Access token | 24 hours | `localStorage` |
| Refresh token | 7 days | PostgreSQL (rotated on each use) |

- All `/api/*` routes except `/api/auth/*` require `Authorization: Bearer <token>`
- The frontend silently refreshes the access token when it expires and retries the original request
- Logout immediately invalidates the refresh token server-side
- WebSocket terminal connections also verify the JWT before accepting

### Routing rules

| Scenario | Behaviour |
|---|---|
| Unauthenticated → protected page | Redirected to `/login` |
| Authenticated → `/login` | Redirected to `/` |
| No users in DB → `/register` | Registration form |
| Users exist → `/register` | **404 Not Found** |
| Unknown URL | **404 Not Found** |

---

## SMTP / Email Setup

Email is used for password reset codes. Three ways to configure:

### Option 1 — Settings page (recommended for production)

Log in → header dropdown → **Settings** → **Email / SMTP** tab.  
Choose Resend or Brevo, enter credentials, **Save**, then **Send test email**.

### Option 2 — `.env` file

```env
EMAIL_PROVIDER=resend          # or: brevo
EMAIL_FROM_NAME=VPS Manager
EMAIL_FROM_ADDRESS=noreply@yourdomain.com

# Resend
RESEND_API_KEY=re_xxxxxxxxxxxx

# Brevo (either one, not both)
BREVO_SMTP_USER=you@email.com
BREVO_SMTP_PASS=xsmtp-xxxxxxxxxxxx
```

### Option 3 — Installer prompt

The installer asks for provider and credentials and writes them to `.env` automatically.

> Your sender domain must be verified with the provider before emails will deliver.

---

## SSL / HTTPS

The installer handles SSL automatically when you provide a custom domain:

1. Polls `dig +short <domain> A` every 10 seconds (up to 5 minutes) to confirm DNS has propagated
2. Warns if extra A records exist (Let's Encrypt validates all of them)
3. Creates `/var/www/html/.well-known/acme-challenge/` for the ACME challenge
4. Adds a dedicated nginx location for `/.well-known/acme-challenge/` (served from disk, not proxied)
5. Runs a self-test — checks HTTP 200 on the ACME path before invoking certbot
6. Runs `certbot certonly --webroot -w /var/www/html -d <domain>`
7. On success:
   - Rewrites the port-80 block to a clean HTTP → HTTPS redirect (ACME path kept for renewal)
   - Appends a port-443 SSL block with `X-Forwarded-Proto: https` headers
   - Writes `ALLOWED_ORIGIN=https://<domain>` to `.env`
   - Removes port `5756` from the UFW firewall
   - Runs `pm2 restart vps-manager --update-env` to apply the new env immediately
   - Adds a daily auto-renewal cron (03:00)
8. Prints `https://<domain> ← HTTPS secured` as the final access URL

To add SSL manually after install:

```bash
# 1. Issue the certificate
sudo certbot certonly --webroot -w /var/www/html -d yourdomain.com

# 2. Add ALLOWED_ORIGIN to .env
echo "ALLOWED_ORIGIN=https://yourdomain.com" >> /root/vps-manager/.env

# 3. Restart the app to pick up the new env
pm2 restart vps-manager --update-env

# 4. Update nginx (add SSL block + HTTP redirect), then reload
sudo nginx -t && sudo systemctl reload nginx
```

---

## Remote Server Management

1. Go to **Servers** → **Add Server** — enter IP, port, username, and password or SSH key
2. Click **Connect** — a green banner confirms remote mode is active
3. All pages (PM2, Docker, Files, Terminal, etc.) proxy operations to the remote server over SSH
4. Click **Disconnect** to return to local mode

---

## Database

The app uses **PostgreSQL**. Tables are auto-created on first startup:

| Table | Contents |
|---|---|
| `users` | Admin and additional user accounts |
| `refresh_tokens` | Active JWT refresh tokens (rotated on each use) |
| `password_reset_codes` | One-time 6-digit reset codes (expire after 10 min) |
| `vps_connections` | Saved remote server connections |
| `smtp_settings` | SMTP configuration (stored as key/value pairs) |

The installer provisions a local PostgreSQL instance automatically. For a remote or managed database, set `DATABASE_URL` in `.env`.

---

## API Overview

All protected endpoints require:
```
Authorization: Bearer <access_token>
```

### Auth (public)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Create first admin (only when 0 users exist) |
| `POST` | `/api/auth/login` | Sign in with **email or username** + password |
| `POST` | `/api/auth/refresh` | Rotate refresh token, get a new pair |
| `POST` | `/api/auth/logout` | Invalidate refresh token |
| `GET` | `/api/auth/me` | Get current user (requires auth) |
| `GET` | `/api/auth/setup-required` | Returns `true` if no users exist |
| `POST` | `/api/auth/forgot-password` | Send 6-digit reset code (`404` if email not found) |
| `POST` | `/api/auth/reset-password` | Verify code and set new password |

### User management (requires auth)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/users` | Admin creates a new user |
| `GET` | `/api/auth/users` | List all users |
| `DELETE` | `/api/auth/users/:id` | Delete a user (cannot delete yourself) |

### Settings (requires auth)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/settings/smtp` | Get current SMTP config (keys masked) |
| `POST` | `/api/settings/smtp` | Save SMTP configuration |
| `POST` | `/api/settings/smtp/test` | Send a test email to the admin's address |

### Protected modules

| Prefix | Description |
|---|---|
| `/api/system` | CPU, RAM, disk, uptime |
| `/api/pm2` | PM2 process management |
| `/api/docker` | Docker containers, images, volumes |
| `/api/databases` | Database browsing and queries |
| `/api/files` | File manager (upload, rename, edit, download, compress) |
| `/api/servers` | Remote VPS connection management |
| `/api/remote/:id/*` | Proxy operations to a saved remote server |
| `/api/extras` | System tools, cron, firewall, env editor |
| `/api/nginx` | Nginx config management |
| `/api/github` | GitHub repo detection |

---

## Project Structure

```
vps-manager/
├── install.sh                   # One-command installer
├── package.json
├── vite.config.ts               # Vite: dev server on :5000, build → dist/public/
├── tsconfig*.json
├── index.html                   # Vite entry point
├── .env.example
├── .gitignore
│
├── server/                      # Express + TypeScript backend (port 5756)
│   ├── index.ts                 # Entry point: CORS, Socket.IO, routes, static serving
│   ├── db.ts                    # PostgreSQL pool + auto-migration (5 tables)
│   ├── ssh.ts                   # SSH2 client helpers
│   ├── middleware/
│   │   └── auth.ts              # requireAuth — JWT Bearer verification
│   ├── services/
│   │   └── email.ts             # sendMail(): Resend + Brevo; HTML templates
│   └── routes/
│       ├── auth.ts              # register · login (email OR username) · refresh
│       │                        # logout · me · setup-required
│       │                        # forgot-password · reset-password · users CRUD
│       ├── settings.ts          # SMTP config + test
│       ├── system.ts            # CPU / RAM / disk / uptime
│       ├── pm2.ts               # PM2 process management
│       ├── docker.ts            # Containers · images · volumes
│       ├── databases.ts         # PostgreSQL · MySQL · SQLite browser
│       ├── files.ts             # File manager operations
│       ├── nginx.ts             # Nginx config management
│       ├── extras.ts            # Cron · firewall · env · tools
│       ├── vps-connections.ts   # Saved server connections
│       ├── remote.ts            # Remote proxy (/api/remote/:id/*)
│       ├── vps.ts               # Legacy VPS helpers
│       └── github.ts            # GitHub repo detection
│
├── src/                         # React + TypeScript frontend
│   ├── main.tsx                 # App root, React Query provider, AOS init
│   ├── App.tsx                  # Route tree (public / auth / protected)
│   ├── index.css                # Global styles, CSS variables, hero keyframe animations
│   ├── lib/
│   │   └── api.ts               # Axios + JWT interceptors + auto-refresh
│   ├── context/
│   │   ├── AuthContext.tsx      # User state, login / logout / refresh
│   │   ├── ThemeContext.tsx     # Dark / light mode
│   │   └── RemoteServerContext.tsx
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Layout.tsx           # Protected app shell
│   │   │   ├── PublicLayout.tsx     # Public / auth shell with AOS scroll animations
│   │   │   ├── Header.tsx
│   │   │   ├── Footer.tsx
│   │   │   └── MobileSidebar.tsx
│   │   └── ui/
│   │       └── ...                  # Shared UI components
│   └── pages/
│       ├── public/
│       │   ├── Landing.tsx          # Hero: animated gradient text + floating glow blobs
│       │   ├── About.tsx
│       │   ├── Contact.tsx
│       │   ├── Terms.tsx
│       │   └── Privacy.tsx
│       ├── auth/
│       │   ├── Login.tsx            # Email or username; inline per-field errors
│       │   ├── ForgotPassword.tsx   # Inline error for unknown email
│       │   ├── Register.tsx
│       │   └── ResetPassword.tsx
│       ├── Dashboard.tsx
│       ├── PM2.tsx
│       ├── Docker.tsx
│       ├── Databases.tsx
│       ├── FileManager.tsx
│       ├── Terminal.tsx
│       ├── Nginx.tsx
│       ├── Extras.tsx
│       ├── Servers.tsx
│       └── Settings.tsx
```

---

## Troubleshooting

### Blank page when visiting via custom HTTPS domain

**Cause:** Vite builds emit `<script type="module">`. Browsers include an `Origin` header when fetching module scripts, which hits the Express CORS middleware. Without `ALLOWED_ORIGIN` in `.env`, the middleware rejects the request and Express returns HTTP 500 on the JS bundle.

**Fix:**
```bash
echo "ALLOWED_ORIGIN=https://yourdomain.com" >> /root/vps-manager/.env
pm2 restart vps-manager --update-env
```

The installer now sets this automatically when SSL is issued.

---

### App not accessible after SSL setup

1. Check nginx config is valid: `sudo nginx -t`
2. Reload nginx: `sudo systemctl reload nginx`
3. Confirm the cert was issued: `sudo certbot certificates`
4. Check the nginx config: `cat /etc/nginx/sites-available/vps-manager`

---

### 502 Bad Gateway

Nginx can't reach the app on port 5756.

```bash
pm2 status
pm2 restart vps-manager
pm2 logs vps-manager --lines 50
```

---

### PM2 app crashes on start

```bash
pm2 logs vps-manager --lines 100
```

Common causes: missing `.env`, wrong PostgreSQL credentials, port already in use.

---

### Certbot ACME challenge fails

```bash
# Check the ACME location is in nginx config
grep -A3 "well-known" /etc/nginx/sites-available/vps-manager

# Reload nginx, then retry
sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/html -d yourdomain.com
```

---

## License

MIT — see [LICENSE](LICENSE).

---

*Built with ❤ by [Gifted Tech](https://giftedtech.co.ke)*
