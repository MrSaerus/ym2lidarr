// apps/web/components/Toaster.tsx
import React, { useEffect, useState } from 'react';
import { subscribe } from '../lib/toast';
import type { ToastItem } from '../lib/toast';

function toneClasses(tone: ToastItem['tone']) {
  switch (tone) {
    case 'ok':   return 'bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/30';
    case 'warn': return 'bg-amber-500/15  text-amber-200  ring-1 ring-amber-500/30';
    case 'err':  return 'bg-rose-500/15   text-rose-200   ring-1 ring-rose-500/30';
    default:     return 'bg-slate-700/80  text-slate-200  ring-1 ring-slate-600/60';
  }
}

export default function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const unsub = subscribe((t) => {
      setItems((xs) => [t, ...xs].slice(0, 6));
      setTimeout(() => {
        setItems((xs) => xs.filter((x) => x.id !== t.id));
      }, t.timeoutMs);
    });
    return () => { unsub(); }; // cleanup гарантированно () => void
  }, []);

  return (
    <div className="fixed top-4 right-4 z-50 flex w-[min(92vw,380px)] flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto select-none rounded-xl px-3 py-2 text-sm shadow-xl backdrop-blur-md ${toneClasses(t.tone)} transition-all`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
