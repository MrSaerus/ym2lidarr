// apps/web/lib/api.ts
// Fetch wrapper with:
//  - base URL support via NEXT_PUBLIC_API_BASE
//  - automatic JSON serialization for plain object bodies OR explicit `json` field
//  - typed ApiError on non-2xx responses
//  - JSON auto-parsing by content-type, fallback to text
import { getRuntimeEnv } from './runtime';

export function getApiBase(): string {
  return getRuntimeEnv('NEXT_PUBLIC_API_BASE') || '';
}
export class ApiError extends Error {
  readonly status: number;
  readonly url: string;
  readonly detail?: unknown;

  constructor(message: string, status: number, url: string, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.url = url;
    this.detail = detail;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof Error && (err as any).name === 'ApiError' && typeof (err as any).status === 'number';
}

function withBase(path: string): string {
  if (/^https?:\/\//i.test(path) || path.startsWith('//')) return path;
  const base = (getApiBase() || '').replace(/\/+$/, '');
  if (!base) return path;
  return `${base}/${path.replace(/^\/+/, '')}`;
}

function isJsonContentType(ct: string | null): boolean {
  return !!ct && /\bapplication\/json\b/i.test(ct);
}

function isBodyInitLike(x: unknown): x is BodyInit {
  return (
      typeof x === 'string' ||
      x instanceof ArrayBuffer ||
      ArrayBuffer.isView(x as any) ||
      (typeof Blob !== 'undefined' && x instanceof Blob) ||
      (typeof FormData !== 'undefined' && x instanceof FormData) ||
      (typeof URLSearchParams !== 'undefined' && x instanceof URLSearchParams) ||
      (typeof ReadableStream !== 'undefined' && x instanceof ReadableStream)
  );
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  if (x === null || typeof x !== 'object') return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

export type ApiInit = Omit<RequestInit, 'body' | 'headers'> & {
  /** If provided, will be JSON.stringify-ed and Content-Type set to application/json */
  json?: unknown;
  /** Body can be standard BodyInit OR a plain object which will be auto-JSON serialized */
  body?: BodyInit | Record<string, unknown> | null;
  headers?: HeadersInit;
};

function buildInit(init?: ApiInit): RequestInit {
  if (!init) return {};

  const { json, body: rawBody, headers: givenHeaders, ...rest } = init;
  const headers = new Headers(givenHeaders || {});
  if (!headers.has('Accept')) headers.set('Accept', 'application/json, text/plain;q=0.9, */*;q=0.8');

  let body: BodyInit | null | undefined = undefined;

  if (json !== undefined) {
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    body = JSON.stringify(json);
  } else if (rawBody === null || rawBody === undefined) {
    body = rawBody as null | undefined;
  } else if (isBodyInitLike(rawBody)) {
    body = rawBody;
  } else if (isPlainObject(rawBody)) {
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    body = JSON.stringify(rawBody);
  } else {
    // Numbers/booleans/etc. — stringify to be safe
    body = String(rawBody);
  }

  const out: RequestInit = { ...rest, headers };
  if (body !== undefined) out.body = body;
  return out;
}

/**
 * Call API and return parsed response.
 * - On non-OK responses, throws ApiError (with status and parsed detail when possible).
 * - Parses JSON when response has JSON content-type, otherwise returns text.
 */
export async function api<T = any>(path: string, init?: ApiInit): Promise<T> {
  const url = withBase(path);
  const reqInit = buildInit(init);
  const res = await fetch(url, reqInit);

  const ct = res.headers.get('content-type');

  if (!res.ok) {
    let detail: unknown;
    try {
      detail = isJsonContentType(ct) ? await res.json() : await res.text();
    } catch {
      /* ignore parse errors */
    }
    const extra =
        typeof detail === 'string'
            ? ` ${detail}`
            : detail && typeof detail === 'object'
                ? ` ${JSON.stringify(detail)}`
                : '';
    const msg = `${res.status} ${res.statusText}${extra}`;
    throw new ApiError(msg, res.status, url, detail);
  }

  if (isJsonContentType(ct)) {
    return (await res.json()) as T;
  }

  // Fallback to text when server didn't send JSON
  return (await res.text()) as unknown as T;
}

/* =========================
 * Custom Artists API (new)
 * ========================= */

function qs(params?: Record<string, any>): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!entries.length) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of entries) sp.set(k, String(v));
  return `?${sp.toString()}`;
}

export type CustomArtist = {
  id: number;
  name: string;
  mbid: string | null;
  matchedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  mbUrl?: string | null;
};

export type CustomArtistsResp = {
  page: number;
  pageSize: number;
  total: number;
  items: CustomArtist[];
};

export const customArtists = {
  list: async (params?: {
    page?: number;
    pageSize?: number;
    q?: string;
    sortBy?: 'name' | 'matched' | 'created';
    sortDir?: 'asc' | 'desc';
  }): Promise<CustomArtistsResp> => {
    return api<CustomArtistsResp>(`/api/custom-artists${qs(params)}`, { method: 'GET' });
  },

  addMany: async (names: string[]): Promise<{ created: number }> => {
    return api<{ created: number }>(`/api/custom-artists`, {
      method: 'POST',
      json: { names },
    });
  },

  patch: async (
      id: number,
      body: Partial<Pick<CustomArtist, 'name' | 'mbid'>>,
  ): Promise<CustomArtist> => {
    return api<CustomArtist>(`/api/custom-artists/${id}`, {
      method: 'PATCH',
      json: body,
    });
  },

  remove: async (id: number): Promise<{ ok: boolean }> => {
    return api<{ ok: boolean }>(`/api/custom-artists/${id}`, { method: 'DELETE' });
  },

  matchOne: async (
      id: number,
  ): Promise<{ matched: boolean; id?: number; mbid?: string }> => {
    return api<{ matched: boolean; id?: number; mbid?: string }>(
        `/api/custom-artists/${id}/match`,
        { method: 'POST', json: {} },
    );
  },

  matchAll: async (): Promise<{ matched: number; total: number }> => {
    return api<{ matched: number; total: number }>(`/api/custom-artists/match-all`, {
      method: 'POST',
      json: {},
    });
  },
};
