import { useEffect, useState } from "react";
import axios from "axios";
import NotFoundPage from "@/pages/NotFound";

interface Props {
  children: React.ReactNode;
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

  // Only show register page if no users exist — otherwise show 404 for everyone
  if (!setupRequired) return <NotFoundPage />;

  return <>{children}</>;
}
