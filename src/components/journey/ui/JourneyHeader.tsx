import { Radio } from "lucide-react";
import type { JourneySummary } from "../types";

/**
 * 여정 헤더 — 현재 단계 뱃지 + 첫 유입 채널 배지.
 */
export function JourneyHeader({
    summary,
    title,
}: {
    summary: JourneySummary;
    title?: string;
}) {
    return (
        <div className="flex flex-wrap items-center gap-2">
            {title && <span className="text-base font-semibold">{title}</span>}
            {summary.currentStage && (
                <span className="rounded-md bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                    {summary.currentStage}
                </span>
            )}
            {summary.firstChannel && (
                <span className="inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-xs">
                    <Radio className="h-3 w-3 text-primary" />
                    첫 유입 · {summary.firstChannel}
                </span>
            )}
        </div>
    );
}
