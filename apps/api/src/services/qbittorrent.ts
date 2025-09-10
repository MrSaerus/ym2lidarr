// apps/api/src/services/qbittorrent.ts
import { fetch, type Response } from 'undici';
import { prisma } from '../prisma';
import { createLogger } from '../lib/logger';

const log = createLogger({ scope: 'service.qbt' });

async function getQbtConfig() {
  const s = await prisma.setting.findFirst({ where: { id: 1 } });
  const cfg = {
    base: (s?.qbtUrl || '').replace(/\/+$/, ''),
    user: s?.qbtUser || '',
    pass: s?.qbtPass || '',
    deleteFiles: !!(s?.qbtDeleteFiles ?? true),
  };
  log.debug('loaded qbt config', 'qbt.config.loaded', {
    base: cfg.base,
    hasUser: !!cfg.user,
    hasPass: cfg.pass ? true : false, // только флаг
    deleteFiles: cfg.deleteFiles,
  });
  return cfg;
}

export class QbtClient {
  private cookie: string | null = null;
  constructor(private base: string, private user: string, private pass: string) {
    if (!this.base) {
      log.error('qbtUrl is not set', 'qbt.init.error', { base });
      throw new Error('qBittorrent: qbtUrl is not set');
    }
    log.debug('QbtClient created', 'qbt.init', { base: this.base, hasUser: !!this.user });
  }

  private async ensureAuth() {
    if (this.cookie) return;
    log.info('auth start', 'qbt.auth.start', { base: this.base });

    const r = await fetch(`${this.base}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: this.user, password: this.pass }),
    });

    if (!r.ok) {
      const msg = `qBittorrent auth failed: ${r.status} ${r.statusText}`;
      log.error('auth failed', 'qbt.auth.fail', { status: r.status, statusText: r.statusText });
      throw new Error(msg);
    }

    // извлекаем cookie, не логируя её содержимое
    const getSetCookie = (r.headers as any).getSetCookie?.bind(r.headers) as (() => string[]) | undefined;
    const cookies: string[] = getSetCookie?.() ?? ((r.headers as any).raw?.()['set-cookie'] ?? []);
    const sidLine = cookies.find((c: string) => /SID=/.test(c));
    if (!sidLine) {
      log.error('no set-cookie with SID', 'qbt.auth.nosid');
      throw new Error('qBittorrent auth: no cookie');
    }
    const m = /SID=([^;]+)/i.exec(sidLine);
    if (!m) {
      log.error('SID not found in cookie', 'qbt.auth.sid.missing');
      throw new Error('qBittorrent auth: SID not found');
    }
    this.cookie = `SID=${m[1]}`;
    log.info('auth ok', 'qbt.auth.ok', { base: this.base });
  }

  private async postForm(path: string, form: Record<string, string>): Promise<Response> {
    await this.ensureAuth();
    const url = `${this.base}${path}`;
    log.debug('POST form', 'qbt.http.post', { path, url });

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: this.cookie! },
      body: new URLSearchParams(form),
    });

    if (!r.ok) {
      log.warn('POST failed', 'qbt.http.post.fail', { path, status: r.status, statusText: r.statusText });
    } else {
      log.debug('POST ok', 'qbt.http.post.ok', { path, status: r.status });
    }
    return r;
  }

  async deleteTorrents(hashes: string, deleteFiles = false) {
    log.info('delete torrents request', 'qbt.delete.start', {
      hashesPreview: hashes.slice(0, 12), // не спамим полный список
      count: hashes.split('|').length,
      deleteFiles,
    });

    const r = await this.postForm('/api/v2/torrents/delete', {
      hashes,
      deleteFiles: deleteFiles ? 'true' : 'false',
    });

    if (!r.ok) {
      const msg = `qBittorrent delete failed: ${r.status} ${r.statusText}`;
      log.error('delete failed', 'qbt.delete.fail', { status: r.status, statusText: r.statusText });
      throw new Error(msg);
    }

    log.info('delete torrents ok', 'qbt.delete.ok', {
      count: hashes.split('|').length,
      deleteFiles,
    });
  }

  static async fromDb(): Promise<{ client: QbtClient; deleteFiles: boolean }> {
    const cfg = await getQbtConfig();
    const client = new QbtClient(cfg.base, cfg.user, cfg.pass);
    log.debug('QbtClient.fromDb ready', 'qbt.fromDb', { base: cfg.base, deleteFiles: cfg.deleteFiles });
    return { client, deleteFiles: cfg.deleteFiles };
  }
}
