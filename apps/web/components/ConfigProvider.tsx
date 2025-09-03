// apps/web/components/ConfigProvider.tsx
import React, { useEffect, useState } from 'react';

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(typeof window === 'undefined'); // на SSR уже "готово"

  useEffect(() => {
    if (typeof window === 'undefined') return;          // SSR
    if ((window as any).__CONFIG_LOADED__) { setReady(true); return; }

    const s = document.createElement('script');
    s.src = '/config.js';
    s.async = false;
    s.onload = () => { (window as any).__CONFIG_LOADED__ = true; setReady(true); };
    s.onerror = () => { console.warn('Failed to load /config.js'); setReady(true); };
    document.head.appendChild(s);
  }, []);

  if (!ready) return <div style={{ padding: 16 }}>Loading…</div>;
  return <>{children}</>;
}
