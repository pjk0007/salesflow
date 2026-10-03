"use client";

import { hasAnyLimit, isSendableNow, nextSendableAt, toLimitSettings } from "@/lib/email-sender-limit-rules";
import { isWeekdayYmd, kstParts } from "@/lib/kst";
import type { SenderProfile, SenderUsageView } from "../types";
import { spreadGapLabel } from "../utils/limitForm";
import { whenLabel } from "../utils/todayStatus";
import SenderLimitBadges from "./SenderLimitBadges";

interface SenderSendHintProps {
    profile: SenderProfile | null | undefined;
    usage?: SenderUsageView;
    /** 이번에 보내려는 건수 */
    recordCount: number;
}

/**
 * 수동 발송 전에 고른 발신 프로필의 한도 상태를 보여 준다.
 * 수동 발송은 미루지 않고 막기만 하므로(서버가 건수로 알려 줌), 막힐 것이 보이면 보내기 전에 알린다.
 * 한도를 켜지 않은 프로필이면 아무것도 보이지 않는다.
 */
export default function SenderSendHint({ profile, usage, recordCount }: SenderSendHintProps) {
    if (!profile) return null;
    const settings = toLimitSettings(profile);
    if (!hasAnyLimit(settings)) return null;

    const now = new Date();
    let warning: string | null = null;
    if (settings.isPaused) {
        warning = "일시 정지된 프로필이라 지금은 보내지 않습니다.";
    } else if (!isSendableNow(settings, now)) {
        // 수동 발송은 미루지 않는다 — 언제부터 보낼 수 있는지 함께 알려 그때 다시 보내게 한다
        const at = whenLabel(nextSendableAt(settings, now), now);
        warning = settings.weekdaysOnly && !isWeekdayYmd(kstParts(now).date)
            ? `평일만 보내는 프로필이라 오늘(주말)은 보내지 않습니다. ${at}부터 보낼 수 있습니다.`
            : `지금은 이 프로필의 발송 시간대가 아니라 보내지 않습니다. ${at}부터 보낼 수 있습니다.`;
    } else if (usage && usage.cap !== null && usage.cap - usage.sentToday < recordCount) {
        const remaining = Math.max(0, usage.cap - usage.sentToday);
        warning = `오늘 남은 한도는 ${remaining.toLocaleString()}통입니다. 넘는 레코드는 보내지 않습니다.`;
    } else if (settings.spreadEvenly && recordCount > 1) {
        // 간격이 차기 전에는 다음 통을 잡지 못한다 — 한 번에 여러 통을 보내면 첫 통 말고는 막힌다
        const gap = spreadGapLabel(settings, kstParts(now).date);
        warning = `고르게 나눠 보내기가 켜져 있어 한 번에 여러 통을 보내지 않습니다.${gap ? ` 앞 메일과 ${gap} 간격이 지나기 전의 레코드는 보내지 않습니다.` : ""}`;
    }

    return (
        <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-1">
                <SenderLimitBadges settings={settings} usage={usage} />
            </div>
            {warning && <p className="text-xs text-amber-600">{warning}</p>}
        </div>
    );
}
