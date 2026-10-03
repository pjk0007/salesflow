/**
 * 깊이 들어온 사람 알림 — 판정 규칙. DB를 모른다.
 *
 * 워커(deep-visitor-alert.ts)·미리보기 라우트·테스트가 같은 규칙을 써야 숫자가 어긋나지 않는다.
 * 카드 글자(buildAlertMessage)와 미리보기를 브라우저로 열 때의 HTML(renderDeepAlertPreviewHtml)도 여기서 만든다.
 * 테스트가 이 파일만 import하면 DB 커넥션이 열리지 않도록 분리해 두었다 (@/lib/db import 금지).
 *
 * 규칙 원본: 마케팅 마스터 tools/icp-journey/build_journey.py (2026-10-01 고도화 리서치 검증본).
 * 설계: docs/2026-10-02-deep-visitor-alert/DESIGN.md 3~5절.
 */

import {
    formatKstHm,
    formatKstShort,
    isBusinessHours,
    kstParts,
    kstToDate,
    nextBusinessStart,
    nextWeekdayYmd,
} from "@/lib/kst";

// ============================================
// 입력 타입 (워커가 DB에서 읽어 채운다)
// ============================================

export type TrackerEventType = "PAGE_VIEW" | "SECTION_VIEW" | "CLICK" | "CUSTOM" | "PURCHASE";

export interface ClickInput {
    clickId: string | null;
    clickedAt: Date;
}

export interface SessionInput {
    id: number;
    siteId: number;
    /** tracker_visitors.id (정수 PK) */
    visitorId: number;
    startedAt: Date;
    endedAt: Date | null;
    /** 초 */
    duration: number | null;
    pageCount: number | null;
    clickId: string | null;
}

export interface EventInput {
    sessionId: number;
    eventType: TrackerEventType | string;
    /** SECTION_VIEW = 영역 이름, CLICK = 버튼 이름, CUSTOM = 이벤트 이름, PAGE_VIEW = null */
    eventName: string | null;
    pageUrl: string | null;
    pageTitle: string | null;
    occurredAt: Date;
    properties: Record<string, unknown> | null;
}

/** 발송 한 통과 그 사람의 사이트 활동. 판정 한 번의 입력이다. */
export interface SendJourneyInput {
    sendLogId: number;
    recordId: number;
    sentAt: Date;
    /** 그 발송의 모든 클릭 (기계 클릭 포함) */
    clicks: ClickInput[];
    /** 그 발송의 click_id들로 찾은 세션 전부 (모든 사이트) */
    foundSessions: SessionInput[];
    /** 그 레코드 워크스페이스의 자기 사이트. 없으면 null (found 전부를 자기 사이트로 본다) */
    ownSiteId: number | null;
    /**
     * 고를 세션을 정해 줄 때 (사람 클릭 세션으로 다시 판정할 때, evaluateSendWithFallback이 채운다).
     * 비우면 own 중 가장 이른 세션. own에 없는 id면 무시한다
     */
    chosenSessionId?: number | null;
    /** 고른 세션의 방문자가 자기 사이트에서 남긴 세션 전부 (시간 제한 없이) */
    visitorSessions: SessionInput[];
    /** 고른 세션의 방문자가 남긴 이벤트 (워커가 start-1분 ~ now 범위로 미리 줄여 줘도 된다) */
    visitorEvents: EventInput[];
    /** 그 방문자(브라우저)가 메일 클릭으로 이어진 서로 다른 레코드 수 (이 레코드 포함) */
    distinctClickedRecordsForVisitor: number;
    /**
     * 같은 레코드가 받은 메일(앞선 메일 포함)의 click_id 중 이 방문자 세션에 붙은 것.
     * 이 click_id가 붙은 세션은 "메일 전부터 오던 방문"으로 세지 않는다 (후속 메일 판정에서 1통째 메일 방문이
     * 기존 방문자로 잡히지 않게). 비우면 이 발송의 click_id만 뺀다
     */
    sameRecordClickIds?: readonly string[];
    /** 4절 "이미 깔때기 안" — 워커가 레코드·이어진 레코드·같은 메일 레코드·record_events로 계산 */
    alreadyInFunnel: boolean;
    /** 4절 수신거부 */
    unsubscribed: boolean;
}

// ============================================
// 판정 결과
// ============================================

export type DeepAlertLevel = "deep" | "intent";
export type DeepAlertAngle = "A" | "B" | "C" | "D" | "E";

/** 0 발송 · 3 사이트 도착 · 4 둘러봄 · 5 서비스 깊이 확인 · 6 행동 · 7 신청 시작 · 8 제출·가입 */
export type JourneyStage = 0 | 3 | 4 | 5 | 6 | 7 | 8;

export const STAGE_LABELS: Record<JourneyStage, string> = {
    0: "발송",
    3: "사이트 도착",
    4: "둘러봄",
    5: "서비스 깊이 확인",
    6: "상담·데모·체험 행동",
    7: "신청 시작",
    8: "신청 제출·구독",
};

export interface JourneyVerdict {
    /** 자기 사이트 세션이 없고 자매 사이트 세션만 있음 */
    sisterSiteOnly: boolean;
    /** 고른 세션 (자기 사이트 가장 이른 세션). 없으면 null */
    chosenSession: SessionInput | null;
    /** 판정 기준 시각 = 그 발송의 첫 클릭 (없으면 고른 세션 시작) */
    start: Date | null;
    hasHumanClick: boolean;
    /** 사람 클릭 중 가장 이른 시각 (2분 뒤 클릭) */
    firstHumanClickAt: Date | null;
    machine: boolean;
    machineReason: "weak" | "early_only" | "scanner" | null;
    existingVisitor: boolean;
    pages: number;
    revisit: boolean;
    /** 고른 세션 duration (초) */
    firstSessionDurationSec: number;
    browsed: boolean;
    sawCases: boolean;
    sawPrice: boolean;
    sawDetail: boolean;
    action: boolean;
    /** 행동으로 잡힌 이름 (버튼 이름 또는 "page:consult" 꼴), 중복 제거·정렬 */
    actionNames: string[];
    signupStart: boolean;
    signupScreen: boolean;
    aiStart: boolean;
    coupon: boolean;
    submitted: boolean;
    appUse: boolean;
    /** 범위 안 SECTION_VIEW 이름, 처음 본 순서, 중복 제거 */
    sections: string[];
    /** 범위 안 CLICK 이름, 처음 누른 순서, 중복 제거 */
    clickNames: string[];
    /** 범위 안 CUSTOM 이름, 처음 순서, 중복 제거 */
    customNames: string[];
    /** 범위 안 PAGE_VIEW 경로, 시간 순, 연속 중복 제거 */
    pagePaths: string[];
    /** 그 방문자의 자기 사이트 마지막 활동 시각 (세션 ended_at·이벤트 occurred_at·세션 시작 중 가장 늦은 것) */
    lastActivityAt: Date | null;
    deepestStage: JourneyStage;
}

export interface AlertDecision {
    alert: boolean;
    /** alert=false일 때 이유 (기록·미리보기용) */
    reason:
        | "ok"
        | "no_session"
        | "sister_site_only"
        | "machine"
        | "existing_visitor"
        | "already_in_funnel"
        | "unsubscribed"
        | "not_deep"
        | "not_settled";
    level: DeepAlertLevel | null;
    angle: DeepAlertAngle | null;
}

// ============================================
// 카드 근거 (워커가 DB에서 모아 채운다)
// ============================================

export interface AlertEmailEvidence {
    sentAt: Date | null;
    subject: string | null;
    /** AI 규칙·템플릿 규칙 이름. 모르면 null */
    ruleName: string | null;
    triggerType: string | null;
    clicks: { clickedAt: Date; human: boolean }[];
    /** 이 알림을 부른 발송이면 true */
    isAlertSend: boolean;
}

export interface AlertEvidence {
    businessName: string;
    recordId: number;
    integratedCode: string | null;
    partitionName: string | null;
    /** listTypeOf(partitionName) */
    listType: string;
    baseUrl: string;
    level: DeepAlertLevel;
    angle: DeepAlertAngle;
    /** deadlineText(angle, now) */
    deadline: string;
    verdict: JourneyVerdict;
    /** 이 알림을 부른 발송 */
    alertSend: { sentAt: Date; subject: string | null; nth: number; totalSends: number };
    /**
     * 레코드 칸 (칸 정의 순서, 빈 값·_키·파일 칸은 워커가 미리 뺀다).
     * key·fieldType이 있으면 카드 둘째 줄 연락 요약(이름·전화·메일·회사)을 고르는 데 쓴다 (contactKindOf)
     */
    fields: { label: string; value: string; key?: string; fieldType?: string }[];
    /**
     * 칸 키 → 칸 라벨 (그 레코드 칸 정의 전부). record_events.type에 칸 키가 오면(callStatus 등)
     * 상태 이력에 키 대신 라벨("콜 상태")을 보인다. 없으면 type을 그대로 보인다
     */
    fieldLabels?: Record<string, string>;
    companyResearch: {
        industry?: string | null;
        employees?: string | null;
        website?: string | null;
        description?: string | null;
    } | null;
    /** 받은 메일 전부 (시간 순) */
    emails: AlertEmailEvidence[];
    /** 영역·버튼·CUSTOM 이벤트의 표시 이름 (별칭). 키 = `${eventType}:${eventName}` */
    labels: Record<string, string>;
    /** CLICK 이벤트의 properties.text (버튼 글자). 키 = eventName */
    clickTexts: Record<string, string>;
    /** 상태 이력 전부 (자르지 말고 넘긴다 — 카드가 최근 8개만 보이고 "(최근 8)" 머리를 붙인다) */
    statusHistory: { occurredAt: Date; type: string; label: string | null }[];
    /** 메모 전부 (자르지 말고 넘긴다 — 카드가 빈 메모를 거른 뒤 최근 3개를 고른다) */
    memos: { createdAt: Date; author: string | null; content: string }[];
    otherRecords: { partitionName: string | null; integratedCode: string | null; createdAt: Date | null; stage: string | null }[];
    alimtalkCount: number;
}

