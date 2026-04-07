import { Router } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const router = Router();

async function run(cmd: string, timeout = 12000): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout });
    return (stdout + stderr).trim();
  } catch (e: any) {
    return (e.stdout || e.stderr || e.message || '').trim();
  }
}

async function binVersion(bin: string, args = '--version'): Promise<string | null> {
  try {
    const out = await run(`${bin} ${args} 2>&1`);
    const m = out.match(/(\d+\.\d+[\.\d]*)/);
    return m ? m[1] : out.split('\n')[0] || null;
  } catch { return null; }
}

async function isInstalled(bin: string): Promise<boolean> {
  try {
    const out = await run(`which ${bin} 2>/dev/null || command -v ${bin} 2>/dev/null`);
    return !!out.trim();
  } catch { return false; }
}

async function npmLatest(pkg: string): Promise<string | null> {
  try {
    const out = await run(`npm view ${pkg} version 2>/dev/null`, 15000);
    return out || null;
  } catch { return null; }
}

async function aptLatest(pkg: string): Promise<string | null> {
  try {
    const out = await run(`apt-cache policy ${pkg} 2>/dev/null | grep 'Candidate:'`);
    const m = out.match(/Candidate:\s*(\S+)/);
    const v = m?.[1];
    return (v && v !== '(none)') ? v : null;
  } catch { return null; }
}

function semverGt(a: string, b: string): boolean {
  if (!a || !b) return false;
  const pa = a.split(/[.\-]/).map(x => parseInt(x) || 0);
  const pb = b.split(/[.\-]/).map(x => parseInt(x) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0; const nb = pb[i] || 0;
    if (na > nb) return true;
    if (na < nb) return false;
  }
  return false;
}

async function getNodeInfo() {
  const inst = await isInstalled('node');
  const ver = inst ? await binVersion('node') : null;
  const latest = await aptLatest('nodejs');
  return {
    id: 'nodejs', name: 'Node.js', bin: 'node', icon: '🟢',
    description: 'JavaScript runtime built on Chrome V8',
    installed: inst, version: ver,
    latestVersion: latest,
    updateAvailable: ver && latest ? semverGt(latest.replace(/[^\d.]/g, ''), ver) : false,
    canSelectVersion: true,
  };
}

async function getBunInfo() {
  const inst = await isInstalled('bun');
  const ver = inst ? await binVersion('bun') : null;
  const latest = await npmLatest('bun');
  return {
    id: 'bun', name: 'Bun', bin: 'bun', icon: '🍞',
    description: 'Fast all-in-one JavaScript runtime',
    installed: inst, version: ver,
    latestVersion: latest,
    updateAvailable: ver && latest ? semverGt(latest, ver) : false,
  };
}

async function getPm2Info() {
  const inst = await isInstalled('pm2');
  const ver = inst ? await binVersion('pm2') : null;
  const latest = await npmLatest('pm2');
  return {
    id: 'pm2', name: 'PM2', bin: 'pm2', icon: '⚙️',
    description: 'Production process manager for Node.js',
    installed: inst, version: ver,
    latestVersion: latest,
    updateAvailable: ver && latest ? semverGt(latest, ver) : false,
  };
}

async function getPythonInfo() {
  const inst = await isInstalled('python3');
  const ver = inst ? await binVersion('python3') : null;
  const latest = await aptLatest('python3');
  return {
    id: 'python', name: 'Python', bin: 'python3', icon: '🐍',
    description: 'High-level programming language',
    installed: inst, version: ver,
    latestVersion: latest,
    updateAvailable: ver && latest ? semverGt(latest.replace(/[^\d.]/g, ''), ver) : false,
  };
}

async function getPythonVenvInfo() {
  const inst = await isInstalled('python3');
  let venvAvail = false;
  if (inst) {
    const out = await run('python3 -m venv --help 2>&1');
    venvAvail = !out.includes('No module') && !out.includes('not found');
  }
  return {
    id: 'python-venv', name: 'Python Venv', bin: 'python3-venv', icon: '🌐',
    description: 'Python virtual environment module',
    installed: venvAvail, version: venvAvail ? await binVersion('python3') : null,
    latestVersion: null, updateAvailable: false,
  };
}

