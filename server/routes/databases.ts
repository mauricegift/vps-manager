import { Router } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execAsync = promisify(exec);
const router = Router();

async function run(cmd: string, timeout = 12000): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout, env: { ...process.env, HOME: os.homedir() } });
    return (stdout + stderr).trim();
  } catch (e: any) { return (e.stdout || e.stderr || e.message || '').trim(); }
}

// runScript: safe multi-line bash script runner — uses base64 so newlines are never mangled.
// Use this for any script that has multi-line logic (functions, if/then/fi, case/esac, etc.)
async function runScript(script: string, timeout = 12000): Promise<string> {
  const b64 = Buffer.from(script).toString('base64');
  return run(`echo '${b64}' | base64 -d | bash`, timeout);
}

async function getLocalServerIp(): Promise<string> {
  const routeOut = await run(`ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \\K[\\d.]+'`, 5000);
  if (routeOut && /^\d+\.\d+\.\d+\.\d+$/.test(routeOut.trim())) return routeOut.trim();
  const hnOut = await run(`hostname -I 2>/dev/null | awk '{print $1}'`, 5000);
  if (hnOut && /^\d+\.\d+\.\d+\.\d+$/.test(hnOut.trim())) return hnOut.trim();
  const nets = os.networkInterfaces();
  for (const iface of Object.values(nets)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return '127.0.0.1';
}

const FW_PORT_MAP: Record<string, number> = { postgresql: 5432, mysql: 3306, mongodb: 27017, redis: 6379, mariadb: 3306 };

// ── Helpers ───────────────────────────────────────────────────────────────────
async function checkPort(port: number): Promise<boolean> {
  try {
    const cmds = [
      `ss -tlnp 2>/dev/null | grep ":${port} " | wc -l`,
      `netstat -tlnp 2>/dev/null | grep ":${port} " | wc -l`,
      `lsof -i :${port} 2>/dev/null | tail -n +2 | wc -l`,
    ];
    for (const cmd of cmds) {
      try {
        const { stdout } = await execAsync(cmd);
        if (parseInt(stdout.trim()) > 0) return true;
      } catch {}
    }
    return false;
  } catch { return false; }
}

async function checkInstalled(bins: string[]): Promise<boolean> {
  for (const bin of bins) {
    try {
      await execAsync(`which ${bin} 2>/dev/null || command -v ${bin} 2>/dev/null`);
      return true;
    } catch {}
  }
  return false;
}

// ── Local DB CLI helpers ──────────────────────────────────────────────────────
async function pgRun(sql: string, dbname = 'postgres', opts = '-tAc'): Promise<string> {
  const cmds = [
    `psql -U postgres -d "${dbname}" ${opts} ${JSON.stringify(sql)} 2>/dev/null`,
    `sudo -n -u postgres psql -d "${dbname}" ${opts} ${JSON.stringify(sql)} 2>/dev/null`,
    `psql -h 127.0.0.1 -U postgres -d "${dbname}" ${opts} ${JSON.stringify(sql)} 2>/dev/null`,
  ];
  for (const cmd of cmds) {
    try {
      const { stdout } = await execAsync(cmd, { timeout: 6000 });
      if (stdout.trim()) return stdout;
    } catch {}
  }
  return '';
}

async function mysqlRun(sql: string, dbname = '', opts = '-N'): Promise<string> {
  const dbArg = dbname ? ` "${dbname}"` : '';
  const cmds = [
    `mysql --defaults-file=/etc/mysql/debian.cnf ${opts} -e ${JSON.stringify(sql)}${dbArg} 2>/dev/null`,
    `sudo mysql ${opts} -e ${JSON.stringify(sql)}${dbArg} 2>/dev/null`,
    `mysql -uroot --socket=/var/run/mysqld/mysqld.sock ${opts} -e ${JSON.stringify(sql)}${dbArg} 2>/dev/null`,
    `mysql -uroot -h 127.0.0.1 ${opts} -e ${JSON.stringify(sql)}${dbArg} 2>/dev/null`,
    `mysql -uroot ${opts} -e ${JSON.stringify(sql)}${dbArg} 2>/dev/null`,
  ];
  for (const cmd of cmds) {
    try {
      const { stdout } = await execAsync(cmd, { timeout: 5000 });
      if (stdout.trim()) return stdout;
    } catch {}
  }
  return '';
}

async function mysqlExec(sql: string, dbname = ''): Promise<void> {
  const dbArg = dbname ? ` ${JSON.stringify(dbname)}` : '';
  // Pipe SQL via stdin using base64 to avoid ALL shell quoting / backtick issues.
  // Backticks inside double-quoted shell strings are treated as command substitution —
  // piping via stdin completely bypasses that problem.
  const b64 = Buffer.from(sql).toString('base64');
  const cmds = [
    `printf '%s' '${b64}' | base64 -d | mysql --defaults-file=/etc/mysql/debian.cnf${dbArg} 2>&1`,
    `printf '%s' '${b64}' | base64 -d | sudo mysql${dbArg} 2>&1`,
    `printf '%s' '${b64}' | base64 -d | mysql -uroot --socket=/var/run/mysqld/mysqld.sock${dbArg} 2>&1`,
    `printf '%s' '${b64}' | base64 -d | mysql -uroot -h 127.0.0.1${dbArg} 2>&1`,
    `printf '%s' '${b64}' | base64 -d | mysql -uroot${dbArg} 2>&1`,
  ];
  const errors: string[] = [];
  for (const cmd of cmds) {
    try {
      const { stdout, stderr } = await execAsync(cmd, { timeout: 10000 });
      const out = (stdout + stderr).toLowerCase();
      if (out.includes('access denied') || out.includes('error 1044') || out.includes('error 1227')) {
        errors.push((stdout + stderr).trim());
        continue;
      }
      return;
    } catch (e: any) {
      const msg: string = (e.stdout || e.stderr || e.message || '').toLowerCase();
      if (msg.includes('access denied') || msg.includes('error 1044') || msg.includes('error 1227')) {
        errors.push(e.message || msg);
        continue;
      }
      errors.push(e.message || 'unknown error');
    }
  }
  throw new Error(errors.length ? errors[errors.length - 1] : 'All MySQL auth methods failed');
}

async function mongoshRun(db: string, jsExpr: string): Promise<string> {
  const cmds = [
    `mongosh --quiet "${db}" --eval ${JSON.stringify(jsExpr)} 2>/dev/null`,
    `mongo --quiet "${db}" --eval ${JSON.stringify(jsExpr)} 2>/dev/null`,
  ];
  for (const cmd of cmds) {
    try {
      const { stdout } = await execAsync(cmd, { timeout: 8000 });
      const clean = stdout.trim().split('\n')
        .filter(l => !l.startsWith('MongoNetwork') && !l.includes('DeprecationWarning') && l.trim())
        .join('\n');
      if (clean) return clean;
    } catch {}
  }
  return '';
}

async function redisRun(args: string): Promise<string> {
  const cmds = [
    `redis-cli ${args} 2>/dev/null`,
    `redis-cli -h 127.0.0.1 ${args} 2>/dev/null`,
  ];
  for (const cmd of cmds) {
    try {
      const { stdout } = await execAsync(cmd, { timeout: 4000 });
      if (stdout.trim()) return stdout;
    } catch {}
  }
  return '';
}

// ── Info gathering ────────────────────────────────────────────────────────────
async function getPostgresInfo() {
  const installed = await checkInstalled(['psql', 'postgres', 'postgresql']);
  if (!installed) return { type: 'postgresql', name: 'PostgreSQL', installed: false, running: false, port: 5432 };

  let version: string | null = null;
  try {
    const { stdout } = await execAsync('psql --version 2>/dev/null');
    const m = stdout.match(/(\d+\.\d+[\.\d]*)/); version = m?.[1] || null;
  } catch {}

  try {
    const dbOut = await pgRun('SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname');
    if (!dbOut.trim()) return { type: 'postgresql', name: 'PostgreSQL', installed: true, running: false, port: 5432, version };
    const databases = dbOut.trim().split('\n').map(s => s.trim()).filter(Boolean);
    const cntOut = await pgRun('SELECT count(*)::int FROM pg_stat_activity');
    const connections = parseInt(cntOut.trim()) || 0;
    return { type: 'postgresql', name: 'PostgreSQL', installed: true, running: true, port: 5432, version, databases, connections };
  } catch {
    return { type: 'postgresql', name: 'PostgreSQL', installed: true, running: false, port: 5432, version };
  }
}

async function getMysqlInfo() {
  const installed = await checkInstalled(['mysql', 'mysqld', 'mysqladmin']);
  if (!installed) return { type: 'mysql', name: 'MySQL', installed: false, running: false, port: 3306 };
  let version: string | null = null;
  try { const { stdout } = await execAsync('mysql --version 2>/dev/null'); const m = stdout.match(/(\d+\.\d+[\.\d]*)/); version = m?.[1] || null; } catch {}
  const running = await checkPort(3306);
  if (!running) return { type: 'mysql', name: 'MySQL', installed: true, running: false, port: 3306, version };
  const stdout = await mysqlRun('SHOW DATABASES');
  const databases = stdout.trim().split('\n').filter((d: string) => d && !['information_schema', 'performance_schema', 'mysql', 'sys'].includes(d.trim())).map(d => d.trim());
  return { type: 'mysql', name: 'MySQL', installed: true, running: true, port: 3306, version, databases };
}

async function getMongoInfo() {
  const installed = await checkInstalled(['mongod', 'mongosh', 'mongo']);
  if (!installed) return { type: 'mongodb', name: 'MongoDB', installed: false, running: false, port: 27017 };
  let version: string | null = null;
  try { const { stdout } = await execAsync('mongod --version 2>/dev/null'); const m = stdout.match(/(\d+\.\d+[\.\d]*)/); version = m?.[1] || null; } catch {}
  const running = await checkPort(27017);
  if (!running) return { type: 'mongodb', name: 'MongoDB', installed: true, running: false, port: 27017, version };
  const out = await mongoshRun('admin', 'db.adminCommand({listDatabases:1}).databases.map(d=>d.name).join("\\n")');
  const databases = out.split('\n').filter(d => d && !['admin', 'local', 'config'].includes(d.trim())).map(d => d.trim());
  return { type: 'mongodb', name: 'MongoDB', installed: true, running: true, port: 27017, version, databases };
}

async function getRedisInfo() {
  const installed = await checkInstalled(['redis-server', 'redis-cli']);
  if (!installed) return { type: 'redis', name: 'Redis', installed: false, running: false, port: 6379 };
  let version: string | null = null;
  try { const { stdout } = await execAsync('redis-cli --version 2>/dev/null'); const m = stdout.match(/(\d+\.\d+[\.\d]*)/); version = m?.[1] || null; } catch {}
  const running = await checkPort(6379);
  if (!running) return { type: 'redis', name: 'Redis', installed: true, running: false, port: 6379, version };
  const dbCount = await redisRun('DBSIZE');
  return { type: 'redis', name: 'Redis', installed: true, running: true, port: 6379, version, connections: parseInt(dbCount.trim()) || 0 };
}

async function getMariadbInfo() {
  const installed = await checkInstalled(['mariadb', 'mariadbd', 'mariadb-admin']);
  if (!installed) return { type: 'mariadb', name: 'MariaDB', installed: false, running: false, port: 3306 };
  let version: string | null = null;
  try { const { stdout } = await execAsync('mariadb --version 2>/dev/null || mysql --version 2>/dev/null'); const m = stdout.match(/(\d+\.\d+[\.\d]*)/); version = m?.[1] || null; } catch {}
  const running = await checkPort(3306) || await checkPort(3307);
  if (!running) return { type: 'mariadb', name: 'MariaDB', installed: true, running: false, port: 3306, version };
  const stdout = await mysqlRun('SHOW DATABASES');
  const databases = stdout.trim().split('\n').filter((d: string) => d && !['information_schema', 'performance_schema', 'mysql', 'sys'].includes(d.trim())).map(d => d.trim());
  return { type: 'mariadb', name: 'MariaDB', installed: true, running: true, port: 3306, version, databases };
}

router.get('/', async (_req, res) => {
  try {
    const results = await Promise.allSettled([
      getPostgresInfo(), getMysqlInfo(), getMongoInfo(), getRedisInfo(), getMariadbInfo(),
    ]);
    const data = results
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => (r as PromiseFulfilledResult<any>).value);
    res.json({ success: true, data });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Service control ───────────────────────────────────────────────────────────
const serviceMap: Record<string, string[]> = {
  postgresql: ['postgresql', 'postgresql-14', 'postgresql-15', 'postgresql-16', 'postgresql-17'],
  mysql: ['mysql', 'mysqld'],
  mongodb: ['mongod', 'mongodb'],
  redis: ['redis', 'redis-server'],
  mariadb: ['mariadb', 'mariadb-server'],
};

async function dbAction(type: string, action: string) {
  const services = serviceMap[type] || [type];
  const errors: string[] = [];
  for (const svc of services) {
    try {
      await execAsync(`systemctl ${action} ${svc} 2>&1 || service ${svc} ${action} 2>&1`);
      return;
    } catch (e: any) {
      errors.push(e.message);
    }
  }
  throw new Error(`Service control restricted or not found. Try: sudo systemctl ${action} ${type}`);
}

router.post('/:type/start', async (req, res) => {
  try { await dbAction(req.params.type, 'start'); res.json({ success: true }); }
  catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});
router.post('/:type/stop', async (req, res) => {
  try { await dbAction(req.params.type, 'stop'); res.json({ success: true }); }
  catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});
router.post('/:type/restart', async (req, res) => {
  try { await dbAction(req.params.type, 'restart'); res.json({ success: true }); }
  catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

// ── APT lock helper ───────────────────────────────────────────────────────────
// Prepend to every apt-get call to safely wait for the dpkg lock to be released.
// flock -w 120 waits up to 2 minutes; if still locked after that we forcibly
// remove stale lock files and reconfigure dpkg before proceeding.
const APT_WAIT = [
  `flock -w 120 /var/lib/dpkg/lock-frontend /bin/true 2>/dev/null`,
  `|| (rm -f /var/lib/dpkg/lock /var/lib/dpkg/lock-frontend /var/lib/apt/lists/lock /var/cache/apt/archives/lock 2>/dev/null`,
  `&& dpkg --configure -a 2>/dev/null)`,
  `|| true`,
].join(' ');

const APT_UPDATE = `${APT_WAIT} && DEBIAN_FRONTEND=noninteractive apt-get update -qq 2>&1`;
const APT_INSTALL = (pkgs: string) => `${APT_WAIT} && DEBIAN_FRONTEND=noninteractive apt-get install -y ${pkgs} 2>&1`;
const APT_REMOVE  = (pkgs: string) => `${APT_WAIT} && DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y ${pkgs} 2>&1 && apt-get autoremove -y 2>&1`;

// MongoDB install works across Ubuntu 20/22/24 and Debian 11/12
const MONGO_INSTALL = [
  `systemctl stop mongod mongodb 2>/dev/null; rm -rf /var/lib/mongodb 2>/dev/null; true`,
  `export DEBIAN_FRONTEND=noninteractive`,
  `${APT_WAIT}`,
  `OS_ID=$(. /etc/os-release 2>/dev/null && echo "$ID" || echo ubuntu)`,
  `CODENAME=$(lsb_release -cs 2>/dev/null || (. /etc/os-release && echo "$VERSION_CODENAME") || echo jammy)`,
  `if [ "$OS_ID" = "debian" ]; then`,
  `  MONGO_DIST=debian; MV=7.0`,
  `  case "$CODENAME" in bookworm|trixie) MV=8.0 ;; esac`,
  `else`,
  `  MONGO_DIST=ubuntu; MV=7.0`,
  `  case "$CODENAME" in focal|jammy|noble) MV=8.0 ;; esac`,
  `fi`,
  `curl -fsSL "https://www.mongodb.org/static/pgp/server-$MV.asc" | gpg -o "/usr/share/keyrings/mongodb-server-$MV.gpg" --dearmor 2>&1`,
  `echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-$MV.gpg ] https://repo.mongodb.org/apt/$MONGO_DIST $CODENAME/mongodb-org/$MV multiverse" > /etc/apt/sources.list.d/mongodb-org-$MV.list`,
  `${APT_UPDATE}`,
  `${APT_INSTALL('mongodb-org')}`,
  `systemctl enable mongod 2>&1 && systemctl start mongod 2>&1`,
].join(' && \\\n');

// ── Install / Uninstall ───────────────────────────────────────────────────────
// Purge existing data directories so a fresh install always starts with zero databases
const PURGE_DATA: Record<string, string> = {
  postgresql: `systemctl stop postgresql 2>/dev/null; rm -rf /var/lib/postgresql 2>/dev/null; true`,
  mysql:      `systemctl stop mysql mysqld 2>/dev/null; rm -rf /var/lib/mysql 2>/dev/null; true`,
  mongodb:    `systemctl stop mongod mongodb 2>/dev/null; rm -rf /var/lib/mongodb 2>/dev/null; true`,
  redis:      `systemctl stop redis-server redis 2>/dev/null; rm -rf /var/lib/redis 2>/dev/null; true`,
  mariadb:    `systemctl stop mariadb mysql 2>/dev/null; rm -rf /var/lib/mysql 2>/dev/null; true`,
};

const installCmds: Record<string, string> = {
  postgresql: `${PURGE_DATA.postgresql} && ${APT_INSTALL('postgresql postgresql-contrib')} && systemctl enable postgresql && systemctl start postgresql 2>&1`,
  mysql:      `${PURGE_DATA.mysql} && ${APT_INSTALL('mysql-server')} && systemctl enable mysql && systemctl start mysql 2>&1`,
  mongodb:    MONGO_INSTALL,
  redis:      `${PURGE_DATA.redis} && ${APT_INSTALL('redis-server')} && systemctl enable redis-server && systemctl start redis-server 2>&1`,
  mariadb:    `${PURGE_DATA.mariadb} && ${APT_INSTALL('mariadb-server')} && systemctl enable mariadb && systemctl start mariadb 2>&1`,
};

const uninstallCmds: Record<string, string> = {
  postgresql: `systemctl stop postgresql 2>&1; ${APT_REMOVE('postgresql postgresql-*')}`,
  mysql:      `systemctl stop mysql 2>&1; ${APT_REMOVE('mysql-server mysql-client mysql-common')}`,
  mongodb:    `systemctl stop mongod 2>&1; ${APT_REMOVE('mongodb-org mongodb')}`,
  redis:      `systemctl stop redis-server 2>&1; ${APT_REMOVE('redis-server')}`,
  mariadb:    `systemctl stop mariadb 2>&1; ${APT_REMOVE('mariadb-server mariadb-client')}`,
};

router.post('/:type/install', async (req, res) => {
  const { type } = req.params;
  const cmd = installCmds[type];
  if (!cmd) return res.status(400).json({ success: false, error: 'Unknown database type' });
  try {
    // For non-mongodb types, run apt update first; mongodb cmd already includes update
    const full = type === 'mongodb' ? cmd : `${APT_UPDATE} && ${cmd}`;
    const { stdout, stderr } = await execAsync(full, { timeout: 180000 });
    res.json({ success: true, output: (stdout + stderr).slice(0, 32000) });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message, output: (e.stdout || '') + (e.stderr || '') });
  }
});

router.post('/:type/uninstall', async (req, res) => {
  const cmd = uninstallCmds[req.params.type];
  if (!cmd) return res.status(400).json({ success: false, error: 'Unknown database type' });
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 120000 });
    res.json({ success: true, output: (stdout + stderr).slice(0, 32000) });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message, output: (e.stdout || '') + (e.stderr || '') });
  }
});

