import axios from "axios";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { buildImageReferencePromptText } from "@/lib/image-reference-prompt";
import { dataUrlToFile } from "@/lib/image-utils";
import { imageToDataUrl } from "@/services/image-storage";
import { refreshProviderModels } from "@/services/api/providers";
import { decodeChannelModel, type AiConfig, type ModelChannel } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export type AiTextMessage = {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

type RequestOptions = { signal?: AbortSignal };
type ImageApiResponse = {
    data?: Array<Record<string, unknown>>;
    images?: Array<Record<string, unknown>>;
    results?: Array<Record<string, unknown>>;
    error?: { message?: string } | string;
    code?: number;
    msg?: string;
};
type ResponseInputContent = { type: "input_text"; text: string } | { type: "input_image"; image_url: string };
type ResponseApiPayload = {
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
    output_text?: string;
    error?: { message?: string };
    code?: number;
    msg?: string;
};
type ResponseStreamState = { buffer: string; text: string; payload?: ResponseApiPayload; error?: string };

const QUALITY_BASE: Record<string, number> = { low: 1024, medium: 2048, high: 2880, standard: 1024, hd: 2048 };
const QUALITY_ALIASES: Record<string, string> = { "1k": "low", "2k": "medium", "4k": "high" };
const DEFAULT_IMAGE_SHORT_SIDE = 1024;
const IMAGE_SIZE_STEP = 16;
const IMAGE_MIN_PIXELS = 655360;
const IMAGE_MAX_PIXELS = 8294400;
const IMAGE_MAX_EDGE = 3840;
const IMAGE_MAX_RATIO = 3;
const IMAGE_OUTPUT_FORMAT = "png";

function normalizeQuality(quality: string) {
    const value = quality.trim().toLowerCase();
    const normalized = QUALITY_ALIASES[value] || value;
    return QUALITY_BASE[normalized] ? normalized : undefined;
}

function normalizeBackground(background: string | undefined) {
    return background?.trim().toLowerCase() === "transparent" ? "transparent" : undefined;
}

function parseRatioValue(value: string) {
    const parts = value.split(":");
    if (parts.length !== 2) throw new Error(apiText("invalidImageSizeFormat"));
    const width = Number(parts[0]);
    const height = Number(parts[1]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error(apiText("positiveImageRatio"));
    return { width, height };
}

function parseImageRatio(value: string) {
    const ratio = parseRatioValue(value);
    if (Math.max(ratio.width, ratio.height) / Math.min(ratio.width, ratio.height) > IMAGE_MAX_RATIO) throw new Error(apiText("imageRatioLimit"));
    return ratio;
}

function validateImageSize(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error(apiText("positiveImageDimensions"));
    if (width % IMAGE_SIZE_STEP !== 0 || height % IMAGE_SIZE_STEP !== 0) throw new Error(apiText("imageDimensionStep"));
    if (Math.max(width, height) > IMAGE_MAX_EDGE) throw new Error(apiText("imageEdgeLimit"));
    if (Math.max(width, height) / Math.min(width, height) > IMAGE_MAX_RATIO) throw new Error(apiText("imageRatioLimit"));
    const pixels = width * height;
    if (pixels < IMAGE_MIN_PIXELS || pixels > IMAGE_MAX_PIXELS) throw new Error(apiText("imagePixelLimit"));
}

function resolveSize(quality: string | undefined, ratioValue: string) {
    const ratio = parseImageRatio(ratioValue);
    const landscape = ratio.width >= ratio.height;
    const longRatio = landscape ? ratio.width / ratio.height : ratio.height / ratio.width;
    const basePixels = quality ? QUALITY_BASE[quality] : undefined;
    let longSide: number;
    let shortSide: number;
    if (basePixels) {
        longSide = Math.floor(Math.sqrt(basePixels * basePixels * longRatio) / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
        shortSide = Math.round(longSide / longRatio / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    } else {
        shortSide = DEFAULT_IMAGE_SHORT_SIDE;
        longSide = Math.round((shortSide * longRatio) / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    }
    const width = landscape ? longSide : shortSide;
    const height = landscape ? shortSide : longSide;
    validateImageSize(width, height);
    return `${width}x${height}`;
}

function resolveRequestSize(quality: string | undefined, size: string) {
    const value = size.trim();
    if (!value || value.toLowerCase() === "auto") return undefined;
    const dimensions = value.match(/^(\d+)x(\d+)$/i);
    if (dimensions) {
        const width = Number(dimensions[1]);
        const height = Number(dimensions[2]);
        validateImageSize(width, height);
        return `${width}x${height}`;
    }
    if (value.includes(":")) return resolveSize(quality, value);
    throw new Error(apiText("invalidImageSizeFormat"));
}

function requestTarget(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded || !config.channels.some((channel) => channel.id === decoded.channelId && channel.models.some((model) => model.name === decoded.model))) throw new Error(apiText("apiKeyRequired"));
    return { providerId: decoded.channelId, model: decoded.model };
}

function withSystemPrompt(config: AiConfig, prompt: string) {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
}

function toResponseContent(content: AiTextMessage["content"]): string | ResponseInputContent[] {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => (item.type === "text" ? { type: "input_text" as const, text: item.text } : { type: "input_image" as const, image_url: item.image_url.url }));
}

function toResponseInput(config: AiConfig, messages: AiTextMessage[]) {
    const systemPrompt = config.systemPrompt.trim();
    const source = systemPrompt ? [{ role: "system" as const, content: systemPrompt }, ...messages] : messages;
    return source.map((message) => ({ role: message.role, content: toResponseContent(message.content) }));
}

function resolveImageDataUrl(item: Record<string, unknown>) {
    if (typeof item.b64_json === "string" && item.b64_json) return `data:image/png;base64,${item.b64_json}`;
    if (typeof item.url === "string" && item.url.startsWith("data:image/")) return item.url;
    return null;
}

function parseImagePayload(payload: ImageApiResponse) {
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || apiText("requestFailed"));
    const imageList = payload.data || payload.images || payload.results || [];
    const images = imageList
        .map(resolveImageDataUrl)
        .filter((value): value is string => Boolean(value))
        .map((dataUrl) => ({ id: nanoid(), dataUrl }));
    if (images.length) return images;
    const fields = Object.keys(payload).filter((key) => !["code", "msg", "error"].includes(key));
    throw new Error(fields.length ? apiText("unknownImageResponse", { fields: fields.join(", ") }) : apiText("noImageReturned"));
}

function readApiErrorMessage(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string") {
        try {
            return readApiErrorMessage(JSON.parse(value)) || value;
        } catch {
            return /<[a-z][\s\S]*>/i.test(value) ? apiText("htmlError", { preview: `${value.slice(0, 80)}...` }) : value;
        }
    }
    if (typeof value !== "object") return "";
    const payload = value as { msg?: unknown; message?: unknown; error?: unknown; detail?: unknown };
    const nestedError = typeof payload.error === "object" && payload.error ? (payload.error as { message?: unknown }).message : payload.error;
    return readApiErrorMessage(payload.msg) || readApiErrorMessage(payload.message) || readApiErrorMessage(nestedError) || readApiErrorMessage(payload.detail);
}

function statusError(status: number, fallback: string) {
    if (status === 401 || status === 403) return apiText("authenticationFailed");
    if (status === 404) return apiText("notFound");
    if (status === 429) return apiText("rateLimited");
    if (status === 502) return apiText("badGateway");
    if (status === 503) return apiText("serviceBusy");
    return status ? apiText("httpFailed", { status }) : fallback;
}

function readRequestError(error: unknown, fallback: string) {
    if (error instanceof DOMException && error.name === "AbortError") return apiText("requestCanceled");
    if (axios.isCancel(error)) return apiText("requestCanceled");
    if (axios.isAxiosError(error)) return readApiErrorMessage(error.response?.data) || statusError(error.response?.status || 0, error.message || fallback);
    return error instanceof Error ? error.message : fallback;
}

async function readFetchError(response: Response, fallback: string) {
    const text = await response.text();
    if (!text) return statusError(response.status, fallback);
    try {
        return readApiErrorMessage(JSON.parse(text)) || statusError(response.status, fallback);
    } catch {
        return text.slice(0, 300) || statusError(response.status, fallback);
    }
}

function responsePayloadText(payload: ResponseApiPayload) {
    if (payload.error?.message) throw new Error(payload.error.message);
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || apiText("requestFailed"));
    return (
        payload.output_text ||
        (payload.output || [])
            .flatMap((item) => (item.type === "message" ? item.content || [] : []))
            .map((item) => item.text || "")
            .join("")
    );
}

