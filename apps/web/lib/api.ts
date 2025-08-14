// apps/web/lib/api.ts
const BASE =
    process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';

/**
 * Обёртка над fetch:
 * - Если !ok — читаем JSON или текст и бросаем Error с деталями.
 * - Если content-type JSON — парсим, иначе возвращаем текст (кастом к T).
 */
export async function api<T = any>(
    path: string,
    init?: RequestInit
): Promise<T> {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const headers = new Headers(init?.headers || {});
  if (!headers.has('Content-Type') && init?.body) {
    headers.set('Content-Type', 'application/json');
  }

  try {
    const r = await fetch(url, { ...init, headers });
    const ct = r.headers.get('content-type') || '';

    if (!r.ok) {
      let detail = '';
      try {
        detail = ct.includes('application/json')
            ? JSON.stringify(await r.json())
            : await r.text();
      } catch {
        /* ignore */
      }
      throw new Error(`${r.status} ${r.statusText}${detail ? ` ${detail}` : ''}`);
    }

    if (ct.includes('application/json')) {
      return (await r.json()) as T;
    }
    // если не JSON — вернём текст, приведя тип
    return (await r.text()) as unknown as T;
  } catch (err: any) {
    throw err instanceof Error ? err : new Error(String(err));
  }
}
