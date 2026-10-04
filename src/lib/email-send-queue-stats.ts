/**
 * 발송 대기열 통계 — AI 규칙별 대기 통수(문의/대량), 발신 묶음의 하루 용량, 예상 소진일, 3일치 경고. DB를 모른다.
 *
 * GET /api/email/send-queue/stats가 세 번 읽은 값(규칙 · 대기 줄 묶음별 수 · 주소와 오늘 사용량)을 buildSendQueueStats에 넘긴다.
 * 판정 재료(capForDate·bulkCapForNow·pickSenderCandidates)는 실제 자리 잡기와 같은 함수를 쓴다 — 통계와 발송이 어긋나지 않게.
 * 테스트가 이 파일만 import하면 DB 커넥션이 열리지 않도록 분리해 두었다 (@/lib/db import 금지).
 * 설계: docs/2026-10-02-sender-warmup/DESIGN-2-queue-policy.md 3절.
 *
 * 경고(backlogDays)의 하루 용량은 "대량 몫" 기준이다 (그날 한도 − 문의 몫 — 보수적으로).
 * 예상 소진일은 지금 쌓인 양만 센다 — 새로 들어올 양은 모른다. 새 문의가 없다고 보므로 문의 몫은 풀리는 시각
 * (reserveReleaseHour — 보통 15:00)에 대량이 쓴다고 센다 (실제 워커와 같다).
 */

import { addDaysYmd, kstParts } from "@/lib/kst";
import {
    bulkCapForNow,
    capForDate,
    inboundReserve,
    linkSenderPool,
    nextSendableAt,
} from "@/lib/email-sender-limit-rules";
import type { SenderLimitSettings } from "@/lib/email-sender-limit-rules";
import { pickSenderCandidates } from "@/lib/email-sender-limit-paths";
import type { SenderCandidate } from "@/lib/email-sender-pick";
import { purposeOfQueuePriority } from "@/lib/email-send-queue-rules";

/** 대기가 하루 용량의 이 날수를 넘으면 경고한다 (넘음 = 초과, 같으면 경고 아님) */
export const BACKLOG_WARNING_DAYS = 3;
/** 용량 미리보기·예상 소진일을 세는 날수 (오늘 포함). 넘으면 소진일은 null ("2주 넘게") */
export const QUEUE_STATS_DAYS = 14;
/** backlogDays의 분모: 보낼 수 있는 날(용량 > 0) 앞의 몇 날을 평균하나 */
const CAPACITY_AVERAGE_DAYS = 2;

// ============================================
// 묶음 하루 용량
// ============================================

/** 묶음의 주소 하나: 판정 설정과 오늘(KST) 사용량 */
export interface PoolMember {
    limits: SenderLimitSettings;
    sentToday: number;
}

/** 하루 용량. cap = 대량 몫 합계, total = 한도 합계. null = 제한 없음 (한도 없는 주소가 그날 보낼 수 있다) */
export interface DayCapacity {
    date: string;
    cap: number | null;
    total: number | null;
}

/** 그날 한도에서 대량이 쓸 수 있는 몫 (문의 몫을 뺀 양). null = 제한 없음 */
export function bulkShareOf(cap: number | null): number | null {
    return cap === null ? null : Math.max(0, cap - inboundReserve(cap));
}

/**
 * 묶음의 그날 하루 용량 (주소별 합).
 * 한도 없는 주소가 하나라도 그날 보낼 수 있으면 null — 묶음은 그 주소로 끝없이 돌아가며 보낸다.
 * 주소가 하나도 없으면(레거시 설정 발신자·발신자 없음) 셀 카운터가 없으므로 null(제한 없음)이다.
 */
export function poolDayCapacity(members: readonly SenderLimitSettings[], date: string): DayCapacity {
    if (members.length === 0) return { date, cap: null, total: null };
    let cap = 0;
    let total = 0;
    for (const s of members) {
        const c = capForDate(s, date);
        if (c === null) return { date, cap: null, total: null };
        total += c;
        cap += bulkShareOf(c) ?? 0;
    }
    return { date, cap, total };
}

/** fromDate부터 days일의 하루 용량 */
export function poolCapacitySchedule(
    members: readonly SenderLimitSettings[],
    fromDate: string,
    days: number = QUEUE_STATS_DAYS,
): DayCapacity[] {
    if (!Number.isFinite(days) || days <= 0) return [];
    return Array.from({ length: Math.floor(days) }, (_, i) => poolDayCapacity(members, addDaysYmd(fromDate, i)));
}

