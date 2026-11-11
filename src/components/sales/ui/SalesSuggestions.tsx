"use client";

import { useState } from "react";
import useSWR from "swr";
import { CalendarHeart, Check, Copy, Hourglass, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useSession } from "@/contexts/SessionContext";
import { defaultFetcher } from "@/lib/swr-fetcher";
import { cn } from "@/lib/utils";
import { MemberAvatar } from "./MemberAvatar";

interface Suggestion {
    id: number;
    recordId: number;
    content: string;
    ownerId: string | null;
    ownerName: string | null;
    dueAt: string | null;
    ruleKey: string | null;
    reason: string | null;
    draft: string | null;
    company: string;
    personName: string;
    personTitle: string;
}
type Rules = { dormant: { enabled: boolean; days: number }; holiday: { enabled: boolean; daysBefore: number } };

const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
const post = (url: string, body?: unknown, method = "POST") =>
    fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());

/** 규칙 이름표 */
function RuleBadge({ ruleKey }: { ruleKey: string | null }) {
    const holiday = ruleKey?.startsWith("holiday");
    return (
        <span className={cn("inline-flex shrink-0 items-center gap-1 rounded px-1.5 text-[11px] leading-5", holiday ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800")}>
            {holiday ? <CalendarHeart className="h-3 w-3" /> : <Hourglass className="h-3 w-3" />}
            {holiday ? "명절 인사" : "오래 연락 안 함"}
        </span>
    );
}

function SuggestionRow({ s, onDone, onOpen }: { s: Suggestion; onDone: () => void; onOpen: () => void }) {
    const [draft, setDraft] = useState(s.draft);
    const [drafting, setDrafting] = useState(false);
    const [busy, setBusy] = useState(false);

    const act = async (action: "accept" | "dismiss") => {
        setBusy(true);
        const r = await post(`/api/sales/suggestions/${s.id}`, { action });
        setBusy(false);
        if (!r.success) {
            toast.error(r.error || "처리하지 못했습니다.");
            return;
        }
        toast.success(action === "accept" ? "할 일로 추가했어요." : "건너뛰었어요.");
        onDone();
    };
    const makeDraft = async () => {
        setDrafting(true);
        const r = await post(`/api/sales/suggestions/${s.id}/draft`);
        setDrafting(false);
        if (!r.success) {
            toast.error(r.error || "문구를 만들지 못했습니다.");
            return;
        }
        setDraft(r.data.draft);
    };

    return (
        <li className="border-b border-border/40 px-4 py-3 last:border-b-0">
            <div className="flex items-start gap-3">
                <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2">
                        <RuleBadge ruleKey={s.ruleKey} />
                        <span className="truncate text-sm font-medium">{s.content}</span>
                        {s.dueAt && <span className="shrink-0 text-xs text-muted-foreground">~{kst(s.dueAt).slice(5).replace("-", "/")}</span>}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {s.company || "(기업명 없음)"}
                        {s.personName && ` · ${[s.personName, s.personTitle].filter(Boolean).join(" · ")}`}
                        {s.reason && ` — ${s.reason}`}
                    </div>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                    <Button size="xs" variant="ghost" disabled={drafting} onClick={draft ? () => setDraft(null) : makeDraft}>
                        {drafting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
                        {draft ? "문구 닫기" : "AI 문구"}
                    </Button>
                    <Button size="xs" variant="ghost" className="text-muted-foreground" disabled={busy} onClick={() => act("dismiss")}>
                        <X className="mr-1 h-3 w-3" />
                        건너뛰기
                    </Button>
                    <Button size="xs" disabled={busy} onClick={() => act("accept")}>
                        <Check className="mr-1 h-3 w-3" />
                        할 일로 추가
                    </Button>
                </div>
            </div>
            {draft && (
                <div className="mt-2 rounded-md bg-muted/40 p-3">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{draft}</p>
                    <div className="mt-2 flex justify-end gap-1">
                        <Button size="xs" variant="ghost" disabled={drafting} onClick={makeDraft}>
                            <RefreshCw className="mr-1 h-3 w-3" />
                            다시 쓰기
                        </Button>
                        <Button
                            size="xs"
                            variant="ghost"
                            onClick={async () => {
                                await navigator.clipboard.writeText(draft);
                                toast.success("문구를 복사했어요.");
                            }}
                        >
                            <Copy className="mr-1 h-3 w-3" />
                            복사
                        </Button>
                    </div>
                </div>
            )}
        </li>
    );
}

/** 규칙 설정 줄 — 관리자만 바꿀 수 있다 */
function RulesBar({ onSaved }: { onSaved: () => void }) {
    const { user } = useSession();
    const admin = user?.role !== "member";
    const { data, mutate } = useSWR<{ success: boolean; data: Rules }>("/api/sales/rules", defaultFetcher);
    const rules = data?.data;
    const save = async (kind: "dormant" | "holiday", body: Record<string, unknown>) => {
        const r = await post("/api/sales/rules", { kind, ...body }, "PUT");
        if (!r.success) {
            toast.error(r.error || "저장하지 못했습니다.");
            return;
        }
        mutate();
        onSaved();
    };
    if (!rules) return null;
    return (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b px-4 py-2.5 text-sm">
            <span className="text-xs font-semibold text-muted-foreground">추천 규칙</span>
            <label className="flex items-center gap-2">
                <Switch disabled={!admin} checked={rules.dormant.enabled} onCheckedChange={(v) => save("dormant", { enabled: v, days: rules.dormant.days })} />
                마지막 연락 후
                <Input
                    key={`d${rules.dormant.days}`}
                    disabled={!admin}
                    defaultValue={rules.dormant.days}
                    onBlur={(e) => Number(e.target.value) !== rules.dormant.days && save("dormant", { enabled: rules.dormant.enabled, days: Number(e.target.value) })}
                    className="h-8 w-16 text-center"
                />
                일 지나면 안부 연락
            </label>
            <label className="flex items-center gap-2">
                <Switch disabled={!admin} checked={rules.holiday.enabled} onCheckedChange={(v) => save("holiday", { enabled: v, daysBefore: rules.holiday.daysBefore })} />
                설·추석
                <Input
                    key={`h${rules.holiday.daysBefore}`}
                    disabled={!admin}
                    defaultValue={rules.holiday.daysBefore}
                    onBlur={(e) =>
                        Number(e.target.value) !== rules.holiday.daysBefore && save("holiday", { enabled: rules.holiday.enabled, daysBefore: Number(e.target.value) })
                    }
                    className="h-8 w-16 text-center"
                />
                일 전부터 인사
            </label>
            {!admin && <span className="text-xs text-muted-foreground">규칙은 관리자만 바꿀 수 있어요.</span>}
        </div>
    );
}

/** 영업ToDo "추천" — 규칙이 찾은 연락 기회를 담당자별로 보여주고, 사람이 할 일로 확정한다 */
export function SalesSuggestions({ mineOnly, onOpenLead, onChanged }: { mineOnly: boolean; onOpenLead: (recordId: number) => void; onChanged: () => void }) {
    const { user } = useSession();
    const { data, isLoading, mutate } = useSWR<{ success: boolean; data: Suggestion[] }>("/api/sales/suggestions?refresh=1", defaultFetcher, {
        revalidateOnFocus: false,
    });
    const list = (data?.data ?? []).filter((s) => !mineOnly || s.ownerId === user?.id);
    const groups = new Map<string, { ownerId: string | null; ownerName: string; items: Suggestion[] }>();
    for (const s of list) {
        const key = s.ownerId ?? "__none__";
        const g = groups.get(key) ?? { ownerId: s.ownerId, ownerName: s.ownerName ?? "담당자 없음", items: [] };
        g.items.push(s);
        groups.set(key, g);
    }
    const sorted = [...groups.values()].sort((a, b) =>
        a.ownerId === user?.id ? -1 : b.ownerId === user?.id ? 1 : !a.ownerId ? 1 : !b.ownerId ? -1 : a.ownerName.localeCompare(b.ownerName, "ko"),
    );
    const refresh = () => {
        mutate();
        onChanged();
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <RulesBar onSaved={() => mutate()} />
            <div className="min-h-0 flex-1 overflow-y-auto">
                {isLoading ? (
                    <p className="p-6 text-sm text-muted-foreground">규칙을 확인하는 중…</p>
                ) : sorted.length === 0 ? (
                    <p className="py-16 text-center text-sm text-muted-foreground">지금은 추천할 연락이 없어요.</p>
                ) : (
                    sorted.map((g) => (
                        <section key={g.ownerId ?? "none"} className="border-b">
                            <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2 text-sm">
                                {g.ownerId ? <MemberAvatar name={g.ownerName} className="size-4" /> : null}
                                <span className="font-medium">
                                    {g.ownerName}
                                    {g.ownerId === user?.id && <span className="ml-1 text-xs text-muted-foreground">(나)</span>}
                                </span>
                                <span className="text-muted-foreground">{g.items.length}건</span>
                            </div>
                            <ul>
                                {g.items.map((s) => (
                                    <SuggestionRow key={s.id} s={s} onDone={refresh} onOpen={() => onOpenLead(s.recordId)} />
                                ))}
                            </ul>
                        </section>
                    ))
                )}
            </div>
        </div>
    );
}
