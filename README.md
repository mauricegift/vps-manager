# VPS Manager

> A professional full-stack VPS control panel built with React + TypeScript + Express.
> Manage PM2 processes, Docker containers, databases, files, Nginx, SSL, and SSH terminals across unlimited remote servers — all from one clean, responsive UI.

**Author:** [Gifted Tech](https://me.giftedtech.co.ke) · [GitHub @mauricegift](https://github.com/mauricegift)

---

## Features

### Process Manager (PM2)
- View all PM2 processes with CPU, memory, uptime, restarts, and status badges
- Start, stop, restart, reload, and delete processes
- View live logs per process in a themed terminal modal
- **New Process form**:
  - Script/entry-file verification — confirm the file exists before submitting
  - Automatic `.env` detection in the working directory
  - Port field — sets the `PORT` environment variable for the process
- **Clone from GitHub** — pull a repo directly onto the server (or remote VPS via SSH), auto-installs dependencies and starts with PM2
- PM2 terminal for running `pm2 list`, `pm2 logs`, `pm2 monit`, etc.
- Auto-install PM2 if not present with one click
- Full remote server support — all actions run on the connected remote VPS via SSH

### Docker
- **Containers**: list all, start, stop, restart, remove, view logs
- **Images**: list, pull from registry, delete
  - **Pull with custom port mapping** — enter a port map (e.g. `8080:80`) and optionally auto-run the container immediately after pulling
  - **Build from Dockerfile** — paste a Dockerfile, set image name/tag, optionally set build context path
- **Compose**: discover all docker-compose projects on the server
  - Up / Down / Restart each project
  - View compose logs in modal
  - Edit `docker-compose.yml` content inline
  - **Create new compose project** — paste YAML, choose directory, auto-starts with `docker compose up -d`
- Auto-install Docker if not present

### Databases
Supports **PostgreSQL**, **MySQL**, **MariaDB**, **MongoDB**, **Redis**, and **SQLite**.

#### Browsing & Querying
- Browse all databases, tables/collections, and row/document data with pagination (50 rows per page)
- Run custom SQL queries (PostgreSQL / MySQL / MariaDB / SQLite) or raw MongoDB expressions / Redis commands
- **Action buttons always visible** — edit and delete buttons pinned to the left of every row in a sticky column (no horizontal scrolling required)

#### PostgreSQL / MySQL / MariaDB / SQLite
- Edit any row via modal — pre-filled fields, safe SQL `UPDATE ... WHERE`
- Delete any row — confirmed `DELETE ... WHERE`
- **Add Row** form auto-generates input fields from column names
- **New Table** modal — column builder with name + type per column, live SQL `CREATE TABLE` preview
- **Drop Table** with confirmation
- MariaDB fully supported in remote SSH mode (tables list, data, and query endpoints)

#### MongoDB
- Full document CRUD — edit via JSON-aware update, delete via `_id` filter with EJSON ObjectId support
- **Add Document** — JSON editor modal with `insertOne` support
- **New Collection** — create a collection by name
- **Drop Collection** with confirmation

#### Redis
- Browse keys by type: string, hash, list, set
- **Type-aware edit commands**:
  - String → `SET key value`
  - Hash → `HSET key field value`
  - List → `LSET key index value`
  - Set → `SREM old + SADD new`
- **Type-aware delete commands**:
  - String → `DEL key`
  - Hash → `HDEL key field`
  - List → `LREM key 0 value`
  - Set → `SREM key member`

#### Remote Database Support
- All CRUD features work on remote VPS databases via SSH
- MariaDB fully handled in remote table-data and query routes

### File Manager
- Browse full directory tree with breadcrumb navigation
- View files with **syntax highlighting** (50+ languages)
- Edit files inline in a code-styled editor
- Create new files and folders
- Cut, Copy, Paste operations
- **Multi-file drag-and-drop upload**
- **Bulk select mode**:
  - Toggle with the Select button in the toolbar
  - Check individual items or use "Select All"
  - **Zip & Download** selected items as a single archive
  - **Bulk delete** selected items with confirmation
- **Download button** shown inline for every `.zip` file
- **Clone from GitHub** — clone any repo into a chosen directory (works on remote VPS via SSH exec)
- Seamlessly switches to SSH remote file browsing when a remote server is active

### Terminal
- Full interactive bash shell for both local and SSH-remote servers
- Output follows the **active theme** — dark background in dark mode, light in light mode
- Colorized output — `ls`, `grep`, `diff`, `ll` aliases applied automatically
- Remote SSH terminal receives the same color environment on connect
- Command history with Up/Down arrows
- Quick-access Ctrl+C, Ctrl+L, Ctrl+D, Tab, history shortcuts
- `exit` handled gracefully — local shell auto-reconnects, SSH shows session-end message
- Adjustable font size

### Nginx + SSL
- Real-time nginx status: running/stopped, version, and available updates
- **Certbot detection**: installed version and update availability shown on the status card
- List all config files — enable, disable, delete, view, or edit
- Create new configs from templates: Static site, Reverse proxy, PHP-FPM, SSL redirect
- Test configuration, reload, and restart nginx
- **Let's Encrypt SSL via Certbot**:
  - Issue certificates for domains
  - Renew and delete certificates
- One-click **Refresh** invalidates all cached queries
- Full remote server support via SSH — certbot status returned in parallel with nginx status

### Software / Extras
- **System** tab: CPU, memory, disk usage
- **Software** tab organized by category:
  - Runtimes: Node.js (multi-version), npm, Bun, Deno, Python, Go, Rust, PM2, pnpm, yarn
  - Servers & SSL: nginx, Apache, Certbot
  - Dev Tools: git, curl, wget, rsync, vim, nvim
  - System Tools: htop, tmux, screen, ufw, fail2ban, jq, unzip
  - Browsers: Chrome
  - Install, update, and check for newer versions
- **Users** tab: list all system users with home directory, shell, and UID

### Remote Servers
- Add unlimited VPS connections (IP, port, username, password or SSH key)
- One-click connect — all pages (PM2, Docker, Databases, Files, Nginx, Terminal) switch to remote context
- Test connection before saving
- View basic server info and uptime for each connected server
- GitHub tokens stored per-session and shared across PM2 and FileManager clone flows

---

## Installation

### Automated (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/mauricegift/vps-manager/main/install.sh | bash
```

### Manual

```bash
git clone https://github.com/mauricegift/vps-manager.git
cd vps-manager
chmod +x install.sh
./install.sh
```

The installer will:
1. Install Node.js **24** via NVM (installs/upgrades NVM automatically)
2. Install PM2 globally (if missing) and configure startup on reboot
3. Install `nginx`, `sshpass`, `python3`, `pip`, `ffmpeg` system packages
4. Create a `~/bin/python` symlink so `python` resolves to `python3`
5. Clone / pull the latest repo
6. Install npm dependencies
7. Generate a `.env` with a random `SESSION_SECRET`
8. Set UFW firewall rules (SSH, 80, 443, 5756)
9. Start the app via PM2 using `npm run dev`
10. **Auto-configure Nginx** as a reverse proxy on port 80:
    - `/api/` → Express backend (port 5756)
    - `/socket.io/` → WebSocket terminal (with upgrade headers)
    - everything else → Vite frontend (port 5000)
11. Optionally issue a **free SSL certificate** via `certbot --nginx` with zero downtime
12. Add a daily **auto-renewal cron job** (`certbot renew` at 03:00)

After install, access the dashboard at:
- `http://<your-server-ip>` — main entry point via Nginx on port 80 (recommended)

---

## Development

```bash
git clone https://github.com/mauricegift/vps-manager.git
cd vps-manager
npm install
npm run dev
```

This is a monorepo — `npm run dev` starts both the Express API (port **5756**) and the Vite frontend (port **5000**) concurrently. In production both are unified behind **Nginx on port 80**, so users only see one URL.

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | Backend server port | `5756` |
| `DATABASE_URL` | PostgreSQL connection URL | auto (local internal DB) |
| `SESSION_SECRET` | Session signing key | auto-generated |

---

## Project Structure

```
vps-manager/
├── src/                    # React + TypeScript frontend (Vite)
│   ├── pages/              # PM2, Docker, Databases, FileManager, Terminal, Nginx, Extras, Servers
│   ├── components/ui/      # Modal, ConfirmDialog, StatusBadge, CodeView, AnsiText
│   └── context/            # ThemeContext, RemoteServerContext
├── server/                 # Express backend (TypeScript, runs via tsx)
│   ├── index.ts            # WebSocket terminal (local bash + SSH)
│   └── routes/             # pm2, docker, databases, files, nginx, extras, remote, vps-connections, github
├── install.sh              # VPS auto-installer (Node, PM2, Nginx, SSL, cron)
└── README.md
```

---

## License

MIT — free to use, modify, and deploy.
