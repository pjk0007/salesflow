/**
 * 발신 주소 묶음의 오늘 용량 — 규칙 화면의 묶음 합계 줄·주소별 "남은 n통"·요약 칸. 순수 함수만.
 *
 * 묶음은 순서대로 쓰지 않는다. 오늘 보낼 수 있는 주소 중 가장 오래 쉰 주소부터 돌아가며 고르게 보낸다
 * (서버 rankPool). 그래서 화면은 순서 대신 "오늘 이 묶음으로 몇 통까지 나가는가"를 보인다.
 * 판정은 서버와 같은 email-sender-limit-rules.ts 함수로만 한다 (화면이 규칙을 따로 세우지 않는다).
 * 설계: docs/2026-10-02-sender-warmup/DESIGN-2-queue-policy.md 1·2절.
 */
import {
    capForDate,
    inboundReserve,
    isSendableNow,
    nextSendableAt,
    RESERVE_RELEASE_HOUR,
    reserveReleaseHour,
    type SenderLimitSettings,
} from "@/lib/email-sender-limit-rules";
import { kstParts } from "@/lib/kst";
import type { TodayUsage } from "./todayStatus";

export interface MemberToday {
    /** 오늘 한도. null = 제한 없음 */
    cap: number | null;
    /** 오늘 보낸 수. 사용량을 못 읽었으면 null */
    sent: number | null;
    /** 오늘 더 보낼 수 있는 수. 제한 없음이거나 사용량을 못 읽었으면 null */
    remaining: number | null;
    /**
     * 이 주소의 문의 몫이 풀리는 시각 (KST, 시 — 서버 reserveReleaseHour). 보통 15, 시간대가 15시 전에 끝나면 시간대 마지막 한 시간.
     * 생략하면 15로 본다
     */
    releaseHour?: number;
}

function freshUsage(usage: TodayUsage | undefined, today: string): TodayUsage | undefined {
    return usage && (usage.usageDate === undefined || usage.usageDate === today) ? usage : undefined;
}

/**
 * 주소 하나의 오늘 상태. 오늘 한도는 사용량 줄(서버 값)을 먼저 쓰고, 없으면 같은 규칙(capForDate)으로 센다.
 * 오늘 발송 시간대가 끝났으면(다음 발송이 내일 이후) 한도가 남아도 오늘 남은 수는 0이다.
 */
export function memberToday(s: SenderLimitSettings, usage: TodayUsage | undefined, now: Date): MemberToday {
    const today = kstParts(now).date;
    const fresh = freshUsage(usage, today);
    const cap = fresh ? fresh.cap : capForDate(s, today);
    const sent = fresh ? fresh.sentToday : null;
    const releaseHour = reserveReleaseHour(s);
    if (cap === null || sent === null) return { cap, sent, remaining: null, releaseHour };
    const closedToday = !isSendableNow(s, now) && kstParts(nextSendableAt(s, now)).date !== today;
    return { cap, sent, remaining: closedToday ? 0 : Math.max(0, cap - sent), releaseHour };
}

export interface PoolCapacity {
    /** 용량을 센 주소 수 (목록에 있는 주소만 — 지워진 프로필은 세지 않는다) */
    size: number;
    /** 한도 있는 주소들의 오늘 한도 합. 한도 있는 주소가 없으면 null */
    todayMax: number | null;
    /** 한도 있는 주소들의 오늘 남은 수 합. 그중 하나라도 사용량을 못 읽었으면 null */
    todayRemaining: number | null;
    /** 오늘 한도 없는 주소 수 (제한 없이 돌아가며 보낸다) */
    unlimited: number;
    /** 몫이 풀리기 전(보통 15:00)까지 문의 메일 몫으로 남겨 두는 합 (주소마다 서버와 같은 inboundReserve — 한도의 10% 올림) */
    inboundReserve: number;
    /** 몫을 남기는 주소들의 몫이 풀리는 시각 (KST, 시 — 작은 순, 중복 없음). 몫이 없으면 빈 배열 */
    reserveReleaseHours: number[];
}

