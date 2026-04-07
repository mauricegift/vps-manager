import { Router } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const router = Router();

function runPM2(args: string) {
  return execAsync(`pm2 ${args} --no-color 2>&1`);
}

async function listProcesses() {
  try {
    const { stdout } = await runPM2('jlist');
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
    const { stdout } = await runPM2(`logs ${req.params.id} --lines 200 --nostream`);
    res.json({ success: true, data: stdout });
  } catch (e: any) {
    res.json({ success: true, data: e.message || 'No logs' });
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
    // Strip leading "pm2 " if user typed it
    const args = trimmed.replace(/^pm2\s+/i, '').trim();
    const firstWord = args.split(/\s+/)[0].toLowerCase();
    if (!ALLOWED_PM2_CMDS.includes(firstWord)) {
      return res.status(400).json({ success: false, error: `Command not allowed: ${firstWord}` });
    }
    const { stdout, stderr } = await execAsync(`pm2 ${args} --no-color 2>&1`, { timeout: 15000 });
    res.json({ success: true, data: stdout || stderr || '(no output)' });
  } catch (e: any) {
    res.json({ success: true, data: e.stdout || e.stderr || e.message || 'Error running command' });
  }
});

export default router;