// ============================================
// 설정
// ============================================

export type DeepAlertMode = "off" | "dry_run" | "live";

export interface DeepAlertConfig {
    mode: DeepAlertMode;
    /** 비면 아무것도 처리하지 않는다 */
    workspaceIds: number[];
    /** 워크스페이스별 웹훅 (공통 주소 반영 후). 없는 워크스페이스는 키가 없다 */
    webhookByWorkspace: Record<number, string>;
}

// ============================================
// 상수
// ============================================

export const LOOKBACK_MS = 48 * 60 * 60 * 1000;
export const SETTLE_MS = 10 * 60 * 1000;
export const HUMAN_CLICK_AFTER_MS = 2 * 60 * 1000;
export const ACTIVITY_WINDOW_DAYS = 30;
export const MESSAGE_MAX_CHARS = 3800;
export const MAX_ATTEMPTS = 3;
export const RETRY_DELAY_MS = 10 * 60 * 1000;
export const STUCK_THRESHOLD_MS = 15 * 60 * 1000;
export const DEADLINE_BUDGET_MS = 4 * 60 * 1000;
/** 탐지보다 먼저 이미 예약된 줄을 보내는 데 쓰는 예산 — 탐지가 예산을 다 써도 밀린 줄이 나가게 */
export const PRE_DELIVERY_BUDGET_MS = 60 * 1000;
/**
 * 예약 시각이 이만큼 지난 pending은 보내지 않고 닫는다 (멈췄다 다시 켤 때 묵은 카드가 몰려 나가지 않게).
 * 예약 시각 기준이라 주말·공휴일 대기(금 18:00 → 월 09:00)와 상관없다
 */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
/** 정기 작업 주기 — 워크스페이스 순서를 회차마다 돌리는 데 쓴다 */
export const RUN_INTERVAL_MS = 5 * 60 * 1000;

// 아래 함수들은 설계 3~5절을 옮긴 것이다.
// 시그니처는 워커와 테스트가 기대는 계약이다 — 바꾸지 않는다.

// ============================================
// 정규식 (build_journey.py와 같다, 대소문자 무시)
// ============================================

export const TRUST_RE = /^(trust-cases|trust-reviews|review-portfolio-more|nav-portfolio|footer-portfolio)$/i;
/** SECTION_VIEW에만 쓴다 — 오피오는 같은 이름이 CLICK으로도 오는데 원본은 그것을 가격으로 치지 않았다 */
export const PRICE_RE = /^(subsidy-calc-cta)$/i;
export const PRICE_PAGE_RE = /^\/(pricing|plan)/i;
// service-workspace는 07 #9 이름 바꾸기(service-pricing → service-workspace)에 미리 대비해 더했다
export const DETAIL_SECTIONS_RE =
    /^(faq|how-it-works|dashboard|intelligence|security|service-cta|service-pricing|service-workspace)$/i;
export const CONTENT_PAGE_RE = /^\/(portfolio|accounting|secretary|subsidy\/|pricing|plan|faq|blog|resources|insight)/i;
export const ACTION_RE = /(demo|consult|contact|trial|meeting|brochure|phone)/i;
export const ACTION_PAGE_RE = /^\/(consult|consulting|contact)/i;
export const START_RE = /(subscribe_step_1$|manual_entry_click|^signup$)/i;
export const AI_START_RE = /^ai_entry_click$/i;
export const COUPON_RE = /(hero-free-trial|nav-free-trial)/i;
export const SUBMIT_RE = /(subscribe_submit|signup_complete)/i;

const CONTACT_ACTION_RE = /(consult|contact|phone|meeting)/i;
const DEMO_ACTION_RE = /demo/i;
const TRIAL_ACTION_RE = /trial/i;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const ACTIVITY_WINDOW_MS = ACTIVITY_WINDOW_DAYS * DAY_MS;
/** 재방문 = 고른 세션 30분 뒤 이후 */
const REVISIT_AFTER_MS = 30 * MINUTE_MS;
/** 기존 방문자 = 첫 클릭 1분 전보다 이른 세션 */
const EXISTING_BEFORE_MS = MINUTE_MS;
const EXISTING_MIN_SESSIONS = 3;
const EXISTING_MIN_RECORDS = 3;
/** 한 발송이 이 폭 안에 여러 사이트를 열면 서명 링크를 다 연 검사기 모양 */
const SCANNER_SPREAD_MS = 60 * 1000;

// ============================================
// 작은 도우미
// ============================================

/** page_url → 경로만 ("https://a.com/x/?q=1#h" → "/x/"). 빈 값이면 "" */
export function pathOf(pageUrl: string | null | undefined): string {
    if (!pageUrl) return "";
    // 연구 내보내기(export_icp.py path_only)·pagePathExpr와 같은 규칙: 주소 앞부분·? 뒤·# 뒤를 떼고, 비면 "/"
    const rest = pageUrl.trim().replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "");
    return rest.split("?")[0].split("#")[0] || "/";
}

/** 파티션 이름 → 명단 종류 (채용공고 수집 / 구매 명단 / 화장품 책임판매업 / 기타) */
export function listTypeOf(partitionName: string | null | undefined): string {
    const part = partitionName ?? "";
    if (part.includes("채용공고") || ["T1", "T2", "T3", "도메인", "(신규)"].some((p) => part.startsWith(p))) {
        return "채용공고 수집";
    }
    if (part.startsWith("콜") || part.includes("콜드") || part === "일반 DB") return "구매 명단";
    if (part.startsWith("화책")) return "화장품 책임판매업";
    return "기타";
}

/** 사람 클릭 = 발송 2분 "뒤" 클릭. 정확히 120초는 보안 장비 쪽으로 본다 (원본 SQL이 `>`) */
export function isHumanClick(sentAt: Date, clickedAt: Date): boolean {
    return clickedAt.getTime() - sentAt.getTime() > HUMAN_CLICK_AFTER_MS;
}

function pageCountOf(s: SessionInput): number {
    return s.pageCount ?? 0;
}

function earliestSession(list: SessionInput[]): SessionInput | null {
    let best: SessionInput | null = null;
    for (const s of list) {
        const t = s.startedAt.getTime();
        // 같은 시각이면 id가 작은 쪽 — 입력 순서에 따라 고른 세션이 바뀌지 않게
        if (!best || t < best.startedAt.getTime() || (t === best.startedAt.getTime() && s.id < best.id)) best = s;
    }
    return best;
}

function minTime(times: number[]): number | null {
    return times.length ? times.reduce((a, b) => (b < a ? b : a)) : null;
}

function pushUnique(list: string[], name: string): void {
    if (name && !list.includes(name)) list.push(name);
}

type SessionPickInput = Pick<SendJourneyInput, "foundSessions" | "ownSiteId" | "chosenSessionId">;

/** now까지 시작한 found 중 자기 사이트 세션. 자기 사이트가 없는 워크스페이스(매치스플랜 등)는 found 전부 */
function ownSessionsOf(input: SessionPickInput, nowMs: number): SessionInput[] {
    const found = input.foundSessions.filter((s) => s.startedAt.getTime() <= nowMs);
    return input.ownSiteId == null ? found : found.filter((s) => s.siteId === input.ownSiteId);
}

/**
 * 고른 세션 (설계 3절). chosenSessionId가 own 안에 있으면 그것, 아니면 own 중 가장 이른 것.
 * 워커도 이 함수로 방문자를 골라야 규칙과 어긋나지 않는다
 */
export function pickChosenSession(input: SessionPickInput, now: Date): SessionInput | null {
    const own = ownSessionsOf(input, now.getTime());
    if (input.chosenSessionId != null) {
        const given = own.find((s) => s.id === input.chosenSessionId);
        if (given) return given;
    }
    return earliestSession(own);
}

/**
 * 처음 고른 세션(own 중 가장 이른 것)이 기계로 판정될 때 다시 판정할 세션.
 * 사람 클릭(발송 2분 뒤, now까지)의 click_id로 찾은 자기 사이트 세션 중 가장 이른 것이고, 처음 고른 세션은 뺀다.
 *
 * 회사 메일 보안 장비가 발송 직후 링크를 열어 1초·1쪽 세션(방문자 V1)을 남기고, 사람이 몇 시간 뒤 같은 메일을
 * 자기 브라우저(V2)로 눌러 깊이 보면 found = [장비, 사람]이다. 원본 규칙은 늘 장비 세션을 골라 그 사람을 놓쳤다.
 * 사람 클릭에 직접 이어진 세션만 후보로 삼는다 (장비가 연 세션·다른 메일로 온 세션은 후보가 아니다)
 */
