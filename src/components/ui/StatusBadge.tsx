interface Props {
  status: string;
  size?: "sm" | "md";
}

function normalize(s: string) {
  return (s || "").toLowerCase();
}

function getColor(s: string) {
  const n = normalize(s);
  if (["online", "running", "up", "active", "started", "healthy"].includes(n)) return "success";
  if (["stopped", "offline", "exited", "inactive"].includes(n)) return "danger";
  if (["errored", "error", "unhealthy"].includes(n)) return "danger";
  if (["stopping", "restarting", "launching", "paused"].includes(n)) return "warning";
  return "muted";
}

const colors: Record<string, string> = {
  success: "bg-green-500/10 text-green-500 border-green-500/20",
  danger: "bg-red-500/10 text-red-400 border-red-500/20",
  warning: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  muted: "bg-[var(--line)] text-[var(--muted)] border-[var(--line)]",
};

const dots: Record<string, string> = {
  success: "bg-green-500",
  danger: "bg-red-400",
  warning: "bg-amber-400",
  muted: "bg-gray-500",
};

export default function StatusBadge({ status, size = "md" }: Props) {
  const color = getColor(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${colors[color]} ${
        size === "sm" ? "text-[10px] px-2 py-0.5" : "text-[11px] px-2.5 py-1"
      }`}
    >
      <span className={`status-dot ${dots[color]} w-1.5 h-1.5 rounded-full`} />
      {status}
    </span>
  );
}
