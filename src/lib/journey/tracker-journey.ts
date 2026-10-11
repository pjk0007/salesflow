import { db } from "@/lib/db";
import { trackerFunnels, trackerEventAliases, trackerEvents, trackerSessions } from "@/lib/db/schema";
import { inArray, and, eq } from "drizzle-orm";
import type {
    JourneyEvent,
    JourneySummary,
    JourneyAttribution,
    AttributionTouch,
    NextAction,
} from "@/components/journey/types";
import { classifyInflow } from "@/components/journey/utils/referrer";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const STALE_DAYS = 14;

// 두 시각 사이 간격을 사람이 읽는 텍스트로 ("3일 7시간")
export function gapText(fromIso: string, toIso: string): string {
    const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
    const days = Math.floor(ms / DAY_MS);
    const hours = Math.floor((ms % DAY_MS) / (60 * 60 * 1000));
    const mins = Math.floor((ms % (60 * 60 * 1000)) / 60000);
    if (days > 0) return `${days}일 ${hours}시간`;
    if (hours > 0) return `${hours}시간 ${mins}분`;
    return `${mins}분`;
}

// "로/으로" 조사 선택: 받침 없거나 ㄹ받침이면 "로", 그 외 받침이면 "으로"
function josaRo(s: string): string {
    if (!s) return "로";
    const last = s.charCodeAt(s.length - 1);
    if (last < 0xac00 || last > 0xd7a3) return "로";
    const jong = (last - 0xac00) % 28;
    // jong 0 = 받침없음, 8 = ㄹ → "로"
    return jong === 0 || jong === 8 ? "로" : "으로";
}

// 트래커 이벤트의 타임라인 라벨.
// CUSTOM/CLICK/SECTION_VIEW는 event_name이 핵심 정보(예: subscribe_step_2)이므로 우선.
// PAGE_VIEW는 event_name이 없으니 page_title.
function trackerEventLabel(ev: { eventType: string; eventName: string | null; pageTitle: string | null; pageUrl: string | null }): string {
    if (ev.eventType === "PAGE_VIEW") return ev.pageTitle ?? ev.pageUrl ?? ev.eventType;
    return ev.eventName ?? ev.pageTitle ?? ev.pageUrl ?? ev.eventType;
}

export type TrackerLabelMaps = {
    /** 퍼널 단계로 등록된 CUSTOM 이벤트 이름 — [단계 전환] 행으로 분리 표시 */
    funnelStageEventNames: Set<string>;
    /** event_name → 한글 라벨 (퍼널 단계 라벨 우선, 이벤트 별칭 보완) */
    customEventLabels: Map<string, string>;
};

/**
 * 사이트들의 퍼널 단계/이벤트 별칭에서 라벨 맵 구성.
 * ① 퍼널 단계 라벨(FunnelEditor) 우선, ② 이벤트 별칭 카드 보완.
 */
export async function loadTrackerLabelMaps(siteIds: number[]): Promise<TrackerLabelMaps> {
    const funnelStageEventNames = new Set<string>();
    const customEventLabels = new Map<string, string>();
    if (siteIds.length === 0) return { funnelStageEventNames, customEventLabels };

    const [funnels, aliases] = await Promise.all([
        db.select({ stages: trackerFunnels.stages })
            .from(trackerFunnels)
            .where(inArray(trackerFunnels.siteId, siteIds)),
        db.select({ eventName: trackerEventAliases.eventName, label: trackerEventAliases.label })
            .from(trackerEventAliases)
            .where(and(
                inArray(trackerEventAliases.siteId, siteIds),
                eq(trackerEventAliases.eventType, "CUSTOM"),
            )),
    ]);
    // ② 라벨 카드 먼저 (퍼널 라벨이 덮어쓰도록)
    for (const a of aliases) {
        if (a.label?.trim()) customEventLabels.set(a.eventName, a.label);
    }
    // ① 퍼널 단계 라벨 우선 적용
    for (const f of funnels) {
        for (const st of (f.stages ?? [])) {
            if (st.match?.type === "custom_event") {
                funnelStageEventNames.add(st.match.eventName);
                if (st.label?.trim()) customEventLabels.set(st.match.eventName, st.label);
            }
        }
    }
    return { funnelStageEventNames, customEventLabels };
}

type TrkEvent = typeof trackerEvents.$inferSelect;
type TrkSession = typeof trackerSessions.$inferSelect;

/**
 * 트래커 세션/이벤트 → JourneyEvent 정규화.
 * - 세션 단위로 묶고(children), 퍼널 단계 이벤트는 [단계 전환] 행으로 독립 표시.
 * - 세션에 안 묶인 이벤트는 개별 행.
 */
