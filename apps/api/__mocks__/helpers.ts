import express from 'express';
import request from 'supertest';

export function makeApp(mountPath: string, router: any) {
  const app = express();
  app.use(express.json());
  app.use(mountPath, router);
  return app;
}

// Reset mock functions quickly
export function resetAllMocks() {
  jest.resetModules();
  jest.clearAllMocks();
}

export async function withServer(app: any, fn: (server: any, req: typeof request) => Promise<void>) {
  const server = app.listen(0);
  try {
    await fn(server, request);
  } finally {
    server.close();
  }
}

export {};