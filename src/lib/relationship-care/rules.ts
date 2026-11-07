import { z } from "zod";
/** 관계 정비 규칙(기획서 3·5절). DB 없이 계산하는 순수 함수만 둔다. */
export const TIERS = ["a", "b", "c", "d"] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_LABEL: Record<Tier, string> = {
    a: "A 핵심",
    b: "B 성장",
    c: "C 유지",
    d: "D 관찰",
};
/** 등급별 기본 점검 주기(일). 대표 결정 전 제안값. */
export const DEFAULT_CADENCE: Record<Tier, number> = { a: 30, b: 60, c: 90, d: 180 };
export const DAY = 86_400_000;
/** 명함을 받은 직후 첫 인사(입고 점검) 기한 */
export const WELCOME_HOURS = 48;
export const SOON_DAYS = 7;
export const SNOOZE_DAYS = 7;
/** 한 번에 보여 주는 카드 상한. 처리하면 대기 중인 다음 카드가 올라온다(하루 단위 발행 기록은 없다). */
export const DAILY_CARD_LIMIT = 10;
/** 같은 사람에게 어떤 카드든 다시 내지 않는 기간(연락 뒤) */
export const REPEAT_GUARD_DAYS = 14;
/** 최근 마케팅 메일을 받은 사람은 이 기간 동안 카드를 미룬다 */
export const MARKETING_DEFER_DAYS = 3;
export const ANNIVERSARY_LOOKAHEAD_DAYS = 3;
export const UNANSWERED_DOWNGRADE = 2;

export type CareStatus = "welcome" | "overdue" | "soon" | "dormant" | "ok";
export type CardReason =
    | "welcome"
    | "anniversary"
    | "memory"
    | "season"
    | "dormant"
    | "routine";
export const REASON_LABEL: Record<CardReason, string> = {
    welcome: "첫 인사(명함 받은 뒤 48시간)",
    anniversary: "기념일",
    memory: "지난 대화 메모 후속",
    season: "연말·새해 인사",
    dormant: "오래 연락하지 않음",
    routine: "점검 주기 도래 · 가벼운 안부",
};
export interface CareState {
    tier: Tier;
    cadenceDays: number | null;
    lastTouchAt: Date | null;
    nextDueAt: Date;
    snoozedUntil: Date | null;
    memoryNote: string;
    importantDates: { label: string; monthDay: string }[];
    unansweredCount: number;
}
export function cadenceOf(care: Pick<CareState, "tier" | "cadenceDays">) {
    return care.cadenceDays ?? DEFAULT_CADENCE[care.tier];
}
export const addDays = (at: Date, days: number) =>
    new Date(at.getTime() + days * DAY);
