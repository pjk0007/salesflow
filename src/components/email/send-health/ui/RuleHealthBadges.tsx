"use client";

import { Badge } from "@/components/ui/badge";
import type { PartitionHoldRow, SenderHealthRow } from "../types";
import { autoPausedInPool } from "../utils/labels";
import HoldBadge from "./HoldBadge";

/**
 * AI 규칙 카드의 발신 건강 배지 (DESIGN-SND 10절): 그 규칙 명단이 보류면 "명단 보류", 묶음에 자동 멈춘 주소가 있으면
 * "주소 N개 멈춤", 대기열에 보류 줄이 있으면 "보류 N통". 아무것도 없으면 붙이지 않는다.
 */
export default function RuleHealthBadges({
    hold,
    poolIds,
    senders,
    heldCount,
}: {
    hold?: PartitionHoldRow;
    poolIds: readonly number[];
    senders: readonly SenderHealthRow[];
    heldCount?: number;
}) {
    const paused = autoPausedInPool(poolIds, senders);
    return (
        <>
            {hold && <HoldBadge kind="hold" reason={hold.reasonText} since={hold.heldAt} />}
            {paused > 0 && (
                <Badge
                    variant="outline"
                    className="border-orange-300 bg-orange-50 text-orange-800"
                    title="발송 실패가 많아 자동으로 멈춘 주소입니다. 이 규칙은 묶음의 남은 주소로 계속 보냅니다."
                >
                    주소 {paused}개 멈춤
                </Badge>
            )}
            {!!heldCount && heldCount > 0 && (
                <Badge variant="outline" className="border-red-200 bg-red-50/60 text-red-800 tabular-nums" title="명단 보류로 멈춘 대기 메일 (보류를 풀면 원래 순서대로 나갑니다)">
                    보류 {heldCount.toLocaleString("ko-KR")}통
                </Badge>
            )}
        </>
    );
}
