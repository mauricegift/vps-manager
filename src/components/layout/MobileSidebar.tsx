import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Server, Container, Database,
  FolderOpen, Terminal, X, Activity, Globe, Sparkles
} from "lucide-react";

const nav = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard, desc: "System overview & health" },
  { path: "/pm2", label: "PM2", icon: Server, desc: "Process management" },
  { path: "/docker", label: "Docker", icon: Container, desc: "Containers & images" },
  { path: "/databases", label: "Databases", icon: Database, desc: "DB management" },
  { path: "/files", label: "Files", icon: FolderOpen, desc: "File manager" },
  { path: "/terminal", label: "Terminal", icon: Terminal, desc: "Run commands" },
  { path: "/extras", label: "Extras", icon: Sparkles, desc: "Software & user management" },
  { path: "/servers", label: "Servers", icon: Globe, desc: "Remote VPS management" },
];

interface Props { open: boolean; onClose: () => void; }

export default function MobileSidebar({ open, onClose }: Props) {
  const { pathname } = useLocation();

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={`fixed top-0 left-0 bottom-0 z-50 w-72 lg:hidden transition-transform duration-300 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{
          background: "var(--secondary)",
          borderRight: "1px solid var(--line)",
          borderTopRightRadius: "24px",
          borderBottomRightRadius: "24px",
          boxShadow: "8px 0 32px rgba(0,0,0,0.3)",
        }}
      >
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between p-5 border-b border-[var(--line)]">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl" style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}>
                <Activity size={17} className="text-white" />
              </div>
              <div>
                <span className="text-sm font-bold leading-none">VPS Manager</span>
                <span className="block text-[10px] text-[var(--muted)] leading-none mt-0.5">Control Panel</span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl border border-[var(--line)] text-[var(--muted)] hover:text-[var(--main)] transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
            {nav.map(({ path, label, icon: Icon, desc }) => {
              const active = pathname === path;
              return (
                <Link
                  key={path}
                  to={path}
                  onClick={onClose}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                    active
                      ? "bg-[var(--accent)] text-white shadow-sm"
                      : "text-[var(--muted)] hover:text-[var(--main)] hover:bg-[var(--foreground)]"
                  }`}
                >
                  <Icon size={18} />
                  <div>
                    <div className="text-sm font-medium leading-none">{label}</div>
                    <div className={`text-[10px] mt-0.5 ${active ? "text-white/70" : "text-[var(--muted)]"}`}>{desc}</div>
                  </div>
                </Link>
              );
            })}
          </nav>

          <div className="p-4 border-t border-[var(--line)]">
            <div className="text-[10px] text-[var(--muted)] text-center">VPS Manager v1.0 · Port 5756</div>
          </div>
        </div>
      </aside>
    </>
  );
}
