import { Router } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const execAsync = promisify(exec);
const router = Router();

async function dockerCmd(args: string) {
  return execAsync(`docker ${args} 2>&1`);
}

// ── Containers ──────────────────────────────────────────────────────────────
router.get('/containers', async (_req, res) => {
  try {
    const { stdout } = await dockerCmd('ps -a --format "{{json .}}"');
    const lines = stdout.trim().split('\n').filter(Boolean);
    const containers = lines.map(line => {
      try {
        const d = JSON.parse(line);
        return {
          Id: d.ID,
          Names: [d.Names],
          Image: d.Image,
          Status: d.Status,
          State: d.State,
          Ports: parsePorts(d.Ports || ''),
          Created: 0,
        };
      } catch { return null; }
    }).filter(Boolean);
    res.json({ success: true, data: containers });
  } catch {
    res.json({ success: true, data: [] });
  }
});

function parsePorts(ports: string) {
  if (!ports) return [];
  return ports.split(', ').map(p => {
    const m = p.match(/(\d+)->(\d+)/);
    if (m) return { PublicPort: parseInt(m[1]), PrivatePort: parseInt(m[2]), Type: 'tcp' };
    return { PrivatePort: parseInt(p) || 0, Type: 'tcp' };
  }).filter(p => p.PrivatePort);
}

router.post('/containers/:id/start', async (req, res) => {
  try {
    await dockerCmd(`start ${req.params.id}`);
    // Auto-enable docker to start on system boot
    execAsync('systemctl enable docker 2>/dev/null').catch(() => {});
    res.json({ success: true });
  }
  catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/containers/:id/stop', async (req, res) => {
  try { await dockerCmd(`stop ${req.params.id}`); res.json({ success: true }); }
  catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/containers/:id/restart', async (req, res) => {
  try { await dockerCmd(`restart ${req.params.id}`); res.json({ success: true }); }
  catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/containers/:id/remove', async (req, res) => {
  try { await dockerCmd(`rm -f ${req.params.id}`); res.json({ success: true }); }
  catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/containers/:id/logs', async (req, res) => {
  try {
    const { stdout } = await dockerCmd(`logs --tail 200 ${req.params.id}`);
    res.json({ success: true, data: stdout });
  } catch (e: any) { res.json({ success: true, data: e.message }); }
});

// ── Images ──────────────────────────────────────────────────────────────────
router.get('/images', async (_req, res) => {
  try {
    const { stdout } = await dockerCmd('images --format "{{json .}}"');
    const lines = stdout.trim().split('\n').filter(Boolean);
    const images = lines.map(line => {
      try {
        const d = JSON.parse(line);
        return {
          Id: d.ID,
          RepoTags: [`${d.Repository}:${d.Tag}`],
          Size: parseSize(d.Size),
          Created: 0,
        };
      } catch { return null; }
    }).filter(Boolean);
    res.json({ success: true, data: images });
  } catch { res.json({ success: true, data: [] }); }
});

function parseSize(s: string): number {
  if (!s) return 0;
  const n = parseFloat(s);
  if (s.includes('GB')) return n * 1e9;
  if (s.includes('MB')) return n * 1e6;
  if (s.includes('kB')) return n * 1e3;
  return n;
}

