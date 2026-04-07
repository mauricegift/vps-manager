import { Client as SSH2Client, ConnectConfig } from 'ssh2';

export interface SSHConnection {
  ip: string;
  port?: number;
  username: string;
  password?: string;
  sshKey?: string;
  timeout?: number;
}

// ── Persistent Connection Pool ────────────────────────────────────────────────
interface PoolEntry {
  client: SSH2Client;
  lastUsed: number;
  ready: boolean;
  connecting: boolean;
  waiters: Array<{ resolve: (c: SSH2Client) => void; reject: (e: Error) => void }>;
}

const pool = new Map<string, PoolEntry>();

function poolKey(conn: SSHConnection) {
  return `${conn.username}@${conn.ip}:${conn.port || 22}`;
}

function buildConfig(conn: SSHConnection): ConnectConfig {
  const cfg: ConnectConfig = {
    host: conn.ip,
    port: conn.port || 22,
    username: conn.username,
    readyTimeout: 20000,
    keepaliveInterval: 15000,
    keepaliveCountMax: 30,
  };
  if (conn.sshKey) cfg.privateKey = conn.sshKey;
  else if (conn.password) cfg.password = conn.password;
  return cfg;
}

export function getPooledClient(conn: SSHConnection): Promise<SSH2Client> {
  const key = poolKey(conn);
  const entry = pool.get(key);

  // Reuse existing ready connection
  if (entry?.ready) {
    entry.lastUsed = Date.now();
    return Promise.resolve(entry.client);
  }

  // Already connecting — queue up
  if (entry?.connecting) {
    return new Promise((resolve, reject) => {
      entry.waiters.push({ resolve, reject });
    });
  }

  // Create fresh entry
  const newEntry: PoolEntry = {
    client: new SSH2Client(),
    lastUsed: Date.now(),
    ready: false,
    connecting: true,
    waiters: [],
  };
  pool.set(key, newEntry);

  return new Promise((resolve, reject) => {
    newEntry.waiters.push({ resolve, reject });

    newEntry.client
      .on('ready', () => {
        newEntry.ready = true;
        newEntry.connecting = false;
        newEntry.lastUsed = Date.now();
        for (const w of newEntry.waiters) w.resolve(newEntry.client);
        newEntry.waiters = [];
      })
      .on('error', (err) => {
        newEntry.ready = false;
        newEntry.connecting = false;
        pool.delete(key);
        for (const w of newEntry.waiters) w.reject(err);
        newEntry.waiters = [];
      })
      .on('close', () => {
        newEntry.ready = false;
        pool.delete(key);
      })
      .on('end', () => {
        newEntry.ready = false;
        pool.delete(key);
      })
      .connect(buildConfig(conn));
  });
}

export function removeFromPool(conn: SSHConnection) {
  const key = poolKey(conn);
  const entry = pool.get(key);
  if (entry) { try { entry.client.end(); } catch {} pool.delete(key); }
}

// Cleanup idle connections every 2 minutes (idle > 5 min)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of pool) {
    if (entry.ready && now - entry.lastUsed > 5 * 60 * 1000) {
      try { entry.client.end(); } catch {}
      pool.delete(key);
    }
  }
}, 2 * 60 * 1000);

// ── Exec on pooled client (with retry) ───────────────────────────────────────
async function execOnClient(
  client: SSH2Client,
  command: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Command timed out after 60s')),
      60000
    );
    client.exec(command, (err, stream) => {
      if (err) { clearTimeout(timer); return reject(err); }
      let stdout = '', stderr = '';
      stream.on('data', (d: Buffer) => (stdout += d.toString()));
      stream.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      stream.on('close', (code: number) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code: code ?? 0 });
      });
    });
  });
}

export async function runSSHCommand(
  conn: SSHConnection,
  command: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  let client: SSH2Client;
  try {
    client = await getPooledClient(conn);
  } catch (e) { throw e; }

  try {
    return await execOnClient(client, command);
  } catch (e: any) {
    // If the channel failed, remove from pool and retry once with new connection
    removeFromPool(conn);
    client = await getPooledClient(conn);
    return execOnClient(client, command);
  }
}

// ── Script runner (base64 to avoid quoting issues) ───────────────────────────
export async function runSSHScript(
  conn: SSHConnection,
  script: string
): Promise<string> {
  const b64 = Buffer.from(script, 'utf8').toString('base64');
  const cmd = `echo '${b64}' | base64 -d | bash`;
  const { stdout, stderr } = await runSSHCommand(conn, cmd);
  return stdout + stderr;
}

// ── One-shot (no pool) — only used for connection testing ────────────────────
export function testSSHConnection(conn: SSHConnection): Promise<boolean> {
  return new Promise((resolve) => {
    const client = new SSH2Client();
    const timer = setTimeout(() => { client.end(); resolve(false); }, 12000);
    client
      .on('ready', () => { clearTimeout(timer); client.end(); resolve(true); })
      .on('error', () => { clearTimeout(timer); resolve(false); })
      .connect(buildConfig(conn));
  });
}

