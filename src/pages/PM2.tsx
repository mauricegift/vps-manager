import { useRef, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  Play, Square, RotateCcw, Trash2, RefreshCw,
  Server, FileText, Plus, ChevronRight, TerminalIcon, Send, Trash, List, RefreshCcw,
  ArrowUpCircle, Download, Copy, Check, Minus, SearchCheck, XCircle, Loader2,
  Github, HardDrive, Folder, File, ArrowUp, Eye, EyeOff, Key, Globe, Star,
  PackageOpen, PackageCheck, CornerDownRight
} from "lucide-react";
import api from "@/lib/api";
import StatusBadge from "@/components/ui/StatusBadge";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Modal from "@/components/ui/Modal";
import AnsiText from "@/components/ui/AnsiText";
import type { PM2Process } from "@/types";
import { toast } from "react-toastify";
import { useRemoteServer } from "@/context/RemoteServerContext";
import { useTheme } from "@/context/ThemeContext";

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

const DARK_TERM = {
  bg:     "#1e1e2e",
  header: "#181825",
  border: "#313244",
  muted:  "#6c7086",
  text:   "#cdd6f4",
  input:  "#a6e22e",
  err:    "#f38ba8",
};

const LIGHT_TERM = {
  bg:     "#f5f5f5",
  header: "#e8e8e8",
  border: "#d0d0d0",
  muted:  "#888888",
  text:   "#1a1a1a",
  input:  "#16803c",
  err:    "#dc2626",
};

const MIN_FONT = 5;
const MAX_FONT = 22;

