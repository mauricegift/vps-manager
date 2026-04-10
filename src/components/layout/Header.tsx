import { useState, useRef, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Server, Container, Database,
  FolderOpen, Terminal, Menu, Activity, Globe, Sun, Moon,
  Unplug, Wifi, Sparkles, Shield, LogOut, User, UserPlus,
  Users, Trash2, X, Eye, EyeOff, ChevronDown
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useRemoteServer } from "@/context/RemoteServerContext";
import { useAuth } from "@/context/AuthContext";
import { toast } from "react-toastify";
import api from "@/lib/api";

const nav = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/pm2", label: "PM2", icon: Server },
  { path: "/docker", label: "Docker", icon: Container },
  { path: "/databases", label: "Databases", icon: Database },
  { path: "/files", label: "Files", icon: FolderOpen },
  { path: "/terminal", label: "Terminal", icon: Terminal },
  { path: "/nginx", label: "Nginx", icon: Shield },
  { path: "/extras", label: "Extras", icon: Sparkles },
  { path: "/servers", label: "Servers", icon: Globe },
];

interface UserRecord {
  id: number;
  username: string;
  email: string;
  created_at: string;
}

interface Props { onMenuToggle: () => void; menuOpen: boolean; }

export default function Header({ onMenuToggle }: Props) {
  const { pathname } = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { activeServer, disconnect } = useRemoteServer();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [dropOpen, setDropOpen] = useState(false);
  const [showUsersModal, setShowUsersModal] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setDropOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleLogout = async () => {
    setDropOpen(false);
    await logout();
    toast.success("Signed out successfully");
    navigate("/login");
  };

  return (
    <>
      <header
        className="fixed top-0 left-0 right-0 z-40"
        style={{
          background: "var(--secondary)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderBottom: "1px solid var(--line)",
          borderRadius: activeServer ? "0" : "0 0 18px 18px",
          boxShadow: "0 2px 20px rgba(0,0,0,0.08)",
        }}
      >
        <div
          className="absolute bottom-0 left-0 right-0 h-[1px]"
          style={{
            background: "linear-gradient(90deg, transparent, var(--accent), transparent)",
            opacity: activeServer ? 0 : 0.3,
          }}
        />

        <div className="main">
          <div className="flex items-center justify-between h-12 gap-3">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2.5 group shrink-0">
              <div
                className="p-2 rounded-xl"
                style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}
              >
                <Activity size={17} className="text-white" />
              </div>
              <div>
                <span className="text-sm font-bold leading-none">VPS Manager</span>
                <span className="block text-[10px] text-[var(--muted)] leading-none mt-0.5">Control Panel</span>
              </div>
            </Link>

            {/* Desktop Nav */}
            <nav className="hidden lg:flex items-center gap-0.5 overflow-x-auto hide-scrollbar flex-1 justify-center">
              {nav.map(({ path, label, icon: Icon }) => {
                const active = pathname === path;
                return (
                  <Link
                    key={path}
                    to={path}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-medium transition-all whitespace-nowrap ${
                      active
                        ? "bg-[var(--accent)] text-white shadow-sm shadow-indigo-500/20"
                        : "text-[var(--muted)] hover:text-[var(--main)] hover:bg-[var(--foreground)]"
                    }`}
                  >
                    <Icon size={14} />
                    {label}
                  </Link>
                );
              })}
            </nav>

            {/* Right side */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={toggleTheme}
                title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                className="p-2 rounded-xl border border-[var(--line)] text-[var(--muted)] hover:text-[var(--main)] hover:bg-[var(--foreground)] transition-colors"
              >
                {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              </button>

              {user && (
                <div className="hidden sm:block relative" ref={dropRef}>
                  <button
                    onClick={() => setDropOpen(v => !v)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-[var(--line)] text-xs hover:bg-[var(--foreground)] transition-colors"
                  >
                    <User size={12} className="text-[var(--accent)]" />
                    <span className="max-w-[80px] truncate font-medium text-[var(--main)]">{user.username}</span>
                    <ChevronDown size={11} className={`text-[var(--muted)] transition-transform ${dropOpen ? "rotate-180" : ""}`} />
                  </button>

                  {dropOpen && (
                    <div
                      className="absolute right-0 mt-1 w-52 rounded-xl border border-[var(--line)] overflow-hidden z-50"
                      style={{ background: "var(--secondary)", boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}
                    >
                      <div className="px-3 py-2.5 border-b border-[var(--line)]">
                        <p className="text-xs font-semibold text-[var(--main)]">{user.username}</p>
                        <p className="text-[11px] text-[var(--muted)] truncate">{user.email}</p>
                      </div>
                      <button
                        onClick={() => { setDropOpen(false); setShowUsersModal(true); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-[var(--muted)] hover:text-[var(--main)] hover:bg-[var(--foreground)] transition-colors text-left"
                      >
                        <Users size={13} />
                        Manage Users
                      </button>
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/5 transition-colors text-left border-t border-[var(--line)]"
                      >
                        <LogOut size={13} />
                        Sign out
                      </button>
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={onMenuToggle}
                className="mobile-menu-btn lg:hidden p-2 rounded-xl border border-[var(--line)] text-[var(--muted)] hover:text-[var(--main)] hover:bg-[var(--foreground)] transition-colors"
              >
                <Menu size={18} />
              </button>
            </div>
          </div>
        </div>

        {/* Active Server Banner */}
        {activeServer && (
          <div
            style={{
              background: "linear-gradient(90deg, rgba(34,197,94,0.12), rgba(34,197,94,0.06))",
              borderTop: "1px solid rgba(34,197,94,0.2)",
              borderBottom: "1px solid rgba(34,197,94,0.2)",
              borderRadius: "0 0 18px 18px",
            }}
            className="px-4 py-2 flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <Wifi size={13} className="text-green-400" />
              <span className="text-xs font-medium text-green-400">
                Managing: <span className="font-bold">{activeServer.name}</span>
              </span>
              <span className="text-xs text-green-400/60 font-mono hidden sm:inline">
                {activeServer.username}@{activeServer.ip}
              </span>
            </div>
            <button
              onClick={disconnect}
              className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 px-2.5 py-1 rounded-lg transition-colors font-medium"
            >
              <Unplug size={12} />
              Disconnect
            </button>
          </div>
        )}
      </header>

      {/* Manage Users Modal */}
      {showUsersModal && (
        <UsersModal onClose={() => setShowUsersModal(false)} currentUserId={user?.id ?? 0} />
      )}
    </>
  );
}

// ─── Manage Users Modal ────────────────────────────────────────────────────
function UsersModal({ onClose, currentUserId }: { onClose: () => void; currentUserId: number }) {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"list" | "create">("list");

  const [uname, setUname] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [creating, setCreating] = useState(false);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/auth/users");
      if (data.success) setUsers(data.data.users);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uname.trim() || !email.trim() || !pass) return;
    setCreating(true);
    try {
      const { data } = await api.post("/auth/users", { username: uname.trim(), email: email.trim(), password: pass });
      if (data.success) {
        toast.success(`User "${uname}" created`);
        setUname(""); setEmail(""); setPass("");
        setTab("list");
        fetchUsers();
      } else {
        toast.error(data.error || "Failed to create user");
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Failed to create user");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (u: UserRecord) => {
    if (!confirm(`Delete user "${u.username}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/auth/users/${u.id}`);
      toast.success(`User "${u.username}" deleted`);
      fetchUsers();
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Failed to delete user");
    }
  };

  return (
    <div className="fixed inset-0 z-[99] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}>
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--line)] overflow-hidden"
        style={{ background: "var(--secondary)", boxShadow: "0 24px 64px rgba(0,0,0,0.4)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--line)]">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-[var(--accent)]" />
            <span className="text-sm font-semibold text-[var(--main)]">User Management</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--foreground)] text-[var(--muted)] transition-colors">
            <X size={15} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--line)]">
          {(["list", "create"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                tab === t ? "text-[var(--accent)] border-b-2 border-[var(--accent)]" : "text-[var(--muted)] hover:text-[var(--main)]"
              }`}
            >
              {t === "list" ? <><Users size={12} className="inline mr-1.5" />All Users</> : <><UserPlus size={12} className="inline mr-1.5" />Add User</>}
            </button>
          ))}
        </div>

        <div className="p-5">
          {tab === "list" ? (
            loading ? (
              <div className="flex justify-center py-8">
                <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : users.length === 0 ? (
              <p className="text-center text-xs text-[var(--muted)] py-8">No users found</p>
            ) : (
              <div className="space-y-2">
                {users.map(u => (
                  <div
                    key={u.id}
                    className="flex items-center justify-between p-3 rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold text-white"
                        style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}
                      >
                        {u.username[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="text-xs font-medium text-[var(--main)] flex items-center gap-1.5">
                          {u.username}
                          {u.id === currentUserId && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)]">you</span>
                          )}
                        </p>
                        <p className="text-[11px] text-[var(--muted)]">{u.email}</p>
                      </div>
                    </div>
                    {u.id !== currentUserId && (
                      <button
                        onClick={() => handleDelete(u)}
                        className="p-1.5 rounded-lg text-[var(--muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Delete user"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )
          ) : (
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="block text-xs text-[var(--muted)] mb-1.5">Username</label>
                <input
                  value={uname}
                  onChange={e => setUname(e.target.value)}
                  placeholder="johndoe"
                  required
                  className="w-full px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-sm text-[var(--main)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--muted)] mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="john@example.com"
                  required
                  className="w-full px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-sm text-[var(--main)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--muted)] mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPass ? "text" : "password"}
                    value={pass}
                    onChange={e => setPass(e.target.value)}
                    placeholder="Min. 6 characters"
                    required
                    minLength={6}
                    className="w-full px-3 py-2 pr-10 rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-sm text-[var(--main)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--main)] transition-colors"
                  >
                    {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={creating}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}
              >
                {creating ? "Creating..." : "Create User"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
