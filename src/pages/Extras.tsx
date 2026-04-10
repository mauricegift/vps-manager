import { useState, useEffect } from "react";
import AOS from "aos";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  Download, RefreshCw, ArrowUpCircle, CheckCircle2, XCircle,
  UserPlus, Edit3, Trash2, Eye, EyeOff, Users, Package, ShieldAlert, Save,
  RefreshCcw, Layers, Server, Cpu, Wrench, Globe, MonitorSmartphone, Cloud, Key, Loader2,
  UserCheck, LogIn
} from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { toast } from "react-toastify";
import { useRemoteServer } from "@/context/RemoteServerContext";

const NODE_VERSIONS = ["18", "20", "22", "24"];

type MainTab = "system" | "software" | "users";
type SoftwareSubTab = "runtimes" | "servers" | "devtools" | "systools" | "browsers" | "cloud";

interface Tool {
  id: string; name: string; icon: string; description: string;
  installed: boolean; version: string | null; path?: string | null;
  latestVersion?: string | null; updateAvailable?: boolean;
  running?: boolean; canSelectVersion?: boolean;
  category?: 'runtime' | 'server' | 'tool' | 'browser';
}

interface User {
  username: string; uid: number; displayName?: string; home?: string; shell?: string; isCurrent?: boolean;
}

const SOFTWARE_GROUPS: { id: SoftwareSubTab; label: string; icon: React.ElementType; ids: string[] }[] = [
  { id: "runtimes", label: "Runtimes", icon: Cpu, ids: ["nodejs", "npm", "bun", "deno", "pm2", "pnpm", "yarn", "python", "go", "rust"] },
  { id: "servers", label: "Servers & SSL", icon: Server, ids: ["nginx", "apache", "certbot"] },
  { id: "devtools", label: "Dev Tools", icon: Wrench, ids: ["git", "curl", "wget", "rsync", "vim", "nvim"] },
  { id: "systools", label: "System Tools", icon: Layers, ids: ["htop", "tmux", "screen", "ufw", "fail2ban-client", "jq", "unzip", "venv", "ffmpeg", "libuuid"] },
  { id: "browsers", label: "Browsers", icon: Globe, ids: ["chrome"] },
  { id: "cloud", label: "Cloud", icon: Cloud, ids: ["wrangler", "cloudflared", "tailscale"] },
];

const ALL_KNOWN_IDS = SOFTWARE_GROUPS.flatMap(g => g.ids);

function VersionChip({ version, label }: { version: string | null; label?: string }) {
  if (!version) return null;
  return (
    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--foreground)] border border-[var(--line)] text-[var(--muted)]">
      {label}{version}
    </span>
  );
}

