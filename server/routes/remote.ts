import { Router } from 'express';
import pool from '../db.js';
import { runSSHCommand, runSSHScript, getRemoteSystemInfo, SSHConnection } from '../ssh.js';

const router = Router();

async function getServerConn(id: string): Promise<SSHConnection | null> {
  const r = await pool.query('SELECT * FROM vps_connections WHERE id = $1', [id]);
  if (!r.rows.length) return null;
  const s = r.rows[0];
  return { ip: s.ip, port: s.port, username: s.username, password: s.password || undefined, sshKey: s.ssh_key || undefined };
}

// ── DB auth helpers ───────────────────────────────────────────────────────────
// Returns a shell expression that tries multiple PG auth methods in order.
// All errors go to /dev/null so nothing pollutes stdout.
function pgTry(sqlLiteral: string, dbname = 'postgres', extraOpts = ''): string {
  const q = sqlLiteral; // already a shell-safe quoted SQL arg
  return (
    `(psql -U postgres -d "${dbname}" ${extraOpts} ${q} 2>/dev/null` +
    ` || sudo -n -u postgres psql -d "${dbname}" ${extraOpts} ${q} 2>/dev/null` +
    ` || psql -h 127.0.0.1 -U postgres -d "${dbname}" ${extraOpts} ${q} 2>/dev/null)`
  );
}

// Returns a shell expression that tries multiple MySQL auth methods in order.
function mysqlTry(sqlLiteral: string, dbname = '', extraOpts = '-N'): string {
  const dbArg = dbname ? ` "${dbname}"` : '';
  return (
    `(mysql --defaults-file=/etc/mysql/debian.cnf ${extraOpts} -e ${sqlLiteral}${dbArg} 2>/dev/null` +
    ` || sudo mysql ${extraOpts} -e ${sqlLiteral}${dbArg} 2>/dev/null` +
    ` || mysql -uroot ${extraOpts} -e ${sqlLiteral}${dbArg} 2>/dev/null)`
  );
}

// ── System Info ───────────────────────────────────────────────────────────────
router.get('/:id/system', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: 'Server not found' });
    const data = await getRemoteSystemInfo(conn);
    res.json({ success: true, data });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── PM2 Processes ─────────────────────────────────────────────────────────────
router.get('/:id/pm2', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: 'Server not found' });
    const { stdout } = await runSSHCommand(conn, 'pm2 jlist --no-color 2>/dev/null || echo "[]"');
    let processes = [];
    try { processes = JSON.parse(stdout.trim() || '[]'); } catch { processes = []; }
    const data = processes.map((p: any) => ({
      pid: p.pid, name: p.name, pm_id: p.pm_id,
      status: p.pm2_env?.status || 'unknown',
      cpu: p.monit?.cpu || 0, memory: p.monit?.memory || 0,
      uptime: p.pm2_env?.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : 0,
      restarts: p.pm2_env?.restart_time || 0,
      pm_exec_path: p.pm2_env?.pm_exec_path || '',
    }));
    res.json({ success: true, data });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── PM2 Action ───────────────────────────────────────────────────────────────
router.post('/:id/pm2/:procId/:action', async (req, res) => {
  const { action, procId } = req.params;
  const allowed = ['start', 'stop', 'restart', 'delete', 'reload'];
  if (!allowed.includes(action)) return res.status(400).json({ success: false, error: 'Invalid action' });
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: 'Server not found' });
    await runSSHCommand(conn, `pm2 ${action} ${procId} --no-color 2>&1 && pm2 save --no-color 2>&1`);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── PM2 Logs ─────────────────────────────────────────────────────────────────
router.get('/:id/pm2/:procId/logs', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: 'Server not found' });
    const { stdout } = await runSSHCommand(conn, `pm2 logs ${req.params.procId} --lines 150 --nostream --no-color 2>&1`);
    res.json({ success: true, data: stdout });
  } catch (e: any) {
    res.json({ success: true, data: e.message });
  }
});

