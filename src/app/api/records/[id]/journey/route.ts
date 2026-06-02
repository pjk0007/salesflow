import { NextRequest, NextResponse } from "next/server";
import {
    db,
    records,
    recordEvents,
    trackerVisitors,
    trackerEvents,
    trackerSessions,
    emailSendLogs,
    emailClickLogs,
    fieldDefinitions,
    partitions,
    workspaces,
    visitorRecordLinks,
} from "@/lib/db";
import { eq, and, inArray } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import type {
    JourneyEvent,
    JourneySummary,
    StageDuration,
    JourneyAttribution,
    AttributionTouch,
    NextAction,
} from "@/components/journey/types";
import { classifyInflow } from "@/components/journey/utils/referrer";

// 두 시각 사이 간격을 사람이 읽는 텍스트로 ("3일 7시간")
function gapText(fromIso: string, toIso: string): string {
    const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
    const days = Math.floor(ms / DAY_MS);
    const hours = Math.floor((ms % DAY_MS) / (60 * 60 * 1000));
    const mins = Math.floor((ms % (60 * 60 * 1000)) / 60000);
    if (days > 0) return `${days}일 ${hours}시간`;
    if (hours > 0) return `${hours}시간 ${mins}분`;
    return `${mins}분`;
}

const STALE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

// "로/으로" 조사 선택: 받침 없거나 ㄹ받침이면 "로", 그 외 받침이면 "으로"
function josaRo(s: string): string {
    if (!s) return "로";
    const last = s.charCodeAt(s.length - 1);
    if (last < 0xac00 || last > 0xd7a3) return "로";
    const jong = (last - 0xac00) % 28;
    // jong 0 = 받침없음, 8 = ㄹ → "로"
    return jong === 0 || jong === 8 ? "로" : "으로";
}

// record_events.type → 채널 라벨
function businessChannel(type: string): string {
    if (type === "match_stage") return "단계";
    if (type === "status") return "상태";
    if (type === "consult") return "상담";
    if (type === "signup") return "가입";
    return type;
}

