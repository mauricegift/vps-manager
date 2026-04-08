import { useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Database, RefreshCw, Play, Square, RotateCcw, Table2,
  ChevronRight, X, Download, Trash2, FolderOpen,
  Plus, Edit3, Trash, AlertTriangle, PlusCircle, MinusCircle, LayoutGrid,
  Search, Copy, Globe, Wifi, WifiOff, Check, Lock, Link2
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
  const { theme } = useTheme();

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
  const [newDbPassword, setNewDbPassword] = useState("");
  const [createDbModal, setCreateDbModal] = useState(false);
  const [dropTableModal, setDropTableModal] = useState<string | null>(null);
  const [deleteDbModal, setDeleteDbModal] = useState<{ type: string; name: string } | null>(null);
  const [deletingDb, setDeletingDb] = useState(false);
  const [managingDb, setManagingDb] = useState(false);
  const [createDbType, setCreateDbType] = useState<string | null>(null);
  const [confirmUninstall, setConfirmUninstall] = useState<DB | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [installTarget, setInstallTarget] = useState<DB | null>(null);
  const [installPort, setInstallPort] = useState("");
  const [installPassword, setInstallPassword] = useState("");

  // Browser search
  const [tableSearch, setTableSearch] = useState("");
  const [rowSearch, setRowSearch] = useState("");

  // Connection string modal
  const [connectionModal, setConnectionModal] = useState<DB | null>(null);
  const [connCopied, setConnCopied] = useState<string | null>(null);
  const [connPassword, setConnPassword] = useState("");
  const [connDbName, setConnDbName] = useState("");

  // Change password modal (used in both the browser sidebar and standalone)
  const [changePassModal, setChangePassModal] = useState<{ type: string; name: string } | null>(null);
  const [changePwdVal, setChangePwdVal] = useState("");
  const [changePwdLoading, setChangePwdLoading] = useState(false);
  const [browserConnCopied, setBrowserConnCopied] = useState(false);

  // New Table / Collection creation
  const [newTableModal, setNewTableModal] = useState(false);
  const [newTableName, setNewTableName] = useState("");
  const [newTableCols, setNewTableCols] = useState([{ name: "id", type: "SERIAL PRIMARY KEY" }]);
  const [creatingTable, setCreatingTable] = useState(false);

  // MongoDB document (JSON) add
  const [addDocModal, setAddDocModal] = useState(false);
  const [addDocJson, setAddDocJson] = useState("{\n  \n}");
  const [addDocLoading, setAddDocLoading] = useState(false);

  const DEFAULT_PORTS: Record<string, number> = {
    postgresql: 5432, mysql: 3306, mongodb: 27017, redis: 6379, mariadb: 3306,
  };

  // Identifier quoting per DB type
  const quoteId = (col: string, type?: string): string => {
    const t = type ?? browserDb?.type ?? "postgresql";
    return (t === "mysql" || t === "mariadb") ? `\`${col}\`` : `"${col}"`;
  };

  const buildWhereClause = (columns: string[], row: any[]): string =>
    columns.map((c, i) => {
      const q = quoteId(c);
      return row[i] === null ? `${q} IS NULL` : `${q} = '${String(row[i]).replace(/'/g, "''")}'`;
    }).join(" AND ");

  // MongoDB: extract _id filter expression from a row
  const buildMongoFilter = (columns: string[], row: any[]): string => {
    const idIdx = columns.indexOf("_id");
    if (idIdx === -1) return "{}";
    const idVal = String(row[idIdx] ?? "");
    try {
      const parsed = JSON.parse(idVal);
      if (parsed.$oid) return `{_id: ObjectId("${parsed.$oid}")}`;
      return `{_id: ${idVal}}`;
    } catch {
      return `{_id: "${idVal.replace(/"/g, '\\"')}"}`;
    }
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
        postgresql: "postgresql", mysql: "mysql-server",
        redis: "redis-server", sqlite: "sqlite3", mariadb: "mariadb-server",
      };
      const pkg = pkgMap[db.type] || db.type;
      let installCmd = `DEBIAN_FRONTEND=noninteractive apt-get install -y ${pkg} 2>&1`;

      // MongoDB requires the official repo setup first
      if (db.type === "mongodb") {
        installCmd = [
          `export DEBIAN_FRONTEND=noninteractive`,
          `CODENAME=$(lsb_release -cs 2>/dev/null || echo jammy)`,
          `MV=$([ "$CODENAME" = "noble" ] && echo 8.0 || echo 7.0)`,
          `curl -fsSL "https://www.mongodb.org/static/pgp/server-$MV.asc" | gpg -o "/usr/share/keyrings/mongodb-server-$MV.gpg" --dearmor 2>&1`,
          `echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-$MV.gpg ] https://repo.mongodb.org/apt/ubuntu $CODENAME/mongodb-org/$MV multiverse" > /etc/apt/sources.list.d/mongodb-org-$MV.list`,
          `apt-get update -qq 2>&1`,
          `apt-get install -y mongodb-org 2>&1`,
          `systemctl enable mongod 2>&1 && systemctl start mongod 2>&1`,
        ].join(" && ");
      }

      // Pre-seed password for MySQL
      if ((db.type === "mysql" || db.type === "mariadb") && opts?.password) {
        const p = opts.password.replace(/'/g, "'\"'\"'");
        installCmd = `debconf-set-selections <<< "mysql-server mysql-server/root_password password ${p}" && ` +
          `debconf-set-selections <<< "mysql-server mysql-server/root_password_again password ${p}" && ` +
          installCmd;
      }

      if (activeServer) {
        const r = await api.post(`/remote/${activeServer.id}/exec`, { command: installCmd });
        const data = r.data.data || {};
        output = (data.stdout || "") + (data.stderr ? `\nSTDERR:\n${data.stderr}` : "");
        const exitCode = data.code ?? 0;
        if (exitCode !== 0) {
          toast.error(`${db.name} installation failed`);
          if (output) setOutputModal({ title: `Install ${db.name} — Error Output`, output });
          setActionLoading(null);
          return;
        }
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
    setTableSearch("");
    setRowSearch("");
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
    setRowSearch("");
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

  const saveEditRow = async () => {
    if (!editRowModal || !selectedTable || !browserDb) return;
    const { columns, row, original } = editRowModal;
    const type = browserDb.type;
    if (type === "mongodb") {
      const filter = buildMongoFilter(columns, original);
      const doc = Object.fromEntries(columns.filter(c => c !== "_id").map((c) => {
        const i = columns.indexOf(c);
        return [c, row[i] ?? null];
      }));
      await runSql(`db.getCollection("${selectedTable}").updateOne(${filter}, {$set: ${JSON.stringify(doc)}})`, "Document updated");
    } else if (type === "redis") {
      const key = selectedTable;
      if (columns.includes("field")) {
        const field = row[columns.indexOf("field")];
        const val = row[columns.indexOf("value")] ?? "";
        await runSql(`HSET ${key} ${field} ${val}`, "Hash field updated");
      } else if (columns.includes("index")) {
        const idx = row[columns.indexOf("index")];
        const val = row[columns.indexOf("value")] ?? "";
        await runSql(`LSET ${key} ${idx} ${val}`, "List item updated");
      } else if (columns.includes("member")) {
        const oldMember = original[columns.indexOf("member")];
        const newMember = row[columns.indexOf("member")];
        await runSql(`SREM ${key} ${oldMember}`, "Removing old member");
        await runSql(`SADD ${key} ${newMember}`, "Set member updated");
      } else {
        const val = row[columns.indexOf("value")] ?? "";
        await runSql(`SET ${key} ${val}`, "Key updated");
      }
    } else {
      const qt = (c: string) => quoteId(c, type);
      const sets = columns.map((c, i) => `${qt(c)} = '${String(row[i] ?? "").replace(/'/g, "''")}'`).join(", ");
      const where = buildWhereClause(columns, original);
      const tq = qt(selectedTable);
      await runSql(`UPDATE ${tq} SET ${sets} WHERE ${where}`, "Row updated");
    }
    setEditRowModal(null);
  };

  const deleteRow = async () => {
    if (!deleteRowModal || !selectedTable || !browserDb) return;
    const { columns, row } = deleteRowModal;
    const type = browserDb.type;
    if (type === "mongodb") {
      const filter = buildMongoFilter(columns, row);
      await runSql(`db.getCollection("${selectedTable}").deleteOne(${filter})`, "Document deleted");
    } else if (type === "redis") {
      const key = selectedTable;
      if (columns.includes("field")) {
        const field = row[columns.indexOf("field")];
        await runSql(`HDEL ${key} ${field}`, "Hash field deleted");
      } else if (columns.includes("index")) {
        const val = row[columns.indexOf("value")];
        await runSql(`LREM ${key} 0 ${val}`, "List item deleted");
      } else if (columns.includes("member")) {
        const member = row[columns.indexOf("member")];
        await runSql(`SREM ${key} ${member}`, "Set member deleted");
      } else {
        await runSql(`DEL ${key}`, "Key deleted");
      }
    } else {
      const where = buildWhereClause(columns, row);
      const qt = (c: string) => quoteId(c, type);
      await runSql(`DELETE FROM ${qt(selectedTable)} WHERE ${where}`, "Row deleted");
    }
    setDeleteRowModal(null);
  };

  const addRow = async () => {
    if (!tableData || !selectedTable || !browserDb) return;
    const type = browserDb.type;
    const cols = Object.keys(addRowValues).filter(c => addRowValues[c] !== "");
    if (!cols.length) { toast.error("Fill in at least one column"); return; }
    const qt = (c: string) => quoteId(c, type);
    const colStr = cols.map(c => qt(c)).join(", ");
    const valStr = cols.map(c => `'${addRowValues[c].replace(/'/g, "''")}'`).join(", ");
    await runSql(`INSERT INTO ${qt(selectedTable)} (${colStr}) VALUES (${valStr})`, "Row added");
    setAddRowModal(false);
    setAddRowValues({});
  };

  const addDocument = async () => {
    if (!selectedTable || !browserDb) return;
    setAddDocLoading(true);
    try {
      let doc: any;
      try { doc = JSON.parse(addDocJson); } catch { toast.error("Invalid JSON"); setAddDocLoading(false); return; }
      await runSql(`db.getCollection("${selectedTable}").insertOne(${JSON.stringify(doc)})`, "Document inserted");
      setAddDocModal(false);
      setAddDocJson("{\n  \n}");
    } catch {}
    setAddDocLoading(false);
  };

  const createTable = async () => {
    if (!browserDb || !newTableName.trim()) return;
    setCreatingTable(true);
    try {
      const type = browserDb.type;
      const qt = (c: string) => quoteId(c, type);
      let sql: string;
      if (type === "mongodb") {
        sql = `db.createCollection("${newTableName.replace(/"/g, '\\"')}")`;
      } else {
        const colDefs = newTableCols.map(c => `${qt(c.name)} ${c.type}`).join(", ");
        sql = `CREATE TABLE ${qt(newTableName)} (${colDefs})`;
      }
      await api.post(`${dbApiBase(type, browserDb.name)}/query`, { sql });
      toast.success(type === "mongodb" ? `Collection "${newTableName}" created` : `Table "${newTableName}" created`);
      setNewTableModal(false);
      setNewTableName("");
      setNewTableCols([{ name: "id", type: "SERIAL PRIMARY KEY" }]);
      const r = await api.get(`${dbApiBase(type, browserDb.name)}/tables`);
      setTableList(r.data.data || []);
    } catch (e: any) {
      toast.error(e.response?.data?.error || "Failed to create");
    }
    setCreatingTable(false);
  };

  const createDatabase = async () => {
    const dbType = browserDb?.type || createDbType;
    if (!dbType || !newDbName.trim()) return;
    setManagingDb(true);
    try {
      const defaultDb = dbType === "postgresql" ? "postgres" : dbType === "mongodb" ? "admin" : "mysql";
      const existingDb = browserDb?.name || defaultDb;
      const safeName = newDbName.trim().replace(/[^a-zA-Z0-9_]/g, "_");
      const pwd = newDbPassword.trim();

      if (dbType === "postgresql") {
        await api.post(`${dbApiBase(dbType, existingDb)}/query`, { sql: `CREATE DATABASE "${safeName}"` });
        if (pwd) {
          await api.post(`${dbApiBase(dbType, existingDb)}/query`, {
            sql: `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${safeName}') THEN CREATE ROLE "${safeName}" WITH LOGIN PASSWORD '${pwd.replace(/'/g, "''")}'; END IF; END $$`
          });
          await api.post(`${dbApiBase(dbType, existingDb)}/query`, { sql: `GRANT ALL PRIVILEGES ON DATABASE "${safeName}" TO "${safeName}"` });
        }
      } else if (dbType === "mongodb") {
        await api.post(`${dbApiBase(dbType, existingDb)}/query`, {
          sql: `db.getSiblingDB("${safeName}").createCollection("_init")`
        });
        if (pwd) {
          await api.post(`${dbApiBase(dbType, existingDb)}/query`, {
            sql: `db.getSiblingDB("${safeName}").createUser({user:"${safeName}",pwd:"${pwd.replace(/"/g, '\\"')}",roles:[{role:"dbOwner",db:"${safeName}"}]})`
          });
        }
      } else {
        await api.post(`${dbApiBase(dbType, existingDb)}/query`, { sql: `CREATE DATABASE \`${safeName}\`` });
        if (pwd) {
          await api.post(`${dbApiBase(dbType, existingDb)}/query`, {
            sql: `CREATE USER IF NOT EXISTS '${safeName}'@'%' IDENTIFIED BY '${pwd.replace(/'/g, "''")}'; GRANT ALL PRIVILEGES ON \`${safeName}\`.* TO '${safeName}'@'%'; FLUSH PRIVILEGES`
          });
        }
      }

      toast.success(`Database "${safeName}" created${pwd ? " with user access" : ""}`);
      setCreateDbModal(false);
      setCreateDbType(null);
      setNewDbName("");
      setNewDbPassword("");
      qc.invalidateQueries({ queryKey: ["databases"] });
    } catch (e: any) {
      toast.error(e.response?.data?.error || "Failed to create database");
    }
    setManagingDb(false);
  };

  const makeConnStr = (type: string, dbname: string, masked = true) => {
    const host = activeServer?.ip ?? "127.0.0.1";
    const portMap: Record<string, number> = { postgresql: 5432, mysql: 3306, mongodb: 27017, redis: 6379, mariadb: 3306 };
    const port = portMap[type] ?? 5432;
    const pwd = masked ? "•••" : "PASSWORD";
    if (type === "postgresql") return `postgresql://postgres:${pwd}@${host}:${port}/${dbname}`;
    if (type === "mysql" || type === "mariadb") return `mysql://root:${pwd}@${host}:${port}/${dbname}`;
    if (type === "mongodb") return `mongodb://root:${pwd}@${host}:${port}/${dbname}?authSource=admin`;
    if (type === "redis") return `redis://:${pwd}@${host}:${port}/0`;
    return dbname;
  };

  const changePassword = async () => {
    if (!changePassModal || !changePwdVal.trim()) return;
    setChangePwdLoading(true);
    try {
      const { type, name } = changePassModal;
      if (activeServer) {
        await api.post(`/remote/${activeServer.id}/databases/${type}/${name}/change-password`, { password: changePwdVal });
      } else {
        await api.post(`/databases/${type}/${name}/change-password`, { password: changePwdVal });
      }
      toast.success("Password changed successfully");
      setChangePassModal(null);
      setChangePwdVal("");
    } catch (e: any) {
      toast.error(e.response?.data?.error || "Failed to change password");
    }
    setChangePwdLoading(false);
  };

  const dropTable = async (table: string) => {
    if (!browserDb) return;
    const type = browserDb.type;
    let sql: string;
    if (type === "mongodb") {
      sql = `db.getCollection("${table}").drop()`;
    } else {
      sql = `DROP TABLE IF EXISTS ${quoteId(table, type)}`;
    }
    await runSql(sql, type === "mongodb" ? `Collection "${table}" dropped` : `Table "${table}" dropped`);
    setDropTableModal(null);
    setTableList(prev => prev.filter(t => t.name !== table));
    if (selectedTable === table) { setSelectedTable(null); setTableData(null); }
  };

  const deleteDatabase = async () => {
    if (!deleteDbModal) return;
    const { type, name } = deleteDbModal;
    setDeletingDb(true);
    try {
      const endpoint = activeServer
        ? `/remote/${activeServer.id}/databases/${type}/${encodeURIComponent(name)}`
        : `/databases/${type}/${encodeURIComponent(name)}`;
      await api.delete(endpoint);
      toast.success(`Database "${name}" deleted`);
      setDeleteDbModal(null);
      qc.invalidateQueries({ queryKey: ["databases"] });
    } catch (e: any) {
      toast.error(e.response?.data?.error || "Failed to delete database");
    }
    setDeletingDb(false);
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
                    onDeleteDb={(name) => setDeleteDbModal({ type: db.type, name })}
                    onCreateDb={() => { setCreateDbType(db.type); setNewDbName(""); setCreateDbModal(true); }}
                    onConnect={() => setConnectionModal(db)}
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

      {/* Change Password modal */}
      {changePassModal && (
        <Modal isOpen onClose={() => { setChangePassModal(null); setChangePwdVal(""); }} title={`Change Password — ${changePassModal.name}`} size="sm" zIndex={200}>
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-orange-500/5 border border-orange-500/20">
              <p className="text-xs text-[var(--muted)]">
                {changePassModal.type === "mongodb" && <>Creates or updates a dedicated user <code className="font-mono text-orange-300">{changePassModal.name.replace(/[^a-zA-Z0-9_]/g, '_')}</code> with access only to this database.</>}
                {(changePassModal.type === "mysql" || changePassModal.type === "mariadb") && <>Creates or updates a dedicated user <code className="font-mono text-orange-300">{changePassModal.name.replace(/[^a-zA-Z0-9_]/g, '_')}</code> with access only to the <code className="font-mono text-orange-300">{changePassModal.name}</code> database.</>}
                {changePassModal.type === "postgresql" && <>Creates or updates a dedicated role <code className="font-mono text-orange-300">{changePassModal.name.replace(/[^a-zA-Z0-9_]/g, '_')}</code> with access only to the <code className="font-mono text-orange-300">{changePassModal.name}</code> database.</>}
                {changePassModal.type === "redis" && "Sets the global requirepass for Redis (Redis does not support per-database passwords)."}
              </p>
            </div>
            <div>
              <label className="text-xs text-[var(--muted)] mb-1.5 block font-semibold uppercase tracking-wide">New Password</label>
              <input
                type="text"
                value={changePwdVal}
                onChange={e => setChangePwdVal(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !changePwdLoading && changePwdVal.trim() && changePassword()}
                placeholder="Enter new password"
                autoFocus
                className="w-full px-3 py-2 text-sm rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-[var(--main)] focus:border-orange-400 transition-colors font-mono"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setChangePassModal(null); setChangePwdVal(""); }} disabled={changePwdLoading} className="px-4 py-2 text-sm rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors disabled:opacity-50">Cancel</button>
              <button onClick={changePassword} disabled={changePwdLoading || !changePwdVal.trim()} className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-orange-500/15 border border-orange-500/30 text-orange-400 hover:bg-orange-500/25 transition-colors disabled:opacity-50">
                {changePwdLoading ? <><div className="w-3 h-3 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" /> Changing...</> : <><Lock size={13} /> Change Password</>}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Output modal */}
      {outputModal && (
        <Modal isOpen onClose={() => setOutputModal(null)} title={outputModal.title} size="lg">
          <pre
            className="text-[11px] font-mono rounded-xl p-4 overflow-auto max-h-96 whitespace-pre-wrap leading-relaxed"
            style={{
              background: theme === "dark" ? "#111" : "#f5f5f5",
              color: theme === "dark" ? "#4ec994" : "#16803c",
              border: `1px solid ${theme === "dark" ? "#222" : "#d1d5db"}`,
            }}
          >
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
            <div className="md:w-44 shrink-0 md:border-r border-[var(--line)] md:pr-3 flex flex-col gap-2">
              <p className="text-[10px] text-[var(--muted)] uppercase font-semibold tracking-wider">
                {browserDb.type === "mongodb" ? "Collections" : browserDb.type === "redis" ? "Keys" : "Tables"}
              </p>
              {/* Search box */}
              {tableList.length > 3 && (
                <div className="relative">
                  <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                  <input
                    value={tableSearch}
                    onChange={e => setTableSearch(e.target.value)}
                    placeholder="Filter..."
                    className="w-full pl-6 pr-2 py-1 text-[11px] rounded-lg border border-[var(--line)] bg-[var(--foreground)] text-[var(--main)] focus:border-[var(--accent)] transition-colors"
                  />
                </div>
              )}
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
                  {tableList.filter(t => !(browserDb.type === "mongodb" && t.name === "_init") && t.name.toLowerCase().includes(tableSearch.toLowerCase())).map((t) => (
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
                  {tableList.filter(t => !(browserDb.type === "mongodb" && t.name === "_init") && t.name.toLowerCase().includes(tableSearch.toLowerCase())).map((t) => (
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
                  {tableSearch && tableList.filter(t => t.name.toLowerCase().includes(tableSearch.toLowerCase())).length === 0 && (
                    <p className="text-[10px] text-[var(--muted)] italic px-2">No matches</p>
                  )}
                </div>
              )}

              {/* Connection String + Change Password */}
              <div className="mt-auto pt-3 border-t border-[var(--line)] hidden md:block">
                <p className="text-[10px] text-[var(--muted)] uppercase font-semibold tracking-wider mb-2 flex items-center gap-1">
                  <Link2 size={9} /> Connection
                </p>
                <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-[var(--foreground)] border border-[var(--line)]">
                  <code className="text-[9px] font-mono flex-1 truncate text-[var(--muted)]">
                    {makeConnStr(browserDb.type, browserDb.name)}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(makeConnStr(browserDb.type, browserDb.name));
                      setBrowserConnCopied(true);
                      setTimeout(() => setBrowserConnCopied(false), 2000);
                    }}
                    className="shrink-0 text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
                    title="Copy connection string"
                  >
                    {browserConnCopied ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
                  </button>
                </div>
                {browserDb.type !== "sqlite" && (
                  <button
                    onClick={() => { setChangePwdVal(""); setChangePassModal({ type: browserDb.type, name: browserDb.name }); }}
                    className="mt-1.5 w-full flex items-center gap-1 text-[10px] px-2.5 py-1.5 rounded-lg border border-[var(--line)] hover:border-orange-400/40 hover:text-orange-400 transition-colors"
                  >
                    <Lock size={10} /> Change Password
                  </button>
                )}
              </div>
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
                  <button
                    onClick={() => { setNewTableName(""); setNewTableCols([{ name: "id", type: "SERIAL PRIMARY KEY" }]); setNewTableModal(true); }}
                    className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-lg bg-[var(--accent)]/10 border border-[var(--accent)]/20 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors"
                  >
                    <LayoutGrid size={11} /> {browserDb.type === "mongodb" ? "New Collection" : "New Table"}
                  </button>
                  {selectedTable && (
                    <>
                      {browserDb.type === "mongodb" ? (
                        <button
                          onClick={() => { setAddDocJson("{\n  \n}"); setAddDocModal(true); }}
                          className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 hover:bg-green-500/20 transition-colors"
                        >
                          <Plus size={11} /> Add Document
                        </button>
                      ) : (
                        <button
                          onClick={() => { setAddRowValues(tableData ? Object.fromEntries(tableData.columns.map(c => [c, ""])) : {}); setAddRowModal(true); }}
                          className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 hover:bg-green-500/20 transition-colors"
                        >
                          <Plus size={11} /> Add Row
                        </button>
                      )}
                      <button
                        onClick={() => setDropTableModal(selectedTable)}
                        className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors"
                      >
                        <MinusCircle size={11} /> {browserDb.type === "mongodb" ? "Drop Collection" : "Drop Table"}
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
                        ? `db.getCollection("${selectedTable || "collection"}").find().limit(10)`
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
                      {/* Row search */}
                      <div className="relative">
                        <Search size={9} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                        <input
                          value={rowSearch}
                          onChange={e => setRowSearch(e.target.value)}
                          placeholder="Search rows..."
                          className="pl-5 pr-2 py-0.5 text-[10px] rounded border border-[var(--line)] bg-[var(--foreground)] text-[var(--main)] focus:border-[var(--accent)] transition-colors w-28"
                        />
                      </div>
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
                      data={{
                        ...tableData,
                        rows: rowSearch
                          ? tableData.rows.filter(row =>
                              row.some(cell => String(cell ?? "").toLowerCase().includes(rowSearch.toLowerCase()))
                            )
                          : tableData.rows,
                      }}
                      canEdit={true}
                      onEdit={row => setEditRowModal({ columns: tableData.columns, row: [...row], original: [...row] })}
                      onDelete={row => setDeleteRowModal({ columns: tableData.columns, row })}
                    />
                  ) : null}
                  {rowSearch && tableData && tableData.rows.filter(row =>
                    row.some(cell => String(cell ?? "").toLowerCase().includes(rowSearch.toLowerCase()))
                  ).length === 0 && (
                    <p className="text-[11px] text-[var(--muted)] italic text-center py-4">No rows match your search on this page</p>
                  )}
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
        <Modal isOpen onClose={() => { setCreateDbModal(false); setNewDbName(""); setNewDbPassword(""); }} title="Create New Database" size="sm">
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
            {(browserDb?.type || createDbType) !== "redis" && (
              <div>
                <label className="text-xs text-[var(--muted)] mb-1.5 block">
                  Password for external access <span className="text-[10px] opacity-60">(optional)</span>
                </label>
                <input
                  type="text"
                  value={newDbPassword}
                  onChange={e => setNewDbPassword(e.target.value)}
                  placeholder="Set a strong password"
                  className="w-full px-3 py-2 text-sm rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-[var(--main)] focus:border-[var(--accent)] transition-colors font-mono"
                />
                <p className="text-[10px] text-[var(--muted)] mt-1">
                  A dedicated user <span className="font-mono text-[var(--main)]">{newDbName || "db_name"}</span> will be created with this password and granted full access.
                </p>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setCreateDbModal(false); setNewDbName(""); setNewDbPassword(""); }} className="px-4 py-2 text-sm rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors">Cancel</button>
              <button onClick={createDatabase} disabled={managingDb || !newDbName.trim()} className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50">
                <PlusCircle size={13} /> {managingDb ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Database Modal */}
      {deleteDbModal && (
        <Modal isOpen onClose={() => !deletingDb && setDeleteDbModal(null)} title="Delete Database" size="sm">
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-xl bg-red-500/5 border border-red-500/20">
              <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-400">Permanently delete this database?</p>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  All data in <strong className="font-mono">{deleteDbModal.name}</strong> will be lost. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteDbModal(null)} disabled={deletingDb} className="px-4 py-2 text-sm rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors disabled:opacity-50">Cancel</button>
              <button onClick={deleteDatabase} disabled={deletingDb} className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 transition-colors disabled:opacity-50">
                {deletingDb ? <><div className="w-3 h-3 border-2 border-red-400 border-t-transparent rounded-full animate-spin" /> Deleting...</> : <><Trash size={13} /> Delete Database</>}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Drop Table / Collection Modal */}
      {dropTableModal && (
        <Modal isOpen onClose={() => setDropTableModal(null)} title={browserDb?.type === "mongodb" ? "Drop Collection" : "Drop Table"} size="sm">
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-xl bg-red-500/5 border border-red-500/20">
              <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
              <p className="text-sm text-[var(--main)]">
                {browserDb?.type === "mongodb" ? "Drop collection" : "Drop table"} <strong className="font-mono">{dropTableModal}</strong>? This permanently deletes all data and cannot be undone.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDropTableModal(null)} className="px-4 py-2 text-sm rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors">Cancel</button>
              <button onClick={() => dropTable(dropTableModal)} className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 transition-colors">
                <MinusCircle size={13} /> {browserDb?.type === "mongodb" ? "Drop Collection" : "Drop Table"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* New Table / Collection Modal */}
      {newTableModal && browserDb && (
        <Modal isOpen onClose={() => setNewTableModal(false)} title={browserDb.type === "mongodb" ? "New Collection" : "New Table"} size="md">
          <div className="space-y-4">
            <div>
              <label className="text-xs text-[var(--muted)] mb-1.5 block">
                {browserDb.type === "mongodb" ? "Collection Name" : "Table Name"}
              </label>
              <input
                value={newTableName}
                onChange={e => setNewTableName(e.target.value)}
                placeholder={browserDb.type === "mongodb" ? "my_collection" : "my_table"}
                className="w-full px-3 py-2 text-sm font-mono rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-[var(--main)] focus:border-[var(--accent)] transition-colors"
                autoFocus
              />
            </div>
            {browserDb.type !== "mongodb" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-[var(--muted)] font-semibold uppercase tracking-wide">Columns</label>
                  <button
                    onClick={() => setNewTableCols(prev => [...prev, { name: "", type: "VARCHAR(255)" }])}
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors"
                  >
                    <Plus size={10} /> Add Column
                  </button>
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {newTableCols.map((col, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <input
                        value={col.name}
                        onChange={e => setNewTableCols(prev => prev.map((c, i) => i === idx ? { ...c, name: e.target.value } : c))}
                        placeholder="column_name"
                        className="flex-1 px-2.5 py-1.5 text-xs font-mono rounded-lg border border-[var(--line)] bg-[var(--foreground)] text-[var(--main)] focus:border-[var(--accent)] transition-colors"
                      />
                      <input
                        value={col.type}
                        onChange={e => setNewTableCols(prev => prev.map((c, i) => i === idx ? { ...c, type: e.target.value } : c))}
                        placeholder="VARCHAR(255)"
                        className="flex-1 px-2.5 py-1.5 text-xs font-mono rounded-lg border border-[var(--line)] bg-[var(--foreground)] text-[var(--main)] focus:border-[var(--accent)] transition-colors"
                      />
                      {newTableCols.length > 1 && (
                        <button
                          onClick={() => setNewTableCols(prev => prev.filter((_, i) => i !== idx))}
                          className="p-1 rounded text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="rounded-lg bg-[var(--foreground)] border border-[var(--line)] p-2">
                  <p className="text-[10px] text-[var(--muted)] font-mono">
                    SQL preview: CREATE TABLE {newTableName || "table_name"} ({newTableCols.map(c => `${c.name} ${c.type}`).join(", ")})
                  </p>
                </div>
              </div>
            )}
            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setNewTableModal(false)} className="px-4 py-2 text-sm rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors">Cancel</button>
              <button
                onClick={createTable}
                disabled={creatingTable || !newTableName.trim()}
                className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
              >
                <LayoutGrid size={13} /> {creatingTable ? "Creating..." : browserDb.type === "mongodb" ? "Create Collection" : "Create Table"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Add Document Modal (MongoDB) */}
      {addDocModal && selectedTable && (
        <Modal isOpen onClose={() => setAddDocModal(false)} title={`Insert Document into ${selectedTable}`} size="md">
          <div className="space-y-4">
            <div>
              <label className="text-xs text-[var(--muted)] mb-1.5 block">Document (JSON)</label>
              <textarea
                value={addDocJson}
                onChange={e => setAddDocJson(e.target.value)}
                rows={8}
                spellCheck={false}
                className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-[var(--main)] focus:border-[var(--accent)] transition-colors resize-y"
                placeholder='{ "name": "value", "count": 0 }'
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setAddDocModal(false)} className="px-4 py-2 text-sm rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors">Cancel</button>
              <button
                onClick={addDocument}
                disabled={addDocLoading}
                className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
              >
                <Plus size={13} /> {addDocLoading ? "Inserting..." : "Insert Document"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {/* Connection String Modal */}
      {connectionModal && (
        <Modal isOpen onClose={() => { setConnectionModal(null); setConnCopied(null); setConnPassword(""); setConnDbName(""); }} title={`Connect to ${connectionModal.name || connectionModal.type}`} size="lg">
          {(() => {
            const db = connectionModal;
            const host = activeServer?.ip ?? "127.0.0.1";
            const port = db.port;
            const pwd = connPassword || "PASSWORD";
            const dbName = connDbName.trim();
            const strings: { label: string; key: string; value: string; hasPwd: boolean }[] = [];
            if (db.type === "postgresql") {
              const pgDb = dbName || "postgres";
              strings.push({ label: "PostgreSQL URL", key: "pg", hasPwd: true, value: `postgresql://postgres:${pwd}@${host}:${port}/${pgDb}` });
              strings.push({ label: "psql CLI", key: "psql", hasPwd: false, value: `psql -h ${host} -p ${port} -U postgres -d ${pgDb}` });
            } else if (db.type === "mysql" || db.type === "mariadb") {
              const myDb = dbName || "";
              strings.push({ label: "MySQL URL", key: "mysql", hasPwd: true, value: `mysql://root:${pwd}@${host}:${port}/${myDb}` });
              strings.push({ label: "mysql CLI", key: "mysql-cli", hasPwd: true, value: `mysql -h ${host} -P ${port} -u root -p'${pwd}'${myDb ? ` ${myDb}` : ""}` });
            } else if (db.type === "mongodb") {
              const mongoDb = dbName || "admin";
              strings.push({ label: "MongoDB URI", key: "mongo", hasPwd: true, value: `mongodb://root:${pwd}@${host}:${port}/${mongoDb}?authSource=admin` });
              strings.push({ label: "mongosh CLI", key: "mongosh", hasPwd: true, value: `mongosh "mongodb://${host}:${port}/${mongoDb}" --username root --password '${pwd}' --authenticationDatabase admin` });
            } else if (db.type === "redis") {
              strings.push({ label: "Redis URL", key: "redis", hasPwd: true, value: `redis://:${pwd}@${host}:${port}/0` });
              strings.push({ label: "redis-cli", key: "redis-cli", hasPwd: true, value: `redis-cli -h ${host} -p ${port} -a '${pwd}'` });
            } else if (db.type === "sqlite") {
              const sqliteDb = dbName || "/path/to/database.db";
              strings.push({ label: "SQLite file path", key: "sqlite", hasPwd: false, value: sqliteDb });
              strings.push({ label: "sqlite3 CLI", key: "sqlite-cli", hasPwd: false, value: `sqlite3 ${sqliteDb}` });
            }
            const copyStr = (key: string, val: string) => {
              navigator.clipboard.writeText(val);
              setConnCopied(key);
              setTimeout(() => setConnCopied(null), 2000);
            };
            return (
              <div className="space-y-4">
                {/* Port + Status */}
                <div className="flex items-center gap-4 text-sm flex-wrap">
                  <div className="flex items-center gap-2">
                    <Globe size={13} className="text-[var(--muted)]" />
                    <span className="text-[var(--muted)]">Host:</span>
                    <span className="font-mono">{host}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--muted)]">Port:</span>
                    <span className="font-mono">{port}</span>
                  </div>
                  {db.running ? (
                    <div className="flex items-center gap-1.5 text-green-500"><Wifi size={13} /> Running</div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-red-500"><WifiOff size={13} /> Stopped</div>
                  )}
                </div>
                {/* Database Name + Password inputs */}
                <div className="grid grid-cols-2 gap-3">
                  {db.type !== "redis" && (
                    <div className={db.type === "sqlite" ? "col-span-2" : ""}>
                      <label className="text-xs text-[var(--muted)] mb-1.5 block font-semibold uppercase tracking-wide">
                        {db.type === "sqlite" ? "Database File Path" : "Database Name"}
                      </label>
                      <input
                        type="text"
                        value={connDbName}
                        onChange={e => setConnDbName(e.target.value)}
                        placeholder={
                          db.type === "postgresql" ? "postgres" :
                          db.type === "mongodb" ? "admin" :
                          db.type === "sqlite" ? "/var/db/app.db" :
                          "my_database"
                        }
                        className="w-full px-3 py-2 text-sm rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-[var(--main)] focus:border-[var(--accent)] transition-colors font-mono"
                      />
                    </div>
                  )}
                  {db.type !== "sqlite" && (
                    <div className={db.type === "redis" ? "col-span-2" : ""}>
                      <label className="text-xs text-[var(--muted)] mb-1.5 block font-semibold uppercase tracking-wide">Database Password</label>
                      <input
                        type="text"
                        value={connPassword}
                        onChange={e => setConnPassword(e.target.value)}
                        placeholder="Enter your database password"
                        className="w-full px-3 py-2 text-sm rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-[var(--main)] focus:border-[var(--accent)] transition-colors font-mono"
                      />
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-[var(--muted)] -mt-2">The connection strings below update as you type.</p>
                {/* Connection strings */}
                <div className="space-y-2">
                  {strings.map(({ label, key, value }) => (
                    <div key={key}>
                      <p className="text-[10px] text-[var(--muted)] font-semibold uppercase tracking-wider mb-1">{label}</p>
                      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--foreground)] border border-[var(--line)]">
                        <code className="text-[11px] font-mono flex-1 truncate text-[var(--main)]">{value}</code>
                        <button
                          onClick={() => copyStr(key, value)}
                          className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors text-[10px] font-medium"
                        >
                          {connCopied === key ? <Check size={11} /> : <Copy size={11} />}
                          {connCopied === key ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                {/* External access note */}
                {host === "127.0.0.1" && (
                  <div className="p-3 rounded-xl bg-[var(--foreground)] border border-[var(--line)] text-xs text-[var(--muted)]">
                    <p className="font-semibold text-[var(--main)] mb-1">Need external access?</p>
                    <p>To connect from outside this server, you'll need to:</p>
                    <ol className="list-decimal list-inside mt-1 space-y-0.5">
                      <li>Change bind-address to <code className="font-mono bg-[var(--secondary)] px-1 rounded">0.0.0.0</code> in the DB config</li>
                      <li>Open port <code className="font-mono bg-[var(--secondary)] px-1 rounded">{port}</code> in your firewall (UFW)</li>
                      <li>Then use your server IP: <code className="font-mono bg-[var(--secondary)] px-1 rounded">{activeServer?.ip ?? "YOUR_SERVER_IP"}</code></li>
                    </ol>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  {db.type !== "sqlite" && (
                    <button
                      onClick={() => { setConnectionModal(null); setConnPassword(""); setConnDbName(""); setChangePwdVal(""); setChangePassModal({ type: db.type, name: db.name || db.type }); }}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl border border-[var(--line)] hover:border-orange-400/40 hover:text-orange-400 transition-colors"
                    >
                      <Lock size={13} /> Change Password
                    </button>
                  )}
                  <button onClick={() => { setConnectionModal(null); setConnPassword(""); setConnDbName(""); }} className="btn-secondary px-4 py-2 text-sm ml-auto">Close</button>
                </div>
              </div>
            );
          })()}
        </Modal>
      )}
    </section>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function InstalledCard({ db, actionLoading, actionMutation, onBrowse, onUninstall, onDeleteDb, onCreateDb, onConnect }: {
  db: any;
  actionLoading: string | null;
  actionMutation: any;
  onBrowse: (db: any, name: string) => void;
  onUninstall: () => void;
  onDeleteDb: (name: string) => void;
  onCreateDb: () => void;
  onConnect: () => void;
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
          <div className="flex justify-between items-center text-xs">
            <span className="text-[var(--muted)]">Databases</span>
            <div className="flex items-center gap-2">
              {db.running && db.type !== "redis" && (
                <button
                  onClick={e => { e.stopPropagation(); onCreateDb(); }}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20 hover:bg-[var(--accent)]/20 transition-colors"
                  title="Create new database"
                >
                  <Plus size={9} /> New
                </button>
              )}
              <button
                onClick={() => setShowDbs(!showDbs)}
                className="font-mono font-medium text-[var(--accent)] hover:underline flex items-center gap-1"
              >
                {db.databases.length} <FolderOpen size={10} />
              </button>
            </div>
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
            <div key={d} className="flex items-center gap-1 group/row">
              <button
                onClick={() => onBrowse(db, d)}
                className="flex-1 flex items-center justify-between px-2 py-1.5 rounded-lg bg-[var(--foreground)] border border-[var(--line)] hover:border-[var(--accent)]/40 transition-colors group min-w-0"
              >
                <span className="text-[11px] font-mono truncate">{d}</span>
                <span className="flex items-center gap-1 text-[10px] text-[var(--muted)] group-hover:text-[var(--accent)] transition-colors shrink-0 ml-2">
                  <Table2 size={10} /> Browse
                </span>
              </button>
              <button
                onClick={e => { e.stopPropagation(); onDeleteDb(d); }}
                className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                title={`Delete database "${d}"`}
              >
                <Trash size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Connect button */}
      <button
        onClick={onConnect}
        className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] rounded-lg bg-[var(--foreground)] border border-[var(--line)] hover:border-[var(--accent)]/50 text-[var(--muted)] hover:text-[var(--accent)] transition-colors mb-2"
      >
        <Globe size={11} /> Connection Strings
      </button>

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

function EditableDataTable({ data, canEdit, onEdit, onDelete }: {
  data: TableData;
  canEdit: boolean;
  onEdit: (row: any[]) => void;
  onDelete: (row: any[]) => void;
}) {
  if (!data.columns || data.columns.length === 0) {
    return <p className="text-xs text-[var(--muted)] italic">No data returned</p>;
  }
  return (
    <div className="overflow-auto max-h-64 rounded-xl border border-[var(--line)] relative">
      <table className="vps-table text-[11px] min-w-max w-full">
        <thead className="sticky top-0 z-20 bg-[var(--secondary)]">
          <tr>
            {canEdit && (
              <th className="sticky left-0 z-30 px-2 py-2 border-b border-r border-[var(--line)] bg-[var(--secondary)] text-center w-14 shrink-0">
                <span className="text-[9px] font-semibold text-[var(--muted)] uppercase tracking-wide">Act.</span>
              </th>
            )}
            {data.columns.map((col) => (
              <th key={col} className="px-3 py-2 text-left font-semibold text-[var(--muted)] uppercase tracking-wide whitespace-nowrap border-b border-[var(--line)]">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.length === 0 ? (
            <tr>
              <td colSpan={data.columns.length + (canEdit ? 1 : 0)} className="text-center py-6 text-[var(--muted)] italic">
                No rows found
              </td>
            </tr>
          ) : (
            data.rows.map((row, i) => (
              <tr key={i} className="hover:bg-[var(--foreground)] transition-colors group">
                {canEdit && (
                  <td className="sticky left-0 z-10 px-1.5 py-1.5 border-r border-[var(--line)] bg-[var(--background)] group-hover:bg-[var(--foreground)] transition-colors">
                    <div className="flex items-center gap-0.5 justify-center">
                      <button
                        onClick={() => onEdit(row)}
                        className="p-1 rounded hover:bg-blue-500/15 text-blue-400 transition-colors"
                        title="Edit"
                      >
                        <Edit3 size={11} />
                      </button>
                      <button
                        onClick={() => onDelete(row)}
                        className="p-1 rounded hover:bg-red-500/15 text-red-400 transition-colors"
                        title="Delete"
                      >
                        <Trash size={11} />
                      </button>
                    </div>
                  </td>
                )}
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-2 font-mono max-w-[200px] truncate" title={String(cell ?? "")}>
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