// ── PM2 Terminal ─────────────────────────────────────────────────────────────
const ALLOWED_PM2 = ['list','ls','status','monit','info','describe','logs','flush','save','restart','stop','start','delete','env','version','ping','reload','reset'];
router.post('/:id/pm2/terminal', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: 'Server not found' });
    const { command } = req.body;
    const args = (command || '').trim().replace(/^pm2\s+/i, '').trim();
    const first = args.split(/\s+/)[0].toLowerCase();
    if (!ALLOWED_PM2.includes(first)) return res.status(400).json({ success: false, error: `Not allowed: ${first}` });
    const { stdout, stderr } = await runSSHCommand(conn, `pm2 ${args} --no-color 2>&1`);
    res.json({ success: true, data: stdout || stderr || '(no output)' });
  } catch (e: any) {
    res.json({ success: true, data: e.message });
  }
});

// ── File Listing ──────────────────────────────────────────────────────────────
router.get('/:id/files', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: 'Server not found' });
    const dir = (req.query.path as string) || '/';
    const script = `ls -la --time-style=+%Y-%m-%dT%H:%M:%S ${JSON.stringify(dir)} 2>&1`;
    const { stdout, code } = await runSSHCommand(conn, script);
    if (code !== 0) return res.status(400).json({ success: false, error: stdout.trim() });

    const lines = stdout.split('\n').filter(Boolean);
    const files = [];
    for (const line of lines) {
      if (line.startsWith('total') || line.startsWith('d.') || line.startsWith('l.') || line.startsWith('-.')) {
        // parse ls -la output
      }
      const m = line.match(/^([dlrwx\-]{10})\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\S+)\s+(.+)$/);
      if (!m) continue;
      const [, perms, size, mtime, name] = m;
      if (name === '.' || name === '..') continue;
      const isDir = perms[0] === 'd';
      const fullPath = dir === '/' ? `/${name}` : `${dir}/${name}`;
      files.push({ name, path: fullPath, type: isDir ? 'directory' : 'file', size: parseInt(size) || 0, modified: mtime, permissions: perms.slice(1) });
    }
    res.json({ success: true, data: files });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── File Read ─────────────────────────────────────────────────────────────────
router.get('/:id/files/read', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: 'Server not found' });
    const filePath = req.query.path as string;
    const { stdout } = await runSSHCommand(conn, `wc -c < ${JSON.stringify(filePath)} 2>/dev/null`);
    const bytes = parseInt(stdout.trim()) || 0;
    if (bytes > 2 * 1024 * 1024) return res.status(413).json({ success: false, error: 'File too large (>2MB)' });
    const { stdout: content, stderr, code: rc } = await runSSHCommand(conn, `cat ${JSON.stringify(filePath)} 2>&1`);
    if (rc !== 0) return res.status(400).json({ success: false, error: stderr || content });
    res.json({ success: true, data: content });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── File Save ─────────────────────────────────────────────────────────────────
router.post('/:id/files/save', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: 'Server not found' });
    const { path: filePath, content } = req.body;
    const escaped = (content || '').replace(/'/g, "'\"'\"'");
    await runSSHCommand(conn, `printf '%s' '${escaped}' > ${JSON.stringify(filePath)}`);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Mkdir ─────────────────────────────────────────────────────────────────────
router.post('/:id/files/mkdir', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: 'Server not found' });
    await runSSHCommand(conn, `mkdir -p ${JSON.stringify(req.body.path)}`);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Delete ────────────────────────────────────────────────────────────────────
router.delete('/:id/files', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: 'Server not found' });
    await runSSHCommand(conn, `rm -rf ${JSON.stringify(req.body.path)}`);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Exec (terminal) ───────────────────────────────────────────────────────────
router.post('/:id/exec', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: 'Server not found' });
    const { command } = req.body;
    if (!command) return res.status(400).json({ success: false, error: 'command required' });
    const { stdout, stderr } = await runSSHCommand(conn, command);
    res.json({ success: true, data: { stdout, stderr } });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Databases list ─────────────────────────────────────────────────────────────