export default function PM2Page() {
  const qc = useQueryClient();
  const { theme } = useTheme();
  const T = theme === "dark" ? DARK_TERM : LIGHT_TERM;

  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get("tab") as Tab) || "processes";
  const setTab = (t: Tab) => setSearchParams(p => { p.set("tab", t); return p; }, { replace: true });

  const [confirm, setConfirm] = useState<{ action: string; id: number; name: string } | null>(null);
  const [logs, setLogs] = useState<{ name: string; content: string } | null>(null);
  const [logsLoading, setLogsLoading] = useState<number | null>(null);
  const [logsCopied, setLogsCopied] = useState(false);
  const [startModal, setStartModal] = useState(false);
  const [startForm, setStartForm] = useState({ name: "", script: "", cwd: "", port: "" });
  const [scriptCheck, setScriptCheck] = useState<{ ok: boolean; type: string } | null>(null);
  const [envCheck, setEnvCheck] = useState<boolean | null>(null);
  const [checkingScript, setCheckingScript] = useState(false);

  // File browser state
  const [browseModal, setBrowseModal] = useState(false);
  const [browseTarget, setBrowseTarget] = useState<"script" | "cwd">("script");
  const [browsePath, setBrowsePath] = useState("/root");
  const [browseItems, setBrowseItems] = useState<{ name: string; type: string; path: string }[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);

  // GitHub source state
  const [ghSource, setGhSource] = useState<"fs" | "github">("fs");
  const [ghRepoUrl, setGhRepoUrl] = useState("");
  const [ghToken, setGhToken] = useState("");
  const [ghShowToken, setGhShowToken] = useState(false);
  const [ghSaveToken, setGhSaveToken] = useState(false);
  const [ghTokenLabel, setGhTokenLabel] = useState("");
  const [ghSavedTokens, setGhSavedTokens] = useState<{ label: string; token: string }[]>([]);
  const [ghDetecting, setGhDetecting] = useState(false);
  const [ghRepoInfo, setGhRepoInfo] = useState<any>(null);
  const [ghSelectedSuggestion, setGhSelectedSuggestion] = useState<any>(null);
  const [ghCloneDir, setGhCloneDir] = useState("/root/apps");
  const [ghRunInstall, setGhRunInstall] = useState(true);
  const [ghCloning, setGhCloning] = useState(false);
  const [ghCloneOutput, setGhCloneOutput] = useState("");

  const [termCmd, setTermCmd] = useState("");
  const [termHistory, setTermHistory] = useState<TermLine[]>([
    { type: "output", text: "PM2 Terminal ready — type pm2 commands (e.g. list, logs myapp, restart 0)" }
  ]);
  const [termLoading, setTermLoading] = useState(false);
  const [fontSize, setFontSize] = useState(() =>
    typeof window !== "undefined" && window.innerWidth < 640 ? 5 : 10
  );
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
    enabled: !!versionInfo?.installed,
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

  const checkScript = async () => {
    if (!startForm.script) return;
    setCheckingScript(true);
    setScriptCheck(null);
    setEnvCheck(null);
    try {
      if (activeServer) {
        const { data } = await api.post(`/remote/${activeServer.id}/exec`, {
          command: `test -e "${startForm.script}" && echo EXISTS || echo MISSING`,
        });
        setScriptCheck({ ok: !!data.data?.includes("EXISTS"), type: "file" });
        if (startForm.cwd) {
          const { data: d2 } = await api.post(`/remote/${activeServer.id}/exec`, {
            command: `test -e "${startForm.cwd}/.env" && echo EXISTS || echo MISSING`,
          });
          setEnvCheck(!!d2.data?.includes("EXISTS"));
        }
      } else {
        const { data } = await api.get(`/files/exists?path=${encodeURIComponent(startForm.script)}`);
        setScriptCheck({ ok: data.data.exists, type: data.data.type });
        if (startForm.cwd) {
          const { data: d2 } = await api.get(`/files/exists?path=${encodeURIComponent(startForm.cwd + "/.env")}`);
          setEnvCheck(d2.data.exists);
        }
      }
    } catch {
      setScriptCheck({ ok: false, type: "error" });
    }
    setCheckingScript(false);
  };

  const startMutation = useMutation({
    mutationFn: (body: typeof startForm) => {
      if (activeServer) {
        let cmd = `pm2 start "${body.script}" --name "${body.name}"`;
        if (body.cwd) cmd += ` --cwd "${body.cwd}"`;
        if (body.port) cmd += ` --env PORT=${body.port}`;
        return api.post(`/remote/${activeServer.id}/exec`, { command: cmd });
      }
      return api.post("/pm2/start", body);
    },
    onSuccess: () => {
      toast.success("Process started");
      qc.invalidateQueries({ queryKey: ["pm2"] });
      setStartModal(false);
      setStartForm({ name: "", script: "", cwd: "", port: "" });
      setScriptCheck(null);
      setEnvCheck(null);
    },
    onError: () => toast.error("Failed to start process"),
  });

  const viewLogs = async (id: number, name: string) => {
    setLogsLoading(id);
    try {
      const endpoint = activeServer
        ? `/remote/${activeServer.id}/pm2/${id}/logs`
        : `/pm2/${id}/logs`;
      const { data } = await api.get(endpoint);
      setLogs({ name, content: data.data });
    } catch { toast.error("Failed to fetch logs"); }
    setLogsLoading(null);
  };

  const copyLogs = async () => {
    if (!logs?.content) return;
    try {
      await navigator.clipboard.writeText(logs.content);
      setLogsCopied(true);
      setTimeout(() => setLogsCopied(false), 2000);
    } catch { toast.error("Failed to copy logs"); }
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

  // ── Saved GitHub tokens (localStorage) ───────────────────────────────────
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("vps_gh_tokens") || "[]");
      setGhSavedTokens(saved);
    } catch { /* ignore */ }
  }, [startModal]);

  const persistGhToken = (label: string, token: string) => {
    const existing: { label: string; token: string }[] = JSON.parse(localStorage.getItem("vps_gh_tokens") || "[]");
    if (!existing.find(t => t.token === token)) {
      const updated = [...existing, { label: label || `Token ${existing.length + 1}`, token }];
      localStorage.setItem("vps_gh_tokens", JSON.stringify(updated));
      setGhSavedTokens(updated);
    }
  };

  const deleteGhToken = (token: string) => {
    const updated: { label: string; token: string }[] = JSON.parse(localStorage.getItem("vps_gh_tokens") || "[]").filter((t: any) => t.token !== token);
    localStorage.setItem("vps_gh_tokens", JSON.stringify(updated));
    setGhSavedTokens(updated);
    if (ghToken === token) setGhToken("");
  };

  // ── Reset start modal ─────────────────────────────────────────────────────
  const resetStartModal = () => {
    setStartModal(false);
    setScriptCheck(null);
    setEnvCheck(null);
    setGhSource("fs");
    setGhRepoUrl("");
    setGhToken("");
    setGhSaveToken(false);
    setGhTokenLabel("");
    setGhRepoInfo(null);
    setGhSelectedSuggestion(null);
    setGhCloneOutput("");
  };

  // ── File browser ──────────────────────────────────────────────────────────
  const openBrowse = async (target: "script" | "cwd", startPath?: string) => {
    const initPath = startPath || (activeServer ? `/home/${activeServer.username}` : "/root");
    setBrowseTarget(target);
    setBrowsePath(initPath);
    setBrowseModal(true);
    await loadBrowseDir(initPath);
  };

  const loadBrowseDir = async (dir: string) => {
    setBrowseLoading(true);
    try {
      const { data } = activeServer
        ? await api.get(`/remote/${activeServer.id}/files`, { params: { path: dir } })
        : await api.get("/files", { params: { path: dir } });
      setBrowseItems(data.data || []);
      setBrowsePath(dir);
    } catch { toast.error("Cannot open folder"); }
    setBrowseLoading(false);
  };

  const browseParent = () => {
    const parts = browsePath.split("/").filter(Boolean);
    parts.pop();
    loadBrowseDir(parts.length ? "/" + parts.join("/") : "/");
  };

  const selectBrowseFile = (filePath: string) => {
    if (browseTarget === "script") {
      setStartForm(s => ({ ...s, script: filePath }));
      setScriptCheck(null);
    } else {
      setStartForm(s => ({ ...s, cwd: filePath.substring(0, filePath.lastIndexOf("/")) || "/" }));
      setEnvCheck(null);
    }
    setBrowseModal(false);
  };

  const useBrowseFolderAsCwd = () => {
    setStartForm(s => ({ ...s, cwd: browsePath }));
    setEnvCheck(null);
    setBrowseModal(false);
  };

  // ── GitHub detect & clone ─────────────────────────────────────────────────
  const detectGhRepo = async () => {
    if (!ghRepoUrl.trim()) return;
    setGhDetecting(true);
    setGhRepoInfo(null);
    setGhSelectedSuggestion(null);
    try {
      if (ghSaveToken && ghToken) persistGhToken(ghTokenLabel, ghToken);
      const { data } = await api.post("/github/detect", { repoUrl: ghRepoUrl, token: ghToken || undefined });
      if (data.success) {
        setGhRepoInfo(data.data);
        if (data.data.suggestions?.length) setGhSelectedSuggestion(data.data.suggestions[0]);
        const repoName = data.data.repo || "myapp";
        setGhCloneDir(`/root/apps/${repoName}`);
        if (!startForm.name) setStartForm(s => ({ ...s, name: repoName }));
      } else { toast.error(data.error || "Failed to detect repo"); }
    } catch (e: any) { toast.error(e.response?.data?.error || "Detect failed"); }
    setGhDetecting(false);
  };

  const cloneGhRepo = async () => {
    if (!ghRepoInfo || !ghCloneDir) return;
    setGhCloning(true);
    setGhCloneOutput("");
    try {
      const entryFile = ghSelectedSuggestion?.file || "";
      const isCmd = entryFile.startsWith("npm") || entryFile.startsWith("bun") || entryFile.startsWith("python");

      if (activeServer) {
        // Clone on the remote VPS via SSH exec
        const cloneUrl = ghToken
          ? `https://${ghToken}@github.com/${ghRepoInfo.owner}/${ghRepoInfo.repo}.git`
          : `https://github.com/${ghRepoInfo.owner}/${ghRepoInfo.repo}.git`;
        const installCmd = ghRunInstall
          ? (ghRepoInfo.hasPackageJson ? " && npm install 2>&1" : ghRepoInfo.hasRequirementsTxt ? " && pip install -r requirements.txt 2>&1" : "")
          : "";
        const cmd = `mkdir -p "$(dirname "${ghCloneDir}")" && git clone "${cloneUrl}" "${ghCloneDir}" 2>&1${installCmd}`;
        const { data } = await api.post(`/remote/${activeServer.id}/exec`, { command: cmd });
        const execOut = typeof data.data === "string"
          ? data.data
          : ((data.data?.stdout || "") + (data.data?.stderr || "")) || "Cloned successfully";
        setGhCloneOutput(execOut);
        setStartForm(s => ({
          ...s,
          script: isCmd ? entryFile : `${ghCloneDir}/${entryFile}`,
          cwd: ghCloneDir,
        }));
        setScriptCheck(null);
        setEnvCheck(null);
        toast.success(`Cloned ${ghRepoInfo.owner}/${ghRepoInfo.repo} on remote`);
      } else {
        const { data } = await api.post("/github/clone", {
          repoUrl: ghRepoUrl,
          token: ghToken || undefined,
          dir: ghCloneDir,
          runInstall: ghRunInstall,
        });
        if (data.success) {
          setGhCloneOutput(data.data.output || "Cloned successfully");
          setStartForm(s => ({
            ...s,
            script: isCmd ? entryFile : `${ghCloneDir}/${entryFile}`,
            cwd: ghCloneDir,
          }));
          setScriptCheck(null);
          setEnvCheck(null);
          toast.success(`Cloned ${ghRepoInfo.owner}/${ghRepoInfo.repo}`);
        } else { toast.error(data.error || "Clone failed"); }
      }
    } catch (e: any) { toast.error(e.response?.data?.error || "Clone failed"); }
    setGhCloning(false);
  };

  const ACTIONS = [
    { key: "start",   label: "Start",   icon: Play,     cls: "text-green-400 hover:bg-green-500/10",  condition: (p: PM2Process) => p.status !== "online" },
    { key: "stop",    label: "Stop",    icon: Square,   cls: "text-red-400 hover:bg-red-500/10",      condition: (p: PM2Process) => p.status === "online" },
    { key: "restart", label: "Restart", icon: RotateCcw,cls: "text-amber-400 hover:bg-amber-500/10" },
    { key: "reload",  label: "Reload",  icon: RefreshCcw,cls: "text-blue-400 hover:bg-blue-500/10",  condition: (p: PM2Process) => p.status === "online" },
    { key: "logs",    label: "Logs",    icon: FileText,  cls: "text-sky-400 hover:bg-sky-500/10" },
    { key: "delete",  label: "Delete",  icon: Trash2,   cls: "text-red-400 hover:bg-red-500/10" },
  ];

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "processes", label: "Processes", icon: List },
    { id: "terminal",  label: "Terminal",  icon: TerminalIcon },
  ];

  const pm2NotInstalled = !versionLoading && versionInfo !== undefined && !versionInfo?.installed;

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
            ) : versionInfo?.installed && versionInfo?.version ? (
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-[var(--foreground)] border border-[var(--line)] text-[var(--muted)]">
                  v{versionInfo.version}
                </span>
                {versionInfo.updateAvailable ? (
                  <a href="/extras?tab=software&sub=runtimes" className="text-[10px] flex items-center gap-1 text-amber-400 hover:underline">
                    <ArrowUpCircle size={11} /> v{versionInfo.latestVersion} available
                  </a>
                ) : versionInfo.latestVersion ? (
                  <span className="text-[10px] text-green-400">✓ up to date</span>
                ) : null}
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
                  <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  <p className="text-xs text-[var(--muted)]">Loading processes...</p>
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
                                    disabled={logsLoading === p.pm_id && action.key === "logs"}
                                    onClick={() =>
                                      action.key === "logs"
                                        ? viewLogs(p.pm_id, p.name)
                                        : setConfirm({ action: action.key, id: p.pm_id, name: p.name })
                                    }
                                    className={`p-1.5 rounded-lg transition-colors ${action.cls} disabled:opacity-50`}
                                  >
                                    {action.key === "logs" && logsLoading === p.pm_id
                                      ? <div className="w-3 h-3 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
                                      : <action.icon size={13} />
                                    }
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
            <div className="rounded-2xl overflow-hidden shadow-xl" style={{ border: `1px solid ${T.border}` }}>
              {/* Chrome bar */}
              <div className="flex items-center gap-2 px-4 py-2.5 border-b"
                style={{ background: T.header, borderColor: T.border }}>
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500 opacity-80" />
                  <div className="w-3 h-3 rounded-full bg-amber-400 opacity-80" />
                  <div className="w-3 h-3 rounded-full bg-green-500 opacity-80" />
                </div>
                <TerminalIcon size={12} style={{ color: T.muted, marginLeft: 4 }} />
                <span className="text-sm font-semibold flex-1" style={{ color: T.text }}>PM2 Terminal</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full border mr-2" style={{ color: T.muted, borderColor: T.border }}>
                  pm2 commands
                </span>
                {/* Font size controls */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setFontSize(f => Math.max(MIN_FONT, +(f - 1).toFixed(1)))}
                    className="w-6 h-6 flex items-center justify-center rounded transition-colors"
                    style={{ background: T.border, color: T.muted }}
                    title="Decrease font size"
                  >
                    <Minus size={10} />
                  </button>
                  <span className="text-[10px] font-mono w-7 text-center" style={{ color: T.muted }}>{fontSize}</span>
                  <button
                    onClick={() => setFontSize(f => Math.min(MAX_FONT, +(f + 1).toFixed(1)))}
                    className="w-6 h-6 flex items-center justify-center rounded transition-colors"
                    style={{ background: T.border, color: T.muted }}
                    title="Increase font size"
                  >
                    <Plus size={10} />
                  </button>
                </div>
                <button
                  onClick={() => setTermHistory([{ type: "output", text: "Terminal cleared." }])}
                  className="p-1.5 rounded-lg ml-1 transition-colors"
                  style={{ color: T.muted }}
                  title="Clear"
                >
                  <Trash size={13} />
                </button>
              </div>

              {/* Output */}
              <div
                className="font-mono p-4 h-72 overflow-y-auto leading-relaxed"
                style={{ background: T.bg, color: T.text, fontSize: `${fontSize}px` }}
              >
                {termHistory.map((line, i) => (
                  <div key={i}>
                    {line.type === "input" ? (
                      <span style={{ color: T.input, fontWeight: 600 }}>
                        <AnsiText text={line.text} fg={T.text} />
                      </span>
                    ) : line.type === "error" ? (
                      <span style={{ color: T.err }}>
                        <AnsiText text={line.text} fg={T.text} />
                      </span>
                    ) : (
                      <AnsiText text={line.text} fg={T.text} />
                    )}
                  </div>
                ))}
                {termLoading && (
                  <div className="flex items-center gap-2 animate-pulse" style={{ color: T.muted }}>
                    <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Running...
                  </div>
                )}
                <div ref={termEndRef} />
              </div>

              {/* Quick commands */}
              <div className="flex flex-wrap gap-1.5 px-4 py-2 border-t"
                style={{ background: T.header, borderColor: T.border }}>
                {["list", "status", "monit", "flush", "save", "reload all", "logs --lines 50"].map(cmd => (
                  <button
                    key={cmd}
                    onClick={() => setTermCmd(cmd)}
                    className="text-[10px] px-2 py-1 rounded-lg font-mono transition-colors"
                    style={{ background: T.border, color: T.text }}
                  >
                    {cmd}
                  </button>
                ))}
              </div>

              {/* Input bar */}
              <div className="flex items-center gap-2 px-4 py-2.5 border-t"
                style={{ background: T.header, borderColor: T.border }}>
                <span className="font-mono text-sm font-bold shrink-0" style={{ color: T.input }}>pm2</span>
                <input
                  value={termCmd}
                  onChange={e => setTermCmd(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && runTermCmd()}
                  placeholder="list · logs myapp · restart 0 · reload all"
                  className="flex-1 bg-transparent font-mono text-sm focus:outline-none disabled:opacity-50"
                  style={{ color: T.text, caretColor: T.input }}
                  disabled={termLoading}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  onClick={runTermCmd}
                  disabled={termLoading || !termCmd.trim()}
                  className="shrink-0 p-1.5 rounded-xl disabled:opacity-40 transition-opacity"
                  style={{ background: T.input }}
                >
                  <Send size={13} style={{ color: theme === "dark" ? "#272822" : "#ffffff" }} />
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
      <Modal isOpen={!!logs} onClose={() => { setLogs(null); setLogsCopied(false); }} title={`Logs: ${logs?.name}`} size="xl">
        <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${T.border}` }}>
          {/* Log toolbar */}
          <div className="flex items-center justify-between px-4 py-2 border-b" style={{ background: T.header, borderColor: T.border }}>
            <span className="text-xs font-mono" style={{ color: T.muted }}>
              {logs?.name} · {logs?.content?.split("\n").length ?? 0} lines
            </span>
            <button
              onClick={copyLogs}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors"
              style={{ background: T.border, color: logsCopied ? "#4ec994" : T.text }}
              title="Copy all logs"
            >
              {logsCopied ? <Check size={12} /> : <Copy size={12} />}
              {logsCopied ? "Copied!" : "Copy"}
            </button>
          </div>
          {/* Log content */}
          <div
            className="font-mono text-[11px] leading-relaxed p-4 overflow-auto"
            style={{ background: T.bg, color: T.text, maxHeight: "60vh" }}
          >
            <AnsiText text={logs?.content || "No logs available"} fg={T.text} />
          </div>
        </div>
      </Modal>

      {/* Start Process Modal */}
      <Modal isOpen={startModal} onClose={resetStartModal} title="Start New Process" size="xl">
        <form onSubmit={(e) => { e.preventDefault(); startMutation.mutate(startForm); }} className="space-y-4">

          {/* Source selector tabs */}
          <div className="flex gap-1 p-1 rounded-xl bg-[var(--foreground)] border border-[var(--line)]">
            <button type="button" onClick={() => setGhSource("fs")}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${ghSource === "fs" ? "bg-[var(--accent)] text-white shadow-sm" : "text-[var(--muted)] hover:text-[var(--main)]"}`}>
              <HardDrive size={13} /> File System
            </button>
            <button type="button" onClick={() => setGhSource("github")}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${ghSource === "github" ? "bg-[var(--accent)] text-white shadow-sm" : "text-[var(--muted)] hover:text-[var(--main)]"}`}>
              <Github size={13} /> GitHub Repo
            </button>
          </div>

          {/* Common: Process Name */}
          <div>
            <label className="block text-xs text-[var(--muted)] mb-1.5">Process Name</label>
            <input value={startForm.name} onChange={(e) => setStartForm(s => ({ ...s, name: e.target.value }))}
              placeholder="my-app" className={`w-full ${inp}`} required />
          </div>

          {/* ── File System mode ── */}
          {ghSource === "fs" && (
            <>
              <div>
                <label className="block text-xs text-[var(--muted)] mb-1.5">Script / Entry File</label>
                <div className="flex gap-2">
                  <input value={startForm.script}
                    onChange={(e) => { setStartForm(s => ({ ...s, script: e.target.value })); setScriptCheck(null); }}
                    placeholder="/root/web/my-app/server.js" className={`flex-1 ${inp} font-mono text-xs`} required />
                  <button type="button" onClick={() => openBrowse("script", startForm.cwd || undefined)}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--line)] text-sm hover:bg-[var(--foreground)] transition-colors">
                    <Folder size={13} /> Browse
                  </button>
                  <button type="button" onClick={checkScript} disabled={!startForm.script || checkingScript}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--line)] text-sm hover:bg-[var(--foreground)] transition-colors disabled:opacity-40"
                    title="Verify file exists">
                    {checkingScript ? <Loader2 size={13} className="animate-spin" /> : <SearchCheck size={13} />}
                    Verify
                  </button>
                </div>
                {scriptCheck !== null && (
                  <div className={`flex items-center gap-1.5 mt-1.5 text-xs ${scriptCheck.ok ? "text-green-400" : "text-red-400"}`}>
                    {scriptCheck.ok ? <Check size={11} /> : <XCircle size={11} />}
                    {scriptCheck.ok ? `Found (${scriptCheck.type})` : "File not found"}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs text-[var(--muted)] mb-1.5">Working Directory <span className="opacity-60">(optional)</span></label>
                <div className="flex gap-2">
                  <input value={startForm.cwd}
                    onChange={(e) => { setStartForm(s => ({ ...s, cwd: e.target.value })); setEnvCheck(null); }}
                    placeholder="/root/web/my-app" className={`flex-1 ${inp} font-mono text-xs`} />
                  <button type="button" onClick={() => openBrowse("cwd", startForm.cwd || undefined)}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--line)] text-sm hover:bg-[var(--foreground)] transition-colors">
                    <Folder size={13} /> Browse
                  </button>
                </div>
                {envCheck !== null && (
                  <div className={`flex items-center gap-1.5 mt-1.5 text-xs ${envCheck ? "text-green-400" : "text-[var(--muted)]"}`}>
                    {envCheck ? <Check size={11} /> : <XCircle size={11} />}
                    {envCheck ? ".env file found — will be loaded automatically" : "No .env found in working directory"}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── GitHub mode ── */}
          {ghSource === "github" && (
            <div className="space-y-4">
              {/* Step 1: Repo URL + token */}
              {!ghCloneOutput ? (
                <>
                  <div>
                    <label className="block text-xs text-[var(--muted)] mb-1.5">Repository URL or <span className="font-mono">owner/repo</span></label>
                    <input value={ghRepoUrl} onChange={e => setGhRepoUrl(e.target.value)}
                      placeholder="github.com/user/my-app  or  user/my-app"
                      className={`w-full ${inp} font-mono text-xs`} />
                  </div>

                  {/* Saved tokens */}
                  {ghSavedTokens.length > 0 && (
                    <div>
                      <label className="block text-xs text-[var(--muted)] mb-1.5">Saved Tokens</label>
                      <div className="flex flex-wrap gap-2">
                        {ghSavedTokens.map((t, i) => (
                          <div key={i} className={`flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-lg border text-xs transition-colors cursor-pointer ${ghToken === t.token ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]" : "border-[var(--line)] hover:bg-[var(--foreground)]"}`}
                            onClick={() => setGhToken(t.token)}>
                            <Key size={10} /> {t.label}
                            <button type="button" onClick={e => { e.stopPropagation(); deleteGhToken(t.token); }}
                              className="ml-1 p-0.5 rounded hover:text-red-400 transition-colors" title="Remove">
                              <XCircle size={10} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Token input */}
                  <div>
                    <label className="block text-xs text-[var(--muted)] mb-1.5">
                      <Key size={10} className="inline mr-1" />GitHub Token <span className="opacity-60">(leave empty for public repos)</span>
                    </label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <input value={ghToken} onChange={e => setGhToken(e.target.value)}
                          type={ghShowToken ? "text" : "password"}
                          placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                          className={`w-full ${inp} font-mono text-xs pr-9`} />
                        <button type="button" onClick={() => setGhShowToken(s => !s)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--main)] transition-colors">
                          {ghShowToken ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                      </div>
                    </div>
                    {ghToken && (
                      <div className="flex items-center gap-3 mt-2">
                        <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                          <input type="checkbox" checked={ghSaveToken} onChange={e => setGhSaveToken(e.target.checked)} className="rounded accent-[var(--accent)]" />
                          Save this token
                        </label>
                        {ghSaveToken && (
                          <input value={ghTokenLabel} onChange={e => setGhTokenLabel(e.target.value)}
                            placeholder="Label (e.g. personal, work)"
                            className="flex-1 px-2.5 py-1.5 text-xs rounded-lg border border-[var(--line)] bg-[var(--foreground)] text-[var(--main)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none transition-colors" />
                        )}
                      </div>
                    )}
                  </div>

                  {/* Detect button */}
                  <button type="button" onClick={detectGhRepo} disabled={!ghRepoUrl.trim() || ghDetecting}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[var(--accent)] text-white text-sm hover:opacity-90 transition-opacity disabled:opacity-50">
                    {ghDetecting ? <><Loader2 size={14} className="animate-spin" /> Fetching repo info...</> : <><Globe size={14} /> Fetch Repo Info</>}
                  </button>

                  {/* Detected results */}
                  {ghRepoInfo && (
                    <div className="space-y-3">
                      {/* Repo header */}
                      <div className="flex items-center gap-2 p-3 rounded-xl border border-[var(--line)] bg-[var(--foreground)]">
                        <Github size={16} className="text-[var(--accent)] shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{ghRepoInfo.owner}/{ghRepoInfo.repo}</div>
                          <div className="text-[10px] text-[var(--muted)] flex items-center gap-2 mt-0.5">
                            <span className="px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)]">{ghRepoInfo.appType}</span>
                            <span>{ghRepoInfo.rootFiles?.length} files in root</span>
                            <span>branch: {ghRepoInfo.defaultBranch}</span>
                          </div>
                        </div>
                      </div>

                      {/* Entry file suggestions */}
                      {ghRepoInfo.suggestions?.length > 0 ? (
                        <div>
                          <label className="block text-xs text-[var(--muted)] mb-2">Select entry point</label>
                          <div className="space-y-1.5">
                            {ghRepoInfo.suggestions.map((s: any, i: number) => (
                              <label key={i} className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-colors ${ghSelectedSuggestion?.file === s.file ? "border-[var(--accent)] bg-[var(--accent)]/5" : "border-[var(--line)] hover:bg-[var(--foreground)]"}`}>
                                <input type="radio" name="ghEntry" className="mt-0.5 accent-[var(--accent)]"
                                  checked={ghSelectedSuggestion?.file === s.file}
                                  onChange={() => setGhSelectedSuggestion(s)} />
                                <div className="min-w-0">
                                  <div className="text-sm font-mono font-medium truncate">{s.file}</div>
                                  <div className="text-[10px] text-[var(--muted)] mt-0.5">{s.reason}</div>
                                  {s.runCmd && (
                                    <div className="text-[10px] text-[var(--accent)] mt-0.5 font-mono flex items-center gap-1">
                                      <CornerDownRight size={9} /> {s.runCmd}
                                    </div>
                                  )}
                                </div>
                              </label>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-[var(--muted)] text-center py-3">
                          No entry files auto-detected. Files: {ghRepoInfo.rootFiles?.slice(0, 5).join(", ")}
                        </div>
                      )}

                      {/* Clone directory */}
                      <div>
                        <label className="block text-xs text-[var(--muted)] mb-1.5">Clone to directory</label>
                        <input value={ghCloneDir} onChange={e => setGhCloneDir(e.target.value)}
                          placeholder="/root/apps/my-app" className={`w-full ${inp} font-mono text-xs`} />
                      </div>

                      {/* Install checkbox */}
                      <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                        <input type="checkbox" checked={ghRunInstall} onChange={e => setGhRunInstall(e.target.checked)} className="rounded accent-[var(--accent)]" />
                        <PackageOpen size={12} className="text-[var(--muted)]" />
                        Auto-install dependencies after cloning (npm install / pip install)
                      </label>

                      {/* Clone button */}
                      <button type="button" onClick={cloneGhRepo} disabled={ghCloning || !ghCloneDir}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-[var(--accent)] text-[var(--accent)] text-sm hover:bg-[var(--accent)]/10 transition-colors disabled:opacity-50">
                        {ghCloning ? <><Loader2 size={14} className="animate-spin" /> Cloning & installing...</> : <><Download size={14} /> Clone & Configure</>}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                /* Step 3: Clone complete */
                <div className="space-y-3">
                  <div className="flex items-center gap-2 p-3 rounded-xl border border-green-500/30 bg-green-500/5">
                    <PackageCheck size={16} className="text-green-400 shrink-0" />
                    <div>
                      <div className="text-sm font-medium text-green-400">Cloned successfully!</div>
                      <div className="text-xs text-[var(--muted)] mt-0.5">Script and working directory populated below</div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--foreground)] p-3 max-h-32 overflow-y-auto">
                    <pre className="text-[10px] font-mono text-[var(--muted)] whitespace-pre-wrap">{ghCloneOutput}</pre>
                  </div>
                  <button type="button" onClick={() => setGhCloneOutput("")}
                    className="text-xs text-[var(--muted)] hover:text-[var(--main)] transition-colors">
                    ← Change repo or re-clone
                  </button>
                </div>
              )}

              {/* Populated fields (always show so user can see/adjust) */}
              {(startForm.script || startForm.cwd) && (
                <div className="space-y-2 pt-1">
                  <div>
                    <label className="block text-xs text-[var(--muted)] mb-1">Script / Entry</label>
                    <input value={startForm.script} onChange={e => setStartForm(s => ({ ...s, script: e.target.value }))}
                      className={`w-full ${inp} font-mono text-xs`} required />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--muted)] mb-1">Working Directory</label>
                    <input value={startForm.cwd} onChange={e => setStartForm(s => ({ ...s, cwd: e.target.value }))}
                      className={`w-full ${inp} font-mono text-xs`} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Common: Port */}
          <div>
            <label className="block text-xs text-[var(--muted)] mb-1.5">Port <span className="opacity-60">(optional)</span></label>
            <input value={startForm.port} onChange={(e) => setStartForm(s => ({ ...s, port: e.target.value }))}
              placeholder="3000" className={`w-full ${inp}`} type="number" min="1" max="65535" />
            <p className="text-[10px] text-[var(--muted)] mt-1">Sets PORT environment variable for the process</p>
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={resetStartModal}
              className="px-4 py-2 text-sm rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={startMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50">
              {startMutation.isPending
                ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Starting...</>
                : <><ChevronRight size={14} /> Start Process</>
              }
            </button>
          </div>
        </form>
      </Modal>

      {/* File Browser Modal */}
      <Modal isOpen={browseModal} onClose={() => setBrowseModal(false)}
        title={browseTarget === "script" ? "Select Entry File" : "Select Working Directory"}
        size="lg">
        <div className="space-y-3">
          {/* Current path */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--foreground)] border border-[var(--line)] font-mono text-xs text-[var(--muted)] overflow-x-auto hide-scrollbar">
            <Folder size={12} className="shrink-0 text-amber-400" />
            <span className="truncate">{browsePath}</span>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            {browsePath !== "/" && (
              <button type="button" onClick={browseParent}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--line)] text-sm hover:bg-[var(--foreground)] transition-colors">
                <ArrowUp size={13} /> Up
              </button>
            )}
            <button type="button" onClick={useBrowseFolderAsCwd}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[var(--accent)]/40 text-[var(--accent)] text-sm hover:bg-[var(--accent)]/5 transition-colors">
              <Check size={13} /> Use <span className="font-mono text-xs truncate max-w-[120px]">{browsePath}</span> as Working Dir
            </button>
          </div>

          {/* File list */}
          <div className="rounded-xl border border-[var(--line)] overflow-hidden max-h-72 overflow-y-auto">
            {browseLoading ? (
              <div className="p-6 text-center">
                <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto" />
              </div>
            ) : browseItems.length === 0 ? (
              <div className="p-6 text-center text-sm text-[var(--muted)]">Empty folder</div>
            ) : (
              browseItems
                .sort((a, b) => (a.type !== b.type ? (a.type === "directory" ? -1 : 1) : a.name.localeCompare(b.name)))
                .map(item => (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => item.type === "directory" ? loadBrowseDir(item.path) : selectBrowseFile(item.path)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 border-b border-[var(--line)] last:border-0 hover:bg-[var(--foreground)] transition-colors text-left"
                  >
                    {item.type === "directory"
                      ? <Folder size={15} className="text-amber-400 shrink-0" />
                      : <File size={15} className="text-[var(--muted)] shrink-0" />}
                    <span className={`text-sm ${item.type === "directory" ? "font-medium text-[var(--main)]" : "text-[var(--muted)]"}`}>
                      {item.name}
                    </span>
                    {item.type === "file" && (
                      <span className="ml-auto text-[10px] text-[var(--accent)] font-medium shrink-0">Select</span>
                    )}
                  </button>
                ))
            )}
          </div>

          <p className="text-[10px] text-[var(--muted)]">
            {browseTarget === "script"
              ? "Click a file to select it as the entry script, or click folders to navigate."
              : "Click 'Use as Working Dir' to select the current folder, or navigate to find your project."}
          </p>
        </div>
      </Modal>
    </section>
  );
}
