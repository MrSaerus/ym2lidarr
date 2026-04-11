export const DEFAULT_DATABASE_URL = "file:./data/app.db";

export function resolveDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}