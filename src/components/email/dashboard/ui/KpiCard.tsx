import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { KpiCardModel } from "../utils/kpiCards";
export function KpiCard({ card }: { card: KpiCardModel }) {
    return <Card title={card.tooltip}>
        <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{card.label}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
            <p className={card.connection ? "text-sm text-muted-foreground" : "text-2xl font-semibold tabular-nums"}>{card.value}</p>
            <p className="text-xs text-muted-foreground">{card.sub}</p>
            <p className={`text-xs ${card.color}`} title={card.deltaTooltip}>{card.delta}</p>
        </CardContent>
    </Card>;
}
