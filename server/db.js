import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), 'schema.sql');

/**
 * Open (and migrate) the SQLite database.
 * Uses node:sqlite so a cheap VPS does not need a native build.
 * @param {string} path filesystem path, or ':memory:' for tests
 */
export function openDatabase(path) {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(schemaPath, 'utf8'));
  return db;
}
