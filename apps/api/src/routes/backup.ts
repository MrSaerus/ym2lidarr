// apps/api/src/routes/backup.ts
import { Router } from 'express';
import path from 'path';

import { prisma } from '../prisma';
import { runBackupNow, listBackups } from '../scheduler';

const r = Router();

/** GET /api/backup/list — список бэкапов */
r.get('/list', async (_req, res) => {
  // используем id=1 для единообразия со всем кодом
  const s = await prisma.setting.findFirst({ where: { id: 1 } });
  const dir = s?.backupDir || '/app/data/backups';
  const files = listBackups(dir);
  res.json({ ok: true, dir, files });
});

/** POST /api/backup/run — выполнить бэкап сейчас */
r.post('/run', async (_req, res) => {
  const result = await runBackupNow();

  if (!result.ok) {
    // disabled → 400; остальное → 500
    const status = result.error && /disabled/i.test(result.error) ? 400 : 500;
    return res.status(status).json(result);
  }

  const s = await prisma.setting.findFirst({ where: { id: 1 } });
  const dir = s?.backupDir || '/app/data/backups';
  const abs = result.file ? path.join(dir, result.file) : undefined;

  res.json({ ...result, path: abs });
});

export default r;
