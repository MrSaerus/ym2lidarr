import { fetch, type Response } from 'undici';
import { prisma } from '../prisma';

async function getQbtConfig() {
  const s = await prisma.setting.findFirst({ where: { id: 1 } });
  return {
    base: (s?.qbtUrl || '').replace(/\/+$/, ''),
    user: s?.qbtUser || '',
    pass: s?.qbtPass || '',
    deleteFiles: !!(s?.qbtDeleteFiles ?? true),
  };
}

export class QbtClient {
  private cookie: string | null = null;
  constructor(private base: string, private user: string, private pass: string) {
    if (!this.base) throw new Error('qBittorrent: qbtUrl is not set');
  }

  private async ensureAuth() {
    if (this.cookie) return;
    const r = await fetch(`${this.base}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: this.user, password: this.pass }),
    });
    if (!r.ok) throw new Error(`qBittorrent auth failed: ${r.status} ${r.statusText}`);
    const getSetCookie = (r.headers as any).getSetCookie?.bind(r.headers) as (() => string[]) | undefined;
    const cookies: string[] = getSetCookie?.() ?? ((r.headers as any).raw?.()['set-cookie'] ?? []);
    const sidLine = cookies.find((c: string) => /SID=/.test(c));
    if (!sidLine) throw new Error('qBittorrent auth: no cookie');
    const m = /SID=([^;]+)/i.exec(sidLine);
    if (!m) throw new Error('qBittorrent auth: SID not found');
    this.cookie = `SID=${m[1]}`;
  }

  private async postForm(path: string, form: Record<string, string>): Promise<Response> {
    await this.ensureAuth();
    const url = `${this.base}${path}`;
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: this.cookie! },
      body: new URLSearchParams(form),
    });
  }

  async deleteTorrents(hashes: string, deleteFiles = false) {
    const r = await this.postForm('/api/v2/torrents/delete', {
      hashes,
      deleteFiles: deleteFiles ? 'true' : 'false',
    });
    if (!r.ok) throw new Error(`qBittorrent delete failed: ${r.status} ${r.statusText}`);
  }

  static async fromDb(): Promise<{ client: QbtClient; deleteFiles: boolean }> {
    const cfg = await getQbtConfig();
    const client = new QbtClient(cfg.base, cfg.user, cfg.pass);
    return { client, deleteFiles: cfg.deleteFiles };
  }
}
