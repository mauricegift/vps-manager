import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  Container, Play, Square, RotateCcw, Trash2,
  RefreshCw, Image, Layers, FileText, Download, ArrowUpCircle,
  Plus, Edit3, ScrollText, Hammer
} from "lucide-react";
import api from "@/lib/api";
import StatusBadge from "@/components/ui/StatusBadge";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Modal from "@/components/ui/Modal";
import type { DockerContainer, DockerImage, DockerCompose } from "@/types";
import { toast } from "react-toastify";
import { useRemoteServer } from "@/context/RemoteServerContext";
import { useAuth } from "@/context/AuthContext";

function fmtSize(b: number) {
  if (b > 1e9) return (b / 1e9).toFixed(1) + " GB";
  if (b > 1e6) return (b / 1e6).toFixed(1) + " MB";
  return (b / 1e3).toFixed(1) + " KB";
}

type Tab = "containers" | "images" | "compose";

const DEFAULT_COMPOSE_YAML = `version: '3.8'
services:
  app:
    image: nginx:latest
    ports:
      - "8080:80"
    restart: unless-stopped
`;

const DEFAULT_DOCKERFILE = `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
`;

const inpCls = "w-full px-3 py-2 text-sm rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-[var(--main)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none transition-colors";

function defaultComposeDir(activeUser?: string) {
  const su = localStorage.getItem("vpsm_active_user") || "";
  const u = su && su !== "root" ? su : (activeUser && activeUser !== "root" ? activeUser : "");
  return u ? `/home/${u}/web/my-project` : "/root/web/my-project";
}

