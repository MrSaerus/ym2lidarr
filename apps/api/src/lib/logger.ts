// apps/api/src/lib/logger.ts
import fs from 'node:fs';
import path from 'node:path';
import { DateRollingFileStream, RollingFileWriteStream } from 'streamroller';
import type { Writable } from 'node:stream';

export type LogLevelName = 'all'|'debug'|'info'|'warn'|'error'|'fatal'|'off';

const LEVEL_ORDER: Record<LogLevelName, number> = {
  all:0, debug:10, info:20, warn:30, error:40, fatal:50, off:100
};

function parseLevel(env?: string): LogLevelName {
  const v = (env || '').trim().toLowerCase();
  if (v in LEVEL_ORDER) return v as LogLevelName;
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

export type LogContext = Record<string, unknown>;
export type EventKey = string;

export interface Logger {
  level: LogLevelName;
  child(bindings: { scope?: string; ctx?: LogContext }): Logger;
  debug(msg: string, evt?: EventKey, ctx?: LogContext): void;
  info (msg: string, evt?: EventKey, ctx?: LogContext): void;
  warn (msg: string, evt?: EventKey, ctx?: LogContext): void;
  error(msg: string, evt?: EventKey, ctx?: LogContext): void;
  fatal(msg: string, evt?: EventKey, ctx?: LogContext): void;
}

function shouldLog(current: LogLevelName, target: LogLevelName) {
  return LEVEL_ORDER[current] <= LEVEL_ORDER[target];
}

type Sink = (rec: Record<string, unknown>) => void;

function makeConsoleSink(): Sink {
  return (rec) => {
    const line = JSON.stringify(rec);
    const lvl = String(rec.level);
    if (lvl === 'error' || lvl === 'fatal') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
  };
}

/** Файловые сinks с ротацией (включаются через LOG_TO_FILES=1) */
function makeFileSinks(): { combined?: Sink; errors?: Sink } {
  const enabled = process.env.LOG_TO_FILES === '1' || process.env.LOG_TO_FILES === 'true';
  if (!enabled) return {};

  const dir = process.env.LOG_DIR || '/var/log/app';
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}

  // Параметры ротации
  const maxSize = process.env.LOG_MAX_SIZE || '50M';      // по размеру
  const backups = Number(process.env.LOG_BACKUPS || 14);  // сколько бэкапов хранить
  const pattern = process.env.LOG_DATE_PATTERN || 'yyyy-MM-dd'; // ежедневный сплит

  // Ежедневный сплит + size backup (streamroller поддерживает оба типа потоков)
  const combinedPath = path.join(dir, 'combined.log');
  const errorPath    = path.join(dir, 'error.log');

  // Для ежедневных логов:
  const combinedDaily = new DateRollingFileStream(combinedPath, pattern, {
    daysToKeep: backups,
    compress: true
  });
  const errorDaily = new DateRollingFileStream(errorPath, pattern, {
    daysToKeep: backups,
    compress: true
  });

  // Дополнительно — защитный size-rolling (если кто-то пишет очень много за день)
  const combinedSize = new RollingFileWriteStream(combinedPath, {
    maxSize, backups, compress: true
  });
  const errorSize = new RollingFileWriteStream(errorPath, {
    maxSize, backups, compress: true
  });

  const write = (w: Writable) => (rec: Record<string, unknown>) => {
    w.write(JSON.stringify(rec) + '\n');
  };

  // Комбинируем «дневной» и «по размеру»: пишем в оба — любой из них сможет ротировать
  const combined: Sink = (rec) => { write(combinedDaily)(rec); write(combinedSize)(rec); };
  const errors: Sink   = (rec) => { write(errorDaily)(rec); write(errorSize)(rec); };

  return { combined, errors };
}

const consoleSink = makeConsoleSink();
const fileSinks = makeFileSinks();

export type LoggerOptions = {
  level?: LogLevelName;
  scope?: string;
  ctx?: LogContext;
  sink?: Sink;           // только для тестов
};

class BaseLogger implements Logger {
  public level: LogLevelName;
  private scope?: string;
  private baseCtx?: LogContext;
  private sink?: Sink; // необязательный кастомный

  constructor(opts: LoggerOptions = {}) {
    this.level = opts.level ?? parseLevel(process.env.LOG_LEVEL);
    this.scope = opts.scope;
    this.baseCtx = opts.ctx;
    this.sink = opts.sink;
  }

  child(bind: { scope?: string; ctx?: LogContext }): Logger {
    return new BaseLogger({
      level: this.level,
      scope: bind.scope ?? this.scope,
      ctx:   { ...(this.baseCtx || {}), ...(bind.ctx || {}) },
      sink:  this.sink
    });
  }

  private emit(target: LogLevelName, msg: string, evt?: EventKey, ctx?: LogContext) {
    if (!shouldLog(this.level, target)) return;

    const rec: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level: target,
      msg,
      ...(this.scope ? { scope: this.scope } : {}),
      ...(evt ? { evt } : {}),
      ...(this.baseCtx || {}),
      ...(ctx || {})
    };

    // 1) всегда пишем в stdout/stderr
    consoleSink(rec);

    // 2) если включены файловые — пишем в combined, а для error/fatal — ещё и в errors
    if (fileSinks.combined) fileSinks.combined(rec);
    if ((target === 'error' || target === 'fatal') && fileSinks.errors) fileSinks.errors(rec);
  }

  debug(msg: string, evt?: EventKey, ctx?: LogContext) { this.emit('debug', msg, evt, ctx); }
  info (msg: string, evt?: EventKey, ctx?: LogContext) { this.emit('info',  msg, evt, ctx); }
  warn (msg: string, evt?: EventKey, ctx?: LogContext) { this.emit('warn',  msg, evt, ctx); }
  error(msg: string, evt?: EventKey, ctx?: LogContext) { this.emit('error', msg, evt, ctx); }
  fatal(msg: string, evt?: EventKey, ctx?: LogContext) { this.emit('fatal', msg, evt, ctx); }
}

export function createLogger(opts?: LoggerOptions): Logger {
  return new BaseLogger(opts);
}
export const log = createLogger({ scope: 'app' });
