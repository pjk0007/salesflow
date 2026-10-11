"use client";

import { cn } from "@/lib/utils";
import { useReplyToStatus } from "../hooks/useReplyToStatus";
import { poolNoMxDomains, REPLY_SUMMARY_TEXT, replySummaryWarning } from "../utils/replyTo";

interface ReplyToSummaryRowProps {
    /** 폼에서 지금 고른 발신 묶음. 빈 배열 = 기본 발신 프로필 */
    ids: number[];
}

/**
 * 규칙 화면 오른쪽 요약 칸의 "답장" 줄 (DESIGN-3). 답장은 늘 메일을 보낸 주소로 간다 — "보낸 주소로 갑니다".
 * 묶음에 메일을 받지 않는(MX 없음) 도메인이 있으면 노란 글로 몇 곳인지 알린다 (자세한 안내는 발신 프로필 칸).
 */
export default function ReplyToSummaryRow({ ids }: ReplyToSummaryRowProps) {
    const { loaded, loadFailed, pool } = useReplyToStatus(ids);
    const warning = loaded ? replySummaryWarning(poolNoMxDomains(pool)) : null;

    return (
        <div className="flex justify-between gap-3">
            <span className="shrink-0 text-muted-foreground">답장</span>
            {loaded ? (
                <div className="min-w-0 text-right text-xs">
                    <span className={cn(warning ? "text-yellow-700 dark:text-yellow-300" : "text-muted-foreground")}>
                        {REPLY_SUMMARY_TEXT}
                    </span>
                    {warning && <p className="text-yellow-700 dark:text-yellow-300">{warning}</p>}
                </div>
            ) : (
                <span className="text-xs text-muted-foreground">{loadFailed ? "불러오지 못함" : "—"}</span>
            )}
        </div>
    );
}
