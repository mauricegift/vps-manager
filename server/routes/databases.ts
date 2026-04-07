import { Router } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const router = Router();

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
// Try multiple PG auth methods; errors suppressed. Returns stdout or ''.
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

async function getMysqlInfo() {
  const installed = await checkInstalled(['mysql', 'mysqld', 'mysqladmin']);
  if (!installed) return { type: 'mysql', name: 'MySQL', installed: false, running: false, port: 3306 };
  let version: string | null = null;
  try { const { stdout } = await execAsync('mysql --version 2>/dev/null'); const m = stdout.match(/(\d+\.\d+[\.\d]*)/); version = m?.[1] || null; } catch {}
  const running = await checkPort(3306);
  if (!running) return { type: 'mysql', name: 'MySQL', installed: true, running: false, port: 3306, version };
  const stdout = await mysqlRun('SHOW DATABASES');
  const databases = stdout.trim().split('\n').filter((d: string) => d && !['information_schema', 'performance_schema', 'mysql', 'sys'].includes(d));
  return { type: 'mysql', name: 'MySQL', installed: true, running: true, port: 3306, version, databases };
}

async function getMongoInfo() {
  const installed = await checkInstalled(['mongod', 'mongosh', 'mongo']);
  if (!installed) return { type: 'mongodb', name: 'MongoDB', installed: false, running: false, port: 27017 };
  const running = await checkPort(27017);
  if (!running) return { type: 'mongodb', name: 'MongoDB', installed: true, running: false, port: 27017 };
  const { stdout } = await execAsync(`mongosh --quiet --eval "db.adminCommand({listDatabases:1}).databases.map(d=>d.name).join('\\n')" 2>/dev/null`).catch(() => ({ stdout: '' }));
  const databases = stdout.trim().split('\n').filter((d: string) => d && !['admin', 'local', 'config'].includes(d));
  return { type: 'mongodb', name: 'MongoDB', installed: true, running: true, port: 27017, databases };
}

async function getRedisInfo() {
  const installed = await checkInstalled(['redis-server', 'redis-cli']);
  if (!installed) return { type: 'redis', name: 'Redis', installed: false, running: false, port: 6379 };
  const running = await checkPort(6379);
  if (!running) return { type: 'redis', name: 'Redis', installed: true, running: false, port: 6379 };
  const { stdout } = await execAsync(`redis-cli info server 2>/dev/null | grep redis_version`).catch(() => ({ stdout: '' }));
  const { stdout: dbCount } = await execAsync(`redis-cli dbsize 2>/dev/null`).catch(() => ({ stdout: '0' }));
  return { type: 'redis', name: 'Redis', installed: true, running: true, port: 6379, size: stdout.trim(), connections: parseInt(dbCount.trim()) || 0 };
}

async function getMariadbInfo() {
  const installed = await checkInstalled(['mariadb', 'mariadbd']);
  if (!installed) return { type: 'mariadb', name: 'MariaDB', installed: false, running: false, port: 3307 };
  const running = await checkPort(3307);
  if (!running) return { type: 'mariadb', name: 'MariaDB', installed: true, running: false, port: 3307 };
  return { type: 'mariadb', name: 'MariaDB', installed: true, running: true, port: 3307 };
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

// ── Install / Uninstall ───────────────────────────────────────────────────────
const installCmds: Record<string, string> = {
  postgresql: 'apt-get install -y postgresql postgresql-contrib 2>&1 && systemctl enable postgresql && systemctl start postgresql 2>&1',
  mysql: 'apt-get install -y mysql-server 2>&1 && systemctl enable mysql && systemctl start mysql 2>&1',
  mongodb: 'apt-get install -y mongodb-org 2>&1 || apt-get install -y mongodb 2>&1 && systemctl enable mongod && systemctl start mongod 2>&1',
  redis: 'apt-get install -y redis-server 2>&1 && systemctl enable redis-server && systemctl start redis-server 2>&1',
  mariadb: 'apt-get install -y mariadb-server 2>&1 && systemctl enable mariadb && systemctl start mariadb 2>&1',
};

const uninstallCmds: Record<string, string> = {
  postgresql: 'systemctl stop postgresql 2>&1; apt-get remove --purge -y postgresql postgresql-* 2>&1 && apt-get autoremove -y 2>&1',
  mysql: 'systemctl stop mysql 2>&1; apt-get remove --purge -y mysql-server mysql-client mysql-common 2>&1 && apt-get autoremove -y 2>&1',
  mongodb: 'systemctl stop mongod 2>&1; apt-get remove --purge -y mongodb-org mongodb 2>&1 && apt-get autoremove -y 2>&1',
  redis: 'systemctl stop redis-server 2>&1; apt-get remove --purge -y redis-server 2>&1 && apt-get autoremove -y 2>&1',
  mariadb: 'systemctl stop mariadb 2>&1; apt-get remove --purge -y mariadb-server mariadb-client 2>&1 && apt-get autoremove -y 2>&1',
};

router.post('/:type/install', async (req, res) => {
  const cmd = installCmds[req.params.type];
  if (!cmd) return res.status(400).json({ success: false, error: 'Unknown database type' });
  try {
    const { stdout, stderr } = await execAsync(`apt-get update -qq 2>&1 && ${cmd}`, { timeout: 120000 });
    res.json({ success: true, output: stdout + stderr });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message, output: e.stdout || '' });
  }
});