/** 첫 인사 기한(등록 시각 + 48시간). 등록 때 다음 점검일은 등록 시각으로 두어 바로 카드에 오른다. */
export function welcomeDeadline(createdAt: Date) {
    return new Date(createdAt.getTime() + WELCOME_HOURS * 3_600_000);
}
export function nextDueAfterTouch(
    care: Pick<CareState, "tier" | "cadenceDays">,
    touchedAt: Date,
) {
    return addDays(touchedAt, cadenceOf(care));
}
export function statusOf(
    care: Pick<CareState, "tier" | "cadenceDays" | "lastTouchAt" | "nextDueAt">,
    now: Date,
): CareStatus {
    if (!care.lastTouchAt) return "welcome";
    if (now.getTime() - care.lastTouchAt.getTime() > 2 * cadenceOf(care) * DAY)
        return "dormant";
    if (care.nextDueAt.getTime() < now.getTime()) return "overdue";
    if (care.nextDueAt.getTime() - now.getTime() <= SOON_DAYS * DAY)
        return "soon";
    return "ok";
}
export const STATUS_LABEL: Record<CareStatus, string> = {
    welcome: "첫 인사 전",
    overdue: "기한 초과",
    soon: "점검 임박",
    dormant: "장기 미접촉",
    ok: "양호",
};
/** 한국 시간 기준 월-일("MM-DD") */
export function seoulMonthDay(at: Date) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(at);
    const get = (type: string) => parts.find((p) => p.type === type)!.value;
    return `${get("month")}-${get("day")}`;
}
/** 오늘부터 lookahead일 안에 돌아오는 기념일(서울 기준, 해를 넘겨도 계산) */
export function upcomingAnniversary(
    dates: CareState["importantDates"],
    now: Date,
    lookahead = ANNIVERSARY_LOOKAHEAD_DAYS,
) {
    for (let i = 0; i <= lookahead; i++) {
        const day = seoulMonthDay(addDays(now, i));
        // 2월 29일 기념일은 평년에는 2월 28일에 챙긴다.
        const leapless = day === "02-28" && seoulMonthDay(addDays(now, i + 1)) === "03-01";
        const hit = dates.find((d) => d.monthDay === day || (leapless && d.monthDay === "02-29"));
        if (hit) return { ...hit, inDays: i };
    }
    return null;
}
/** 연말(12/20~12/31)·새해(1/1~1/7) 인사 시기 */
export function seasonOf(now: Date): "yearEnd" | "newYear" | null {
    const md = seoulMonthDay(now);
    if (md >= "12-20") return "yearEnd";
    if (md <= "01-07") return "newYear";
    return null;
}
export interface CardDecision {
    show: boolean;
    reason: CardReason;
    status: CareStatus;
    anniversary?: { label: string; monthDay: string; inDays: number };
    deferredByMarketing?: boolean;
}
/**
 * 오늘의 인사 카드에 올릴지와 연락 계기를 정한다.
 * - 다음 점검일이 7일 안(지난 것 포함)이면 후보: 첫 인사 전·기한 초과·임박·장기 미접촉
 * - 기한이 멀어도 기념일이 3일 안이면 후보
 * - 최근 14일 안에 연락했으면 어떤 카드도 내지 않는다
 * - [다음 주로] 미룬 카드는 미룬 기간 동안 숨긴다
 * - 최근 3일 안에 마케팅 메일을 받았으면 첫 인사가 아닌 카드는 미룬다
 */
export function decideCard(
    care: CareState,
    now: Date,
    lastMarketingAt: Date | null = null,
): CardDecision {
    const status = statusOf(care, now);
    const anniversary = upcomingAnniversary(care.importantDates, now);
    const recentlyTouched =
        !!care.lastTouchAt &&
        now.getTime() - care.lastTouchAt.getTime() < REPEAT_GUARD_DAYS * DAY;
    const snoozed =
        !!care.snoozedUntil && care.snoozedUntil.getTime() > now.getTime();
    const dueSoon =
        care.nextDueAt.getTime() - now.getTime() <= SOON_DAYS * DAY;
    const byAnniversary = !!anniversary && !recentlyTouched;
    // 같은 사람에게 14일 안에 카드를 두 번 내지 않는다(개별 주기가 짧아도 적용). 첫 인사 전은 해당 없음.
    let show = !snoozed && !recentlyTouched && (dueSoon || byAnniversary);
    const deferredByMarketing =
        show &&
        status !== "welcome" &&
        !!lastMarketingAt &&
        now.getTime() - lastMarketingAt.getTime() < MARKETING_DEFER_DAYS * DAY;
    if (deferredByMarketing) show = false;
    const reason: CardReason =
        status === "welcome"
            ? "welcome"
            : byAnniversary
              ? "anniversary"
              : status === "dormant"
                ? "dormant"
                : care.memoryNote.trim()
                  ? "memory"
                  : seasonOf(now)
                    ? "season"
                    : "routine";
    return {
        show,
        reason,
        status,
        ...(anniversary ? { anniversary } : {}),
        ...(deferredByMarketing ? { deferredByMarketing } : {}),
    };
}
const STATUS_ORDER: Record<CareStatus, number> = {
    welcome: 1,
    overdue: 2,
    dormant: 3,
    soon: 5,
    ok: 6,
};
const WELCOME_EXPIRED_RANK = 4;
export interface SortableCard {
    status: CareStatus;
    nextDueAt: Date;
    reason: CardReason;
    /** 첫 인사 전 카드의 48시간 기한. 지나면 기한 초과·장기 미접촉 뒤로 내려 다른 카드를 막지 않는다. */
    welcomeDeadline?: Date | null;
}
export function cardRank(c: SortableCard, now: Date) {
    if (c.reason === "anniversary") return 0;
    if (c.status === "welcome" && c.welcomeDeadline && c.welcomeDeadline.getTime() < now.getTime())
        return WELCOME_EXPIRED_RANK;
    return STATUS_ORDER[c.status];
}
/**
 * 기념일 → 첫 인사(48시간 안) → 기한 초과 → 장기 미접촉 → 기한 지난 첫 인사 → 임박 순.
 * 같은 칸은 점검일이 이른 순. 상한(10장)에 밀린 카드는 앞 카드를 처리하면 올라온다.
 */
