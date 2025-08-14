import cron from 'node-cron';
import fs from 'fs';
import path from 'path';

import { prisma } from './prisma';
import { runYandexSync, runLidarrPush } from './workers';

let jobs: {
  yandex?: cron.ScheduledTask;
  lidarr?: cron.ScheduledTask;
  backup?: cron.ScheduledTask;
} = {};

function ts() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
      d.getFullYear() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) +
      '_' +
      pad(d.getHours()) +
      pad(d.getMinutes()) +
      pad(d.getSeconds())
  );
}

/** Выполнить бэкап сейчас (VACUUM INTO + ротация) */
export async function runBackupNow(): Promise<{
  ok: boolean;
  file?: string;
  deleted?: string[];
  error?: string;
}> {
  try {
    const s = await prisma.setting.findFirst();
    if (!s || !s.backupEnabled) {
      return { ok: false, error: 'Backups are disabled in settings.' };
    }
    const backupDir = s.backupDir || '/app/data/backups';
    const retention = s.backupRetention ?? 0;

    // создаём каталог и проверяем, что он доступен на запись
    fs.mkdirSync(backupDir, { recursive: true });
    try {
      // проверим право на запись (создадим и удалим temp-файл)
      const probe = path.join(backupDir, '.write-test');
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
    } catch (e) {
      const msg = (e as Error).message || String(e);
      return { ok: false, error: `Backup dir not writable: ${backupDir}. ${msg}` };
    }

    // сбрасываем WAL → через queryRawUnsafe, т.к. возвращает строки
    try {
      await prisma.$queryRawUnsafe(`PRAGMA wal_checkpoint(TRUNCATE);`);
    } catch (e) {
      console.warn('[backup] wal_checkpoint failed:', (e as Error).message);
    }

    const fname = `backup_${ts()}.db`;
    const full = path.resolve(backupDir, fname);
    const escaped = full.replace(/'/g, "''");

    console.log('[backup] start →', full);
    await prisma.$executeRawUnsafe(`VACUUM INTO '${escaped}';`);
    console.log('[backup] done:', full);

    // ротация по retention (как было)
    const deleted: string[] = [];
    if (retention && retention > 0) {
      const entries = fs
          .readdirSync(backupDir)
          .filter((f) => /^backup_\d{8}_\d{6}\.db$/i.test(f))
          .map((f) => ({ f, m: fs.statSync(path.join(backupDir, f)).mtimeMs }))
          .sort((a, b) => b.m - a.m);
      for (const x of entries.slice(retention)) {
        try {
          fs.unlinkSync(path.join(backupDir, x.f));
          deleted.push(x.f);
        } catch (e) {
          console.warn('[backup] delete failed', x.f, (e as Error).message);
        }
      }
      if (deleted.length) console.log('[backup] rotated: deleted', deleted.length, 'files');
    }

    return { ok: true, file: fname, deleted };
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error('[backup] failed:', msg);
    return { ok: false, error: msg };
  }
}


/** Список файлов бэкапа в каталоге */
export function listBackups(dir: string): { file: string; size: number; mtime: number }[] {
  try {
    if (!fs.existsSync(dir)) return [];
    const out: { file: string; size: number; mtime: number }[] = [];
    for (const f of fs.readdirSync(dir)) {
      if (!/^backup_\d{8}_\d{6}\.db$/i.test(f)) continue;
      const full = path.join(dir, f);
      const st = fs.statSync(full);
      out.push({ file: f, size: st.size, mtime: st.mtimeMs });
    }
    out.sort((a, b) => b.mtime - a.mtime);
    return out;
  } catch {
    return [];
  }
}

export async function initScheduler() {
  await reloadJobs();
}

export async function reloadJobs() {
  // стоп старые
  for (const k of Object.keys(jobs) as (keyof typeof jobs)[]) {
    jobs[k]?.stop();
    jobs[k] = undefined;
  }

  const s = await prisma.setting.findFirst(); // NOTE: singular model
  if (!s) return;

  // Яндекс
  if (s.yandexCron && cron.validate(s.yandexCron)) {
    jobs.yandex = cron.schedule(s.yandexCron, async () => {
      try {
        console.log('[cron] yandex sync');
        await runYandexSync(); // без аргументов — совместимо по типам
      } catch (e) {
        console.error('[cron] yandex failed:', (e as Error).message);
      }
    });
  }

  // Lidarr
  if (s.lidarrCron && cron.validate(s.lidarrCron)) {
    jobs.lidarr = cron.schedule(s.lidarrCron, async () => {
      try {
        console.log('[cron] lidarr push');
        await runLidarrPush();
      } catch (e) {
        console.error('[cron] lidarr failed:', (e as Error).message);
      }
    });
  }

  // Backups
  if (s.backupEnabled && s.backupCron && cron.validate(s.backupCron)) {
    jobs.backup = cron.schedule(s.backupCron, async () => {
      try {
        console.log('[cron] backup run');
        await runBackupNow();
      } catch (e) {
        console.error('[cron] backup failed:', (e as Error).message);
      }
    });
  }

  console.log('[scheduler] jobs reloaded');
}
