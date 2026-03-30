// apps/api/src/instance.ts
import os from 'os';
import crypto from 'crypto';

export const instanceId =
    `${os.hostname()}-${process.pid}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
