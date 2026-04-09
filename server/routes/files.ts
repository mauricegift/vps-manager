import { Router } from 'express';
import { readdir, stat, rm, rename, mkdir, readFile, writeFile, cp } from 'fs/promises';
import { existsSync, createWriteStream, createReadStream } from 'fs';
import path from 'path';
import multer from 'multer';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const router = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, '/tmp'),
    filename: (_req, file, cb) => cb(null, `upload_${Date.now()}_${file.originalname}`),
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
});

router.get('/', async (req, res) => {
  try {
    const dirPath = (req.query.path as string) || '/';
    if (!existsSync(dirPath)) return res.status(404).json({ success: false, error: 'Path not found' });

    const entries = await readdir(dirPath, { withFileTypes: true });
    const items = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dirPath, entry.name);
        try {
          const s = await stat(fullPath);
          return {
            name: entry.name,
            path: fullPath,
            type: entry.isDirectory() ? 'directory' : 'file',
            size: s.size,
            modified: s.mtime.toISOString(),
            permissions: (s.mode & 0o777).toString(8),
            owner: String(s.uid),
          };
        } catch { return null; }
      })
    );
    res.json({ success: true, data: items.filter(Boolean) });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/read', async (req, res) => {
  try {
    const filePath = req.query.path as string;
    const s = await stat(filePath);
    if (s.size > 2 * 1024 * 1024) return res.status(413).json({ success: false, error: 'File too large (>2MB)' });
    const content = await readFile(filePath, 'utf-8');
    res.json({ success: true, data: content });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.delete('/', async (req, res) => {
  try {
    const { path: p } = req.body;
    await rm(p, { recursive: true, force: true });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/move', async (req, res) => {
  try {
    const { src, dest } = req.body;
    await rename(src, dest);
    res.json({ success: true });
  } catch {
    try {
      await cp(req.body.src, req.body.dest, { recursive: true });
      await rm(req.body.src, { recursive: true, force: true });
      res.json({ success: true });
    } catch (e2: any) {
      res.status(500).json({ success: false, error: e2.message });
    }
  }
});

router.post('/copy', async (req, res) => {
  try {
    const { src, dest } = req.body;
    await cp(src, dest, { recursive: true });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/mkdir', async (req, res) => {
  try {
    const { path: p } = req.body;
    await mkdir(p, { recursive: true });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Create new file with content
router.post('/create', async (req, res) => {
  try {
    const { path: p, content = '' } = req.body;
    if (!p) return res.status(400).json({ success: false, error: 'path is required' });
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, content, 'utf-8');
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Save/overwrite file content
router.post('/save', async (req, res) => {
  try {
    const { path: p, content } = req.body;
    if (!p) return res.status(400).json({ success: false, error: 'path is required' });
    await writeFile(p, content || '', 'utf-8');
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Upload file(s) to a directory (supports folder structure via relativePaths field)
router.post('/upload', upload.array('files'), async (req, res) => {
  try {
    const destDir = (req.body.path as string) || '/';
    if (!existsSync(destDir)) await mkdir(destDir, { recursive: true });
    const files = req.files as Express.Multer.File[];
    let relativePaths: string[] = [];
    try { relativePaths = req.body.relativePaths ? JSON.parse(req.body.relativePaths) : []; } catch { relativePaths = []; }
    const moved = await Promise.all(
      files.map(async (f, i) => {
        const relPath = relativePaths[i] || f.originalname;
        const dest = path.join(destDir, relPath);
        const destParent = path.dirname(dest);
        if (!existsSync(destParent)) await mkdir(destParent, { recursive: true });
        const content = await readFile(f.path);
        await writeFile(dest, content);
        await rm(f.path, { force: true });
        return relPath;
      })
    );
    res.json({ success: true, data: moved });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Check if path exists
router.get('/exists', async (req, res) => {
  try {
    const { path: p } = req.query as { path: string };
    if (!p) return res.status(400).json({ success: false, error: 'path required' });
    const exists = existsSync(p);
    let type = 'none';
    if (exists) {
      const s = await stat(p);
      type = s.isDirectory() ? 'directory' : 'file';
    }
    res.json({ success: true, data: { exists, type } });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Bulk delete multiple paths
router.post('/bulk-delete', async (req, res) => {
  try {
    const { paths } = req.body as { paths: string[] };
    if (!paths || !paths.length) return res.status(400).json({ success: false, error: 'paths required' });
    await Promise.all(paths.map(p => rm(p, { recursive: true, force: true })));
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Zip selected paths into archive
const ZIP_EXCLUDE = [
  '*/node_modules/*', '*/.git/*', '*/.npm/*', '*/.agents/*',
  '*/attached_assets/*', '*/replit.md', '*/replit.nix', '*/.replit',
  '*/bun.lock', '*/package-lock.json',
  '*/__pycache__/*', '*/*.pyc', '*/.mypy_cache/*',
  '*/dist/*', '*/build/*', '*/.next/*',
  '*/target/*', '*/vendor/*',
  '*/venv/*', '*/.venv/*',
  '*/*.egg-info/*',
].map(p => `-x "${p}"`).join(' ');

router.post('/zip', async (req, res) => {
  try {
    const { paths, dest } = req.body as { paths: string[]; dest?: string };
    if (!paths || !paths.length) return res.status(400).json({ success: false, error: 'paths required' });
    const outPath = dest || path.join('/tmp', `archive-${Date.now()}.zip`);
    const quoted = paths.map(p => `"${p}"`).join(' ');
    await execAsync(`zip -r "${outPath}" ${quoted} ${ZIP_EXCLUDE} 2>&1`);
    res.json({ success: true, data: { path: outPath } });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Download a file
router.get('/download', async (req, res) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath || !existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }
    const filename = path.basename(filePath);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    createReadStream(filePath).pipe(res);
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
