/**
 * 발신 프로필 배지 — "오늘 이 주소로 실제로 무엇이 일어나는가"를 짧은 글로. 순수 함수만.
 *
 * 숫자만 보이면 "오늘 0/0"(주말이라 0인지 다 쓴 것인지), "웜업 5일째"(쉬는 날도 세는지)처럼 읽힌다.
 * 그래서 보낼 수 없는 때는 숫자 옆에 이유와 다시 보내는 때를 함께 적는다.
 * 판정은 서버와 같은 email-sender-limit-rules.ts 함수로만 한다 (화면이 규칙을 따로 세우지 않는다).
 */
import {
    capForDate,
    hasAnyLimit,
    isSendableNow,
    nextSendableAt,
    type SenderLimitSettings,
} from "@/lib/email-sender-limit-rules";
import { addDaysYmd, formatKstHm, isWeekdayYmd, kstParts } from "@/lib/kst";
import { formatYmdShort, warmupDayNumber, weekdayLabel } from "./limitForm";

export type TodayBadgeTone = "paused" | "off" | "full" | "info";

export interface TodayBadge {
    key: "paused" | "warmup" | "today" | "next";
    text: string;
    tone: TodayBadgeTone;
    /** 마우스를 올리면 보이는 설명 */
    title?: string;
}

/** 오늘 사용량. usageDate가 오늘(KST)이 아니면 옛 값이라 쓰지 않는다 */
export interface TodayUsage {
    usageDate?: string;
    sentToday: number;
    cap: number | null;
}

/** 다시 보내는 때 — 오늘이면 "09:00", 내일이면 "내일 09:00", 그 뒤면 "10/5(월) 09:00" */
export function whenLabel(at: Date, now: Date): string {
    const day = kstParts(at).date;
    const today = kstParts(now).date;
    const hm = formatKstHm(at);
    if (day === today) return hm;
    if (day === addDaysYmd(today, 1)) return `내일 ${hm}`;
    return `${formatYmdShort(day)}(${weekdayLabel(day)}) ${hm}`;
}

function count(n: number): string {
    return n.toLocaleString();
}

/**
 * 배지 목록. 한도를 하나도 켜지 않은 주소는 빈 목록 (지금까지와 같은 모습).
 *
 * - 정지: "정지" (+ 웜업이면 "웜업 n일째(정지 중)")
 * - 평일만인데 주말: "오늘 쉼(주말)", 웜업이면 "웜업 n일째(월요일 재개)", "다음 발송 10/5(월) 09:00 · 11통"
 * - 보낼 수 있는 날: 웜업이면 "웜업 n일째", 그리고 오늘 사용량 한 줄
 *     지금 보낼 수 있음 "오늘 4/10" (한도 없음 "오늘 4통")
 *     오늘 한도를 다 씀 "오늘 10/10 다 씀 · 내일 09:00부터"
 *     시간대 전        "오늘 0/10 · 09:00부터"
 *     시간대 뒤        "오늘 3/10 마감 · 내일 09:00부터"
 * 사용량을 못 읽었으면 숫자를 지어내지 않고, 지금 보낼 수 없을 때만 "09:00부터 발송"처럼 때만 적는다.
 */
export function senderTodayBadges(s: SenderLimitSettings, usage: TodayUsage | undefined, now: Date): TodayBadge[] {
    if (!hasAnyLimit(s)) return [];
    const today = kstParts(now).date;
    const out: TodayBadge[] = [];

    if (s.isPaused) {
        out.push({
            key: "paused",
            text: "정지",
            tone: "paused",
            title: "이 주소로는 보내지 않습니다. 정지를 풀면 다음 보낼 수 있는 날부터 나갑니다.",
        });
        if (s.warmupEnabled) out.push({ key: "warmup", text: `웜업 ${warmupDayNumber(s, today)}일째(정지 중)`, tone: "info" });
        return out;
    }

    if (s.weekdaysOnly && !isWeekdayYmd(today)) {
        const next = nextSendableAt(s, now);
        const nextDay = kstParts(next).date;
        const nextCap = capForDate(s, nextDay);
        out.push({ key: "today", text: "오늘 쉼(주말)", tone: "off", title: "평일만 보내는 주소라 토·일요일에는 보내지 않습니다." });
        if (s.warmupEnabled) {
            out.push({
                key: "warmup",
                text: `웜업 ${warmupDayNumber(s, nextDay)}일째(${weekdayLabel(nextDay)}요일 재개)`,
                tone: "info",
                title: "주말은 웜업 날수에 넣지 않습니다.",
            });
        }
        out.push({
            key: "next",
            text: `다음 발송 ${whenLabel(next, now)}${nextCap === null ? "" : ` · ${count(nextCap)}통`}`,
            tone: "info",
        });
        return out;
    }

    if (s.warmupEnabled) out.push({ key: "warmup", text: `웜업 ${warmupDayNumber(s, today)}일째`, tone: "info" });

    const sendable = isSendableNow(s, now);
    const fresh = usage && (usage.usageDate === undefined || usage.usageDate === today) ? usage : undefined;
    if (!fresh) {
        if (!sendable) out.push({ key: "today", text: `${whenLabel(nextSendableAt(s, now), now)}부터 발송`, tone: "off" });
        return out;
    }

    const { sentToday, cap } = fresh;
    const used = cap === null ? `오늘 ${count(sentToday)}통` : `오늘 ${count(sentToday)}/${count(cap)}`;
    if (cap !== null && cap <= 0) {
        // 서버가 오늘을 0으로 본 경우 (날짜가 막 바뀐 때 등) — "0/0"으로 두지 않는다
        out.push({ key: "today", text: `오늘 쉼 · 다음 발송 ${whenLabel(nextSendableAt(s, now, true), now)}`, tone: "off" });
    } else if (cap !== null && sentToday >= cap) {
        out.push({
            key: "today",
            text: `${used} 다 씀 · ${whenLabel(nextSendableAt(s, now, true), now)}부터`,
            tone: "full",
            title: "오늘 한도를 다 썼습니다. 자동 발송 메일은 미뤄 두었다가 다음 날 보냅니다.",
        });
    } else if (!sendable) {
        const next = nextSendableAt(s, now);
        const later = kstParts(next).date !== today;
        out.push({
            key: "today",
            text: `${used}${later ? " 마감" : ""} · ${whenLabel(next, now)}부터`,
            tone: "off",
            title: "지금은 이 주소의 발송 시간대가 아닙니다.",
        });
    } else {
        out.push({ key: "today", text: used, tone: "info" });
    }
    return out;
}
