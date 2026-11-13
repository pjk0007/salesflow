"use client";

import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { Switch } from "@/components/ui/switch";
import { useSession } from "@/contexts/SessionContext";
import { defaultFetcher } from "@/lib/swr-fetcher";
import { cn } from "@/lib/utils";
import { updateActionItem } from "../api";
import { MemberAvatar } from "./MemberAvatar";
import { OwnerSelect } from "./OwnerSelect";
import { InlineEdit } from "./InlineEdit";
import { SalesLeadPanel } from "./SalesLeadPanel";
import { SalesSuggestions } from "./SalesSuggestions";

interface Todo {
    id: number;
    recordId: number;
    content: string;
    ownerId: string | null;
    ownerName: string | null;
    dueAt: string | null;
    doneAt: string | null;
    company: string;
    personName: string;
    personTitle: string;
}

const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
const todayKst = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

/** 할 일 한 줄 — 체크로 완료, 기한·담당 바로 바꾸기 */
function TodoRow({ todo, onChanged, onOpen }: { todo: Todo; onChanged: () => void; onOpen: () => void }) {
    const due = todo.dueAt ? kst(todo.dueAt) : "";
    const today = todayKst();
    const overdue = !todo.doneAt && due && due < today;
    const isToday = !todo.doneAt && due === today;
    const patch = async (input: Parameters<typeof updateActionItem>[1]) => {
        const r = await updateActionItem(todo.id, input);
        if (!r.success) toast.error(r.error || "저장하지 못했습니다.");
        onChanged();
    };
    // 고치는 칸(체크·내용 글자·담당·기한) 바깥은 어디를 눌러도 리드 상세 패널이 열린다.
    // 드롭다운·달력은 화면 위 다른 층에 떠도 React에서는 이 줄 안이라 클릭이 줄까지 올라오지 않게 막는다.
    const stop = (e: React.MouseEvent) => e.stopPropagation();
    return (
        <li onClick={onOpen} className="flex cursor-pointer items-center gap-3 border-b border-border/40 px-4 py-2.5 last:border-b-0 hover:bg-muted/40">
            <span onClick={stop} className="flex">
                <Checkbox checked={!!todo.doneAt} onCheckedChange={(v) => patch({ done: v === true })} aria-label="완료" />
            </span>
            <div className="min-w-0 flex-1">
                {/* 할 일 글자만 눌러서 고친다 */}
                {/* 줄 전체 너비 칸이지만, 글자(또는 고치는 입력칸)를 누를 때만 막고 빈 곳은 패널을 연다 */}
                <span onClick={(e) => e.target !== e.currentTarget && e.stopPropagation()} className="flex">
                    <InlineEdit
                        value={todo.content}
                        onSave={async (v) => {
                            if (v) await patch({ content: v });
                            else toast.error("할 일을 입력해주세요.");
                        }}
                        className={cn("-ml-2 min-h-0 py-0.5", todo.doneAt && "text-muted-foreground line-through")}
                        triggerClassName="w-auto max-w-full"
                    />
                </span>
                <div className="truncate text-xs text-muted-foreground">
                    {todo.company || "(기업명 없음)"}
                    {todo.personName && ` · ${[todo.personName, todo.personTitle].filter(Boolean).join(" · ")}`}
                </div>
            </div>
            <span onClick={stop} className="flex shrink-0 items-center gap-3">
                <OwnerSelect value={todo.ownerId} onChange={(id) => patch({ ownerId: id })} className="w-28 shrink-0" />
                <DatePicker
                    value={due}
                    onChange={(v) => patch({ dueDate: v || null })}
                    placeholder="기한"
                    clearable
                    compact
                    align="end"
                    triggerClassName={cn(
                        "h-7 w-28 shrink-0 gap-1.5 border-0 px-2 text-xs shadow-none hover:bg-muted",
                        overdue && "text-rose-600",
                        isToday && "font-semibold text-amber-600",
                    )}
                />
            </span>
        </li>
    );
}

