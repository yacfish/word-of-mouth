import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { applySchema, openDatabase } from './db.js';
import { runDigest } from './notify.js';
import type { SendFn } from './notify.js';
import { createApp } from './server.js';
import type { Hono } from 'hono';

type Call = { endpoint: string; payload: string };

function setup(send?: SendFn): { app: Hono; db: DatabaseSync; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'wom-app-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  applySchema(db);
  const app = createApp(db, {
    send,
    uploadDir: path.join(dir, 'uploads'),
    vapidPublicKey: 'BElq0wTestKeyForPages',
  });
  return {
    app,
    db,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function sessionCookie(res: Response): string {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const raw = list.find((value) => value.startsWith('wom_session=')) ?? res.headers.get('set-cookie') ?? '';
  const pair = raw.split(';')[0] ?? '';
  if (!pair.startsWith('wom_session=')) throw new Error(`missing session cookie from ${raw}`);
  return pair;
}

function csrfFrom(html: string): string {
  const match = html.match(/name="csrf" value="([^"]+)"/);
  assert.ok(match, 'csrf field missing');
  return match[1] ?? '';
}

async function signIn(app: Hono, name: string): Promise<string> {
  const page = await app.request('/sign-in');
  assert.equal(page.status, 200);
  const anon = sessionCookie(page);
  const csrf = csrfFrom(await page.text());
  const posted = await app.request('/sign-in', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: anon },
    body: new URLSearchParams({ display_name: name, csrf }).toString(),
  });
  assert.equal(posted.status, 303);
  return sessionCookie(posted);
}

async function csrfFor(app: Hono, cookie: string, pathName = '/'): Promise<string> {
  const res = await app.request(pathName, { headers: { cookie } });
  assert.equal(res.status, 200);
  return csrfFrom(await res.text());
}

async function createPage(
  app: Hono,
  cookie: string,
  fields: { title: string; city: string; description?: string },
): Promise<string> {
  const csrf = await csrfFor(app, cookie);
  const res = await app.request('/pages', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({
      csrf,
      title: fields.title,
      city: fields.city,
      description: fields.description ?? '',
    }).toString(),
  });
  assert.equal(res.status, 303);
  return new URL(res.headers.get('location') ?? '/', 'http://127.0.0.1').pathname;
}

async function postUpdate(app: Hono, cookie: string, slugPath: string, body: string): Promise<Response> {
  const csrf = await csrfFor(app, cookie, slugPath);
  return app.request(`${slugPath}/posts`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ csrf, body }).toString(),
  });
}

function countOf(db: DatabaseSync, table: 'posts' | 'pages' | 'devices'): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number };
  return Number(row.c);
}

function userId(db: DatabaseSync, name: string): number {
  const row = db
    .prepare(`SELECT id FROM users WHERE provider = 'local' AND subject = ?`)
    .get(name.trim().toLowerCase()) as { id: number };
  return row.id;
}

async function registerDevice(app: Hono, cookie: string, endpoint: string): Promise<void> {
  const csrf = await csrfFor(app, cookie);
  const res = await app.request('/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf': csrf, cookie },
    body: JSON.stringify({ endpoint, keys: { p256dh: 'p256dh-key', auth: 'auth-key' } }),
  });
  assert.equal(res.status, 200);
}

test('creating a page returns public HTML with the title', async () => {
  const { app, cleanup } = setup();
  try {
    const ada = await signIn(app, 'Ada');
    const first = await createPage(app, ada, {
      title: 'Night Market',
      city: 'Brussels',
      description: 'Hello <b>there</b>',
    });
    assert.equal(first, '/p/night-market');
    const page = await app.request(first);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.equal(html.includes('Night Market'), true);
    assert.equal(html.includes('Hello &lt;b&gt;there&lt;/b&gt;'), true);
    assert.equal(html.includes('<b>there</b>'), false);
    const second = await createPage(app, ada, { title: 'Night Market', city: 'Brussels' });
    assert.equal(second, '/p/night-market-2');
    const home = await app.request('/', { headers: { cookie: ada } });
    const homeHtml = await home.text();
    assert.equal(homeHtml.includes('Night Market'), true);
    assert.equal(homeHtml.includes('/p/night-market'), true);
  } finally {
    cleanup();
  }
});

