// apps/api/src/lib/log.ts
export type LogLevelName = 'all'|'debug'|'info'|'warn'|'error'|'fatal'|'off';
const LEVEL_ORDER: Record<LogLevelName, number> = {
  all:0, debug:10, info:20, warn:30, error:40, fatal:50, off:100
};

function parseLevel(v?: string): LogLevelName {
  const x = (v||'').trim().toLowerCase();
  return (x in LEVEL_ORDER ? (x as LogLevelName) : (process.env.NODE_ENV === 'production' ? 'info' : 'debug'));
}

export class FrontLog {
  level: LogLevelName;
  scope?: string;

  constructor(scope?: string, level?: LogLevelName) {
    this.scope = scope;
    this.level = level ?? parseLevel(process.env.NEXT_PUBLIC_LOG_LEVEL);
  }
  child(scope: string) { return new FrontLog(scope, this.level); }

  private ok(target: LogLevelName) { return LEVEL_ORDER[this.level] <= LEVEL_ORDER[target]; }
  private out(target: LogLevelName, msg: string, ctx?: Record<string, unknown>) {
    const head = `[${new Date().toISOString()}][${target}${this.scope?':'+this.scope:''}]`;
    const payload = ctx ? [head, msg, ctx] : [head, msg];
    if (target === 'error' || target === 'fatal') console.error(...payload);
    else if (target === 'warn') console.warn(...payload);
    else if (target === 'info') console.info(...payload);
    else console.debug(...payload);
  }

  debug(msg: string, ctx?: any) { if (this.ok('debug')) this.out('debug', msg, ctx); }
  info (msg: string, ctx?: any) { if (this.ok('info'))  this.out('info', msg, ctx); }
  warn (msg: string, ctx?: any) { if (this.ok('warn'))  this.out('warn', msg, ctx); }
  error(msg: string, ctx?: any) { if (this.ok('error')) this.out('error', msg, ctx); }
  fatal(msg: string, ctx?: any) { if (this.ok('fatal')) this.out('fatal', msg, ctx); }
}

export const log = new FrontLog('web');
