import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import cors from 'cors';
import { exec, spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client as SSH2Client } from 'ssh2';
import { networkInterfaces } from 'os';

import systemRouter from './routes/system.js';
import pm2Router from './routes/pm2.js';
import dockerRouter from './routes/docker.js';
import databasesRouter from './routes/databases.js';
import filesRouter from './routes/files.js';
import vpsRouter from './routes/vps.js';
import serversRouter from './routes/vps-connections.js';
import remoteRouter from './routes/remote.js';
import extrasRouter from './routes/extras.js';
import nginxRouter from './routes/nginx.js';
import githubRouter from './routes/github.js';
import authRouter from './routes/auth.js';
import settingsRouter from './routes/settings.js';
import { requireAuth } from './middleware/auth.js';
import { initDB } from './db.js';
import pool from './db.js';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CUSTOM_DOMAIN = (process.env.ALLOWED_ORIGIN || '').trim();

// In the Replit dev environment REPLIT_DEV_DOMAIN is always set —
// the browser origin is a proxied *.replit.dev URL so we allow all there.
const IS_DEV = !!process.env.REPLIT_DEV_DOMAIN;

// Detect the server's own public/private IP for use in production
// when no custom domain is configured.
const getServerIP = (): string => {
  const nets = networkInterfaces();
  for (const iface of Object.values(nets)) {
    for (const addr of iface ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return 'localhost';
};
const SERVER_IP = getServerIP();

// Build the list of allowed origins for production:
//   • ALLOWED_ORIGIN env var set (custom domain) → only that domain
//   • No env var → only http://<vps-ip> (port 80 via nginx) + direct frontend port
const buildAllowedOrigins = (): string[] => {
  if (CUSTOM_DOMAIN) {
    const base = CUSTOM_DOMAIN.replace(/\/$/, '');
    return [
      base,
      base.replace(/^https:\/\//, 'http://'),
      base.replace(/^http:\/\//, 'https://'),
    ];
  }
  return [
    `http://${SERVER_IP}`,       // via nginx port 80
    `http://${SERVER_IP}:5756`,  // direct backend port (production VPS)
  ];
};
const ALLOWED_ORIGINS = buildAllowedOrigins();
console.log(`[cors] mode=${IS_DEV ? 'dev (permissive)' : 'production'} allowed origins:`, ALLOWED_ORIGINS);

const corsOpts: cors.CorsOptions = IS_DEV
  ? { origin: true, credentials: true } // Replit dev: allow all origins
  : {
      origin: (origin, cb) => {
        // Allow server-to-server requests (no Origin header)
        if (!origin) { cb(null, true); return; }
        if (ALLOWED_ORIGINS.some(o => origin === o || origin.startsWith(o + '/'))) {
          cb(null, true);
        } else {
          cb(new Error(`CORS: origin "${origin}" not allowed`));
        }
      },
      credentials: true,
    };

const app = express();
const httpServer = createServer(app);
const io = new SocketIO(httpServer, {
  cors: {
    origin: IS_DEV ? true : ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

app.use(cors(corsOpts));
app.use(express.json());

// ── Socket.IO auth middleware — require valid JWT on every WS connection ────
const ACCESS_SECRET = process.env.SESSION_SECRET || 'vpsmanager_access_secret';
io.use((socket, next) => {
  const token = (socket.handshake.auth as any)?.token as string | undefined;
  if (!token) {
    return next(new Error('Authentication required'));
  }
  try {
    const payload = jwt.verify(token, ACCESS_SECRET);
    (socket as any).user = payload;
    next();
  } catch {
    next(new Error('Invalid or expired token'));
  }
});

app.use('/api/auth', authRouter);
app.use('/api/settings', settingsRouter);

app.use('/api/system', requireAuth, systemRouter);
app.use('/api/pm2', requireAuth, pm2Router);
app.use('/api/docker', requireAuth, dockerRouter);
app.use('/api/databases', requireAuth, databasesRouter);
app.use('/api/files', requireAuth, filesRouter);
app.use('/api/vps', requireAuth, vpsRouter);
app.use('/api/servers', requireAuth, serversRouter);
app.use('/api/remote', requireAuth, remoteRouter);
app.use('/api/extras', requireAuth, extrasRouter);
app.use('/api/nginx', requireAuth, nginxRouter);
app.use('/api/github', requireAuth, githubRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ── Serve built frontend in production ──────────────────────────────────────
// In dev (Replit) the Vite dev server handles the frontend.
// In production the installer runs `npm run build` which puts the React app
// into dist/public/; Express serves it directly — no separate Vite process.
if (!IS_DEV) {
  const frontendDist = path.join(__dirname, '../dist/public');
  app.use(express.static(frontendDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// ── WebSocket Terminal ──────────────────────────────────────────────────────
io.on('connection', async (socket) => {
  console.log('[terminal] client connected', socket.id);
  const serverId = socket.handshake.query?.serverId as string | undefined;

  // ── REMOTE MODE: SSH shell ──────────────────────────────────────────────
  if (serverId) {
    let sshClient: SSH2Client | null = null;

    try {
      const r = await pool.query('SELECT * FROM vps_connections WHERE id = $1', [serverId]);
      if (!r.rows.length) { socket.emit('error', 'Server not found'); return; }
      const s = r.rows[0];

      sshClient = new SSH2Client();

      sshClient
        .on('ready', () => {
          sshClient!.shell(
            { term: 'xterm-256color', rows: 30, cols: 120 },
            (err, stream) => {
              if (err) { socket.emit('error', 'SSH shell error: ' + err.message); return; }

              socket.emit('cwd', '~');

              stream.on('data', (d: Buffer) => socket.emit('output', d.toString()));
              stream.stderr.on('data', (d: Buffer) => socket.emit('output', d.toString()));
              stream.on('close', () => {
                socket.emit('system', '✗ SSH session ended');
                sshClient?.end();
              });

              // ── Silent init ──────────────────────────────────────────────
              // Step 1: disable terminal echo (this one line will be echoed, then echo goes off)
              setTimeout(() => {
                if (stream.writable) stream.write('stty -echo 2>/dev/null\n');
              }, 250);
              // Step 2: setup commands — echo is off, nothing appears in output
              setTimeout(() => {
                if (stream.writable) {
                  stream.write(
                    'export FORCE_COLOR=3 COLORTERM=truecolor CLICOLOR=1 CLICOLOR_FORCE=1; ' +
                    "alias ls='ls --color=always'; alias ll='ls -la --color=always'; " +
                    "alias grep='grep --color=always'; alias diff='diff --color=always'; " +
                    'export PS1="\\[\\e[32m\\]\\u@\\h\\[\\e[0m\\]:\\[\\e[34m\\]\\w\\[\\e[0m\\]\\$ "\n'
                  );
                }
              }, 500);
              // Step 3: re-enable echo then clear screen — frontend will detect \x1b[2J and wipe display
              setTimeout(() => {
                if (stream.writable) stream.write('stty echo 2>/dev/null; clear\n');
              }, 800);

              socket.on('command', (cmd: string) => {
                if (stream.writable) stream.write(cmd + '\n');
              });

              socket.on('interrupt', () => {
                if (stream.writable) stream.write('\x03');
              });

              socket.on('key', (raw: string) => {
                if (stream.writable) stream.write(raw);
              });

              socket.on('resize', ({ rows, cols }: { rows: number; cols: number }) => {
                stream.setWindow(rows, cols, 0, 0);
              });

              socket.on('disconnect', () => {
                console.log('[terminal] remote client disconnected', socket.id);
                stream.end();
                sshClient?.end();
              });
            }
          );
        })
        .on('error', (err) => {
          socket.emit('error', 'SSH connection failed: ' + err.message);
        })
        .connect({
          host: s.ip,
          port: s.port || 22,
          username: s.username,
          ...(s.ssh_key ? { privateKey: s.ssh_key } : {}),
          ...(s.password ? { password: s.password } : {}),
          readyTimeout: 20000,
          keepaliveInterval: 15000,
          keepaliveCountMax: 30,
        });

    } catch (e: any) {
      socket.emit('error', 'Failed to connect: ' + e.message);
    }

    return; // don't fall through to local shell
  }

  // ── LOCAL MODE: bash shell ─────────────────────────────────────────────
  const activeUser = (socket.handshake.query?.activeUser as string | undefined)?.trim() || '';
  const asSubUser = activeUser && activeUser !== 'root';
  const userHome = asSubUser ? `/home/${activeUser}` : (process.env.HOME || '/root');

  let shellProc: ReturnType<typeof spawn> | null = null;
  let cwd = userHome;

  const startShell = () => {
    // If an active sub-user is set, run `su - <username>` so the shell runs
    // with that user's full login environment, home dir, and PATH.
    const shellEnv = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      FORCE_COLOR: '3',
      CLICOLOR_FORCE: '1',
      CLICOLOR: '1',
      LS_COLORS: 'rs=0:di=01;34:ln=01;36:mh=00:pi=40;33:so=01;35:do=01;35:bd=40;33;01:cd=40;33;01:or=40;31;01:mi=00:su=37;41:sg=30;43:ca=00:tw=30;42:ow=34;42:st=37;44:ex=01;32',
    };

    if (asSubUser) {
      shellProc = spawn('su', ['-', activeUser], { env: shellEnv, cwd: '/root' });
    } else {
      shellProc = spawn('/bin/bash', ['--login'], { env: shellEnv, cwd });
    }

    shellProc.stdout?.on('data', (d: Buffer) => socket.emit('output', d.toString()));
    shellProc.stderr?.on('data', (d: Buffer) => socket.emit('output', d.toString()));
    shellProc.on('close', () => {
      socket.emit('system', 'Shell session ended. Reconnecting...');
      setTimeout(startShell, 1000);
    });

    // Write color helpers — for su sessions, add a short delay so the login
    // shell is ready before we write to stdin.
    const writeInit = () => {
      shellProc?.stdin?.write(
        'ls()   { command ls   --color=always "$@"; }; export -f ls\n'   +
        'll()   { command ls -la --color=always "$@"; }; export -f ll\n'  +
        'grep() { command grep --color=always "$@"; }; export -f grep\n'  +
        'diff() { command diff --color=always "$@"; }; export -f diff\n'  +
        'export PS1="\\[\\e[32m\\]\\u@\\h\\[\\e[0m\\]:\\[\\e[34m\\]\\w\\[\\e[0m\\]\\$ "\n'
      );
    };

    if (asSubUser) {
      setTimeout(writeInit, 800); // give `su` time to open the login shell
    } else {
      writeInit();
    }

    setTimeout(() => {
      socket.emit('output',
        '\x1b[32m✓\x1b[0m Colors ready — ' +
        '\x1b[34mls\x1b[0m · \x1b[33mgrep\x1b[0m · \x1b[35mdiff\x1b[0m · \x1b[36mll\x1b[0m are colorized\n'
      );
    }, asSubUser ? 1000 : 200);
  };

  socket.on('command', (cmd: string) => {
    if (shellProc?.stdin?.writable) {
      shellProc.stdin.write(cmd + '\n');
      exec('pwd', { cwd }, (_, stdout) => {
        if (stdout) socket.emit('cwd', stdout.trim().replace(process.env.HOME || '/root', '~'));
      });
    } else {
      exec(cmd, { cwd, maxBuffer: 1024 * 1024 * 5 }, (err, stdout, stderr) => {
        if (stdout) socket.emit('output', stdout);
        if (stderr) socket.emit('output', stderr);
        if (err && !stderr) socket.emit('error', `Exit code ${err.code}`);
      });
    }
  });

  socket.on('interrupt', () => { shellProc?.kill('SIGINT'); });

  socket.on('key', (raw: string) => {
    if (shellProc?.stdin?.writable) shellProc.stdin.write(raw);
  });

  socket.on('disconnect', () => {
    console.log('[terminal] local client disconnected', socket.id);
    shellProc?.kill();
  });

  startShell();
  socket.emit('cwd', '~');
});

const PORT = parseInt(process.env.PORT || '5756');
initDB().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`[server] VPS Manager backend running on port ${PORT}`);
  });
});

export { io };
