import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma';
import { createLogger } from '../lib/logger';
import { runNavidromePlan } from '../workers/runNavidromePlan';
import { runNavidromeApply } from '../workers/runNavidromeApply';
import { startRun, patchRunStats } from '../log';

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

/* ========== PLAN ========== */
navidromeRouter.post(
  '/plan',
  async (req: Request<unknown, unknown, PlanBody>, res: Response, next: NextFunction) => {
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
      const policy = (req.body?.policy ?? setting?.likesPolicySourcePriority ?? 'yandex') as 'yandex'|'navidrome';
      const withNdState = req.body?.withNdState !== undefined ? !!req.body.withNdState : true;

      log.info('navidrome plan requested', 'route.nav.plan.start', { target, policy, withNdState });

      const runId = await runNavidromePlan({
        navUrl: url.replace(/\/+$/, ''),
        auth: chooseAuth(user, pass, token, salt),
        target, policy, withNdState,
      });

      log.info('navidrome plan started', 'route.nav.plan.ok', { runId });
      res.json({ ok: true, runId });
    } catch (e: any) {
      log.error('plan route failed', 'route.nav.plan.fail', { err: e?.message || String(e) });
      next(e);
    }
  }
);

/* ========== APPLY (асинхронный ответ сразу) ========== */
navidromeRouter.post(
  '/apply',
  async (req: Request<unknown, unknown, ApplyBody>, res: Response, next: NextFunction) => {
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
      const policy = (req.body?.policy ?? setting?.likesPolicySourcePriority ?? 'yandex') as 'yandex'|'navidrome';
      const withNdState = req.body?.withNdState !== undefined ? !!req.body.withNdState : true;
      const dryRun = !!req.body?.dryRun;

      log.info('navidrome apply requested', 'route.nav.apply.start', { target, policy, withNdState, dryRun });

      const run = await startRun('navidrome.apply', {
        phase: 'apply',
        target, policy,
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

      const auth = chooseAuth(user, pass, token, salt);

      setImmediate(() => {
        runNavidromeApply({
          navUrl: url,
          auth,
          target, policy, withNdState, dryRun,
          reuseRunId: runId,
          // пробросим пароль внутрь на случай фолбэка в сервисе
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
  }
);

export default navidromeRouter;
