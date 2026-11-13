"use client";
import { toPlainText } from "@/lib/rich-text/format";
import { workspaceAbilities } from "@/components/customer-access/utils/abilities";
import { useAgentPresence } from "@/components/inbox-presence/hooks/useAgentPresence";
import { useState } from "react";
import { SupportNotifications } from "@/components/inbox-operations/ui/SupportNotifications";
import type { OpenSupportConversation } from "@/components/inbox-operations/types";
import {
    Archive,
    ArrowLeft,
    Inbox,
    MessageCircle,
    Search,
    Star,
    UserRound,
    Clock,
    CheckCheck,
} from "lucide-react";
import { useInbox } from "../hooks/useInbox";
import { useInboxSearch } from "../hooks/useInboxSearch";
import { useStaffDraftSession, type SubscribeSessionInvalidation } from "../hooks/useStaffDraftSession";
import { useEmailMailboxes } from "@/components/inbox-email/hooks/useEmailMailboxes";
import { InboxChannelTabs } from "./InboxChannelTabs";
import { ConversationPane, statusNames } from "./ConversationPane";
import type { ConversationFilter, ConversationStatus } from "../types";
import { toast } from "sonner";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { moveInboxDraft } from "../utils/draft-storage";
import { mailboxAlert } from "@/components/inbox-email/utils/mailbox-alert";
const listDate = new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit" });
export function InboxPage({ userId, orgId = "", role, subscribeSessionInvalidation }: { userId: string; orgId?: string; role: string; subscribeSessionInvalidation?: SubscribeSessionInvalidation }) {
    const params = useSearchParams();
    const [chosenChannel, setChosenChannel] = useState<number | null>(
            Number(params.get("channelId")) || null,
        ),
        [selected, setSelectedState] = useState<string | null>(
            params.get("conversation"),
        );
    const [focusMessageId, setFocusMessageId] = useState<number | null>(
        Number(params.get("message")) > 0
            ? Number(params.get("message"))
            : null,
    );
    const setSelected = (id: string | null) => {
        setSelectedState(id);
        setFocusMessageId(null);
    };
    const [status, setStatus] = useState<ConversationStatus>(() => {
            const value = params.get("status");
            return value === "closed" || value === "snoozed" ? value : "open";
        }),
        [filter, setFilter] = useState<ConversationFilter>(
            params.get("filter") === "history"
                ? "history"
                : params.get("filter") === "mentioned"
                  ? "mentioned"
                  : "all",
        ),
        [query, setQuery] = useState("");
    void role;
    const openSupport: OpenSupportConversation = ({
        conversationId,
        channelId,
        status,
        messageId,
    }) => {
        setChannel(channelId);
        setSelected(conversationId);
        setFocusMessageId(messageId ?? null);
        setFilter("all");
        setStatus(status);
        setQuery("");
    };
    const initial = useInbox(null, null),
        bootstrap = initial.bootstrap.data;
    const channelId = chosenChannel ?? bootstrap?.channels[0]?.id ?? null;
    const searchQuery = useInboxSearch(query);
    const { list, detail, patch, receiveMessage } = useInbox(channelId, selected, {
        q: searchQuery,
        status,
        filter,
    }, (fromId, toId, toChannelId) => {
        // 보고 있던 비회원 상담이 회원 상담으로 합쳐지면 서버가 돌려준 대상으로 따라간다(초안도 옮김).
        if (toChannelId !== channelId) return;
        const moved = moveInboxDraft(localStorage, userId, fromId, toId);
        setSelectedState((current) => (current === fromId ? toId : current));
        toast.info(
            moved
                ? "비회원 상담이 회원 상담으로 합쳐져 이어서 보여드립니다. 작성 중이던 초안도 옮겼습니다."
                : "비회원 상담이 회원 상담으로 합쳐져 이어서 보여드립니다.",
        );
    });
    const channel = bootstrap?.channels.find((c) => c.id === channelId);
    const mailboxes = useEmailMailboxes(channel?.workspaceId ?? null);
    const { reconnectCount, workerStopped: mailWorkerStopped } = mailboxAlert(mailboxes.data);
    const abilities = workspaceAbilities(bootstrap, channel?.workspaceId);
    const accessDenied = [
        initial.bootstrap.error,
        list.error,
        detail.error,
    ].some((error) => error?.status === 401 || error?.status === 403);
    const draftSession = useStaffDraftSession(
        `${orgId}:${userId}:${channelId}`,
        !!channel && abilities.respond && !accessDenied,
        subscribeSessionInvalidation,
    );
    const setChannel = (next: number) => {
        if (next !== channelId) draftSession.invalidate();
        setChosenChannel(next);
    };
    const presence = useAgentPresence(
        channelId,
        detail.data?.conversation.channelId === channelId
            ? detail.data.conversation.id
            : null,
        userId,
    );
    const canSetChannel = channel
        ? abilities.manage
        : !!bootstrap?.workspaces.some((w) => w.abilities.manage);
    const filtered = list.data ?? [];
    const menus: {
        id: ConversationFilter;
        label: string;
        icon: typeof Inbox;
    }[] = [
        { id: "all", label: "전체 상담", icon: Inbox },
        { id: "unread", label: "안 읽은 메시지", icon: MessageCircle },
        { id: "mine", label: "내 상담", icon: UserRound },
        { id: "unassigned", label: "담당자 없음", icon: Archive },
        { id: "priority", label: "중요 상담", icon: Star },
        { id: "history", label: "이전 상담 기록", icon: Archive },
        { id: "mentioned", label: "나를 멘션한 상담", icon: MessageCircle },
    ];
    const count = (id: ConversationFilter) => list.counts?.[id] ?? "…";
    const error = initial.bootstrap.error || list.error || detail.error;
    const headerTools = (
        <>
            <SupportNotifications
                onSelect={openSupport}
                channels={bootstrap?.channels ?? []}
                initialOpen={params.get("notifications") === "open"}
            />
        </>
    );
    return (
        <div className="flex h-full min-h-[600px] flex-col bg-background">
            {/* 좁은 화면에서 상담을 열면 대화 공간을 위해 페이지 머리를 접는다(목록으로 돌아오면 다시 보임) */}
            {/* 사업부 탭 줄 오른쪽 끝에 상담 설정·알림. 좁은 화면에서 상담을 열면 대화 공간을 위해 접는다 */}
            <div className={selected ? "hidden lg:block" : undefined}>
                {bootstrap && channel ? (
                    <InboxChannelTabs
                        bootstrap={bootstrap}
                        channelId={channelId}
                        onChange={(next) => {
                            setChannel(next);
                            setSelected(null);
                        }}
                        right={headerTools}
                    />
                ) : (
                    <div className="flex h-12 items-center justify-end gap-1 border-b px-4">{headerTools}</div>
                )}
            </div>
            {(reconnectCount > 0 || mailWorkerStopped || mailboxes.error) && (
                <p role="alert" className="border-b bg-amber-50 px-5 py-3 text-sm text-amber-900">
                    {reconnectCount > 0 ? `이 사업의 Google 메일함 ${reconnectCount}개를 다시 연결해야 새 문의와 답장을 처리할 수 있습니다.`
                        : mailWorkerStopped ? "Google 메일 자동 처리가 꺼져 있습니다. 관리자에게 서버 설정 확인을 요청해주세요."
                        : "메일 연결 상태를 확인하지 못했습니다. 잠시 후 다시 확인해주세요."}
                    {abilities.manage && reconnectCount > 0 && <Link className="ml-2 underline" href={`/inbox/settings?channelId=${channel?.id ?? ""}&open=email`}>이메일 연결 확인</Link>}
                </p>
            )}
            {error && (
                <div
                    role="alert"
                    className="flex items-center justify-between bg-red-50 px-5 py-3 text-sm text-red-700"
                >
                    {error.message}
                    <button
                        onClick={() => {
                            void initial.bootstrap.mutate();
                            void list.mutate();
                            void detail.mutate();
                        }}
                    >
                        다시 시도
                    </button>
                </div>
            )}
            {!bootstrap ? (
                <p className="m-auto p-10 text-muted-foreground">
                    상담함을 불러오고 있습니다…
                </p>
            ) : !channel ? (
                <div className="m-auto max-w-sm space-y-5 p-8 text-center">
                    <MessageCircle
                        className="mx-auto text-violet-400"
                        size={48}
                    />
                    <h2 className="text-xl font-semibold">
                        {!bootstrap.workspaces.length
                            ? "접근할 수 있는 사업이 없습니다"
                            : "첫 고객 상담을 시작해보세요"}
                    </h2>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                        {!bootstrap.workspaces.length
                            ? "조직 관리자에게 담당 사업의 고객 업무 권한 배정을 요청해주세요."
                            : "사이트에 상담 버튼을 설치하면 고객의 문의를 받고 답변할 수 있습니다."}
                    </p>
                    {canSetChannel ? (
                        <Link
                            className="inline-block rounded-lg bg-[#635BFF] px-5 py-3 text-sm text-white"
                            href="/inbox/settings?new=1"
                        >
                            상담창 만들기
                        </Link>
                    ) : bootstrap.workspaces.length > 0 ? (
                        <p className="text-sm">
                            관리자에게 상담창 설정을 요청해주세요.
                        </p>
                    ) : null}
                </div>
            ) : (
                <div className="flex min-h-0 flex-1">
                    <nav
                        aria-label="상담함"
                        className={`w-[195px] shrink-0 overflow-y-auto border-r bg-muted/20 p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${selected ? "hidden lg:block" : "hidden md:block"}`}
                    >
                        <p className="mb-2 px-3 text-[10px] font-semibold tracking-widest text-muted-foreground">
                            INBOX
                        </p>
                        {menus.map((m) => (
                            <button
                                key={m.id}
                                onClick={() => {
                                    setFilter(m.id);
                                    setSelected(null);
                                }}
                                className={`mb-1 flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] ${filter === m.id ? "bg-violet-100/70 font-semibold text-violet-800" : "text-muted-foreground hover:bg-muted"}`}
                            >
                                <m.icon size={16} />
                                <span className="flex-1 text-left">
                                    {m.label}
                                </span>
                                <span className="text-[11px]">
                                    {count(m.id) || ""}
                                </span>
                            </button>
                        ))}
                        <div className="mt-6 border-t pt-4">
                            <p className="px-3 text-xs text-muted-foreground">
                                팀원
                            </p>
                            {bootstrap.members
                                .filter((m) =>
                                    m.workspaceIds.includes(
                                        channel.workspaceId,
                                    ),
                                )
                                .map((m) => (
                                    <div
                                        className="mt-3 flex items-center gap-2 px-3 text-xs"
                                        key={m.id}
                                    >
                                        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                                            {m.name.slice(0, 1)}
                                        </span>
                                        {m.name}
                                        {m.id === userId && (
                                            <span className="text-[10px] text-muted-foreground">
                                                나
                                            </span>
                                        )}
                                    </div>
                                ))}
                        </div>
                    </nav>
                    <section
                        className={`flex min-h-0 w-full shrink-0 flex-col border-r lg:w-[285px] ${selected ? "hidden lg:flex" : "flex md:flex-1 lg:flex-none"}`}
                    >
                        <div className="space-y-4 p-4">
                            <div className="flex items-center justify-between">
                                <h2 className="font-semibold">
                                    {menus.find((m) => m.id === filter)?.label}
                                </h2>
                                <span className="text-xs text-muted-foreground">
                                    {count(filter)}
                                </span>
                            </div>
                            <label className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2">
                                <Search
                                    size={14}
                                    className="text-muted-foreground"
                                />
                                <input
                                    aria-label="상담 검색"
                                    className="min-w-0 w-full bg-transparent text-xs outline-none"
                                    placeholder={filter === "history" ? "이전 상담 기록에서 고객·태그·대화 검색" : `${statusNames[status]} 상담에서 고객·태그·대화 검색`}
                                    maxLength={200}
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                />
                            </label>
                            {query !== searchQuery && <p role="status" className="text-xs text-muted-foreground">검색어 입력 중…</p>}
                            {list.countsError && <button className="text-xs text-muted-foreground" onClick={() => void list.refreshCounts()}>상담 건수 다시 확인</button>}
                            <div
                                className={
                                    filter === "history"
                                        ? "hidden"
                                        : "flex gap-1"
                                }
                                role="tablist"
                                aria-label="상담 상태"
                            >
                                {(["open", "snoozed", "closed"] as const).map(
                                    (s) => (
                                        <button
                                            key={s}
                                            role="tab"
                                            aria-selected={status === s}
                                            onClick={() => {
                                                setStatus(s);
                                                setSelected(null);
                                            }}
                                            className={`flex-1 rounded-lg py-1.5 text-xs ${status === s ? "bg-foreground font-medium text-background" : "text-muted-foreground hover:bg-muted"}`}
                                        >
                                            {statusNames[s]}
                                        </button>
                                    ),
                                )}
                            </div>
                            <select
                                aria-label="모바일 상담 필터"
                                className="w-full rounded-lg border p-2 text-xs md:hidden"
                                value={filter}
                                onChange={(e) =>
                                    setFilter(
                                        e.target.value as ConversationFilter,
                                    )
                                }
                            >
                                {menus.map((m) => (
                                    <option key={m.id} value={m.id}>
                                        {m.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                            {list.isLoading && (
                                <p className="p-6 text-xs text-muted-foreground">
                                    불러오는 중…
                                </p>
                            )}
                            {!list.isLoading && !filtered.length && (
                                <div className="px-5 py-14 text-center">
                                    <CheckCheck
                                        size={28}
                                        className="mx-auto mb-3 text-muted-foreground/40"
                                    />
                                    <p className="text-sm text-muted-foreground">
                                        {query
                                            ? filter === "history"
                                                ? "이전 상담 기록에 검색 결과가 없습니다"
                                                : `${statusNames[status]} 상담에 검색 결과가 없습니다`
                                            : "이곳의 상담을 모두 확인했어요"}
                                    </p>
                                    {query && filter !== "history" && list.counts?.searchOpen !== undefined && (
                                        <div className="mt-3 flex flex-wrap justify-center gap-2 text-xs">
                                            {(["open", "snoozed", "closed"] as const)
                                                .filter((s) => s !== status)
                                                .map((s) => {
                                                    const n = list.counts?.[s === "open" ? "searchOpen" : s === "snoozed" ? "searchSnoozed" : "searchClosed"] ?? 0;
                                                    return (
                                                        <button
                                                            key={s}
                                                            disabled={!n}
                                                            className="rounded-lg border px-2 py-1 disabled:opacity-40"
                                                            onClick={() => {
                                                                setStatus(s);
                                                                setSelected(null);
                                                            }}
                                                        >
                                                            {statusNames[s]} {n}건 보기
                                                        </button>
                                                    );
                                                })}
                                        </div>
                                    )}
                                </div>
                            )}
                            {filtered.map((c) => (
                                <button
                                    aria-label={`${c.name} 상담 열기`}
                                    key={c.id}
                                    onClick={() => setSelected(c.id)}
                                    className={`mb-1 flex w-full gap-3 rounded-xl p-3 text-left ${selected === c.id ? "bg-violet-50 ring-1 ring-violet-100" : "hover:bg-muted/60"}`}
                                >
                                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-sm font-semibold text-violet-700">
                                        {c.name.slice(0, 1)}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-1">
                                            <span className="truncate text-[13px] font-semibold">
                                                {c.name}
                                            </span>
                                            {c.medium === "email" && (
                                                <span className="text-[10px] text-violet-700">
                                                    이메일
                                                </span>
                                            )}
                                            {c.priority && (
                                                <Star
                                                    size={11}
                                                    className="fill-amber-400 text-amber-400"
                                                />
                                            )}
                                            <time className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                                                {listDate.format(new Date(c.lastMessageAt))}
                                            </time>
                                        </div>
                                        <div className="mt-1 flex items-center gap-2">
                                            <p
                                                className={`truncate text-xs ${c.unread ? "font-medium text-foreground" : "text-muted-foreground"}`}
                                            >
                                                {(c.preview && toPlainText(c.preview)) || "새 상담"}
                                            </p>
                                            {c.unread && (
                                                <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-[#635BFF]" />
                                            )}
                                        </div>
                                        <div className="mt-2 flex flex-wrap gap-1">
                                            {c.tags.slice(0, 2).map((t) => (
                                                <span
                                                    key={t}
                                                    className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground"
                                                >
                                                    {t}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </button>
                            ))}
                            {list.hasMore && (
                                <button
                                    disabled={list.loadingMore}
                                    className="w-full py-3 text-xs text-[#635BFF]"
                                    onClick={async () => {
                                        try {
                                            await list.loadMore();
                                        } catch (e) {
                                            toast.error((e as Error).message);
                                        }
                                    }}
                                >
                                    {list.loadingMore
                                        ? "불러오는 중…"
                                        : "이전 상담 더 보기"}
                                </button>
                            )}
                        </div>
                        <p className="border-t px-4 py-2 text-[10px] text-muted-foreground">
                            {channel.enabled
                                ? "사이트 상담창 켜짐"
                                : "사이트 상담창 꺼짐"}{" "}
                            · 검색은 선택한 상태(또는 이전 상담 기록) 안에서 찾습니다
                        </p>
                    </section>
                    {selected && detail.data && detail.data.conversation.id === selected && detail.data.conversation.channelId === channelId && ![401, 403, 404].includes(detail.error?.status) ? (
                        <ConversationPane
                            draftSession={draftSession}
                            userId={userId}
                            presenceAgents={presence.agents}
                            onActivity={presence.activity}
                            key={`${orgId}:${userId}:${channelId}:${detail.data.conversation.id}`}
                            chat={detail.data.conversation}
                            focusMessageId={focusMessageId}
                            onDismissMention={() => setFocusMessageId(null)}
                            messages={detail.data.messages}
                            hasOlder={detail.data.hasOlder}
                            onSent={receiveMessage}
                            bootstrap={bootstrap}
                            patch={async (value) => {
                                await patch(value);
                            }}
                            refresh={async () => {
                                void list.refreshCounts().catch(() => {});
                                await Promise.all([
                                    detail.mutate(),
                                    list.mutate(),
                                ]);
                            }}
                            onBack={() => setSelected(null)}
                        />
                    ) : selected ? (
                        <div className="m-auto p-10 text-sm text-muted-foreground">
                            <button
                                className="mb-5 flex items-center gap-2 lg:hidden"
                                onClick={() => setSelected(null)}
                            >
                                <ArrowLeft size={16} />
                                상담 목록
                            </button>
                            대화를 불러오는 중…
                        </div>
                    ) : (
                        <div className="hidden flex-1 flex-col items-center justify-center gap-4 bg-muted/10 lg:flex">
                            <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-violet-50 text-violet-300">
                                <MessageCircle size={38} />
                            </div>
                            <h2 className="text-lg font-semibold">
                                대화를 이어가 볼까요?
                            </h2>
                            <p className="text-sm text-muted-foreground">
                                왼쪽에서 상담을 선택하면 대화와 고객 정보를
                                확인할 수 있어요.
                            </p>
                            <span className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">
                                <Clock size={13} />새 메시지는 자동으로
                                갱신됩니다.
                            </span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
