jest.mock('../src/prisma', () => require('../__mocks__/prisma'));
import request from 'supertest';
import { makeApp } from '../__mocks__/helpers';

import healthRouter from '../src/routes/health';

describe('health', () => {
  it('GET / returns ok:true', async () => {
    const app = makeApp('/api/health', healthRouter);
    const res = await request(app).get('/api/health/');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