test('only the owner and approved publishers can post', async () => {
  const { app, db, cleanup } = setup(async () => {});
  try {
    const ada = await signIn(app, 'Ada');
    const slugPath = await createPage(app, ada, { title: 'Ada Nights', city: 'Brussels' });
    const posted = await postUpdate(app, ada, slugPath, 'Doors at nine');
    assert.equal(posted.status, 303);
    const html = await (await app.request(slugPath)).text();
    assert.equal(html.includes('Doors at nine'), true);

    const sam = await signIn(app, 'Sam');
    const before = countOf(db, 'posts');
    const denied = await postUpdate(app, sam, slugPath, 'Not allowed');
    assert.equal(denied.status, 403);
    assert.equal(countOf(db, 'posts'), before);
    assert.equal((await (await app.request(slugPath)).text()).includes('Not allowed'), false);

    const ownerId = userId(db, 'Ada');
    const samCsrf = await csrfFor(app, sam, slugPath);
    const notOwner = await app.request(`${slugPath}/publishers/${ownerId}/approve`, {
      method: 'POST',
      headers: { cookie: sam, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf: samCsrf }).toString(),
    });
    assert.equal(notOwner.status, 403);

    const request = await app.request(`${slugPath}/publish-request`, {
      method: 'POST',
      headers: { cookie: sam, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf: samCsrf }).toString(),
    });
    assert.equal(request.status, 303);

    const adaCsrf = await csrfFor(app, ada, slugPath);
    const samId = userId(db, 'Sam');
    const approved = await app.request(`${slugPath}/publishers/${samId}/approve`, {
      method: 'POST',
      headers: { cookie: ada, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf: adaCsrf }).toString(),
    });
    assert.equal(approved.status, 303);
    const second = await postUpdate(app, sam, slugPath, 'Second night');
    assert.equal(second.status, 303);
    assert.equal((await (await app.request(slugPath)).text()).includes('Second night'), true);
  } finally {
    cleanup();
  }
});

test('instant, mute, and daily delivery use the fake sender', async () => {
  const calls: Call[] = [];
  const send: SendFn = async (subscription, payload) => {
    calls.push({ endpoint: subscription.endpoint, payload });
  };
  const { app, db, cleanup } = setup(send);
  try {
    const ada = await signIn(app, 'Ada');
    const slugPath = await createPage(app, ada, { title: 'Digest Hall', city: 'Ghent' });
    const instant = await signIn(app, 'Instant Fan');
    const muted = await signIn(app, 'Muted Fan');
    const daily = await signIn(app, 'Daily Fan');
    for (const cookie of [instant, muted, daily]) {
      const csrf = await csrfFor(app, cookie, slugPath);
      const sub = await app.request(`${slugPath}/subscribe`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ csrf }).toString(),
      });
      assert.equal(sub.status, 303);
    }
    await registerDevice(app, instant, 'https://push.example/instant');
    await registerDevice(app, muted, 'https://push.example/mute');
    await registerDevice(app, daily, 'https://push.example/daily');

    async function setMode(cookie: string, mode: string): Promise<void> {
      const page = await app.request(`${slugPath}/preferences`, { headers: { cookie } });
      assert.equal(page.status, 200);
      const csrf = csrfFrom(await page.text());
      const saved = await app.request(`${slugPath}/preferences`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ csrf, mode }).toString(),
      });
      assert.equal(saved.status, 303);
    }
    await setMode(muted, 'mute');
    await setMode(daily, 'daily');
    db.prepare(`UPDATE subscriptions SET created_at = ?`).run('2020-01-01T00:00:00.000Z');

    const posted = await postUpdate(app, ada, slugPath, 'Band on at ten');
    assert.equal(posted.status, 303);
    assert.deepEqual(
      calls.map((call) => call.endpoint),
      ['https://push.example/instant'],
    );
    const instantPayload = JSON.parse(calls[0]?.payload ?? '{}') as { title: string; body: string; url: string };
    assert.equal(instantPayload.title, 'Digest Hall');
    assert.equal(instantPayload.body, 'Band on at ten');
    assert.equal(instantPayload.url, slugPath);

    await runDigest(db, '2030-01-01T00:00:00.000Z', send);
    assert.deepEqual(
      calls.map((call) => call.endpoint),
      ['https://push.example/instant', 'https://push.example/daily'],
    );
    const digestPayload = JSON.parse(calls[1]?.payload ?? '{}') as { body: string; url: string };
    assert.equal(digestPayload.body.includes('1 new post'), true);
    assert.equal(digestPayload.body.includes('Band on at ten'), true);
    assert.equal(digestPayload.url, slugPath);

    await runDigest(db, '2030-01-01T00:00:01.000Z', send);
    assert.equal(calls.length, 2);
  } finally {
    cleanup();
  }
});

