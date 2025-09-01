// apps/web/lib/buildInfo.ts
export const BUILD = {
  version: process.env.NEXT_PUBLIC_APP_VERSION || 'dev',
  commit: (process.env.NEXT_PUBLIC_GIT_COMMIT || '').slice(0, 7),
  dateIso: process.env.NEXT_PUBLIC_BUILD_DATE || '',
  repoUrl: process.env.NEXT_PUBLIC_REPO_URL || '', // опционально
};

export function formatBuildDate(d?: string) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  // короткий формат локали
  return dt.toLocaleString();
}
