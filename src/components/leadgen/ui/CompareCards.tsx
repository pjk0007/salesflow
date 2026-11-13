"use client";

import { InfoTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";
import { GROUPS, type CompareCardData } from "../utils/groups";

/** 비교 카드 묶음 — 묶음(메일·기간) A·B·C별 값, 가장 나은 값은 굵게, 아래에 1·2위 차이 (리드젠통계·리드통계 공통) */
export function CompareCards({ cards, className }: { cards: CompareCardData[]; className?: string }) {
    return (
        <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>
            {cards.map((c) => (
                <section key={c.key} className="rounded-lg border border-border/40 bg-card p-5">
                    <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-foreground/80">
                        {c.label}
                        {c.tooltip && <InfoTip text={c.tooltip} />}
                    </h2>
                    <div className="space-y-1.5">
                        {c.rows.map((r) => (
                            <div key={r.group} className="flex items-baseline justify-between gap-2">
                                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <span className="size-2 shrink-0 rounded-full" style={{ background: GROUPS[r.group].color }} />
                                    {GROUPS[r.group].letter}
                                </span>
                                <span className={cn("text-xl tracking-tight tabular-nums", r.best ? "font-semibold" : "text-foreground/70")}>{r.value}</span>
                            </div>
                        ))}
                    </div>
                    {c.diffText && <p className="mt-2 text-xs text-muted-foreground">{c.diffText}</p>}
                </section>
            ))}
        </div>
    );
}
