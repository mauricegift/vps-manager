import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Mail, ArrowLeft, RefreshCw, CheckCircle, KeyRound } from "lucide-react";
import { toast } from "react-toastify";
import axios from "axios";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const startCooldown = () => {
    setCooldown(60);
    timerRef.current = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) { clearInterval(timerRef.current!); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    try {
      await axios.post("/api/auth/forgot-password", { email: email.trim() });
      setSent(true);
      startCooldown();
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Failed to send reset code");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || loading) return;
    setLoading(true);
    try {
      await axios.post("/api/auth/forgot-password", { email: email.trim() });
      toast.success("Reset code resent!");
      startCooldown();
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Failed to resend code");
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 px-4 py-12">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex p-4 rounded-2xl mb-5" style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.2)" }}>
              <CheckCircle size={36} className="text-[var(--accent)]" />
            </div>
            <h1 className="text-2xl font-bold text-[var(--main)]">Check your email</h1>
            <p className="text-sm text-[var(--muted)] mt-2 max-w-xs mx-auto">
              We sent a 6-digit reset code to <strong className="text-[var(--main)]">{email}</strong>
            </p>
          </div>

          <div className="rounded-2xl border border-[var(--line)] p-7 text-center space-y-5" style={{ background: "var(--secondary)" }}>
            <div className="p-4 rounded-xl" style={{ background: "var(--foreground)" }}>
              <p className="text-xs text-[var(--muted)] mb-1">Enter the code at</p>
              <Link to="/reset-password" state={{ email }} className="text-sm font-semibold text-[var(--accent)] hover:underline flex items-center justify-center gap-1.5">
                <KeyRound size={14} />
                Password Reset page
              </Link>
            </div>

            <div className="text-xs text-[var(--muted)]">
              Didn't receive it?
            </div>

            <button
              onClick={handleResend}
              disabled={cooldown > 0 || loading}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-medium border border-[var(--line)] text-[var(--muted)] hover:text-[var(--main)] hover:bg-[var(--foreground)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              {cooldown > 0 ? `Resend in ${cooldown}s` : loading ? "Sending…" : "Resend code"}
            </button>
          </div>

          <Link to="/login" className="flex items-center justify-center gap-2 mt-5 text-sm text-[var(--muted)] hover:text-[var(--main)] transition-colors">
            <ArrowLeft size={14} />
            Back to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center flex-1 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-[var(--main)]">Forgot your password?</h1>
          <p className="text-sm text-[var(--muted)] mt-1">Enter your email and we'll send you a reset code</p>
        </div>

        <div className="rounded-2xl border border-[var(--line)] p-8" style={{ background: "var(--secondary)" }}>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[var(--main)]">Email address</label>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 transition"
                />
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60"
              style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}>
              {loading ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Mail size={15} />}
              {loading ? "Sending…" : "Send Reset Code"}
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
