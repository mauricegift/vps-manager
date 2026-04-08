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
    const procId = req.params.procId;

    // Use node (always present with PM2) to read log files directly — avoids pm2 logs hanging
    const script = `node -e "
const { execSync } = require('child_process');
try {
  const procs = JSON.parse(execSync('pm2 jlist --no-color 2>/dev/null || echo []').toString());
  const proc = procs.find(p => String(p.pm_id) === '${procId}' || p.name === '${procId}');
  if (!proc) { console.log('(process not found)'); process.exit(0); }
  const out = proc.pm2_env && proc.pm2_env.pm_out_log_path;
  const err = proc.pm2_env && proc.pm2_env.pm_err_log_path;
  if (out) {
    try { process.stdout.write(execSync('tail -n 300 ' + JSON.stringify(out) + ' 2>/dev/null || true').toString()); } catch {}
    if (err && err !== out) {
      try {
        const e = execSync('tail -n 150 ' + JSON.stringify(err) + ' 2>/dev/null || true').toString();
        if (e.trim()) { process.stdout.write('\\n\\x1b[31m\\n── stderr ──\\x1b[0m\\n' + e); }
      } catch {}
    }
  } else {
    console.log('(log path not found, trying pm2 logs fallback)');
    try { process.stdout.write(execSync('pm2 logs ${procId} --lines 100 --nostream --no-color 2>&1', { timeout: 12000 }).toString()); } catch(fe) { console.log(String(fe)); }
  }
} catch(e) { console.log(String(e)); }
"`;
    const { stdout } = await runSSHCommand(conn, script);
    res.json({ success: true, data: stdout || '(no logs)' });
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
    const parts = args.split(/\s+/);
    const first = parts[0].toLowerCase();
    if (!ALLOWED_PM2.includes(first)) return res.status(400).json({ success: false, error: `Not allowed: ${first}` });

    // Intercept `logs` — read files directly to avoid pm2 logs hanging
    if (first === 'logs') {
      const nameOrId = parts[1] || '';
      const lines = parseInt(
        (parts.find((p, i) => i > 0 && /^\d+$/.test(p)) || parts[parts.indexOf('--lines') + 1] || ''),
        10
      ) || 100;
      const script = `node -e "
const { execSync } = require('child_process');
try {
  const procs = JSON.parse(execSync('pm2 jlist --no-color 2>/dev/null || echo []').toString());
  const proc = ${nameOrId
    ? `procs.find(p => String(p.pm_id) === '${nameOrId}' || p.name === '${nameOrId}')`
    : `procs[0]`};
  if (!proc) { console.log('(process not found)'); process.exit(0); }
  const out = proc.pm2_env && proc.pm2_env.pm_out_log_path;
  const err = proc.pm2_env && proc.pm2_env.pm_err_log_path;
  if (out) {
    try { process.stdout.write(execSync('tail -n ${lines} ' + JSON.stringify(out) + ' 2>/dev/null || true').toString()); } catch {}
    if (err && err !== out) {
      try {
        const e = execSync('tail -n ${Math.ceil(lines / 2)} ' + JSON.stringify(err) + ' 2>/dev/null || true').toString();
        if (e.trim()) process.stdout.write('\\n\\x1b[31m── stderr ──\\x1b[0m\\n' + e);
      } catch {}
    }
  } else { console.log('(log path not found)'); }
} catch(e) { console.log(String(e)); }
"`;
      const { stdout } = await runSSHCommand(conn, script);
      return res.json({ success: true, data: stdout || '(no logs)' });
    }

    const { stdout, stderr } = await runSSHCommand(conn, `FORCE_COLOR=3 COLORTERM=truecolor pm2 ${args} 2>&1`);
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

