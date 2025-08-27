jest.mock('../src/prisma', () => require('../__mocks__/prisma'));

import request from 'supertest';
import { prisma } from '../__mocks__/prisma';
import { makeApp } from '../__mocks__/helpers';
import unifiedRouter from '../src/routes/unified';

describe('unified routes', () => {
  beforeEach(() => {
    (prisma.setting.findFirst as any).mockResolvedValue({ id: 1, lidarrUrl: 'http://lidarr' });
    (prisma.yandexArtist.findMany as any).mockResolvedValue([{ id: 1, ymId: 11, name: 'YA', mbid: 'mbid-ya' }]);
    (prisma.yandexAlbum.findMany as any).mockResolvedValue([{ id: 2, ymId: 22, artist: 'YA', title: 'YAL', rgMbid: 'rg-1', year: 2020 }]);
    (prisma.lidarrArtist.findMany as any).mockResolvedValue([{ id: 1, name: 'YA', mbid: 'mbid-ya' }]);
    (prisma.lidarrAlbum.findMany as any).mockResolvedValue([{ id: 2, title: 'YAL', artistName: 'YA', mbid: 'mbid-rel', foreignAlbumId: 'rel-1' }]);
  });

  it('GET /artists merges Yandex+Lidarr', async () => {
    const app = makeApp('/api/unified', unifiedRouter);
    const res = await request(app).get('/api/unified/artists?page=1&pageSize=50');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
  });

  it('GET /albums merges Yandex+Lidarr', async () => {
    const app = makeApp('/api/unified', unifiedRouter);
    const res = await request(app).get('/api/unified/albums?page=1&pageSize=50');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
  });
});