function streamError(value: unknown) {
    if (!value || typeof value !== "object") return "";
    const event = value as Record<string, unknown>;
    return readApiErrorMessage(event.error) || (event.response && typeof event.response === "object" ? readApiErrorMessage((event.response as Record<string, unknown>).error) : "");
}

function consumeResponseBlock(block: string, state: ResponseStreamState, onDelta: (text: string) => void) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data) as Record<string, unknown>;
    const error = streamError(event);
    if (error) state.error = error;
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
        state.text += event.delta;
        onDelta(state.text);
    }
    if (event.type === "response.output_text.done" && !state.text && typeof event.text === "string") {
        state.text = event.text;
        onDelta(state.text);
    }
    if (event.type === "response.completed" && event.response && typeof event.response === "object") state.payload = event.response as ResponseApiPayload;
}

function consumeResponseText(state: ResponseStreamState, text: string, onDelta: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        const index = match.index || 0;
        consumeResponseBlock(state.buffer.slice(0, index), state, onDelta);
        state.buffer = state.buffer.slice(index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeResponseBlock(state.buffer, state, onDelta);
        state.buffer = "";
    }
}

export async function requestGeneration(config: AiConfig, prompt: string, options?: RequestOptions) {
    const target = requestTarget(config, config.model || config.imageModel);
    const count = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const quality = normalizeQuality(config.quality);
    const size = resolveRequestSize(quality, config.size);
    const background = normalizeBackground(config.background);
    try {
        const response = await axios.post<ImageApiResponse>(
            "/api/ai/images/generations",
            {
                ...target,
                prompt: withSystemPrompt(config, prompt),
                n: count,
                response_format: "b64_json",
                output_format: IMAGE_OUTPUT_FORMAT,
                ...(quality ? { quality } : {}),
                ...(size ? { size } : {}),
                ...(background ? { background } : {}),
            },
            { signal: options?.signal },
        );
        return parseImagePayload(response.data);
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        throw new Error(readRequestError(error, apiText("requestFailed")));
    }
}

