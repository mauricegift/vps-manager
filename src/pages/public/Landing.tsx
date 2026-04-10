import { Server, Container, Database, FolderOpen, Terminal, Shield, ArrowRight, CheckCircle, Github } from "lucide-react";
import { Link } from "react-router-dom";

const GITHUB = "https://github.com/mauricegift/vps-manager";

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

const rowAos = ["fade-right", "fade-up", "fade-left"] as const;

export default function LandingPage() {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6">

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative text-center py-10 sm:py-16 overflow-hidden">

        {/* Decorative floating glow blobs */}
        <div
          className="hero-blob absolute -top-10 -left-16 w-72 h-72 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, var(--accent) 0%, transparent 70%)", filter: "blur(60px)" }}
        />
        <div
          className="hero-blob-alt absolute -bottom-8 -right-12 w-64 h-64 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, #7c3aed 0%, transparent 70%)", filter: "blur(55px)" }}
        />
        <div
          className="hero-blob absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-40 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(ellipse, var(--accent) 0%, transparent 65%)", filter: "blur(80px)", opacity: 0.12 }}
        />

        {/* Heading */}
        <h1
          className="hero-fade-up relative text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight mb-5"
          style={{ animationDelay: "0ms" }}
        >
          Your VPS,{" "}
          <span className="hero-gradient-text">fully in control</span>
        </h1>

        {/* Subheading */}
        <p
          className="hero-fade-up relative text-lg text-[var(--muted)] max-w-2xl mx-auto mb-8 leading-relaxed"
          style={{ animationDelay: "140ms" }}
        >
          VPS Manager is a self-hosted web control panel for managing your Linux server — PM2, Docker, Nginx, databases, files and a web terminal, all in one place.
        </p>

        {/* CTA buttons */}
        <div
          className="hero-scale-in relative flex flex-wrap items-center justify-center gap-3"
          style={{ animationDelay: "260ms" }}
        >
          <a
            href={GITHUB}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-white text-sm transition-all shadow-lg shadow-indigo-500/25 hover:scale-105 hover:shadow-indigo-500/40"
            style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}
          >
            <Github size={15} />
            Get Started Free <ArrowRight size={15} />
          </a>
          <Link
            to="/login"
            className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm border border-[var(--line)] hover:bg-[var(--foreground)] transition-all"
          >
            Sign In
          </Link>
        </div>
      </section>

      {/* ── Highlights ───────────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-14">
        {highlights.map((h, i) => (
          <div
            key={h}
            data-aos={rowAos[i % 3]}
            data-aos-delay={String(Math.floor(i / 3) * 80)}
            className="flex items-center gap-2.5 p-3 rounded-xl border border-[var(--line)]"
            style={{ background: "var(--secondary)" }}
          >
            <CheckCircle size={14} className="text-green-400 shrink-0" />
            <span className="text-xs font-medium">{h}</span>
          </div>
        ))}
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section className="mb-16">
        <h2 data-aos="fade-down" data-aos-duration="500" className="text-2xl font-bold text-center mb-10">
          Everything you need to manage your server
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map(({ icon: Icon, title, desc }, i) => (
            <div
              key={title}
              data-aos={rowAos[i % 3]}
              data-aos-delay={String(Math.floor(i / 3) * 100)}
              data-aos-duration="600"
              className="p-5 rounded-2xl border border-[var(--line)] hover:border-[var(--accent)]/40 transition-all group"
              style={{ background: "var(--secondary)" }}
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform"
                style={{ background: "linear-gradient(135deg, var(--accent)/20, #7c3aed/20)", border: "1px solid var(--accent)/20" }}
              >
                <Icon size={18} style={{ color: "var(--accent)" }} />
              </div>
              <h3 className="font-semibold mb-1.5">{title}</h3>
              <p className="text-sm text-[var(--muted)] leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <section data-aos="zoom-in" data-aos-duration="600" className="text-center pb-12">
        <div
          className="p-10 rounded-3xl border border-[var(--accent)]/20"
          style={{ background: "linear-gradient(135deg, var(--accent)/8, #7c3aed/8)" }}
        >
          <h2 className="text-2xl font-bold mb-3">Ready to take control?</h2>
          <p className="text-[var(--muted)] mb-6 text-sm">
            Star us on GitHub and deploy VPS Manager on your server in minutes.
          </p>
          <a
            href={GITHUB}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-8 py-3 rounded-xl font-semibold text-white text-sm transition-all hover:scale-105 shadow-lg shadow-indigo-500/20"
            style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}
          >
            <Github size={15} />
            View on GitHub <ArrowRight size={15} />
          </a>
        </div>
      </section>
    </div>
  );
}
