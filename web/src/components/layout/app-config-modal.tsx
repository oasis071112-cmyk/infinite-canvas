import { App, Button, Empty, Form, Input, Modal, Tabs } from "antd";
import { Download, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiKeyContactModal } from "@/components/layout/api-key-contact-modal";
import { ChannelEditorDrawer } from "@/components/layout/channel-editor-drawer";
import { ConfigLocalStorage } from "@/components/layout/config-local-storage";
import { ConfigPromptSources } from "@/components/layout/config-prompt-sources";
import { ModelPicker } from "@/components/model-picker";
import { createProvider, deleteProvider, listProviders, updateProvider, updateProviderModels } from "@/services/api/providers";
import { exportAppConfig, importAppConfig } from "@/services/config-file";
import { createModelChannel, useConfigStore, type ConfigTabKey, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "textModel";
    labelKey: string;
};

const modelGroups: ModelGroup[] = [
    { capability: "image", modelKey: "imageModel", labelKey: "config.preferences.defaultImageModel" },
    { capability: "text", modelKey: "textModel", labelKey: "config.preferences.defaultTextModel" },
];

export function AppConfigPanel({ showDoneButton = false, initialTab = "channels" }: { showDoneButton?: boolean; initialTab?: ConfigTabKey }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const configInputRef = useRef<HTMLInputElement>(null);
    const [activeTab, setActiveTab] = useState<ConfigTabKey>(initialTab);
    const [editingChannel, setEditingChannel] = useState<ModelChannel | null>(null);
    const [deletingId, setDeletingId] = useState("");
    const config = useConfigStore((state) => state.config);
    const providersReady = useConfigStore((state) => state.providersReady);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const setChannels = useConfigStore((state) => state.setChannels);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);

    useEffect(() => setActiveTab(initialTab), [initialTab]);

    const refreshChannels = async () => {
        const channels = await listProviders();
        setChannels(channels);
        return channels;
    };

    const finishConfig = () => {
        const ready = config.channels.some((channel) => channel.keyConfigured && channel.models.length);
        setConfigDialogOpen(false);
        if (!ready) return;
        message.success(t(shouldPromptContinue ? "config.savedContinue" : "config.saved"));
        clearPromptContinue();
    };

    const loadConfigFile = async (file: File) => {
        try {
            await importAppConfig(file);
            message.success(t("config.imported"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.importFailed"));
        } finally {
            if (configInputRef.current) configInputRef.current.value = "";
        }
    };

    const addChannel = () => {
        setEditingChannel(
            createModelChannel({
                name: t("config.channels.numberedName", { count: config.channels.length + 1 }),
                baseUrl: "https://api.openai.com",
            }),
        );
    };

    const saveChannel = async (channel: ModelChannel, apiKey: string) => {
        let saved = channel.id
            ? await updateProvider(channel.id, { name: channel.name, baseUrl: channel.baseUrl, ...(apiKey ? { apiKey } : {}) })
            : await createProvider({ name: channel.name, baseUrl: channel.baseUrl, apiKey });
        if (channel.models.length || saved.models.length) saved = await updateProviderModels(saved.id, channel.models);
        const channels = await refreshChannels();
        return channels.find((item) => item.id === saved.id) || saved;
    };

    const removeChannel = async (id: string) => {
        setDeletingId(id);
        try {
            await deleteProvider(id);
            await refreshChannels();
            if (editingChannel?.id === id) setEditingChannel(null);
            message.success(t("config.channels.deleted"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.channels.deleteFailed"));
        } finally {
            setDeletingId("");
        }
    };

    return (
        <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-3 dark:border-stone-800">
                <div className="text-xs text-stone-500">{t("config.fileSecurity")}</div>
                <div className="flex gap-2">
                    <Button icon={<Upload className="size-4" />} onClick={() => configInputRef.current?.click()}>{t("config.import")}</Button>
                    <Button icon={<Download className="size-4" />} onClick={exportAppConfig}>{t("config.export")}</Button>
                    <input ref={configInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => event.target.files?.[0] && void loadConfigFile(event.target.files[0])} />
                </div>
            </div>
            <Tabs
                activeKey={activeTab}
                onChange={(key) => setActiveTab(key as ConfigTabKey)}
                items={[
                    {
                        key: "channels",
                        label: t("config.tabs.channels"),
                        children: (
                            <div>
                                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                                    <div className="text-xs text-stone-500">{t("config.channels.description")}</div>
                                    <Button type="primary" icon={<Plus className="size-4" />} onClick={addChannel}>{t("config.channels.add")}</Button>
                                </div>
                                <div className="space-y-2">
                                    {config.channels.length ? (
                                        config.channels.map((channel) => (
                                            <div key={channel.id} className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800">
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-semibold">{channel.name || t("config.channels.unnamed")}</div>
                                                    <div className="mt-1 truncate text-xs text-stone-500">OpenAI · {t("config.channels.modelCount", { count: channel.models.length })} · {channel.baseUrl}</div>
                                                </div>
                                                <div className="flex shrink-0 gap-2">
                                                    <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => setEditingChannel(channel)}>{t("common.edit")}</Button>
                                                    <Button size="small" danger loading={deletingId === channel.id} icon={<Trash2 className="size-3.5" />} onClick={() => void removeChannel(channel.id)} />
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={providersReady ? t("config.channels.empty") : t("config.channels.loading")} />
                                    )}
                                </div>
                            </div>
                        ),
                    },
                    {
                        key: "preferences",
                        label: t("config.tabs.preferences"),
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <div className="mb-2 text-sm font-semibold">{t("config.preferences.defaultModels")}</div>
                                <div className="mb-4 grid gap-4 md:grid-cols-2">
                                    {modelGroups.map((group) => (
                                        <Form.Item key={group.modelKey} label={t(group.labelKey)} className="mb-0">
                                            <ModelPicker config={config} value={config[group.modelKey]} onChange={(model) => updateConfig(group.modelKey, model)} capability={group.capability} fullWidth />
                                        </Form.Item>
                                    ))}
                                </div>
                                <div className="mb-2 text-sm font-semibold">{t("config.preferences.generation")}</div>
                                <div className="grid gap-4 md:grid-cols-2">
                                    <Form.Item label={t("config.preferences.canvasImageCount")} extra={t("config.preferences.canvasImageCountDescription")} className="mb-4">
                                        <Input type="number" min={1} max={15} value={config.canvasImageCount} onChange={(event) => updateConfig("canvasImageCount", event.target.value)} onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))} />
                                    </Form.Item>
                                </div>
                                <Form.Item label={t("config.preferences.systemPrompt")} className="mb-0">
                                    <Input.TextArea rows={4} value={config.systemPrompt} placeholder={t("config.preferences.systemPromptPlaceholder")} onChange={(event) => updateConfig("systemPrompt", event.target.value)} />
                                </Form.Item>
                            </Form>
                        ),
                    },
                    { key: "prompt-sources", label: t("config.tabs.promptSources"), children: <ConfigPromptSources /> },
                    { key: "local-storage", label: t("config.tabs.localStorage"), children: <ConfigLocalStorage active={activeTab === "local-storage"} /> },
                ]}
            />
            {showDoneButton ? <div className="mt-4 flex justify-end"><Button type="primary" onClick={finishConfig}>{t("common.done")}</Button></div> : null}
            <ChannelEditorDrawer open={Boolean(editingChannel)} channel={editingChannel} onSave={saveChannel} onClose={() => setEditingChannel(null)} />
        </>
    );
}

export function AppConfigModal() {
    const { t } = useTranslation();
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const configTab = useConfigStore((state) => state.configTab);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const [showContact, setShowContact] = useState(true);
    const closeConfig = () => setConfigDialogOpen(false);

    useEffect(() => {
        if (!isConfigOpen) setShowContact(true);
    }, [isConfigOpen]);

    return (
        <>
            <ApiKeyContactModal open={isConfigOpen && showContact} onClose={closeConfig} onContinue={() => setShowContact(false)} />
            <Modal
                title={<div><div className="text-lg font-semibold">{t("config.title")}</div><div className="mt-1 text-xs font-normal text-stone-500">{t("config.modalDescription")}</div></div>}
                open={isConfigOpen && !showContact}
                width={980}
                centered
                onCancel={closeConfig}
                styles={{ body: { maxHeight: "72vh", overflowY: "auto", paddingRight: 12 } }}
                footer={null}
            >
                <AppConfigPanel showDoneButton initialTab={configTab} />
            </Modal>
        </>
    );
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 3))));
}
