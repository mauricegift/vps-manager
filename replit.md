# VPS Manager

A full-stack React + Express/TypeScript web application for managing VPS servers.

## Architecture

- **Frontend**: React + Vite + TypeScript, runs on port **5000**
- **Backend**: Express/TypeScript API, runs on port **5756**
- **Database**: SQLite (via better-sqlite3) for VPS connection persistence
- **Styling**: Tailwind CSS v4

## Dev

```bash
npm run dev
```

This runs backend and frontend concurrently (the frontend waits for the API to be ready before starting).

## Key Pages

- **Dashboard** – System health, CPU/mem/disk/uptime, network interfaces
- **PM2** – Process manager with file browser, GitHub clone, env var import
- **Docker** – Container management
- **Files** – File manager with upload/download/zip
- **Terminal** – SSH-style terminal
- **Nginx** – Reverse proxy config and SSL certificate management
- **Extras** – Software install/uninstall, system updates, swap, MOTD, users, cloud tools
- **Servers** – Remote server management via SSH

## Changes Made (2025-04)

### Bugfixes & Enhancements

1. **Footer** – Copyright `© {year} VPS Manager` appears before the "Built with ❤️ by Gifted Tech" tagline; single clean footer bar.

2. **File zip/download** – ZIP excludes now cover all language build artifacts: `__pycache__`, `*.pyc`, `.mypy_cache`, `dist/`, `build/`, `.next/`, `target/`, `vendor/`, `venv/`, `.venv/`, `*.egg-info/`

3. **Nginx SSL** – Webroot path field has preset quick-pick buttons (`/var/www/html`, etc.). Added a step-by-step setup checklist (DNS → Nginx config → Issue certificate).

4. **Swap creation** – Always runs `swapoff /swapfile && rm -f /swapfile` unconditionally before creating a new swap file, preventing failures when a swap exists but isn't mounted.

5. **MOTD** – Added "View Current MOTD" button (shows current `/etc/motd` content in a modal) and "Load Current" button (copies current MOTD into the editor).

6. **Software page** – All ToolCard buttons globally disabled while any install/update/uninstall is in progress (`!!opLoading`), preventing concurrent operations.

7. **Tailscale** – Connect command uses `--accept-routes`. Shows auth URL hint when an authentication URL is returned. Added Routes Info button. Tips about `--advertise-routes` and `--accept-routes`.

8. **Cloudflared** – Added setup instructions panel (login → create tunnel → configure → start). Improved start button output to show failure reason. Added Login button.

9. **Wrangler remote** – New `WranglerRemotePanel` component shown when connected to a remote server with Wrangler installed; prompts for `CLOUDFLARE_API_TOKEN` and runs commands with it as an env var.

10. **PM2 file browser** – On error, `browseItems` is cleared to `[]` and the error message is surfaced properly.

11. **PM2 verify button row** – Uses `flex-wrap` so Browse + Verify buttons stack on mobile screens.

12. **PM2 port → .env** – Port and env vars are written to `.env` in the cwd instead of passed as `--env` CLI flags; works for both local and remote processes.

13. **PM2 env vars import** – "Import .env" button allows pasting `.env` file content or JSON (`{"KEY":"val"}`) to bulk-import variables.

14. **PM2 remote start** – Appends `&& pm2 save` to the remote exec command so processes persist across reboots.

## GitHub

Repository: [mauricegift/vps-manager](https://github.com/mauricegift/vps-manager)
