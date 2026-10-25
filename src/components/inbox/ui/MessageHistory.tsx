"use client";
import { Fragment, memo } from "react";
import { LockKeyhole } from "lucide-react";
import type { ChatMessage } from "../types";
import { AttachmentList } from "./AttachmentList";
import { IncomingEmailFiles } from "@/components/inbox-email/ui/IncomingEmailFiles";
import { EmailDeliveryStatus } from "@/components/inbox-email/ui/EmailDeliveryStatus";

// Keep locale formatter construction out of the per-message/per-keystroke path.
const day = new Intl.DateTimeFormat("ko-KR", {year:"numeric",month:"long",day:"numeric"});
const time = new Intl.DateTimeFormat("ko-KR", {hour:"2-digit",minute:"2-digit"});
const full = new Intl.DateTimeFormat("ko-KR", {year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"numeric",second:"numeric"});
export const MessageHistory = memo(function MessageHistory({ messages, historyOnly, canRespond, refresh, onRewrite }: {
    messages: ChatMessage[]; historyOnly?: boolean; canRespond: boolean; refresh: () => Promise<unknown>;
    onRewrite?: (body: string) => void;
}) {
    return <>
        {messages.map((m, index) => (
        <Fragment key={m.id}>
            {(!index ||
                new Date(
                    messages[index - 1].createdAt,
                ).toDateString() !==
                    new Date(m.createdAt).toDateString()) && (
                <div className="pb-2 text-center text-xs text-muted-foreground">
                    {day.format(new Date(m.createdAt))}
                </div>
            )}
            <div
                className={`flex ${m.kind === "customer" ? "justify-start" : "justify-end"}`}
            >
                <div className="max-w-[85%] space-y-1.5">
                    <div
                        className={`flex items-center gap-1.5 text-[11px] text-muted-foreground ${m.kind !== "customer" ? "justify-end" : ""}`}
                    >
                        {m.kind === "note" && (
                            <LockKeyhole size={11} />
                        )}
                        {m.authorName}
                        {m.kind === "note"
                            ? " · 내부 메모"
                            : ""}
                        <time>
                            {time.format(new Date(m.createdAt))}
                        </time>
                    </div>
                    {historyOnly && (
                        <p className="text-[10px] text-muted-foreground">
                            {full.format(new Date(m.createdAt))}{" "}
                            · 원본{" "}
                            {m.importMetadata?.sourceId ?? ""}
                        </p>
                    )}
                    {m.email && (
                        <p className="text-[11px] text-muted-foreground">
                            {m.email.subject} ·{" "}
                            {full.format(new Date(m.email.receivedAt))}
                            {m.email.cc.length
                                ? ` · 참조 ${m.email.cc.join(", ")}`
                                : ""}
                        </p>
                    )}
                    {m.body && (
                        <p
                            className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-relaxed ${m.kind === "customer" ? "rounded-tl-md bg-muted" : m.kind === "note" ? "border border-amber-200 bg-amber-50 text-amber-950" : "rounded-tr-md bg-[#635BFF] text-white"}`}
                        >
                            {m.body}
                        </p>
                    )}
                    {m.kind === "note" &&
                        !!m.mentions?.length && (
                            <p className="text-xs text-amber-800">
                                {m.mentions
                                    .map(
                                        (person) =>
                                            `@${person.name}`,
                                    )
                                    .join(" ")}
                            </p>
                        )}
                    {m.email && (
                        <details className="text-xs text-muted-foreground">
                            <summary>
                                메일 발신·수신 정보
                            </summary>
                            <p className="break-all">
                                보낸 사람: {m.email.from}
                            </p>
                            <p className="break-all">
                                받는 사람:{" "}
                                {m.email.to.join(", ")}
                            </p>
                            <p className="break-all">
                                참조:{" "}
                                {m.email.cc.join(", ") ||
                                    "없음"}
                            </p>
                            {!!m.email.replyTo?.length && (
                                <p className="break-all">
                                    회신 주소:{" "}
                                    {m.email.replyTo.join(", ")}
                                </p>
                            )}
                        </details>
                    )}
                    {m.delivery && (
                        <EmailDeliveryStatus
                            canRespond={canRespond}
                            item={m.delivery}
                            refresh={refresh}
                            onRewrite={
                                onRewrite && m.body && !historyOnly
                                    ? () => onRewrite(m.body!)
                                    : undefined
                            }
                        />
                    )}
                    {!!m.email?.files.length && (
                        <IncomingEmailFiles
                            canRetry={canRespond}
                            files={m.email.files}
                            refresh={refresh}
                        />
                    )}
                    <AttachmentList
                        files={m.attachments}
                        url={(id) =>
                            `/api/inbox/attachments/${id}`
                        }
                    />
                    {!!m.importMetadata?.files?.length && (
                        <p className="mt-2 text-xs text-muted-foreground">
                            원본 첨부 ·{" "}
                            {m.importMetadata.files
                                .map((f) =>
                                    String(
                                        f.name ||
                                            f.fileName ||
                                            f.id ||
                                            "파일",
                                    ),
                                )
                                .join(", ")}{" "}
                            · 파일 원본{" "}
                            {
                                m.attachments.filter(
                                    (f) =>
                                        f.importMetadata &&
                                        !f.importMetadata
                                            .previousSource,
                                ).length
                            }
                            /{m.importMetadata.files.length}개
                            확보. 미확보 파일은 기존 자료
                            이전에서 보충할 수 있습니다.
                        </p>
                    )}
                </div>
            </div>
        </Fragment>
    ))}
</>;
});
