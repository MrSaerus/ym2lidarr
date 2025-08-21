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

const app = express();
const PORT = process.env.PORT_API ? Number(process.env.PORT_API) : 4000;

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

// Runs/logs router (supports /runs and /api/runs internally)
app.use(runsRouter);

app.listen(PORT, async () => {
  console.log(`[api] listening on ${PORT}`);

  try {
    await initPrismaPragmas();
  } catch (e) {
    console.error('[api] initPrismaPragmas failed:', e);
  }

  try {
    await initScheduler();
  } catch (e) {
    console.error('[api] initScheduler failed:', e);
  }
});
