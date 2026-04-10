import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import axios from "axios";
import { useAuth } from "@/context/AuthContext";

interface Props {
  children: React.ReactNode;
}

export default function SetupRoute({ children }: Props) {
  const { user, loading } = useAuth();
  const [setupLoading, setSetupLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);

  useEffect(() => {
    axios.get("/api/auth/setup-required")
      .then(({ data }) => setSetupRequired(data.data?.required ?? false))
      .catch(() => setSetupRequired(false))
      .finally(() => setSetupLoading(false));
  }, []);

  if (loading || setupLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--background)" }}>
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (setupRequired) return <>{children}</>;
  if (user) return <>{children}</>;
  return <Navigate to="/login" replace />;
}
