"use client";
import { ConversationServiceStatus } from "@/components/inbox-operations/ui/ConversationServiceStatus";
import { MAX_FILE_BYTES } from "@/lib/inbox/file-rules";
import { workspaceAbilities } from "@/components/customer-access/utils/abilities";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, Check, Clock, LockKeyhole, Send, Star } from "lucide-react";
import { toast } from "sonner";
import type { ChatMessage, Conversation, InboxBootstrap } from "../types";
import { inboxRequest, inboxWrite } from "../api";
import { useAttachmentDrafts } from "../hooks/useAttachmentDrafts";
import type { StaffDraftSession } from "../hooks/staff-draft-session";
import { AttachmentDrafts } from "./AttachmentDrafts";
import { MessageHistory } from "./MessageHistory";
import { inboxDraftStorageKey } from "../utils/draft-storage";
import { InboxAudit } from "./InboxAudit";
import { StaffReplyContact } from "@/components/customer-messenger/ui/StaffReplyContact";
import { CustomerCrmContext } from "./CustomerCrmContext";
import { ConversationJourneyPanel } from "@/components/inbox-journey/ui/ConversationJourneyPanel";
import { EmailReplyRecipients } from "@/components/inbox-email/ui/EmailReplyRecipients";
import { useEmailReply } from "@/components/inbox-email/hooks/useEmailReply";
import { useNoteMentions } from "@/components/inbox-collaboration/hooks/useNoteMentions";
import { NoteMentions } from "@/components/inbox-collaboration/ui/NoteMentions";
import { MentionTargetCard } from "@/components/inbox-collaboration/ui/MentionTargetCard";
import { SupportDraftPanel } from "@/components/customer-ai/ui/SupportDraftPanel";
import { TeamAssignment } from "@/components/inbox-routing/ui/TeamAssignment";
import { ConversationPresence } from "@/components/inbox-presence/ui/ConversationPresence";
import { useReplyGuard } from "@/components/inbox-reply-guard/hooks/useReplyGuard";
import { ReplyGuardStatus } from "@/components/inbox-reply-guard/ui/ReplyGuardStatus";
import type {
    AgentActivity,
    InboxPresence,
} from "@/components/inbox-presence/types";
export const statusNames = {
    open: "진행중",
    snoozed: "보류중",
    closed: "종료됨",
};
export function ConversationPane({
    draftSession,
    userId,
    chat,
    messages,
    hasOlder,
    bootstrap,
    patch,
    refresh,
    onBack,
    focusMessageId,
    onDismissMention,
    presenceAgents,
    onActivity,
    onSent,
}: {
    draftSession: StaffDraftSession;
    userId: string;
    chat: Conversation;
    messages: ChatMessage[];
    hasOlder: boolean;
    bootstrap: InboxBootstrap;
    patch: (value: unknown) => Promise<void>;
    refresh: () => Promise<unknown>;
    onBack: () => void;
    focusMessageId?: number | null;
    onDismissMention: () => void;
    presenceAgents: InboxPresence["agents"];
    onActivity: (activity: AgentActivity | null) => void;
    onSent: (conversationId: string, message: ChatMessage) => Promise<unknown>;
}) {
    const workspaceId = bootstrap.channels.find(
        (c) => c.id === chat.channelId,
    )?.workspaceId;
    const sharedDrafts = useSyncExternalStore(
        draftSession.subscribe,
        draftSession.getSnapshot,
        draftSession.getSnapshot,
    );
    const canRespond =
        workspaceAbilities(bootstrap, workspaceId).respond &&
        sharedDrafts.active;
    const draftStorageKey = inboxDraftStorageKey(userId, chat.id);
    const emailReply = useEmailReply(chat.emailContext, draftStorageKey);
    const noteMentions = useNoteMentions(
        draftStorageKey,
        bootstrap.mentionMembers ?? bootstrap.members,
        workspaceId,
    );
    const [kind, setKind] = useState<"reply" | "note">("reply"),
        [savedDrafts] = useState<Record<string, string>>(() => {
            try {
                return JSON.parse(
                    localStorage.getItem(draftStorageKey) ?? "{}",
                );
            } catch {
                return {};
            }
        });
    const drafts = { ...savedDrafts, ...sharedDrafts.text };
    const mounted = useRef(false);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const [older, setOlder] = useState<ChatMessage[]>([]),
        [canLoad, setCanLoad] = useState(hasOlder),
        [loading, setLoading] = useState(false);
    const aiStorageKey = `sendb-inbox-ai-draft:${userId}:${chat.id}`;
    const [aiDraftId, setAiDraftId] = useState<string | null>(() => {
        try {
            return localStorage.getItem(aiStorageKey);
        } catch {
            return null;
        }
    });
    useEffect(() => {
        try {
            if (aiDraftId) localStorage.setItem(aiStorageKey, aiDraftId);
            else localStorage.removeItem(aiStorageKey);
        } catch {}
    }, [aiDraftId, aiStorageKey]);
    const end = useRef<HTMLDivElement>(null),
        scroll = useRef<HTMLDivElement>(null),
        follow = useRef(true);
    const draftKey = `${chat.id}:${kind}`,
        text = drafts[draftKey] ?? "";
    const busy = sharedDrafts.pending[draftKey]?.busy ?? false;
    const guard = useReplyGuard(
        chat.channelId,
        chat.id,
        chat.replyRevision,
        userId,
        !!bootstrap.channels.find((c) => c.id === chat.channelId)
            ?.replyGuardEnabled,
        kind === "reply" && chat.status !== "closed",
        canRespond && !chat.historyOnly,
    );
    useEffect(() => {
        onActivity(null);
        return () => onActivity(null);
    }, [kind, onActivity]);
    const attachments = useAttachmentDrafts(draftKey, draftSession);
    const replyCompleted = sharedDrafts.completed[`${chat.id}:reply`] ?? 0;
    const noteCompleted = sharedDrafts.completed[`${chat.id}:note`] ?? 0;
    const completion = useRef({ reply: replyCompleted, note: noteCompleted });
    useEffect(() => {
        // A send started in an earlier pane can finish after returning to this conversation.
        if (completion.current.reply !== replyCompleted) {
            setAiDraftId(null);
            emailReply.reset();
        }
        if (completion.current.note !== noteCompleted) noteMentions.clear();
        completion.current = { reply: replyCompleted, note: noteCompleted };
    }, [replyCompleted, noteCompleted]); // eslint-disable-line react-hooks/exhaustive-deps
    const uploadUrl = `/api/inbox/conversations/${chat.id}/attachments`;
    const lastMessageId = messages.at(-1)?.id;
    useEffect(() => {
        if (follow.current) end.current?.scrollIntoView({ block: "end" });
    }, [lastMessageId]);
    useEffect(() => {
        void inboxWrite(`/api/inbox/conversations/${chat.id}`, {
            action: "read",
            customerSeq: chat.customerSeq,
        })
            .then(refresh)
            .catch(() => {});
    }, [chat.id, chat.customerSeq]); // eslint-disable-line react-hooks/exhaustive-deps
    const changingRef = useRef(false);
    const [changing, setChanging] = useState(false);
    async function change(value: unknown) {
        if (changingRef.current) return false;
        if (!canRespond) {
            toast.info(
                "열람 권한으로 보고 있습니다. 응대·편집은 담당 직원에게 요청해주세요.",
            );
            return false;
        }
        if (chat.historyOnly) {
            toast.info(
                "과거 상담 기록입니다. 현재 고객 정보에서 후속 업무를 만들어주세요.",
            );
            return false;
        }
        changingRef.current = true;
        setChanging(true);
        try {
            await patch(value);
            return true;
        } catch (e) {
            toast.error((e as Error).message);
            return false;
        } finally {
            changingRef.current = false;
            if (mounted.current) setChanging(false);
        }
    }
    function persistDraft(value: string, key = draftKey) {
        try {
            const current = JSON.parse(
                localStorage.getItem(draftStorageKey) ?? "{}",
            );
            localStorage.setItem(
                draftStorageKey,
                JSON.stringify({ ...current, [key]: value }),
            );
        } catch {}
    }
    function updateDraft(value: string, key = draftKey) {
        draftSession.setText(key, value);
        persistDraft(value, key);
    }
    // 취소된 메일 답장을 새 답장 초안으로 되살린다. 작성 중인 내용은 지우지 않고 뒤에 붙인다.
    const rewriteRef = useRef<(body: string) => void>(() => {});
    useEffect(() => {
        rewriteRef.current = (body) => {
            const key = `${chat.id}:reply`,
                current = drafts[key] ?? "";
            setKind("reply");
            updateDraft(current.trim() ? `${current}

${body}` : body, key);
            toast.info(
                "취소된 답장 본문을 작성란에 넣었습니다. 첨부는 다시 추가해주세요.",
            );
        };
    });
    const rewriteReply = useCallback(
        (body: string) => rewriteRef.current(body),
        [],
    );
    async function send() {
        if (!canRespond || !draftSession.capture().isCurrent()) return;
        if ((!text.trim() && !attachments.files.length) || busy) return;
        if (kind === "reply" && !guard.canSend) {
            toast.error(
                "확인된 작성 권한과 최신 대화가 필요합니다. 초안을 유지하고 작성 상태를 확인해주세요.",
            );
            void guard.refresh();
            return;
        }
        const replyGuard = kind === "reply" ? guard.context() : undefined;
        if (
            chat.medium === "email" &&
            kind === "reply" &&
            attachments.files.reduce((sum, f) => sum + f.file.size, 0) >
                MAX_FILE_BYTES
        ) {
            toast.error("이메일 답장 첨부는 합계 20MB까지 보낼 수 있습니다.");
            return;
        }
        if (
            kind === "reply" &&
            chat.medium === "email" &&
            !chat.emailContext?.enabled
        ) {
            toast.error("메일함 연결이 중지되어 있습니다.");
            return;
        }
        const body = text.trim();
        const source = kind === "reply" ? aiDraftId : null;
        const emailSelection =
            kind === "reply" && chat.medium === "email"
                ? emailReply.selection
                : undefined;
        if (
            kind === "reply" &&
            chat.medium === "email" &&
            (emailReply.stale || !emailSelection)
        ) {
            toast.error("최신 회신 대상과 받는 사람을 확인해주세요.");
            return;
        }
        const emailSignature = JSON.stringify(emailSelection ?? null);
        const mentionIds = kind === "note" ? noteMentions.ids : [],
            mentionSignature = JSON.stringify([...mentionIds].sort());
        const operation = draftSession.begin(
            draftKey,
            JSON.stringify({
                body,
                kind,
                files: attachments.signature,
                aiDraftId: source,
                emailReply: emailSignature,
                mentions: mentionSignature,
            }),
        );
        if (!operation) return;
        try {
            const attachmentIds = await attachments.prepare(
                uploadUrl,
                kind,
                undefined,
                operation,
            );
            operation.assertCurrent();
            const sent = await inboxRequest<ChatMessage>(`/api/inbox/conversations/${chat.id}`, {
                method: "POST",
                signal: operation.signal,
                body: JSON.stringify({
                    attachmentIds,
                    clientId: operation.clientId,
                    body,
                    kind,
                    ...(source ? { aiDraftId: source } : {}),
                    ...(emailSelection ? { emailReply: emailSelection } : {}),
                    ...(mentionIds.length
                        ? { mentionedUserIds: mentionIds }
                        : {}),
                    ...(replyGuard ? { replyGuard } : {}),
                }),
            });
            operation.assertCurrent();
            persistDraft("");
            try {
                if (kind === "reply") {
                    localStorage.removeItem(aiStorageKey);
                    localStorage.removeItem(
                        draftStorageKey + ":email-recipients",
                    );
                } else
                    localStorage.removeItem(draftStorageKey + ":note-mentions");
            } catch {}
            operation.complete();
            await onSent(chat.id, sent);
            if (mounted.current) {
                onActivity(null);
                follow.current = true;
                // The POST is confirmed. A slow/failed refresh must not look like a failed send.
                void refresh().catch(() => {
                    if (mounted.current) toast.info("메시지는 저장됐습니다. 최신 상담 정보를 다시 불러와주세요.");
                });
                void guard.refresh();
            }
        } catch (e) {
            if (operation.isCurrent()) {
                draftSession.requestFailed(e);
                if (operation.isCurrent() && mounted.current) {
                    toast.error((e as Error).message);
                    void guard.refresh();
                }
            }
        } finally {
            operation.finish();
        }
    }
    const allMessages = useMemo(() => {
        const ids = new Set(messages.map(m => m.id));
        return [...older.filter(m => !ids.has(m.id)), ...messages];
    }, [older, messages]);
    return (
        <div className="flex min-h-0 min-w-0 flex-1">
            <section className="flex min-w-0 flex-1 flex-col bg-background">
                <header className="flex h-[76px] shrink-0 items-center justify-between gap-3 border-b px-5">
                    <div className="flex min-w-0 items-center gap-3">
                        <button
                            aria-label="상담 목록으로"
                            className="lg:hidden"
                            onClick={onBack}
                        >
                            <ArrowLeft size={20} />
                        </button>
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-100 font-semibold text-violet-700">
                            {chat.name.slice(0, 1)}
                        </div>
                        <div className="min-w-0">
                            <h2 className="truncate font-semibold">
                                {chat.name}
                            </h2>
                            <p className="text-xs text-muted-foreground">
                                {chat.historyOnly
                                    ? "이전 상담"
                                    : chat.medium === "email"
                                      ? "이메일 상담"
                                      : "사이트 상담"}{" "}
                                · {statusNames[chat.status]}
                            </p>
                        </div>
                        <button
                            disabled={changing || chat.historyOnly || !canRespond}
                            aria-label={
                                chat.priority
                                    ? "중요 상담 해제"
                                    : "중요 상담 지정"
                            }
                            onClick={() => change({ priority: !chat.priority })}
                        >
                            <Star
                                size={17}
                                className={
                                    chat.priority
                                        ? "fill-amber-400 text-amber-400"
                                        : "text-muted-foreground"
                                }
                            />
                        </button>
                    </div>
                    <div className="flex gap-2">
                        {!chat.historyOnly && canRespond && (
                            <>
                                {chat.status !== "closed" ? (
                                    <>
                                        <button
                                            title="상담 보류"
                                            disabled={changing}
                                            aria-label="상담 보류"
                                            onClick={() =>
                                                change({
                                                    status:
                                                        chat.status ===
                                                        "snoozed"
                                                            ? "open"
                                                            : "snoozed",
                                                })
                                            }
                                            className="rounded-xl border p-2"
                                        >
                                            <Clock size={17} />
                                        </button>
                                        <button
                                            onClick={() =>
                                                change({ status: "closed" })
                                            }
                                            disabled={changing}
                                            className="flex items-center gap-1 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700"
                                        >
                                            <Check size={16} />
                                            종료
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        className="rounded-xl border px-3 py-2 text-sm"
                                        onClick={() =>
                                            change({ status: "open" })
                                        }
                                        disabled={changing}
                                    >
                                        다시 열기
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                </header>
                {!canRespond && (
                    <p
                        role="status"
                        className="border-b bg-muted px-5 py-3 text-sm"
                    >
                        열람 권한으로 보고 있습니다. 답변과 고객 정보 편집은
                        응대 담당자가 할 수 있습니다.
                    </p>
                )}
                {chat.emailContext && (
                    <div className="border-b bg-violet-50 px-5 py-3 text-sm">
                        <p className="font-semibold">
                            {chat.emailContext.subject}
                        </p>
                        <p className="mt-1 text-xs">
                            {chat.emailContext.from} →{" "}
                            {chat.emailContext.recipient}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                            받는 사람과 참조는 답장 작성란에서 확인합니다.{" "}
                            {chat.emailContext.connectionStatus === "reconnect"
                                ? "Google 재연결이 필요합니다. 관리자에게 이메일 연결 확인을 요청해주세요."
                                : chat.emailContext.connectionStatus === "connected" && chat.emailContext.workerEnabled === false
                                  ? "Google 메일 자동 처리가 꺼져 있습니다. 관리자에게 확인해주세요."
                                  : chat.emailContext.enabled
                                ? "메일 서비스 접수 상태를 각 답장에서 확인할 수 있습니다."
                                : "현재 메일함 연결이 중지되어 있습니다."}
                        </p>
                        {!!chat.emailContext.primarySender &&
                            chat.emailContext.sender !==
                                chat.emailContext.primarySender && (
                                <p className="mt-2 break-all text-xs">
                                    다른 참여자가 회신했습니다. 처음 문의한
                                    주소: {chat.emailContext.primarySender} ·
                                    최신 발신자: {chat.emailContext.sender}
                                </p>
                            )}
                    </div>
                )}
                {chat.historyOnly && (
                    <p
                        role="status"
                        className="border-b bg-amber-50 px-5 py-3 text-xs text-amber-900"
                    >
                        이전 상담 기록 ·{" "}
                        {String(chat.importMetadata?.source ?? "")} · 원본{" "}
                        {String(chat.importMetadata?.sourceId ?? "")}
                        <br />
                        현재 웹 상담과 분리된 과거 기록입니다. 원본 상태:{" "}
                        {statusNames[chat.status]}. 고객에게 답변을 전송하지
                        않습니다.
                    </p>
                )}
                {focusMessageId && (
                    <MentionTargetCard
                        conversationId={chat.id}
                        messageId={focusMessageId}
                        onDismiss={onDismissMention}
                    />
                )}
                <div
                    ref={scroll}
                    onScroll={() => {
                        const el = scroll.current;
                        if (el)
                            follow.current =
                                el.scrollHeight -
                                    el.scrollTop -
                                    el.clientHeight <
                                100;
                    }}
                    className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5"
                    role="log"
                    aria-label="상담 메시지"
                >
                    {canLoad && (
                        <button
                            disabled={loading}
                            className="block w-full py-2 text-xs text-muted-foreground"
                            onClick={async () => {
                                setLoading(true);
                                try {
                                    const data = await inboxRequest<{
                                        messages: ChatMessage[];
                                        hasOlder: boolean;
                                    }>(
                                        `/api/inbox/conversations/${chat.id}?before=${allMessages[0]?.id}`,
                                    );
                                    setOlder((o) => [...data.messages, ...o]);
                                    setCanLoad(data.hasOlder);
                                    follow.current = false;
                                } catch (e) {
                                    toast.error((e as Error).message);
                                } finally {
                                    setLoading(false);
                                }
                            }}
                        >
                            이전 메시지 보기
                        </button>
                    )}
                    {!allMessages.length && (
                        <p className="py-20 text-center text-sm text-muted-foreground">
                            고객이 문의를 작성하고 있습니다.
                        </p>
                    )}
                    <MessageHistory messages={allMessages} historyOnly={chat.historyOnly} canRespond={canRespond} refresh={refresh} onRewrite={rewriteReply} />
                    <div ref={end} />
                </div>
                <ConversationPresence agents={presenceAgents} userId={userId} />
                {!chat.historyOnly && canRespond && (
                    <>
                        {chat.medium !== "email" && (
                            <SupportDraftPanel
                                chat={chat}
                                messages={allMessages}
                                workspaceId={
                                    bootstrap.channels.find(
                                        (c) => c.id === chat.channelId,
                                    )?.workspaceId
                                }
                                hasDraft={!!drafts[`${chat.id}:reply`]?.trim()}
                                onUse={(answer, id) => {
                                    if (
                                        draftSession.getSnapshot().pending[
                                            `${chat.id}:reply`
                                        ]?.busy
                                    ) {
                                        toast.info(
                                            "답변 전송이 끝난 뒤 AI 초안을 추가해주세요.",
                                        );
                                        return;
                                    }
                                    const old =
                                        drafts[`${chat.id}:reply`]?.trim();
                                    updateDraft(
                                        old ? `${old}\n\n${answer}` : answer,
                                        `${chat.id}:reply`,
                                    );
                                    setKind("reply");
                                    setAiDraftId(id);
                                }}
                                onMode={(state) => patch({ aiState: state })}
                            />
                        )}
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                void send();
                            }}
                            className={`m-4 shrink-0 rounded-2xl border p-3 ${kind === "note" ? "border-amber-200 bg-amber-50/60" : "bg-background shadow-sm"}`}
                        >
                            <div className="mb-2 flex gap-1 text-xs">
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => setKind("reply")}
                                    className={`rounded-lg px-3 py-1.5 ${kind === "reply" ? "bg-muted font-semibold" : "text-muted-foreground"}`}
                                >
                                    고객응대
                                </button>
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => setKind("note")}
                                    className={`flex items-center gap-1 rounded-lg px-3 py-1.5 ${kind === "note" ? "bg-amber-100 font-semibold text-amber-800" : "text-muted-foreground"}`}
                                >
                                    <LockKeyhole size={12} />
                                    내부 메모
                                </button>
                            </div>
                            {kind === "reply" && chat.medium === "email" && (
                                <EmailReplyRecipients
                                    state={emailReply}
                                    disabled={busy}
                                />
                            )}
                            {kind === "reply" && (
                                <ReplyGuardStatus
                                    guard={guard}
                                    refresh={refresh}
                                    hasDraft={
                                        !!text.trim() ||
                                        !!attachments.files.length
                                    }
                                />
                            )}
                            {kind === "note" && (
                                <NoteMentions
                                    state={noteMentions}
                                    busy={busy}
                                />
                            )}
                            <textarea
                                aria-label={
                                    kind === "note"
                                        ? "내부 메모 입력"
                                        : "고객 답변 입력"
                                }
                                value={text}
                                onChange={(e) => {
                                    updateDraft(e.target.value);
                                    onActivity(
                                        e.target.value.trim() ? kind : null,
                                    );
                                }}
                                onBlur={() => onActivity(null)}
                                onKeyDown={(e) => {
                                    if (
                                        e.key === "Enter" &&
                                        (e.ctrlKey || e.metaKey) &&
                                        !e.nativeEvent.isComposing
                                    ) {
                                        e.preventDefault();
                                        void send();
                                    }
                                }}
                                disabled={
                                    busy ||
                                    (kind === "reply" &&
                                        (chat.status === "closed" ||
                                            (guard.required && !guard.mine)))
                                }
                                maxLength={5000}
                                rows={3}
                                placeholder={
                                    kind === "note"
                                        ? "팀원만 볼 수 있는 메모를 남겨주세요."
                                        : chat.status === "closed"
                                          ? "종료된 상담입니다. 다시 열면 답변할 수 있어요."
                                          : "고객에게 보낼 메시지를 입력하세요."
                                }
                                className="w-full resize-none bg-transparent text-sm outline-none"
                            />
                            {kind === "reply" && aiDraftId && (
                                <p className="mb-2 text-xs text-muted-foreground">
                                    AI 초안의 근거를 전송할 때 다시 확인합니다.{" "}
                                    <button
                                        type="button"
                                        disabled={busy}
                                        className="underline"
                                        onClick={() => setAiDraftId(null)}
                                    >
                                        초안 연결 해제·일반 답변으로 전환
                                    </button>
                                </p>
                            )}
                            {chat.medium === "email" && kind === "reply" && (
                                <p className="mb-2 text-xs text-muted-foreground">
                                    이메일 첨부는 최대 5개, 합계 20MB까지 보낼
                                    수 있습니다.
                                </p>
                            )}
                            <AttachmentDrafts
                                files={attachments.files}
                                busy={
                                    busy ||
                                    (kind === "reply" &&
                                        (chat.status === "closed" ||
                                            (guard.required && !guard.mine)))
                                }
                                progress={attachments.progress}
                                onSelect={attachments.select}
                                onRemove={(id) =>
                                    attachments.remove(id, uploadUrl)
                                }
                                onError={(message) => toast.error(message)}
                            />
                            {attachments.files.length > 0 && (
                                <p className="mt-1 text-[10px] text-muted-foreground">
                                    첨부 초안은 문의를 오가며 유지됩니다.
                                    사업·조직·계정 변경이나 상담함 이탈 시
                                    초기화됩니다.
                                </p>
                            )}
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-muted-foreground">
                                    {kind === "note"
                                        ? "고객에게 보이지 않습니다"
                                        : "Ctrl / ⌘ + Enter로 전송"}
                                </span>
                                <button
                                    disabled={
                                        busy ||
                                        (!text.trim() &&
                                            !attachments.files.length) ||
                                        (kind === "reply" &&
                                            (chat.status === "closed" ||
                                                !guard.canSend))
                                    }
                                    className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-white disabled:opacity-40 ${kind === "note" ? "bg-amber-700" : "bg-[#635BFF]"}`}
                                >
                                    <Send size={13} />
                                    {busy
                                        ? "전송 중…"
                                        : kind === "note"
                                          ? "메모 저장"
                                          : chat.medium === "email"
                                            ? "메일 발송 예약"
                                            : "답변 전송"}
                                </button>
                            </div>
                        </form>
                    </>
                )}
                <details className="mx-4 mb-3 max-h-[40vh] shrink-0 overflow-y-auto lg:hidden">
                    <summary className="cursor-pointer text-sm">
                        고객 · 담당 정보
                    </summary>
                    <CustomerInfo
                        chat={chat}
                        bootstrap={bootstrap}
                        change={change}
                    />
                </details>
            </section>
            <aside className="hidden w-[320px] shrink-0 overflow-y-auto border-l bg-muted/10 lg:block">
                <div className="flex h-[76px] items-center border-b px-5 text-sm font-semibold">
                    고객 정보
                </div>
                <CustomerInfo
                    chat={chat}
                    bootstrap={bootstrap}
                    change={change}
                />
            </aside>
        </div>
    );
}
function CustomerInfo({
    chat,
    bootstrap,
    change,
}: {
    chat: Conversation;
    bootstrap: InboxBootstrap;
    change: (value: unknown) => Promise<boolean>;
}) {
    const workspaceId = bootstrap.channels.find(
        (c) => c.id === chat.channelId,
    )?.workspaceId;
    const canRespond = workspaceAbilities(bootstrap, workspaceId).respond;
    const [recordDraft, setRecord] = useState<{
            value: string;
            version: number;
        } | null>(null),
        [tagDraft, setTags] = useState<{
            value: string;
            version: number;
        } | null>(null);
    const recordId = recordDraft?.value ?? String(chat.recordId ?? ""),
        tags = tagDraft?.value ?? chat.tags.join(", ");
    const [saving, setSaving] = useState(false);
    async function save(which: "record" | "tags") {
        setSaving(true);
        try {
            const result = await change(
                which === "tags"
                    ? {
                          tags: tags
                              .split(",")
                              .map((t) => t.trim())
                              .filter(Boolean),
                          version: tagDraft?.version ?? chat.version,
                      }
                    : {
                          // 숫자만 입력하면 레코드 번호, 그 밖은 화면에 보이는 통합코드로 연결한다.
                          ...(!recordId.trim()
                              ? { recordId: null }
                              : /^\d+$/.test(recordId.trim())
                                ? { recordId: Number(recordId.trim()) }
                                : { recordCode: recordId.trim() }),
                          version: recordDraft?.version ?? chat.version,
                      },
            );
            if (result) {
                if (which === "tags") setTags(null);
                else setRecord(null);
            }
        } finally {
            setSaving(false);
        }
    }
    return (
        <div className="space-y-6 p-5 text-sm">
            <StaffReplyContact id={chat.id} />
            <ConversationJourneyPanel
                key={chat.id}
                id={chat.id}
                recordId={chat.recordId}
                version={chat.version}
                canConfirm={canRespond && !chat.historyOnly}
                change={change}
            />
            <CustomerCrmContext
                key={`crm-${chat.id}`}
                chat={chat}
                bootstrap={bootstrap}
            />
            <ConversationServiceStatus id={chat.id} />
            {chat.historyOnly ? (
                <>
                    <section className="space-y-2 text-xs">
                        <h3 className="font-semibold">과거 상담 원본 정보</h3>
                        <p>
                            {String(
                                chat.importMetadata?.customerName ||
                                    "연결된 고객 이름은 고객 관리에서 확인해주세요.",
                            )}
                        </p>
                        <p>{chat.email ?? "이메일 미입력"}</p>
                        <p>태그: {chat.tags.join(", ") || "없음"}</p>
                        <p className="text-muted-foreground">
                            이 기록의 상태·태그·담당은 직접 수정하지 않습니다.
                            현재 고객 관리에서 딜·후속 업무를 연결할 수
                            있습니다.
                        </p>
                    </section>
                    <InboxAudit
                        url={`/api/inbox/conversations/${chat.id}/audit`}
                    />
                </>
            ) : (
                <>
                    <TeamAssignment
                        bootstrap={bootstrap}
                        chat={chat}
                        workspaceId={workspaceId ?? 0}
                        canRespond={canRespond}
                        change={change}
                    />
                    <section className="space-y-3 border-t pt-5">
                        <h3 className="font-semibold">고객 정보</h3>
                        <div>
                            <p className="text-xs text-muted-foreground">
                                이름
                            </p>
                            <p className="mt-1">{chat.name}</p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">
                                {chat.medium === "email"
                                    ? "이메일 · 상담 시작 주소"
                                    : chat.contactId
                                      ? "이메일 · 연결된 회원"
                                      : "이메일 · 고객 입력"}
                            </p>
                            <p className="mt-1 break-all">
                                {chat.email ?? "미입력"}
                            </p>
                            {chat.contactId && (
                                <a
                                    className="mt-2 block text-xs text-[#635BFF]"
                                    href={`/customer-crm?workspaceId=${bootstrap.channels.find((c) => c.id === chat.channelId)?.workspaceId ?? ""}&q=${encodeURIComponent(chat.name)}`}
                                >
                                    고객 관리에서 딜·할 일 연결 ↗
                                </a>
                            )}
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">
                                문의 페이지
                            </p>
                            <p className="mt-1 break-all text-xs">
                                {chat.pageUrl ?? "직접 문의"}
                            </p>
                        </div>
                    </section>
                    {((tagDraft && tagDraft.version !== chat.version) ||
                        (recordDraft &&
                            recordDraft.version !== chat.version)) && (
                        <div
                            role="alert"
                            className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800"
                        >
                            다른 변경이 있습니다. 작성 중인 값은 보존했습니다.
                            <button
                                className="mt-2 block underline"
                                onClick={() => {
                                    setTags(null);
                                    setRecord(null);
                                }}
                            >
                                최신 태그·연결 정보 불러오기
                            </button>
                        </div>
                    )}
                    <section className="space-y-3 border-t pt-5">
                        <h3 className="font-semibold">상담 태그</h3>
                        <input
                            aria-label="상담 태그"
                            className="w-full rounded-lg border bg-background p-2 text-xs"
                            disabled={!canRespond}
                            value={tags}
                            onChange={(e) =>
                                setTags((old) => ({
                                    value: e.target.value,
                                    version: old?.version ?? chat.version,
                                }))
                            }
                            placeholder="도입문의, 비용"
                        />
                        <button
                            className="text-xs text-[#635BFF]"
                            disabled={saving || !canRespond}
                            onClick={() => void save("tags")}
                        >
                            태그 저장
                        </button>
                        <div className="flex flex-wrap gap-1">
                            {chat.tags.map((t) => (
                                <span
                                    className="rounded-md bg-violet-50 px-2 py-1 text-[11px] text-violet-700"
                                    key={t}
                                >
                                    {t}
                                </span>
                            ))}
                        </div>
                    </section>
                    <section className="space-y-3 border-t pt-5">
                        <h3 className="font-semibold">샌드비 CRM 연결</h3>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                            고객을 확인한 뒤 같은 사업 레코드의 통합코드(레코드
                            목록에 보이는 코드)를 입력해 연결하세요. 레코드
                            번호도 입력할 수 있습니다.
                        </p>
                        <input
                            maxLength={50}
                            aria-label="CRM 통합코드 또는 레코드 번호"
                            className="w-full rounded-lg border bg-background p-2 text-xs"
                            disabled={!canRespond}
                            value={recordId}
                            onChange={(e) =>
                                setRecord((old) => ({
                                    value: e.target.value,
                                    version: old?.version ?? chat.version,
                                }))
                            }
                            placeholder="예: SALES-0012"
                        />
                        <button
                            className="text-xs text-[#635BFF]"
                            disabled={saving || !canRespond}
                            onClick={() => void save("record")}
                        >
                            고객 연결 저장
                        </button>
                        {chat.recordId && (
                            <div className="flex flex-col gap-2">
                                <a
                                    className="text-xs text-[#635BFF]"
                                    href={`/records?id=${chat.recordId}`}
                                >
                                    CRM 고객 열기 ↗
                                </a>
                                <a
                                    className="text-xs text-[#635BFF]"
                                    href={`/records/${chat.recordId}/journey`}
                                >
                                    메일 · 사이트 · 상담 여정 보기 ↗
                                </a>
                            </div>
                        )}
                    </section>
                    <InboxAudit
                        url={`/api/inbox/conversations/${chat.id}/audit`}
                    />
                </>
            )}
        </div>
    );
}
