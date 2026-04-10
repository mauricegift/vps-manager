import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';

const router = Router();

const ACCESS_SECRET = process.env.SESSION_SECRET || 'vpsmanager_access_secret';
const REFRESH_SECRET = (process.env.SESSION_SECRET || 'vpsmanager_access_secret') + '_refresh';
const ACCESS_TTL = '1d';
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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
    const user = result.rows[0];
    const accessToken = signAccess(user);
    const refreshToken = signRefresh(user.id);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
    await pool.query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshToken, expiresAt]
    );
    res.status(201).json({
      success: true,
      data: {
        user: { id: user.id, username: user.username, email: user.email, created_at: user.created_at },
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
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );
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
    // Rotate: delete old, issue new
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

export default router;
