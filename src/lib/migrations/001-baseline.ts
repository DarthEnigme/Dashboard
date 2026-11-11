import type { DatabaseSync } from "node:sqlite";
import { addColumn } from "./addColumn";

/** Schema step 1: every table and column up to 0.5.11. */
export function baseline(d: DatabaseSync) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS pings (
      service_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      up INTEGER NOT NULL,
      status INTEGER,
      latency_ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS pings_service_ts ON pings (service_id, ts);

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      email TEXT COLLATE NOCASE,
      name TEXT,
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS identities (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      subject TEXT NOT NULL,
      PRIMARY KEY (provider, subject)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      ip TEXT,
      user_agent TEXT,
      method TEXT
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
    CREATE TABLE IF NOT EXISTS password_resets (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_by TEXT
    );
    CREATE TABLE IF NOT EXISTS user_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      description TEXT,
      permissions TEXT NOT NULL DEFAULT '[]',
      sso TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS user_group_members (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      group_id INTEGER NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
      source TEXT NOT NULL DEFAULT 'manual',
      PRIMARY KEY (user_id, group_id)
    );
    CREATE TABLE IF NOT EXISTS pings_hourly (
      service_id TEXT NOT NULL,
      hour INTEGER NOT NULL,
      checks INTEGER NOT NULL,
      up INTEGER NOT NULL,
      avg_ms REAL,
      p95_ms REAL,
      PRIMARY KEY (service_id, hour)
    );
    CREATE TABLE IF NOT EXISTS incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id TEXT NOT NULL,
      start INTEGER NOT NULL,
      end INTEGER,
      cause TEXT
    );
    CREATE INDEX IF NOT EXISTS incidents_service ON incidents (service_id, start);
    CREATE TABLE IF NOT EXISTS fin_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      category TEXT,
      description TEXT NOT NULL DEFAULT '',
      account TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      external_id TEXT UNIQUE,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS fin_transactions_date ON fin_transactions (date);
    CREATE TABLE IF NOT EXISTS fin_categories (
      name TEXT PRIMARY KEY COLLATE NOCASE,
      slot INTEGER
    );
    CREATE TABLE IF NOT EXISTS fin_meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS fin_recurring (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      category TEXT,
      every TEXT NOT NULL,
      every_n INTEGER NOT NULL DEFAULT 1,
      start_date TEXT NOT NULL,
      end_date TEXT,
      last_date TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fin_shortcuts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      category TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fin_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      target_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      deadline TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fin_goal_moves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_id INTEGER NOT NULL REFERENCES fin_goals(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      note TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fin_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      kind TEXT NOT NULL DEFAULT 'bank',
      currency TEXT NOT NULL,
      opening_cents INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS travel_places (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      country TEXT NOT NULL,
      city TEXT,
      lat REAL,
      lon REAL,
      status TEXT NOT NULL DEFAULT 'visited',
      first_date TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS travel_places_owner ON travel_places (owner_id);
    CREATE TABLE IF NOT EXISTS travel_trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      notes TEXT,
      rating INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS travel_stops (
      trip_id INTEGER NOT NULL REFERENCES travel_trips(id) ON DELETE CASCADE,
      ord INTEGER NOT NULL,
      country TEXT NOT NULL,
      city TEXT,
      lat REAL,
      lon REAL,
      arrive TEXT,
      depart TEXT,
      PRIMARY KEY (trip_id, ord)
    );
    CREATE TABLE IF NOT EXISTS travel_companions (
      trip_id INTEGER NOT NULL REFERENCES travel_trips(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (trip_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS watch_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'book',
      title TEXT NOT NULL,
      creator TEXT,
      year INTEGER,
      cover TEXT,
      external_id TEXT,
      status TEXT NOT NULL DEFAULT 'planned',
      rating INTEGER,
      progress INTEGER,
      total INTEGER,
      started TEXT,
      finished TEXT,
      notes TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS watch_items_owner ON watch_items (owner_id, status);
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'other',
      ip TEXT,
      mac TEXT,
      hostname TEXT,
      location TEXT,
      vendor TEXT,
      model TEXT,
      serial TEXT,
      purchase_date TEXT,
      price_cents INTEGER,
      warranty_until TEXT,
      service_id TEXT,
      tags TEXT,
      notes TEXT,
      check_port INTEGER,
      wol_broadcast TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS config_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file TEXT NOT NULL,
      ts INTEGER NOT NULL,
      user TEXT,
      content TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS config_versions_file ON config_versions (file, id);
    CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (
      ts INTEGER NOT NULL,
      user TEXT,
      action TEXT NOT NULL,
      detail TEXT
    );
  `);
  addColumn(d, "fin_categories", "budget_cents INTEGER");
  addColumn(d, "users", "avatar TEXT");
  addColumn(d, "fin_categories", "color TEXT");
  // Encrypted TOTP secret, and SHA-256 hashes of unused recovery codes (JSON).
  addColumn(d, "users", "totp_secret TEXT");
  addColumn(d, "users", "totp_recovery TEXT");
  addColumn(d, "users", "totp_last_step INTEGER");
  addColumn(d, "incidents", "planned INTEGER NOT NULL DEFAULT 0");
  addColumn(d, "incidents", "note TEXT");
  addColumn(d, "incidents", "public_note TEXT");
  addColumn(d, "pings", "maint INTEGER NOT NULL DEFAULT 0");
  // Personal look (theme, background, …) over the global one, as JSON.
  addColumn(d, "users", "prefs TEXT");
  // Both halves of a transfer between own accounts share this id (left out of income and spending).
  addColumn(d, "fin_transactions", "transfer_id TEXT");
  // Subcategories: one level, by the parent's name.
  addColumn(d, "fin_categories", "parent TEXT");
  // Recurring rules tracked as subscriptions (Finance → Subscriptions).
  addColumn(d, "fin_recurring", "subscription INTEGER NOT NULL DEFAULT 0");
  addColumn(d, "fin_recurring", "url TEXT");
  addColumn(d, "fin_recurring", "notes TEXT");
  addColumn(d, "fin_recurring", "remind_days INTEGER");
  addColumn(d, "fin_recurring", "account TEXT");
  addColumn(d, "fin_recurring", "cancel_by TEXT");
  // Watchlist: tags (JSON list) and one shelf per item.
  addColumn(d, "watch_items", "tags TEXT");
  addColumn(d, "watch_items", "list TEXT");
  d.exec(`
    -- Fill in the category of new transactions: the first rule that matches wins.
    CREATE TABLE IF NOT EXISTS fin_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'contains',
      category TEXT NOT NULL,
      account TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS watch_items_external ON watch_items (owner_id, external_id);
    -- Each user's link to their account on a Jellyfin or Plex server.
    CREATE TABLE IF NOT EXISTS watch_sync (
      owner_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      service_id TEXT NOT NULL,
      media_user TEXT NOT NULL,
      last_sync INTEGER,
      last_error TEXT
    );
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      updated_by TEXT
    );
    CREATE TABLE IF NOT EXISTS note_services (
      note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      service_id TEXT NOT NULL,
      PRIMARY KEY (note_id, service_id)
    );
    CREATE INDEX IF NOT EXISTS note_services_service ON note_services (service_id);
    -- Incidents written by admins for the status page (outages found by checks are in incidents).
    CREATE TABLE IF NOT EXISTS status_incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'investigating',
      impact TEXT NOT NULL DEFAULT 'minor',
      services TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      resolved_at INTEGER,
      created_by TEXT
    );
    CREATE TABLE IF NOT EXISTS status_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id INTEGER NOT NULL REFERENCES status_incidents(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      at INTEGER NOT NULL,
      by TEXT
    );
    CREATE INDEX IF NOT EXISTS status_updates_incident ON status_updates (incident_id, at);
  `);
}