router.post('/:type/uninstall', async (req, res) => {
  const cmd = uninstallCmds[req.params.type];
  if (!cmd) return res.status(400).json({ success: false, error: 'Unknown database type' });
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 60000 });
    res.json({ success: true, output: stdout + stderr });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message, output: e.stdout || '' });
  }
});

// ── Database browser ──────────────────────────────────────────────────────────
function parseCSV(text: string): { columns: string[]; rows: string[][] } {
  const lines = text.trim().split('\n');
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

router.get('/postgresql/:dbname/tables', async (req, res) => {
  try {
    const db = req.params.dbname;
    const sql = `SELECT t.table_name as name, pg_total_relation_size(quote_ident(t.table_name))::bigint as size_bytes, (SELECT reltuples::bigint FROM pg_class WHERE relname = t.table_name) as est_rows FROM information_schema.tables t WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`;
    const out = await pgRun(sql, db, '--csv -c');
    const parsed = parseCSV(out.trim().split('\n').filter(l => !l.startsWith('psql:') && !l.startsWith('ERROR')).join('\n'));
    res.json({ success: true, data: parsed.rows.map(r => ({
      name: r[0], rows: parseInt(r[2]) >= 0 ? parseInt(r[2]) : null, size: formatBytes(parseInt(r[1]) || 0),
    })) });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/postgresql/:dbname/:table/data', async (req, res) => {
  try {
    const { dbname } = req.params;
    const table = req.params.table.replace(/[^a-zA-Z0-9_]/g, '');
    const offset = parseInt(req.query.offset as string) || 0;
    const cntOut = await pgRun(`SELECT COUNT(*)::int FROM "${table}"`, dbname);
    const total = parseInt(cntOut.trim()) || 0;
    const dataOut = await pgRun(`SELECT * FROM "${table}" LIMIT 50 OFFSET ${offset}`, dbname, '--csv -c');
    const parsed = parseCSV(dataOut.trim().split('\n').filter(l => !l.startsWith('psql:') && !l.startsWith('ERROR')).join('\n'));
    res.json({ success: true, data: { columns: parsed.columns, rows: parsed.rows, total } });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/postgresql/:dbname/query', async (req, res) => {
  try {
    const { sql } = req.body;
    if (!sql) return res.status(400).json({ success: false, error: 'sql is required' });
    const out = await pgRun(sql, req.params.dbname, '--csv -c');
    const parsed = parseCSV(out.trim().split('\n').filter(l => !l.startsWith('psql:') && !l.startsWith('ERROR')).join('\n'));
    res.json({ success: true, data: { columns: parsed.columns, rows: parsed.rows, total: parsed.rows.length } });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/mysql/:dbname/tables', async (req, res) => {
  try {
    const out = await mysqlRun(`SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA='${req.params.dbname}' ORDER BY TABLE_NAME`);
    const tables = out.trim().split('\n').filter(l => l && !l.startsWith('ERROR')).map((line: string) => {
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
    const cntOut = await mysqlRun(`SELECT COUNT(*) FROM \`${table}\``, dbname);
    const total = parseInt(cntOut.trim().split('\n').filter(l => !l.startsWith('ERROR')).pop() || '0') || 0;
    const dataOut = await mysqlRun(`SELECT * FROM \`${table}\` LIMIT 50 OFFSET ${offset}`, dbname, '-B');
    const lines = dataOut.trim().split('\n').filter((l: string) => l && !l.startsWith('ERROR') && !l.startsWith('mysql:'));
    const columns = lines[0]?.split('\t') || [];
    const rows = lines.slice(1).map((l: string) => l.split('\t'));
    res.json({ success: true, data: { columns, rows, total } });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/mysql/:dbname/query', async (req, res) => {
  try {
    const { sql } = req.body;
    const out = await mysqlRun(sql, req.params.dbname, '-B');
    const lines = out.trim().split('\n').filter((l: string) => l && !l.startsWith('ERROR') && !l.startsWith('mysql:'));
    const columns = lines[0]?.split('\t') || [];
    const rows = lines.slice(1).map((l: string) => l.split('\t'));
    res.json({ success: true, data: { columns, rows, total: rows.length } });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export default router;