/**
 * 오늘 지금부터 더 보낼 수 있는 양. cap = 대량(지금 문의 몫을 남긴 한도 기준), total = 문의 포함.
 * 오늘 다시 열리지 않는 주소(정지·시간대가 지났다·평일만인데 주말)는 0으로 센다.
 * 오늘 열리는 한도 없는 주소가 있으면 null(제한 없음). 주소가 없으면 null.
 */
export function poolRemainingToday(
    members: readonly PoolMember[],
    now: Date,
): { cap: number | null; total: number | null } {
    if (members.length === 0) return { cap: null, total: null };
    const today = kstParts(now).date;
    let cap = 0;
    let total = 0;
    for (const m of members) {
        const s = m.limits;
        if (s.isPaused) continue;
        if (kstParts(nextSendableAt(s, now)).date !== today) continue;
        const dayCap = capForDate(s, today);
        if (dayCap === null) return { cap: null, total: null };
        const used = Math.max(0, m.sentToday);
        total += Math.max(0, dayCap - used);
        cap += Math.max(0, (bulkCapForNow(dayCap, now, s).cap ?? dayCap) - used);
    }
    return { cap, total };
}

/**
 * 오늘 하루 대량이 쓸 수 있는 양 (지금 기준) = 주소마다 bulkCapForNow(오늘 한도, 지금, 주소 설정)를 더한 값.
 * 몫이 풀리기 전(보통 15:00 KST 전)에는 대량 몫, 풀린 뒤에는 한도 그대로다 — 시간대가 15시 전에 끝나는 주소는 더 일찍 풀린다
 * (reserveReleaseHour). todayRemaining(poolRemainingToday)과 같은 기준이라 "오늘 용량"이 "오늘 남은 양"보다 작게 나오지 않는다.
 * 한도 없는 주소가 있거나 주소가 없으면 null (제한 없음 — poolDayCapacity와 같다).
 */
export function poolTodayBulkCap(members: readonly SenderLimitSettings[], now: Date): number | null {
    if (members.length === 0) return null;
    const today = kstParts(now).date;
    let sum = 0;
    for (const s of members) {
        const c = capForDate(s, today);
        if (c === null) return null;
        sum += bulkCapForNow(c, now, s).cap ?? c;
    }
    return sum;
}

// ============================================
// 예상 소진일·밀린 날수
// ============================================

/**
 * 지금 쌓인 대기(문의 inbound + 대량 bulk)가 다 나가는 한국 날짜. 새로 들어올 양은 세지 않는다.
 * 날마다: 문의가 한도 전체(total)에서 먼저 쓰고, 대량은 그 나머지를 다 쓴다 — 새 문의가 없으면 남겨 둔 문의 몫은
 * 풀리는 시각(reserveReleaseHour, 보통 15:00 — 시간대 안으로 잡힌다)에 대량이 쓰기 때문이다 (실제 워커와 같다.
 * 예전에는 앞날을 대량 몫으로만 세어 대량만 쌓인 규칙이 하루 늦게 나왔다 — REVIEW-2 정책 F5).
 * 오늘은 지금부터 남은 양만 (poolRemainingToday의 total). 그날 용량이 제한 없음이면 그날 다 나간다.
 * 대기가 없으면 null. days일 안에 못 끝나면 null.
 */
export function estimateDrainDate(
    members: readonly PoolMember[],
    backlog: { inbound: number; bulk: number },
    now: Date,
    days: number = QUEUE_STATS_DAYS,
): string | null {
    let inboundLeft = Math.max(0, backlog.inbound);
    let bulkLeft = Math.max(0, backlog.bulk);
    if (inboundLeft + bulkLeft <= 0) return null;

    const today = kstParts(now).date;
    const settings = members.map((m) => m.limits);
    for (let i = 0; i < days; i++) {
        const date = addDaysYmd(today, i);
        const day = i === 0 ? poolRemainingToday(members, now) : poolDayCapacity(settings, date);
        if (day.total === null || day.cap === null) return date;

        const inboundTake = Math.min(inboundLeft, day.total);
        inboundLeft -= inboundTake;
        const bulkTake = Math.min(bulkLeft, day.total - inboundTake);
        bulkLeft -= bulkTake;
        if (inboundLeft <= 0 && bulkLeft <= 0) return date;
    }
    return null;
}

export interface BacklogLoad {
    /** 제한 없는 묶음 — 용량 "제한 없음", 경고 없음 */
    unlimited: boolean;
    /** 분모로 쓴 하루 용량 (대량 몫). 보낼 수 있는 날이 없으면 0, 제한 없음이면 null */
    dailyCapacity: number | null;
    /** 대기 ÷ 하루 용량 (소수 둘째 자리 반올림). 제한 없음·용량 0이면 null */
    backlogDays: number | null;
    warning: boolean;
}

