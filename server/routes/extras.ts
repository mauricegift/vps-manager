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
# venv: check if python3 venv module is importable
if python3 -c "import venv" >/dev/null 2>&1; then
  emit venv "$(find_bin python3)"
else
  echo "MISSING:venv"
fi
emit ffmpeg "$(find_bin ffmpeg)"
# libuuid-dev: dpkg check (no binary)
if dpkg -s libuuid-dev >/dev/null 2>&1; then
  LUUID_VER=$(dpkg -s libuuid-dev 2>/dev/null | awk '/^Version:/{print $2}' | head -1)
  echo "TOOL:libuuid:/usr/lib/x86_64-linux-gnu/libuuid.so:\${LUUID_VER:-?}"
else
  echo "MISSING:libuuid"
fi
emit cloudflared "$(find_bin cloudflared)"
emit tailscale "$(find_bin tailscale)"
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
      { id: 'venv', name: 'Python venv', icon: '🐍', category: 'tool', description: 'Python virtual environment module (python3-venv)', latestVersion: null, updateAvailable: false, ...t('venv') },
      { id: 'ffmpeg', name: 'FFmpeg', icon: '🎬', category: 'tool', description: 'Multimedia framework for video/audio processing', latestVersion: null, updateAvailable: false, ...t('ffmpeg') },
      { id: 'libuuid', name: 'libuuid-dev', icon: '🔑', category: 'tool', description: 'UUID library dev headers (required for node-canvas)', latestVersion: null, updateAvailable: false, ...t('libuuid') },
      { id: 'cloudflared', name: 'Cloudflare Tunnel', icon: '🌐', category: 'tool', description: 'Cloudflare Tunnel daemon for secure tunneling', latestVersion: null, updateAvailable: false, ...t('cloudflared') },
      { id: 'tailscale', name: 'Tailscale', icon: '🔒', category: 'tool', description: 'Zero-config VPN for secure mesh networking', latestVersion: null, updateAvailable: false, ...t('tailscale') },
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
# Always add active NVM node bin to PATH so npm-global tools are found
_NVM_ACTIVE_NODE=$(ls ~/.nvm/versions/node/ 2>/dev/null | sort -V | tail -1)
[ -n "$_NVM_ACTIVE_NODE" ] && export PATH="$HOME/.nvm/versions/node/$_NVM_ACTIVE_NODE/bin:$PATH"
# Also add npm global bin
_NPM_PREFIX=$(npm config get prefix 2>/dev/null)
[ -n "$_NPM_PREFIX" ] && export PATH="$_NPM_PREFIX/bin:$PATH"
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
  chrome: () =>
    `apt-get update -qq 2>&1 && DEBIAN_FRONTEND=noninteractive apt-get install -y wget gnupg ca-certificates 2>&1 && ` +
    `wget -qO- https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg 2>&1 && ` +
    `echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" | tee /etc/apt/sources.list.d/google-chrome.list 2>&1 && ` +
    `apt-get update -qq 2>&1 && DEBIAN_FRONTEND=noninteractive apt-get install -y google-chrome-stable 2>&1`,
  wrangler: () => `npm install -g wrangler`,
  venv: () => `PY_VER=$(python3 --version 2>/dev/null | grep -oP '\\d+\\.\\d+'); DEBIAN_FRONTEND=noninteractive apt-get install -y python3-venv python3.\${PY_VER}-venv 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y python3-venv 2>&1`,
  ffmpeg: () => `DEBIAN_FRONTEND=noninteractive apt-get install -y ffmpeg`,
  libuuid: () => `DEBIAN_FRONTEND=noninteractive apt-get install -y libuuid-dev uuid-runtime`,
  cloudflared: () =>
    `curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | gpg --dearmor -o /usr/share/keyrings/cloudflare-main.gpg 2>&1 && ` +
    `echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared \$(lsb_release -sc 2>/dev/null || echo focal) main" | tee /etc/apt/sources.list.d/cloudflared.list 2>&1 && ` +
    `apt-get update -qq 2>&1 && DEBIAN_FRONTEND=noninteractive apt-get install -y cloudflared 2>&1`,
  tailscale: () => `curl -fsSL https://tailscale.com/install.sh | sh 2>&1`,
  docker: () =>
    `curl -fsSL https://get.docker.com | sh 2>&1 && systemctl enable docker 2>&1 && systemctl start docker 2>&1`,
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
  venv: 'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade python3-venv',
  ffmpeg: 'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade ffmpeg',
  libuuid: 'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade libuuid-dev',
  cloudflared: 'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade cloudflared',
  tailscale: 'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade tailscale',
};

