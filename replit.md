# VPS Manager

A professional, full-stack VPS management dashboard built with React + TypeScript + Express.

## Architecture

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS v4, AOS animations, react-toastify
- **Backend**: Express.js, TypeScript, tsx (watch mode), socket.io (WebSocket terminal), multer (file uploads)
- **Dev port**: 5000 (Vite, proxied to backend)
- **Backend port**: 5756 (Express API + WebSocket)
- **Database**: Replit PostgreSQL (via pg pool, env vars PGHOST/PGUSER/PGPASSWORD/PGDATABASE)

## Folder Structure

```
/
├── public/
├── src/
│   ├── components/
│   │   ├── layout/ (Header, Footer, MobileSidebar, Layout)
│   │   └── ui/     (Pattern, Modal, StatusBadge, StatCard, ConfirmDialog)
│   ├── context/    (ThemeContext - light/dark toggle)
│   ├── pages/      (Dashboard, PM2, Docker, Databases, FileManager, Terminal, Servers)
│   ├── lib/        (api.ts - axios baseURL: '/api')
│   └── types/      (TypeScript interfaces + server.ts)
├── server/
│   ├── routes/     (system, pm2, docker, databases, files, vps, vps-connections)
│   ├── db.ts       (pg pool + initDB for vps_connections table)
│   ├── ssh.ts      (SSH connection testing + remote system info)
│   └── index.ts    (Express + socket.io)
├── package.json
├── vite.config.ts
└── install.sh      (VPS deployment setup script)
```

## Features

- **Dashboard**: Real-time CPU, memory, disk, network, uptime, system info, restart/shutdown
- **PM2**: List, start, stop, restart, delete processes, view logs, start new + **PM2 Terminal** (run pm2 commands)
- **Docker**: Containers (start/stop/restart/remove/logs), Images, Compose
- **Databases**: Auto-detect PostgreSQL (via direct connection), MySQL, MongoDB, Redis; database browser with table viewer + SQL query runner
- **File Manager**: Browse, view/edit files, move, copy, delete, **upload files** (click or drag-drop), **create new file** with content, **create new folder**
- **Terminal**: WebSocket-based interactive shell
- **Remote Servers**: SSH connection management stored in PostgreSQL, test connections, view remote system info

## API Conventions

- All frontend `api` calls use **relative paths without `/api/` prefix** (e.g. `api.get('/servers')` not `api.get('/api/servers')`), since the axios instance has `baseURL: '/api'`
- Exception: Databases.tsx, Servers.tsx — fixed to use correct short paths

## Design & UX

- **Light theme by default** (dark available via moon icon toggle, persisted to localStorage)
- Plus Jakarta Sans font + JetBrains Mono for code
- Header: sticky top-0, white/themed background, `h-16`; Layout adds `pt-20 sm:pt-24` (disconnected) or `pt-28 sm:pt-32` (server connected)
- `.mobile-menu-btn` CSS class hides hamburger at lg+ breakpoints
- AOS: `once: true`, `AOSRouteRefresh` component calls `AOS.refresh()` on route change (80ms delay) — no blinks or disappearing elements
- Custom react-toastify glass morphism styling
- CSS variables: `--background`, `--foreground`, `--secondary`, `--main`, `--muted`, `--line`, `--accent`
- Terminal & PM2 terminal: **fully theme-adaptive** via CSS variables (no hardcoded dark colors)
- Modal: slides up from bottom on mobile (`items-end sm:items-center`, `rounded-t-2xl sm:rounded-2xl`); centered on desktop
- Footer: compact single row with `py-3`
- Mobile: `overflow-x: hidden` prevents horizontal scroll; `.main` max-width 95% on sm screens

## Remote Server Mode

- `RemoteServerContext` — active server persisted to `sessionStorage` key `vpsm_active_server`; survives page reload
- When connected: banner shows below header, all API calls route to `/api/remote/:id/*`
- SSH scripts: base64-encoded to eliminate newline/escaping issues (`echo 'B64' | base64 -d | bash`)
- Remote endpoints: `/system`, `/pm2`, `/pm2/:procId/:action`, `/pm2/terminal`, `/files`, `/files/read`, `/files/save`, `/files/mkdir`, `/exec`, `/databases`

## Databases Page

- Auto-detects installed databases using `which` command (PostgreSQL, MySQL, MongoDB, Redis, SQLite, MariaDB)
- Shows "INSTALLED" and "NOT INSTALLED" sections separately
- Install/Uninstall buttons run apt-get commands, output shown in terminal modal
- Database list is expandable (show/hide)

## Deployment

```bash
npm install && npm run build
NODE_ENV=production PORT=5756 node server/index.js
# Or: pm2 start "node server/index.js" --name vps-manager
```
