import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { and, asc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { acquireAiSlot } from "./concurrency.js";
import { db } from "./db/index.js";
import { callSummaries, providerModels, providers } from "./db/schema.js";
import { env } from "./env.js";
import { ApiError, errorCode } from "./errors.js";
import { assertPublicUrl, buildProviderUrl, encryptSecret, normalizeBaseUrl } from "./security.js";
import { limitStream, readLimitedText, requestProvider, type ProviderRecord, type ProviderPath } from "./upstream.js";

const providerCreateSchema = z.object({
    name: z.string().trim().min(1).max(80),
    baseUrl: z.string().trim().min(1).max(2048),
    apiKey: z.string().min(1).max(8192),
});
const providerUpdateSchema = z
    .object({
        name: z.string().trim().min(1).max(80).optional(),
        baseUrl: z.string().trim().min(1).max(2048).optional(),
        apiKey: z.string().min(1).max(8192).optional(),
    })
    .refine((value) => Object.keys(value).length > 0);
const modelsSchema = z.object({
    models: z
        .array(z.object({ name: z.string().trim().min(1).max(200), capability: z.enum(["image", "text"]) }))
        .max(500),
});
const idParamsSchema = z.object({ id: z.string().uuid() });
const aiJsonSchema = z
    .object({
        providerId: z.string().uuid(),
        model: z.string().trim().min(1).max(200),
    })
    .passthrough();
const editQuerySchema = z.object({ providerId: z.string().uuid(), model: z.string().trim().min(1).max(200) });

type Capability = "image" | "text";

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) throw new ApiError(400, "INVALID_REQUEST", "请求参数不正确");
    return result.data;
}

function ownedProvider(sessionId: string, id: string) {
    const provider = db
        .select()
        .from(providers)
        .where(and(eq(providers.id, id), eq(providers.sessionId, sessionId)))
        .get();
    if (!provider) throw new ApiError(404, "PROVIDER_NOT_FOUND", "渠道不存在或不属于当前浏览器");
    return provider;
}

function modelsForProvider(providerId: string) {
    return db.select().from(providerModels).where(eq(providerModels.providerId, providerId)).orderBy(asc(providerModels.name)).all();
}

function providerResponse(provider: ProviderRecord) {
    return {
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        keyConfigured: true,
        models: modelsForProvider(provider.id).map(({ name, capability }) => ({ name, capability })),
        createdAt: provider.createdAt,
        updatedAt: provider.updatedAt,
    };
}

function requireConfiguredModel(providerId: string, model: string, capability: Capability) {
    const configured = db
        .select()
        .from(providerModels)
        .where(and(eq(providerModels.providerId, providerId), eq(providerModels.name, model)))
        .get();
    if (!configured || configured.capability !== capability) throw new ApiError(400, "MODEL_NOT_CONFIGURED", `请先将模型配置为${capability === "image" ? "生图" : "文本"}能力`);
}

function recordCall(input: {
    sessionId: string;
    providerId: string;
    capability: Capability;
    operation: string;
    model: string;
    status: "success" | "failed";
    httpStatus?: number;
    durationMs: number;
    errorCode?: string;
}) {
    db.insert(callSummaries)
        .values({ id: randomUUID(), createdAt: Date.now(), ...input, httpStatus: input.httpStatus ?? null, errorCode: input.errorCode ?? null })
        .run();
}

function copyUpstreamHeaders(reply: FastifyReply, headers: Record<string, string | string[] | undefined>) {
    for (const name of ["content-type", "content-length", "cache-control", "x-request-id"]) {
        const value = headers[name];
        if (value !== undefined) reply.header(name, Array.isArray(value) ? value.join(", ") : value);
    }
    reply.header("X-Accel-Buffering", "no");
}

function ensureResponseSize(headers: Record<string, string | string[] | undefined>) {
    const value = headers["content-length"];
    const size = Number(Array.isArray(value) ? value[0] : value || 0);
    if (size > env.maxResponseBytes) throw new ApiError(502, "UPSTREAM_RESPONSE_TOO_LARGE", "中转站返回的数据超过服务器限制");
}