export function humanClickFallbackSession(
    input: Pick<SendJourneyInput, "sentAt" | "clicks" | "foundSessions" | "ownSiteId">,
    now: Date
): SessionInput | null {
    const nowMs = now.getTime();
    const humanClickIds = new Set<string>();
    for (const c of input.clicks) {
        if (c.clickId && c.clickedAt.getTime() <= nowMs && isHumanClick(input.sentAt, c.clickedAt)) {
            humanClickIds.add(c.clickId);
        }
    }
    if (humanClickIds.size === 0) return null;
    const own = ownSessionsOf({ foundSessions: input.foundSessions, ownSiteId: input.ownSiteId }, nowMs);
    const first = earliestSession(own);
    return earliestSession(
        own.filter((s) => s.id !== first?.id && s.clickId !== null && humanClickIds.has(s.clickId))
    );
}

/**
 * 제출·가입 신호 (설계 3절 "제출·가입"의 이벤트 규칙): SUBMIT 이름의 CLICK·CUSTOM,
 * PAGE_VIEW `/signup/complete`, PAGE_VIEW `/main/`(앱 사용 = 이미 계정 있음)
 */
export function isSubmitSignal(e: Pick<EventInput, "eventType" | "eventName" | "pageUrl">): boolean {
    if (e.eventType === "PAGE_VIEW") {
        const path = pathOf(e.pageUrl);
        return path.startsWith("/signup/complete") || path.startsWith("/main/");
    }
    if (e.eventType === "CLICK" || e.eventType === "CUSTOM") return SUBMIT_RE.test(e.eventName ?? "");
    return false;
}

// ============================================
// 판정
// ============================================

/** 설계 3절 판정 전부. now 이후의 이벤트·세션은 무시한다 */
export function evaluateSend(input: SendJourneyInput, now: Date): JourneyVerdict {
    const nowMs = now.getTime();
    const sentMs = input.sentAt.getTime();

    const clickTimes = input.clicks.map((c) => c.clickedAt.getTime()).filter((t) => t <= nowMs);
    const humanTimes = clickTimes.filter((t) => t - sentMs > HUMAN_CLICK_AFTER_MS);
    const firstHumanMs = minTime(humanTimes);
    const hasHumanClick = firstHumanMs !== null;

    const found = input.foundSessions.filter((s) => s.startedAt.getTime() <= nowMs);
    const own = ownSessionsOf(input, nowMs);
    const sisterSiteOnly = found.length > 0 && own.length === 0;
    const chosen = pickChosenSession(input, now);

    const startMs = minTime(clickTimes) ?? (chosen ? chosen.startedAt.getTime() : null);

    const verdict: JourneyVerdict = {
        sisterSiteOnly,
        chosenSession: chosen,
        start: startMs === null ? null : new Date(startMs),
        hasHumanClick,
        firstHumanClickAt: firstHumanMs === null ? null : new Date(firstHumanMs),
        machine: false,
        machineReason: null,
        existingVisitor: false,
        pages: 0,
        revisit: false,
        firstSessionDurationSec: 0,
        browsed: false,
        sawCases: false,
        sawPrice: false,
        sawDetail: false,
        action: false,
        actionNames: [],
        signupStart: false,
        signupScreen: false,
        aiStart: false,
        coupon: false,
        submitted: false,
        appUse: false,
        sections: [],
        clickNames: [],
        customNames: [],
        pagePaths: [],
        lastActivityAt: null,
        deepestStage: 0,
    };
    if (!chosen || startMs === null) return verdict;

    const chosenMs = chosen.startedAt.getTime();

    // 고른 세션이 visitorSessions에 빠져 있어도 같이 센다
    const byId = new Map<number, SessionInput>();
    for (const s of [chosen, ...input.visitorSessions]) {
        if (s.visitorId === chosen.visitorId && s.startedAt.getTime() <= nowMs && !byId.has(s.id)) byId.set(s.id, s);
    }
    const sessions = [...byId.values()];
    const later = sessions.filter((s) => {
        const d = s.startedAt.getTime() - chosenMs;
        return d > 0 && d <= ACTIVITY_WINDOW_MS;
    });

    const pages = pageCountOf(chosen) + later.reduce((sum, s) => sum + pageCountOf(s), 0);
    // 체험 화면 새 탭 세션·0쪽 세션은 다시 온 것으로 치지 않는다
    const revisit = later.some((s) => s.startedAt.getTime() - chosenMs >= REVISIT_AFTER_MS && pageCountOf(s) >= 1);
    const dur0 = chosen.duration ?? 0;

    const events = input.visitorEvents
        .filter((e) => e.occurredAt.getTime() <= nowMs)
        .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    const sections: string[] = [];
    const clickNames: string[] = [];
    const customNames: string[] = [];
    const pagePaths: string[] = [];
    const actionNames = new Set<string>();
    let inter = 0;
    let sawCases = false;
    let sawPrice = false;
    let sawDetail = false;
    let action = false;
    let signupStart = false;
    let signupScreen = false;
    let aiStart = false;
    let coupon = false;
    let eventSubmitted = false;
    let appUse = false;

    for (const e of events) {
        const at = e.occurredAt.getTime();
        if (at < startMs || at - startMs > ACTIVITY_WINDOW_MS) continue;
        const name = e.eventName ?? "";
        // 보내기 전 재확인(deep-visitor-alert.ts)과 같은 함수로 본다
        if (isSubmitSignal(e)) eventSubmitted = true;
        if (e.eventType === "SECTION_VIEW") {
            pushUnique(sections, name);
            if (TRUST_RE.test(name)) sawCases = true;
            if (PRICE_RE.test(name)) sawPrice = true;
            if (DETAIL_SECTIONS_RE.test(name)) sawDetail = true;
        } else if (e.eventType === "PAGE_VIEW") {
            const path = pathOf(e.pageUrl);
            if (path && pagePaths[pagePaths.length - 1] !== path) pagePaths.push(path);
            if (path.startsWith("/portfolio")) sawCases = true;
            if (CONTENT_PAGE_RE.test(path)) sawDetail = true;
            if (PRICE_PAGE_RE.test(path)) sawPrice = true;
            if (path.startsWith("/signup") && !path.startsWith("/signup/complete")) {
                signupScreen = true;
                signupStart = true;
            }
            if (ACTION_PAGE_RE.test(path)) {
                action = true;
                actionNames.add("page:" + path.replace(/^\/+|\/+$/g, "").split("/")[0]);
            }
            if (path.startsWith("/main/")) appUse = true;
        } else if (e.eventType === "CLICK" || e.eventType === "CUSTOM") {
            inter += 1;
            pushUnique(e.eventType === "CLICK" ? clickNames : customNames, name);
            if (ACTION_RE.test(name)) {
                action = true;
                actionNames.add(name);
            }
            if (TRUST_RE.test(name)) sawCases = true;
            if (START_RE.test(name)) signupStart = true;
            if (AI_START_RE.test(name)) aiStart = true;
            if (COUPON_RE.test(name)) coupon = true;
        }
    }

    // 앱 화면(/main/)을 쓰면 이미 계정이 있는 사람이다 — 원본은 표시만 했지만 알림에서는 제출로 본다
    const submitted = eventSubmitted || appUse || input.alreadyInFunnel;
    const distinctSections = sections.length;
    const browsed = pages >= 2 || dur0 >= 30 || distinctSections >= 3;

    // 사람이 아닌 방문 거르기 (2026-10-01 고도화 리서치 검증 결과)
    const chosenSessionHasEvents = events.some(
        (e) =>
            e.sessionId === chosen.id &&
            (e.eventType === "SECTION_VIEW" || e.eventType === "CLICK" || e.eventType === "CUSTOM")
    );
    const weak = dur0 < 3 && pageCountOf(chosen) <= 1 && !chosenSessionHasEvents && !revisit && !submitted;
    // 홈→상담 두 쪽을 20~45초 만에 여는 보안 장비 모양을 거른다 → 3쪽 이상·영역 2개 이상·클릭이 있어야 사람
    const earlyOnly = !hasHumanClick && !(pages >= 3 || distinctSections >= 2 || inter > 0 || submitted);
    const foundTimes = found.map((s) => s.startedAt.getTime());
    const multiSite =
        new Set(found.map((s) => s.siteId)).size >= 2 &&
        Math.max(...foundTimes) - Math.min(...foundTimes) <= SCANNER_SPREAD_MS;
    const scanner = multiSite && !(pages >= 2 || dur0 >= 30 || distinctSections >= 3) && !submitted;
    const machineReason: JourneyVerdict["machineReason"] = earlyOnly
        ? "early_only"
        : weak
          ? "weak"
          : scanner
            ? "scanner"
            : null;

    // 메일 전부터 사이트에 오던 사람(사내 직원·시험·이미 쓰던 고객)은 메일 효과가 아니다.
    // 같은 레코드가 앞선 메일을 눌러 남긴 세션은 "메일 전 방문"이 아니다 — 원본은 첫 메일만 봐서 이 경우가 없었다.
    // 이것을 세면 1통째 메일로 여러 번 다시 온 사람(가장 뜨거운 리드)이 후속 메일에서 기존 방문자로 빠진다
    const ownMailClickIds = new Set<string>(input.sameRecordClickIds ?? []);
    for (const c of input.clicks) if (c.clickId) ownMailClickIds.add(c.clickId);
    const before = sessions.filter(
        (s) =>
            s.startedAt.getTime() < startMs - EXISTING_BEFORE_MS &&
            !(s.clickId !== null && ownMailClickIds.has(s.clickId))
    ).length;
    const existingVisitor =
        before >= EXISTING_MIN_SESSIONS || input.distinctClickedRecordsForVisitor >= EXISTING_MIN_RECORDS;

    // SECTION_VIEW는 탭을 닫을 때 몰려 오므로 판정 가능 시점을 이것으로 잰다.
    // now 뒤에 끝난 세션(미리보기에서 과거 now를 줄 때)은 now까지 이어진 것으로 본다
    let lastMs = chosenMs;
    for (const s of sessions) {
        lastMs = Math.max(lastMs, s.startedAt.getTime());
        if (s.endedAt) lastMs = Math.max(lastMs, Math.min(s.endedAt.getTime(), nowMs));
    }
    for (const e of events) lastMs = Math.max(lastMs, e.occurredAt.getTime());

    verdict.pages = pages;
    verdict.firstSessionDurationSec = dur0;
    verdict.sections = sections;
    verdict.clickNames = clickNames;
    verdict.customNames = customNames;
    verdict.pagePaths = pagePaths;
    verdict.existingVisitor = existingVisitor;
    verdict.lastActivityAt = new Date(lastMs);

    if (machineReason) {
        // 원본처럼 단계 표시는 모두 끈다 (기계 방문은 "사이트 도착"도 아니다). 본 목록은 미리보기에서 이유를 보이려고 남긴다
        verdict.machine = true;
        verdict.machineReason = machineReason;
        return verdict;
    }

    verdict.revisit = revisit;
    verdict.browsed = browsed;
    verdict.sawCases = sawCases;
    verdict.sawPrice = sawPrice;
    verdict.sawDetail = sawDetail;
    verdict.action = action;
    verdict.actionNames = [...actionNames].sort();
    verdict.signupStart = signupStart;
    verdict.signupScreen = signupScreen;
    verdict.aiStart = aiStart;
    verdict.coupon = coupon;
    verdict.submitted = submitted;
    verdict.appUse = appUse;

    let stage: JourneyStage = 3;
    if (browsed) stage = 4;
    if (sawCases || sawPrice || sawDetail) stage = 5;
    if (action) stage = 6;
    if (signupStart) stage = 7;
    if (submitted) stage = 8;
    verdict.deepestStage = stage;
    return verdict;
}

