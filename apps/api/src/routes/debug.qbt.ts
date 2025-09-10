// apps/api/src/routes/debug.qbt.ts
import { Router } from 'express';
import { fetch } from 'undici';
import { createLogger } from '../lib/logger';

const r = Router();
const log = createLogger({ scope: 'route.debug.qbt' });

r.get('/qbt/ping', async (req, res) => {
  const lg = log.child({ ctx: { reqId: (req as any)?.reqId } });
  const base = (process.env.QBT_URL || '').replace(/\/+$/, '');
  lg.info('qbt ping requested', 'debug.qbt.ping.start', { base });

  try {
    const r1 = await fetch(`${base}/api/v2/app/webapiVersion`);
    const txt = await r1.text();

    lg.debug('qbt ping succeeded', 'debug.qbt.ping.done', { status: r1.status, webapi: txt });

    res.json({ ok: true, base, webapi: txt, status: r1.status });
  } catch (e: any) {
    const det = {
      msg: String(e?.message || e),
      code: e?.cause?.code || e?.code,
      errno: e?.cause?.errno || e?.errno,
      syscall: e?.cause?.syscall || e?.syscall,
      address: e?.cause?.address || e?.address,
      port: e?.cause?.port || e?.port,
    };
    lg.error('qbt ping failed', 'debug.qbt.ping.fail', det);

    res.status(500).json({ ok: false, base, ...det });
  }
});

export default r;
