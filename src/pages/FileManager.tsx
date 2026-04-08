import { useRef, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Folder, File, ChevronRight, Home, RefreshCw,
  Scissors, Copy, Trash2, Eye, ArrowUp, FolderOpen,
  Plus, Upload, FilePlus, FolderPlus, Edit3, Save, X, ClipboardCopy, Code
} from "lucide-react";
import api from "@/lib/api";
import type { FileItem } from "@/types";
import Modal from "@/components/ui/Modal";
import CodeView, { getLang } from "@/components/ui/CodeView";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { toast } from "react-toastify";
import { useRemoteServer } from "@/context/RemoteServerContext";
import { useTheme } from "@/context/ThemeContext";

function fmtSize(b: number) {
  if (!b) return "—";
  if (b > 1e9) return (b / 1e9).toFixed(1) + " GB";
  if (b > 1e6) return (b / 1e6).toFixed(1) + " MB";
  if (b > 1e3) return (b / 1e3).toFixed(1) + " KB";
  return b + " B";
}

function defaultPath(username?: string) {
  if (!username) return "/";
  return username === "root" ? "/root" : `/home/${username}`;
}

const inp = "w-full px-3 py-2 text-sm rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-[var(--main)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] transition-colors";

export default function FileManagerPage() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { activeServer } = useRemoteServer();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const pfx = activeServer ? `/remote/${activeServer.id}` : "";

  const [path, setPath] = useState(() =>
    activeServer ? defaultPath(activeServer.username) : "/home/runner/workspace"
  );
  const [selected, setSelected] = useState<FileItem | null>(null);
  const [clipboard, setClipboard] = useState<{ item: FileItem; op: "cut" | "copy" } | null>(null);

  // Modals
  const [viewContent, setViewContent] = useState<{ name: string; content: string; path: string } | null>(null);
  const [editContent, setEditContent] = useState<string>("");
  const [isEditing, setIsEditing] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<FileItem | null>(null);
  const [moveModal, setMoveModal] = useState(false);
  const [moveDest, setMoveDest] = useState("");
  const [newFolderModal, setNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFileModal, setNewFileModal] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [newFileContent, setNewFileContent] = useState("");
  const [uploading, setUploading] = useState(false);

  // Reset path when active server changes
  useEffect(() => {
    if (activeServer) {
      setPath(defaultPath(activeServer.username));
    } else {
      setPath("/home/runner/workspace");
    }
    setSelected(null);
  }, [activeServer?.id]);

  const { data: files = [], isLoading, refetch, isFetching } = useQuery<FileItem[]>({
    queryKey: ["files", path, activeServer?.id ?? "local"],
    queryFn: () => api.get(`${pfx}/files`, { params: { path } }).then(r => r.data.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (p: string) =>
      activeServer
        ? api.delete(`/remote/${activeServer.id}/files`, { data: { path: p } })
        : api.delete("/files", { data: { path: p } }),
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["files"] }); setDeleteConfirm(null); },
    onError: () => toast.error("Failed to delete"),
  });

  const moveMutation = useMutation({
    mutationFn: ({ src, dest }: { src: string; dest: string }) =>
      activeServer
        ? api.post(`/remote/${activeServer.id}/exec`, { command: `mv ${JSON.stringify(src)} ${JSON.stringify(dest)}` })
        : api.post("/files/move", { src, dest }),
    onSuccess: () => { toast.success("Moved/Copied"); qc.invalidateQueries({ queryKey: ["files"] }); setClipboard(null); setMoveModal(false); setMoveDest(""); },
    onError: () => toast.error("Operation failed"),
  });

  const mkdirMutation = useMutation({
    mutationFn: (name: string) => {
      const newPath = path === "/" ? `/${name}` : `${path}/${name}`;
      return activeServer
        ? api.post(`/remote/${activeServer.id}/files/mkdir`, { path: newPath })
        : api.post("/files/mkdir", { path: newPath });
    },
    onSuccess: () => { toast.success("Folder created"); qc.invalidateQueries({ queryKey: ["files"] }); setNewFolderModal(false); setNewFolderName(""); },
    onError: () => toast.error("Failed to create folder"),
  });

  const createFileMutation = useMutation({
    mutationFn: ({ name, content }: { name: string; content: string }) => {
      const newPath = path === "/" ? `/${name}` : `${path}/${name}`;
      return activeServer
        ? api.post(`/remote/${activeServer.id}/files/save`, { path: newPath, content })
        : api.post("/files/create", { path: newPath, content });
    },
    onSuccess: () => { toast.success("File created"); qc.invalidateQueries({ queryKey: ["files"] }); setNewFileModal(false); setNewFileName(""); setNewFileContent(""); },
    onError: () => toast.error("Failed to create file"),
  });

  const saveMutation = useMutation({
    mutationFn: ({ path: p, content }: { path: string; content: string }) =>
      activeServer
        ? api.post(`/remote/${activeServer.id}/files/save`, { path: p, content })
        : api.post("/files/save", { path: p, content }),
    onSuccess: () => { toast.success("File saved"); setIsEditing(false); if (viewContent) setViewContent({ ...viewContent, content: editContent }); },
    onError: () => toast.error("Failed to save file"),
  });

  const viewFile = async (item: FileItem) => {
    try {
      const { data } = activeServer
        ? await api.get(`/remote/${activeServer.id}/files/read`, { params: { path: item.path } })
        : await api.get("/files/read", { params: { path: item.path } });
      setViewContent({ name: item.name, content: data.data, path: item.path });
      setEditContent(data.data);
      setIsEditing(false);
    } catch { toast.error("Cannot read file"); }
  };

  const handleUpload = async (files: FileList) => {
    if (!files.length) return;
    setUploading(true);
    try {
      const form = new FormData();
      Array.from(files).forEach(f => form.append("files", f));
      form.append("path", path);
      await api.post("/files/upload", form, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`${files.length} file${files.length > 1 ? "s" : ""} uploaded`);
      qc.invalidateQueries({ queryKey: ["files"] });
    } catch { toast.error("Upload failed"); }
    setUploading(false);
  };

  const breadcrumbs = ["", ...path.split("/").filter(Boolean)];
  const navigate = (parts: string[]) => { setPath(parts.join("/") || "/"); setSelected(null); };

  return (
    <section className="main space-y-6">
      <div data-aos="fade-down" className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">File Manager</h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            {activeServer
              ? `Remote · ${activeServer.username}@${activeServer.ip}`
              : "Browse and manage server files"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setNewFileModal(true)} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[var(--line)] text-sm hover:bg-[var(--foreground)] transition-colors">
            <FilePlus size={14} /> New File
          </button>
          <button onClick={() => setNewFolderModal(true)} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[var(--line)] text-sm hover:bg-[var(--foreground)] transition-colors">
            <FolderPlus size={14} /> New Folder
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--accent)] text-white text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Upload size={14} className={uploading ? "animate-pulse" : ""} />
            {uploading ? "Uploading..." : "Upload"}
          </button>
          <button onClick={() => refetch()} disabled={isFetching} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[var(--line)] text-sm hover:bg-[var(--foreground)] transition-colors disabled:opacity-50">
            <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} /> Refresh
          </button>
          <input ref={fileInputRef} type="file" multiple className="hidden"
            onChange={e => e.target.files && handleUpload(e.target.files)} />
        </div>
      </div>

      {/* Drop zone */}
      <div
        data-aos="fade-up"
        className="glass-card border-2 border-dashed border-[var(--line)] hover:border-[var(--accent)]/40 transition-colors cursor-pointer text-center py-4 text-sm text-[var(--muted)]"
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); e.dataTransfer.files && handleUpload(e.dataTransfer.files); }}
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload size={16} className="mx-auto mb-1 opacity-50" />
        Drop files here or click to upload to <span className="font-mono text-[var(--accent)]">{path}</span>
      </div>

      {/* Breadcrumb */}
      <div data-aos="fade-up" className="glass-card p-3 flex items-center gap-1 overflow-x-auto hide-scrollbar">
        {breadcrumbs.map((part, i) => {
          const parts = breadcrumbs.slice(0, i + 1);
          const isLast = i === breadcrumbs.length - 1;
          return (
            <div key={i} className="flex items-center gap-1 shrink-0">
              {i === 0 ? (
                <button onClick={() => navigate([""])} className="p-1.5 rounded-lg hover:bg-[var(--foreground)] transition-colors">
                  <Home size={14} className="text-[var(--accent)]" />
                </button>
              ) : (
                <>
                  <ChevronRight size={12} className="text-[var(--muted)]" />
                  <button
                    onClick={() => !isLast && navigate(parts)}
                    className={`text-xs px-2 py-1 rounded-lg transition-colors ${isLast ? "text-[var(--main)] font-medium" : "text-[var(--muted)] hover:bg-[var(--foreground)]"}`}
                  >
                    {part}
                  </button>
                </>
              )}
            </div>
          );
        })}
        {activeServer && (
          <button
            onClick={() => setPath(defaultPath(activeServer.username))}
            className="ml-auto shrink-0 text-[10px] px-2 py-1 rounded-lg border border-[var(--line)] hover:bg-[var(--foreground)] text-[var(--muted)] transition-colors"
          >
            Home
          </button>
        )}
      </div>

      {/* Clipboard banner */}
      {clipboard && (
        <div className="flex items-center justify-between px-4 py-2.5 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 text-sm">
          <span className="text-[var(--muted)]">
            <span className="text-[var(--accent)] font-medium">{clipboard.op === "cut" ? "Cut" : "Copied"}</span>: {clipboard.item.name}
          </span>
          <div className="flex gap-2">
            <button onClick={() => setMoveModal(true)} className="text-xs px-3 py-1 rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition-opacity">
              Paste here
            </button>
            <button onClick={() => setClipboard(null)} className="text-xs px-3 py-1 rounded-lg border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {/* File list */}
      <div data-aos="fade-up" className="glass-card overflow-hidden">
        {path !== "/" && (
          <button
            onClick={() => {
              const parts = path.split("/").filter(Boolean);
              parts.pop();
              navigate(parts.length ? parts : [""]);
            }}
            className="w-full flex items-center gap-3 px-4 py-3 border-b border-[var(--line)] hover:bg-[var(--foreground)] transition-colors text-[var(--muted)] text-sm"
          >
            <ArrowUp size={15} /><span>..</span>
          </button>
        )}
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : files.length === 0 ? (
          <div className="p-12 text-center text-[var(--muted)]">
            <FolderOpen size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">This directory is empty</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="vps-table">
              <thead>
                <tr><th>Name</th><th>Size</th><th>Modified</th><th>Permissions</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {files
                  .sort((a, b) => {
                    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
                    return a.name.localeCompare(b.name);
                  })
                  .map((item) => (
                    <tr
                      key={item.path}
                      className={selected?.path === item.path ? "bg-[var(--accent)]/5" : ""}
                      onClick={() => setSelected(s => s?.path === item.path ? null : item)}
                    >
                      <td>
                        <button
                          onClick={(e) => { e.stopPropagation(); if (item.type === "directory") setPath(item.path); }}
                          className="flex items-center gap-2 text-left group"
                        >
                          {item.type === "directory"
                            ? <Folder size={15} className="text-amber-400 shrink-0" />
                            : <File size={15} className="text-[var(--muted)] shrink-0" />}
                          <span className={`text-sm ${item.type === "directory" ? "font-medium group-hover:text-[var(--accent)] transition-colors" : ""}`}>
                            {item.name}
                          </span>
                        </button>
                      </td>
                      <td className="text-xs text-[var(--muted)] font-mono">{fmtSize(item.size)}</td>
                      <td className="text-xs text-[var(--muted)]">{new Date(item.modified).toLocaleDateString()}</td>
                      <td className="text-xs font-mono text-[var(--muted)]">{item.permissions}</td>
                      <td onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          {item.type === "file" && (
                            <>
                              <button onClick={() => viewFile(item)} className="p-1.5 rounded-lg hover:bg-blue-500/10 text-blue-400 transition-colors" title="View"><Eye size={13} /></button>
                              <button onClick={async () => { await viewFile(item); setIsEditing(true); }} className="p-1.5 rounded-lg hover:bg-green-500/10 text-green-400 transition-colors" title="Edit"><Edit3 size={13} /></button>
                            </>
                          )}
                          <button onClick={() => setClipboard({ item, op: "cut" })} className="p-1.5 rounded-lg hover:bg-amber-500/10 text-amber-400 transition-colors" title="Cut"><Scissors size={13} /></button>
                          <button onClick={() => setClipboard({ item, op: "copy" })} className="p-1.5 rounded-lg hover:bg-blue-500/10 text-blue-400 transition-colors" title="Copy"><Copy size={13} /></button>
                          <button onClick={() => setDeleteConfirm(item)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400 transition-colors" title="Delete"><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      <ConfirmDialog
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => deleteConfirm && deleteMutation.mutate(deleteConfirm.path)}
        title="Delete Item"
        message={`Delete "${deleteConfirm?.name}"? This cannot be undone.`}
        danger
        loading={deleteMutation.isPending}
      />

      <Modal isOpen={moveModal} onClose={() => setMoveModal(false)} title="Paste To">
        <div className="space-y-4">
          <div>
            <label className="text-xs text-[var(--muted)] mb-1.5 block">Destination path</label>
            <input value={moveDest || path} onChange={e => setMoveDest(e.target.value)} placeholder="/destination/path" className={`${inp} font-mono`} />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setMoveModal(false)} className="px-4 py-2 text-sm rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors">Cancel</button>
            <button onClick={() => clipboard && moveMutation.mutate({ src: clipboard.item.path, dest: (moveDest || path) + "/" + clipboard.item.name })}
              disabled={moveMutation.isPending} className="px-4 py-2 text-sm rounded-xl bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50">
              {moveMutation.isPending ? "Working..." : clipboard?.op === "cut" ? "Move" : "Copy"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={newFolderModal} onClose={() => setNewFolderModal(false)} title="New Folder">
        <form onSubmit={e => { e.preventDefault(); mkdirMutation.mutate(newFolderName); }} className="space-y-4">
          <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)} placeholder="folder-name" className={inp} required autoFocus />
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setNewFolderModal(false)} className="px-4 py-2 text-sm rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors">Cancel</button>
            <button type="submit" disabled={mkdirMutation.isPending} className="px-4 py-2 text-sm rounded-xl bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50">Create</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={newFileModal} onClose={() => setNewFileModal(false)} title="New File" size="xl">
        <form onSubmit={e => { e.preventDefault(); createFileMutation.mutate({ name: newFileName, content: newFileContent }); }} className="space-y-4">
          <div>
            <label className="text-xs text-[var(--muted)] mb-1.5 block">File name</label>
            <input value={newFileName} onChange={e => setNewFileName(e.target.value)} placeholder="example.txt" className={inp} required autoFocus />
          </div>
          <div>
            <label className="text-xs text-[var(--muted)] mb-1.5 block">Content (optional)</label>
            <textarea rows={8} value={newFileContent} onChange={e => setNewFileContent(e.target.value)}
              placeholder="File content..." className={`${inp} font-mono text-xs resize-y`} />
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setNewFileModal(false)} className="px-4 py-2 text-sm rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors">Cancel</button>
            <button type="submit" disabled={createFileMutation.isPending} className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50">
              <FilePlus size={14} />{createFileMutation.isPending ? "Creating..." : "Create File"}
            </button>
          </div>
        </form>
      </Modal>

      {/* View / Edit file modal */}
      <Modal isOpen={!!viewContent} onClose={() => { setViewContent(null); setIsEditing(false); }} title={viewContent?.name || ""} size="xl">
        <div className="space-y-3">
          {isEditing ? (
            <>
              {/* Code language badge */}
              {viewContent?.name && getLang(viewContent.name) && (
                <div className="flex items-center gap-1.5">
                  <Code size={12} className="text-[var(--accent)]" />
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--foreground)] border border-[var(--line)] text-[var(--muted)] capitalize">
                    {getLang(viewContent.name)}
                  </span>
                  <span className="text-[10px] text-[var(--muted)]">syntax highlighting active</span>
                </div>
              )}
              {/* Code-styled editor */}
              <div
                className="relative rounded-xl overflow-hidden border border-[var(--line)]"
                style={{ background: dark ? "#1e1e2e" : "#f8fafc" }}
              >
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  spellCheck={false}
                  className="w-full font-mono text-[11px] resize-none focus:outline-none bg-transparent p-4 leading-relaxed"
                  style={{
                    minHeight: "300px",
                    maxHeight: "55vh",
                    color: dark ? "#cdd6f4" : "#1e293b",
                    caretColor: dark ? "#cdd6f4" : "#1e293b",
                    overflowY: "auto",
                  }}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setIsEditing(false)} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors">
                  <X size={13} /> Discard
                </button>
                <button
                  onClick={() => viewContent && saveMutation.mutate({ path: viewContent.path, content: editContent })}
                  disabled={saveMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50">
                  <Save size={13} />{saveMutation.isPending ? "Saving..." : "Save File"}
                </button>
              </div>
            </>
          ) : (
            <>
              <CodeView
                code={viewContent?.content || ""}
                filename={viewContent?.name || ""}
                className="max-h-[55vh]"
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    if (viewContent?.content) {
                      navigator.clipboard.writeText(viewContent.content)
                        .then(() => import("react-toastify").then(({ toast }) => toast.success("Copied")));
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors"
                >
                  <ClipboardCopy size={13} /> Copy
                </button>
                <button onClick={() => setIsEditing(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl bg-[var(--accent)] text-white hover:opacity-90">
                  <Edit3 size={13} /> Edit File
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </section>
  );
}
