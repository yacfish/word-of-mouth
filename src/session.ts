// Signed cookie session. The payload is the user id plus a CSRF token.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const DEV_SESSION_SECRET = 'word-of-mouth-dev-session-secret';

export const SESSION_COOKIE = 'wom_session';

export type Session = {
  uid: number | null;
  csrf: string;
};

export function sessionSecret(): string {
  const fromEnv = process.env.WOM_SESSION_SECRET;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('WOM_SESSION_SECRET is required when NODE_ENV is production');
  }
  return DEV_SESSION_SECRET;
}

export function newCsrf(): string {
  return randomBytes(32).toString('base64url');
}

export function signSession(session: Session, secret: string): string {
  const body = Buffer.from(JSON.stringify({ uid: session.uid, csrf: session.csrf })).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function readSession(token: string | undefined, secret: string): Session | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString()) as {
      uid?: unknown;
      csrf?: unknown;
    };
    if (typeof parsed.csrf !== 'string' || parsed.csrf.length < 16) return null;
    if (parsed.uid !== null && (typeof parsed.uid !== 'number' || !Number.isInteger(parsed.uid))) return null;
    return { uid: parsed.uid === null ? null : parsed.uid, csrf: parsed.csrf };
  } catch {
    return null;
  }
}

export function sessionCookie(session: Session, secret: string): string {
  const value = signSession(session, secret);
  return `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
