"use client";

import Link from "next/link";
import { AlertTriangle, ChevronRight, Hourglass } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAutoPersonalizedEmail } from "@/hooks/useAutoPersonalizedEmail";
import { useSendQueueStats } from "../hooks/useSendQueueStats";
import { BACKLOG_WARNING_DAYS, warnedRuleRows } from "../utils/queueStatus";

/**
 * 메일 대시보드의 발송 대기열 카드 — 대기 합계와, 대기가 하루 용량의 3일치를 넘은 규칙 목록. 보류(AI 한도·꺼진 규칙)와
 * 접수 결과 확인이 필요한 줄도 함께 알린다 (UX-194·228·259).
 * 대기·보류·확인 필요가 모두 없거나 통계를 못 읽었으면 카드를 보이지 않는다.
 */
export default function SendQueueOverviewCard() {
    const { stats } = useSendQueueStats();
    const warnings = stats?.totals.warnings ?? 0;
    // 경고 규칙이 있을 때만 이름을 찾으러 규칙 목록을 읽는다 (AI 규칙 탭·발송 이력과 같은 SWR 키)
    const { links } = useAutoPersonalizedEmail(warnings > 0 ? "all" : null);

    const heldQuota = stats?.totals.heldQuota ?? 0;
    const heldRulesInactive = stats?.totals.heldRulesInactive ?? 0;
    const needsCheck = stats?.totals.needsCheck ?? 0;
    if (!stats || (stats.totals.pending <= 0 && heldQuota + heldRulesInactive + needsCheck <= 0)) return null;
    const rows = warnedRuleRows(stats.rules, links, new Date());
    const ruleCount = stats.rules.filter((r) => r.pending.total > 0).length;

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base">발송 대기열</CardTitle>
                <Hourglass className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
                <p>
                    대기 합계 <span className="font-semibold tabular-nums">{stats.totals.pending.toLocaleString()}통</span>
                    <span className="text-muted-foreground"> · 규칙 {ruleCount}개</span>
                    {warnings > 0 ? (
                        <span className="text-destructive"> · {BACKLOG_WARNING_DAYS}일치 넘은 규칙 {warnings}개</span>
                    ) : (
                        <span className="text-muted-foreground"> · 모두 {BACKLOG_WARNING_DAYS}일 안에 나갑니다</span>
                    )}
                </p>
                {rows.length > 0 && (
                    <ul className="divide-y rounded-md border">
                        {rows.map((r) => (
                            <li key={r.linkId}>
                                <Link
                                    href={`/email/ai-auto/${r.linkId}?partitionId=${r.partitionId}`}
                                    className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50"
                                >
                                    <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
                                    <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                        대기 {r.pending.toLocaleString()}통{r.backlog ? ` · ${r.backlog}` : ""} · {r.eta}
                                    </span>
                                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
                {(heldQuota > 0 || heldRulesInactive > 0 || needsCheck > 0) && (
                    <ul className="space-y-1 text-xs">
                        {heldQuota > 0 && (
                            <li className="text-destructive">
                                AI 사용량 한도로 보류 {heldQuota.toLocaleString()}통 — 한도가 풀리면(다음 달·플랜 상향) 원래 순서대로 이어서 나갑니다.
                            </li>
                        )}
                        {heldRulesInactive > 0 && (
                            <li className="text-muted-foreground">
                                꺼진 규칙의 대기 {heldRulesInactive.toLocaleString()}통 보류 중 — 규칙을 다시 켜면 이어서 나갑니다.
                            </li>
                        )}
                        {needsCheck > 0 && (
                            <li className="text-destructive">
                                처리 중 멈춰 접수 결과 확인이 필요한 메일 {needsCheck.toLocaleString()}통 — 중복 발송을 막으려고 자동으로 다시 보내지 않았습니다. 발송 이력에서 결과를 확인해주세요.
                            </li>
                        )}
                    </ul>
                )}
                {warnings > 0 && (
                    <p className="text-xs text-muted-foreground">
                        발신 주소를 늘리거나 주소별 하루 한도를 올리면 빨리 나갑니다. 예상은 지금 쌓인 양만 센 것입니다.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
