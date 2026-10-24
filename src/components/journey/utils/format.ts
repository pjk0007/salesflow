// 여정 표시용 포맷 헬퍼
import { formatKstHm, kstParts, KST_TIME_ZONE, weekdayOfYmd } from "@/lib/kst";

export function formatDwell(sec: number): string {
    if (!sec) return "0초";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m === 0) return `${s}초`;
    return s ? `${m}분 ${s}초` : `${m}분`;
}

export function formatClickRate(rate: number): string {
    return `${Math.round(rate * 100)}%`;
}

// 여정의 날짜·시각은 업무 기준인 KST로 보여 준다 — 해외 브라우저에서도 날짜 묶음과 행 시각이 맞는다.
export function formatDateTime(iso: string): string {
    return new Date(iso).toLocaleString("ko-KR", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: KST_TIME_ZONE,
    });
}

/** 이벤트 시각(ISO)의 KST 날짜 키 "YYYY-MM-DD" — 일별 그룹·집계는 UTC 문자열 절단이 아니라 이것으로 묶는다 */
export function kstDateKey(iso: string): string {
    return kstParts(new Date(iso)).date;
}

/** 이벤트 시각(ISO)의 KST "HH:mm" */
export function formatTimeKst(iso: string): string {
    return formatKstHm(new Date(iso));
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 날짜 키 → 월·일·요일 (이미 KST 날짜라 시간대 변환 없이 읽는다) */
export function dayKeyParts(ymd: string): { month: number; day: number; weekday: string } {
    const [, month, day] = ymd.split("-").map(Number);
    return { month, day, weekday: WEEKDAYS[weekdayOfYmd(ymd)] };
}

/** 날짜 키 → "MM. DD." (일별 차트 축) */
export function formatDayKey(ymd: string): string {
    const [, month, day] = ymd.split("-");
    return `${month}. ${day}.`;
}

// 채널별 색상/아이콘 키
export const CHANNEL_STYLE: Record<string, { color: string; dot: string }> = {
    가입: { color: "text-rose-700 dark:text-rose-300", dot: "bg-rose-500" },
    단계: { color: "text-violet-700 dark:text-violet-300", dot: "bg-violet-500" },
    상태: { color: "text-blue-700 dark:text-blue-300", dot: "bg-blue-500" },
    상담: { color: "text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
    사이트: { color: "text-amber-700 dark:text-amber-300", dot: "bg-amber-500" },
    메일: { color: "text-sky-700 dark:text-sky-300", dot: "bg-sky-500" },
};

// 전환/단계성 채널 — 타임라인에서 강조(굵게)
const EMPHASIZED = new Set(["가입", "단계", "상태", "상담"]);

export function channelStyle(channel: string) {
    return CHANNEL_STYLE[channel] ?? { color: "text-muted-foreground", dot: "bg-muted-foreground" };
}

export function isEmphasizedChannel(channel: string): boolean {
    return EMPHASIZED.has(channel);
}
