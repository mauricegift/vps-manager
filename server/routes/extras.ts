import { Router } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);
const router = Router();
const HOME = os.homedir();

async function run(cmd: string, timeout = 12000): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout, env: { ...process.env, HOME } });
    return (stdout + stderr).trim();
  } catch (e: any) {
    return (e.stdout || e.stderr || e.message || '').trim();
  }
}

async function runV(cmd: string, timeout = 8000): Promise<string | null> {
  try {
    const out = await run(cmd, timeout);
    const m = out.match(/(\d+\.\d+[\.\d]*)/);
    return m ? m[1] : null;
  } catch { return null; }
}

function semverGt(a: string, b: string): boolean {
  if (!a || !b) return false;
  const pa = a.split(/[.\-]/).map(x => parseInt(x) || 0);
  const pb = b.split(/[.\-]/).map(x => parseInt(x) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0; const nb = pb[i] || 0;
    if (na > nb) return true; if (na < nb) return false;
  }
  return false;
}

// All candidate paths to search for any binary
function extraPaths(): string[] {
  return [
    `${HOME}/.local/bin`,
    `${HOME}/.bun/bin`,
    `${HOME}/.deno/bin`,
    `${HOME}/.cargo/bin`,
    `${HOME}/go/bin`,
    `/usr/local/bin`,
    `/usr/bin`,
    `/bin`,
    `/usr/local/sbin`,
    `/usr/sbin`,
  ];
}

async function getNvmBin(): Promise<string> {
  const active = (await run('ls ~/.nvm/versions/node/ 2>/dev/null | sort -V | tail -1')).trim();
  return active ? `${HOME}/.nvm/versions/node/${active}/bin` : '';
}

async function getNpmGlobalBin(): Promise<string> {
  const nvmBin = await getNvmBin();
  if (nvmBin) {
    const nvmNpm = path.join(nvmBin, 'npm');
    const exists = await run(`test -x "${nvmNpm}" && echo yes || echo no`);
    if (exists.trim() === 'yes') {
      const p = await run(`"${nvmNpm}" config get prefix 2>/dev/null`);
      if (p && !p.includes('undefined') && p.trim()) return path.join(p.trim(), 'bin');
      return nvmBin;
    }
  }
  const p = await run('npm config get prefix 2>/dev/null');
  return p && !p.includes('undefined') ? path.join(p.trim(), 'bin') : `${HOME}/.npm-global/bin`;
}

async function findBin(name: string, additionalPaths: string[] = []): Promise<{ found: boolean; binPath: string | null }> {
  // 1. Try PATH-aware which
  const which = await run(`which ${name} 2>/dev/null || command -v ${name} 2>/dev/null`);
  if (which && !which.includes('not found') && !which.includes('no ') && which.startsWith('/')) {
    return { found: true, binPath: which.split('\n')[0].trim() };
  }
  // 2. Check extra paths
  const allPaths = [...additionalPaths, ...extraPaths()];
  for (const dir of allPaths) {
    const candidate = path.join(dir, name);
    const exists = await run(`test -x "${candidate}" && echo yes || echo no`);
    if (exists.trim() === 'yes') return { found: true, binPath: candidate };
  }
  return { found: false, binPath: null };
}

async function getVersion(binPath: string, versionArg = '--version'): Promise<string | null> {
  const out = await run(`"${binPath}" ${versionArg} 2>&1`);
  const m = out.match(/(\d+\.\d+[\.\d]*)/);
  return m ? m[1] : null;
}

async function npmLatest(pkg: string): Promise<string | null> {
  const out = await run(`npm view ${pkg} version 2>/dev/null`, 15000);
  return out && !out.includes('npm error') && /^\d/.test(out.trim()) ? out.trim() : null;
}

async function aptLatest(pkg: string): Promise<string | null> {
  const out = await run(`apt-cache policy ${pkg} 2>/dev/null | grep 'Candidate:'`);
  const m = out.match(/Candidate:\s*(\S+)/);
  const v = m?.[1];
  return (v && v !== '(none)') ? v : null;
}

// ── Tool factories ─────────────────────────────────────────────────────────────

