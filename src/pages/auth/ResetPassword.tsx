import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { KeyRound, Lock, Eye, EyeOff, CheckCircle, ArrowLeft } from "lucide-react";
import { toast } from "react-toastify";
import axios from "axios";

export default function ResetPasswordPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const prefillEmail = (location.state as any)?.email || "";

  const [form, setForm] = useState({ email: prefillEmail, code: "", password: "", confirm: "" });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const setField = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.code.length !== 6) { toast.error("Enter the 6-digit code"); return; }
    if (form.password !== form.confirm) { toast.error("Passwords do not match"); return; }
    if (form.password.length < 6) { toast.error("Password must be at least 6 characters"); return; }

    setLoading(true);
    try {
      await axios.post("/api/auth/reset-password", {
        email: form.email.trim(),
        code: form.code.trim(),
        password: form.password,
      });
      setDone(true);
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Failed to reset password");
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 px-4 py-12 text-center">
        <div className="w-full max-w-sm">
          <div className="inline-flex p-4 rounded-2xl mb-5" style={{ background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.2)" }}>
            <CheckCircle size={40} className="text-green-400" />
          </div>
          <h1 className="text-2xl font-bold text-[var(--main)] mb-3">Password changed!</h1>
          <p className="text-sm text-[var(--muted)] mb-8">Your password has been reset successfully. You can now sign in with your new password.</p>
          <Link to="/login"
            className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white"
            style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}>
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center flex-1 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-[var(--main)]">Reset your password</h1>
          <p className="text-sm text-[var(--muted)] mt-1">Enter the 6-digit code from your email and choose a new password</p>
        </div>

        <div className="rounded-2xl border border-[var(--line)] p-8" style={{ background: "var(--secondary)" }}>
          <form onSubmit={handleSubmit} className="space-y-4">
            {!prefillEmail && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-[var(--main)]">Email address</label>
                <input
                  type="email" required value={form.email} onChange={setField("email")}
                  placeholder="you@example.com" autoComplete="email"
                  className="w-full px-3 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 transition"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[var(--main)]">Reset code</label>
              <div className="relative">
                <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                <input
                  type="text" required maxLength={6} value={form.code} onChange={setField("code")}
                  placeholder="123456" autoComplete="one-time-code" inputMode="numeric"
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-sm font-mono tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 transition"
                />
              </div>
              <p className="text-[11px] text-[var(--muted)]">
                No code? <Link to="/forgot-password" className="text-[var(--accent)] hover:underline">Request one here</Link>
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[var(--main)]">New password</label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                <input
                  type={showPw ? "text" : "password"} required value={form.password} onChange={setField("password")}
                  placeholder="Min. 6 characters" autoComplete="new-password"
                  className="w-full pl-9 pr-10 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 transition"
                />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--main)] transition-colors">
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[var(--main)]">Confirm new password</label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                <input
                  type={showPw ? "text" : "password"} required value={form.confirm} onChange={setField("confirm")}
                  placeholder="Repeat your password" autoComplete="new-password"
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 transition"
                />
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60 mt-2"
              style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}>
              {loading ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <KeyRound size={15} />}
              {loading ? "Resetting…" : "Change Password"}
            </button>
          </form>
        </div>

        <Link to="/login" className="flex items-center justify-center gap-2 mt-5 text-sm text-[var(--muted)] hover:text-[var(--main)] transition-colors">
          <ArrowLeft size={14} />
          Back to login
        </Link>
      </div>
    </div>
  );
}
