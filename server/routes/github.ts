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

    // Extract repo name from URL (e.g. "user/my-repo" → "my-repo")
    const repoSlug = repoUrl
      .replace(/^https?:\/\/github\.com\//, '')
      .replace(/\.git$/, '');
    const repoName = repoSlug.split('/').pop() || 'repo';

    // Clone destination is always {dir}/{repoName}
    const cloneTarget = path.join(dir, repoName);

    // Build authenticated clone URL
    const cloneUrl = token
      ? `https://${token}@github.com/${repoSlug}.git`
      : `https://github.com/${repoSlug}.git`;

    // Ensure the parent dir exists
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    // Clone into parent dir — git creates the {repoName} subfolder automatically
    const cloneCmd = `git clone --progress ${JSON.stringify(cloneUrl)} ${JSON.stringify(repoName)}`;
    let output = '';
    try {
      const { stdout, stderr } = await execAsync(cloneCmd, {
        cwd: dir,
        timeout: 120_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      output = (stdout + stderr).trim();
    } catch (cloneErr: any) {
      const msg: string = (cloneErr.stderr || cloneErr.stdout || cloneErr.message || 'Clone failed').trim();
      const safe = token ? msg.replace(new RegExp(token, 'g'), '***') : msg;
      return res.status(500).json({ success: false, error: safe });
    }

    // Optionally run npm install
    let installOutput = '';
    if (runInstall && existsSync(path.join(cloneTarget, 'package.json'))) {
      try {
        const { stdout, stderr } = await execAsync('npm install --legacy-peer-deps', {
          cwd: cloneTarget,
          timeout: 180_000,
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

export default router;
