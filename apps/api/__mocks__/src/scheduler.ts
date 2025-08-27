export const reloadJobs = jest.fn();
export const getCronStatuses = jest.fn(async () => ([
  { key: 'yandexPull', title: 'Yandex Pull', enabled: true, valid: true, cron: '0 */6 * * *', nextRun: new Date(), running: false }
]));
export const ensureNotBusyOrThrow = jest.fn(async () => {});
export const runBackupNow = jest.fn(async () => ({ ok: true, file: 'backup_20250101_000000.db', deleted: [] }));
export const listBackups = jest.fn(() => [{ file: 'backup_20250101_000000.db', size: 1024, mtime: 1 }]);
