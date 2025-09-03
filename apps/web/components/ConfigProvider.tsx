// apps/web/components/ConfigProvider.tsx
import React, { useEffect } from 'react';

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window as any;
    if (w.__CONFIG_LOADED__) return;

    const s = document.createElement('script');
    s.src = '/config.js';
    s.async = false;
    s.onload = () => { w.__CONFIG_LOADED__ = true; };
    s.onerror = () => { console.warn('Failed to load /config.js'); };
    document.head.appendChild(s);
  }, []);

  return <>{children}</>;
}