// 비즈니스 이벤트가 "단계성"인지 (퍼널 계단/소요시간 계산 대상)
function isStageEvent(channel: string): boolean {
    return channel === "단계" || channel === "상태" || channel === "상담" || channel === "가입";
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;
    const recordId = Number(id);
    if (!recordId) {
        return NextResponse.json({ success: false, error: "레코드 ID가 필요합니다." }, { status: 400 });
    }

    const sp = req.nextUrl.searchParams;
    const channelFilter = sp.getAll("channel"); // business|tracker|email
    const fromParam = sp.get("from");
    const toParam = sp.get("to");
    const fromTs = fromParam ? new Date(fromParam).getTime() : null;
    const toTs = toParam ? new Date(toParam).getTime() : null;

    try {
        // record + orgId 격리
        const [record] = await db
            .select()
            .from(records)
            .where(and(eq(records.id, recordId), eq(records.orgId, user.orgId)));
        if (!record) {
            return NextResponse.json({ success: false, error: "레코드를 찾을 수 없습니다." }, { status: 404 });
        }

        const want = (s: string) => channelFilter.length === 0 || channelFilter.includes(s);
        const merge = sp.get("merge") !== "none";

        // 통합 모드: 이 record에 연결된 visitor들 → 그 visitor들이 연결된 모든 record (1-hop)
        // 그 record들의 이벤트를 한 여정으로. (파티션 경계 넘어 통합)
        let recordIds = [recordId];
        if (merge) {
            const directVisitors = await db
                .select({ visitorId: visitorRecordLinks.visitorId })
                .from(visitorRecordLinks)
                .where(eq(visitorRecordLinks.recordId, recordId));
            // tracker_visitors.record_id 직접 연결분(대표)도 visitor 후보에 포함
            const repVisitors = await db
                .select({ id: trackerVisitors.id })
                .from(trackerVisitors)
                .where(and(eq(trackerVisitors.recordId, recordId), eq(trackerVisitors.orgId, user.orgId)));
            const vIds = [...new Set([...directVisitors.map((v) => v.visitorId), ...repVisitors.map((v) => v.id)])];
            if (vIds.length) {
                const linked = await db
                    .select({ recordId: visitorRecordLinks.recordId })
                    .from(visitorRecordLinks)
                    .where(inArray(visitorRecordLinks.visitorId, vIds));
                const candidateIds = [...new Set([recordId, ...linked.map((l) => l.recordId)])];
                // orgId 격리: 같은 org의 record만
                const orgRecords = await db
                    .select({ id: records.id })
                    .from(records)
                    .where(and(inArray(records.id, candidateIds), eq(records.orgId, user.orgId)));
                recordIds = orgRecords.map((r) => r.id);
            }
        }

        // 병렬 조회 (recordIds 기반)
        const [bizEvents, visitors, sendLogs] = await Promise.all([
            want("business")
                ? db.select().from(recordEvents).where(inArray(recordEvents.recordId, recordIds))
                : Promise.resolve([]),
            want("tracker")
                ? db.select({ id: trackerVisitors.id }).from(trackerVisitors).where(
                    and(inArray(trackerVisitors.recordId, recordIds), eq(trackerVisitors.orgId, user.orgId))
                )
                : Promise.resolve([]),
            want("email")
                ? db.select().from(emailSendLogs).where(
                    and(inArray(emailSendLogs.recordId, recordIds), eq(emailSendLogs.orgId, user.orgId))
                )
                : Promise.resolve([]),
        ]);

        // tracker: record_id 직접 연결 + 링크로 연결된 visitor 모두
        const linkedVisitors = want("tracker")
            ? await db
                .select({ visitorId: visitorRecordLinks.visitorId })
                .from(visitorRecordLinks)
                .where(inArray(visitorRecordLinks.recordId, recordIds))
            : [];
        const visitorIds = [...new Set([...visitors.map((v) => v.id), ...linkedVisitors.map((v) => v.visitorId)])];
        const [trkEvents, trkSessions, clickLogs] = await Promise.all([
            visitorIds.length
                ? db.select().from(trackerEvents).where(inArray(trackerEvents.visitorId, visitorIds))
                : Promise.resolve([]),
            visitorIds.length
                ? db.select().from(trackerSessions).where(inArray(trackerSessions.visitorId, visitorIds))
                : Promise.resolve([]),
            sendLogs.length
                ? db.select().from(emailClickLogs).where(
                    inArray(emailClickLogs.sendLogId, sendLogs.map((s) => s.id))
                )
                : Promise.resolve([]),
        ]);

        // ── normalize ──
        const events: JourneyEvent[] = [];

        // business
        for (const e of bizEvents) {
            const channel = businessChannel(e.type);
            events.push({
                at: e.occurredAt.toISOString(),
                source: "business",
                channel,
                type: e.type,
                label: e.label,
                meta: (e.meta as Record<string, unknown>) ?? {},
            });
        }

        // tracker — 세션 단위 묶기
        type TrkEvent = (typeof trackerEvents.$inferSelect);
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
            const children = (eventsBySession.get(s.id) ?? []).map<JourneyEvent>((ev) => ({
                at: ev.occurredAt.toISOString(),
                source: "tracker",
                channel: "사이트",
                type: ev.eventType,
                label: ev.pageTitle ?? ev.pageUrl ?? ev.eventType,
                meta: { pageUrl: ev.pageUrl, eventName: ev.eventName, properties: ev.properties },
            }));
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
                channel: "사이트",
                type: ev.eventType,
                label: ev.pageTitle ?? ev.pageUrl ?? ev.eventType,
                meta: { pageUrl: ev.pageUrl },
            });
        }

        // email — 발송 / 열람 / 클릭
        const clicksBySend = new Map<number, typeof clickLogs>();
        for (const c of clickLogs) {
            const arr = clicksBySend.get(c.sendLogId) ?? [];
            arr.push(c);
            clicksBySend.set(c.sendLogId, arr);
        }
        for (const s of sendLogs) {
            events.push({
                at: s.sentAt.toISOString(),
                source: "email",
                channel: "메일",
                type: "email_sent",
                label: `메일 발송: ${s.subject ?? "(제목 없음)"}`,
                meta: { subject: s.subject, status: s.status },
            });
        }
        for (const c of clickLogs) {
            events.push({
                at: c.clickedAt.toISOString(),
                source: "email",
                channel: "메일",
                type: "email_click",
                label: "메일 링크 클릭",
                meta: { url: c.url },
            });
        }

        // 기간 필터 + 정렬
        let filtered = events;
        if (fromTs !== null) filtered = filtered.filter((e) => new Date(e.at).getTime() >= fromTs);
        if (toTs !== null) filtered = filtered.filter((e) => new Date(e.at).getTime() <= toTs);
        filtered.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

        const summary = await buildSummary(filtered, record, user.orgId, trkSessions, sendLogs, clickLogs);
        const attribution = buildAttribution(filtered, summary);
        const nextActions = buildNextActions(filtered, summary);

        return NextResponse.json({ success: true, data: { summary, events: filtered, attribution, nextActions } });
    } catch (error) {
        console.error("Journey fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

async function buildSummary(
    events: JourneyEvent[],
    record: typeof records.$inferSelect,
    orgId: string,
    sessions: (typeof trackerSessions.$inferSelect)[],
    sendLogs: (typeof emailSendLogs.$inferSelect)[],
    clickLogs: (typeof emailClickLogs.$inferSelect)[]
): Promise<JourneySummary> {
    const firstSeenAt = events.length ? events[0].at : null;
    const lastActiveAt = events.length ? events[events.length - 1].at : null;

    // 퍼널 단계 순서 = 추적 select 필드의 options
    const { stageOrder, stageFieldKey } = await loadStageOrder(record.partitionId, record.workspaceId);

    // 단계성 이벤트 (시간순) → 도달 단계 / 소요시간
    const stageEvents = events.filter((e) => isStageEvent(e.channel));
    const reachedStages: string[] = [];
    for (const e of stageEvents) {
        if (!reachedStages.includes(e.label)) reachedStages.push(e.label);
    }
    const stageDurations: StageDuration[] = [];
    for (let i = 1; i < stageEvents.length; i++) {
        const prev = stageEvents[i - 1];
        const cur = stageEvents[i];
        const days = Math.round((new Date(cur.at).getTime() - new Date(prev.at).getTime()) / DAY_MS);
        stageDurations.push({ from: prev.label, to: cur.label, days });
    }

    // 현재 단계 = record.data[stageFieldKey] 또는 마지막 단계 이벤트
    const data = record.data as Record<string, unknown>;
    const currentStage = (stageFieldKey && (data[stageFieldKey] as string)) ||
        (stageEvents.length ? stageEvents[stageEvents.length - 1].label : null);

    // 전환 = 퍼널 마지막 단계 도달. stageOrder 없으면 도달 단계의 마지막을 전환으로 폴백.
    let convertedAt: string | null = null;
    const lastStage = stageOrder.length
        ? stageOrder[stageOrder.length - 1]
        : (reachedStages.length ? reachedStages[reachedStages.length - 1] : null);
    if (lastStage) {
        // 그 단계의 가장 마지막 도달 이벤트
        const hits = stageEvents.filter((e) => e.label === lastStage);
        convertedAt = hits.length ? hits[hits.length - 1].at : null;
    }
    const daysToConvert =
        firstSeenAt && convertedAt
            ? Math.round((new Date(convertedAt).getTime() - new Date(firstSeenAt).getTime()) / DAY_MS)
            : null;

    // 채널 카운트
    const channels: Record<string, number> = {};
    for (const e of events) channels[e.source] = (channels[e.source] ?? 0) + 1;

    // 활동 밀도
    const visits = sessions.length || events.filter((e) => e.channel === "사이트").length;
    const emailSent = sendLogs.length;
    const emailClicks = clickLogs.length;
    const dwells = sessions.map((s) => s.duration ?? 0).filter((d) => d > 0);
    const avgDwellSec = dwells.length ? Math.round(dwells.reduce((a, b) => a + b, 0) / dwells.length) : 0;

    // 이탈
    const daysSince = lastActiveAt
        ? Math.floor((Date.now() - new Date(lastActiveAt).getTime()) / DAY_MS)
        : 0;

    // 일별 활동량
    const dailyMap = new Map<string, number>();
    for (const e of events) {
        const day = e.at.slice(0, 10);
        dailyMap.set(day, (dailyMap.get(day) ?? 0) + 1);
    }
    const dailyActivity = [...dailyMap.entries()]
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));

    return {
        firstSeenAt,
        convertedAt,
        daysToConvert,
        totalEvents: events.length,
        currentStage,
        stages: stageOrder.length ? stageOrder : reachedStages,
        reachedStages,
        stageDurations,
        firstChannel: firstInflowChannel(events) ?? (events.length ? events[0].channel : null),
        channels,
        density: {
            visits,
            emailSent,
            emailClicks,
            emailClickRate: emailSent ? Number((emailClicks / emailSent).toFixed(2)) : 0,
            avgDwellSec,
            sessions: sessions.length,
        },
        inactivity: { lastActiveAt, daysSince, isStale: daysSince >= STALE_DAYS },
        dailyActivity,
    };
}

