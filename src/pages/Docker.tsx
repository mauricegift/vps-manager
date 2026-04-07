import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Container, Play, Square, RotateCcw, Trash2,
  RefreshCw, Image, Layers, FileText, Download, AlertCircle, ArrowUpCircle
} from "lucide-react";
import api from "@/lib/api";
import StatusBadge from "@/components/ui/StatusBadge";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Modal from "@/components/ui/Modal";
import type { DockerContainer, DockerImage, DockerCompose } from "@/types";
import { toast } from "react-toastify";
import { useRemoteServer } from "@/context/RemoteServerContext";

function fmtSize(b: number) {
  if (b > 1e9) return (b / 1e9).toFixed(1) + " GB";
  if (b > 1e6) return (b / 1e6).toFixed(1) + " MB";
  return (b / 1e3).toFixed(1) + " KB";
}

type Tab = "containers" | "images" | "compose";

export default function DockerPage() {
  const qc = useQueryClient();
  const { activeServer } = useRemoteServer();
  const [tab, setTab] = useState<Tab>("containers");
  const [confirm, setConfirm] = useState<{ action: string; id: string; name: string } | null>(null);
  const [logs, setLogs] = useState<{ name: string; content: string } | null>(null);
  const [pullModal, setPullModal] = useState(false);
  const [pullImage, setPullImage] = useState("");

  const { data: versionInfo } = useQuery({
    queryKey: ["docker-version", activeServer?.id ?? "local"],
    queryFn: () => {
      const url = activeServer ? `/remote/${activeServer.id}/extras/docker-version` : "/extras/docker-version";
      return api.get(url).then(r => r.data.data).catch(() => null);
    },
    staleTime: 60000,
  });

  const containers = useQuery<DockerContainer[]>({
    queryKey: ["docker-containers"],
    queryFn: () => api.get("/docker/containers").then(r => r.data.data),
    refetchInterval: 6000,
  });

  const images = useQuery<DockerImage[]>({
    queryKey: ["docker-images"],
    queryFn: () => api.get("/docker/images").then(r => r.data.data),
    enabled: tab === "images",
  });

  const compose = useQuery<DockerCompose[]>({
    queryKey: ["docker-compose"],
    queryFn: () => api.get("/docker/compose").then(r => r.data.data),
    enabled: tab === "compose",
  });

  const containerMutation = useMutation({
    mutationFn: ({ action, id }: { action: string; id: string }) =>
      api.post(`/docker/containers/${id}/${action}`),
    onSuccess: (_, { action }) => {
      toast.success(`Container ${action}ed`);
      qc.invalidateQueries({ queryKey: ["docker-containers"] });
      setConfirm(null);
    },
    onError: () => toast.error("Action failed"),
  });

  const imageMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/docker/images/${id}`),
    onSuccess: () => {
      toast.success("Image removed");
      qc.invalidateQueries({ queryKey: ["docker-images"] });
      setConfirm(null);
    },
    onError: () => toast.error("Failed to remove image"),
  });

  const pullMutation = useMutation({
    mutationFn: (image: string) => api.post("/docker/images/pull", { image }),
    onSuccess: () => {
      toast.success("Image pulled");
      qc.invalidateQueries({ queryKey: ["docker-images"] });
      setPullModal(false);
      setPullImage("");
    },
    onError: () => toast.error("Failed to pull image"),
  });

  const composeMutation = useMutation({
    mutationFn: ({ action, path }: { action: string; path: string }) =>
      api.post(`/docker/compose/${action}`, { path }),
    onSuccess: (_, { action }) => {
      toast.success(`Compose ${action}ed`);
      qc.invalidateQueries({ queryKey: ["docker-compose"] });
    },
    onError: () => toast.error("Action failed"),
  });

  const viewContainerLogs = async (id: string, name: string) => {
    try {
      const { data } = await api.get(`/docker/containers/${id}/logs`);
      setLogs({ name, content: data.data });
    } catch { toast.error("Failed to fetch logs"); }
  };

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "containers", label: "Containers", icon: Container },
    { id: "images", label: "Images", icon: Image },
    { id: "compose", label: "Compose", icon: Layers },
  ];

  return (
    <section className="main space-y-6">
      <div data-aos="fade-down" className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold">Docker</h1>
            {versionInfo?.docker?.version && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-[var(--foreground)] border border-[var(--line)] text-[var(--muted)]">
                  Docker v{versionInfo.docker.version}
                </span>
                {versionInfo.compose?.version && (
                  <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-[var(--foreground)] border border-[var(--line)] text-[var(--muted)]">
                    Compose v{versionInfo.compose.version}
                  </span>
                )}
                {(versionInfo.docker.updateAvailable || versionInfo.compose?.updateAvailable) && (
                  <a href="/extras" className="text-[10px] flex items-center gap-1 text-amber-400 hover:underline">
                    <ArrowUpCircle size={11} /> update available
                  </a>
                )}
              </div>
            )}
          </div>
          <p className="text-sm text-[var(--muted)] mt-1">Containers, images & compose projects</p>
        </div>
        <div className="flex gap-2">
          {tab === "images" && (
            <button onClick={() => setPullModal(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--accent)] text-white text-sm hover:opacity-90 transition-opacity">
              <Download size={14} /> Pull Image
            </button>
          )}
          <button
            onClick={() => { containers.refetch(); images.refetch(); compose.refetch(); }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[var(--line)] text-sm hover:bg-[var(--foreground)] transition-colors"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div data-aos="fade-up" className="overflow-x-auto hide-scrollbar">
        <div className="flex gap-1 p-1 rounded-xl bg-[var(--secondary)] border border-[var(--line)] w-fit min-w-full sm:min-w-0">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                tab === id ? "bg-[var(--accent)] text-white shadow-sm" : "text-[var(--muted)] hover:text-[var(--main)]"
              }`}
            >
              <Icon size={14} />
              {label}
              {id === "containers" && !containers.isLoading && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${tab === id ? "bg-white/20" : "bg-[var(--foreground)]"}`}>
                  {(containers.data || []).length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Containers Tab */}
      {tab === "containers" && (
        <div data-aos="fade-up">
          {containers.isLoading ? (
            <div className="glass-card p-8 text-center"><div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto" /></div>
          ) : !containers.data?.length ? (
            <div className="glass-card p-12 text-center text-[var(--muted)]">
              <Container size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">No Docker containers found</p>
            </div>
          ) : (
            <div className="glass-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="vps-table">
                  <thead>
                    <tr><th>Name</th><th>Image</th><th>Status</th><th>Ports</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {containers.data.map((c) => {
                      const name = c.Names[0]?.replace(/^\//, "") || c.Id.slice(0, 12);
                      return (
                        <tr key={c.Id}>
                          <td>
                            <div className="font-medium text-sm">{name}</div>
                            <div className="text-[10px] text-[var(--muted)] font-mono">{c.Id.slice(0, 12)}</div>
                          </td>
                          <td className="text-sm font-mono text-[var(--muted)] max-w-[160px] truncate">{c.Image}</td>
                          <td><StatusBadge status={c.State} /></td>
                          <td>
                            <div className="flex flex-wrap gap-1">
                              {(c.Ports || []).filter(p => p.PublicPort).slice(0, 3).map((p, i) => (
                                <span key={i} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--foreground)] border border-[var(--line)]">
                                  {p.PublicPort}:{p.PrivatePort}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td>
                            <div className="flex items-center gap-1">
                              {c.State !== "running" ? (
                                <button onClick={() => setConfirm({ action: "start", id: c.Id, name })} className="p-1.5 rounded-lg hover:bg-green-500/10 text-green-400 transition-colors"><Play size={14} /></button>
                              ) : (
                                <button onClick={() => setConfirm({ action: "stop", id: c.Id, name })} className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400 transition-colors"><Square size={14} /></button>
                              )}
                              <button onClick={() => setConfirm({ action: "restart", id: c.Id, name })} className="p-1.5 rounded-lg hover:bg-amber-500/10 text-amber-400 transition-colors"><RotateCcw size={14} /></button>
                              <button onClick={() => viewContainerLogs(c.Id, name)} className="p-1.5 rounded-lg hover:bg-blue-500/10 text-blue-400 transition-colors"><FileText size={14} /></button>
                              <button onClick={() => setConfirm({ action: "remove", id: c.Id, name })} className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400 transition-colors"><Trash2 size={14} /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Images Tab */}
      {tab === "images" && (
        <div data-aos="fade-up">
          {images.isLoading ? (
            <div className="glass-card p-8 text-center"><div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto" /></div>
          ) : !images.data?.length ? (
            <div className="glass-card p-12 text-center text-[var(--muted)]">
              <Image size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">No Docker images found</p>
            </div>
          ) : (
            <div className="glass-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="vps-table">
                  <thead>
                    <tr><th>Repository</th><th>Tag</th><th>Image ID</th><th>Size</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {images.data.map((img) => {
                      const [repo, tag] = (img.RepoTags?.[0] || "<none>:<none>").split(":");
                      return (
                        <tr key={img.Id}>
                          <td className="font-mono text-sm">{repo}</td>
                          <td><span className="text-xs px-2 py-0.5 rounded bg-[var(--foreground)] border border-[var(--line)] font-mono">{tag || "latest"}</span></td>
                          <td className="font-mono text-xs text-[var(--muted)]">{img.Id.replace("sha256:", "").slice(0, 12)}</td>
                          <td className="text-sm">{fmtSize(img.Size)}</td>
                          <td>
                            <button onClick={() => setConfirm({ action: "delete-image", id: img.Id, name: img.RepoTags?.[0] || img.Id.slice(0, 12) })} className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400 transition-colors"><Trash2 size={14} /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Compose Tab */}
      {tab === "compose" && (
        <div data-aos="fade-up">
          {compose.isLoading ? (
            <div className="glass-card p-8 text-center"><div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto" /></div>
          ) : !compose.data?.length ? (
            <div className="glass-card p-12 text-center text-[var(--muted)]">
              <Layers size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">No Docker Compose projects found</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {compose.data.map((c) => (
                <div key={c.path} className="glass-card p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="font-semibold text-sm">{c.name}</div>
                      <div className="text-xs text-[var(--muted)] font-mono mt-0.5">{c.path}</div>
                    </div>
                    <StatusBadge status={c.status} size="sm" />
                  </div>
                  {c.services.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {c.services.map(s => (
                        <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--foreground)] border border-[var(--line)] font-mono">{s}</span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button onClick={() => composeMutation.mutate({ action: "up", path: c.path })} className="flex-1 py-1.5 text-xs rounded-lg bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20 transition-colors">Up</button>
                    <button onClick={() => composeMutation.mutate({ action: "down", path: c.path })} className="flex-1 py-1.5 text-xs rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors">Down</button>
                    <button onClick={() => composeMutation.mutate({ action: "restart", path: c.path })} className="flex-1 py-1.5 text-xs rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors">Restart</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Confirm */}
      <ConfirmDialog
        isOpen={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.action === "delete-image") imageMutation.mutate(confirm.id);
          else containerMutation.mutate({ action: confirm.action, id: confirm.id });
        }}
        title={`${confirm?.action} — ${confirm?.name}`}
        message={`Are you sure you want to ${confirm?.action} "${confirm?.name}"?`}
        danger={confirm?.action === "remove" || confirm?.action === "delete-image"}
        loading={containerMutation.isPending || imageMutation.isPending}
      />

      {/* Logs */}
      <Modal isOpen={!!logs} onClose={() => setLogs(null)} title={`Logs: ${logs?.name}`} size="xl">
        <pre className="code-block text-[11px] max-h-96 overflow-y-auto whitespace-pre-wrap break-all">
          {logs?.content || "No logs"}
        </pre>
      </Modal>

      {/* Pull */}
      <Modal isOpen={pullModal} onClose={() => setPullModal(false)} title="Pull Docker Image">
        <form onSubmit={(e) => { e.preventDefault(); pullMutation.mutate(pullImage); }} className="space-y-4">
          <input
            value={pullImage} onChange={e => setPullImage(e.target.value)}
            placeholder="nginx:latest"
            className="w-full px-3 py-2 text-sm rounded-xl border border-[var(--line)] bg-[var(--foreground)] focus:border-[var(--accent)] transition-colors font-mono"
            required
          />
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setPullModal(false)} className="px-4 py-2 text-sm rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors">Cancel</button>
            <button type="submit" disabled={pullMutation.isPending} className="px-4 py-2 text-sm rounded-xl bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50">
              {pullMutation.isPending ? "Pulling..." : "Pull"}
            </button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
