import { InfoTip } from "@/components/ui/info-tip";
import type { KpiCardModel } from "../utils/kpiCards";

/** 핵심 지표 카드 — 리드통계 카드와 같은 모양, 설명은 i 아이콘 툴팁 */
export function KpiCard({ card }: { card: KpiCardModel }) {
    return (
        <section className="rounded-lg border border-border/40 bg-card p-5">
            <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-foreground/80">
                {card.label}
                <InfoTip text={card.tooltip} />
            </h2>
            <p className={card.connection ? "text-sm text-muted-foreground" : "text-3xl font-semibold tracking-tight tabular-nums"}>{card.value}</p>
            {card.sub && <p className="mt-1 text-xs text-muted-foreground">{card.sub}</p>}
            {card.delta && (
                <InfoTip text={card.deltaTooltip} className={`mt-1 inline-block text-xs ${card.color}`}>
                    {card.delta}
                </InfoTip>
            )}
        </section>
    );
}
