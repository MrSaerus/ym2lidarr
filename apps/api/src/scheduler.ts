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
import { runNavidromeApply } from './workers';
import { createLogger } from './lib/logger';

const log = createLogger({ scope: 'scheduler' });

/* ====================== CRON-PARSER SAFE NEXT ====================== */
/** Универсальный вызов cron-parser для v2…v5 */
function nextFromCron(expr: string, opts?: any): Date | null {
  try {
    const m: any = cronParser;

    // Подбираем доступную функцию парсинга в порядке приоритета
    const parseFn =
      (typeof m?.parseExpression === 'function' && m.parseExpression) ||
      (typeof m?.default?.parseExpression === 'function' && m.default.parseExpression) ||
      (typeof m?.CronExpression?.parse === 'function' && m.CronExpression.parse) ||
      (typeof m?.CronExpressionParser?.parse === 'function' && m.CronExpressionParser.parse) ||
      null;

    if (!parseFn) {
      log.warn('cron-parser API not found', 'cron.safeNext.api.missing', {
        keys: Object.keys(m || {}),
      });
      return null;
    }

    const it = parseFn(expr, opts);
    if (!it || typeof it.next !== 'function') return null;

    const n = it.next();
    if (!n) return null;

    // v2/v3/v5: next() -> CronDate { toDate() }, иногда возвращают сам Date
    if (typeof n.toDate === 'function') return n.toDate();
    if (n instanceof Date) return n;
    if (typeof n.valueOf === 'function') return new Date(n.valueOf());

    return null;
  } catch {
    // тихо возвращаем null (UI сам покажет "—")
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
  navidromePush?: cron.ScheduledTask;
} = {};

// Памятка: какие jobKeys сейчас запущены ИМЕННО кроном (для UI "State")
type JobKey =
  | 'yandexPull'
  | 'yandexMatch'
  | 'yandexPush'
  | 'lidarrPull'
  | 'customMatch'
  | 'customPush'
  | 'backup'
  | 'navidromePush';

const cronActivity: Partial<Record<JobKey, boolean>> = {};

/* ====================== BACKUP HELPERS ====================== */

const blog = log.child({ scope: 'scheduler.backup' });

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

export async function runBackupNow(): Promise<{
  ok: boolean;
  file?: string;
  deleted?: string[];
  error?: string;
}> {
  blog.info('backup run requested', 'cron.backup.request');
  try {
    const s = await prisma.setting.findFirst();
    if (!s || !s.backupEnabled) {
      blog.warn('backup disabled in settings', 'cron.backup.disabled');
      return { ok: false, error: 'Backups are disabled in settings.' };
    }

    const backupDir = s.backupDir || '/app/data/backups';
    const retention = s.backupRetention ?? 0;

    fs.mkdirSync(backupDir, { recursive: true });
    try {
      const probe = path.join(backupDir, '.write-test');
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
    } catch (e) {
      const msg = (e as Error).message || String(e);
      blog.error('backup dir not writable', 'cron.backup.dir.unwritable', {
        backupDir,
        error: msg,
      });
      return { ok: false, error: `Backup dir not writable: ${backupDir}. ${msg}` };
    }

    try {
      await prisma.$queryRawUnsafe(`PRAGMA wal_checkpoint(TRUNCATE);`);
      blog.debug('sqlite wal checkpoint truncate', 'cron.backup.sqlite.checkpoint');
    } catch (e: any) {
      blog.warn('wal checkpoint failed (continuing)', 'cron.backup.sqlite.checkpoint.fail', {
        error: e?.message || String(e),
      });
    }

    const fname = `backup_${ts()}.db`;
    const full = path.resolve(backupDir, fname);
    await prisma.$executeRawUnsafe(`VACUUM INTO '${full.replace(/'/g, "''")}';`);
    blog.info('backup file created', 'cron.backup.ok', { file: fname, dir: backupDir });

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
        } catch {}
      }
      if (deleted.length) {
        blog.info('old backups pruned', 'cron.backup.pruned', {
          kept: retention,
          deleted,
        });
      }
    }

    return { ok: true, file: fname, deleted };
  } catch (e) {
    const msg = (e as Error).message || String(e);
    blog.error('backup failed', 'cron.backup.fail', { error: msg });
    return { ok: false, error: msg };
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
  } catch {
    return [];
  }
}

/* ====================== COMMON ====================== */

export async function initScheduler() {
  log.info('init scheduler', 'cron.init');
  await reloadJobs();
}

