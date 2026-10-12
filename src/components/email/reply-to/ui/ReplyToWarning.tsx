"use client";

import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/** 답장 노란 경고 상자 — 발신 묶음 칸(답장을 받을 수 없는 주소) 안내가 쓴다 */
export default function ReplyToWarning({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <div
            role="status"
            className={cn(
                "flex gap-2 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-800",
                "dark:border-yellow-900/60 dark:bg-yellow-900/20 dark:text-yellow-200",
                className
            )}
        >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-yellow-600 dark:text-yellow-400" />
            <div className="min-w-0 space-y-1">{children}</div>
        </div>
    );
}