// ── Remote system info (one pooled script call) ───────────────────────────────
export async function getRemoteSystemInfo(conn: SSHConnection) {
  const script = `
UP=$(cat /proc/uptime 2>/dev/null | awk '{print $1}'); echo "UPTIME=$UP"
CPU=$(grep 'cpu ' /proc/stat | awk '{u=($2+$4)*100/($2+$4+$5)} END {printf "%.1f",u}' 2>/dev/null); echo "CPU=$CPU"
CPUBRAND=$(grep -m1 "model name" /proc/cpuinfo 2>/dev/null | cut -d: -f2 | xargs || echo "Unknown CPU"); echo "CPUBRAND=$CPUBRAND"
CPUCORES=$(nproc 2>/dev/null || grep -c processor /proc/cpuinfo 2>/dev/null || echo 1); echo "CPUCORES=$CPUCORES"
CPUMHZ=$(grep -m1 "cpu MHz" /proc/cpuinfo 2>/dev/null | cut -d: -f2 | xargs || echo "0"); echo "CPUMHZ=$CPUMHZ"
MEM=$(free -b 2>/dev/null | awk 'NR==2{print $2" "$3" "$4}'); echo "MEM=$MEM"
OS=$(grep PRETTY_NAME /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d '"' || uname -s); echo "OS=$OS"
OSVER=$(grep VERSION_ID /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d '"' || echo ""); echo "OSVER=$OSVER"
echo "HOST=$(hostname)"
echo "KERNEL=$(uname -r)"
echo "ARCH=$(uname -m)"
LOAD=$(cat /proc/loadavg | awk '{print $1" "$2" "$3}'); echo "LOAD=$LOAD"
df -B1 --output=source,size,used,avail,pcent,target 2>/dev/null | grep -v tmpfs | grep -v devtmpfs | grep -v udev | tail -n +2 | head -8 | awk '{printf "DISK|%s|%s|%s|%s|%s|%s\\n",$1,$2,$3,$4,$5,$6}'
ip -4 addr show 2>/dev/null | awk '/^[0-9]/{iface=$2; gsub(":","",iface)} /inet /{split($2,a,"/"); printf "NET|%s|%s\\n",iface,a[1]}' | head -8
`.trim();

  const raw = await runSSHScript(conn, script);

  const kv: Record<string, string> = {};
  const disks: any[] = [];
  const networks: any[] = [];

  for (const line of raw.split('\n')) {
    if (line.startsWith('DISK|')) {
      const p = line.split('|');
      // p: DISK|source|size|used|avail|pcent|target
      const size = parseInt(p[2]) || 0;
      const used = parseInt(p[3]) || 0;
      const free = parseInt(p[4]) || 0;
      const use = parseFloat((p[5] || '0%').replace('%', '')) || 0;
      if (size > 0) disks.push({ fs: p[1], size, used, free, use, mount: p[6] || '/' });
    } else if (line.startsWith('NET|')) {
      const p = line.split('|');
      // p: NET|iface|ip4
      if (p[2] && p[2] !== '127.0.0.1') {
        networks.push({ iface: p[1] || '', ip4: p[2] || '', ip6: '', mac: '' });
      }
    } else {
      const idx = line.indexOf('=');
      if (idx > 0) kv[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }

  const [memTotal, memUsed, memFree] = (kv.MEM || '0 0 0').split(' ').map(Number);
  const [loadAvg1, loadAvg5, loadAvg15] = (kv.LOAD || '0 0 0').split(' ').map(Number);
  const cpuMhz = parseFloat(kv.CPUMHZ || '0');

  return {
    os: {
      distro: kv.OS || 'Unknown',
      release: kv.OSVER || '',
      hostname: kv.HOST || conn.ip,
      kernel: kv.KERNEL || 'Unknown',
      arch: kv.ARCH || 'x64',
    },
    cpu: {
      load: parseFloat(kv.CPU) || 0,
      brand: kv.CPUBRAND || 'Unknown CPU',
      manufacturer: '',
      cores: parseInt(kv.CPUCORES) || 1,
      physicalCores: parseInt(kv.CPUCORES) || 1,
      speed: cpuMhz > 0 ? (cpuMhz / 1000).toFixed(2) : '0',
    },
    memory: {
      total: memTotal,
      used: memUsed,
      free: memFree,
      usedPercent: memTotal > 0 ? (memUsed / memTotal) * 100 : 0,
    },
    disk: disks.length > 0 ? disks : [{ fs: '/', size: 0, used: 0, free: 0, use: 0, mount: '/' }],
    network: networks,
    uptime: parseFloat(kv.UPTIME) || 0,
    load: { avg1: loadAvg1, avg5: loadAvg5, avg15: loadAvg15 },
    temps: [],
  };
}
