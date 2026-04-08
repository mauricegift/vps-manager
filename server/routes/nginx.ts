import { Router } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);
const router = Router();

const SITES_AVAILABLE = '/etc/nginx/sites-available';
const SITES_ENABLED   = '/etc/nginx/sites-enabled';

async function run(cmd: string, timeout = 15000): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout });
    return (stdout + stderr).trim();
  } catch (e: any) {
    return (e.stdout || e.stderr || e.message || '').trim();
  }
}

function dirFiles(dir: string): string[] {
  try { return fs.existsSync(dir) ? fs.readdirSync(dir) : []; } catch { return []; }
}

function isEnabled(name: string): boolean {
  const p = path.join(SITES_ENABLED, name);
  try { return fs.existsSync(p); } catch { return false; }
}

// ─── Nginx Status ───────────────────────────────────────────────────────────

router.get('/status', async (_req, res) => {
  const version = await run('nginx -v 2>&1');
  const installed = version.toLowerCase().includes('nginx');
  const test = await run('nginx -t 2>&1');
  const configOk = test.includes('syntax is ok');
  const running = await run('systemctl is-active nginx 2>&1');
  res.json({ installed, configOk, running: running.trim() === 'active', version, testOutput: test });
});

// ─── Nginx Configs ──────────────────────────────────────────────────────────

router.get('/configs', (_req, res) => {
  const available = dirFiles(SITES_AVAILABLE);
  const configs = available.map(name => ({ name, enabled: isEnabled(name) }));
  res.json({ data: configs });
});

router.get('/configs/:name', (req, res) => {
  const file = path.join(SITES_AVAILABLE, path.basename(req.params.name));
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
  res.json({ content: fs.readFileSync(file, 'utf8') });
});

router.put('/configs/:name', (req, res) => {
  const file = path.join(SITES_AVAILABLE, path.basename(req.params.name));
  if (!req.body.content && req.body.content !== '') return res.status(400).json({ error: 'content required' });
  fs.writeFileSync(file, req.body.content, 'utf8');
  res.json({ ok: true });
});

router.post('/configs', (req, res) => {
  const { name, content } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const file = path.join(SITES_AVAILABLE, path.basename(name));
  if (fs.existsSync(file)) return res.status(409).json({ error: 'Config already exists' });
  fs.writeFileSync(file, content || `server {\n    listen 80;\n    server_name ${name};\n\n    location / {\n        proxy_pass http://127.0.0.1:3000;\n        proxy_http_version 1.1;\n        proxy_set_header Upgrade $http_upgrade;\n        proxy_set_header Connection 'upgrade';\n        proxy_set_header Host $host;\n    }\n}\n`, 'utf8');
  res.json({ ok: true });
});

router.delete('/configs/:name', (req, res) => {
  const name = path.basename(req.params.name);
  const src  = path.join(SITES_AVAILABLE, name);
  const link = path.join(SITES_ENABLED,   name);
  try { if (fs.existsSync(link)) fs.unlinkSync(link); } catch {}
  try { if (fs.existsSync(src))  fs.unlinkSync(src);  } catch {}
  res.json({ ok: true });
});

router.post('/configs/:name/enable', async (req, res) => {
  const name = path.basename(req.params.name);
  const src  = path.join(SITES_AVAILABLE, name);
  const dst  = path.join(SITES_ENABLED,   name);
  if (!fs.existsSync(src)) return res.status(404).json({ error: 'Config not found' });
  try { if (!fs.existsSync(dst)) fs.symlinkSync(src, dst); } catch (e: any) { return res.status(500).json({ error: e.message }); }
  const out = await run('nginx -t 2>&1 && nginx -s reload 2>&1');
  res.json({ ok: true, output: out });
});

router.post('/configs/:name/disable', async (req, res) => {
  const dst = path.join(SITES_ENABLED, path.basename(req.params.name));
  try { if (fs.existsSync(dst)) fs.unlinkSync(dst); } catch (e: any) { return res.status(500).json({ error: e.message }); }
  const out = await run('nginx -s reload 2>&1');
  res.json({ ok: true, output: out });
});

router.post('/test', async (_req, res) => {
  const out = await run('nginx -t 2>&1');
  res.json({ output: out, ok: out.includes('syntax is ok') });
});

router.post('/reload', async (_req, res) => {
  const out = await run('nginx -s reload 2>&1');
  res.json({ output: out, ok: !out.toLowerCase().includes('error') });
});

router.post('/restart', async (_req, res) => {
  const out = await run('systemctl restart nginx 2>&1');
  res.json({ output: out, ok: !out.toLowerCase().includes('failed') });
});

// ─── Certbot Certs ──────────────────────────────────────────────────────────

router.get('/certs', async (_req, res) => {
  const out = await run('certbot certificates 2>&1', 20000);
  const certs: any[] = [];
  const blocks = out.split(/Found the following certs:|Saving debug log/i).join('\n').split(/\n(?=\s*Certificate Name:)/);
  for (const block of blocks) {
    const name    = block.match(/Certificate Name:\s*(.+)/)?.[1]?.trim();
    const domains = block.match(/Domains:\s*(.+)/)?.[1]?.trim().split(/\s+/) ?? [];
    const expiry  = block.match(/Expiry Date:\s*(.+?)(?:\s*\()/)?.[1]?.trim();
    const valid   = /VALID/i.test(block);
    const certPath = block.match(/Certificate Path:\s*(.+)/)?.[1]?.trim();
    const keyPath  = block.match(/Private Key Path:\s*(.+)/)?.[1]?.trim();
    if (name) certs.push({ name, domains, expiry, valid, certPath, keyPath });
  }
  res.json({ data: certs, raw: out });
});

router.post('/certs/issue', async (req, res) => {
  const { domains, email, method, webrootPath } = req.body;
  if (!domains?.length || !email) return res.status(400).json({ error: 'domains and email required' });
  const domainFlags = (Array.isArray(domains) ? domains : [domains]).map((d: string) => `-d ${d}`).join(' ');
  const methodFlag  = method === 'standalone'
    ? '--standalone --preferred-challenges http'
    : `--webroot -w ${webrootPath || '/var/www/html'}`;
  const cmd = `certbot certonly ${methodFlag} --non-interactive --agree-tos --email ${email} ${domainFlags} 2>&1`;
  const out = await run(cmd, 120000);
  res.json({ output: out, ok: /Congratulations|Successfully received/i.test(out) });
});

router.post('/certs/renew', async (req, res) => {
  const { name } = req.body;
  const cmd = name
    ? `certbot renew --cert-name ${name} --non-interactive 2>&1`
    : 'certbot renew --non-interactive 2>&1';
  const out = await run(cmd, 120000);
  res.json({ output: out, ok: !out.toLowerCase().includes('failed') });
});

router.delete('/certs/:name', async (req, res) => {
  const out = await run(`certbot delete --cert-name ${encodeURIComponent(req.params.name)} --non-interactive 2>&1`, 30000);
  res.json({ output: out, ok: !out.toLowerCase().includes('failed') });
});

router.post('/certs/:name/revoke', async (req, res) => {
  const out = await run(`certbot revoke --cert-name ${encodeURIComponent(req.params.name)} --non-interactive 2>&1`, 30000);
  res.json({ output: out });
});

export default router;
