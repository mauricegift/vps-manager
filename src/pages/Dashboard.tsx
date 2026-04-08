import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Cpu, MemoryStick, HardDrive, Network, Clock,
  Server, Globe, RefreshCw, Power, RotateCcw, Thermometer
} from "lucide-react";
import AOS from "aos";
import api from "@/lib/api";
import StatCard from "@/components/ui/StatCard";
import type { SystemInfo } from "@/types";
import { toast } from "react-toastify";
import { useRemoteServer } from "@/context/RemoteServerContext";

function fmtBytes(b: number) {
  if (b > 1e9) return (b / 1e9).toFixed(1) + " GB";
  if (b > 1e6) return (b / 1e6).toFixed(1) + " MB";
  return (b / 1e3).toFixed(1) + " KB";
}

function fmtUptime(s: number) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function Dashboard() {
  const { activeServer } = useRemoteServer();
  const endpoint = activeServer ? `/remote/${activeServer.id}/system` : "/system";

  const { data: info, isLoading, refetch, isFetching } = useQuery<SystemInfo>({
    queryKey: ["system", activeServer?.id ?? "local"],
    queryFn: () => api.get(endpoint).then((r) => r.data.data),
    refetchInterval: 3000,
  });

  useEffect(() => { AOS.refresh(); }, [info]);

  const handleRestart = async () => {
    if (activeServer) return toast.info("Use SSH to restart the remote server.");
    if (!confirm("Restart the VPS?")) return;
    try {
      await api.post("/vps/restart");
      toast.info("Restarting VPS...");
    } catch { toast.error("Failed to restart"); }
  };

  const handleShutdown = async () => {
    if (activeServer) return toast.info("Use SSH to shutdown the remote server.");
    if (!confirm("Shutdown the VPS? You will lose remote access.")) return;
    try {
      await api.post("/vps/shutdown");
      toast.warning("Shutting down VPS...");
    } catch { toast.error("Failed to shutdown"); }
  };

  return (
    <section className="main space-y-8">
      {/* Page Header */}
      <div data-aos="fade-down" data-aos-duration="500" className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {activeServer ? activeServer.name : "System Dashboard"}
          </h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            {activeServer
              ? `Remote · ${activeServer.username}@${activeServer.ip}`
              : "Real-time VPS health & performance"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[var(--line)] text-sm hover:bg-[var(--foreground)] transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
            Refresh
          </button>
          <button
            onClick={handleRestart}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-amber-500/30 text-amber-400 text-sm hover:bg-amber-500/10 transition-colors"
          >
            <RotateCcw size={14} />
            Restart
          </button>
          <button
            onClick={handleShutdown}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-red-500/30 text-red-400 text-sm hover:bg-red-500/10 transition-colors"
          >
            <Power size={14} />
            Shutdown
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="glass-card p-5 h-28 animate-pulse" />
          ))}
        </div>
      ) : info ? (
        <>
          {/* Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="CPU Usage"
              value={`${info.cpu.load.toFixed(1)}%`}
              sub={`${info.cpu.brand} · ${info.cpu.cores} cores`}
              icon={Cpu}
              color="text-indigo-400"
              progress={info.cpu.load}
              data-aos="fade-up"
              data-aos-delay="0"
            />
            <StatCard
              label="Memory"
              value={`${info.memory.usedPercent.toFixed(1)}%`}
              sub={`${fmtBytes(info.memory.used)} / ${fmtBytes(info.memory.total)}`}
              icon={MemoryStick}
              color="text-violet-400"
              progress={info.memory.usedPercent}
              data-aos="fade-up"
              data-aos-delay="60"
            />
            {(info.memory as any).swapTotal > 0 && (
              <StatCard
                label="Swap"
                value={`${(((info.memory as any).swapUsed / (info.memory as any).swapTotal) * 100).toFixed(1)}%`}
                sub={`${fmtBytes((info.memory as any).swapUsed)} / ${fmtBytes((info.memory as any).swapTotal)}`}
                icon={MemoryStick}
                color="text-fuchsia-400"
                progress={((info.memory as any).swapUsed / (info.memory as any).swapTotal) * 100}
                data-aos="fade-up"
                data-aos-delay="240"
              />
            )}
            <StatCard
              label="Disk Usage"
              value={info.disk[0] ? `${info.disk[0].use.toFixed(1)}%` : "N/A"}
              sub={info.disk[0] ? `${fmtBytes(info.disk[0].used)} / ${fmtBytes(info.disk[0].size)}` : ""}
              icon={HardDrive}
              color="text-blue-400"
              progress={info.disk[0]?.use}
              data-aos="fade-up"
              data-aos-delay="120"
            />
            <StatCard
              label="Uptime"
              value={fmtUptime(info.uptime)}
              sub="System uptime"
              icon={Clock}
              color="text-emerald-400"
              data-aos="fade-up"
              data-aos-delay="180"
            />
          </div>

          {/* System Info + Network */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* OS Info */}
            <div data-aos="fade-right" className="glass-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <Server size={16} className="text-[var(--accent)]" />
                <h2 className="text-sm font-semibold">System Information</h2>
              </div>
              <div className="space-y-2.5">
                {[
                  ["Hostname", info.os.hostname],
                  ["OS", `${info.os.distro} ${info.os.release}`],
                  ["Kernel", info.os.kernel],
                  ["Architecture", info.os.arch],
                  ["CPU", `${info.cpu.manufacturer} ${info.cpu.brand}`],
                  ["CPU Speed", `${info.cpu.speed} GHz`],
                  ["Physical Cores", String(info.cpu.physicalCores)],
                  ["Load Avg", `${info.load.avg1.toFixed(2)} · ${info.load.avg5.toFixed(2)} · ${info.load.avg15.toFixed(2)}`],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between items-center py-1.5 border-b border-[var(--line)] last:border-0">
                    <span className="text-xs text-[var(--muted)]">{k}</span>
                    <span className="text-xs font-mono font-medium text-right max-w-[60%] truncate">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Network */}
            <div data-aos="fade-left" className="space-y-4">
              <div className="glass-card p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Globe size={16} className="text-[var(--accent)]" />
                  <h2 className="text-sm font-semibold">Network Interfaces</h2>
                </div>
                <div className="space-y-3">
                  {(info.network ?? []).filter(n => n.ip4).map((n) => (
                    <div key={n.iface} className="p-3 rounded-xl bg-[var(--foreground)] border border-[var(--line)]">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold">{n.iface}</span>
                        <Network size={12} className="text-[var(--muted)]" />
                      </div>
                      <div className="space-y-1">
                        {n.ip4 && <div className="flex justify-between text-xs"><span className="text-[var(--muted)]">IPv4</span><span className="font-mono">{n.ip4}</span></div>}
                        {n.ip6 && <div className="flex justify-between text-xs"><span className="text-[var(--muted)]">IPv6</span><span className="font-mono truncate max-w-[160px]">{n.ip6}</span></div>}
                        {n.mac && <div className="flex justify-between text-xs"><span className="text-[var(--muted)]">MAC</span><span className="font-mono">{n.mac}</span></div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Temperatures */}
              {info.temps && info.temps.length > 0 && (
                <div className="glass-card p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Thermometer size={16} className="text-[var(--accent)]" />
                    <h2 className="text-sm font-semibold">Temperatures</h2>
                  </div>
                  <div className="space-y-2">
                    {info.temps.map((t) => (
                      <div key={t.label} className="flex items-center justify-between">
                        <span className="text-xs text-[var(--muted)]">{t.label}</span>
                        <span className={`text-xs font-mono font-semibold ${t.main > 80 ? "text-red-400" : t.main > 60 ? "text-amber-400" : "text-emerald-400"}`}>
                          {t.main}°C
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Disk Partitions */}
          {(info.disk ?? []).length > 0 && (
            <div data-aos="fade-up" className="glass-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <HardDrive size={16} className="text-[var(--accent)]" />
                <h2 className="text-sm font-semibold">Disk Partitions</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {(info.disk ?? []).map((d) => (
                  <div key={d.mount} className="p-4 rounded-xl bg-[var(--foreground)] border border-[var(--line)]">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-semibold">{d.mount}</span>
                      <span className="text-xs text-[var(--muted)]">{d.type}</span>
                    </div>
                    <div className="text-lg font-bold mb-1">{d.use.toFixed(1)}%</div>
                    <div className="progress-bar mb-2">
                      <div
                        className={`progress-fill ${d.use > 90 ? "bg-red-500" : d.use > 75 ? "bg-amber-500" : "bg-indigo-500"}`}
                        style={{ width: `${d.use}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-[var(--muted)]">
                      <span>{fmtBytes(d.used)} used</span>
                      <span>{fmtBytes(d.size)} total</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="glass-card p-12 text-center text-[var(--muted)]">
          <Server size={40} className="mx-auto mb-3 opacity-30" />
          <p>Unable to load system information</p>
        </div>
      )}
    </section>
  );
}
