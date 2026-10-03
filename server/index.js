import 'dotenv/config';
import express from 'express';
import { join } from 'node:path';
import { openDatabase } from './db.js';

const port = Number(process.env.PORT || 3000);
const dbPath = process.env.DATABASE_PATH || join(process.cwd(), 'data', 'notify-pages.sqlite');
const db = openDatabase(dbPath);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// Liveness. Confirms the process and the schema are up.
app.get('/health', (_req, res) => {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name);
  res.json({ ok: true, tables });
});

app.get('/', (_req, res) => {
  res.type('text').send('notify-pages\nserver skeleton is up. public pages come next.\n');
});

app.listen(port, () => {
  console.log(`notify-pages listening on :${port} (db ${dbPath})`);
});
