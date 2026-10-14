"use client";
import { useState } from "react";
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
import { ChannelSettings } from "./ChannelSettings";
import { ConversationPane, statusNames } from "./ConversationPane";
import type { ConversationStatus } from "../types";
import { inboxRequest } from "../api";
import { toast } from "sonner";
import { useSearchParams } from "next/navigation";
export function InboxPage({ userId, role }: { userId: string; role: string }) {
    const params = useSearchParams();
    const [chosenChannel, setChannel] = useState<number | null>(
            Number(params.get("channelId")) || null,
        ),
        [selected, setSelected] = useState<string | null>(
            params.get("conversation"),
        );
    const [status, setStatus] = useState<ConversationStatus>("open"),
        [filter, setFilter] = useState("all"),
        [query, setQuery] = useState("");
    const [settings, setSettings] = useState<"current" | "new" | null>(null),
        [extra, setExtra] = useState<import("../types").Conversation[]>([]),
        [more, setMore] = useState(true),
        [loading, setLoading] = useState(false);
    const initial = useInbox(null, null),
        bootstrap = initial.bootstrap.data;
    const channelId = chosenChannel ?? bootstrap?.channels[0]?.id ?? null;
    const { list, detail, patch } = useInbox(channelId, selected);
    const channel = bootstrap?.channels.find((c) => c.id === channelId);
    const chats = [
        ...(list.data ?? []),
        ...extra.filter((e) => !list.data?.some((c) => c.id === e.id)),
    ];
    const filtered = chats.filter(
        (c) =>
            c.status === status &&
            (filter !== "mine" || c.assigneeId === userId) &&
            (filter !== "unassigned" || !c.assigneeId) &&
            (filter !== "unread" || c.unread) &&
            (filter !== "priority" || c.priority) &&
            `${c.name} ${c.email ?? ""} ${c.preview} ${c.tags.join(" ")}`
                .toLowerCase()
                .includes(query.toLowerCase()),
    );
    const menus = [
        { id: "all", label: "전체 상담", icon: Inbox },
        { id: "unread", label: "안 읽은 메시지", icon: MessageCircle },
        { id: "mine", label: "내 상담", icon: UserRound },
        { id: "unassigned", label: "담당자 없음", icon: Archive },
        { id: "priority", label: "중요 상담", icon: Star },
    ];
    const count = (id: string) =>
        chats.filter(
            (c) =>
                c.status === status &&
                (id !== "mine" || c.assigneeId === userId) &&
                (id !== "unassigned" || !c.assigneeId) &&
                (id !== "unread" || c.unread) &&
                (id !== "priority" || c.priority),
        ).length;
    const error = initial.bootstrap.error || list.error || detail.error;
    return (
        <div className="flex h-full min-h-[600px] flex-col bg-background">
            <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b px-5">
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
                {role !== "member" && (
                    <button
                        className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs"
                        onClick={() => setSettings(channel ? "current" : "new")}
                    >
                        <Settings2 size={14} />
                        사이트 상담창
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
                        첫 고객 상담을 시작해보세요
                    </h2>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                        사이트에 상담 버튼을 설치하면 고객의 문의를 받고 답변할
                        수 있습니다.
                    </p>
                    {role !== "member" ? (
                        <button
                            className="rounded-xl bg-[#635BFF] px-5 py-3 text-sm text-white"
                            onClick={() => setSettings("new")}
                        >
                            상담창 만들기
                        </button>
                    ) : (
                        <p className="text-sm">
                            관리자에게 상담창 설정을 요청해주세요.
                        </p>
                    )}
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
                                setExtra([]);
                                setMore(true);
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
                        <div className="mt-6 border-t pt-4">
                            <p className="px-3 text-xs text-muted-foreground">
                                팀원
                            </p>
                            {bootstrap.members.map((m) => (
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
                        {role !== "member" && (
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
                                    {filtered.length}
                                </span>
                            </div>
                            <select
                                aria-label="모바일 상담 채널"
                                className="w-full rounded-lg border p-2 text-xs md:hidden"
                                value={channelId ?? ""}
                                onChange={(e) => {
                                    setChannel(Number(e.target.value));
                                    setSelected(null);
                                    setExtra([]);
                                    setMore(true);
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
                                    placeholder="이름, 이메일, 태그 검색"
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                />
                            </label>
                            <div
                                className="flex gap-1"
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
                                onChange={(e) => setFilter(e.target.value)}
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
                            {more &&
                                (list.data?.length === 100 ||
                                    extra.length > 0) && (
                                    <button
                                        disabled={loading}
                                        className="w-full py-3 text-xs text-[#635BFF]"
                                        onClick={async () => {
                                            setLoading(true);
                                            try {
                                                const rows = await inboxRequest<
                                                    import("../types").Conversation[]
                                                >(
                                                    `/api/inbox?channelId=${channelId}&before=${encodeURIComponent(chats.at(-1)!.lastMessageAt)}&beforeId=${chats.at(-1)!.id}`,
                                                );
                                                setExtra((e) => [
                                                    ...e,
                                                    ...rows,
                                                ]);
                                                setMore(rows.length === 100);
                                            } catch (e) {
                                                toast.error(
                                                    (e as Error).message,
                                                );
                                            } finally {
                                                setLoading(false);
                                            }
                                        }}
                                    >
                                        {loading
                                            ? "불러오는 중…"
                                            : "이전 상담 더 보기"}
                                    </button>
                                )}
                        </div>
                        <p className="border-t px-4 py-2 text-[10px] text-muted-foreground">
                            {channel.enabled
                                ? "사이트 상담창 켜짐"
                                : "사이트 상담창 꺼짐"}{" "}
                            · 최근 {chats.length}건에서 검색
                        </p>
                    </section>
                    {selected && detail.data ? (
                        <ConversationPane
                            userId={userId}
                            key={selected}
                            chat={detail.data.conversation}
                            messages={detail.data.messages}
                            hasOlder={detail.data.hasOlder}
                            bootstrap={bootstrap}
                            patch={async value => {
                                const updated = await patch(value);
                                setExtra(current => current.map(c => c.id === updated.id ? {...c,...updated} : c));
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
            {settings && bootstrap && (
                <ChannelSettings
                    key={settings}
                    bootstrap={bootstrap}
                    channel={settings === "current" ? channel : undefined}
                    onClose={() => setSettings(null)}
                    onSaved={async (c) => {
                        await initial.bootstrap.mutate();
                        setChannel(c.id);
                        setExtra([]);
                        setSelected(null);
                        setMore(true);
                        setSettings("current");
                    }}
                />
            )}
        </div>
    );
}
