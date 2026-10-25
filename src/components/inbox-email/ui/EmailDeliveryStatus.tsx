"use client";
import { useState } from "react";
import { toast } from "sonner";
import { changeDelivery } from "../api";
import type { EmailDelivery } from "../types";
import { deliveryReason } from "../utils/delivery-reason";
import { useAsyncConfirm } from "@/components/ui/alert-dialog";
const labels = {
    queued: "메일 발송 대기",
    leased: "메일 발송 준비",
    sending: "메일 서비스 접수 확인 중",
    sent: "메일 서비스 접수됨",
    failed: "메일 발송 실패",
    uncertain: "메일 발송 결과 확인 필요",
    cancelled: "메일 발송 취소",
};
export function EmailDeliveryStatus({
    item,
    refresh,
    canRespond = false,
    onRewrite,
}: {
    item: EmailDelivery;
    refresh: () => Promise<unknown>;
    canRespond?: boolean;
    /** 취소된 답장 본문을 답장 작성란에 다시 넣는다. */
    onRewrite?: () => void;
}) {
    const [busy, setBusy] = useState(false);
    const { confirm, confirmationDialog } = useAsyncConfirm();
    const reason = deliveryReason(item);
    const act = async (action: "retry" | "cancel") => {
        setBusy(true);
        try {
            await changeDelivery(item.id, action);
            await refresh();
        } catch (e) {
            toast.error((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    return (
        <div
            className={`space-y-1 text-xs ${reason.warn ? "text-amber-800" : "text-muted-foreground"}`}
        >
            <p>
                {labels[item.state]} ·{" "}
                {(item.recipientTo ?? [item.recipient]).join(", ")}
            </p>
            {!!item.recipientCc?.length && (
                <p className="break-all">참조: {item.recipientCc.join(", ")}</p>
            )}
            {reason.text && <p>{reason.text}</p>}
            {canRespond && item.state === "failed" && (
                <button
                    disabled={busy}
                    className="mr-3 underline"
                    onClick={() => void act("retry")}
                >
                    발송 재시도
                </button>
            )}
            {canRespond &&
                ["queued", "leased", "failed"].includes(item.state) && (
                    <button
                        disabled={busy}
                        className="underline"
                        onClick={() => void act("cancel")}
                    >
                        발송 취소
                    </button>
                )}
            {canRespond && item.state === "uncertain" && (
                <button
                    disabled={busy}
                    className="underline"
                    onClick={() =>
                        confirm({
                            title: "보내지 않은 답장으로 정리할까요?",
                            description:
                                "보낸 편지함에 이 답장이 없는 것을 확인한 경우에만 정리해주세요. 정리하면 자동 확인을 멈추고, 본문을 다시 넣어 새로 보낼 수 있습니다. 실제로 보내졌다면 고객이 같은 답장을 두 번 받게 됩니다.",
                            confirmLabel: "보내지 않음으로 정리",
                            onConfirm: async () => {
                                await changeDelivery(item.id, "cancel");
                                await refresh();
                            },
                        })
                    }
                >
                    보내지 않은 것으로 정리
                </button>
            )}
            {canRespond && reason.canRewrite && onRewrite && (
                <button className="underline" onClick={onRewrite}>
                    본문을 작성란에 다시 넣기
                </button>
            )}
            {confirmationDialog}
        </div>
    );
}
