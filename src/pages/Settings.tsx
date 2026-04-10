import { useState, useEffect } from "react";
import { Mail, Save, Send, CheckCircle, Eye, EyeOff, Settings as SettingsIcon } from "lucide-react";
import { toast } from "react-toastify";
import api from "@/lib/api";

type Provider = "resend" | "brevo" | "none";

interface SmtpForm {
  provider: Provider;
  from_name: string;
  from_email: string;
  resend_api_key: string;
  brevo_user: string;
  brevo_pass: string;
}

const defaultForm: SmtpForm = {
  provider: "none",
  from_name: "VPS Manager",
  from_email: "",
  resend_api_key: "",
  brevo_user: "",
  brevo_pass: "",
};

export default function SettingsPage() {
  const [form, setForm] = useState<SmtpForm>(defaultForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    api.get("/settings/smtp").then(({ data }) => {
      if (data.success) {
        setForm(f => ({ ...f, ...data.data }));
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const set = (field: keyof SmtpForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await api.post("/settings/smtp", form);
      if (data.success) toast.success("SMTP settings saved");
      else toast.error(data.error || "Failed to save");
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const { data } = await api.post("/settings/smtp/test");
      if (data.success) toast.success(data.message || "Test email sent!");
      else toast.error(data.error || "Email delivery failed");
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Test failed — check your settings");
    } finally {
      setTesting(false);
    }
  };

  const inputClass = "w-full px-3 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-sm text-[var(--main)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 transition";
  const labelClass = "block text-xs font-medium text-[var(--muted)] mb-1.5";

  if (loading) {
    return (
      <div className="main pt-6 flex justify-center py-20">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="main pt-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2.5 rounded-xl" style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}>
          <SettingsIcon size={18} className="text-white" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-[var(--main)]">Settings</h1>
          <p className="text-xs text-[var(--muted)]">Configure SMTP email and other options</p>
        </div>
      </div>

      <div className="max-w-2xl">
        {/* SMTP Card */}
        <div className="rounded-2xl border border-[var(--line)] overflow-hidden" style={{ background: "var(--secondary)" }}>
          <div className="flex items-center gap-3 px-6 py-4 border-b border-[var(--line)]">
            <Mail size={16} className="text-[var(--accent)]" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--main)]">Email / SMTP</h2>
              <p className="text-[11px] text-[var(--muted)]">Used for password reset emails</p>
            </div>
            {form.provider !== "none" && form.from_email && (
              <span className="ml-auto flex items-center gap-1 text-[11px] text-green-400 font-medium">
                <CheckCircle size={11} /> Configured
              </span>
            )}
          </div>

          <form onSubmit={handleSave} className="p-6 space-y-5">
            {/* Provider */}
            <div>
              <label className={labelClass}>Provider</label>
              <select value={form.provider} onChange={set("provider")} className={inputClass}>
                <option value="none">Disabled — no emails</option>
                <option value="resend">Resend (API key)</option>
                <option value="brevo">Brevo (SMTP)</option>
              </select>
            </div>

            {form.provider !== "none" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>From name</label>
                    <input type="text" value={form.from_name} onChange={set("from_name")} placeholder="VPS Manager" className={inputClass} required />
                  </div>
                  <div>
                    <label className={labelClass}>From email</label>
                    <input type="email" value={form.from_email} onChange={set("from_email")} placeholder="noreply@yourdomain.com" className={inputClass} required />
                  </div>
                </div>

                {form.provider === "resend" && (
                  <div>
                    <label className={labelClass}>Resend API key</label>
                    <div className="relative">
                      <input
                        type={showKey ? "text" : "password"}
                        value={form.resend_api_key}
                        onChange={set("resend_api_key")}
                        placeholder="re_••••••••••••••••"
                        className={`${inputClass} pr-10`}
                      />
                      <button type="button" onClick={() => setShowKey(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--main)] transition-colors">
                        {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <p className="text-[11px] text-[var(--muted)] mt-1">
                      Get your key at <a href="https://resend.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">resend.com</a>
                    </p>
                  </div>
                )}

                {form.provider === "brevo" && (
                  <div className="space-y-3">
                    <div>
                      <label className={labelClass}>Brevo SMTP username</label>
                      <input type="text" value={form.brevo_user} onChange={set("brevo_user")} placeholder="your@email.com" className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Brevo SMTP password / API key</label>
                      <div className="relative">
                        <input
                          type={showPass ? "text" : "password"}
                          value={form.brevo_pass}
                          onChange={set("brevo_pass")}
                          placeholder="xsmtp-••••••••••••••••"
                          className={`${inputClass} pr-10`}
                        />
                        <button type="button" onClick={() => setShowPass(v => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--main)] transition-colors">
                          {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                      <p className="text-[11px] text-[var(--muted)] mt-1">
                        Find SMTP credentials at <a href="https://account.brevo.com/smtp-api" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">brevo.com → SMTP & API</a>
                      </p>
                    </div>
                  </div>
                )}

                <div className="p-3 rounded-xl text-[11px] text-[var(--muted)] border border-[var(--line)]" style={{ background: "var(--foreground)" }}>
                  <strong className="text-[var(--main)]">Note:</strong> The sender domain must be verified with your email provider.
                  Changes are saved to the database and take effect immediately.
                </div>
              </>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button type="submit" disabled={saving}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60"
                style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}>
                {saving ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Save size={14} />}
                {saving ? "Saving…" : "Save Settings"}
              </button>

              {form.provider !== "none" && form.from_email && (
                <button type="button" onClick={handleTest} disabled={testing}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium border border-[var(--line)] text-[var(--muted)] hover:text-[var(--main)] hover:bg-[var(--foreground)] transition-colors disabled:opacity-50">
                  {testing ? <div className="w-4 h-4 border-2 border-[var(--muted)] border-t-[var(--main)] rounded-full animate-spin" /> : <Send size={14} />}
                  {testing ? "Sending…" : "Send test email"}
                </button>
              )}
            </div>
          </form>
        </div>

        {/* .env hint */}
        <div className="mt-4 p-4 rounded-xl border border-[var(--line)] text-xs text-[var(--muted)]" style={{ background: "var(--secondary)" }}>
          <strong className="text-[var(--main)]">Development (.env):</strong>{" "}
          You can also configure SMTP via environment variables:{" "}
          <code className="text-[var(--accent)]">EMAIL_PROVIDER</code>,{" "}
          <code className="text-[var(--accent)]">EMAIL_FROM_NAME</code>,{" "}
          <code className="text-[var(--accent)]">EMAIL_FROM_ADDRESS</code>,{" "}
          <code className="text-[var(--accent)]">RESEND_API_KEY</code>,{" "}
          <code className="text-[var(--accent)]">BREVO_SMTP_USER</code>,{" "}
          <code className="text-[var(--accent)]">BREVO_SMTP_PASS</code>.
          Database settings take priority over env vars.
        </div>
      </div>
    </div>
  );
}
