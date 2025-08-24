// apps/api/src/scheduler.ts
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import * as cronParser from 'cron-parser';

import { prisma } from './prisma';
import {
  runCustomMatchAll,
  runCustomPushAll,
  runYandexPullAll,
  runYandexMatch,
  runYandexPush,
  runLidarrPullEx,
} from './workers';

/* ====================== CRON-PARSER SAFE NEXT ====================== */

function nextFromCron(expr: string, opts?: any): Date | null {
  try {
    // v4: parseExpression; v5: CronExpression.parse
    if (typeof (cronParser as any).parseExpression === 'function') {
      const it = (cronParser as any).parseExpression(expr, opts);
      const n = it.next();
      if (n?.toDate) return n.toDate();
      if (n instanceof Date) return n;
      return null;
    }
    const CE = (cronParser as any).CronExpression;
    if (CE && typeof CE.parse === 'function') {
      const it = CE.parse(expr, opts);
      const n = it.next();
      if (n?.toDate) return n.toDate();
      if (n instanceof Date) return n;
      return null;
    }
    console.warn('[scheduler] safeNext: cron-parser API not found; keys=', Object.keys(cronParser));
    return null;
  } catch (e) {
    // не шумим на каждую секунду — короткий лог и null
    return null;
  }
}

/* ====================== JOBS REGISTRY ====================== */

let jobs: {
  customMatch?: cron.ScheduledTask;
  customPush?: cron.ScheduledTask;

  yandexPull?: cron.ScheduledTask;
  yandexMatch?: cron.ScheduledTask;
  yandexPush?: cron.ScheduledTask;

  lidarrPull?: cron.ScheduledTask;

  backup?: cron.ScheduledTask;
} = {};

// Памятка: какие jobKeys сейчас запущены ИМЕННО кроном (для UI "State")
type JobKey =
    | 'yandexPull'
    | 'yandexMatch'
    | 'yandexPush'
    | 'lidarrPull'
    | 'customMatch'
    | 'customPush'
    | 'backup';

const cronActivity: Partial<Record<JobKey, boolean>> = {};

/* ====================== BACKUP HELPERS (как было) ====================== */

function ts() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
      d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' +
      pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds())
  );
}

export async function runBackupNow(): Promise<{ ok: boolean; file?: string; deleted?: string[]; error?: string; }> {
  try {
    const s = await prisma.setting.findFirst();
    if (!s || !s.backupEnabled) return { ok: false, error: 'Backups are disabled in settings.' };

    const backupDir = s.backupDir || '/app/data/backups';
    const retention = s.backupRetention ?? 0;

    fs.mkdirSync(backupDir, { recursive: true });
    try {
      const probe = path.join(backupDir, '.write-test');
      fs.writeFileSync(probe, 'ok'); fs.unlinkSync(probe);
    } catch (e) {
      const msg = (e as Error).message || String(e);
      return { ok: false, error: `Backup dir not writable: ${backupDir}. ${msg}` };
    }

    try { await prisma.$queryRawUnsafe(`PRAGMA wal_checkpoint(TRUNCATE);`); } catch {}

    const fname = `backup_${ts()}.db`;
    const full = path.resolve(backupDir, fname);
    await prisma.$executeRawUnsafe(`VACUUM INTO '${full.replace(/'/g, "''")}';`);

    const deleted: string[] = [];
    if (retention && retention > 0) {
      const entries = fs.readdirSync(backupDir)
          .filter((f) => /^backup_\d{8}_\d{6}\.db$/i.test(f))
          .map((f) => ({ f, m: fs.statSync(path.join(backupDir, f)).mtimeMs }))
          .sort((a, b) => b.m - a.m);
      for (const x of entries.slice(retention)) {
        try { fs.unlinkSync(path.join(backupDir, x.f)); deleted.push(x.f); } catch {}
      }
    }

    return { ok: true, file: fname, deleted };
  } catch (e) {
    return { ok: false, error: (e as Error).message || String(e) };
  }
}

export function listBackups(dir: string): { file: string; size: number; mtime: number }[] {
  try {
    if (!fs.existsSync(dir)) return [];
    const out: { file: string; size: number; mtime: number }[] = [];
    for (const f of fs.readdirSync(dir)) {
      if (!/^backup_\d{8}_\d{6}\.db$/i.test(f)) continue;
      const st = fs.statSync(path.join(dir, f));
      out.push({ file: f, size: st.size, mtime: st.mtimeMs });
    }
    out.sort((a, b) => b.mtime - a.mtime);
    return out;
  } catch { return []; }
}

/* ====================== COMMON ====================== */

export async function initScheduler() { await reloadJobs(); }

