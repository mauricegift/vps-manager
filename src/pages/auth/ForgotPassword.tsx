import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Mail, ArrowLeft, RefreshCw, CheckCircle, KeyRound, AlertTriangle, Terminal, AlertCircle } from "lucide-react";
import { toast } from "react-toastify";
import axios from "axios";

interface ResetResponse {
  success: boolean;
  emailSent: boolean;
  emailConfigured: boolean;
  message: string;
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResetResponse | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [emailError, setEmailError] = useState("");
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

  const submit = async (isResend = false) => {
    if (!email.trim() || loading) return;
    setEmailError("");
    setLoading(true);
    try {
      const { data } = await axios.post<ResetResponse>("/api/auth/forgot-password", { email: email.trim() });
      setResult(data);
      startCooldown();
      if (isResend) toast.success("Reset code regenerated!");
    } catch (err: any) {
      const status = err.response?.status;
      const msg: string = err.response?.data?.error || "Failed to send reset code";
      if (status === 404) {
        setEmailError(msg);
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Success state ──────────────────────────────────────────────────────────
  if (result) {
    const noEmail = !result.emailConfigured;
    const sendFailed = result.emailConfigured && !result.emailSent;

    return (
      <div className="flex flex-col items-center justify-center flex-1 px-4 py-12">
        <div className="w-full max-w-md">

          {/* Header icon + title */}
          <div className="text-center mb-8">
            <div
              className="inline-flex p-4 rounded-2xl mb-5"
              style={{
                background: noEmail || sendFailed
                  ? "rgba(245,158,11,0.10)"
                  : "rgba(99,102,241,0.12)",
                border: noEmail || sendFailed
                  ? "1px solid rgba(245,158,11,0.25)"
                  : "1px solid rgba(99,102,241,0.2)",
              }}
            >
              {noEmail || sendFailed
                ? <AlertTriangle size={36} className="text-amber-400" />
                : <CheckCircle size={36} className="text-[var(--accent)]" />}
            </div>

            <h1 className="text-2xl font-bold text-[var(--main)]">
              {noEmail ? "Email not configured" : sendFailed ? "Email delivery failed" : "Check your email"}
            </h1>
            <p className="text-sm text-[var(--muted)] mt-2 max-w-xs mx-auto">
              {noEmail
                ? "No email provider is set up on this server. The reset code was written to the server logs."
                : sendFailed
                  ? <>Couldn't send email to <strong className="text-[var(--main)]">{email}</strong>. The reset code was written to the server logs.</>
                  : <>We sent a 6-digit code to <strong className="text-[var(--main)]">{email}</strong></>}
            </p>
          </div>

          <div
            className="rounded-2xl border border-[var(--line)] p-7 space-y-5"
            style={{ background: "var(--secondary)" }}
          >
            {/* No-email / send-failed: admin instructions */}
            {(noEmail || sendFailed) && (
              <div
                className="rounded-xl p-4 space-y-2"
                style={{ background: "var(--foreground)", border: "1px solid var(--line)" }}
              >
                <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold uppercase tracking-wide">
                  <Terminal size={13} />
                  Server administrator
                </div>
                <p className="text-xs text-[var(--muted)] leading-relaxed">
                  Run <code className="text-[var(--accent)] bg-[var(--foreground)] px-1 rounded">pm2 logs vps-manager</code> and look for a line like:
                </p>
                <div
                  className="rounded-lg px-3 py-2 text-xs font-mono text-[var(--muted)]"
                  style={{ background: "var(--background, #0f0f12)", border: "1px solid var(--line)" }}
                >
                  [auth] Password reset code for {email}: <span className="text-[var(--accent)]">XXXXXX</span>
                </div>
                {noEmail && (
                  <p className="text-xs text-[var(--muted)] leading-relaxed pt-1">
                    To enable email, go to{" "}
                    <Link to="/settings?tab=smtp" className="text-[var(--accent)] hover:underline">
                      Settings → Email / SMTP
                    </Link>{" "}
                    and configure Resend or Brevo.
                  </p>
                )}
              </div>
            )}

            {/* Enter code button — always shown */}
            <div className="p-4 rounded-xl text-center" style={{ background: "var(--foreground)" }}>
              <p className="text-xs text-[var(--muted)] mb-1">
                {noEmail || sendFailed ? "Once you have the code," : "Enter the code at"}
              </p>
              <Link
                to="/reset-password"
                state={{ email }}
                className="text-sm font-semibold text-[var(--accent)] hover:underline flex items-center justify-center gap-1.5"
              >
                <KeyRound size={14} />
                Password Reset page
              </Link>
            </div>

            {/* Resend button — only shown when email is configured */}
            {result.emailConfigured && (
              <>
                <div className="text-xs text-center text-[var(--muted)]">
                  {result.emailSent ? "Didn't receive it?" : "Want to try again?"}
                </div>
                <button
                  onClick={() => submit(true)}
                  disabled={cooldown > 0 || loading}
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-medium border border-[var(--line)] text-[var(--muted)] hover:text-[var(--main)] hover:bg-[var(--foreground)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                  {cooldown > 0 ? `Resend in ${cooldown}s` : loading ? "Sending…" : "Resend code"}
                </button>
              </>
            )}
          </div>

          <Link
            to="/login"
            className="flex items-center justify-center gap-2 mt-5 text-sm text-[var(--muted)] hover:text-[var(--main)] transition-colors"
          >
            <ArrowLeft size={14} />
            Back to login
          </Link>
        </div>
      </div>
    );
  }

  // ── Form state ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center justify-center flex-1 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-[var(--main)]">Forgot your password?</h1>
          <p className="text-sm text-[var(--muted)] mt-1">Enter your email and we'll send you a reset code</p>
        </div>

        <div className="rounded-2xl border border-[var(--line)] p-8" style={{ background: "var(--secondary)" }}>
          <form onSubmit={e => { e.preventDefault(); submit(); }} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[var(--main)]">Email address</label>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setEmailError(""); }}
                  placeholder="you@example.com"
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

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60"
              style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}
            >
              {loading
                ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                : <Mail size={15} />}
              {loading ? "Sending…" : "Send Reset Code"}
            </button>
          </form>
        </div>

        <Link
          to="/login"
          className="flex items-center justify-center gap-2 mt-5 text-sm text-[var(--muted)] hover:text-[var(--main)] transition-colors"
        >
          <ArrowLeft size={14} />
          Back to login
        </Link>
      </div>
    </div>
  );
}
