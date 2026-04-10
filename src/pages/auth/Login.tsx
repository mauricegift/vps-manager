import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Activity, Mail, Lock, Eye, EyeOff, LogIn } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { toast } from "react-toastify";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as any)?.from?.pathname || "/";

  const [form, setForm] = useState({ email: "", password: "" });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(form.email, form.password);
      navigate(from, { replace: true });
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12" style={{ background: "var(--background)" }}>
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="p-3 rounded-2xl mb-3" style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}>
            <Activity size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold">VPS Manager</h1>
          <p className="text-sm text-[var(--muted)] mt-1">Sign in to your account</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-[var(--line)] p-8" style={{ background: "var(--secondary)" }}>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Email</label>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="you@example.com"
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 transition"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Password</label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                <input
                  type={showPw ? "text" : "password"}
                  required
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-10 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 transition"
                />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--main)] transition-colors">
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60"
              style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}>
              {loading ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <LogIn size={15} />}
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-[var(--muted)] mt-5">
          Don't have an account?{" "}
          <Link to="/register" className="text-[var(--accent)] font-medium hover:underline">Create one</Link>
        </p>

        <div className="flex justify-center gap-4 mt-6 text-xs text-[var(--muted)]">
          <Link to="/" className="hover:text-[var(--main)] transition-colors">Home</Link>
          <Link to="/about" className="hover:text-[var(--main)] transition-colors">About</Link>
          <Link to="/privacy" className="hover:text-[var(--main)] transition-colors">Privacy</Link>
          <Link to="/terms" className="hover:text-[var(--main)] transition-colors">Terms</Link>
        </div>
      </div>
    </div>
  );
}
