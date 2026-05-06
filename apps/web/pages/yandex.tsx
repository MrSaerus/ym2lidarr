// apps/web/pages/yandex.tsx
import React, { useCallback, useEffect, useState } from 'react';
import Nav from '../components/Nav';
import { api } from '../lib/api';
import { Table, Th, Td } from '../components/Table';
import { useRouter } from 'next/router';
import Footer from '../components/Footer';

type Target = 'artists' | 'albums' | 'tracks';
type MbFilter = 'all' | 'missing' | 'with';
type DownloadedFilter = 'all' | 'downloaded' | 'notDownloaded';

type YArtistRow = {
  id: number;
  name: string;
  yandexArtistId: number;
  yandexUrl: string;
  mbid?: string | null;
  mbUrl?: string | null;
};

type YAlbumRow = {
  id: number;
  title: string;
  artistName: string;
  yandexAlbumId: number;
  yandexUrl: string;
  rgMbid?: string | null;
  rgUrl?: string | null;
  year?: number | null;
};

type YTrackRow = {
  id: number;
  title: string;
  artistName: string;
  albumTitle?: string | null;
  durationSec?: number | null;
  yandexTrackId: number;
  yandexAlbumId?: number | null;
  yandexUrl: string;
  recMbid?: string | null;
  rgMbid?: string | null;
  mbUrl?: string | null;
  downloaded?: boolean;
};

type ApiResp<T> = { page: number; pageSize: number; total: number; items: T[] };

type SortFieldArtists = 'name' | 'id';
type SortFieldAlbums = 'title' | 'artist' | 'id';
type SortFieldTracks = 'title' | 'artist' | 'album' | 'id';

/* ==== Fixed link slots (Yandex | MusicBrainz) ==== */
const LINKS_COL_WIDTH = 'w-[14rem]';