router.get('/:id/databases', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: 'Server not found' });

    const script = `
which psql 2>/dev/null && echo "PG_INST=1" || echo "PG_INST=0"
which mysql 2>/dev/null && echo "MYSQL_INST=1" || echo "MYSQL_INST=0"
which mongod 2>/dev/null || which mongosh 2>/dev/null && echo "MONGO_INST=1" || echo "MONGO_INST=0"
which redis-cli 2>/dev/null && echo "REDIS_INST=1" || echo "REDIS_INST=0"
which sqlite3 2>/dev/null && echo "SQLITE_INST=1" || echo "SQLITE_INST=0"
ss -tlnp 2>/dev/null | grep -E ":(5432|3306|27017|6379) " || true
pg_isready -q 2>/dev/null && echo "PG_RUN=1" || echo "PG_RUN=0"
mysql --connect-timeout=2 -e "SELECT 1;" 2>/dev/null && echo "MYSQL_RUN=1" || echo "MYSQL_RUN=0"
redis-cli ping 2>/dev/null | grep -q PONG && echo "REDIS_RUN=1" || echo "REDIS_RUN=0"
`.trim();

    const raw = await runSSHScript(conn, script);
    const has = (s: string) => raw.includes(s);

    const pgInst = has('PG_INST=1');
    const mysqlInst = has('MYSQL_INST=1');
    const mongoInst = has('MONGO_INST=1');
    const redisInst = has('REDIS_INST=1');
    const sqliteInst = has('SQLITE_INST=1');

    const pgRun = has('PG_RUN=1') || has(':5432');
    const mysqlRun = has('MYSQL_RUN=1') || has(':3306');
    const mongoRun = has(':27017');
    const redisRun = has('REDIS_RUN=1') || has(':6379');

    // Get DB names if running
    let pgDbs: string[] = [];
    let mysqlDbs: string[] = [];
    let mongoDbs: string[] = [];

    if (pgRun) {
      try {
        const cmd = pgTry(`-tAc "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname"`);
        const { stdout } = await runSSHCommand(conn, cmd);
        pgDbs = stdout.trim().split('\n').filter(l => l && !l.startsWith('psql:') && !l.startsWith('ERROR') && !l.startsWith('FATAL'));
      } catch {}
    }
    if (mysqlRun) {
      try {
        const cmd = mysqlTry(`"SHOW DATABASES"`) + ` | grep -v 'information_schema\\|performance_schema\\|mysql\\|sys'`;
        const { stdout } = await runSSHCommand(conn, cmd);
        mysqlDbs = stdout.trim().split('\n').filter(l => l && !l.startsWith('ERROR') && !l.startsWith('mysql:'));
      } catch {}
    }
    if (mongoRun) {
      try {
        const { stdout } = await runSSHCommand(conn, `mongosh --quiet --eval "db.adminCommand({listDatabases:1}).databases.map(d=>d.name).join('\\n')" 2>&1 | grep -v '^[[:space:]]*$'`);
        mongoDbs = stdout.trim().split('\n').filter(l => !l.startsWith('MongoNetwork') && Boolean(l.trim()));
      } catch {}
    }

    const data = [
      { type: 'postgresql', name: 'PostgreSQL', installed: pgInst, running: pgRun, port: 5432, databases: pgInst ? pgDbs : undefined },
      { type: 'mysql', name: 'MySQL', installed: mysqlInst, running: mysqlRun, port: 3306, databases: mysqlInst ? mysqlDbs : undefined },
      { type: 'mongodb', name: 'MongoDB', installed: mongoInst, running: mongoRun, port: 27017, databases: mongoInst ? mongoDbs : undefined },
      { type: 'redis', name: 'Redis', installed: redisInst, running: redisRun, port: 6379 },
      { type: 'sqlite', name: 'SQLite', installed: sqliteInst, running: sqliteInst, port: 0 },
    ];
    res.json({ success: true, data });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Remote DB: list tables ────────────────────────────────────────────────────
