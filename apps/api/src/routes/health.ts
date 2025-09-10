// apps/api/src/routes/health.ts
import { Router } from 'express';
import { createLogger } from '../lib/logger';

const r = Router();
const log = createLogger({ scope: 'route.health' });

r.get('/', (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
  lg.info('health check requested', 'health.check.start');

  const payload = { ok: true };
  res.json(payload);

  lg.debug('health check response sent', 'health.check.done', payload);
});

export default r;
