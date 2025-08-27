jest.mock('../src/prisma', () => require('../__mocks__/prisma'));
jest.mock('../src/workers.ts', () => require('../__mocks__/src/workers.ts'));

import request from 'supertest';
import { makeApp } from '../__mocks__/helpers';
import syncRouter from '../src/routes/sync';
import { prisma } from '../__mocks__/prisma';

describe('sync routes', () => {
  beforeEach(() => {
    (prisma.syncRun.create as any).mockResolvedValue({ id: 100, status: 'running' });
    (prisma.syncRun.findUnique as any).mockResolvedValue({ id: 100, status: 'running', stats: '{}' });
    (prisma.syncRun.update as any).mockResolvedValue({});
  });

  it('POST /yandex/pull starts run', async () => {
    const app = makeApp('/api/sync', syncRouter);
    const res = await request(app).post('/api/sync/yandex/pull').send({});
    expect(res.status).toBe(200);
    expect(res.body.started).toBe(true);
  });

  it('POST /lidarr/pull starts run with target', async () => {
    const app = makeApp('/api/sync', syncRouter);
    const res = await request(app).post('/api/sync/lidarr/pull').send({ target: 'artists' });
    expect(res.status).toBe(200);
    expect(res.body.target).toBe('artists');
  });

  it('POST /match starts match run', async () => {
    const app = makeApp('/api/sync', syncRouter);
    const res = await request(app).post('/api/sync/match').send({ target: 'both', force: true });
    expect(res.status).toBe(200);
  });

  it('POST /lidarr triggers push', async () => {
    const app = makeApp('/api/sync', syncRouter);
    const res = await request(app).post('/api/sync/lidarr').send({ target: 'albums', source: 'custom' });
    expect(res.status).toBe(200);
    expect(res.body.started).toBe(true);
  });

  it('POST /runs/:id/stop cancels', async () => {
    const app = makeApp('/api/sync', syncRouter);
    const res = await request(app).post('/api/sync/runs/100/stop');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST /custom/match starts custom match all', async () => {
    const app = makeApp('/api/sync', syncRouter);
    const res = await request(app).post('/api/sync/custom/match');
    expect(res.status).toBe(200);
    expect(res.body.started).toBe(true);
  });
});