/**
 * evaluateSend + 사람 클릭 세션으로 다시 판정 (설계 3절 "고른 세션"의 예외, B21).
 *
 * 처음 고른 세션이 기계로 판정되고 humanClickFallbackSession이 있으면, 그 세션의 방문자 재료로 한 번 더 판정한다.
 * 다시 판정해도 기계면 처음 판정을 돌려준다. inputForSession은 그 세션 방문자의 세션·이벤트·연결 레코드로
 * 입력을 만든다 (워커는 DB에서 미리 읽어 둔 재료로, 시험은 고정 자료로)
 */
export function evaluateSendWithFallback(
    input: SendJourneyInput,
    now: Date,
    inputForSession: (session: SessionInput) => SendJourneyInput
): { input: SendJourneyInput; verdict: JourneyVerdict; usedFallback: boolean } {
    const verdict = evaluateSend(input, now);
    if (!verdict.machine) return { input, verdict, usedFallback: false };
    const alt = humanClickFallbackSession(input, now);
    if (!alt || alt.id === verdict.chosenSession?.id) return { input, verdict, usedFallback: false };
    const altInput: SendJourneyInput = { ...inputForSession(alt), chosenSessionId: alt.id };
    const altVerdict = evaluateSend(altInput, now);
    if (altVerdict.machine || altVerdict.chosenSession?.id !== alt.id) return { input, verdict, usedFallback: false };
    return { input: altInput, verdict: altVerdict, usedFallback: true };
}

/** 설계 3절 "알림 대상과 수준"·"연락 각도". 판정 가능 시점(SETTLE_MS)도 여기서 본다 */
export function decideAlert(input: SendJourneyInput, verdict: JourneyVerdict, now: Date): AlertDecision {
    const no = (reason: AlertDecision["reason"]): AlertDecision => ({ alert: false, reason, level: null, angle: null });

    if (!verdict.chosenSession) return no(verdict.sisterSiteOnly ? "sister_site_only" : "no_session");
    if (verdict.machine) return no("machine");
    if (verdict.existingVisitor) return no("existing_visitor");
    if (input.unsubscribed) return no("unsubscribed");
    if (input.alreadyInFunnel || verdict.submitted) return no("already_in_funnel");
    // 원본 목록은 5~7단계만 봐서 AI 입력만 누른 사람이 빠졌다 → 쿠폰·AI 입력도 넣는다
    if (!(verdict.deepestStage >= 5 || verdict.coupon || verdict.aiStart)) return no("not_deep");

    const last = (verdict.lastActivityAt ?? verdict.chosenSession.startedAt).getTime();
    if (last > now.getTime() - SETTLE_MS) return no("not_settled");

    const level: DeepAlertLevel = verdict.signupStart || verdict.coupon || verdict.aiStart ? "intent" : "deep";
    return { alert: true, reason: "ok", level, angle: angleOf(verdict) };
}

export function angleOf(verdict: JourneyVerdict): DeepAlertAngle {
    if (verdict.signupStart || verdict.coupon || verdict.aiStart) return "A";
    if (verdict.actionNames.some((n) => CONTACT_ACTION_RE.test(n))) return "B";
    // 쿠폰 버튼(hero-free-trial)도 trial이 들어가지만 그것은 위의 A로 이미 갔다
    if (verdict.actionNames.some((n) => DEMO_ACTION_RE.test(n) || (TRIAL_ACTION_RE.test(n) && !COUPON_RE.test(n)))) {
        return "C";
    }
    if (verdict.sawPrice) return "D";
    // 원본의 마지막 기본값 D는 디하용 "가격·쿠폰" 대본이라 다른 사업에 맞지 않았다 → E
    return "E";
}

const ANGLE_LABELS: Record<DeepAlertAngle, string> = {
    A: "A 신청 이어 하기",
    B: "B 바로 상담 일정",
    C: "C 체험 다음 단계",
    D: "D 가격 안내",
    E: "E 사례·상세 보여 주기",
};

/** 각도 글자 ("A 신청 이어 하기" 등) */
export function angleLabel(angle: DeepAlertAngle): string {
    return ANGLE_LABELS[angle];
}

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

/** 기한 시각 "M/D(요일) HH:mm" (한국 시각) */
function formatDeadlineAt(date: Date): string {
    const [md, hm] = formatKstShort(date).split(" ");
    return `${md}(${WEEKDAY_KO[kstParts(date).weekday]}) ${hm}`;
}

/**
 * 기한 글자 (근무시간 여부에 따라). 예: "1시간 안 · 10/2(금) 15:20까지". 기한 시각 규칙은 설계 3절 그대로다.
 *
 * - 근무시간 밖 카드는 다음 근무 시작(평일 09:00)에 읽힌다 → "다음 평일" 같은 상대 말 대신 날짜·요일을 쓴다
 *   (토요일에 탐지한 카드를 월요일 아침에 읽으면 "다음 평일"이 화요일로 읽혔다)
 * - 근무시간 밖 B와 C~E는 기한 시각이 같을 수 있다(12:00) → B에만 "출근하면 먼저"를 붙여 급함을 가른다
 * - "오전까지"라고 쓰고 12:00을 보이던 글자를 시각만 남겨 맞췄다
 */
export function deadlineText(angle: DeepAlertAngle, now: Date): string {
    const inHours = isBusinessHours(now);
    if (angle === "A") {
        if (inHours) return `1시간 안 · ${formatDeadlineAt(new Date(now.getTime() + HOUR_MS))}까지`;
        // 근무시간 밖 알림은 다음 근무 시작에 나가므로 그날 10:00이 기한이다
        const day = kstParts(nextBusinessStart(now)).date;
        return `출근하면 바로 · ${formatDeadlineAt(kstToDate(day, 10))}까지`;
    }
    if (angle === "B") {
        if (inHours) return `오늘 안 · ${formatDeadlineAt(kstToDate(kstParts(now).date, 18))}까지`;
        const day = kstParts(nextBusinessStart(now)).date;
        return `출근하면 먼저 · ${formatDeadlineAt(kstToDate(day, 12))}까지`;
    }
    const day = nextWeekdayYmd(kstParts(now).date);
    return `${formatDeadlineAt(kstToDate(day, 12))}까지`;
}

/** 근무시간이면 now, 밖이면 다음 평일 09:00 KST */
export function nextAlertTime(now: Date): Date {
    return nextBusinessStart(now);
}

