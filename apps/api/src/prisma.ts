// apps/api/src/prisma.ts
import { PrismaClient } from '@prisma/client';
import { createLogger } from './lib/logger';

export const prisma = new PrismaClient();
const log = createLogger({ scope: 'db.prisma' });

export async function initPrismaPragmas() {
  try {
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys=ON');
    await prisma.$executeRawUnsafe('PRAGMA journal_mode=WAL');
    await prisma.$executeRawUnsafe('PRAGMA synchronous=NORMAL');
    await prisma.$executeRawUnsafe('PRAGMA busy_timeout=30000');
    await prisma.$executeRawUnsafe('PRAGMA wal_autocheckpoint=1000');

    log.info('pragmas set', 'prisma.pragmas.ok', {
      foreign_keys: 'ON',
      journal_mode: 'WAL',
      synchronous: 'NORMAL',
      busy_timeout: 30000,
      wal_autocheckpoint: 1000,
    });
  } catch (e: any) {
    log.error('pragmas init failed', 'prisma.pragmas.fail', { err: e?.message || String(e) });
  }
}
