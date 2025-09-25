// apps/api/src/services/qbittorrent.ts
import { fetch, type Response, FormData } from 'undici';
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
    hasPass: !!cfg.pass,
    deleteFiles: cfg.deleteFiles,
  });
  return cfg;
}

export type QbtTorrentInfo = {
  hash: string;
  name: string;
  progress: number; // 0..1
  state: string;    // downloading, stalledDL, pausedDL, metaDL, error, uploading, ...
  dlspeed: number;
  upspeed: number;
  downloaded: number;
  uploaded: number;
  size: number;
  category?: string;
  save_path?: string;
  tags?: string;
};

export type QbtTorrentFile = {
  name: string;             // относительный путь внутри торрента
  size: number;
  progress: number;
  priority: number;
  is_seed: boolean;
};

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

    const getSetCookie = (r.headers as any).getSetCookie?.bind(r.headers) as (() => string[]) | undefined;
    const cookies: string[] = getSetCookie?.() ?? ((r.headers as any).raw?.()['set-cookie'] ?? []);
    const sidLine = cookies.find((c: string) => /SID=/.test(c));
    const m = sidLine ? /SID=([^;]+)/i.exec(sidLine) : null;
    if (!m) {
      log.error('SID not found in cookie', 'qbt.auth.sid.missing');
      throw new Error('qBittorrent auth: SID not found');
    }
    this.cookie = `SID=${m[1]}`;
  }

  private async get(path: string): Promise<Response> {
    await this.ensureAuth();
    const url = `${this.base}${path}`;
    return fetch(url, { headers: { cookie: this.cookie! } });
  }

  private async postFormUrlencoded(path: string, form: Record<string, string>): Promise<Response> {
    await this.ensureAuth();
    const url = `${this.base}${path}`;
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: this.cookie! },
      body: new URLSearchParams(form),
    });
  }

  // `any` вместо Blob/File, чтобы не упираться в типы среды
  private async postMultipart(path: string, fields: Record<string, string | any | undefined | null>): Promise<Response> {
    await this.ensureAuth();
    const url = `${this.base}${path}`;
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined || v === null) continue;
      fd.append(k, v as any);
    }
    return fetch(url, { method: 'POST', headers: { cookie: this.cookie! }, body: fd });
  }

  async deleteTorrents(hashes: string, deleteFiles = false) {
    const r = await this.postFormUrlencoded('/api/v2/torrents/delete', {
      hashes,
      deleteFiles: deleteFiles ? 'true' : 'false',
    });
    if (!r.ok) throw new Error(`qBittorrent delete failed: ${r.status} ${r.statusText}`);
  }

  /** Добавление по magnet или прямой ссылке (torrent-файл url) */
  async addByMagnetOrUrl(args: { magnetOrUrl: string; savePath?: string | null; paused?: boolean; tags?: string | null; category?: string | null }) {
    const fields: Record<string, string> = { urls: args.magnetOrUrl };
    if (args.savePath) fields['savepath'] = args.savePath;
    if (typeof args.paused === 'boolean') {
      // qBittorrent v5: поле `stopped`.
      // Для совместимости можно отправлять и paused, и stopped.
      const v = args.paused ? 'true' : 'false';
      fields['stopped'] = v;
      fields['paused'] = v; // на случай, если придётся говорить с более старым qBittorrent
    }
    if (args.tags) fields['tags'] = args.tags;
    if (args.category) fields['category'] = args.category;

    const r = await this.postMultipart('/api/v2/torrents/add', fields);
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      log.error('add torrent failed', 'qbt.add.fail', {
        status: r.status,
        statusText: r.statusText,
        body: text
      });
      throw new Error(`qBittorrent add failed: ${r.status} ${r.statusText}`);
    }
    return true;
  }

  /** Информация по одному торренту */
  async infoByHash(hash: string): Promise<QbtTorrentInfo | null> {
    const r = await this.get(`/api/v2/torrents/info?hashes=${encodeURIComponent(hash)}`);
    if (!r.ok) throw new Error(`qBittorrent info failed: ${r.status} ${r.statusText}`);
    const rows = (await r.json()) as any[];
    const it = Array.isArray(rows) ? rows[0] : null;
    if (!it) return null;
    return {
      hash: it.hash,
      name: it.name,
      progress: it.progress,
      state: it.state,
      dlspeed: it.dlspeed,
      upspeed: it.upspeed,
      downloaded: it.downloaded,
      uploaded: it.uploaded,
      size: it.size,
      category: it.category,
      save_path: it.save_path,
    };
  }

  async setLocation(args: { hashes: string; location: string }) {
    const r = await this.postFormUrlencoded('/api/v2/torrents/setLocation', {
      hashes: args.hashes,
      location: args.location,
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`qBittorrent setLocation failed: ${r.status} ${text}`);
    }
    return true;
  }

  static async fromDb(): Promise<{ client: QbtClient; deleteFiles: boolean }> {
    const cfg = await getQbtConfig();
    const client = new QbtClient(cfg.base, cfg.user, cfg.pass);
    return { client, deleteFiles: cfg.deleteFiles };
  }
  async infoList(params?: { tag?: string; category?: string; filter?: string }): Promise<QbtTorrentInfo[]> {
    const usp = new URLSearchParams();
    if (params?.filter) usp.set('filter', params.filter);
    if (params?.category) usp.set('category', params.category);
    if (params?.tag) usp.set('tag', params.tag);
    const suffix = usp.toString() ? `?${usp.toString()}` : '';
    const r = await this.get(`/api/v2/torrents/info${suffix}`);
    if (!r.ok) throw new Error(`qBittorrent info list failed: ${r.status} ${r.statusText}`);
    const rows = (await r.json()) as any[];
    return (rows || []).map((it) => ({
      hash: it.hash,
      name: it.name,
      progress: it.progress,
      state: it.state,
      dlspeed: it.dlspeed,
      upspeed: it.upspeed,
      downloaded: it.downloaded,
      uploaded: it.uploaded,
      size: it.size,
      category: it.category,
      save_path: it.save_path,
      tags: it.tags, // строка вида "tag1,tag2"
    }));
  }

  async filesByHash(hash: string): Promise<QbtTorrentFile[]> {
    const r = await this.get(`/api/v2/torrents/files?hash=${encodeURIComponent(hash)}`);
    if (!r.ok) throw new Error(`qBittorrent files failed: ${r.status} ${r.statusText}`);
    return (await r.json()) as QbtTorrentFile[];
  }
  async pauseTorrents(hashes: string) {
    const r = await this.postFormUrlencoded('/api/v2/torrents/stop', {
      hashes,
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`qBittorrent pause failed: ${r.status} ${text}`);
    }
    return true;
  }

  async resumeTorrents(hashes: string) {
    const r = await this.postFormUrlencoded('/api/v2/torrents/start', {
      hashes,
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`qBittorrent resume failed: ${r.status} ${text}`);
    }
    return true;
  }
}
