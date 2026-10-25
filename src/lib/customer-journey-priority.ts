/** 고객 여정의 관심도. 업종을 추측하거나 체류 시간만으로 긴급 리드를 만들지 않는다. */
import { createHash } from "node:crypto";
import { AI_START_RE, CONTENT_PAGE_RE, DETAIL_SECTIONS_RE, normalizeEmail, pathOf, START_RE, TRUST_RE, type EventInput, type SessionInput } from "./deep-visitor-alert-rules";

export const MIN_JOURNEY_SECONDS = 3;

export interface JourneyAudience {
    internal: boolean;
    sharedVisitor: boolean;
    existingVisitor: boolean;
    alreadyConverted: boolean;
    unsubscribed: boolean;
    revisit: boolean;
    lastActivityAt: Date;
}
export interface JourneyPriority {
    version: 1;
    tier: "normal" | "highlight" | "urgent";
    score: number;
    coreIcp: boolean;
    evidence: string[];
    excludedReason: string | null;
    rankEligible: boolean;
    customerKey: string;
    /** 신청 입력·AI 신청 시작 행동이 있었다 (신청 화면 조회만으로는 false). 예전에 저장한 판정에는 없다 */
    inputStarted?: boolean;
    percentile: number | null;
    cohortSize: number;
}
export interface JourneyCohortMember { customerKey: string; score: number }
type Field = { key: string; label: string; value: string };
const compact = (s: string) => s.trim().toLowerCase().replace(/[\s_-]/g, "");
const ICP_FIELDS = new Set(["icp", "icp등급", "icptier", "icpgrade", "핵심icp", "coreicp", "iscoreicp"]);
const CORE_VALUES = new Set(["핵심", "핵심icp", "core", "coreicp", "tier1", "t1", "a", "a등급", "true", "1"]);
export function isCoreIcp(fields: readonly Field[]): boolean {
    const values = fields.filter((f) => ICP_FIELDS.has(compact(f.key)) || ICP_FIELDS.has(compact(f.label))).map((f) => compact(f.value)).filter(Boolean);
    return values.length > 0 && values.every((v) => CORE_VALUES.has(v));
}
export function journeyCustomerKey(email: string): string {
    return createHash("sha256").update(normalizeEmail(email)).digest("hex");
}

/** 같은 고객의 여러 세션·중복 레코드는 한 명으로 비교한다. 동점은 상위라고 부풀리지 않는다. */
export function journeyPercentile(key: string, score: number, cohort: readonly JourneyCohortMember[]) {
    const scores = new Map<string, number>();
    for (const m of cohort) if (m.customerKey && Number.isFinite(m.score) && m.score >= 0 && m.score <= 100) {
        scores.set(m.customerKey, Math.max(scores.get(m.customerKey) ?? 0, m.score));
    }
    // 현재 방문 점수로 비교한다. 과거의 더 높은 점수로 현재 방문의 순위를 올리지 않는다.
    scores.set(key, score);
    const cohortSize = scores.size;
    const percentile = cohortSize >= 20 ? Math.floor(100 * [...scores.values()].filter((s) => s < score).length / (cohortSize - 1)) : null;
    return { percentile, cohortSize };
}

