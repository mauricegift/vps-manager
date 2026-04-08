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

// ── Install / Uninstall ───────────────────────────────────────────────────────
const installCmds: Record<string, string> = {
  postgresql: 'apt-get install -y postgresql postgresql-contrib 2>&1 && systemctl enable postgresql && systemctl start postgresql 2>&1',
  mysql: 'apt-get install -y mysql-server 2>&1 && systemctl enable mysql && systemctl start mysql 2>&1',
  mongodb: `export DEBIAN_FRONTEND=noninteractive && \
CODENAME=$(lsb_release -cs 2>/dev/null || echo jammy) && \
MV=$([ "$CODENAME" = "noble" ] && echo 8.0 || echo 7.0) && \
curl -fsSL "https://www.mongodb.org/static/pgp/server-$MV.asc" | gpg -o "/usr/share/keyrings/mongodb-server-$MV.gpg" --dearmor 2>&1 && \
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-$MV.gpg ] https://repo.mongodb.org/apt/ubuntu $CODENAME/mongodb-org/$MV multiverse" > /etc/apt/sources.list.d/mongodb-org-$MV.list && \
apt-get update -qq 2>&1 && \
apt-get install -y mongodb-org 2>&1 && \
systemctl enable mongod 2>&1 && systemctl start mongod 2>&1`,
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
    await mysqlRun(`DROP DATABASE IF EXISTS \`${db}\``);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/mariadb/:dbname', async (req, res) => {
  const db = req.params.dbname.replace(/['"`;]/g, '');
  try {
    await mysqlRun(`DROP DATABASE IF EXISTS \`${db}\``);
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

export default router;
