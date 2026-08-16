import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { lt } from "drizzle-orm";
import Fastify from "fastify";

import { db, sqlite } from "./db/index.js";
import { anonymousSessions, callSummaries } from "./db/schema.js";
import { DAY_MS, env } from "./env.js";
import { ApiError } from "./errors.js";
import { registerRoutes } from "./routes.js";
import { attachAnonymousSession } from "./session.js";

const app = Fastify({
    trustProxy: 1,
    bodyLimit: env.maxUploadBytes,
    logger: {
        level: process.env.LOG_LEVEL || "info",
        redact: ["req.headers.authorization", "req.headers.cookie", "req.body.apiKey"],
    },
});

await app.register(cookie);
await app.register(rateLimit, { global: true, max: 120, timeWindow: "1 minute" });

app.addContentTypeParser(/^multipart\/form-data(?:;.*)?$/i, (_request, payload, done) => done(null, payload));

app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/") || request.url.startsWith("/api/health")) return;
    const origin = request.headers.origin?.replace(/\/+$/, "");
    if (request.method !== "GET" && origin && origin !== env.appOrigin) throw new ApiError(403, "ORIGIN_FORBIDDEN", "请求来源不受信任");
    attachAnonymousSession(request, reply);
});

app.addHook("onSend", async (_request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "same-origin");
});

app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    const statusCode = typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
    app.log.error({ err: error }, "request failed");
    return reply.code(statusCode).send({ error: { code: statusCode === 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED", message: statusCode === 500 ? "服务器处理请求失败" : error.message } });
});

await registerRoutes(app);

function cleanupExpiredData() {
    const now = Date.now();
    db.delete(callSummaries).where(lt(callSummaries.createdAt, now - env.callLogDays * DAY_MS)).run();
    db.delete(anonymousSessions).where(lt(anonymousSessions.expiresAt, now)).run();
}

cleanupExpiredData();
const cleanupTimer = setInterval(cleanupExpiredData, DAY_MS);
cleanupTimer.unref();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, async () => {
        clearInterval(cleanupTimer);
        await app.close();
        sqlite.close();
        process.exit(0);
    });
}

await app.listen({ host: env.host, port: env.port });