const UNINSTALL_CMDS: Record<string, string> = {
  nodejs:  'nvm deactivate 2>/dev/null; nvm uninstall node 2>/dev/null || DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y nodejs npm 2>&1 && apt-get autoremove -y 2>&1',
  bun:     'rm -rf ~/.bun && rm -f ~/.local/bin/bun 2>&1',
  deno:    'rm -rf ~/.deno && rm -f ~/.local/bin/deno 2>&1',
  pm2:     `export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" || true; _N=$(ls ~/.nvm/versions/node/ 2>/dev/null | sort -V | tail -1); [ -n "$_N" ] && export PATH="$HOME/.nvm/versions/node/$_N/bin:$PATH"; pm2 kill 2>/dev/null; npm uninstall -g pm2 2>&1`,
  pnpm:    `export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" || true; _N=$(ls ~/.nvm/versions/node/ 2>/dev/null | sort -V | tail -1); [ -n "$_N" ] && export PATH="$HOME/.nvm/versions/node/$_N/bin:$PATH"; npm uninstall -g pnpm 2>&1`,
  yarn:    `export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" || true; _N=$(ls ~/.nvm/versions/node/ 2>/dev/null | sort -V | tail -1); [ -n "$_N" ] && export PATH="$HOME/.nvm/versions/node/$_N/bin:$PATH"; npm uninstall -g yarn 2>&1`,
  python:  'DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y python3 python3-pip python3-venv 2>&1 && apt-get autoremove -y 2>&1',
  go:      'DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y golang-go 2>&1 && apt-get autoremove -y 2>&1',
  rust:    'rustup self uninstall -y 2>&1',
  nginx:   'systemctl stop nginx 2>/dev/null; DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y nginx nginx-common nginx-full 2>&1 && apt-get autoremove -y 2>&1',
  apache:  'systemctl stop apache2 2>/dev/null; DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y apache2 apache2-utils 2>&1 && apt-get autoremove -y 2>&1',
  certbot: 'DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y certbot python3-certbot-nginx 2>&1 && apt-get autoremove -y 2>&1',
  git:     'DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y git 2>&1 && apt-get autoremove -y 2>&1',
  curl:    'DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y curl 2>&1 && apt-get autoremove -y 2>&1',
  wget:    'DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y wget 2>&1 && apt-get autoremove -y 2>&1',
  rsync:   'DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y rsync 2>&1 && apt-get autoremove -y 2>&1',
  vim:     'DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y vim 2>&1 && apt-get autoremove -y 2>&1',
  nvim:    'DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y neovim 2>&1 && apt-get autoremove -y 2>&1',
  htop:    'DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y htop 2>&1 && apt-get autoremove -y 2>&1',
  tmux:    'DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y tmux 2>&1 && apt-get autoremove -y 2>&1',
  screen:  'DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y screen 2>&1 && apt-get autoremove -y 2>&1',
  ufw:     'DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y ufw 2>&1 && apt-get autoremove -y 2>&1',
  'fail2ban-client': 'systemctl stop fail2ban 2>/dev/null; DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y fail2ban 2>&1 && apt-get autoremove -y 2>&1',
  jq:      'DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y jq 2>&1 && apt-get autoremove -y 2>&1',
  unzip:   'DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y unzip 2>&1 && apt-get autoremove -y 2>&1',
  chrome:  'DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y google-chrome-stable 2>&1; rm -f /usr/share/keyrings/google-chrome.gpg /etc/apt/sources.list.d/google-chrome.list 2>/dev/null; apt-get autoremove -y 2>&1',
  wrangler:`export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" || true; _N=$(ls ~/.nvm/versions/node/ 2>/dev/null | sort -V | tail -1); [ -n "$_N" ] && export PATH="$HOME/.nvm/versions/node/$_N/bin:$PATH"; npm uninstall -g wrangler 2>&1`,
  docker:  'systemctl stop docker 2>/dev/null; DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin docker.io docker-compose 2>/dev/null; apt-get autoremove -y 2>&1',
  venv:    `PY_VER=$(python3 --version 2>/dev/null | grep -oP '\\d+\\.\\d+'); DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y python3-venv python3.\${PY_VER}-venv 2>/dev/null; apt-get autoremove -y 2>&1`,
  ffmpeg:  'DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y ffmpeg 2>&1 && apt-get autoremove -y 2>&1',
  libuuid: 'DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y libuuid-dev uuid-runtime 2>&1 && apt-get autoremove -y 2>&1',
  cloudflared: 'systemctl stop cloudflared 2>/dev/null || true; DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y cloudflared 2>&1; rm -f /usr/share/keyrings/cloudflare-main.gpg /etc/apt/sources.list.d/cloudflared.list 2>/dev/null; apt-get autoremove -y 2>&1',
  tailscale:   'systemctl stop tailscaled 2>/dev/null || true; DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y tailscale 2>&1 && apt-get autoremove -y 2>&1',
};

