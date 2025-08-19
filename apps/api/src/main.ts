import cors from 'cors';
import express from 'express';
import morgan from 'morgan';

import { initPrismaPragmas } from './prisma';
import backupRouter from './routes/backup';
import exportRouter from './routes/export';
import foundRouter from './routes/found';
import healthRouter from './routes/health';
import runsRouter from './routes/runs';
import settingsRouter from './routes/settings';
import statsRouter from './routes/stats';
import syncRouter from './routes/sync';
import unmatchedRouter from './routes/unmatched';
import { initScheduler } from './scheduler';
import lidarrArtists from './routes/lidarr-artists';
import yandexRouter from './routes/yandex';

const app = express();
const PORT = process.env.PORT_API ? Number(process.env.PORT_API) : 4000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('combined'));

app.use('/health', healthRouter);

app.use('/api/settings', settingsRouter);
app.use('/api/sync', syncRouter);
app.use('/api/export', exportRouter);
app.use('/api/found', foundRouter);
app.use('/api/unmatched', unmatchedRouter);
app.use('/api/stats', statsRouter);
app.use(runsRouter);
app.use('/api/backup', backupRouter);
app.use('/api/lidarr', lidarrArtists);
app.use('/api/yandex', yandexRouter);

app.listen(PORT, async () => {
  console.log(`[api] listening on ${PORT}`);
  await initPrismaPragmas();
  await initScheduler();
});