export const compareCards = (now: Date) => (a: SortableCard, b: SortableCard) =>
    cardRank(a, now) - cardRank(b, now) || a.nextDueAt.getTime() - b.nextDueAt.getTime();
export type CareAction = "sent" | "logged" | "snooze" | "skip" | "reply";
export const ACTION_LABEL: Record<CareAction, string> = {
    sent: "인사 보냄",
    logged: "연락 기록",
    snooze: "다음 주로 미룸",
    skip: "이번 주기 건너뜀",
    reply: "답장 받음",
};
/**
 * 카드 처리 결과. 인사를 보내거나 기록하면 마지막 연락일이 갱신된다.
 * 장기 미접촉 상태에서 보낸 인사와 그 뒤 답장 없이 이어 보낸 인사가 2회 쌓이면 등급을 한 단계 낮춘다.
 * [답장 받음]을 기록하면 0으로 돌아간다.
 */
export type CareChannel = "email" | "sms" | "kakao" | "call" | "meeting" | "other";
/** 통화·만남은 상대가 응한 접촉이므로 답장 받음과 같게 본다 */
export const ANSWERED_CHANNELS: readonly CareChannel[] = ["call", "meeting"];
export function applyAction(
    care: CareState,
    action: CareAction,
    now: Date,
    channel?: CareChannel,
): Pick<
    CareState,
    "tier" | "lastTouchAt" | "nextDueAt" | "snoozedUntil" | "unansweredCount"
> {
    if (action === "snooze") {
        const until = addDays(now, SNOOZE_DAYS);
        return {
            tier: care.tier,
            lastTouchAt: care.lastTouchAt,
            nextDueAt:
                care.nextDueAt.getTime() > until.getTime() ? care.nextDueAt : until,
            snoozedUntil: until,
            unansweredCount: care.unansweredCount,
        };
    }
    if (action === "skip") {
        // 주기가 7일 이하여도 건너뛴 카드가 최소 한 번은 빠지도록 임박 구간 밖으로 민다.
        const next = nextDueAfterTouch(care, now),
            floor = addDays(now, SOON_DAYS + 1);
        return {
            tier: care.tier,
            lastTouchAt: care.lastTouchAt,
            nextDueAt: next.getTime() > floor.getTime() ? next : floor,
            snoozedUntil: null,
            unansweredCount: care.unansweredCount,
        };
    }
    if (action === "reply" || (action === "logged" && channel && ANSWERED_CHANNELS.includes(channel)))
        return {
            tier: care.tier,
            lastTouchAt: now,
            nextDueAt: nextDueAfterTouch(care, now),
            snoozedUntil: null,
            unansweredCount: 0,
        };
    // 장기 미접촉 상태에서 보낸 인사부터 세고, 답장 기록 없이 이어서 보낸 인사도 센다.
    const counting = statusOf(care, now) === "dormant" || care.unansweredCount > 0;
    let tier = care.tier,
        unansweredCount = counting ? care.unansweredCount + 1 : care.unansweredCount;
    if (unansweredCount >= UNANSWERED_DOWNGRADE) {
        tier = TIERS[Math.min(TIERS.indexOf(tier) + 1, TIERS.length - 1)];
        unansweredCount = 0;
    }
    return {
        tier,
        lastTouchAt: now,
        nextDueAt: nextDueAfterTouch({ tier, cadenceDays: care.cadenceDays }, now),
        snoozedUntil: null,
        unansweredCount,
    };
}
export function daysSince(at: Date | null, now: Date) {
    return at ? Math.floor((now.getTime() - at.getTime()) / DAY) : null;
}
export interface DraftInput {
    contactName: string;
    senderName: string;
    reason: CardReason;
    metPlace?: string | null;
    anniversaryLabel?: string | null;
    season?: "yearEnd" | "newYear" | null;
}
export interface Draft {
    sms: string;
    emailSubject: string;
    emailBody: string;
}
/**
 * 기본 인사 초안(AI 없이 즉시). 메모·이력에 없는 사실은 넣지 않는다.
 * 사람이 고쳐 쓰는 출발점이며 판매 제안은 넣지 않는다.
 */
