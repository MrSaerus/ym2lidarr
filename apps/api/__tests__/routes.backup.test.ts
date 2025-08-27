jest.mock('../src/prisma', () => require('../__mocks__/prisma'));
jest.mock('../src/scheduler', () => require('../__mocks__/src/scheduler'));
import request from 'supertest';
import { prisma } from '../__mocks__/prisma';
import { makeApp } from '../__mocks__/helpers';

import backupRouter from '../src/routes/backup';
import { listBackups, runBackupNow } from '../src/scheduler';

describe('backup routes', () => {
  beforeEach(() => {
    (prisma.setting.findFirst as any).mockResolvedValue({ id: 1, backupDir: '/app/data/backups' });
  });

  it('GET /list returns files and dir', async () => {
    const app = makeApp('/api/backup', backupRouter);
    const res = await request(app).get('/api/backup/list');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.dir).toBe('/app/data/backups');
    expect(listBackups).toHaveBeenCalledWith('/app/data/backups');
  });

  it('POST /run returns path built from settings dir and file', async () => {
    const app = makeApp('/api/backup', backupRouter);
    const res = await request(app).post('/api/backup/run');
    expect(res.status).toBe(200);
    expect(runBackupNow).toHaveBeenCalled();
    expect(res.body.path).toContain('/app/data/backups/backup_');
  });

  it('POST /run handles disabled error with 400', async () => {
    (runBackupNow as any).mockResolvedValueOnce({ ok: false, error: 'Backups are disabled in settings.' });
    const app = makeApp('/api/backup', backupRouter);
    const res = await request(app).post('/api/backup/run');
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});
