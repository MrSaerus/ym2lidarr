// apps/api/src/middleware/logging.ts
import type { Request, Response, NextFunction } from 'express';
import { log } from '../lib/logger'

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const id = (req.headers['x-request-id'] as string) || cryptoRandom();
  (req as any).reqId = id;

  const child = log.child({ scope: 'http', ctx: { reqId: id, path: req.path, method: req.method } });

  // было info — стало debug, чтобы не дублировать access-лог
  child.debug('incoming request', 'api.request.start', { ip: req.ip });

  res.on('finish', () => {
    const dur = Date.now() - start;
    const lvl = res.statusCode >= 500 ? 'error'
      : res.statusCode >= 400 ? 'warn'
        : 'info';
    (child as any)[lvl]('request completed', 'api.request.done', {
      status: res.statusCode, durMs: dur, bytes: Number(res.getHeader('Content-Length')) || undefined
    });
  });

  next();
}

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  const id = (req as any).reqId || cryptoRandom();
  const child = log.child({ scope: 'http', ctx: { reqId: id, path: req.path, method: req.method } });

  child.error('unhandled error', 'api.error', {
    err: err?.message || String(err), stack: err?.stack
  });

  res.status(500).json({ error: 'Internal Error', requestId: id });
}

function cryptoRandom() {
  return Math.random().toString(36).slice(2, 10);
}