export function baseDraft(input: DraftInput): Draft {
    const name = `${input.contactName}님`,
        me = input.senderName;
    const place = input.metPlace?.trim();
    const lines: Record<CardReason, { sms: string; subject: string; body: string }> = {
        welcome: {
            sms: `${name}, 안녕하세요. ${place ? `${place}에서 ` : ""}인사드린 ${me}입니다. 만나 뵙게 되어 반가웠습니다. 앞으로도 편하게 연락 주세요.`,
            subject: `${place ? `${place}에서 ` : ""}만나 뵈어 반가웠습니다`,
            body: `${name}, 안녕하세요.\n${place ? `${place}에서 ` : ""}인사드린 ${me}입니다.\n\n짧은 시간이었지만 이야기 나눌 수 있어 반가웠습니다.\n앞으로도 궁금하신 점이 있거나 도움이 필요하실 때 편하게 연락 주세요.\n\n${me} 드림`,
        },
        anniversary: {
            sms: `${name}, ${input.anniversaryLabel ?? "기념일"} 진심으로 축하드립니다. 늘 좋은 일 가득하시길 바랍니다. ${me} 드림`,
            subject: `${input.anniversaryLabel ?? "기념일"} 축하드립니다`,
            body: `${name}, 안녕하세요. ${me}입니다.\n\n${input.anniversaryLabel ?? "기념일"} 진심으로 축하드립니다.\n늘 건강하시고 좋은 일 가득하시길 바랍니다.\n\n${me} 드림`,
        },
        memory: {
            sms: `${name}, 안녕하세요. ${me}입니다. 지난번 나눈 이야기가 생각나 안부 여쭙니다. 요즘 어떻게 지내세요?`,
            subject: "지난번 이야기가 생각나 연락드립니다",
            body: `${name}, 안녕하세요. ${me}입니다.\n\n지난번 나눈 이야기가 생각나 안부 여쭙니다.\n그 뒤로 어떻게 되셨는지 궁금합니다.\n\n${me} 드림`,
        },
        season:
            input.season === "newYear"
                ? {
                      sms: `${name}, 새해 복 많이 받으세요. 올해도 건강하시고 하시는 일 모두 잘되시길 바랍니다. ${me} 드림`,
                      subject: "새해 복 많이 받으세요",
                      body: `${name}, 안녕하세요. ${me}입니다.\n\n새해 복 많이 받으세요.\n올해도 건강하시고 하시는 일 모두 잘되시길 바랍니다.\n\n${me} 드림`,
                  }
                : {
                      sms: `${name}, 한 해 동안 고마웠습니다. 따뜻한 연말 보내시고 새해에도 좋은 일 가득하시길 바랍니다. ${me} 드림`,
                      subject: "한 해 동안 고마웠습니다",
                      body: `${name}, 안녕하세요. ${me}입니다.\n\n올 한 해 동안 고마웠습니다.\n따뜻한 연말 보내시고 새해에도 좋은 일 가득하시길 바랍니다.\n\n${me} 드림`,
                  },
        dormant: {
            sms: `${name}, 오랜만에 인사드립니다. ${me}입니다. 그동안 잘 지내셨는지 궁금해 연락드렸습니다.`,
            subject: "오랜만에 인사드립니다",
            body: `${name}, 오랜만에 인사드립니다. ${me}입니다.\n\n그동안 잘 지내셨는지 궁금해 연락드렸습니다.\n시간 되실 때 근황 한번 나눠 주시면 반갑겠습니다.\n\n${me} 드림`,
        },
        routine: {
            sms: `${name}, 안녕하세요. ${me}입니다. 잘 지내시죠? 문득 생각나 안부 전합니다.`,
            subject: "안부 인사드립니다",
            body: `${name}, 안녕하세요. ${me}입니다.\n\n잘 지내시죠? 문득 생각나 안부 전합니다.\n요즘 하시는 일은 어떠신지 궁금합니다.\n\n${me} 드림`,
        },
    };
    const picked = lines[input.reason];
    return { sms: picked.sms, emailSubject: picked.subject, emailBody: picked.body };
}
const monthDay = z
    .string()
    .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "기념일은 MM-DD 형식으로 입력해주세요.");
