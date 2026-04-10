import { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { User, Lock, Eye, EyeOff, LogIn, AlertCircle } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { toast } from "react-toastify";
import axios from "axios";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as any)?.from?.pathname || "/";

  const [form, setForm] = useState({ email: "", password: "" });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");

  useEffect(() => {
    axios.get("/api/auth/setup-required")
      .then(({ data }) => setSetupRequired(data.data?.required ?? false))
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError("");
    setPasswordError("");
    setLoading(true);
    try {
      await login(form.email, form.password);
      navigate(from, { replace: true });
    } catch (err: any) {
      const status = err.response?.status;
      const msg: string = err.response?.data?.error || err.message || "Login failed";
      if (status === 404) {
        setEmailError(msg);
      } else if (status === 401) {
        setPasswordError(msg);
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center flex-1 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-[var(--main)]">Welcome back</h1>
          <p className="text-sm text-[var(--muted)] mt-1">Sign in to your account to continue</p>
        </div>

        <div className="rounded-2xl border border-[var(--line)] p-8" style={{ background: "var(--secondary)" }}>
          <form onSubmit={handleSubmit} className="space-y-5">

            {/* Email / Username */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[var(--main)]">Email or Username</label>
              <div className="relative">
                <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                <input
                  type="text"
                  required
                  autoComplete="username"
                  value={form.email}
                  onChange={e => { setForm(f => ({ ...f, email: e.target.value })); setEmailError(""); }}
                  placeholder="you@example.com or username"
                  className={`w-full pl-9 pr-4 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 transition ${
                    emailError
                      ? "border-red-400 focus:ring-red-400/30 bg-red-500/5"
                      : "border-[var(--line)] bg-[var(--foreground)] focus:ring-[var(--accent)]/40"
                  }`}
                />
              </div>
              {emailError && (
                <p className="flex items-center gap-1.5 text-xs text-red-400 mt-1">
                  <AlertCircle size={12} className="shrink-0" />
                  {emailError}
                </p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-[var(--main)]">Password</label>
                <Link to="/forgot-password" className="text-xs text-[var(--accent)] hover:underline">Forgot password?</Link>
              </div>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                <input
                  type={showPw ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  value={form.password}
                  onChange={e => { setForm(f => ({ ...f, password: e.target.value })); setPasswordError(""); }}
                  placeholder="••••••••"
                  className={`w-full pl-9 pr-10 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 transition ${
                    passwordError
                      ? "border-red-400 focus:ring-red-400/30 bg-red-500/5"
                      : "border-[var(--line)] bg-[var(--foreground)] focus:ring-[var(--accent)]/40"
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--main)] transition-colors"
                >
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {passwordError && (
                <p className="flex items-center gap-1.5 text-xs text-red-400 mt-1">
                  <AlertCircle size={12} className="shrink-0" />
                  {passwordError}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60"
              style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}
            >
              {loading
                ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                : <LogIn size={15} />}
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>
        </div>

        {setupRequired && (
          <p className="text-center text-sm text-[var(--muted)] mt-5">
            First time?{" "}
            <Link to="/register" className="text-[var(--accent)] font-medium hover:underline">
              Create your admin account
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
