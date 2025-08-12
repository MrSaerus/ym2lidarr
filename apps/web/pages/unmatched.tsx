import { useEffect, useState } from 'react';
import Nav from '../components/Nav';
import { api } from '../lib/api';

type UnmatchedArtistsResp = {
  type: 'artists';
  total: number;
  items: {
    id: number;
    name: string;
    candidates: {
      id?: string;
      name?: string;
      score?: number | null;
      type?: string | null;
      country?: string | null;
      url?: string | null;
      highlight?: boolean;
    }[];
  }[];
};
type UnmatchedAlbumsResp = {
  type: 'albums';
  total: number;
  items: {
    id: number;
    artist: string;
    title: string;
    year?: number | null;
    candidates: {
      id?: string;
      title?: string;
      primaryType?: string | null;
      firstReleaseDate?: string | null;
      primaryArtist?: string | null;
      score?: number | null;
      url?: string | null;
      highlight?: boolean;
    }[];
  }[];
};

export default function UnmatchedPage() {
  const [type, setType] = useState<'artists' | 'albums'>('artists');
  const [data, setData] = useState<UnmatchedArtistsResp | UnmatchedAlbumsResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [limit, setLimit] = useState(200);
  const [offset, setOffset] = useState(0);

  async function load() {
    try {
      const res = await api<UnmatchedArtistsResp | UnmatchedAlbumsResp>(
        `/api/unmatched?type=${type}&limit=${limit}&offset=${offset}`,
      );
      setData(res);
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }

  useEffect(() => {
    load();
  }, [type, limit, offset]);

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto' }}>
      <Nav />
      <div style={{ padding: 16 }}>
        <h1>Unmatched</h1>

        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            marginBottom: 12,
            flexWrap: 'wrap',
          }}
        >
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value as any);
              setOffset(0);
            }}
          >
            <option value="artists">Artists</option>
            <option value="albums">Albums</option>
          </select>
          <span style={{ opacity: 0.8 }}>Total: {data?.total ?? 0}</span>
          <label>
            Limit:&nbsp;
            <input
              type="number"
              min={10}
              max={1000}
              value={limit}
              onChange={(e) =>
                setLimit(Math.max(10, Math.min(1000, parseInt(e.target.value || '0', 10))))
              }
            />
          </label>
          <label>
            Offset:&nbsp;
            <input
              type="number"
              min={0}
              value={offset}
              onChange={(e) => setOffset(Math.max(0, parseInt(e.target.value || '0', 10)))}
            />
          </label>
          <button onClick={load}>Reload</button>
        </div>

        {err && (
          <div
            style={{
              background: '#fee2e2',
              border: '1px solid #fecaca',
              padding: 8,
              borderRadius: 6,
              marginBottom: 12,
            }}
          >
            {err}
          </div>
        )}

        {!data ? (
          <p>Loading…</p>
        ) : type === 'artists' ? (
          <ArtistsTable data={data as UnmatchedArtistsResp} />
        ) : (
          <AlbumsTable data={data as UnmatchedAlbumsResp} />
        )}
      </div>
    </main>
  );
}

function ymArtistLink(name: string) {
  return `https://music.yandex.ru/search?text=${encodeURIComponent(name)}&type=artists`;
}
function ymAlbumLink(artist: string, title: string) {
  return `https://music.yandex.ru/search?text=${encodeURIComponent(`${artist} ${title}`)}&type=albums`;
}

function ArtistsTable({ data }: { data: UnmatchedArtistsResp }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <Th>#</Th>
          <Th>Artist</Th>
          <Th>YM</Th>
          <Th>Candidates</Th>
        </tr>
      </thead>
      <tbody>
        {data.items.map((a, i) => (
          <tr key={a.id} style={{ borderTop: '1px solid #eee' }}>
            <Td mono>{i + 1}</Td>
            <Td>{a.name}</Td>
            <Td>
              <a href={ymArtistLink(a.name)} target="_blank" rel="noreferrer">
                YM
              </a>
            </Td>
            <Td>
              {!a.candidates?.length ? (
                <i style={{ opacity: 0.6 }}>no candidates</i>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {a.candidates.map((c, j) => (
                    <li key={j} style={{ color: c.highlight ? '#22c55e' : undefined }}>
                      {c.name || c.id}
                      {c.type && <> • {c.type}</>}
                      {c.country && <> • {c.country}</>}
                      {typeof c.score === 'number' && <> • score {c.score}</>}
                      {c.url && (
                        <>
                          {' '}
                          •{' '}
                          <a href={c.url} target="_blank" rel="noreferrer">
                            open
                          </a>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AlbumsTable({ data }: { data: UnmatchedAlbumsResp }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <Th>#</Th>
          <Th>Artist</Th>
          <Th>Album</Th>
          <Th>Year</Th>
          <Th>YM</Th>
          <Th>Candidates</Th>
        </tr>
      </thead>
      <tbody>
        {data.items.map((al, i) => (
          <tr key={al.id} style={{ borderTop: '1px solid #eee' }}>
            <Td mono>{i + 1}</Td>
            <Td>{al.artist}</Td>
            <Td>{al.title}</Td>
            <Td mono>{al.year ?? ''}</Td>
            <Td>
              <a href={ymAlbumLink(al.artist, al.title)} target="_blank" rel="noreferrer">
                YM
              </a>
            </Td>
            <Td>
              {!al.candidates?.length ? (
                <i style={{ opacity: 0.6 }}>no candidates</i>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {al.candidates.map((c, j) => (
                    <li key={j} style={{ color: c.highlight ? '#22c55e' : undefined }}>
                      {c.title || c.id}
                      {c.primaryType && <> • {c.primaryType}</>}
                      {c.firstReleaseDate && <> • {c.firstReleaseDate}</>}
                      {c.primaryArtist && <> • by {c.primaryArtist}</>}
                      {typeof c.score === 'number' && <> • score {c.score}</>}
                      {c.url && (
                        <>
                          {' '}
                          •{' '}
                          <a href={c.url} target="_blank" rel="noreferrer">
                            open
                          </a>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Th({ children }: any) {
  return (
    <th style={{ textAlign: 'left', padding: '8px 6px', fontSize: 13, opacity: 0.75 }}>
      {children}
    </th>
  );
}
function Td({ children, mono = false }: any) {
  return (
    <td
      style={{
        padding: '8px 6px',
        fontFamily: mono
          ? 'ui-monospace, Menlo, Monaco, Consolas, "Courier New", monospace'
          : undefined,
      }}
    >
      {children}
    </td>
  );
}