test('publisher filter skips an author who is not selected', async () => {
  const calls: Call[] = [];
  const send: SendFn = async (subscription, payload) => {
    calls.push({ endpoint: subscription.endpoint, payload });
  };
  const { app, db, cleanup } = setup(send);
  try {
    const ada = await signIn(app, 'Ada');
    const slugPath = await createPage(app, ada, { title: 'Filter Night', city: 'Liège' });
    const other = await signIn(app, 'Other Publisher');
    const fan = await signIn(app, 'Filter Fan');
    const page = db.prepare('SELECT id FROM pages WHERE slug = ?').get('filter-night') as { id: number };
    db.prepare('INSERT INTO publishers (page_id, user_id, created_at) VALUES (?, ?, ?)').run(
      page.id,
      userId(db, 'Other Publisher'),
      '2020-01-01T00:00:00.000Z',
    );
    const sub = await app.request(`${slugPath}/subscribe`, {
      method: 'POST',
      headers: {
        cookie: fan,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ csrf: await csrfFor(app, fan, slugPath) }).toString(),
    });
    assert.equal(sub.status, 303);
    await registerDevice(app, fan, 'https://push.example/filter');
    const first = await postUpdate(app, ada, slugPath, 'Open to everyone');
    assert.equal(first.status, 303);
    assert.equal(calls.length, 1);

    const prefs = await app.request(`${slugPath}/preferences`, { headers: { cookie: fan } });
    const csrf = csrfFrom(await prefs.text());
    const saved = await app.request(`${slugPath}/preferences`, {
      method: 'POST',
      headers: { cookie: fan, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        csrf,
        mode: 'instant',
        publisher_id: String(userId(db, 'Other Publisher')),
      }).toString(),
    });
    assert.equal(saved.status, 303);
    const before = countOf(db, 'posts');
    const second = await postUpdate(app, ada, slugPath, 'Owner only update');
    assert.equal(second.status, 303);
    assert.equal(countOf(db, 'posts'), before + 1);
    assert.equal(calls.length, 1);
    void other;
  } finally {
    cleanup();
  }
});

test('POST /pages without the csrf token is forbidden', async () => {
  const { app, db, cleanup } = setup();
  try {
    const ada = await signIn(app, 'Ada');
    const before = countOf(db, 'pages');
    const res = await app.request('/pages', {
      method: 'POST',
      headers: { cookie: ada, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ title: 'Nope', city: 'Here' }).toString(),
    });
    assert.equal(res.status, 403);
    assert.equal(countOf(db, 'pages'), before);
  } finally {
    cleanup();
  }
});

test('a removed push endpoint deletes the device', async () => {
  const send: SendFn = async () => {
    const err = new Error('gone') as Error & { statusCode?: number };
    err.statusCode = 410;
    throw err;
  };
  const { app, db, cleanup } = setup(send);
  try {
    const ada = await signIn(app, 'Ada');
    const slugPath = await createPage(app, ada, { title: 'Gone Device', city: 'Antwerp' });
    const fan = await signIn(app, 'Gone Fan');
    const sub = await app.request(`${slugPath}/subscribe`, {
      method: 'POST',
      headers: { cookie: fan, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf: await csrfFor(app, fan, slugPath) }).toString(),
    });
    assert.equal(sub.status, 303);
    await registerDevice(app, fan, 'https://push.example/gone');
    assert.equal(countOf(db, 'devices'), 1);
    const posted = await postUpdate(app, ada, slugPath, 'Still saved');
    assert.equal(posted.status, 303);
    assert.equal(countOf(db, 'devices'), 0);
    assert.equal((await (await app.request(slugPath)).text()).includes('Still saved'), true);
  } finally {
    cleanup();
  }
});

