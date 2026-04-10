import { Link } from "react-router-dom";
import { Activity, Server, Container, Database, FolderOpen, Terminal, Shield, Sparkles, ArrowRight, CheckCircle } from "lucide-react";

const features = [
  { icon: Server, title: "PM2 Process Manager", desc: "Start, stop, restart and monitor Node.js processes with full log streaming." },
  { icon: Container, title: "Docker Management", desc: "Manage containers, images and volumes with a clean visual interface." },
  { icon: Database, title: "Database Tools", desc: "Browse and query PostgreSQL, MySQL and SQLite databases directly." },
  { icon: FolderOpen, title: "File Manager", desc: "Upload, edit, download and zip files with a built-in syntax-highlighted editor." },
  { icon: Terminal, title: "Web Terminal", desc: "Full interactive bash shell in your browser — local and remote." },
  { icon: Shield, title: "Nginx Manager", desc: "Create and manage reverse proxy configurations and SSL certificates." },
];

const highlights = [
  "JWT-secured with refresh tokens",
  "Local & remote VPS management",
  "Real-time terminal via WebSocket",
  "Syntax-highlighted file editor",
  "Dark & light theme support",
  "One-command install script",
];

export default function LandingPage() {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6">
      {/* Hero */}
      <section className="text-center py-20 sm:py-28">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent)] text-xs font-medium mb-6">
          <Activity size={12} />
          Open Source · Self-Hosted · Free
        </div>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight mb-6">
          Your VPS,{" "}
          <span style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            fully in control
          </span>
        </h1>
        <p className="text-lg text-[var(--muted)] max-w-2xl mx-auto mb-8 leading-relaxed">
          VPS Manager is a self-hosted web control panel for managing your Linux server — PM2, Docker, Nginx, databases, files and a web terminal, all in one place.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link to="/register"
            className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-white text-sm transition-all shadow-lg shadow-indigo-500/20 hover:scale-105"
            style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}>
            Get Started Free <ArrowRight size={15} />
          </Link>
          <Link to="/login"
            className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm border border-[var(--line)] hover:bg-[var(--foreground)] transition-all">
            Sign In
          </Link>
        </div>
      </section>

      {/* Highlights */}
      <section className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-20">
        {highlights.map(h => (
          <div key={h} className="flex items-center gap-2.5 p-3 rounded-xl border border-[var(--line)]" style={{ background: "var(--secondary)" }}>
            <CheckCircle size={14} className="text-green-400 shrink-0" />
            <span className="text-xs font-medium">{h}</span>
          </div>
        ))}
      </section>

      {/* Features */}
      <section className="mb-24">
        <h2 className="text-2xl font-bold text-center mb-10">Everything you need to manage your server</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="p-5 rounded-2xl border border-[var(--line)] hover:border-[var(--accent)]/40 transition-all group" style={{ background: "var(--secondary)" }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform"
                style={{ background: "linear-gradient(135deg, var(--accent)/20, #7c3aed/20)", border: "1px solid var(--accent)/20" }}>
                <Icon size={18} style={{ color: "var(--accent)" }} />
              </div>
              <h3 className="font-semibold mb-1.5">{title}</h3>
              <p className="text-sm text-[var(--muted)] leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="text-center pb-20">
        <div className="p-10 rounded-3xl border border-[var(--accent)]/20" style={{ background: "linear-gradient(135deg, var(--accent)/8, #7c3aed/8)" }}>
          <h2 className="text-2xl font-bold mb-3">Ready to take control?</h2>
          <p className="text-[var(--muted)] mb-6 text-sm">Create a free account and start managing your VPS in minutes.</p>
          <Link to="/register"
            className="inline-flex items-center gap-2 px-8 py-3 rounded-xl font-semibold text-white text-sm transition-all hover:scale-105 shadow-lg shadow-indigo-500/20"
            style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}>
            Create Account <ArrowRight size={15} />
          </Link>
        </div>
      </section>
    </div>
  );
}
