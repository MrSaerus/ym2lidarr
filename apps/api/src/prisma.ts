// apps/api/src/prisma.ts
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export async function initPrismaPragmas() {
  try {
    // Включаем ограничения внешних ключей и тюним SQLite под наше использование
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys=ON');
    await prisma.$executeRawUnsafe('PRAGMA journal_mode=WAL');       // лучше для чтений параллельно с записью
    await prisma.$executeRawUnsafe('PRAGMA synchronous=NORMAL');     // баланс надёжности/скорости
    await prisma.$executeRawUnsafe('PRAGMA busy_timeout=30000');     // 30 секунд ожидания при блокировке
    await prisma.$executeRawUnsafe('PRAGMA wal_autocheckpoint=1000'); // реже fsync при WAL

    console.log('[prisma] pragmas set: foreign_keys=ON, WAL, busy_timeout=30000');
  } catch (e: any) {
    console.warn('[prisma] pragmas init failed:', e?.message || e);
  }
}
