import { Heart } from "lucide-react";

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
        <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--muted)]">
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
    </footer>
  );
}
