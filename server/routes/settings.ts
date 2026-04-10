import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { getSmtpConfig, saveSmtpConfig, sendMail, tplTestEmail, SmtpConfig } from '../services/email.js';

const router = Router();

// ── GET /api/settings/smtp ─────────────────────────────────────────────────
router.get('/smtp', requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const cfg = await getSmtpConfig();
    // Never expose the full API key/password — mask it
    const safe = {
      provider: cfg.provider,
      from_name: cfg.from_name,
      from_email: cfg.from_email,
      resend_api_key: cfg.resend_api_key ? '••••' + cfg.resend_api_key.slice(-4) : '',
      brevo_user: cfg.brevo_user || '',
      brevo_pass: cfg.brevo_pass ? '••••••••' : '',
      configured: cfg.provider !== 'none' && !!cfg.from_email,
    };
    res.json({ success: true, data: safe });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/settings/smtp ────────────────────────────────────────────────
router.post('/smtp', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { provider, from_name, from_email, resend_api_key, brevo_user, brevo_pass } = req.body;

    if (!provider || !from_name || !from_email) {
      res.status(400).json({ success: false, error: 'provider, from_name and from_email are required' });
      return;
    }
    if (provider !== 'resend' && provider !== 'brevo' && provider !== 'none') {
      res.status(400).json({ success: false, error: 'provider must be resend, brevo, or none' });
      return;
    }

    const cfg: Partial<SmtpConfig> = { provider, from_name, from_email };

    if (provider === 'resend') {
      // Only update API key if a non-masked value was sent
      if (resend_api_key && !resend_api_key.startsWith('••••')) {
        cfg.resend_api_key = resend_api_key;
      }
    } else if (provider === 'brevo') {
      if (brevo_user) cfg.brevo_user = brevo_user;
      if (brevo_pass && !brevo_pass.startsWith('••••')) cfg.brevo_pass = brevo_pass;
    }

    await saveSmtpConfig(cfg);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/settings/smtp/test ───────────────────────────────────────────
router.post('/smtp/test', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const cfg = await getSmtpConfig();
    if (cfg.provider === 'none' || !cfg.from_email) {
      res.status(400).json({ success: false, error: 'No email provider configured. Save your settings first.' });
      return;
    }

    const to = req.user!.email;
    const sent = await sendMail({
      to,
      subject: 'VPS Manager — Test Email',
      html: tplTestEmail(to),
      text: 'This is a test email from VPS Manager confirming your SMTP settings are working.',
    });

    if (sent) {
      res.json({ success: true, message: `Test email sent to ${to}` });
    } else {
      res.status(500).json({ success: false, error: 'Email delivery failed. Check your provider credentials.' });
    }
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