/** 묶음 주소들의 오늘 상태(memberToday)를 더한다 */
export function poolCapacity(members: readonly MemberToday[]): PoolCapacity {
    let todayMax: number | null = null;
    let todayRemaining: number | null = 0;
    let unlimited = 0;
    let reserve = 0;
    const hours = new Set<number>();
    for (const t of members) {
        if (t.cap === null) {
            unlimited++;
            continue;
        }
        todayMax = (todayMax ?? 0) + t.cap;
        todayRemaining = todayRemaining === null || t.remaining === null ? null : todayRemaining + t.remaining;
        const r = inboundReserve(t.cap);
        reserve += r;
        if (r > 0) hours.add(t.releaseHour ?? RESERVE_RELEASE_HOUR);
    }
    return {
        size: members.length,
        todayMax,
        todayRemaining: todayMax === null ? null : todayRemaining,
        unlimited,
        inboundReserve: reserve,
        reserveReleaseHours: [...hours].sort((a, b) => a - b),
    };
}

function count(n: number): string {
    return n.toLocaleString();
}

/**
 * 묶음 합계 줄. 예: "오늘 이 묶음으로 최대 20통 · 남은 12통 · 한도 없는 주소 1개(제한 없이 돌아가며 보냄)".
 * 주소가 없으면 null.
 */
export function poolCapacityLine(p: PoolCapacity): string | null {
    if (p.size === 0) return null;
    if (p.todayMax === null) {
        return `오늘 이 묶음은 한도 없음 · 주소 ${count(p.unlimited)}개를 제한 없이 돌아가며 보냄`;
    }
    const parts = [`오늘 이 묶음으로 최대 ${count(p.todayMax)}통`];
    if (p.todayRemaining !== null) parts.push(`남은 ${count(p.todayRemaining)}통`);
    if (p.unlimited > 0) parts.push(`한도 없는 주소 ${count(p.unlimited)}개(제한 없이 돌아가며 보냄)`);
    return parts.join(" · ");
}

/** 요약 칸 한 줄. 예: "주소 3개 · 최대 20통 · 남은 12통 · 한도 없음 1개". 주소가 없으면 "—" */
export function poolCapacityShort(p: PoolCapacity): string {
    if (p.size === 0) return "—";
    const parts = [`주소 ${count(p.size)}개`];
    if (p.todayMax === null) {
        parts.push("한도 없음");
    } else {
        parts.push(`최대 ${count(p.todayMax)}통`);
        if (p.todayRemaining !== null) parts.push(`남은 ${count(p.todayRemaining)}통`);
        if (p.unlimited > 0) parts.push(`한도 없음 ${count(p.unlimited)}개`);
    }
    return parts.join(" · ");
}

/**
 * 문의 몫 안내. 남겨 둘 몫이 없으면(한도 없음·한도 1 이하) null.
 * 몫이 풀리기 전(보통 15:00 KST)에는 오늘 남겨 두는 합계를, 모두 풀린 뒤에는 대량 명단도 쓴다는 것을 적는다.
 * 발송 시간대가 15시 전에 끝나는 주소는 더 일찍 풀린다(서버 reserveReleaseHour) — 그런 주소가 있으면 한 문장 덧붙인다.
 */
export function inboundReserveNote(p: PoolCapacity, now: Date): string | null {
    if (p.inboundReserve <= 0) return null;
    const hours = p.reserveReleaseHours.length > 0 ? p.reserveReleaseHours : [RESERVE_RELEASE_HOUR];
    const main = hours.includes(RESERVE_RELEASE_HOUR) ? RESERVE_RELEASE_HOUR : Math.max(...hours);
    const early = hours.filter((h) => h < main);
    const hh = `${main}:00`;
    const earlyNote =
        early.length > 0
            ? ` 발송 시간대가 15시 전에 끝나는 주소는 시간대 마지막 한 시간(${early.map((h) => `${h}:00`).join("·")})부터 씁니다.`
            : "";
    if (kstParts(now).hour >= Math.max(...hours)) {
        return `${hh}이 지나 문의·수동 메일 몫(주소마다 하루 한도의 10%)도 대량 명단이 씁니다. 다음 날은 다시 ${hh}까지 남겨 둡니다.${earlyNote}`;
    }
    return (
        `문의·수동 메일이 바로 나가도록 ${hh}까지 주소마다 하루 한도의 10%` +
        `(오늘 합계 ${count(p.inboundReserve)}통)를 남겨 둡니다. 대량 명단은 ${hh}부터 이 몫도 씁니다.${earlyNote}`
    );
}

/** 주소 한 줄 끝의 오늘 남은 수. 한도 없음이면 "한도 없음", 사용량을 못 읽었으면 null */
export function memberRemainingLabel(t: MemberToday): string | null {
    if (t.cap === null) return "한도 없음";
    if (t.remaining === null) return null;
    return `남은 ${count(t.remaining)}통`;
}
