jest.mock('../src/prisma', () => require('../__mocks__/prisma'));
import request from 'supertest';
import { prisma } from '../__mocks__/prisma';
import { makeApp } from '../__mocks__/helpers';
import exportRouter from '../src/routes/export';

describe('export routes', () => {
  beforeEach(() => {
    (prisma.yandexArtist.findMany as any).mockResolvedValue([
      { name: 'A', mbid: 'mbid-a' },
      { name: 'B', mbid: 'mbid-b' },
    ]);
    (prisma.yandexAlbum.findMany as any).mockResolvedValue([
      { artist: 'A', title: 'T', year: 2020, rgMbid: 'rg-1' }
    ]);
  });

  it('artists.json', async () => {
    const app = makeApp('/api/export', exportRouter);
    const res = await request(app).get('/api/export/artists.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.text).toContain('"MusicBrainzId"');
  });

  it('albums.json', async () => {
    const app = makeApp('/api/export', exportRouter);
    const res = await request(app).get('/api/export/albums.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.text).toContain('"ReleaseGroupMBID"');
  });

  it('artists.csv', async () => {
    const app = makeApp('/api/export', exportRouter);
    const res = await request(app).get('/api/export/artists.csv');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Artist,MBID');
  });

  it('albums.csv', async () => {
    const app = makeApp('/api/export', exportRouter);
    const res = await request(app).get('/api/export/albums.csv');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Artist,Album,Year,ReleaseGroupMBID');
  });

  it('artists.md', async () => {
    const app = makeApp('/api/export', exportRouter);
    const res = await request(app).get('/api/export/artists.md');
    expect(res.status).toBe(200);
    expect(res.text).toContain('| Artist | MBID |');
  });

  it('albums.md', async () => {
    const app = makeApp('/api/export', exportRouter);
    const res = await request(app).get('/api/export/albums.md');
    expect(res.status).toBe(200);
    expect(res.text).toContain('| Artist | Album | Year |');
  });
});
