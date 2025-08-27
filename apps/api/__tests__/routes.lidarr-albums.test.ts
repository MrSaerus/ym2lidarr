jest.mock('../src/prisma', () => require('../__mocks__/prisma'));
jest.mock('../src/utils/lidarr-creds.ts', () => require('../__mocks__/src/utils/lidarr-creds.ts'));
jest.mock('../src/scheduler', () => require('../__mocks__/src/scheduler'));
jest.mock('undici', () => require('../__mocks__/undici'));

import request from 'supertest';
import { prisma } from '../__mocks__/prisma';
import { makeApp, withServer} from '../__mocks__/helpers';
import lidarrAlbumsRouter from '../src/routes/lidarr-albums';


describe('lidarr-albums routes', () => {
  beforeEach(() => {
    (prisma.setting.findFirst  as any).mockResolvedValue({ id: 1, lidarrUrl: 'http://lidarr', lidarrApiKey: 'KEY' });
    (prisma.setting.findUnique as any).mockResolvedValue({ id: 1, lidarrUrl: 'http://lidarr', lidarrApiKey: 'KEY' });
    (prisma.$queryRawUnsafe   as any).mockResolvedValue([]);
    (prisma.$executeRawUnsafe as any).mockResolvedValue(0);
    (prisma.lidarrAlbum.count as any).mockResolvedValue(1);
    (prisma.lidarrAlbum.findMany as any).mockResolvedValue([{id: 2, title: 'Al', artistName: 'Ar', sizeOnDisk: 5,
      path: '/p', added: new Date(), monitored: true, mbid: null, foreignAlbumId: 'rel-1',},]);

    (prisma.lidarrAlbum.upsert as any).mockResolvedValue({});
  });

  it('GET /albums returns records and maps urls', async () => {
    await withServer(makeApp('/api/lidarr', lidarrAlbumsRouter), async (server, req) => {
      const res = await req(server).get('/api/lidarr/albums?page=1&pageSize=10');
      const item = res.body.items[0];
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items.length).toBeGreaterThan(0);
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('title');
      expect(item).toHaveProperty('artistName');
      expect(Object.prototype.hasOwnProperty.call(item, 'lidarrUrl')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(item, 'mbid')).toBe(true);
    });
  });

  it('POST /album/:id/refresh updates cache', async () => {
    const app = makeApp('/api/lidarr', lidarrAlbumsRouter);
    const res = await request(app).post('/api/lidarr/album/99/refresh');
    expect(res.status).toBe(200);
  });
});
