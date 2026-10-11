"use client";

import { MessageSquareReply } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useReplyStats } from "../hooks/useReplyStats";

/**
 * 규칙 카드·목록의 "회신 3 · 28일" 배지 (DESIGN-RPL 11절 3번). 사람 회신 수를 보이고, 툴팁에 자동응답·반송 수.
 * 회신이 없으면(또는 못 읽었으면) 아무것도 보이지 않는다
 */
export function RuleReplyBadge({ kind, ruleId }: { kind: "ai" | "template"; ruleId: number }) {
    const { countsFor, days } = useReplyStats();
    const c = countsFor(kind, ruleId);
    if (!c || c.human + c.auto_reply + c.bounce === 0) return null;
    return (
        <Badge
            variant="secondary"
            className="gap-1 bg-emerald-50 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
            title={`최근 ${days}일 — 사람 회신 ${c.human} · 자동응답 ${c.auto_reply} · 반송 ${c.bounce}`}
        >
            <MessageSquareReply className="size-3" />
            회신 {c.human} · {days}일
        </Badge>
    );
}
