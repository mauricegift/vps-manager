import { useState, useEffect } from "react";
import AOS from "aos";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Download, RefreshCw, ArrowUpCircle, CheckCircle2, XCircle,
  UserPlus, Edit3, Trash2, Eye, EyeOff, Users, Package, ShieldAlert, Save
} from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { toast } from "react-toastify";
import { useRemoteServer } from "@/context/RemoteServerContext";

const NODE_VERSIONS = ["18", "20", "22", "24"];

interface Tool {
  id: string; name: string; icon: string; description: string;
  installed: boolean; version: string | null; path?: string | null;
  latestVersion?: string | null; updateAvailable?: boolean;
  running?: boolean; canSelectVersion?: boolean;
  category?: 'runtime' | 'server' | 'tool';
}

interface User {
  username: string; uid: number; displayName?: string; home?: string; shell?: string;
}

function VersionChip({ version, label }: { version: string | null; label?: string }) {
  if (!version) return null;
  return (
    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--foreground)] border border-[var(--line)] text-[var(--muted)]">
      {label}{version}
    </span>
  );
}

function ToolCard({
  tool, onInstall, onUpdate, loading
}: {
  tool: Tool;
  onInstall: (nodeVersion?: string) => void;
  onUpdate: () => void;
  loading: boolean;
}) {
  const [nodeVer, setNodeVer] = useState("20");
  const nginxRunning = tool.id === "nginx" && tool.running;
  const apacheRunning = tool.id === "apache" && tool.running;

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

      {/* Version + path */}
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

      {/* Conflict warning */}
      {(tool.id === "apache" && nginxRunning) || (tool.id === "nginx" && apacheRunning) ? null : null}
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

      {/* Node version select */}
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

      {/* Actions */}
      <div className="flex gap-2 mt-auto pt-1">
        {!tool.installed ? (
          <button
            onClick={() => onInstall(tool.canSelectVersion ? nodeVer : undefined)}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-xl bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {loading ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" /> : <Download size={12} />}
            {loading ? "Installing..." : `Install ${tool.name}`}
          </button>
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
          </>
        )}
      </div>
    </div>
  );
}

const inp = "w-full px-3 py-2 text-sm rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-[var(--main)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] transition-colors";