router.get('/:id/databases/:type/:dbName/tables', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: 'Server not found' });
    const { type, dbName } = req.params;
    const db = decodeURIComponent(dbName);
    let tables: { name: string; rows?: number }[] = [];

    if (type === 'postgresql') {
      // Simple query — works even without ANALYZE/statistics collected
      const { stdout } = await runSSHCommand(conn,
        pgTry(`-tAc "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name"`, db)
      );
      tables = stdout.trim().split('\n')
        .filter(l => l && !l.startsWith('psql:') && !l.startsWith('ERROR') && !l.match(/^FATAL|^WARNING/))
        .map(l => ({ name: l.trim() }))
        .filter(t => t.name);
    } else if (type === 'mysql' || type === 'mariadb') {
      const { stdout } = await runSSHCommand(conn,
        mysqlTry(`"SELECT TABLE_NAME, IFNULL(TABLE_ROWS,0) FROM information_schema.TABLES WHERE TABLE_SCHEMA='${db}' ORDER BY TABLE_NAME"`)
      );
      tables = stdout.trim().split('\n').filter(l => l && !l.startsWith('ERROR') && !l.startsWith('mysql:') && !l.startsWith('Warning')).map(l => {
        const parts = l.split('\t');
        return { name: parts[0]?.trim(), rows: parseInt(parts[1]) || 0 };
      }).filter(t => t.name);
    } else if (type === 'mongodb') {
      const { stdout } = await runSSHCommand(conn,
        `mongosh --quiet ${JSON.stringify(db)} --eval "db.getCollectionNames().join('\\n')" 2>/dev/null`
      );
      tables = stdout.trim().split('\n')
        .filter(l => l.trim() && !l.startsWith('MongoNetwork') && !l.includes('DeprecationWarning') && !/^[A-Z].*Error/.test(l))
        .map(name => ({ name: name.trim() }))
        .filter(t => t.name);
    } else if (type === 'redis') {
      const { stdout } = await runSSHCommand(conn, `redis-cli --scan --count 1000 2>/dev/null | head -200`);
      tables = stdout.trim().split('\n').filter(Boolean).map(name => ({ name: name.trim() }));
    } else if (type === 'sqlite') {
      const { stdout } = await runSSHCommand(conn,
        `find / -name "*.db" -o -name "*.sqlite" -o -name "*.sqlite3" 2>/dev/null | head -20`
      );
      tables = stdout.trim().split('\n').filter(Boolean).map(name => ({ name: name.trim() }));
    }

    res.json({ success: true, data: tables });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// helper: simple CSV parser
function parseCSV(text: string): { columns: string[]; rows: string[][] } {
  const lines = text.trim().split('\n');
  if (!lines.length) return { columns: [], rows: [] };
  const parseRow = (line: string) => {
    const result: string[] = [];
    let inQuote = false;
    let cell = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cell += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) { result.push(cell); cell = ''; }
      else cell += ch;
    }
    result.push(cell);
    return result;
  };
  return { columns: parseRow(lines[0]), rows: lines.slice(1).filter(Boolean).map(parseRow) };
}

