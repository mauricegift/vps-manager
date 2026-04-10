import { Router } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const router = Router();

// Broad PATH so NVM-installed pm2/npm/node are always found even when spawned by PM2
const WIDE_PATH = [
  process.env.PATH,
  `${process.env.HOME || '/root'}/.nvm/versions/node`,   // resolved per-command via shell glob
  `${process.env.HOME || '/root'}/.local/bin`,
  '/usr/local/sbin', '/usr/local/bin', '/usr/sbin', '/usr/bin', '/sbin', '/bin',
].filter(Boolean).join(':');

const BASE_ENV = { ...process.env, PATH: WIDE_PATH, FORCE_COLOR: '3', COLORTERM: 'truecolor', DEBIAN_FRONTEND: 'noninteractive' };
const COLOR_ENV = BASE_ENV;
// Prefix for shell commands — sources NVM so node/npm/pm2 are in PATH
const NVM_PREFIX = `export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" --no-use; `;

function runPM2(args: string) {
  return execAsync(`${NVM_PREFIX}pm2 ${args} 2>&1`, { env: BASE_ENV });
}

function runPM2Json(args: string) {
  return execAsync(`${NVM_PREFIX}pm2 ${args} --no-color 2>&1`, { env: BASE_ENV });
}

async function listProcesses() {
  try {
    const { stdout } = await runPM2Json('jlist');
    return JSON.parse(stdout);
  } catch {
    return [];
  }
}

