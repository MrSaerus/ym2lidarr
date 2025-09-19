// apps/api/src/main.ts
import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

import { initPrismaPragmas } from './prisma';
import backupRouter from './routes/backup';
import exportRouter from './routes/export';
import healthRouter from './routes/health';
import runsRouter from './routes/runs';
import settingsRouter from './routes/settings';
import statsRouter from './routes/stats';
import syncRouter from './routes/sync';
import { initScheduler } from './scheduler';
import lidarrArtists from './routes/lidarr-artists';
import lidarrAlbumsRouter from './routes/lidarr-albums';
import yandexRouter from './routes/yandex';
import unifiedRouter from './routes/unified';
import customArtistsRoute from './routes/custom-artists';
import lidarrWebhook from './routes/webhooks.lidarr';
import qbtDebug from './routes/debug.qbt';
import { requestLogger, errorHandler } from './middleware/logging';
import { createLogger } from './lib/logger';
import { prisma } from './prisma';
import { instanceId } from './instance';
import { navidromeRouter } from './routes/navidrome'
import jackettIndexers from './routes/jackett';

const app = express();
app.use(requestLogger);
const PORT = process.env.PORT_API ? Number(process.env.PORT_API) : 4000;

// сколько времени считаем «живым» heartbeat (мс)
const STALE_RUN_MS = Number(process.env.STALE_RUN_MS || 5 * 60 * 1000); // 5 минут

// локальный логгер со скоупом
const log = createLogger({ scope: 'api.main', ctx: { instanceId, portApi: PORT, staleRunMs: STALE_RUN_MS } });

/* -----------------------------------------------------------
 * Build / Runtime Metadata (для первого старта)
 * --------------------------------------------------------- */
function safePkgVersion(): string | null {
  try {
    // __dirname -> apps/api/dist/src при сборке; поднимемся к корню пакета apps/api
    const pkgPathCandidates = [
      path.resolve(__dirname, '../../package.json'), // когда dist лежит в apps/api/dist
      path.resolve(process.cwd(), 'package.json'),   // fallback на текущую CWD
    ];
    for (const p of pkgPathCandidates) {
      if (fs.existsSync(p)) {
        const txt = fs.readFileSync(p, 'utf8');
        const json = JSON.parse(txt);
        if (json?.version) return String(json.version);
      }
    }
  } catch {}
  return null;
}

function getStartupMeta() {
  const pkgVersion = safePkgVersion();

  // Передаём только «безопасные» переменные окружения (ничего чувствительного)
  const envSnapshot = {
    NODE_ENV: process.env.NODE_ENV || 'development',
    LOG_LEVEL: process.env.LOG_LEVEL || undefined,
    LOG_TO_FILES: process.env.LOG_TO_FILES || undefined,
    LOG_DIR: process.env.LOG_DIR || undefined,
    PORT_API: process.env.PORT_API || undefined,
    PORT: process.env.PORT || undefined,
    STALE_RUN_MS: process.env.STALE_RUN_MS || undefined,
  };

  // Возможные CI-переменные, если заданы при сборке/запуске
  const build = {
    version: pkgVersion || process.env.BUILD_VERSION || null,
    commit: process.env.GIT_COMMIT || process.env.COMMIT_SHA || null,
    buildTime: process.env.BUILD_TIME || null,
    image: process.env.IMAGE_TAG || null,
  };

  // Платформа и рантайм
  const runtime = {
    node: process.version,
    pid: process.pid,
    platform: process.platform,
    arch: process.arch,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };

  return { instanceId, build, env: envSnapshot, runtime };
}

async function recoverStaleRuns() {
  const startedAt = Date.now();
  try {
    log.info('recover stale runs start', 'api.recover.start');
    const running = await prisma.syncRun.findMany({ where: { status: 'running' } });
    const now = Date.now();
    let fixed = 0;

    for (const r of running) {
      let stats: any = {};
      try { stats = r.stats ? JSON.parse(r.stats) : {}; } catch (e: any) {
        log.warn('parse stats failed during recover', 'api.recover.parse', { runId: r.id, err: e?.message || String(e) });
      }
      const hbMs = stats?.heartbeatAt ? Date.parse(stats.heartbeatAt) : 0;
      const sameInstance = stats?.instanceId === instanceId;

      if (!sameInstance || !hbMs || (now - hbMs) > STALE_RUN_MS) {
        await prisma.syncRun.update({
          where: { id: r.id },
          data: {
            status: 'error',
            message: 'Orphaned (server restarted or worker died)',
            finishedAt: new Date(),
          },
        });
        fixed++;
      }
    }
    const durMs = Date.now() - startedAt;
    if (fixed) {
      log.warn('orphaned runs marked as error', 'api.recover.fixed', { fixed, durMs });
    } else {
      log.info('no orphaned runs found', 'api.recover.none', { durMs });
    }
  } catch (e: any) {
    log.error('recoverStaleRuns failed', 'api.recover.fail', { err: e?.message || String(e) });
    throw e;
  }
}

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// health both with and without /api
app.use(['/health', '/api/health'], healthRouter);

// API routes
app.use('/api/settings', settingsRouter);
app.use('/api/sync', syncRouter);
app.use('/api/export', exportRouter);
app.use('/api/stats', statsRouter);
app.use('/api/backup', backupRouter);
app.use('/api/lidarr', lidarrArtists);
app.use('/api/lidarr', lidarrAlbumsRouter);
app.use('/api/yandex', yandexRouter);
app.use('/api/unified', unifiedRouter);
app.use('/api/custom-artists', customArtistsRoute);
app.use('/api/webhooks', lidarrWebhook);
app.use('/api/debug', qbtDebug);
app.use('/api/navidrome', navidromeRouter);
app.use('/api/jackett/indexers', jackettIndexers)

// Runs/logs router (supports /runs and /api/runs internally)
app.use(runsRouter);

app.listen(PORT, async () => {
  // 🔎 первый «паспортный» лог: сборка/окружение/рантайм
  log.info('API startup', 'api.startup', getStartupMeta());

  try {
    await initPrismaPragmas();
    log.info('initPrismaPragmas ok', 'api.prisma.pragmas.ok');
  } catch (e: any) {
    log.error('initPrismaPragmas failed', 'api.prisma.pragmas.fail', { err: e?.message || String(e) });
  }

  try {
    await recoverStaleRuns();
    log.info('initial recover done', 'api.recover.initial.ok');
  } catch (e: any) {
    log.error('initial recover failed', 'api.recover.initial.fail', { err: e?.message || String(e) });
  }

  try {
    await initScheduler();
    log.info('scheduler initialized', 'api.scheduler.ok');
  } catch (e: any) {
    log.error('initScheduler failed', 'api.scheduler.fail', { err: e?.message || String(e) });
  }

  setInterval(() => recoverStaleRuns().catch((e: any) => {
    log.error('recoverStaleRuns periodic failed', 'api.recover.tick.fail', { err: e?.message || String(e) });
  }), 60_000);

  log.info('API primary listener up', 'api.listen.primary', { port: PORT });
});

app.use(errorHandler);
//
// const port = Number(process.env.PORT || 3001);
// app.listen(port, () => rootLog.info(`API listening on ${port}`, 'api.start'));