export function normalizeTrackerEvents(
    trkSessions: TrkSession[],
    trkEvents: TrkEvent[],
    maps: TrackerLabelMaps,
): JourneyEvent[] {
    const { funnelStageEventNames, customEventLabels } = maps;

    // CUSTOM 이벤트의 표시 라벨 — 라벨 맵 우선, 없으면 기본 라벨러.
    const customLabel = (ev: TrkEvent): string => {
        if (ev.eventType === "CUSTOM" && ev.eventName && customEventLabels.has(ev.eventName)) {
            return customEventLabels.get(ev.eventName)!;
        }
        return trackerEventLabel(ev);
    };
    const isFunnelStageEvent = (ev: TrkEvent) =>
        ev.eventType === "CUSTOM" && ev.eventName != null && funnelStageEventNames.has(ev.eventName);

    const events: JourneyEvent[] = [];
    const sessionById = new Map(trkSessions.map((s) => [s.id, s]));
    const eventsBySession = new Map<number, TrkEvent[]>();
    const looseEvents: TrkEvent[] = [];
    for (const ev of trkEvents) {
        if (ev.sessionId && sessionById.has(ev.sessionId)) {
            const arr = eventsBySession.get(ev.sessionId) ?? [];
            arr.push(ev);
            eventsBySession.set(ev.sessionId, arr);
        } else {
            looseEvents.push(ev);
        }
    }

    for (const s of trkSessions) {
        const sessionEvents = eventsBySession.get(s.id) ?? [];
        // 퍼널 단계 이벤트는 세션 children에서 빼서 [단계 전환] 행에 독립 표시.
        const stageEvents = sessionEvents.filter(isFunnelStageEvent);
        const children = sessionEvents
            .filter((ev) => !isFunnelStageEvent(ev))
            .map<JourneyEvent>((ev) => ({
                at: ev.occurredAt.toISOString(),
                source: "tracker",
                channel: "사이트",
                type: ev.eventType,
                label: customLabel(ev),
                meta: { pageUrl: ev.pageUrl, eventName: ev.eventName, properties: ev.properties },
            }));
        for (const ev of stageEvents) {
            events.push({
                at: ev.occurredAt.toISOString(),
                source: "tracker",
                channel: "단계",
                type: ev.eventType,
                label: customLabel(ev),
                meta: { pageUrl: ev.pageUrl, eventName: ev.eventName, properties: ev.properties },
            });
        }
        const inflow = classifyInflow(s.referrer, s.landingPage);
        events.push({
            at: s.startedAt.toISOString(),
            source: "tracker",
            channel: "사이트",
            type: "session",
            label: `${inflow}${josaRo(inflow)} 사이트 방문 ${children.length}페이지`,
            meta: {
                duration: s.duration,
                landingPage: s.landingPage,
                referrer: s.referrer,
                inflowChannel: inflow,
            },
            children,
            groupCount: children.length,
        });
    }
    for (const ev of looseEvents) {
        events.push({
            at: ev.occurredAt.toISOString(),
            source: "tracker",
            channel: isFunnelStageEvent(ev) ? "단계" : "사이트",
            type: ev.eventType,
            label: customLabel(ev),
            meta: { pageUrl: ev.pageUrl, eventName: ev.eventName, properties: ev.properties },
        });
    }
    return events;
}

// 첫 사이트 세션의 유입채널 (meta.inflowChannel)
export function firstInflowChannel(events: JourneyEvent[]): string | null {
    const firstSite = events.find((e) => e.source === "tracker" && e.type === "session");
    return (firstSite?.meta?.inflowChannel as string) ?? null;
}

// 어트리뷰션: 마케팅 터치(사이트 유입/메일)만 추려 First/Last/전환 + 간격
export function buildAttribution(events: JourneyEvent[], convertedAt: string | null): JourneyAttribution {
    const touches: AttributionTouch[] = [];
    for (const e of events) {
        if (e.source === "tracker" && e.type === "session") {
            touches.push({ channel: (e.meta?.inflowChannel as string) ?? "사이트", at: e.at });
        } else if (e.source === "email" && (e.type === "email_sent" || e.type === "email_click")) {
            touches.push({ channel: "메일", at: e.at });
        }
    }
    // 간격 텍스트
    for (let i = 1; i < touches.length; i++) {
        touches[i].gapText = gapText(touches[i - 1].at, touches[i].at);
    }
    const conversionAt = convertedAt
        ?? events.find((e) => e.type === "signup")?.at
        ?? null;
    return {
        firstTouch: touches[0] ?? null,
        lastTouch: touches.length ? touches[touches.length - 1] : null,
        conversionAt,
        path: touches,
    };
}

// 다음 액션 제안 (간단한 룰)
export function buildNextActions(events: JourneyEvent[], summary: JourneySummary): NextAction[] {
    const actions: NextAction[] = [];
    const now = Date.now();

    // 가입 직후 48시간 & 아직 단계 미진행 → 온보딩 콜
    const signup = events.find((e) => e.type === "signup");
    if (signup) {
        const since = now - new Date(signup.at).getTime();
        const hasStage = events.some((e) => e.channel === "단계");
        if (since <= 48 * 60 * 60 * 1000 && !hasStage) {
            actions.push({ label: "온보딩 콜 제안", reason: "가입 직후 48시간 골든타임", level: "urgent" });
        }
    }

    // 요금제 페이지 2회+ 방문 → 결정 기준 확인
    let pricingViews = 0;
    for (const e of events) {
        if (e.children) {
            pricingViews += e.children.filter((c) =>
                String((c.meta?.pageUrl as string) ?? "").includes("pricing") ||
                c.label.includes("요금제")
            ).length;
        }
    }
    if (pricingViews >= 2) {
        actions.push({ label: "결정 기준 확인 · 사례 발송", reason: `요금제 페이지 ${pricingViews}회 방문`, level: "important" });
    }

    // 무활동 → 재접촉
    if (summary.inactivity.isStale) {
        actions.push({ label: "재접촉 메일 발송", reason: `${summary.inactivity.daysSince}일 무활동`, level: "info" });
    }

    // 구독중 → 업셀/후기
    if (summary.currentStage === "구독중") {
        actions.push({ label: "후기 요청 · 업셀 검토", reason: "구독 전환 완료", level: "info" });
    }

    return actions;
}