test('images are stored and other files are rejected', async () => {
  const { app, db, cleanup } = setup(async () => {});
  try {
    const ada = await signIn(app, 'Ada');
    const slugPath = await createPage(app, ada, { title: 'Poster', city: 'Brussels' });
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const csrf = await csrfFor(app, ada, slugPath);
    const form = new FormData();
    form.set('csrf', csrf);
    form.set('body', 'See the poster');
    form.set('event_date', '2026-10-10');
    form.set('venue', 'Recyclart');
    form.set('doors', '21:00');
    form.set('image', new File([png], 'dot.png', { type: 'image/png' }));
    const posted = await app.request(`${slugPath}/posts`, { method: 'POST', headers: { cookie: ada }, body: form });
    assert.equal(posted.status, 303);
    const html = await (await app.request(slugPath)).text();
    const found = html.match(/\/media\/[a-f0-9]+\.png/);
    assert.ok(found);
    const media = await app.request(found[0] ?? '/');
    assert.equal(media.status, 200);
    assert.equal(media.headers.get('content-type'), 'image/png');
    assert.equal(html.includes('Recyclart'), true);

    const before = countOf(db, 'posts');
    const badCsrf = await csrfFor(app, ada, slugPath);
    const bad = new FormData();
    bad.set('csrf', badCsrf);
    bad.set('body', 'Notes should fail');
    bad.set('image', new File([Buffer.from('hello')], 'notes.txt', { type: 'text/plain' }));
    const rejected = await app.request(`${slugPath}/posts`, {
      method: 'POST',
      headers: { cookie: ada },
      body: bad,
    });
    assert.equal(rejected.status, 400);
    assert.equal(countOf(db, 'posts'), before);
    const exe = await app.request('/media/notes.exe');
    assert.equal(exe.status, 400);
    const dot = await app.request('/media/..%2Fpackage.json');
    assert.equal(dot.status, 400);
  } finally {
    cleanup();
  }
});

test('google sign-in is absent unless configured, and ios gets a note', async () => {
  const { app, cleanup } = setup();
  try {
    const missing = await app.request('/auth/google');
    assert.equal(missing.status, 404);
    const signInPage = await app.request('/sign-in');
    const signInHtml = await signInPage.text();
    assert.equal(signInHtml.includes('/auth/google'), false);
    const ada = await signIn(app, 'Ada');
    const slugPath = await createPage(app, ada, { title: 'Phone', city: 'Brussels' });
    const iphone = await app.request(slugPath, {
      headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' },
    });
    assert.equal((await iphone.text()).includes('add Word of Mouth to the Home Screen'), true);
    const desktop = await app.request(slugPath, { headers: { 'user-agent': 'Mozilla/5.0' } });
    assert.equal((await desktop.text()).includes('add Word of Mouth to the Home Screen'), false);
    const manifest = await app.request('/manifest.webmanifest');
    const json = (await manifest.json()) as { name: string; display: string; start_url: string };
    assert.equal(json.name, 'Word of Mouth');
    assert.equal(json.display, 'standalone');
    assert.equal(json.start_url, '/');
    const worker = await (await app.request('/sw.js')).text();
    assert.equal(worker.includes('showNotification'), true);
    assert.equal(worker.includes('openWindow'), true);
  } finally {
    cleanup();
  }
});

test('start throws in production without a session secret', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `process.env.NODE_ENV = 'production';
delete process.env.WOM_SESSION_SECRET;
const { start } = await import('./dist/server.js');
try {
  start();
  console.error('start did not throw');
  process.exit(2);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}`,
    ],
    { cwd: root, encoding: 'utf8', timeout: 8000 },
  );
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /WOM_SESSION_SECRET/);
});