/** existing에 이미 있는 수준들을 보고 level을 새로 만들지 (deep → intent만 올라감) */
export function isLevelUpgrade(existing: readonly DeepAlertLevel[], level: DeepAlertLevel): boolean {
    if (level === "deep") return existing.length === 0;
    return !existing.includes("intent");
}

// ============================================
// 4절 "이미 깔때기 안"·수신거부 (워커가 DB에서 읽은 줄로 판정한다)
// ============================================

/** 깔때기 단계 하나 — 기본 마케팅 깔때기의 record_field 단계 `{field, value}` */
export interface FunnelFieldStage {
    field: string;
    value: string;
}

/** record_events 한 줄이 깔때기 도달인가: type='signup'이거나 label이 깔때기 단계 값 */
export function isFunnelRecordEvent(
    event: { type: string | null; label: string | null },
    stageValues: readonly string[]
): boolean {
    if (event.type === "signup") return true;
    return event.label !== null && stageValues.includes(event.label);
}

/**
 * 레코드 하나가 깔때기 안인가 (설계 4절).
 * 깔때기가 없는 사이트는 false — 이벤트 규칙(SUBMIT·/signup/complete·/main/)만 쓴다 (evaluateSend가 본다).
 * 깔때기 도달이 record_events로만 드러나는 레코드(data에 단계 칸이 없음)도 hasFunnelEvent로 잡는다.
 */
export function isRecordInFunnel(
    stages: readonly FunnelFieldStage[],
    data: Record<string, unknown> | null | undefined,
    hasFunnelEvent: boolean
): boolean {
    if (stages.length === 0) return false;
    if (hasFunnelEvent) return true;
    if (!data) return false;
    return stages.some((st) => data[st.field] === st.value);
}

/**
 * 메일 주소 앞뒤에서 지우는 문자. SQL(`lower(btrim(x, 이 값))`)과 normalizeEmail이 같은 집합을 써야 한다 —
 * Postgres trim()은 공백만, JS trim()은 모든 공백 문자를 지워서 엑셀에서 온 "a@b.com\n"·끝 NBSP 값을 SQL이 놓쳤다.
 * 공백·탭·줄바꿈·세로 탭·폼 피드·캐리지 리턴·NBSP·전각 공백·BOM·폭 없는 공백
 */
export const EMAIL_TRIM_CHARS = " \t\n\v\f\r 　﻿​";

/** 비교용 메일 주소: 앞뒤 EMAIL_TRIM_CHARS를 지우고 소문자로 */
export function normalizeEmail(email: string | null | undefined): string {
    const s = email ?? "";
    let start = 0;
    let end = s.length;
    while (start < end && EMAIL_TRIM_CHARS.includes(s[start])) start++;
    while (end > start && EMAIL_TRIM_CHARS.includes(s[end - 1])) end--;
    return s.slice(start, end).toLowerCase();
}

export interface UnsubscribeRow {
    recordId: number | null;
    workspaceId: number | null;
    email: string | null;
}

export interface UnsubscribeIndex {
    recordIds: Set<number>;
    /** 이 워크스페이스에서 거부한 메일 (normalizeEmail 값) */
    emails: Set<string>;
}

/**
 * 수신거부 줄 → 찾아보기 표. record_id는 워크스페이스와 상관없이 막고,
 * 메일 주소는 같은 워크스페이스 줄만 막는다 (거부 범위가 워크스페이스 단위다)
 */
export function buildUnsubscribeIndex(rows: readonly UnsubscribeRow[], workspaceId: number): UnsubscribeIndex {
    const out: UnsubscribeIndex = { recordIds: new Set(), emails: new Set() };
    for (const r of rows) {
        if (r.recordId !== null) out.recordIds.add(r.recordId);
        const email = normalizeEmail(r.email);
        if (r.workspaceId === workspaceId && email) out.emails.add(email);
    }
    return out;
}

export function isUnsubscribedBy(index: UnsubscribeIndex, recordId: number, email: string | null | undefined): boolean {
    if (index.recordIds.has(recordId)) return true;
    const e = normalizeEmail(email);
    return e !== "" && index.emails.has(e);
}

/** 방문자 세션의 click_id → 메일 클릭 → 발송 → 레코드 한 줄 */
export interface VisitorClickLink {
    visitorId: number;
    clickId: string;
    recordId: number;
}

export interface VisitorClickSummary {
    /** 그 방문자가 메일 클릭으로 이어진 서로 다른 레코드 수 (줄이 없으면 0) */
    distinctRecords(visitorId: number): number;
    /** 그 방문자 세션에 붙은 click_id 중 그 레코드가 받은 메일의 것 */
    clickIdsFor(visitorId: number, recordId: number): string[];
}

/** 기존 방문자 판정 재료 (설계 3절): 서로 다른 레코드 수와 같은 레코드 메일의 click_id */
export function summarizeVisitorClicks(links: readonly VisitorClickLink[]): VisitorClickSummary {
    const records = new Map<number, Set<number>>();
    const clickIds = new Map<string, Set<string>>();
    for (const l of links) {
        const set = records.get(l.visitorId) ?? new Set<number>();
        set.add(l.recordId);
        records.set(l.visitorId, set);
        const key = `${l.visitorId}:${l.recordId}`;
        const ids = clickIds.get(key) ?? new Set<string>();
        ids.add(l.clickId);
        clickIds.set(key, ids);
    }
    return {
        distinctRecords: (visitorId) => records.get(visitorId)?.size ?? 0,
        clickIdsFor: (visitorId, recordId) => [...(clickIds.get(`${visitorId}:${recordId}`) ?? [])],
    };
}

// ============================================
// 보내기 직전 재확인 (설계 7절 6단계)
// ============================================

/** 같은 레코드의 이 상태 intent 줄이 있으면 deep 카드는 낡았다 */
const INTENT_COVERING_STATUSES = ["pending", "processing", "sent"];

export interface SendRecheck {
    level: DeepAlertLevel;
    /** 같은 레코드의 intent 줄 상태들 */
    intentStatuses: readonly string[];
    /** 레코드·이어진 레코드·같은 메일 레코드가 지금 깔때기 안 (설계 4절, 탐지와 같은 함수) */
    alreadyInFunnel: boolean;
    unsubscribed: boolean;
    /** 탐지 뒤 그 방문자가 제출·가입 신호(isSubmitSignal)를 남김 */
    submittedSince: boolean;
}

/**
 * 근무시간 밖에 탐지한 줄은 다음 평일 09:00까지(최대 약 63시간) 기다린다. 그 사이 가입·수신거부했거나
 * intent 카드가 새로 생겼으면 낡은 카드를 보내지 않는다. 보내지 않을 이유(last_error에 남김), 보낼 거면 null
 */
export function recheckSkipReason(r: SendRecheck): string | null {
    if (r.unsubscribed) return "보내기 전 재확인: 수신거부";
    if (r.alreadyInFunnel || r.submittedSince) return "보내기 전 재확인: 이미 가입·신청함";
    if (r.level === "deep" && r.intentStatuses.some((s) => INTENT_COVERING_STATUSES.includes(s))) {
        return "보내기 전 재확인: 같은 레코드에 intent 알림이 있음";
    }
    return null;
}

/** 목록을 seed번째부터 돌려 세운다 — 탐지가 예산에 걸려도 늘 같은 워크스페이스만 굶지 않게 */
export function rotateStart<T>(list: readonly T[], seed: number): T[] {
    if (list.length === 0) return [];
    const k = ((Math.floor(seed) % list.length) + list.length) % list.length;
    return [...list.slice(k), ...list.slice(0, k)];
}

// ============================================
// 카드
// ============================================

const CAP_PAGES = 12;
const CAP_SECTIONS = 15;
const CAP_CLICKS = 15;
const CAP_CUSTOM = 10;
const CAP_EMAILS = 8;
const CAP_STATUS = 8;
const CAP_MEMOS = 3;
const FIELD_VALUE_MAX = 120;
const FIELD_LABEL_MAX = 40;
const RESEARCH_DESC_MAX = 200;
const MEMO_MAX = 200;
/**
 * 사이트 활동 항목 하나(경로·영역·버튼 이름)와 그 목록 한 줄의 상한.
 * 블로그·인사이트 글처럼 한글 슬러그 주소는 퍼센트 인코딩된 채 수백 자가 된다 — 항목 길이를 자르지 않으면
 * "본 페이지" 한 줄이 3,800자를 다 먹어 뒤의 CRM 정보·받은 메일·메모가 통째로 잘렸다
 */
const ACTIVITY_ITEM_MAX = 80;
const ACTIVITY_LINE_MAX = 400;
const SUBJECT_MAX = 100;
const TAG_MAX = 40;
const STATUS_TEXT_MAX = 80;
export const MESSAGE_TRUNCATION_NOTE = "… 나머지는 레코드에서 보세요";
export const MESSAGE_FOOTER = '_고객에게 "사이트에서 무엇을 봤는지"는 말하지 않습니다._';

/** 사용자 값 → 한 줄 글자. `<` `>`를 바꿔 `<주소|글자>` 링크·멘션 문법이 끼어들지 못하게 한다 */
function clean(value: unknown): string {
    return String(value ?? "")
        .replace(/</g, "‹")
        .replace(/>/g, "›")
        .replace(/\s+/g, " ")
        .trim();
}

