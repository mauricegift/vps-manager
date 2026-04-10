import { useRef, useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Folder, File, ChevronRight, Home, RefreshCw,
  Scissors, Copy, Trash2, Eye, ArrowUp, FolderOpen,
  Plus, Upload, FilePlus, FolderPlus, Edit3, Save, X, ClipboardCopy, Code,
  CheckSquare, Square as SquareIcon, ArchiveIcon, Download, Loader2,
  Github, Key, Eye as EyeIcon, EyeOff, XCircle, PackageOpen
} from "lucide-react";
import api from "@/lib/api";
import type { FileItem } from "@/types";
import Modal from "@/components/ui/Modal";
import CodeView, { getLang } from "@/components/ui/CodeView";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { toast } from "react-toastify";
import { useRemoteServer } from "@/context/RemoteServerContext";
import { useTheme } from "@/context/ThemeContext";

async function collectFolderEntries(entry: FileSystemEntry, prefix: string): Promise<{ file: File; relativePath: string }[]> {
  if (entry.isFile) {
    return new Promise((resolve) => {
      (entry as FileSystemFileEntry).file(f => resolve([{ file: f, relativePath: prefix + f.name }]));
    });
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const allEntries: FileSystemEntry[] = [];
    const readBatch = (): Promise<void> =>
      new Promise((resolve, reject) => {
        reader.readEntries(batch => {
          if (!batch.length) return resolve();
          allEntries.push(...batch);
          readBatch().then(resolve).catch(reject);
        }, reject);
      });
    await readBatch();
    const nested = await Promise.all(allEntries.map(e => collectFolderEntries(e, prefix + entry.name + "/")));
    return nested.flat();
  }
  return [];
}

