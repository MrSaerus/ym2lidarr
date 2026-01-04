// apps/api/src/routes/backup.ts
import { Router } from 'express';
import path from 'path';

import { prisma } from '../prisma';
import { runBackupNow, listBackups } from '../scheduler';
import { createLogger } from '../lib/logger';

const r = Router();
const log = createLogger({ scope: 'route.backup' });

/** GET /api/backup/list — список бэкапов */
r.get('/list', async (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
  lg.info('list backups requested', 'backup.list.start');

  try {
    const s = await prisma.setting.findFirst({ where: { id: 1 } });
    const dir = s?.backupDir || '/app/data/backups';
    lg.debug('resolved backup directory', 'backup.list.dir', { dir });

    const files = listBackups(dir);
    lg.info('list backups completed', 'backup.list.done', { count: files?.length ?? 0 });

    res.json({ ok: true, dir, files });
  } catch (err: any) {
    lg.error('list backups failed', 'backup.list.fail', { err: err?.message });
    res.status(500).json({ ok: false, error: 'Failed to list backups' });
  }
});

/** POST /api/backup/run — выполнить бэкап сейчас */
r.post('/run', async (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
  lg.info('run backup requested', 'backup.run.start');

  try {
    const result = await runBackupNow();

    if (!result.ok) {
      const status = result.error && /disabled/i.test(result.error) ? 400 : 500;

      if (status === 400) {
        lg.warn('backup run is disabled', 'backup.run.disabled', { error: result.error });
      } else {
        lg.error('backup run failed', 'backup.run.fail', { error: result.error });
      }

      return res.status(status).json(result);
    }

    const s = await prisma.setting.findFirst({ where: { id: 1 } });
    const dir = s?.backupDir || '/app/data/backups';
    const abs = result.file ? path.join(dir, result.file) : undefined;

    lg.info('backup run completed', 'backup.run.done', { file: result.file, path: abs });

    res.json({ ...result, path: abs });
  } catch (err: any) {
    lg.error('backup run handler crashed', 'backup.run.error', { err: err?.message });
    res.status(500).json({ ok: false, error: 'Failed to run backup' });
  }
});

export default r;