async function getNodeInfo() {
  const npmBin = await getNpmGlobalBin();
  // Check NVM paths too
  const nvmVersionsDir = `${HOME}/.nvm/versions/node`;
  const nvmPaths: string[] = [];
  try {
    const dirs = await run(`ls "${nvmVersionsDir}" 2>/dev/null`);
    for (const d of dirs.split('\n').filter(Boolean)) {
      nvmPaths.push(`${nvmVersionsDir}/${d.trim()}/bin`);
    }
  } catch {}

  const { found, binPath } = await findBin('node', [...nvmPaths.reverse(), npmBin]);
  if (!found || !binPath) {
    return { id: 'nodejs', name: 'Node.js', icon: '🟢', category: 'runtime',
      description: 'JavaScript runtime built on Chrome V8',
      installed: false, version: null, path: null, latestVersion: null, updateAvailable: false, canSelectVersion: true };
  }
  const version = await getVersion(binPath);
  const latest = await aptLatest('nodejs');
  return {
    id: 'nodejs', name: 'Node.js', icon: '🟢', category: 'runtime',
    description: 'JavaScript runtime built on Chrome V8',
    installed: true, version, path: binPath,
    latestVersion: latest,
    updateAvailable: version && latest ? semverGt(latest.replace(/[^\d.]/g, ''), version) : false,
    canSelectVersion: true,
  };
}

async function getNpmInfo() {
  const npmBin = await getNpmGlobalBin();
  const { found, binPath } = await findBin('npm', [npmBin]);
  if (!found || !binPath) return { id: 'npm', name: 'npm', icon: '📦', category: 'runtime', description: 'Node package manager', installed: false, version: null, path: null, latestVersion: null, updateAvailable: false };
  const version = await getVersion(binPath);
  return { id: 'npm', name: 'npm', icon: '📦', category: 'runtime', description: 'Node package manager', installed: true, version, path: binPath, latestVersion: null, updateAvailable: false };
}

async function getBunInfo() {
  const npmBin = await getNpmGlobalBin();
  const { found, binPath } = await findBin('bun', [`${HOME}/.bun/bin`, npmBin]);
  if (!found || !binPath) {
    return { id: 'bun', name: 'Bun', icon: '🍞', category: 'runtime', description: 'Fast all-in-one JS runtime', installed: false, version: null, path: null, latestVersion: null, updateAvailable: false };
  }
  const version = await getVersion(binPath);
  const latest = await npmLatest('bun');
  return { id: 'bun', name: 'Bun', icon: '🍞', category: 'runtime', description: 'Fast all-in-one JS runtime', installed: true, version, path: binPath, latestVersion: latest, updateAvailable: version && latest ? semverGt(latest, version) : false };
}

async function getDenoInfo() {
  const { found, binPath } = await findBin('deno', [`${HOME}/.deno/bin`]);
  if (!found || !binPath) return { id: 'deno', name: 'Deno', icon: '🦕', category: 'runtime', description: 'Secure JS/TS runtime by Ryan Dahl', installed: false, version: null, path: null, latestVersion: null, updateAvailable: false };
  const version = await getVersion(binPath);
  return { id: 'deno', name: 'Deno', icon: '🦕', category: 'runtime', description: 'Secure JS/TS runtime by Ryan Dahl', installed: true, version, path: binPath, latestVersion: null, updateAvailable: false };
}

async function getPm2Info() {
  const [nvmBin, npmBin] = await Promise.all([getNvmBin(), getNpmGlobalBin()]);
  const searchPaths = [nvmBin, npmBin, `${HOME}/.npm-global/bin`, `${HOME}/.local/bin`].filter(Boolean);
  const { found, binPath } = await findBin('pm2', searchPaths);
  if (!found || !binPath) return { id: 'pm2', name: 'PM2', icon: '⚙️', category: 'runtime', description: 'Production process manager for Node.js', installed: false, version: null, path: null, latestVersion: null, updateAvailable: false };
  const version = await getVersion(binPath);
  const latest = await npmLatest('pm2');
  return { id: 'pm2', name: 'PM2', icon: '⚙️', category: 'runtime', description: 'Production process manager for Node.js', installed: true, version, path: binPath, latestVersion: latest, updateAvailable: version && latest ? semverGt(latest, version) : false };
}

async function getPnpmInfo() {
  const npmBin = await getNpmGlobalBin();
  const { found, binPath } = await findBin('pnpm', [npmBin, `${HOME}/.local/bin`]);
  if (!found || !binPath) return { id: 'pnpm', name: 'pnpm', icon: '📦', category: 'runtime', description: 'Efficient disk-saving package manager', installed: false, version: null, path: null, latestVersion: null, updateAvailable: false };
  const version = await getVersion(binPath);
  const latest = await npmLatest('pnpm');
  return { id: 'pnpm', name: 'pnpm', icon: '📦', category: 'runtime', description: 'Efficient disk-saving package manager', installed: true, version, path: binPath, latestVersion: latest, updateAvailable: version && latest ? semverGt(latest, version) : false };
}

