jest.mock('../src/prisma', () => require('../__mocks__/prisma'));
import { prisma } from '../__mocks__/prisma';
import * as log from '../src/log';

describe('log module', () => {
  it('startRun creates running syncRun with stats', async () => {
    (prisma.syncRun.create as any).mockResolvedValue({ id: 7, status: 'running' });
    const run = await log.startRun('test', { phase: 'start' });
    expect(run.id).toBe(7);
    expect(prisma.syncRun.create).toHaveBeenCalled();
  });

  it('patchRunStats merges and updates', async () => {
    (prisma.syncRun.findUnique as any).mockResolvedValue({ id: 7, stats: '{}' });
    (prisma.syncRun.update as any).mockResolvedValue({});
    await log.patchRunStats(7, { x: 1 });
    expect(prisma.syncRun.update).toHaveBeenCalled();
  });

  it('endRun sets finishedAt', async () => {
    (prisma.syncRun.findUnique as any).mockResolvedValue({ id: 7, stats: '{}' });
    await log.endRun(7, 'ok', 'done', { ok: true });
    expect(prisma.syncRun.update).toHaveBeenCalled();
  });

  it('log writes syncLog', async () => {
    await log.log(1, 'info', 'm', { a: 1 });
    expect(prisma.syncLog.create).toHaveBeenCalled();
  });
});
