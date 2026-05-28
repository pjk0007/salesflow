"use client";

import Link from "next/link";
import type { FunnelAnalyticsData } from "../../types/funnel";

interface Props {
    data: FunnelAnalyticsData | null;
    // 안내 메시지를 띄울지 (사이트에 퍼널 정의 없을 때)
    showSetupHint?: boolean;
}

const COLORS = ["#6366f1", "#3b82f6", "#0ea5e9", "#06b6d4", "#10b981", "#84cc16", "#eab308", "#f97316"];

/**
 * 마케팅 퍼널 — 사이트의 메인 퍼널 정의대로 동적 단계 렌더.
 * 자동 단계(방문/리드) + 사용자 정의 단계. 단계 수 가변, 코드 도메인 단어 없음.
 */
export function FunnelPreview({ data, showSetupHint }: Props) {
    if (!data || data.stages.length === 0) {
        return (
            <div className="rounded-lg border bg-card p-5">
                <p className="text-sm font-semibold">마케팅 퍼널</p>
                <p className="mt-2 text-sm text-muted-foreground">데이터 없음</p>
            </div>
        );
    }
    const stages = data.stages;
    const max = Math.max(1, stages[0].visitors);

    return (
        <div className="rounded-lg border bg-card p-5">
            <div className="mb-1 flex items-baseline justify-between">
                <p className="text-sm font-semibold">마케팅 퍼널</p>
                {data.funnel.name && (
                    <span className="text-[11px] text-muted-foreground">{data.funnel.name}</span>
                )}
            </div>
            <p className="mb-4 text-[11px] text-muted-foreground">
                {stages.map((s) => s.label).join(" → ")}
            </p>
            {showSetupHint && (
                <div className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                    기본 퍼널로 표시 중. 설정 탭에서 사이트에 맞는 퍼널을 정의하면 단계별 분석이 가능합니다.
                    <Link href="?tab=settings" className="ml-2 underline">설정으로</Link>
                </div>
            )}
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
        </div>
    );
}
