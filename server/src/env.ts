import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

function integer(name: string, fallback: number) {
    const value = Number(process.env[name] || fallback);
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
    return value;
}

function masterKey() {
    const encoded = process.env.API_KEY_MASTER_KEY?.trim() || "";
    const value = Buffer.from(encoded, "base64");
    if (value.length !== 32) throw new Error("API_KEY_MASTER_KEY must be a base64-encoded 32-byte key");
    return value;
}

const cookieSecure = process.env.COOKIE_SECURE !== "false";

function applicationOrigin() {
    let url: URL;
    try {
        url = new URL(process.env.APP_ORIGIN || "http://localhost:3000");
    } catch {
        throw new Error("APP_ORIGIN must be an absolute origin");
    }
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("APP_ORIGIN must not contain credentials, a path, a query, or a fragment");
    if (cookieSecure && url.protocol !== "https:") throw new Error("APP_ORIGIN must use HTTPS when COOKIE_SECURE is enabled");
    return url.origin;
}

const databasePath = resolve(process.env.DATABASE_PATH || "./data/ionailabs-canvas.sqlite");
mkdirSync(dirname(databasePath), { recursive: true });

export const env = {
    host: process.env.HOST || "0.0.0.0",
    port: integer("PORT", 4000),
    appOrigin: applicationOrigin(),
    databasePath,
    masterKey: masterKey(),
    cookieSecure,
    sessionDays: integer("SESSION_DAYS", 365),
    callLogDays: integer("CALL_LOG_DAYS", 90),
    maxJsonBytes: integer("MAX_JSON_BYTES", 20_971_520),
    maxUploadBytes: integer("MAX_UPLOAD_BYTES", 52_428_800),
    maxResponseBytes: integer("MAX_RESPONSE_BYTES", 104_857_600),
    upstreamTimeoutMs: integer("UPSTREAM_TIMEOUT_MS", 600_000),
    sessionConcurrency: integer("SESSION_AI_CONCURRENCY", 4),
    ipConcurrency: integer("IP_AI_CONCURRENCY", 8),
    globalConcurrency: integer("GLOBAL_AI_CONCURRENCY", 20),
};

export const DAY_MS = 86_400_000;
