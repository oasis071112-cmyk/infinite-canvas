import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { env } from "../env.js";
import * as schema from "./schema.js";

export const sqlite = new Database(env.databasePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("synchronous = NORMAL");
sqlite.pragma("busy_timeout = 5000");
sqlite.pragma("foreign_keys = ON");
sqlite.exec(`
    CREATE TABLE IF NOT EXISTS anonymous_sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES anonymous_sessions(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        key_ciphertext TEXT NOT NULL,
        key_iv TEXT NOT NULL,
        key_tag TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS providers_session_id_idx ON providers(session_id);
    CREATE TABLE IF NOT EXISTS provider_models (
        provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        capability TEXT NOT NULL CHECK (capability IN ('image', 'text')),
        PRIMARY KEY (provider_id, name)
    );
    CREATE TABLE IF NOT EXISTS call_summaries (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES anonymous_sessions(id) ON DELETE CASCADE,
        provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL,
        capability TEXT NOT NULL CHECK (capability IN ('image', 'text')),
        operation TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
        http_status INTEGER,
        duration_ms INTEGER NOT NULL,
        error_code TEXT,
        created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS call_summaries_created_at_idx ON call_summaries(created_at);
`);

export const db = drizzle(sqlite, { schema });
