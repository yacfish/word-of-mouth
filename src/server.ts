import { serve } from '@hono/node-server';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { applySchema, openDatabase } from './db.js';
import { escapeHtml, renderDocument } from './html.js';
import { configureWebPush, defaultSend, loadOrCreateVapid, notifyNewPost, runDigest } from './notify.js';
import type { SendFn } from './notify.js';
import {
  clearSessionCookie,
  newCsrf,
  readSession,
  sessionCookie,
  sessionSecret,
  SESSION_COOKIE,
} from './session.js';
import type { Session } from './session.js';
import { allocateSlug } from './slug.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

type FormValue = string | File | Array<string | File>;
type FormMap = Record<string, FormValue>;

export type AppOptions = {
  send?: SendFn;
  uploadDir?: string;
  vapidPublicKey?: string | null;
};

type GoogleConfig = {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
};

type PageRow = {
  id: number;
  slug: string;
  owner_user_id: number;
  title: string;
  city: string;
  description: string;
};

type UserRow = { id: number; display_name: string | null };

function nowIso(): string {
  return new Date().toISOString();
}

function googleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
  const baseUrl = process.env.PUBLIC_BASE_URL ?? '';
  if (!clientId || !clientSecret || !baseUrl) return null;
  return { clientId, clientSecret, baseUrl: baseUrl.replace(/\/$/, '') };
}

function cookiesFrom(header: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!header) return map;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    map.set(part.slice(0, idx).trim(), decodeURIComponent(part.slice(idx + 1).trim()));
  }
  return map;
}

function currentSession(c: Context): Session | null {
  const token = cookiesFrom(c.req.header('cookie')).get(SESSION_COOKIE);
  return readSession(token, sessionSecret());
}

function isAppleMobile(userAgent: string | undefined): boolean {
  if (!userAgent) return false;
  return /iPhone|iPad/i.test(userAgent);
}

function formStrings(form: FormMap, key: string): string[] {
  const value = form[key];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return [];
}

function formString(form: FormMap, key: string): string {
  return formStrings(form, key)[0] ?? '';
}

function formFile(form: FormMap, key: string): File | null {
  const value = form[key];
  if (value instanceof File) return value;
  if (Array.isArray(value)) {
    const found = value.find((item) => item instanceof File);
    return found instanceof File ? found : null;
  }
  return null;
}

async function parseInput(c: Context): Promise<{ csrf?: string; form: FormMap; json: unknown }> {
  const header = c.req.header('x-csrf') ?? undefined;
  const contentType = c.req.header('content-type') ?? '';
  if (contentType.includes('application/json')) {
    let json: unknown = {};
    try {
      json = await c.req.json();
    } catch {
      json = {};
    }
    let field: string | undefined;
    if (json && typeof json === 'object' && 'csrf' in json) {
      const raw = (json as { csrf?: unknown }).csrf;
      if (typeof raw === 'string') field = raw;
    }
    return { csrf: header || field, form: {}, json };
  }
  let form: FormMap = {};
  try {
    form = (await c.req.parseBody({ all: true })) as FormMap;
  } catch {
    form = {};
  }
  const raw = form.csrf;
  const field = typeof raw === 'string' ? raw : undefined;
  return { csrf: header || field, form, json: null };
}

function csrfMatches(session: Session | null, given: string | undefined): boolean {
  if (!session || !given) return false;
  return given === session.csrf;
}

function redirectTo(location: string, cookies: string[] = []): Response {
  const headers = new Headers();
  headers.set('location', location);
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response(null, { status: 303, headers });
}

