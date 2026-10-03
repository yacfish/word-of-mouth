// Opens the SQLite file and creates the Word of Mouth tables when they are missing.

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DEFAULT_DB_PATH = './data/word-of-mouth.sqlite';

export function openDatabase(dbPath = process.env.WOM_DB ?? DEFAULT_DB_PATH): DatabaseSync {
  if (dbPath !== ':memory:') {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

export function applySchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      provider TEXT NOT NULL,
      subject TEXT NOT NULL,
      display_name TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (provider, subject)
    );

    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      owner_user_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      city TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS publishers (
      page_id INTEGER NOT NULL REFERENCES pages(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      PRIMARY KEY (page_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY,
      page_id INTEGER NOT NULL REFERENCES pages(id),
      author_user_id INTEGER NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      image_path TEXT,
      event_date TEXT,
      venue TEXT,
      doors TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      page_id INTEGER NOT NULL REFERENCES pages(id),
      mode TEXT NOT NULL CHECK (mode IN ('instant', 'daily', 'mute')),
      publisher_ids TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (user_id, page_id)
    );

    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}
