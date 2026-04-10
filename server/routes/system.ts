import { Router } from 'express';
import si from 'systeminformation';
import os from 'os';

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

router.get('/homedir', async (_req, res) => {
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    const username = os.userInfo().username;
    const home = os.homedir();
    res.json({ success: true, data: { home, username } });
  } catch (e: any) {
    res.json({ success: true, data: { home: os.homedir(), username: os.userInfo().username } });
  }
});

export default router;
