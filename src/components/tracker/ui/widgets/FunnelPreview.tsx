"use client";

interface Props {
    funnel: {
        visitors: number;
        leads: number;
        signups: number;
        paid: number | null;
        conversionStageLabel: string | null;
    };
}

/**
 * 마케팅 퍼널 — 방문자 → 리드 → 가입 → 결제(전환완료).
 * "결제" 단계는 site.conversionStage가 설정된 경우에만 표시.
 * Phase 2의 사용자 정의 다단계 퍼널과는 별개의 KPI 시각화.
 */
export function FunnelPreview({ funnel }: Props) {
    const stages: Array<{ key: string; label: string; sub?: string; value: number; color: string }> = [
        { key: "visitors", label: "방문자", sub: "사이트 진입", value: funnel.visitors, color: "#6366f1" },
        { key: "leads", label: "리드", sub: "CRM 연결", value: funnel.leads, color: "#3b82f6" },
        { key: "signups", label: "가입", sub: "회원가입 완료", value: funnel.signups, color: "#0ea5e9" },
    ];
    if (funnel.paid !== null) {
        stages.push({
            key: "paid",
            label: funnel.conversionStageLabel ?? "전환",
            sub: "전환 완료",
            value: funnel.paid,
            color: "#10b981",
        });
    }
    const max = Math.max(1, stages[0].value);

    return (
        <div className="rounded-lg border bg-card p-5">
            <p className="text-sm font-semibold">마케팅 퍼널</p>
            <p className="mb-4 text-[11px] text-muted-foreground">
                방문자 → 리드 → 가입{funnel.paid !== null ? ` → ${funnel.conversionStageLabel}` : ""}
            </p>
            <ul className="space-y-3">
                {stages.map((s, i) => {
                    const widthPct = (s.value / max) * 100;
                    const prev = i === 0 ? null : stages[i - 1].value;
                    const conv = prev && prev > 0 ? (s.value / prev) * 100 : null;
                    const drop = prev && prev > 0 ? Math.round(((prev - s.value) / prev) * 100) : null;
                    return (
                        <li key={s.key} className="space-y-1">
                            <div className="flex items-baseline justify-between gap-3 text-sm">
                                <div className="flex items-baseline gap-2">
                                    <span className="font-medium">{s.label}</span>
                                    {s.sub && <span className="text-[11px] text-muted-foreground">{s.sub}</span>}
                                </div>
                                <div className="flex items-baseline gap-3 tabular-nums">
                                    {conv !== null && (
                                        <span className="text-[11px] text-muted-foreground">
                                            전환 {conv.toFixed(1)}%
                                        </span>
                                    )}
                                    <span className="text-lg font-semibold">{s.value.toLocaleString()}</span>
                                    {drop !== null && (
                                        <span className="text-[11px] text-rose-600/80">-{drop}%</span>
                                    )}
                                </div>
                            </div>
                            <div className="h-3 w-full overflow-hidden rounded bg-muted">
                                <div
                                    className="h-full transition-all"
                                    style={{ width: `${widthPct}%`, background: s.color }}
                                />
                            </div>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
