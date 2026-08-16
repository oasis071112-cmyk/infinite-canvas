import type { Readable } from "node:stream";
import { Transform } from "node:stream";
import { Agent, request } from "undici";

import type { providers } from "./db/schema.js";
import { env } from "./env.js";
import { ApiError } from "./errors.js";
import { assertPublicUrl, buildProviderUrl, decryptSecret, securePublicLookup } from "./security.js";

export type ProviderRecord = typeof providers.$inferSelect;
export type ProviderPath = "/models" | "/responses" | "/images/generations" | "/images/edits";

const publicNetworkDispatcher = new Agent({ connect: { lookup: securePublicLookup } });

export async function requestProvider(
    provider: ProviderRecord,
    path: ProviderPath,
    options: { method: "GET" | "POST"; body?: string | Readable; contentType?: string; contentLength?: string; accept?: string; signal?: AbortSignal },
) {
    const url = buildProviderUrl(provider.baseUrl, path);
    await assertPublicUrl(url);
    const apiKey = decryptSecret({ ciphertext: provider.keyCiphertext, iv: provider.keyIv, tag: provider.keyTag });
    const timeoutSignal = AbortSignal.timeout(env.upstreamTimeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
    return request(url, {
        dispatcher: publicNetworkDispatcher,
        method: options.method,
        headers: {
            Authorization: `Bearer ${apiKey}`,
            ...(options.contentType ? { "Content-Type": options.contentType } : {}),
            ...(options.contentLength ? { "Content-Length": options.contentLength } : {}),
            ...(options.accept ? { Accept: options.accept } : {}),
            "User-Agent": "IonAiLabs-Infinite-Canvas/1.0",
        },
        body: options.body,
        signal,
        headersTimeout: env.upstreamTimeoutMs,
        bodyTimeout: env.upstreamTimeoutMs,
    });
}

export function limitStream(stream: Readable, maxBytes: number, code: string) {
    let bytes = 0;
    return stream.pipe(
        new Transform({
            transform(chunk: Buffer, _encoding, callback) {
                bytes += chunk.length;
                if (bytes > maxBytes) callback(new ApiError(413, code, "请求或响应内容超过大小限制"));
                else callback(null, chunk);
            },
        }),
    );
}

export async function readLimitedText(stream: Readable, maxBytes: number) {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of stream) {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += value.length;
        if (bytes > maxBytes) throw new ApiError(502, "UPSTREAM_RESPONSE_TOO_LARGE", "中转站返回的数据过大");
        chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
}
