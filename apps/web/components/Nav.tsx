import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  HomeIcon,
  Cog6ToothIcon,
  ArchiveBoxArrowDownIcon,
  QueueListIcon, MusicalNoteIcon, InboxStackIcon, PlayIcon, ServerStackIcon,
} from '@heroicons/react/24/outline';

const tabs = [
  { href: '/', label: 'Overview', Icon: HomeIcon },
  { href: '/lidarr', label: 'Lidarr', Icon: ServerStackIcon },
  { href: '/yandex', label: 'Yandex', Icon: MusicalNoteIcon },
  { href: '/custom', label: 'Custom', Icon: PlayIcon },
  { href: '/unified', label: 'Unified', Icon: InboxStackIcon },
  { href: '/settings', label: 'Settings', Icon: Cog6ToothIcon },
  { href: '/backups', label: 'Backups', Icon: ArchiveBoxArrowDownIcon },
  { href: '/logs', label: 'Live Logs', Icon: QueueListIcon },
];

export default function Nav() {
  const r = useRouter();
  return (
      <nav className="px-4 py-3 border-b" style={{ borderColor: 'var(--panel-border)' }}>
        <div className="mx-auto max-w-6xl flex flex-wrap items-center gap-2">
          <span className="font-bold mr-2">YM → Lidarr</span>
          {tabs.map(({ href, label, Icon }) => {
            const active = r.pathname === href;
            return (
                <Link
                    key={href}
                    href={href}
                    className={`tab ${active ? 'tab--active' : ''}`}
                >
                  <Icon className="icon" />
                  <span>{label}</span>
                </Link>
            );
          })}
        </div>
      </nav>
  );
}
