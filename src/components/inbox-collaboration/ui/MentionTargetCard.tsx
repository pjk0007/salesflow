"use client";
import useSWR from "swr";
import { collaborationRequest } from "../api";
import type { ChatMessage } from "@/components/inbox/types";
import { AttachmentList } from "@/components/inbox/ui/AttachmentList";
export function MentionTargetCard({
    conversationId,
    messageId,
    onDismiss,
}: {
    conversationId: string;
    messageId: number;
    onDismiss: () => void;
}) {
    const state = useSWR<{ focusedMessage: ChatMessage }>(
            `/api/inbox/conversations/${conversationId}?focusMessageId=${messageId}`,
            collaborationRequest,
        ),
        message = state.data?.focusedMessage;
    return (
        <section
            aria-label="알림으로 연 내부 메모"
            className="shrink-0 border-b bg-amber-50 px-5 py-3 text-xs text-amber-950"
        >
            <header className="mb-2 flex justify-between gap-3">
                <strong>알림으로 연 내부 메모</strong>
                <button
                    type="button"
                    aria-label="멘션 메모 닫기"
                    onClick={onDismiss}
                >
                    닫기
                </button>
            </header>
            {state.error ? (
                <p role="alert">
                    {state.error.message}{" "}
                    <button
                        type="button"
                        className="underline"
                        onClick={() => void state.mutate()}
                    >
                        다시 불러오기
                    </button>
                </p>
            ) : message ? (
                <div className="max-h-40 overflow-auto space-y-2">
                    <p>
                        {message.authorName} ·{" "}
                        {new Date(message.createdAt).toLocaleString("ko-KR")}
                    </p>
                    <p className="whitespace-pre-wrap break-words">
                        {message.body}
                    </p>
                    <p>
                        {message.mentions?.map((m) => `@${m.name}`).join(" ")}
                    </p>
                    <AttachmentList
                        files={message.attachments}
                        url={(id) => `/api/inbox/attachments/${id}`}
                    />
                </div>
            ) : (
                <p>메모를 불러오는 중…</p>
            )}
        </section>
    );
}
