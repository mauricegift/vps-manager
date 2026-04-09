import { Router } from 'express';
import { exec } from 'child_process';
import { existsSync, readdirSync } from 'fs';
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

    // Build authenticated clone URL
    const repoSlug = repoUrl
      .replace(/^https?:\/\/github\.com\//, '')
      .replace(/\.git$/, '');
    const cloneUrl = token
      ? `https://${token}@github.com/${repoSlug}.git`
      : `https://github.com/${repoSlug}.git`;

    // Safety check: refuse to clone into a non-empty existing directory
    if (existsSync(dir)) {
      const entries = readdirSync(dir).filter(e => e !== '.git');
      if (entries.length > 0) {
        return res.status(400).json({
          success: false,
          error: `Directory "${dir}" already exists and is not empty. Choose a new or empty directory.`,
        });
      }
    } else {
      // Create target directory (including parents)
      await mkdir(dir, { recursive: true });
    }

    const parentDir = path.dirname(dir);
    const targetName = path.basename(dir);

    // Clone into parent, naming the folder as targetName
    const cloneCmd = `git clone --progress ${JSON.stringify(cloneUrl)} ${JSON.stringify(targetName)}`;
    let output = '';
    try {
      const { stdout, stderr } = await execAsync(cloneCmd, {
        cwd: parentDir,
        timeout: 120_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      output = (stdout + stderr).trim();
    } catch (cloneErr: any) {
      const msg: string = (cloneErr.stderr || cloneErr.stdout || cloneErr.message || 'Clone failed').trim();
      // Strip the token from error messages
      const safe = token ? msg.replace(new RegExp(token, 'g'), '***') : msg;
      return res.status(500).json({ success: false, error: safe });
    }

    // Optionally run npm install
    let installOutput = '';
    if (runInstall && existsSync(path.join(dir, 'package.json'))) {
      try {
        const { stdout, stderr } = await execAsync('npm install --legacy-peer-deps', {
          cwd: dir,
          timeout: 180_000,
        });
        installOutput = (stdout + stderr).trim();
      } catch (installErr: any) {
        installOutput = `npm install failed: ${installErr.message}`;
      }
    }

    const fullOutput = [output, installOutput].filter(Boolean).join('\n\n');
    return res.json({ success: true, data: { output: fullOutput || 'Cloned successfully' } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