/**
 * 대기가 하루 용량의 며칠치인가 — 대기 ÷ 오늘~내일 평균 하루 용량(대량 몫), 3일치를 넘으면 경고.
 *
 * "오늘~내일"은 보낼 수 있는 날(용량 > 0) 앞의 두 날이다 — 평일만 보내는 묶음이 토·일에 용량 0으로 잡혀
 * 주말마다 경고가 뜨지 않게. 오늘이 평일이면 오늘~내일 그대로다.
 * 그 두 날에 제한 없는 날이 있으면 제한 없음(경고 없음). 일정 안에 보낼 수 있는 날이 없으면(전부 정지 등)
 * 대기가 있을 때 경고한다 — 쌓인 메일이 나갈 곳이 없다.
 */
export function backlogLoad(
    pending: number,
    schedule: readonly DayCapacity[],
    warnDays: number = BACKLOG_WARNING_DAYS,
): BacklogLoad {
    const sendable = schedule.filter((d) => d.cap === null || d.cap > 0).slice(0, CAPACITY_AVERAGE_DAYS);
    if (sendable.some((d) => d.cap === null)) {
        return { unlimited: true, dailyCapacity: null, backlogDays: null, warning: false };
    }
    if (sendable.length === 0) {
        return { unlimited: false, dailyCapacity: 0, backlogDays: null, warning: pending > 0 };
    }
    const dailyCapacity = sendable.reduce((sum, d) => sum + (d.cap ?? 0), 0) / sendable.length;
    const backlogDays = Math.round((Math.max(0, pending) / dailyCapacity) * 100) / 100;
    return { unlimited: false, dailyCapacity, backlogDays, warning: backlogDays > warnDays };
}

// ============================================
// 규칙별 통계 (API 응답)
// ============================================

/** AI 규칙 (email_auto_personalized_links의 일부) */
export interface QueueStatsRule {
    id: number;
    partitionId: number;
    triggerType: string;
    senderProfileId: number | null;
    senderProfileIds: unknown;
}

/** 대기(pending) 줄을 (파티션, 트리거, priority)로 묶은 수 */
export interface QueueStatsGroup {
    partitionId: number;
    triggerType: string;
    priority: number;
    count: number;
    oldestScheduledAt: Date | null;
}

/** 조직의 발신 주소 하나 (주소·기본 여부·한도 설정·오늘 사용량) */
export interface QueueStatsSender extends SenderCandidate, PoolMember {}

export interface PendingCounts {
    total: number;
    /** 문의가 막혀 미뤄진 줄 (priority 1) */
    inbound: number;
    /** 가져오기·예약 등록으로 들어온 줄 (priority 0) */
    bulk: number;
}

export interface RuleQueueStats {
    linkId: number;
    partitionId: number;
    triggerType: "on_create" | "on_update";
    pending: PendingCounts;
    /** 가장 일찍 예정된 대기 줄의 시각 (ISO). 대기가 없으면 null */
    oldestScheduledAt: string | null;
    /** 이 규칙이 실제로 쓰는 주소 id (묶음 → 없으면 기본 주소). 비면 레거시 설정 발신자·발신자 없음 */
    poolProfileIds: number[];
    capacity: {
        unlimited: boolean;
        /** 오늘 하루 대량이 쓸 수 있는 양 (문의 몫이 풀리기 전(보통 15:00 KST 전) = 대량 몫 합계, 풀린 뒤 = 한도 합계). null = 제한 없음 */
        today: number | null;
        /** 오늘 지금부터 대량이 더 보낼 수 있는 양. null = 제한 없음 */
        todayRemaining: number | null;
        /** 앞으로 14일 (오늘 포함) 하루 용량. cap = 대량 몫, total = 한도 합계. null = 제한 없음 */
        schedule: DayCapacity[];
    };
    /** backlogDays의 분모 (대량 몫 하루 평균) */
    dailyCapacity: number | null;
    /** 지금 쌓인 대기가 다 나가는 한국 날짜 "YYYY-MM-DD". 대기가 없거나 제한 없음이거나 14일 안에 못 끝나면 null */
    etaDate: string | null;
    backlogDays: number | null;
    warning: boolean;
}

export interface SendQueueStatsView {
    generatedAt: string;
    /** 오늘 (KST) */
    today: string;
    warningDays: number;
    rules: RuleQueueStats[];
    totals: {
        /** 조직의 대기 줄 전부 (규칙이 없는 파티션 포함). 한 줄을 규칙 여럿이 봐도 한 번만 센다 */
        pending: number;
        inbound: number;
        bulk: number;
        oldestScheduledAt: string | null;
        /** 경고 규칙 수 */
        warnings: number;
        warningLinkIds: number[];
    };
}

