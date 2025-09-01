// apps/web/lib/toast.ts
export type ToastTone = 'ok' | 'warn' | 'err' | 'muted';
export type ToastItem = {
  id: number;
  text: string;
  tone: ToastTone;
  timeoutMs: number;
};

type Sub = (t: ToastItem) => void;

let _id = 1;
const subs = new Set<Sub>();

export function subscribe(fn: Sub) {
  subs.add(fn);
  return () => {
    subs.delete(fn); // игнорируем boolean
  };
}

export function toast(text: string, tone: ToastTone = 'ok', timeoutMs = 4000) {
  const item: ToastItem = { id: _id++, text, tone, timeoutMs };
  subs.forEach((fn) => fn(item));
  return item.id;
}

export const toastOk   = (t: string, ms?: number) => toast(t, 'ok',   ms ?? 4000);
export const toastWarn = (t: string, ms?: number) => toast(t, 'warn', ms ?? 6000);
export const toastErr  = (t: string, ms?: number) => toast(t, 'err',  ms ?? 8000);