async function proxyJson(request: FastifyRequest, reply: FastifyReply, path: Exclude<ProviderPath, "/models" | "/images/edits">, capability: Capability, operation: string) {
    const input = parse(aiJsonSchema, request.body);
    const provider = ownedProvider(request.anonymousSessionId, input.providerId);
    requireConfiguredModel(provider.id, input.model, capability);
    const upstreamBody = { ...input } as Record<string, unknown>;
    delete upstreamBody.providerId;
    const startedAt = Date.now();
    const release = acquireAiSlot(request.anonymousSessionId, request.ip);
    const controller = new AbortController();
    request.raw.once("aborted", () => controller.abort());
    reply.raw.once("close", () => controller.abort());
    try {
        const upstream = await requestProvider(provider, path, {
            method: "POST",
            body: JSON.stringify(upstreamBody),
            contentType: "application/json",
            accept: path === "/responses" ? "text/event-stream, application/json" : "application/json",
            signal: controller.signal,
        });
        ensureResponseSize(upstream.headers);
        const success = upstream.statusCode >= 200 && upstream.statusCode < 300;
        recordCall({
            sessionId: request.anonymousSessionId,
            providerId: provider.id,
            capability,
            operation,
            model: input.model,
            status: success ? "success" : "failed",
            httpStatus: upstream.statusCode,
            durationMs: Date.now() - startedAt,
            errorCode: success ? undefined : `UPSTREAM_HTTP_${upstream.statusCode}`,
        });
        reply.raw.once("finish", release);
        reply.raw.once("close", release);
        copyUpstreamHeaders(reply, upstream.headers);
        return reply.code(upstream.statusCode).send(limitStream(upstream.body, env.maxResponseBytes, "UPSTREAM_RESPONSE_TOO_LARGE"));
    } catch (error) {
        release();
        recordCall({ sessionId: request.anonymousSessionId, providerId: provider.id, capability, operation, model: input.model, status: "failed", durationMs: Date.now() - startedAt, errorCode: errorCode(error) });
        throw error;
    }
}

async function proxyImageEdit(request: FastifyRequest, reply: FastifyReply) {
    const query = parse(editQuerySchema, request.query);
    const provider = ownedProvider(request.anonymousSessionId, query.providerId);
    requireConfiguredModel(provider.id, query.model, "image");
    const contentType = request.headers["content-type"] || "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data;")) throw new ApiError(415, "MULTIPART_REQUIRED", "图片编辑请求必须使用 multipart/form-data");
    const contentLength = Number(request.headers["content-length"] || 0);
    if (contentLength > env.maxUploadBytes) throw new ApiError(413, "UPLOAD_TOO_LARGE", "上传内容超过大小限制");
    const body = request.body as Readable;
    if (!body?.pipe) throw new ApiError(400, "EMPTY_UPLOAD", "图片编辑请求内容为空");
    const startedAt = Date.now();
    const release = acquireAiSlot(request.anonymousSessionId, request.ip);
    const controller = new AbortController();
    request.raw.once("aborted", () => controller.abort());
    reply.raw.once("close", () => controller.abort());
    try {
        const upstream = await requestProvider(provider, "/images/edits", {
            method: "POST",
            body: limitStream(body, env.maxUploadBytes, "UPLOAD_TOO_LARGE"),
            contentType,
            contentLength: contentLength ? String(contentLength) : undefined,
            accept: "application/json",
            signal: controller.signal,
        });
        ensureResponseSize(upstream.headers);
        const success = upstream.statusCode >= 200 && upstream.statusCode < 300;
        recordCall({
            sessionId: request.anonymousSessionId,
            providerId: provider.id,
            capability: "image",
            operation: "images.edits",
            model: query.model,
            status: success ? "success" : "failed",
            httpStatus: upstream.statusCode,
            durationMs: Date.now() - startedAt,
            errorCode: success ? undefined : `UPSTREAM_HTTP_${upstream.statusCode}`,
        });
        reply.raw.once("finish", release);
        reply.raw.once("close", release);
        copyUpstreamHeaders(reply, upstream.headers);
        return reply.code(upstream.statusCode).send(limitStream(upstream.body, env.maxResponseBytes, "UPSTREAM_RESPONSE_TOO_LARGE"));
    } catch (error) {
        release();
        recordCall({ sessionId: request.anonymousSessionId, providerId: provider.id, capability: "image", operation: "images.edits", model: query.model, status: "failed", durationMs: Date.now() - startedAt, errorCode: errorCode(error) });
        throw error;
    }
}

