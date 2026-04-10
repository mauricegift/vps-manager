import { Mail, Globe, Github, MessageCircle } from "lucide-react";

export default function ContactPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
      <div className="text-center mb-12">
        <h1 className="text-3xl font-bold mb-3">Contact Us</h1>
        <p className="text-[var(--muted)] text-sm leading-relaxed">
          Have a question, found a bug, or want to contribute? We'd love to hear from you.
        </p>
      </div>

      <div className="space-y-4">
        <a href="mailto:info@giftedtech.co.ke"
          className="flex items-center gap-4 p-5 rounded-2xl border border-[var(--line)] hover:border-[var(--accent)]/40 transition-all group"
          style={{ background: "var(--secondary)" }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg, var(--accent)/15, #7c3aed/15)" }}>
            <Mail size={18} style={{ color: "var(--accent)" }} />
          </div>
          <div>
            <p className="font-semibold text-sm">Email</p>
            <p className="text-[var(--muted)] text-xs mt-0.5">info@giftedtech.co.ke</p>
          </div>
        </a>

        <a href="https://github.com/mauricegift/vps-manager" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-4 p-5 rounded-2xl border border-[var(--line)] hover:border-[var(--accent)]/40 transition-all group"
          style={{ background: "var(--secondary)" }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg, var(--accent)/15, #7c3aed/15)" }}>
            <Github size={18} style={{ color: "var(--accent)" }} />
          </div>
          <div>
            <p className="font-semibold text-sm">GitHub Issues</p>
            <p className="text-[var(--muted)] text-xs mt-0.5">Report bugs or request features on GitHub</p>
          </div>
        </a>

        <a href="https://github.com/mauricegift/vps-manager/discussions" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-4 p-5 rounded-2xl border border-[var(--line)] hover:border-[var(--accent)]/40 transition-all group"
          style={{ background: "var(--secondary)" }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg, var(--accent)/15, #7c3aed/15)" }}>
            <MessageCircle size={18} style={{ color: "var(--accent)" }} />
          </div>
          <div>
            <p className="font-semibold text-sm">GitHub Discussions</p>
            <p className="text-[var(--muted)] text-xs mt-0.5">Ask questions and share ideas with the community</p>
          </div>
        </a>

        <a href="https://me.giftedtech.co.ke" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-4 p-5 rounded-2xl border border-[var(--line)] hover:border-[var(--accent)]/40 transition-all group"
          style={{ background: "var(--secondary)" }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg, var(--accent)/15, #7c3aed/15)" }}>
            <Globe size={18} style={{ color: "var(--accent)" }} />
          </div>
          <div>
            <p className="font-semibold text-sm">Website</p>
            <p className="text-[var(--muted)] text-xs mt-0.5">me.giftedtech.co.ke</p>
          </div>
        </a>
      </div>
    </div>
  );
}
