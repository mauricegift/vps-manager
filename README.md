# VPS Manager

A modern, self-hosted web control panel for managing your Linux VPS — PM2 processes, Docker, Nginx, databases, files and a full interactive terminal, all from one clean dashboard.

[![GitHub](https://img.shields.io/badge/GitHub-mauricegift%2Fvps--manager-blue?logo=github)](https://github.com/mauricegift/vps-manager)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green?logo=node.js)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-18-blue?logo=react)](https://react.dev)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-blue?logo=postgresql)](https://postgresql.org)

---

## Features

| Module | What you can do |
|---|---|
| **Dashboard** | Real-time CPU, RAM, disk and uptime stats |
| **PM2** | Start / stop / restart processes, view logs, deploy from GitHub |
| **Docker** | Manage containers, images and volumes |
| **Databases** | Browse and query PostgreSQL, MySQL, SQLite |
| **File Manager** | Upload, rename, edit (syntax-highlighted), download, compress files |
| **Terminal** | Full interactive bash shell — local and SSH to any remote server |
| **Nginx** | Create / edit reverse-proxy configs, manage SSL via Let's Encrypt |
| **Extras** | Cron jobs, firewall rules, env editor, system tools |
| **Servers** | Save and manage unlimited remote VPS connections |
| **Settings** | SMTP email, user management, account settings |

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

---

## Ports

| Port | Purpose |
|---|---|
| `5756` | Backend API + frontend static files (Express) |
| `80` | Nginx reverse proxy (HTTP) |
| `443` | Nginx reverse proxy (HTTPS, after SSL setup) |

Everything is served through one process on port 5756. Nginx proxies port 80/443 to it.  
Direct access without nginx: `http://YOUR_SERVER_IP:5756`

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
| `ALLOWED_ORIGIN` | — | Your public domain for CORS in production (e.g. `https://vps.yourdomain.com`) |

> **Note:** SMTP settings saved through the Settings page are stored in the database and always take priority over `.env` values.

---

## Authentication

### First-time setup

On first visit — when no users exist — `/register` is available to create the admin account.  
Once created, **registration is permanently disabled** (returns 404 for all visitors).

### Additional users

Only the logged-in admin can create additional accounts via **Manage Users** in the header dropdown.  
New accounts do not receive a session — the admin provides credentials manually.

### Password reset

1. Click **Forgot password?** on the login page
2. Enter your email — a 6-digit code is sent (valid 10 minutes)
3. Enter the code and choose a new password
4. All active sessions are immediately invalidated

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
2. Creates `/var/www/html/.well-known/acme-challenge/` for the ACME challenge
3. Adds a dedicated nginx location for `/.well-known/acme-challenge/` (served from disk, not proxied)
4. Reloads nginx so the ACME location is live before certbot runs
5. Runs `certbot certonly --webroot -w /var/www/html -d <domain>`
6. Appends a port-443 SSL server block to the nginx config
7. Adds an auto-renewal cron (daily at 03:00)

To add SSL manually after install:

```bash
# Make sure nginx has the ACME challenge location in its config, then:
sudo certbot certonly --webroot -w /var/www/html -d yourdomain.com
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
| `POST` | `/api/auth/login` | Sign in, receive access + refresh tokens |
| `POST` | `/api/auth/refresh` | Rotate refresh token, get a new pair |
| `POST` | `/api/auth/logout` | Invalidate refresh token |
| `GET` | `/api/auth/me` | Get current user (requires auth) |
| `GET` | `/api/auth/setup-required` | Returns `true` if no users exist |
| `POST` | `/api/auth/forgot-password` | Send 6-digit reset code to email |
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
│       ├── auth.ts              # register · login · refresh · logout · me
│       │                        # setup-required · forgot-password · reset-password
│       │                        # users CRUD
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
│   ├── main.tsx                 # App root, React Query provider
│   ├── App.tsx                  # Route tree (public / auth / protected)
│   ├── index.css                # Global styles + CSS variables
│   ├── lib/
│   │   └── api.ts               # Axios + JWT interceptors + auto-refresh
│   ├── context/
│   │   ├── AuthContext.tsx      # User state, login / logout / refresh
│   │   ├── ThemeContext.tsx     # Dark / light mode
│   │   └── RemoteServerContext.tsx
│   ├── types/
│   │   ├── index.ts
│   │   └── server.ts
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Layout.tsx           # Protected app shell
│   │   │   ├── PublicLayout.tsx     # Public / auth shell
│   │   │   ├── Header.tsx           # Top bar with nav, theme, user dropdown
│   │   │   ├── Footer.tsx
│   │   │   └── MobileSidebar.tsx
│   │   └── ui/
│   │       ├── ProtectedRoute.tsx   # → /login if unauthenticated
│   │       ├── GuestRoute.tsx       # → / if already authenticated
│   │       ├── SetupRoute.tsx       # → 404 if users already exist
│   │       └── ...
│   └── pages/
│       ├── Dashboard.tsx
│       ├── PM2.tsx
│       ├── Docker.tsx
│       ├── Databases.tsx
│       ├── FileManager.tsx
│       ├── Terminal.tsx
│       ├── Servers.tsx
│       ├── Extras.tsx
│       ├── Nginx.tsx
│       ├── Settings.tsx         # SMTP config + user management tabs
│       ├── NotFound.tsx
│       ├── auth/
│       │   ├── Login.tsx
│       │   ├── Register.tsx     # First-time admin setup only
│       │   ├── ForgotPassword.tsx
│       │   └── ResetPassword.tsx
│       └── public/
│           ├── Landing.tsx
│           ├── About.tsx
│           ├── Contact.tsx
│           ├── Terms.tsx
│           └── Privacy.tsx
│
└── public/                      # Static assets (favicon, OG image)
```

---

## Tech Stack

**Frontend**

| Library | Purpose |
|---|---|
| React 18 + TypeScript | UI framework |
| Vite 6 | Build tool and dev server |
| Tailwind CSS v4 | Utility-first styling |
| React Router v6 | Client-side routing |
| TanStack Query | Server state and data fetching |
| Axios | HTTP client with JWT interceptors |
| Socket.IO client | Real-time WebSocket terminal |
| highlight.js | Syntax-highlighted file editor |
| Framer Motion + AOS | Animations |
| Lucide React | Icons |

**Backend**

| Library | Purpose |
|---|---|
| Node.js + Express | HTTP server |
| TypeScript (tsx) | Type-safe backend, no compile step |
| PostgreSQL (pg) | Primary database |
| jsonwebtoken + bcryptjs | JWT auth and password hashing |
| Socket.IO | WebSocket server (terminal) |
| SSH2 | Remote server connections |
| Resend | Transactional email (Option A) |
| Nodemailer | Brevo SMTP transport (Option B) |
| Multer | File uploads |

**Infrastructure**

| Tool | Purpose |
|---|---|
| Nginx | Reverse proxy (port 80 / 443) |
| PM2 | Process manager + auto-restart on reboot |
| PostgreSQL | Database (auto-provisioned by installer) |
| Let's Encrypt / Certbot | Free SSL certificates (webroot mode) |
| UFW | Firewall management |

---

## Scripts

| Script | Command | Description |
|---|---|---|
| Development | `npm run dev` | Backend on :5756 + Vite dev server on :5000 |
| Build | `npm run build` | Compile React app → `dist/public/` |
| Production | `npm start` | Express serves API + built frontend from `dist/public/` |

---

## Contributing

1. Fork the repo
2. Create a branch: `git checkout -b feat/my-feature`
3. Commit and push your changes
4. Open a Pull Request

Bug reports and feature requests → [GitHub Issues](https://github.com/mauricegift/vps-manager/issues)

---

## License

MIT © [Gifted Tech](https://me.giftedtech.co.ke)
