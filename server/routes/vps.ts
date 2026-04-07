import { Router } from 'express';
import { exec } from 'child_process';

const router = Router();

router.post('/restart', (_req, res) => {
  res.json({ success: true, message: 'Restarting...' });
  setTimeout(() => exec('shutdown -r now'), 1000);
});

router.post('/shutdown', (_req, res) => {
  res.json({ success: true, message: 'Shutting down...' });
  setTimeout(() => exec('shutdown -h now'), 1000);
});

export default router;
