"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SenderLimitSettings } from "@/lib/email-sender-limit-rules";
import { senderTodayBadges, type TodayBadgeTone, type TodayUsage } from "../utils/todayStatus";

interface SenderLimitBadgesProps {
    settings: SenderLimitSettings;
    /** 오늘 사용량 (GET /api/email/sender-profiles/usage 한 줄). 없으면 숫자를 보이지 않는다 */
    usage?: TodayUsage;
    /** 판정 시각. 시험·미리보기용 — 없으면 지금 */
    now?: Date;
}

const TONE_CLASS: Record<TodayBadgeTone, string> = {
    paused: "",
    info: "",
    off: "bg-muted text-muted-foreground",
    full: "border-amber-300 bg-amber-50 text-amber-700",
};

/**
 * 주소 한 줄에 붙는 상태 배지 — 오늘 실제로 무엇이 일어나는지 ("오늘 4/10", "오늘 쉼(주말)", "다음 발송 10/5(월) 09:00").
 * 한도를 하나도 켜지 않은 주소에는 아무것도 붙이지 않는다 — 지금까지와 같은 모습으로 둔다.
 */
export default function SenderLimitBadges({ settings, usage, now }: SenderLimitBadgesProps) {
    const badges = senderTodayBadges(settings, usage, now ?? new Date());
    return (
        <>
            {badges.map((b) => (
                <Badge
                    key={b.key}
                    variant={b.tone === "paused" ? "destructive" : b.key === "warmup" ? "secondary" : "outline"}
                    className={cn("text-xs", TONE_CLASS[b.tone])}
                    title={b.title}
                >
                    {b.text}
                </Badge>
            ))}
        </>
    );
}
