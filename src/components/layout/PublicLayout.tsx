import { Link, useLocation } from "react-router-dom";
import { Activity, Sun, Moon } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import Pattern from "@/components/ui/Pattern";

const publicNav = [
  { path: "/", label: "Home" },
  { path: "/about", label: "About" },
  { path: "/contact", label: "Contact" },
  { path: "/terms", label: "Terms" },
  { path: "/privacy", label: "Privacy" },
];

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const { theme, toggleTheme } = useTheme();

  return (
    <Pattern>
      <div className="flex flex-col min-h-screen">
        {/* Public header */}
        <header className="fixed top-0 left-0 right-0 z-40"
          style={{
            background: "var(--secondary)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            borderBottom: "1px solid var(--line)",
            borderRadius: "0 0 18px 18px",
            boxShadow: "0 2px 20px rgba(0,0,0,0.08)",
          }}>
          <div className="main">
            <div className="flex items-center justify-between h-12 gap-3">
              <Link to="/" className="flex items-center gap-2.5 group shrink-0">
                <div className="p-2 rounded-xl" style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}>
                  <Activity size={17} className="text-white" />
                </div>
                <div>
                  <span className="text-sm font-bold leading-none">VPS Manager</span>
                  <span className="block text-[10px] text-[var(--muted)] leading-none mt-0.5">Control Panel</span>
                </div>
              </Link>

              <nav className="hidden md:flex items-center gap-0.5">
                {publicNav.map(({ path, label }) => {
                  const active = pathname === path;
                  return (
                    <Link key={path} to={path}
                      className={`px-3 py-2 rounded-xl text-[13px] font-medium transition-all ${
                        active
                          ? "bg-[var(--accent)] text-white shadow-sm"
                          : "text-[var(--muted)] hover:text-[var(--main)] hover:bg-[var(--foreground)]"
                      }`}>
                      {label}
                    </Link>
                  );
                })}
              </nav>

              <div className="flex items-center gap-2 shrink-0">
                <button onClick={toggleTheme} title="Toggle theme"
                  className="p-2 rounded-xl border border-[var(--line)] text-[var(--muted)] hover:text-[var(--main)] hover:bg-[var(--foreground)] transition-colors">
                  {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
                </button>
                <Link to="/login"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium text-white transition-all"
                  style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}>
                  Sign In
                </Link>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 pt-20">
          {children}
        </main>

        <footer style={{ background: "var(--secondary)", borderTop: "1px solid var(--line)", borderRadius: "18px 18px 0 0" }}>
          <div className="main py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="p-1 rounded-lg" style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}>
                  <Activity size={12} className="text-white" />
                </div>
                <span className="text-xs font-semibold">VPS Manager</span>
              </div>
              <div className="flex items-center gap-4 text-xs text-[var(--muted)]">
                <Link to="/about" className="hover:text-[var(--main)] transition-colors">About</Link>
                <Link to="/contact" className="hover:text-[var(--main)] transition-colors">Contact</Link>
                <Link to="/privacy" className="hover:text-[var(--main)] transition-colors">Privacy Policy</Link>
                <Link to="/terms" className="hover:text-[var(--main)] transition-colors">Terms of Service</Link>
              </div>
              <span className="text-xs text-[var(--muted)]">&copy; {new Date().getFullYear()} VPS Manager · Built by{" "}
                <a href="https://me.giftedtech.co.ke" target="_blank" rel="noopener noreferrer"
                  className="text-[var(--accent)] hover:underline font-medium">Gifted Tech</a>
              </span>
            </div>
          </div>
        </footer>
      </div>
    </Pattern>
  );
}
