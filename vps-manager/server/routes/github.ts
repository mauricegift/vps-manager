import { Router } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);
const router = Router();

function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  const clean = url.trim().replace(/\.git$/, '');
  const m = clean.match(/(?:github\.com[:/])([^/\s]+)\/([^/\s]+)/);
  if (m) return { owner: m[1], repo: m[2] };
  const simple = clean.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (simple) return { owner: simple[1], repo: simple[2] };
  return null;
}

function ghHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'vps-manager',
  };
  if (token) h.Authorization = `token ${token}`;
  return h;
}

// ── Detect repo entry files ───────────────────────────────────────────────────
router.post('/detect', async (req, res) => {
  try {
    const { repoUrl, token } = req.body;
    if (!repoUrl) return res.status(400).json({ success: false, error: 'repoUrl is required' });

    const parsed = parseRepoUrl(repoUrl);
    if (!parsed) return res.status(400).json({ success: false, error: 'Invalid GitHub repo URL or "owner/repo" format' });
    const { owner, repo } = parsed;

    const headers = ghHeaders(token);
    const apiBase = `https://api.github.com/repos/${owner}/${repo}`;

    // Fetch root contents
    const contentsRes = await fetch(`${apiBase}/contents`, { headers });
    if (!contentsRes.ok) {
      const body = await contentsRes.json() as any;
      return res.status(400).json({ success: false, error: body.message || `GitHub API error (${contentsRes.status})` });
    }
    const contents = await contentsRes.json() as any[];
    const fileNames = contents.filter((f: any) => f.type === 'file').map((f: any) => f.name);
    const dirNames = contents.filter((f: any) => f.type === 'dir').map((f: any) => f.name);

    const suggestions: { file: string; reason: string; runCmd: string; installCmd?: string }[] = [];
    let appType = 'unknown';
    let defaultBranch = 'main';

    // Fetch repo metadata for default branch
    const repoRes = await fetch(apiBase, { headers });
    if (repoRes.ok) {
      const repoData = await repoRes.json() as any;
      defaultBranch = repoData.default_branch || 'main';
    }

    // ── Node.js / TypeScript ────────────────────────────────────────────────
    if (fileNames.includes('package.json')) {
      appType = 'nodejs';
      try {
        const pkgRes = await fetch(`${apiBase}/contents/package.json`, { headers });
        if (pkgRes.ok) {
          const pkgFile = await pkgRes.json() as any;
          const pkgContent = JSON.parse(Buffer.from(pkgFile.content, 'base64').toString());

          if (pkgContent.scripts?.start) {
            suggestions.push({
              file: 'npm start',
              reason: `"start" script: ${pkgContent.scripts.start}`,
              runCmd: 'npm start',
              installCmd: 'npm install',
            });
          }
          if (pkgContent.main) {
            suggestions.push({
              file: pkgContent.main,
              reason: `"main" in package.json → ${pkgContent.main}`,
              runCmd: `node ${pkgContent.main}`,
              installCmd: 'npm install',
            });
          }
          if (pkgContent.scripts?.dev) {
            suggestions.push({
              file: 'npm run dev',
              reason: `"dev" script: ${pkgContent.scripts.dev}`,
              runCmd: 'npm run dev',
              installCmd: 'npm install',
            });
          }
        }
      } catch { /* ignore */ }

      // TypeScript
      if (fileNames.includes('tsconfig.json')) {
        appType = 'typescript';
        for (const f of ['src/index.ts', 'src/server.ts', 'src/app.ts', 'index.ts', 'server.ts']) {
          const base = path.basename(f);
          if (fileNames.includes(base) || dirNames.includes('src')) {
            suggestions.push({ file: f, reason: 'TypeScript entry file', runCmd: `npx ts-node ${f}`, installCmd: 'npm install' });
            break;
          }
        }
      }
    }

    // ── Common Node.js entries ──────────────────────────────────────────────
    for (const f of ['server.js', 'app.js', 'index.js', 'main.js']) {
      if (fileNames.includes(f)) {
        suggestions.push({ file: f, reason: 'Node.js entry file', runCmd: `node ${f}`, installCmd: fileNames.includes('package.json') ? 'npm install' : undefined });
      }
    }

    // ── Python ──────────────────────────────────────────────────────────────
    const pyFiles = ['app.py', 'main.py', 'server.py', 'run.py', 'manage.py'];
    for (const f of pyFiles) {
      if (fileNames.includes(f)) {
        appType = 'python';
        const install = fileNames.includes('requirements.txt') ? 'pip install -r requirements.txt' : undefined;
        suggestions.push({ file: f, reason: 'Python entry file', runCmd: `python3 ${f}`, installCmd: install });
        if (f === 'manage.py') {
          suggestions.push({ file: 'manage.py runserver', reason: 'Django management command', runCmd: 'python3 manage.py runserver', installCmd: install });
        }
      }
    }

    // ── Shell scripts ────────────────────────────────────────────────────────
    for (const f of ['start.sh', 'run.sh', 'boot.sh']) {
      if (fileNames.includes(f)) {
        suggestions.push({ file: f, reason: 'Shell start script', runCmd: `bash ${f}` });
      }
    }

    // ── Bun ─────────────────────────────────────────────────────────────────
    if (fileNames.includes('bun.lockb') || fileNames.includes('bunfig.toml')) {
      suggestions.unshift({ file: 'bun start', reason: 'Bun project detected', runCmd: 'bun start', installCmd: 'bun install' });
    }

    // Deduplicate
    const seen = new Set<string>();
    const unique = suggestions.filter(s => { if (seen.has(s.file)) return false; seen.add(s.file); return true; });

    res.json({
      success: true,
      data: {
        owner,
        repo,
        defaultBranch,
        appType,
        suggestions: unique,
        rootFiles: fileNames,
        rootDirs: dirNames,
        hasPackageJson: fileNames.includes('package.json'),
        hasRequirementsTxt: fileNames.includes('requirements.txt'),
        hasInstallSh: fileNames.includes('install.sh'),
      },
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Clone a repo ─────────────────────────────────────────────────────────────
router.post('/clone', async (req, res) => {
  try {
    const { repoUrl, token, dir, runInstall = true } = req.body;
    if (!repoUrl || !dir) return res.status(400).json({ success: false, error: 'repoUrl and dir are required' });

    const parsed = parseRepoUrl(repoUrl);
    if (!parsed) return res.status(400).json({ success: false, error: 'Invalid GitHub repo URL' });
    const { owner, repo } = parsed;

    const cloneUrl = token
      ? `https://${token}@github.com/${owner}/${repo}.git`
      : `https://github.com/${owner}/${repo}.git`;

    // Remove directory if already exists (re-clone)
    if (existsSync(dir)) {
      await execAsync(`rm -rf "${dir}" 2>&1`);
    }
    await mkdir(path.dirname(dir), { recursive: true });

    const { stdout: cloneOut, stderr: cloneErr } = await execAsync(
      `git clone "${cloneUrl}" "${dir}" 2>&1`,
      { timeout: 120000 }
    );
    const cloneLog = (cloneOut + cloneErr).trim();

    let installLog = '';
    if (runInstall && existsSync(dir)) {
      if (existsSync(path.join(dir, 'package.json'))) {
        try {
          const { stdout } = await execAsync(`cd "${dir}" && npm install 2>&1`, { timeout: 180000 });
          installLog = '\n\n[npm install]\n' + stdout;
        } catch (e: any) { installLog = '\n\n[npm install failed]\n' + e.message; }
      } else if (existsSync(path.join(dir, 'requirements.txt'))) {
        try {
          const { stdout } = await execAsync(`cd "${dir}" && pip install -r requirements.txt 2>&1`, { timeout: 180000 });
          installLog = '\n\n[pip install]\n' + stdout;
        } catch (e: any) { installLog = '\n\n[pip install failed]\n' + e.message; }
      } else if (existsSync(path.join(dir, 'install.sh'))) {
        try {
          const { stdout } = await execAsync(`cd "${dir}" && bash install.sh 2>&1`, { timeout: 180000 });
          installLog = '\n\n[install.sh]\n' + stdout;
        } catch (e: any) { installLog = '\n\n[install.sh failed]\n' + e.message; }
      }
    }

    res.json({ success: true, data: { dir, owner, repo, output: cloneLog + installLog } });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── List repo tree (for browsing files) ─────────────────────────────────────
router.post('/tree', async (req, res) => {
  try {
    const { repoUrl, token, subPath = '' } = req.body;
    if (!repoUrl) return res.status(400).json({ success: false, error: 'repoUrl required' });

    const parsed = parseRepoUrl(repoUrl);
    if (!parsed) return res.status(400).json({ success: false, error: 'Invalid repo URL' });
    const { owner, repo } = parsed;

    const headers = ghHeaders(token);
    const endpoint = subPath
      ? `https://api.github.com/repos/${owner}/${repo}/contents/${subPath}`
      : `https://api.github.com/repos/${owner}/${repo}/contents`;

    const r = await fetch(endpoint, { headers });
    if (!r.ok) {
      const b = await r.json() as any;
      return res.status(400).json({ success: false, error: b.message });
    }
    const items = await r.json() as any[];
    res.json({ success: true, data: items.map((i: any) => ({ name: i.name, type: i.type, path: i.path, size: i.size })) });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
