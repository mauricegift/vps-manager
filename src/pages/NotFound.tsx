import { Link } from "react-router-dom";
import { AlertTriangle, Home, LogIn } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

export default function NotFoundPage() {
  const { user } = useAuth();

  return (
    <div className="flex flex-col items-center justify-center flex-1 px-4 py-20 text-center">
      <div
        className="p-4 rounded-2xl mb-6"
        style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}
      >
        <AlertTriangle size={40} className="text-red-400" />
      </div>
      <h1 className="text-7xl font-black text-[var(--main)] mb-3 leading-none">404</h1>
      <h2 className="text-xl font-semibold text-[var(--main)] mb-3">Page Not Found</h2>
      <p className="text-sm text-[var(--muted)] max-w-sm mb-10">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <div className="flex items-center gap-3">
        <Link
          to={user ? "/" : "/login"}
          className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white"
          style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}
        >
          {user ? <Home size={15} /> : <LogIn size={15} />}
          {user ? "Go to Dashboard" : "Back to Login"}
        </Link>
        {user && (
          <Link
            to="/home"
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold border border-[var(--line)] text-[var(--muted)] hover:text-[var(--main)] hover:bg-[var(--foreground)] transition-colors"
          >
            Home
          </Link>
        )}
      </div>
    </div>
  );
}
