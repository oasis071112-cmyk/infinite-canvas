import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ModelCapability = "image" | "text";
export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "xhigh";

export type ChannelModel = {
    name: string;
    capability: ModelCapability;
};

export type ModelChannel = {
    id: string;
    name: string;
    baseUrl: string;
    keyConfigured: boolean;
    models: ChannelModel[];
    createdAt?: number;
    updatedAt?: number;
};

export type AiConfig = {
    channels: ModelChannel[];
    model: string;
    imageModel: string;
    textModel: string;
    systemPrompt: string;
    reasoningEffort: ReasoningEffort;
    models: string[];
    quality: string;
    size: string;
    background: string;
    count: string;
    canvasImageCount: string;
};

export type ConfigTabKey = "channels" | "preferences" | "prompt-sources" | "local-storage";

export const CONFIG_STORE_KEY = "ionailabs:ai_preferences_store";
const LEGACY_CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";
const CHANNEL_MODEL_SEPARATOR = "::";

if (typeof window !== "undefined") window.localStorage.removeItem(LEGACY_CONFIG_STORE_KEY);

export const defaultConfig: AiConfig = {
    channels: [],
    model: "",
    imageModel: "",
    textModel: "",
    systemPrompt: "",
    reasoningEffort: "auto",
    models: [],
    quality: "auto",
    size: "1:1",
    background: "",
    count: "1",
    canvasImageCount: "3",
};

type ConfigStore = {
    config: AiConfig;
    providersReady: boolean;
    isConfigOpen: boolean;
    configTab: ConfigTabKey;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    setChannels: (channels: ModelChannel[]) => void;
    setProvidersReady: (ready: boolean) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean, tab?: ConfigTabKey) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

const IMAGE_KEYWORDS = ["seedream", "gpt-image", "image", "dall-e", "dalle", "imagen", "flux", "sdxl", "stable-diffusion", "midjourney"];

export function guessCapability(name: string): ModelCapability {
    const value = name.toLowerCase();
    return IMAGE_KEYWORDS.some((keyword) => value.includes(keyword)) ? "image" : "text";
}

function findChannelModel(config: AiConfig, value: string): { channel: ModelChannel; model: ChannelModel } | null {
    const decoded = decodeChannelModel(value);
    if (!decoded) return null;
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    const model = channel?.models.find((item) => item.name === decoded.model);
    return channel && model ? { channel, model } : null;
}

export function modelCapabilityOf(config: AiConfig, value: string) {
    return findChannelModel(config, value)?.model.capability;
}

export function modelMatchesCapability(config: AiConfig, value: string, capability?: ModelCapability) {
    return !capability || modelCapabilityOf(config, value) === capability;
}

export function resolveModelForCapability(config: AiConfig, currentModel: string | undefined, capability: ModelCapability) {
    const preferred = capability === "image" ? config.imageModel : config.textModel;
    if (currentModel && modelMatchesCapability(config, currentModel, capability)) return currentModel;
    if (preferred && modelMatchesCapability(config, preferred, capability)) return preferred;
    return selectableModelsByCapability(config, capability)[0] || "";
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    return config.channels.flatMap((channel) =>
        channel.models.filter((model) => !capability || model.capability === capability).map((model) => encodeChannelModel(channel.id, model.name)),
    );
}

function applyChannels(config: AiConfig, channels: ModelChannel[]): AiConfig {
    const models = modelOptionsFromChannels(channels);
    const next = { ...config, channels, models };
    const imageModel = normalizeModelOptionValue(config.imageModel, channels);
    const textModel = normalizeModelOptionValue(config.textModel, channels);
    const nextImageModel = imageModel && modelMatchesCapability(next, imageModel, "image") ? imageModel : selectableModelsByCapability(next, "image")[0] || "";
    const nextTextModel = textModel && modelMatchesCapability(next, textModel, "text") ? textModel : selectableModelsByCapability(next, "text")[0] || "";
    return {
        ...next,
        imageModel: nextImageModel,
        textModel: nextTextModel,
        model: normalizeModelOptionValue(config.model, channels) || nextImageModel || nextTextModel || models[0] || "",
    };
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set) => ({
            config: defaultConfig,
            providersReady: false,
            isConfigOpen: false,
            configTab: "channels",
            shouldPromptContinue: false,
            updateConfig: (key, value) => set((state) => ({ config: { ...state.config, [key]: value } })),
            setChannels: (channels) => set((state) => ({ config: applyChannels(state.config, normalizeChannels(channels)) })),
            setProvidersReady: (providersReady) => set({ providersReady }),
            isAiConfigReady: (config, model) => Boolean(findChannelModel(config, model)?.channel.keyConfigured),
            openConfigDialog: (shouldPromptContinue = false, configTab = "channels") => set({ isConfigOpen: true, shouldPromptContinue, configTab }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            version: 2,
            partialize: (state) => ({
                config: {
                    ...state.config,
                    channels: [],
                    models: [],
                },
            }),
            merge: (persisted, current) => {
                const saved = (persisted as Partial<ConfigStore> | undefined)?.config;
                return {
                    ...current,
                    config: {
                        ...defaultConfig,
                        ...saved,
                        channels: [],
                        models: [],
                    },
                };
            },
        },
    ),
);

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    return useMemo(() => config, [config]);
}

export function normalizeChannelModels(models: Array<string | ChannelModel> | undefined): ChannelModel[] {
    const seen = new Set<string>();
    return (models || []).flatMap((item) => {
        const name = (typeof item === "string" ? item : item.name || "").trim();
        if (!name || seen.has(name)) return [];
        seen.add(name);
        const capability = typeof item === "string" ? guessCapability(name) : item.capability;
        return capability === "image" || capability === "text" ? [{ name, capability }] : [];
    });
}

export function createModelChannel(channel?: Partial<ModelChannel>): ModelChannel {
    return {
        id: channel?.id || "",
        name: channel?.name?.trim() || "",
        baseUrl: channel?.baseUrl?.trim() || "",
        keyConfigured: Boolean(channel?.keyConfigured),
        models: normalizeChannelModels(channel?.models),
        createdAt: channel?.createdAt,
        updatedAt: channel?.updatedAt,
    };
}

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${model.trim()}`;
}

export function decodeChannelModel(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { channelId: value.slice(0, index), model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}

export function modelOptionName(value: string) {
    return decodeChannelModel(value)?.model || value;
}

export function modelOptionLabel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded) return value;
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    return channel ? `${decoded.model}（${channel.name}）` : decoded.model;
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return Array.from(new Set(channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model.name)))));
}

export function normalizeModelOptionValue(value: string | undefined, channels: ModelChannel[]) {
    const model = (value || "").trim();
    if (!model) return "";
    const decoded = decodeChannelModel(model);
    if (decoded) {
        const channel = channels.find((item) => item.id === decoded.channelId);
        return channel?.models.some((item) => item.name === decoded.model) ? model : "";
    }
    const channel = channels.find((item) => item.models.some((entry) => entry.name === model));
    return channel ? encodeChannelModel(channel.id, model) : "";
}

export function resolveModelChannel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    return decoded ? config.channels.find((channel) => channel.id === decoded.channelId) : undefined;
}

function normalizeChannels(channels: ModelChannel[]) {
    return channels.map((channel) => createModelChannel(channel)).filter((channel) => channel.id);
}