// ── Remote DB: table data ─────────────────────────────────────────────────────
router.get('/:id/databases/:type/:dbName/:table/data', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: 'Server not found' });
    const { type, dbName, table } = req.params;
    const db = decodeURIComponent(dbName);
    const tbl = decodeURIComponent(table);
    const offset = parseInt(req.query.offset as string) || 0;
    let columns: string[] = [];
    let rows: any[][] = [];
    let total = 0;

    if (type === 'postgresql') {
      const { stdout } = await runSSHCommand(conn,
        pgTry(`--csv -c "SELECT * FROM \\"${tbl}\\" LIMIT 50 OFFSET ${offset}"`, db)
      );
      const cleanOut = stdout.trim().split('\n').filter(l => !l.startsWith('psql:') && !l.startsWith('ERROR')).join('\n');
      const parsed = parseCSV(cleanOut);
      columns = parsed.columns;
      rows = parsed.rows;
      const { stdout: cnt } = await runSSHCommand(conn,
        pgTry(`-tAc "SELECT COUNT(*) FROM \\"${tbl}\\""`, db)
      );
      total = parseInt(cnt.trim()) || rows.length;
    } else if (type === 'mysql') {
      const { stdout } = await runSSHCommand(conn,
        mysqlTry(`"SELECT * FROM \\\`${tbl}\\\` LIMIT 50 OFFSET ${offset}"`, db, '-B')
      );
      const lines = stdout.trim().split('\n').filter(l => l && !l.startsWith('ERROR') && !l.startsWith('mysql:'));
      if (lines.length > 0) {
        columns = lines[0].split('\t');
        rows = lines.slice(1).map(l => l.split('\t'));
      }
      const { stdout: cnt } = await runSSHCommand(conn,
        mysqlTry(`"SELECT COUNT(*) FROM \\\`${tbl}\\\`"`, db)
      );
      total = parseInt(cnt.trim()) || rows.length;
    } else if (type === 'mongodb') {
      const { stdout } = await runSSHCommand(conn,
        `mongosh --quiet ${JSON.stringify(db)} --eval "JSON.stringify(db.${tbl}.find().skip(${offset}).limit(50).toArray())" 2>&1`
      );
      try {
        const docs = JSON.parse(stdout.trim());
        if (docs.length > 0) {
          columns = Object.keys(docs[0]);
          rows = docs.map((d: any) => columns.map(c => JSON.stringify(d[c])));
        }
        const { stdout: cnt } = await runSSHCommand(conn,
          `mongosh --quiet ${JSON.stringify(db)} --eval "db.${tbl}.countDocuments()" 2>&1`
        );
        total = parseInt(cnt.trim()) || docs.length;
      } catch { columns = ['error']; rows = [[stdout]]; }
    } else if (type === 'redis') {
      const { stdout: typeOut } = await runSSHCommand(conn, `redis-cli TYPE "${tbl}" 2>&1`);
      const keyType = typeOut.trim();
      let value = '';
      if (keyType === 'string') {
        const { stdout } = await runSSHCommand(conn, `redis-cli GET "${tbl}" 2>&1`);
        value = stdout.trim();
      } else if (keyType === 'list') {
        const { stdout } = await runSSHCommand(conn, `redis-cli LRANGE "${tbl}" 0 49 2>&1`);
        const items = stdout.trim().split('\n');
        columns = ['index', 'value'];
        rows = items.map((v, i) => [String(i), v]);
        total = rows.length;
      } else if (keyType === 'hash') {
        const { stdout } = await runSSHCommand(conn, `redis-cli HGETALL "${tbl}" 2>&1`);
        const parts = stdout.trim().split('\n');
        columns = ['field', 'value'];
        rows = [];
        for (let i = 0; i < parts.length; i += 2) {
          if (parts[i] && parts[i + 1]) rows.push([parts[i], parts[i + 1]]);
        }
        total = rows.length;
      } else if (keyType === 'set') {
        const { stdout } = await runSSHCommand(conn, `redis-cli SMEMBERS "${tbl}" 2>&1`);
        columns = ['member'];
        rows = stdout.trim().split('\n').map(m => [m]);
        total = rows.length;
      }
      if (keyType === 'string') {
        columns = ['key', 'type', 'value'];
        rows = [[tbl, keyType, value]];
        total = 1;
      }
    }

    res.json({ success: true, data: { columns, rows, total } });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Remote DB: run query ──────────────────────────────────────────────────────
