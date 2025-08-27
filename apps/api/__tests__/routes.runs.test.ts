jest.mock('../src/prisma', () => require('../__mocks__/prisma'));
import request from 'supertest';
import { prisma } from '../__mocks__/prisma';
import runsRouter from '../src/routes/runs';
import express from 'express';

const app = express();
app.use(express.json());
app.use('/', runsRouter); // supports both /runs and /api/runs

describe('runs router', () => {
  beforeEach(() => {
    (prisma.syncRun.findMany as any).mockResolvedValue([{ id: 2, status: 'ok', startedAt: new Date(), finishedAt: new Date(), message: null }]);
    (prisma.syncRun.findFirst as any).mockResolvedValue({ id: 3, status: 'ok', startedAt: new Date(), finishedAt: new Date(), message: null });
    (prisma.syncRun.findUnique as any).mockImplementation(({ where: { id } }: any) => Promise.resolve({ id, status: 'running', stats: JSON.stringify({ foo: 'bar' }) }));
    (prisma.syncLog.findMany as any).mockResolvedValue([{ id: 1, ts: new Date(), level: 'info', message: 'm', data: '{"a":1}', runId: 1 }]);
    (prisma.syncRun.update as any).mockResolvedValue({});
  });

  it('GET /runs returns list', async () => {
    const res = await request(app).get('/runs?limit=5');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(prisma.syncRun.findMany).toHaveBeenCalled();
  });

  it('GET /api/runs/latest returns ok:true with run', async () => {
    const res = await request(app).get('/api/runs/latest');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('GET /runs/:id/logs supports after & limit', async () => {
    const res = await request(app).get('/runs/1/logs?after=0&limit=10');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.items[0].data).toEqual({ a: 1 });
  });

  it('POST /runs/:id/stop sets cancel flag', async () => {
    const res = await request(app).post('/runs/42/stop');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(prisma.syncRun.update).toHaveBeenCalled();
  });
});
