"use client";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { ArrowUp, MessageCircle, RotateCcw } from "lucide-react";
import { inboxRequest, InboxRequestError } from "../api";
import type { ChatMessage } from "../types";
import { useAttachmentDrafts } from "../hooks/useAttachmentDrafts";
import { AttachmentDrafts } from "./AttachmentDrafts";
import { AttachmentList } from "./AttachmentList";
import { draftSessionKey } from "../utils/session";
export function ChatWidget({ channelKey }: { channelKey: string }) {
    const [token, setToken] = useState(""),
        [ready, setReady] = useState(false),
        [name, setName] = useState(""),
        [email, setEmail] = useState("");
    const [text, setText] = useState(""),
        [busy, setBusy] = useState(false),
        [error, setError] = useState("");
    const [older, setOlder] = useState<ChatMessage[]>([]),
        [canLoad, setCanLoad] = useState(true);
    const [blocked, setBlocked] = useState(false);
    const [managed, setManaged] = useState(false),
        [opened, setOpened] = useState(true),
        [readId, setReadId] = useState(0);
    const generation = useRef(0);
    const attachments = useAttachmentDrafts(channelKey);
    const resetAttachments = attachments.reset;
    const uploadUrl = `/api/messenger/${channelKey}/attachments`;
    const configured = useRef<string | null>(null);
    const pending = useRef<{ body: string; id: string; files: string } | null>(
            null,
        ),
        end = useRef<HTMLDivElement>(null),
        scroll = useRef<HTMLDivElement>(null),
        follow = useRef(true);
    const storageKey = `sendb-chat:${channelKey}`;
    const config = useSWR<{
        name: string;
        greeting: string;
        color: string;
        allowedOrigins: string[];
    }>(`/api/messenger/${channelKey}`, inboxRequest);
    const data = useSWR<{
        status: string;
        messages: ChatMessage[];
        hasOlder: boolean;
        profile: { name: string; email: string | null; identified: boolean };
    }>(
        token && ready ? [`/api/messenger/${channelKey}`, token] : null,
        ([url, value]: [string, string]) =>
            inboxRequest(url, {
                headers: { Authorization: `Bearer ${value}` },
            }),
        {
            refreshInterval: opened ? 3000 : 15000,
            refreshWhenHidden: false,
            shouldRetryOnError: false,
        },
    );
    useEffect(() => {
        try {
            setToken(localStorage.getItem(storageKey) ?? "");
        } catch {
            /* 저장이 제한되어도 현재 창에서는 상담 가능 */
        }
        setReady(true);
    }, [storageKey]);
    useEffect(() => {
        if (!config.data || window.parent === window) return;
        const parent = new URLSearchParams(window.location.search).get(
            "origin",
        );
        if (!parent || !config.data.allowedOrigins.includes(parent))
            setBlocked(true);
        if (!parent || !config.data.allowedOrigins.includes(parent)) return;
        const listener = (event: MessageEvent) => {
            if (
                event.source !== window.parent ||
                event.origin !== parent ||
                event.data?.key !== channelKey
            )
                return;
            if (event.data.type === "sendb:configure") {
                const next =
                    typeof event.data.identityToken === "string"
                        ? event.data.identityToken
                        : typeof event.data.visitorToken === "string"
                          ? event.data.visitorToken
                          : "";
                setManaged(true);
                setToken(next);
                setOpened(!!event.data.opened);
                setReadId(Number(event.data.readId) || 0);
                const session = draftSessionKey(next);
                if (configured.current !== session) {
                    generation.current++;
                    resetAttachments();
                    setText("");
                    setOlder([]);
                    setCanLoad(true);
                    setError("");
                    pending.current = null;
                    configured.current = session;
                }
            }
            if (event.data.type === "sendb:visibility")
                setOpened(!!event.data.opened);
        };
        window.addEventListener("message", listener);
        window.parent.postMessage(
            { type: "sendb:loaded", key: channelKey },
            parent,
        );
        return () => window.removeEventListener("message", listener);
    }, [config.data, channelKey, resetAttachments]);
    function parentMessage(
        type: string,
        payload: Record<string, unknown> = {},
    ) {
        if (!managed || window.parent === window) return;
        const parent = new URLSearchParams(window.location.search).get(
            "origin",
        );
        if (parent && config.data?.allowedOrigins.includes(parent))
            window.parent.postMessage(
                { type, key: channelKey, ...payload },
                parent,
            );
    }
    useEffect(() => {
        if (!managed) return;
        if (!token || data.data) parentMessage("sendb:ready");
        if (data.error)
            parentMessage("sendb:error", {
                message: data.error.message,
                status:
                    data.error instanceof InboxRequestError
                        ? data.error.status
                        : 500,
            });
    }, [managed, token, data.data, data.error]); // eslint-disable-line react-hooks/exhaustive-deps
    const latestId = data.data?.messages.at(-1)?.id ?? 0;
    useEffect(() => {
        if (!managed || !data.data) return;
        const unread = opened
            ? 0
            : data.data.messages.filter(
                  (m) => m.kind === "reply" && m.id > readId,
              ).length;
        if (opened && latestId > readId) {
            setReadId(latestId);
            parentMessage("sendb:read", { readId: latestId });
        }
        parentMessage("sendb:unread", { count: unread });
    }, [managed, opened, latestId, readId, data.data]); // eslint-disable-line react-hooks/exhaustive-deps
    const lastMessageId = data.data?.messages.at(-1)?.id;
    useEffect(() => {
        if (follow.current) end.current?.scrollIntoView({ block: "end" });
    }, [lastMessageId]);
    const baseError = config.error?.message;
    if (baseError || blocked)
        return (
            <div className="flex h-dvh items-center justify-center bg-white p-8 text-center text-sm text-gray-500">
                {blocked
                    ? "이 사이트에는 상담창이 설치되어 있지 않습니다."
                    : baseError}
            </div>
        );
    const color = config.data?.color ?? "#635BFF";
    async function send() {
        if (busy || (!text.trim() && !attachments.files.length)) return;
        const body = text.trim();
        setBusy(true);
        setError("");
        const currentGeneration = generation.current;
        if (
            pending.current?.body !== body ||
            pending.current?.files !== attachments.signature
        )
            pending.current = {
                body,
                id: crypto.randomUUID(),
                files: attachments.signature,
            };
        try {
            let session = token;
            if (!session) {
                const result = await inboxRequest<{ token: string }>(
                    `/api/messenger/${channelKey}`,
                    {
                        method: "POST",
                        body: JSON.stringify({
                            action: "session",
                            name: name.trim(),
                            email: email.trim(),
                            pageUrl:
                                new URLSearchParams(window.location.search).get(
                                    "page",
                                ) ?? undefined,
                        }),
                        headers: { "Content-Type": "application/json" },
                    },
                );
                if (currentGeneration !== generation.current) return;
                session = result.token;
                // First anonymous session belongs to the current draft; parent echo must not reset it.
                configured.current = draftSessionKey(session);
                setToken(session);
                if (managed) parentMessage("sendb:session", { token: session });
                else
                    try {
                        localStorage.setItem(storageKey, session);
                    } catch {
                        /* 현재 창 세션 유지 */
                    }
            }
            const attachmentIds = await attachments.prepare(
                uploadUrl,
                "customer",
                { Authorization: `Bearer ${session}` },
            );
            if (currentGeneration !== generation.current) return;
            await inboxRequest(`/api/messenger/${channelKey}`, {
                method: "POST",
                body: JSON.stringify({
                    clientId: pending.current!.id,
                    body,
                    attachmentIds,
                }),
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${session}`,
                },
            });
            if (currentGeneration !== generation.current) return;
            setText("");
            attachments.clear();
            pending.current = null;
            follow.current = true;
            await data.mutate();
        } catch (e) {
            if (currentGeneration === generation.current)
                setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    }
    const messages = [
        ...older.filter((o) => !data.data?.messages.some((m) => m.id === o.id)),
        ...(data.data?.messages ?? []),
    ];
    return (
        <div className="flex h-dvh flex-col bg-white font-sans text-gray-900">
            <header
                className="shrink-0 px-6 py-6 text-white"
                style={{ backgroundColor: color }}
            >
                <div className="mb-3 flex items-center gap-3">
                    <div className="rounded-2xl bg-white/20 p-2.5">
                        <MessageCircle size={23} />
                    </div>
                    <div>
                        <h1 className="text-lg font-semibold">
                            {config.data?.name ?? "고객 상담"}
                        </h1>
                        <p className="mt-1 text-xs text-white/75">
                            문의 내용을 남겨주시면 순서대로 답변드려요
                        </p>
                    </div>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/90">
                    {config.data?.greeting}
                </p>
            </header>
            <div
                ref={scroll}
                onScroll={() => {
                    const el = scroll.current;
                    if (el)
                        follow.current =
                            el.scrollHeight - el.scrollTop - el.clientHeight <
                            80;
                }}
                className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5"
                role="log"
                aria-label="고객 상담 대화"
            >
                {data.error && (
                    <div
                        role="alert"
                        className="space-y-2 rounded-xl bg-red-50 p-3 text-xs text-red-700"
                    >
                        <p>{data.error.message}</p>
                        <button
                            onClick={() => {
                                void data.mutate();
                            }}
                        >
                            다시 불러오기
                        </button>
                        <button
                            className="ml-4"
                            onClick={() => {
                                if (managed && token.includes(".")) {
                                    parentMessage("sendb:refresh");
                                    return;
                                }
                                generation.current++;
                                attachments.reset();
                                pending.current = null;
                                setToken("");
                                setOlder([]);
                                setCanLoad(true);
                                try {
                                    localStorage.removeItem(storageKey);
                                } catch {}
                            }}
                        >
                            {managed && token.includes(".")
                                ? "회원 다시 연결"
                                : "새 문의 시작"}
                        </button>
                    </div>
                )}
                {data.data?.hasOlder && canLoad && (
                    <button
                        className="w-full text-xs text-gray-500"
                        onClick={async () => {
                            try {
                                const result = await inboxRequest<{
                                    messages: ChatMessage[];
                                    hasOlder: boolean;
                                }>(
                                    `/api/messenger/${channelKey}?before=${messages[0]?.id}`,
                                    {
                                        headers: {
                                            Authorization: `Bearer ${token}`,
                                        },
                                    },
                                );
                                follow.current = false;
                                setOlder((o) => [...result.messages, ...o]);
                                setCanLoad(result.hasOlder);
                            } catch (e) {
                                setError((e as Error).message);
                            }
                        }}
                    >
                        이전 메시지 보기
                    </button>
                )}
                {!token && (
                    <div className="space-y-3 rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                        <h2 className="text-sm font-semibold">
                            어떻게 불러드릴까요?
                        </h2>
                        <label className="block text-xs text-gray-500">
                            이름
                            <input
                                aria-label="방문자 이름"
                                value={name}
                                maxLength={100}
                                onChange={(e) => setName(e.target.value)}
                                className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900"
                                placeholder="이름 또는 닉네임"
                            />
                        </label>
                        <label className="block text-xs text-gray-500">
                            이메일 (선택)
                            <input
                                aria-label="방문자 이메일"
                                type="email"
                                value={email}
                                maxLength={254}
                                onChange={(e) => setEmail(e.target.value)}
                                className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900"
                                placeholder="이메일 주소 (선택)"
                            />
                        </label>
                        <p className="text-[10px] leading-relaxed text-gray-400">
                            이름과 연락처는 이 문의의 상담·응대를 위해
                            저장됩니다. 답변은 이 상담창에서 확인해주세요.
                        </p>
                    </div>
                )}
                {messages.map((m) => (
                    <div
                        className={`flex ${m.kind === "customer" ? "justify-end" : "justify-start"}`}
                        key={m.id}
                    >
                        <div className="max-w-[85%]">
                            <p
                                className={`mb-1.5 text-[10px] text-gray-400 ${m.kind === "customer" ? "text-right" : ""}`}
                            >
                                {m.authorName} ·{" "}
                                {new Date(m.createdAt).toLocaleTimeString(
                                    "ko-KR",
                                    {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                    },
                                )}
                            </p>
                            {m.body && (
                                <p
                                    className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-relaxed ${m.kind === "customer" ? "rounded-tr-md text-white" : "rounded-tl-md bg-gray-100"}`}
                                    style={
                                        m.kind === "customer"
                                            ? { backgroundColor: color }
                                            : {}
                                    }
                                >
                                    {m.body}
                                </p>
                            )}
                            <AttachmentList
                                files={m.attachments}
                                url={(id) =>
                                    `/api/messenger/${channelKey}/attachments/${id}`
                                }
                                headers={{ Authorization: `Bearer ${token}` }}
                            />
                        </div>
                    </div>
                ))}
                <div ref={end} />
            </div>
            {data.data?.status === "closed" && (
                <p className="bg-gray-50 px-5 py-2 text-center text-xs text-gray-500">
                    상담이 종료되었습니다. 메시지를 보내면 다시 연결됩니다.
                </p>
            )}
            {error && (
                <p role="alert" className="px-5 pb-2 text-xs text-red-600">
                    {error}
                </p>
            )}
            <form
                className="shrink-0 border-t border-gray-100 p-4"
                onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                }}
            >
                <div className="flex items-end gap-2 rounded-2xl border border-gray-200 p-3">
                    <textarea
                        aria-label="문의 메시지"
                        disabled={busy}
                        value={text}
                        maxLength={5000}
                        onChange={(e) => setText(e.target.value)}
                        placeholder="메시지를 입력해주세요"
                        rows={2}
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
                        className="min-w-0 flex-1 resize-none text-sm outline-none"
                    />
                    <button
                        aria-label="문의 보내기"
                        disabled={
                            busy ||
                            (!text.trim() && !attachments.files.length) ||
                            (!token && !name.trim()) ||
                            !config.data ||
                            !!data.error
                        }
                        className="rounded-xl p-2.5 text-white disabled:opacity-40"
                        style={{ backgroundColor: color }}
                    >
                        {busy ? (
                            <RotateCcw size={17} className="animate-spin" />
                        ) : (
                            <ArrowUp size={17} />
                        )}
                    </button>
                </div>
                <AttachmentDrafts
                    files={attachments.files}
                    busy={busy || !config.data || !!data.error}
                    progress={attachments.progress}
                    onSelect={attachments.select}
                    onRemove={(id) =>
                        attachments.remove(id, uploadUrl, {
                            Authorization: `Bearer ${token}`,
                        })
                    }
                    onError={setError}
                />
                <p className="mt-3 text-center text-[10px] text-gray-400">
                    Sendb 고객 상담
                </p>
            </form>
        </div>
    );
}