// ── Change Password ───────────────────────────────────────────────────────────
router.post('/:type/:dbname/change-password', async (req, res) => {
  const { type, dbname } = req.params;
  const { password } = req.body;
  if (!password) return res.status(400).json({ success: false, error: 'Password is required' });
  const safeUser = dbname.replace(/[^a-zA-Z0-9_]/g, '_');
  const safePwd = password.replace(/'/g, "''");
  const safePwdMongo = password.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  try {
    if (type === 'mongodb') {
      // Create or update a user scoped only to this database
      const script = [
        `db = db.getSiblingDB("${dbname}");`,
        `try { db.updateUser("${safeUser}", { pwd: "${safePwdMongo}" }); }`,
        `catch(e) { db.createUser({ user: "${safeUser}", pwd: "${safePwdMongo}", roles: [{ role: "dbOwner", db: "${dbname}" }] }); }`
      ].join(' ');
      await mongoshRun('admin', script);
    } else if (type === 'mysql' || type === 'mariadb') {
      // Create/update a user tied only to this database (not root)
      // Use base64 to avoid shell backtick/quoting issues
      const sql = [
        `CREATE USER IF NOT EXISTS '${safeUser}'@'localhost' IDENTIFIED BY '${safePwd}';`,
        `ALTER USER '${safeUser}'@'localhost' IDENTIFIED BY '${safePwd}';`,
        `CREATE USER IF NOT EXISTS '${safeUser}'@'%' IDENTIFIED BY '${safePwd}';`,
        `ALTER USER '${safeUser}'@'%' IDENTIFIED BY '${safePwd}';`,
        `GRANT ALL PRIVILEGES ON ${safeUser}.* TO '${safeUser}'@'localhost';`,
        `GRANT ALL PRIVILEGES ON ${safeUser}.* TO '${safeUser}'@'%';`,
        `FLUSH PRIVILEGES;`
      ].join('\n');
      const b64sql = Buffer.from(sql).toString('base64');
      await execAsync(
        `(echo '${b64sql}' | base64 -d | mysql --defaults-file=/etc/mysql/debian.cnf 2>/dev/null` +
        ` || echo '${b64sql}' | base64 -d | sudo mysql 2>/dev/null` +
        ` || echo '${b64sql}' | base64 -d | mysql -uroot 2>/dev/null)`,
        { timeout: 15000 }
      );
    } else if (type === 'postgresql') {
      // Try ALTER first (user exists), fall back to CREATE, then GRANT
      try {
        await execAsync(`su - postgres -c "psql -c \\"ALTER USER ${safeUser} WITH PASSWORD '${safePwd}';\\""`, { timeout: 10000 });
      } catch {
        await execAsync(`su - postgres -c "psql -c \\"CREATE USER ${safeUser} WITH PASSWORD '${safePwd}';\\""`, { timeout: 10000 });
      }
      await execAsync(`su - postgres -c "psql -c \\"GRANT ALL PRIVILEGES ON DATABASE ${dbname} TO ${safeUser};\\""`, { timeout: 10000 });
    } else if (type === 'redis') {
      const safePwdRedis = password.replace(/'/g, "\\'");
      await execAsync(`redis-cli CONFIG SET requirepass '${safePwdRedis}' 2>&1`, { timeout: 10000 });
      // Persist to config file so it survives restarts
      await execAsync(
        `CONF=$(find /etc/redis -name "*.conf" 2>/dev/null | head -1); ` +
        `if [ -n "$CONF" ]; then ` +
        `  grep -q "^requirepass" "$CONF" && sed -i "s/^requirepass.*/requirepass ${safePwdRedis}/" "$CONF" || echo "requirepass ${safePwdRedis}" >> "$CONF"; ` +
        `  grep -q "^protected-mode" "$CONF" && sed -i "s/^protected-mode.*/protected-mode no/" "$CONF" || echo "protected-mode no" >> "$CONF"; ` +
        `fi`, { timeout: 10000 });
    } else {
      return res.status(400).json({ success: false, error: 'Unsupported database type' });
    }
    res.json({ success: true, username: safeUser });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message || 'Failed to change password' });
  }
});

