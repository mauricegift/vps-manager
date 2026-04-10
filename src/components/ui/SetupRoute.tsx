import { useEffect, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: React.ReactNode;
}

function NotFoundPage() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 text-center"
      style={{ background: "var(--background)" }}
    >
      <div
        className="p-4 rounded-2xl mb-5"
        style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}
      >
        <AlertTriangle size={36} className="text-red-400" />
      </div>
      <h1 className="text-6xl font-black text-[var(--main)] mb-2">404</h1>
      <h2 className="text-xl font-semibold text-[var(--main)] mb-2">Page Not Found</h2>
      <p className="text-sm text-[var(--muted)] max-w-xs mb-8">
        This page does not exist or is no longer available.
      </p>
      <Link
        to="/login"
        className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white"
        style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}
      >
        Back to Login
      </Link>
    </div>
  );
}

export default function SetupRoute({ children }: Props) {
  const [loading, setLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);

  useEffect(() => {
    axios.get("/api/auth/setup-required")
      .then(({ data }) => setSetupRequired(data.data?.required ?? false))
      .catch(() => setSetupRequired(false))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--background)" }}>
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Only show register page if no users exist at all — otherwise always 404
  if (!setupRequired) return <NotFoundPage />;

  return <>{children}</>;
}
