// apps/api/src/routes/navidrome.ts
import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma';
import { createLogger } from '../lib/logger';
import { runNavidromePlan } from '../workers/runNavidromePlan';
import { runNavidromeApply } from '../workers/runNavidromeApply';

export const navidromeRouter = Router();
const log = createLogger({ scope: 'route.navidrome' });

type PlanBody = {
  navidromeUrl?: string;
  navidromeUser?: string;
  navidromePass?: string;
  navidromeToken?: string;
  navidromeSalt?: string;
  target?: 'artists' | 'albums' | 'tracks' | 'all';
  policy?: 'yandex' | 'navidrome';
  withNdState?: boolean;
};
type ApplyBody = PlanBody & { dryRun?: boolean };

function str(x: unknown): string {
  return typeof x === 'string' ? x.trim() : '';
}

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

      if (!url || !user || (!pass && !token)) {
        res.status(400).json({ ok: false, error: 'Navidrome is not configured: url+user and pass or token required' });
        return;
      }

      const target = (req.body?.target ?? setting?.navidromeSyncTarget ?? 'all') as 'artists'|'albums'|'tracks'|'all';
      const policy = (req.body?.policy ?? setting?.likesPolicySourcePriority ?? 'yandex') as 'yandex'|'navidrome';
      const withNdState = req.body?.withNdState !== undefined ? !!req.body.withNdState : true;

      log.info('navidrome plan requested', 'route.nav.plan.start', { target, policy, withNdState });

      const runId = await runNavidromePlan({
        navUrl: url.replace(/\/+$/, ''),
        auth: token ? { user, token, salt } : { user, pass },
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

      if (!url || !user || (!pass && !token)) {
        res.status(400).json({ ok: false, error: 'Navidrome is not configured: url+user and pass or token required' });
        return;
      }

      const target = (req.body?.target ?? setting?.navidromeSyncTarget ?? 'all') as 'artists'|'albums'|'tracks'|'all';
      const policy = (req.body?.policy ?? setting?.likesPolicySourcePriority ?? 'yandex') as 'yandex'|'navidrome';
      const withNdState = req.body?.withNdState !== undefined ? !!req.body.withNdState : true;
      const dryRun = !!req.body?.dryRun;

      log.info('navidrome apply requested', 'route.nav.apply.start', { target, policy, withNdState, dryRun });

      const runId = await runNavidromeApply({
        navUrl: url,
        auth: token ? { user, token, salt } : { user, pass },
        target, policy, withNdState, dryRun,
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
