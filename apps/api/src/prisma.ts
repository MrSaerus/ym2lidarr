import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export async function initPrismaPragmas() {
  try {
    await prisma.$executeRawUnsafe('PRAGMA journal_mode=WAL'); // лучше для чтений параллельно с записью
    await prisma.$executeRawUnsafe('PRAGMA synchronous=NORMAL'); // баланс надёжности/скорости
    await prisma.$executeRawUnsafe('PRAGMA busy_timeout=30000'); // 30 секунд ожидания при блокировке
    console.log('[prisma] pragmas set: WAL, busy_timeout=30000');
  } catch (e: any) {
    console.warn('[prisma] pragmas init failed:', e?.message || e);
  }
}
