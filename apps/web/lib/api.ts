export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';

function mergeHeaders(init?: RequestInit): HeadersInit {
  const out: Record<string, string> = {};
  const src = init?.headers as HeadersInit | undefined;

  if (src instanceof Headers) {
    src.forEach((v, k) => {
      out[k] = v;
    });
  } else if (Array.isArray(src)) {
    for (const [k, v] of src) out[String(k)] = String(v);
  } else if (src && typeof src === 'object') {
    Object.assign(out, src as Record<string, string>);
  }

  if (!out['Content-Type']) out['Content-Type'] = 'application/json';
  return out;
}

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const options: RequestInit = {
    ...init,
    headers: mergeHeaders(init),
  };

  const res = await fetch(url, options);

  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      msg += ' ' + JSON.stringify(await res.json());
    } catch (_err) {
      console.warn('[log] write failed', _err);
    }
    throw new Error(msg);
  }

  try {
    return (await res.json()) as T;
  } catch {
    return null as unknown as T;
  }
}
