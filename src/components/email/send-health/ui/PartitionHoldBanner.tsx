"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePartitionHolds } from "../hooks/useSendHealth";
import type { ReleaseTarget } from "../types";
import { holdLine } from "../utils/labels";
import ReleaseDialog from "./ReleaseDialog";

/**
 * 명단 레코드 화면 머리의 보류 띠 (DESIGN-SND 10절). 보류 중이면 "발송 실패가 많아 이 명단의 대량 발송을 잠시 멈췄습니다" + 풀기(관리자).
 */
export default function PartitionHoldBanner({ partitionId }: { partitionId: number | null }) {
    const { byPartition, isAdmin, releaseHold } = usePartitionHolds(partitionId !== null);
    const [target, setTarget] = useState<ReleaseTarget | null>(null);
    const hold = partitionId !== null ? byPartition.get(partitionId) : undefined;
    if (!hold) return null;
    return (
        <div className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-900 dark:bg-red-950/40 dark:text-red-100">
            <ShieldAlert className="size-4 shrink-0" />
            <p className="min-w-0 flex-1">
                발송 실패가 많아 이 명단의 대량 발송을 잠시 멈췄습니다 (폼·광고 문의 메일은 그대로 나갑니다).
                <span className="ml-1 text-xs opacity-80">
                    {holdLine(hold)} · 대기 {hold.queued.toLocaleString("ko-KR")}통
                </span>
            </p>
            {isAdmin && (
                <Button size="sm" variant="outline" onClick={() => setTarget({ kind: "hold", holdId: hold.id, name: hold.partitionName, queued: hold.queued })}>
                    풀기
                </Button>
            )}
            <ReleaseDialog target={target} onClose={() => setTarget(null)} onConfirm={(t, note) => releaseHold(t.kind === "hold" ? t.holdId : 0, note)} />
        </div>
    );
}