function LinkSlot({
                    href,
                    label,
                    className,
                  }: {
  href?: string | null;
  label: 'Yandex' | 'MusicBrainz';
  className: string;
}) {
  if (!href) {
    return (
      <span className={`link-chip ${className} invisible select-none`} aria-hidden="true">
        {label}
      </span>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className={`link-chip ${className}`}>
      {label}
    </a>
  );
}

function LinksFixedRow({
                         yandexUrl,
                         mbUrl,
                       }: {
  yandexUrl?: string | null;
  mbUrl?: string | null;
}) {
  return (
    <div className={`grid grid-cols-2 gap-2 justify-items-center ${LINKS_COL_WIDTH}`}>
      <LinkSlot href={yandexUrl} label="Yandex" className="link-chip--ym" />
      <LinkSlot href={mbUrl} label="MusicBrainz" className="link-chip--mb" />
    </div>
  );
}

function DownloadedCheck({ downloaded }: { downloaded?: boolean }) {
  if (!downloaded) return <span className="text-gray-600">—</span>;
  return (
    <span className="inline-flex items-center justify-end text-emerald-400 font-bold" title="Downloaded" aria-label="Downloaded">
          ✓
      </span>
  );
}
/* ================================================ */

export default function YandexPage() {
  const router = useRouter();

  const [target, setTarget] = useState<Target>('artists');
  const [rows, setRows] = useState<(YArtistRow | YAlbumRow | YTrackRow)[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [total, setTotal] = useState(0);

  const [sortByArtists, setSortByArtists] = useState<SortFieldArtists>('name');
  const [sortDirArtists, setSortDirArtists] = useState<'asc' | 'desc'>('asc');
  const [sortByAlbums, setSortByAlbums] = useState<SortFieldAlbums>('title');
  const [sortDirAlbums, setSortDirAlbums] = useState<'asc' | 'desc'>('asc');
  const [sortByTracks, setSortByTracks] = useState<SortFieldTracks>('title');
  const [sortDirTracks, setSortDirTracks] = useState<'asc' | 'desc'>('asc');

  const [mbFilter, setMbFilter] = useState<MbFilter>('all');
  const [downloadedFilter, setDownloadedFilter] = useState<DownloadedFilter>('all');

  useEffect(() => {
    if (!router.isReady) return;
    const t = router.query.target as string | undefined;
    if (t === 'albums' || t === 'artists' || t === 'tracks') setTarget(t);

    const qp = router.query.page as string | undefined;
    const qs = router.query.pageSize as string | undefined;
    const qq = router.query.q as string | undefined;

    const sba = router.query.sortByArtists as string | undefined;
    const sda = router.query.sortDirArtists as string | undefined;
    const sbb = router.query.sortByAlbums as string | undefined;
    const sdb = router.query.sortDirAlbums as string | undefined;
    const sbt = router.query.sortByTracks as string | undefined;
    const sdt = router.query.sortDirTracks as string | undefined;

    const qMb = router.query.mb as string | undefined;
    const qMissingMb = router.query.missingMb as string | undefined;
    const qDownloaded = router.query.downloaded as string | undefined;

    if (qp) setPage(Math.max(1, parseInt(qp, 10) || 1));
    if (qs) setPageSize(Math.max(1, parseInt(qs, 10) || 50));
    if (typeof qq === 'string') setQ(qq);

    if (sba === 'name' || sba === 'id') setSortByArtists(sba as SortFieldArtists);
    if (sda === 'asc' || sda === 'desc') setSortDirArtists(sda);
    if (sbb === 'title' || sbb === 'artist' || sbb === 'id') setSortByAlbums(sbb as SortFieldAlbums);
    if (sdb === 'asc' || sdb === 'desc') setSortDirAlbums(sdb);
    if (sbt === 'title' || sbt === 'artist' || sbt === 'album' || sbt === 'id') setSortByTracks(sbt as SortFieldTracks);
    if (sdt === 'asc' || sdt === 'desc') setSortDirTracks(sdt);

    if (qMb === 'all' || qMb === 'missing' || qMb === 'with') setMbFilter(qMb);
    else setMbFilter(qMissingMb === '1' ? 'missing' : 'all');

    if (qDownloaded === 'downloaded' || qDownloaded === 'notDownloaded') setDownloadedFilter(qDownloaded);
    else setDownloadedFilter('all');
  }, [
    router.isReady,
    router.query.target,
    router.query.page,
    router.query.pageSize,
    router.query.q,
    router.query.sortByArtists,
    router.query.sortDirArtists,
    router.query.sortByAlbums,
    router.query.sortDirAlbums,
    router.query.sortByTracks,
    router.query.sortDirTracks,
    router.query.mb,
    router.query.missingMb,
    router.query.downloaded,
  ]);

  const load = useCallback(
    async (p = page) => {
      setLoading(true);
      setErrorMsg('');
      try {
        const sortBy = target === 'artists' ? sortByArtists : target === 'albums' ? sortByAlbums : sortByTracks;
        const sortDir = target === 'artists' ? sortDirArtists : target === 'albums' ? sortDirAlbums : sortDirTracks;

        const params = new URLSearchParams({
          page: String(p),
          pageSize: String(pageSize),
          q,
          sortBy: sortBy as string,
          sortDir,
          mb: mbFilter,
        } as Record<string, string>);

        if (target === 'tracks' && downloadedFilter !== 'all') params.set('downloaded', downloadedFilter);

        const path = `/api/yandex/${target}?${params.toString()}`;

        const r = await api<ApiResp<YArtistRow | YAlbumRow | YTrackRow>>(path);
        setRows(r.items || []);
        setPage(p);
        setTotal(r.total || 0);
      } catch (e: any) {
        setErrorMsg(e?.message || String(e));
        setRows([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize, q, target, sortByArtists, sortDirArtists, sortByAlbums, sortDirAlbums, sortByTracks, sortDirTracks, mbFilter, downloadedFilter]
  );

  useEffect(() => {
    if (!router.isReady) return;
    load(page);
  }, [
    router.isReady,
    page,
    q,
    pageSize,
    target,
    sortByArtists,
    sortDirArtists,
    sortByAlbums,
    sortDirAlbums,
    sortByTracks,
    sortDirTracks,
    mbFilter,
    downloadedFilter,
    load,
  ]);

  function updateUrl(params: Record<string, string>) {
    if (!router.isReady) return;
    router.replace({ pathname: router.pathname, query: { ...router.query, ...params } }, undefined, {
      shallow: true,
    });
  }

  function baseQuery(extra: Record<string, string> = {}) {
    return {
      target,
      page: String(page),
      pageSize: String(pageSize),
      q,
      sortByArtists,
      sortDirArtists,
      sortByAlbums,
      sortDirAlbums,
      sortByTracks,
      sortDirTracks,
      mb: mbFilter,
      downloaded: downloadedFilter,
      ...extra,
    };
  }

  function setTargetAndUrl(t: Target) {
    setTarget(t);
    setPage(1);
    updateUrl(baseQuery({ target: t, page: '1' }));
  }

  function setPageAndUrl(p: number) {
    setPage(p);
    updateUrl(baseQuery({ page: String(p) }));
  }

  function setPageSizeAndUrl(ps: number) {
    setPageSize(ps);
    setPage(1);
    updateUrl(baseQuery({ page: '1', pageSize: String(ps) }));
  }

  function setQAndUrl(newQ: string) {
    setQ(newQ);
    setPage(1);
    updateUrl(baseQuery({ page: '1', q: newQ }));
  }

  function setSortArtistsAndUrl(field: SortFieldArtists) {
    const dir = sortByArtists === field ? (sortDirArtists === 'asc' ? 'desc' : 'asc') : 'asc';
    setSortByArtists(field);
    setSortDirArtists(dir);
    setPage(1);
    updateUrl(baseQuery({ page: '1', sortByArtists: field, sortDirArtists: dir }));
  }

  function setSortAlbumsAndUrl(field: SortFieldAlbums) {
    const dir = sortByAlbums === field ? (sortDirAlbums === 'asc' ? 'desc' : 'asc') : 'asc';
    setSortByAlbums(field);
    setSortDirAlbums(dir);
    setPage(1);
    updateUrl(baseQuery({ page: '1', sortByAlbums: field, sortDirAlbums: dir }));
  }

  function setSortTracksAndUrl(field: SortFieldTracks) {
    const dir = sortByTracks === field ? (sortDirTracks === 'asc' ? 'desc' : 'asc') : 'asc';
    setSortByTracks(field);
    setSortDirTracks(dir);
    setPage(1);
    updateUrl(baseQuery({ page: '1', sortByTracks: field, sortDirTracks: dir }));
  }

  function setMbFilterAndUrl(val: MbFilter) {
    setMbFilter(val);
    setPage(1);
    updateUrl(baseQuery({ page: '1', mb: val, missingMb: val === 'missing' ? '1' : '0' }));
  }

  function setDownloadedFilterAndUrl(val: DownloadedFilter) {
    setDownloadedFilter(val);
    setPage(1);
    updateUrl(baseQuery({ page: '1', downloaded: val }));
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const headerArrow = (active: boolean, dir: 'asc' | 'desc') =>
    active ? (
      <span className="text-xs text-gray-500">
        {dir === 'asc' ? '▲' : '▼'}
      </span>
    ) : null;

  const searchPlaceholder =
    target === 'artists'
      ? 'Search by name…'
      : target === 'albums'
        ? 'Search title or artist…'
        : 'Search title, artist or album…';

  const emptyColSpan = target === 'artists' ? 3 : target === 'albums' ? 4 : 6;

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-6xl px-4 py-4">
        <h1 className="h1">Yandex</h1>

        <div className="toolbar">
          <div className="inline-flex rounded-md overflow-hidden ring-1 ring-slate-800">
            <button
              className={`btn ${target === 'artists' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setTargetAndUrl('artists')}
            >
              Artists
            </button>
            <button
              className={`btn ${target === 'albums' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setTargetAndUrl('albums')}
            >
              Albums
            </button>
            <button
              className={`btn ${target === 'tracks' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setTargetAndUrl('tracks')}
            >
              Tracks
            </button>
          </div>

          <div className="ml-3 inline-flex rounded-md overflow-hidden ring-1 ring-slate-800">
            <button
              className={`btn ${mbFilter === 'all' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setMbFilterAndUrl('all')}
              title="Show all"
            >
              All
            </button>
            <button
              className={`btn ${mbFilter === 'missing' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setMbFilterAndUrl('missing')}
              title="Show only entries without MusicBrainz mapping"
            >
              No MusicBrainz
            </button>
            <button
              className={`btn ${mbFilter === 'with' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setMbFilterAndUrl('with')}
              title="Show only entries with MusicBrainz mapping"
            >
              With MusicBrainz
            </button>
          </div>

          {target === 'tracks' ? (
            <div className="ml-3 inline-flex rounded-md overflow-hidden ring-1 ring-slate-800">
              <button
                className={`btn ${downloadedFilter === 'all' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setDownloadedFilterAndUrl('all')}
              >
                All tracks
              </button>
              <button
                className={`btn ${downloadedFilter === 'downloaded' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setDownloadedFilterAndUrl('downloaded')}
              >
                Downloaded
              </button>
              <button
                className={`btn ${downloadedFilter === 'notDownloaded' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setDownloadedFilterAndUrl('notDownloaded')}
              >
                Not downloaded
              </button>
            </div>
          ) : null}
        </div>

        <div className="toolbar">
          <input
            placeholder={searchPlaceholder}
            className="input w-80"
            value={q}
            onChange={(e) => setQAndUrl(e.target.value)}
          />
          <button className="btn btn-outline" onClick={() => load(page)} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        <div className="toolbar">
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-gray-500 text-nowrap">Rows per page:</span>
            <select
              className="bg-slate-900 text-slate-100 text-sm border border-slate-700 rounded px-2 py-1"
              value={pageSize}
              onChange={(e) => setPageSizeAndUrl(Number(e.target.value))}
            >
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1">
              <button className="btn btn-outline" onClick={() => setPageAndUrl(1)} disabled={page <= 1}>
                {'«'}
              </button>
              <button
                className="btn btn-outline"
                onClick={() => setPageAndUrl(Math.max(1, page - 1))}
                disabled={page <= 1}
              >
                {'‹'}
              </button>
              <span className="text-xs text-gray-500 px-2">Page {page}/{pageCount}</span>
              <button
                className="btn btn-outline"
                onClick={() => setPageAndUrl(Math.min(pageCount, page + 1))}
                disabled={page >= pageCount}
              >
                {'›'}
              </button>
              <button className="btn btn-outline" onClick={() => setPageAndUrl(pageCount)} disabled={page >= pageCount}>
                {'»'}
              </button>
            </div>
          </div>
        </div>

        {errorMsg && <div className="panel p-3 text-red-500 text-sm">{errorMsg}</div>}

        <div className="panel overflow-x-auto">
          <Table className="table-default">
            <thead>
            <tr>
              <Th>#</Th>
              {target === 'artists' ? (
                <>
                  <Th className="select-none">
                    <button
                      type="button"
                      onClick={() => setSortArtistsAndUrl('name')}
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      Name {headerArrow(sortByArtists === 'name', sortDirArtists)}
                    </button>
                  </Th>
                  <Th className={`text-center ${LINKS_COL_WIDTH}`}>Links</Th>
                </>
              ) : target === 'albums' ? (
                <>
                  <Th className="select-none">
                    <button
                      type="button"
                      onClick={() => setSortAlbumsAndUrl('title')}
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      Album {headerArrow(sortByAlbums === 'title', sortDirAlbums)}
                    </button>
                  </Th>
                  <Th className="select-none">
                    <button
                      type="button"
                      onClick={() => setSortAlbumsAndUrl('artist')}
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      Artist {headerArrow(sortByAlbums === 'artist', sortDirAlbums)}
                    </button>
                  </Th>
                  <Th className={`text-center ${LINKS_COL_WIDTH}`}>Links</Th>
                </>
              ) : (
                <>
                  <Th className="select-none">
                    <button
                      type="button"
                      onClick={() => setSortTracksAndUrl('title')}
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      Track {headerArrow(sortByTracks === 'title', sortDirTracks)}
                    </button>
                  </Th>
                  <Th className="select-none">
                    <button
                      type="button"
                      onClick={() => setSortTracksAndUrl('artist')}
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      Artist {headerArrow(sortByTracks === 'artist', sortDirTracks)}
                    </button>
                  </Th>
                  <Th className="select-none">
                    <button
                      type="button"
                      onClick={() => setSortTracksAndUrl('album')}
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      Album {headerArrow(sortByTracks === 'album', sortDirTracks)}
                    </button>
                  </Th>
                  <Th className={`text-center ${LINKS_COL_WIDTH}`}>Links</Th>
                  <Th className="text-right">Downloaded</Th>
                </>
              )}
            </tr>
            </thead>
            <tbody>
            {rows.length === 0 ? (
              <tr>
                <Td colSpan={emptyColSpan}>
                  <div className="p-4 text-center text-gray-500">{loading ? 'Loading…' : 'No data'}</div>
                </Td>
              </tr>
            ) : target === 'artists' ? (
              (rows as YArtistRow[]).map((r, i) => {
                const missing = !r.mbid;
                return (
                  <tr key={`${r.yandexArtistId}-${i}`} className={missing ? 'opacity-100' : ''}>
                    <Td>{i + 1 + (page - 1) * pageSize}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <span>{r.name || '—'}</span>
                      </div>
                    </Td>
                    <Td className="text-center">
                      <LinksFixedRow yandexUrl={r.yandexUrl} mbUrl={(r.mbid ? r.mbUrl : undefined) || undefined} />
                    </Td>
                  </tr>
                );
              })
            ) : target === 'albums' ? (
              (rows as YAlbumRow[]).map((r, i) => {
                const missing = !r.rgMbid;
                return (
                  <tr key={`${r.yandexAlbumId}-${i}`} className={missing ? 'opacity-100' : ''}>
                    <Td>{i + 1 + (page - 1) * pageSize}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <span>{r.title || '—'}</span>
                      </div>
                    </Td>
                    <Td>{r.artistName || '—'}</Td>
                    <Td className="text-center">
                      <LinksFixedRow yandexUrl={r.yandexUrl} mbUrl={(r.rgMbid ? r.rgUrl : undefined) || undefined} />
                    </Td>
                  </tr>
                );
              })
            ) : (
              (rows as YTrackRow[]).map((r, i) => {
                const missing = !r.recMbid && !r.rgMbid;
                return (
                  <tr key={`${r.yandexTrackId}-${i}`} className={missing ? 'opacity-100' : ''}>
                    <Td>{i + 1 + (page - 1) * pageSize}</Td>
                    <Td>{r.title || '—'}</Td>
                    <Td>{r.artistName || '—'}</Td>
                    <Td>{r.albumTitle || '—'}</Td>
                    <Td className="text-center">
                      <LinksFixedRow yandexUrl={r.yandexUrl} mbUrl={r.mbUrl || undefined} />
                    </Td>
                    <Td className="text-right pr-4">
                      <DownloadedCheck downloaded={r.downloaded} />
                    </Td>
                  </tr>
                );
              })
            )}
            </tbody>
          </Table>
        </div>
      </main>
      <Footer />
    </>
  );
}
