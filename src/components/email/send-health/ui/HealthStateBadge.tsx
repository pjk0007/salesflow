"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { stateLabel, stateTone } from "../utils/labels";

/**
 * 정상 / 주의 / 위험 / 판정 보류 / 회복 배지 (DESIGN-SND 10절). 숫자(확정·실패·비율·기준·창 시작)는 툴팁에.
 * 판정 전(상태 없음)이면 아무것도 붙이지 않는다.
 */
export default function HealthStateBadge({
    state,
    recovered = false,
    tooltip,
    prefix,
    className,
}: {
    state: string | null | undefined;
    recovered?: boolean;
    tooltip?: string;
    /** 배지 앞 글 (예: "발송 건강 ") */
    prefix?: string;
    className?: string;
}) {
    if (!state) return null;
    return (
        <Badge variant="outline" className={cn("tabular-nums", stateTone(state, recovered), className)} title={tooltip}>
            {prefix}
            {stateLabel(state, recovered)}
        </Badge>
    );
}
