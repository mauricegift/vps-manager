import { Router } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const router = Router();

const COLOR_ENV = { ...process.env, FORCE_COLOR: '3', COLORTERM: 'truecolor' };

function runPM2(args: string) {
  return execAsync(`pm2 ${args} 2>&1`, { env: COLOR_ENV });
}

function runPM2Json(args: string) {
  return execAsync(`pm2 ${args} --no-color 2>&1`);
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
    const data = processes.map((p: any) => ({
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
    }));
    res.json({ success: true, data });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/start', async (req, res) => {
  try {
    const { name, script, cwd } = req.body;
    let cmd = `pm2 start "${script}" --name "${name}"`;
    if (cwd) cmd += ` --cwd "${cwd}"`;
    await execAsync(cmd);
    await execAsync('pm2 save');
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
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/:id/restart', async (req, res) => {
  try {
    await runPM2(`restart ${req.params.id}`);
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
