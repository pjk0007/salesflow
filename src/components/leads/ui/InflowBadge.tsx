import { Globe, Mail } from "lucide-react";
import type { LeadInflow } from "../types";

/** 유입경로 칩 — 콜드메일이면 보낸 파티션 이름을 옆에 */
export function InflowBadge({ inflow }: { inflow?: LeadInflow }) {
    if (!inflow) return <span className="text-muted-foreground">-</span>;
    if (inflow.type === "cold_mail") {
        return (
            <div className="flex min-w-0 flex-wrap items-center gap-1">
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                    <Mail className="h-3 w-3" />
                    콜드메일
                </span>
                <span className="truncate text-xs text-muted-foreground" title={inflow.partitionName}>
                    {inflow.partitionName}
                </span>
            </div>
        );
    }
    if (inflow.type === "homepage") {
        return (
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-800">
                <Globe className="h-3 w-3" />
                홈페이지
            </span>
        );
    }
    return (
        <span className="inline-flex max-w-full items-center truncate rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
            {inflow.label}
        </span>
    );
}