/** 글자 수로 자른다. 이모지 같은 서로게이트 쌍을 반으로 가르지 않게 코드 포인트로 센다 */
function clip(value: string, max: number): string {
    const chars = Array.from(value);
    return chars.length > max ? chars.slice(0, max).join("") + "…" : value;
}

/**
 * 앞에서부터 max개까지, 이은 길이가 maxChars를 넘지 않을 만큼만 보이고 나머지 수를 붙인다.
 * 첫 항목은 maxChars를 넘어도 넣는다 (항목은 미리 clip한다)
 */
function capJoin(items: string[], max: number, sep: string, maxChars = Number.POSITIVE_INFINITY): string {
    const shown: string[] = [];
    let length = 0;
    for (const item of items) {
        if (shown.length >= max) break;
        const add = (shown.length > 0 ? sep.length : 0) + item.length;
        if (shown.length > 0 && length + add > maxChars) break;
        shown.push(item);
        length += add;
    }
    const rest = items.length - shown.length;
    return rest > 0 ? `${shown.join(sep)} 외 ${rest}개` : shown.join(sep);
}

/** 카드에 보일 경로: 퍼센트 인코딩을 풀고(잘못된 %는 그대로) clean한 뒤 자른다. 판정은 pathOf 원문으로 한다 */
function displayPath(path: string): string {
    let decoded = path;
    try {
        decoded = decodeURI(path);
    } catch {
        // URIError (잘못된 % 순서) — 원문을 그대로 보인다
    }
    // decodeURI가 %3C %3E를 < >로 풀므로 clean을 반드시 그 뒤에 한다
    return clip(clean(decoded), ACTIVITY_ITEM_MAX);
}

/** 사이트 활동 항목 이름 (영역·버튼·CUSTOM) */
function activityItem(value: string): string {
    return clip(clean(value), ACTIVITY_ITEM_MAX);
}

/** 표(Record) 값 찾기 — 자기 키만 본다 ("constructor" 같은 이름이 Object 원형 함수를 꺼내지 않게) */
function ownText(map: Record<string, string> | null | undefined, key: string): string | undefined {
    if (!map || !Object.prototype.hasOwnProperty.call(map, key)) return undefined;
    const value = map[key];
    return typeof value === "string" && value ? value : undefined;
}

// ── 연락 요약 (카드 둘째 줄) ──

export type ContactKind = "name" | "phone" | "email" | "company";

const NAME_KEY_RE = /^(contact_?name|customer_?name|manager_?name|person_?name|full_?name|name|ceo_?name|representative)$/i;
const NAME_LABEL_RE = /^(담당자|담당자명|담당자 이름|담당자 성함|고객명|고객 이름|이름|성함|성명|대표자|대표자명|대표|신청자|신청자명)$/;
const COMPANY_KEY_RE = /^(company|company_?name|corp_?name|corporation|business_?name|org_?name|organization|brand_?name)$/i;
const COMPANY_LABEL_RE = /^(회사|회사명|회사 이름|업체|업체명|기업|기업명|상호|상호명|법인명|브랜드|브랜드명)$/;
const PHONE_HINT_RE = /(전화|연락처|휴대|핸드폰|phone|mobile|tel)/i;
const EMAIL_HINT_RE = /(메일|e-?mail)/i;
const EMAIL_VALUE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_VALUE_RE = /^\+?[\d\s().-]+$/;
const NAME_MAX = 20;
const CONTACT_CAP = 6;
const CONTACT_LINE_MAX = 300;

/**
 * 칸 하나가 연락 요약의 무엇인가. 메일·전화는 칸 형식(field_type)으로 정한다.
 * 형식이 text(또는 모름)인 칸은 키·라벨로 이름·회사를 고르고, 메일·전화는 라벨 힌트와 값 모양이 둘 다 맞을 때만 고른다
 * ("이메일 수신 동의: 예" 같은 칸이 메일로 잡히지 않게). 아무것도 아니면 null
 */
export function contactKindOf(field: { key?: string; label: string; fieldType?: string; value: string }): ContactKind | null {
    if (field.fieldType === "email") return "email";
    if (field.fieldType === "phone") return "phone";
    if (field.fieldType !== undefined && field.fieldType !== "text") return null;
    const key = (field.key ?? "").trim();
    const label = field.label.trim();
    const value = field.value.trim();
    if (NAME_KEY_RE.test(key) || NAME_LABEL_RE.test(label)) return "name";
    if (COMPANY_KEY_RE.test(key) || COMPANY_LABEL_RE.test(label)) return "company";
    const hint = `${key} ${label}`;
    if (EMAIL_HINT_RE.test(hint) && EMAIL_VALUE_RE.test(value)) return "email";
    if (PHONE_HINT_RE.test(hint) && PHONE_VALUE_RE.test(value) && value.replace(/\D/g, "").length >= 8) return "phone";
    return null;
}

/**
 * 카드 둘째 줄: "이름 · 전화 · 메일 · 회사". 이름·회사는 첫 칸 하나, 전화·메일은 전부(같은 값은 한 번).
 * 전화를 메일보다 앞에 둔다 — 짧고, 상담 각도(B)는 바로 거는 것이 할 일이다. 연락할 것이 없으면 ""
 * (같은 값은 *CRM 정보*에도 라벨과 함께 그대로 남는다)
 */
export function contactSummaryOf(fields: AlertEvidence["fields"]): string {
    const found: Record<ContactKind, string[]> = { name: [], phone: [], email: [], company: [] };
    for (const f of fields) {
        const kind = contactKindOf(f);
        if (!kind) continue;
        const max = kind === "name" ? NAME_MAX : kind === "company" ? TAG_MAX : FIELD_VALUE_MAX;
        const value = clip(clean(f.value), max);
        if (value && !found[kind].includes(value)) found[kind].push(value);
    }
    const items = [found.name[0], ...found.phone, ...found.email, found.company[0]].filter((x): x is string => !!x);
    // 메일·전화 칸이 아주 많은 레코드도 머리가 예산을 먹지 않게 (나머지는 CRM 정보에 있다)
    return capJoin(items, CONTACT_CAP, " · ", CONTACT_LINE_MAX);
}

