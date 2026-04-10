# VPS Manager

A modern, self-hosted web control panel for managing your Linux VPS — PM2, Docker, Nginx, databases, files and a full web terminal, all in one place.

[![GitHub](https://img.shields.io/badge/GitHub-mauricegift%2Fvps--manager-blue?logo=github)](https://github.com/mauricegift/vps-manager)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-24-green?logo=node.js)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-18-blue?logo=react)](https://react.dev)

---

## Features

| Module | What you can do |
|---|---|
| **Dashboard** | Real-time CPU, RAM, disk and uptime stats |
| **PM2** | Start / stop / restart processes, view logs, deploy from GitHub |
| **Docker** | Manage containers, images and volumes |
| **Databases** | Browse and query PostgreSQL, MySQL, SQLite |
| **File Manager** | Upload, edit (syntax-highlighted), download, zip files |
| **Terminal** | Full interactive bash shell — local and remote SSH |
| **Nginx** | Create / edit reverse-proxy configs, manage SSL via Let's Encrypt |
| **Extras** | Cron jobs, firewall, env editor, system tools |
| **Servers** | Connect and manage unlimited remote VPS servers |
| **Settings** | Configure SMTP email provider (Resend or Brevo) |

---

## Quick Install

  > **Run as root for the smoothest experience** (no sudo prompts, no permission issues).
  > Non-root users are also supported — the installer will automatically prefix system commands with `sudo`.

  ```bash
  # As root (recommended)
  curl -fsSL https://raw.githubusercontent.com/mauricegift/vps-manager/main/install.sh | bash

  # As a non-root user with sudo access
  curl -fsSL https://raw.githubusercontent.com/mauricegift/vps-manager/main/install.sh | sudo bash
  ```

  The installer will:
1. Install system packages (`git`, `nginx`, `dnsutils`, etc.)
2. Install Node.js 24 via NVM
3. Install PM2 globally
4. Clone this repository to `$HOME/vps-manager` (your home directory)
5. Install npm dependencies
6. Prompt for SMTP provider (Resend or Brevo) and write settings to `.env`
7. Generate a random `SESSION_SECRET` for JWT signing
8. Configure UFW firewall rules
9. Start the app with PM2 (auto-restart on reboot)
10. Set up an Nginx reverse proxy on port 80
11. Optionally issue a free SSL certificate via Let's Encrypt (with automatic DNS polling via `dig`)

---

## Manual Install

```bash
# Clone
git clone https://github.com/mauricegift/vps-manager.git
cd vps-manager

# Install dependencies
npm install

# Create .env (copy and edit)
cp .env.example .env
# Edit .env with your settings (SESSION_SECRET, database, SMTP, etc.)

# Development — runs backend + frontend concurrently
npm run dev

# Production build + start
npm run build
npm start
```

### Run with PM2

```bash
pm2 start npm --name vps-manager -- run dev
pm2 save && pm2 startup
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in your values.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5756` | Backend API port |
| `SESSION_SECRET` | — | **Required** — JWT signing secret (generate with `openssl rand -hex 32`) |
| `NODE_ENV` | `production` | Node environment |
| `DATABASE_URL` | — | Full PostgreSQL connection string (or use individual vars below) |
| `PGHOST` | `localhost` | PostgreSQL host |
| `PGPORT` | `5432` | PostgreSQL port |
| `PGUSER` | `vpsmanager` | PostgreSQL user |
| `PGPASSWORD` | `vpsmanager_secret` | PostgreSQL password |
| `PGDATABASE` | `vpsmanager` | PostgreSQL database name |
| `EMAIL_PROVIDER` | `none` | Email provider: `resend`, `brevo`, or `none` |
| `EMAIL_FROM_NAME` | `VPS Manager` | Sender display name |
| `EMAIL_FROM_ADDRESS` | — | Sender email address (must be verified with your provider) |
| `RESEND_API_KEY` | — | API key from [resend.com](https://resend.com) (if `EMAIL_PROVIDER=resend`) |
| `BREVO_SMTP_USER` | — | Brevo SMTP login (if `EMAIL_PROVIDER=brevo`) |
| `BREVO_SMTP_PASS` | — | Brevo SMTP password / API key (if `EMAIL_PROVIDER=brevo`) |
| `ALLOWED_ORIGIN` | — | Your public domain for CORS (leave blank in dev) |

> **Note:** SMTP settings saved through the Settings page (stored in the database) take priority over environment variables.

---

## Authentication

### First-time setup

On first visit — when no users exist — `/register` is available to create the admin account. Once created, **the registration route is permanently disabled (returns 404 for everyone)**. There is no way to self-register after setup.

### Subsequent users

Only the logged-in admin can create additional accounts, via **Manage Users** in the header dropdown. Additional users never receive a login session automatically — the admin hands them credentials manually.

### Password Reset

1. Click **Forgot password?** on the login page
2. Enter your email — a 6-digit reset code is sent (valid 10 minutes)
3. Go to the reset page, enter the code and choose a new password
4. All active sessions are invalidated and you must sign in again

> If SMTP is not configured, the reset code is printed to the server console log as a fallback.

### How JWT works

| Token | Lifetime | Storage |
|---|---|---|
| Access token | 24 hours | `localStorage` |
| Refresh token | 7 days | PostgreSQL DB (rotated on each use) |

- All API routes except `/api/auth/*` require `Authorization: Bearer <token>`
- The frontend silently refreshes the access token when it expires and retries the failed request
- Logging out immediately invalidates the refresh token server-side
- WebSocket (terminal) connections also require a valid JWT

### Routing rules

| Scenario | Behaviour |
|---|---|
| Not logged in → protected page | Redirected to `/login` |
| Logged in → `/login` | Redirected to `/` |
| No users in DB → `/register` | Registration form shown |
| Users exist → `/register` | **404 Not Found** |
| Unknown URL | **404 Not Found** |

---

## SMTP / Email Setup

Email is used for password reset codes. You can configure it three ways:

### Option 1 — Settings page (recommended)

Log in → user dropdown → **Settings** → Email/SMTP section.  
Choose **Resend** or **Brevo**, fill in your credentials, click **Save**, then **Send test email** to verify.

### Option 2 — `.env` file (development)

```env
EMAIL_PROVIDER=resend          # or brevo
EMAIL_FROM_NAME=VPS Manager
EMAIL_FROM_ADDRESS=noreply@yourdomain.com
RESEND_API_KEY=re_xxxxx        # Resend only
BREVO_SMTP_USER=you@email.com  # Brevo only
BREVO_SMTP_PASS=xsmtp-xxxxx    # Brevo only
```

### Option 3 — install.sh (production)

The installer will ask whether you want to use Resend or Brevo and write the values to `.env` automatically.

> **Sender domain must be verified** with your email provider (Resend or Brevo) before emails will deliver.

---

## API Overview

All protected endpoints require:
```
Authorization: Bearer <access_token>
```

### Auth (public)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Create first admin (only works when 0 users exist) |
| `POST` | `/api/auth/login` | Sign in, receive tokens |
| `POST` | `/api/auth/refresh` | Rotate refresh token, get new pair |
| `POST` | `/api/auth/logout` | Invalidate refresh token |
| `GET` | `/api/auth/me` | Get current user (requires auth) |
| `GET` | `/api/auth/setup-required` | Check if any users exist |
| `POST` | `/api/auth/forgot-password` | Request 6-digit password reset code |
| `POST` | `/api/auth/reset-password` | Verify code and set new password |

### User management (requires auth)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/users` | Admin creates a new user |
| `GET` | `/api/auth/users` | List all users |
| `DELETE` | `/api/auth/users/:id` | Delete a user (cannot delete self) |

### Settings (requires auth)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/settings/smtp` | Get current SMTP configuration (masked) |
| `POST` | `/api/settings/smtp` | Save SMTP configuration |
| `POST` | `/api/settings/smtp/test` | Send a test email to the admin's address |

### Protected

| Prefix | Description |
|---|---|
| `/api/system` | CPU, RAM, disk, uptime |
| `/api/pm2` | PM2 process management |
| `/api/docker` | Docker containers, images, volumes |
| `/api/databases` | Database browsing and queries |
| `/api/files` | File manager operations |
| `/api/servers` | Remote VPS connection management |
| `/api/remote/:id/*` | Proxy operations to a remote server |
| `/api/extras` | System tools, cron, firewall, env |
| `/api/nginx` | Nginx config management |
| `/api/github` | GitHub repo detection |

---

## Project Tree

### Full tree

```
vps-manager/
├── install.sh                   # One-command installer
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
├── .env.example                 # Environment variable reference
├── .gitignore
│
├── server/                      # Express + TypeScript backend
│   ├── index.ts                 # Entry point, Socket.IO, route wiring
│   ├── db.ts                    # PostgreSQL pool + auto-migration
│   ├── ssh.ts                   # SSH helper utilities
│   ├── middleware/
│   │   └── auth.ts              # requireAuth middleware (JWT verify)
│   ├── services/
│   │   └── email.ts             # Email service: Resend + Brevo, HTML templates
│   └── routes/
│       ├── auth.ts              # /api/auth/* — register, login, refresh, users,
│       │                        # forgot-password, reset-password
│       ├── settings.ts          # /api/settings/smtp — SMTP config + test
│       ├── system.ts            # /api/system — CPU, RAM, disk, uptime
│       ├── pm2.ts               # /api/pm2 — process management
│       ├── docker.ts            # /api/docker — containers, images, volumes
│       ├── databases.ts         # /api/databases — query PostgreSQL/MySQL/SQLite
│       ├── files.ts             # /api/files — file manager operations
│       ├── nginx.ts             # /api/nginx — config management
│       ├── extras.ts            # /api/extras — cron, firewall, env, tools
│       ├── vps.ts               # /api/vps — legacy VPS helpers
│       ├── vps-connections.ts   # /api/servers — saved server connections
│       ├── remote.ts            # /api/remote/:id/* — remote proxy
│       └── github.ts            # /api/github — repo detection
│
└── src/                         # React + TypeScript frontend
    ├── main.tsx                 # App root, providers, scroll-to-top
    ├── App.tsx                  # Route tree (public / auth / protected)
    ├── index.css                # Global styles + CSS variables
    ├── lib/
    │   └── api.ts               # Axios instance with JWT interceptors + auto-refresh
    ├── context/
    │   ├── AuthContext.tsx      # User state, login/register/logout/refresh
    │   ├── ThemeContext.tsx     # Dark / light mode
    │   └── RemoteServerContext.tsx
    ├── types/
    │   ├── index.ts
    │   └── server.ts
    ├── components/
    │   ├── layout/
    │   │   ├── Layout.tsx           # App shell (header + sidebar + footer)
    │   │   ├── PublicLayout.tsx     # Public/auth shell with mobile sidebar
    │   │   ├── Header.tsx           # App header with nav, user dropdown, settings
    │   │   ├── Footer.tsx           # App footer (minimal)
    │   │   └── MobileSidebar.tsx    # Mobile navigation drawer (app)
    │   └── ui/
    │       ├── ProtectedRoute.tsx
    │       ├── GuestRoute.tsx
    │       ├── SetupRoute.tsx
    │       └── ...
    └── pages/
        ├── NotFound.tsx         # 404 page
        ├── Dashboard.tsx
        ├── PM2.tsx
        ├── Docker.tsx
        ├── Databases.tsx
        ├── FileManager.tsx
        ├── Terminal.tsx
        ├── Servers.tsx
        ├── Extras.tsx
        ├── Nginx.tsx
        ├── Settings.tsx         # SMTP configuration page
        ├── auth/
        │   ├── Login.tsx        # Sign-in form (with Forgot password link)
        │   ├── Register.tsx     # First-time admin setup
        │   ├── ForgotPassword.tsx   # Request reset code (60s resend cooldown)
        │   └── ResetPassword.tsx    # Enter code + new password
        └── public/
            ├── Landing.tsx
            ├── About.tsx
            ├── Contact.tsx
            ├── Terms.tsx
            └── Privacy.tsx
```

### Backend tree

```
server/
├── index.ts                 # Express + Socket.IO, route wiring, WS JWT auth
├── db.ts                    # PostgreSQL pool; auto-creates 5 tables on startup:
│                            #   vps_connections, users, refresh_tokens,
│                            #   password_reset_codes, smtp_settings
├── ssh.ts                   # SSH2 client helpers
├── middleware/
│   └── auth.ts              # requireAuth — verifies Bearer JWT, attaches req.user
├── services/
│   └── email.ts             # sendMail() — tries Resend then Brevo
│                            # getSmtpConfig() — DB first, env vars fallback
│                            # saveSmtpConfig() — upsert to smtp_settings table
│                            # HTML email templates (reset code, confirmation, test)
└── routes/
    ├── auth.ts              # POST /register (setup only) · POST /login
    │                        # POST /refresh · POST /logout · GET /me
    │                        # GET /setup-required
    │                        # POST /forgot-password → generates 6-digit OTP
    │                        # POST /reset-password → verifies OTP, updates password
    │                        # POST /users (admin) · GET /users · DELETE /users/:id
    ├── settings.ts          # GET /smtp · POST /smtp · POST /smtp/test
    ├── system.ts
    ├── pm2.ts
    ├── docker.ts
    ├── databases.ts
    ├── files.ts
    ├── nginx.ts
    ├── extras.ts
    ├── vps.ts
    ├── vps-connections.ts
    ├── remote.ts
    └── github.ts
```

### Frontend tree

```
src/
├── main.tsx
├── App.tsx                  # Route tree:
│                            #   PublicLayout: /home /about /terms /privacy /contact
│                            #                /login (GuestRoute)
│                            #                /register (SetupRoute — 404 if users exist)
│                            #                /forgot-password · /reset-password
│                            #                * → NotFound
│                            #   Protected (Layout): / /pm2 /docker /databases
│                            #                       /files /terminal /servers
│                            #                       /extras /nginx /settings
├── index.css
├── lib/
│   └── api.ts
├── context/
│   ├── AuthContext.tsx
│   ├── ThemeContext.tsx
│   └── RemoteServerContext.tsx
├── types/
│   ├── index.ts
│   └── server.ts
├── components/
│   ├── layout/
│   │   ├── Layout.tsx           # Protected app shell
│   │   ├── PublicLayout.tsx     # Public/auth shell:
│   │   │                        #   · Auth-aware header (Dashboard or Sign In)
│   │   │                        #   · Desktop nav (Home/About/Contact/Terms/Privacy)
│   │   │                        #   · Mobile hamburger → sidebar with same nav
│   │   │                        #   · Nav hidden on auth pages
│   │   │                        #   · Minimal footer (logo + copyright)
│   │   ├── Header.tsx           # Fixed top bar: logo, nav, theme, user dropdown
│   │   │                        #   Dropdown: Settings → /settings
│   │   │                        #             Manage Users → modal
│   │   │                        #             Sign out
│   │   ├── Footer.tsx
│   │   └── MobileSidebar.tsx
│   └── ui/
│       ├── ProtectedRoute.tsx   # if !user → /login
│       ├── GuestRoute.tsx       # if user  → /
│       ├── SetupRoute.tsx       # if users exist → NotFoundPage
│       └── ...
└── pages/
    ├── NotFound.tsx
    ├── Settings.tsx         # SMTP config: provider, from name/email, credentials,
    │                        # Save + Send test email
    ├── Dashboard.tsx
    ├── PM2.tsx
    ├── Docker.tsx
    ├── Databases.tsx
    ├── FileManager.tsx
    ├── Terminal.tsx
    ├── Servers.tsx
    ├── Extras.tsx
    ├── Nginx.tsx
    ├── auth/
    │   ├── Login.tsx        # Email + password; "Forgot password?" link
    │   ├── Register.tsx     # First-time admin setup
    │   ├── ForgotPassword.tsx   # Step 1: enter email → send code
    │   │                        # Step 2: success state + resend (60s cooldown)
    │   └── ResetPassword.tsx    # Enter code + new password + confirm → change
    └── public/
        ├── Landing.tsx
        ├── About.tsx
        ├── Contact.tsx
        ├── Terms.tsx
        └── Privacy.tsx
```

---

## SSL / HTTPS

The installer optionally sets up Let's Encrypt SSL:
1. Polls `dig +short <domain> A` every 10 seconds (up to 5 minutes) until DNS resolves to this server
2. Automatically proceeds without any manual prompts once DNS is confirmed
3. Runs `certbot --nginx` and adds an auto-renewal cron

To add SSL manually after install:
```bash
sudo certbot --nginx -d yourdomain.com
```

---

## Remote Server Management

1. Go to **Servers**, click **Add Server** and enter IP, port, username, and password or SSH key
2. Click **Connect** — a green banner appears confirming remote mode
3. All pages (PM2, Docker, Files, Terminal, etc.) now proxy operations to the remote server
4. Click **Disconnect** to return to local mode

---

## Tech Stack

**Frontend**

| Library | Purpose |
|---|---|
| React 18 + TypeScript | UI framework |
| Vite 6 | Build tool and dev server |
| Tailwind CSS | Utility-first styling with CSS variables |
| React Router v6 | Client-side routing |
| TanStack Query | Server state and data fetching |
| Axios | HTTP client with JWT interceptors |
| Socket.IO client | Real-time WebSocket terminal |
| highlight.js | Syntax-highlighted file editor |
| Framer Motion + AOS | Animations |
| Lucide React | Icon library |

**Backend**

| Library | Purpose |
|---|---|
| Node.js + Express | HTTP server |
| TypeScript (tsx) | Type-safe backend |
| PostgreSQL (pg) | Primary database |
| jsonwebtoken + bcryptjs | JWT auth and password hashing |
| Socket.IO | WebSocket server (terminal) |
| SSH2 | Remote server SSH connections |
| Resend | Transactional email (primary) |
| Nodemailer | Brevo SMTP transport (alternative) |
| Multer | File uploads |
| Nginx | Reverse proxy in production |

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
