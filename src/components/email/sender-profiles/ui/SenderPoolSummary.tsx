"use client";

import { cn } from "@/lib/utils";
import { useSenderProfiles } from "../hooks/useSenderProfiles";
import { senderPoolSummary } from "../utils/ruleSummary";

interface SenderPoolSummaryProps {
    /** 규칙의 발신 주소 묶음. 빈 배열 = 기본 발신 프로필 */
    ids: number[];
    className?: string;
}

/**
 * 규칙 화면 오른쪽 요약 칸의 "발신" 줄 — 묶음의 주소를 이름으로 보인다.
 * 번호를 붙이지 않는다 — 묶음은 순서대로 쓰지 않고 가장 오래 쉰 주소부터 돌아가며 쓴다.
 * 프로필 목록은 같은 화면의 SenderPoolField와 같은 SWR 키라 요청이 더 나가지 않는다.
 */
export default function SenderPoolSummary({ ids, className }: SenderPoolSummaryProps) {
    const { profiles, isLoading, loadFailed } = useSenderProfiles();
    const summary = senderPoolSummary(ids, profiles, !isLoading && !loadFailed);

    if (summary.kind === "default") {
        return <span className={cn("font-medium text-right", className)}>{summary.label}</span>;
    }
    return (
        <ul className={cn("space-y-0.5 text-right", className)}>
            {summary.items.map((item) => (
                <li key={item.id} className={cn("text-xs font-medium", item.missing && "text-destructive")}>
                    {item.label}
                </li>
            ))}
        </ul>
    );
}
