jest.mock('../src/prisma', () => require('../__mocks__/prisma'));
jest.mock('../src/scheduler', () => require('../__mocks__/src/scheduler'));
jest.mock('../src/services/yandex.ts', () => require('../__mocks__/src/services/yandex.ts'));
jest.mock('undici', () => require('../__mocks__/undici'));

import request from 'supertest';
import { prisma } from '../__mocks__/prisma';
import settingsRouter from '../src/routes/settings';
import { makeApp } from '../__mocks__/helpers';
import { getCronStatuses } from '../src/scheduler';
import { yandexVerifyToken } from '../src/services/yandex';

describe('settings routes', () => {
  beforeEach(() => {
    (prisma.setting.findFirst as any).mockResolvedValue({ id: 1, lidarrUrl: 'http://localhost', lidarrApiKey: 'KEY', pyproxyUrl: 'http://proxy', yandexToken: 'TKN' });
    (prisma.setting.upsert as any).mockResolvedValue({ id: 1, lidarrUrl: 'http://localhost', lidarrApiKey: 'KEY' });
  });

  it('GET / returns settings object', async () => {
    const app = makeApp('/api/settings', settingsRouter);
    const res = await request(app).get('/api/settings/');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
  });

  it('GET /scheduler returns jobs', async () => {
    const app = makeApp('/api/settings', settingsRouter);
    const res = await request(app).get('/api/settings/scheduler');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(getCronStatuses).toHaveBeenCalled();
  });

  it('POST /test/yandex returns verification result', async () => {
    const app = makeApp('/api/settings', settingsRouter);
    const res = await request(app).post('/api/settings/test/yandex').send({});
    expect(res.status).toBe(200);
    expect(yandexVerifyToken).toHaveBeenCalledWith('TKN');
  });

  it('POST /lidarr/defaults applies defaults when overwrite true', async () => {
    const app = makeApp('/api/settings', settingsRouter);
    const res = await request(app).post('/api/settings/lidarr/defaults').send({ overwrite: true });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST / and PUT / save settings via upsert', async () => {
    const app = makeApp('/api/settings', settingsRouter);
    const post = await request(app).post('/api/settings/').send({ lidarrUrl: 'http://x', lidarrApiKey: 'Y' });
    expect(post.status).toBe(200);
    const put = await request(app).put('/api/settings/').send({ lidarrUrl: 'http://x', lidarrApiKey: 'Y' });
    expect(put.status).toBe(200);
  });
});
