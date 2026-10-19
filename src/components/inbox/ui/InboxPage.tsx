"use client";
import { StaffAccessPanel } from "@/components/customer-access/ui/StaffAccessPanel";
import { workspaceAbilities } from "@/components/customer-access/utils/abilities";
import { TeamSettings } from "@/components/inbox-routing/ui/TeamSettings";
import { useAgentPresence } from "@/components/inbox-presence/hooks/useAgentPresence";
import { ReplyGuardSettings } from "@/components/inbox-reply-guard/ui/ReplyGuardSettings";
import { AgentStatus } from "@/components/inbox-presence/ui/AgentStatus";
import { CapacitySettings } from "@/components/inbox-capacity/ui/CapacitySettings";
import { useState } from "react";
import { SupportNotifications } from "@/components/inbox-operations/ui/SupportNotifications";
import { OperationsPanel } from "@/components/inbox-operations/ui/OperationsPanel";
import type { OpenSupportConversation } from "@/components/inbox-operations/types";
import {
    Archive,
    ArrowLeft,
    Inbox,
    MessageCircle,
    Plus,
    Search,
    Settings2,
    Star,
    UserRound,
    Clock,
    CheckCheck,
} from "lucide-react";
import { useInbox } from "../hooks/useInbox";
import { useStaffDraftSession, type SubscribeSessionInvalidation } from "../hooks/useStaffDraftSession";
import { EmailMailboxSettings } from "@/components/inbox-email/ui/EmailMailboxSettings";
import { ChannelSettings } from "./ChannelSettings";
import { ConversationPane, statusNames } from "./ConversationPane";
import type { ConversationFilter, ConversationStatus } from "../types";
import { toast } from "sonner";
import { useSearchParams } from "next/navigation";
export function InboxPage({ userId, orgId = "", role, subscribeSessionInvalidation }: { userId: string; orgId?: string; role: string; subscribeSessionInvalidation?: SubscribeSessionInvalidation }) {
    const params = useSearchParams();
    const [emailSettings, setEmailSettings] = useState(() =>
        params.has("emailConnection"),
    );
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
    const [accessOpen, setAccessOpen] = useState(false);
    const [operationsOpen, setOperationsOpen] = useState(false);
    const [teamsOpen, setTeamsOpen] = useState(false);
    const [capacityOpen, setCapacityOpen] = useState(false);
    const [replyGuardOpen, setReplyGuardOpen] = useState(false);
    const [teamFilters, setTeamFilters] = useState<Record<number, string>>({});
    const openSupport: OpenSupportConversation = ({
        conversationId,
        channelId,
        status,
        messageId,
    }) => {
        setChannel(channelId);
        setTeamFilters((value) => ({ ...value, [channelId]: "" }));
        setSelected(conversationId);
        setFocusMessageId(messageId ?? null);
        setFilter("all");
        setStatus(status);
        setQuery("");
    };
    const [settings, setSettings] = useState<"current" | "new" | null>(null);
    const initial = useInbox(null, null),
        bootstrap = initial.bootstrap.data;
    const channelId = chosenChannel ?? bootstrap?.channels[0]?.id ?? null;
    const { list, detail, patch } = useInbox(channelId, selected, {
        q: query,
        status,
        filter,
        teamId: channelId ? (teamFilters[channelId] ?? "") : "",
    });
    const channel = bootstrap?.channels.find((c) => c.id === channelId);
    const abilities = workspaceAbilities(bootstrap, channel?.workspaceId);
    const accessDenied = [initial.bootstrap.error, list.error, detail.error].some((error) => error?.status === 401 || error?.status === 403);
    const draftSession = useStaffDraftSession(`${orgId}:${userId}:${channelId}`, !!channel && abilities.respond && !accessDenied, subscribeSessionInvalidation);
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
        { id: "myTeams", label: "내 팀 상담", icon: UserRound },
        { id: "unassigned", label: "담당자 없음", icon: Archive },
        { id: "priority", label: "중요 상담", icon: Star },
        { id: "history", label: "이전 상담 기록", icon: Archive },
        { id: "mentioned", label: "나를 멘션한 상담", icon: MessageCircle },
    ];
    const count = (id: ConversationFilter) => list.counts?.[id] ?? 0;
    const error = initial.bootstrap.error || list.error || detail.error;
    return (
        <div className="flex h-full min-h-[600px] flex-col bg-background">
            <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-2 border-b px-5 py-3">
                <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#635BFF] text-white">
                        <MessageCircle size={19} />
                    </div>
                    <div>
                        <h1 className="text-lg font-semibold">고객 상담</h1>
                        <p className="text-xs text-muted-foreground">
                            고객과의 대화, 한곳에서 이어가세요.
                        </p>
                    </div>
                </div>
                <SupportNotifications
                    onSelect={openSupport}
                    channels={bootstrap?.channels ?? []}
                    initialOpen={params.get("notifications") === "open"}
                />
                {channel && (
                    <AgentStatus
                        key={`${channel.id}:${userId}`}
                        presence={presence}
                        userId={userId}
                        canRespond={abilities.respond}
                    />
                )}
                {channel && (
                    <button
                        className="rounded-xl border px-3 py-2 text-xs"
                        onClick={() => setOperationsOpen(true)}
                    >
                        운영·성과
                    </button>
                )}
                {abilities.manage && channel && (
                    <button
                        className="rounded-xl border px-3 py-2 text-xs"
                        onClick={() => setCapacityOpen(true)}
                    >
                        배정 수용량
                    </button>
                )}
                {abilities.manage && channel && (
                    <button
                        className="rounded-xl border px-3 py-2 text-xs"
                        onClick={() => setReplyGuardOpen(true)}
                    >
                        답변 충돌 방지
                    </button>
                )}
                {abilities.manage && channel && (
                    <button
                        className="rounded-xl border px-3 py-2 text-xs"
                        onClick={() => setTeamsOpen(true)}
                    >
                        상담팀
                    </button>
                )}
                {abilities.manage && channel && (
                    <button
                        className="ml-auto rounded-xl border px-3 py-2 text-xs"
                        onClick={() => setEmailSettings(true)}
                    >
                        이메일 연결
                    </button>
                )}
                {canSetChannel && (
                    <button
                        className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs"
                        onClick={() => setSettings(channel ? "current" : "new")}
                    >
                        <Settings2 size={14} />
                        사이트 상담창
                    </button>
                )}
                {bootstrap?.canManageAccess && (
                    <button
                        className="rounded-xl border px-3 py-2 text-xs"
                        onClick={() => setAccessOpen(true)}
                    >
                        직원 권한
                    </button>
                )}
            </header>
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
                        <button
                            className="rounded-xl bg-[#635BFF] px-5 py-3 text-sm text-white"
                            onClick={() => setSettings("new")}
                        >
                            상담창 만들기
                        </button>
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
                        className={`w-[195px] shrink-0 border-r bg-muted/20 p-3 ${selected ? "hidden lg:block" : "hidden md:block"}`}
                    >
                        <select
                            aria-label="상담 채널"
                            className="mb-5 w-full rounded-xl border bg-background px-2 py-3 text-sm font-semibold"
                            value={channelId ?? ""}
                            onChange={(e) => {
                                setChannel(Number(e.target.value));
                                setSelected(null);
                            }}
                        >
                            {bootstrap.channels.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                </option>
                            ))}
                        </select>
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
                        <label className="mt-4 block px-3 text-xs text-muted-foreground">
                            팀 대기열
                            <select
                                aria-label="팀 대기열"
                                className="mt-2 w-full rounded-lg border bg-background px-2 py-2 text-foreground"
                                value={teamFilters[channelId!] ?? ""}
                                onChange={(e) => {
                                    setTeamFilters({
                                        ...teamFilters,
                                        [channelId!]: e.target.value,
                                    });
                                    setSelected(null);
                                }}
                            >
                                <option value="">모든 팀</option>
                                <option value="none">팀 없음</option>
                                {(bootstrap.teams ?? [])
                                    .filter((t) => t.channelId === channelId)
                                    .map((t) => (
                                        <option key={t.id} value={t.id}>
                                            {t.name}
                                            {!t.enabled ? " · 보관됨" : ""}
                                        </option>
                                    ))}
                            </select>
                        </label>
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
                        {canSetChannel && (
                            <button
                                className="mt-7 flex items-center gap-2 px-3 text-xs text-muted-foreground"
                                onClick={() => setSettings("new")}
                            >
                                <Plus size={14} />
                                다른 사업 상담창
                            </button>
                        )}
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
                            <select
                                aria-label="모바일 상담 채널"
                                className="w-full rounded-lg border p-2 text-xs md:hidden"
                                value={channelId ?? ""}
                                onChange={(e) => {
                                    setChannel(Number(e.target.value));
                                    setSelected(null);
                                }}
                            >
                                {bootstrap.channels.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.name}
                                    </option>
                                ))}
                            </select>
                            <label className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2">
                                <Search
                                    size={14}
                                    className="text-muted-foreground"
                                />
                                <input
                                    aria-label="상담 검색"
                                    className="min-w-0 w-full bg-transparent text-xs outline-none"
                                    placeholder="고객, 태그, 대화 전체 검색"
                                    maxLength={200}
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                />
                            </label>
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
                        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
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
                                            ? "검색 결과가 없습니다"
                                            : "이곳의 상담을 모두 확인했어요"}
                                    </p>
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
                                                {new Date(
                                                    c.lastMessageAt,
                                                ).toLocaleDateString("ko-KR", {
                                                    month: "2-digit",
                                                    day: "2-digit",
                                                })}
                                            </time>
                                        </div>
                                        <div className="mt-1 flex items-center gap-2">
                                            <p
                                                className={`truncate text-xs ${c.unread ? "font-medium text-foreground" : "text-muted-foreground"}`}
                                            >
                                                {c.preview || "새 상담"}
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
                            · 모든 상담과 대화에서 검색
                        </p>
                    </section>
                    {selected && detail.data && detail.data.conversation.channelId === channelId && !detail.error ? (
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
                            bootstrap={bootstrap}
                            patch={async (value) => {
                                await patch(value);
                            }}
                            refresh={async () => {
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
            {accessOpen && bootstrap?.canManageAccess && (
                <StaffAccessPanel
                    bootstrap={bootstrap}
                    initialWorkspaceId={channel?.workspaceId}
                    onClose={() => setAccessOpen(false)}
                    onSaved={() => initial.bootstrap.mutate()}
                />
            )}
            {operationsOpen && channel && (
                <OperationsPanel
                    key={channel.id}
                    channelId={channel.id}
                    name={channel.name}
                    canManage={abilities.manage}
                    onClose={() => setOperationsOpen(false)}
                    onSelect={openSupport}
                />
            )}
            {capacityOpen && channel && abilities.manage && (
                <CapacitySettings
                    key={channel.id}
                    channelId={channel.id}
                    name={channel.name}
                    onClose={() => setCapacityOpen(false)}
                    onAssigned={async () => {
                        await Promise.all([list.mutate(), detail.mutate()]);
                    }}
                />
            )}
            {replyGuardOpen && channel && abilities.manage && (
                <ReplyGuardSettings
                    key={channel.id}
                    channelId={channel.id}
                    name={channel.name}
                    onClose={() => setReplyGuardOpen(false)}
                    onSaved={() => initial.bootstrap.mutate()}
                />
            )}
            {teamsOpen && channel && bootstrap && abilities.manage && (
                <TeamSettings
                    key={channel.id}
                    channel={channel}
                    bootstrap={bootstrap}
                    onClose={() => setTeamsOpen(false)}
                    onSaved={() => initial.bootstrap.mutate()}
                />
            )}
            {emailSettings && channel && abilities.manage && (
                <EmailMailboxSettings
                    key={channel.workspaceId}
                    workspaceId={channel.workspaceId}
                    onClose={() => setEmailSettings(false)}
                />
            )}
            {settings && bootstrap && canSetChannel && (
                <ChannelSettings
                    key={settings}
                    bootstrap={bootstrap}
                    channel={settings === "current" ? channel : undefined}
                    onClose={() => setSettings(null)}
                    onSaved={async (c) => {
                        await initial.bootstrap.mutate();
                        setChannel(c.id);
                        setSelected(null);
                        setSettings("current");
                    }}
                />
            )}
        </div>
    );
}
