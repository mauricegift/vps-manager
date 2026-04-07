import Modal from "./Modal";
import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
}

export default function ConfirmDialog({ isOpen, onClose, onConfirm, title, message, confirmLabel = "Confirm", danger = false, loading }: Props) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <div className="space-y-4">
        <div className="flex gap-3 items-start">
          <AlertTriangle size={20} className={danger ? "text-red-400 mt-0.5 shrink-0" : "text-amber-400 mt-0.5 shrink-0"} />
          <p className="text-sm text-[var(--muted)]">{message}</p>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 text-sm rounded-lg font-medium transition-colors disabled:opacity-50 ${
              danger ? "bg-red-500 hover:bg-red-600 text-white" : "bg-[var(--accent)] hover:bg-[var(--accent-light)] text-white"
            }`}
          >
            {loading ? "Processing..." : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
