"use client";

import { AlertTriangle } from "lucide-react";
import { usePoolCapacity } from "../hooks/usePoolCapacity";
import { useSendQueueStats } from "../hooks/useSendQueueStats";
import { poolCapacityShort } from "../utils/poolCapacity";
import { queueSummary } from "../utils/queueStatus";

interface RuleQueueSummaryProps {
    /** 폼에서 지금 고른 발신 주소 묶음 (저장 전일 수 있다). 빈 배열 = 기본 발신 프로필 */
    ids: number[];
    /** 저장된 규칙 id. 새 규칙이면 없음 — 대기 줄을 보이지 않는다 */
    linkId?: number;
    /** 저장된 묶음. 폼에서 바꿨으면 대기·예상 소진일이 저장된 묶음 기준이라고 알린다 */
    savedIds?: number[];
}

function sameIds(a: readonly number[], b: readonly number[]): boolean {
    return a.length === b.length && a.every((id, i) => id === b[i]);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex justify-between gap-3">
            <span className="shrink-0 text-muted-foreground">{label}</span>
            <div className="min-w-0 text-right">{children}</div>
        </div>
    );
}

/**
 * 규칙 화면 오른쪽 요약 칸의 발송 용량·대기 줄 — 오늘 이 묶음으로 몇 통까지 나가는지, 쌓인 대기와 다 나가는 날, 3일치 경고.
 * 오늘 용량은 폼에서 고른 묶음으로 바로 다시 센다. 대기·예상 소진일은 서버가 저장된 묶음으로 센 값이다.
 */
export default function RuleQueueSummary({ ids, linkId, savedIds }: RuleQueueSummaryProps) {
    const { capacity } = usePoolCapacity(ids);
    const { byLinkId, loaded, loadFailed } = useSendQueueStats(linkId !== undefined);

    const stats = linkId !== undefined ? byLinkId.get(linkId) : undefined;
    const summary = queueSummary(stats, new Date());
    const poolChanged = savedIds !== undefined && !sameIds(ids, savedIds);

    return (
        <>
            <Row label="오늘 용량">
                <span className="text-xs font-medium tabular-nums">{poolCapacityShort(capacity)}</span>
            </Row>
            {linkId !== undefined && (
                <>
                    <Row label="대기">
                        {loaded ? (
                            <>
                                <span className="font-medium tabular-nums">{summary.pending}</span>
                                {summary.breakdown && (
                                    <p className="text-xs text-muted-foreground tabular-nums">{summary.breakdown}</p>
                                )}
                            </>
                        ) : (
                            <span className="text-xs text-muted-foreground">{loadFailed ? "불러오지 못함" : "—"}</span>
                        )}
                    </Row>
                    {summary.eta && (
                        <Row label="예상 소진">
                            <span className="font-medium">{summary.eta}</span>
                        </Row>
                    )}
                    {summary.warning && (
                        <p className="flex gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            {summary.warning}
                        </p>
                    )}
                    {poolChanged && summary.eta && (
                        <p className="text-xs text-muted-foreground">대기·예상 소진일은 저장된 발신 묶음 기준입니다.</p>
                    )}
                </>
            )}
        </>
    );
}
