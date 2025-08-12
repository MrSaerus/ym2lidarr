import { Router } from 'express';
import fs from 'fs';

import { prisma } from '../prisma';
import { runBackup } from '../scheduler';

const r = Router();

r.post('/run', async (_req, res) => {
  runBackup().catch(() => {});
  res.json({ started: true });
});

r.get('/list', async (_req, res) => {
  const s = await prisma.setting.findFirst({ where: { id: 1 } });
  const dir = s?.backupDir || '/app/data/backups';
  try {
    const files = (await fs.promises.readdir(dir))
      .filter((f) => f.startsWith('app-') && f.endsWith('.db'))
      .sort()
      .reverse();
    res.json({ dir, files });
  } catch {
    res.json({ dir, files: [] });
  }
});

export default r;