/** 영업ToDo — 기업별 다음 할 일(액션플랜)을 담당자별로 모아 본다. 내 것이 맨 위 */
export function SalesTodoPage() {
    const { user } = useSession();
    const [mineOnly, setMineOnly] = useState(false);
    const [includeDone, setIncludeDone] = useState(false);
    const [openRecordId, setOpenRecordId] = useState<number | null>(null);
    const [view, setView] = useState<"todo" | "suggest">("todo");
    // 추천 개수 칩 (추천 탭을 열 때 규칙을 다시 돌린다)
    const { data: suggestData, mutate: mutateSuggest } = useSWR<{ success: boolean; data: unknown[] }>(
        "/api/sales/suggestions?refresh=1",
        defaultFetcher,
        {
            revalidateOnFocus: false,
        },
    );
    const suggestCount = suggestData?.data?.length ?? 0;
    const closePanel = useCallback(() => setOpenRecordId(null), []);
    const { data, isLoading, mutate } = useSWR<{ success: boolean; data: Todo[] }>(
        `/api/sales/todos${includeDone ? "?done=1" : ""}`,
        defaultFetcher,
    );
    const todos = useMemo(() => data?.data ?? [], [data]);

    // 담당자별 묶음 — 나 → 이름순 → 담당자 없음
    const groups = useMemo(() => {
        const map = new Map<string, { ownerId: string | null; ownerName: string; items: Todo[] }>();
        for (const t of todos) {
            if (mineOnly && t.ownerId !== user?.id) continue;
            const key = t.ownerId ?? "__none__";
            const g = map.get(key) ?? { ownerId: t.ownerId, ownerName: t.ownerName ?? "담당자 없음", items: [] };
            g.items.push(t);
            map.set(key, g);
        }
        return [...map.values()].sort((a, b) => {
            if (a.ownerId === user?.id) return -1;
            if (b.ownerId === user?.id) return 1;
            if (!a.ownerId) return 1;
            if (!b.ownerId) return -1;
            return a.ownerName.localeCompare(b.ownerName, "ko");
        });
    }, [todos, mineOnly, user?.id]);

    const today = todayKst();
    const countOverdue = (items: Todo[]) => items.filter((t) => !t.doneAt && t.dueAt && kst(t.dueAt) < today).length;

    return (
        <WorkspaceLayout>
            <div className="flex h-[calc(100vh-3.5rem)] flex-col">
                {/* 위쪽: [할 일 | 추천] 탭 + [전체 | 내 것] */}
                <div className="flex h-12 shrink-0 items-stretch justify-between gap-3 border-b px-4">
                    <div className="-mb-px flex gap-1">
                        {(
                            [
                                ["todo", "할 일"],
                                ["suggest", "추천"],
                            ] as const
                        ).map(([v, label]) => (
                            <button
                                key={v}
                                type="button"
                                onClick={() => setView(v)}
                                className={cn(
                                    "flex items-center gap-1.5 border-b-2 px-3 text-sm transition-colors",
                                    view === v
                                        ? "border-primary font-semibold text-foreground"
                                        : "border-transparent text-muted-foreground hover:text-foreground",
                                )}
                            >
                                {label}
                                {v === "suggest" && suggestCount > 0 && (
                                    <span className="rounded-full bg-rose-600 px-1.5 text-[10px] leading-4 text-white">{suggestCount}</span>
                                )}
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1 rounded-md bg-muted p-1">
                            {(
                                [
                                    [false, "전체"],
                                    [true, view === "suggest" ? "내 것만" : "내 할 일"],
                                ] as const
                            ).map(([v, label]) => (
                                <button
                                    key={label}
                                    type="button"
                                    onClick={() => setMineOnly(v)}
                                    className={cn(
                                        "flex h-7 items-center rounded px-3 text-xs transition-colors",
                                        mineOnly === v
                                            ? "bg-background font-semibold text-foreground"
                                            : "text-muted-foreground hover:text-foreground",
                                    )}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        {view === "todo" && (
                            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                                완료한 할 일 보기
                                <Switch checked={includeDone} onCheckedChange={setIncludeDone} />
                            </label>
                        )}
                    </div>
                </div>

                {view === "suggest" ? (
                    <SalesSuggestions
                        mineOnly={mineOnly}
                        onOpenLead={setOpenRecordId}
                        onChanged={() => {
                            mutate();
                            mutateSuggest();
                        }}
                    />
                ) : (
                    <div className="min-h-0 flex-1 overflow-y-auto">
                        {isLoading ? (
                            <p className="p-6 text-sm text-muted-foreground">불러오는 중…</p>
                        ) : groups.length === 0 ? (
                            <p className="py-16 text-center text-sm text-muted-foreground">
                                할 일이 없어요. 영업고객의 미팅 기록에서 액션플랜을 만들면 여기에 모여요.
                            </p>
                        ) : (
                            groups.map((g) => {
                                const overdue = countOverdue(g.items);
                                return (
                                    <section key={g.ownerId ?? "none"} className="border-b">
                                        <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2 text-sm">
                                            {g.ownerId ? <MemberAvatar name={g.ownerName} className="size-4" /> : null}
                                            <span className="font-medium">
                                                {g.ownerName}
                                                {g.ownerId === user?.id && <span className="ml-1 text-xs text-muted-foreground">(나)</span>}
                                            </span>
                                            <span className="text-muted-foreground">{g.items.length}건</span>
                                            {overdue > 0 && (
                                                <span className="rounded bg-rose-100 px-1.5 text-[11px] text-rose-700">
                                                    기한 지남 {overdue}
                                                </span>
                                            )}
                                        </div>
                                        <ul>
                                            {g.items.map((t) => (
                                                <TodoRow
                                                    key={t.id}
                                                    todo={t}
                                                    onChanged={() => mutate()}
                                                    onOpen={() => setOpenRecordId(t.recordId)}
                                                />
                                            ))}
                                        </ul>
                                    </section>
                                );
                            })
                        )}
                    </div>
                )}
            </div>
            {openRecordId && <SalesLeadPanel recordId={openRecordId} onClose={closePanel} onChanged={() => mutate()} />}
        </WorkspaceLayout>
    );
}
