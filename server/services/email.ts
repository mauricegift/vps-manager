import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import pool from '../db.js';

// ─── Config ────────────────────────────────────────────────────────────────

export interface SmtpConfig {
  provider: 'resend' | 'brevo' | 'none';
  from_name: string;
  from_email: string;
  resend_api_key?: string;
  brevo_user?: string;
  brevo_pass?: string;
}

export async function getSmtpConfig(): Promise<SmtpConfig> {
  // Prefer DB config; fall back to env vars
  try {
    const r = await pool.query('SELECT key, value FROM smtp_settings');
    if (r.rows.length > 0) {
      const cfg: Record<string, string> = {};
      for (const { key, value } of r.rows) cfg[key] = value;
      if (cfg.provider) {
        return {
          provider: (cfg.provider as SmtpConfig['provider']) || 'none',
          from_name: cfg.from_name || 'VPS Manager',
          from_email: cfg.from_email || '',
          resend_api_key: cfg.resend_api_key,
          brevo_user: cfg.brevo_user,
          brevo_pass: cfg.brevo_pass,
        };
      }
    }
  } catch { /* DB may not be ready */ }

  // Env var fallback
  const provider = (process.env.EMAIL_PROVIDER || 'none') as SmtpConfig['provider'];
  return {
    provider,
    from_name: process.env.EMAIL_FROM_NAME || 'VPS Manager',
    from_email: process.env.EMAIL_FROM_ADDRESS || '',
    resend_api_key: process.env.RESEND_API_KEY,
    brevo_user: process.env.BREVO_SMTP_USER,
    brevo_pass: process.env.BREVO_SMTP_PASS,
  };
}

export async function saveSmtpConfig(cfg: Partial<SmtpConfig>): Promise<void> {
  const pairs = Object.entries(cfg).filter(([, v]) => v !== undefined);
  for (const [key, value] of pairs) {
    await pool.query(
      'INSERT INTO smtp_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
      [key, value ?? '']
    );
  }
}

// ─── Email Sending ─────────────────────────────────────────────────────────

interface MailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

async function sendViaResend(opts: MailOptions, cfg: SmtpConfig): Promise<void> {
  if (!cfg.resend_api_key) throw new Error('Resend API key not configured');
  const resend = new Resend(cfg.resend_api_key);
  const from = `${cfg.from_name} <${cfg.from_email}>`;
  const { error } = await resend.emails.send({
    from,
    to: [opts.to],
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });
  if (error) throw new Error(error.message || JSON.stringify(error));
}

async function sendViaBrevo(opts: MailOptions, cfg: SmtpConfig): Promise<void> {
  if (!cfg.brevo_user || !cfg.brevo_pass) throw new Error('Brevo credentials not configured');
  const transport = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: cfg.brevo_user, pass: cfg.brevo_pass },
  });
  await transport.sendMail({
    from: `${cfg.from_name} <${cfg.from_email}>`,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });
}

export async function sendMail(opts: MailOptions): Promise<boolean> {
  const cfg = await getSmtpConfig();

  if (cfg.provider === 'none' || !cfg.from_email) {
    console.log('[email] No provider configured. Would have sent:', opts.subject, '→', opts.to);
    return false;
  }

  if (cfg.provider === 'resend') {
    try {
      await sendViaResend(opts, cfg);
      console.log('[email] Sent via Resend:', opts.subject, '→', opts.to);
      return true;
    } catch (err: any) {
      console.error('[email] Resend failed:', err.message);
      return false;
    }
  }

  if (cfg.provider === 'brevo') {
    try {
      await sendViaBrevo(opts, cfg);
      console.log('[email] Sent via Brevo:', opts.subject, '→', opts.to);
      return true;
    } catch (err: any) {
      console.error('[email] Brevo failed:', err.message);
      return false;
    }
  }

  return false;
}

// ─── Email Templates ────────────────────────────────────────────────────────

function baseTemplate(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#0f0f12;color:#e5e7eb}
  .wrap{background:#0f0f12;padding:40px 16px}
  .container{max-width:520px;margin:0 auto}
  .logo{text-align:center;margin-bottom:24px}
  .logo-inner{display:inline-flex;align-items:center;gap:10px}
  .logo-icon{background:linear-gradient(135deg,#6366f1,#7c3aed);border-radius:10px;width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center}
  .logo-text{font-size:16px;font-weight:700;color:#f3f4f6}
  .card{background:#1a1a24;border:1px solid #2a2a3a;border-radius:16px;overflow:hidden}
  .card-top{height:3px;background:linear-gradient(90deg,#6366f1,#7c3aed)}
  .body{padding:32px}
  h1{font-size:20px;font-weight:700;color:#f3f4f6;margin-bottom:12px}
  .lead{font-size:14px;color:#9ca3af;line-height:1.65;margin-bottom:20px}
  .code-box{background:#0f0f12;border:1px solid #2a2a3a;border-radius:12px;padding:20px;text-align:center;margin:20px 0}
  .code{font-size:36px;font-weight:800;letter-spacing:8px;color:#6366f1;font-family:monospace}
  .code-label{font-size:11px;color:#6b7280;margin-top:8px}
  .alert{background:#1f1f2e;border:1px solid #2a2a3a;border-radius:8px;padding:12px 16px;font-size:12px;color:#9ca3af;margin-top:16px;line-height:1.5}
  .footer{text-align:center;padding:20px 16px}
  .footer p{font-size:11px;color:#4b5563}
</style>
</head>
<body>
<div class="wrap">
  <div class="container">
    <div class="logo">
      <div class="logo-inner">
        <div class="logo-icon">
          <svg width="18" height="18" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        </div>
        <span class="logo-text">VPS Manager</span>
      </div>
    </div>
    <div class="card">
      <div class="card-top"></div>
      <div class="body">${content}</div>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} VPS Manager</p>
    </div>
  </div>
</div>
</body>
</html>`;
}

export function tplPasswordReset(username: string, code: string): string {
  return baseTemplate(`
    <h1>Password reset code</h1>
    <p class="lead">Hi <strong>${username}</strong>, we received a request to reset your VPS Manager password. Use the code below to set a new password.</p>
    <div class="code-box">
      <div class="code">${code}</div>
      <div class="code-label">Valid for 10 minutes</div>
    </div>
    <div class="alert">If you didn't request a password reset, you can safely ignore this email — your password will not change.</div>
  `);
}

export function tplPasswordChanged(username: string): string {
  return baseTemplate(`
    <h1>Password changed</h1>
    <p class="lead">Hi <strong>${username}</strong>, your VPS Manager account password was successfully changed.</p>
    <div class="alert">If you did not make this change, please contact your administrator immediately.</div>
  `);
}

export function tplTestEmail(to: string): string {
  return baseTemplate(`
    <h1>Test email</h1>
    <p class="lead">This is a test email from VPS Manager confirming that your SMTP settings are working correctly.</p>
    <div class="code-box">
      <div style="font-size:14px;color:#6366f1;font-weight:600;">✓ Configuration working</div>
      <div class="code-label">Sent to: ${to}</div>
    </div>
  `);
}