// Post-install binary verification (NVM prefix included for npm-global tools)
const NVM_PATH_PREFIX = `export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" || true; _N=$(ls ~/.nvm/versions/node/ 2>/dev/null | sort -V | tail -1); [ -n "$_N" ] && export PATH="$HOME/.nvm/versions/node/$_N/bin:$PATH"; _P=$(npm config get prefix 2>/dev/null); [ -n "$_P" ] && export PATH="$_P/bin:$PATH"; `;

const VERIFY_CMDS: Record<string, string> = {
  nodejs:  `${NVM_PATH_PREFIX}node --version`,
  npm:     `${NVM_PATH_PREFIX}npm --version`,
  bun:     `bun --version 2>/dev/null || $HOME/.bun/bin/bun --version`,
  deno:    `deno --version 2>/dev/null || $HOME/.deno/bin/deno --version`,
  pm2:     `${NVM_PATH_PREFIX}pm2 --version`,
  pnpm:    `${NVM_PATH_PREFIX}pnpm --version`,
  yarn:    `${NVM_PATH_PREFIX}yarn --version`,
  python:  `python3 --version`,
  go:      `go version 2>/dev/null || /usr/local/go/bin/go version`,
  rust:    `cargo --version 2>/dev/null || $HOME/.cargo/bin/cargo --version`,
  nginx:   `nginx -v 2>/dev/null || which nginx`,
  apache:  `apache2 -v 2>/dev/null || which apache2`,
  certbot: `certbot --version 2>/dev/null || which certbot`,
  git:     `git --version`,
  curl:    `curl --version`,
  wget:    `wget --version`,
  rsync:   `rsync --version`,
  vim:     `vim --version`,
  nvim:    `nvim --version`,
  htop:    `htop --version`,
  tmux:    `tmux -V`,
  screen:  `screen --version`,
  ufw:     `which ufw`,
  'fail2ban-client': `which fail2ban-client`,
  jq:      `jq --version`,
  unzip:   `which unzip`,
  chrome:  `google-chrome --version 2>/dev/null || google-chrome-stable --version 2>/dev/null || chromium-browser --version 2>/dev/null || chromium --version`,
  wrangler:`${NVM_PATH_PREFIX}wrangler --version`,
  docker:  `docker --version`,
  venv:    `python3 -m venv --help >/dev/null 2>&1`,
  ffmpeg:  `ffmpeg -version 2>/dev/null`,
  libuuid: `dpkg -s libuuid-dev 2>/dev/null | grep -q 'Status: install ok'`,
  cloudflared: `cloudflared --version 2>/dev/null || which cloudflared`,
  tailscale:   `tailscale --version 2>/dev/null || which tailscale`,
};

