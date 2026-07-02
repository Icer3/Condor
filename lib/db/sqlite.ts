// SQLite singleton — opens .data/calibration.db, runs migrations on startup.
// Server-only (uses node fs path). Never import from a client component.

import Database from 'better-sqlite3';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DATA_DIR = path.join(process.cwd(), '.data');
const DB_FILE = path.join(DATA_DIR, 'calibration.db');
const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

let _db: Database.Database | null = null;
let _migrated = false;

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function runMigrations(db: Database.Database) {
  if (_migrated) return;
  // Bootstrap table for migration tracking
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  const applied = new Set(
    (db.prepare(`SELECT id FROM _migrations`).all() as { id: string }[]).map(r => r.id)
  );

  let files: string[];
  try {
    files = (await fs.readdir(MIGRATIONS_DIR)).filter(f => f.endsWith('.sql')).sort();
  } catch {
    // Migrations dir not found — no migrations to apply.
    return;
  }

  for (const file of files) {
    const id = file.replace(/\.sql$/, '');
    if (applied.has(id)) continue;
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf-8');
    db.exec(`BEGIN`);
    try {
      db.exec(sql);
      db.prepare(`INSERT INTO _migrations (id, applied_at) VALUES (?, ?)`).run(id, new Date().toISOString());
      db.exec(`COMMIT`);
    } catch (err) {
      db.exec(`ROLLBACK`);
      throw err;
    }
  }
  _migrated = true;
}

export async function getDb(): Promise<Database.Database> {
  if (_db) return _db;
  if (typeof window !== 'undefined') {
    throw new Error('getDb() must not be called from the browser');
  }
  await ensureDir();
  _db = new Database(DB_FILE);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  await runMigrations(_db);
  return _db;
}

/** Synchronous variant: useful in tests with `:memory:` databases. Don't use in prod. */
export function openInMemory(): Database.Database {
  return new Database(':memory:');
}

/** Apply SQL migrations to a raw database connection. Used by tests. */
export async function applyMigrations(db: Database.Database) {
  _migrated = false; // reset so migrations can re-run
  await runMigrations(db);
}