/** true, если есть активный ран, kind начинается с любого из префиксов */
async function hasActiveRunWithPrefixes(prefixes: string[]): Promise<boolean> {
  if (!prefixes.length) return false;
  const or = prefixes.map((p) => ({ kind: { startsWith: p } as any }));
  const r = await prisma.syncRun.findFirst({ where: { status: 'running', OR: or }, orderBy: { startedAt: 'desc' } });
  return !!r;
}

/** Проверка «занятости» с учётом памяти (крон уже стартанул, но ран ещё не создался) */
async function isBusyNow(prefixes: string[], relatedJobKeys: JobKey[]): Promise<boolean> {
  const dbBusy = await hasActiveRunWithPrefixes(prefixes);
  const cronBusy = relatedJobKeys.some((k) => !!cronActivity[k]);
  return dbBusy || cronBusy;
}

/* ====================== RELOAD JOBS ====================== */

export async function reloadJobs() {
  // стоп старые
  for (const k of Object.keys(jobs) as (keyof typeof jobs)[]) {
    try { jobs[k]?.stop(); } catch {}
    jobs[k] = undefined;
  }

  const s = await prisma.setting.findFirst();
  if (!s) { console.log('[scheduler] no settings'); return; }

  /* ---------- CUSTOM: match all ---------- */
  if (s.enableCronCustomMatch && s.cronCustomMatch && cron.validate(s.cronCustomMatch)) {
    jobs.customMatch = cron.schedule(s.cronCustomMatch, async () => {
      if (await hasActiveRunWithPrefixes(['custom.'])) { console.log('[cron] custom.match: skip (busy)'); return; }
      cronActivity.customMatch = true;
      try {
        console.log('[cron] custom.match.start');
        await runCustomMatchAll();
      } catch (e) {
        console.error('[cron] custom.match.failed:', (e as Error).message);
      } finally {
        cronActivity.customMatch = false;
      }
    });
  }

  /* ---------- CUSTOM: push all ---------- */
  if (s.enableCronCustomPush && s.cronCustomPush && cron.validate(s.cronCustomPush)) {
    jobs.customPush = cron.schedule(s.cronCustomPush, async () => {
      if (await hasActiveRunWithPrefixes(['custom.'])) { console.log('[cron] custom.push: skip (busy)'); return; }
      cronActivity.customPush = true;
      try {
        console.log('[cron] custom.push.start');
        await runCustomPushAll();
      } catch (e) {
        console.error('[cron] custom.push.failed:', (e as Error).message);
      } finally {
        cronActivity.customPush = false;
      }
    });
  }

  /* ---------- YANDEX: pull all ---------- */
  if ( s.enableCronYandexPull && s.cronYandexPull && cron.validate(s.cronYandexPull) ) {
    jobs.yandexPull = cron.schedule(s.cronYandexPull, async () => {
      if (await hasActiveRunWithPrefixes(['yandex.'])) { console.log('[cron] yandex.pull: skip (busy)'); return; }
      cronActivity.yandexPull = true;
      try {
        console.log('[cron] yandex.pull.start');
        await runYandexPullAll();
      } catch (e) {
        console.error('[cron] yandex.pull.failed:', (e as Error).message);
      } finally {
        cronActivity.yandexPull = false;
      }
    });
  }

  /* ---------- YANDEX: match ---------- */
  if ( s.enableCronYandexMatch && s.cronYandexMatch && cron.validate(s.cronYandexMatch) ) {
    const target = (s.yandexMatchTarget as 'artists'|'albums'|'both') || 'both';
    jobs.yandexMatch = cron.schedule(s.cronYandexMatch, async () => {
      if (await hasActiveRunWithPrefixes(['yandex.'])) { console.log('[cron] yandex.match: skip (busy)'); return; }
      cronActivity.yandexMatch = true;
      try {
        console.log('[cron] yandex.match.start', target);
        await runYandexMatch(target, { force: false });
      } catch (e) {
        console.error('[cron] yandex.match.failed:', (e as Error).message);
      } finally {
        cronActivity.yandexMatch = false;
      }
    });
  }

  /* ---------- YANDEX: push ---------- */
  if ( s.enableCronYandexPush && s.cronYandexPush && cron.validate(s.cronYandexPush) ) {
    const target = (s.yandexPushTarget as 'artists'|'albums'|'both') || 'both';
    jobs.yandexPush = cron.schedule(s.cronYandexPush, async () => {
      if (await hasActiveRunWithPrefixes(['yandex.'])) { console.log('[cron] yandex.push: skip (busy)'); return; }
      cronActivity.yandexPush = true;
      try {
        console.log('[cron] yandex.push.start', target);
        await runYandexPush(target);
      } catch (e) {
        console.error('[cron] yandex.push.failed:', (e as Error).message);
      } finally {
        cronActivity.yandexPush = false;
      }
    });
  }

  /* ---------- LIDARR: pull ---------- */
  if ( s.enableCronLidarrPull && s.cronLidarrPull && cron.validate(s.cronLidarrPull) ) {
    const target = (s.lidarrPullTarget as 'artists'|'albums'|'both') || 'both';
    jobs.lidarrPull = cron.schedule(s.cronLidarrPull, async () => {
      if (await hasActiveRunWithPrefixes(['lidarr.pull.'])) { console.log('[cron] lidarr.pull: skip (busy)'); return; }
      cronActivity.lidarrPull = true;
      try {
        console.log('[cron] lidarr.pull.start', target);
        await runLidarrPullEx(target);
      } catch (e) {
        console.error('[cron] lidarr.pull.failed:', (e as Error).message);
      } finally {
        cronActivity.lidarrPull = false;
      }
    });
  }

  /* ---------- BACKUP ---------- */
  if (s.backupEnabled && s.backupCron && cron.validate(s.backupCron)) {
    jobs.backup = cron.schedule(s.backupCron, async () => {
      cronActivity.backup = true;
      try {
        console.log('[cron] backup.run');
        await runBackupNow();
      } catch (e) {
        console.error('[cron] backup.failed:', (e as Error).message);
      } finally {
        cronActivity.backup = false;
      }
    });
  }

  console.log('[scheduler] jobs reloaded');
}

