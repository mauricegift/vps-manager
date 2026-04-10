import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Server, Container, Database,
  FolderOpen, Terminal, Menu, Activity, Globe, Sun, Moon,
  Unplug, Wifi, Sparkles, Shield, LogOut, User
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useRemoteServer } from "@/context/RemoteServerContext";
import { useAuth } from "@/context/AuthContext";
import { toast } from "react-toastify";

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

interface Props { onMenuToggle: () => void; menuOpen: boolean; }

export default function Header({ onMenuToggle }: Props) {
  const { pathname } = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { activeServer, disconnect } = useRemoteServer();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    toast.success("Logged out successfully");
    navigate("/login");
  };

  return (
    <header
      className="fixed top-0 left-0 right-0 z-40"
      style={{
        background: "var(--secondary)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderBottom: "1px solid var(--line)",
        borderRadius: activeServer ? "0 0 0 0" : "0 0 18px 18px",
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
              <div className="hidden sm:flex items-center gap-2">
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-[var(--line)] text-xs text-[var(--muted)]">
                  <User size={12} />
                  <span className="max-w-[80px] truncate font-medium text-[var(--main)]">{user.username}</span>
                </div>
                <button
                  onClick={handleLogout}
                  title="Sign out"
                  className="p-2 rounded-xl border border-[var(--line)] text-[var(--muted)] hover:text-red-400 hover:border-red-400/40 hover:bg-red-500/5 transition-colors"
                >
                  <LogOut size={15} />
                </button>
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
  );
}
