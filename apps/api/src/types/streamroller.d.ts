declare module 'streamroller' {
  import { Writable } from 'stream';

  export interface DateRollingOptions {
    daysToKeep?: number;
    compress?: boolean;
  }

  export interface SizeRollingOptions {
    maxSize?: number | string; // например "50M"
    backups?: number;
    compress?: boolean;
  }

  export class DateRollingFileStream extends Writable {
    constructor(filename: string, pattern?: string, options?: DateRollingOptions);
  }

  export class RollingFileWriteStream extends Writable {
    constructor(filename: string, options?: SizeRollingOptions);
  }
}
