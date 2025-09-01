// apps/api/src/main.ts
import cors from 'cors';
import express from 'express';
import morgan from 'morgan';

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

import { prisma } from './prisma';
import { instanceId } from './instance';

const app = express();
const PORT = process.env.PORT_API ? Number(process.env.PORT_API) : 4000;

// сколько времени считаем «живым» heartbeat (мс)
const STALE_RUN_MS = Number(process.env.STALE_RUN_MS || 5 * 60 * 1000); // 5 минут

async function recoverStaleRuns() {
  const running = await prisma.syncRun.findMany({ where: { status: 'running' } });
  const now = Date.now();
  let fixed = 0;

  for (const r of running) {
    let stats: any = {};
    try { stats = r.stats ? JSON.parse(r.stats) : {}; } catch {}
    const hbMs = stats?.heartbeatAt ? Date.parse(stats.heartbeatAt) : 0;
    const sameInstance = stats?.instanceId === instanceId;

    // если это не наш instance (значит процесс перезапускался),
    // или heartbeat сильно старый — помечаем как error
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
  if (fixed) {
    console.log(`[recover] marked ${fixed} orphaned run(s) as error`);
  }
}

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('combined'));

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

// Runs/logs router (supports /runs and /api/runs internally)
app.use(runsRouter);

app.listen(PORT, async () => {
  console.log(`[api] listening on ${PORT}`);

  try {
    await initPrismaPragmas();
  } catch (e) {
    console.error('[api] initPrismaPragmas failed:', e);
  }

  // 🔧 починить «висящие» запуски после рестарта контейнера
  try {
    await recoverStaleRuns();
  } catch (e) {
    console.error('[api] recoverStaleRuns failed:', e);
  }

  try {
    await initScheduler();
  } catch (e) {
    console.error('[api] initScheduler failed:', e);
  }

  // (необязательно) периодический вотчер раз в минуту
  setInterval(() => recoverStaleRuns().catch(() => {}), 60_000);
});
