// Web Push delivery for instant posts and the daily digest.

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);

type WebPushModule = {
  generateVAPIDKeys: () => { publicKey: string; privateKey: string };
  setVapidDetails: (subject: string, publicKey: string, privateKey: string) => void;
  sendNotification: (
    subscription: PushSubscriptionKeys,
    payload?: string | Buffer | null,
  ) => Promise<unknown>;
};

const webpush = require('web-push') as WebPushModule;

export type PushSubscriptionKeys = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type SendFn = (subscription: PushSubscriptionKeys, payload: string) => Promise<unknown> | unknown;

export type VapidKeys = { publicKey: string; privateKey: string };

export function loadOrCreateVapid(dataDir: string): VapidKeys {
  const fromPublic = process.env.WOM_VAPID_PUBLIC ?? '';
  const fromPrivate = process.env.WOM_VAPID_PRIVATE ?? '';
  if (fromPublic && fromPrivate) return { publicKey: fromPublic, privateKey: fromPrivate };
  if (fromPublic || fromPrivate) {
    throw new Error('Set both WOM_VAPID_PUBLIC and WOM_VAPID_PRIVATE, or leave both unset');
  }
  const file = path.join(dataDir, 'vapid.json');
  if (existsSync(file)) {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<VapidKeys>;
    if (!parsed.publicKey || !parsed.privateKey) throw new Error('vapid.json is missing a key');
    return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
  }
  const keys = webpush.generateVAPIDKeys();
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, `${JSON.stringify({ publicKey: keys.publicKey, privateKey: keys.privateKey }, null, 2)}\n`);
  return keys;
}

export function configureWebPush(keys: VapidKeys): void {
  webpush.setVapidDetails('mailto:self-host@word-of-mouth.local', keys.publicKey, keys.privateKey);
}

export async function defaultSend(subscription: PushSubscriptionKeys, payload: string): Promise<void> {
  await webpush.sendNotification(subscription, payload);
}

type DeviceRow = { id: number; endpoint: string; p256dh: string; auth: string };

function errorStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const record = err as { statusCode?: unknown; status?: unknown };
  const value = record.statusCode ?? record.status;
  const number = Number(value);
  return Number.isInteger(number) ? number : undefined;
}

async function deliver(db: DatabaseSync, userId: number, payload: string, send: SendFn): Promise<void> {
  const devices = db
    .prepare('SELECT id, endpoint, p256dh, auth FROM devices WHERE user_id = ?')
    .all(userId) as DeviceRow[];
  for (const device of devices) {
    try {
      await send(
        { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
        payload,
      );
    } catch (err) {
      const status = errorStatus(err);
      if (status === 404 || status === 410) {
        db.prepare('DELETE FROM devices WHERE id = ?').run(device.id);
      } else {
        console.error(`push send failed status=${status ?? 'unknown'}`);
      }
    }
  }
}

export function authorAllowed(publisherIds: string | null, authorId: number): boolean {
  if (publisherIds == null || publisherIds.trim() === '') return true;
  try {
    const parsed = JSON.parse(publisherIds) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return true;
    return parsed.some((value) => Number(value) === authorId);
  } catch {
    return true;
  }
}

type InstantRow = { user_id: number; publisher_ids: string | null };
type PostContext = {
  body: string;
  author_user_id: number;
  title: string;
  slug: string;
  page_id: number;
};

export async function notifyNewPost(db: DatabaseSync, postId: number, send: SendFn): Promise<void> {
  const post = db
    .prepare(
      `SELECT posts.body, posts.author_user_id, posts.page_id, pages.title, pages.slug
       FROM posts JOIN pages ON pages.id = posts.page_id
       WHERE posts.id = ?`,
    )
    .get(postId) as PostContext | undefined;
  if (!post) return;
  const subs = db
    .prepare(
      `SELECT user_id, publisher_ids FROM subscriptions WHERE page_id = ? AND mode = 'instant'`,
    )
    .all(post.page_id) as InstantRow[];
  const payload = JSON.stringify({
    title: post.title,
    body: post.body.slice(0, 180),
    url: `/p/${post.slug}`,
  });
  for (const sub of subs) {
    if (!authorAllowed(sub.publisher_ids, post.author_user_id)) continue;
    await deliver(db, sub.user_id, payload, send);
  }
}

type DigestRow = {
  id: number;
  user_id: number;
  page_id: number;
  publisher_ids: string | null;
  created_at: string;
  last_digest_at: string | null;
  title: string;
  slug: string;
};

type DigestPost = { id: number; body: string; author_user_id: number };

export async function runDigest(db: DatabaseSync, nowIso: string, send: SendFn): Promise<void> {
  const subs = db
    .prepare(
      `SELECT s.id, s.user_id, s.page_id, s.publisher_ids, s.created_at, s.last_digest_at, p.title, p.slug
       FROM subscriptions s
       JOIN pages p ON p.id = s.page_id
       WHERE s.mode = 'daily'`,
    )
    .all() as DigestRow[];
  for (const sub of subs) {
    const since = sub.last_digest_at ?? sub.created_at;
    const posts = db
      .prepare(
        `SELECT id, body, author_user_id FROM posts
         WHERE page_id = ? AND created_at > ?
         ORDER BY created_at DESC, id DESC`,
      )
      .all(sub.page_id, since) as DigestPost[];
    const matched = posts.filter((post) => authorAllowed(sub.publisher_ids, post.author_user_id));
    if (matched.length === 0) continue;
    const count = matched.length;
    const noun = count === 1 ? 'post' : 'posts';
    const newest = matched[0]?.body ?? '';
    const payload = JSON.stringify({
      title: sub.title,
      body: `${count} new ${noun}. Newest: ${newest.slice(0, 140)}`,
      url: `/p/${sub.slug}`,
    });
    await deliver(db, sub.user_id, payload, send);
    db.prepare('UPDATE subscriptions SET last_digest_at = ? WHERE id = ?').run(nowIso, sub.id);
  }
}