export default function DockerPage() {
  const qc = useQueryClient();
  const { activeServer } = useRemoteServer();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get("tab") as Tab) || "containers";
  const setTab = (t: Tab) => setSearchParams(p => { p.set("tab", t); return p; }, { replace: true });

  const [confirm, setConfirm] = useState<{ action: string; id: string; name: string } | null>(null);
  const [logs, setLogs] = useState<{ name: string; content: string } | null>(null);
  const [pullModal, setPullModal] = useState(false);
  const [pullImage, setPullImage] = useState("");
  const [pullPort, setPullPort] = useState("");
  const [pullAutoRun, setPullAutoRun] = useState(false);
  const [installingDocker, setInstallingDocker] = useState(false);
  const [uninstallingDocker, setUninstallingDocker] = useState(false);

  // Compose YAML creation
  const [composeModal, setComposeModal] = useState(false);
  const [newComposeDir, setNewComposeDir] = useState(() => defaultComposeDir());
  const [newComposeYaml, setNewComposeYaml] = useState(DEFAULT_COMPOSE_YAML);

  // Compose YAML edit
  const [editCompose, setEditCompose] = useState<{ path: string; yaml: string } | null>(null);
  const [savingCompose, setSavingCompose] = useState(false);

  // Compose logs
  const [composeLogs, setComposeLogs] = useState<{ name: string; content: string } | null>(null);

  // Run image
  const [runImageModal, setRunImageModal] = useState<{ image: string; tag: string } | null>(null);
  const [runContainerName, setRunContainerName] = useState("");
  const [runContainerPort, setRunContainerPort] = useState("");

  // Dockerfile build
  const [buildModal, setBuildModal] = useState(false);
  const [buildName, setBuildName] = useState("");
  const [buildTag, setBuildTag] = useState("latest");
  const [buildContext, setBuildContext] = useState("");
  const [buildDockerfile, setBuildDockerfile] = useState(DEFAULT_DOCKERFILE);
  const [buildOutput, setBuildOutput] = useState<string | null>(null);

  // After mount, update compose dir if JWT user is non-root and vpsm_active_user is not set
  useEffect(() => {
    const stored = localStorage.getItem("vpsm_active_user") || "";
    if (!stored && user?.username && user.username !== "root") {
      setNewComposeDir(defaultComposeDir(user.username));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.username]);

  // Listen for user-switch from Extras page
  useEffect(() => {
    const handler = (e: Event) => {
      const username: string = (e as CustomEvent).detail?.username || "";
      setNewComposeDir(defaultComposeDir(username));
    };
    window.addEventListener("vpsm:user-change", handler);
    return () => window.removeEventListener("vpsm:user-change", handler);
  }, []);

  const { data: versionInfo, isLoading: versionLoading } = useQuery({
    queryKey: ["docker-version", activeServer?.id ?? "local"],
    queryFn: () => {
      const url = activeServer ? `/remote/${activeServer.id}/extras/docker-version` : "/extras/docker-version";
      return api.get(url).then(r => r.data.data).catch(() => null);
    },
    staleTime: 0,
    refetchInterval: 3000,
  });

  const dockerInstalled = versionInfo !== null && versionInfo?.docker?.version;
  const dockerNotInstalled = !versionLoading && versionInfo === null;

  const serverId = activeServer?.id ?? "local";

  const containers = useQuery<DockerContainer[]>({
    queryKey: ["docker-containers", serverId],
    queryFn: () => api.get("/docker/containers").then(r => r.data.data),
    refetchInterval: 3000,
    enabled: !!dockerInstalled && !activeServer,
  });

  const images = useQuery<DockerImage[]>({
    queryKey: ["docker-images", serverId],
    queryFn: () => api.get("/docker/images").then(r => r.data.data),
    enabled: tab === "images" && !!dockerInstalled && !activeServer,
  });

  const compose = useQuery<DockerCompose[]>({
    queryKey: ["docker-compose", serverId],
    queryFn: () => api.get("/docker/compose").then(r => r.data.data),
    enabled: tab === "compose" && !!dockerInstalled && !activeServer,
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
    mutationFn: (opts: { image: string; port?: string; autoRun?: boolean }) =>
      api.post("/docker/images/pull", opts),
    onSuccess: (_, opts) => {
      toast.success(opts.autoRun && opts.port ? `Image pulled & container started on port ${opts.port}` : "Image pulled");
      qc.invalidateQueries({ queryKey: ["docker-images"] });
      qc.invalidateQueries({ queryKey: ["docker-containers"] });
      setPullModal(false);
      setPullImage("");
      setPullPort("");
      setPullAutoRun(false);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || "Failed to pull image"),
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

  const createComposeMutation = useMutation({
    mutationFn: ({ dir, yaml }: { dir: string; yaml: string }) =>
      api.post("/docker/compose/create", { dir, yaml }),
    onSuccess: () => {
      toast.success("Compose project created & started");
      qc.invalidateQueries({ queryKey: ["docker-compose"] });
      setComposeModal(false);
      setNewComposeYaml(DEFAULT_COMPOSE_YAML);
      setNewComposeDir(defaultComposeDir(user?.username));
    },
    onError: (e: any) => toast.error(e.response?.data?.error || "Failed to create compose project"),
  });

  const runImageMutation = useMutation({
    mutationFn: (opts: { image: string; name?: string; port?: string }) =>
      api.post("/docker/images/run", opts),
    onSuccess: (_, opts) => {
      toast.success(`Container started from ${opts.image}`);
      qc.invalidateQueries({ queryKey: ["docker-containers"] });
      qc.invalidateQueries({ queryKey: ["docker-images"] });
      setRunImageModal(null);
      setRunContainerName("");
      setRunContainerPort("");
    },
    onError: (e: any) => toast.error(e.response?.data?.error || "Failed to run container"),
  });

  const buildMutation = useMutation({
    mutationFn: (body: { name: string; tag: string; dockerfile: string; context: string }) =>
      api.post("/docker/images/build", body),
    onSuccess: (res) => {
      toast.success("Image built successfully");
      qc.invalidateQueries({ queryKey: ["docker-images"] });
      setBuildOutput(res.data.data || "Build complete");
    },
    onError: (e: any) => toast.error(e.response?.data?.error || "Build failed"),
  });

  const viewContainerLogs = async (id: string, name: string) => {
    try {
      const { data } = await api.get(`/docker/containers/${id}/logs`);
      setLogs({ name, content: data.data });
    } catch { toast.error("Failed to fetch logs"); }
  };

  const viewComposeLogs = async (composePath: string, name: string) => {
    try {
      const { data } = await api.get(`/docker/compose/logs?path=${encodeURIComponent(composePath)}`);
      setComposeLogs({ name, content: data.data });
    } catch { toast.error("Failed to fetch compose logs"); }
  };

  const loadAndEditCompose = async (composePath: string) => {
    try {
      const { data } = await api.get(`/docker/compose/read?path=${encodeURIComponent(composePath)}`);
      setEditCompose({ path: composePath, yaml: data.data });
    } catch { toast.error("Failed to read compose file"); }
  };

  const saveComposeYaml = async () => {
    if (!editCompose) return;
    setSavingCompose(true);
    try {
      await api.post("/docker/compose/save", { path: editCompose.path, yaml: editCompose.yaml });
      toast.success("Compose file saved");
      setEditCompose(null);
    } catch (e: any) {
      toast.error(e.response?.data?.error || "Save failed");
    }
    setSavingCompose(false);
  };

  const installDocker = async () => {
    setInstallingDocker(true);
    try {
      const url = activeServer ? `/remote/${activeServer.id}/extras/docker/install` : "/extras/docker/install";
      await api.post(url);
      toast.success("Docker installed successfully");
      qc.invalidateQueries({ queryKey: ["docker-version"] });
    } catch (e: any) {
      toast.error(e.response?.data?.error || "Failed to install Docker");
    }
    setInstallingDocker(false);
  };

  const uninstallDocker = async () => {
    if (!window.confirm("Uninstall Docker? This will remove all containers, images and data. This cannot be undone.")) return;
    setUninstallingDocker(true);
    try {
      const url = activeServer ? `/remote/${activeServer.id}/extras/docker/uninstall` : "/extras/docker/uninstall";
      await api.post(url);
      toast.success("Docker uninstalled");
      qc.invalidateQueries({ queryKey: ["docker-version"] });
    } catch (e: any) {
      toast.error(e.response?.data?.error || "Failed to uninstall Docker");
    }
    setUninstallingDocker(false);
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
            {versionLoading ? (
              <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            ) : dockerInstalled ? (
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
                  <a href="/extras?tab=software&sub=servers" className="text-[10px] flex items-center gap-1 text-amber-400 hover:underline">
                    <ArrowUpCircle size={11} /> update available
                  </a>
                )}
              </div>
            ) : dockerNotInstalled ? (
              <span className="text-xs text-red-400 font-medium px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20">
                Not installed
              </span>
            ) : null}
          </div>
          <p className="text-sm text-[var(--muted)] mt-1">Containers, images &amp; compose projects</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {dockerNotInstalled ? (
            <button
              onClick={installDocker}
              disabled={installingDocker}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--accent)] text-white text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {installingDocker ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Download size={14} />}
              {installingDocker ? "Installing..." : "Install Docker"}
            </button>
          ) : (
            <>
              {tab === "images" && (
                <>
                  <button onClick={() => { setBuildOutput(null); setBuildModal(true); }} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[var(--line)] text-sm hover:bg-[var(--foreground)] transition-colors">
                    <Hammer size={14} /> Build Image
                  </button>
                  <button onClick={() => setPullModal(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--accent)] text-white text-sm hover:opacity-90 transition-opacity">
                    <Download size={14} /> Pull Image
                  </button>
                </>
              )}
              {tab === "compose" && (
                <button onClick={() => setComposeModal(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--accent)] text-white text-sm hover:opacity-90 transition-opacity">
                  <Plus size={14} /> New Compose
                </button>
              )}
              <button
                onClick={() => { containers.refetch(); images.refetch(); compose.refetch(); }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[var(--line)] text-sm hover:bg-[var(--foreground)] transition-colors"
              >
                <RefreshCw size={14} /> Refresh
              </button>
              <button
                onClick={uninstallDocker}
                disabled={uninstallingDocker}
                title="Uninstall Docker"
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-red-500/30 text-red-400 text-sm hover:bg-red-500/10 transition-colors disabled:opacity-50"
              >
                {uninstallingDocker ? <div className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin" /> : <Trash2 size={14} />}
                {uninstallingDocker ? "Uninstalling..." : "Uninstall"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Remote server notice */}
      {activeServer && dockerInstalled && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs">
          <Container size={14} className="shrink-0 mt-0.5" />
          <span>Container, image and compose management is only available for the <strong>local server</strong>. Use the Terminal to manage Docker on remote servers. Install and uninstall Docker work for both local and remote.</span>
        </div>
      )}

      {/* Not installed banner */}
      {dockerNotInstalled && (
        <div className="glass-card p-8 text-center">
          <Container size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium mb-1">Docker is not installed</p>
          <p className="text-xs text-[var(--muted)] mb-4">Docker provides containerization for your applications</p>
          <button
            onClick={installDocker}
            disabled={installingDocker}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--accent)] text-white text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {installingDocker ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Download size={14} />}
            {installingDocker ? "Installing Docker..." : "Install Docker"}
          </button>
        </div>
      )}

      {!dockerNotInstalled && (
        <>
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
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => {
                                      const imgName = img.RepoTags?.[0]?.split(":")[0] || "container";
                                      const safeName = imgName.replace(/[^a-zA-Z0-9_.-]/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);
                                      setRunContainerName(safeName);
                                      setRunContainerPort("");
                                      setRunImageModal({ image: img.RepoTags?.[0] || img.Id, tag: tag || "latest" });
                                    }}
                                    className="p-1.5 rounded-lg hover:bg-green-500/10 text-green-400 transition-colors"
                                    title="Run container from this image"
                                  >
                                    <Play size={14} />
                                  </button>
                                  <button onClick={() => setConfirm({ action: "delete-image", id: img.Id, name: img.RepoTags?.[0] || img.Id.slice(0, 12) })} className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400 transition-colors" title="Delete image"><Trash2 size={14} /></button>
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
                        <div className="flex flex-wrap gap-1 mb-2">
                          {c.services.map(s => (
                            <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--foreground)] border border-[var(--line)] font-mono">{s}</span>
                          ))}
                        </div>
                      )}
                      {c.ports && c.ports.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-3">
                          {c.ports.map((p, i) => (
                            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent)]/10 border border-[var(--accent)]/20 text-[var(--accent)] font-mono">:{p}</span>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-1.5 mb-2">
                        <button onClick={() => composeMutation.mutate({ action: "up", path: c.path })} className="flex-1 py-1.5 text-xs rounded-lg bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20 transition-colors">Up</button>
                        <button onClick={() => composeMutation.mutate({ action: "down", path: c.path })} className="flex-1 py-1.5 text-xs rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors">Down</button>
                        <button onClick={() => composeMutation.mutate({ action: "restart", path: c.path })} className="flex-1 py-1.5 text-xs rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors">Restart</button>
                      </div>
                      <div className="flex gap-1.5">
                        <button onClick={() => viewComposeLogs(c.path, c.name)} className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs rounded-lg bg-[var(--foreground)] border border-[var(--line)] hover:bg-[var(--secondary)] transition-colors">
                          <ScrollText size={11} /> Logs
                        </button>
                        <button onClick={() => loadAndEditCompose(c.path)} className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs rounded-lg bg-[var(--foreground)] border border-[var(--line)] hover:bg-[var(--secondary)] transition-colors">
                          <Edit3 size={11} /> Edit YAML
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
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

      {/* Run Image */}
      <Modal isOpen={!!runImageModal} onClose={() => { setRunImageModal(null); setRunContainerName(""); setRunContainerPort(""); }} title="Run Container from Image">
        <form onSubmit={(e) => { e.preventDefault(); if (!runImageModal) return; runImageMutation.mutate({ image: runImageModal.image, name: runContainerName || undefined, port: runContainerPort || undefined }); }} className="space-y-4">
          <div>
            <label className="text-xs text-[var(--muted)] mb-1.5 block">Image</label>
            <div className="px-3 py-2 text-sm rounded-xl border border-[var(--line)] bg-[var(--foreground)] font-mono text-[var(--muted)]">
              {runImageModal?.image}
            </div>
          </div>
          <div>
            <label className="text-xs text-[var(--muted)] mb-1.5 block">Container Name</label>
            <input value={runContainerName} onChange={e => setRunContainerName(e.target.value)} placeholder="my-container" className={inpCls + " font-mono"} />
          </div>
          <div>
            <label className="text-xs text-[var(--muted)] mb-1.5 block">Port Mapping <span className="font-normal text-[var(--muted)]">(optional, e.g. 8080:80)</span></label>
            <input value={runContainerPort} onChange={e => setRunContainerPort(e.target.value)} placeholder="8080:80" className={inpCls + " font-mono"} />
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => { setRunImageModal(null); setRunContainerName(""); setRunContainerPort(""); }} className="px-4 py-2 text-sm rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors">Cancel</button>
            <button type="submit" disabled={runImageMutation.isPending} className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-green-600 text-white hover:opacity-90 disabled:opacity-50">
              <Play size={14} /> {runImageMutation.isPending ? "Starting..." : "Run Container"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Pull */}
      <Modal isOpen={pullModal} onClose={() => { setPullModal(false); setPullPort(""); setPullAutoRun(false); }} title="Pull Docker Image">
        <form onSubmit={(e) => { e.preventDefault(); pullMutation.mutate({ image: pullImage, port: pullPort || undefined, autoRun: pullAutoRun }); }} className="space-y-4">
          <div>
            <label className="text-xs text-[var(--muted)] mb-1.5 block">Image Name</label>
            <input
              value={pullImage} onChange={e => setPullImage(e.target.value)}
              placeholder="nginx:latest"
              className={inpCls + " font-mono"}
              required
            />
          </div>
          <div>
            <label className="text-xs text-[var(--muted)] mb-1.5 block">Custom Port Mapping <span className="text-[var(--muted)] font-normal">(optional)</span></label>
            <input
              value={pullPort}
              onChange={e => setPullPort(e.target.value)}
              placeholder="e.g. 8080:80  or  3000:3000"
              className={inpCls + " font-mono"}
            />
            <p className="text-[10px] text-[var(--muted)] mt-1">Format: host_port:container_port — overrides the image's default port</p>
          </div>
          {pullPort && (
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <div
                onClick={() => setPullAutoRun(v => !v)}
                className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${pullAutoRun ? "bg-[var(--accent)]" : "bg-[var(--foreground)] border border-[var(--line)]"}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${pullAutoRun ? "translate-x-4" : "translate-x-0.5"}`} />
              </div>
              <span className="text-sm">Auto-run container after pull</span>
            </label>
          )}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => { setPullModal(false); setPullPort(""); setPullAutoRun(false); }} className="px-4 py-2 text-sm rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors">Cancel</button>
            <button type="submit" disabled={pullMutation.isPending} className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50">
              <Download size={14} /> {pullMutation.isPending ? "Pulling..." : (pullAutoRun && pullPort ? "Pull & Run" : "Pull")}
            </button>
          </div>
        </form>
      </Modal>

      {/* New Compose Modal */}
      <Modal isOpen={composeModal} onClose={() => setComposeModal(false)} title="New Compose Project" size="xl">
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-[var(--muted)] mb-1.5">Project Directory</label>
            <input value={newComposeDir} onChange={e => setNewComposeDir(e.target.value)}
              placeholder="/root/web/my-project" className={inpCls + " font-mono"} />
            <p className="text-[10px] text-[var(--muted)] mt-1">Directory will be created if it doesn't exist. docker-compose.yml will be saved here.</p>
          </div>
          <div>
            <label className="block text-xs text-[var(--muted)] mb-1.5">docker-compose.yml content</label>
            <textarea
              value={newComposeYaml}
              onChange={e => setNewComposeYaml(e.target.value)}
              rows={14}
              className="w-full px-3 py-2 text-sm rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-[var(--main)] font-mono focus:border-[var(--accent)] focus:outline-none transition-colors resize-y"
              spellCheck={false}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setComposeModal(false)} className="px-4 py-2 text-sm rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors">Cancel</button>
            <button
              onClick={() => createComposeMutation.mutate({ dir: newComposeDir, yaml: newComposeYaml })}
              disabled={!newComposeDir || !newComposeYaml || createComposeMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50">
              {createComposeMutation.isPending ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Creating...</> : <><Plus size={14} /> Create & Start</>}
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit Compose YAML Modal */}
      <Modal isOpen={!!editCompose} onClose={() => setEditCompose(null)} title="Edit docker-compose.yml" size="xl">
        {editCompose && (
          <div className="space-y-4">
            <div className="text-xs text-[var(--muted)] font-mono px-3 py-2 rounded-xl bg-[var(--foreground)] border border-[var(--line)]">
              {editCompose.path}
            </div>
            <textarea
              value={editCompose.yaml}
              onChange={e => setEditCompose(prev => prev ? { ...prev, yaml: e.target.value } : null)}
              rows={18}
              className="w-full px-3 py-2 text-sm rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-[var(--main)] font-mono focus:border-[var(--accent)] focus:outline-none transition-colors resize-y"
              spellCheck={false}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditCompose(null)} className="px-4 py-2 text-sm rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors">Cancel</button>
              <button onClick={saveComposeYaml} disabled={savingCompose}
                className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50">
                {savingCompose ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving...</> : "Save YAML"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Compose Logs Modal */}
      <Modal isOpen={!!composeLogs} onClose={() => setComposeLogs(null)} title={`Compose Logs: ${composeLogs?.name}`} size="xl">
        <pre className="code-block text-[11px] max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-all">
          {composeLogs?.content || "No logs"}
        </pre>
      </Modal>

      {/* Build Image Modal */}
      <Modal isOpen={buildModal} onClose={() => setBuildModal(false)} title="Build Docker Image" size="xl">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--muted)] mb-1.5">Image Name</label>
              <input value={buildName} onChange={e => setBuildName(e.target.value)}
                placeholder="my-app" className={inpCls + " font-mono"} />
            </div>
            <div>
              <label className="block text-xs text-[var(--muted)] mb-1.5">Tag</label>
              <input value={buildTag} onChange={e => setBuildTag(e.target.value)}
                placeholder="latest" className={inpCls + " font-mono"} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-[var(--muted)] mb-1.5">Build Context Directory (optional)</label>
            <input value={buildContext} onChange={e => setBuildContext(e.target.value)}
              placeholder="/root/web/my-app" className={inpCls + " font-mono"} />
          </div>
          <div>
            <label className="block text-xs text-[var(--muted)] mb-1.5">Dockerfile content</label>
            <textarea
              value={buildDockerfile}
              onChange={e => setBuildDockerfile(e.target.value)}
              rows={12}
              className="w-full px-3 py-2 text-sm rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-[var(--main)] font-mono focus:border-[var(--accent)] focus:outline-none transition-colors resize-y"
              spellCheck={false}
            />
          </div>
          {buildOutput && (
            <details className="cursor-pointer">
              <summary className="text-xs text-[var(--muted)] mb-1 select-none">Build output</summary>
              <pre className="code-block text-[10px] max-h-40 overflow-y-auto whitespace-pre-wrap break-all mt-1">{buildOutput}</pre>
            </details>
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setBuildModal(false)} className="px-4 py-2 text-sm rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors">Cancel</button>
            <button
              onClick={() => buildMutation.mutate({ name: buildName, tag: buildTag, dockerfile: buildDockerfile, context: buildContext })}
              disabled={!buildName || !buildDockerfile || buildMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50">
              {buildMutation.isPending ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Building...</> : <><Hammer size={14} /> Build Image</>}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