export async function requestEdit(config: AiConfig, prompt: string, references: ReferenceImage[], mask?: ReferenceImage, options?: RequestOptions) {
    const target = requestTarget(config, config.model || config.imageModel);
    const count = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const quality = normalizeQuality(config.quality);
    const size = resolveRequestSize(quality, config.size);
    const background = normalizeBackground(config.background);
    const formData = new FormData();
    formData.set("model", target.model);
    formData.set("prompt", withSystemPrompt(config, buildImageReferencePromptText(prompt, references)));
    formData.set("n", String(count));
    formData.set("response_format", "b64_json");
    formData.set("output_format", IMAGE_OUTPUT_FORMAT);
    if (quality) formData.set("quality", quality);
    if (size) formData.set("size", size);
    if (background) formData.set("background", background);
    const files = await Promise.all(references.map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    files.forEach((file) => formData.append("image", file));
    if (mask) formData.set("mask", dataUrlToFile(mask));
    try {
        const query = new URLSearchParams({ providerId: target.providerId, model: target.model });
        const response = await axios.post<ImageApiResponse>(`/api/ai/images/edits?${query}`, formData, { signal: options?.signal });
        return parseImagePayload(response.data);
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        throw new Error(readRequestError(error, apiText("requestFailed")));
    }
}

export async function requestImageQuestion(config: AiConfig, messages: AiTextMessage[], onDelta: (text: string) => void, options?: RequestOptions) {
    const target = requestTarget(config, config.model || config.textModel);
    try {
        const response = await fetch("/api/ai/responses", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "text/event-stream, application/json" },
            body: JSON.stringify({
                ...target,
                input: toResponseInput(config, messages),
                stream: true,
                ...(config.reasoningEffort === "auto" ? {} : { reasoning: { effort: config.reasoningEffort } }),
            }),
            signal: options?.signal,
        });
        if (!response.ok) throw new Error(await readFetchError(response, apiText("requestFailed")));
        if (!response.headers.get("content-type")?.includes("text/event-stream")) {
            const answer = responsePayloadText((await response.json()) as ResponseApiPayload) || apiText("noContent");
            onDelta(answer);
            return answer;
        }
        if (!response.body) throw new Error(apiText("noContent"));
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const state: ResponseStreamState = { buffer: "", text: "" };
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            consumeResponseText(state, decoder.decode(value, { stream: true }), onDelta);
            if (state.error) throw new Error(state.error);
        }
        consumeResponseText(state, decoder.decode(), onDelta, true);
        if (state.error) throw new Error(state.error);
        const answer = state.text || (state.payload ? responsePayloadText(state.payload) : "") || apiText("noContent");
        if (!state.text) onDelta(answer);
        return answer;
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        throw new Error(readRequestError(error, apiText("requestFailed")));
    }
}

export async function fetchChannelModels(channel: ModelChannel) {
    if (!channel.id) throw new Error(apiText("baseUrlRequired"));
    return refreshProviderModels(channel.id);
}
