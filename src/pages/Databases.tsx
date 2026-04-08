import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Database, RefreshCw, Play, Square, RotateCcw, Table2,
  ChevronRight, X, Download, Trash2, FolderOpen, Terminal,
  Plus, Edit3, Trash, AlertTriangle, PlusCircle, MinusCircle
} from "lucide-react";
import api from "@/lib/api";
import StatusBadge from "@/components/ui/StatusBadge";
import Modal from "@/components/ui/Modal";
import type { Database as DB } from "@/types";
import { toast } from "react-toastify";
import { useRemoteServer } from "@/context/RemoteServerContext";

const dbIcons: Record<string, string> = {
  postgresql: "🐘", mysql: "🐬", mongodb: "🍃", redis: "🔴", mariadb: "🐋",
};
const dbColors: Record<string, string> = {
  postgresql: "border-blue-500/30 bg-blue-500/5",
  mysql: "border-orange-500/30 bg-orange-500/5",
  mongodb: "border-green-500/30 bg-green-500/5",
  redis: "border-red-500/30 bg-red-500/5",
  mariadb: "border-purple-500/30 bg-purple-500/5",
};

interface TableData { columns: string[]; rows: any[][]; total: number; }
interface TableInfo { name: string; rows?: number; size?: string; }

export default function DatabasesPage() {
  const qc = useQueryClient();
  const { activeServer } = useRemoteServer();

  const [browserDb, setBrowserDb] = useState<{ type: string; name: string } | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableData, setTableData] = useState<TableData | null>(null);
  const [loadingTable, setLoadingTable] = useState(false);
  const [tableList, setTableList] = useState<TableInfo[]>([]);
  const [loadingTables, setLoadingTables] = useState(false);
  const [queryText, setQueryText] = useState("");
  const [queryResult, setQueryResult] = useState<any>(null);
  const [queryLoading, setQueryLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [outputModal, setOutputModal] = useState<{ title: string; output: string } | null>(null);
  const [editRowModal, setEditRowModal] = useState<{ columns: string[]; row: any[]; original: any[] } | null>(null);
  const [deleteRowModal, setDeleteRowModal] = useState<{ columns: string[]; row: any[] } | null>(null);
  const [addRowModal, setAddRowModal] = useState(false);
  const [addRowValues, setAddRowValues] = useState<Record<string, string>>({});
  const [newDbName, setNewDbName] = useState("");
  const [createDbModal, setCreateDbModal] = useState(false);
  const [dropTableModal, setDropTableModal] = useState<string | null>(null);
  const [managingDb, setManagingDb] = useState(false);
  const [confirmUninstall, setConfirmUninstall] = useState<DB | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [installTarget, setInstallTarget] = useState<DB | null>(null);
  const [installPort, setInstallPort] = useState("");
  const [installPassword, setInstallPassword] = useState("");

  const DEFAULT_PORTS: Record<string, number> = {
    postgresql: 5432, mysql: 3306, mongodb: 27017, redis: 6379, mariadb: 3306,
  };

  const dbEndpoint = activeServer ? `/remote/${activeServer.id}/databases` : "/databases";

  const { data: dbs = [], isLoading, refetch, isFetching } = useQuery<DB[]>({
    queryKey: ["databases", activeServer?.id ?? "local"],
    queryFn: () => api.get(dbEndpoint).then(r => r.data.data),
    refetchInterval: 30000,
  });

  const actionMutation = useMutation({
    mutationFn: ({ type, action }: { type: string; action: string }) =>
      activeServer
        ? api.post(`/remote/${activeServer.id}/exec`, { command: `apt-get ${action === 'install' ? 'install -y' : 'remove --purge -y autoremove'} ${type}` })
        : api.post(`/databases/${type}/${action}`),
    onSuccess: (_, { action }) => {
      toast.success(`Database ${action}ed`);
      qc.invalidateQueries({ queryKey: ["databases"] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || "Action failed — root access may be required"),
  });

  const runInstall = async (db: DB, opts?: { port?: string; password?: string }) => {
    setInstallTarget(null);
    setActionLoading(`install-${db.type}`);
    try {
      let output = "";
      const pkgMap: Record<string, string> = {
        postgresql: "postgresql", mysql: "mysql-server", mongodb: "mongodb",
        redis: "redis-server", sqlite: "sqlite3", mariadb: "mariadb-server",
      };
      const pkg = pkgMap[db.type] || db.type;
      let installCmd = `DEBIAN_FRONTEND=noninteractive apt-get install -y ${pkg} 2>&1`;

      // Pre-seed password for MySQL
      if ((db.type === "mysql" || db.type === "mariadb") && opts?.password) {
        const p = opts.password.replace(/'/g, "'\"'\"'");
        installCmd = `debconf-set-selections <<< "mysql-server mysql-server/root_password password ${p}" && ` +
          `debconf-set-selections <<< "mysql-server mysql-server/root_password_again password ${p}" && ` +
          installCmd;
      }

      if (activeServer) {
        const r = await api.post(`/remote/${activeServer.id}/exec`, { command: installCmd });
        output = r.data.data?.stdout || r.data.data || "";
      } else {
        const r = await api.post(`/databases/${db.type}/install`, opts);
        output = r.data.output || "";
      }
      toast.success(`${db.name} installed`);
      if (output) setOutputModal({ title: `Install ${db.name} — Output`, output });
      qc.invalidateQueries({ queryKey: ["databases"] });
    } catch (e: any) {
      const msg = e.response?.data?.error || "Install failed — root access required";
      toast.error(msg);
    }
    setActionLoading(null);
  };

  const runUninstall = async (db: DB) => {
    setConfirmUninstall(null);
    setActionLoading(`uninstall-${db.type}`);
    try {
      let output = "";
      if (activeServer) {
        const pkgMap: Record<string, string> = {
          postgresql: "postgresql", mysql: "mysql-server", mongodb: "mongodb",
          redis: "redis-server", sqlite: "sqlite3", mariadb: "mariadb-server",
        };
        const pkg = pkgMap[db.type] || db.type;
        const r = await api.post(`/remote/${activeServer.id}/exec`, {
          command: `DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y ${pkg} && apt-get autoremove -y 2>&1`
        });
        output = r.data.data?.stdout || r.data.data || "";
      } else {
        const r = await api.post(`/databases/${db.type}/uninstall`);
        output = r.data.output || "";
      }
      toast.success(`${db.name} uninstalled`);
      if (output) setOutputModal({ title: `Uninstall ${db.name} — Output`, output });
      qc.invalidateQueries({ queryKey: ["databases"] });
    } catch (e: any) {
      toast.error(e.response?.data?.error || "Uninstall failed");
    }
    setActionLoading(null);
  };

  const dbApiBase = (type: string, dbName: string) =>
    activeServer
      ? `/remote/${activeServer.id}/databases/${type}/${encodeURIComponent(dbName)}`
      : `/databases/${type}/${encodeURIComponent(dbName)}`;

  const openBrowser = async (db: DB, dbName: string) => {
    setBrowserDb({ type: db.type, name: dbName });
    setSelectedTable(null);
    setTableData(null);
    setQueryText("");
    setQueryResult(null);
    setPage(0);
    setLoadingTables(true);
    try {
      const r = await api.get(`${dbApiBase(db.type, dbName)}/tables`);
      setTableList(r.data.data || []);
    } catch (e: any) {
      toast.error(e.response?.data?.error || "Could not list tables");
    }
    setLoadingTables(false);
  };

  const loadTable = async (table: string, pg = 0) => {
    if (!browserDb) return;
    setSelectedTable(table);
    setLoadingTable(true);
    setPage(pg);
    try {
      const r = await api.get(`${dbApiBase(browserDb.type, browserDb.name)}/${encodeURIComponent(table)}/data?offset=${pg * 50}`);
      setTableData(r.data.data);
    } catch (e: any) {
      toast.error(e.response?.data?.error || "Could not load table data");
    }
    setLoadingTable(false);
  };

  const runQuery = async () => {
    if (!browserDb || !queryText.trim()) return;
    setQueryLoading(true);
    try {
      const r = await api.post(`${dbApiBase(browserDb.type, browserDb.name)}/query`, { sql: queryText });
      setQueryResult(r.data.data);
    } catch (e: any) {
      toast.error(e.response?.data?.error || "Query failed");
    }
    setQueryLoading(false);
  };

  const runSql = async (sql: string, successMsg: string) => {
    if (!browserDb) return;
    try {
      await api.post(`${dbApiBase(browserDb.type, browserDb.name)}/query`, { sql });
      toast.success(successMsg);
      if (selectedTable) loadTable(selectedTable, page);
    } catch (e: any) {
      toast.error(e.response?.data?.error || "Operation failed");
    }
  };

  const buildWhereClause = (columns: string[], row: any[]) =>
    columns.map((c, i) => row[i] === null ? `"${c}" IS NULL` : `"${c}" = '${String(row[i]).replace(/'/g, "''")}'`).join(" AND ");

  const saveEditRow = async () => {
    if (!editRowModal || !selectedTable || !browserDb) return;
    const { columns, row, original } = editRowModal;
    const sets = columns.map((c, i) => `"${c}" = '${String(row[i] ?? "").replace(/'/g, "''")}'`).join(", ");
    const where = buildWhereClause(columns, original);
    await runSql(`UPDATE "${selectedTable}" SET ${sets} WHERE ${where}`, "Row updated");
    setEditRowModal(null);
  };

  const deleteRow = async () => {
    if (!deleteRowModal || !selectedTable || !browserDb) return;
    const { columns, row } = deleteRowModal;
    const where = buildWhereClause(columns, row);
    await runSql(`DELETE FROM "${selectedTable}" WHERE ${where}`, "Row deleted");
    setDeleteRowModal(null);
  };

  const addRow = async () => {
    if (!tableData || !selectedTable || !browserDb) return;
    const cols = Object.keys(addRowValues).filter(c => addRowValues[c] !== "");
    if (!cols.length) { toast.error("Fill in at least one column"); return; }
    const colStr = cols.map(c => `"${c}"`).join(", ");
    const valStr = cols.map(c => `'${addRowValues[c].replace(/'/g, "''")}'`).join(", ");
    await runSql(`INSERT INTO "${selectedTable}" (${colStr}) VALUES (${valStr})`, "Row added");
    setAddRowModal(false);
    setAddRowValues({});
  };

  const createDatabase = async () => {
    if (!browserDb || !newDbName.trim()) return;
    setManagingDb(true);
    try {
      await api.post(`${dbApiBase(browserDb.type, browserDb.name)}/query`, {
        sql: browserDb.type === "postgresql" ? `CREATE DATABASE "${newDbName}"` : `CREATE DATABASE \`${newDbName}\``
      });
      toast.success(`Database "${newDbName}" created`);
      setCreateDbModal(false);
      setNewDbName("");
    } catch (e: any) {
      toast.error(e.response?.data?.error || "Failed to create database");
    }
    setManagingDb(false);
  };

  const dropTable = async (table: string) => {
    if (!browserDb) return;
    await runSql(`DROP TABLE IF EXISTS "${table}"`, `Table "${table}" dropped`);
    setDropTableModal(null);
    setTableList(prev => prev.filter(t => t.name !== table));
    if (selectedTable === table) { setSelectedTable(null); setTableData(null); }
  };

  // Split databases into installed vs not-installed
  const installed = dbs.filter((d: any) => d.installed !== false);
  const notInstalled = dbs.filter((d: any) => d.installed === false);

  return (
    <section className="main space-y-6">
      <div data-aos="fade-down" className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {activeServer ? `Databases · ${activeServer.name}` : "Databases"}
          </h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            {activeServer ? `Remote · ${activeServer.ip}` : "Manage and browse database services on this system"}
          </p>
        </div>
        <button onClick={() => refetch()} disabled={isFetching} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[var(--line)] text-sm hover:bg-[var(--foreground)] transition-colors disabled:opacity-50">
          <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass-card p-5 h-52 animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {/* Installed databases */}
          {installed.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--muted)]">Installed</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {installed.map((db: any) => (
                  <InstalledCard
                    key={db.type}
                    db={db}
                    actionLoading={actionLoading}
                    actionMutation={actionMutation}
                    onBrowse={openBrowser}
                    onUninstall={() => setConfirmUninstall(db)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Not-installed databases */}
          {notInstalled.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--muted)]">Not Installed</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {notInstalled.map((db: any) => (
                  <NotInstalledCard
                    key={db.type}
                    db={db}
                    actionLoading={actionLoading}
                    onInstall={() => {
                      setInstallTarget(db);
                      setInstallPort(String(DEFAULT_PORTS[db.type] || ""));
                      setInstallPassword("");
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {dbs.length === 0 && (
            <div className="glass-card p-12 text-center text-[var(--muted)]">
              <Database size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">No database services detected</p>
            </div>
          )}
        </>
      )}

      {/* Install options modal */}
      {installTarget && (
        <Modal isOpen onClose={() => setInstallTarget(null)} title={`Install ${installTarget.name}`}>
          <div className="space-y-4">
            <p className="text-sm text-[var(--muted)]">
              Configure before installing <strong>{installTarget.name}</strong>.
              {activeServer ? " This will run on the remote server." : ""}
            </p>
            <div>
              <label className="text-xs text-[var(--muted)] mb-1.5 block">Port</label>
              <input
                value={installPort}
                onChange={e => setInstallPort(e.target.value)}
                placeholder={String(DEFAULT_PORTS[installTarget.type] || "")}
                type="number"
                className="w-full px-3 py-2 text-sm rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-[var(--main)] focus:border-[var(--accent)] transition-colors font-mono"
              />
              <p className="text-[10px] text-[var(--muted)] mt-1">Default: {DEFAULT_PORTS[installTarget.type] || "N/A"}</p>
            </div>
            {(installTarget.type === "mysql" || installTarget.type === "mariadb") && (
              <div>
                <label className="text-xs text-[var(--muted)] mb-1.5 block">Root Password (optional)</label>
                <input
                  type="password"
                  value={installPassword}
                  onChange={e => setInstallPassword(e.target.value)}
                  placeholder="Leave blank to set later"
                  className="w-full px-3 py-2 text-sm rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-[var(--main)] focus:border-[var(--accent)] transition-colors"
                />
              </div>
            )}
            {installTarget.type === "redis" && (
              <div>
                <label className="text-xs text-[var(--muted)] mb-1.5 block">Auth Password (optional)</label>
                <input
                  type="password"
                  value={installPassword}
                  onChange={e => setInstallPassword(e.target.value)}
                  placeholder="Leave blank for no auth"
                  className="w-full px-3 py-2 text-sm rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-[var(--main)] focus:border-[var(--accent)] transition-colors"
                />
              </div>
            )}
            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setInstallTarget(null)}
                className="px-4 py-2 text-sm rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors">
                Cancel
              </button>
              <button
                onClick={() => runInstall(installTarget, { port: installPort, password: installPassword })}
                className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
              >
                <Download size={14} /> Install
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Confirm uninstall dialog */}
      {confirmUninstall && (
        <Modal
          isOpen
          onClose={() => setConfirmUninstall(null)}
          title={`Uninstall ${confirmUninstall.name}?`}
          size="sm"
        >
          <div className="space-y-4">
            <p className="text-sm text-[var(--muted)]">
              This will stop and completely remove <strong>{confirmUninstall.name}</strong> and its data files. This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmUninstall(null)} className="flex-1 px-4 py-2 rounded-xl border border-[var(--line)] text-sm hover:bg-[var(--foreground)] transition-colors">Cancel</button>
              <button
                onClick={() => runUninstall(confirmUninstall)}
                className="flex-1 px-4 py-2 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 text-sm hover:bg-red-500/25 transition-colors"
              >
                Uninstall
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Output modal */}
      {outputModal && (
        <Modal isOpen onClose={() => setOutputModal(null)} title={outputModal.title} size="lg">
          <pre className="text-[11px] font-mono bg-[#111] text-green-400 rounded-xl p-4 overflow-auto max-h-96 whitespace-pre-wrap">
            {outputModal.output}
          </pre>
        </Modal>
      )}

      {/* Database Browser Modal */}
      <Modal
        isOpen={!!browserDb}
        onClose={() => { setBrowserDb(null); setSelectedTable(null); setTableData(null); setQueryResult(null); }}
        title={browserDb ? `${dbIcons[browserDb.type] || "🗄️"} ${browserDb.name}` : ""}
        size="xl"
      >
        {browserDb && (
          <div className="flex flex-col md:flex-row gap-3" style={{ minHeight: 0 }}>

            {/* Table/Collection/Key list — horizontal scroll on mobile, vertical sidebar on desktop */}
            <div className="md:w-44 shrink-0 md:border-r border-[var(--line)] md:pr-3 flex flex-col">
              <p className="text-[10px] text-[var(--muted)] uppercase font-semibold mb-2 tracking-wider">
                {browserDb.type === "mongodb" ? "Collections" : browserDb.type === "redis" ? "Keys" : "Tables"}
              </p>
              {loadingTables ? (
                <div className="flex md:flex-col gap-2 overflow-x-auto md:overflow-x-visible pb-1 md:pb-0 hide-scrollbar">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-7 w-20 md:w-full shrink-0 rounded-lg bg-[var(--foreground)] animate-pulse" />
                  ))}
                </div>
              ) : tableList.length === 0 ? (
                <p className="text-[11px] text-[var(--muted)] italic">
                  {browserDb.type === "mongodb" ? "No collections" : browserDb.type === "redis" ? "No keys" : "No tables found"}
                </p>
              ) : (
                <div className="flex gap-1.5 overflow-x-auto pb-2 hide-scrollbar md:hidden">
                  {tableList.map((t) => (
                    <button
                      key={t.name}
                      onClick={() => loadTable(t.name, 0)}
                      className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-mono transition-colors whitespace-nowrap ${
                        selectedTable === t.name
                          ? "bg-[var(--accent)]/20 text-[var(--accent)] border border-[var(--accent)]/30"
                          : "bg-[var(--foreground)] border border-[var(--line)] text-[var(--muted)]"
                      }`}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              )}
              {/* Desktop vertical list */}
              {tableList.length > 0 && !loadingTables && (
                <div className="hidden md:flex flex-col gap-0.5 overflow-y-auto" style={{ maxHeight: '52vh' }}>
                  {tableList.map((t) => (
                    <button
                      key={t.name}
                      onClick={() => loadTable(t.name, 0)}
                      className={`w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-mono text-left transition-colors ${
                        selectedTable === t.name
                          ? "bg-[var(--accent)]/20 text-[var(--accent)] border border-[var(--accent)]/30"
                          : "border border-transparent hover:bg-[var(--foreground)] text-[var(--muted)] hover:text-[var(--main)]"
                      }`}
                    >
                      <ChevronRight size={10} className="shrink-0" />
                      <span className="truncate">{t.name}</span>
                      {t.rows !== undefined && (
                        <span className="text-[9px] text-[var(--muted)] ml-auto shrink-0">{t.rows}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Main content */}
            <div className="flex-1 min-w-0 space-y-3 overflow-y-auto" style={{ maxHeight: '65vh' }}>

              {/* DB Management bar */}
              {browserDb.type !== "redis" && (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => setCreateDbModal(true)}
                    className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-lg bg-[var(--foreground)] border border-[var(--line)] hover:border-[var(--accent)]/40 hover:text-[var(--accent)] transition-colors"
                  >
                    <PlusCircle size={11} /> New Database
                  </button>
                  {selectedTable && browserDb.type !== "mongodb" && (
                    <>
                      <button
                        onClick={() => { setAddRowValues(tableData ? Object.fromEntries(tableData.columns.map(c => [c, ""])) : {}); setAddRowModal(true); }}
                        className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 hover:bg-green-500/20 transition-colors"
                      >
                        <Plus size={11} /> Add Row
                      </button>
                      <button
                        onClick={() => setDropTableModal(selectedTable)}
                        className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors"
                      >
                        <MinusCircle size={11} /> Drop Table
                      </button>
                    </>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <p className="text-[10px] text-[var(--muted)] uppercase font-semibold tracking-wider">
                  {browserDb.type === "mongodb" ? "MongoDB Expression" : browserDb.type === "redis" ? "Redis Command" : "SQL Query"}
                </p>
                <div className="flex gap-2">
                  <textarea
                    rows={2}
                    value={queryText}
                    onChange={e => setQueryText(e.target.value)}
                    placeholder={
                      browserDb.type === "mongodb"
                        ? `db.${selectedTable || "collection"}.find().limit(10)`
                        : browserDb.type === "redis"
                        ? `KEYS *`
                        : `SELECT * FROM ${selectedTable || "table_name"} LIMIT 50;`
                    }
                    className="flex-1 px-3 py-2 text-xs font-mono rounded-xl border border-[var(--line)] bg-[var(--foreground)] focus:border-[var(--accent)] transition-colors resize-none"
                    onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runQuery(); }}
                  />
                  <button
                    onClick={runQuery}
                    disabled={queryLoading || !queryText.trim()}
                    className="px-3 py-1 rounded-xl bg-[var(--accent)] text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 shrink-0"
                  >
                    {queryLoading ? "..." : "Run"}
                  </button>
                </div>
              </div>

              {queryResult && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-[var(--muted)] uppercase font-semibold tracking-wider">Query Result</p>
                    <button onClick={() => setQueryResult(null)} className="text-[var(--muted)] hover:text-[var(--main)]"><X size={12} /></button>
                  </div>
                  <DataTable data={queryResult} />
                </div>
              )}

              {!queryResult && selectedTable && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <p className="text-[10px] text-[var(--muted)] uppercase font-semibold tracking-wider">
                      {selectedTable} {tableData && `(${tableData.total} rows)`}
                    </p>
                    <div className="flex items-center gap-2">
                      <button onClick={() => loadTable(selectedTable, Math.max(0, page - 1))} disabled={page === 0 || loadingTable} className="px-2 py-0.5 text-[10px] rounded border border-[var(--line)] hover:bg-[var(--foreground)] disabled:opacity-40">← Prev</button>
                      <span className="text-[10px] text-[var(--muted)]">Page {page + 1}</span>
                      <button onClick={() => loadTable(selectedTable, page + 1)} disabled={!tableData || tableData.rows.length < 50 || loadingTable} className="px-2 py-0.5 text-[10px] rounded border border-[var(--line)] hover:bg-[var(--foreground)] disabled:opacity-40">Next →</button>
                    </div>
                  </div>
                  {loadingTable ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : tableData ? (
                    <EditableDataTable
                      data={tableData}
                      isSql={browserDb.type !== "mongodb" && browserDb.type !== "redis"}
                      onEdit={row => setEditRowModal({ columns: tableData.columns, row: [...row], original: [...row] })}
                      onDelete={row => setDeleteRowModal({ columns: tableData.columns, row })}
                    />
                  ) : null}
                </div>
              )}

              {!queryResult && !selectedTable && !loadingTables && (
                <div className="flex flex-col items-center justify-center py-12 text-[var(--muted)]">
                  <Table2 size={28} className="mb-3 opacity-30" />
                  <p className="text-sm">
                    {browserDb.type === "mongodb"
                      ? "Select a collection to browse documents"
                      : browserDb.type === "redis"
                      ? "Select a key to inspect its value"
                      : "Select a table to browse its data"}
                  </p>
                  <p className="text-xs mt-1">
                    {browserDb.type === "mongodb"
                      ? "Or run a MongoDB expression above"
                      : browserDb.type === "redis"
                      ? "Or run a Redis command above"
                      : "Or run a SQL query above"}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Edit Row Modal */}
      {editRowModal && (
        <Modal isOpen onClose={() => setEditRowModal(null)} title="Edit Row" size="lg">
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            {editRowModal.columns.map((col, i) => (
              <div key={col}>
                <label className="text-[10px] text-[var(--muted)] mb-1 block font-mono">{col}</label>
                <input
                  value={String(editRowModal.row[i] ?? "")}
                  onChange={e => {
                    const updated = [...editRowModal.row];
                    updated[i] = e.target.value;
                    setEditRowModal({ ...editRowModal, row: updated });
                  }}
                  className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-[var(--main)] focus:border-[var(--accent)] transition-colors"
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2 justify-end pt-4">
            <button onClick={() => setEditRowModal(null)} className="px-4 py-2 text-sm rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors">Cancel</button>
            <button onClick={saveEditRow} className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-[var(--accent)] text-white hover:opacity-90">
              <Edit3 size={13} /> Save Changes
            </button>
          </div>
        </Modal>
      )}

      {/* Delete Row Modal */}
      {deleteRowModal && (
        <Modal isOpen onClose={() => setDeleteRowModal(null)} title="Delete Row" size="sm">
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-xl bg-red-500/5 border border-red-500/20">
              <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-400">Delete this row?</p>
                <p className="text-xs text-[var(--muted)] mt-0.5">This will permanently delete the row from the table.</p>
              </div>
            </div>
            <div className="bg-[var(--foreground)] rounded-xl p-3 space-y-1">
              {deleteRowModal.columns.map((c, i) => (
                <div key={c} className="flex gap-2 text-xs">
                  <span className="text-[var(--muted)] font-mono w-24 shrink-0">{c}:</span>
                  <span className="font-mono truncate">{String(deleteRowModal.row[i] ?? "null")}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteRowModal(null)} className="px-4 py-2 text-sm rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors">Cancel</button>
              <button onClick={deleteRow} className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 transition-colors">
                <Trash size={13} /> Delete Row
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Add Row Modal */}
      {addRowModal && tableData && (
        <Modal isOpen onClose={() => { setAddRowModal(false); setAddRowValues({}); }} title={`Add Row to ${selectedTable}`} size="lg">
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            {tableData.columns.map(col => (
              <div key={col}>
                <label className="text-[10px] text-[var(--muted)] mb-1 block font-mono">{col}</label>
                <input
                  value={addRowValues[col] || ""}
                  onChange={e => setAddRowValues(prev => ({ ...prev, [col]: e.target.value }))}
                  placeholder="NULL"
                  className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-[var(--main)] focus:border-[var(--accent)] transition-colors"
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2 justify-end pt-4">
            <button onClick={() => { setAddRowModal(false); setAddRowValues({}); }} className="px-4 py-2 text-sm rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors">Cancel</button>
            <button onClick={addRow} className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-[var(--accent)] text-white hover:opacity-90">
              <Plus size={13} /> Insert Row
            </button>
          </div>
        </Modal>
      )}

      {/* Create Database Modal */}
      {createDbModal && (
        <Modal isOpen onClose={() => setCreateDbModal(false)} title="Create New Database" size="sm">
          <div className="space-y-4">
            <div>
              <label className="text-xs text-[var(--muted)] mb-1.5 block">Database Name</label>
              <input
                value={newDbName}
                onChange={e => setNewDbName(e.target.value)}
                placeholder="my_database"
                className="w-full px-3 py-2 text-sm font-mono rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-[var(--main)] focus:border-[var(--accent)] transition-colors"
                autoFocus
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setCreateDbModal(false)} className="px-4 py-2 text-sm rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors">Cancel</button>
              <button onClick={createDatabase} disabled={managingDb || !newDbName.trim()} className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50">
                <PlusCircle size={13} /> {managingDb ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Drop Table Modal */}
      {dropTableModal && (
        <Modal isOpen onClose={() => setDropTableModal(null)} title="Drop Table" size="sm">
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-xl bg-red-500/5 border border-red-500/20">
              <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
              <p className="text-sm text-[var(--main)]">
                Drop table <strong className="font-mono">{dropTableModal}</strong>? This permanently deletes all data and cannot be undone.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDropTableModal(null)} className="px-4 py-2 text-sm rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors">Cancel</button>
              <button onClick={() => dropTable(dropTableModal)} className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 transition-colors">
                <MinusCircle size={13} /> Drop Table
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function InstalledCard({ db, actionLoading, actionMutation, onBrowse, onUninstall }: {
  db: any;
  actionLoading: string | null;
  actionMutation: any;
  onBrowse: (db: any, name: string) => void;
  onUninstall: () => void;
}) {
  const [showDbs, setShowDbs] = useState(false);
  const busy = actionLoading === `install-${db.type}` || actionLoading === `uninstall-${db.type}` || actionMutation.isPending;

  return (
    <div className={`glass-card p-5 border ${dbColors[db.type] || ""}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{dbIcons[db.type] || "🗄️"}</span>
          <div>
            <div className="font-semibold capitalize">{db.name || db.type}</div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-[var(--muted)]">Port {db.port}</span>
              {db.version && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-[var(--foreground)] border border-[var(--line)] text-[var(--muted)]">
                  v{db.version}
                </span>
              )}
            </div>
          </div>
        </div>
        <StatusBadge status={db.running ? "running" : "stopped"} size="sm" />
      </div>

      {/* Stats */}
      <div className="space-y-1 mb-3">
        {db.connections !== undefined && (
          <div className="flex justify-between text-xs">
            <span className="text-[var(--muted)]">Connections</span>
            <span className="font-mono font-medium">{db.connections}</span>
          </div>
        )}
        {db.size && (
          <div className="flex justify-between text-xs">
            <span className="text-[var(--muted)]">Data Size</span>
            <span className="font-mono font-medium">{db.size}</span>
          </div>
        )}
        {db.databases && (
          <div className="flex justify-between text-xs">
            <span className="text-[var(--muted)]">Databases</span>
            <button
              onClick={() => setShowDbs(!showDbs)}
              className="font-mono font-medium text-[var(--accent)] hover:underline flex items-center gap-1"
            >
              {db.databases.length} <FolderOpen size={10} />
            </button>
          </div>
        )}
      </div>

      {/* Redis: direct browse button (no database concept) */}
      {db.running && db.type === "redis" && (
        <div className="mb-3">
          <button
            onClick={() => onBrowse(db, "default")}
            className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg bg-[var(--foreground)] border border-[var(--line)] hover:border-[var(--accent)]/40 transition-colors group"
          >
            <span className="text-[11px] font-mono truncate">Browse All Keys</span>
            <span className="flex items-center gap-1 text-[10px] text-[var(--muted)] group-hover:text-[var(--accent)] transition-colors shrink-0 ml-2">
              <Table2 size={10} /> Browse
            </span>
          </button>
        </div>
      )}

      {/* Database list (expandable) */}
      {showDbs && db.databases && db.databases.length > 0 && (
        <div className="mb-3 max-h-28 overflow-y-auto space-y-1">
          {db.databases.map((d: string) => (
            <button
              key={d}
              onClick={() => onBrowse(db, d)}
              className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg bg-[var(--foreground)] border border-[var(--line)] hover:border-[var(--accent)]/40 transition-colors group"
            >
              <span className="text-[11px] font-mono truncate">{d}</span>
              <span className="flex items-center gap-1 text-[10px] text-[var(--muted)] group-hover:text-[var(--accent)] transition-colors shrink-0 ml-2">
                <Table2 size={10} /> Browse
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Service controls */}
      <div className="flex gap-2 pt-2 border-t border-[var(--line)]">
        {!db.running ? (
          <button
            onClick={() => actionMutation.mutate({ type: db.type, action: "start" })}
            disabled={busy}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20 transition-colors disabled:opacity-50"
          >
            <Play size={12} /> Start
          </button>
        ) : (
          <button
            onClick={() => actionMutation.mutate({ type: db.type, action: "stop" })}
            disabled={busy}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-50"
          >
            <Square size={12} /> Stop
          </button>
        )}
        <button
          onClick={() => actionMutation.mutate({ type: db.type, action: "restart" })}
          disabled={busy}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
        >
          <RotateCcw size={12} /> Restart
        </button>
        <button
          onClick={onUninstall}
          disabled={busy}
          className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-lg bg-red-900/20 text-red-400 border border-red-900/30 hover:bg-red-900/30 transition-colors disabled:opacity-50"
          title="Uninstall"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

function NotInstalledCard({ db, actionLoading, onInstall }: {
  db: any;
  actionLoading: string | null;
  onInstall: () => void;
}) {
  const isInstalling = actionLoading === `install-${db.type}`;
  return (
    <div className={`glass-card p-5 border border-[var(--line)] opacity-70`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl grayscale">{dbIcons[db.type] || "🗄️"}</span>
          <div>
            <div className="font-semibold capitalize text-[var(--muted)]">{db.name || db.type}</div>
            <div className="text-xs text-[var(--muted)]">Port {db.port}</div>
          </div>
        </div>
        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--foreground)] border border-[var(--line)] text-[var(--muted)]">
          Not installed
        </span>
      </div>
      <p className="text-xs text-[var(--muted)] mb-4">
        {db.type === 'postgresql' && 'Open-source relational database with strong SQL support.'}
        {db.type === 'mysql' && 'Popular open-source relational database for web apps.'}
        {db.type === 'mongodb' && 'NoSQL document database for flexible data models.'}
        {db.type === 'redis' && 'In-memory key-value store, great for caching and queues.'}
        {db.type === 'mariadb' && 'Community-developed fork of MySQL, fully compatible.'}
      </p>
      <button
        onClick={onInstall}
        disabled={isInstalling || !!actionLoading}
        className="w-full flex items-center justify-center gap-2 py-2.5 text-xs rounded-xl bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30 hover:bg-[var(--accent)]/25 transition-colors disabled:opacity-50 font-semibold"
      >
        {isInstalling ? (
          <>
            <div className="w-3.5 h-3.5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            Installing...
          </>
        ) : (
          <>
            <Download size={13} /> Install {db.name}
          </>
        )}
      </button>
    </div>
  );
}

function DataTable({ data }: { data: TableData }) {
  if (!data.columns || data.columns.length === 0) {
    return <p className="text-xs text-[var(--muted)] italic">No data returned</p>;
  }
  return (
    <div className="overflow-auto max-h-64 rounded-xl border border-[var(--line)]">
      <table className="vps-table text-[11px] min-w-max">
        <thead className="sticky top-0 bg-[var(--secondary)] z-10">
          <tr>
            {data.columns.map((col) => (
              <th key={col} className="px-3 py-2 text-left font-semibold text-[var(--muted)] uppercase tracking-wide whitespace-nowrap border-b border-[var(--line)]">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.length === 0 ? (
            <tr><td colSpan={data.columns.length} className="text-center py-6 text-[var(--muted)] italic">No rows found</td></tr>
          ) : (
            data.rows.map((row, i) => (
              <tr key={i} className="hover:bg-[var(--foreground)] transition-colors">
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-2 font-mono max-w-[180px] truncate" title={String(cell ?? "")}>
                    {cell === null ? <span className="text-[var(--muted)] italic">null</span> : String(cell)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function EditableDataTable({ data, isSql, onEdit, onDelete }: {
  data: TableData;
  isSql: boolean;
  onEdit: (row: any[]) => void;
  onDelete: (row: any[]) => void;
}) {
  if (!data.columns || data.columns.length === 0) {
    return <p className="text-xs text-[var(--muted)] italic">No data returned</p>;
  }
  return (
    <div className="overflow-auto max-h-64 rounded-xl border border-[var(--line)]">
      <table className="vps-table text-[11px] min-w-max">
        <thead className="sticky top-0 bg-[var(--secondary)] z-10">
          <tr>
            {data.columns.map((col) => (
              <th key={col} className="px-3 py-2 text-left font-semibold text-[var(--muted)] uppercase tracking-wide whitespace-nowrap border-b border-[var(--line)]">
                {col}
              </th>
            ))}
            {isSql && <th className="px-3 py-2 border-b border-[var(--line)] text-right">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {data.rows.length === 0 ? (
            <tr><td colSpan={data.columns.length + (isSql ? 1 : 0)} className="text-center py-6 text-[var(--muted)] italic">No rows found</td></tr>
          ) : (
            data.rows.map((row, i) => (
              <tr key={i} className="hover:bg-[var(--foreground)] transition-colors group">
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-2 font-mono max-w-[180px] truncate" title={String(cell ?? "")}>
                    {cell === null ? <span className="text-[var(--muted)] italic">null</span> : String(cell)}
                  </td>
                ))}
                {isSql && (
                  <td className="px-3 py-1.5 text-right">
                    <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => onEdit(row)}
                        className="p-1 rounded-lg hover:bg-blue-500/10 text-blue-400 transition-colors"
                        title="Edit row"
                      >
                        <Edit3 size={11} />
                      </button>
                      <button
                        onClick={() => onDelete(row)}
                        className="p-1 rounded-lg hover:bg-red-500/10 text-red-400 transition-colors"
                        title="Delete row"
                      >
                        <Trash size={11} />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