async function getYarnInfo() {
  const npmBin = await getNpmGlobalBin();
  const { found, binPath } = await findBin('yarn', [npmBin, `${HOME}/.local/bin`]);
  if (!found || !binPath) return { id: 'yarn', name: 'Yarn', icon: '🧶', category: 'runtime', description: 'Fast, reliable Node package manager', installed: false, version: null, path: null, latestVersion: null, updateAvailable: false };
  const version = await getVersion(binPath);
  const latest = await npmLatest('yarn');
  return { id: 'yarn', name: 'Yarn', icon: '🧶', category: 'runtime', description: 'Fast, reliable Node package manager', installed: true, version, path: binPath, latestVersion: latest, updateAvailable: version && latest ? semverGt(latest, version) : false };
}

async function getPythonInfo() {
  const { found, binPath } = await findBin('python3');
  if (!found || !binPath) return { id: 'python', name: 'Python', icon: '🐍', category: 'runtime', description: 'High-level programming language', installed: false, version: null, path: null, latestVersion: null, updateAvailable: false };
  const version = await getVersion(binPath);
  const latest = await aptLatest('python3');
  return { id: 'python', name: 'Python', icon: '🐍', category: 'runtime', description: 'High-level programming language', installed: true, version, path: binPath, latestVersion: latest, updateAvailable: version && latest ? semverGt(latest.replace(/[^\d.]/g, ''), version) : false };
}

async function getGoInfo() {
  const { found, binPath } = await findBin('go', [`${HOME}/go/bin`, `/usr/local/go/bin`]);
  if (!found || !binPath) return { id: 'go', name: 'Go', icon: '🐹', category: 'runtime', description: 'Google Go programming language', installed: false, version: null, path: null, latestVersion: null, updateAvailable: false };
  const version = await getVersion(binPath, 'version');
  return { id: 'go', name: 'Go', icon: '🐹', category: 'runtime', description: 'Google Go programming language', installed: true, version, path: binPath, latestVersion: null, updateAvailable: false };
}

async function getRustInfo() {
  const { found, binPath } = await findBin('cargo', [`${HOME}/.cargo/bin`]);
  if (!found || !binPath) return { id: 'rust', name: 'Rust / Cargo', icon: '🦀', category: 'runtime', description: 'Systems language with cargo package manager', installed: false, version: null, path: null, latestVersion: null, updateAvailable: false };
  const version = await getVersion(binPath);
  return { id: 'rust', name: 'Rust / Cargo', icon: '🦀', category: 'runtime', description: 'Systems language with cargo package manager', installed: true, version, path: binPath, latestVersion: null, updateAvailable: false };
}

async function getServerInfo(id: string, name: string, icon: string, bin: string, versionArg = '-v') {
  const { found, binPath } = await findBin(bin);
  if (!found || !binPath) return { id, name, icon, category: 'server', description: '', installed: false, version: null, path: null, latestVersion: null, updateAvailable: false, running: false };
  const version = await getVersion(binPath, versionArg);
  const latest = await aptLatest(id === 'apache' ? 'apache2' : bin);
  const running = !(await run(`systemctl is-active ${bin} 2>&1 || systemctl is-active ${id === 'apache' ? 'apache2' : bin} 2>&1`)).includes('inactive');
  return { id, name, icon, category: 'server' as const, description: id === 'nginx' ? 'High-performance HTTP server & reverse proxy' : 'Apache HTTP server', installed: true, version, path: binPath, latestVersion: latest, updateAvailable: version && latest ? semverGt(latest.replace(/[^\d.]/g, ''), version) : false, running };
}

async function getCertbotInfo() {
  const { found, binPath } = await findBin('certbot');
  if (!found || !binPath) return { id: 'certbot', name: 'Certbot', icon: '🔒', category: 'server', description: "Let's Encrypt SSL certificate client", installed: false, version: null, path: null, latestVersion: null, updateAvailable: false };
  const version = await getVersion(binPath);
  const latest = await aptLatest('certbot');
  return { id: 'certbot', name: 'Certbot', icon: '🔒', category: 'server', description: "Let's Encrypt SSL certificate client", installed: true, version, path: binPath, latestVersion: latest, updateAvailable: version && latest ? semverGt(latest.replace(/[^\d.]/g, ''), version) : false };
}

