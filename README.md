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
  - Browse button — opens a server-side file browser to pick the script path
  - Browse + Verify button row uses `flex-wrap` so it stacks cleanly on mobile
  - Automatic `.env` detection in the working directory
  - Port field — writes `PORT=xxx` to `cwd/.env` instead of passing `--env PORT` (more compatible)
- **Import .env** button — paste raw `.env` file lines (`KEY=VALUE`) or JSON (`{"KEY":"val"}`) to bulk-import environment variables into the new process form
- **Clone from GitHub** — pull a repo directly onto the server (or remote VPS via SSH), auto-installs dependencies and starts with PM2
- PM2 terminal for running `pm2 list`, `pm2 logs`, `pm2 monit`, etc.
- Auto-install PM2 if not present with one click
- **Remote start saves automatically** — all remote `pm2 start` commands append `&& pm2 save` so processes persist across reboots
- **File browser error handling** — on folder-open failure the item list is cleared and the exact error is shown in a toast
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
    - ZIP excludes language build artifacts: `__pycache__`, `*.pyc`, `.mypy_cache`, `dist/`, `build/`, `.next/`, `target/`, `vendor/`, `venv/`, `.venv/`, `*.egg-info/`
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
  - **Webroot path quick-pick presets** — one-click buttons for common paths (`/var/www/html`, `/var/www/letsencrypt`, `/srv/www`, `/usr/share/nginx/html`)
  - **Step-by-step setup checklist** shown inside the SSL modal: DNS → Nginx config → issue cert → verify — guides you through the full setup
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
  - **Global operation lock** — all install/update/uninstall buttons are disabled while any operation is running, preventing concurrent conflicts
- **Users** tab: list all system users with home directory, shell, and UID
- **Swap** tab:
  - Create or resize a swap file in one click
  - Always runs `swapoff /swapfile && rm -f /swapfile` before creating, so it works even when a swap file already exists
- **MOTD** tab:
  - Edit the Message of the Day (`/etc/motd`) in a code editor
  - **View Current MOTD** button — shows current live MOTD in a read-only modal
  - **Load Current** button — pulls the live MOTD into the editor so you can build on it
  - Save applies the new MOTD to the server instantly

### Cloud Tools (Extras → Cloud)
- **Tailscale**:
  - Install, start, connect with one click
  - Connect command uses `--accept-routes` by default
  - **Auth URL hint** — if the connect output includes a login URL (`https://...`), it is highlighted automatically with a click-to-copy link
  - **Routes Info** button shows `tailscale status` in the output panel
  - Tips displayed for `--advertise-routes` and `--accept-routes` flags
- **Cloudflare Tunnel (cloudflared)**:
  - Install, start, stop, restart
  - **Setup Instructions panel** — step-by-step guide: `cloudflared login` → create tunnel → write `config.yml` → start service
  - **Login** button runs `cloudflared login` and shows the browser-auth URL in the output
  - Improved start-button output shows failure reason clearly
- **Wrangler**:
  - Install, run commands locally
  - **Remote panel**: when a remote server is active, a dedicated `WranglerRemotePanel` prompts for a `CLOUDFLARE_API_TOKEN` before running any wrangler command — token is passed as an environment variable per-command, never stored

### Remote Servers
- Add unlimited VPS connections (IP, port, username, password or SSH key)
- One-click connect — all pages (PM2, Docker, Databases, Files, Nginx, Terminal, Extras) switch to remote context
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
│   ├── components/
│   │   ├── layout/         # Header (server banner), Footer, MobileSidebar
│   │   └── ui/             # Modal, ConfirmDialog, StatusBadge, CodeView, AnsiText
│   └── context/            # ThemeContext, RemoteServerContext
├── server/                 # Express backend (TypeScript, runs via tsx)
│   ├── index.ts            # WebSocket terminal (local bash + SSH)
│   └── routes/             # pm2, docker, databases, files, nginx, extras, remote, vps-connections, github
├── install.sh              # VPS auto-installer (Node, PM2, Nginx, SSL, cron)
└── README.md
```

---

## Changelog

### Latest Release
- **Footer**: copyright `© {year} VPS Manager` now appears before "Built with ❤️ by Gifted Tech"
- **ZIP downloads**: exclude `__pycache__`, `*.pyc`, `.mypy_cache`, `dist/`, `build/`, `.next/`, `target/`, `vendor/`, `venv/`, `.venv/`, `*.egg-info/`
- **Nginx SSL**: webroot quick-pick presets + step-by-step DNS → Nginx → SSL setup checklist
- **Swap**: unconditionally removes existing swap before creating new one — no more "swap already exists" failures
- **MOTD**: "View Current MOTD" modal and "Load Current" button added
- **Software tools**: all buttons globally disabled during any active install/update/uninstall operation
- **Tailscale**: auth URL hint, `--accept-routes` default, Routes Info button, route tips
- **Cloudflared**: setup instructions panel, Login button, improved error output on start failure
- **Wrangler**: dedicated remote panel with per-command `CLOUDFLARE_API_TOKEN` prompt
- **PM2 file browser**: clears item list and shows error toast on folder-open failure
- **PM2 verify row**: `flex-wrap` so Browse + Verify buttons stack on small screens
- **PM2 port**: writes `PORT=xxx` to `cwd/.env` instead of passing via `--env` flag
- **PM2 env import**: "Import .env" button — paste `.env` lines or JSON to bulk-add vars
- **PM2 remote start**: appends `&& pm2 save` so processes survive reboots

---

## License

MIT — free to use, modify, and deploy.
