"use client";

import { Badge } from "@/components/ui/badge";
import { formatKst } from "../utils/labels";

/**
 * "명단 보류"(빨강) / "자동 멈춤"(주황) 배지 + 사유 한 줄·언제부터 (툴팁). DESIGN-SND 10절.
 */
export default function HoldBadge({
    kind,
    reason,
    since,
    suffix,
}: {
    kind: "hold" | "auto_pause";
    reason?: string | null;
    since?: string | null;
    /** 배지 뒤 글 (예: " · 대기 1,240통") */
    suffix?: string;
}) {
    const when = since ? `${formatKst(since)}부터` : "";
    if (kind === "hold") {
        const title = [
            "발송 실패가 많아 이 명단의 대량 발송을 잠시 멈췄습니다 (폼·광고 문의 메일은 그대로 나갑니다).",
            reason ?? "",
            when,
            "관리자가 풀면 남겨 둔 대기가 다시 나갑니다.",
        ]
            .filter(Boolean)
            .join("\n");
        return (
            <Badge variant="outline" className="border-red-300 bg-red-50 text-red-800" title={title}>
                명단 보류{suffix}
            </Badge>
        );
    }
    const title = ["발송 실패가 많아 이 주소를 자동으로 멈췄습니다.", reason ?? "", when, "관리자가 풀 수 있습니다."].filter(Boolean).join("\n");
    return (
        <Badge variant="outline" className="border-orange-300 bg-orange-50 text-orange-800" title={title}>
            자동 멈춤{suffix}
        </Badge>
    );
}
