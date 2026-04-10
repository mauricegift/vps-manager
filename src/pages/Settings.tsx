import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Mail, Save, Send, CheckCircle, Eye, EyeOff,
  Settings as SettingsIcon, Users, UserPlus, Trash2, User
} from "lucide-react";
import { toast } from "react-toastify";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

type Provider = "resend" | "brevo" | "none";
type Tab = "settings" | "users";

interface SmtpForm {
  provider: Provider;
  from_name: string;
  from_email: string;
  resend_api_key: string;
  brevo_user: string;
  brevo_pass: string;
}

interface UserRecord {
  id: number;
  username: string;
  email: string;
  created_at: string;
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
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get("tab") as Tab) || "settings";
  const [tab, setTab] = useState<Tab>(initialTab);
  const { user } = useAuth();

  const switchTab = (t: Tab) => {
    setTab(t);
    setSearchParams(t === "settings" ? {} : { tab: t });
  };

  const inputClass = "w-full px-3 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--foreground)] text-sm text-[var(--main)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 transition";
  const labelClass = "block text-xs font-medium text-[var(--muted)] mb-1.5";

  return (
    <div className="main pt-6">
      {/* Page header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2.5 rounded-xl" style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}>
          <SettingsIcon size={18} className="text-white" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-[var(--main)]">Settings</h1>
          <p className="text-xs text-[var(--muted)]">Manage users and application configuration</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--line)] mb-6 max-w-2xl mx-auto">
        {([
          { id: "settings", label: "Email / SMTP", icon: Mail },
          { id: "users", label: "Users", icon: Users },
        ] as { id: Tab; label: string; icon: React.ElementType }[]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => switchTab(id)}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === id
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--muted)] hover:text-[var(--main)]"
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content — centered */}
      <div className="max-w-2xl mx-auto">
        {tab === "settings" ? (
          <SmtpPanel inputClass={inputClass} labelClass={labelClass} />
        ) : (
          <UsersPanel currentUserId={user?.id ?? 0} inputClass={inputClass} labelClass={labelClass} />
        )}
      </div>
    </div>
  );
}

// ─── SMTP Settings Panel ─────────────────────────────────────────────────────
function SmtpPanel({ inputClass, labelClass }: { inputClass: string; labelClass: string }) {
  const [form, setForm] = useState<SmtpForm>(defaultForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    api.get("/settings/smtp").then(({ data }) => {
      if (data.success) setForm(f => ({ ...f, ...data.data }));
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

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
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
      <div className="p-4 rounded-xl border border-[var(--line)] text-xs text-[var(--muted)]" style={{ background: "var(--secondary)" }}>
        <strong className="text-[var(--main)]">Development (.env):</strong>{" "}
        You can also configure SMTP via environment variables:{" "}
        <code className="text-[var(--accent)]">EMAIL_PROVIDER</code>,{" "}
        <code className="text-[var(--accent)]">EMAIL_FROM_NAME</code>,{" "}
        <code className="text-[var(--accent)]">EMAIL_FROM_ADDRESS</code>,{" "}
        <code className="text-[var(--accent)]">RESEND_API_KEY</code>,{" "}
        <code className="text-[var(--accent)]">BREVO_SMTP_USER</code>,{" "}
        <code className="text-[var(--accent)]">BREVO_SMTP_PASS</code>.{" "}
        Database settings take priority over env vars.
      </div>
    </div>
  );
}

// ─── Users Panel ─────────────────────────────────────────────────────────────
function UsersPanel({ currentUserId, inputClass, labelClass }: { currentUserId: number; inputClass: string; labelClass: string }) {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState<"list" | "create">("list");

  const [uname, setUname] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [creating, setCreating] = useState(false);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/auth/users");
      if (data.success) setUsers(data.data.users);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uname.trim() || !email.trim() || !pass) return;
    setCreating(true);
    try {
      const { data } = await api.post("/auth/users", { username: uname.trim(), email: email.trim(), password: pass });
      if (data.success) {
        toast.success(`User "${uname}" created`);
        setUname(""); setEmail(""); setPass("");
        setSubTab("list");
        fetchUsers();
      } else {
        toast.error(data.error || "Failed to create user");
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Failed to create user");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (u: UserRecord) => {
    if (!confirm(`Delete user "${u.username}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/auth/users/${u.id}`);
      toast.success(`User "${u.username}" deleted`);
      fetchUsers();
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Failed to delete user");
    }
  };

  return (
    <div className="rounded-2xl border border-[var(--line)] overflow-hidden" style={{ background: "var(--secondary)" }}>
      {/* Sub-tabs */}
      <div className="flex border-b border-[var(--line)]">
        {([
          { id: "list", label: "All Users", icon: Users },
          { id: "create", label: "Add User", icon: UserPlus },
        ] as { id: "list" | "create"; label: string; icon: React.ElementType }[]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setSubTab(id)}
            className={`flex items-center gap-2 flex-1 py-3 text-xs font-medium border-b-2 transition-colors -mb-px ${
              subTab === id
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--muted)] hover:text-[var(--main)]"
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      <div className="p-6">
        {subTab === "list" ? (
          loading ? (
            <div className="flex justify-center py-10">
              <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : users.length === 0 ? (
            <p className="text-center text-sm text-[var(--muted)] py-10">No users found</p>
          ) : (
            <div className="space-y-2">
              {users.map(u => (
                <div
                  key={u.id}
                  className="flex items-center justify-between p-3.5 rounded-xl border border-[var(--line)] hover:bg-[var(--foreground)] transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold text-white shrink-0"
                      style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}
                    >
                      {u.username[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[var(--main)] flex items-center gap-1.5">
                        {u.username}
                        {u.id === currentUserId && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)] font-semibold">you</span>
                        )}
                      </p>
                      <p className="text-xs text-[var(--muted)]">{u.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-[var(--muted)] hidden sm:block">
                      {new Date(u.created_at).toLocaleDateString()}
                    </span>
                    {u.id !== currentUserId && (
                      <button
                        onClick={() => handleDelete(u)}
                        className="p-2 rounded-lg text-[var(--muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Delete user"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className={labelClass}>Username</label>
              <input
                value={uname}
                onChange={e => setUname(e.target.value)}
                placeholder="johndoe"
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="john@example.com"
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Password</label>
              <div className="relative">
                <input
                  type={showPass ? "text" : "password"}
                  value={pass}
                  onChange={e => setPass(e.target.value)}
                  placeholder="Min. 6 characters"
                  required
                  minLength={6}
                  className={`${inputClass} pr-10`}
                />
                <button type="button" onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--main)] transition-colors">
                  {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                disabled={creating}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60 transition-all"
                style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed)" }}
              >
                {creating
                  ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  : <UserPlus size={14} />}
                {creating ? "Creating…" : "Create User"}
              </button>
              <button type="button" onClick={() => setSubTab("list")}
                className="px-5 py-2.5 rounded-xl text-sm border border-[var(--line)] text-[var(--muted)] hover:text-[var(--main)] hover:bg-[var(--foreground)] transition-colors">
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
