import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432'),
  user: process.env.PGUSER || 'vpsmanager',
  password: process.env.PGPASSWORD || 'vpsmanager_secret',
  database: process.env.PGDATABASE || 'vpsmanager',
  ssl: process.env.DATABASE_URL?.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Prevent pool errors (e.g. PostgreSQL restart) from crashing the server
pool.on('error', (err) => {
  console.error('[db] Pool client error (PostgreSQL may have restarted):', err.message);
});

export async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vps_connections (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        ip VARCHAR(45) NOT NULL,
        port INTEGER DEFAULT 22,
        username VARCHAR(100) NOT NULL DEFAULT 'root',
        password TEXT,
        ssh_key TEXT,
        notes TEXT,
        tags TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        last_tested TIMESTAMP,
        last_status VARCHAR(20) DEFAULT 'unknown'
      );
    `);
    console.log('[db] VPS connections table ready');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[db] Users table ready');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[db] Refresh tokens table ready');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_reset_codes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code VARCHAR(6) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[db] Password reset codes table ready');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS smtp_settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[db] SMTP settings table ready');
  } catch (e: any) {
    console.warn('[db] Could not init DB (PostgreSQL may not be running locally):', e.message);
  }
}

export default pool;
