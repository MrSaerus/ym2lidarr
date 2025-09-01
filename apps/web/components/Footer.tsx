// apps/web/components/Footer.tsx
import React from 'react';
import { BUILD, formatBuildDate } from '../lib/buildInfo';

export default function Footer() {
  const hasCommit = Boolean(BUILD.commit);
  const hasRepo = Boolean(BUILD.repoUrl);

  const verNode = hasRepo
    ? (
      <a
        href={
          // если тег — ведём на релиз/тег, иначе просто на репо
          BUILD.version && BUILD.version !== 'dev'
            ? `${BUILD.repoUrl}/releases/tag/${encodeURIComponent(BUILD.version)}`
            : BUILD.repoUrl
        }
        target="_blank"
        rel="noreferrer"
        className="hover:underline"
      >
        v{BUILD.version}
      </a>
    )
    : <>v{BUILD.version}</>;

  const commitNode = hasRepo && hasCommit
    ? (
      <a
        href={`${BUILD.repoUrl}/commit/${BUILD.commit}`}
        target="_blank"
        rel="noreferrer"
        className="hover:underline font-mono"
        title={BUILD.commit}
      >
        {BUILD.commit}
      </a>
    )
    : (hasCommit ? <span className="font-mono">{BUILD.commit}</span> : null);

  const dateNode = BUILD.dateIso ? formatBuildDate(BUILD.dateIso) : null;

  return (
    <footer className="px-4 py-6 border-t" style={{ borderColor: 'var(--panel-border)' }}>
      <div className="mx-auto max-w-6xl text-xs text-gray-400 flex flex-wrap items-center gap-3">
        <span>© {new Date().getFullYear()} YM → Lidarr</span>
        <span className="text-gray-600">•</span>
        <span>Release: {verNode}{commitNode ? <> ({commitNode})</> : null}{dateNode ? <> • {dateNode}</> : null}</span>
      </div>
    </footer>
  );
}