async function getCertbotInfo() {
  const inst = await isInstalled('certbot');
  const ver = inst ? await binVersion('certbot') : null;
  const latest = await aptLatest('certbot');
  return {
    id: 'certbot', name: 'Certbot', bin: 'certbot', icon: '🔒',
    description: "Let's Encrypt SSL certificate client",
    installed: inst, version: ver,
    latestVersion: latest,
    updateAvailable: ver && latest ? semverGt(latest.replace(/[^\d.]/g, ''), ver) : false,
  };
}

async function getNginxInfo() {
  const inst = await isInstalled('nginx');
  const ver = inst ? await binVersion('nginx', '-v') : null;
  const latest = await aptLatest('nginx');
  const running = inst ? !(await run('systemctl is-active nginx 2>&1')).includes('inactive') : false;
  return {
    id: 'nginx', name: 'Nginx', bin: 'nginx', icon: '🌿',
    description: 'High-performance HTTP server & reverse proxy',
    installed: inst, version: ver, running,
    latestVersion: latest,
    updateAvailable: ver && latest ? semverGt(latest.replace(/[^\d.]/g, ''), ver) : false,
  };
}

async function getApacheInfo() {
  const inst = await isInstalled('apache2') || await isInstalled('httpd');
  const bin = (await isInstalled('apache2')) ? 'apache2' : 'httpd';
  const ver = inst ? await binVersion(bin, '-v') : null;
  const latest = await aptLatest('apache2');
  const running = inst ? (await run('systemctl is-active apache2 2>&1 || systemctl is-active httpd 2>&1')).includes('active') : false;
  return {
    id: 'apache', name: 'Apache', bin, icon: '🪶',
    description: 'World-wide HTTP server (Apache2)',
    installed: inst, version: ver, running,
    latestVersion: latest,
    updateAvailable: ver && latest ? semverGt(latest.replace(/[^\d.]/g, ''), ver) : false,
  };
}

// ── Docker & Compose versions ─────────────────────────────────────────────────
async function getDockerInfo() {
  const inst = await isInstalled('docker');
  const ver = inst ? await binVersion('docker') : null;
  const latest = await aptLatest('docker-ce');
  return {
    id: 'docker', name: 'Docker', bin: 'docker', icon: '🐳',
    version: ver, latestVersion: latest,
    updateAvailable: ver && latest ? semverGt(latest.replace(/[^\d.]/g, ''), ver) : false,
  };
}

async function getDockerComposeInfo() {
  const inst = await isInstalled('docker');
  if (!inst) return { id: 'docker-compose', name: 'Docker Compose', version: null, latestVersion: null, updateAvailable: false };
  const ver = await run('docker compose version 2>&1 || docker-compose --version 2>&1').then(o => {
    const m = o.match(/(\d+\.\d+[\.\d]*)/); return m ? m[1] : null;
  });
  const latest = await aptLatest('docker-compose-plugin');
  return {
    id: 'docker-compose', name: 'Docker Compose', bin: 'docker compose',
    version: ver, latestVersion: latest,
    updateAvailable: ver && latest ? semverGt(latest.replace(/[^\d.]/g, ''), ver) : false,
  };
}