/** 대기열 줄의 trigger_type 해석과 같다 — on_update가 아니면 on_create 규칙이 본다 */
function normalizeTrigger(t: string): "on_create" | "on_update" {
    return t === "on_update" ? "on_update" : "on_create";
}

function emptyCounts(): PendingCounts {
    return { total: 0, inbound: 0, bulk: 0 };
}

function addGroup(into: { counts: PendingCounts; oldest: number | null }, g: QueueStatsGroup): void {
    const n = Math.max(0, Math.floor(Number(g.count) || 0));
    into.counts.total += n;
    if (purposeOfQueuePriority(g.priority) === "inbound") into.counts.inbound += n;
    else into.counts.bulk += n;
    const t = g.oldestScheduledAt ? g.oldestScheduledAt.getTime() : NaN;
    if (n > 0 && Number.isFinite(t) && (into.oldest === null || t < into.oldest)) into.oldest = t;
}

/**
 * 규칙별 대기 통계. 규칙 → 그 파티션·트리거의 대기 줄 (규칙 여럿이 같은 파티션·트리거면 같은 줄을 본다 —
 * 대기열 워커도 한 줄에서 그 규칙들을 모두 돌린다). 묶음은 claimSender와 같은 방식으로 고른다 (pickSenderCandidates).
 */
export function buildSendQueueStats(input: {
    rules: readonly QueueStatsRule[];
    groups: readonly QueueStatsGroup[];
    senders: readonly QueueStatsSender[];
    now: Date;
    days?: number;
}): SendQueueStatsView {
    const { rules, groups, senders, now } = input;
    const days = input.days ?? QUEUE_STATS_DAYS;
    const today = kstParts(now).date;

    const byKey = new Map<string, { counts: PendingCounts; oldest: number | null }>();
    const all = { counts: emptyCounts(), oldest: null as number | null };
    for (const g of groups) {
        const key = `${g.partitionId}|${normalizeTrigger(g.triggerType)}`;
        let entry = byKey.get(key);
        if (!entry) {
            entry = { counts: emptyCounts(), oldest: null };
            byKey.set(key, entry);
        }
        addGroup(entry, g);
        addGroup(all, g);
    }

    const out: RuleQueueStats[] = rules.map((rule) => {
        const trigger = normalizeTrigger(rule.triggerType);
        const entry = byKey.get(`${rule.partitionId}|${trigger}`);
        const counts = entry ? { ...entry.counts } : emptyCounts();

        const ids = linkSenderPool({
            senderProfileId: rule.senderProfileId,
            senderProfileIds: Array.isArray(rule.senderProfileIds) ? (rule.senderProfileIds as number[]) : null,
        });
        const picked = pickSenderCandidates(senders, { mode: "pool", ids, config: null });
        // 프로필이 아닌 발신자(레거시 설정)·발신자 없음 → 카운터가 없어 제한 없음
        const members: QueueStatsSender[] = Array.isArray(picked) ? picked : [];

        const schedule = poolCapacitySchedule(
            members.map((m) => m.limits),
            today,
            days,
        );
        const load = backlogLoad(counts.total, schedule);
        const unlimited = load.unlimited || schedule.some((d) => d.cap === null);
        const remaining = poolRemainingToday(members, now);

        return {
            linkId: rule.id,
            partitionId: rule.partitionId,
            triggerType: trigger,
            pending: counts,
            oldestScheduledAt: entry?.oldest != null ? new Date(entry.oldest).toISOString() : null,
            poolProfileIds: members.map((m) => m.id),
            capacity: {
                unlimited,
                today: poolTodayBulkCap(
                    members.map((m) => m.limits),
                    now,
                ),
                todayRemaining: remaining.cap,
                schedule,
            },
            dailyCapacity: unlimited ? null : load.dailyCapacity,
            etaDate: unlimited ? null : estimateDrainDate(members, counts, now, days),
            backlogDays: unlimited ? null : load.backlogDays,
            warning: !unlimited && load.warning,
        };
    });

    const warned = out.filter((r) => r.warning).map((r) => r.linkId);
    return {
        generatedAt: now.toISOString(),
        today,
        warningDays: BACKLOG_WARNING_DAYS,
        rules: out,
        totals: {
            pending: all.counts.total,
            inbound: all.counts.inbound,
            bulk: all.counts.bulk,
            oldestScheduledAt: all.oldest !== null ? new Date(all.oldest).toISOString() : null,
            warnings: warned.length,
            warningLinkIds: warned,
        },
    };
}