/** true, если есть активный ран, kind начинается с любого из префиксов */
async function hasActiveRunWithPrefixes(prefixes: string[]): Promise<boolean> {
  if (!prefixes.length) return false;
  const or = prefixes.map((p) => ({ kind: { startsWith: p } as any }));
  const r = await prisma.syncRun.findFirst({
    where: { status: 'running', OR: or },
    orderBy: { startedAt: 'desc' },
  });
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
  log.info('reload scheduler jobs start', 'cron.reload.start');

  // стоп старые
  for (const k of Object.keys(jobs) as (keyof typeof jobs)[]) {
    try {
      jobs[k]?.stop();
    } catch {}
    jobs[k] = undefined;
  }

  const s = await prisma.setting.findFirst();
  if (!s) {
    log.warn('no settings, jobs not scheduled', 'cron.reload.no_settings');
    return;
  }

  /* helper: обёртки запуска для единообразного логирования */
  const wrap =
    <T extends JobKey>(
      key: T,
      prefixes: string[],
      runner: (...args: any[]) => Promise<any>,
      startPayload?: Record<string, unknown>,
    ) =>
      async () => {
        if (await hasActiveRunWithPrefixes(prefixes)) {
          log.info('job skipped (busy)', 'cron.job.skip.busy', { key, prefixes });
          return;
        }
        cronActivity[key] = true;
        try {
          log.info('job start', 'cron.job.start', { key, ...(startPayload || {}) });
          await runner();
          log.info('job end', 'cron.job.end', { key });
        } catch (e: any) {
          log.error('job failed', 'cron.job.fail', { key, error: e?.message || String(e) });
        } finally {
          cronActivity[key] = false;
        }
      };

  /* ---------- CUSTOM: match all ---------- */
  if (s.enableCronCustomMatch && s.cronCustomMatch && cron.validate(s.cronCustomMatch)) {
    jobs.customMatch = cron.schedule(s.cronCustomMatch, wrap('customMatch', ['custom.'], runCustomMatchAll));
    log.debug('scheduled custom.match', 'cron.plan', { key: 'customMatch', cron: s.cronCustomMatch });
  }

  /* ---------- CUSTOM: push all ---------- */
  if (s.enableCronCustomPush && s.cronCustomPush && cron.validate(s.cronCustomPush)) {
    jobs.customPush = cron.schedule(s.cronCustomPush, wrap('customPush', ['custom.'], runCustomPushAll));
    log.debug('scheduled custom.push', 'cron.plan', { key: 'customPush', cron: s.cronCustomPush });
  }

  /* ---------- YANDEX: pull all ---------- */
  if (s.enableCronYandexPull && s.cronYandexPull && cron.validate(s.cronYandexPull)) {
    jobs.yandexPull = cron.schedule(s.cronYandexPull, wrap('yandexPull', ['yandex.'], runYandexPullAll));
    log.debug('scheduled yandex.pull', 'cron.plan', { key: 'yandexPull', cron: s.cronYandexPull });
  }

  /* ---------- YANDEX: match ---------- */
  if (s.enableCronYandexMatch && s.cronYandexMatch && cron.validate(s.cronYandexMatch)) {
    const target = (s.yandexMatchTarget as 'artists' | 'albums' | 'both') || 'both';
    jobs.yandexMatch = cron.schedule(
      s.cronYandexMatch,
      wrap('yandexMatch', ['yandex.'], () => runYandexMatch(target, { force: false }), { target }),
    );
    log.debug('scheduled yandex.match', 'cron.plan', { key: 'yandexMatch', cron: s.cronYandexMatch, target });
  }

  /* ---------- YANDEX: push ---------- */
  if (s.enableCronYandexPush && s.cronYandexPush && cron.validate(s.cronYandexPush)) {
    const target = (s.yandexPushTarget as 'artists' | 'albums' | 'both') || 'both';
    jobs.yandexPush = cron.schedule(
      s.cronYandexPush,
      wrap('yandexPush', ['yandex.'], () => runYandexPush(target), { target }),
    );
    log.debug('scheduled yandex.push', 'cron.plan', { key: 'yandexPush', cron: s.cronYandexPush, target });
  }

  /* ---------- LIDARR: pull ---------- */
  if (s.enableCronLidarrPull && s.cronLidarrPull && cron.validate(s.cronLidarrPull)) {
    const target = (s.lidarrPullTarget as 'artists' | 'albums' | 'both') || 'both';
    jobs.lidarrPull = cron.schedule(
      s.cronLidarrPull,
      wrap('lidarrPull', ['lidarr.pull.'], () => runLidarrPullEx(target), { target }),
    );
    log.debug('scheduled lidarr.pull', 'cron.plan', { key: 'lidarrPull', cron: s.cronLidarrPull, target });
  }

  /* ---------- BACKUP ---------- */
  if (s.backupEnabled && s.backupCron && cron.validate(s.backupCron)) {
    jobs.backup = cron.schedule(s.backupCron, wrap('backup', [], runBackupNow));
    log.debug('scheduled backup', 'cron.plan', { key: 'backup', cron: s.backupCron });
  }

// ========== NAVIDROME PUSH ==========
// управляется полями: enableCronNavidromePush + cronNavidromePush
  if (s?.enableCronNavidromePush && s?.cronNavidromePush) {
    const expr = String(s.cronNavidromePush);
    if (cron.validate(expr)) {
      jobs.navidromePush = cron.schedule(expr, async () => {
        cronActivity.navidromePush = true;
        const lg = log.child({ scope: 'scheduler.navidromePush' });
        try {
          // читаем текущие настройки для аутентификации и таргета/политики
          const st = await prisma.setting.findFirst();
          const navUrl  = (st?.navidromeUrl || '').replace(/\/+$/, '');
          const user    = st?.navidromeUser || '';
          const pass    = st?.navidromePass || '';
          const token   = st?.navidromeToken || '';
          const salt    = st?.navidromeSalt || '';
          const target  = (st?.navidromeSyncTarget as any) || 'tracks';
          const policy  = (st?.likesPolicySourcePriority as any) || 'yandex';
          if (!navUrl || !user || (!pass && !(token && salt))) {
            lg.warn('navidrome not configured, skip', 'cron.nav.push.skip.misconfig');
          } else {
            // сам воркер стартует run и ведёт логи (reuseRunId не нужен)
            // dryRun=false — реальный пуш лайков
            const auth = pass ? { user, pass } : { user, token, salt };
            await runNavidromeApply({
              navUrl,
              auth,
              target,
              policy,
              dryRun: false,
            });
            lg.info('navidrome push tick done', 'cron.nav.push.done', { target, policy });
          }
        } catch (e: any) {
          log.error('navidrome push tick failed', 'cron.nav.push.fail', { err: e?.message });
        } finally {
          cronActivity.navidromePush = false;
        }
      });
      jobs.navidromePush.start();
    } else {
      log.warn('invalid cron for navidromePush', 'cron.nav.push.invalid', { expr: expr });
    }
  }
  log.info('jobs reloaded', 'cron.reload.done');
}