function formatGap(ms: number): string {
    const sec = Math.max(0, Math.round(ms / 1000));
    if (sec < 60) return `${sec}초`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}분`;
    const h = Math.floor(min / 60);
    if (h < 24) return min % 60 ? `${h}시간 ${min % 60}분` : `${h}시간`;
    const d = Math.floor(h / 24);
    return h % 24 ? `${d}일 ${h % 24}시간` : `${d}일`;
}

function formatDwell(sec: number): string {
    const total = Math.max(0, Math.round(sec));
    const m = Math.floor(total / 60);
    return m > 0 ? `${m}분 ${total % 60}초` : `${total}초`;
}

function byTime<T>(list: readonly T[], at: (x: T) => Date): T[] {
    return [...list].sort((a, b) => at(a).getTime() - at(b).getTime());
}

function emailClickSummary(email: AlertEmailEvidence): string {
    if (email.clicks.length === 0) return "클릭 없음";
    const human = byTime(
        email.clicks.filter((c) => c.human),
        (c) => c.clickedAt
    )[0];
    const first = human ?? byTime(email.clicks, (c) => c.clickedAt)[0];
    const sameDay = email.sentAt && kstParts(email.sentAt).date === kstParts(first.clickedAt).date;
    const at = sameDay ? formatKstHm(first.clickedAt) : formatKstShort(first.clickedAt);
    return human ? `클릭 ${at} (사람)` : `클릭 ${at} (발송 직후·기계 의심)`;
}

function cutToLimit(body: string): string {
    const full = `${body}\n\n${MESSAGE_FOOTER}`;
    if (full.length <= MESSAGE_MAX_CHARS) return full;
    // 마지막 안내 줄은 자르지 않고 남긴다 — 영업 담당이 꼭 봐야 하는 줄이다
    const tail = `\n${MESSAGE_TRUNCATION_NOTE}\n\n${MESSAGE_FOOTER}`;
    let head = body.slice(0, MESSAGE_MAX_CHARS - tail.length);
    const nl = head.lastIndexOf("\n");
    // 줄 중간(링크 문법·이모지 한가운데)에서 끊지 않게 줄 단위로 자른다
    if (nl > 0) head = head.slice(0, nl);
    else if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1);
    return head.trimEnd() + tail;
}

/** 설계 5절 카드 글자. MESSAGE_MAX_CHARS 안으로 자른다 */
export function buildAlertMessage(evidence: AlertEvidence, now: Date): string {
    void now; // 시각은 모두 근거에 들어 있다. 계약상 받기만 한다
    const v = evidence.verdict;
    const blocks: string[] = [];

    // 머리 — 할 일 순서: 언제까지(기한) → 누구에게 어떻게(연락 요약) → 무엇을(사업·각도) → 어디서 보나(레코드·링크).
    // 챗 알림 미리보기에는 앞 한두 줄만 보인다 — 기한과 연락처가 거기 들어가야 카드를 열지 않고도 움직인다
    const code = clean(evidence.integratedCode);
    const recordLabel = code ? `레코드 ${code} (#${evidence.recordId})` : `레코드 #${evidence.recordId}`;
    const base = evidence.baseUrl.replace(/\/+$/, "");
    const deadline = clean(evidence.deadline);
    const contact = contactSummaryOf(evidence.fields);
    blocks.push(
        [
            deadline ? `⏰ *${deadline}*` : "",
            contact ? `👤 ${contact}` : "",
            `🔔 *${clean(evidence.businessName)} · 깊이 들어온 사람* — ${angleLabel(evidence.angle)}`,
            [recordLabel, clean(evidence.partitionName), clean(evidence.listType)].filter(Boolean).join(" · "),
            `<${base}/records?id=${evidence.recordId}|레코드 열기> · <${base}/records/${evidence.recordId}/journey|고객 여정>`,
        ]
            .filter(Boolean)
            .join("\n")
    );

    // 왜 알림이 왔나
    const clickAt = v.firstHumanClickAt ?? v.start;
    const subject = clip(clean(evidence.alertSend.subject), SUBJECT_MAX) || "(제목 없음)";
    const clickPart = clickAt
        ? `${formatKstShort(clickAt)} 클릭 (발송 ${formatGap(clickAt.getTime() - evidence.alertSend.sentAt.getTime())} 뒤)`
        : "클릭";
    const extras = [v.aiStart ? "AI 입력 시작" : "", v.coupon ? "쿠폰 버튼" : ""].filter(Boolean);
    const stageText = STAGE_LABELS[v.deepestStage] + (extras.length ? ` · ${extras.join("·")}` : "");
    blocks.push(
        [
            "*왜 알림이 왔나*",
            `메일 ${evidence.alertSend.nth}통째 "${subject}"에서 ${clickPart} → ${stageText}${v.submitted ? "" : ", 가입은 안 함"}`,
        ].join("\n")
    );

    // 사이트에서 한 일
    const first = v.chosenSession ? formatKstShort(v.chosenSession.startedAt) : "-";
    const site = [
        `*사이트에서 한 일* (첫 방문 ${first}, 체류 ${formatDwell(v.firstSessionDurationSec)}, ${v.pages}쪽${v.revisit ? ", 다시 옴" : ""})`,
    ];
    const label = (key: string): string | undefined => ownText(evidence.labels, key);
    const pages = v.pagePaths.map(displayPath).filter(Boolean);
    if (pages.length) site.push(`• 본 페이지: ${capJoin(pages, CAP_PAGES, " → ", ACTIVITY_LINE_MAX)}`);
    const sections = v.sections.map((n) => activityItem(label(`SECTION_VIEW:${n}`) ?? n)).filter(Boolean);
    if (sections.length) site.push(`• 본 영역: ${capJoin(sections, CAP_SECTIONS, ", ", ACTIVITY_LINE_MAX)}`);
    const clicks = v.clickNames
        .map((n) => activityItem(label(`CLICK:${n}`) ?? ownText(evidence.clickTexts, n) ?? n))
        .filter(Boolean);
    if (clicks.length) site.push(`• 누른 것: ${capJoin(clicks, CAP_CLICKS, ", ", ACTIVITY_LINE_MAX)}`);
    const custom = v.customNames.map((n) => activityItem(label(`CUSTOM:${n}`) ?? n)).filter(Boolean);
    if (custom.length) site.push(`• 신청 흐름: ${capJoin(custom, CAP_CUSTOM, ", ", ACTIVITY_LINE_MAX)}`);
    blocks.push(site.join("\n"));

    // CRM 정보
    const fields = evidence.fields
        .map((f) => ({ label: clip(clean(f.label), FIELD_LABEL_MAX), value: clip(clean(f.value), FIELD_VALUE_MAX) }))
        .filter((f) => f.label && f.value)
        .map((f) => `• ${f.label}: ${f.value}`);
    if (fields.length) blocks.push(["*CRM 정보*", ...fields].join("\n"));

    // 회사 조사
    const r = evidence.companyResearch;
    if (r) {
        const meta = [
            clean(r.industry) && `업종 ${clean(r.industry)}`,
            clean(r.employees) && `직원 ${clean(r.employees)}`,
            clean(r.website) && `웹사이트 ${clean(r.website)}`,
        ].filter(Boolean);
        const desc = clip(clean(r.description), RESEARCH_DESC_MAX);
        const lines = [meta.join(" · "), desc].filter(Boolean);
        if (lines.length) blocks.push(["*회사 조사*", ...lines].join("\n"));
    }

    // 받은 메일 — 번호는 전체에서의 순서라 "메일 N통째"와 맞는다
    if (evidence.emails.length) {
        const total = Math.max(evidence.alertSend.totalSends, evidence.emails.length);
        const offset = total - evidence.emails.length;
        const startIdx = Math.max(0, evidence.emails.length - CAP_EMAILS);
        const lines = evidence.emails.slice(startIdx).map((m, i) => {
            const n = offset + startIdx + i + 1;
            const tag = clip(clean(m.ruleName) || clean(m.triggerType), TAG_MAX);
            return [
                `${n}.`,
                m.sentAt ? formatKstShort(m.sentAt) : "-",
                tag ? `[${tag}]` : "",
                `${clip(clean(m.subject), SUBJECT_MAX) || "(제목 없음)"} — ${emailClickSummary(m)}${m.isAlertSend ? " ← 이번 알림" : ""}`,
            ]
                .filter(Boolean)
                .join(" ");
        });
        const head = total > CAP_EMAILS ? `(${total}통, 최근 ${CAP_EMAILS}통)` : `(${total}통)`;
        blocks.push([`*받은 메일* ${head}`, ...lines].join("\n"));
    }

    // 상태 이력 — 워커는 전부 넘긴다 (미리 자르면 "(최근 8)" 머리가 붙지 않아 보이는 줄이 전부인 것처럼 읽힌다).
    // type이 칸 키(callStatus)면 CRM 정보와 같은 칸 라벨(콜 상태)로 보인다
    if (evidence.statusHistory.length) {
        const all = byTime(evidence.statusHistory, (h) => h.occurredAt);
        const lines = all.slice(-CAP_STATUS).map((h) => {
            const lab = clip(clean(h.label), STATUS_TEXT_MAX);
            const type = clip(clean(ownText(evidence.fieldLabels, h.type) ?? h.type), STATUS_TEXT_MAX);
            return `• ${formatKstShort(h.occurredAt)} ${type}${lab ? `: ${lab}` : ""}`;
        });
        const head = all.length > CAP_STATUS ? ` (최근 ${CAP_STATUS})` : "";
        blocks.push([`*상태 이력*${head}`, ...lines].join("\n"));
    }

    // 메모 — 빈 메모를 먼저 거른 뒤 최근 3개를 고른다 (워커는 전부 넘긴다)
    const memos = byTime(evidence.memos, (m) => m.createdAt).filter((m) => clean(m.content));
    if (memos.length) {
        const lines = memos
            .slice(-CAP_MEMOS)
            .map(
                (m) =>
                    `• ${formatKstShort(m.createdAt)} ${clip(clean(m.author), TAG_MAX) || "작성자 없음"}: ${clip(clean(m.content), MEMO_MAX)}`
            );
        const head = memos.length > CAP_MEMOS ? ` (최근 ${CAP_MEMOS})` : "";
        blocks.push([`*메모*${head}`, ...lines].join("\n"));
    }

    // 같은 사람의 다른 레코드
    if (evidence.otherRecords.length) {
        const lines = evidence.otherRecords.map(
            (o) =>
                "• " +
                [
                    clip(clean(o.partitionName), TAG_MAX) || "(파티션 없음)",
                    clip(clean(o.integratedCode), TAG_MAX),
                    o.createdAt ? `(${formatKstShort(o.createdAt)})` : "",
                    clip(clean(o.stage), TAG_MAX),
                ]
                    .filter(Boolean)
                    .join(" ")
        );
        blocks.push(["*같은 사람의 다른 레코드*", ...lines].join("\n"));
    }

    if (evidence.alimtalkCount > 0) blocks.push(`*알림톡* ${evidence.alimtalkCount}건 보냄`);

    return cutToLimit(blocks.join("\n\n"));
}

// ============================================
// 미리보기를 브라우저로 열 때 (설계 7절 라우트 — 같은 결과를 읽을 수 있는 HTML로)
// ============================================

/** 미리보기 결과 (deep-visitor-alert.ts DeepAlertPreviewResult와 같은 모양 — 이 파일은 DB 쪽을 import하지 않는다) */
export interface DeepAlertPreviewView {
    candidates: number;
    items: { recordId: number; level: DeepAlertLevel; angle: DeepAlertAngle; deepestStage: number; message: string }[];
    skippedByReason: Record<string, number>;
}

const SKIP_REASON_LABELS: Record<string, string> = {
    machine: "기계 방문",
    existing_visitor: "기존 방문자",
    already_in_funnel: "이미 가입·신청",
    unsubscribed: "수신거부",
    not_deep: "깊이 부족",
    not_settled: "아직 활동 중(10분 대기)",
    already_alerted: "이미 알림 보냄",
    no_session: "방문 세션 없음",
    sister_site_only: "자매 사이트만 방문",
};

