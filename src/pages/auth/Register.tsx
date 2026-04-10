import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Activity, User, Mail, Lock, Eye, EyeOff, UserPlus, ArrowLeft } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { toast } from "react-toastify";
import api from "@/lib/api";
import axios from "axios";

export default function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ username: "", email: "", password: "", confirm: "" });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  // "admin mode" = user is already logged in (creating another account)
  const isAdminMode = !!user;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm) {
      toast.error("Passwords do not match");
      return;
    }
    if (form.password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    try {
      if (isAdminMode) {
        // Admin creating another user — use api (sends bearer token)
        const { data } = await api.post("/auth/register", {
          username: form.username,
          email: form.email,
          password: form.password,
        });
        if (!data.success) throw new Error(data.error);
        toast.success(`User "${form.username}" created successfully`);
        navigate("/", { replace: true });
      } else {
        // First-time setup — use AuthContext.register (gets tokens + logs you in)
        await register(form.username, form.email, form.password);
        toast.success("Admin account created! Welcome to VPS Manager.");
        navigate("/", { replace: true });
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || "Failed to create account");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12" style={{ background: "var(--background)" }}>
      <div className="w-full max-w-md">
        {/* Back link (admin mode) */}
        {isAdminMode && (
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--main)] transition-colors mb-6"
          >
            <ArrowLeft size={14} />
            Back
          </button>
        )}

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="p-3 rounded-2xl mb-3" style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}>
            <Activity size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold">VPS Manager</h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            {isAdminMode ? "Create a new user account" : "Create your admin account to get started"}
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-[var(--line)] p-8" style={{ background: "var(--secondary)" }}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Username</label>
              <div className="relative">
                <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                <input
                  type="text"
                  required
                  autoComplete="username"
                  value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  placeholder="yourname"
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 transition"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Email</label>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                <input
                  type="email"
                  required
                  autoComplete="email"
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
                  autoComplete="new-password"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="Min. 6 characters"
                  className="w-full pl-9 pr-10 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 transition"
                />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--main)] transition-colors">
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Confirm Password</label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                <input
                  type={showPw ? "text" : "password"}
                  required
                  autoComplete="new-password"
                  value={form.confirm}
                  onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
                  placeholder="Repeat your password"
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 transition"
                />
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60 mt-2"
              style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}>
              {loading
                ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                : <UserPlus size={15} />
              }
              {loading ? "Creating…" : isAdminMode ? "Create User" : "Create Admin Account"}
            </button>
          </form>
        </div>

        {!isAdminMode && (
          <p className="text-center text-sm text-[var(--muted)] mt-5">
            Already have an account?{" "}
            <Link to="/login" className="text-[var(--accent)] font-medium hover:underline">Sign in</Link>
          </p>
        )}

        <div className="flex justify-center gap-4 mt-6 text-xs text-[var(--muted)]">
          <Link to="/home" className="hover:text-[var(--main)] transition-colors">Home</Link>
          <Link to="/about" className="hover:text-[var(--main)] transition-colors">About</Link>
          <Link to="/privacy" className="hover:text-[var(--main)] transition-colors">Privacy</Link>
          <Link to="/terms" className="hover:text-[var(--main)] transition-colors">Terms</Link>
        </div>
      </div>
    </div>
  );
}
