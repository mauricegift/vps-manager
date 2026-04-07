import { Router } from 'express';
import pool from '../db.js';
import { testSSHConnection, getRemoteSystemInfo } from '../ssh.js';

const router = Router();

// List all stored VPS connections
router.get('/', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, ip, port, username, tags, notes, created_at, last_tested, last_status FROM vps_connections ORDER BY created_at DESC'
    );
    res.json({ success: true, data: result.rows });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Add a new VPS connection
router.post('/', async (req, res) => {
  try {
    const { name, ip, port = 22, username = 'root', password, ssh_key, notes, tags } = req.body;
    if (!name || !ip) {
      return res.status(400).json({ success: false, error: 'name and ip are required' });
    }
    const result = await pool.query(
      `INSERT INTO vps_connections (name, ip, port, username, password, ssh_key, notes, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, name, ip, port, username, tags, notes, created_at, last_tested, last_status`,
      [name, ip, port, username, password || null, ssh_key || null, notes || null, tags || null]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Update a VPS connection
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, ip, port, username, password, ssh_key, notes, tags } = req.body;
    const result = await pool.query(
      `UPDATE vps_connections
       SET name=$1, ip=$2, port=$3, username=$4,
           password=COALESCE($5, password),
           ssh_key=COALESCE($6, ssh_key),
           notes=$7, tags=$8
       WHERE id=$9
       RETURNING id, name, ip, port, username, tags, notes, created_at, last_tested, last_status`,
      [name, ip, port || 22, username || 'root', password || null, ssh_key || null, notes || null, tags || null, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Delete a VPS connection
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM vps_connections WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Test SSH connection
router.post('/:id/test', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM vps_connections WHERE id=$1',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Not found' });
    const row = result.rows[0];
    const ok = await testSSHConnection({
      ip: row.ip,
      port: row.port,
      username: row.username,
      password: row.password || undefined,
      sshKey: row.ssh_key || undefined,
    });
    const status = ok ? 'online' : 'offline';
    await pool.query(
      'UPDATE vps_connections SET last_tested=NOW(), last_status=$1 WHERE id=$2',
      [status, row.id]
    );
    res.json({ success: true, online: ok, status });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Get system info from a remote VPS
router.get('/:id/info', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM vps_connections WHERE id=$1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Not found' });
    const row = result.rows[0];
    const info = await getRemoteSystemInfo({
      ip: row.ip,
      port: row.port,
      username: row.username,
      password: row.password || undefined,
      sshKey: row.ssh_key || undefined,
    });
    res.json({ success: true, data: info });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Run a command on a remote VPS
router.post('/:id/exec', async (req, res) => {
  try {
    const { command } = req.body;
    if (!command) return res.status(400).json({ success: false, error: 'command is required' });
    const result = await pool.query('SELECT * FROM vps_connections WHERE id=$1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Not found' });
    const row = result.rows[0];
    const { runSSHCommand } = await import('../ssh.js');
    const { stdout, stderr, code } = await runSSHCommand(
      { ip: row.ip, port: row.port, username: row.username, password: row.password || undefined, sshKey: row.ssh_key || undefined },
      command
    );
    res.json({ success: true, stdout, stderr, code });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
