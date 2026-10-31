import { Database } from "bun:sqlite";

// Persistent cache: survives restarts.
const db = new Database("cache.sqlite");
db.run("CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT, expires INTEGER)");

export function get(key: string): string | null {
  const row = db.query("SELECT value, expires FROM cache WHERE key = ?").get(key) as { value: string; expires: number } | null;
  if (!row || row.expires < Date.now()) return null;
  return row.value;
}

export function set(key: string, value: string, ttlMs: number) {
  db.run("INSERT OR REPLACE INTO cache VALUES (?, ?, ?)", [key, value, Date.now() + ttlMs]);
}
