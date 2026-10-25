"use client";
import { toast } from "sonner";
import { useAsyncConfirm } from "@/components/ui/alert-dialog";
import { toggleEmailMailbox } from "../api";
import { useGoogleConnection } from "../hooks/useGoogleConnection";
import type { EmailMailbox } from "../types";
/** 수신·발송 켜기/중지. 중지는 발송 대기 답장을 취소하므로 건수를 보여주고 확인받는다. */
export function MailboxToggle({
    box,
    busy,
    onChange,
}: {
    box: EmailMailbox;
    busy: boolean;
    onChange: () => Promise<unknown>;
}) {
    const { data } = useGoogleConnection(box.id);
    const { confirm, confirmationDialog } = useAsyncConfirm();
    const pending = data?.pendingReplies ?? 0;
    return (
        <>
            <button
                disabled={busy}
                className="rounded-lg border px-3 py-2 text-sm"
                onClick={() => {
                    if (!box.enabled) {
                        void toggleEmailMailbox(box.id, box.version, true)
                            .then(onChange)
                            .catch((e: Error) => toast.error(e.message));
                        return;
                    }
                    confirm({
                        title: "수신·발송을 중지할까요?",
                        description: `${box.address}의 새 문의 가져오기와 답장 발송을 멈춥니다.\n${
                            pending
                                ? `발송 대기 중인 답장 ${pending}건이 취소되며 다시 보낼 수 없습니다(본문을 작성란에 다시 넣어 새로 보내야 합니다).`
                                : "지금 발송 대기 중인 답장은 없습니다."
                        }`,
                        confirmLabel: "중지",
                        onConfirm: async () => {
                            await toggleEmailMailbox(box.id, box.version, false);
                            await onChange();
                        },
                    });
                }}
            >
                {box.enabled ? "수신·발송 중지" : "수신·발송 켜기"}
            </button>
            {confirmationDialog}
        </>
    );
}
