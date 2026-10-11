"use client";

import Link from "next/link";
import { MessageSquareReply } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useReplies } from "../hooks/useReplies";
import { formatKstDateTime } from "../utils/labels";

/**
 * 레코드 상세의 "회신함 · 10/12 10:42" 배지와 최근 발췌 한 줄 (DESIGN-RPL 11절 4번).
 * 사람 회신만 본다. 없거나 못 읽었으면 아무것도 보이지 않는다
 */
export function RecordReplyBadge({ recordId }: { recordId: number | null | undefined }) {
    const { items } = useReplies({ recordId: recordId ?? undefined, kind: "human", pageSize: 1 }, !!recordId);
    const latest = items[0];
    if (!latest) return null;
    return (
        <div className="flex min-w-0 items-center gap-2 text-sm">
            <Badge variant="secondary" className="shrink-0 gap-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                <MessageSquareReply className="size-3" />
                회신함 · {formatKstDateTime(latest.receivedAt)}
            </Badge>
            {latest.excerpt && (
                <Link
                    href={`/email?tab=replies&reply=${latest.id}`}
                    className="min-w-0 truncate text-muted-foreground hover:underline"
                    title={latest.excerpt}
                >
                    {latest.excerpt.replace(/\s+/g, " ")}
                </Link>
            )}
        </div>
    );
}
