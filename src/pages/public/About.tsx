import { Link } from "react-router-dom";
import { Activity, Github, Globe, Code, Heart, ArrowRight } from "lucide-react";

export default function AboutPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
      <div className="text-center mb-12">
        <div className="inline-flex p-3 rounded-2xl mb-4" style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}>
          <Activity size={28} className="text-white" />
        </div>
        <h1 className="text-3xl font-bold mb-3">About VPS Manager</h1>
        <p className="text-[var(--muted)] leading-relaxed">
          A free, open-source, self-hosted control panel for Linux servers.
        </p>
      </div>

      <div className="space-y-6">
        <div className="p-6 rounded-2xl border border-[var(--line)]" style={{ background: "var(--secondary)" }}>
          <h2 className="font-bold text-lg mb-3 flex items-center gap-2"><Code size={18} style={{ color: "var(--accent)" }} /> What is VPS Manager?</h2>
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            VPS Manager is a modern, web-based server control panel built with React and Node.js. It gives you a clean, intuitive interface to manage every aspect of your Linux VPS — from running processes and Docker containers, to databases, files, Nginx configuration and a fully-featured web terminal — all from your browser.
          </p>
        </div>

        <div className="p-6 rounded-2xl border border-[var(--line)]" style={{ background: "var(--secondary)" }}>
          <h2 className="font-bold text-lg mb-3 flex items-center gap-2"><Heart size={18} className="text-red-400 fill-red-400" /> Why we built it</h2>
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            Managing a VPS usually means juggling SSH sessions, memorising CLI commands and hopping between half a dozen tools. We built VPS Manager to unify all of that into one beautiful panel that anyone — from a seasoned sysadmin to a developer deploying their first app — can use confidently.
          </p>
        </div>

        <div className="p-6 rounded-2xl border border-[var(--line)]" style={{ background: "var(--secondary)" }}>
          <h2 className="font-bold text-lg mb-3 flex items-center gap-2"><Globe size={18} style={{ color: "var(--accent)" }} /> Built by Gifted Tech</h2>
          <p className="text-sm text-[var(--muted)] leading-relaxed mb-4">
            VPS Manager is developed and maintained by{" "}
            <a href="https://me.giftedtech.co.ke" target="_blank" rel="noopener noreferrer"
              className="text-[var(--accent)] hover:underline font-medium">Gifted Tech</a>
            , a software development team passionate about open-source tools that make developers' lives easier.
          </p>
          <div className="flex flex-wrap gap-3">
            <a href="https://github.com/mauricegift/vps-manager" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[var(--line)] text-sm hover:bg-[var(--foreground)] transition-colors">
              <Github size={14} /> View on GitHub
            </a>
            <a href="https://me.giftedtech.co.ke" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[var(--line)] text-sm hover:bg-[var(--foreground)] transition-colors">
              <Globe size={14} /> Gifted Tech
            </a>
          </div>
        </div>
      </div>

      <div className="text-center mt-10">
        <Link to="/register"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-white text-sm transition-all hover:scale-105"
          style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}>
          Get Started <ArrowRight size={15} />
        </Link>
      </div>
    </div>
  );
}