/* ====================== STATUS (для фронта) ====================== */

const JOB_META: Record<
  JobKey,
  { title: string; settingCron: string; enabledFlag?: string; prefixes: string[] }
> = {
  yandexPull: {
    title: 'Yandex: Pull all',
    settingCron: 'cronYandexPull',
    enabledFlag: 'enableCronYandexPull',
    prefixes: ['yandex.pull.', 'yandex.'],
  },
  yandexMatch: {
    title: 'Yandex: Match',
    settingCron: 'cronYandexMatch',
    enabledFlag: 'enableCronYandexMatch',
    prefixes: ['yandex.match.', 'yandex.'],
  },
  yandexPush: {
    title: 'Yandex: Push',
    settingCron: 'cronYandexPush',
    enabledFlag: 'enableCronYandexPush',
    prefixes: ['yandex.push.', 'yandex.'],
  },
  lidarrPull: {
    title: 'Lidarr: Pull',
    settingCron: 'cronLidarrPull',
    enabledFlag: 'enableCronLidarrPull',
    prefixes: ['lidarr.pull.'],
  },
  customMatch: {
    title: 'Custom: Match MB',
    settingCron: 'cronCustomMatch',
    enabledFlag: 'enableCronCustomMatch',
    prefixes: ['custom.match.', 'custom.'],
  },
  customPush: {
    title: 'Custom: Push to Lidarr',
    settingCron: 'cronCustomPush',
    enabledFlag: 'enableCronCustomPush',
    prefixes: ['custom.push.', 'custom.'],
  },
  backup: { title: 'Backup', settingCron: 'backupCron', enabledFlag: 'backupEnabled', prefixes: [] },
  navidromePush: {
    title: 'Navidrome: Push likes',
    settingCron: 'cronNavidromePush',
    enabledFlag: 'enableCronNavidromePush',
    prefixes: ['nav.apply.', 'navidrome.'],
  },
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
    running: boolean; // показываем только «крон сейчас выполняет»
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
    log.warn('busy: active run exists', 'cron.ensure.busy', { prefixes: p, relatedJobKeys });
    throw Object.assign(new Error(`Busy: active run for prefixes [${p}]`), { status: 409 });
  }
}