// ── Zip & download a file or folder from remote ───────────────────────────────
router.get('/:id/files/zip-download', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: 'Server not found' });
    const targetPath = (req.query.path as string || '').trim();
    if (!targetPath) return res.status(400).json({ success: false, error: 'path required' });

    const tmpZip = `/tmp/vpm_dl_${Date.now()}.zip`;
    const baseName = targetPath.split('/').filter(Boolean).pop() || 'download';
    const parentDir = targetPath.split('/').slice(0, -1).join('/') || '/';

    const EXCLUDE = [
      '*/node_modules/*', '*/.git/*', '*/.npm/*', '*/.agents/*',
      '*/attached_assets/*', '*/replit.md', '*/replit.nix', '*/.replit',
      '*/bun.lock', '*/package-lock.json',
    ].map(p => `-x ${JSON.stringify(p)}`).join(' ');

    // Ensure zip is installed, create zip on remote
    const zipCheckCmd = `command -v zip >/dev/null 2>&1 || (apt-get install -y zip -qq 2>&1)`;
    await runSSHCommand(conn, zipCheckCmd);

    const { stdout: zipOut, code: zipCode } = await runSSHCommand(conn,
      `cd ${JSON.stringify(parentDir)} && zip -r ${JSON.stringify(tmpZip)} ${JSON.stringify(baseName)} ${EXCLUDE} 2>&1; echo "_ZIPCODE_$?"`
    );
    const actualZipCode = parseInt((zipOut.match(/_ZIPCODE_(\d+)/) || ['', '1'])[1]);
    if (actualZipCode !== 0 && actualZipCode !== 12) {
      const errMsg = zipOut.replace(/_ZIPCODE_\d+/, '').trim().slice(-300);
      return res.status(500).json({ success: false, error: `Failed to create zip: ${errMsg}` });
    }

    // Read zip as base64 then delete temp file
    const { stdout: b64, code: readCode } = await runSSHCommand(conn,
      `base64 ${JSON.stringify(tmpZip)} 2>&1; rm -f ${JSON.stringify(tmpZip)}`
    );

    if (readCode !== 0 || !b64.trim()) {
      return res.status(500).json({ success: false, error: 'Failed to read zip from remote server' });
    }

    const zipBuffer = Buffer.from(b64.trim(), 'base64');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.zip"`);
    res.setHeader('Content-Length', zipBuffer.length);
    res.send(zipBuffer);
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Raw file download (any file, via base64 over SSH) ─────────────────────────
router.get('/:id/files/raw-download', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: 'Server not found' });
    const filePath = (req.query.path as string || '').trim();
    if (!filePath) return res.status(400).json({ success: false, error: 'path required' });

    const { stdout: b64, code } = await runSSHCommand(conn,
      `base64 ${JSON.stringify(filePath)} 2>&1; echo "_EXIT_$?"`
    );
    if (code !== 0 || !b64.trim()) {
      return res.status(500).json({ success: false, error: 'Failed to read file from remote server' });
    }
    const clean = b64.replace(/_EXIT_\d+/g, '').trim();
    const fileBuffer = Buffer.from(clean, 'base64');
    const fileName = filePath.split('/').filter(Boolean).pop() || 'download';
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', fileBuffer.length);
    res.send(fileBuffer);
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
    } else if (type === 'mysql' || type === 'mariadb') {
      const { stdout } = await runSSHCommand(conn,
        mysqlTry(`"SELECT * FROM \\\`${tbl}\\\` LIMIT 50 OFFSET ${offset}"`, db, '-B')
      );
      const lines = stdout.trim().split('\n').filter(l => l && !l.startsWith('ERROR') && !l.startsWith('mysql:') && !l.startsWith('Warning'));
      if (lines.length > 0) {
        columns = lines[0].split('\t');
        rows = lines.slice(1).map(l => l.split('\t'));
      }
      const { stdout: cnt } = await runSSHCommand(conn,
        mysqlTry(`"SELECT COUNT(*) FROM \\\`${tbl}\\\`"`, db)
      );
      total = parseInt(cnt.trim().split('\n').pop() || '0') || rows.length;
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
    } else if (type === 'mysql' || type === 'mariadb') {
      const safe = sql.replace(/"/g, '\\"');
      const { stdout } = await runSSHCommand(conn,
        mysqlTry(`"${safe}"`, db, '-B')
      );
      const lines = stdout.trim().split('\n').filter(l => l && !l.startsWith('ERROR') && !l.startsWith('mysql:') && !l.startsWith('Warning'));
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

// ── Remote DB: delete database ────────────────────────────────────────────────
router.delete('/:id/databases/:type/:dbName', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: 'Server not found' });
    const { type, dbName } = req.params;
    const db = decodeURIComponent(dbName).replace(/['"`;]/g, '');

    let cmd = '';
    if (type === 'postgresql') {
      cmd = pgTry(`-c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${db}' AND pid<>pg_backend_pid()"`, 'postgres') +
        ' ; ' + pgTry(`-c "DROP DATABASE IF EXISTS \\"${db}\\""`, 'postgres');
    } else if (type === 'mysql' || type === 'mariadb') {
      cmd = mysqlTry(`"DROP DATABASE IF EXISTS \\\`${db}\\\`"`, '', '-N');
    } else if (type === 'mongodb') {
      cmd = `mongosh --quiet ${JSON.stringify(db)} --eval 'db.dropDatabase()' 2>&1`;
    } else {
      return res.status(400).json({ success: false, error: 'Unsupported database type for deletion' });
    }

    await runSSHCommand(conn, cmd);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Remote Extras: software status ───────────────────────────────────────────
router.get('/:id/extras', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: 'Server not found' });

    // Comprehensive detection: check PATH, nvm, npm-global, ~/.bun, ~/.deno, ~/.cargo
    const script = `
NVM_ACTIVE=$(ls ~/.nvm/versions/node/ 2>/dev/null | sort -V | tail -1)
NVM_BIN_DIR="$HOME/.nvm/versions/node/$NVM_ACTIVE/bin"
# Get npm prefix: try nvm npm first, then PATH npm
if [ -n "$NVM_ACTIVE" ] && [ -x "$NVM_BIN_DIR/npm" ]; then
  NPM_PREFIX=$("$NVM_BIN_DIR/npm" config get prefix 2>/dev/null)
else
  NPM_PREFIX=$(npm config get prefix 2>/dev/null)
fi
NPM_BIN="${'${NPM_PREFIX}'}/bin"

# find binary: returns path or empty
find_bin() {
  local name=$1
  for p in $(which "$name" 2>/dev/null) "$NVM_BIN_DIR/$name" "$NPM_BIN/$name" "$HOME/.local/bin/$name" "$HOME/.bun/bin/$name" "$HOME/.deno/bin/$name" "$HOME/.cargo/bin/$name" "$HOME/go/bin/$name" /usr/local/go/bin/$name /usr/local/bin/$name /usr/bin/$name /bin/$name; do
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

# Node.js: prefer nvm newest, then PATH
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
emit apache "$(find_bin apache2)" "-v"
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
CHROME_P=$(find_bin google-chrome)
if [ -z "$CHROME_P" ]; then CHROME_P=$(find_bin google-chrome-stable); fi
if [ -z "$CHROME_P" ]; then CHROME_P=$(find_bin chromium-browser); fi
if [ -z "$CHROME_P" ]; then CHROME_P=$(find_bin chromium); fi
emit chrome "$CHROME_P" "--version"
emit wrangler "$(find_bin wrangler)"

systemctl is-active nginx 2>/dev/null || echo "svc_nginx_inactive"
systemctl is-active apache2 2>/dev/null || systemctl is-active httpd 2>/dev/null || echo "svc_apache_inactive"
`.trim();

    const raw = await runSSHScript(conn, script);
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

    const toolMap: Record<string, { installed: boolean; version: string | null; path: string | null }> = {};
    for (const line of lines) {
      if (line.startsWith('TOOL:')) {
        const parts = line.split(':');
        const id = parts[1];
        const binPath = parts[2] || null;
        const version = parts[3] === 'unknown' ? null : (parts[3] || null);
        toolMap[id] = { installed: true, version, path: binPath };
      } else if (line.startsWith('MISSING:')) {
        const id = line.replace('MISSING:', '');
        toolMap[id] = { installed: false, version: null, path: null };
      }
    }

    const nginxRunning = !lines.some(l => l === 'svc_nginx_inactive');
    const apacheRunning = !lines.some(l => l === 'svc_apache_inactive');

    const t = (id: string) => toolMap[id] || { installed: false, version: null, path: null };

    const tools = [
      { id: 'nodejs', name: 'Node.js', icon: '🟢', category: 'runtime', description: 'JavaScript runtime built on Chrome V8', canSelectVersion: true, ...t('nodejs') },
      { id: 'npm', name: 'npm', icon: '📦', category: 'runtime', description: 'Node package manager', ...t('npm') },
      { id: 'bun', name: 'Bun', icon: '🍞', category: 'runtime', description: 'Fast all-in-one JS runtime', ...t('bun') },
      { id: 'deno', name: 'Deno', icon: '🦕', category: 'runtime', description: 'Secure JS/TS runtime', ...t('deno') },
      { id: 'pm2', name: 'PM2', icon: '⚙️', category: 'runtime', description: 'Production process manager for Node.js', ...t('pm2') },
      { id: 'pnpm', name: 'pnpm', icon: '📦', category: 'runtime', description: 'Efficient disk-saving package manager', ...t('pnpm') },
      { id: 'yarn', name: 'Yarn', icon: '🧶', category: 'runtime', description: 'Fast, reliable Node package manager', ...t('yarn') },
      { id: 'python', name: 'Python', icon: '🐍', category: 'runtime', description: 'High-level programming language', ...t('python3') },
      { id: 'go', name: 'Go', icon: '🐹', category: 'runtime', description: 'Google Go programming language', ...t('go') },
      { id: 'rust', name: 'Rust / Cargo', icon: '🦀', category: 'runtime', description: 'Systems language with cargo', ...t('cargo') },
      { id: 'nginx', name: 'Nginx', icon: '🌿', category: 'server', description: 'HTTP server & reverse proxy', running: nginxRunning, ...t('nginx') },
      { id: 'apache', name: 'Apache', icon: '🪶', category: 'server', description: 'Apache HTTP server', running: apacheRunning, ...t('apache') },
      { id: 'certbot', name: 'Certbot', icon: '🔒', category: 'server', description: "Let's Encrypt SSL certificate client", ...t('certbot') },
      { id: 'git', name: 'Git', icon: '📁', category: 'tool', description: 'Distributed version control', ...t('git') },
      { id: 'curl', name: 'curl', icon: '🌐', category: 'tool', description: 'HTTP client & transfer tool', ...t('curl') },
      { id: 'wget', name: 'wget', icon: '⬇️', category: 'tool', description: 'Non-interactive download utility', ...t('wget') },
      { id: 'rsync', name: 'rsync', icon: '🔄', category: 'tool', description: 'Fast incremental file transfer', ...t('rsync') },
      { id: 'vim', name: 'Vim', icon: '📝', category: 'tool', description: 'Modal text editor', ...t('vim') },
      { id: 'nvim', name: 'Neovim', icon: '✨', category: 'tool', description: 'Hyperextensible Vim-based editor', ...t('nvim') },
      { id: 'htop', name: 'htop', icon: '📊', category: 'tool', description: 'Interactive process viewer', ...t('htop') },
      { id: 'tmux', name: 'tmux', icon: '🖥️', category: 'tool', description: 'Terminal multiplexer', ...t('tmux') },
      { id: 'screen', name: 'screen', icon: '🪟', category: 'tool', description: 'Terminal session manager', ...t('screen') },
      { id: 'ufw', name: 'ufw', icon: '🛡️', category: 'tool', description: 'Uncomplicated firewall', ...t('ufw') },
      { id: 'fail2ban-client', name: 'fail2ban', icon: '🔐', category: 'tool', description: 'Intrusion prevention system', ...t('fail2ban-client') },
      { id: 'jq', name: 'jq', icon: '🔍', category: 'tool', description: 'Lightweight JSON processor', ...t('jq') },
      { id: 'unzip', name: 'unzip', icon: '📂', category: 'tool', description: 'ZIP extraction utility', ...t('unzip') },
      { id: 'chrome', name: 'Google Chrome', icon: '🌐', category: 'browser', description: 'Google Chrome web browser with headless support', ...t('chrome') },
    ];
    res.json({ success: true, data: tools });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Remote Extras: install/update ─────────────────────────────────────────────

const NPM_DEPENDENT_REMOTE = new Set(['pm2','pnpm','yarn','npm','wrangler','bun']);

const REMOTE_NVM_ENSURE_NODE24 = `
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

const REMOTE_INSTALL: Record<string, (opts: any) => string> = {
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

const REMOTE_UPDATE: Record<string, string> = {
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

router.post('/:id/extras/system-update', async (req, res) => {
  const { action } = req.body as { action?: string };
  const cmd = action === 'upgrade'
    ? 'DEBIAN_FRONTEND=noninteractive apt-get upgrade -y 2>&1'
    : 'apt-get update 2>&1';
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: 'Server not found' });
    const { stdout, stderr } = await runSSHCommand(conn, cmd);
    res.json({ success: true, output: stdout + stderr });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/:id/extras/:tool/install', async (req, res) => {
  const { tool } = req.params;
  const cmdFn = REMOTE_INSTALL[tool];
  if (!cmdFn) return res.status(400).json({ success: false, error: 'Unknown tool' });
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: 'Server not found' });
    const installCmd = cmdFn(req.body);
    const nvmPrefix = NPM_DEPENDENT_REMOTE.has(tool) ? REMOTE_NVM_ENSURE_NODE24 : '';
    const needsAptUpdate = tool.startsWith('python') || ['nginx','apache','certbot','git','curl','wget','rsync','vim','nvim','htop','tmux','screen','ufw','fail2ban-client','jq','unzip','go'].includes(tool);
    const aptPrefix = needsAptUpdate ? 'apt-get update -qq 2>&1\n' : '';
    const fullScript = nvmPrefix + aptPrefix + installCmd + ' 2>&1\n';
    const b64 = Buffer.from(fullScript, 'utf8').toString('base64');
    const cmd = `bash -l -c "$(echo '${b64}' | base64 -d)"`;
    const { stdout, stderr, code } = await runSSHCommand(conn, cmd);
    if (code !== 0) {
      return res.status(500).json({ success: false, error: 'Installation failed', output: stdout + stderr });
    }
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
    const script = `
PM2_VER=""
if command -v pm2 >/dev/null 2>&1; then
  PM2_VER=$(pm2 --version 2>/dev/null | head -1 | tr -d '\\r')
fi
if [ -z "$PM2_VER" ]; then
  NPM_BIN=$(npm config get prefix 2>/dev/null)/bin/pm2
  if [ -x "$NPM_BIN" ]; then PM2_VER=$("$NPM_BIN" --version 2>/dev/null | head -1 | tr -d '\\r'); fi
fi
if [ -z "$PM2_VER" ]; then
  for BIN in /usr/local/bin/pm2 /usr/bin/pm2 "$HOME/.npm-global/bin/pm2" "$HOME/.local/bin/pm2"; do
    if [ -x "$BIN" ]; then PM2_VER=$("$BIN" --version 2>/dev/null | head -1 | tr -d '\\r'); break; fi
  done
fi
LATEST=$(npm view pm2 version 2>/dev/null | tr -d '\\r' || true)
echo "INSTALLED:$PM2_VER"
echo "LATEST:$LATEST"
`;
    const b64 = Buffer.from(script, 'utf8').toString('base64');
    const { stdout } = await runSSHCommand(conn, `bash -l -c "$(echo '${b64}' | base64 -d)"`);
    const version = stdout.match(/^INSTALLED:(.+)$/m)?.[1]?.match(/(\d+\.\d+[\.\d]*)/)?.[1] || null;
    const latestVersion = stdout.match(/^LATEST:(.+)$/m)?.[1]?.match(/(\d+\.\d+[\.\d]*)/)?.[1] || null;
    res.json({ success: true, data: { installed: !!version, version, latestVersion, updateAvailable: !!(version && latestVersion && version !== latestVersion) } });
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
    const [usersResult, whoamiResult] = await Promise.all([
      runSSHCommand(conn, `getent passwd | awk -F: '($3 >= 1000 && $3 < 65534) || $3 == 0 {print $1"|"$3"|"$5"|"$6"|"$7}'`),
      runSSHCommand(conn, `whoami`).catch(() => ({ stdout: '' })),
    ]);
    const currentUser = (whoamiResult.stdout || '').trim();
    const users = usersResult.stdout.trim().split('\n').filter(Boolean).map(line => {
      const [username, uid, displayName, home, shell] = line.split('|');
      return { username, uid: parseInt(uid), displayName, home, shell, isCurrent: username === currentUser };
    });
    res.json({ success: true, data: users, currentUser });
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

// ── Nginx & Certbot (Remote) ──────────────────────────────────────────────────

router.get('/:id/nginx/status', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ error: 'Server not found' });

    // Run all checks in parallel via a single SSH session
    const [versionR, runningR, certbotR] = await Promise.all([
      runSSHCommand(conn, 'nginx -v 2>&1 || echo "not installed"'),
      runSSHCommand(conn, 'systemctl is-active nginx 2>/dev/null || echo inactive'),
      runSSHCommand(conn, 'certbot --version 2>&1 || echo "not installed"'),
    ]);

    const version   = (versionR.stdout + versionR.stderr).trim();
    const installed = /nginx/i.test(version) && !version.includes('not installed');
    const running   = runningR.stdout.trim() === 'active';

    let test = '';
    let configOk = false;
    if (installed) {
      const testR = await runSSHCommand(conn, 'nginx -t 2>&1');
      test     = (testR.stdout + testR.stderr).trim();
      configOk = test.includes('syntax is ok');
    }

    const certbotVer      = (certbotR.stdout + certbotR.stderr).trim();
    const certbotInstalled = /certbot/i.test(certbotVer) && !certbotVer.includes('not installed');

    // Check for available updates (best-effort)
    let nginxUpdateAvailable   = false;
    let certbotUpdateAvailable = false;
    if (installed) {
      const ng = await runSSHCommand(conn, 'apt-cache policy nginx 2>/dev/null | grep -E "Installed:|Candidate:" | head -2 || true');
      const lines = (ng.stdout + ng.stderr).split('\n').map(l => l.trim());
      const inst = lines.find(l => l.startsWith('Installed:'))?.replace('Installed:', '').trim() ?? '';
      const cand = lines.find(l => l.startsWith('Candidate:'))?.replace('Candidate:', '').trim() ?? '';
      nginxUpdateAvailable = !!inst && !!cand && inst !== cand;
    }
    if (certbotInstalled) {
      const cb = await runSSHCommand(conn, 'apt-cache policy certbot 2>/dev/null | grep -E "Installed:|Candidate:" | head -2 || true');
      const lines = (cb.stdout + cb.stderr).split('\n').map(l => l.trim());
      const inst = lines.find(l => l.startsWith('Installed:'))?.replace('Installed:', '').trim() ?? '';
      const cand = lines.find(l => l.startsWith('Candidate:'))?.replace('Candidate:', '').trim() ?? '';
      certbotUpdateAvailable = !!inst && !!cand && inst !== cand;
    }

    res.json({
      installed, configOk, running, version, testOutput: test,
      nginxUpdateAvailable,
      certbotInstalled, certbotVersion: certbotVer, certbotUpdateAvailable,
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/:id/nginx/configs', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ error: 'Server not found' });
    const avail = (await runSSHCommand(conn, 'ls /etc/nginx/sites-available/ 2>/dev/null || echo ""')).stdout.trim();
    const enabled = (await runSSHCommand(conn, 'ls /etc/nginx/sites-enabled/ 2>/dev/null || echo ""')).stdout.trim();
    const enabledSet = new Set(enabled.split('\n').filter(Boolean));
    const configs = avail.split('\n').filter(Boolean).map(name => ({ name, enabled: enabledSet.has(name) }));
    res.json({ data: configs });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/:id/nginx/configs/:name', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ error: 'Server not found' });
    const name = req.params.name.replace(/[^a-zA-Z0-9._-]/g, '');
    const { stdout } = await runSSHCommand(conn, `cat /etc/nginx/sites-available/${name} 2>/dev/null`);
    res.json({ content: stdout });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.put('/:id/nginx/configs/:name', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ error: 'Server not found' });
    const name = req.params.name.replace(/[^a-zA-Z0-9._-]/g, '');
    const b64 = Buffer.from(req.body.content || '').toString('base64');
    await runSSHCommand(conn, `printf '%s' '${b64}' | base64 -d | tee /etc/nginx/sites-available/${name} > /dev/null`);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/nginx/configs', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ error: 'Server not found' });
    const name = (req.body.name || '').replace(/[^a-zA-Z0-9._-]/g, '');
    if (!name) return res.status(400).json({ error: 'name required' });
    const check = (await runSSHCommand(conn, `test -f /etc/nginx/sites-available/${name} && echo exists || echo ok`)).stdout.trim();
    if (check === 'exists') return res.status(409).json({ error: 'Config already exists' });
    const b64 = Buffer.from(req.body.content || '').toString('base64');
    await runSSHCommand(conn, `printf '%s' '${b64}' | base64 -d | tee /etc/nginx/sites-available/${name} > /dev/null`);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/nginx/configs/:name', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ error: 'Server not found' });
    const name = req.params.name.replace(/[^a-zA-Z0-9._-]/g, '');
    const { stdout, stderr } = await runSSHCommand(conn, `rm -f /etc/nginx/sites-enabled/${name} /etc/nginx/sites-available/${name} 2>&1; echo done`);
    res.json({ ok: true, output: stdout + stderr });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/nginx/configs/:name/enable', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ error: 'Server not found' });
    const name = req.params.name.replace(/[^a-zA-Z0-9._-]/g, '');
    const { stdout: out1, stderr: err1 } = await runSSHCommand(conn,
      `ln -sf /etc/nginx/sites-available/${name} /etc/nginx/sites-enabled/${name} 2>&1`
    );
    const { stdout: out2, stderr: err2 } = await runSSHCommand(conn, 'nginx -t 2>&1 && nginx -s reload 2>&1');
    res.json({ ok: true, output: out1 + err1 + out2 + err2 });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/nginx/configs/:name/disable', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ error: 'Server not found' });
    const name = req.params.name.replace(/[^a-zA-Z0-9._-]/g, '');
    const { stdout, stderr } = await runSSHCommand(conn, `rm -f /etc/nginx/sites-enabled/${name} 2>&1 && nginx -s reload 2>&1`);
    res.json({ ok: true, output: stdout + stderr });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/nginx/test', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ error: 'Server not found' });
    const { stdout, stderr } = await runSSHCommand(conn, 'nginx -t 2>&1');
    const out = stdout + stderr;
    res.json({ output: out, ok: out.includes('syntax is ok') });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/nginx/reload', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ error: 'Server not found' });
    const { stdout, stderr } = await runSSHCommand(conn, 'nginx -s reload 2>&1');
    const out = stdout + stderr;
    res.json({ output: out, ok: !out.toLowerCase().includes('error') });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/nginx/restart', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ error: 'Server not found' });
    const { stdout, stderr } = await runSSHCommand(conn, 'systemctl restart nginx 2>&1');
    const out = stdout + stderr;
    res.json({ output: out, ok: !out.toLowerCase().includes('failed') });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/:id/nginx/certs', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ error: 'Server not found' });
    const { stdout, stderr } = await runSSHCommand(conn, 'certbot certificates 2>&1');
    const raw = stdout + stderr;
    const certs: any[] = [];
    const blocks = raw.split(/\n(?=\s*Certificate Name:)/);
    for (const block of blocks) {
      const name    = block.match(/Certificate Name:\s*(.+)/)?.[1]?.trim();
      const domains = block.match(/Domains:\s*(.+)/)?.[1]?.trim().split(/\s+/) ?? [];
      const expiry  = block.match(/Expiry Date:\s*(.+?)(?:\s*\()/)?.[1]?.trim();
      const valid   = /VALID/i.test(block);
      const certPath = block.match(/Certificate Path:\s*(.+)/)?.[1]?.trim();
      const keyPath  = block.match(/Private Key Path:\s*(.+)/)?.[1]?.trim();
      if (name) certs.push({ name, domains, expiry, valid, certPath, keyPath });
    }
    res.json({ data: certs, raw });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/nginx/certs/issue', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ error: 'Server not found' });
    const { domains, email, method, webrootPath } = req.body;
    if (!domains?.length || !email) return res.status(400).json({ error: 'domains and email required' });
    const domainFlags = (Array.isArray(domains) ? domains : [domains]).map((d: string) => `-d ${d}`).join(' ');
    const methodFlag  = method === 'standalone'
      ? '--standalone --preferred-challenges http'
      : `--webroot -w ${webrootPath || '/var/www/html'}`;
    const cmd = `certbot certonly ${methodFlag} --non-interactive --agree-tos --email ${email} ${domainFlags} 2>&1`;
    const { stdout, stderr } = await runSSHCommand(conn, cmd);
    const out = stdout + stderr;
    res.json({ output: out, ok: /Congratulations|Successfully received/i.test(out) });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/nginx/certs/renew', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ error: 'Server not found' });
    const { name } = req.body;
    const cmd = name
      ? `certbot renew --cert-name ${name} --non-interactive 2>&1`
      : 'certbot renew --non-interactive 2>&1';
    const { stdout, stderr } = await runSSHCommand(conn, cmd);
    const out = stdout + stderr;
    res.json({ output: out, ok: !out.toLowerCase().includes('failed') });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/nginx/certs/:name', async (req, res) => {
  try {
    const conn = await getServerConn(req.params.id);
    if (!conn) return res.status(404).json({ error: 'Server not found' });
    const { stdout, stderr } = await runSSHCommand(conn, `certbot delete --cert-name ${req.params.name} --non-interactive 2>&1`);
    const out = stdout + stderr;
    res.json({ output: out, ok: !out.toLowerCase().includes('failed') });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
