import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { applySchema, openDatabase } from './db.js';

export function createApp(): Hono {
  const app = new Hono();
  app.get('/health', (c) => c.json({ ok: true }));
  return app;
}

export const app = createApp();

export function start(): void {
  const db = openDatabase();
  applySchema(db);
  const port = Number(process.env.PORT ?? 3000);
  serve({
    fetch: app.fetch,
    hostname: '127.0.0.1',
    port,
  });
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  start();
}
