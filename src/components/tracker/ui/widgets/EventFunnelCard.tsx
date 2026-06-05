"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Activity } from "lucide-react";
import { useTrackerFunnels } from "../../hooks/useTrackerFunnels";
import { useFunnelAnalytics } from "../../hooks/useFunnelAnalytics";
import type { SegmentFilters } from "../../types/overview";

interface Props {
    siteId: number;
    range: { from: string; to: string };
    filters: SegmentFilters;
}

const COLORS = ["#8b5cf6", "#6366f1", "#3b82f6", "#0ea5e9", "#06b6d4", "#10b981", "#84cc16", "#eab308"];

/**
 * 행동(이벤트) 퍼널 위젯 — 행동 탭.
 * 사이트의 kind='event' 퍼널 중 하나를 골라 단계별 도달/전환/이탈을 본다.
 * 카운트는 역산 미적용(각 이벤트 실제 발생자) — API의 kind 분기에서 처리됨.
 * event 퍼널이 없으면 만들기 안내(빈 상태)를 표시.
 */
export function EventFunnelCard({ siteId, range, filters }: Props) {
    const { funnels, isLoading: funnelsLoading } = useTrackerFunnels(siteId);
    const eventFunnels = useMemo(() => funnels.filter((f) => f.kind === "event"), [funnels]);

    // 사용자가 명시 선택한 id (없으면 null). 실제 사용 id는 아래 derived로 결정.
    const [pickedId, setPickedId] = useState<number | null>(null);

    // 선택한 퍼널이 유효하면 그것, 아니면 첫 event 퍼널 — effect 없이 파생.
    const selectedId =
        pickedId !== null && eventFunnels.some((f) => f.id === pickedId)
            ? pickedId
            : eventFunnels[0]?.id ?? null;

    const { data, isLoading } = useFunnelAnalytics({
        siteId,
        funnelId: selectedId,
        from: range.from,
        to: range.to,
        device: filters.device,
        channel: filters.channel,
        channelMode: filters.channelMode,
    });

    // event 퍼널 없으면 만들기 안내 (행동 탭 전용이라 숨기지 않고 빈 상태 노출)
    if (!funnelsLoading && eventFunnels.length === 0) {
        return (
            <div className="rounded-lg border bg-card p-5">
                <p className="inline-flex items-center gap-2 text-sm font-semibold">
                    <Activity className="h-4 w-4 text-violet-500" />
                    행동 퍼널
                </p>
                <p className="mt-3 rounded-md border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
                    행동 퍼널이 없습니다.{" "}
                    <Link href="?tab=settings" className="underline">퍼널 관리</Link>
                    에서 행동(이벤트) 퍼널을 만드세요.
                </p>
            </div>
        );
    }

    const stages = data?.stages ?? [];
    const max = Math.max(1, stages[0]?.visitors ?? 1);

    return (
        <div className="rounded-lg border bg-card p-5">
            <div className="mb-1 flex items-center justify-between gap-3">
                <p className="inline-flex items-center gap-2 text-sm font-semibold">
                    <Activity className="h-4 w-4 text-violet-500" />
                    행동 퍼널
                </p>
                <Select
                    value={selectedId !== null ? String(selectedId) : undefined}
                    onValueChange={(v) => setPickedId(Number(v))}
                >
                    <SelectTrigger className="h-7 w-auto min-w-40 text-xs">
                        <SelectValue placeholder="퍼널 선택" />
                    </SelectTrigger>
                    <SelectContent>
                        {eventFunnels.map((f) => (
                            <SelectItem key={f.id} value={String(f.id)} className="text-xs">
                                {f.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <p className="mb-4 text-[11px] text-muted-foreground/80">
                방문한 사람들이 각 단계 이벤트를 실제로 발생시킨 수입니다. 단계마다 실제 발생자만 카운트되며, 상위 단계로의 역산은 적용되지 않습니다.
            </p>

            {isLoading && !data ? (
                <p className="text-sm text-muted-foreground">불러오는 중...</p>
            ) : stages.length === 0 ? (
                <p className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
                    데이터가 없습니다.
                </p>
            ) : (
                <ul className="space-y-3">
                    {stages.map((s, i) => {
                        const widthPct = (s.visitors / max) * 100;
                        const prev = i === 0 ? null : stages[i - 1].visitors;
                        const conv = prev && prev > 0 ? (s.visitors / prev) * 100 : null;
                        const drop = prev && prev > 0 ? Math.round(((prev - s.visitors) / prev) * 100) : null;
                        const color = COLORS[i % COLORS.length];
                        return (
                            <li key={s.key} className="space-y-1">
                                <div className="flex items-baseline justify-between gap-3 text-sm">
                                    <div className="flex items-baseline gap-2">
                                        <span className="font-medium">{s.label}</span>
                                        {s.isAuto && (
                                            <span className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">자동</span>
                                        )}
                                    </div>
                                    <div className="flex items-baseline gap-3 tabular-nums">
                                        {conv !== null && (
                                            <span className="text-[11px] text-muted-foreground">전환 {conv.toFixed(1)}%</span>
                                        )}
                                        <span className="text-lg font-semibold">{s.visitors.toLocaleString()}</span>
                                        {drop !== null && drop > 0 && (
                                            <span className="text-[11px] text-rose-600/80">-{drop}%</span>
                                        )}
                                    </div>
                                </div>
                                <div className="h-3 w-full overflow-hidden rounded bg-muted">
                                    <div className="h-full transition-all" style={{ width: `${widthPct}%`, background: color }} />
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            <p className="mt-3 text-[11px] text-muted-foreground/70">
                단계는 <Link href="?tab=settings" className="underline">퍼널 관리</Link>에서 행동 퍼널로 정의합니다.
            </p>
        </div>
    );
}
