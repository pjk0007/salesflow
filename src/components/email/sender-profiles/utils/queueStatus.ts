/**
 * 대기열 통계(GET /api/email/send-queue/stats)를 화면 글로 — AI 규칙 카드 배지, 규칙 화면 요약 칸,
 * 메일 대시보드의 경고 규칙 목록. 순수 함수만.
 *
 * 숫자는 서버가 센 그대로 쓴다 (예상 소진일·3일치 경고를 화면이 다시 계산하지 않는다).
 * 설계: docs/2026-10-02-sender-warmup/DESIGN-2-queue-policy.md 3절.
 */
import { addDaysYmd, kstParts } from "@/lib/kst";
import { BACKLOG_WARNING_DAYS } from "@/lib/email-send-queue-stats";
import type { SendQueueRuleStats } from "../types";
import { formatYmdShort, weekdayLabel } from "./limitForm";

/** 경고 기준 — 대기가 하루 용량의 몇 일치를 넘으면 경고하는가. 판정(warning)은 서버가 하고 화면은 글에만 쓴다 */
export { BACKLOG_WARNING_DAYS };

function count(n: number): string {
    return n.toLocaleString();
}

/** 3.42 → "3.4", 12.7 → "13" */
export function formatBacklogDays(days: number): string {
    return days >= 10 ? String(Math.round(days)) : (Math.round(days * 10) / 10).toString();
}

/** 예상 소진일 — 오늘이면 "오늘", 내일이면 "내일", 그 뒤면 "10/7(수)" */
export function etaDayLabel(etaDate: string, now: Date): string {
    const today = kstParts(now).date;
    if (etaDate <= today) return "오늘";
    if (etaDate === addDaysYmd(today, 1)) return "내일";
    return `${formatYmdShort(etaDate)}(${weekdayLabel(etaDate)})`;
}

/** "대기 12통 · 10/7(수)까지 다 나감"의 뒷부분. 대기가 없으면 null */
function etaPhrase(s: SendQueueRuleStats, now: Date): string | null {
    if (s.pending.total <= 0) return null;
    if (s.capacity.unlimited) return null;
    if (s.etaDate === null) return "2주 안에 다 못 나감";
    const day = etaDayLabel(s.etaDate, now);
    return day === "오늘" ? "오늘 다 나감" : `${day}까지 다 나감`;
}

function pendingBreakdown(s: SendQueueRuleStats): string {
    return `문의 ${count(s.pending.inbound)}통 · 대량 ${count(s.pending.bulk)}통`;
}

/** 경고 설명. 보낼 수 있는 날이 아예 없어(전부 정지·한도 0) 경고한 경우는 따로 적는다 */
export function warningDetail(s: SendQueueRuleStats): string {
    if (s.backlogDays === null) {
        return "앞으로 이 묶음으로 보낼 수 있는 날이 없어 대기가 나가지 못합니다(정지·한도 0). 정지를 풀거나 발신 주소를 늘리세요.";
    }
    return (
        `대기가 하루에 보낼 수 있는 양의 ${BACKLOG_WARNING_DAYS}일치를 넘었습니다(${formatBacklogDays(s.backlogDays)}일치). ` +
        "발신 주소를 늘리거나 하루 한도를 올리세요."
    );
}

export interface QueueBadge {
    key: "pending" | "warning";
    text: string;
    tone: "info" | "warning";
    /** 마우스를 올리면 보이는 설명 */
    title: string;
}

/**
 * AI 규칙 카드의 대기 배지. 대기가 없으면 빈 목록 (지금까지와 같은 모습).
 * - "대기 12통 · 10/7(수)까지 다 나감" / "대기 3통 · 오늘 다 나감" / 한도 없는 묶음은 "대기 3통"
 * - 3일치를 넘으면 빨간 "대기 3일치 넘음"을 하나 더
 */
export function queueBadges(s: SendQueueRuleStats | undefined, now: Date): QueueBadge[] {
    if (!s || s.pending.total <= 0) return [];
    const eta = etaPhrase(s, now);
    const out: QueueBadge[] = [
        {
            key: "pending",
            text: `대기 ${count(s.pending.total)}통${eta ? ` · ${eta}` : ""}`,
            tone: "info",
            title: s.capacity.unlimited
                ? `${pendingBreakdown(s)}. 발신 묶음에 한도가 없어 대기열 차례대로 나갑니다.`
                : `${pendingBreakdown(s)}. 지금 쌓인 양만 센 예상입니다 (새로 들어오는 메일은 빼고).`,
        },
    ];
    if (s.warning) {
        out.push({ key: "warning", text: `대기 ${BACKLOG_WARNING_DAYS}일치 넘음`, tone: "warning", title: warningDetail(s) });
    }
    return out;
}

export interface QueueSummary {
    /** "12통" / "없음" */
    pending: string;
    /** "문의 2통 · 대량 10통". 대기가 없으면 null */
    breakdown: string | null;
    /** 예상 소진일 "10/7(수)" / "오늘" / "한도 없음" / "2주 넘게". 대기가 없으면 null */
    eta: string | null;
    /** 3일치 경고 문장. 경고가 아니면 null */
    warning: string | null;
}

/** 규칙 화면 요약 칸의 대기 줄들. 통계를 못 읽었으면(s 없음) 대기 없음으로 보지 않도록 호출한 쪽이 가린다 */
export function queueSummary(s: SendQueueRuleStats | undefined, now: Date): QueueSummary {
    if (!s || s.pending.total <= 0) return { pending: "없음", breakdown: null, eta: null, warning: null };
    let eta: string;
    if (s.capacity.unlimited) eta = "한도 없음";
    else if (s.etaDate === null) eta = "2주 넘게";
    else eta = etaDayLabel(s.etaDate, now);
    return {
        pending: `${count(s.pending.total)}통`,
        breakdown: pendingBreakdown(s),
        eta,
        warning: s.warning ? warningDetail(s) : null,
    };
}

export interface RuleNameLike {
    id: number;
    name: string | null;
    productName?: string | null;
}

export interface WarnedRuleRow {
    linkId: number;
    partitionId: number;
    name: string;
    pending: number;
    /** "4.2일치" */
    backlog: string | null;
    /** "10/9(금)까지" / "2주 넘게" */
    eta: string;
}

/** 대시보드의 경고 규칙 목록 — 밀린 일수가 많은 순. 규칙 이름은 규칙 목록에서 찾는다 */
export function warnedRuleRows(
    rules: readonly SendQueueRuleStats[],
    links: readonly RuleNameLike[],
    now: Date,
): WarnedRuleRow[] {
    const byId = new Map(links.map((l) => [l.id, l]));
    return rules
        .filter((r) => r.warning)
        .sort((a, b) => (b.backlogDays ?? 0) - (a.backlogDays ?? 0) || b.pending.total - a.pending.total)
        .map((r) => {
            const link = byId.get(r.linkId);
            return {
                linkId: r.linkId,
                partitionId: r.partitionId,
                name: link?.name || link?.productName || `AI 규칙 #${r.linkId}`,
                pending: r.pending.total,
                backlog: r.backlogDays === null ? null : `${formatBacklogDays(r.backlogDays)}일치`,
                eta: r.etaDate === null ? "2주 넘게" : `${etaDayLabel(r.etaDate, now)}까지`,
            };
        });
}
