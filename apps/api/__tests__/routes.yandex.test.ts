jest.mock('../src/prisma', () => require('../__mocks__/prisma'));
jest.mock('../src/scheduler', () => require('../__mocks__/src/scheduler'));
jest.mock('../src/workers.ts', () => require('../__mocks__/src/workers'));

import request from 'supertest';
import { makeApp } from '../__mocks__/helpers';
import yandexRouter from '../src/routes/yandex';

describe('yandex manual routes', () => {
  it('POST /pull-all triggers worker when not busy', async () => {
    const app = makeApp('/api/yandex', yandexRouter);
    const res = await request(app).post('/api/yandex/pull-all');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST /match triggers worker with target', async () => {
    const app = makeApp('/api/yandex', yandexRouter);
    const res = await request(app).post('/api/yandex/match').send({ target: 'artists', force: true });
    expect(res.status).toBe(200);
  });

  it('POST /push triggers worker', async () => {
    const app = makeApp('/api/yandex', yandexRouter);
    const res = await request(app).post('/api/yandex/push').send({ target: 'albums' });
    expect(res.status).toBe(200);
  });
});
