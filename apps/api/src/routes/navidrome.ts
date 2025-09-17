// apps/api/src/routes/navidrome.ts
import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma';
import { createLogger } from '../lib/logger';
import { runNavidromePlan } from '../workers/runNavidromePlan';
import { runNavidromeApply } from '../workers/runNavidromeApply';
import { startRun, patchRunStats } from '../log';
import { NavidromeClient, type NdAuth } from '../services/navidrome'; // <-- ДОБАВЛЕНО

export const navidromeRouter = Router();
const log = createLogger({ scope: 'route.navidrome' });

type PlanBody = {
  navidromeUrl?: string;
  navidromeUser?: string;
  navidromePass?: string;
  navidromeToken?: string;
  navidromeSalt?: string;
  target?: 'artists' | 'albums' | 'tracks' | 'all' | 'both'; // 'both' нормализуем в 'all'
  policy?: 'yandex' | 'navidrome';
  withNdState?: boolean;
};
type ApplyBody = PlanBody & { dryRun?: boolean };

function str(x: unknown): string {
  return typeof x === 'string' ? x.trim() : '';
}

function normalizeTarget(t?: string | null): 'artists'|'albums'|'tracks'|'all' {
  const v = String(t || '').toLowerCase();
  const n = (v === 'both') ? 'all' : v;
  return (['artists','albums','tracks','all'].includes(n) ? (n as any) : 'all');
}

function chooseAuth(user: string, pass: string, token: string, salt: string) {
  // Приоритет — пароль, если он задан (надёжнее и подтверждён curl-тестом)
  if (pass) return { user, pass } as const;
  if (token && salt) return { user, token, salt } as const;
  // fallback: если только token без salt — это заведомо плохо, не возвращаем
  return { user, pass } as const; // пустой pass пусть отловится проверками выше
}

/* ========== PLAN (новая логика) ========== */
navidromeRouter.post('/plan', async (req, res, next) => {
  try {
    const setting = await prisma.setting.findFirst({ where: { id: 1 } });

    const url   = str(setting?.navidromeUrl ?? req.body?.navidromeUrl);
    const user  = str(setting?.navidromeUser ?? req.body?.navidromeUser);
    const pass  = str(setting?.navidromePass ?? req.body?.navidromePass);
    const token = str(setting?.navidromeToken ?? req.body?.navidromeToken);
    const salt  = str(setting?.navidromeSalt ?? req.body?.navidromeSalt);

    if (!url || !user || (!pass && !(token && salt))) {
      res.status(400).json({ ok: false, error: 'Navidrome is not configured: url+user and pass OR token+salt required' });
      return;
    }

    const target = normalizeTarget(req.body?.target ?? setting?.navidromeSyncTarget ?? 'all');
    const auth = chooseAuth(user, pass, token, salt);

    log.info('navidrome plan requested (new logic)', 'route.nav.plan.start', { target });

    const runId = await runNavidromePlan({
      navUrl: url.replace(/\/+$/, ''),
      auth,
      target,
    });

    log.info('navidrome plan started', 'route.nav.plan.ok', { runId });
    res.json({ ok: true, runId });
  } catch (e: any) {
    log.error('plan route failed', 'route.nav.plan.fail', { err: e?.message || String(e) });
    next(e);
  }
});

/* ========== APPLY (новая логика) ========== */
navidromeRouter.post('/apply', async (req, res, next) => {
  try {
    const setting = await prisma.setting.findFirst({ where: { id: 1 } });

    const url   = str(setting?.navidromeUrl ?? req.body?.navidromeUrl).replace(/\/+$/, '');
    const user  = str(setting?.navidromeUser ?? req.body?.navidromeUser);
    const pass  = str(setting?.navidromePass ?? req.body?.navidromePass);
    const token = str(setting?.navidromeToken ?? req.body?.navidromeToken);
    const salt  = str(setting?.navidromeSalt ?? req.body?.navidromeSalt);

    if (!url || !user || (!pass && !(token && salt))) {
      res.status(400).json({ ok: false, error: 'Navidrome is not configured: url+user and pass OR token+salt required' });
      return;
    }

    const target = normalizeTarget(req.body?.target ?? setting?.navidromeSyncTarget ?? 'all');
    const dryRun = !!req.body?.dryRun;
    const auth = chooseAuth(user, pass, token, salt);

    log.info('navidrome apply requested (new logic)', 'route.nav.apply.start', { target, dryRun });

    const run = await startRun('navidrome.apply', {
      phase: 'apply',
      target,
      policy: 'n/a',
      star_total: 0, star_done: 0,
      unstar_total: 0, unstar_done: 0,
      dryRun,
    });
    const runId = run?.id!;
    if (!runId) {
      res.status(500).json({ ok: false, error: 'failed to start run' });
      return;
    }

    await patchRunStats(runId, { phase: 'apply' });

    setImmediate(() => {
      runNavidromeApply({
        navUrl: url,
        auth,
        target,
        dryRun,
        reuseRunId: runId,
        authPass: pass || undefined,
      } as any).catch((e) => {
        log.error('apply worker unhandled', 'route.nav.apply.spawn.fail', { err: e?.message || String(e) });
      });
    });

    log.info('navidrome apply started', 'route.nav.apply.ok', { runId });
    res.json({ ok: true, runId });
  } catch (e: any) {
    log.error('apply route failed', 'route.nav.apply.fail', { err: e?.message || String(e) });
    next(e);
  }
});

/* ========== TEST ========== */
navidromeRouter.post('/test', async (req, res, next) => {
  try {
    // Берём из БД дефолты, а body позволяет переопределить (как на фронте)
    const setting = await prisma.setting.findFirst({ where: { id: 1 } });

    const url   = str(req.body?.navidromeUrl   ?? setting?.navidromeUrl).replace(/\/+$/, '');
    const user  = str(req.body?.navidromeUser  ?? setting?.navidromeUser);
    const pass  = str(req.body?.navidromePass  ?? setting?.navidromePass);
    const token = str(req.body?.navidromeToken ?? setting?.navidromeToken);
    const salt  = str(req.body?.navidromeSalt  ?? setting?.navidromeSalt);

    if (!url || !user || (!pass && !(token && salt))) {
      res.status(400).json({
        ok: false,
        error: 'Navidrome is not configured: need url + user and pass OR token + salt',
      });
      return;
    }

    const auth = chooseAuth(user, pass, token, salt);
    const nd = new NavidromeClient(url, auth, pass || undefined);

    log.info('navidrome test requested', 'route.nav.test.start', { via: pass ? 'pass' : 'token' });

    // Проверяем и отдаём подробности
    const info = await nd.pingInfo();
    if (!info.ok) {
      const { ok: _ignored, ...rest } = info;
      res.status(401).json({ ok: false, error: 'Auth failed', ...rest });
      return;
    }

    log.info('navidrome test ok', 'route.nav.test.ok', { server: info.server, type: info.type, version: info.version });
    res.json({ ok: true, server: info.server, type: info.type, version: info.version });
  } catch (e: any) {
    log.error('navidrome test failed', 'route.nav.test.fail', { err: e?.message || String(e) });
    next(e);
  }
});

export default navidromeRouter;

