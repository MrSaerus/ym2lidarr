export const prisma = {
  setting: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
  },
  syncRun: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  syncLog: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
  yandexArtist: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  },
  yandexAlbum: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  },
  lidarrArtist: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    upsert: jest.fn(),
    count: jest.fn(),
  },
  lidarrAlbum: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    upsert: jest.fn(),
    count: jest.fn(),
  },
  customArtist: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    createMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  $transaction: jest.fn((fns: any) => Promise.all(fns)),
  $executeRawUnsafe: jest.fn(),
  $queryRawUnsafe: jest.fn(),
};