router.post('/:tool/uninstall', async (req, res) => {
  const { tool } = req.params;
  const cmd = UNINSTALL_CMDS[tool];
  if (!cmd) return res.status(400).json({ success: false, error: 'Unknown tool' });
  try {
    let output: string;
    try {
      const result = await execAsync(cmd, { timeout: 300000, env: { ...process.env, HOME }, shell: '/bin/bash' });
      output = (result.stdout + result.stderr).trim();
    } catch (e: any) {
      output = ((e.stdout || '') + (e.stderr || '') + (e.message || '')).trim();
    }
    res.json({ success: true, output });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

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
    bashrc = bashrc.replace(/\n# --- Cloudflare \(VPS Manager\) ---[\s\S]*?# --- end Cloudflare ---\n?/g, '');
    if (apiToken) {
      const block = `\n# --- Cloudflare (VPS Manager) ---\nexport CLOUDFLARE_API_TOKEN="${apiToken}"\n${accountId ? `export CLOUDFLARE_ACCOUNT_ID="${accountId}"\n` : ''}# --- end Cloudflare ---\n`;
      bashrc += block;
    }
    fs.writeFileSync(bashrcPath, bashrc);
    // Write persistent wrangler config so `wrangler` CLI works without env vars
    const wranglerConfigDir = path.join(HOME, '.wrangler', 'config');
    const wranglerConfigFile = path.join(wranglerConfigDir, 'default.toml');
    if (!fs.existsSync(wranglerConfigDir)) fs.mkdirSync(wranglerConfigDir, { recursive: true });
    if (apiToken) {
      const toml = `[default]\napi_token = "${apiToken}"${accountId ? `\naccount_id = "${accountId}"` : ''}\n`;
      fs.writeFileSync(wranglerConfigFile, toml);
    } else if (fs.existsSync(wranglerConfigFile)) {
      fs.unlinkSync(wranglerConfigFile);
    }
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
    const needsAptUpdate = tool.startsWith('python') || ['venv','ffmpeg','libuuid','nginx','apache','certbot','git','curl','wget','rsync','vim','nvim','htop','tmux','screen','ufw','fail2ban-client','jq','unzip','go'].includes(tool);
    const aptPrefix = needsAptUpdate ? 'apt-get update -qq 2>&1\n' : '';
    const nvmPrefix = NPM_DEPENDENT_LOCAL.has(tool) ? NVM_ENSURE_NODE24 : '';
    const fullScript = nvmPrefix + aptPrefix + cmdFn(req.body) + '\n';
    let output = '';
    let execError = false;
    try {
      const result = await execAsync(fullScript, { timeout: 300000, env: { ...process.env, HOME }, shell: '/bin/bash' });
      output = (result.stdout + result.stderr).trim();
    } catch (e: any) {
      output = ((e.stdout || '') + (e.stderr || '') + (e.message || '')).trim();
      execError = true;
    }

    // After running, verify the tool is actually installed (regardless of exit code)
    // This handles cases where the command exits non-zero but the binary is present
    const verifyCmd = VERIFY_CMDS[tool];
    if (verifyCmd) {
      try {
        await execAsync(verifyCmd, { timeout: 15000, env: { ...process.env, HOME }, shell: '/bin/bash' });
        // Binary confirmed — return success even if the exec threw
        return res.json({ success: true, output });
      } catch {
        // Binary not found after install attempt
        if (execError) {
          return res.status(500).json({ success: false, error: 'Installation failed', output });
        }
        // execAsync succeeded but verify failed (PATH issue) — still return success with warning
        return res.json({ success: true, output: output + '\n[Note: binary not immediately found in PATH — it may need a shell restart]' });
      }
    }

    if (execError) {
      return res.status(500).json({ success: false, error: 'Installation failed', output });
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
  const { username, password, shell = '/bin/bash', sudo = false, type = 'regular', homeDir } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, error: 'username and password are required' });
  const safeUser = username.replace(/[^a-z0-9_-]/g, '');
  if (!safeUser) return res.status(400).json({ success: false, error: 'Invalid username' });
  try {
    let cmd: string;
    if (type === 'sub') {
      const subHome = homeDir || `/home/${safeUser}`;
      cmd = `useradd -m -d ${subHome} -s /usr/sbin/nologin ${safeUser} 2>&1 && echo '${safeUser}:${password.replace(/'/g, "'\\''")}' | chpasswd 2>&1`;
      cmd += ` && chmod 750 ${subHome} 2>&1 || true`;
    } else {
      cmd = `useradd -m -s ${shell} ${safeUser} 2>&1 && echo '${safeUser}:${password.replace(/'/g, "'\\''")}' | chpasswd 2>&1`;
      if (sudo) cmd += ` && usermod -aG sudo ${safeUser} 2>&1`;
    }
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

// ── Generic exec ─────────────────────────────────────────────────────────────
router.post('/exec', async (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ success: false, error: 'command required' });
  try {
    const { stdout, stderr } = await execAsync(command, { timeout: 30000, env: { ...process.env, HOME }, shell: '/bin/bash' });
    res.json({ success: true, data: { stdout, stderr } });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message, data: { stdout: e.stdout || '', stderr: e.stderr || '' } });
  }
});

// ── Hostname ──────────────────────────────────────────────────────────────────
router.get('/hostname', async (_req, res) => {
  const h = await run('hostname 2>/dev/null || cat /etc/hostname 2>/dev/null');
  res.json({ success: true, hostname: h.trim() });
});

