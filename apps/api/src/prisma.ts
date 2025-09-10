// apps/api/src/prisma.ts
import { PrismaClient } from '@prisma/client';
import { createLogger } from './lib/logger';

export const prisma = new PrismaClient();
const log = createLogger({ scope: 'db.prisma' });

export async function initPrismaPragmas() {
  try {
    // Включаем ограничения внешних ключей и тюним SQLite под наше использование
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys=ON');
    await prisma.$executeRawUnsafe('PRAGMA journal_mode=WAL');        // лучше для чтений параллельно с записью
    await prisma.$executeRawUnsafe('PRAGMA synchronous=NORMAL');      // баланс надёжности/скорости
    await prisma.$executeRawUnsafe('PRAGMA busy_timeout=30000');      // 30 секунд ожидания при блокировке
    await prisma.$executeRawUnsafe('PRAGMA wal_autocheckpoint=1000'); // реже fsync при WAL

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
