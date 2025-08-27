// __tests__/routes.custom-artists.test.ts
jest.mock('../src/prisma', () => require('../__mocks__/prisma'));
jest.mock('../src/scheduler', () => require('../__mocks__/src/scheduler'));
jest.mock('../src/workers.ts', () => require('../__mocks__/src/workers.ts'));

import { prisma } from '../__mocks__/prisma';
import customArtistsRouter from '../src/routes/custom-artists';
import { makeApp, withServer } from '../__mocks__/helpers';

describe('custom-artists routes', () => {
  beforeEach(() => {
    // Настройки (иногда нужны для сборки ссылок)
    (prisma.setting.findUnique as any).mockResolvedValue({ id: 1, lidarrUrl: 'http://lidarr' });
    (prisma.setting.findFirst  as any).mockResolvedValue({ id: 1, lidarrUrl: 'http://lidarr' });

    // Подсчёт для пагинации
    (prisma.customArtist.count as any).mockResolvedValue(2);

    // Список артистов (используется и в GET, и в match-all)
    (prisma.customArtist.findMany as any).mockResolvedValue([
      { id: 1, name: 'A', nkey: 'a', mbid: null, matchedAt: null },
      { id: 2, name: 'B', nkey: 'b', mbid: null, matchedAt: null },
    ]);

    // ВАЖНО: findUnique должен вернуть артиста, если передали where.id
    (prisma.customArtist.findUnique as any).mockImplementation(({ where }: any) => {
      if (where?.id != null) {
        return Promise.resolve({
          id: Number(where.id),
          name: `Artist${where.id}`,
          nkey: `artist${where.id}`,
          mbid: null,
          matchedAt: null,
        });
      }
      if (where?.nkey) {
        // при дедупе по nkey считаем, что нет дублей
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });

    // Создания (в POST / — через $transaction([...create(...)...]))
    (prisma.customArtist.create as any).mockImplementation(({ data }: any) =>
        Promise.resolve({ id: Math.floor(Math.random() * 1000), ...data })
    );
    (prisma.$transaction as any).mockImplementation((ops: any[]) => Promise.all(ops));
    (prisma.customArtist.createMany as any).mockResolvedValue({ count: 1 });

    // Обновления/удаления
    (prisma.customArtist.update as any).mockResolvedValue({ id: 1, name: 'B', nkey: 'b', mbid: 'x', matchedAt: new Date() });
    (prisma.customArtist.delete as any).mockResolvedValue({ id: 1 });

    // На всякий случай — если роут стартует run и ожидает id
    (prisma.syncRun?.create as any)?.mockResolvedValue?.({ id: 101, status: 'running' });
  });

  it('GET / returns paginated list', async () => {
    await withServer(makeApp('/api/custom-artists', customArtistsRouter), async (server, req) => {
      const res = await req(server).get('/api/custom-artists/?page=1&pageSize=50');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('total');
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items.length).toBeGreaterThan(0);
      // элемент имеет ожидаемые поля
      const item = res.body.items[0];
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('name');
      expect(Object.prototype.hasOwnProperty.call(item, 'mbid')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(item, 'matchedAt')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(item, 'hasLidarr')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(item, 'lidarrUrl')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(item, 'mbUrl')).toBe(true);
    });
  });

  it('POST / adds new items (dedup)', async () => {
    await withServer(makeApp('/api/custom-artists', customArtistsRouter), async (server, req) => {
      const res = await req(server)
          .post('/api/custom-artists/')
          .send({ names: [' A ', 'A', 'B'] });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('created');
    });
  });

  it('PATCH /:id updates', async () => {
    await withServer(makeApp('/api/custom-artists', customArtistsRouter), async (server, req) => {
      const res = await req(server)
          .patch('/api/custom-artists/1')
          .send({ name: 'B', mbid: 'x' });
      expect(res.status).toBe(200);
      expect(res.body.mbid).toBe('x');
    });
  });

  it('DELETE /:id deletes', async () => {
    await withServer(makeApp('/api/custom-artists', customArtistsRouter), async (server, req) => {
      const res = await req(server).delete('/api/custom-artists/1');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  it('POST /:id/match starts worker', async () => {
    await withServer(makeApp('/api/custom-artists', customArtistsRouter), async (server, req) => {
      const res = await req(server).post('/api/custom-artists/1/match').send({ force: true });
      if (res.status !== 200) {
        // eslint-disable-next-line no-console
        console.error('FAIL /custom-artists/...:', res.status, res.text || res.body);
      }
      expect(res.status).toBe(200);
      expect(res.body.runId).toBeDefined();
    });
  });

  it('POST /match-all starts worker', async () => {
    await withServer(makeApp('/api/custom-artists', customArtistsRouter), async (server, req) => {
      const res = await req(server).post('/api/custom-artists/match-all').send({ force: false });
      if (res.status !== 200) {
        // eslint-disable-next-line no-console
        console.error('FAIL /custom-artists/...:', res.status, res.text || res.body);
      }
      expect(res.status).toBe(200);
    });
  });
});
