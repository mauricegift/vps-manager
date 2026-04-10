import { Router, Request } from 'express';
import si from 'systeminformation';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { AuthRequest } from '../middleware/auth.js';

const execAsync = promisify(exec);

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const [cpu, mem, disk, net, osInfo, cpuLoad, temps] = await Promise.all([
      si.cpu(),
      si.mem(),
      si.fsSize(),
      si.networkInterfaces(),
      si.osInfo(),
      si.currentLoad(),
      si.cpuTemperature().catch(() => ({ main: null, cores: [] as number[] })),
    ]);

    const timeInfo = si.time();
    const uptime = (timeInfo as any)?.uptime ?? os.uptime();
    const loadAvg = os.loadavg();

    const data = {
      os: {
        platform: osInfo.platform,
        distro: osInfo.distro,
        release: osInfo.release,
        arch: osInfo.arch,
        hostname: osInfo.hostname,
        kernel: osInfo.kernel,
      },
      cpu: {
        manufacturer: cpu.manufacturer,
        brand: cpu.brand,
        speed: cpu.speed,
        cores: cpu.cores,
        physicalCores: cpu.physicalCores,
        load: cpuLoad.currentLoad,
      },
      memory: {
        total: mem.total,
        used: mem.used,
        free: mem.free,
        usedPercent: (mem.used / mem.total) * 100,
        swapTotal: mem.swaptotal || 0,
        swapUsed: mem.swapused || 0,
        swapFree: mem.swapfree || 0,
      },
      disk: (Array.isArray(disk) ? disk : [disk])
        .filter((d: any) => d.size > 0)
        .slice(0, 8)
        .map((d: any) => ({
          fs: d.fs,
          type: d.type,
          size: d.size,
          used: d.used,
          use: d.use,
          mount: d.mount,
        })),
      network: (Array.isArray(net) ? net : [net])
        .filter((n: any) => n.ip4 || n.ip6)
        .map((n: any) => ({
          iface: n.iface,
          ip4: n.ip4 || '',
          ip6: n.ip6 || '',
          mac: n.mac || '',
        })),
      uptime,
      load: {
        avg1: loadAvg[0],
        avg5: loadAvg[1],
        avg15: loadAvg[2],
      },
      temps: (temps as any).main
        ? [{ label: 'CPU', main: (temps as any).main }]
        : [],
    };

    res.json({ success: true, data });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/homedir', async (req: AuthRequest, res) => {
  // Priority 1: ?user= query param (e.g. switched system user sent by frontend)
  // Priority 2: JWT-authenticated VPS Manager username (may be a matching system user)
  // Priority 3: process owner (always 'root' when VPS Manager runs as root)
  const processUsername = os.userInfo().username;
  const processHome = os.homedir();

  const candidates = [
    (req.query.user as string) || '',
    req.user?.username || '',
  ].filter(u => u && u !== processUsername && u !== 'root');

  for (const candidate of candidates) {
    try {
      // getent passwd returns: name:pwd:uid:gid:gecos:home:shell
      const { stdout } = await execAsync(`getent passwd ${candidate} 2>/dev/null`);
      const parts = stdout.trim().split(':');
      if (parts.length >= 6 && parts[5]) {
        return res.json({ success: true, data: { home: parts[5], username: candidate } });
      }
    } catch { /* not a system user — try next */ }
  }

  res.json({ success: true, data: { home: processHome, username: processUsername } });
});

export default router;
