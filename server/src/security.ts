import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { lookup as lookupWithCallback } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";

import { env } from "./env.js";
import { ApiError } from "./errors.js";

export type EncryptedSecret = { ciphertext: string; iv: string; tag: string };

export function encryptSecret(value: string): EncryptedSecret {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", env.masterKey, iv);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return {
        ciphertext: ciphertext.toString("base64"),
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
    };
}

export function decryptSecret(secret: EncryptedSecret) {
    try {
        const decipher = createDecipheriv("aes-256-gcm", env.masterKey, Buffer.from(secret.iv, "base64"));
        decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
        return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext, "base64")), decipher.final()]).toString("utf8");
    } catch {
        throw new ApiError(409, "PROVIDER_KEY_UNREADABLE", "该渠道密钥无法解密，请重新填写 API Key");
    }
}

export function normalizeBaseUrl(input: string) {
    let url: URL;
    try {
        url = new URL(input.trim());
    } catch {
        throw new ApiError(400, "INVALID_BASE_URL", "接口地址格式不正确");
    }
    if (url.protocol !== "https:") throw new ApiError(400, "HTTPS_REQUIRED", "中转站接口必须使用 HTTPS");
    if (url.username || url.password) throw new ApiError(400, "URL_CREDENTIALS_FORBIDDEN", "接口地址不能包含用户名或密码");
    if (url.search || url.hash) throw new ApiError(400, "URL_QUERY_FORBIDDEN", "接口地址不能包含查询参数或锚点");
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/+$/, "");
}

export function buildProviderUrl(baseUrl: string, path: "/models" | "/responses" | "/images/generations" | "/images/edits") {
    const normalized = normalizeBaseUrl(baseUrl);
    const url = new URL(normalized);
    const pathname = url.pathname.replace(/\/+$/, "");
    url.pathname = `${pathname.toLowerCase().endsWith("/v1") ? pathname : `${pathname}/v1`}${path}`;
    return url;
}

function assertPublicAddress(value: string) {
    let address = ipaddr.parse(value);
    if (address instanceof ipaddr.IPv6 && address.isIPv4MappedAddress()) address = address.toIPv4Address();
    if (address.range() !== "unicast") throw new ApiError(400, "PRIVATE_ADDRESS_FORBIDDEN", "中转站地址不能指向内网、回环或保留网络");
}

export const securePublicLookup: LookupFunction = (hostname, options, callback) => {
    lookupWithCallback(hostname, { ...options, all: true, verbatim: true }, (error, addresses) => {
        if (error) return callback(error, "", 0);
        try {
            addresses.forEach((item) => assertPublicAddress(item.address));
        } catch (lookupError) {
            return callback(lookupError as ApiError, "", 0);
        }
        const first = addresses[0];
        if (!first) return callback(new ApiError(400, "DNS_LOOKUP_FAILED", "中转站域名无法解析"), "", 0);
        return options.all ? callback(null, addresses) : callback(null, first.address, first.family);
    });
};

export async function assertPublicUrl(url: URL) {
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    let addresses;
    try {
        addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true });
    } catch {
        throw new ApiError(400, "DNS_LOOKUP_FAILED", "中转站域名无法解析");
    }
    if (!addresses.length) throw new ApiError(400, "DNS_LOOKUP_FAILED", "中转站域名无法解析");
    addresses.forEach((item) => assertPublicAddress(item.address));
}
