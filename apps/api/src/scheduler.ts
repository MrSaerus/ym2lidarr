import cron from 'node-cron';
import fs from 'fs';
import path from 'path';

import { prisma } from './prisma';
import {
  runCustomMatchAll,
  runCustomPushAll,
  runYandexPullAll,
  runYandexMatch,
  runYandexPush,
  runLidarrPullEx,
} from './workers';

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

/* ====================== BACKUP HELPERS (без изменений) ====================== */

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

/* ====================== SCHEDULER ====================== */

export async function initScheduler() { await reloadJobs(); }

/** true, если есть активный ран, kind начинается с любого из префиксов */
async function hasActiveRunWithPrefixes(prefixes: string[]): Promise<boolean> {
  const or = prefixes.map((p) => ({ kind: { startsWith: p } as any }));
  const r = await prisma.syncRun.findFirst({ where: { status: 'running', OR: or }, orderBy: { startedAt: 'desc' } });
  return !!r;
}

export async function reloadJobs() {
  // стоп старые
  for (const k of Object.keys(jobs) as (keyof typeof jobs)[]) {
    try { jobs[k]?.stop(); } catch {}
    jobs[k] = undefined;
  }

  const s = await prisma.setting.findFirst();
  if (!s) { console.log('[scheduler] no settings'); return; }

  /* ---------- CUSTOM: match all ---------- */
  if (s.cronCustomMatch && cron.validate(s.cronCustomMatch)) {
    jobs.customMatch = cron.schedule(s.cronCustomMatch, async () => {
      if (await hasActiveRunWithPrefixes(['custom.'])) { console.log('[cron] custom.match: skip (busy)'); return; }
      try {
        console.log('[cron] custom.match.start');
        await runCustomMatchAll(); // kind: custom.match.all
      } catch (e) { console.error('[cron] custom.match.failed:', (e as Error).message); }
    });
  }

  /* ---------- CUSTOM: push all ---------- */
  if (s.cronCustomPush && cron.validate(s.cronCustomPush)) {
    jobs.customPush = cron.schedule(s.cronCustomPush, async () => {
      if (await hasActiveRunWithPrefixes(['custom.'])) { console.log('[cron] custom.push: skip (busy)'); return; }
      try {
        console.log('[cron] custom.push.start');
        await runCustomPushAll(); // kind: custom.push.all
      } catch (e) { console.error('[cron] custom.push.failed:', (e as Error).message); }
    });
  }

  /* ---------- YANDEX: pull all ---------- */
  if ( s.cronYandexPull && cron.validate(s.cronYandexPull) ) {
    jobs.yandexPull = cron.schedule(s.cronYandexPull, async () => {
      if (await hasActiveRunWithPrefixes(['yandex.'])) { console.log('[cron] yandex.pull: skip (busy)'); return; }
      try {
        console.log('[cron] yandex.pull.start');
        await runYandexPullAll(); // kind: yandex.pull.all
      } catch (e) { console.error('[cron] yandex.pull.failed:', (e as Error).message); }
    });
  }

  /* ---------- YANDEX: match (artists|albums|both) ---------- */
  if ( s.cronYandexMatch && cron.validate(s.cronYandexMatch) ) {
    const target = (s.yandexMatchTarget as 'artists'|'albums'|'both') || 'both';
    jobs.yandexMatch = cron.schedule(s.cronYandexMatch, async () => {
      if (await hasActiveRunWithPrefixes(['yandex.'])) { console.log('[cron] yandex.match: skip (busy)'); return; }
      try {
        console.log('[cron] yandex.match.start', target);
        await runYandexMatch(target, { force: false });
      } catch (e) { console.error('[cron] yandex.match.failed:', (e as Error).message); }
    });
  }

  /* ---------- YANDEX: push (artists|albums|both) ---------- */
  if ( s.cronYandexPush && cron.validate(s.cronYandexPush) ) {
    const target = (s.yandexPushTarget as 'artists'|'albums'|'both') || 'both';
    jobs.yandexPush = cron.schedule(s.cronYandexPush, async () => {
      if (await hasActiveRunWithPrefixes(['yandex.'])) { console.log('[cron] yandex.push: skip (busy)'); return; }
      try {
        console.log('[cron] yandex.push.start', target);
        await runYandexPush(target);
      } catch (e) { console.error('[cron] yandex.push.failed:', (e as Error).message); }
    });
  }

  /* ---------- LIDARR: pull (artists|albums|both) ---------- */
  if ( s.cronLidarrPull && cron.validate(s.cronLidarrPull) ) {
    const target = (s.lidarrPullTarget as 'artists'|'albums'|'both') || 'both';
    jobs.lidarrPull = cron.schedule(s.cronLidarrPull, async () => {
      if (await hasActiveRunWithPrefixes(['lidarr.pull.'])) { console.log('[cron] lidarr.pull: skip (busy)'); return; }
      try {
        console.log('[cron] lidarr.pull.start', target);
        await runLidarrPullEx(target);
      } catch (e) { console.error('[cron] lidarr.pull.failed:', (e as Error).message); }
    });
  }

  /* ---------- BACKUP ---------- */
  if (s.backupEnabled && s.backupCron && cron.validate(s.backupCron)) {
    jobs.backup = cron.schedule(s.backupCron, async () => {
      try {
        console.log('[cron] backup.run');
        await runBackupNow();
      } catch (e) { console.error('[cron] backup.failed:', (e as Error).message); }
    });
  }

  console.log('[scheduler] jobs reloaded');
}