// ── Database browser helpers ──────────────────────────────────────────────────
function parseCSV(text: string): { columns: string[]; rows: string[][] } {
  const lines = text.trim().split('\n').filter(Boolean);
  if (!lines.length) return { columns: [], rows: [] };
  const parseRow = (line: string) => {
    const result: string[] = []; let inQuote = false; let cell = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (inQuote && line[i + 1] === '"') { cell += '"'; i++; } else inQuote = !inQuote; }
      else if (ch === ',' && !inQuote) { result.push(cell); cell = ''; }
      else cell += ch;
    }
    result.push(cell);
    return result;
  };
  return { columns: parseRow(lines[0]), rows: lines.slice(1).filter(Boolean).map(parseRow) };
}

function cleanPgOut(out: string): string {
  return out.trim().split('\n')
    .filter(l => !l.startsWith('psql:') && !l.startsWith('ERROR') && !l.match(/^FATAL|^WARNING/))
    .join('\n');
}
function cleanMysqlOut(out: string): string {
  return out.trim().split('\n')
    .filter(l => l && !l.startsWith('ERROR') && !l.startsWith('mysql:') && !l.startsWith('Warning'))
    .join('\n');
}

// ── PostgreSQL browser ────────────────────────────────────────────────────────
router.get('/postgresql/:dbname/tables', async (req, res) => {
  try {
    const db = req.params.dbname;
    // Simple query against information_schema — works even without ANALYZE
    const sql = `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`;
    const out = await pgRun(sql, db, '-tAc');
    const names = cleanPgOut(out).split('\n').map(l => l.trim()).filter(Boolean);
    // Fetch row estimates separately so a failure doesn't break table listing
    const tables: any[] = [];
    for (const name of names) {
      let rows: number | null = null;
      try {
        const cnt = await pgRun(`SELECT reltuples::bigint FROM pg_class WHERE relname=${JSON.stringify(name)} AND relnamespace='public'::regnamespace`, db, '-tAc');
        const n = parseInt(cleanPgOut(cnt).trim());
        if (!isNaN(n) && n >= 0) rows = n;
      } catch {}
      let size = '—';
      try {
        const sz = await pgRun(`SELECT pg_size_pretty(pg_total_relation_size(${JSON.stringify(name + '::regclass')}))`, db, '-tAc');
        const s = cleanPgOut(sz).trim();
        if (s && !s.startsWith('ERROR')) size = s;
      } catch {}
      tables.push({ name, rows, size });
    }
    res.json({ success: true, data: tables });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/postgresql/:dbname/:table/data', async (req, res) => {
  try {
    const { dbname } = req.params;
    const table = req.params.table.replace(/[^a-zA-Z0-9_]/g, '');
    const offset = parseInt(req.query.offset as string) || 0;
    const cntOut = await pgRun(`SELECT COUNT(*) FROM "${table}"`, dbname, '-tAc');
    const total = parseInt(cleanPgOut(cntOut).trim()) || 0;
    const dataOut = await pgRun(`SELECT * FROM "${table}" LIMIT 50 OFFSET ${offset}`, dbname, '--csv -c');
    const parsed = parseCSV(cleanPgOut(dataOut));
    res.json({ success: true, data: { columns: parsed.columns, rows: parsed.rows, total } });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/postgresql/:dbname/query', async (req, res) => {
  try {
    const { sql } = req.body;
    if (!sql) return res.status(400).json({ success: false, error: 'sql is required' });
    const out = await pgRun(sql, req.params.dbname, '--csv -c');
    const parsed = parseCSV(cleanPgOut(out));
    res.json({ success: true, data: { columns: parsed.columns, rows: parsed.rows, total: parsed.rows.length } });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

// ── MySQL browser ─────────────────────────────────────────────────────────────
router.get('/mysql/:dbname/tables', async (req, res) => {
  try {
    const out = await mysqlRun(`SELECT TABLE_NAME, IFNULL(TABLE_ROWS,0) FROM information_schema.TABLES WHERE TABLE_SCHEMA='${req.params.dbname}' ORDER BY TABLE_NAME`);
    const tables = cleanMysqlOut(out).split('\n').filter(Boolean).map((line: string) => {
      const [name, rows] = line.split('\t');
      return { name: name?.trim(), rows: parseInt(rows) || 0 };
    }).filter((t: any) => t.name);
    res.json({ success: true, data: tables });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/mysql/:dbname/:table/data', async (req, res) => {
  try {
    const offset = parseInt(req.query.offset as string) || 0;
    const { dbname, table } = req.params;
    const safeTable = table.replace(/[^a-zA-Z0-9_]/g, '');
    const cntOut = await mysqlRun(`SELECT COUNT(*) FROM \`${safeTable}\``, dbname);
    const total = parseInt(cleanMysqlOut(cntOut).split('\n').pop() || '0') || 0;
    const dataOut = await mysqlRun(`SELECT * FROM \`${safeTable}\` LIMIT 50 OFFSET ${offset}`, dbname, '-B');
    const lines = cleanMysqlOut(dataOut).split('\n').filter(Boolean);
    const columns = lines[0]?.split('\t') || [];
    const rows = lines.slice(1).map((l: string) => l.split('\t'));
    res.json({ success: true, data: { columns, rows, total } });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/mysql/:dbname/query', async (req, res) => {
  try {
    const { sql } = req.body;
    const out = await mysqlRun(sql, req.params.dbname, '-B');
    const lines = cleanMysqlOut(out).split('\n').filter(Boolean);
    const columns = lines[0]?.split('\t') || [];
    const rows = lines.slice(1).map((l: string) => l.split('\t'));
    res.json({ success: true, data: { columns, rows, total: rows.length } });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

// ── MariaDB browser (MySQL-compatible) ───────────────────────────────────────
router.get('/mariadb/:dbname/tables', async (req, res) => {
  try {
    const out = await mysqlRun(`SELECT TABLE_NAME, IFNULL(TABLE_ROWS,0) FROM information_schema.TABLES WHERE TABLE_SCHEMA='${req.params.dbname}' ORDER BY TABLE_NAME`);
    const tables = cleanMysqlOut(out).split('\n').filter(Boolean).map((line: string) => {
      const [name, rows] = line.split('\t');
      return { name: name?.trim(), rows: parseInt(rows) || 0 };
    }).filter((t: any) => t.name);
    res.json({ success: true, data: tables });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/mariadb/:dbname/:table/data', async (req, res) => {
  try {
    const offset = parseInt(req.query.offset as string) || 0;
    const { dbname, table } = req.params;
    const safeTable = table.replace(/[^a-zA-Z0-9_]/g, '');
    const cntOut = await mysqlRun(`SELECT COUNT(*) FROM \`${safeTable}\``, dbname);
    const total = parseInt(cleanMysqlOut(cntOut).split('\n').pop() || '0') || 0;
    const dataOut = await mysqlRun(`SELECT * FROM \`${safeTable}\` LIMIT 50 OFFSET ${offset}`, dbname, '-B');
    const lines = cleanMysqlOut(dataOut).split('\n').filter(Boolean);
    const columns = lines[0]?.split('\t') || [];
    const rows = lines.slice(1).map((l: string) => l.split('\t'));
    res.json({ success: true, data: { columns, rows, total } });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/mariadb/:dbname/query', async (req, res) => {
  try {
    const { sql } = req.body;
    const out = await mysqlRun(sql, req.params.dbname, '-B');
    const lines = cleanMysqlOut(out).split('\n').filter(Boolean);
    const columns = lines[0]?.split('\t') || [];
    const rows = lines.slice(1).map((l: string) => l.split('\t'));
    res.json({ success: true, data: { columns, rows, total: rows.length } });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

// ── MongoDB browser ───────────────────────────────────────────────────────────
router.get('/mongodb/:dbname/tables', async (req, res) => {
  try {
    const db = req.params.dbname;
    const out = await mongoshRun(db, 'db.getCollectionNames().join("\\n")');
    const names = out.split('\n').map(l => l.trim()).filter(Boolean);
    // Get document counts per collection
    const tables: any[] = [];
    for (const name of names) {
      let rows: number | null = null;
      try {
        const cnt = await mongoshRun(db, `db.getCollection("${name}").estimatedDocumentCount()`);
        const n = parseInt(cnt.trim());
        if (!isNaN(n)) rows = n;
      } catch {}
      tables.push({ name, rows });
    }
    res.json({ success: true, data: tables });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/mongodb/:dbname/:collection/data', async (req, res) => {
  try {
    const { dbname, collection } = req.params;
    const safeColl = collection.replace(/[^a-zA-Z0-9_]/g, '');
    const offset = parseInt(req.query.offset as string) || 0;
    const cntOut = await mongoshRun(dbname, `db.getCollection("${safeColl}").countDocuments()`);
    const total = parseInt(cntOut.trim()) || 0;
    const dataOut = await mongoshRun(dbname, `JSON.stringify(db.getCollection("${safeColl}").find().skip(${offset}).limit(50).toArray())`);
    let columns: string[] = [];
    let rows: any[][] = [];
    try {
      const docs = JSON.parse(dataOut.trim());
      if (docs.length > 0) {
        columns = Object.keys(docs[0]);
        rows = docs.map((d: any) => columns.map(c => typeof d[c] === 'object' ? JSON.stringify(d[c]) : String(d[c] ?? '')));
      }
    } catch { columns = ['raw']; rows = [[dataOut]]; }
    res.json({ success: true, data: { columns, rows, total } });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/mongodb/:dbname/query', async (req, res) => {
  try {
    const { sql: jsExpr } = req.body;
    if (!jsExpr) return res.status(400).json({ success: false, error: 'expression is required' });
    const out = await mongoshRun(req.params.dbname, jsExpr);
    let columns: string[] = ['result'];
    let rows: any[][] = [[out]];
    try {
      const parsed = JSON.parse(out);
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
        columns = Object.keys(parsed[0]);
        rows = parsed.map((d: any) => columns.map(c => typeof d[c] === 'object' ? JSON.stringify(d[c]) : String(d[c] ?? '')));
      }
    } catch {}
    res.json({ success: true, data: { columns, rows, total: rows.length } });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Redis browser ─────────────────────────────────────────────────────────────
router.get('/redis/:dbname/tables', async (req, res) => {
  try {
    // SCAN all keys (safer than KEYS * for production)
    const out = await redisRun('--scan --count 1000');
    const keys = out.trim().split('\n').map(k => k.trim()).filter(Boolean).slice(0, 200);
    // Get types in parallel batches
    const tables: any[] = await Promise.all(keys.map(async name => {
      const typeOut = await redisRun(`TYPE "${name.replace(/"/g, '\\"')}"`);
      return { name, type: typeOut.trim() || 'string' };
    }));
    res.json({ success: true, data: tables.map(t => ({ name: t.name, rows: null, size: t.type })) });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/redis/:dbname/:key/data', async (req, res) => {
  try {
    const key = req.params.key;
    const safeKey = key.replace(/"/g, '\\"');
    const typeOut = await redisRun(`TYPE "${safeKey}"`);
    const keyType = typeOut.trim().toLowerCase();
    let columns: string[] = [];
    let rows: any[][] = [];
    let total = 0;

    if (keyType === 'string') {
      const val = await redisRun(`GET "${safeKey}"`);
      columns = ['key', 'type', 'value'];
      rows = [[key, 'string', val.trim()]];
      total = 1;
    } else if (keyType === 'list') {
      const out = await redisRun(`LRANGE "${safeKey}" 0 49`);
      const items = out.trim().split('\n').filter(Boolean);
      const lenOut = await redisRun(`LLEN "${safeKey}"`);
      columns = ['index', 'value'];
      rows = items.map((v, i) => [String(i), v]);
      total = parseInt(lenOut.trim()) || rows.length;
    } else if (keyType === 'hash') {
      const out = await redisRun(`HGETALL "${safeKey}"`);
      const parts = out.trim().split('\n').filter(Boolean);
      columns = ['field', 'value'];
      rows = [];
      for (let i = 0; i < parts.length - 1; i += 2) {
        rows.push([parts[i], parts[i + 1]]);
      }
      total = rows.length;
    } else if (keyType === 'set') {
      const out = await redisRun(`SMEMBERS "${safeKey}"`);
      const lenOut = await redisRun(`SCARD "${safeKey}"`);
      columns = ['member'];
      rows = out.trim().split('\n').filter(Boolean).map(m => [m]);
      total = parseInt(lenOut.trim()) || rows.length;
    } else if (keyType === 'zset') {
      const out = await redisRun(`ZRANGE "${safeKey}" 0 49 WITHSCORES`);
      const parts = out.trim().split('\n').filter(Boolean);
      const lenOut = await redisRun(`ZCARD "${safeKey}"`);
      columns = ['member', 'score'];
      rows = [];
      for (let i = 0; i < parts.length - 1; i += 2) {
        rows.push([parts[i], parts[i + 1]]);
      }
      total = parseInt(lenOut.trim()) || rows.length;
    } else {
      columns = ['key', 'type'];
      rows = [[key, keyType || 'unknown']];
      total = 1;
    }
    res.json({ success: true, data: { columns, rows, total } });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/redis/:dbname/query', async (req, res) => {
  try {
    const { sql: cmd } = req.body;
    if (!cmd) return res.status(400).json({ success: false, error: 'command is required' });
    const out = await redisRun(cmd);
    res.json({ success: true, data: { columns: ['result'], rows: [[out.trim()]], total: 1 } });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

// ── Create Database ───────────────────────────────────────────────────────────
router.post('/:type/create', async (req, res) => {
  const { type } = req.params;
  const { name, password } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'name required' });
  const safeName = name.replace(/[^a-zA-Z0-9_]/g, '_');
  const safePwd = (password || '').replace(/'/g, "''");
  const safePwdMongo = (password || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  try {
    if (type === 'postgresql') {
      await pgRun(`CREATE DATABASE "${safeName}"`, 'postgres');
      let username = 'postgres';
      if (password) {
        try { await execAsync(`su - postgres -c "psql -c \\"ALTER USER ${safeName} WITH PASSWORD '${safePwd}';\\""`, { timeout: 10000 }); }
        catch { await execAsync(`su - postgres -c "psql -c \\"CREATE USER ${safeName} WITH PASSWORD '${safePwd}';\\""`, { timeout: 10000 }); }
        await execAsync(`su - postgres -c "psql -c \\"GRANT ALL PRIVILEGES ON DATABASE ${safeName} TO ${safeName};\\""`, { timeout: 10000 });
        username = safeName;
      }
      return res.json({ success: true, username });
    }
    if (type === 'mysql' || type === 'mariadb') {
      await mysqlExec(`CREATE DATABASE IF NOT EXISTS \`${safeName}\``);
      if (password) {
        const grantSql = [
          `CREATE USER IF NOT EXISTS '${safeName}'@'%' IDENTIFIED BY '${safePwd}'`,
          `ALTER USER '${safeName}'@'%' IDENTIFIED BY '${safePwd}'`,
          `GRANT ALL PRIVILEGES ON \`${safeName}\`.* TO '${safeName}'@'%'`,
          `FLUSH PRIVILEGES`,
        ];
        for (const stmt of grantSql) {
          try { await mysqlExec(stmt); } catch { /* non-fatal: db still created */ }
        }
      }
      return res.json({ success: true, username: password ? safeName : 'root' });
    }
    if (type === 'mongodb') {
      await mongoshRun('admin', `db.getSiblingDB("${safeName}").createCollection("_init")`);
      let username = '';
      if (password) {
        const script = [
          `db = db.getSiblingDB("${safeName}");`,
          `try { db.updateUser("${safeName}", { pwd: "${safePwdMongo}" }); }`,
          `catch(e) { db.createUser({ user: "${safeName}", pwd: "${safePwdMongo}", roles: [{ role: "dbOwner", db: "${safeName}" }] }); }`
        ].join(' ');
        await mongoshRun('admin', script);
        username = safeName;
      }
      return res.json({ success: true, username });
    }
    res.status(400).json({ success: false, error: 'Unsupported type' });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Delete Database ───────────────────────────────────────────────────────────
router.delete('/postgresql/:dbname', async (req, res) => {
  const db = req.params.dbname.replace(/['"`;]/g, '');
  try {
    await pgRun(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${db}' AND pid <> pg_backend_pid()`, 'postgres');
    await pgRun(`DROP DATABASE IF EXISTS "${db}"`, 'postgres');
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/mysql/:dbname', async (req, res) => {
  const db = req.params.dbname.replace(/['"`;]/g, '');
  try {
    await mysqlExec(`DROP DATABASE IF EXISTS \`${db}\``);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/mariadb/:dbname', async (req, res) => {
  const db = req.params.dbname.replace(/['"`;]/g, '');
  try {
    await mysqlExec(`DROP DATABASE IF EXISTS \`${db}\``);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/mongodb/:dbname', async (req, res) => {
  const db = req.params.dbname.replace(/['"`;]/g, '');
  try {
    await mongoshRun(db, 'db.dropDatabase()');
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Local DB: firewall status ────────────────────────────────────────────────
// Source of truth = /var/lib/vpsm-fw-state.json written by allow/close-external.
// Falls back to actual bind-address check only for types not yet in the state file.
const FW_STATE_FILE = '/var/lib/vpsm-fw-state.json';

async function readFwState(): Promise<Record<string, boolean>> {
  try {
    const raw = await run(`cat ${FW_STATE_FILE} 2>/dev/null || echo '{}'`, 3000);
    return JSON.parse(raw.trim() || '{}');
  } catch { return {}; }
}

async function writeFwState(state: Record<string, boolean>): Promise<void> {
  const json = JSON.stringify(state);
  await run(`echo ${JSON.stringify(json)} > ${FW_STATE_FILE}`, 3000);
}

router.get('/firewall-status', async (_req, res) => {
  try {
    const stored = await readFwState();
    const serverIp = await getLocalServerIp();
    // For types not in state file yet, fall back to bind-address check
    const script = `
check_bind() {
  local port=$1
  ss -tlnp 2>/dev/null | grep ":$port " | grep -qE "\\*:|0\\.0\\.0\\.0:" && echo 1 || echo 0
}
echo "postgresql=$(check_bind 5432)"
echo "mysql=$(check_bind 3306)"
echo "mongodb=$(check_bind 27017)"
echo "redis=$(check_bind 6379)"
echo "mariadb=$(check_bind 3306)"
`.trim();
    const out = await runScript(script, 10000);
    const bindCheck = (t: string) => out.includes(`${t}=1`);
    const dbs = ['postgresql', 'mysql', 'mongodb', 'redis', 'mariadb'];
    const result: Record<string, boolean> = {};
    for (const db of dbs) {
      // Prefer stored state; fall back to live bind check
      result[db] = db in stored ? stored[db] : bindCheck(db);
    }
    res.json({ ...result, serverIp });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Local DB: open external access (UFW + bind 0.0.0.0) ─────────────────────
router.post('/:type/allow-external', async (req, res) => {
  try {
    const { type } = req.params;
    const port = FW_PORT_MAP[type];
    if (!port) return res.status(400).json({ success: false, error: 'Unknown database type' });

    // ── Step 1: Open firewall using iptables (always) + UFW (if active, no comment)
    const fwScript = `
OPENED=0; ALREADY=0
if command -v iptables &>/dev/null; then
  if iptables -C INPUT -p tcp --dport ${port} -j ACCEPT 2>/dev/null; then
    ALREADY=1
  else
    iptables -I INPUT -p tcp --dport ${port} -j ACCEPT 2>/dev/null && OPENED=1
  fi
fi
if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw status 2>/dev/null | grep -q "${port}/tcp" || ufw allow ${port}/tcp 2>/dev/null
fi
if command -v firewall-cmd &>/dev/null && firewall-cmd --state 2>/dev/null | grep -q running; then
  firewall-cmd --permanent --add-port=${port}/tcp 2>/dev/null; firewall-cmd --reload 2>/dev/null
  OPENED=1
fi
[ "$OPENED" = "0" ] && [ "$ALREADY" = "1" ] && OPENED=1
echo "FW_OPENED=$OPENED"
echo "ALREADY=$ALREADY"
`.trim();
    const checkOut = await runScript(fwScript, 15000);
    const fwOpened = checkOut.includes('FW_OPENED=1');
    const alreadyOpen = checkOut.includes('ALREADY=1');

    // ── Step 2: ALWAYS update config files to bind 0.0.0.0 (ensures persistence after service restarts)
    const fixScript = `
case "${type}" in
  postgresql)
    CONF=$(find /etc/postgresql -name postgresql.conf 2>/dev/null | head -1)
    if [ -n "$CONF" ]; then
      sed -i -E "s/^#?[[:space:]]*listen_addresses.*/listen_addresses = '*'/" "$CONF"
      grep -q "^listen_addresses" "$CONF" || echo "listen_addresses = '*'" >> "$CONF"
      HBA=$(find /etc/postgresql -name pg_hba.conf 2>/dev/null | head -1)
      if [ -n "$HBA" ] && ! grep -q "^host.*all.*all.*0\\.0\\.0\\.0/0" "$HBA"; then
        echo "host    all             all             0.0.0.0/0               scram-sha-256" >> "$HBA"
      fi
      systemctl restart postgresql 2>&1 || service postgresql restart 2>&1 || true
      sleep 3
      echo "BIND_FIXED=1"
    fi
    ;;
  mysql|mariadb)
    # Update bind-address in ALL known MySQL/MariaDB CNF locations
    for f in /etc/mysql/mysql.conf.d/mysqld.cnf /etc/mysql/conf.d/mysqld.cnf /etc/mysql/my.cnf /etc/mysql/mariadb.conf.d/50-server.cnf /etc/mariadb/my.cnf; do
      [ -f "$f" ] && sed -i "s/^bind-address.*/bind-address = 0.0.0.0/" "$f" || true
    done
    # Also write a drop-in that always wins (highest sort order)
    mkdir -p /etc/mysql/conf.d 2>/dev/null
    printf '[mysqld]\nbind-address = 0.0.0.0\n' > /etc/mysql/conf.d/99-vpsm-bind.cnf
    systemctl restart mysql 2>/dev/null || systemctl restart mariadb 2>/dev/null || service mysql restart 2>/dev/null || true
    sleep 3
    echo "BIND_FIXED=1"
    ;;
  mongodb)
    CONF=/etc/mongod.conf
    if [ -f "$CONF" ]; then
      grep -q "bindIp" "$CONF" && sed -i "s/bindIp:.*/bindIp: 0.0.0.0/" "$CONF" || sed -i '/^net:/a\\  bindIp: 0.0.0.0' "$CONF"
      # Ensure security.authorization is always enabled
      if grep -q "^security:" "$CONF"; then
        grep -q "authorization:" "$CONF" || sed -i "/^security:/a\\  authorization: enabled" "$CONF"
        sed -i "s/.*authorization:.*/  authorization: enabled/" "$CONF"
      else
        sed -i "s/#security:/security:\\n  authorization: enabled/" "$CONF"
        grep -q "^security:" "$CONF" || printf '\nsecurity:\n  authorization: enabled\n' >> "$CONF"
      fi
      systemctl restart mongod 2>&1 || service mongod restart 2>&1 || true
      sleep 3
      echo "BIND_FIXED=1"
    fi
    ;;
  redis)
    CONF=$(find /etc/redis -name "*.conf" 2>/dev/null | head -1)
    if [ -n "$CONF" ]; then
      sed -i "s/^bind .*/bind 0.0.0.0/" "$CONF"
      systemctl restart redis-server 2>/dev/null || systemctl restart redis 2>/dev/null || true
      sleep 2
      echo "BIND_FIXED=1"
    fi
    ;;
esac
`.trim();
    const fixOut = await runScript(fixScript, 45000);
    const bindFixed = fixOut.includes('BIND_FIXED=1');
    const bindErr = bindFixed ? '' : 'Could not update bind address — set bind 0.0.0.0 manually.';

    // ── Step 3: Rate-limit (max 20 new connections/min per source IP)
    let rateLimited = false;
    const rlScript = `
if command -v iptables &>/dev/null; then
  iptables -C INPUT -p tcp --dport ${port} -m state --state NEW -m recent --set --name VPSM_${type} 2>/dev/null || \
    iptables -I INPUT 1 -p tcp --dport ${port} -m state --state NEW -m recent --set --name VPSM_${type} 2>/dev/null
  iptables -C INPUT -p tcp --dport ${port} -m state --state NEW -m recent --update --seconds 60 --hitcount 20 --name VPSM_${type} -j DROP 2>/dev/null || \
    iptables -I INPUT 2 -p tcp --dport ${port} -m state --state NEW -m recent --update --seconds 60 --hitcount 20 --name VPSM_${type} -j DROP 2>/dev/null
  echo "RL_OK=1"
fi
`.trim();
    const rlOut = await runScript(rlScript, 10000);
    rateLimited = rlOut.includes('RL_OK=1');

    // ── Step 4: Save state to file (source of truth for firewall-status)
    const state = await readFwState();
    state[type] = true;
    await writeFwState(state);

    const serverIp = await getLocalServerIp();
    const warnings: string[] = [];
    if (type === 'redis') warnings.push('Redis has no per-database auth — ensure requirepass is set via Change Password.');
    if (!bindFixed) warnings.push(bindErr);

    res.json({ success: true, port, firewallOpened: fwOpened, alreadyOpen, bindAll: bindFixed, bindFixed, rateLimited, warnings, serverIp });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Local DB: close external access ─────────────────────────────────────────
router.post('/:type/close-external', async (req, res) => {
  try {
    const { type } = req.params;
    const port = FW_PORT_MAP[type];
    if (!port) return res.status(400).json({ success: false, error: 'Unknown database type' });

    const script = `
# 1. Close firewall — remove ALL instances of ACCEPT rules for this port (handles duplicates)
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw delete allow ${port}/tcp 2>&1 || true
  ufw reload 2>/dev/null || true
fi
for i in 1 2 3 4 5 6 7 8; do
  iptables -D INPUT -p tcp --dport ${port} -j ACCEPT 2>/dev/null || break
done
for i in 1 2 3; do
  iptables -D INPUT -p tcp --dport ${port} -m state --state NEW -m recent --set --name VPSM_${type} 2>/dev/null || true
  iptables -D INPUT -p tcp --dport ${port} -m state --state NEW -m recent --update --seconds 60 --hitcount 20 --name VPSM_${type} -j DROP 2>/dev/null || true
done
REMAINING=$(iptables -L INPUT -n 2>/dev/null | grep -c "dpt:${port}" || echo 0)
echo "FW_CLOSED=1 remaining_rules=$REMAINING"

# 2. Revert bind address back to localhost in ALL config files, then restart
case "${type}" in
  postgresql)
    CONF=$(find /etc/postgresql -name postgresql.conf 2>/dev/null | head -1)
    if [ -n "$CONF" ]; then
      sed -i -E "s/^listen_addresses.*/listen_addresses = 'localhost'/" "$CONF"
      HBA=$(find /etc/postgresql -name pg_hba.conf 2>/dev/null | head -1)
      [ -n "$HBA" ] && sed -i "/^host.*all.*all.*0\\.0\\.0\\.0\\/0/d" "$HBA"
      systemctl restart postgresql 2>&1 || service postgresql restart 2>&1 || true
    fi
    ;;
  mysql|mariadb)
    # Revert bind-address in ALL known MySQL/MariaDB CNF locations
    for f in /etc/mysql/mysql.conf.d/mysqld.cnf /etc/mysql/conf.d/mysqld.cnf /etc/mysql/my.cnf /etc/mysql/mariadb.conf.d/50-server.cnf /etc/mariadb/my.cnf; do
      [ -f "$f" ] && sed -i "s/^bind-address.*/bind-address = 127.0.0.1/" "$f" || true
    done
    # Remove the vpsm drop-in override
    rm -f /etc/mysql/conf.d/99-vpsm-bind.cnf 2>/dev/null || true
    systemctl restart mysql 2>/dev/null || systemctl restart mariadb 2>/dev/null || service mysql restart 2>/dev/null || true
    ;;
  mongodb)
    CONF=/etc/mongod.conf
    [ -f "$CONF" ] && sed -i "s/bindIp:.*/bindIp: 127.0.0.1/" "$CONF"
    systemctl restart mongod 2>&1 || true
    ;;
  redis)
    CONF=$(find /etc/redis -name "*.conf" 2>/dev/null | head -1)
    [ -n "$CONF" ] && sed -i "s/^bind .*/bind 127.0.0.1/" "$CONF"
    systemctl restart redis-server 2>/dev/null || systemctl restart redis 2>/dev/null || true
    ;;
esac
echo "DONE"
`.trim();
    const out = await runScript(script, 45000);
    // Save closed state to file (source of truth)
    const state = await readFwState();
    state[type] = false;
    await writeFwState(state);
    res.json({ success: true, port, closed: out.includes('FW_CLOSED=1') || out.includes('DONE') });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

export default router;
