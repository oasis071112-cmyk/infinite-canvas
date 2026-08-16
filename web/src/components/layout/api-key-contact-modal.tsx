import { Button, Modal } from "antd";
import { KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";

export function ApiKeyContactModal({ open, onClose, onContinue }: { open: boolean; onClose: () => void; onContinue: () => void }) {
    const { t } = useTranslation();

    return (
        <Modal
            open={open}
            width="min(460px, calc(100vw - 24px))"
            centered
            footer={null}
            onCancel={onClose}
            styles={{ body: { maxHeight: "calc(100dvh - 32px)", overflowY: "auto", padding: "clamp(18px, 5vw, 28px) clamp(12px, 4vw, 24px) clamp(16px, 4vw, 24px)" } }}
        >
            <div className="mx-auto flex max-w-sm flex-col items-center text-center">
                <div className="grid size-10 place-items-center rounded-full bg-amber-50 text-amber-700 sm:size-11 dark:bg-amber-950/40 dark:text-amber-300">
                    <KeyRound className="size-5" />
                </div>
                <h2 className="mt-3 text-lg font-semibold tracking-tight text-stone-950 sm:mt-4 sm:text-xl dark:text-stone-100">{t("config.apiKeyContact.title")}</h2>
                <p className="mt-1.5 text-[13px] leading-5 text-stone-600 sm:mt-2 sm:text-sm sm:leading-6 dark:text-stone-300">{t("config.apiKeyContact.description")}</p>
                <div className="mt-4 aspect-square w-[min(68vw,280px)] overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm sm:mt-5 sm:w-[280px] dark:border-stone-700">
                    <img src="/api-key-contact.jpg" alt={t("config.apiKeyContact.imageAlt")} className="size-full scale-[1.45] object-cover" />
                </div>
                <p className="mt-2 text-[11px] text-stone-500 sm:mt-3 sm:text-xs dark:text-stone-400">{t("config.apiKeyContact.scanHint")}</p>
                <div className="mt-4 flex w-full flex-col-reverse gap-2.5 sm:mt-6 sm:grid sm:grid-cols-2 sm:gap-3">
                    <Button block className="h-10" onClick={onClose}>
                        {t("config.apiKeyContact.later")}
                    </Button>
                    <Button block type="primary" className="h-10" onClick={onContinue}>
                        {t("config.apiKeyContact.continue")}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
