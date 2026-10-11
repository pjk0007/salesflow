"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReplySyncStatus } from "../types";
import { syncBanner } from "../utils/labels";

/**
 * 회신 탭 위 띠 (DESIGN-RPL 11절 1번): 연결 상태·모드·마지막 확인·가린 메일함 주소.
 * 오류면 빨간 띠, 둘째 줄부터 뺀 주소(B1)·시험 서버 경고(M1)·메일함 별칭 경고(m3)
 */
export function ReplySyncBanner({ sync, isAdmin }: { sync: ReplySyncStatus | null; isAdmin: boolean }) {
    const [showExcluded, setShowExcluded] = useState(false);
    const view = syncBanner(sync);
    if (!view || !sync) return null;
    const Icon = view.tone === "error" ? AlertTriangle : view.tone === "ok" ? CheckCircle2 : Info;
    return (
        <div
            className={cn(
                "rounded-md border px-4 py-3 text-sm",
                view.tone === "error" && "border-red-300 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-100",
                view.tone === "warn" && "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
                view.tone === "ok" && "border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
            )}
        >
            <div className="flex items-start gap-2">
                <Icon className="mt-0.5 size-4 shrink-0" />
                <div className="min-w-0 space-y-1">
                    <p className="font-medium">{view.title}</p>
                    {view.lines.map((line) => (
                        <p key={line} className="text-xs opacity-90">
                            {line}
                        </p>
                    ))}
                    {isAdmin && sync.excluded.length > 0 && (
                        <div>
                            <button
                                type="button"
                                className="inline-flex items-center gap-1 text-xs underline underline-offset-2"
                                onClick={() => setShowExcluded((v) => !v)}
                            >
                                뺀 주소 {showExcluded ? "접기" : "보기"}
                                {showExcluded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                            </button>
                            {showExcluded && <p className="mt-1 font-mono text-xs">{sync.excluded.join(", ")}</p>}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