export default function ExtrasPage() {
  const qc = useQueryClient();
  const { activeServer } = useRemoteServer();
  const pfx = activeServer ? `/remote/${activeServer.id}` : "";

  const [opLoading, setOpLoading] = useState<string | null>(null);
  const [outputModal, setOutputModal] = useState<{ title: string; output: string } | null>(null);

  // User management state
  const [userModal, setUserModal] = useState<"create" | "edit" | null>(null);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [showPass, setShowPass] = useState(false);
  const [userForm, setUserForm] = useState({ username: "", password: "", shell: "/bin/bash", sudo: false });
  const [keepHome, setKeepHome] = useState(false);

  const { data: tools = [], isLoading, refetch, isFetching } = useQuery<Tool[]>({
    queryKey: ["extras", activeServer?.id ?? "local"],
    queryFn: () => api.get(`${pfx}/extras`).then(r => r.data.data),
    staleTime: 60000,
    gcTime: 120000,
  });

  // Refresh AOS after dynamic content loads so fade-up cards are visible
  useEffect(() => {
    if (tools.length > 0) {
      const t = setTimeout(() => AOS.refresh(), 50);
      return () => clearTimeout(t);
    }
  }, [tools.length]);

  const usersQuery = useQuery<User[]>({
    queryKey: ["system-users", activeServer?.id ?? "local"],
    queryFn: () => {
      const url = activeServer ? `/remote/${activeServer.id}/users` : `/extras/users`;
      return api.get(url).then(r => r.data.data);
    },
    staleTime: 10000,
  });

  const handleInstall = async (tool: Tool, nodeVersion?: string) => {
    setOpLoading(`install-${tool.id}`);
    try {
      const url = activeServer
        ? `/remote/${activeServer.id}/extras/${tool.id}/install`
        : `/extras/${tool.id}/install`;
      const { data } = await api.post(url, nodeVersion ? { nodeVersion } : {});
      toast.success(`${tool.name} installed`);
      if (data.output) setOutputModal({ title: `Install ${tool.name}`, output: data.output });
      qc.invalidateQueries({ queryKey: ["extras"] });
    } catch (e: any) {
      toast.error(e.response?.data?.error || `Failed to install ${tool.name}`);
    }
    setOpLoading(null);
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
      qc.invalidateQueries({ queryKey: ["extras"] });
    } catch (e: any) {
      toast.error(e.response?.data?.error || `Failed to update ${tool.name}`);
    }
    setOpLoading(null);
  };

  const createUserMutation = useMutation({
    mutationFn: (form: typeof userForm) => {
      const url = activeServer ? `/remote/${activeServer.id}/users` : `/extras/users`;
      return api.post(url, form);
    },
    onSuccess: () => {
      toast.success("User created");
      setUserModal(null);
      setUserForm({ username: "", password: "", shell: "/bin/bash", sudo: false });
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

  const userList = usersQuery.data || [];

  return (
    <section className="main space-y-8">
      {/* Header */}
      <div data-aos="fade-down" className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Extras</h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            {activeServer
              ? `Software management · ${activeServer.username}@${activeServer.ip}`
              : "Manage software and system users"}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[var(--line)] text-sm hover:bg-[var(--foreground)] disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {/* Software section */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Package size={16} className="text-[var(--accent)]" />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-[var(--muted)]">Software</h2>
        </div>
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
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
        ) : (() => {
          const groups: { label: string; ids: string[] }[] = [
            { label: "Runtimes & Package Managers", ids: ["nodejs","npm","bun","deno","pm2","pnpm","yarn","python","go","rust"] },
            { label: "Servers & SSL", ids: ["nginx","apache","certbot"] },
            { label: "Dev Tools", ids: ["git","curl","wget","rsync","vim","nvim"] },
            { label: "System Tools", ids: ["htop","tmux","screen","ufw","fail2ban-client","jq","unzip"] },
          ];
          return (
            <div className="space-y-6">
              {groups.map(g => {
                const groupTools = tools.filter(t => g.ids.includes(t.id));
                if (groupTools.length === 0) return null;
                return (
                  <div key={g.label}>
                    <p className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-widest mb-3">{g.label}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                      {groupTools.map(tool => (
                        <ToolCard
                          key={tool.id}
                          tool={tool}
                          loading={opLoading === `install-${tool.id}` || opLoading === `update-${tool.id}`}
                          onInstall={(nodeVer) => handleInstall(tool, nodeVer)}
                          onUpdate={() => handleUpdate(tool)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
              {/* Any tools not in groups (future additions) */}
              {(() => {
                const knownIds = ["nodejs","npm","bun","deno","pm2","pnpm","yarn","python","go","rust","nginx","apache","certbot","git","curl","wget","rsync","vim","nvim","htop","tmux","screen","ufw","fail2ban-client","jq","unzip"];
                const extra = tools.filter(t => !knownIds.includes(t.id));
                if (!extra.length) return null;
                return (
                  <div>
                    <p className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-widest mb-3">Other</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                      {extra.map(tool => (
                        <ToolCard key={tool.id} tool={tool}
                          loading={opLoading === `install-${tool.id}` || opLoading === `update-${tool.id}`}
                          onInstall={(nodeVer) => handleInstall(tool, nodeVer)}
                          onUpdate={() => handleUpdate(tool)} />
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })()}
      </div>

      {/* User Management */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-[var(--accent)]" />
            <h2 className="text-sm font-semibold uppercase tracking-widest text-[var(--muted)]">System Users</h2>
          </div>
          <button
            onClick={() => { setUserForm({ username: "", password: "", shell: "/bin/bash", sudo: false }); setUserModal("create"); }}
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
              <p className="text-sm">No system users found (UID 1000+)</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="vps-table">
                <thead>
                  <tr><th>Username</th><th>UID</th><th>Home</th><th>Shell</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {userList.map(user => (
                    <tr key={user.username}>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-[var(--accent)]/10 border border-[var(--accent)]/20 flex items-center justify-center text-[10px] font-bold text-[var(--accent)]">
                            {user.username[0]?.toUpperCase()}
                          </div>
                          <span className="font-medium text-sm">{user.username}</span>
                          {user.displayName && <span className="text-xs text-[var(--muted)]">({user.displayName})</span>}
                        </div>
                      </td>
                      <td className="font-mono text-xs text-[var(--muted)]">{user.uid}</td>
                      <td className="font-mono text-xs text-[var(--muted)] max-w-[120px] truncate">{user.home}</td>
                      <td className="font-mono text-xs text-[var(--muted)]">{user.shell?.split('/').pop()}</td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEdit(user)} className="p-1.5 rounded-lg hover:bg-blue-500/10 text-blue-400 transition-colors" title="Edit">
                            <Edit3 size={13} />
                          </button>
                          <button onClick={() => { setDeleteTarget(user); setKeepHome(false); }} className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400 transition-colors" title="Delete">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

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
          {userModal === "create" && (
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
      <Modal isOpen={!!outputModal} onClose={() => setOutputModal(null)} title={outputModal?.title || ""} size="xl">
        <pre className="text-[11px] font-mono bg-[#1e1e2e] text-[#cdd6f4] p-4 rounded-xl overflow-auto max-h-[60vh] whitespace-pre-wrap leading-relaxed">
          {outputModal?.output}
        </pre>
      </Modal>
    </section>
  );
}
