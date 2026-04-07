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
  } catch (e: any) {
    console.warn('[db] Could not init DB (PostgreSQL may not be running locally):', e.message);
  }
}

export default pool;
