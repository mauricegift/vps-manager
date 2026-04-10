import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { sendMail, tplPasswordReset, tplPasswordChanged } from '../services/email.js';

const router = Router();

const ACCESS_SECRET = process.env.SESSION_SECRET || 'vpsmanager_access_secret';
const REFRESH_SECRET = (process.env.SESSION_SECRET || 'vpsmanager_access_secret') + '_refresh';
const ACCESS_TTL = '1d';
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function signAccess(user: { id: number; username: string; email: string }) {
  return jwt.sign(
    { id: user.id, username: user.username, email: user.email },
    ACCESS_SECRET,
    { expiresIn: ACCESS_TTL }
  );
}

function signRefresh(userId: number) {
  return jwt.sign({ id: userId }, REFRESH_SECRET, { expiresIn: '7d' });
}


// ── POST /api/auth/register ────────────────────────────────────────────────
// ONLY allowed when NO users exist (first-time setup).
// Once the first user is created this endpoint returns 404 for everyone.
router.post('/register', async (req: Request, res: Response) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    res.status(400).json({ success: false, error: 'username, email and password are required' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    return;
  }

  try {
    const countRes = await pool.query('SELECT COUNT(*) FROM users');
    const userCount = parseInt(countRes.rows[0].count);

    // Once any user exists — route is permanently closed (404)
    if (userCount > 0) {
      res.status(404).json({ success: false, error: 'Not found' });
      return;
    }

    const exists = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email.toLowerCase(), username.toLowerCase()]
    );
    if (exists.rows.length) {
      res.status(409).json({ success: false, error: 'Username or email already taken' });
      return;
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, created_at',
      [username.trim(), email.toLowerCase().trim(), hash]
    );
    const newUser = result.rows[0];

    const accessToken = signAccess(newUser);
    const refreshToken = signRefresh(newUser.id);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
    await pool.query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [newUser.id, refreshToken, expiresAt]
    );
    res.status(201).json({
      success: true,
      data: {
        user: { id: newUser.id, username: newUser.username, email: newUser.email, created_at: newUser.created_at },
        accessToken,
        refreshToken,
      },
    });
  } catch (e: any) {
    console.error('[auth] register error:', e.message);
    res.status(500).json({ success: false, error: 'Registration failed' });
  }
});

// ── POST /api/auth/login ───────────────────────────────────────────────────
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ success: false, error: 'email and password are required' });
    return;
  }
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    const user = result.rows[0];
    if (!user) {
      res.status(401).json({ success: false, error: 'Invalid email or password' });
      return;
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ success: false, error: 'Invalid email or password' });
      return;
    }
    const accessToken = signAccess(user);
    const refreshToken = signRefresh(user.id);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
    await pool.query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshToken, expiresAt]
    );
    res.json({
      success: true,
      data: {
        user: { id: user.id, username: user.username, email: user.email, created_at: user.created_at },
        accessToken,
        refreshToken,
      },
    });
  } catch (e: any) {
    console.error('[auth] login error:', e.message);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

// ── POST /api/auth/refresh ─────────────────────────────────────────────────
router.post('/refresh', async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    res.status(400).json({ success: false, error: 'refreshToken is required' });
    return;
  }
  try {
    const payload = jwt.verify(refreshToken, REFRESH_SECRET) as any;
    const stored = await pool.query(
      'SELECT * FROM refresh_tokens WHERE token = $1 AND user_id = $2 AND expires_at > NOW()',
      [refreshToken, payload.id]
    );
    if (!stored.rows.length) {
      res.status(401).json({ success: false, error: 'Refresh token is invalid or expired' });
      return;
    }
    const userRes = await pool.query('SELECT id, username, email FROM users WHERE id = $1', [payload.id]);
    const user = userRes.rows[0];
    if (!user) {
      res.status(401).json({ success: false, error: 'User not found' });
      return;
    }
    await pool.query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
    const newAccessToken = signAccess(user);
    const newRefreshToken = signRefresh(user.id);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
    await pool.query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, newRefreshToken, expiresAt]
    );
    res.json({ success: true, data: { accessToken: newAccessToken, refreshToken: newRefreshToken } });
  } catch {
    res.status(401).json({ success: false, error: 'Invalid refresh token' });
  }
});

// ── POST /api/auth/logout ──────────────────────────────────────────────────
router.post('/logout', async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    await pool.query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]).catch(() => {});
  }
  res.json({ success: true });
});

// ── GET /api/auth/me ───────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  const userRes = await pool.query(
    'SELECT id, username, email, created_at FROM users WHERE id = $1',
    [req.user!.id]
  );
  const user = userRes.rows[0];
  if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return; }
  res.json({ success: true, data: { user } });
});

