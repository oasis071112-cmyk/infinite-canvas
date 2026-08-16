import { App, Button, Drawer, Input, Segmented, Space } from "antd";
import { ListPlus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { guessCapability, normalizeChannelModels, type ChannelModel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import { ModelSelectModal } from "./model-select-modal";

export function ChannelEditorDrawer({
    open,
    channel,
    onSave,
    onClose,
}: {
    open: boolean;
    channel: ModelChannel | null;
    onSave: (channel: ModelChannel, apiKey: string) => Promise<ModelChannel>;
    onClose: () => void;
}) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [draft, setDraft] = useState<ModelChannel | null>(channel);
    const [apiKey, setApiKey] = useState("");
    const [selectOpen, setSelectOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const capabilityOptions = (["image", "text"] as ModelCapability[]).map((value) => ({ label: t(`config.channelEditor.capabilities.${value}`), value }));

    useEffect(() => {
        if (!open || !channel) return;
        setDraft(channel);
        setApiKey("");
        setSelectOpen(false);
    }, [channel, open]);

    if (!draft) return null;

    const patch = (value: Partial<ModelChannel>) => setDraft((current) => (current ? { ...current, ...value } : current));
    const setModels = (models: ChannelModel[]) => patch({ models });
    const setCapability = (name: string, capability: ModelCapability) => setModels(draft.models.map((model) => (model.name === name ? { ...model, capability } : model)));
    const removeModel = (name: string) => setModels(draft.models.filter((model) => model.name !== name));

    const persist = async () => {
        if (!draft.name.trim() || !draft.baseUrl.trim() || (!draft.keyConfigured && !apiKey.trim())) {
            message.error(t("config.channelEditor.required"));
            return null;
        }
        setSaving(true);
        try {
            const saved = await onSave({ ...draft, name: draft.name.trim(), baseUrl: draft.baseUrl.trim(), models: normalizeChannelModels(draft.models) }, apiKey.trim());
            setDraft(saved);
            setApiKey("");
            return saved;
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.channelEditor.saveFailed"));
            return null;
        } finally {
            setSaving(false);
        }
    };

    const openModelSelector = async () => {
        const saved = await persist();
        if (saved) setSelectOpen(true);
    };

    const saveAndClose = async () => {
        if (await persist()) onClose();
    };

    const applySelection = (names: string[]) => {
        const existing = new Map(draft.models.map((model) => [model.name, model]));
        setModels(names.map((name) => existing.get(name) || { name, capability: guessCapability(name) }));
    };

    return (
        <Drawer
            open={open}
            width={640}
            title={t("config.channelEditor.title")}
            onClose={onClose}
            styles={{ body: { paddingTop: 16 } }}
            extra={
                <Space>
                    <Button onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="primary" loading={saving} onClick={() => void saveAndClose()}>
                        {t("common.save")}
                    </Button>
                </Space>
            }
        >
            <div className="grid gap-4">
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.name")}</span>
                    <Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.baseUrl")}</span>
                    <Input value={draft.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} placeholder="https://api.example.com" />
                    <span className="mt-1 block text-xs text-stone-500">{t("config.channelEditor.httpsOnly")}</span>
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">API Key</span>
                    <Input.Password value={apiKey} autoComplete="new-password" onChange={(event) => setApiKey(event.target.value)} placeholder={draft.keyConfigured ? t("config.channelEditor.keepKey") : "sk-..."} />
                    <span className="mt-1 block text-xs text-stone-500">{t("config.channelEditor.keySecurity")}</span>
                </label>
            </div>

            <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="text-sm font-semibold">{t("config.channelEditor.models")}</div>
                    <div className="mt-0.5 text-xs text-stone-500">{t("config.channelEditor.modelDescription", { count: draft.models.length })}</div>
                </div>
                <Button type="primary" icon={<ListPlus className="size-4" />} loading={saving} onClick={() => void openModelSelector()}>
                    {t("config.channelEditor.selectModels")}
                </Button>
            </div>

            <div className="space-y-2 rounded-lg border border-stone-200 p-2 dark:border-stone-800">
                {draft.models.length ? (
                    draft.models.map((model) => (
                        <div key={model.name} className="flex flex-wrap items-center gap-3 rounded-md px-2 py-1.5 hover:bg-stone-50 dark:hover:bg-stone-900/40">
                            <span className="min-w-0 flex-1 truncate text-sm" title={model.name}>
                                {model.name}
                            </span>
                            <div className="flex shrink-0 items-center gap-2">
                                <Segmented size="small" value={model.capability} options={capabilityOptions} onChange={(value) => setCapability(model.name, value as ModelCapability)} />
                                <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} onClick={() => removeModel(model.name)} />
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="px-2 py-8 text-center text-sm text-stone-500">{t("config.channelEditor.empty")}</div>
                )}
            </div>

            <ModelSelectModal open={selectOpen} channel={draft} selectedNames={draft.models.map((model) => model.name)} onConfirm={applySelection} onClose={() => setSelectOpen(false)} />
        </Drawer>
    );
}
