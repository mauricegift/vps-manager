import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Activity, Sun, Moon, LayoutDashboard, LogIn, Menu, X, Heart } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useAuth } from "@/context/AuthContext";
import Pattern from "@/components/ui/Pattern";

const publicNav = [
  { path: "/home", label: "Home" },
  { path: "/about", label: "About" },
  { path: "/contact", label: "Contact" },
  { path: "/terms", label: "Terms" },
  { path: "/privacy", label: "Privacy" },
];

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const isAuthPage = pathname === "/login" || pathname === "/register"
    || pathname === "/forgot-password" || pathname === "/reset-password";
  const isLoginPage = pathname === "/login";

  return (
    <Pattern>
      <div className="flex flex-col min-h-screen">
        {/* Header */}
        <header
          className="fixed top-0 left-0 right-0 z-40"
          style={{
            background: "var(--secondary)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            borderBottom: "1px solid var(--line)",
            borderRadius: "0 0 18px 18px",
            boxShadow: "0 2px 20px rgba(0,0,0,0.08)",
          }}
        >
          <div className="main">
            <div className="flex items-center justify-between h-12 gap-3">
              {/* Logo */}
              <Link to={user ? "/" : "/home"} className="flex items-center gap-2.5 group shrink-0">
                <div className="p-2 rounded-xl" style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}>
                  <Activity size={17} className="text-white" />
                </div>
                <div>
                  <span className="text-sm font-bold leading-none">VPS Manager</span>
                  <span className="block text-[10px] text-[var(--muted)] leading-none mt-0.5">Control Panel</span>
                </div>
              </Link>

              {/* Desktop nav — hidden on auth pages */}
              {!isAuthPage && (
                <nav className="hidden md:flex items-center gap-0.5">
                  {publicNav.map(({ path, label }) => {
                    const active = pathname === path;
                    return (
                      <Link
                        key={path}
                        to={path}
                        className={`px-3 py-2 rounded-xl text-[13px] font-medium transition-all ${
                          active
                            ? "bg-[var(--accent)] text-white shadow-sm"
                            : "text-[var(--muted)] hover:text-[var(--main)] hover:bg-[var(--foreground)]"
                        }`}
                      >
                        {label}
                      </Link>
                    );
                  })}
                </nav>
              )}

              {/* Right side */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={toggleTheme}
                  title="Toggle theme"
                  className="p-2 rounded-xl border border-[var(--line)] text-[var(--muted)] hover:text-[var(--main)] hover:bg-[var(--foreground)] transition-colors"
                >
                  {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
                </button>

                {user ? (
                  <Link
                    to="/"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium text-white transition-all"
                    style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}
                  >
                    <LayoutDashboard size={14} />
                    Dashboard
                  </Link>
                ) : !isLoginPage ? (
                  <Link
                    to="/login"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium text-white transition-all"
                    style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}
                  >
                    <LogIn size={14} />
                    Sign In
                  </Link>
                ) : null}

                {/* Mobile menu — only on public info pages */}
                {!isAuthPage && (
                  <button
                    onClick={() => setMenuOpen(v => !v)}
                    className="md:hidden p-2 rounded-xl border border-[var(--line)] text-[var(--muted)] hover:text-[var(--main)] hover:bg-[var(--foreground)] transition-colors"
                  >
                    <Menu size={18} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Mobile sidebar — public nav */}
        {menuOpen && (
          <div className="fixed inset-0 z-50 md:hidden" onClick={() => setMenuOpen(false)}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <aside
              className="absolute top-0 left-0 bottom-0 w-64"
              style={{
                background: "var(--secondary)",
                borderRight: "1px solid var(--line)",
                borderTopRightRadius: "24px",
                borderBottomRightRadius: "24px",
                boxShadow: "8px 0 32px rgba(0,0,0,0.3)",
              }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between p-5 border-b border-[var(--line)]">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl" style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}>
                      <Activity size={15} className="text-white" />
                    </div>
                    <span className="text-sm font-bold">VPS Manager</span>
                  </div>
                  <button onClick={() => setMenuOpen(false)} className="p-2 rounded-xl border border-[var(--line)] text-[var(--muted)] hover:text-[var(--main)] transition-colors">
                    <X size={15} />
                  </button>
                </div>

                <nav className="flex-1 p-4 space-y-1">
                  {publicNav.map(({ path, label }) => {
                    const active = pathname === path;
                    return (
                      <Link
                        key={path}
                        to={path}
                        onClick={() => setMenuOpen(false)}
                        className={`flex items-center px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                          active
                            ? "bg-[var(--accent)] text-white"
                            : "text-[var(--muted)] hover:text-[var(--main)] hover:bg-[var(--foreground)]"
                        }`}
                      >
                        {label}
                      </Link>
                    );
                  })}
                </nav>

                <div className="p-4 border-t border-[var(--line)] space-y-2">
                  {user ? (
                    <Link
                      to="/"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold text-white"
                      style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}
                    >
                      <LayoutDashboard size={14} />
                      Go to Dashboard
                    </Link>
                  ) : (
                    <Link
                      to="/login"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold text-white"
                      style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}
                    >
                      <LogIn size={14} />
                      Sign In
                    </Link>
                  )}
                </div>
              </div>
            </aside>
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 pt-14 flex flex-col">
          {children}
        </main>

        {/* Footer — minimal, matching app footer */}
        <footer
          className="mt-4"
          style={{
            background: "var(--secondary)",
            borderTop: "1px solid var(--line)",
            borderRadius: "18px 18px 0 0",
          }}
        >
          <div className="main py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="p-1 rounded-lg" style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}>
                  <Activity size={12} className="text-white" />
                </div>
                <span className="text-xs font-semibold">VPS Manager</span>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-[var(--muted)]">
                <span>&copy; {new Date().getFullYear()} VPS Manager</span>
                <span className="flex items-center gap-1">
                  <span>Built with</span>
                  <Heart size={10} className="text-red-400 fill-red-400 mx-0.5" />
                  <span>by</span>
                  <a
                    href="https://me.giftedtech.co.ke"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-[var(--accent)] hover:underline"
                  >
                    Gifted Tech
                  </a>
                </span>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </Pattern>
  );
}