router.get('/', async (_req, res) => {
  try {
    const processes = await listProcesses();
    const data = processes.map((p: any) => {
      // Detect port: from --env PORT=xxx, or env object, or pm2_env.PORT
      const envObj = p.pm2_env?.env || {};
      const port = envObj.PORT || p.pm2_env?.PORT || null;
      return {
        pid: p.pid,
        name: p.name,
        pm_id: p.pm_id,
        status: p.pm2_env?.status || 'unknown',
        cpu: p.monit?.cpu || 0,
        memory: p.monit?.memory || 0,
        uptime: p.pm2_env?.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : 0,
        restarts: p.pm2_env?.restart_time || 0,
        pm_exec_path: p.pm2_env?.pm_exec_path,
        pm_cwd: p.pm2_env?.pm_cwd,
        mode: p.pm2_env?.exec_mode,
        watching: p.pm2_env?.watch,
        port: port ? String(port) : null,
      };
    });
    res.json({ success: true, data });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Build a pm2 start command that handles both file paths and command-style scripts
// e.g. "npm start" → `pm2 start npm --name "x" -- start`
// e.g. "node server.js" → `pm2 start node --name "x" -- server.js`
// e.g. "python3 app.py" → `pm2 start python3 --name "x" -- app.py`
const COMMAND_INTERPS = new Set(['npm', 'bun', 'node', 'python3', 'python', 'npx', 'pnpm', 'yarn', 'deno']);

function buildPm2Cmd(script: string, name: string, cwd?: string, interpreter?: string): string {
  const parts = script.trim().split(/\s+/);
  const first = parts[0].toLowerCase();
  if (COMMAND_INTERPS.has(first)) {
    // Command-style: interpreter + args
    let cmd = `pm2 start ${parts[0]} --name "${name}"`;
    if (cwd) cmd += ` --cwd "${cwd}"`;
    if (parts.length > 1) cmd += ` -- ${parts.slice(1).join(' ')}`;
    return cmd;
  }
  // File path: pm2 start "/path/to/file" --name "x"
  const isSh = script.trim().endsWith('.sh');
  let cmd = `pm2 start "${script}" --name "${name}"`;
  if (isSh || interpreter === 'bash') cmd += ' --interpreter bash';
  if (cwd) cmd += ` --cwd "${cwd}"`;
  return cmd;
}

router.post('/start', async (req, res) => {
  try {
    const { name, script, cwd, port, interpreter, envVars, pkgManager, installDeps } = req.body;

    // Write PORT and env vars to .env in cwd (avoids shell-quoting issues with --env flags)
    if (cwd && (port || (Array.isArray(envVars) && envVars.some((e: any) => e.key?.trim())))) {
      const { readFileSync, writeFileSync, existsSync } = await import('fs');
      const dotenvPath = `${cwd}/.env`;
      let existing = '';
      try { existing = existsSync(dotenvPath) ? readFileSync(dotenvPath, 'utf-8') : ''; } catch { existing = ''; }
      const dotLines = existing ? existing.split('\n') : [];
      const setVar = (k: string, v: string) => {
        const idx = dotLines.findIndex(l => l.startsWith(`${k}=`) || l.startsWith(`${k} =`));
        if (idx >= 0) dotLines[idx] = `${k}=${v}`;
        else dotLines.push(`${k}=${v}`);
      };
      if (port) setVar('PORT', port);
      if (Array.isArray(envVars)) {
        for (const { key, value } of envVars) {
          if (key && key.trim()) setVar(key.trim(), value || '');
        }
      }
      writeFileSync(dotenvPath, dotLines.join('\n').replace(/\n+$/, '') + '\n', 'utf-8');
    }

    // Build the pm2 start command (handles both file paths and command-style scripts)
    let cmd = buildPm2Cmd(script, name, cwd, interpreter);

    // Inject env via --env when no cwd .env file was written above
    if (!cwd && port) cmd += ` --env PORT=${port}`;
    if (!cwd && Array.isArray(envVars)) {
      for (const { key, value } of envVars) {
        if (key && key.trim()) cmd += ` --env ${key.trim()}=${value || ''}`;
      }
    }

    if (installDeps && cwd) {
      const pm = pkgManager === 'bun' ? 'bun' : 'npm';
      const installCmd = pm === 'bun'
        ? `(command -v bun >/dev/null 2>&1 || npm install -g bun) && cd "${cwd}" && bun install 2>&1`
        : `${NVM_PREFIX}cd "${cwd}" && npm install 2>&1`;
      await execAsync(installCmd, { timeout: 300000, env: BASE_ENV }).catch(() => {});
    }
    await execAsync(`${NVM_PREFIX}${cmd}`, { timeout: 60000, env: BASE_ENV });
    await execAsync(`${NVM_PREFIX}pm2 save`, { timeout: 10000, env: BASE_ENV }).catch(() => {});
    await execAsync(`${NVM_PREFIX}pm2 startup systemd -u root --hp /root 2>/dev/null || pm2 startup 2>/dev/null`, { timeout: 15000, env: BASE_ENV }).catch(() => {});
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/:id/stop', async (req, res) => {
  try {
    await runPM2(`stop ${req.params.id}`);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/:id/start', async (req, res) => {
  try {
    await runPM2(`start ${req.params.id}`);
    execAsync('pm2 save').catch(() => {});
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/:id/restart', async (req, res) => {
  try {
    await runPM2(`restart ${req.params.id}`);
    execAsync('pm2 save').catch(() => {});
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/:id/delete', async (req, res) => {
  try {
    await runPM2(`delete ${req.params.id}`);
    await execAsync('pm2 save');
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/:id/logs', async (req, res) => {
  try {
    const id = req.params.id;
    // Get full process list (raw jlist includes pm2_env with log file paths)
    const processes = await listProcesses();
    const proc = processes.find((p: any) =>
      String(p.pm_id) === String(id) || p.name === id
    );

    const outLog: string = proc?.pm2_env?.pm_out_log_path || '';
    const errLog: string = proc?.pm2_env?.pm_err_log_path || '';

    if (outLog) {
      let content = '';
      try {
        const { stdout } = await execAsync(`tail -n 300 "${outLog}" 2>/dev/null || true`, { timeout: 5000 });
        content += stdout;
      } catch { /* ignore */ }
      if (errLog && errLog !== outLog) {
        try {
          const { stdout } = await execAsync(`tail -n 150 "${errLog}" 2>/dev/null || true`, { timeout: 5000 });
          if (stdout.trim()) content += `\n\x1b[31m\n── stderr ──\x1b[0m\n${stdout}`;
        } catch { /* ignore */ }
      }
      return res.json({ success: true, data: content || '(no log output yet)' });
    }

    // Fallback: pm2 logs with a short timeout & limited lines
    const { stdout } = await execAsync(
      `pm2 logs ${id} --lines 100 --nostream --no-color 2>&1`,
      { timeout: 12000 }
    );
    res.json({ success: true, data: stdout || 'No logs available' });
  } catch (e: any) {
    res.json({ success: true, data: e.stdout || e.message || 'No logs available' });
  }
});

// PM2 terminal: run any pm2 command
const ALLOWED_PM2_CMDS = [
  'list', 'ls', 'status', 'monit', 'info', 'describe', 'logs', 'flush',
  'save', 'startup', 'unstartup', 'reset', 'reload', 'restart', 'stop',
  'start', 'delete', 'env', 'jlist', 'prettylist', 'version', 'ping',
];

router.post('/terminal', async (req, res) => {
  try {
    const { command } = req.body as { command: string };
    if (!command || typeof command !== 'string') {
      return res.status(400).json({ success: false, error: 'command is required' });
    }
    const trimmed = command.trim();
    const args = trimmed.replace(/^pm2\s+/i, '').trim();
    const parts = args.split(/\s+/);
    const firstWord = parts[0].toLowerCase();
    if (!ALLOWED_PM2_CMDS.includes(firstWord)) {
      return res.status(400).json({ success: false, error: `Command not allowed: ${firstWord}` });
    }

    // `logs` can hang with pm2 daemon — read files directly instead
    if (firstWord === 'logs') {
      const nameOrId = parts[1] || '';
      const lines = parseInt(
        (parts.find(p => /^\d+$/.test(p) && p !== nameOrId) || parts[parts.indexOf('--lines') + 1] || ''),
        10
      ) || 100;

      const processes = await listProcesses();
      const proc = processes.find((p: any) =>
        !nameOrId || String(p.pm_id) === nameOrId || p.name === nameOrId
      );
      const outLog: string = proc?.pm2_env?.pm_out_log_path || '';
      const errLog: string = proc?.pm2_env?.pm_err_log_path || '';

      if (outLog) {
        let content = '';
        try {
          const { stdout } = await execAsync(`tail -n ${lines} "${outLog}" 2>/dev/null || true`, { timeout: 5000 });
          content += stdout;
        } catch { /* ignore */ }
        if (errLog && errLog !== outLog) {
          try {
            const { stdout } = await execAsync(`tail -n ${Math.ceil(lines / 2)} "${errLog}" 2>/dev/null || true`, { timeout: 5000 });
            if (stdout.trim()) content += `\n\x1b[31m── stderr ──\x1b[0m\n${stdout}`;
          } catch { /* ignore */ }
        }
        return res.json({ success: true, data: content || '(no log output yet)' });
      }
      // No log path found — fallback with nostream
      const { stdout } = await execAsync(
        `pm2 logs ${nameOrId} --lines ${lines} --nostream --no-color 2>&1`,
        { timeout: 15000 }
      );
      return res.json({ success: true, data: stdout || '(no logs)' });
    }

    const { stdout, stderr } = await execAsync(`pm2 ${args} 2>&1`, { timeout: 20000, env: COLOR_ENV });
    res.json({ success: true, data: stdout || stderr || '(no output)' });
  } catch (e: any) {
    res.json({ success: true, data: e.stdout || e.stderr || e.message || 'Error running command' });
  }
});

export default router;
