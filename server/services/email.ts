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
// All styles are inline so they survive Gmail and other clients that strip
// <style> blocks. Table-based layout for maximum email-client compatibility.

const YEAR = new Date().getFullYear();
const BRAND_COLOR = '#6366f1';      // indigo-500
const BG        = '#0f0f12';
const CARD_BG   = '#18181f';
const BORDER    = '#27272f';
const TEXT_MAIN = '#f1f1f3';
const TEXT_MUTED= '#8b8b9a';
const CODE_BG   = '#0f0f12';

function baseTemplate(preheader: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no" />
  <title>VPS Manager</title>
</head>
<body style="margin:0;padding:0;background-color:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">

  <!--[if !vml]><!--><span style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</span><!--<![endif]-->

  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background-color:${BG};">
    <tr>
      <td align="center" style="padding:48px 16px 40px;">

        <!-- Container -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;max-width:520px;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr>
                  <td style="padding-right:10px;vertical-align:middle;">
                    <div style="background:linear-gradient(135deg,${BRAND_COLOR},#7c3aed);border-radius:10px;width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;text-align:center;line-height:36px;">
                      <img src="https://raw.githubusercontent.com/mauricegift/vps-manager/main/public/favicon.svg" width="20" height="20" alt="" style="display:block;border:0;outline:0;" />
                    </div>
                  </td>
                  <td style="vertical-align:middle;">
                    <span style="font-size:16px;font-weight:700;color:${TEXT_MAIN};letter-spacing:-0.3px;">VPS Manager</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background-color:${CARD_BG};border:1px solid ${BORDER};border-radius:16px;overflow:hidden;">

              <!-- Accent bar -->
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
                <tr>
                  <td style="height:3px;background:linear-gradient(90deg,${BRAND_COLOR},#7c3aed);font-size:0;line-height:0;">&nbsp;</td>
                </tr>
              </table>

              <!-- Body -->
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
                <tr>
                  <td style="padding:36px 36px 32px;">
                    ${body}
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0 0 6px;font-size:11px;color:${TEXT_MUTED};line-height:1.5;">
                You received this email because a password reset was requested for your VPS Manager account.
              </p>
              <p style="margin:0;font-size:11px;color:${TEXT_MUTED};">
                &copy; ${YEAR} VPS Manager &mdash; <a href="https://me.giftedtech.co.ke" style="color:${TEXT_MUTED};text-decoration:underline;">Gifted Tech</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}

export function tplPasswordReset(username: string, code: string): string {
  const body = `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:${TEXT_MAIN};letter-spacing:-0.4px;">Password reset code</h1>
    <p style="margin:0 0 24px;font-size:14px;color:${TEXT_MUTED};line-height:1.65;">
      Hi <strong style="color:${TEXT_MAIN};">${username}</strong>, we received a request to reset your VPS Manager password.
      Use the code below on the password reset page.
    </p>

    <!-- Code box -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin-bottom:20px;">
      <tr>
        <td align="center" style="background-color:${CODE_BG};border:1px solid ${BORDER};border-radius:12px;padding:24px 16px;">
          <p style="margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:${TEXT_MUTED};">Your reset code</p>
          <p style="margin:8px 0 6px;font-size:40px;font-weight:800;letter-spacing:10px;color:${BRAND_COLOR};font-family:monospace,monospace;line-height:1;">${code}</p>
          <p style="margin:0;font-size:11px;color:${TEXT_MUTED};">Valid for <strong style="color:${TEXT_MAIN};">10 minutes</strong></p>
        </td>
      </tr>
    </table>

    <!-- Steps -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin-bottom:20px;">
      <tr>
        <td style="background-color:#1e1e2a;border:1px solid ${BORDER};border-radius:10px;padding:14px 16px;">
          <p style="margin:0;font-size:12px;color:${TEXT_MUTED};line-height:1.6;">
            1. Go to the <strong style="color:${TEXT_MAIN};">Password Reset</strong> page on your VPS Manager<br/>
            2. Enter your email address and paste the code above<br/>
            3. Choose your new password
          </p>
        </td>
      </tr>
    </table>

    <!-- Security note -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
      <tr>
        <td style="border-left:3px solid ${BORDER};padding:4px 0 4px 14px;">
          <p style="margin:0;font-size:12px;color:${TEXT_MUTED};line-height:1.6;">
            If you did not request a password reset, you can safely ignore this email. Your password will not change.
          </p>
        </td>
      </tr>
    </table>
  `;
  return baseTemplate(`Your VPS Manager password reset code is: ${code}`, body);
}

export function tplPasswordChanged(username: string): string {
  const body = `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:${TEXT_MAIN};letter-spacing:-0.4px;">Password changed</h1>
    <p style="margin:0 0 20px;font-size:14px;color:${TEXT_MUTED};line-height:1.65;">
      Hi <strong style="color:${TEXT_MAIN};">${username}</strong>, your VPS Manager account password was successfully updated.
    </p>

    <!-- Confirmation box -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin-bottom:20px;">
      <tr>
        <td align="center" style="background-color:${CODE_BG};border:1px solid ${BORDER};border-radius:12px;padding:20px 16px;">
          <p style="margin:0;font-size:13px;font-weight:600;color:#34d399;">&#10003; &nbsp;Password updated successfully</p>
        </td>
      </tr>
    </table>

    <!-- Security note -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
      <tr>
        <td style="border-left:3px solid #ef4444;padding:4px 0 4px 14px;">
          <p style="margin:0;font-size:12px;color:${TEXT_MUTED};line-height:1.6;">
            If you did not make this change, contact your server administrator immediately. All active sessions have been invalidated.
          </p>
        </td>
      </tr>
    </table>
  `;
  return baseTemplate('Your VPS Manager password was changed', body);
}

export function tplTestEmail(to: string): string {
  const body = `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:${TEXT_MAIN};letter-spacing:-0.4px;">SMTP test email</h1>
    <p style="margin:0 0 24px;font-size:14px;color:${TEXT_MUTED};line-height:1.65;">
      This is a test email confirming that your VPS Manager SMTP settings are configured correctly.
    </p>

    <!-- Status box -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin-bottom:20px;">
      <tr>
        <td align="center" style="background-color:${CODE_BG};border:1px solid ${BORDER};border-radius:12px;padding:24px 16px;">
          <p style="margin:0 0 6px;font-size:24px;color:#34d399;">&#10003;</p>
          <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#34d399;">Email delivery is working</p>
          <p style="margin:0;font-size:12px;color:${TEXT_MUTED};">Sent to: <strong style="color:${TEXT_MAIN};">${to}</strong></p>
        </td>
      </tr>
    </table>

    <p style="margin:0;font-size:12px;color:${TEXT_MUTED};line-height:1.6;">
      Password reset emails will now be delivered to your users. You can close the Settings page.
    </p>
  `;
  return baseTemplate('VPS Manager SMTP configuration test — delivery confirmed', body);
}
