import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  Play, Square, RotateCcw, Trash2, RefreshCw,
  Server, FileText, Plus, ChevronRight, TerminalIcon, Send, Trash, List, RefreshCcw, ArrowUpCircle, Download
} from "lucide-react";
import api from "@/lib/api";
import StatusBadge from "@/components/ui/StatusBadge";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Modal from "@/components/ui/Modal";
import AnsiText from "@/components/ui/AnsiText";
import type { PM2Process } from "@/types";
import { toast } from "react-toastify";
import { useRemoteServer } from "@/context/RemoteServerContext";

function fmtMem(b: number) {
  if (b > 1e6) return (b / 1e6).toFixed(1) + " MB";
  return (b / 1e3).toFixed(1) + " KB";
}
function fmtUptime(ms: number) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

type Tab = "processes" | "terminal";
interface TermLine { type: "input" | "output" | "error"; text: string; }

const inp = "px-3 py-2 text-sm rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-[var(--main)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none transition-colors";

export default function PM2Page() {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get("tab") as Tab) || "processes";
  const setTab = (t: Tab) => setSearchParams(p => { p.set("tab", t); return p; }, { replace: true });

  const [confirm, setConfirm] = useState<{ action: string; id: number; name: string } | null>(null);
  const [logs, setLogs] = useState<{ name: string; content: string } | null>(null);
  const [startModal, setStartModal] = useState(false);
  const [startForm, setStartForm] = useState({ name: "", script: "", cwd: "" });
  const [termCmd, setTermCmd] = useState("");
  const [termHistory, setTermHistory] = useState<TermLine[]>([
    { type: "output", text: "PM2 Terminal ready — type pm2 commands (e.g. list, logs myapp, restart 0)" }
  ]);
  const [termLoading, setTermLoading] = useState(false);
  const [installingPM2, setInstallingPM2] = useState(false);
  const termEndRef = useRef<HTMLDivElement>(null);

  const { activeServer } = useRemoteServer();
  const pfx = activeServer ? `/remote/${activeServer.id}` : "";

  const { data: versionInfo, isLoading: versionLoading } = useQuery({
    queryKey: ["pm2-version", activeServer?.id ?? "local"],
    queryFn: () => {
      const url = activeServer ? `/remote/${activeServer.id}/extras/pm2-version` : "/extras/pm2-version";
      return api.get(url).then(r => r.data.data).catch(() => null);
    },
    staleTime: 60000,
  });

  const { data: processes = [], isLoading, refetch, isFetching } = useQuery<PM2Process[]>({
    queryKey: ["pm2", activeServer?.id ?? "local"],
    queryFn: () => api.get(`${pfx}/pm2`).then((r) => r.data.data),
    refetchInterval: 8000,
    placeholderData: keepPreviousData,
    enabled: versionInfo !== null,
  });

  const mutation = useMutation({
    mutationFn: ({ action, id }: { action: string; id: number }) =>
      activeServer
        ? api.post(`/remote/${activeServer.id}/pm2/${id}/${action}`)
        : api.post(`/pm2/${id}/${action}`),
    onSuccess: (_, { action }) => {
      const label = action === "delete" ? "deleted" : action + "ed";
      toast.success(`Process ${label}`);
      qc.invalidateQueries({ queryKey: ["pm2"] });
      setConfirm(null);
    },
    onError: () => toast.error("Action failed"),
  });

  const startMutation = useMutation({
    mutationFn: (body: typeof startForm) =>
      activeServer
        ? api.post(`/remote/${activeServer.id}/exec`, { command: `pm2 start ${body.script} --name ${body.name}${body.cwd ? ` --cwd ${body.cwd}` : ""}` })
        : api.post("/pm2/start", body),
    onSuccess: () => {
      toast.success("Process started");
      qc.invalidateQueries({ queryKey: ["pm2"] });
      setStartModal(false);
      setStartForm({ name: "", script: "", cwd: "" });
    },
    onError: () => toast.error("Failed to start process"),
  });

  const viewLogs = async (id: number, name: string) => {
    try {
      const endpoint = activeServer
        ? `/remote/${activeServer.id}/pm2/${id}/logs`
        : `/pm2/${id}/logs`;
      const { data } = await api.get(endpoint);
      setLogs({ name, content: data.data });
    } catch { toast.error("Failed to fetch logs"); }
  };

  const runTermCmd = async () => {
    const cmd = termCmd.trim();
    if (!cmd || termLoading) return;
    setTermHistory(prev => [...prev, { type: "input", text: `$ pm2 ${cmd.replace(/^pm2\s*/i, "")}` }]);
    setTermCmd("");
    setTermLoading(true);
    try {
      const endpoint = activeServer
        ? `/remote/${activeServer.id}/pm2/terminal`
        : "/pm2/terminal";
      const { data } = await api.post(endpoint, { command: cmd });
      setTermHistory(prev => [...prev, { type: "output", text: data.data || "(no output)" }]);
      qc.invalidateQueries({ queryKey: ["pm2"] });
    } catch (e: any) {
      setTermHistory(prev => [...prev, { type: "error", text: e.response?.data?.error || "Command failed" }]);
    }
    setTermLoading(false);
    setTimeout(() => termEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  const installPM2 = async () => {
    setInstallingPM2(true);
    try {
      const url = activeServer ? `/remote/${activeServer.id}/extras/pm2/install` : "/extras/pm2/install";
      await api.post(url);
      toast.success("PM2 installed successfully");
      qc.invalidateQueries({ queryKey: ["pm2-version"] });
      qc.invalidateQueries({ queryKey: ["pm2"] });
    } catch (e: any) {
      toast.error(e.response?.data?.error || "Failed to install PM2");
    }
    setInstallingPM2(false);
  };

  const ACTIONS = [
    { key: "start", label: "Start", icon: Play, cls: "text-green-400 hover:bg-green-500/10", condition: (p: PM2Process) => p.status !== "online" },
    { key: "stop", label: "Stop", icon: Square, cls: "text-red-400 hover:bg-red-500/10", condition: (p: PM2Process) => p.status === "online" },
    { key: "restart", label: "Restart", icon: RotateCcw, cls: "text-amber-400 hover:bg-amber-500/10" },
    { key: "reload", label: "Reload", icon: RefreshCcw, cls: "text-blue-400 hover:bg-blue-500/10", condition: (p: PM2Process) => p.status === "online" },
    { key: "logs", label: "Logs", icon: FileText, cls: "text-sky-400 hover:bg-sky-500/10" },
    { key: "delete", label: "Delete", icon: Trash2, cls: "text-red-400 hover:bg-red-500/10" },
  ];

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "processes", label: "Processes", icon: List },
    { id: "terminal", label: "Terminal", icon: TerminalIcon },
  ];

  const pm2NotInstalled = !versionLoading && versionInfo === null;

  return (
    <section className="main space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold">
              {activeServer ? `PM2 · ${activeServer.name}` : "PM2 Processes"}
            </h1>
            {versionLoading ? (
              <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            ) : versionInfo?.version ? (
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-[var(--foreground)] border border-[var(--line)] text-[var(--muted)]">
                  v{versionInfo.version}
                </span>
                {versionInfo.updateAvailable && (
                  <a href="/extras?tab=software&sub=runtimes" className="text-[10px] flex items-center gap-1 text-amber-400 hover:underline">
                    <ArrowUpCircle size={11} /> v{versionInfo.latestVersion} available
                  </a>
                )}
                {!versionInfo.updateAvailable && versionInfo.latestVersion && (
                  <span className="text-[10px] text-green-400">✓ up to date</span>
                )}
              </div>
            ) : pm2NotInstalled ? (
              <span className="text-xs text-red-400 font-medium px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20">
                Not installed
              </span>
            ) : null}
          </div>
          <p className="text-sm text-[var(--muted)] mt-1">
            {activeServer ? `Remote · ${activeServer.ip}` : `${processes.length} process${processes.length !== 1 ? "es" : ""} managed`}
          </p>
        </div>
        <div className="flex gap-2">
          {pm2NotInstalled ? (
            <button
              onClick={installPM2}
              disabled={installingPM2}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--accent)] text-white text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {installingPM2 ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Download size={14} />}
              {installingPM2 ? "Installing..." : "Install PM2"}
            </button>
          ) : (
            <>
              <button onClick={() => refetch()} disabled={isFetching}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[var(--line)] text-sm hover:bg-[var(--foreground)] transition-colors disabled:opacity-50">
                <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} /> Refresh
              </button>
              <button onClick={() => setStartModal(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--accent)] text-white text-sm hover:opacity-90 transition-opacity">
                <Plus size={14} /> New Process
              </button>
            </>
          )}
        </div>
      </div>

      {/* Not installed banner */}
      {pm2NotInstalled && (
        <div className="glass-card p-8 text-center">
          <Server size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium mb-1">PM2 is not installed</p>
          <p className="text-xs text-[var(--muted)] mb-4">PM2 is a process manager for Node.js applications</p>
          <button
            onClick={installPM2}
            disabled={installingPM2}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--accent)] text-white text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {installingPM2 ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Download size={14} />}
            {installingPM2 ? "Installing PM2..." : "Install PM2"}
          </button>
        </div>
      )}

      {!pm2NotInstalled && (
        <>
          {/* Tabs */}
          <div className="flex gap-1 p-1 rounded-xl bg-[var(--foreground)] border border-[var(--line)] w-fit">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  tab === t.id
                    ? "bg-[var(--accent)] text-white shadow-sm"
                    : "text-[var(--muted)] hover:text-[var(--main)] hover:bg-[var(--secondary)]"
                }`}
              >
                <t.icon size={14} />
                {t.label}
                {t.id === "processes" && processes.length > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${tab === "processes" ? "bg-white/20" : "bg-[var(--accent)]/15 text-[var(--accent)]"}`}>
                    {processes.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Processes Tab */}
          {tab === "processes" && (
            <>
              {isLoading ? (
                <div className="glass-card p-8 text-center">
                  <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto" />
                </div>
              ) : processes.length === 0 ? (
                <div className="glass-card p-8 text-center text-[var(--muted)]">
                  <Server size={32} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No PM2 processes found</p>
                  <p className="text-xs mt-1">Start a process to see it here</p>
                </div>
              ) : (
                <div className="glass-card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="vps-table">
                      <thead>
                        <tr>
                          <th>ID</th><th>Name</th><th>Status</th><th>CPU</th>
                          <th>Memory</th><th>Uptime</th><th>Restarts</th><th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {processes.map((p) => (
                          <tr key={p.pm_id}>
                            <td className="font-mono text-xs text-[var(--muted)]">{p.pm_id}</td>
                            <td>
                              <div className="font-medium text-sm">{p.name}</div>
                              {p.pm_exec_path && (
                                <div className="text-[10px] text-[var(--muted)] font-mono truncate max-w-[180px]">{p.pm_exec_path}</div>
                              )}
                            </td>
                            <td><StatusBadge status={p.status} /></td>
                            <td className="font-mono text-sm">{(p.cpu || 0).toFixed(1)}%</td>
                            <td className="font-mono text-sm">{fmtMem(p.memory || 0)}</td>
                            <td className="text-sm text-[var(--muted)]">{p.uptime ? fmtUptime(p.uptime) : "—"}</td>
                            <td>
                              <span className={`text-sm font-mono ${(p.restarts || 0) > 5 ? "text-amber-400" : ""}`}>
                                {p.restarts || 0}
                              </span>
                            </td>
                            <td onClick={e => e.stopPropagation()}>
                              <div className="flex items-center gap-0.5">
                                {ACTIONS.filter(a => !a.condition || a.condition(p)).map(action => (
                                  <button
                                    key={action.key}
                                    title={action.label}
                                    onClick={() =>
                                      action.key === "logs"
                                        ? viewLogs(p.pm_id, p.name)
                                        : setConfirm({ action: action.key, id: p.pm_id, name: p.name })
                                    }
                                    className={`p-1.5 rounded-lg transition-colors ${action.cls}`}
                                  >
                                    <action.icon size={13} />
                                  </button>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Terminal Tab */}
          {tab === "terminal" && (
            <div className="rounded-2xl overflow-hidden border border-[var(--line)] shadow-lg">
              <div className="flex items-center justify-between px-4 py-3 border-b"
                style={{ background: "var(--secondary)", borderColor: "var(--line)" }}>
                <div className="flex items-center gap-2">
                  <div className="flex gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-500 opacity-70" />
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-400 opacity-70" />
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500 opacity-70" />
                  </div>
                  <TerminalIcon size={13} className="text-[var(--accent)] ml-1" />
                  <span className="font-semibold text-sm">PM2 Terminal</span>
                  <span className="text-[10px] text-[var(--muted)] px-2 py-0.5 rounded-full border border-[var(--line)]">
                    pm2 commands only
                  </span>
                </div>
                <button
                  onClick={() => setTermHistory([{ type: "output", text: "Terminal cleared." }])}
                  className="p-1.5 rounded-lg hover:bg-[var(--foreground)] text-[var(--muted)] transition-colors"
                  title="Clear"
                >
                  <Trash size={13} />
                </button>
              </div>

              <div className="font-mono text-[12.5px] p-4 h-64 overflow-y-auto"
                style={{ background: "var(--foreground)", lineHeight: "1.6" }}>
                {termHistory.map((line, i) => (
                  <div key={i} style={{ color: line.type === "error" ? "#f44747" : "var(--main)" }}>
                    {line.type === "input" ? (
                      <span style={{ color: "var(--accent)", fontWeight: 600 }}>
                        <AnsiText text={line.text} />
                      </span>
                    ) : (
                      <AnsiText text={line.text} />
                    )}
                  </div>
                ))}
                {termLoading && <div className="animate-pulse text-[var(--muted)]">Running...</div>}
                <div ref={termEndRef} />
              </div>

              <div className="flex flex-wrap gap-1.5 px-4 py-2 border-t"
                style={{ background: "var(--secondary)", borderColor: "var(--line)" }}>
                {["list", "status", "monit", "flush", "save", "reload all"].map(cmd => (
                  <button
                    key={cmd}
                    onClick={() => { setTermCmd(cmd); }}
                    className="text-[10px] px-2 py-1 rounded-lg border border-[var(--line)] font-mono hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/5 transition-colors"
                  >
                    {cmd}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 px-4 py-2.5 border-t"
                style={{ background: "var(--secondary)", borderColor: "var(--line)" }}>
                <span className="font-mono text-xs font-bold shrink-0 text-[var(--accent)]">pm2</span>
                <input
                  value={termCmd}
                  onChange={e => setTermCmd(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && runTermCmd()}
                  placeholder="list · logs myapp · restart 0 · reload all"
                  className="flex-1 bg-transparent font-mono text-xs placeholder:opacity-30 focus:outline-none disabled:opacity-50 text-[var(--main)]"
                  disabled={termLoading}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  onClick={runTermCmd}
                  disabled={termLoading || !termCmd.trim()}
                  className="shrink-0 p-1.5 rounded-xl disabled:opacity-40 transition-opacity bg-[var(--accent)]"
                >
                  <Send size={13} className="text-white" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && mutation.mutate({ action: confirm.action, id: confirm.id })}
        title={`${confirm?.action ? confirm.action.charAt(0).toUpperCase() + confirm.action.slice(1) : ""} Process`}
        message={`Are you sure you want to ${confirm?.action} "${confirm?.name}"?`}
        confirmLabel={confirm ? confirm.action.charAt(0).toUpperCase() + confirm.action.slice(1) : ""}
        danger={confirm?.action === "delete"}
        loading={mutation.isPending}
      />

      {/* Logs Modal */}
      <Modal isOpen={!!logs} onClose={() => setLogs(null)} title={`Logs: ${logs?.name}`} size="xl">
        <AnsiText text={logs?.content || "No logs available"} className="text-[11px] font-mono whitespace-pre-wrap break-all leading-relaxed" />
      </Modal>

      {/* Start Process Modal */}
      <Modal isOpen={startModal} onClose={() => setStartModal(false)} title="Start New Process">
        <form onSubmit={(e) => { e.preventDefault(); startMutation.mutate(startForm); }} className="space-y-4">
          <div>
            <label className="block text-xs text-[var(--muted)] mb-1.5">Process Name</label>
            <input value={startForm.name} onChange={(e) => setStartForm(s => ({ ...s, name: e.target.value }))}
              placeholder="my-app" className={`w-full ${inp}`} required />
          </div>
          <div>
            <label className="block text-xs text-[var(--muted)] mb-1.5">Script / Entry File</label>
            <input value={startForm.script} onChange={(e) => setStartForm(s => ({ ...s, script: e.target.value }))}
              placeholder="/path/to/app.js" className={`w-full ${inp} font-mono`} required />
          </div>
          <div>
            <label className="block text-xs text-[var(--muted)] mb-1.5">Working Directory (optional)</label>
            <input value={startForm.cwd} onChange={(e) => setStartForm(s => ({ ...s, cwd: e.target.value }))}
              placeholder="/root/web/my-app" className={`w-full ${inp} font-mono`} />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={() => setStartModal(false)}
              className="px-4 py-2 text-sm rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={startMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50">
              <ChevronRight size={14} />
              {startMutation.isPending ? "Starting..." : "Start Process"}
            </button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
