"use client";
import { useState } from "react";
import { toast } from "sonner";
import { changeDelivery } from "../api";
import type { EmailDelivery } from "../types";
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
}: {
    item: EmailDelivery;
    refresh: () => Promise<unknown>;
    canRespond?: boolean;
}) {
    const [busy, setBusy] = useState(false);
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
            className={`space-y-1 text-xs ${["failed", "uncertain"].includes(item.state) ? "text-amber-800" : "text-muted-foreground"}`}
        >
            <p>
                {labels[item.state]} · {item.recipient}
            </p>
            {item.state === "failed" &&
                [
                    "attachment_download",
                    "attachment_changed",
                    "mime_invalid",
                    "mailbox_mismatch",
                ].includes(item.errorCode ?? "") && (
                    <p>
                        {item.errorCode === "mailbox_mismatch"
                            ? "연결된 메일 계정과 발신 주소가 다릅니다. 관리자에게 연결 설정을 확인해주세요."
                            : "첨부 파일을 모두 확인하지 못해 발송을 시작하지 않았습니다. 파일과 연결 상태를 확인한 뒤 재시도해주세요."}
                    </p>
                )}
            {item.errorCode === "access_revoked" && (
                <p>작성자의 사업 응대 권한이 회수되어 발송을 중단했습니다.</p>
            )}
            {item.state === "uncertain" && (
                <p>
                    중복 발송을 막기 위해 자동 재전송하지 않습니다. 메일
                    서비스의 보낸 편지함에서 확인해주세요.
                </p>
            )}
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
        </div>
    );
}