// 추적 켠 select 필드의 옵션 순서를 퍼널 순서로
async function loadStageOrder(
    partitionId: number,
    workspaceId: number
): Promise<{ stageOrder: string[]; stageFieldKey: string | null }> {
    const [partition] = await db
        .select({ fieldTypeId: partitions.fieldTypeId })
        .from(partitions)
        .where(eq(partitions.id, partitionId));
    let resolvedTypeId = partition?.fieldTypeId ?? null;
    if (!resolvedTypeId) {
        const [ws] = await db
            .select({ defaultFieldTypeId: workspaces.defaultFieldTypeId })
            .from(workspaces)
            .where(eq(workspaces.id, workspaceId));
        resolvedTypeId = ws?.defaultFieldTypeId ?? null;
    }
    if (!resolvedTypeId) return { stageOrder: [], stageFieldKey: null };

    const tracked = await db
        .select({ key: fieldDefinitions.key, options: fieldDefinitions.options })
        .from(fieldDefinitions)
        .where(
            and(
                eq(fieldDefinitions.fieldTypeId, resolvedTypeId),
                eq(fieldDefinitions.trackHistory, 1),
                eq(fieldDefinitions.fieldType, "select")
            )
        );
    // 첫 추적 select 필드를 퍼널 기준으로 사용
    const f = tracked[0];
    return { stageOrder: (f?.options as string[]) ?? [], stageFieldKey: f?.key ?? null };
}

// 첫 사이트 세션의 유입채널 (meta.inflowChannel)
function firstInflowChannel(events: JourneyEvent[]): string | null {
    const firstSite = events.find((e) => e.source === "tracker" && e.type === "session");
    return (firstSite?.meta?.inflowChannel as string) ?? null;
}

// 어트리뷰션: 마케팅 터치(사이트 유입/메일)만 추려 First/Last/전환 + 간격
function buildAttribution(events: JourneyEvent[], summary: JourneySummary): JourneyAttribution {
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
    const conversionAt = summary.convertedAt
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
function buildNextActions(events: JourneyEvent[], summary: JourneySummary): NextAction[] {
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