export function classifyJourneyPriority(input: {
    eligible: boolean; completed: boolean; recipientEmail: string;
    session: SessionInput; events: readonly EventInput[]; fields: readonly Field[];
    labels: Record<string, string>; totalSeconds: number | null;
    audience?: JourneyAudience; cohort?: readonly JourneyCohortMember[];
}, now: Date): JourneyPriority {
    const a = input.audience;
    const excludedReason = a?.internal ? "내부 계정"
        : a?.sharedVisitor ? "여러 고객에게 공유된 방문자"
        : a?.existingVisitor ? "메일 이전부터 반복 방문한 계정"
        : a?.unsubscribed ? "수신거부"
        : input.completed || a?.alreadyConverted ? "이미 신청·구매 완료"
        : input.totalSeconds !== null && input.totalSeconds < MIN_JOURNEY_SECONDS ? `${MIN_JOURNEY_SECONDS}초 미만 짧은 방문`
        : !input.eligible ? "방문 중이거나 자동 방문 의심" : null;
    const coreIcp = isCoreIcp(input.fields);
    const customerKey = journeyCustomerKey(input.recipientEmail);
    const events = input.events.filter((e) => e.sessionId === input.session.id && e.occurredAt >= input.session.startedAt && e.occurredAt <= now)
        .sort((x, y) => x.occurredAt.getTime() - y.occurredAt.getTime());
    const categories = new Set<"price" | "cases" | "detail">();
    let explicitStart = false, contact = false, signupPage = false;
    const activityTimes = new Set<number>();
    const seconds = Number.isFinite(input.totalSeconds) ? Math.max(0, Math.min(input.totalSeconds!, (now.getTime() - input.session.startedAt.getTime()) / 1000)) : 0;
    for (let i = 0; i < events.length; i++) {
        const e = events[i], name = e.eventName ?? "", path = pathOf(e.pageUrl);
        const label = input.labels[`${e.eventType}:${name}`] ?? "";
        const click = e.eventType === "CLICK" || e.eventType === "CUSTOM";
        if (click && (START_RE.test(name) || AI_START_RE.test(name))) explicitStart = true;
        // 소개서 다운로드·연락처 화면을 연 것만으로 상담 요청으로 승격하지 않는다.
        if (click && /(?:^|[_-])(consult|contact|demo|trial|meeting|phone)(?:[_-]|$)/i.test(name)) contact = true;
        if (e.eventType === "PAGE_VIEW" && /^\/signup(?:\/|$)/i.test(path)) signupPage = true;
        const dwell = e.properties?.dwell_ms;
        const sectionRead = e.eventType === "SECTION_VIEW" && typeof dwell === "number" && Number.isFinite(dwell) && dwell >= 10_000 && dwell <= Math.max(seconds, 10) * 1000;
        const nextView = e.eventType === "PAGE_VIEW" ? events.slice(i + 1).find((v) => v.eventType === "PAGE_VIEW") : undefined;
        const pageEnd = nextView?.occurredAt.getTime() ?? input.session.startedAt.getTime() + seconds * 1000;
        const pageRead = e.eventType === "PAGE_VIEW" && pageEnd - e.occurredAt.getTime() >= 15_000;
        if (click || sectionRead || pageRead) activityTimes.add(e.occurredAt.getTime());
        const price = /^(service-pricing|subsidy-calc-cta)$/i.test(name) || /가격|요금|견적|pricing/i.test(label);
        const cases = TRUST_RE.test(name) || /고객\s*(후기|사례)|포트폴리오|사례|reviews|cases/i.test(label);
        if ((pageRead && /^\/(pricing|plan)(?:\/|$)/i.test(path)) || (sectionRead && price)) categories.add("price");
        else if ((pageRead && /^\/portfolio(?:\/|$)/i.test(path)) || (sectionRead && cases) || (click && TRUST_RE.test(name))) categories.add("cases");
        else if ((pageRead && CONTENT_PAGE_RE.test(path)) || (sectionRead && (DETAIL_SECTIONS_RE.test(name) || /FAQ|도입\s*절차|서비스\s*(소개|종류)|how.it.works/i.test(label)))) categories.add("detail");
    }
    const times = [...activityTimes];
    const activitySpan = times.length >= 3 ? Math.max(...times) - Math.min(...times) : 0;
    const engagement = seconds >= 120 && activitySpan >= 90_000 ? 15 : seconds >= 60 && activitySpan >= 30_000 ? 10 : 0;
    const intent = explicitStart ? 40 : contact ? 30 : signupPage ? 15 : 0;
    const score = excludedReason ? 0 : Math.min(100, intent + categories.size * 10 + engagement + (a?.revisit ? 10 : 0) + (coreIcp ? 10 : 0));
    const rank = journeyPercentile(customerKey, score, input.cohort ?? []);
    const evidence = [
        ...(coreIcp ? ["CRM에 핵심 ICP로 분류됨"] : []),
        ...(explicitStart ? ["신청 입력·AI 신청 시작 행동"] : contact ? ["상담·데모·체험 버튼 클릭"] : signupPage ? ["신청 화면 확인 (입력 시작은 미확인)"] : []),
        ...[...categories].map((c) => ({ price: "가격·요금 검토", cases: "사례·후기 검토", detail: "서비스 상세·FAQ 검토" })[c]),
        ...(engagement ? [`${seconds >= 120 ? "2분" : "1분"} 이상 체류와 시간 간격이 있는 복수 활동`] : []),
        ...(a?.revisit ? ["같은 고객의 메일로 30분 이상 간격을 두고 재방문"] : []),
    ];
    const strong = (explicitStart || contact) && categories.size >= 2 && engagement === 15;
    const urgent = !excludedReason && strong && score >= 75 && (coreIcp || (rank.percentile !== null ? rank.percentile >= 95 : score >= 85));
    const highlight = !excludedReason && (coreIcp || intent >= 30 || (score >= 35 && categories.size >= 2));
    return { version: 1, tier: urgent ? "urgent" : highlight ? "highlight" : "normal", score, coreIcp,
        evidence: excludedReason ? [] : evidence, excludedReason, rankEligible: !excludedReason, customerKey, inputStarted: explicitStart, ...rank };
}

export { PRIORITY_LABELS } from "../components/lead-followup/utils/labels";
