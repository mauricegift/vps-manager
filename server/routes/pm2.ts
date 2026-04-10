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

// Interpreters that are invoked as commands rather than file paths
// e.g. "npm start" → script="npm", args="start"
const COMMAND_INTERPS = new Set(['npm', 'bun', 'node', 'python3', 'python', 'npx', 'pnpm', 'yarn', 'deno']);

router.post('/start', async (req, res) => {
  let ecosystemPath = '';
  try {
    const { name, script, cwd, port, interpreter, envVars, pkgManager, installDeps } = req.body;

    // ── Build explicit env block for the new process ──────────────────────────
    // We MUST use a PM2 ecosystem JSON file rather than --env flags because:
    //  1. PM2's --env CLI flag selects named ecosystem blocks, NOT key=value pairs
    //  2. BASE_ENV inherits PORT=5756 from our server process; without an explicit
    //     env block that inheritance bleeds into every spawned process
    const procEnv: Record<string, string> = {};
    if (port) procEnv.PORT = String(port);
    if (Array.isArray(envVars)) {
      for (const { key, value } of envVars) {
        if (key?.trim()) procEnv[key.trim()] = value ?? '';
      }
    }

    // ── Also write env to .env in cwd so the app can read via dotenv ─────────
    if (cwd && Object.keys(procEnv).length > 0) {
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
      for (const [k, v] of Object.entries(procEnv)) setVar(k, v);
      writeFileSync(dotenvPath, dotLines.join('\n').replace(/\n+$/, '') + '\n', 'utf-8');
    }

    // ── Detect script type ────────────────────────────────────────────────────
    const parts = script.trim().split(/\s+/);
    const first = parts[0].toLowerCase();
    const isCommandStyle = COMMAND_INTERPS.has(first);
    const scriptIsSh = !isCommandStyle && /\.(sh|bash)$/i.test(script.trim());
    const useBash = scriptIsSh || interpreter === 'bash';

    // ── Build PM2 ecosystem config object ────────────────────────────────────
    const appEntry: Record<string, unknown> = { name };

    if (isCommandStyle) {
      // e.g. "npm start", "bun run app.js", "python app.py"
      appEntry.script = parts[0];
      if (parts.length > 1) appEntry.args = parts.slice(1).join(' ');
    } else {
      appEntry.script = script.trim();
      if (useBash) appEntry.interpreter = 'bash';
    }

    if (cwd) appEntry.cwd = cwd;

    // Explicitly set env — this overrides anything the PM2 daemon might inherit
    // Always include at minimum an empty env so PORT=5756 is not forwarded
    appEntry.env = procEnv;

    // ── Write temporary ecosystem JSON and start via it ───────────────────────
    const { writeFileSync, unlinkSync } = await import('fs');
    ecosystemPath = `/tmp/pm2-start-${Date.now()}.json`;
    writeFileSync(ecosystemPath, JSON.stringify({ apps: [appEntry] }));

    if (installDeps && cwd) {
      const pm = pkgManager === 'bun' ? 'bun' : 'npm';
      const installCmd = pm === 'bun'
        ? `(command -v bun >/dev/null 2>&1 || npm install -g bun) && cd "${cwd}" && bun install 2>&1`
        : `${NVM_PREFIX}cd "${cwd}" && npm install 2>&1`;
      await execAsync(installCmd, { timeout: 300000, env: BASE_ENV }).catch(() => {});
    }

    await execAsync(`${NVM_PREFIX}pm2 start ${JSON.stringify(ecosystemPath)}`, { timeout: 60000, env: BASE_ENV });
    await execAsync(`${NVM_PREFIX}pm2 save`, { timeout: 10000, env: BASE_ENV }).catch(() => {});
    await execAsync(`${NVM_PREFIX}pm2 startup systemd -u root --hp /root 2>/dev/null || pm2 startup 2>/dev/null`, { timeout: 15000, env: BASE_ENV }).catch(() => {});
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  } finally {
    if (ecosystemPath) {
      try { const { unlinkSync } = await import('fs'); unlinkSync(ecosystemPath); } catch {}
    }
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
