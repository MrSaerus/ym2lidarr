import fs from 'fs';
import * as cron from 'node-cron';
import path from 'path';

import { log as dblog } from './log';
import { prisma } from './prisma';
import { runYandexSync, runLidarrPush } from './workers';

let yandexTask: cron.ScheduledTask | null = null;
let lidarrTask: cron.ScheduledTask | null = null;
let backupTask: cron.ScheduledTask | null = null;

function safeSchedule(cronExpr: string, job: () => void, label: string) {
  try {
    const task = cron.schedule(cronExpr, job, { timezone: 'UTC' });
    console.log(`[scheduler] ${label} scheduled: ${cronExpr}`);
    return task;
  } catch (e: any) {
    console.warn(`[scheduler] invalid cron for ${label}: "${cronExpr}" — ${e?.message || e}`);
    return null;
  }
}

/**
 * Перечитать настройки и пересоздать задания cron.
 * Вызывается на старте и после сохранения настроек.
 */
export async function rescheduleAll() {
  const s = await prisma.setting.findFirst({ where: { id: 1 } });

  // Yandex likes sync
  if (yandexTask) {
    yandexTask.stop();
    yandexTask = null;
  }
  if (s?.yandexCron && s.yandexCron.trim()) {
    yandexTask = safeSchedule(
      s.yandexCron.trim(),
      () => {
        // без force; токен берётся из БД
        runYandexSync(undefined, undefined, { force: false }).catch(() => {});
      },
      'yandex',
    );
  } else {
    console.log('[scheduler] yandex disabled');
  }

  // Lidarr push
  if (lidarrTask) {
    lidarrTask.stop();
    lidarrTask = null;
  }
  if (s?.lidarrCron && s.lidarrCron.trim()) {
    lidarrTask = safeSchedule(
      s.lidarrCron.trim(),
      () => {
        runLidarrPush().catch(() => {});
      },
      'lidarr',
    );
  } else {
    console.log('[scheduler] lidarr disabled');
  }

  // Backups
  if (backupTask) {
    backupTask.stop();
    backupTask = null;
  }
  if (s?.backupEnabled && s.backupCron && s.backupCron.trim()) {
    backupTask = safeSchedule(
      s.backupCron.trim(),
      () => {
        runBackup().catch(() => {});
      },
      'backup',
    );
  } else {
    console.log('[scheduler] backup disabled');
  }
}

/**
 * Безопасный бэкап SQLite:
 *  - пропускает, если есть активный run
 *  - использует VACUUM INTO для атомного снапшота
 *  - ротация по количеству файлов
 */
export async function runBackup() {
  // не делаем бэкап, если есть активные RUN'ы
  const active = await prisma.syncRun.findFirst({ where: { status: 'running' } });
  if (active) {
    console.log('[backup] skipped: active run', active.id);
    return;
  }

  const s = await prisma.setting.findFirst({ where: { id: 1 } });
  const dir = s?.backupDir || '/app/data/backups';
  await fs.promises.mkdir(dir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const dst = path.join(dir, `app-${ts}.db`);
  const sqlPath = dst.replace(/'/g, "''"); // экранируем кавычки в SQL строке

  try {
    // поведение БД под бэкап
    await prisma.$executeRawUnsafe('PRAGMA busy_timeout=30000');

    // атомный снапшот в dst
    await prisma.$executeRawUnsafe(`VACUUM INTO '${sqlPath}'`);

    console.log('[backup] written', dst);
    const runId = await ensureRunId();
    await dblog(runId, 'info', 'Backup created', { file: dst });

    // ротация
    const keep = Math.max(1, s?.backupRetention ?? 14);
    const files = (await fs.promises.readdir(dir))
      .filter((f) => f.startsWith('app-') && f.endsWith('.db'))
      .sort()
      .reverse();
    const toDelete = files.slice(keep);
    for (const f of toDelete) {
      await fs.promises.unlink(path.join(dir, f)).catch(() => {});
    }
  } catch (e: any) {
    console.warn('[backup] failed:', e?.message || e);
  }
}

/** Вспомогательный runId для логов бэкапа */
async function ensureRunId(): Promise<number> {
  const last = await prisma.syncRun.findFirst({ orderBy: { startedAt: 'desc' } });
  if (last) return last.id;
  const r = await prisma.syncRun.create({
    data: { kind: 'export', status: 'ok', message: 'system' },
  });
  return r.id;
}

/** Вызывать на старте сервера */
export async function initScheduler() {
  await rescheduleAll();
}
