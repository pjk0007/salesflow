"use client";

import { Badge } from "@/components/ui/badge";
import type { SendQueueRuleStats } from "../types";
import { queueBadges } from "../utils/queueStatus";

/**
 * AI 규칙 카드의 대기 배지 — "대기 12통 · 10/7(수)까지 다 나감", 3일치를 넘으면 빨간 "대기 3일치 넘음".
 * 대기가 없거나 통계를 못 읽었으면 아무것도 붙이지 않는다 (지금까지와 같은 모습).
 */
export default function RuleQueueBadges({ stats }: { stats?: SendQueueRuleStats }) {
    const badges = queueBadges(stats, new Date());
    return (
        <>
            {badges.map((b) =>
                b.tone === "warning" ? (
                    <Badge key={b.key} variant="destructive" title={b.title}>
                        {b.text}
                    </Badge>
                ) : (
                    <Badge
                        key={b.key}
                        variant="outline"
                        className="border-sky-300 bg-sky-50 text-sky-800 tabular-nums"
                        title={b.title}
                    >
                        {b.text}
                    </Badge>
                )
            )}
        </>
    );
}
