import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import api from '@/lib/api';
import { VpsConnection } from '@/types/server';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Globe, Plus, Eye, EyeOff, Wifi, Unplug } from 'lucide-react';
import { useRemoteServer } from '@/context/RemoteServerContext';

interface ServerFormData {
  name: string; ip: string; port: number; username: string;
  password: string; ssh_key: string; notes: string; tags: string;
}

const EMPTY_FORM: ServerFormData = { name: '', ip: '', port: 22, username: 'root', password: '', ssh_key: '', notes: '', tags: '' };

function StatusDot({ status }: { status: string }) {
  const color = status === 'online' ? 'bg-green-500' : status === 'offline' ? 'bg-red-500' : 'bg-[var(--muted)]';
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${color} shrink-0`} />;
}

function formatDate(d?: string) {
  if (!d) return 'Never';
  return new Date(d).toLocaleString();
}

const inp = "w-full px-3 py-2 rounded-xl bg-[var(--foreground)] border border-[var(--line)] text-[var(--main)] text-sm focus:outline-none focus:border-[var(--accent)] placeholder:text-[var(--muted)] transition-colors";

export default function Servers() {
  const qc = useQueryClient();
  const { activeServer, connect, disconnect } = useRemoteServer();
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<VpsConnection | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VpsConnection | null>(null);
  const [infoTarget, setInfoTarget] = useState<VpsConnection | null>(null);
  const [remoteInfo, setRemoteInfo] = useState<any>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [form, setForm] = useState<ServerFormData>(EMPTY_FORM);
  const [showPwd, setShowPwd] = useState(false);
  const [activeTab, setActiveTab] = useState<'password' | 'key'>('password');

  const { data, isLoading } = useQuery({
    queryKey: ['vps-connections'],
    queryFn: async () => {
      const r = await api.get('/servers');
      return r.data.data as VpsConnection[];
    },
    refetchInterval: 30000,
  });


  const addMutation = useMutation({
    mutationFn: (body: any) => api.post('/servers', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vps-connections'] });
      toast.success('Server added successfully');
      closeForm();
      setTimeout(() => AOS.refresh(), 100);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to add server'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: any }) => api.put(`/servers/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vps-connections'] });
      toast.success('Server updated');
      closeForm();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to update server'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/servers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vps-connections'] });
      toast.success('Server removed');
      setDeleteTarget(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to delete server'),
  });

  const openAdd = () => { setEditTarget(null); setForm(EMPTY_FORM); setActiveTab('password'); setShowForm(true); };
  const openEdit = (s: VpsConnection) => {
    setEditTarget(s);
    setForm({ name: s.name, ip: s.ip, port: s.port, username: s.username, password: '', ssh_key: '', notes: s.notes || '', tags: s.tags || '' });
    setActiveTab('password');
    setShowForm(true);
  };
  const closeForm = () => { setShowForm(false); setEditTarget(null); setForm(EMPTY_FORM); };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const body: any = { name: form.name, ip: form.ip, port: form.port, username: form.username, notes: form.notes, tags: form.tags };
    if (activeTab === 'key' && form.ssh_key) body.ssh_key = form.ssh_key;
    if (activeTab === 'password' && form.password) body.password = form.password;
    if (editTarget) updateMutation.mutate({ id: editTarget.id, body });
    else addMutation.mutate(body);
  };

  const testConnection = async (s: VpsConnection) => {
    setTestingId(s.id);
    try {
      const r = await api.post(`/servers/${s.id}/test`);
      if (r.data.online) toast.success(`${s.name} is reachable`);
      else toast.error(`${s.name} is unreachable`);
      qc.invalidateQueries({ queryKey: ['vps-connections'] });
    } catch { toast.error('Test failed'); }
    setTestingId(null);
  };

  const viewInfo = async (s: VpsConnection) => {
    setInfoTarget(s);
    setRemoteInfo(null);
    setLoadingInfo(true);
    try {
      const r = await api.get(`/servers/${s.id}/info`);
      setRemoteInfo(r.data.data);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Could not fetch server info');
    }
    setLoadingInfo(false);
  };

  const formatBytes = (b: number) => {
    if (!b) return '0 B';
    const k = 1024; const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return `${(b / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };
  const formatUptime = (s: number) => {
    const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60);
    return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return (
    <section className="main space-y-6">
      <div className="flex items-start justify-between" data-aos="fade-down">
        <div>
          <h1 className="text-2xl font-bold">Remote Servers</h1>
          <p className="text-sm text-[var(--muted)] mt-1">Manage and monitor your remote VPS connections</p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--accent)] hover:opacity-90 text-white text-sm font-medium transition-opacity"
        >
          <Plus size={15} /> Add Server
        </button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-52 rounded-2xl glass-card animate-pulse" />)}
        </div>
      ) : !data || data.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center py-24 text-[var(--muted)]" data-aos="fade-up">
          <Globe size={48} className="mb-4 opacity-30" />
          <p className="text-lg font-medium">No servers yet</p>
          <p className="text-sm mt-1">Click "Add Server" to connect a remote VPS</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((s, i) => (
            <div
              key={s.id}
              className="glass-card p-5 space-y-4 hover:border-[var(--accent)]/30 transition-all duration-300"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-xl bg-[var(--accent)]/10 flex items-center justify-center">
                    <Globe size={18} className="text-[var(--accent)]" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{s.name}</p>
                    <p className="text-xs text-[var(--muted)] font-mono">{s.username}@{s.ip}:{s.port}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <StatusDot status={s.last_status} />
                  <span className="text-xs text-[var(--muted)] capitalize">{s.last_status}</span>
                </div>
              </div>

              {s.notes && (
                <p className="text-xs text-[var(--muted)] italic border-l-2 border-[var(--line)] pl-2">{s.notes}</p>
              )}

              {s.tags && (
                <div className="flex flex-wrap gap-1">
                  {s.tags.split(',').map((t) => (
                    <span key={t} className="px-2 py-0.5 rounded-full bg-[var(--foreground)] border border-[var(--line)] text-xs text-[var(--muted)]">
                      {t.trim()}
                    </span>
                  ))}
                </div>
              )}

              <div className="text-xs text-[var(--muted)] space-y-0.5">
                <p>Added: {formatDate(s.created_at)}</p>
                {s.last_tested && <p>Last tested: {formatDate(s.last_tested)}</p>}
              </div>

              <div className="space-y-2 pt-1">
                {/* Connect / Disconnect button */}
                {activeServer?.id === s.id ? (
                  <button
                    onClick={() => disconnect()}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-orange-500/15 hover:bg-orange-500/25 border border-orange-500/30 text-orange-400 text-xs font-semibold transition-colors"
                  >
                    <Unplug size={13} /> Disconnect from {s.name}
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      connect({ id: s.id, name: s.name, ip: s.ip, username: s.username });
                      toast.success(`Connected to ${s.name} — use the menu to manage it`);
                    }}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-[var(--accent)]/15 hover:bg-[var(--accent)]/25 border border-[var(--accent)]/30 text-[var(--accent)] text-xs font-semibold transition-colors"
                  >
                    <Wifi size={13} /> Connect &amp; Manage
                  </button>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => testConnection(s)} disabled={testingId === s.id}
                    className="px-3 py-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-xs font-medium transition-colors disabled:opacity-50">
                    {testingId === s.id ? 'Testing...' : 'Test SSH'}
                  </button>
                  <button onClick={() => viewInfo(s)}
                    className="px-3 py-1.5 rounded-lg bg-green-500/10 hover:bg-green-500/20 text-green-400 text-xs font-medium transition-colors">
                    View Info
                  </button>
                  <button onClick={() => openEdit(s)}
                    className="px-3 py-1.5 rounded-lg bg-[var(--foreground)] hover:bg-[var(--line)] text-[var(--muted)] text-xs font-medium transition-colors">
                    Edit
                  </button>
                  <button onClick={() => setDeleteTarget(s)}
                    className="px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium transition-colors">
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      <Modal isOpen={showForm} onClose={closeForm} title={editTarget ? `Edit: ${editTarget.name}` : 'Add Remote Server'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs text-[var(--muted)] mb-1.5">Server Name *</label>
              <input required className={`${inp} font-medium`} placeholder="My Production VPS"
                value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs text-[var(--muted)] mb-1.5">IP Address *</label>
              <input required className={`${inp} font-mono`} placeholder="192.168.1.100"
                value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs text-[var(--muted)] mb-1.5">SSH Port</label>
              <input type="number" className={`${inp} font-mono`}
                value={form.port} onChange={(e) => setForm({ ...form, port: parseInt(e.target.value) || 22 })} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-[var(--muted)] mb-1.5">Username</label>
              <input className={`${inp} font-mono`} placeholder="root"
                value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </div>
          </div>

          {/* Auth tabs */}
          <div>
            <div className="flex gap-1 mb-3 p-1 rounded-xl bg-[var(--foreground)] w-fit">
              {(['password', 'key'] as const).map((tab) => (
                <button key={tab} type="button" onClick={() => setActiveTab(tab)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${activeTab === tab ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted)] hover:text-[var(--main)]'}`}>
                  {tab === 'password' ? 'Password' : 'SSH Key'}
                </button>
              ))}
            </div>

            {activeTab === 'password' ? (
              <div>
                <label className="block text-xs text-[var(--muted)] mb-1.5">
                  Password {editTarget && <span className="opacity-60">(leave blank to keep existing)</span>}
                </label>
                <div className="relative">
                  <input
                    type={showPwd ? 'text' : 'password'}
                    className={`${inp} pr-10`}
                    placeholder={editTarget ? '••••••••' : 'Enter password'}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                  />
                  <button type="button" onClick={() => setShowPwd(!showPwd)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--main)] transition-colors">
                    {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-xs text-[var(--muted)] mb-1.5">
                  Private Key (PEM) {editTarget && <span className="opacity-60">(leave blank to keep existing)</span>}
                </label>
                <textarea rows={4} className={`${inp} text-xs font-mono resize-none`}
                  placeholder={"-----BEGIN RSA PRIVATE KEY-----\n..."}
                  value={form.ssh_key} onChange={(e) => setForm({ ...form, ssh_key: e.target.value })} />
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs text-[var(--muted)] mb-1.5">Tags (comma-separated)</label>
            <input className={inp} placeholder="production, web, nginx"
              value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs text-[var(--muted)] mb-1.5">Notes</label>
            <textarea rows={2} className={`${inp} resize-none`} placeholder="Any notes about this server..."
              value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={closeForm}
              className="flex-1 px-4 py-2 rounded-xl border border-[var(--line)] text-[var(--muted)] text-sm hover:bg-[var(--foreground)] transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={addMutation.isPending || updateMutation.isPending}
              className="flex-1 px-4 py-2 rounded-xl bg-[var(--accent)] hover:opacity-90 text-white text-sm font-medium transition-opacity disabled:opacity-50">
              {addMutation.isPending || updateMutation.isPending ? 'Saving...' : editTarget ? 'Update Server' : 'Add Server'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Remote Info Modal */}
      <Modal isOpen={!!infoTarget} onClose={() => { setInfoTarget(null); setRemoteInfo(null); }}
        title={`${infoTarget?.name} — System Info`}>
        {loadingInfo ? (
          <div className="py-12 flex flex-col items-center gap-3 text-[var(--muted)]">
            <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Connecting via SSH...</span>
          </div>
        ) : remoteInfo ? (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Hostname', remoteInfo.os?.hostname],
                ['OS', remoteInfo.os?.distro],
                ['Kernel', remoteInfo.os?.kernel],
                ['Arch', remoteInfo.os?.arch],
                ['Uptime', formatUptime(remoteInfo.uptime)],
                ['Load Avg', `${remoteInfo.load?.avg1?.toFixed(2)} / ${remoteInfo.load?.avg5?.toFixed(2)} / ${remoteInfo.load?.avg15?.toFixed(2)}`],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-[var(--foreground)] px-3 py-2">
                  <p className="text-xs text-[var(--muted)]">{k}</p>
                  <p className="font-mono text-xs mt-0.5 truncate">{v || '—'}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-[var(--foreground)] px-3 py-2 col-span-1">
                <p className="text-xs text-[var(--muted)] mb-1">CPU</p>
                <p className="text-2xl font-bold">{remoteInfo.cpu?.load?.toFixed(1)}%</p>
              </div>
              <div className="rounded-xl bg-[var(--foreground)] px-3 py-2 col-span-2">
                <p className="text-xs text-[var(--muted)] mb-1">Memory</p>
                <p className="text-lg font-bold">{remoteInfo.memory?.usedPercent?.toFixed(1)}%</p>
                <p className="text-xs text-[var(--muted)]">{formatBytes(remoteInfo.memory?.used)} / {formatBytes(remoteInfo.memory?.total)}</p>
                <div className="mt-1.5 h-1.5 rounded-full bg-[var(--line)] overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-violet-500 to-red-500 rounded-full"
                    style={{ width: `${Math.min(remoteInfo.memory?.usedPercent || 0, 100)}%` }} />
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-[var(--foreground)] px-3 py-2">
              <p className="text-xs text-[var(--muted)] mb-1">Disk (/)</p>
              <p className="text-lg font-bold">{remoteInfo.disk?.use?.toFixed(1)}%</p>
              <p className="text-xs text-[var(--muted)]">{formatBytes(remoteInfo.disk?.used)} used / {formatBytes(remoteInfo.disk?.total)} total</p>
              <div className="mt-1.5 h-1.5 rounded-full bg-[var(--line)] overflow-hidden">
                <div className="h-full bg-gradient-to-r from-blue-500 to-violet-500 rounded-full"
                  style={{ width: `${Math.min(remoteInfo.disk?.use || 0, 100)}%` }} />
              </div>
            </div>
          </div>
        ) : (
          <p className="text-center text-[var(--muted)] py-8 text-sm">Could not retrieve system info</p>
        )}
      </Modal>

      {/* Delete confirm */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Remove Server"
        message={`Remove "${deleteTarget?.name}" from your server list? The connection credentials will be deleted.`}
        confirmLabel="Remove"
        danger
      />
    </section>
  );
}
