import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const anonymousSessions = sqliteTable(
    "anonymous_sessions",
    {
        id: text("id").primaryKey(),
        tokenHash: text("token_hash").notNull(),
        createdAt: integer("created_at").notNull(),
        lastSeenAt: integer("last_seen_at").notNull(),
        expiresAt: integer("expires_at").notNull(),
    },
    (table) => [uniqueIndex("anonymous_sessions_token_hash_idx").on(table.tokenHash)],
);

export const providers = sqliteTable("providers", {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
        .notNull()
        .references(() => anonymousSessions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    baseUrl: text("base_url").notNull(),
    keyCiphertext: text("key_ciphertext").notNull(),
    keyIv: text("key_iv").notNull(),
    keyTag: text("key_tag").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
});

export const providerModels = sqliteTable(
    "provider_models",
    {
        providerId: text("provider_id")
            .notNull()
            .references(() => providers.id, { onDelete: "cascade" }),
        name: text("name").notNull(),
        capability: text("capability", { enum: ["image", "text"] }).notNull(),
    },
    (table) => [primaryKey({ columns: [table.providerId, table.name] })],
);

export const callSummaries = sqliteTable("call_summaries", {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
        .notNull()
        .references(() => anonymousSessions.id, { onDelete: "cascade" }),
    providerId: text("provider_id").references(() => providers.id, { onDelete: "set null" }),
    capability: text("capability", { enum: ["image", "text"] }).notNull(),
    operation: text("operation").notNull(),
    model: text("model").notNull(),
    status: text("status", { enum: ["success", "failed"] }).notNull(),
    httpStatus: integer("http_status"),
    durationMs: integer("duration_ms").notNull(),
    errorCode: text("error_code"),
    createdAt: integer("created_at").notNull(),
});
