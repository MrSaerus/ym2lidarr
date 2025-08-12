import Link from 'next/link';
import { useRouter } from 'next/router';

const tabs = [
  { href: '/', label: 'Overview' },
  { href: '/found', label: 'Found' },
  { href: '/unmatched', label: 'Unmatched' },
  { href: '/settings', label: 'Settings' },
  { href: '/backups', label: 'Backups' },
  { href: '/logs', label: 'Live Logs' },
];

export default function Nav() {
  const r = useRouter();
  const path = (r.asPath || r.pathname || '/').split('?')[0];

  const isActive = (href: string) => {
    if (href === '/') return path === '/';
    return path === href || path.startsWith(href + '/');
  };

  return (
      <nav style={{ padding: '12px 16px', borderBottom: '1px solid #eee', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700 }}>YM → Lidarr</span>
          {tabs.map((t) => {
            const active = isActive(t.href);
            return (
                <Link
                    key={t.href}
                    href={t.href}
                    style={{
                      textDecoration: 'none',
                      padding: '6px 10px',
                      borderRadius: 6,
                      background: active ? '#eef2ff' : 'transparent',
                      color: active ? '#3730a3' : '#111',
                      border: active ? '1px solid #c7d2fe' : '1px solid transparent',
                    }}
                >
                  {t.label}
                </Link>
            );
          })}
        </div>
      </nav>
  );
}