function ToolCard({
  tool, onInstall, onUpdate, onUninstall, loading, hideInstall, hideUninstall
}: {
  tool: Tool;
  onInstall: (nodeVersion?: string) => void;
  onUpdate: () => void;
  onUninstall: () => void;
  loading: boolean;
  hideInstall?: boolean;
  hideUninstall?: boolean;
}) {
  const [nodeVer, setNodeVer] = useState("20");

  return (
    <div className="glass-card p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="text-2xl">{tool.icon}</div>
          <div>
            <div className="font-semibold text-sm">{tool.name}</div>
            <div className="text-[11px] text-[var(--muted)] mt-0.5">{tool.description}</div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {tool.installed ? (
            <span className="flex items-center gap-1 text-[10px] font-medium text-green-400">
              <CheckCircle2 size={11} /> Installed
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] font-medium text-[var(--muted)]">
              <XCircle size={11} /> Not installed
            </span>
          )}
          {tool.running !== undefined && tool.installed && (
            <span className={`flex items-center gap-1 text-[10px] font-medium ${tool.running ? "text-emerald-400" : "text-amber-400"}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${tool.running ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
              {tool.running ? "Running" : "Stopped"}
            </span>
          )}
        </div>
      </div>

      {tool.installed && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            {tool.version && <VersionChip version={tool.version} label="v" />}
            {tool.latestVersion && tool.latestVersion !== tool.version && (
              <VersionChip version={tool.latestVersion} label="latest " />
            )}
            {tool.updateAvailable && (
              <span className="text-[10px] text-amber-400 font-medium">• update available</span>
            )}
            {!tool.updateAvailable && tool.latestVersion && (
              <span className="text-[10px] text-green-400 font-medium">• up to date</span>
            )}
          </div>
          {tool.path && (
            <div className="text-[10px] font-mono text-[var(--muted)] truncate" title={tool.path}>
              {tool.path}
            </div>
          )}
        </div>
      )}

      {tool.id === "apache" && !tool.installed && (
        <div className="flex items-start gap-1.5 text-[10px] text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-2.5 py-1.5">
          <ShieldAlert size={11} className="shrink-0 mt-0.5" />
          If Nginx is running, installing Apache may cause port 80 conflicts.
        </div>
      )}
      {tool.id === "nginx" && !tool.installed && (
        <div className="flex items-start gap-1.5 text-[10px] text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-2.5 py-1.5">
          <ShieldAlert size={11} className="shrink-0 mt-0.5" />
          If Apache is running, installing Nginx may cause port 80 conflicts.
        </div>
      )}

      {tool.canSelectVersion && !tool.installed && (
        <div>
          <label className="text-[10px] text-[var(--muted)] mb-1 block">Select Node.js version</label>
          <select
            value={nodeVer}
            onChange={e => setNodeVer(e.target.value)}
            className="w-full text-xs px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-[var(--main)] focus:border-[var(--accent)] transition-colors"
          >
            {NODE_VERSIONS.map(v => (
              <option key={v} value={v}>Node.js {v}.x LTS</option>
            ))}
          </select>
        </div>
      )}

      <div className="flex gap-2 mt-auto pt-1">
        {!tool.installed ? (
          hideInstall ? (
            <div className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-xl bg-[var(--foreground)] border border-[var(--line)] text-[var(--muted)]">
              Install Node.js first
            </div>
          ) : (
            <button
              onClick={() => onInstall(tool.canSelectVersion ? nodeVer : undefined)}
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-xl bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {loading ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" /> : <Download size={12} />}
              {loading ? "Installing..." : `Install ${tool.name}`}
            </button>
          )
        ) : (
          <>
            {tool.updateAvailable && (
              <button
                onClick={onUpdate}
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-xl bg-amber-500 text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {loading ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" /> : <ArrowUpCircle size={12} />}
                {loading ? "Updating..." : "Update"}
              </button>
            )}
            {!tool.updateAvailable && tool.latestVersion && (
              <div className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-xl bg-green-500/10 border border-green-500/20 text-green-400">
                <CheckCircle2 size={12} /> Up to date
              </div>
            )}
            {!tool.latestVersion && (
              <div className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-xl bg-[var(--foreground)] border border-[var(--line)] text-[var(--muted)]">
                <CheckCircle2 size={12} /> Installed
              </div>
            )}
            {!hideUninstall && (
              <button
                onClick={onUninstall}
                disabled={loading}
                title={`Uninstall ${tool.name}`}
                className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
              >
                {loading ? <div className="w-3 h-3 border border-red-400 border-t-transparent rounded-full animate-spin" /> : <Trash2 size={12} />}
                {loading ? "Removing..." : "Uninstall"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SysUpdateCard({ onRun, loading }: { onRun: (action: 'update' | 'upgrade') => void; loading: string | null }) {
  return (
    <div className="glass-card p-5 flex flex-col gap-3 border-l-4 border-[var(--accent)]">
      <div className="flex items-start gap-3">
        <div className="text-2xl">🔄</div>
        <div>
          <div className="font-semibold text-sm">Update System</div>
          <div className="text-[11px] text-[var(--muted)] mt-0.5">
            Fetch latest package list and upgrade installed packages
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => onRun('update')}
          disabled={!!loading}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] disabled:opacity-50 transition-colors"
        >
          {loading === 'update'
            ? <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
            : <RefreshCcw size={12} />}
          {loading === 'update' ? 'Running...' : 'apt update'}
        </button>
        <button
          onClick={() => onRun('upgrade')}
          disabled={!!loading}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-xl bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {loading === 'upgrade'
            ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
            : <Layers size={12} />}
          {loading === 'upgrade' ? 'Running...' : 'apt upgrade'}
        </button>
      </div>
    </div>
  );
}

function AppUpdateCard({ onOutput }: { onOutput: (title: string, output: string) => void }) {
  const qc = useQueryClient();

  const versionQuery = useQuery<{ localVersion: string; remoteVersion: string | null; updateAvailable: boolean }>({
    queryKey: ["app-version"],
    queryFn: () => api.get("/extras/app-version").then(r => r.data),
    staleTime: 60000,
  });

  const updateMutation = useMutation({
    mutationFn: () => api.post("/extras/app-update").then(r => r.data),
    onSuccess: (data) => {
      toast.success("Update applied — server is restarting…");
      onOutput("App Update Log", data.output || "Done.");
      qc.invalidateQueries({ queryKey: ["app-version"] });
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.error || "Update failed");
    },
  });

  const { localVersion, remoteVersion, updateAvailable } = versionQuery.data ?? {};

  return (
    <div className="glass-card p-5 flex flex-col gap-4 border-l-4 border-violet-500">
      <div className="flex items-start gap-3">
        <div className="text-2xl">🚀</div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">VPS Manager Updates</div>
          <div className="text-[11px] text-[var(--muted)] mt-0.5">
            Compares your installed version with the latest on GitHub and applies updates in-place.
          </div>
        </div>
      </div>

      {versionQuery.isLoading ? (
        <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <Loader2 size={13} className="animate-spin" /> Checking versions…
        </div>
      ) : versionQuery.isError ? (
        <p className="text-xs text-red-400">Could not fetch version info.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[var(--muted)] uppercase tracking-wider">Installed</span>
            <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full bg-[var(--foreground)] border border-[var(--line)]">
              v{localVersion}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[var(--muted)] uppercase tracking-wider">GitHub</span>
            <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full bg-[var(--foreground)] border border-[var(--line)]">
              {remoteVersion ? `v${remoteVersion}` : "—"}
            </span>
          </div>
          {remoteVersion && (
            updateAvailable ? (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-400 bg-amber-400/10 border border-amber-400/30 px-2 py-0.5 rounded-full">
                <ArrowUpCircle size={11} /> Update available
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-green-400 bg-green-400/10 border border-green-400/30 px-2 py-0.5 rounded-full">
                <CheckCircle2 size={11} /> Up to date
              </span>
            )
          )}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ["app-version"] })}
          disabled={versionQuery.isFetching || updateMutation.isPending}
          className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] disabled:opacity-50 transition-colors"
        >
          {versionQuery.isFetching
            ? <Loader2 size={12} className="animate-spin" />
            : <RefreshCw size={12} />}
          Refresh
        </button>
        <button
          onClick={() => updateMutation.mutate()}
          disabled={!updateAvailable || updateMutation.isPending || versionQuery.isLoading}
          className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-xl bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 transition-colors"
          title={!updateAvailable ? "Already on latest version" : "Pull latest code from GitHub and restart"}
        >
          {updateMutation.isPending
            ? <><Loader2 size={12} className="animate-spin" /> Updating…</>
            : <><ArrowUpCircle size={12} /> Update Now</>}
        </button>
      </div>
    </div>
  );
}

const inp = "w-full px-3 py-2 text-sm rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-[var(--main)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] transition-colors";

function WranglerRemotePanel({ activeServer, runCloudCmd, cloudOutput, cloudLoading }: {
  activeServer: { id: string; ip: string; username: string };
  runCloudCmd: (key: string, cmd: string) => void;
  cloudOutput: Record<string, string>;
  cloudLoading: string | null;
}) {
  const [cfToken, setCfToken] = useState("");
  const [showToken, setShowToken] = useState(false);

  const run = (key: string, subCmd: string) => {
    if (!cfToken.trim()) {
      alert("Please enter your Cloudflare API Token first.");
      return;
    }
    const cmd = `CLOUDFLARE_API_TOKEN="${cfToken.trim()}" wrangler ${subCmd} 2>&1`;
    runCloudCmd(key, cmd);
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-[var(--muted)] mb-1.5 block">Cloudflare API Token</label>
        <div className="relative">
          <input
            type={showToken ? "text" : "password"}
            value={cfToken}
            onChange={e => setCfToken(e.target.value)}
            placeholder="Enter CLOUDFLARE_API_TOKEN"
            className="w-full px-3 py-2 text-sm rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-[var(--main)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] transition-colors pr-10"
          />
          <button
            type="button"
            onClick={() => setShowToken(s => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--main)] transition-colors"
          >
            {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <p className="text-[10px] text-[var(--muted)] mt-1">Token is passed as env var for each command — not stored on the remote server.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {[
          { key: "wr-whoami",  label: "whoami",         sub: "whoami" },
          { key: "wr-list",    label: "List Workers",   sub: "worker list" },
          { key: "wr-pages",   label: "List Pages",     sub: "pages project list" },
          { key: "wr-kv",      label: "List KV",        sub: "kv:namespace list" },
        ].map(({ key, label, sub }) => (
          <button
            key={key}
            onClick={() => run(key, sub)}
            disabled={!!cloudLoading || !cfToken.trim()}
            className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] disabled:opacity-50 transition-colors"
          >
            {cloudLoading === key ? <Loader2 size={11} className="animate-spin" /> : null}
            {label}
          </button>
        ))}
      </div>
      {Object.entries(cloudOutput).filter(([k]) => k.startsWith("wr-")).map(([k, v]) =>
        v ? <pre key={k} className="text-[10px] font-mono text-[var(--muted)] bg-[var(--foreground)] border border-[var(--line)] rounded-xl p-2.5 max-h-40 overflow-y-auto">{v}</pre> : null
      )}
    </div>
  );
}

export default function ExtrasPage() {
  const qc = useQueryClient();
  const { activeServer } = useRemoteServer();
  const pfx = activeServer ? `/remote/${activeServer.id}` : "";

  const [searchParams, setSearchParams] = useSearchParams();
  const mainTab = (searchParams.get("tab") as MainTab) || "system";
  const subTab = (searchParams.get("sub") as SoftwareSubTab) || "runtimes";
  const sysSubTab = (searchParams.get("ssub") as "updates" | "hostname" | "swap" | "motd") || "updates";

  const setMainTab = (t: MainTab) =>
    setSearchParams(p => { p.set("tab", t); if (t !== "software") p.delete("sub"); return p; }, { replace: true });
  const setSubTab = (s: SoftwareSubTab) =>
    setSearchParams(p => { p.set("tab", "software"); p.set("sub", s); return p; }, { replace: true });
  const setSysSubTab = (s: "updates" | "hostname" | "swap" | "motd") =>
    setSearchParams(p => { p.set("tab", "system"); p.set("ssub", s); return p; }, { replace: true });

  const [opLoading, setOpLoading] = useState<string | null>(null);
  const [sysUpdLoading, setSysUpdLoading] = useState<string | null>(null);
  const [outputModal, setOutputModal] = useState<{ title: string; output: string } | null>(null);

  const [cfToken, setCfToken] = useState("");
  const [cfAccountId, setCfAccountId] = useState("");
  const [cfShowToken, setCfShowToken] = useState(false);
  const [cfSaving, setCfSaving] = useState(false);

  // Hostname
  const [hostnameInput, setHostnameInput] = useState("");
  const [hostnameSaving, setHostnameSaving] = useState(false);
  const hostnameQuery = useQuery<{ hostname: string }>({
    queryKey: ["hostname", activeServer?.id ?? "local"],
    queryFn: () => {
      const url = activeServer ? `/remote/${activeServer.id}/hostname` : `/extras/hostname`;
      return api.get(url).then(r => r.data);
    },
    staleTime: 30000,
    enabled: mainTab === "system",
  });
  useEffect(() => {
    if (hostnameQuery.data?.hostname) setHostnameInput(hostnameQuery.data.hostname);
  }, [hostnameQuery.data?.hostname]);

  // Swap
  const [swapGb, setSwapGb] = useState("2");
  const [swapLoading, setSwapLoading] = useState<string | null>(null);
  const [swapOutput, setSwapOutput] = useState("");
  const swapQuery = useQuery<{ swapInfo: string; freeInfo: string }>({
    queryKey: ["swap", activeServer?.id ?? "local"],
    queryFn: () => {
      const url = activeServer ? `/remote/${activeServer.id}/swap` : `/extras/swap`;
      return api.get(url).then(r => r.data);
    },
    staleTime: 10000,
    enabled: mainTab === "system",
  });

  // Tailscale / Cloudflared management
  const [cloudOutput, setCloudOutput] = useState<Record<string, string>>({});
  const [cloudLoading, setCloudLoading] = useState<string | null>(null);

  const runCloudCmd = async (key: string, cmd: string) => {
    setCloudLoading(key);
    try {
      const url = activeServer ? `/remote/${activeServer.id}/exec` : `/extras/exec`;
      const { data } = await api.post(url, { command: cmd });
      const out = typeof data.data === "string" ? data.data : ((data.data?.stdout || "") + (data.data?.stderr || ""));
      setCloudOutput(prev => ({ ...prev, [key]: out || "(no output)" }));
    } catch (e: any) {
      setCloudOutput(prev => ({ ...prev, [key]: e.response?.data?.error || "Error" }));
    }
    setCloudLoading(null);
  };

  // MOTD
  const [motdContent, setMotdContent] = useState("");
  const [motdMode, setMotdMode] = useState<"motd" | "script">("motd");
  const [motdSaving, setMotdSaving] = useState(false);
  const motdQuery = useQuery<{ motd: string; custom: string }>({
    queryKey: ["motd", activeServer?.id ?? "local"],
    queryFn: () => {
      const url = activeServer ? `/remote/${activeServer.id}/motd` : `/extras/motd`;
      return api.get(url).then(r => r.data);
    },
    staleTime: 30000,
    enabled: mainTab === "system",
  });
  useEffect(() => {
    if (motdQuery.data) {
      setMotdContent(motdMode === "motd" ? (motdQuery.data.motd || "") : (motdQuery.data.custom || ""));
    }
  }, [motdQuery.data, motdMode]);

  const [userModal, setUserModal] = useState<"create" | "edit" | null>(null);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [showPass, setShowPass] = useState(false);
  const [userForm, setUserForm] = useState({ username: "", password: "", shell: "/bin/bash", sudo: false, type: "regular" as "regular" | "sub", homeDir: "" });
  const [keepHome, setKeepHome] = useState(false);

  const { data: tools = [], isLoading, refetch, isFetching } = useQuery<Tool[]>({
    queryKey: ["extras", activeServer?.id ?? "local"],
    queryFn: () => api.get(`${pfx}/extras`).then(r => r.data.data),
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 3000,
  });

  useEffect(() => {
    if (tools.length > 0) {
      const t = setTimeout(() => AOS.refresh(), 50);
      return () => clearTimeout(t);
    }
  }, [tools.length]);

  const usersQuery = useQuery<{ users: User[]; currentUser: string }>({
    queryKey: ["system-users", activeServer?.id ?? "local"],
    queryFn: () => {
      const url = activeServer ? `/remote/${activeServer.id}/users` : `/extras/users`;
      return api.get(url).then(r => ({ users: r.data.data, currentUser: r.data.currentUser || "" }));
    },
    staleTime: 10000,
    enabled: mainTab === "users",
  });

  const cfCredsQuery = useQuery<{ apiToken: string; accountId: string }>({
    queryKey: ["cf-creds"],
    queryFn: () => api.get(`/extras/cloudflare/creds`).then(r => r.data.data),
    staleTime: Infinity,
    enabled: !activeServer,
  });

  useEffect(() => {
    if (cfCredsQuery.data) {
      setCfToken(cfCredsQuery.data.apiToken || "");
      setCfAccountId(cfCredsQuery.data.accountId || "");
    }
  }, [cfCredsQuery.data]);

  const saveCfCreds = async () => {
    setCfSaving(true);
    try {
      await api.post(`/extras/cloudflare/creds`, { apiToken: cfToken, accountId: cfAccountId });
      toast.success("Cloudflare credentials saved and persisted to ~/.bashrc");
      qc.invalidateQueries({ queryKey: ["cf-creds"] });
    } catch (e: any) {
      toast.error(e.response?.data?.error || "Failed to save credentials");
    }
    setCfSaving(false);
  };

  const handleInstall = async (tool: Tool, nodeVersion?: string) => {
    setOpLoading(`install-${tool.id}`);
    try {
      const url = activeServer
        ? `/remote/${activeServer.id}/extras/${tool.id}/install`
        : `/extras/${tool.id}/install`;
      const { data } = await api.post(url, nodeVersion ? { nodeVersion } : {});
      toast.success(`${tool.name} installed`);
      if (data.output) setOutputModal({ title: `Install ${tool.name}`, output: data.output });
    } catch (e: any) {
      const errMsg = e.response?.data?.error || `Failed to install ${tool.name}`;
      const errOutput = e.response?.data?.output;
      toast.error(errMsg);
      if (errOutput) setOutputModal({ title: `Install ${tool.name} (failed)`, output: errOutput });
    }
    setOpLoading(null);
    refetch();
  };

  const handleSystemUpdate = async (action: 'update' | 'upgrade') => {
    setSysUpdLoading(action);
    try {
      const url = activeServer
        ? `/remote/${activeServer.id}/extras/system-update`
        : `/extras/system-update`;
      const { data } = await api.post(url, { action });
      toast.success(action === 'update' ? 'Package list updated' : 'System upgraded');
      if (data.output) setOutputModal({ title: action === 'update' ? 'apt update' : 'apt upgrade', output: data.output });
    } catch (e: any) {
      toast.error(e.response?.data?.error || `Failed to run apt ${action}`);
    }
    setSysUpdLoading(null);
  };

  const handleUpdate = async (tool: Tool) => {
    setOpLoading(`update-${tool.id}`);
    try {
      const url = activeServer
        ? `/remote/${activeServer.id}/extras/${tool.id}/update`
        : `/extras/${tool.id}/update`;
      const { data } = await api.post(url);
      toast.success(`${tool.name} updated`);
      if (data.output) setOutputModal({ title: `Update ${tool.name}`, output: data.output });
    } catch (e: any) {
      const errMsg = e.response?.data?.error || `Failed to update ${tool.name}`;
      const errOutput = e.response?.data?.output;
      toast.error(errMsg);
      if (errOutput) setOutputModal({ title: `Update ${tool.name} (failed)`, output: errOutput });
    }
    setOpLoading(null);
    refetch();
  };

  const handleUninstall = async (tool: Tool) => {
    if (!window.confirm(`Uninstall ${tool.name}? This cannot be undone.`)) return;
    setOpLoading(`uninstall-${tool.id}`);
    try {
      const url = activeServer
        ? `/remote/${activeServer.id}/extras/${tool.id}/uninstall`
        : `/extras/${tool.id}/uninstall`;
      const { data } = await api.post(url);
      toast.success(`${tool.name} uninstalled`);
      if (data.output) setOutputModal({ title: `Uninstall ${tool.name}`, output: data.output });
    } catch (e: any) {
      toast.error(e.response?.data?.error || `Failed to uninstall ${tool.name}`);
    }
    setOpLoading(null);
    refetch();
  };

  const createUserMutation = useMutation({
    mutationFn: (form: typeof userForm) => {
      const url = activeServer ? `/remote/${activeServer.id}/users` : `/extras/users`;
      return api.post(url, form);
    },
    onSuccess: () => {
      toast.success("User created");
      setUserModal(null);
      setUserForm({ username: "", password: "", shell: "/bin/bash", sudo: false, type: "regular", homeDir: "" });
      qc.invalidateQueries({ queryKey: ["system-users"] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || "Failed to create user"),
  });

  const editUserMutation = useMutation({
    mutationFn: ({ username, data }: { username: string; data: any }) => {
      const url = activeServer ? `/remote/${activeServer.id}/users/${username}` : `/extras/users/${username}`;
      return api.patch(url, data);
    },
    onSuccess: () => {
      toast.success("User updated");
      setUserModal(null);
      setEditTarget(null);
      qc.invalidateQueries({ queryKey: ["system-users"] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || "Failed to update user"),
  });

  const deleteUserMutation = useMutation({
    mutationFn: ({ username }: { username: string }) => {
      const url = activeServer ? `/remote/${activeServer.id}/users/${username}` : `/extras/users/${username}`;
      return api.delete(url, { data: { keepHome } });
    },
    onSuccess: () => {
      toast.success("User deleted");
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["system-users"] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || "Failed to delete user"),
  });

  const openEdit = (u: User) => {
    setEditTarget(u);
    setUserForm({ username: u.username, password: "", shell: u.shell || "/bin/bash", sudo: false });
    setUserModal("edit");
  };

  const userList = usersQuery.data?.users || [];
  const currentUser = usersQuery.data?.currentUser || "";

  const [activeUser, setActiveUser] = useState<string>(() => localStorage.getItem("vpsm_active_user") || "");

  const switchToUser = (username: string) => {
    localStorage.setItem("vpsm_active_user", username);
    setActiveUser(username);
    toast.success(`Switched active user context to ${username}. File browsing and paths will now use /home/${username === "root" ? "root" : username}.`);
  };

  const saveHostname = async () => {
    setHostnameSaving(true);
    try {
      const url = activeServer ? `/remote/${activeServer.id}/hostname` : `/extras/hostname`;
      await api.post(url, { hostname: hostnameInput });
      toast.success("Hostname updated successfully");
      qc.invalidateQueries({ queryKey: ["hostname"] });
    } catch (e: any) { toast.error(e.response?.data?.error || "Failed to set hostname"); }
    setHostnameSaving(false);
  };

  const createSwap = async () => {
    setSwapLoading("create");
    setSwapOutput("");
    try {
      const url = activeServer ? `/remote/${activeServer.id}/swap` : `/extras/swap`;
      const { data } = await api.post(url, { sizeGb: parseInt(swapGb) });
      setSwapOutput(data.output || "");
      toast.success(`${swapGb}GB swap created`);
      qc.invalidateQueries({ queryKey: ["swap"] });
    } catch (e: any) {
      const msg = e.response?.data?.error || "Failed to create swap";
      setSwapOutput(e.response?.data?.output || msg);
      toast.error(msg);
    }
    setSwapLoading(null);
  };

  const removeSwap = async () => {
    if (!window.confirm("Remove the swap file? This cannot be undone.")) return;
    setSwapLoading("remove");
    setSwapOutput("");
    try {
      const url = activeServer ? `/remote/${activeServer.id}/swap` : `/extras/swap`;
      const { data } = await api.delete(url);
      setSwapOutput(data.output || "");
      toast.success("Swap removed");
      qc.invalidateQueries({ queryKey: ["swap"] });
    } catch (e: any) { toast.error(e.response?.data?.error || "Failed to remove swap"); }
    setSwapLoading(null);
  };

  const saveMotd = async () => {
    setMotdSaving(true);
    try {
      const url = activeServer ? `/remote/${activeServer.id}/motd` : `/extras/motd`;
      await api.post(url, { content: motdContent, mode: motdMode });
      toast.success("MOTD saved");
      qc.invalidateQueries({ queryKey: ["motd"] });
    } catch (e: any) { toast.error(e.response?.data?.error || "Failed to save MOTD"); }
    setMotdSaving(false);
  };

  const clearMotd = async () => {
    if (!window.confirm("Clear MOTD?")) return;
    try {
      const url = activeServer ? `/remote/${activeServer.id}/motd` : `/extras/motd`;
      await api.delete(url);
      setMotdContent("");
      toast.success("MOTD cleared");
      qc.invalidateQueries({ queryKey: ["motd"] });
    } catch (e: any) { toast.error(e.response?.data?.error || "Failed to clear MOTD"); }
  };

  const MAIN_TABS: { id: MainTab; label: string; icon: React.ElementType }[] = [
    { id: "system", label: "System", icon: RefreshCcw },
    { id: "software", label: "Software", icon: Package },
    { id: "users", label: "Users", icon: Users },
  ];

  const currentGroup = SOFTWARE_GROUPS.find(g => g.id === subTab) || SOFTWARE_GROUPS[0];

  const TOOL_META: Record<string, { name: string; icon: string; description: string }> = {
    wrangler:    { name: "Wrangler",          icon: "☁️", description: "Cloudflare Workers CLI for deploying to the edge" },
    venv:        { name: "Python venv",       icon: "🐍", description: "Python virtual environment module (python3-venv)" },
    ffmpeg:      { name: "FFmpeg",            icon: "🎬", description: "Multimedia framework for video/audio processing" },
    libuuid:     { name: "libuuid-dev",       icon: "🔑", description: "UUID library dev headers (required for node-canvas)" },
    cloudflared: { name: "Cloudflare Tunnel", icon: "🌐", description: "Cloudflare Tunnel daemon for secure tunneling" },
    tailscale:   { name: "Tailscale",         icon: "🔒", description: "Zero-config VPN for secure mesh networking" },
  };
  const groupToolIds = currentGroup.ids;
  const groupToolsFetched = tools.filter(t => groupToolIds.includes(t.id));
  const fetchedIds = new Set(tools.map(t => t.id));
  const syntheticTools: typeof tools = groupToolIds
    .filter(id => !fetchedIds.has(id))
    .map(id => ({
      id,
      name: TOOL_META[id]?.name || id,
      icon: TOOL_META[id]?.icon || "🔧",
      description: TOOL_META[id]?.description || id,
      installed: false,
      version: null,
    }));
  const groupTools = [...groupToolsFetched, ...syntheticTools];
  const extraTools = tools.filter(t => !ALL_KNOWN_IDS.includes(t.id));

  return (
    <section className="main space-y-6">
      {/* Header */}
      <div data-aos="fade-down" className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Extras</h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            {activeServer
              ? `Software management · ${activeServer.username}@${activeServer.ip}`
              : "Manage software, system updates and users"}
          </p>
        </div>
        {mainTab === "software" && (
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[var(--line)] text-sm hover:bg-[var(--foreground)] disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} /> Refresh
          </button>
        )}
      </div>

      {/* Main Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-[var(--foreground)] border border-[var(--line)] w-fit">
        {MAIN_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setMainTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              mainTab === id
                ? "bg-[var(--accent)] text-white shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--main)] hover:bg-[var(--secondary)]"
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* ── SYSTEM TAB ── */}
      {mainTab === "system" && (
        <div data-aos="fade-up" className="space-y-5">
          {/* System Sub-tabs */}
          <div className="overflow-x-auto hide-scrollbar">
            <div className="flex gap-1 p-1 rounded-xl bg-[var(--secondary)] border border-[var(--line)] w-fit min-w-full sm:min-w-0">
              {([
                { id: "updates", label: "Updates" },
                { id: "hostname", label: "Hostname" },
                { id: "swap", label: "Swap" },
                { id: "motd", label: "MOTD" },
              ] as const).map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setSysSubTab(id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                    sysSubTab === id ? "bg-[var(--accent)] text-white shadow-sm" : "text-[var(--muted)] hover:text-[var(--main)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Updates */}
          {sysSubTab === "updates" && (
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-xs text-[var(--muted)] font-semibold uppercase tracking-widest">App Update</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                <AppUpdateCard onOutput={(title, output) => setOutputModal({ title, output })} />
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs text-[var(--muted)] font-semibold uppercase tracking-widest">Package Management</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                <SysUpdateCard onRun={handleSystemUpdate} loading={sysUpdLoading} />
              </div>
            </div>
          </div>
          )}

          {/* Hostname Management */}
          {sysSubTab === "hostname" && (
          <div className="space-y-2">
            <p className="text-xs text-[var(--muted)] font-semibold uppercase tracking-widest">Hostname</p>
            <div className="glass-card p-5 flex flex-col gap-3 max-w-lg">
              <div className="flex items-start gap-3">
                <div className="text-2xl">🖥️</div>
                <div>
                  <div className="font-semibold text-sm">Server Hostname</div>
                  <div className="text-[11px] text-[var(--muted)] mt-0.5">Change this server's hostname using hostnamectl</div>
                </div>
              </div>
              <div className="flex gap-2">
                <input
                  value={hostnameInput}
                  onChange={e => setHostnameInput(e.target.value)}
                  placeholder="e.g. my-server"
                  className={inp + " flex-1"}
                  disabled={hostnameQuery.isLoading}
                />
                <button
                  onClick={saveHostname}
                  disabled={hostnameSaving || !hostnameInput}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs rounded-xl bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {hostnameSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  {hostnameSaving ? "Saving..." : "Apply"}
                </button>
              </div>
              {hostnameQuery.data?.hostname && (
                <p className="text-[10px] text-[var(--muted)]">Current: <span className="font-mono text-[var(--main)]">{hostnameQuery.data.hostname}</span></p>
              )}
            </div>
          </div>
          )}

          {/* Swap RAM */}
          {sysSubTab === "swap" && (
          <div className="space-y-2">
            <p className="text-xs text-[var(--muted)] font-semibold uppercase tracking-widest">Swap RAM</p>
            <div className="glass-card p-5 flex flex-col gap-3 max-w-lg">
              <div className="flex items-start gap-3">
                <div className="text-2xl">💾</div>
                <div>
                  <div className="font-semibold text-sm">Swap File</div>
                  <div className="text-[11px] text-[var(--muted)] mt-0.5">Create or remove a swap file. Persists across reboots via /etc/fstab.</div>
                </div>
              </div>
              {swapQuery.data?.swapInfo && (
                <div className="bg-[var(--foreground)] rounded-xl p-2.5 border border-[var(--line)]">
                  <p className="text-[10px] font-mono whitespace-pre-wrap text-[var(--muted)]">{swapQuery.data.swapInfo}</p>
                </div>
              )}
              {swapQuery.data?.freeInfo && (
                <pre className="text-[10px] font-mono text-[var(--muted)] bg-[var(--foreground)] border border-[var(--line)] rounded-xl p-2.5 overflow-x-auto">{swapQuery.data.freeInfo}</pre>
              )}
              <div className="flex gap-2 items-center">
                <div className="flex items-center gap-2 flex-1">
                  <label className="text-xs text-[var(--muted)] whitespace-nowrap">Size (GB)</label>
                  <input
                    type="number"
                    min={1}
                    max={256}
                    value={swapGb}
                    onChange={e => setSwapGb(e.target.value)}
                    className={inp + " w-24"}
                  />
                </div>
                <button
                  onClick={createSwap}
                  disabled={!!swapLoading}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-xl bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {swapLoading === "create" ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                  {swapLoading === "create" ? "Creating..." : "Create Swap"}
                </button>
                <button
                  onClick={removeSwap}
                  disabled={!!swapLoading}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
                >
                  {swapLoading === "remove" ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  {swapLoading === "remove" ? "Removing..." : "Remove"}
                </button>
              </div>
              {swapOutput && (
                <pre className="text-[10px] font-mono text-[var(--muted)] bg-[var(--foreground)] border border-[var(--line)] rounded-xl p-2.5 max-h-40 overflow-y-auto">{swapOutput}</pre>
              )}
            </div>
          </div>
          )}

          {/* MOTD Editor */}
          {sysSubTab === "motd" && (
          <div className="space-y-2">
            <p className="text-xs text-[var(--muted)] font-semibold uppercase tracking-widest">Login Banner (MOTD)</p>
            <div className="glass-card p-5 flex flex-col gap-3 max-w-2xl">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-start gap-3">
                  <div className="text-2xl">📋</div>
                  <div>
                    <div className="font-semibold text-sm">Message of the Day</div>
                    <div className="text-[11px] text-[var(--muted)] mt-0.5">Displayed when users SSH into the server</div>
                  </div>
                </div>
                {motdQuery.data?.motd && (
                  <button
                    onClick={() => setOutputModal({ title: "Current /etc/motd", output: motdQuery.data!.motd })}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors shrink-0"
                  >
                    <Eye size={12} /> View Current MOTD
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                {(["motd", "script"] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setMotdMode(m)}
                    className={`px-3 py-1.5 text-xs rounded-lg transition-all ${motdMode === m ? "bg-[var(--accent)] text-white" : "border border-[var(--line)] text-[var(--muted)] hover:text-[var(--main)]"}`}
                  >
                    {m === "motd" ? "/etc/motd (static)" : "/etc/update-motd.d/ (script)"}
                  </button>
                ))}
              </div>
              <textarea
                value={motdContent}
                onChange={e => setMotdContent(e.target.value)}
                rows={6}
                placeholder={motdMode === "motd" ? "Enter static MOTD text..." : "#!/bin/bash\necho 'Welcome to my server'"}
                className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-[var(--main)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] transition-colors resize-y"
              />
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={saveMotd}
                  disabled={motdSaving}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs rounded-xl bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {motdSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  {motdSaving ? "Saving..." : "Save MOTD"}
                </button>
                <button
                  onClick={() => {
                    if (motdQuery.data?.motd) setMotdContent(motdQuery.data.motd);
                  }}
                  disabled={!motdQuery.data?.motd}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] disabled:opacity-40 transition-colors"
                >
                  <Eye size={12} /> Load Current
                </button>
                <button
                  onClick={clearMotd}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
          )}
        </div>
      )}

      {/* ── SOFTWARE TAB ── */}
      {mainTab === "software" && (
        <div className="space-y-5">
          {/* Sub-tabs */}
          <div className="overflow-x-auto hide-scrollbar">
            <div className="flex gap-1 p-1 rounded-xl bg-[var(--secondary)] border border-[var(--line)] w-fit min-w-full sm:min-w-0">
              {SOFTWARE_GROUPS.map(({ id, label, icon: Icon }) => {
                const groupCount = tools.filter(t => id === subTab
                  ? SOFTWARE_GROUPS.find(g => g.id === id)!.ids.includes(t.id)
                  : false).length;
                const installed = tools.filter(t => SOFTWARE_GROUPS.find(g => g.id === id)!.ids.includes(t.id) && t.installed).length;
                const total = tools.filter(t => SOFTWARE_GROUPS.find(g => g.id === id)!.ids.includes(t.id)).length;
                const hasUpdate = tools.some(t => SOFTWARE_GROUPS.find(g => g.id === id)!.ids.includes(t.id) && t.updateAvailable);
                return (
                  <button
                    key={id}
                    onClick={() => setSubTab(id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap relative ${
                      subTab === id
                        ? "bg-[var(--accent)] text-white shadow-sm"
                        : "text-[var(--muted)] hover:text-[var(--main)]"
                    }`}
                  >
                    <Icon size={13} />
                    {label}
                    {total > 0 && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${subTab === id ? "bg-white/20" : "bg-[var(--foreground)]"}`}>
                        {installed}/{total}
                      </span>
                    )}
                    {hasUpdate && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Software cards */}
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="glass-card p-5 h-36 animate-pulse">
                  <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-xl bg-[var(--line)]" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-24 rounded bg-[var(--line)]" />
                      <div className="h-2 w-32 rounded bg-[var(--line)]" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : groupTools.length === 0 && extraTools.length === 0 ? (
            <div className="glass-card p-10 text-center text-[var(--muted)]">
              <MonitorSmartphone size={36} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">No tools in this category</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {groupTools.map(tool => (
                  <ToolCard
                    key={tool.id}
                    tool={tool}
                    loading={!!opLoading}
                    onInstall={(nodeVer) => handleInstall(tool, nodeVer)}
                    onUpdate={() => handleUpdate(tool)}
                    onUninstall={() => handleUninstall(tool)}
                    hideInstall={tool.id === "npm"}
                    hideUninstall={tool.id === "npm"}
                  />
                ))}
              </div>
              {subTab === "runtimes" && extraTools.length > 0 && (
                <>
                  <p className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-widest mt-4">Other</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {extraTools.map(tool => (
                      <ToolCard key={tool.id} tool={tool}
                        loading={!!opLoading}
                        onInstall={(nodeVer) => handleInstall(tool, nodeVer)}
                        onUpdate={() => handleUpdate(tool)}
                        onUninstall={() => handleUninstall(tool)}
                        hideInstall={tool.id === "npm"}
                        hideUninstall={tool.id === "npm"} />
                    ))}
                  </div>
                </>
              )}
              {subTab === "cloud" && (() => {
                const tsInstalled = tools.find(t => t.id === "tailscale")?.installed;
                const cfdInstalled = tools.find(t => t.id === "cloudflared")?.installed;
                if (!tsInstalled && !cfdInstalled && activeServer) return null;
                if (!tsInstalled && !cfdInstalled && !activeServer) return null;
                return (
                  <div className="space-y-4">
                    {tsInstalled && (
                      <div className="glass-card p-5 space-y-3 border border-blue-500/20">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">🔒</span>
                          <h3 className="font-semibold text-sm">Tailscale Management</h3>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {[
                            { key: "ts-status",   label: "Status",       cmd: "tailscale status 2>&1" },
                            { key: "ts-up",       label: "Connect",      cmd: "tailscale up --accept-routes 2>&1; echo; echo 'Tip: if you see an auth URL above, open it in a browser to authenticate this node.'" },
                            { key: "ts-down",     label: "Disconnect",   cmd: "tailscale down 2>&1" },
                            { key: "ts-ip",       label: "Show IP",      cmd: "tailscale ip 2>&1" },
                            { key: "ts-routes",   label: "Routes Info",  cmd: "tailscale status --json 2>&1 | python3 -c \"import sys,json; d=json.load(sys.stdin); [print(k,':',v) for k,v in d.items() if k in ['BackendState','TailscaleIPs','Self']]\" 2>/dev/null || tailscale status 2>&1" },
                          ].map(({ key, label, cmd }) => (
                            <button
                              key={key}
                              onClick={() => runCloudCmd(key, cmd)}
                              disabled={!!cloudLoading}
                              className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] disabled:opacity-50 transition-colors"
                            >
                              {cloudLoading === key ? <Loader2 size={11} className="animate-spin" /> : null}
                              {label}
                            </button>
                          ))}
                        </div>
                        {Object.entries(cloudOutput).filter(([k]) => k.startsWith("ts-")).map(([k, v]) =>
                          v ? (
                            <div key={k}>
                              {cloudOutput["ts-up"] && k === "ts-up" && cloudOutput["ts-up"].includes("https://") && (
                                <div className="flex items-start gap-2 p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-[10px] text-blue-300 mb-2">
                                  <span className="shrink-0">💡</span>
                                  <span>An auth URL was returned — open it in a browser to authenticate this node with your Tailscale account. After logging in, run <strong>Status</strong> to confirm it's connected.</span>
                                </div>
                              )}
                              <pre className="text-[10px] font-mono text-[var(--muted)] bg-[var(--foreground)] border border-[var(--line)] rounded-xl p-2.5 max-h-48 overflow-y-auto">{v}</pre>
                            </div>
                          ) : null
                        )}
                        <div className="text-[10px] text-[var(--muted)] space-y-0.5 pt-1 border-t border-[var(--line)]">
                          <p><strong>Tip:</strong> Use <code className="font-mono bg-[var(--foreground)] px-1 rounded">--advertise-routes=10.0.0.0/24</code> to share subnets.</p>
                          <p>Use <code className="font-mono bg-[var(--foreground)] px-1 rounded">--accept-routes</code> to receive routes from other nodes.</p>
                        </div>
                      </div>
                    )}
                    {cfdInstalled && (
                      <div className="glass-card p-5 space-y-3 border border-orange-500/20">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">🌐</span>
                          <h3 className="font-semibold text-sm">Cloudflare Tunnel Management</h3>
                        </div>
                        <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-300 space-y-1">
                          <p><strong>Setup required before starting:</strong></p>
                          <p>1. Run <code className="font-mono bg-[var(--foreground)] px-1 rounded">cloudflared tunnel login</code> to authenticate</p>
                          <p>2. Run <code className="font-mono bg-[var(--foreground)] px-1 rounded">cloudflared tunnel create &lt;name&gt;</code> to create a tunnel</p>
                          <p>3. Configure <code className="font-mono bg-[var(--foreground)] px-1 rounded">~/.cloudflared/config.yml</code> with tunnel ID and ingress rules</p>
                          <p>4. Then start the service below</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {[
                            { key: "cfd-version",  label: "Version",      cmd: "cloudflared --version 2>&1" },
                            { key: "cfd-login",    label: "Login",        cmd: "cloudflared tunnel login 2>&1" },
                            { key: "cfd-tunnels",  label: "List Tunnels", cmd: "cloudflared tunnel list 2>&1" },
                            { key: "cfd-status",   label: "Service Status",cmd: "systemctl status cloudflared 2>&1 | head -30" },
                            { key: "cfd-start",    label: "Start Service", cmd: "systemctl start cloudflared 2>&1 && echo '✓ Started' || (echo '✗ Failed — ensure tunnel is configured in ~/.cloudflared/config.yml first' && systemctl status cloudflared --no-pager 2>&1 | tail -20)" },
                            { key: "cfd-stop",     label: "Stop Service",  cmd: "systemctl stop cloudflared 2>&1 && echo '✓ Stopped'" },
                          ].map(({ key, label, cmd }) => (
                            <button
                              key={key}
                              onClick={() => runCloudCmd(key, cmd)}
                              disabled={!!cloudLoading}
                              className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] disabled:opacity-50 transition-colors"
                            >
                              {cloudLoading === key ? <Loader2 size={11} className="animate-spin" /> : null}
                              {label}
                            </button>
                          ))}
                        </div>
                        {Object.entries(cloudOutput).filter(([k]) => k.startsWith("cfd-")).map(([k, v]) => (
                          v ? (
                            <pre key={k} className="text-[10px] font-mono text-[var(--muted)] bg-[var(--foreground)] border border-[var(--line)] rounded-xl p-2.5 max-h-48 overflow-y-auto">{v}</pre>
                          ) : null
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
              {subTab === "cloud" && activeServer && (() => {
                const wranglerInstalled = tools.find(t => t.id === "wrangler")?.installed;
                if (!wranglerInstalled) return null;
                return (
                  <div className="glass-card p-5 space-y-3 border border-[var(--accent)]/20">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">☁️</span>
                      <h3 className="font-semibold text-sm">Wrangler (Remote)</h3>
                      <span className="text-[10px] text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-full px-2 py-0.5">Requires API Token</span>
                    </div>
                    <p className="text-[11px] text-[var(--muted)]">
                      Wrangler commands on a remote server require a Cloudflare API Token. Enter it below to run commands with the correct credentials.
                    </p>
                    <WranglerRemotePanel activeServer={activeServer} runCloudCmd={runCloudCmd} cloudOutput={cloudOutput} cloudLoading={cloudLoading} />
                  </div>
                );
              })()}
              {subTab === "cloud" && !activeServer && (
                <div className="glass-card p-5 space-y-4 border border-[var(--accent)]/20">
                  <div className="flex items-center gap-2">
                    <Key size={15} className="text-[var(--accent)]" />
                    <h3 className="font-semibold text-sm">Cloudflare Credentials</h3>
                    <span className="text-[10px] text-[var(--muted)] bg-[var(--foreground)] px-2 py-0.5 rounded-full border border-[var(--line)]">persists to ~/.bashrc</span>
                  </div>
                  <p className="text-[11px] text-[var(--muted)]">
                    Store your Cloudflare API token and Account ID so <code className="font-mono bg-[var(--foreground)] px-1 py-0.5 rounded">wrangler</code> works in the terminal without re-entering credentials each time.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-[var(--muted)] mb-1.5 block">API Token</label>
                      <div className="relative">
                        <input
                          type={cfShowToken ? "text" : "password"}
                          value={cfToken}
                          onChange={e => setCfToken(e.target.value)}
                          placeholder="Your Cloudflare API token"
                          className={inp}
                        />
                        <button
                          type="button"
                          onClick={() => setCfShowToken(s => !s)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--main)] transition-colors"
                        >
                          {cfShowToken ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-[var(--muted)] mb-1.5 block">Account ID <span className="text-[10px]">(optional)</span></label>
                      <input
                        value={cfAccountId}
                        onChange={e => setCfAccountId(e.target.value)}
                        placeholder="Your Cloudflare account ID"
                        className={inp}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={saveCfCreds}
                      disabled={cfSaving}
                      className="flex items-center gap-2 px-4 py-2 text-xs rounded-xl bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                    >
                      {cfSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                      {cfSaving ? "Saving..." : "Save & Apply"}
                    </button>
                    {cfToken && (
                      <button
                        onClick={async () => {
                          setCfToken(""); setCfAccountId("");
                          await api.post(`/extras/cloudflare/creds`, { apiToken: "", accountId: "" });
                          toast.success("Credentials cleared");
                          qc.invalidateQueries({ queryKey: ["cf-creds"] });
                        }}
                        className="text-xs text-red-400 hover:text-red-300 transition-colors"
                      >
                        Clear credentials
                      </button>
                    )}
                  </div>
                  {cfCredsQuery.data?.apiToken && (
                    <div className="flex items-center gap-1.5 text-[10px] text-green-400">
                      <CheckCircle2 size={11} /> Credentials saved and active
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── USERS TAB ── */}
      {mainTab === "users" && (
        <div data-aos="fade-up" className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="text-xs text-[var(--muted)]">System users on this server</p>
              {currentUser && (
                <p className="text-[11px] text-[var(--accent)] mt-0.5 font-mono">
                  Connected as: <span className="font-bold">{currentUser}</span>
                  {activeUser && activeUser !== currentUser && (
                    <span className="ml-2 text-amber-400">· Active context: <span className="font-bold">{activeUser}</span></span>
                  )}
                </p>
              )}
            </div>
            <button
              onClick={() => { setUserForm({ username: "", password: "", shell: "/bin/bash", sudo: false, type: "regular", homeDir: "" }); setUserModal("create"); }}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--accent)] text-white text-sm hover:opacity-90 transition-opacity"
            >
              <UserPlus size={14} /> New User
            </button>
          </div>

          <div className="glass-card overflow-hidden">
            {usersQuery.isLoading ? (
              <div className="p-8 text-center">
                <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto" />
              </div>
            ) : userList.length === 0 ? (
              <div className="p-10 text-center text-[var(--muted)]">
                <Users size={36} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">No system users found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="vps-table">
                  <thead>
                    <tr><th>Username</th><th>UID</th><th>Home</th><th>Shell</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {userList.map(user => {
                      const isRoot = user.username === "root";
                      const isActiveCtx = activeUser === user.username;
                      return (
                      <tr key={user.username} className={`${user.isCurrent ? "bg-[var(--accent)]/5" : ""} ${isActiveCtx ? "bg-amber-400/5" : ""}`}>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${
                              user.isCurrent
                                ? "bg-[var(--accent)] text-white"
                                : "bg-[var(--accent)]/10 border border-[var(--accent)]/20 text-[var(--accent)]"
                            }`}>
                              {user.username[0]?.toUpperCase()}
                            </div>
                            <span className="font-medium text-sm">{user.username}</span>
                            {user.isCurrent && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--accent)] text-white uppercase tracking-wide">you</span>
                            )}
                            {isRoot && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400 uppercase tracking-wide">root</span>
                            )}
                            {isActiveCtx && !user.isCurrent && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-400/20 text-amber-400 uppercase tracking-wide">active</span>
                            )}
                            {user.displayName && <span className="text-xs text-[var(--muted)]">({user.displayName})</span>}
                          </div>
                        </td>
                        <td className="font-mono text-xs text-[var(--muted)]">{user.uid}</td>
                        <td className="font-mono text-xs text-[var(--muted)] max-w-[120px] truncate">{user.home}</td>
                        <td className="font-mono text-xs text-[var(--muted)]">{user.shell?.split('/').pop()}</td>
                        <td>
                          <div className="flex items-center gap-1">
                            {isActiveCtx ? (
                              <span className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] text-amber-400 bg-amber-400/10">
                                <UserCheck size={11} /> Active
                              </span>
                            ) : (
                              <button onClick={() => switchToUser(user.username)} className="p-1.5 rounded-lg hover:bg-amber-400/10 text-amber-400 transition-colors" title={`Switch active context to ${user.username}`}>
                                <LogIn size={13} />
                              </button>
                            )}
                            <button onClick={() => openEdit(user)} className="p-1.5 rounded-lg hover:bg-blue-500/10 text-blue-400 transition-colors" title="Edit">
                              <Edit3 size={13} />
                            </button>
                            {!isRoot && (
                              <button onClick={() => { setDeleteTarget(user); setKeepHome(false); }} className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400 transition-colors" title="Delete">
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create/Edit User Modal */}
      <Modal
        isOpen={userModal === "create" || userModal === "edit"}
        onClose={() => { setUserModal(null); setEditTarget(null); }}
        title={userModal === "create" ? "Create System User" : `Edit User: ${editTarget?.username}`}
      >
        <form
          onSubmit={e => {
            e.preventDefault();
            if (userModal === "create") {
              createUserMutation.mutate(userForm);
            } else if (editTarget) {
              const data: any = {};
              if (userForm.password) data.password = userForm.password;
              if (userForm.shell !== editTarget.shell) data.shell = userForm.shell;
              editUserMutation.mutate({ username: editTarget.username, data });
            }
          }}
          className="space-y-4"
        >
          {userModal === "create" && (
            <>
              <div>
                <label className="text-xs text-[var(--muted)] mb-1.5 block">User Type</label>
                <div className="flex gap-2">
                  {(["regular", "sub"] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setUserForm(f => ({ ...f, type: t, shell: t === "sub" ? "/usr/sbin/nologin" : "/bin/bash", sudo: false }))}
                      className={`flex-1 py-2 text-sm rounded-xl border transition-colors ${userForm.type === t ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]" : "border-[var(--line)] text-[var(--muted)] hover:border-[var(--accent)]/50"}`}
                    >
                      {t === "regular" ? "Regular User" : "Sub User"}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-[var(--muted)] mt-1.5">
                  {userForm.type === "sub" ? "SFTP/service account — no shell login, restricted home directory." : "Full shell access with optional sudo privileges."}
                </p>
              </div>
              <div>
                <label className="text-xs text-[var(--muted)] mb-1.5 block">Username</label>
                <input
                  value={userForm.username}
                  onChange={e => setUserForm(f => ({ ...f, username: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') }))}
                  placeholder="username"
                  className={inp}
                  required
                  autoFocus
                />
              </div>
              {userForm.type === "sub" && (
                <div>
                  <label className="text-xs text-[var(--muted)] mb-1.5 block">Home Directory <span className="text-[var(--muted)]">(optional)</span></label>
                  <input
                    value={userForm.homeDir}
                    onChange={e => setUserForm(f => ({ ...f, homeDir: e.target.value }))}
                    placeholder={`/home/${userForm.username || "username"}`}
                    className={inp}
                  />
                </div>
              )}
            </>
          )}
          <div>
            <label className="text-xs text-[var(--muted)] mb-1.5 block">
              {userModal === "edit" ? "New Password (leave blank to keep current)" : "Password"}
            </label>
            <div className="relative">
              <input
                type={showPass ? "text" : "password"}
                value={userForm.password}
                onChange={e => setUserForm(f => ({ ...f, password: e.target.value }))}
                placeholder={userModal === "edit" ? "Leave blank to keep current" : "Password"}
                className={`${inp} pr-10`}
                required={userModal === "create"}
              />
              <button type="button" onClick={() => setShowPass(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--main)] transition-colors">
                {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          {(userModal === "edit" || userForm.type === "regular") && (
            <div>
              <label className="text-xs text-[var(--muted)] mb-1.5 block">Shell</label>
              <select value={userForm.shell} onChange={e => setUserForm(f => ({ ...f, shell: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-[var(--main)] focus:border-[var(--accent)] transition-colors">
                <option value="/bin/bash">/bin/bash</option>
                <option value="/bin/sh">/bin/sh</option>
                <option value="/bin/zsh">/bin/zsh</option>
                <option value="/usr/bin/fish">/usr/bin/fish</option>
                <option value="/sbin/nologin">/sbin/nologin (no login)</option>
              </select>
            </div>
          )}
          {userModal === "create" && userForm.type === "regular" && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={userForm.sudo} onChange={e => setUserForm(f => ({ ...f, sudo: e.target.checked }))}
                className="rounded" />
              <span className="text-sm">Add to sudo group</span>
            </label>
          )}
          <div className="flex gap-2 justify-end pt-1">
            <button type="button" onClick={() => { setUserModal(null); setEditTarget(null); }}
              className="px-4 py-2 text-sm rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors">Cancel</button>
            <button type="submit"
              disabled={createUserMutation.isPending || editUserMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity">
              {createUserMutation.isPending || editUserMutation.isPending
                ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                : <Save size={13} />}
              {userModal === "create" ? "Create User" : "Save Changes"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete User */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteUserMutation.mutate({ username: deleteTarget.username })}
        title="Delete User"
        message={
          <div className="space-y-3">
            <p>Delete user <strong>{deleteTarget?.username}</strong>? This cannot be undone.</p>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input type="checkbox" checked={keepHome} onChange={e => setKeepHome(e.target.checked)} className="rounded" />
              Keep home directory
            </label>
          </div>
        }
        danger
        loading={deleteUserMutation.isPending}
      />

      {/* Output Modal */}
      {outputModal && (
        <Modal isOpen={!!outputModal} onClose={() => setOutputModal(null)} title={outputModal.title} size="xl">
          <pre className="code-block text-[11px] max-h-96 overflow-y-auto whitespace-pre-wrap break-all leading-relaxed">
            {outputModal.output}
          </pre>
        </Modal>
      )}
    </section>
  );
}