// ── PM2 version for PM2 page ──────────────────────────────────────────────────
router.get('/pm2-version', async (_req, res) => {
  try {
    const d = await getPm2Info();
    res.json({ success: true, data: d });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/docker-version', async (_req, res) => {
  try {
    const [docker, compose] = await Promise.all([getDockerInfo(), getDockerComposeInfo()]);
    res.json({ success: true, data: { docker, compose } });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Get all extras ────────────────────────────────────────────────────────────
router.get('/', async (_req, res) => {
  try {
    const results = await Promise.allSettled([
      getNodeInfo(), getBunInfo(), getPm2Info(), getPythonInfo(),
      getPythonVenvInfo(), getCertbotInfo(), getNginxInfo(), getApacheInfo(),
    ]);
    const data = results.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean);
    res.json({ success: true, data });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Install ───────────────────────────────────────────────────────────────────
const INSTALL_CMDS: Record<string, (opts: any) => string> = {
  nodejs: (o) => {
    const major = o?.nodeVersion || '20';
    return `curl -fsSL https://deb.nodesource.com/setup_${major}.x | bash - && DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs 2>&1`;
  },
  bun: () => `curl -fsSL https://bun.sh/install | bash 2>&1 || npm install -g bun 2>&1`,
  pm2: () => `npm install -g pm2 2>&1`,
  python: () => `DEBIAN_FRONTEND=noninteractive apt-get install -y python3 python3-pip 2>&1`,
  'python-venv': () => `DEBIAN_FRONTEND=noninteractive apt-get install -y python3-venv 2>&1`,
  certbot: () => `DEBIAN_FRONTEND=noninteractive apt-get install -y certbot 2>&1`,
  nginx: () => `DEBIAN_FRONTEND=noninteractive apt-get install -y nginx 2>&1 && systemctl enable nginx && systemctl start nginx 2>&1`,
  apache: () => `DEBIAN_FRONTEND=noninteractive apt-get install -y apache2 2>&1 && systemctl enable apache2 && systemctl start apache2 2>&1`,
};

const UPDATE_CMDS: Record<string, string> = {
  nodejs: 'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade nodejs 2>&1',
  bun: 'bun upgrade 2>&1 || npm install -g bun@latest 2>&1',
  pm2: 'npm install -g pm2@latest 2>&1',
  python: 'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade python3 2>&1',
  'python-venv': 'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade python3-venv 2>&1',
  certbot: 'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade certbot 2>&1',
  nginx: 'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade nginx 2>&1',
  apache: 'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade apache2 2>&1',
};

router.post('/:tool/install', async (req, res) => {
  const { tool } = req.params;
  const cmdFn = INSTALL_CMDS[tool];
  if (!cmdFn) return res.status(400).json({ success: false, error: 'Unknown tool' });
  try {
    const cmd = `apt-get update -qq 2>&1; ${cmdFn(req.body)}`;
    const output = await run(cmd, 180000);
    res.json({ success: true, output });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/:tool/update', async (req, res) => {
  const { tool } = req.params;
  const cmd = UPDATE_CMDS[tool];
  if (!cmd) return res.status(400).json({ success: false, error: 'Unknown tool' });
  try {
    const output = await run(cmd, 120000);
    res.json({ success: true, output });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── User Management ───────────────────────────────────────────────────────────
router.get('/users', async (_req, res) => {
  try {
    const out = await run(`getent passwd | awk -F: '$3 >= 1000 && $3 < 65534 {print $1"|"$3"|"$4"|"$5"|"$6"|"$7}'`);
    const users = out.trim().split('\n').filter(Boolean).map(line => {
      const [username, uid, gid, gecos, home, shell] = line.split('|');
      return { username, uid: parseInt(uid), gid: parseInt(gid), displayName: gecos, home, shell };
    });
    res.json({ success: true, data: users });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/users', async (req, res) => {
  const { username, password, shell = '/bin/bash', sudo = false } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, error: 'username and password are required' });
  const safeUser = username.replace(/[^a-z0-9_-]/g, '');
  if (!safeUser) return res.status(400).json({ success: false, error: 'Invalid username' });
  try {
    let cmd = `useradd -m -s ${shell} ${safeUser} 2>&1 && echo '${safeUser}:${password.replace(/'/g, "'\\''")}' | chpasswd 2>&1`;
    if (sudo) cmd += ` && usermod -aG sudo ${safeUser} 2>&1`;
    const output = await run(cmd);
    if (output.includes('already exists')) return res.status(409).json({ success: false, error: 'User already exists' });
    res.json({ success: true, output });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.patch('/users/:username', async (req, res) => {
  const { username } = req.params;
  const { password, shell, sudo } = req.body;
  const safeUser = username.replace(/[^a-z0-9_-]/g, '');
  try {
    const cmds: string[] = [];
    if (password) cmds.push(`echo '${safeUser}:${password.replace(/'/g, "'\\''")}' | chpasswd 2>&1`);
    if (shell) cmds.push(`chsh -s ${shell} ${safeUser} 2>&1`);
    if (sudo === true) cmds.push(`usermod -aG sudo ${safeUser} 2>&1`);
    if (sudo === false) cmds.push(`gpasswd -d ${safeUser} sudo 2>&1 || deluser ${safeUser} sudo 2>&1`);
    if (!cmds.length) return res.status(400).json({ success: false, error: 'Nothing to update' });
    const output = await run(cmds.join(' && '));
    res.json({ success: true, output });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.delete('/users/:username', async (req, res) => {
  const { username } = req.params;
  const safeUser = username.replace(/[^a-z0-9_-]/g, '');
  const { keepHome = false } = req.body;
  try {
    const flag = keepHome ? '' : '-r';
    const output = await run(`userdel ${flag} ${safeUser} 2>&1`);
    res.json({ success: true, output });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
