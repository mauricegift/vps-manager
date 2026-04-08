import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Shield, RefreshCw, CheckCircle, XCircle, Play, RotateCcw,
  Plus, Edit3, Trash2, Power, PowerOff, Lock, AlertTriangle,
  ChevronRight, Copy, Check, Terminal
} from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import { toast } from "react-toastify";
import { useTheme } from "@/context/ThemeContext";

type Tab = "configs" | "certs";

interface NginxConfig { name: string; enabled: boolean; }
interface NginxCert { name: string; domains: string[]; expiry?: string; valid: boolean; certPath?: string; keyPath?: string; }
interface NginxStatus { installed: boolean; configOk: boolean; running: boolean; version: string; testOutput: string; }

const inp = "px-3 py-2 text-sm rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-[var(--main)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none transition-colors w-full";

const DEFAULT_CONFIG = (name: string) =>
`server {
    listen 80;
    server_name ${name};

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}`;

export default function NginxPage() {
  const qc = useQueryClient();
  const { theme } = useTheme();
  const dark = theme === "dark";

  const [tab, setTab] = useState<Tab>("configs");
  const [outputModal, setOutputModal] = useState<{ title: string; output: string } | null>(null);

  // Config state
  const [editConfig, setEditConfig] = useState<{ name: string; content: string } | null>(null);
  const [newConfigModal, setNewConfigModal] = useState(false);
  const [newConfigName, setNewConfigName] = useState("");
  const [deleteConfig, setDeleteConfig] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [copied, setCopied] = useState(false);

  // Cert state
  const [issueModal, setIssueModal] = useState(false);
  const [issueForm, setIssueForm] = useState({ domains: "", email: "", method: "webroot", webrootPath: "/var/www/html" });
  const [deleteCert, setDeleteCert] = useState<string | null>(null);
  const [renewingCert, setRenewingCert] = useState<string | null>(null);

  // Status
  const { data: status, refetch: refetchStatus } = useQuery<NginxStatus>({
    queryKey: ["nginx-status"],
    queryFn: () => api.get("/nginx/status").then(r => r.data),
    refetchInterval: 30000,
  });

  // Configs
  const { data: configs = [], refetch: refetchConfigs, isLoading: loadingConfigs } = useQuery<NginxConfig[]>({
    queryKey: ["nginx-configs"],
    queryFn: () => api.get("/nginx/configs").then(r => r.data.data),
    enabled: tab === "configs",
  });

  // Certs
  const { data: certsData, refetch: refetchCerts, isLoading: loadingCerts } = useQuery<{ data: NginxCert[]; raw: string }>({
    queryKey: ["nginx-certs"],
    queryFn: () => api.get("/nginx/certs").then(r => r.data),
    enabled: tab === "certs",
  });
  const certs = certsData?.data ?? [];

  const testMutation = useMutation({
    mutationFn: () => api.post("/nginx/test"),
    onSuccess: (r) => {
      setOutputModal({ title: "Nginx Config Test", output: r.data.output });
      refetchStatus();
    },
  });

  const reloadMutation = useMutation({
    mutationFn: () => api.post("/nginx/reload"),
    onSuccess: (r) => {
      toast.success("Nginx reloaded");
      setOutputModal({ title: "Nginx Reload", output: r.data.output });
      refetchStatus();
    },
    onError: () => toast.error("Reload failed"),
  });

  const restartMutation = useMutation({
    mutationFn: () => api.post("/nginx/restart"),
    onSuccess: (r) => {
      toast.success("Nginx restarted");
      setOutputModal({ title: "Nginx Restart", output: r.data.output });
      refetchStatus();
    },
    onError: () => toast.error("Restart failed"),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ name, enable }: { name: string; enable: boolean }) =>
      api.post(`/nginx/configs/${name}/${enable ? "enable" : "disable"}`),
    onSuccess: (r, { enable, name }) => {
      toast.success(`${name} ${enable ? "enabled" : "disabled"}`);
      if (r.data.output) setOutputModal({ title: `${enable ? "Enable" : "Disable"}: ${name}`, output: r.data.output });
      refetchConfigs();
    },
    onError: (_, { name }) => toast.error(`Failed to toggle ${name}`),
  });

  const deleteConfigMutation = useMutation({
    mutationFn: (name: string) => api.delete(`/nginx/configs/${name}`),
    onSuccess: (_, name) => { toast.success(`${name} deleted`); setDeleteConfig(null); refetchConfigs(); },
    onError: () => toast.error("Delete failed"),
  });

  const newConfigMutation = useMutation({
    mutationFn: ({ name, content }: { name: string; content: string }) =>
      api.post("/nginx/configs", { name, content }),
    onSuccess: (_, { name }) => {
      toast.success(`${name} created`);
      setNewConfigModal(false);
      setNewConfigName("");
      refetchConfigs();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Failed to create config"),
  });

  const saveConfigMutation = useMutation({
    mutationFn: ({ name, content }: { name: string; content: string }) =>
      api.put(`/nginx/configs/${name}`, { content }),
    onSuccess: (_, { name }) => { toast.success(`${name} saved`); setEditConfig(null); },
    onError: () => toast.error("Save failed"),
  });

  const issueMutation = useMutation({
    mutationFn: (form: typeof issueForm) =>
      api.post("/nginx/certs/issue", {
        domains: form.domains.split(/[\s,]+/).filter(Boolean),
        email: form.email,
        method: form.method,
        webrootPath: form.webrootPath,
      }),
    onSuccess: (r) => {
      setIssueModal(false);
      setOutputModal({ title: "Issue Certificate", output: r.data.output });
      if (r.data.ok) toast.success("Certificate issued!");
      else toast.warning("Check output for details");
      refetchCerts();
    },
    onError: () => toast.error("Failed to issue certificate"),
  });

  const deleteCertMutation = useMutation({
    mutationFn: (name: string) => api.delete(`/nginx/certs/${name}`),
    onSuccess: (r, name) => {
      toast.success(`${name} deleted`);
      setDeleteCert(null);
      setOutputModal({ title: `Delete Cert: ${name}`, output: r.data.output });
      refetchCerts();
    },
    onError: () => toast.error("Failed to delete certificate"),
  });

  async function openEdit(name: string) {
    setSavingConfig(false);
    try {
      const r = await api.get(`/nginx/configs/${name}`);
      setEditContent(r.data.content);
      setEditConfig({ name, content: r.data.content });
    } catch { toast.error("Failed to load config"); }
  }

  async function renewCert(name: string) {
    setRenewingCert(name);
    try {
      const r = await api.post("/nginx/certs/renew", { name });
      setOutputModal({ title: `Renew: ${name}`, output: r.data.output });
      if (!r.data.ok) toast.warning("Renewal may have failed — check output");
      else toast.success(`${name} renewed`);
      refetchCerts();
    } catch { toast.error("Renewal failed"); }
    finally { setRenewingCert(null); }
  }

  async function renewAll() {
    setRenewingCert("__all__");
    try {
      const r = await api.post("/nginx/certs/renew", {});
      setOutputModal({ title: "Renew All Certificates", output: r.data.output });
      toast.success("Renewal completed");
      refetchCerts();
    } catch { toast.error("Renewal failed"); }
    finally { setRenewingCert(null); }
  }

  const cardBorder = dark ? "border-[var(--line)]" : "border-[var(--line)]";
  const termBg  = dark ? "#111" : "#f5f5f5";
  const termFg  = dark ? "#4ec994" : "#16803c";
  const termBorder = dark ? "#222" : "#d1d5db";

  return (
    <section className="main py-6 space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield size={22} className="text-[var(--accent)]" />
            Nginx & SSL
          </h1>
          <p className="text-sm text-[var(--muted)] mt-0.5">Manage nginx configs and Let's Encrypt certificates</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => { refetchStatus(); refetchConfigs(); refetchCerts(); }}
            className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
          >
            <RefreshCw size={13} /> Refresh
          </button>
          <button
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
            className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
          >
            <Terminal size={13} /> Test Config
          </button>
          <button
            onClick={() => reloadMutation.mutate()}
            disabled={reloadMutation.isPending}
            className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
          >
            <RotateCcw size={13} /> Reload
          </button>
          <button
            onClick={() => restartMutation.mutate()}
            disabled={restartMutation.isPending}
            className="btn-primary flex items-center gap-1.5 text-sm px-3 py-1.5"
          >
            <Play size={13} /> Restart
          </button>
        </div>
      </div>

      {/* Status Bar */}
      {status && (
        <div className="card p-4 flex flex-wrap gap-4">
          <div className="flex items-center gap-2">
            {status.installed
              ? <CheckCircle size={15} className="text-green-500" />
              : <XCircle size={15} className="text-red-500" />}
            <span className="text-sm font-medium">
              {status.installed ? "Nginx installed" : "Nginx not installed"}
            </span>
            {status.version && (
              <span className="text-xs text-[var(--muted)] font-mono">
                {status.version.match(/[\d.]+/)?.[0]}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {status.running
              ? <CheckCircle size={15} className="text-green-500" />
              : <XCircle size={15} className="text-red-500" />}
            <span className="text-sm font-medium">{status.running ? "Running" : "Stopped"}</span>
          </div>
          <div className="flex items-center gap-2">
            {status.configOk
              ? <CheckCircle size={15} className="text-green-500" />
              : <AlertTriangle size={15} className="text-amber-500" />}
            <span className="text-sm font-medium">{status.configOk ? "Config OK" : "Config error"}</span>
            {!status.configOk && (
              <button
                onClick={() => setOutputModal({ title: "Config Error", output: status.testOutput })}
                className="text-xs text-[var(--accent)] hover:underline"
              >view</button>
            )}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--line)]">
        {([["configs", "Configs", Shield], ["certs", "SSL Certificates", Lock]] as const).map(([t, label, Icon]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--muted)] hover:text-[var(--main)]"
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {/* ── Configs Tab ── */}
      {tab === "configs" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--muted)]">{configs.length} configuration file{configs.length !== 1 ? "s" : ""}</p>
            <button
              onClick={() => setNewConfigModal(true)}
              className="btn-primary flex items-center gap-1.5 text-sm px-3 py-1.5"
            >
              <Plus size={13} /> New Config
            </button>
          </div>

          {loadingConfigs ? (
            <div className="card p-8 text-center text-[var(--muted)] text-sm">Loading configs...</div>
          ) : configs.length === 0 ? (
            <div className="card p-10 text-center space-y-2">
              <Shield size={32} className="mx-auto text-[var(--muted)] opacity-40" />
              <p className="text-[var(--muted)] text-sm">No configs found in /etc/nginx/sites-available</p>
              <button onClick={() => setNewConfigModal(true)} className="btn-primary text-sm px-4 py-2 mt-2">
                Create First Config
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {configs.map(cfg => (
                <div key={cfg.name} className={`card p-4 flex items-center gap-3 ${cardBorder}`}>
                  <div className={`w-2 h-2 rounded-full shrink-0 ${cfg.enabled ? "bg-green-500" : "bg-zinc-400"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-medium truncate">{cfg.name}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        cfg.enabled
                          ? "bg-green-500/10 text-green-600 dark:text-green-400"
                          : "bg-zinc-200 dark:bg-zinc-700 text-zinc-500"
                      }`}>
                        {cfg.enabled ? "enabled" : "disabled"}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--muted)] mt-0.5">/etc/nginx/sites-available/{cfg.name}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => toggleMutation.mutate({ name: cfg.name, enable: !cfg.enabled })}
                      disabled={toggleMutation.isPending}
                      title={cfg.enabled ? "Disable" : "Enable"}
                      className={`p-1.5 rounded-lg transition-colors text-xs font-medium flex items-center gap-1 px-2.5 ${
                        cfg.enabled
                          ? "bg-amber-500/10 text-amber-600 hover:bg-amber-500/20"
                          : "bg-green-500/10 text-green-600 hover:bg-green-500/20"
                      }`}
                    >
                      {cfg.enabled ? <PowerOff size={12} /> : <Power size={12} />}
                      {cfg.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      onClick={() => openEdit(cfg.name)}
                      className="p-1.5 rounded-lg bg-[var(--foreground)] hover:bg-[var(--line)] transition-colors text-[var(--muted)] hover:text-[var(--main)]"
                      title="Edit"
                    >
                      <Edit3 size={13} />
                    </button>
                    <button
                      onClick={() => setDeleteConfig(cfg.name)}
                      className="p-1.5 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Certs Tab ── */}
      {tab === "certs" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm text-[var(--muted)]">{certs.length} certificate{certs.length !== 1 ? "s" : ""}</p>
            <div className="flex gap-2">
              <button
                onClick={renewAll}
                disabled={!!renewingCert}
                className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
              >
                <RotateCcw size={13} className={renewingCert === "__all__" ? "animate-spin" : ""} />
                Renew All
              </button>
              <button
                onClick={() => setIssueModal(true)}
                className="btn-primary flex items-center gap-1.5 text-sm px-3 py-1.5"
              >
                <Plus size={13} /> Issue Certificate
              </button>
            </div>
          </div>

          {loadingCerts ? (
            <div className="card p-8 text-center text-[var(--muted)] text-sm">Loading certificates...</div>
          ) : certs.length === 0 ? (
            <div className="card p-10 text-center space-y-2">
              <Lock size={32} className="mx-auto text-[var(--muted)] opacity-40" />
              <p className="text-[var(--muted)] text-sm">No certificates found</p>
              <p className="text-xs text-[var(--muted)]">Certbot may not be installed, or no certs have been issued yet.</p>
              <button onClick={() => setIssueModal(true)} className="btn-primary text-sm px-4 py-2 mt-2">
                Issue First Certificate
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {certs.map(cert => (
                <div key={cert.name} className="card p-4">
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 shrink-0 ${cert.valid ? "text-green-500" : "text-red-500"}`}>
                      {cert.valid ? <CheckCircle size={16} /> : <XCircle size={16} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{cert.name}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          cert.valid
                            ? "bg-green-500/10 text-green-600 dark:text-green-400"
                            : "bg-red-500/10 text-red-500"
                        }`}>
                          {cert.valid ? "VALID" : "EXPIRED"}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {cert.domains.map(d => (
                          <span key={d} className="text-[11px] px-2 py-0.5 bg-[var(--foreground)] border border-[var(--line)] rounded-full font-mono text-[var(--muted)]">
                            {d}
                          </span>
                        ))}
                      </div>
                      {cert.expiry && (
                        <p className="text-xs text-[var(--muted)] mt-1.5">
                          Expires: <span className={cert.valid ? "" : "text-red-500 font-medium"}>{cert.expiry}</span>
                        </p>
                      )}
                      {cert.certPath && (
                        <p className="text-[10px] text-[var(--muted)] font-mono mt-0.5 truncate">{cert.certPath}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => renewCert(cert.name)}
                        disabled={!!renewingCert}
                        className="text-xs px-2.5 py-1.5 rounded-lg bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors flex items-center gap-1 font-medium"
                      >
                        <RotateCcw size={11} className={renewingCert === cert.name ? "animate-spin" : ""} />
                        Renew
                      </button>
                      <button
                        onClick={() => setDeleteCert(cert.name)}
                        className="p-1.5 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
                        title="Delete certificate"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Config Editor Modal ── */}
      <Modal
        isOpen={!!editConfig}
        onClose={() => setEditConfig(null)}
        title={`Edit: ${editConfig?.name}`}
        size="xl"
      >
        {editConfig && (
          <div className="space-y-3">
            <div className="relative">
              <button
                onClick={() => { navigator.clipboard.writeText(editContent); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                className="absolute top-2 right-2 p-1.5 rounded-lg bg-[var(--foreground)] text-[var(--muted)] hover:text-[var(--main)] transition-colors z-10"
                title="Copy"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
              <textarea
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                className="w-full font-mono text-[12px] leading-relaxed rounded-xl p-4 pr-10 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
                style={{
                  background: termBg, color: dark ? "#cdd6f4" : "#1a1a1a",
                  border: `1px solid ${termBorder}`,
                  minHeight: "400px",
                }}
                spellCheck={false}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditConfig(null)} className="btn-secondary px-4 py-2 text-sm">Cancel</button>
              <button
                onClick={() => saveConfigMutation.mutate({ name: editConfig.name, content: editContent })}
                disabled={saveConfigMutation.isPending}
                className="btn-primary px-4 py-2 text-sm"
              >
                {saveConfigMutation.isPending ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── New Config Modal ── */}
      <Modal isOpen={newConfigModal} onClose={() => { setNewConfigModal(false); setNewConfigName(""); }} title="New Nginx Config">
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-[var(--muted)] mb-1.5">Config name (e.g. mysite.com)</label>
            <input
              className={inp}
              value={newConfigName}
              onChange={e => setNewConfigName(e.target.value)}
              placeholder="mysite.com"
              autoFocus
            />
          </div>
          <p className="text-xs text-[var(--muted)]">A proxy-pass template will be pre-filled. You can edit it after creation.</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setNewConfigModal(false)} className="btn-secondary px-4 py-2 text-sm">Cancel</button>
            <button
              onClick={() => newConfigMutation.mutate({ name: newConfigName, content: DEFAULT_CONFIG(newConfigName) })}
              disabled={!newConfigName.trim() || newConfigMutation.isPending}
              className="btn-primary px-4 py-2 text-sm"
            >
              {newConfigMutation.isPending ? "Creating..." : "Create"}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Delete Config Modal ── */}
      <Modal isOpen={!!deleteConfig} onClose={() => setDeleteConfig(null)} title="Delete Config">
        {deleteConfig && (
          <div className="space-y-4">
            <p className="text-sm text-[var(--muted)]">
              Are you sure you want to delete <span className="font-mono font-medium text-[var(--main)]">{deleteConfig}</span>?
              This will also remove the symlink from sites-enabled.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteConfig(null)} className="btn-secondary px-4 py-2 text-sm">Cancel</button>
              <button
                onClick={() => deleteConfigMutation.mutate(deleteConfig)}
                disabled={deleteConfigMutation.isPending}
                className="px-4 py-2 text-sm rounded-xl bg-red-500 text-white hover:bg-red-600 transition-colors"
              >
                {deleteConfigMutation.isPending ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Issue Certificate Modal ── */}
      <Modal isOpen={issueModal} onClose={() => setIssueModal(false)} title="Issue SSL Certificate" size="lg">
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-[var(--muted)] mb-1.5">Domains (space or comma separated)</label>
            <input
              className={inp}
              value={issueForm.domains}
              onChange={e => setIssueForm(f => ({ ...f, domains: e.target.value }))}
              placeholder="example.com www.example.com"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--muted)] mb-1.5">Email (for Let's Encrypt notifications)</label>
            <input
              className={inp}
              type="email"
              value={issueForm.email}
              onChange={e => setIssueForm(f => ({ ...f, email: e.target.value }))}
              placeholder="admin@example.com"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--muted)] mb-1.5">Verification method</label>
            <div className="flex gap-2">
              {[["webroot", "Webroot (nginx running)"], ["standalone", "Standalone (no web server)"]].map(([v, l]) => (
                <button
                  key={v}
                  onClick={() => setIssueForm(f => ({ ...f, method: v }))}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
                    issueForm.method === v
                      ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                      : "border-[var(--line)] text-[var(--muted)] hover:border-[var(--accent)]"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          {issueForm.method === "webroot" && (
            <div>
              <label className="block text-xs text-[var(--muted)] mb-1.5">Webroot path</label>
              <input
                className={inp}
                value={issueForm.webrootPath}
                onChange={e => setIssueForm(f => ({ ...f, webrootPath: e.target.value }))}
                placeholder="/var/www/html"
              />
            </div>
          )}
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-700 dark:text-amber-400 flex gap-2">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <span>Make sure port 80 is open and your domain's DNS points to this server. Standalone mode temporarily stops nginx.</span>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setIssueModal(false)} className="btn-secondary px-4 py-2 text-sm">Cancel</button>
            <button
              onClick={() => issueMutation.mutate(issueForm)}
              disabled={!issueForm.domains.trim() || !issueForm.email.trim() || issueMutation.isPending}
              className="btn-primary px-4 py-2 text-sm"
            >
              {issueMutation.isPending ? "Issuing..." : "Issue Certificate"}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Delete Cert Modal ── */}
      <Modal isOpen={!!deleteCert} onClose={() => setDeleteCert(null)} title="Delete Certificate">
        {deleteCert && (
          <div className="space-y-4">
            <p className="text-sm text-[var(--muted)]">
              Permanently delete certificate <span className="font-medium text-[var(--main)]">{deleteCert}</span>?
              This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteCert(null)} className="btn-secondary px-4 py-2 text-sm">Cancel</button>
              <button
                onClick={() => deleteCertMutation.mutate(deleteCert)}
                disabled={deleteCertMutation.isPending}
                className="px-4 py-2 text-sm rounded-xl bg-red-500 text-white hover:bg-red-600 transition-colors"
              >
                {deleteCertMutation.isPending ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Output Modal ── */}
      {outputModal && (
        <Modal isOpen onClose={() => setOutputModal(null)} title={outputModal.title} size="xl">
          <pre
            className="text-[11px] font-mono rounded-xl p-4 overflow-auto max-h-96 whitespace-pre-wrap leading-relaxed"
            style={{ background: termBg, color: termFg, border: `1px solid ${termBorder}` }}
          >
            {outputModal.output}
          </pre>
        </Modal>
      )}
    </section>
  );
}
