jest.mock('../src/prisma', () => require('../__mocks__/prisma'));

import request from 'supertest';
import { prisma } from '../__mocks__/prisma';
import { makeApp } from '../__mocks__/helpers';
import statsRouter from '../src/routes/stats';
import {withServer} from "../__mocks__/helpers";

describe('stats route', () => {
  beforeEach(() => {
    (prisma.yandexArtist.findMany as any).mockResolvedValue([
      { id: 1, name: 'A', present: true, mbid: 'x', createdAt: new Date() },
    ]);
    (prisma.yandexAlbum.findMany as any).mockResolvedValue([
      { id: 2, title: 'T', present: true, rgMbid: 'rg', createdAt: new Date() },
    ]);
    (prisma.lidarrArtist.findMany as any).mockResolvedValue([
      { id: 3, name: 'L', removed: false, mbid: 'm', createdAt: new Date() },
    ]);
    (prisma.lidarrAlbum.findMany as any).mockResolvedValue([
      { id: 4, title: 'LA', removed: false, mbid: 'm', createdAt: new Date() },
    ]);
    (prisma.customArtist.findMany as any).mockResolvedValue([
      { id: 5, name: 'C', mbid: 'm', createdAt: new Date() },
    ]);
    (prisma.syncRun.findMany as any).mockResolvedValue([
      { id: 10, kind: 'yandex', status: 'ok', message: null, startedAt: new Date(), finishedAt: new Date(), stats: JSON.stringify({}) },
    ]);
    (prisma.syncRun.findFirst as any).mockResolvedValue(
        { id: 11, kind: 'yandex', status: 'ok', startedAt: new Date(), finishedAt: new Date(), stats: JSON.stringify({}) }
    );

    // сырые запросы (если есть агрегации/гистограммы)
    (prisma.$queryRawUnsafe as any).mockResolvedValue([]);
    (prisma.$executeRawUnsafe as any).mockResolvedValue(0);
    (prisma.yandexArtist.count as any).mockResolvedValue(1);
    (prisma.yandexAlbum.count  as any).mockResolvedValue(1);
    (prisma.lidarrArtist.count as any).mockResolvedValue(1);
    (prisma.lidarrAlbum.count  as any).mockResolvedValue(1);
    (prisma.customArtist.count as any).mockResolvedValue(1);
    (prisma.setting.findFirst as any).mockResolvedValue({ id: 1 });
  });

  it('GET / returns aggregated stats', async () => {
    await withServer(makeApp('/api/stats', statsRouter), async (server, req) => {
      const res = await req(server).get('/api/stats/');
      if (res.status !== 200) {
        // eslint-disable-next-line no-console
        console.error('FAIL /stats:', res.status, res.text || res.body);
      }
      expect(res.status).toBe(200);
      expect(res.body.yandex.artists.total).toBeGreaterThanOrEqual(0);
      expect(res.body.runs).toBeDefined();
    });
  });
});