// ── GET /api/auth/setup-required ──────────────────────────────────────────
router.get('/setup-required', async (_req: Request, res: Response) => {
  try {
    const r = await pool.query('SELECT COUNT(*) FROM users');
    res.json({ success: true, data: { required: parseInt(r.rows[0].count) === 0 } });
  } catch {
    res.json({ success: true, data: { required: true } });
  }
});

// ── POST /api/auth/users ─── admin creates a new user (requires auth) ─────
router.post('/users', requireAuth, async (req: AuthRequest, res: Response) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    res.status(400).json({ success: false, error: 'username, email and password are required' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    return;
  }
  try {
    const exists = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email.toLowerCase(), username.toLowerCase()]
    );
    if (exists.rows.length) {
      res.status(409).json({ success: false, error: 'Username or email already taken' });
      return;
    }
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, created_at',
      [username.trim(), email.toLowerCase().trim(), hash]
    );
    const newUser = result.rows[0];
    res.status(201).json({
      success: true,
      data: { user: { id: newUser.id, username: newUser.username, email: newUser.email, created_at: newUser.created_at } },
    });
  } catch (e: any) {
    console.error('[auth] create user error:', e.message);
    res.status(500).json({ success: false, error: 'Failed to create user' });
  }
});

// ── GET /api/auth/users ─── list all users (requires auth) ────────────────
router.get('/users', requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query('SELECT id, username, email, created_at FROM users ORDER BY id');
    res.json({ success: true, data: { users: r.rows } });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch users' });
  }
});

// ── DELETE /api/auth/users/:id ─── delete a user (requires auth) ──────────
router.delete('/users/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const targetId = parseInt(req.params.id);
  if (targetId === req.user!.id) {
    res.status(400).json({ success: false, error: 'You cannot delete your own account' });
    return;
  }
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [targetId]);
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to delete user' });
  }
});

// ── POST /api/auth/forgot-password ────────────────────────────────────────
router.post('/forgot-password', async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ success: false, error: 'email is required' });
    return;
  }
  try {
    const userRes = await pool.query('SELECT id, username, email FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    // Always respond 200 to avoid user enumeration
    if (!userRes.rows.length) {
      res.json({ success: true, message: 'If that email exists, a reset code has been sent.' });
      return;
    }
    const user = userRes.rows[0];

    // Delete any existing codes for this user
    await pool.query('DELETE FROM password_reset_codes WHERE user_id = $1', [user.id]);

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await pool.query(
      'INSERT INTO password_reset_codes (user_id, code, expires_at) VALUES ($1, $2, $3)',
      [user.id, code, expiresAt]
    );

    // Send email (non-blocking — don't fail if email is not configured)
    sendMail({
      to: user.email,
      subject: 'VPS Manager — Your password reset code',
      html: tplPasswordReset(user.username, code),
      text: `Your VPS Manager password reset code is: ${code}\n\nValid for 10 minutes. If you didn't request this, ignore this email.`,
    }).catch(e => console.error('[auth] forgot-password email error:', e));

    console.log(`[auth] Reset code for ${user.email}: ${code}`); // fallback log if email not configured
    res.json({ success: true, message: 'If that email exists, a reset code has been sent.' });
  } catch (e: any) {
    console.error('[auth] forgot-password error:', e.message);
    res.status(500).json({ success: false, error: 'Failed to process request' });
  }
});

// ── POST /api/auth/reset-password ──────────────────────────────────────────
router.post('/reset-password', async (req: Request, res: Response) => {
  const { email, code, password } = req.body;
  if (!email || !code || !password) {
    res.status(400).json({ success: false, error: 'email, code and password are required' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    return;
  }
  try {
    const userRes = await pool.query('SELECT id, username, email FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (!userRes.rows.length) {
      res.status(400).json({ success: false, error: 'Invalid code or email' });
      return;
    }
    const user = userRes.rows[0];

    const codeRes = await pool.query(
      'SELECT id FROM password_reset_codes WHERE user_id = $1 AND code = $2 AND expires_at > NOW()',
      [user.id, code.trim()]
    );
    if (!codeRes.rows.length) {
      res.status(400).json({ success: false, error: 'Invalid or expired reset code' });
      return;
    }

    // Update password and delete the used code
    const hash = await bcrypt.hash(password, 12);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, user.id]);
    await pool.query('DELETE FROM password_reset_codes WHERE user_id = $1', [user.id]);
    // Invalidate all refresh tokens (force re-login)
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [user.id]);

    // Send confirmation email
    sendMail({
      to: user.email,
      subject: 'VPS Manager — Password changed',
      html: tplPasswordChanged(user.username),
      text: `Your VPS Manager password has been changed. If you did not make this change, contact your administrator.`,
    }).catch(e => console.error('[auth] password-changed email error:', e));

    res.json({ success: true, message: 'Password reset successfully' });
  } catch (e: any) {
    console.error('[auth] reset-password error:', e.message);
    res.status(500).json({ success: false, error: 'Failed to reset password' });
  }
});

export default router;
