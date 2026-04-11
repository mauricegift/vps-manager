import { Router } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';

const execAsync = promisify(exec);
const router = Router();

// Broad PATH so NVM-installed pm2/npm/node are always found even when spawned by PM2
const WIDE_PATH = [
  process.env.PATH,
  `${process.env.HOME || '/root'}/.nvm/versions/node`,   // resolved per-command via shell glob
  `${process.env.HOME || '/root'}/.local/bin`,
  '/usr/local/sbin', '/usr/local/bin', '/usr/sbin', '/usr/bin', '/sbin', '/bin',
].filter(Boolean).join(':');

// Strip server-specific vars (PORT etc.) so VPS Manager's own port never leaks
// into child processes. Processes get their PORT only via the ecosystem env block.
const { PORT: _stripPort, ...REST_ENV } = process.env as Record<string, string>;
const BASE_ENV = { ...REST_ENV, PATH: WIDE_PATH, FORCE_COLOR: '3', COLORTERM: 'truecolor', DEBIAN_FRONTEND: 'noninteractive' };
const COLOR_ENV = BASE_ENV;
// Prefix for shell commands — sources NVM so node/npm/pm2 are in PATH
const NVM_PREFIX = `export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" --no-use; `;

// ── Run a shell command as a non-root system user ────────────────────────────
async function runAsUser(cmd: string, user: string): Promise<{ stdout: string; stderr: string }> {
  const tmp = path.join(os.tmpdir(), `.vpsm-pm2-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`);
  // #!/bin/bash -l  → login shell so .bashrc / NVM are sourced automatically
  fs.writeFileSync(tmp, `#!/bin/bash -l\n${cmd}\n`, { mode: 0o755 });
  try {
    return await execAsync(`su - "${user}" -c "bash '${tmp}'"`, { env: BASE_ENV, timeout: 30000 });
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function runPM2(args: string, user?: string) {
  if (user && user !== 'root') return runAsUser(`${NVM_PREFIX}pm2 ${args} 2>&1`, user);
  return execAsync(`${NVM_PREFIX}pm2 ${args} 2>&1`, { env: BASE_ENV });
}

function runPM2Json(args: string, user?: string) {
  if (user && user !== 'root') return runAsUser(`${NVM_PREFIX}pm2 ${args} --no-color 2>&1`, user);
  return execAsync(`${NVM_PREFIX}pm2 ${args} --no-color 2>&1`, { env: BASE_ENV });
}

async function listProcesses(user?: string) {
  try {
    const { stdout } = await runPM2Json('jlist', user);
    return JSON.parse(stdout);
  } catch {
    return [];
  }
}

function resolveUser(query: Record<string, any>): string | undefined {
  const u = (query?.activeUser as string | undefined)?.trim();
  return u && u !== 'root' ? u : undefined;
}

router.get('/', async (req, res) => {
  try {
    const user = resolveUser(req.query);
    const processes = await listProcesses(user);
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

// ── Read a pm2 ecosystem.config.js/cjs and return its apps array ─────────────
async function readEcosystemApps(filePath: string): Promise<Array<{ name?: string; script?: string; cwd?: string; env?: Record<string, any> }>> {
  const tmpJs = `/tmp/eco-reader-${Date.now()}.js`;
  try {
    const code = `try{const c=require(${JSON.stringify(filePath)});const a=Array.isArray(c)?c:(c.apps||[]);process.stdout.write(JSON.stringify(a.map(function(x){return{name:x.name,script:x.script,cwd:x.cwd,env:Object.assign({},x.env||{},x.env_production||{})}})))}catch(e){process.stdout.write('[]')}`;
    fs.writeFileSync(tmpJs, code);
    const { stdout } = await execAsync(`node ${tmpJs}`, { timeout: 5000, env: BASE_ENV });
    return JSON.parse(stdout.trim()) || [];
  } catch { return []; }
  finally { try { fs.unlinkSync(tmpJs); } catch {} }
}

// GET /pm2/ecosystem?path=<absolute-path>  — read apps from an ecosystem config
router.get('/ecosystem', async (req, res) => {
  const filePath = (req.query.path as string | undefined)?.trim();
  if (!filePath) return res.status(400).json({ success: false, error: 'path query param required' });
  const apps = await readEcosystemApps(filePath);
  return res.json({ success: true, data: apps });
});

// ── Detect if an npm/yarn/pnpm/bun start script internally calls pm2 start ───
// Returns the real entry file path so we can start it directly, using the
// user's entered name instead of whatever --name is hardcoded in package.json.
function resolveNpmStartEntry(scriptCmd: string, cwd: string): string | null {
  if (!cwd) return null;
  const parts = scriptCmd.trim().split(/\s+/);
  const PKG_MANAGERS = ['npm', 'yarn', 'pnpm', 'bun'];
  if (parts.length < 2 || !PKG_MANAGERS.includes(parts[0].toLowerCase()) || parts[1] !== 'start') return null;
  try {
    const pkgPath = path.join(cwd, 'package.json');
    if (!fs.existsSync(pkgPath)) return null;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const startScript: string = pkg.scripts?.start || '';
    // Match: pm2 start <file> (with optional flags after)
    const m = startScript.match(/pm2\s+start\s+([^\s]+)/);
    if (!m) return null;
    return m[1]; // e.g. "index.js"
  } catch { return null; }
}

router.post('/start', async (req, res) => {
  let ecosystemPath = '';
  try {
    const { name, script, cwd, port, interpreter, envVars, pkgManager, installDeps, activeUser } = req.body;
    const user = activeUser && activeUser !== 'root' ? activeUser : undefined;

    // ── Build explicit env block for the new process ──────────────────────────
    const procEnv: Record<string, string> = {};
    if (port) procEnv.PORT = String(port);
    if (Array.isArray(envVars)) {
      for (const { key, value } of envVars) {
        if (key?.trim()) procEnv[key.trim()] = value ?? '';
      }
    }

    // ── Also write env to .env in cwd so the app can read via dotenv ─────────
    if (cwd && Object.keys(procEnv).length > 0) {
      const dotenvPath = `${cwd}/.env`;
      let existing = '';
      try { existing = fs.existsSync(dotenvPath) ? fs.readFileSync(dotenvPath, 'utf-8') : ''; } catch { existing = ''; }
      const dotLines = existing ? existing.split('\n') : [];
      const setVar = (k: string, v: string) => {
        const idx = dotLines.findIndex(l => l.startsWith(`${k}=`) || l.startsWith(`${k} =`));
        if (idx >= 0) dotLines[idx] = `${k}=${v}`;
        else dotLines.push(`${k}=${v}`);
      };
      for (const [k, v] of Object.entries(procEnv)) setVar(k, v);
      fs.writeFileSync(dotenvPath, dotLines.join('\n').replace(/\n+$/, '') + '\n', 'utf-8');
    }

    // ── Detect if script is a pm2 ecosystem config file ──────────────────────
    const isEcosystemConfig = /ecosystem\.config\.c?js$/i.test(script.trim());
    // Resolve the ecosystem file path (may be relative to cwd)
    const ecosystemFilePath = isEcosystemConfig
      ? (path.isAbsolute(script.trim()) ? script.trim() : path.join(cwd || process.cwd(), script.trim()))
      : null;

    if (isEcosystemConfig && ecosystemFilePath) {
      // ── Ecosystem mode: pass the config file directly to pm2 ───────────────
      // pm2 reads all names, scripts, env, ports from the file natively.
      if (installDeps && cwd) {
        const pm = pkgManager === 'bun' ? 'bun' : 'npm';
        const installCmd = pm === 'bun'
          ? `(command -v bun >/dev/null 2>&1 || npm install -g bun) && cd "${cwd}" && bun install 2>&1`
          : `${NVM_PREFIX}cd "${cwd}" && npm install 2>&1`;
        if (user) { await runAsUser(installCmd, user).catch(() => {}); }
        else { await execAsync(installCmd, { timeout: 300000, env: BASE_ENV }).catch(() => {}); }
      }
      await runPM2(`start ${JSON.stringify(ecosystemFilePath)}`, user);
      await runPM2('save', user).catch(() => {});
      if (!user) {
        await execAsync(`${NVM_PREFIX}pm2 startup systemd -u root --hp /root 2>/dev/null || pm2 startup 2>/dev/null`, { timeout: 15000, env: BASE_ENV }).catch(() => {});
      }
      return res.json({ success: true });
    }

    // ── Detect script type ────────────────────────────────────────────────────
    // If "npm start" (etc.) internally calls "pm2 start <file>", bypass npm
    // and start the entry file directly — this avoids a duplicate pm2 process
    // with a hardcoded name and ensures the user's entered name is used.
    const resolvedEntry = resolveNpmStartEntry(script, cwd);
    const effectiveScript = resolvedEntry
      ? path.isAbsolute(resolvedEntry) ? resolvedEntry : path.join(cwd, resolvedEntry)
      : script;

    const parts = effectiveScript.trim().split(/\s+/);
    const first = parts[0].toLowerCase();
    const isCommandStyle = !resolvedEntry && COMMAND_INTERPS.has(first);
    const scriptIsSh = !isCommandStyle && /\.(sh|bash)$/i.test(effectiveScript.trim());
    const useBash = scriptIsSh || interpreter === 'bash';

    // ── Build PM2 ecosystem config object ────────────────────────────────────
    const appEntry: Record<string, unknown> = { name };

    if (isCommandStyle) {
      appEntry.script = parts[0];
      if (parts.length > 1) appEntry.args = parts.slice(1).join(' ');
    } else {
      appEntry.script = effectiveScript.trim();
      if (useBash) appEntry.interpreter = 'bash';
    }

    if (cwd) appEntry.cwd = cwd;
    appEntry.env = procEnv;

    // ── Write temporary ecosystem JSON and start via it ───────────────────────
    ecosystemPath = `/tmp/pm2-start-${Date.now()}.json`;
    fs.writeFileSync(ecosystemPath, JSON.stringify({ apps: [appEntry] }));

    if (installDeps && cwd) {
      const pm = pkgManager === 'bun' ? 'bun' : 'npm';
      const installCmd = pm === 'bun'
        ? `(command -v bun >/dev/null 2>&1 || npm install -g bun) && cd "${cwd}" && bun install 2>&1`
        : `${NVM_PREFIX}cd "${cwd}" && npm install 2>&1`;
      if (user) {
        await runAsUser(installCmd, user).catch(() => {});
      } else {
        await execAsync(installCmd, { timeout: 300000, env: BASE_ENV }).catch(() => {});
      }
    }

    await runPM2(`start ${JSON.stringify(ecosystemPath)}`, user);
    await runPM2('save', user).catch(() => {});

    // Only set up PM2 startup for the root user (it requires root privileges)
    if (!user) {
      await execAsync(`${NVM_PREFIX}pm2 startup systemd -u root --hp /root 2>/dev/null || pm2 startup 2>/dev/null`, { timeout: 15000, env: BASE_ENV }).catch(() => {});
    }

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  } finally {
    if (ecosystemPath) {
      try { fs.unlinkSync(ecosystemPath); } catch {}
    }
  }
});

router.post('/:id/stop', async (req, res) => {
  try {
    const user = resolveUser(req.query);
    await runPM2(`stop ${req.params.id}`, user);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/:id/start', async (req, res) => {
  try {
    const user = resolveUser(req.query);
    await runPM2(`start ${req.params.id}`, user);
    runPM2('save', user).catch(() => {});
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/:id/restart', async (req, res) => {
  try {
    const user = resolveUser(req.query);
    await runPM2(`restart ${req.params.id}`, user);
    runPM2('save', user).catch(() => {});
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/:id/delete', async (req, res) => {
  try {
    const user = resolveUser(req.query);
    await runPM2(`delete ${req.params.id}`, user);
    await runPM2('save', user);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/:id/logs', async (req, res) => {
  try {
    const id = req.params.id;
    const user = resolveUser(req.query);
    const processes = await listProcesses(user);
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
    const { command, activeUser } = req.body as { command: string; activeUser?: string };
    const user = activeUser && activeUser !== 'root' ? activeUser : undefined;

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

    // `logs` — read log files directly (pm2 logs can hang)
    if (firstWord === 'logs') {
      const nameOrId = parts[1] || '';
      const lines = parseInt(
        (parts.find(p => /^\d+$/.test(p) && p !== nameOrId) || parts[parts.indexOf('--lines') + 1] || ''),
        10
      ) || 100;

      const processes = await listProcesses(user);
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
      const { stdout } = await execAsync(
        `pm2 logs ${nameOrId} --lines ${lines} --nostream --no-color 2>&1`,
        { timeout: 15000 }
      );
      return res.json({ success: true, data: stdout || '(no logs)' });
    }

    const { stdout, stderr } = await runPM2(args, user);
    res.json({ success: true, data: stdout || stderr || '(no output)' });
  } catch (e: any) {
    res.json({ success: true, data: e.stdout || e.stderr || e.message || 'Error running command' });
  }
});

export default router;