router.post('/:id/databases/:type/:dbName/query', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: 'Server not found' });
    const { type, dbName } = req.params;
    const db = decodeURIComponent(dbName);
    const { sql } = req.body;
    if (!sql) return res.status(400).json({ success: false, error: 'sql required' });

    let columns: string[] = [];
    let rows: any[][] = [];

    if (type === 'postgresql') {
      const safe = sql.replace(/'/g, "''");
      const { stdout } = await runSSHCommand(conn,
        pgTry(`--csv -c '${safe}'`, db)
      );
      const cleanOut = stdout.trim().split('\n').filter(l => !l.startsWith('psql:') && !l.startsWith('ERROR')).join('\n');
      const parsed = parseCSV(cleanOut);
      columns = parsed.columns;
      rows = parsed.rows;
    } else if (type === 'mysql') {
      const safe = sql.replace(/"/g, '\\"');
      const { stdout } = await runSSHCommand(conn,
        mysqlTry(`"${safe}"`, db, '-B')
      );
      const lines = stdout.trim().split('\n').filter(l => l && !l.startsWith('ERROR') && !l.startsWith('mysql:'));
      if (lines.length > 0) {
        columns = lines[0].split('\t');
        rows = lines.slice(1).map(l => l.split('\t'));
      }
    } else if (type === 'mongodb') {
      const safe = sql.replace(/'/g, "\\'");
      const { stdout } = await runSSHCommand(conn,
        `mongosh --quiet ${JSON.stringify(db)} --eval '${safe}' 2>&1`
      );
      columns = ['result'];
      rows = [[stdout.trim()]];
    } else if (type === 'redis') {
      const { stdout } = await runSSHCommand(conn, `redis-cli ${sql} 2>&1`);
      columns = ['result'];
      rows = [[stdout.trim()]];
    }

    res.json({ success: true, data: { columns, rows, total: rows.length } });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Remote Extras: software status ───────────────────────────────────────────
router.get('/:id/extras', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: 'Server not found' });

    const script = `
which node 2>/dev/null && node --version 2>/dev/null || echo "NODE_MISSING"
which bun 2>/dev/null && bun --version 2>/dev/null || echo "BUN_MISSING"
which pm2 2>/dev/null && pm2 --version 2>/dev/null || echo "PM2_MISSING"
which python3 2>/dev/null && python3 --version 2>/dev/null || echo "PYTHON_MISSING"
python3 -m venv --help 2>/dev/null | head -1 || echo "VENV_MISSING"
which certbot 2>/dev/null && certbot --version 2>/dev/null || echo "CERTBOT_MISSING"
which nginx 2>/dev/null && nginx -v 2>&1 || echo "NGINX_MISSING"
which apache2 2>/dev/null && apache2 -v 2>&1 | head -1 || which httpd 2>/dev/null && httpd -v 2>&1 | head -1 || echo "APACHE_MISSING"
npm view pm2 version 2>/dev/null || echo "PM2_LATEST_UNKNOWN"
npm view bun version 2>/dev/null || echo "BUN_LATEST_UNKNOWN"
systemctl is-active nginx 2>/dev/null || echo "nginx_inactive"
systemctl is-active apache2 2>/dev/null || systemctl is-active httpd 2>/dev/null || echo "apache_inactive"
`.trim();
    const raw = await runSSHScript(conn, script);
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

    const extract = (missing: string, searchStr: string): { installed: boolean; version: string | null } => {
      const missingLine = lines.find(l => l === missing);
      if (missingLine) return { installed: false, version: null };
      const line = lines.find(l => l.toLowerCase().includes(searchStr.toLowerCase()) && !l.includes('MISSING'));
      const m = line?.match(/(\d+\.\d+[\.\d]*)/);
      return { installed: true, version: m?.[1] || line?.trim() || null };
    };

    const getLine = (idx: number) => lines[idx] || '';
    const pm2Latest = lines.find(l => /^\d+\.\d+/.test(l) && !lines.slice(0, 8).includes(l)) || null;
    const nginxActive = raw.includes('\nactive') || raw.includes('\nactive\n');
    const apacheActive = raw.split('\n').filter(l => l.trim() === 'active').length > 0;

    const tools = [
      { id: 'nodejs', name: 'Node.js', icon: '🟢', description: 'JavaScript runtime', ...extract('NODE_MISSING', 'v'), canSelectVersion: true },
      { id: 'bun', name: 'Bun', icon: '🍞', description: 'Fast JS runtime', ...extract('BUN_MISSING', 'bun') },
      { id: 'pm2', name: 'PM2', icon: '⚙️', description: 'Process manager', ...extract('PM2_MISSING', 'pm2') },
      { id: 'python', name: 'Python', icon: '🐍', description: 'Programming language', ...extract('PYTHON_MISSING', 'python') },
      { id: 'python-venv', name: 'Python Venv', icon: '🌐', description: 'Virtual environments', installed: !raw.includes('VENV_MISSING'), version: null },
      { id: 'certbot', name: 'Certbot', icon: '🔒', description: "Let's Encrypt SSL", ...extract('CERTBOT_MISSING', 'certbot') },
      { id: 'nginx', name: 'Nginx', icon: '🌿', description: 'HTTP server & reverse proxy', ...extract('NGINX_MISSING', 'nginx'), running: nginxActive },
      { id: 'apache', name: 'Apache', icon: '🪶', description: 'Apache HTTP server', ...extract('APACHE_MISSING', 'apache'), running: apacheActive },
    ];
    res.json({ success: true, data: tools });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Remote Extras: install/update ─────────────────────────────────────────────
const REMOTE_INSTALL: Record<string, (opts: any) => string> = {
  nodejs: (o) => {
    const major = o?.nodeVersion || '20';
    return `curl -fsSL https://deb.nodesource.com/setup_${major}.x | bash - && DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs 2>&1`;
  },
  bun: () => `curl -fsSL https://bun.sh/install | bash 2>&1`,
  pm2: () => `npm install -g pm2 2>&1`,
  python: () => `DEBIAN_FRONTEND=noninteractive apt-get install -y python3 python3-pip 2>&1`,
  'python-venv': () => `DEBIAN_FRONTEND=noninteractive apt-get install -y python3-venv 2>&1`,
  certbot: () => `DEBIAN_FRONTEND=noninteractive apt-get install -y certbot 2>&1`,
  nginx: () => `DEBIAN_FRONTEND=noninteractive apt-get install -y nginx 2>&1 && systemctl enable nginx && systemctl start nginx 2>&1`,
  apache: () => `DEBIAN_FRONTEND=noninteractive apt-get install -y apache2 2>&1 && systemctl enable apache2 && systemctl start apache2 2>&1`,
};

const REMOTE_UPDATE: Record<string, string> = {
  nodejs: 'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade nodejs 2>&1',
  bun: 'bun upgrade 2>&1',
  pm2: 'npm install -g pm2@latest 2>&1',
  python: 'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade python3 2>&1',
  'python-venv': 'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade python3-venv 2>&1',
  certbot: 'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade certbot 2>&1',
  nginx: 'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade nginx 2>&1',
  apache: 'DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade apache2 2>&1',
};

router.post('/:id/extras/:tool/install', async (req, res) => {
  const { tool } = req.params;
  const cmdFn = REMOTE_INSTALL[tool];
  if (!cmdFn) return res.status(400).json({ success: false, error: 'Unknown tool' });
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: 'Server not found' });
    const cmd = `apt-get update -qq 2>&1; ${cmdFn(req.body)}`;
    const { stdout, stderr } = await runSSHCommand(conn, cmd);
    res.json({ success: true, output: stdout + stderr });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/:id/extras/:tool/update', async (req, res) => {
  const { tool } = req.params;
  const cmd = REMOTE_UPDATE[tool];
  if (!cmd) return res.status(400).json({ success: false, error: 'Unknown tool' });
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: 'Server not found' });
    const { stdout, stderr } = await runSSHCommand(conn, cmd);
    res.json({ success: true, output: stdout + stderr });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Remote version info (PM2, Docker) ────────────────────────────────────────
