// apps/api/src/routes/health.ts
import { Router } from 'express';

const r = Router();

r.get('/', (_req, res) => res.json({ ok: true }));

export default r;
