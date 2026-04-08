import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import cors from 'cors';
import { exec, spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client as SSH2Client } from 'ssh2';

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
import { initDB } from './db.js';
import pool from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new SocketIO(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors());
app.use(express.json());

app.use('/api/system', systemRouter);
app.use('/api/pm2', pm2Router);
app.use('/api/docker', dockerRouter);
app.use('/api/databases', databasesRouter);
app.use('/api/files', filesRouter);
app.use('/api/vps', vpsRouter);
app.use('/api/servers', serversRouter);
app.use('/api/remote', remoteRouter);
app.use('/api/extras', extrasRouter);
app.use('/api/nginx', nginxRouter);
app.use('/api/github', githubRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

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

              // Set up color aliases (same as local shell)
              setTimeout(() => {
                if (stream.writable) {
                  stream.write(
                    'export FORCE_COLOR=3 COLORTERM=truecolor CLICOLOR=1 CLICOLOR_FORCE=1\n' +
                    'ls()   { command ls   --color=always "$@"; }; export -f ls\n' +
                    'll()   { command ls -la --color=always "$@"; }; export -f ll\n' +
                    'grep() { command grep --color=always "$@"; }; export -f grep\n' +
                    'diff() { command diff --color=always "$@"; }; export -f diff\n' +
                    'export PS1="\\[\\e[32m\\]\\u@\\h\\[\\e[0m\\]:\\[\\e[34m\\]\\w\\[\\e[0m\\]\\$ "\n'
                  );
                }
              }, 400);
              setTimeout(() => {
                socket.emit('output',
                  '\x1b[32m✓\x1b[0m Colors ready — ' +
                  '\x1b[34mls\x1b[0m · \x1b[33mgrep\x1b[0m · \x1b[35mdiff\x1b[0m · \x1b[36mll\x1b[0m are colorized\n'
                );
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
  let shellProc: ReturnType<typeof spawn> | null = null;
  let cwd = process.env.HOME || '/root';

  const startShell = () => {
    shellProc = spawn('/bin/bash', ['--login'], {
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        FORCE_COLOR: '3',
        CLICOLOR_FORCE: '1',
        CLICOLOR: '1',
        LS_COLORS: 'rs=0:di=01;34:ln=01;36:mh=00:pi=40;33:so=01;35:do=01;35:bd=40;33;01:cd=40;33;01:or=40;31;01:mi=00:su=37;41:sg=30;43:ca=00:tw=30;42:ow=34;42:st=37;44:ex=01;32',
      },
      cwd,
    });

    shellProc.stdout?.on('data', (d: Buffer) => socket.emit('output', d.toString()));
    shellProc.stderr?.on('data', (d: Buffer) => socket.emit('output', d.toString()));
    shellProc.on('close', () => {
      socket.emit('system', 'Shell session ended. Reconnecting...');
      setTimeout(startShell, 1000);
    });

    // Write color helpers immediately — stdin is pipe-buffered so these land
    // before any user input even if bash's login scripts haven't finished yet.
    shellProc.stdin?.write(
      'ls()   { command ls   --color=always "$@"; }; export -f ls\n'   +
      'll()   { command ls -la --color=always "$@"; }; export -f ll\n'  +
      'grep() { command grep --color=always "$@"; }; export -f grep\n'  +
      'diff() { command diff --color=always "$@"; }; export -f diff\n'  +
      'export PS1="\\[\\e[32m\\]\\u@\\h\\[\\e[0m\\]:\\[\\e[34m\\]\\w\\[\\e[0m\\]\\$ "\n'
    );

    // Emit a visible ANSI color test so the user can confirm rendering works.
    setTimeout(() => {
      socket.emit('output',
        '\x1b[32m✓\x1b[0m Colors ready — ' +
        '\x1b[34mls\x1b[0m · \x1b[33mgrep\x1b[0m · \x1b[35mdiff\x1b[0m · \x1b[36mll\x1b[0m are colorized\n'
      );
    }, 200);
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
