-- notify-pages data model. Applied on every boot (idempotent).
-- See SPEC.md. Subscribing does not grant posting rights: publishers are a
-- separate approval table, owned by the page owner.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,            -- 'google' | 'apple'
  provider_id TEXT NOT NULL,
  email TEXT,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, provider_id)
);

CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,         -- shareable URL segment
  owner_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  city TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Users the page owner has approved to post. Everyone else is read-only.
CREATE TABLE IF NOT EXISTS publishers (
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  approved_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (page_id, user_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id),
  image_path TEXT,                   -- optional local path under data/uploads
  body TEXT NOT NULL DEFAULT '',
  event_date TEXT,                   -- optional ISO date (YYYY-MM-DD)
  venue TEXT,
  doors TEXT,                        -- optional free-form doors time
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS posts_page_created ON posts (page_id, created_at DESC);

-- mode: instant | daily | mute. Mute keeps the row so the user stays subscribed.
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('instant', 'daily', 'mute')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, page_id)
);

CREATE INDEX IF NOT EXISTS subscriptions_page ON subscriptions (page_id);

-- Optional filter. Empty means "all approved publishers" for instant mode.
-- Rows here are the publishers the subscriber wants instant alerts from.
CREATE TABLE IF NOT EXISTS subscription_publishers (
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  publisher_user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (subscription_id, publisher_user_id)
);

-- One row per browser push subscription. A user may have several devices.
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS devices_user ON devices (user_id);
