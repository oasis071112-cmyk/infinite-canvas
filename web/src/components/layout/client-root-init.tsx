import { App } from "antd";
import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";
import { bootstrapAnonymousSession, listProviders } from "@/services/api/providers";
import { useConfigStore } from "@/stores/use-config-store";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const started = useRef(false);
    const setChannels = useConfigStore((state) => state.setChannels);
    const setProvidersReady = useConfigStore((state) => state.setProvidersReady);

    usePromptSourceScheduler();

    useEffect(() => {
        if (started.current) return;
        started.current = true;
        void (async () => {
            try {
                await bootstrapAnonymousSession();
                setChannels(await listProviders());
            } catch (error) {
                message.error(error instanceof Error ? error.message : t("config.sessionUnavailable"));
            } finally {
                setProvidersReady(true);
            }
        })();
    }, [message, setChannels, setProvidersReady, t]);

    return <>{children}</>;
}