async function getSimpleTool(id: string, name: string, icon: string, description: string, bin?: string, versionArg = '--version'): Promise<any> {
  const b = bin || id;
  const { found, binPath } = await findBin(b);
  if (!found || !binPath) return { id, name, icon, category: 'tool', description, installed: false, version: null, path: null, latestVersion: null, updateAvailable: false };
  const version = await getVersion(binPath, versionArg);
  const latest = await aptLatest(b).catch(() => null);
  return { id, name, icon, category: 'tool', description, installed: true, version, path: binPath, latestVersion: latest, updateAvailable: version && latest ? semverGt(latest.replace(/[^\d.]/g, ''), version) : false };
}

// ── Main route — single shell script for speed ────────────────────────────────
router.get('/pm2-version', async (_req, res) => {
  try { res.json({ success: true, data: await getPm2Info() }); }
  catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/docker-version', async (_req, res) => {
  try {
    const { found: df, binPath: db } = await findBin('docker');
    const docker = df && db ? { installed: true, version: await getVersion(db), path: db } : { installed: false, version: null, path: null };
    const composeVer = df ? await runV('docker compose version 2>&1 || docker-compose --version 2>&1') : null;
    res.json({ success: true, data: { docker, compose: { installed: !!composeVer, version: composeVer } } });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/', async (_req, res) => {
  try {
    // Run a single comprehensive shell script instead of 26+ individual execs
    const script = `
NVM_ACTIVE=$(ls ~/.nvm/versions/node/ 2>/dev/null | sort -V | tail -1)
NVM_BIN="$HOME/.nvm/versions/node/$NVM_ACTIVE/bin"
# Get npm prefix: try nvm npm first, then PATH npm
if [ -n "$NVM_ACTIVE" ] && [ -x "$NVM_BIN/npm" ]; then
  NPM_PREFIX=$("$NVM_BIN/npm" config get prefix 2>/dev/null)
else
  NPM_PREFIX=$(npm config get prefix 2>/dev/null)
fi
NPM_BIN="$NPM_PREFIX/bin"

find_bin() {
  local name=$1
  for p in $(which "$name" 2>/dev/null) "$HOME/.nvm/versions/node/$NVM_ACTIVE/bin/$name" "$NPM_BIN/$name" "$HOME/.local/bin/$name" "$HOME/.bun/bin/$name" "$HOME/.deno/bin/$name" "$HOME/.cargo/bin/$name" "$HOME/go/bin/$name" /usr/local/go/bin/$name /usr/local/bin/$name /usr/bin/$name /bin/$name; do
    [ -x "$p" ] && echo "$p" && return
  done
}

emit() {
  local id="$1" bpath="$2" ver_arg="$3"
  if [ -z "$ver_arg" ]; then ver_arg="--version"; fi
  if [ -z "$bpath" ]; then echo "MISSING:$id"; return; fi
  local v
  v=$("$bpath" $ver_arg 2>&1 | grep -oE '[0-9]+[.][0-9]+[.0-9]*' | head -1)
  if [ -z "$v" ]; then v="?"; fi
  echo "TOOL:$id:$bpath:$v"
}

if [ -n "$NVM_ACTIVE" ] && [ -x "$HOME/.nvm/versions/node/$NVM_ACTIVE/bin/node" ]; then
  NODE_P="$HOME/.nvm/versions/node/$NVM_ACTIVE/bin/node"
else
  NODE_P=$(find_bin node)
fi
emit nodejs "$NODE_P"
emit npm "$(find_bin npm)"
emit bun "$(find_bin bun)"
emit deno "$(find_bin deno)"
emit pm2 "$(find_bin pm2)"
emit pnpm "$(find_bin pnpm)"
emit yarn "$(find_bin yarn)"
emit python3 "$(find_bin python3)"
emit go "$(find_bin go)" "version"
emit cargo "$(find_bin cargo)"
emit nginx "$(find_bin nginx)" "-v"
emit apache2 "$(find_bin apache2)" "-v"
emit certbot "$(find_bin certbot)"
emit git "$(find_bin git)"
emit curl "$(find_bin curl)"
emit wget "$(find_bin wget)"
emit rsync "$(find_bin rsync)"
emit vim "$(find_bin vim)"
emit nvim "$(find_bin nvim)"
emit htop "$(find_bin htop)"
emit tmux "$(find_bin tmux)"
emit screen "$(find_bin screen)"
emit ufw "$(find_bin ufw)"
emit fail2ban-client "$(find_bin fail2ban-client)"
emit jq "$(find_bin jq)"
emit unzip "$(find_bin unzip)"
# Chrome: try google-chrome, google-chrome-stable, chromium-browser, chromium
CHROME_P=$(find_bin google-chrome)
if [ -z "$CHROME_P" ]; then CHROME_P=$(find_bin google-chrome-stable); fi
if [ -z "$CHROME_P" ]; then CHROME_P=$(find_bin chromium-browser); fi
if [ -z "$CHROME_P" ]; then CHROME_P=$(find_bin chromium); fi
emit chrome "$CHROME_P" "--version"
emit wrangler "$(find_bin wrangler)"
systemctl is-active nginx 2>/dev/null || echo "svc_nginx_inactive"
systemctl is-active apache2 2>/dev/null || systemctl is-active httpd 2>/dev/null || echo "svc_apache_inactive"
`;

    const tmpFile = `/tmp/vpsm-extras-${Date.now()}.sh`;
    fs.writeFileSync(tmpFile, script);
    let raw = '';
    try { raw = await run(`bash "${tmpFile}"`, 30000); } finally { try { fs.unlinkSync(tmpFile); } catch {} }
    const lines = raw.split('\n').map((l: string) => l.trim()).filter(Boolean);
    const toolMap: Record<string, { installed: boolean; version: string | null; path: string | null }> = {};
    for (const line of lines) {
      if (line.startsWith('TOOL:')) {
        const parts = line.split(':');
        const id = parts[1]; const binPath = parts[2] || null;
        const version = parts[3] === '?' ? null : (parts[3] || null);
        toolMap[id] = { installed: true, version, path: binPath };
      } else if (line.startsWith('MISSING:')) {
        const id = line.replace('MISSING:', '');
        toolMap[id] = { installed: false, version: null, path: null };
      }
    }

    const nginxRunning = !lines.some(l => l === 'svc_nginx_inactive');
    const apacheRunning = !lines.some(l => l === 'svc_apache_inactive');
    const t = (id: string) => toolMap[id] || { installed: false, version: null, path: null };

    const data = [
      { id: 'nodejs', name: 'Node.js', icon: '🟢', category: 'runtime', description: 'JavaScript runtime built on Chrome V8', canSelectVersion: true, latestVersion: null, updateAvailable: false, ...t('nodejs') },
      { id: 'npm', name: 'npm', icon: '📦', category: 'runtime', description: 'Node package manager', latestVersion: null, updateAvailable: false, ...t('npm') },
      { id: 'bun', name: 'Bun', icon: '🍞', category: 'runtime', description: 'Fast all-in-one JS runtime', latestVersion: null, updateAvailable: false, ...t('bun') },
      { id: 'deno', name: 'Deno', icon: '🦕', category: 'runtime', description: 'Secure JS/TS runtime by Ryan Dahl', latestVersion: null, updateAvailable: false, ...t('deno') },
      { id: 'pm2', name: 'PM2', icon: '⚙️', category: 'runtime', description: 'Production process manager for Node.js', latestVersion: null, updateAvailable: false, ...t('pm2') },
      { id: 'pnpm', name: 'pnpm', icon: '📦', category: 'runtime', description: 'Efficient disk-saving package manager', latestVersion: null, updateAvailable: false, ...t('pnpm') },
      { id: 'yarn', name: 'Yarn', icon: '🧶', category: 'runtime', description: 'Fast, reliable Node package manager', latestVersion: null, updateAvailable: false, ...t('yarn') },
      { id: 'python', name: 'Python', icon: '🐍', category: 'runtime', description: 'High-level programming language', latestVersion: null, updateAvailable: false, ...t('python3') },
      { id: 'go', name: 'Go', icon: '🐹', category: 'runtime', description: 'Google Go programming language', latestVersion: null, updateAvailable: false, ...t('go') },
      { id: 'rust', name: 'Rust / Cargo', icon: '🦀', category: 'runtime', description: 'Systems language with cargo package manager', latestVersion: null, updateAvailable: false, ...t('cargo') },
      { id: 'nginx', name: 'Nginx', icon: '🌿', category: 'server', description: 'High-performance HTTP server & reverse proxy', running: nginxRunning, latestVersion: null, updateAvailable: false, ...t('nginx') },
      { id: 'apache', name: 'Apache', icon: '🪶', category: 'server', description: 'Apache HTTP server', running: apacheRunning, latestVersion: null, updateAvailable: false, ...t('apache2') },
      { id: 'certbot', name: 'Certbot', icon: '🔒', category: 'server', description: "Let's Encrypt SSL certificate client", latestVersion: null, updateAvailable: false, ...t('certbot') },
      { id: 'git', name: 'Git', icon: '📁', category: 'tool', description: 'Distributed version control', latestVersion: null, updateAvailable: false, ...t('git') },
      { id: 'curl', name: 'curl', icon: '🌐', category: 'tool', description: 'HTTP client & transfer tool', latestVersion: null, updateAvailable: false, ...t('curl') },
      { id: 'wget', name: 'wget', icon: '⬇️', category: 'tool', description: 'Non-interactive download utility', latestVersion: null, updateAvailable: false, ...t('wget') },
      { id: 'rsync', name: 'rsync', icon: '🔄', category: 'tool', description: 'Fast incremental file transfer', latestVersion: null, updateAvailable: false, ...t('rsync') },
      { id: 'vim', name: 'Vim', icon: '📝', category: 'tool', description: 'Modal text editor', latestVersion: null, updateAvailable: false, ...t('vim') },
      { id: 'nvim', name: 'Neovim', icon: '✨', category: 'tool', description: 'Hyperextensible Vim-based editor', latestVersion: null, updateAvailable: false, ...t('nvim') },
      { id: 'htop', name: 'htop', icon: '📊', category: 'tool', description: 'Interactive process viewer', latestVersion: null, updateAvailable: false, ...t('htop') },
      { id: 'tmux', name: 'tmux', icon: '🖥️', category: 'tool', description: 'Terminal multiplexer', latestVersion: null, updateAvailable: false, ...t('tmux') },
      { id: 'screen', name: 'screen', icon: '🪟', category: 'tool', description: 'Terminal session manager', latestVersion: null, updateAvailable: false, ...t('screen') },
      { id: 'ufw', name: 'ufw', icon: '🛡️', category: 'tool', description: 'Uncomplicated firewall', latestVersion: null, updateAvailable: false, ...t('ufw') },
      { id: 'fail2ban-client', name: 'fail2ban', icon: '🔐', category: 'tool', description: 'Intrusion prevention system', latestVersion: null, updateAvailable: false, ...t('fail2ban-client') },
      { id: 'jq', name: 'jq', icon: '🔍', category: 'tool', description: 'Lightweight JSON processor', latestVersion: null, updateAvailable: false, ...t('jq') },
      { id: 'unzip', name: 'unzip', icon: '📂', category: 'tool', description: 'ZIP extraction utility', latestVersion: null, updateAvailable: false, ...t('unzip') },
      { id: 'chrome', name: 'Google Chrome', icon: '🌐', category: 'browser', description: 'Google Chrome web browser with headless support', latestVersion: null, updateAvailable: false, ...t('chrome') },
      { id: 'wrangler', name: 'Wrangler', icon: '☁️', category: 'tool', description: 'Cloudflare Workers CLI for deploying to the edge', latestVersion: null, updateAvailable: false, ...t('wrangler') },
    ];
    res.json({ success: true, data });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Install/Update ────────────────────────────────────────────────────────────

// Tools that require npm/node — if npm is missing, install Node.js 24 via nvm first
const NPM_DEPENDENT_LOCAL = new Set(['pm2','pnpm','yarn','npm','wrangler','bun']);

const NVM_ENSURE_NODE24 = `
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" || true
if ! command -v npm >/dev/null 2>&1; then
  echo "==> npm/node not found. Installing Node.js v24 via nvm..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash 2>&1
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install 24 2>&1 && nvm use 24 2>&1 && nvm alias default 24 2>&1
  echo "==> Node.js $(node --version 2>/dev/null) / npm $(npm --version 2>/dev/null) ready"
fi
`;

const INSTALL_CMDS: Record<string, (opts: any) => string> = {
  nodejs: (o) => {
    const v = o?.nodeVersion || '24';
    return `export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" || true; ` +
      `if command -v nvm >/dev/null 2>&1; then nvm install ${v} 2>&1 && nvm use ${v} 2>&1 && nvm alias default ${v} 2>&1; else ` +
      `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash 2>&1 && ` +
      `export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && ` +
      `nvm install ${v} 2>&1 && nvm use ${v} 2>&1 && nvm alias default ${v} 2>&1; fi`;
  },
  npm:    () => `npm install -g npm@latest`,
  bun:    () => `curl -fsSL https://bun.sh/install | bash 2>&1 || npm install -g bun`,
  deno:   () => `curl -fsSL https://deno.land/install.sh | sh`,
  pm2:    () => `npm install -g pm2`,
  pnpm:   () => `npm install -g pnpm`,
  yarn:   () => `npm install -g yarn`,
  python: () => `DEBIAN_FRONTEND=noninteractive apt-get install -y python3 python3-pip`,
  'python-venv': () => `DEBIAN_FRONTEND=noninteractive apt-get install -y python3-venv`,
  go:     () => `DEBIAN_FRONTEND=noninteractive apt-get install -y golang-go`,
  rust:   () => `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y`,
  nginx:  () => `DEBIAN_FRONTEND=noninteractive apt-get install -y nginx && systemctl enable nginx && systemctl start nginx`,
  apache: () => `DEBIAN_FRONTEND=noninteractive apt-get install -y apache2 && systemctl enable apache2 && systemctl start apache2`,
  certbot:() => `DEBIAN_FRONTEND=noninteractive apt-get install -y certbot`,
  git:    () => `DEBIAN_FRONTEND=noninteractive apt-get install -y git`,
  curl:   () => `DEBIAN_FRONTEND=noninteractive apt-get install -y curl`,
  wget:   () => `DEBIAN_FRONTEND=noninteractive apt-get install -y wget`,
  rsync:  () => `DEBIAN_FRONTEND=noninteractive apt-get install -y rsync`,
  vim:    () => `DEBIAN_FRONTEND=noninteractive apt-get install -y vim`,
  nvim:   () => `DEBIAN_FRONTEND=noninteractive apt-get install -y neovim`,
  htop:   () => `DEBIAN_FRONTEND=noninteractive apt-get install -y htop`,
  tmux:   () => `DEBIAN_FRONTEND=noninteractive apt-get install -y tmux`,
  screen: () => `DEBIAN_FRONTEND=noninteractive apt-get install -y screen`,
  ufw:    () => `DEBIAN_FRONTEND=noninteractive apt-get install -y ufw`,
  'fail2ban-client': () => `DEBIAN_FRONTEND=noninteractive apt-get install -y fail2ban`,
  jq:     () => `DEBIAN_FRONTEND=noninteractive apt-get install -y jq`,
  unzip:  () => `DEBIAN_FRONTEND=noninteractive apt-get install -y unzip`,
  chrome: () => `apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y wget gnupg && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" | tee /etc/apt/sources.list.d/google-chrome.list && apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y google-chrome-stable && DEBIAN_FRONTEND=noninteractive apt-get install -y xvfb`,
  wrangler: () => `npm install -g wrangler`,
};

const UPDATE_CMDS: Record<string, string> = {
  nodejs: 'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade nodejs',
  npm:    'npm install -g npm@latest',
  bun:    'bun upgrade 2>&1 || npm install -g bun@latest',
  deno:   'deno upgrade',
  pm2:    'npm install -g pm2@latest',
  pnpm:   'npm install -g pnpm@latest',
  yarn:   'npm install -g yarn@latest',
  python: 'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade python3',
  'python-venv': 'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade python3-venv',
  go:     'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade golang-go',
  nginx:  'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade nginx',
  apache: 'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade apache2',
  certbot:'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade certbot',
  git:    'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade git',
  curl:   'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade curl',
  wget:   'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade wget',
  rsync:  'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade rsync',
  vim:    'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade vim',
  nvim:   'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade neovim',
  htop:   'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade htop',
  tmux:   'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade tmux',
  screen: 'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade screen',
  ufw:    'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade ufw',
  'fail2ban-client': 'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade fail2ban',
  jq:     'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade jq',
  unzip:  'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade unzip',
  chrome: 'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade google-chrome-stable',
  wrangler: 'npm install -g wrangler@latest',
};

// ── Cloudflare credentials (persist to ~/.bashrc + creds file) ────────────────
const CF_CREDS_FILE = path.join(HOME, '.vpsm_cloudflare.json');

router.get('/cloudflare/creds', async (_req, res) => {
  try {
    if (fs.existsSync(CF_CREDS_FILE)) {
      const creds = JSON.parse(fs.readFileSync(CF_CREDS_FILE, 'utf-8'));
      res.json({ success: true, data: creds });
    } else {
      res.json({ success: true, data: { apiToken: '', accountId: '' } });
    }
  } catch { res.json({ success: true, data: { apiToken: '', accountId: '' } }); }
});

router.post('/cloudflare/creds', async (req, res) => {
  const { apiToken = '', accountId = '' } = req.body;
  try {
    fs.writeFileSync(CF_CREDS_FILE, JSON.stringify({ apiToken, accountId }, null, 2));
    // Persist to ~/.bashrc for shell sessions
    const bashrcPath = path.join(HOME, '.bashrc');
    let bashrc = fs.existsSync(bashrcPath) ? fs.readFileSync(bashrcPath, 'utf-8') : '';
    // Remove old managed block
    bashrc = bashrc.replace(/\n# --- Cloudflare \(VPS Manager\) ---[\s\S]*?# --- end Cloudflare ---\n?/g, '');
    if (apiToken) {
      const block = `\n# --- Cloudflare (VPS Manager) ---\nexport CLOUDFLARE_API_TOKEN="${apiToken}"\n${accountId ? `export CLOUDFLARE_ACCOUNT_ID="${accountId}"\n` : ''}# --- end Cloudflare ---\n`;
      bashrc += block;
    }
    fs.writeFileSync(bashrcPath, bashrc);
    // Set for current process so wrangler works immediately
    if (apiToken) process.env.CLOUDFLARE_API_TOKEN = apiToken;
    else delete process.env.CLOUDFLARE_API_TOKEN;
    if (accountId) process.env.CLOUDFLARE_ACCOUNT_ID = accountId;
    else delete process.env.CLOUDFLARE_ACCOUNT_ID;
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/:tool/install', async (req, res) => {
  const { tool } = req.params;
  const cmdFn = INSTALL_CMDS[tool];
  if (!cmdFn) return res.status(400).json({ success: false, error: 'Unknown tool' });
  try {
    const needsAptUpdate = tool.startsWith('python') || ['nginx','apache','certbot','git','curl','wget','rsync','vim','nvim','htop','tmux','screen','ufw','fail2ban-client','jq','unzip','go'].includes(tool);
    const aptPrefix = needsAptUpdate ? 'apt-get update -qq 2>&1\n' : '';
    const nvmPrefix = NPM_DEPENDENT_LOCAL.has(tool) ? NVM_ENSURE_NODE24 : '';
    const fullScript = nvmPrefix + aptPrefix + cmdFn(req.body) + '\n';
    let output: string;
    try {
      const result = await execAsync(fullScript, { timeout: 300000, env: { ...process.env, HOME }, shell: '/bin/bash' });
      output = (result.stdout + result.stderr).trim();
    } catch (e: any) {
      const out = ((e.stdout || '') + (e.stderr || '') + (e.message || '')).trim();
      return res.status(500).json({ success: false, error: 'Installation failed', output: out });
    }
    res.json({ success: true, output });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/:tool/update', async (req, res) => {
  const { tool } = req.params;
  const cmd = UPDATE_CMDS[tool];
  if (!cmd) return res.status(400).json({ success: false, error: 'Unknown tool' });
  try {
    const output = await run(cmd, 180000);
    res.json({ success: true, output });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

// ── System Update ─────────────────────────────────────────────────────────────
router.post('/system-update', async (req, res) => {
  const { action } = req.body as { action?: string };
  let cmd: string;
  if (action === 'upgrade') {
    cmd = 'DEBIAN_FRONTEND=noninteractive apt-get upgrade -y 2>&1';
  } else {
    cmd = 'apt-get update 2>&1';
  }
  try {
    const output = await run(cmd, 300000);
    res.json({ success: true, output });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

// ── User Management ───────────────────────────────────────────────────────────
router.get('/users', async (_req, res) => {
  try {
    const [out, whoamiOut] = await Promise.all([
      run(`getent passwd | awk -F: '($3 >= 1000 && $3 < 65534) || $3 == 0 {print $1"|"$3"|"$4"|"$5"|"$6"|"$7}'`),
      run(`whoami`).catch(() => ''),
    ]);
    const currentUser = whoamiOut.trim();
    const users = out.trim().split('\n').filter(Boolean).map(line => {
      const [username, uid, gid, gecos, home, shell] = line.split('|');
      return { username, uid: parseInt(uid), gid: parseInt(gid), displayName: gecos, home, shell, isCurrent: username === currentUser };
    });
    res.json({ success: true, data: users, currentUser });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
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
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
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
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/users/:username', async (req, res) => {
  const { username } = req.params;
  const safeUser = username.replace(/[^a-z0-9_-]/g, '');
  if (safeUser === 'root') {
    return res.status(403).json({ success: false, error: 'The root user cannot be deleted.' });
  }
  const { keepHome = false } = req.body;
  try {
    const flag = keepHome ? '' : '-r';
    const output = await run(`userdel ${flag} ${safeUser} 2>&1`);
    res.json({ success: true, output });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

export default router;
