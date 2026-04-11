// apps/api/src/prisma/client.ts
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../generated/prisma/client';
import { createLogger } from '../lib/logger';
import { resolveDatabaseUrl } from './database';

const adapter = new PrismaBetterSqlite3({
  url: resolveDatabaseUrl(),
});

export const prisma = new PrismaClient({ adapter });
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