export async function registerRoutes(app: FastifyInstance) {
    app.get("/api/health", { config: { rateLimit: false } }, async () => ({ ok: true }));
    app.get("/api/session", async () => ({ ready: true, expiresInDays: env.sessionDays }));

    app.get("/api/providers", async (request) => {
        const rows = db.select().from(providers).where(eq(providers.sessionId, request.anonymousSessionId)).orderBy(asc(providers.createdAt)).all();
        return { providers: rows.map(providerResponse) };
    });

    app.post("/api/providers", async (request, reply) => {
        const input = parse(providerCreateSchema, request.body);
        const baseUrl = normalizeBaseUrl(input.baseUrl);
        await assertPublicUrl(buildProviderUrl(baseUrl, "/models"));
        const encrypted = encryptSecret(input.apiKey);
        const now = Date.now();
        const provider: ProviderRecord = {
            id: randomUUID(),
            sessionId: request.anonymousSessionId,
            name: input.name,
            baseUrl,
            keyCiphertext: encrypted.ciphertext,
            keyIv: encrypted.iv,
            keyTag: encrypted.tag,
            createdAt: now,
            updatedAt: now,
        };
        db.insert(providers).values(provider).run();
        return reply.code(201).send(providerResponse(provider));
    });

    app.patch("/api/providers/:id", async (request) => {
        const { id } = parse(idParamsSchema, request.params);
        const current = ownedProvider(request.anonymousSessionId, id);
        const input = parse(providerUpdateSchema, request.body);
        const update: Partial<ProviderRecord> = { updatedAt: Date.now() };
        if (input.name !== undefined) update.name = input.name;
        if (input.baseUrl !== undefined) {
            update.baseUrl = normalizeBaseUrl(input.baseUrl);
            await assertPublicUrl(buildProviderUrl(update.baseUrl, "/models"));
        }
        if (input.apiKey !== undefined) {
            const encrypted = encryptSecret(input.apiKey);
            update.keyCiphertext = encrypted.ciphertext;
            update.keyIv = encrypted.iv;
            update.keyTag = encrypted.tag;
        }
        db.update(providers).set(update).where(eq(providers.id, current.id)).run();
        return providerResponse({ ...current, ...update });
    });

    app.delete("/api/providers/:id", async (request, reply) => {
        const { id } = parse(idParamsSchema, request.params);
        ownedProvider(request.anonymousSessionId, id);
        db.delete(providers).where(eq(providers.id, id)).run();
        return reply.code(204).send();
    });

    app.post("/api/providers/:id/models/refresh", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
        const { id } = parse(idParamsSchema, request.params);
        const provider = ownedProvider(request.anonymousSessionId, id);
        const release = acquireAiSlot(request.anonymousSessionId, request.ip);
        const controller = new AbortController();
        request.raw.once("aborted", () => controller.abort());
        reply.raw.once("close", () => controller.abort());
        try {
            const upstream = await requestProvider(provider, "/models", { method: "GET", accept: "application/json", signal: controller.signal });
            const text = await readLimitedText(upstream.body, 2_097_152);
            if (upstream.statusCode < 200 || upstream.statusCode >= 300) throw new ApiError(502, `UPSTREAM_HTTP_${upstream.statusCode}`, `读取模型失败（上游 HTTP ${upstream.statusCode}）`);
            let payload: unknown;
            try {
                payload = JSON.parse(text);
            } catch {
                throw new ApiError(502, "INVALID_MODELS_RESPONSE", "中转站返回的模型列表不是有效 JSON");
            }
            const data = payload && typeof payload === "object" && "data" in payload ? (payload as { data?: unknown }).data : undefined;
            const models = Array.isArray(data)
                ? Array.from(new Set(data.flatMap((item) => (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string" ? [(item as { id: string }).id] : [])))).sort((a, b) => a.localeCompare(b))
                : [];
            return { models };
        } finally {
            release();
        }
    });

    app.put("/api/providers/:id/models", async (request) => {
        const { id } = parse(idParamsSchema, request.params);
        const provider = ownedProvider(request.anonymousSessionId, id);
        const input = parse(modelsSchema, request.body);
        const unique = Array.from(new Map(input.models.map((model) => [model.name, model])).values());
        db.transaction((tx) => {
            tx.delete(providerModels).where(eq(providerModels.providerId, provider.id)).run();
            if (unique.length) tx.insert(providerModels).values(unique.map((model) => ({ providerId: provider.id, ...model }))).run();
            tx.update(providers).set({ updatedAt: Date.now() }).where(eq(providers.id, provider.id)).run();
        });
        return providerResponse({ ...provider, updatedAt: Date.now() });
    });

    app.post("/api/ai/responses", { bodyLimit: env.maxJsonBytes, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, (request, reply) => proxyJson(request, reply, "/responses", "text", "responses"));
    app.post("/api/ai/images/generations", { bodyLimit: env.maxJsonBytes, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, (request, reply) => proxyJson(request, reply, "/images/generations", "image", "images.generations"));
    app.post("/api/ai/images/edits", { bodyLimit: env.maxUploadBytes, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, proxyImageEdit);
}
