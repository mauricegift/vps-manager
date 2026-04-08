import { Activity, Heart } from "lucide-react";

export default function Footer() {
  return (
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
          <div className="flex items-center gap-1 text-[11px] text-[var(--muted)]">
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
          </div>
          <div className="text-[11px] text-[var(--muted)]">&copy; {new Date().getFullYear()} VPS Manager</div>
        </div>
      </div>
    </footer>
  );
}