router.get('/:id/extras/pm2-version', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: 'Server not found' });
    const { stdout } = await runSSHCommand(conn, 'pm2 --version 2>/dev/null && npm view pm2 version 2>/dev/null || echo ""');
    const lines = stdout.trim().split('\n').filter(Boolean);
    const version = lines[0]?.match(/(\d+\.\d+[\.\d]*)/)?.[1] || null;
    const latestVersion = lines[1]?.match(/(\d+\.\d+[\.\d]*)/)?.[1] || null;
    res.json({ success: true, data: { version, latestVersion, updateAvailable: version && latestVersion && version !== latestVersion } });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/:id/extras/docker-version', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: 'Server not found' });
    const { stdout } = await runSSHCommand(conn, 'docker --version 2>/dev/null; docker compose version 2>/dev/null || docker-compose --version 2>/dev/null');
    const lines = stdout.trim().split('\n');
    const dockerVer = lines[0]?.match(/(\d+\.\d+[\.\d]*)/)?.[1] || null;
    const composeVer = lines[1]?.match(/(\d+\.\d+[\.\d]*)/)?.[1] || null;
    res.json({ success: true, data: { docker: { version: dockerVer }, compose: { version: composeVer } } });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Remote User Management ────────────────────────────────────────────────────
router.get('/:id/users', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: 'Server not found' });
    const { stdout } = await runSSHCommand(conn, `getent passwd | awk -F: '$3 >= 1000 && $3 < 65534 {print $1"|"$3"|"$5"|"$6"|"$7}'`);
    const users = stdout.trim().split('\n').filter(Boolean).map(line => {
      const [username, uid, displayName, home, shell] = line.split('|');
      return { username, uid: parseInt(uid), displayName, home, shell };
    });
    res.json({ success: true, data: users });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/:id/users', async (req, res) => {
  const { username, password, shell = '/bin/bash', sudo = false } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, error: 'username and password required' });
  const safeUser = username.replace(/[^a-z0-9_-]/g, '');
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: 'Server not found' });
    let cmd = `useradd -m -s ${shell} ${safeUser} 2>&1 && echo '${safeUser}:${password.replace(/'/g, "'\\''")}' | chpasswd 2>&1`;
    if (sudo) cmd += ` && usermod -aG sudo ${safeUser} 2>&1`;
    const { stdout, stderr } = await runSSHCommand(conn, cmd);
    res.json({ success: true, output: stdout + stderr });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.patch('/:id/users/:username', async (req, res) => {
  const safeUser = req.params.username.replace(/[^a-z0-9_-]/g, '');
  const { password, shell, sudo } = req.body;
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: 'Server not found' });
    const cmds: string[] = [];
    if (password) cmds.push(`echo '${safeUser}:${password.replace(/'/g, "'\\''")}' | chpasswd`);
    if (shell) cmds.push(`chsh -s ${shell} ${safeUser}`);
    if (sudo === true) cmds.push(`usermod -aG sudo ${safeUser}`);
    if (sudo === false) cmds.push(`gpasswd -d ${safeUser} sudo 2>/dev/null || deluser ${safeUser} sudo 2>/dev/null`);
    if (!cmds.length) return res.status(400).json({ success: false, error: 'Nothing to update' });
    const { stdout, stderr } = await runSSHCommand(conn, cmds.join(' && ') + ' 2>&1');
    res.json({ success: true, output: stdout + stderr });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.delete('/:id/users/:username', async (req, res) => {
  const safeUser = req.params.username.replace(/[^a-z0-9_-]/g, '');
  const { keepHome = false } = req.body;
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: 'Server not found' });
    const flag = keepHome ? '' : '-r';
    const { stdout, stderr } = await runSSHCommand(conn, `userdel ${flag} ${safeUser} 2>&1`);
    res.json({ success: true, output: stdout + stderr });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