/**
 * Accept 머리글이 JSON보다 HTML을 더 원하면 true (브라우저 주소창으로 열 때).
 * text/html을 직접 적고 그 q가 JSON(application/json → application/* → *\/* 순)보다 클 때만이다.
 * 같거나 HTML을 적지 않은 요청(fetch 기본값 *\/*, API 클라이언트)은 지금처럼 JSON을 받는다
 */
export function prefersHtml(accept: string | null | undefined): boolean {
    if (!accept) return false;
    let html = 0;
    let json = -1;
    let appAny = -1;
    let any = 0;
    for (const part of accept.split(",")) {
        const [rawType, ...params] = part.split(";");
        const type = rawType.trim().toLowerCase();
        let q = 1;
        for (const p of params) {
            const m = p.trim().match(/^q=([0-9.]+)$/i);
            if (m) q = Number(m[1]);
        }
        if (!Number.isFinite(q)) q = 0;
        if (type === "text/html") html = Math.max(html, q);
        else if (type === "application/json") json = Math.max(json, q);
        else if (type === "application/*") appAny = Math.max(appAny, q);
        else if (type === "*/*") any = Math.max(any, q);
    }
    const jsonQ = json >= 0 ? json : appAny >= 0 ? appAny : any;
    return html > 0 && html > jsonQ;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/** 우리가 만든 링크 <https://…|글자> 또는 꾸밈 없는 http(s) 주소 */
const CHAT_LINK_RE = /<(https?:\/\/[^|<>\s]+)\|([^<>\n]+)>|(https?:\/\/[^\s<>"'‹›]+)/g;

/** 구글 챗 꾸밈 (*굵게* _기울임_ ~취소선~ `코드`). 이미 이스케이프한 글자에 쓴다. 앞뒤가 글자 경계일 때만 꾸민다 */
function chatInline(escaped: string): string {
    return escaped
        .replace(/`([^`\n]+)`/g, "<code>$1</code>")
        .replace(/(^|[\s(\[“;'—–-])\*([^*\n]+?)\*(?=$|[\s).,:;!?\]”&'—–-])/g, "$1<b>$2</b>")
        .replace(/(^|[\s(\[“;'—–-])_([^_\n]+?)_(?=$|[\s).,:;!?\]”&'—–-])/g, "$1<i>$2</i>")
        .replace(/(^|[\s(\[])~([^~\n]+?)~(?=$|[\s).,:;!?\]])/g, "$1<s>$2</s>");
}

function linkHtml(url: string, label: string): string {
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

/**
 * 구글 챗 text 한 통 → HTML (줄바꿈은 그대로 두고 white-space: pre-wrap으로 보인다).
 * 모든 글자를 이스케이프한 뒤 꾸밈만 태그로 바꾼다 — 사용자 값이 태그·스크립트가 되지 않는다
 */
export function chatTextToHtml(text: string): string {
    return text
        .split("\n")
        .map((line) => {
            let out = "";
            let last = 0;
            for (const m of line.matchAll(CHAT_LINK_RE)) {
                const at = m.index ?? 0;
                out += chatInline(escapeHtml(line.slice(last, at)));
                if (m[1]) {
                    out += linkHtml(m[1], m[2]);
                    last = at + m[0].length;
                } else {
                    // 주소 끝의 문장부호는 주소가 아니다
                    const url = m[3].replace(/[.,;:!?)\]]+$/, "");
                    out += linkHtml(url, url);
                    last = at + url.length;
                }
            }
            return out + chatInline(escapeHtml(line.slice(last)));
        })
        .join("\n");
}

const PREVIEW_CSS = `
:root{--bg:#f6f7f9;--card:#fff;--fg:#1f1f1f;--muted:#5f6368;--line:#e0e3e7;--link:#0b57d0;--code:#f1f3f4}
@media (prefers-color-scheme:dark){:root{--bg:#141517;--card:#1e1f22;--fg:#e8eaed;--muted:#9aa0a6;--line:#3c4043;--link:#8ab4f8;--code:#2d2e31}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 "Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif}
.wrap{max-width:780px;margin:0 auto;padding:12px 16px 40px}
.sum{font-weight:700;font-size:15px;margin:4px 0 10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:0 0 12px}
.text{white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere}
.meta,.foot{color:var(--muted);font-size:12px}
.meta{border-top:1px solid var(--line);margin-top:10px;padding-top:6px}
.foot div{margin:4px 0}
a{color:var(--link);text-decoration:none}
a:hover{text-decoration:underline}
code{font-family:Consolas,monospace;background:var(--code);padding:0 3px;border-radius:3px}
`;

function previewPage(title: string, body: string): string {
    return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title><style>${PREVIEW_CSS}</style></head>
<body><div class="wrap">${body}</div></body></html>`;
}

/**
 * 미리보기 결과 → 읽을 수 있는 HTML 한 장. JSON과 같은 내용이다 (카드 글자·수준·각도·단계·후보·건너뛴 이유).
 * 맨 위 요약은 한 줄로 짧게 두고 바로 첫 카드를 보인다 — 카드 첫 두 줄(기한·연락처)이 화면 맨 위에 오게.
 * 건너뛴 이유와 시점·안내는 맨 아래에 둔다
 */
export function renderDeepAlertPreviewHtml(
    result: DeepAlertPreviewView,
    opts: { workspaceId: number; now: Date; nowGiven: boolean }
): string {
    const skipped = Object.entries(result.skippedByReason).filter(([, n]) => n > 0);
    const skippedTotal = skipped.reduce((sum, [, n]) => sum + n, 0);
    const sum = `카드 ${result.items.length} · 후보 ${result.candidates} · 제외 ${skippedTotal}`;

    const cards = result.items.map((item) => {
        const stage = STAGE_LABELS[item.deepestStage as JourneyStage];
        const meta = [
            `레코드 #${item.recordId}`,
            `수준 ${item.level}`,
            `각도 ${angleLabel(item.angle)}`,
            `단계 ${item.deepestStage}${stage ? ` ${stage}` : ""}`,
        ].join(" · ");
        return `<article class="card"><div class="text">${chatTextToHtml(item.message)}</div><div class="meta">${escapeHtml(meta)}</div></article>`;
    });
    const empty = `<article class="card"><div class="text">지금 판정하면 나갈 카드가 없습니다.</div></article>`;

    const reasons = skipped
        .sort((a, b) => b[1] - a[1])
        .map(([reason, n]) => `${SKIP_REASON_LABELS[reason] ?? reason} ${n}`)
        .join(" · ");
    const at = `${formatDeadlineAt(opts.now)}${opts.nowGiven ? " (now로 정한 시점)" : " (지금)"}`;
    const foot = [
        reasons ? `제외 이유: ${reasons}` : "",
        `워크스페이스 ${opts.workspaceId} · 판정 시점 ${at}`,
        "미리보기는 읽기만 합니다 — 알림 표에 쓰지 않고 구글 챗으로 보내지 않습니다. 같은 주소를 Accept: application/json으로 부르면 JSON입니다.",
    ]
        .filter(Boolean)
        .map((line) => `<div>${escapeHtml(line)}</div>`)
        .join("");

    return previewPage(
        `깊이 알림 미리보기 · 워크스페이스 ${opts.workspaceId}`,
        `<div class="sum">${escapeHtml(sum)}</div><main>${cards.length ? cards.join("") : empty}</main><footer class="foot">${foot}</footer>`
    );
}

/** 미리보기 오류를 브라우저로 볼 때 (상태 코드는 JSON과 같다) */
export function renderDeepAlertPreviewErrorHtml(message: string): string {
    return previewPage("깊이 알림 미리보기", `<div class="sum">${escapeHtml(message)}</div>`);
}

// ============================================
// 설정
// ============================================

/** 설계 2절. env는 process.env 꼴 */
export function resolveAlertConfig(env: Record<string, string | undefined>): DeepAlertConfig {
    const rawMode = (env.DEEP_ALERT_MODE ?? "").trim().toLowerCase();
    // 모르는 값은 dry_run — 오타 하나로 실제 발송이 켜지거나 기록이 꺼지지 않게
    const mode: DeepAlertMode = rawMode === "off" || rawMode === "live" ? rawMode : "dry_run";

    const workspaceIds: number[] = [];
    for (const part of (env.DEEP_ALERT_WORKSPACE_IDS ?? "").split(",")) {
        const s = part.trim();
        if (!/^\d+$/.test(s)) continue;
        const n = Number(s);
        if (Number.isSafeInteger(n) && n > 0 && !workspaceIds.includes(n)) workspaceIds.push(n);
    }

    const common = (env.DEEP_ALERT_WEBHOOK_URL ?? "").trim();
    const webhookByWorkspace: Record<number, string> = {};
    for (const id of workspaceIds) {
        // 워크스페이스별 값이 있으면 그것만 본다. 잘못 적었다고 공통 스페이스로 새면 다른 사업 담당이 받게 된다
        const own = (env[`DEEP_ALERT_WEBHOOK_URL_${id}`] ?? "").trim();
        const url = own || common;
        if (/^https:\/\//i.test(url)) webhookByWorkspace[id] = url;
    }
    return { mode, workspaceIds, webhookByWorkspace };
}
