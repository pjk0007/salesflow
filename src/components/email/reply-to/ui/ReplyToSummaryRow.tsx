"use client";

import { cn } from "@/lib/utils";
import { useReplyToStatus } from "../hooks/useReplyToStatus";
import { poolReplyNotice, replyToSummary } from "../utils/replyTo";

interface ReplyToSummaryRowProps {
    /** 규칙의 파티션 — 그 워크스페이스의 답장 받을 주소를 보인다 */
    partitionId: number | null | undefined;
    /** 폼에서 지금 고른 발신 묶음. 빈 배열 = 기본 발신 프로필 */
    ids: number[];
}

/**
 * 규칙 화면 오른쪽 요약 칸의 "답장" 줄 (DESIGN-3 3절). 워크스페이스 답장 받을 주소, 없으면 "없음 — 답장이 발신 주소로 갑니다".
 * 답장이 되돌아갈 때는 노란 글로 보인다 — 주소가 없는데 묶음에 메일을 받지 않는 도메인이 있거나(자세한 안내는 발신 묶음 칸),
 * 답장 받을 주소의 도메인 자체가 메일을 받지 않을 때.
 */
export default function ReplyToSummaryRow({ partitionId, ids }: ReplyToSummaryRowProps) {
    const { loaded, loadFailed, replyToEmail, replyToMx, pool } = useReplyToStatus(partitionId, ids);
    if (!partitionId) return null;

    const summary = replyToSummary(replyToEmail);
    const replyToUnreachable = summary.isSet && replyToMx === "none";
    const unreachable = replyToUnreachable || (loaded && poolReplyNotice(replyToEmail, pool) !== null);

    return (
        <div className="flex justify-between gap-3">
            <span className="shrink-0 text-muted-foreground">답장</span>
            {loaded ? (
                <div className="min-w-0 text-right text-xs">
                    <span
                        className={cn(
                            summary.isSet ? "break-all font-medium" : "text-muted-foreground",
                            unreachable && "text-yellow-700 dark:text-yellow-300"
                        )}
                    >
                        {summary.text}
                    </span>
                    {replyToUnreachable && (
                        <p className="text-yellow-700 dark:text-yellow-300">메일을 받지 않는 도메인입니다</p>
                    )}
                </div>
            ) : (
                <span className="text-xs text-muted-foreground">{loadFailed ? "불러오지 못함" : "—"}</span>
            )}
        </div>
    );
}
