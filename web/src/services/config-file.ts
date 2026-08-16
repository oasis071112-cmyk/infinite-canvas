import { saveAs } from "file-saver";

import i18n from "@/i18n";
import { useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { usePromptSourceStore, type PromptSourceSchedule } from "@/stores/use-prompt-source-store";
import type { PromptSource } from "@/services/api/prompt-source-presets";

type AppConfigFile = {
    app: "infinite-canvas";
    version: 2;
    exportedAt: string;
    preferences: Pick<AiConfig, "systemPrompt" | "reasoningEffort" | "quality" | "size" | "background" | "count" | "canvasImageCount">;
    promptSources: {
        sources: PromptSource[];
        schedule: PromptSourceSchedule;
    };
};

export function exportAppConfig() {
    const { config } = useConfigStore.getState();
    const { sources, schedule } = usePromptSourceStore.getState();
    const preferences: AppConfigFile["preferences"] = {
        systemPrompt: config.systemPrompt,
        reasoningEffort: config.reasoningEffort,
        quality: config.quality,
        size: config.size,
        background: config.background,
        count: config.count,
        canvasImageCount: config.canvasImageCount,
    };
    const data: AppConfigFile = { app: "infinite-canvas", version: 2, exportedAt: new Date().toISOString(), preferences, promptSources: { sources, schedule } };
    saveAs(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }), "ionailabs-canvas-preferences.json");
}

export async function importAppConfig(file: File) {
    let data: AppConfigFile;
    try {
        data = JSON.parse(await file.text()) as AppConfigFile;
    } catch {
        throw new Error(i18n.t("config.invalidFile"));
    }
    if (data.app !== "infinite-canvas" || data.version !== 2 || !data.preferences || !data.promptSources) throw new Error(i18n.t("config.invalidFile"));
    const source = data.preferences as Record<string, unknown>;
    const stringValue = (key: keyof AppConfigFile["preferences"]) => {
        const value = source[key];
        if (typeof value !== "string") throw new Error(i18n.t("config.invalidFile"));
        return value;
    };
    const reasoningEffort = stringValue("reasoningEffort");
    if (!(["auto", "low", "medium", "high", "xhigh"] as const).includes(reasoningEffort as AiConfig["reasoningEffort"])) throw new Error(i18n.t("config.invalidFile"));
    const preferences: AppConfigFile["preferences"] = {
        systemPrompt: stringValue("systemPrompt"),
        reasoningEffort: reasoningEffort as AiConfig["reasoningEffort"],
        quality: stringValue("quality"),
        size: stringValue("size"),
        background: stringValue("background"),
        count: stringValue("count"),
        canvasImageCount: stringValue("canvasImageCount"),
    };
    useConfigStore.setState((state) => ({ config: { ...state.config, ...preferences } }));
    usePromptSourceStore.setState(data.promptSources);
}