export const importantDatesInput = z
    .array(z.object({ label: z.string().trim().min(1).max(30), monthDay }).strict())
    .max(10);
export const careSettingsInput = z
    .object({
        workspaceId: z.number().int().positive(),
        version: z.number().int().positive().optional(),
        tier: z.enum(TIERS),
        cadenceDays: z.number().int().min(1).max(730).nullable().optional(),
        ownerUserId: z.string().uuid().nullable().optional(),
        metPlace: z.string().trim().max(200).nullable().optional(),
        metOn: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .nullable()
            .optional(),
        memoryNote: z.string().max(2000).optional(),
        importantDates: importantDatesInput.optional(),
        /** 기존 고객에 관계 관리를 붙일 때 마지막으로 연락한 날(없으면 첫 인사 카드로 시작) */
        lastTouchOn: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .nullable()
            .optional(),
    })
    .strict();
export const careActionInput = z
    .object({
        workspaceId: z.number().int().positive(),
        action: z.enum(["sent", "logged", "snooze", "skip", "reply"]),
        channel: z.enum(["email", "sms", "kakao", "call", "meeting", "other"]).optional(),
        note: z.string().trim().max(500).optional(),
        reason: z
            .enum(["welcome", "anniversary", "memory", "season", "dormant", "routine"])
            .optional(),
    })
    .strict();
export const businessCardInput = z
    .object({
        workspaceId: z.number().int().positive(),
        name: z.string().trim().min(1).max(100),
        email: z
            .email()
            .transform((s) => s.toLowerCase())
            .nullable()
            .optional(),
        phone: z.string().trim().max(40).nullable().optional(),
        companyName: z.string().trim().max(200).nullable().optional(),
        title: z.string().trim().max(100).nullable().optional(),
        website: z.string().trim().max(300).nullable().optional(),
        metPlace: z.string().trim().max(200).nullable().optional(),
        metOn: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .nullable()
            .optional(),
        memoryNote: z.string().max(2000).optional(),
        tier: z.enum(TIERS),
        /** 같은 메일·전화의 기존 고객이 있을 때, 그 고객에 관계 관리를 붙인다 */
        attachToContactId: z.string().uuid().optional(),
        /** 대표전화 공유 등으로 겹친 경우, 확인 후 새 고객으로 만든다 */
        allowDuplicate: z.boolean().optional(),
    })
    .strict();
/** 전화번호 비교용 — 숫자만 남긴다 */
export const phoneDigits = (phone: string | null | undefined) =>
    (phone ?? "").replace(/\D/g, "");