router.post('/hostname', async (req, res) => {
  const { hostname } = req.body;
  if (!hostname || !/^[a-zA-Z0-9][a-zA-Z0-9\-]{0,62}[a-zA-Z0-9]?$/.test(hostname)) {
    return res.status(400).json({ success: false, error: 'Invalid hostname (use only letters, numbers, hyphens)' });
  }
  try {
    const out = await run(`hostnamectl set-hostname "${hostname}" 2>&1`, 10000);
    res.json({ success: true, output: out, hostname });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Swap Management ───────────────────────────────────────────────────────────
router.get('/swap', async (_req, res) => {
  const [swapInfo, freeInfo] = await Promise.all([
    run('swapon --show 2>/dev/null || echo ""'),
    run('free -h 2>/dev/null'),
  ]);
  res.json({ success: true, swapInfo: swapInfo.trim(), freeInfo: freeInfo.trim() });
});

router.post('/swap', async (req, res) => {
  const sizeGb = parseInt(req.body.sizeGb);
  if (!sizeGb || sizeGb < 1 || sizeGb > 256) return res.status(400).json({ success: false, error: 'Size must be 1–256 GB' });
  const script = `
swapoff /swapfile 2>/dev/null || true
rm -f /swapfile
fallocate -l ${sizeGb}G /swapfile 2>&1 || dd if=/dev/zero of=/swapfile bs=1M count=${sizeGb * 1024} status=progress 2>&1
chmod 600 /swapfile
mkswap /swapfile 2>&1
swapon /swapfile 2>&1
grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
grep -q 'vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
grep -q 'vm.vfs_cache_pressure' /etc/sysctl.conf || echo 'vm.vfs_cache_pressure=50' >> /etc/sysctl.conf
sysctl -p 2>&1
swapon --show 2>&1
echo "=== ${sizeGb}GB swap created and persists across reboots ==="
`;
  try {
    const output = await run(script, 180000);
    res.json({ success: true, output });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/swap', async (_req, res) => {
  const script = `
swapoff /swapfile 2>/dev/null || true
rm -f /swapfile 2>/dev/null || true
sed -i '/swapfile/d' /etc/fstab 2>/dev/null || true
echo "Swap removed"
`;
  try {
    const output = await run(script, 30000);
    res.json({ success: true, output });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

// ── MOTD Management ───────────────────────────────────────────────────────────
router.get('/motd', async (_req, res) => {
  const [motd, custom] = await Promise.all([
    run('cat /etc/motd 2>/dev/null || echo ""'),
    run('cat /etc/update-motd.d/99-custom 2>/dev/null || echo ""'),
  ]);
  res.json({ success: true, motd: motd, custom });
});

router.post('/motd', async (req, res) => {
  const { content = '', mode = 'motd' } = req.body;
  try {
    if (mode === 'motd') {
      fs.writeFileSync('/etc/motd', content);
    } else {
      const file = '/etc/update-motd.d/99-custom';
      fs.writeFileSync(file, content);
      await run(`chmod +x ${file} 2>/dev/null`);
    }
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/motd', async (_req, res) => {
  try {
    fs.writeFileSync('/etc/motd', '');
    await run('chmod -x /etc/update-motd.d/* 2>/dev/null || true');
    await run('rm -f /etc/update-motd.d/99-custom 2>/dev/null || true');
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/app-version', async (_req, res) => {
  try {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const localVersion: string = pkg.version || '0.0.0';

    let remoteVersion: string | null = null;
    try {
      const ghRes = await fetch('https://raw.githubusercontent.com/mauricegift/vps-manager/main/package.json', {
        signal: AbortSignal.timeout(8000),
      });
      if (ghRes.ok) {
        const ghPkg: any = await ghRes.json();
        remoteVersion = ghPkg.version || null;
      }
    } catch { }

    const updateAvailable = remoteVersion ? semverGt(remoteVersion, localVersion) : false;
    res.json({ localVersion, remoteVersion, updateAvailable });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/app-update', async (_req, res) => {
  try {
    const appDir = process.cwd();
    const envPath = path.join(appDir, '.env');

    // Back up .env so git reset --hard doesn't wipe credentials
    let envContent = '';
    if (fs.existsSync(envPath)) envContent = fs.readFileSync(envPath, 'utf8');

    // 1. Pull latest code from GitHub
    const gitOut = await run(
      `cd "${appDir}" && git fetch origin main 2>&1 && git reset --hard origin/main 2>&1`,
      90000
    );

    // Restore .env immediately after git reset
    if (envContent) fs.writeFileSync(envPath, envContent);

    // 2. Install any new/updated dependencies
    const npmOut = await run(`cd "${appDir}" && npm install --prefer-offline 2>&1`, 120000);

    // 3. Rebuild the React frontend (Vite outputs to dist/public/)
    //    Without this step new UI code would NOT be visible after restart
    const buildOut = await run(`cd "${appDir}" && npm run build 2>&1`, 180000);

    // 4. Restart via PM2 so the new backend + frontend are served
    const pm2Out = await run('pm2 restart vps-manager --update-env 2>&1', 20000);

    res.json({ success: true, output: [gitOut, npmOut, buildOut, pm2Out].join('\n---\n') });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