/* ====================== STATUS (для фронта) ====================== */

const JOB_META: Record<JobKey, { title: string; settingCron: string; enabledFlag?: string; prefixes: string[]; }> = {
  yandexPull:  { title: 'Yandex: Pull all',       settingCron: 'cronYandexPull',    enabledFlag: 'enableCronYandexPull',  prefixes: ['yandex.pull.', 'yandex.'] },
  yandexMatch: { title: 'Yandex: Match',          settingCron: 'cronYandexMatch',   enabledFlag: 'enableCronYandexMatch', prefixes: ['yandex.match.', 'yandex.'] },
  yandexPush:  { title: 'Yandex: Push',           settingCron: 'cronYandexPush',    enabledFlag: 'enableCronYandexPush',  prefixes: ['yandex.push.', 'yandex.'] },
  lidarrPull:  { title: 'Lidarr: Pull',           settingCron: 'cronLidarrPull',    enabledFlag: 'enableCronLidarrPull',  prefixes: ['lidarr.pull.'] },
  customMatch: { title: 'Custom: Match MB',       settingCron: 'cronCustomMatch',   enabledFlag: 'enableCronCustomMatch', prefixes: ['custom.match.', 'custom.'] },
  customPush:  { title: 'Custom: Push to Lidarr', settingCron: 'cronCustomPush',    enabledFlag: 'enableCronCustomPush',  prefixes: ['custom.push.', 'custom.'] },
  backup:      { title: 'Backup',                 settingCron: 'backupCron',        enabledFlag: 'backupEnabled',         prefixes: [] },
};

export async function getCronStatuses() {
  const s = await prisma.setting.findFirst();
  const now = new Date();

  const out: Array<{
    key: JobKey;
    title: string;
    enabled: boolean;
    cron?: string | null;
    valid: boolean;
    nextRun?: Date | null;
    running: boolean; // ВАЖНО: теперь это "крон запущен"
  }> = [];

  for (const key of Object.keys(JOB_META) as JobKey[]) {
    const meta = JOB_META[key];
    const cronExpr = (s as any)?.[meta.settingCron] as string | undefined | null;
    const enabled = !!((s as any)?.[meta.enabledFlag as string]);
    const valid = !!cronExpr && cron.validate(cronExpr);
    let nextRun: Date | null = null;

    if (enabled && valid && cronExpr) {
      nextRun = nextFromCron(cronExpr, { currentDate: now });
    }

    // ВАЖНО: показываем running ТОЛЬКО по памяти (то, что запущено кроном)
    const running = !!cronActivity[key];

    out.push({
      key,
      title: meta.title,
      enabled,
      cron: cronExpr || null,
      valid,
      nextRun,
      running,
    });
  }

  return out;
}

/* ====================== ХЕЛПЕР для ручных эндпоинтов ====================== */
/** Зови это из ручных роутов, чтобы отдавать 409, если занято */
export async function ensureNotBusyOrThrow(prefixes: string[], relatedJobKeys: JobKey[]) {
  const busy = await isBusyNow(prefixes, relatedJobKeys);
  if (busy) {
    const p = prefixes.join(', ');
    throw Object.assign(new Error(`Busy: active run for prefixes [${p}]`), { status: 409 });
  }
}
