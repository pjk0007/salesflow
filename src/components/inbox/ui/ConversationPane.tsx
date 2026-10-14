"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Clock, LockKeyhole, Send, Star } from "lucide-react";
import { toast } from "sonner";
import type { ChatMessage, Conversation, InboxBootstrap } from "../types";
import { inboxRequest, inboxWrite } from "../api";
import { useAttachmentDrafts } from "../hooks/useAttachmentDrafts";
import { AttachmentDrafts } from "./AttachmentDrafts";
import { AttachmentList } from "./AttachmentList";
import { InboxAudit } from "./InboxAudit";
import { CustomerCrmContext } from "./CustomerCrmContext";
import { SupportDraftPanel } from "@/components/customer-ai/ui/SupportDraftPanel";
export const statusNames = {
    open: "진행중",
    snoozed: "보류중",
    closed: "종료됨",
};
export function ConversationPane({
    userId,
    chat,
    messages,
    hasOlder,
    bootstrap,
    patch,
    refresh,
    onBack,
}: {
    userId: string;
    chat: Conversation;
    messages: ChatMessage[];
    hasOlder: boolean;
    bootstrap: InboxBootstrap;
    patch: (value: unknown) => Promise<void>;
    refresh: () => Promise<unknown>;
    onBack: () => void;
}) {
    const draftStorageKey = `sendb-inbox-draft:${userId}:${chat.id}`;
    const [kind, setKind] = useState<"reply" | "note">("reply"),
        [drafts, setDrafts] = useState<Record<string, string>>(() => {
            try {
                return JSON.parse(
                    localStorage.getItem(draftStorageKey) ?? "{}",
                );
            } catch {
                return {};
            }
        }),
        [busy, setBusy] = useState(false);
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
        follow = useRef(true),
        pending = useRef<{
            body: string;
            kind: string;
            id: string;
            files: string;
            aiDraftId: string | null;
        } | null>(null);
    const draftKey = `${chat.id}:${kind}`,
        text = drafts[draftKey] ?? "";
    const attachments = useAttachmentDrafts(draftKey);
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
    async function change(value: unknown) {
        try {
            await patch(value);
            return true;
        } catch (e) {
            toast.error((e as Error).message);
            return false;
        }
    }
    function updateDraft(value: string, key = draftKey) {
        setDrafts((current) => {
            const next = { ...current, [key]: value };
            try {
                localStorage.setItem(draftStorageKey, JSON.stringify(next));
            } catch {}
            return next;
        });
    }
    async function send() {
        if ((!text.trim() && !attachments.files.length) || busy) return;
        const body = text.trim();
        const source = kind === "reply" ? aiDraftId : null;
        setBusy(true);
        if (
            pending.current?.body !== body ||
            pending.current?.kind !== kind ||
            pending.current?.files !== attachments.signature ||
            pending.current?.aiDraftId !== source
        )
            pending.current = {
                body,
                kind,
                id: crypto.randomUUID(),
                files: attachments.signature,
                aiDraftId: source,
            };
        try {
            const attachmentIds = await attachments.prepare(uploadUrl, kind);
            await inboxWrite(`/api/inbox/conversations/${chat.id}`, {
                attachmentIds,
                clientId: pending.current.id,
                body,
                kind,
                ...(source ? { aiDraftId: source } : {}),
            });
            updateDraft("");
            if (kind === "reply") setAiDraftId(null);
            attachments.clear();
            pending.current = null;
            follow.current = true;
            await refresh();
        } catch (e) {
            toast.error((e as Error).message);
        } finally {
            setBusy(false);
        }
    }
    const allMessages = [
        ...older.filter((o) => !messages.some((m) => m.id === o.id)),
        ...messages,
    ];
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
                                사이트 상담 · {statusNames[chat.status]}
                            </p>
                        </div>
                        <button
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
                        {chat.status !== "closed" ? (
                            <>
                                <button
                                    title="상담 보류"
                                    aria-label="상담 보류"
                                    onClick={() =>
                                        change({
                                            status:
                                                chat.status === "snoozed"
                                                    ? "open"
                                                    : "snoozed",
                                        })
                                    }
                                    className="rounded-xl border p-2"
                                >
                                    <Clock size={17} />
                                </button>
                                <button
                                    onClick={() => change({ status: "closed" })}
                                    className="flex items-center gap-1 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700"
                                >
                                    <Check size={16} />
                                    종료
                                </button>
                            </>
                        ) : (
                            <button
                                className="rounded-xl border px-3 py-2 text-sm"
                                onClick={() => change({ status: "open" })}
                            >
                                다시 열기
                            </button>
                        )}
                    </div>
                </header>
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
                    <div className="text-center text-xs text-muted-foreground">
                        {new Date(chat.lastMessageAt).toLocaleDateString(
                            "ko-KR",
                            {
                                month: "long",
                                day: "numeric",
                            },
                        )}
                    </div>
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
                    {allMessages.map((m) => (
                        <div
                            key={m.id}
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
                                    {m.kind === "note" ? " · 내부 메모" : ""}
                                    <time>
                                        {new Date(
                                            m.createdAt,
                                        ).toLocaleTimeString("ko-KR", {
                                            hour: "2-digit",
                                            minute: "2-digit",
                                        })}
                                    </time>
                                </div>
                                {m.body && (
                                    <p
                                        className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-relaxed ${m.kind === "customer" ? "rounded-tl-md bg-muted" : m.kind === "note" ? "border border-amber-200 bg-amber-50 text-amber-950" : "rounded-tr-md bg-[#635BFF] text-white"}`}
                                    >
                                        {m.body}
                                    </p>
                                )}
                                <AttachmentList
                                    files={m.attachments}
                                    url={(id) => `/api/inbox/attachments/${id}`}
                                />
                            </div>
                        </div>
                    ))}
                    <div ref={end} />
                </div>
                <SupportDraftPanel
                    chat={chat}
                    messages={allMessages}
                    workspaceId={
                        bootstrap.channels.find((c) => c.id === chat.channelId)
                            ?.workspaceId
                    }
                    hasDraft={!!drafts[`${chat.id}:reply`]?.trim()}
                    onUse={(answer, id) => {
                        const old = drafts[`${chat.id}:reply`]?.trim();
                        updateDraft(
                            old ? `${old}\n\n${answer}` : answer,
                            `${chat.id}:reply`,
                        );
                        setKind("reply");
                        setAiDraftId(id);
                    }}
                    onMode={(state) => patch({ aiState: state })}
                />
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
                    <textarea
                        aria-label={
                            kind === "note"
                                ? "내부 메모 입력"
                                : "고객 답변 입력"
                        }
                        value={text}
                        onChange={(e) => updateDraft(e.target.value)}
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
                            (kind === "reply" && chat.status === "closed")
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
                                className="underline"
                                onClick={() => setAiDraftId(null)}
                            >
                                초안 연결 해제·일반 답변으로 전환
                            </button>
                        </p>
                    )}
                    <AttachmentDrafts
                        files={attachments.files}
                        busy={
                            busy ||
                            (kind === "reply" && chat.status === "closed")
                        }
                        progress={attachments.progress}
                        onSelect={attachments.select}
                        onRemove={(id) => attachments.remove(id, uploadUrl)}
                        onError={(message) => toast.error(message)}
                    />
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] text-muted-foreground">
                            {kind === "note"
                                ? "고객에게 보이지 않습니다"
                                : "Ctrl / ⌘ + Enter로 전송"}
                        </span>
                        <button
                            disabled={
                                busy ||
                                (!text.trim() && !attachments.files.length) ||
                                (kind === "reply" && chat.status === "closed")
                            }
                            className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-white disabled:opacity-40 ${kind === "note" ? "bg-amber-700" : "bg-[#635BFF]"}`}
                        >
                            <Send size={13} />
                            {busy
                                ? "전송 중…"
                                : kind === "note"
                                  ? "메모 저장"
                                  : "답변 전송"}
                        </button>
                    </div>
                </form>
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
            <aside className="hidden w-[270px] shrink-0 overflow-y-auto border-l bg-muted/10 lg:block">
                <div className="flex h-[76px] items-center border-b px-5 text-sm font-semibold">
                    상세 정보
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
                          recordId: recordId ? Number(recordId) : null,
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
            <section className="space-y-3">
                <h3 className="font-semibold">담당 정보</h3>
                <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    담당자
                    <select
                        aria-label="담당자"
                        className="max-w-[160px] rounded-lg border bg-background px-2 py-1.5 text-foreground"
                        value={chat.assigneeId ?? ""}
                        onChange={(e) =>
                            change({ assigneeId: e.target.value || null })
                        }
                    >
                        <option value="">담당자 없음</option>
                        {bootstrap.members.map((m) => (
                            <option key={m.id} value={m.id}>
                                {m.name}
                            </option>
                        ))}
                    </select>
                </label>
            </section>
            <CustomerCrmContext chat={chat} bootstrap={bootstrap} />
            <section className="space-y-3 border-t pt-5">
                <h3 className="font-semibold">고객 정보</h3>
                <div>
                    <p className="text-xs text-muted-foreground">이름</p>
                    <p className="mt-1">{chat.name}</p>
                </div>
                <div>
                    <p className="text-xs text-muted-foreground">
                        {chat.contactId
                            ? "이메일 · 연결된 회원"
                            : "이메일 · 고객 입력"}
                    </p>
                    <p className="mt-1 break-all">{chat.email ?? "미입력"}</p>
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
                    <p className="text-xs text-muted-foreground">문의 페이지</p>
                    <p className="mt-1 break-all text-xs">
                        {chat.pageUrl ?? "직접 문의"}
                    </p>
                </div>
            </section>
            {((tagDraft && tagDraft.version !== chat.version) ||
                (recordDraft && recordDraft.version !== chat.version)) && (
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
                    disabled={saving}
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
                    고객을 확인한 뒤 같은 사업의 레코드 번호로 연결하세요.
                </p>
                <input
                    type="number"
                    min={1}
                    aria-label="CRM 레코드 번호"
                    className="w-full rounded-lg border bg-background p-2 text-xs"
                    value={recordId}
                    onChange={(e) =>
                        setRecord((old) => ({
                            value: e.target.value,
                            version: old?.version ?? chat.version,
                        }))
                    }
                    placeholder="레코드 번호"
                />
                <button
                    className="text-xs text-[#635BFF]"
                    disabled={saving}
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
            <InboxAudit url={`/api/inbox/conversations/${chat.id}/audit`} />
        </div>
    );
}
