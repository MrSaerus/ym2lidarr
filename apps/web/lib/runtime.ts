export function getRuntimeEnv(key: string): string | undefined {
  if (typeof window !== 'undefined' && key in (window as any)) {
    const v = (window as any)[key];
    if (typeof v === 'string') return v;
  }
  const v = (process.env as Record<string, any>)[key];
  return typeof v === 'string' ? v : undefined;
}