router.delete('/images/:id', async (req, res) => {
  try { await dockerCmd(`rmi -f ${req.params.id}`); res.json({ success: true }); }
  catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/images/run', async (req, res) => {
  try {
    const { image, name, port } = req.body as { image: string; name?: string; port?: string };
    if (!image) return res.status(400).json({ success: false, error: 'image is required' });
    const safeImage = image.replace(/[^a-zA-Z0-9:.\-_/@]/g, '');
    const containerName = (name || safeImage.replace(/[^a-zA-Z0-9_.-]/g, '_').replace(/^_+|_+$/g, '')).slice(0, 64);
    let cmd = `docker run -d --name "${containerName}" --restart unless-stopped`;
    if (port) {
      const safePort = port.replace(/[^0-9:]/g, '');
      if (safePort) cmd += ` -p ${safePort}`;
    }
    cmd += ` ${safeImage}`;
    await execAsync(cmd, { timeout: 30000 });
    res.json({ success: true, containerName });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/images/pull', async (req, res) => {
  try {
    const { image, port, autoRun } = req.body;
    if (!image) return res.status(400).json({ success: false, error: 'image is required' });
    // Sanitise inputs
    const safeImage = image.replace(/[^a-zA-Z0-9:.\-_/@]/g, '');
    await execAsync(`docker pull ${safeImage}`, { timeout: 180000 });

    if (autoRun && port) {
      const safePort = port.replace(/[^0-9:]/g, '');
      const containerName = safeImage.replace(/[^a-zA-Z0-9_.-]/g, '_').replace(/^_+|_+$/g, '');
      await execAsync(
        `docker run -d --name "${containerName}" -p ${safePort} --restart unless-stopped ${safeImage}`,
        { timeout: 30000 }
      );
    }

    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Compose ─────────────────────────────────────────────────────────────────
router.get('/compose', async (_req, res) => {
  try {
    const searchDirs = ['/root', '/home', '/var/www', '/opt', '/srv'];
    const composeFiles: string[] = [];

    for (const dir of searchDirs) {
      if (!existsSync(dir)) continue;
      try {
        const entries = await readdir(dir);
        for (const entry of entries) {
          const fullPath = path.join(dir, entry);
          try {
            const s = await stat(fullPath);
            if (s.isDirectory()) {
              const sub = await readdir(fullPath);
              for (const f of sub) {
                if (['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'].includes(f)) {
                  composeFiles.push(path.join(fullPath, f));
                }
              }
            }
          } catch {}
        }
      } catch {}
    }

    const results = await Promise.all(composeFiles.map(async (file) => {
      const dir = path.dirname(file);
      const name = path.basename(dir);
      let services: string[] = [];
      let status = 'unknown';
      let ports: string[] = [];
      try {
        const { stdout } = await execAsync(`docker compose -f "${file}" ps --format json 2>&1`);
        const items = stdout.trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        services = [...new Set(items.map((i: any) => i.Service))];
        status = items.some((i: any) => i.State === 'running') ? 'running' : items.length > 0 ? 'stopped' : 'unknown';
        // Extract ports from running containers
        const allPorts: string[] = [];
        items.forEach((i: any) => {
          if (i.Publishers) {
            i.Publishers.forEach((p: any) => {
              if (p.PublishedPort) allPorts.push(`${p.PublishedPort}:${p.TargetPort}`);
            });
          }
        });
        ports = [...new Set(allPorts)];
      } catch {
        // Try to parse ports from YAML as fallback
        try {
          const { readFile } = await import('fs/promises');
          const yaml = await readFile(file, 'utf-8');
          const portMatches = yaml.matchAll(/^\s*-\s*["']?(\d+:\d+)["']?/gm);
          for (const m of portMatches) ports.push(m[1]);
          ports = [...new Set(ports)];
        } catch {}
      }
      return { name, path: file, services, status, ports };
    }));

    res.json({ success: true, data: results });
  } catch (e: any) { res.json({ success: true, data: [] }); }
});

router.post('/compose/:action', async (req, res) => {
  try {
    const { path: composePath } = req.body;
    const action = req.params.action;
    const cmd = action === 'up' ? `docker compose -f "${composePath}" up -d`
      : action === 'down' ? `docker compose -f "${composePath}" down`
      : `docker compose -f "${composePath}" restart`;
    await execAsync(cmd, { timeout: 60000 });
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Compose CRUD ─────────────────────────────────────────────────────────────
router.get('/compose/read', async (req, res) => {
  try {
    const { path: filePath } = req.query as { path: string };
    if (!filePath) return res.status(400).json({ success: false, error: 'path required' });
    const { readFile } = await import('fs/promises');
    const content = await readFile(filePath, 'utf-8');
    res.json({ success: true, data: content });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/compose/create', async (req, res) => {
  try {
    const { dir, yaml } = req.body;
    if (!dir || !yaml) return res.status(400).json({ success: false, error: 'dir and yaml required' });
    const { writeFile, mkdir } = await import('fs/promises');
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, 'docker-compose.yml');
    await writeFile(filePath, yaml, 'utf-8');
    await execAsync(`docker compose -f "${filePath}" up -d`, { timeout: 120000 });
    res.json({ success: true, data: { path: filePath } });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/compose/save', async (req, res) => {
  try {
    const { path: filePath, yaml } = req.body;
    if (!filePath || !yaml) return res.status(400).json({ success: false, error: 'path and yaml required' });
    const { writeFile } = await import('fs/promises');
    await writeFile(filePath, yaml, 'utf-8');
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/compose/logs', async (req, res) => {
  try {
    const { path: composePath } = req.query as { path: string };
    if (!composePath) return res.status(400).json({ success: false, error: 'path required' });
    const { stdout } = await execAsync(`docker compose -f "${composePath}" logs --tail 300 2>&1`);
    res.json({ success: true, data: stdout });
  } catch (e: any) { res.json({ success: true, data: e.message }); }
});

// ── Dockerfile Build ─────────────────────────────────────────────────────────
router.post('/images/build', async (req, res) => {
  try {
    const { name, tag = 'latest', context = '/tmp', dockerfile } = req.body;
    if (!name || !dockerfile) return res.status(400).json({ success: false, error: 'name and dockerfile required' });
    const { writeFile, mkdir } = await import('fs/promises');
    const buildDir = path.join('/tmp', `docker-build-${Date.now()}`);
    await mkdir(buildDir, { recursive: true });
    await writeFile(path.join(buildDir, 'Dockerfile'), dockerfile, 'utf-8');
    const contextDir = context && existsSync(context) ? context : buildDir;
    const fullTag = `${name}:${tag}`;
    const { stdout } = await execAsync(
      `docker build -t "${fullTag}" -f "${path.join(buildDir, 'Dockerfile')}" "${contextDir}" 2>&1`,
      { timeout: 300000 }
    );
    res.json({ success: true, data: stdout });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

export default router;