function htmlResponse(body: string, status = 200, cookies: string[] = []): Response {
  const headers = new Headers({
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response(body, { status, headers });
}

function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function pageBySlug(db: DatabaseSync, slug: string): PageRow | undefined {
  const row = db
    .prepare('SELECT id, slug, owner_user_id, title, city, description FROM pages WHERE slug = ?')
    .get(slug) as PageRow | undefined;
  return row ?? undefined;
}

function userById(db: DatabaseSync, id: number): UserRow | undefined {
  const row = db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(id) as UserRow | undefined;
  return row ?? undefined;
}

function localSubject(displayName: string): string {
  return displayName.trim().toLowerCase();
}

function upsertUser(db: DatabaseSync, provider: string, subject: string, displayName: string): number {
  const created = nowIso();
  db.prepare(
    `INSERT INTO users (provider, subject, display_name, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(provider, subject) DO UPDATE SET display_name = excluded.display_name`,
  ).run(provider, subject, displayName, created);
  const row = db.prepare('SELECT id FROM users WHERE provider = ? AND subject = ?').get(provider, subject) as {
    id: number;
  };
  return row.id;
}

function canPost(db: DatabaseSync, page: PageRow, userId: number): boolean {
  if (page.owner_user_id === userId) return true;
  const row = db.prepare('SELECT 1 AS ok FROM publishers WHERE page_id = ? AND user_id = ?').get(page.id, userId);
  return row != null;
}

function subscriptionFor(db: DatabaseSync, userId: number, pageId: number): { mode: string; publisher_ids: string | null } | undefined {
  const row = db
    .prepare('SELECT mode, publisher_ids FROM subscriptions WHERE user_id = ? AND page_id = ?')
    .get(userId, pageId) as { mode: string; publisher_ids: string | null } | undefined;
  return row ?? undefined;
}

function optionalText(value: string, max: number): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

function renderShell(
  c: Context,
  input: {
    title: string;
    bodyHtml: string;
    session: Session | null;
    askPush?: boolean;
    vapidPublicKey: string | null;
  },
): string {
  const signedIn = Boolean(input.session && input.session.uid);
  return renderDocument({
    title: input.title,
    bodyHtml: input.bodyHtml,
    signedIn,
    csrf: input.session?.csrf ?? null,
    iosNote: isAppleMobile(c.req.header('user-agent')),
    askPush: Boolean(input.askPush && signedIn),
    vapidPublicKey: input.vapidPublicKey,
  });
}

export function createApp(db?: DatabaseSync, options: AppOptions = {}): Hono {
  const app = new Hono();
  const uploadDir = options.uploadDir ?? path.resolve('data/uploads');
  const vapidPublicKey = options.vapidPublicKey ?? null;
  const send = options.send ?? defaultSend;
  const google = googleConfig();

  app.get('/health', (c) => c.json({ ok: true }));

  app.get('/styles.css', () => fileResponse('styles.css', 'text/css; charset=utf-8'));
  app.get('/sw.js', () => fileResponse('sw.js', 'text/javascript; charset=utf-8', 'no-cache'));
  app.get('/manifest.webmanifest', () => fileResponse('manifest.webmanifest', 'application/manifest+json'));
  app.get('/icon.svg', () => fileResponse('icon.svg', 'image/svg+xml'));

  app.get('/media/:name', (c) => {
    const name = c.req.param('name');
    if (!/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|gif)$/.test(name)) return text('Bad name', 400);
    const root = path.resolve(uploadDir);
    const full = path.resolve(root, name);
    if (full !== path.join(root, name)) return text('Bad name', 400);
    try {
      const bytes = readFileSync(full);
      const ext = name.split('.').pop() ?? '';
      return new Response(new Uint8Array(bytes), {
        headers: { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': 'public, max-age=31536000' },
      });
    } catch {
      return text('Not found', 404);
    }
  });

  app.get('/sign-in', (c) => {
    if (!db) return text('Database is not configured', 500);
    let session = currentSession(c);
    const cookies: string[] = [];
    if (!session || !session.uid) {
      session = { uid: null, csrf: newCsrf() };
      cookies.push(sessionCookie(session, sessionSecret()));
    }
    const googleLink = google ? `<p><a href="/auth/google">Continue with Google</a></p>` : '';
    const bodyHtml = `<h1>Sign in</h1>
      <p>Use a display name on this server. Subscribing still does not let you post.</p>
      <form method="post" action="/sign-in">
        <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
        <label>Display name <input name="display_name" required maxlength="80" autocomplete="nickname"></label>
        <button type="submit">Sign in</button>
      </form>
      ${googleLink}`;
    return htmlResponse(renderShell(c, { title: 'Sign in', bodyHtml, session, vapidPublicKey }), 200, cookies);
  });

  app.post('/sign-in', async (c) => {
    if (!db) return text('Database is not configured', 500);
    const session = currentSession(c);
    const input = await parseInput(c);
    if (!csrfMatches(session, input.csrf) || !session) return text('Forbidden', 403);
    const displayName = formString(input.form, 'display_name').trim();
    if (displayName.length < 1 || displayName.length > 80) {
      return text('Display name must be 1 to 80 characters.', 400);
    }
    const userId = upsertUser(db, 'local', localSubject(displayName), displayName);
    const next = sessionCookie({ uid: userId, csrf: newCsrf() }, sessionSecret());
    return redirectTo('/', [next]);
  });

  app.post('/sign-out', async (c) => {
    const session = currentSession(c);
    const input = await parseInput(c);
    if (!csrfMatches(session, input.csrf) || !session) return text('Forbidden', 403);
    return redirectTo('/', [clearSessionCookie()]);
  });

  if (google) {
    app.get('/auth/google', (c) => {
      const state = randomBytes(16).toString('base64url');
      const redirectUri = `${google.baseUrl}/auth/google/callback`;
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.searchParams.set('client_id', google.clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'openid email profile');
      url.searchParams.set('state', state);
      const cookie = `wom_oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`;
      return redirectTo(url.toString(), [cookie]);
    });

    app.get('/auth/google/callback', async (c) => {
      if (!db) return text('Database is not configured', 500);
      const state = c.req.query('state') ?? '';
      const saved = cookiesFrom(c.req.header('cookie')).get('wom_oauth_state') ?? '';
      const clear = 'wom_oauth_state=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0';
      if (!state || !saved || state !== saved) return text('Forbidden', 403);
      const code = c.req.query('code');
      if (!code) return text('Google sign-in failed', 400);
      const redirectUri = `${google.baseUrl}/auth/google/callback`;
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: google.clientId,
          client_secret: google.clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      if (!tokenRes.ok) return text('Google sign-in failed', 400);
      const tokenJson = (await tokenRes.json()) as { access_token?: string };
      if (!tokenJson.access_token) return text('Google sign-in failed', 400);
      const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { authorization: `Bearer ${tokenJson.access_token}` },
      });
      if (!infoRes.ok) return text('Google sign-in failed', 400);
      const profile = (await infoRes.json()) as { sub?: string; name?: string; email?: string };
      if (!profile.sub) return text('Google sign-in failed', 400);
      const displayName = (profile.name || profile.email || 'Google user').trim().slice(0, 80) || 'Google user';
      const userId = upsertUser(db, 'google', profile.sub, displayName);
      const next = sessionCookie({ uid: userId, csrf: newCsrf() }, sessionSecret());
      return redirectTo('/', [next, clear]);
    });
  }

  app.get('/', (c) => {
    if (!db) return text('Database is not configured', 500);
    const session = currentSession(c);
    if (!session?.uid) {
      const bodyHtml = `<h1>Events, without the group chat</h1>
        <p>Word of Mouth is a public page you can share. People subscribe for alerts. Only the owner and approved publishers can post. Chat is intentionally absent.</p>
        <p><a href="/sign-in">Sign in</a></p>`;
      return htmlResponse(renderShell(c, { title: 'Word of Mouth', bodyHtml, session, vapidPublicKey }));
    }
    const user = userById(db, session.uid);
    const pages = db
      .prepare('SELECT slug, title, city FROM pages WHERE owner_user_id = ? ORDER BY created_at DESC, id DESC')
      .all(session.uid) as Array<{ slug: string; title: string; city: string }>;
    const list = pages.length
      ? `<ul>${pages
          .map(
            (page) =>
              `<li><a href="/p/${escapeHtml(page.slug)}">${escapeHtml(page.title)}</a> <span class="muted">${escapeHtml(page.city)}</span></li>`,
          )
          .join('')}</ul>`
      : '<p>You have not created a page yet.</p>';
    const bodyHtml = `<h1>Hello, ${escapeHtml(user?.display_name || 'there')}</h1>
      <form method="post" action="/pages">
        <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
        <label>Title <input name="title" required maxlength="120"></label>
        <label>City <input name="city" required maxlength="80"></label>
        <label>Description <textarea name="description" maxlength="4000"></textarea></label>
        <button type="submit">Create page</button>
      </form>
      <h2>Your pages</h2>
      ${list}`;
    return htmlResponse(renderShell(c, { title: 'Word of Mouth', bodyHtml, session, vapidPublicKey }));
  });

  app.post('/pages', async (c) => {
    if (!db) return text('Database is not configured', 500);
    const session = currentSession(c);
    const input = await parseInput(c);
    if (!csrfMatches(session, input.csrf) || !session) return text('Forbidden', 403);
    if (!session.uid) return text('Sign in required', 401);
    const title = formString(input.form, 'title').trim();
    const city = formString(input.form, 'city').trim();
    const description = formString(input.form, 'description').trim();
    if (title.length < 1 || title.length > 120) return text('Title must be 1 to 120 characters.', 400);
    if (city.length < 1 || city.length > 80) return text('City must be 1 to 80 characters.', 400);
    if (description.length > 4000) return text('Description is too long.', 400);
    const slug = allocateSlug(title, (candidate) => {
      return db.prepare('SELECT 1 AS ok FROM pages WHERE slug = ?').get(candidate) != null;
    });
    db.prepare(
      'INSERT INTO pages (slug, owner_user_id, title, city, description, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(slug, session.uid, title, city, description, nowIso());
    return redirectTo(`/p/${slug}`);
  });

  app.get('/p/:slug', (c) => {
    if (!db) return text('Database is not configured', 500);
    const page = pageBySlug(db, c.req.param('slug'));
    if (!page) return text('Page not found', 404);
    const session = currentSession(c);
    const uid = session?.uid ?? null;
    const sub = uid ? subscriptionFor(db, uid, page.id) : undefined;
    const publisher = uid
      ? db.prepare('SELECT 1 AS ok FROM publishers WHERE page_id = ? AND user_id = ?').get(page.id, uid) != null
      : false;
    const request = uid
      ? (db
          .prepare('SELECT status FROM publish_requests WHERE page_id = ? AND user_id = ?')
          .get(page.id, uid) as { status: string } | undefined)
      : undefined;
    const posts = db
      .prepare(
        `SELECT posts.body, posts.image_path, posts.event_date, posts.venue, posts.doors, posts.created_at,
                users.display_name AS author_name
         FROM posts JOIN users ON users.id = posts.author_user_id
         WHERE posts.page_id = ?
         ORDER BY posts.created_at DESC, posts.id DESC`,
      )
      .all(page.id) as Array<{
      body: string;
      image_path: string | null;
      event_date: string | null;
      venue: string | null;
      doors: string | null;
      created_at: string;
      author_name: string | null;
    }>;
    const postHtml = posts.length
      ? posts
          .map((post) => {
            const bits = [
              post.event_date ? `Date ${escapeHtml(post.event_date)}` : '',
              post.venue ? `Venue ${escapeHtml(post.venue)}` : '',
              post.doors ? `Doors ${escapeHtml(post.doors)}` : '',
            ].filter(Boolean);
            const image = post.image_path ? `<img src="${escapeHtml(post.image_path)}" alt="">` : '';
            return `<article class="post">
              <p class="post-body">${escapeHtml(post.body)}</p>
              ${image}
              <p class="meta">${escapeHtml(post.author_name || 'Someone')}, <time datetime="${escapeHtml(post.created_at)}">${escapeHtml(post.created_at)}</time></p>
              ${bits.length ? `<p class="meta">${bits.join(', ')}</p>` : ''}
            </article>`;
          })
          .join('')
      : '<p>No posts yet.</p>';

    let controls = '';
    if (!uid) {
      controls = `<p><a href="/sign-in">Sign in</a> to subscribe.</p>`;
    } else if (session) {
      if (!sub) {
        controls += `<form method="post" action="/p/${escapeHtml(page.slug)}/subscribe">
          <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
          <button type="submit">Subscribe</button>
        </form>`;
      } else {
        controls += `<p>Subscribed, ${escapeHtml(sub.mode)} delivery.</p>
          <p><a href="/p/${escapeHtml(page.slug)}/preferences">Notification preferences</a></p>`;
      }
      if (uid !== page.owner_user_id && !publisher) {
        if (request?.status === 'pending') {
          controls += '<p>Your request to publish is pending.</p>';
        } else if (request?.status !== 'approved') {
          controls += `<form method="post" action="/p/${escapeHtml(page.slug)}/publish-request">
            <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
            <button type="submit">Request to publish</button>
          </form>`;
        }
      }
      if (canPost(db, page, uid)) {
        controls += `<h2>New post</h2>
          <form method="post" action="/p/${escapeHtml(page.slug)}/posts" enctype="multipart/form-data">
            <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
            <label>Update <textarea name="body" required maxlength="4000"></textarea></label>
            <label>Event date <input name="event_date" maxlength="200"></label>
            <label>Venue <input name="venue" maxlength="200"></label>
            <label>Doors <input name="doors" maxlength="200"></label>
            <label>Image <input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif"></label>
            <button type="submit">Post</button>
          </form>`;
      }
      if (uid === page.owner_user_id) {
        const pending = db
          .prepare(
            `SELECT r.user_id, u.display_name
             FROM publish_requests r JOIN users u ON u.id = r.user_id
             WHERE r.page_id = ? AND r.status = 'pending'
             ORDER BY r.created_at`,
          )
          .all(page.id) as Array<{ user_id: number; display_name: string | null }>;
        const items = pending.length
          ? pending
              .map(
                (row) => `<li>${escapeHtml(row.display_name || 'Someone')}
                  <form method="post" action="/p/${escapeHtml(page.slug)}/publishers/${row.user_id}/approve" class="inline">
                    <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
                    <button type="submit">Approve</button>
                  </form>
                </li>`,
              )
              .join('')
          : '<li>No pending requests.</li>';
        controls += `<h2>Publish requests</h2><ul>${items}</ul>`;
      }
    }

    const bodyHtml = `<h1>${escapeHtml(page.title)}</h1>
      <p class="muted">${escapeHtml(page.city)}</p>
      ${page.description ? `<p class="description">${escapeHtml(page.description)}</p>` : ''}
      <p>Anyone can read this page. Only the owner and approved publishers can post.</p>
      ${controls}
      <h2>Posts</h2>
      ${postHtml}`;
    const askPush = c.req.query('push') === '1' && Boolean(sub);
    return htmlResponse(
      renderShell(c, { title: page.title, bodyHtml, session, askPush, vapidPublicKey }),
    );
  });

  app.post('/p/:slug/subscribe', async (c) => {
    if (!db) return text('Database is not configured', 500);
    const session = currentSession(c);
    const input = await parseInput(c);
    if (!csrfMatches(session, input.csrf) || !session) return text('Forbidden', 403);
    if (!session.uid) return text('Sign in required', 401);
    const page = pageBySlug(db, c.req.param('slug'));
    if (!page) return text('Page not found', 404);
    db.prepare(
      `INSERT INTO subscriptions (user_id, page_id, mode, publisher_ids, created_at)
       VALUES (?, ?, 'instant', NULL, ?)
       ON CONFLICT(user_id, page_id) DO NOTHING`,
    ).run(session.uid, page.id, nowIso());
    return redirectTo(`/p/${page.slug}?push=1`);
  });

  app.get('/p/:slug/preferences', (c) => {
    if (!db) return text('Database is not configured', 500);
    const session = currentSession(c);
    if (!session?.uid) return text('Sign in required', 401);
    const page = pageBySlug(db, c.req.param('slug'));
    if (!page) return text('Page not found', 404);
    const sub = subscriptionFor(db, session.uid, page.id);
    if (!sub) return text('Subscribe before setting preferences', 403);
    return htmlResponse(renderShell(c, {
      title: `Preferences for ${page.title}`,
      bodyHtml: preferencesHtml(db, page, session, sub),
      session,
      vapidPublicKey,
    }));
  });

  app.post('/p/:slug/preferences', async (c) => {
    if (!db) return text('Database is not configured', 500);
    const session = currentSession(c);
    const input = await parseInput(c);
    if (!csrfMatches(session, input.csrf) || !session) return text('Forbidden', 403);
    if (!session.uid) return text('Sign in required', 401);
    const page = pageBySlug(db, c.req.param('slug'));
    if (!page) return text('Page not found', 404);
    const sub = subscriptionFor(db, session.uid, page.id);
    if (!sub) return text('Subscribe before setting preferences', 403);
    const mode = formString(input.form, 'mode');
    if (mode !== 'instant' && mode !== 'daily' && mode !== 'mute') return text('Unknown mode', 400);
    const chosen = formStrings(input.form, 'publisher_id')
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value));
    const allowed = new Set(
      (db.prepare('SELECT user_id FROM publishers WHERE page_id = ?').all(page.id) as Array<{ user_id: number }>).map(
        (row) => row.user_id,
      ),
    );
    const ids = chosen.filter((id) => allowed.has(id));
    const publisherIds = ids.length ? JSON.stringify(ids) : null;
    db.prepare('UPDATE subscriptions SET mode = ?, publisher_ids = ? WHERE user_id = ? AND page_id = ?').run(
      mode,
      publisherIds,
      session.uid,
      page.id,
    );
    return redirectTo(`/p/${page.slug}`);
  });

  app.post('/p/:slug/publish-request', async (c) => {
    if (!db) return text('Database is not configured', 500);
    const session = currentSession(c);
    const input = await parseInput(c);
    if (!csrfMatches(session, input.csrf) || !session) return text('Forbidden', 403);
    if (!session.uid) return text('Sign in required', 401);
    const page = pageBySlug(db, c.req.param('slug'));
    if (!page) return text('Page not found', 404);
    if (session.uid === page.owner_user_id) return text('Forbidden', 403);
    if (db.prepare('SELECT 1 AS ok FROM publishers WHERE page_id = ? AND user_id = ?').get(page.id, session.uid) != null) {
      return text('Forbidden', 403);
    }
    const existing = db
      .prepare('SELECT status FROM publish_requests WHERE page_id = ? AND user_id = ?')
      .get(page.id, session.uid) as { status: string } | undefined;
    if (!existing) {
      db.prepare(
        'INSERT INTO publish_requests (page_id, user_id, status, created_at) VALUES (?, ?, ?, ?)',
      ).run(page.id, session.uid, 'pending', nowIso());
    } else if (existing.status === 'rejected') {
      db.prepare(`UPDATE publish_requests SET status = 'pending' WHERE page_id = ? AND user_id = ?`).run(
        page.id,
        session.uid,
      );
    }
    return redirectTo(`/p/${page.slug}`);
  });

  app.post('/p/:slug/publishers/:userId/approve', async (c) => {
    if (!db) return text('Database is not configured', 500);
    const session = currentSession(c);
    const input = await parseInput(c);
    if (!csrfMatches(session, input.csrf) || !session) return text('Forbidden', 403);
    if (!session.uid) return text('Sign in required', 401);
    const page = pageBySlug(db, c.req.param('slug'));
    if (!page) return text('Page not found', 404);
    if (session.uid !== page.owner_user_id) return text('Forbidden', 403);
    const userId = Number(c.req.param('userId'));
    if (!Number.isInteger(userId)) return text('Bad user', 400);
    const request = db
      .prepare('SELECT status FROM publish_requests WHERE page_id = ? AND user_id = ?')
      .get(page.id, userId) as { status: string } | undefined;
    if (!request) return text('Not found', 404);
    const created = nowIso();
    db.prepare(
      `INSERT INTO publishers (page_id, user_id, created_at) VALUES (?, ?, ?)
       ON CONFLICT(page_id, user_id) DO NOTHING`,
    ).run(page.id, userId, created);
    db.prepare(`UPDATE publish_requests SET status = 'approved' WHERE page_id = ? AND user_id = ?`).run(page.id, userId);
    return redirectTo(`/p/${page.slug}`);
  });

  app.post('/p/:slug/posts', async (c) => {
    if (!db) return text('Database is not configured', 500);
    const session = currentSession(c);
    const input = await parseInput(c);
    if (!csrfMatches(session, input.csrf) || !session) return text('Forbidden', 403);
    if (!session.uid) return text('Sign in required', 401);
    const page = pageBySlug(db, c.req.param('slug'));
    if (!page) return text('Page not found', 404);
    if (!canPost(db, page, session.uid)) return text('Forbidden', 403);
    const body = formString(input.form, 'body').trim();
    if (body.length < 1 || body.length > 4000) return text('Post text is required.', 400);
    const eventDate = optionalText(formString(input.form, 'event_date'), 200);
    const venue = optionalText(formString(input.form, 'venue'), 200);
    const doors = optionalText(formString(input.form, 'doors'), 200);
    let imagePath: string | null = null;
    const image = formFile(input.form, 'image');
    if (image && image.size > 0) {
      const stored = await storeImageAsync(image, uploadDir);
      if (!stored.ok) return text(stored.error, 400);
      imagePath = stored.imagePath;
    }
    const result = db
      .prepare(
        `INSERT INTO posts (page_id, author_user_id, body, image_path, event_date, venue, doors, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(page.id, session.uid, body, imagePath, eventDate, venue, doors, nowIso());
    const postId = Number(result.lastInsertRowid);
    try {
      await notifyNewPost(db, postId, send);
    } catch (err) {
      console.error('notify failed');
      console.error(err instanceof Error ? err.message : 'unknown notify error');
    }
    return redirectTo(`/p/${page.slug}`);
  });

  app.post('/push/subscribe', async (c) => {
    if (!db) return text('Database is not configured', 500);
    const session = currentSession(c);
    const input = await parseInput(c);
    if (!csrfMatches(session, input.csrf) || !session) return text('Forbidden', 403);
    if (!session.uid) return text('Sign in required', 401);
    const body = input.json;
    if (!body || typeof body !== 'object') return text('Bad subscription', 400);
    const record = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
    const endpoint = typeof record.endpoint === 'string' ? record.endpoint : '';
    const p256dh = typeof record.keys?.p256dh === 'string' ? record.keys.p256dh : '';
    const auth = typeof record.keys?.auth === 'string' ? record.keys.auth : '';
    if (!endpoint.startsWith('https://') || endpoint.length > 4096) return text('Bad subscription', 400);
    if (!p256dh || p256dh.length > 500 || !auth || auth.length > 500) return text('Bad subscription', 400);
    db.prepare(
      `INSERT INTO devices (user_id, endpoint, p256dh, auth, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth`,
    ).run(session.uid, endpoint, p256dh, auth, nowIso());
    return c.json({ ok: true });
  });

  return app;

  function preferencesHtml(
    database: DatabaseSync,
    page: PageRow,
    session: Session,
    sub: { mode: string; publisher_ids: string | null },
  ): string {
    const publishers = database
      .prepare(
        `SELECT u.id, u.display_name
         FROM publishers p JOIN users u ON u.id = p.user_id
         WHERE p.page_id = ?
         ORDER BY u.display_name`,
      )
      .all(page.id) as Array<{ id: number; display_name: string | null }>;
    let selected = new Set<number>();
    if (sub.publisher_ids) {
      try {
        const parsed = JSON.parse(sub.publisher_ids) as unknown;
        if (Array.isArray(parsed)) selected = new Set(parsed.map((value) => Number(value)));
      } catch {
        selected = new Set();
      }
    }
    const boxes = publishers.length
      ? publishers
          .map((publisher) => {
            const checked = selected.has(publisher.id) ? ' checked' : '';
            return `<label><input type="checkbox" name="publisher_id" value="${publisher.id}"${checked}> ${escapeHtml(publisher.display_name || 'Someone')}</label>`;
          })
          .join('')
      : '<p>No approved publishers yet. Leave this empty to hear from everyone who can post.</p>';
    const mode = (value: string, label: string) =>
      `<label><input type="radio" name="mode" value="${value}"${sub.mode === value ? ' checked' : ''}> ${label}</label>`;
    return `<h1>Preferences</h1>
      <p>${escapeHtml(page.title)}</p>
      <form method="post" action="/p/${escapeHtml(page.slug)}/preferences">
        <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
        ${mode('instant', 'Instant')}
        ${mode('daily', 'Daily digest')}
        ${mode('mute', 'Mute')}
        <fieldset>
          <legend>Publishers</legend>
          <p>Leave every box unchecked to include everyone approved. Checked boxes limit instant and daily delivery to those publishers. Mute does not send, so the filter is ignored.</p>
          ${boxes}
        </fieldset>
        <button type="submit">Save</button>
      </form>`;
  }
}

async function storeImageAsync(
  file: File,
  uploadDir: string,
): Promise<{ ok: true; imagePath: string } | { ok: false; error: string }> {
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: 'Image must be 5MB or smaller' };
  const original = file.name || '';
  const ext = original.includes('.') ? (original.split('.').pop() ?? '').toLowerCase() : '';
  if (!IMAGE_EXT.has(ext)) return { ok: false, error: 'Image must be jpg, jpeg, png, webp, or gif' };
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength > MAX_IMAGE_BYTES) return { ok: false, error: 'Image must be 5MB or smaller' };
  const filename = `${randomBytes(16).toString('hex')}.${ext}`;
  mkdirSync(uploadDir, { recursive: true });
  writeFileSync(path.join(uploadDir, filename), buffer);
  return { ok: true, imagePath: `/media/${filename}` };
}

function fileResponse(name: string, contentType: string, cache = 'public, max-age=3600'): Response {
  try {
    const bytes = readFileSync(path.join(publicDir, name));
    return new Response(new Uint8Array(bytes), { headers: { 'content-type': contentType, 'cache-control': cache } });
  } catch {
    return text('Not found', 404);
  }
}

export const app = createApp();

export function start(): void {
  sessionSecret();
  const dbPath = process.env.WOM_DB ?? './data/word-of-mouth.sqlite';
  const db = openDatabase(dbPath);
  applySchema(db);
  const dataDir = dbPath === ':memory:' ? path.resolve('data') : path.resolve(path.dirname(dbPath));
  const vapid = loadOrCreateVapid(dataDir);
  configureWebPush(vapid);
  const runtime = createApp(db, {
    uploadDir: path.join(dataDir, 'uploads'),
    vapidPublicKey: vapid.publicKey,
  });
  const timer = setInterval(() => {
    void runDigest(db, new Date().toISOString(), defaultSend).catch((err: unknown) => {
      console.error('digest failed');
      console.error(err instanceof Error ? err.message : 'unknown digest error');
    });
  }, 60_000);
  timer.unref();
  const port = Number(process.env.PORT ?? 3000);
  serve({ fetch: runtime.fetch, hostname: '127.0.0.1', port });
  console.log(`listening on http://127.0.0.1:${port}`);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  start();
}

