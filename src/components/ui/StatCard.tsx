import { type LucideIcon } from "lucide-react";

interface Props {
  label: string;
  value: string | number;
  sub?: string;
  icon: LucideIcon;
  color?: string;
  progress?: number;
  progressColor?: string;
  "data-aos"?: string;
  "data-aos-delay"?: string | number;
}

export default function StatCard({ label, value, sub, icon: Icon, color = "text-accent", progress, progressColor = "bg-indigo-500", ...aosProps }: Props) {
  return (
    <div className="glass-card p-5 space-y-3" {...aosProps}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">{label}</span>
        <div className={`p-2 rounded-lg bg-[var(--foreground)] ${color}`}>
          <Icon size={16} />
        </div>
      </div>
      <div>
        <div className="text-2xl font-bold">{value}</div>
        {sub && <div className="text-xs text-[var(--muted)] mt-0.5">{sub}</div>}
      </div>
      {progress !== undefined && (
        <div className="progress-bar">
          <div
            className={`progress-fill ${progressColor} ${progress > 80 ? "bg-red-500" : progress > 60 ? "bg-amber-500" : ""}`}
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
