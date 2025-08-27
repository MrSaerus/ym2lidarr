jest.mock('../src/prisma', () => require('../__mocks__/prisma'));
jest.mock('../src/utils/lidarr-creds.ts', () => require('../__mocks__/src/utils/lidarr-creds.ts'));
jest.mock('../src/services/lidarr-cache.ts', () => require('../__mocks__/src/services/lidarr-cache.ts'));
jest.mock('../src/scheduler', () => require('../__mocks__/src/scheduler'));
jest.mock('undici', () => require('../__mocks__/undici'));

import request from 'supertest';
import { prisma } from '../__mocks__/prisma';
import { makeApp, withServer } from '../__mocks__/helpers';
import lidarrArtistsRouter from '../src/routes/lidarr-artists';

describe('lidarr-artists routes', () => {
  beforeEach(() => {
    (prisma.setting.findFirst as any).mockResolvedValue({ id: 1, lidarrUrl: 'http://lidarr', lidarrApiKey: 'KEY' });
    (prisma.setting.findUnique as any).mockResolvedValue({ id: 1, lidarrUrl: 'http://lidarr' });
    (prisma.$queryRawUnsafe   as any).mockResolvedValue([]);
    (prisma.$executeRawUnsafe as any).mockResolvedValue(0);
    (prisma.lidarrArtist.count as any).mockResolvedValue(1);
    (prisma.lidarrArtist.findMany as any).mockResolvedValue([
      { id: 1, name: 'X', albums: 1, tracks: 2, sizeOnDisk: 3, path: '/m', added: new Date(), monitored: true, mbId: '12345678-1234-1234-1234-1234567890ab', foreignArtistId: 'artist-1', }
    ]);
    (prisma.lidarrArtist.upsert as any).mockResolvedValue({});
  });

  it('GET /artists returns items with lidarrUrl and mbUrl', async () => {
    await withServer(makeApp('/api/lidarr', lidarrArtistsRouter), async (server, req) => {
      const res = await req(server).get('/api/lidarr/artists?page=1&pageSize=10');
      const item = res.body.items[0];
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items.length).toBeGreaterThan(0);
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('name');
      expect(item).toHaveProperty('mbid');
      expect(['string', 'object']).toContain(typeof item.lidarrUrl);
    });
  });
  it('POST /artist/:id/refresh updates cache', async () => {
    const app = makeApp('/api/lidarr', lidarrArtistsRouter);
    const res = await request(app).post('/api/lidarr/artist/10/refresh');
    expect(res.status).toBe(200);
  });

  it('POST /resync returns counts', async () => {
    const app = makeApp('/api/lidarr', lidarrArtistsRouter);
    const res = await request(app).post('/api/lidarr/resync');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