function fmtSize(b: number | null) {
  if (b === null || b === undefined) return "—";
  if (!b) return "0 B";
  if (b > 1e9) return (b / 1e9).toFixed(2) + " GB";
  if (b > 1e6) return (b / 1e6).toFixed(2) + " MB";
  if (b > 1e3) return (b / 1e3).toFixed(2) + " KB";
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
  const folderInputRef = useRef<HTMLInputElement>(null);
  const editorTextareaRef = useRef<HTMLTextAreaElement>(null);
  const editorLineNumRef = useRef<HTMLDivElement>(null);
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
  const [folderDlLoading, setFolderDlLoading] = useState<string | null>(null);
  const [fileOpLoading, setFileOpLoading] = useState<string | null>(null);
  const [itemActionLoading, setItemActionLoading] = useState<string | null>(null);

  // Bulk selection
  const [selectMode, setSelectMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkZipping, setBulkZipping] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Hidden files
  const [showHidden, setShowHidden] = useState(false);

  // GitHub import
  const [ghModal, setGhModal] = useState(false);
  const [ghRepoUrl, setGhRepoUrl] = useState("");
  const [ghToken, setGhToken] = useState("");
  const [ghShowToken, setGhShowToken] = useState(false);
  const [ghSaveToken, setGhSaveToken] = useState(false);
  const [ghTokenLabel, setGhTokenLabel] = useState("");
  const [ghSavedTokens, setGhSavedTokens] = useState<{ label: string; token: string }[]>([]);
  const [ghTargetDir, setGhTargetDir] = useState("");
  const [ghRunInstall, setGhRunInstall] = useState(true);
  const [ghCloning, setGhCloning] = useState(false);
  const [ghCloneOutput, setGhCloneOutput] = useState("");

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

  const viewFile = async (item: FileItem, op: "view" | "edit" = "view") => {
    const key = `${item.path}:${op}`;
    setFileOpLoading(key);
    try {
      const { data } = activeServer
        ? await api.get(`/remote/${activeServer.id}/files/read`, { params: { path: item.path } })
        : await api.get("/files/read", { params: { path: item.path } });
      setViewContent({ name: item.name, content: data.data, path: item.path });
      setEditContent(data.data);
      setIsEditing(op === "edit");
    } catch { toast.error("Cannot read file"); }
    setFileOpLoading(null);
  };

  const downloadFileSmart = (item: FileItem) => {
    if (activeServer) {
      const url = `/api/remote/${activeServer.id}/files/raw-download?path=${encodeURIComponent(item.path)}`;
      const link = document.createElement("a");
      link.href = url;
      link.download = item.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      downloadFile(item.path, item.name);
    }
  };

  const handleUpload = async (files: FileList | File[], relativePaths?: string[]) => {
    if (!files.length) return;
    setUploading(true);
    try {
      const form = new FormData();
      const filesArr = Array.from(files);
      filesArr.forEach(f => form.append("files", f));
      form.append("path", path);
      if (relativePaths && relativePaths.length) {
        form.append("relativePaths", JSON.stringify(relativePaths));
      }
      const uploadUrl = activeServer
        ? `/remote/${activeServer.id}/files/upload`
        : "/files/upload";
      await api.post(uploadUrl, form, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`${filesArr.length} file${filesArr.length > 1 ? "s" : ""} uploaded`);
      await refetch();
    } catch { toast.error("Upload failed"); }
    setUploading(false);
  };

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const items = Array.from(e.dataTransfer.items || []);
    const hasDir = items.some(i => {
      const entry = i.webkitGetAsEntry?.();
      return entry?.isDirectory;
    });
    if (hasDir) {
      setUploading(true);
      try {
        const allFiles: File[] = [];
        const allPaths: string[] = [];
        for (const item of items) {
          const entry = item.webkitGetAsEntry?.();
          if (!entry) continue;
          const collected = await collectFolderEntries(entry, "");
          collected.forEach(({ file, relativePath }) => {
            allFiles.push(file);
            allPaths.push(relativePath);
          });
        }
        if (allFiles.length) await handleUpload(allFiles, allPaths);
        else setUploading(false);
      } catch { toast.error("Folder upload failed"); setUploading(false); }
    } else if (e.dataTransfer.files?.length) {
      await handleUpload(e.dataTransfer.files);
    }
  }, [path]);

  const handleFolderInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !files.length) return;
    const relativePaths = Array.from(files).map(f => (f as any).webkitRelativePath || f.name);
    await handleUpload(files, relativePaths);
    e.target.value = "";
  };

  const syncEditorScroll = useCallback(() => {
    if (editorTextareaRef.current && editorLineNumRef.current) {
      editorLineNumRef.current.scrollTop = editorTextareaRef.current.scrollTop;
    }
  }, []);

  const toggleBulkItem = (itemPath: string) => {
    setBulkSelected(prev => {
      const next = new Set(prev);
      if (next.has(itemPath)) next.delete(itemPath);
      else next.add(itemPath);
      return next;
    });
  };

  const visibleFiles = files.filter(f => showHidden || !f.name.startsWith("."));
  const hiddenCount = files.length - visibleFiles.length;

  const toggleSelectAll = () => {
    if (bulkSelected.size === visibleFiles.length) {
      setBulkSelected(new Set());
    } else {
      setBulkSelected(new Set(visibleFiles.map(f => f.path)));
    }
  };

  const bulkDelete = async () => {
    if (!bulkSelected.size) return;
    if (!window.confirm(`Delete ${bulkSelected.size} item(s)? This cannot be undone.`)) return;
    setBulkDeleting(true);
    try {
      const paths = Array.from(bulkSelected);
      if (activeServer) {
        await api.post(`/remote/${activeServer.id}/exec`, { command: paths.map(p => `rm -rf ${JSON.stringify(p)}`).join(" && ") });
      } else {
        await api.post("/files/bulk-delete", { paths });
      }
      toast.success(`Deleted ${bulkSelected.size} item(s)`);
      setBulkSelected(new Set());
      qc.invalidateQueries({ queryKey: ["files"] });
    } catch { toast.error("Bulk delete failed"); }
    setBulkDeleting(false);
  };

  const bulkZip = async () => {
    if (!bulkSelected.size) return;
    setBulkZipping(true);
    try {
      const paths = Array.from(bulkSelected);
      const { data } = await api.post("/files/zip", { paths });
      const zipPath = data.data.path;
      const link = document.createElement("a");
      link.href = `/api/files/download?path=${encodeURIComponent(zipPath)}`;
      link.download = "archive.zip";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("Archive created — download started");
    } catch { toast.error("Zip failed"); }
    setBulkZipping(false);
  };

  const downloadFile = (filePath: string, fileName: string) => {
    const link = document.createElement("a");
    link.href = `/api/files/download?path=${encodeURIComponent(filePath)}`;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadFolder = async (item: FileItem) => {
    if (folderDlLoading) return;
    setFolderDlLoading(item.path);
    try {
      if (activeServer) {
        // Remote: use dedicated zip-download endpoint (zips on remote, streams back)
        const url = `/api/remote/${activeServer.id}/files/zip-download?path=${encodeURIComponent(item.path)}`;
        const res = await fetch(url);
        if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Zip failed"); }
        const blob = await res.blob();
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${item.name}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
      } else {
        // Local: use existing /files/zip endpoint
        const { data } = await api.post("/files/zip", { paths: [item.path] });
        const zipPath = data.data.path;
        const link = document.createElement("a");
        link.href = `/api/files/download?path=${encodeURIComponent(zipPath)}`;
        link.download = `${item.name}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
      toast.success(`Downloading ${item.name}.zip`);
    } catch (e: any) {
      toast.error(e.message || "Download failed");
    }
    setFolderDlLoading(null);
  };

  // ── GitHub import helpers ─────────────────────────────────────────────────
  useEffect(() => {
    if (ghModal) {
      try {
        const saved = JSON.parse(localStorage.getItem("vps_gh_tokens") || "[]");
        setGhSavedTokens(saved);
      } catch { /* ignore */ }
      setGhTargetDir(path);
      setGhCloneOutput("");
    }
  }, [ghModal, path]);

  const persistGhToken = (label: string, token: string) => {
    const existing: { label: string; token: string }[] = JSON.parse(localStorage.getItem("vps_gh_tokens") || "[]");
    if (!existing.find((t) => t.token === token)) {
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

  const importFromGitHub = async () => {
    if (!ghRepoUrl.trim() || !ghTargetDir.trim()) {
      toast.error("Repo URL and target directory are required");
      return;
    }
    setGhCloning(true);
    setGhCloneOutput("");
    try {
      if (ghSaveToken && ghToken) persistGhToken(ghTokenLabel, ghToken);
      const repoSlug = ghRepoUrl.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
      const cloneUrl = ghToken
        ? `https://${ghToken}@github.com/${repoSlug}.git`
        : `https://github.com/${repoSlug}.git`;

      if (activeServer) {
        const repoName = repoSlug.split("/").pop() || "repo";
        const cloneDest = `${ghTargetDir.replace(/\/$/, "")}/${repoName}`;
        let cloneCmd = `mkdir -p ${JSON.stringify(ghTargetDir)} && git clone ${JSON.stringify(cloneUrl)} ${JSON.stringify(cloneDest)} 2>&1`;
        if (ghRunInstall) {
          cloneCmd += ` && cd ${JSON.stringify(cloneDest)} && (` +
            `[ -f package.json ] && npm install 2>&1 || ` +
            `[ -f requirements.txt ] && python3 -m venv venv 2>/dev/null && . venv/bin/activate && pip install -r requirements.txt 2>&1 || ` +
            `[ -f install.sh ] && bash install.sh 2>&1 || ` +
            `echo "No recognizable dependency file found")`;
        }
        const { data } = await api.post(`/remote/${activeServer.id}/exec`, { command: cloneCmd });
        const execOut = typeof data.data === "string"
          ? data.data
          : ((data.data?.stdout || "") + (data.data?.stderr || ""));
        setGhCloneOutput(execOut || "Cloned successfully");
        const failed = /error:|fatal:|not found|denied|could not/i.test(execOut);
        if (failed) {
          toast.error("Clone failed — check output above");
        } else {
          toast.success(`Repository cloned to ${cloneDest}`);
          setPath(cloneDest);
          await refetch();
        }
      } else {
        const { data } = await api.post("/github/clone", {
          repoUrl: ghRepoUrl,
          token: ghToken || undefined,
          dir: ghTargetDir,
          runInstall: ghRunInstall,
        });
        if (data.success) {
          const actualPath = data.data.clonedTo || ghTargetDir;
          setGhCloneOutput(data.data.output || "Cloned successfully");
          toast.success(`Repository cloned to ${actualPath}`);
          setPath(actualPath);
          await refetch();
        } else {
          setGhCloneOutput(data.error || "Clone failed");
          toast.error(data.error || "Clone failed");
        }
      }
    } catch (e: any) {
      const msg = e.response?.data?.error || "Clone failed";
      setGhCloneOutput(msg);
      toast.error(msg);
    }
    setGhCloning(false);
  };

  const breadcrumbs = ["", ...path.split("/").filter(Boolean)];
  const navigate = (parts: string[]) => { setPath(parts.join("/") || "/"); setSelected(null); setBulkSelected(new Set()); };

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
            onClick={() => { setSelectMode(s => !s); setBulkSelected(new Set()); }}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm transition-colors ${selectMode ? "bg-[var(--accent)]/10 border-[var(--accent)]/50 text-[var(--accent)]" : "border-[var(--line)] hover:bg-[var(--foreground)]"}`}
          >
            {selectMode ? <CheckSquare size={14} /> : <SquareIcon size={14} />} Select
          </button>
          <button
            onClick={() => setGhModal(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[var(--line)] text-sm hover:bg-[var(--foreground)] transition-colors"
          >
            <Github size={14} /> From GitHub
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--accent)] text-white text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Upload size={14} className={uploading ? "animate-pulse" : ""} />
            {uploading ? "Uploading..." : "Upload Files"}
          </button>
          <button
            onClick={() => folderInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[var(--line)] text-sm hover:bg-[var(--foreground)] transition-colors disabled:opacity-50"
          >
            <FolderPlus size={14} className={uploading ? "animate-pulse" : ""} />
            {uploading ? "Uploading..." : "Upload Folder"}
          </button>
          <button onClick={() => refetch()} disabled={isFetching} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[var(--line)] text-sm hover:bg-[var(--foreground)] transition-colors disabled:opacity-50">
            <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} /> Refresh
          </button>
          <input ref={fileInputRef} type="file" multiple className="hidden"
            onChange={e => e.target.files && handleUpload(e.target.files)} />
          <input ref={folderInputRef} type="file" className="hidden"
            {...({ webkitdirectory: "", multiple: "" } as any)}
            onChange={handleFolderInputChange} />
        </div>
      </div>

      {/* Drop zone */}
      <div
        data-aos="fade-up"
        className="glass-card border-2 border-dashed border-[var(--line)] hover:border-[var(--accent)]/40 transition-colors cursor-pointer text-center py-4 text-sm text-[var(--muted)]"
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload size={16} className="mx-auto mb-1 opacity-50" />
        Drop files or folders here, or click to upload to <span className="font-mono text-[var(--accent)]">{path}</span>
      </div>

      {/* Breadcrumb */}
      <div data-aos="fade-up" className="glass-card p-3 flex items-center gap-2">
        {/* Scrollable path — only this part scrolls horizontally */}
        <div className="flex items-center gap-1 overflow-x-auto hide-scrollbar flex-1 min-w-0">
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
        </div>
        {/* Always-visible controls — never scrolled off screen */}
        <div className="flex items-center gap-1.5 shrink-0">
          {activeServer && (
            <button
              onClick={() => setPath(defaultPath(activeServer.username))}
              className="text-[10px] px-2 py-1 rounded-lg border border-[var(--line)] hover:bg-[var(--foreground)] text-[var(--muted)] transition-colors"
            >
              Home
            </button>
          )}
          <button
            onClick={() => setShowHidden(h => !h)}
            title={showHidden ? "Hide hidden files" : "Show hidden files"}
            className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border transition-colors ${showHidden ? "bg-[var(--accent)]/10 border-[var(--accent)]/30 text-[var(--accent)]" : "border-[var(--line)] text-[var(--muted)] hover:text-[var(--main)]"}`}
          >
            {showHidden ? <EyeIcon size={11} /> : <EyeOff size={11} />}
            <span className="hidden sm:inline">{showHidden ? "Hide dotfiles" : `Dotfiles${hiddenCount > 0 ? ` (${hiddenCount})` : ""}`}</span>
            <span className="sm:hidden">{hiddenCount > 0 && !showHidden ? `(${hiddenCount})` : ""}</span>
          </button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectMode && bulkSelected.size > 0 && (
        <div className="flex items-center justify-between px-4 py-2.5 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 text-sm">
          <span className="text-[var(--muted)]">
            <span className="text-[var(--accent)] font-semibold">{bulkSelected.size}</span> item{bulkSelected.size !== 1 ? "s" : ""} selected
          </span>
          <div className="flex gap-2">
            <button onClick={bulkZip} disabled={bulkZipping}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors disabled:opacity-50">
              {bulkZipping ? <Loader2 size={11} className="animate-spin" /> : <ArchiveIcon size={11} />}
              Zip & Download
            </button>
            <button onClick={bulkDelete} disabled={bulkDeleting}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-50">
              {bulkDeleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
              Delete
            </button>
            <button onClick={() => setBulkSelected(new Set())} className="text-xs px-3 py-1.5 rounded-lg border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors">
              Clear
            </button>
          </div>
        </div>
      )}

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
                <tr>
                  {selectMode && (
                    <th className="w-8">
                      <button onClick={toggleSelectAll} className="p-0.5 rounded hover:bg-[var(--foreground)] transition-colors">
                        {bulkSelected.size === visibleFiles.length && visibleFiles.length > 0 ? <CheckSquare size={13} className="text-[var(--accent)]" /> : <SquareIcon size={13} />}
                      </button>
                    </th>
                  )}
                  <th>Name</th><th>Size</th><th>Modified</th><th>Permissions</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleFiles
                  .sort((a, b) => {
                    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
                    return a.name.localeCompare(b.name);
                  })
                  .map((item) => {
                    return (
                      <tr
                        key={item.path}
                        className={bulkSelected.has(item.path) ? "bg-[var(--accent)]/5" : selected?.path === item.path ? "bg-[var(--accent)]/5" : ""}
                        onClick={() => selectMode ? toggleBulkItem(item.path) : setSelected(s => s?.path === item.path ? null : item)}
                      >
                        {selectMode && (
                          <td onClick={e => e.stopPropagation()} className="w-8">
                            <input type="checkbox" checked={bulkSelected.has(item.path)} onChange={() => toggleBulkItem(item.path)}
                              className="rounded cursor-pointer accent-[var(--accent)]" />
                          </td>
                        )}
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
                                <button
                                  onClick={() => viewFile(item, "view")}
                                  disabled={!!fileOpLoading}
                                  className="p-1.5 rounded-lg hover:bg-blue-500/10 text-blue-400 transition-colors disabled:opacity-40"
                                  title="View"
                                >
                                  {fileOpLoading === `${item.path}:view`
                                    ? <Loader2 size={13} className="animate-spin" />
                                    : <Eye size={13} />}
                                </button>
                                <button
                                  onClick={() => viewFile(item, "edit")}
                                  disabled={!!fileOpLoading}
                                  className="p-1.5 rounded-lg hover:bg-green-500/10 text-green-400 transition-colors disabled:opacity-40"
                                  title="Edit"
                                >
                                  {fileOpLoading === `${item.path}:edit`
                                    ? <Loader2 size={13} className="animate-spin" />
                                    : <Edit3 size={13} />}
                                </button>
                                <button
                                  onClick={() => downloadFileSmart(item)}
                                  className="p-1.5 rounded-lg hover:bg-purple-500/10 text-purple-400 transition-colors"
                                  title="Download"
                                >
                                  <Download size={13} />
                                </button>
                              </>
                            )}
                            {item.type === "directory" && (
                              <button
                                onClick={() => downloadFolder(item)}
                                disabled={folderDlLoading === item.path}
                                className="p-1.5 rounded-lg hover:bg-purple-500/10 text-purple-400 transition-colors disabled:opacity-40"
                                title="Download as zip"
                              >
                                {folderDlLoading === item.path
                                  ? <Loader2 size={13} className="animate-spin" />
                                  : <Download size={13} />}
                              </button>
                            )}
                            <button
                              onClick={() => { setItemActionLoading(`${item.path}:cut`); setClipboard({ item, op: "cut" }); setTimeout(() => setItemActionLoading(null), 400); }}
                              className="p-1.5 rounded-lg hover:bg-amber-500/10 text-amber-400 transition-colors" title="Cut"
                            >{itemActionLoading === `${item.path}:cut` ? <Loader2 size={13} className="animate-spin" /> : <Scissors size={13} />}</button>
                            <button
                              onClick={() => { setItemActionLoading(`${item.path}:copy`); setClipboard({ item, op: "copy" }); setTimeout(() => setItemActionLoading(null), 400); }}
                              className="p-1.5 rounded-lg hover:bg-blue-500/10 text-blue-400 transition-colors" title="Copy"
                            >{itemActionLoading === `${item.path}:copy` ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />}</button>
                            <button
                              onClick={() => { setItemActionLoading(`${item.path}:del`); setDeleteConfirm(item); setTimeout(() => setItemActionLoading(null), 400); }}
                              className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400 transition-colors" title="Delete"
                            >{itemActionLoading === `${item.path}:del` ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}</button>
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
              <div className="flex items-center gap-1.5">
                <Code size={12} className="text-[var(--accent)]" />
                {viewContent?.name && getLang(viewContent.name) ? (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--foreground)] border border-[var(--line)] text-[var(--muted)] capitalize">
                    {getLang(viewContent.name)}
                  </span>
                ) : (
                  <span className="text-[10px] text-[var(--muted)]">plain text</span>
                )}
                <span className="text-[10px] text-[var(--muted)] ml-1">
                  {editContent.split("\n").length} lines
                </span>
              </div>
              {/* Line-numbered editor */}
              <div
                className="rounded-xl overflow-hidden border border-[var(--line)] flex"
                style={{ background: dark ? "#1e1e2e" : "#f8fafc", minHeight: "300px", maxHeight: "55vh" }}
              >
                {/* Gutter */}
                <div
                  ref={editorLineNumRef}
                  className="select-none shrink-0 py-4 text-right font-mono text-[11px] leading-relaxed overflow-hidden"
                  style={{
                    minWidth: `${String(editContent.split("\n").length).length * 8 + 24}px`,
                    paddingLeft: 8,
                    paddingRight: 12,
                    background: dark ? "#181825" : "#f1f5f9",
                    borderRight: `1px solid ${dark ? "#2a2a3e" : "#e2e8f0"}`,
                    color: dark ? "#4a4a6a" : "#94a3b8",
                  }}
                >
                  {editContent.split("\n").map((_, i) => (
                    <div key={i}>{i + 1}</div>
                  ))}
                </div>
                {/* Textarea */}
                <textarea
                  ref={editorTextareaRef}
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  onScroll={syncEditorScroll}
                  spellCheck={false}
                  className="flex-1 font-mono text-[11px] resize-none focus:outline-none bg-transparent py-4 px-3 leading-relaxed"
                  style={{
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

      {/* GitHub Import Modal */}
      <Modal isOpen={ghModal} onClose={() => { setGhModal(false); setGhCloneOutput(""); setGhRepoUrl(""); setGhToken(""); }}
        title="Import from GitHub" size="lg">
        <div className="space-y-4">
          {!ghCloneOutput ? (
            <>
              {/* Repo URL */}
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
                      <div key={i}
                        className={`flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-lg border text-xs cursor-pointer transition-colors ${ghToken === t.token ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]" : "border-[var(--line)] hover:bg-[var(--foreground)]"}`}
                        onClick={() => setGhToken(t.token)}>
                        <Key size={10} /> {t.label}
                        <button onClick={e => { e.stopPropagation(); deleteGhToken(t.token); }}
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
                  <Key size={10} className="inline mr-1" />
                  GitHub Token <span className="opacity-60">(leave empty for public repos)</span>
                </label>
                <div className="relative">
                  <input value={ghToken} onChange={e => setGhToken(e.target.value)}
                    type={ghShowToken ? "text" : "password"}
                    placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                    className={`w-full ${inp} font-mono text-xs pr-9`} />
                  <button type="button" onClick={() => setGhShowToken(s => !s)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--main)] transition-colors">
                    {ghShowToken ? <EyeOff size={13} /> : <EyeIcon size={13} />}
                  </button>
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

              {/* Target directory */}
              <div>
                <label className="block text-xs text-[var(--muted)] mb-1.5">Clone into directory</label>
                <input value={ghTargetDir} onChange={e => setGhTargetDir(e.target.value)}
                  placeholder="/root/apps/my-repo"
                  className={`w-full ${inp} font-mono text-xs`} />
                <p className="text-[10px] text-[var(--muted)] mt-1">Current location: <span className="font-mono text-[var(--accent)]">{path}</span></p>
              </div>

              {/* Auto install */}
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                <input type="checkbox" checked={ghRunInstall} onChange={e => setGhRunInstall(e.target.checked)} className="rounded accent-[var(--accent)]" />
                <PackageOpen size={12} className="text-[var(--muted)]" />
                Auto-install dependencies (npm install / pip install / install.sh)
              </label>

              <div className="flex gap-2 justify-end pt-1">
                <button onClick={() => setGhModal(false)}
                  className="px-4 py-2 text-sm rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors">
                  Cancel
                </button>
                <button onClick={importFromGitHub} disabled={ghCloning || !ghRepoUrl.trim() || !ghTargetDir.trim()}
                  className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50">
                  {ghCloning
                    ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Cloning...</>
                    : <><Github size={14} /> Clone Repository</>}
                </button>
              </div>
            </>
          ) : (
            /* Clone complete */
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 rounded-xl border border-green-500/30 bg-green-500/5">
                <Github size={16} className="text-green-400 shrink-0" />
                <div>
                  <div className="text-sm font-medium text-green-400">Repository cloned!</div>
                  <div className="text-xs text-[var(--muted)] mt-0.5 font-mono">{ghTargetDir}</div>
                </div>
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-[var(--foreground)] p-3 max-h-40 overflow-y-auto">
                <pre className="text-[10px] font-mono text-[var(--muted)] whitespace-pre-wrap">{ghCloneOutput}</pre>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => { setGhCloneOutput(""); setGhRepoUrl(""); setGhToken(""); }}
                  className="px-4 py-2 text-sm rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors">
                  Clone Another
                </button>
                <button onClick={() => { setGhModal(false); setGhCloneOutput(""); setPath(ghTargetDir); }}
                  className="px-4 py-2 text-sm rounded-xl bg-[var(--accent)] text-white hover:opacity-90 transition-opacity">
                  Navigate There
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </section>
  );
}
