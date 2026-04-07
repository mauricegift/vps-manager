# VPS Manager

> A professional full-stack VPS control panel built with React + TypeScript + Express.
> Manage PM2 processes, Docker containers, databases, files, and SSH terminals across unlimited remote servers — all from a clean, responsive UI.

**Author:** [Gifted Tech](https://me.giftedtech.co.ke) · [GitHub @mauricegift](https://github.com/mauricegift)

---

## Features

| Module | Description |
|---|---|
| **Dashboard** | Real-time CPU, memory, disk, uptime and network stats |
| **PM2 Manager** | List, start, stop, restart, delete processes — live logs & version badges |
| **Docker Manager** | Container & image management, start/stop/remove, stats |
| **Database Browser** | PostgreSQL, MySQL, MariaDB, MongoDB, Redis — browse tables, run queries |
| **File Manager** | Navigate, create, edit, delete, upload and download files over SSH |
| **SSH Terminal** | Full xterm.js terminal with dark/light themes, persistent connections |
| **Extras** | Install/update Node.js, Bun, PM2, Python, Nginx, Apache, Certbot |
| **Multi-server** | Add unlimited remote VPS servers, switch between them instantly |

---

## Screenshots

> The UI adapts to both light and dark modes and is fully responsive for mobile.

---

## Quick Start

### Prerequisites

- **Node.js** 18 or later
- **PostgreSQL** (for the local database that stores server credentials)

### Automated Install

```bash
# Clone the repo
git clone https://github.com/mauricegift/vps-manager.git
cd vps-manager

# Run the installer (handles PostgreSQL setup, .env creation, npm install, build)
bash install.sh
```

The installer will:
1. Check for an existing PostgreSQL installation (uses it if present, installs it if not)
2. Create the `vpsmanager` database and user (skips if they already exist)
3. Generate a `.env` file with secure random secrets
4. Install npm dependencies
5. Build the frontend

### Manual Install

```bash
# 1. Clone and enter the project
git clone https://github.com/mauricegift/vps-manager.git
cd vps-manager

# 2. Create .env (copy and fill in your values)
cp .env.example .env        # or create manually (see below)

# 3. Install dependencies
npm install

# 4. Build the frontend
npm run build

# 5. Start the server
npm start
```

### Required `.env` variables

```env
DATABASE_URL=postgresql://vpsmanager:password@localhost:5432/vpsmanager
PGHOST=localhost
PGPORT=5432
PGUSER=vpsmanager
PGPASSWORD=your_password
PGDATABASE=vpsmanager
SESSION_SECRET=your_32char_secret
PORT=5756
```

---

## Running

| Command | Description |
|---|---|
| `npm start` | Start in production mode (serves built frontend + API) |
| `npm run dev` | Start in development mode with hot reload |
| `pm2 start dist/server/index.js --name vps-manager` | Run with PM2 (recommended for production) |

The frontend runs on **port 5000** (Vite dev) or is served statically in production.
The API server runs on **port 5756**.

---

## Adding Remote Servers

1. Go to the **Servers** page
2. Click **Add Server**
3. Enter the server's IP, SSH port (default 22), username, and either a password or SSH private key
4. Click **Test Connection** to verify
5. Once saved, select the server from the top bar to manage it remotely

All SSH connections are pooled and reused for efficiency.

---

## Database Browser

The built-in database browser supports:

| Database | Features |
|---|---|
| **PostgreSQL** | List tables, browse rows with pagination, run SQL queries |
| **MySQL / MariaDB** | List tables, browse rows with pagination, run SQL queries |
| **MongoDB** | List collections, browse documents (JSON), run JS expressions |
| **Redis** | Scan all keys, inspect string/list/hash/set/zset values, run commands |

> No database client installation required — the app shells out to `psql`, `mysql`, `mongosh`, and `redis-cli` on the target server.

---

## Architecture

```
vps-manager/
├── src/                         # React frontend (Vite + TypeScript)
│   ├── pages/                   # Dashboard, PM2, Docker, Databases, Files, Terminal, Extras, Servers
│   ├── components/
│   │   ├── layout/              # Header, Footer, Layout, MobileSidebar
│   │   └── ui/                  # Modal, StatusBadge, StatCard, AnsiText, CodeView, ConfirmDialog
│   ├── context/                 # ThemeContext, RemoteServerContext
│   ├── lib/api.ts               # Axios instance (baseURL /api)
│   └── types/                   # Shared TypeScript interfaces
│
├── server/                      # Express API (TypeScript)
│   ├── index.ts                 # App entry, static serving, Socket.io
│   ├── db.ts                    # PostgreSQL connection pool
│   ├── ssh.ts                   # SSH2 persistent connection pool + helpers
│   └── routes/
│       ├── system.ts            # Local system stats
│       ├── pm2.ts               # Local PM2 management
│       ├── docker.ts            # Local Docker management
│       ├── databases.ts         # Local database browser (pg, mysql, mongo, redis)
│       ├── files.ts             # Local file manager
│       ├── extras.ts            # Local extras/software manager
│       ├── vps.ts               # VPS connection management
│       ├── vps-connections.ts   # SSH connection CRUD
│       └── remote.ts            # Remote server proxy (all of the above over SSH)
│
├── public/                      # Static assets (favicon.svg, og-image.svg)
├── index.html                   # Root HTML with SEO meta tags
├── install.sh                   # One-shot installation script
├── vite.config.ts               # Vite configuration
└── package.json
```

### Key Design Decisions

- **SSH connection pool** — `getPooledClient()` in `ssh.ts` reuses live SSH2 connections per `user@host:port`. Idle connections are cleaned up after 5 minutes.
- **Script runner** — `runSSHScript()` base64-encodes multi-line scripts and pipes them to `bash`, avoiding complex shell escaping for compound remote commands.
- **DB auth fallback chain** — `pgTry()` / `mysqlTry()` helpers generate OR-chained shell commands that silently try multiple authentication methods (socket, sudo, TCP) until one succeeds.
- **Remote mode** — All pages transparently switch between local and remote routes based on `RemoteServerContext`. The `dbApiBase()` helper handles URL switching.

---

## Tech Stack

### Frontend
| Package | Purpose |
|---|---|
| React 18 + TypeScript | UI framework |
| Vite | Build tool + dev server |
| Tailwind CSS v4 | Utility-first styling |
| TanStack Query | Server state management |
| React Router | Client-side routing |
| xterm.js | Terminal emulator |
| Socket.io client | WebSocket for terminal |
| AOS | Scroll animations |
| Lucide React | Icon library |

### Backend
| Package | Purpose |
|---|---|
| Express | HTTP server |
| ssh2 | SSH client for remote management |
| pg | PostgreSQL client (for local app DB) |
| Socket.io | WebSocket server for terminal |
| express-session | Session management |

---

## Security Notes

- **Never expose VPS Manager publicly without authentication.** The default setup has no login screen — add one before deploying to an internet-accessible host.
- SSH credentials are stored in the PostgreSQL database. Ensure your DB is not publicly accessible and `SESSION_SECRET` is a strong random value.
- The file manager and terminal allow arbitrary command execution. Restrict access to trusted users only.
- Consider running behind a reverse proxy (Nginx) with HTTPS and HTTP basic auth as a minimum.

---

## Environment Variables Reference

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5756` | API server port |
| `DATABASE_URL` | — | Full PostgreSQL connection string |
| `PGHOST` | `localhost` | PostgreSQL host |
| `PGPORT` | `5432` | PostgreSQL port |
| `PGUSER` | — | PostgreSQL user |
| `PGPASSWORD` | — | PostgreSQL password |
| `PGDATABASE` | — | PostgreSQL database name |
| `SESSION_SECRET` | — | Express session secret (use 32+ random chars) |

---

## License

MIT © [Gifted Tech](https://me.giftedtech.co.ke)

---

## Author

**Maurice Gift** (mauricegift)
- Website: [me.giftedtech.co.ke](https://me.giftedtech.co.ke)
- API: [api.giftedtech.co.ke](https://api.giftedtech.co.ke)
- GitHub: [@mauricegift](https://github.com/mauricegift)
- Org: [@GiftedTech-Nexus](https://github.com/GiftedTech-Nexus)
