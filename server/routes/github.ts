import { Router } from 'express';
import { exec } from 'child_process';
import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);
const router = Router();

router.post('/clone', async (req, res) => {
  try {
    const { repoUrl, token, dir, runInstall } = req.body as {
      repoUrl: string;
      token?: string;
      dir: string;
      runInstall?: boolean;
    };

    if (!repoUrl || !dir) {
      return res.status(400).json({ success: false, error: 'repoUrl and dir are required' });
    }

    // Extract repo slug from URL (e.g. "user/my-repo")
    const repoSlug = repoUrl
      .replace(/^https?:\/\/github\.com\//, '')
      .replace(/\.git$/, '');

    // `dir` is the FULL destination path (e.g. /root/apps/atassa).
    // Split into parent dir + clone folder name so git creates exactly the path the user expects.
    const parentDir  = path.dirname(dir);   // /root/apps
    const cloneName  = path.basename(dir);  // atassa
    const cloneTarget = dir;                // /root/apps/atassa  (= parentDir/cloneName)

    // Build authenticated clone URL
    const cloneUrl = token
      ? `https://${token}@github.com/${repoSlug}.git`
      : `https://github.com/${repoSlug}.git`;

    // Ensure the parent dir exists (not the clone target itself — git creates that)
    if (!existsSync(parentDir)) {
      await mkdir(parentDir, { recursive: true });
    }

    // Source NVM + widen PATH so npm/node/git are found even under PM2
    const NVM_PREFIX = `export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" --no-use; `;
    const WIDE_ENV = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      DEBIAN_FRONTEND: 'noninteractive',
      PATH: [process.env.PATH, '/usr/local/bin', '/usr/bin', '/bin'].filter(Boolean).join(':'),
    };

    // Clone into parentDir — git creates the {cloneName} subfolder automatically
    const cloneCmd = `${NVM_PREFIX}git clone --progress ${JSON.stringify(cloneUrl)} ${JSON.stringify(cloneName)}`;
    let output = '';
    try {
      const { stdout, stderr } = await execAsync(cloneCmd, {
        cwd: parentDir,
        timeout: 120_000,
        env: WIDE_ENV,
      });
      output = (stdout + stderr).trim();
    } catch (cloneErr: any) {
      const msg: string = (cloneErr.stderr || cloneErr.stdout || cloneErr.message || 'Clone failed').trim();
      const safe = token ? msg.replace(new RegExp(token, 'g'), '***') : msg;
      return res.status(500).json({ success: false, error: safe });
    }

    // Optionally run npm install (or pip if Python project)
    let installOutput = '';
    if (runInstall && existsSync(path.join(cloneTarget, 'package.json'))) {
      try {
        const { stdout, stderr } = await execAsync(`${NVM_PREFIX}npm install --legacy-peer-deps`, {
          cwd: cloneTarget,
          timeout: 180_000,
          env: WIDE_ENV,
        });
        installOutput = (stdout + stderr).trim();
      } catch (installErr: any) {
        installOutput = `npm install failed: ${installErr.message}`;
      }
    }

    const fullOutput = [output, installOutput].filter(Boolean).join('\n\n');
    return res.json({
      success: true,
      data: {
        output: fullOutput || 'Cloned successfully',
        clonedTo: cloneTarget,
      },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/detect', async (req, res) => {
  try {
    const { repoUrl, token } = req.body as { repoUrl: string; token?: string };
    if (!repoUrl) return res.status(400).json({ success: false, error: 'repoUrl is required' });

    const slug = repoUrl
      .replace(/^https?:\/\/(www\.)?github\.com\//, '')
      .replace(/\.git$/, '')
      .replace(/\/$/, '');

    const parts = slug.split('/');
    if (parts.length < 2) return res.status(400).json({ success: false, error: 'Invalid GitHub URL — expected github.com/owner/repo' });

    const [owner, repo] = parts;

    const headers: Record<string, string> = { 'User-Agent': 'vps-manager', Accept: 'application/vnd.github.v3+json' };
    if (token) headers['Authorization'] = `token ${token}`;

    const apiBase = `https://api.github.com/repos/${owner}/${repo}`;

    const metaRes = await fetch(apiBase, { headers, signal: AbortSignal.timeout(10000) });
    if (!metaRes.ok) {
      const body: any = await metaRes.json().catch(() => ({}));
      return res.status(metaRes.status).json({ success: false, error: body.message || `GitHub API error ${metaRes.status}` });
    }
    const meta: any = await metaRes.json();

    const treeRes = await fetch(`${apiBase}/git/trees/${meta.default_branch}?recursive=0`, { headers, signal: AbortSignal.timeout(8000) });
    const treeData: any = treeRes.ok ? await treeRes.json() : { tree: [] };
    const files: string[] = (treeData.tree || []).map((f: any) => f.path as string);

    const hasPackageJson      = files.includes('package.json');
    const hasRequirementsTxt  = files.includes('requirements.txt');
    const hasIndexJs          = files.includes('index.js') || files.includes('src/index.js') || files.includes('app.js');
    const hasIndexPy          = files.includes('index.py') || files.includes('app.py') || files.includes('main.py') || files.includes('server.py');
    const hasIndexTs          = files.includes('index.ts') || files.includes('src/index.ts') || files.includes('app.ts');

    const suggestions: { label: string; file: string; interpreter?: string }[] = [];
    if (hasPackageJson) {
      if (hasIndexTs)   suggestions.push({ label: 'TypeScript (tsx index.ts)',    file: 'index.ts',     interpreter: 'tsx' });
      if (hasIndexJs)   suggestions.push({ label: 'Node.js (node index.js)',       file: 'index.js' });
      suggestions.push(                   { label: 'npm start (npm run start)',     file: 'npm start',   interpreter: 'npm' });
    }
    if (hasRequirementsTxt) {
      if (hasIndexPy)   suggestions.push({ label: 'Python (python3 app.py)',       file: files.find(f => ['app.py','main.py','index.py','server.py'].includes(f)) || 'app.py', interpreter: 'python3' });
    }
    if (!suggestions.length) suggestions.push({ label: 'Custom — fill entry below', file: '' });

    return res.json({
      success: true,
      data: {
        owner,
        repo,
        description:        meta.description || '',
        defaultBranch:      meta.default_branch || 'main',
        private:            meta.private || false,
        language:           meta.language || null,
        stars:              meta.stargazers_count || 0,
        hasPackageJson,
        hasRequirementsTxt,
        suggestions,
      },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
