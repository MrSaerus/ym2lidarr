// /apps/web/components/Nav.tsx
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
      <div className="mx-auto max-w-6xl">
        {/* Лента вкладок со скроллом на мобилке */}
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold mr-2 whitespace-nowrap">YM → Lidarr</span>
          {/* при желании сюда можно вынести кнопку меню */}
        </div>

        <div
          className="mt-2 flex gap-2 overflow-x-auto no-scrollbar snap-x snap-mandatory -mx-4 px-4"
          /* плавный скролл и отключение подсветки за границами */
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {tabs.map(({ href, label, Icon }) => {
            const active = r.pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`tab ${active ? 'tab--active' : ''} snap-start shrink-0`}
              >
                <Icon className="icon" />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
