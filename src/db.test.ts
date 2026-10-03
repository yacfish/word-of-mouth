import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { applySchema, openDatabase } from './db.js';
import { app } from './server.js';

test('schema, integrity, and health', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wom-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const db = openDatabase(dbPath);
  try {
    applySchema(db);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    assert.deepEqual(
      tables.map((row) => row.name),
      ['devices', 'pages', 'posts', 'publish_requests', 'publishers', 'subscriptions', 'users'],
    );

    const now = '2026-10-03T00:00:00.000Z';
    const user = db
      .prepare(
        'INSERT INTO users (provider, subject, display_name, created_at) VALUES (?, ?, ?, ?)',
      )
      .run('google', 'subject-1', 'Ada', now);
    const userId = Number(user.lastInsertRowid);

    const page = db
      .prepare(
        'INSERT INTO pages (slug, owner_user_id, title, city, description, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('ada-nights', userId, 'Ada Nights', 'Brussels', 'Shows', now);
    const pageId = Number(page.lastInsertRowid);

    db.prepare('INSERT INTO publishers (page_id, user_id, created_at) VALUES (?, ?, ?)').run(
      pageId,
      userId,
      now,
    );

    db.prepare(
      'INSERT INTO posts (page_id, author_user_id, body, image_path, event_date, venue, doors, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(pageId, userId, 'Doors at nine', null, '2026-10-10', 'Recyclart', '21:00', now);

    db.prepare(
      'INSERT INTO subscriptions (user_id, page_id, mode, publisher_ids, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(userId, pageId, 'instant', null, now);

    db.prepare(
      'INSERT INTO devices (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(userId, 'https://push.example/device', 'p256dh-key', 'auth-key', now);

    assert.throws(() => {
      db.prepare(
        'INSERT INTO posts (page_id, author_user_id, body, created_at) VALUES (?, ?, ?, ?)',
      ).run(999999, userId, 'missing page', now);
    });
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }

  const response = await app.request('/health');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});
