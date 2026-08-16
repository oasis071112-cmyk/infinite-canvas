import type { ChannelModel, ModelChannel } from "@/stores/use-config-store";

type ApiErrorPayload = { error?: { code?: string; message?: string } };

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
        credentials: "same-origin",
        ...init,
        headers: {
            ...(init?.body ? { "Content-Type": "application/json" } : {}),
            ...init?.headers,
        },
    });
    if (!response.ok) {
        let payload: ApiErrorPayload | null = null;
        try {
            payload = (await response.json()) as ApiErrorPayload;
        } catch {
            // Keep the status fallback when a proxy returns a non-JSON error page.
        }
        throw new Error(payload?.error?.message || `请求失败（HTTP ${response.status}）`);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
}

export async function bootstrapAnonymousSession() {
    return apiRequest<{ ready: boolean; expiresInDays: number }>("/api/session");
}

export async function listProviders() {
    return (await apiRequest<{ providers: ModelChannel[] }>("/api/providers")).providers;
}

export async function createProvider(input: { name: string; baseUrl: string; apiKey: string }) {
    return apiRequest<ModelChannel>("/api/providers", { method: "POST", body: JSON.stringify(input) });
}

export async function updateProvider(id: string, input: { name?: string; baseUrl?: string; apiKey?: string }) {
    return apiRequest<ModelChannel>(`/api/providers/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
}

export async function deleteProvider(id: string) {
    return apiRequest<void>(`/api/providers/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function refreshProviderModels(id: string) {
    return (await apiRequest<{ models: string[] }>(`/api/providers/${encodeURIComponent(id)}/models/refresh`, { method: "POST", body: "{}" })).models;
}

export async function updateProviderModels(id: string, models: ChannelModel[]) {
    return apiRequest<ModelChannel>(`/api/providers/${encodeURIComponent(id)}/models`, { method: "PUT", body: JSON.stringify({ models }) });
}
