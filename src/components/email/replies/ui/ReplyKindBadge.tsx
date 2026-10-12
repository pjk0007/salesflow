"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { kindLabel, type BadgeTone } from "../utils/labels";

const TONE_CLASS: Record<BadgeTone, string> = {
    green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
    gray: "bg-muted text-muted-foreground",
    red: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    blue: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
    slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
};

/** 회신 분류 배지: 회신(초록)·자동응답(회색)·반송(빨강)·시스템 안내·내부 직원·알 수 없음 */
export function ReplyKindBadge({ kind, className, title }: { kind: string; className?: string; title?: string }) {
    const { label, tone } = kindLabel(kind);
    return (
        <Badge variant="secondary" className={cn(TONE_CLASS[tone], className)} title={title}>
            {label}
        </Badge>
    );
}
