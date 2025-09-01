// apps/api/src/routes/debug.qbt.ts
import { Router } from 'express';
import { fetch } from 'undici';
const r = Router();

r.get('/qbt/ping', async (_req, res) => {
  const base = (process.env.QBT_URL || '').replace(/\/+$/,'');
  try {
    const r1 = await fetch(`${base}/api/v2/app/webapiVersion`);
    const txt = await r1.text();
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
    res.status(500).json({ ok: false, base, ...det });
  }
});

export default r;
