/**
 * 깊이 들어온 사람 알림 — 묶어 읽기의 순수 도우미. DB를 모른다 (테스트가 이 파일만 import해도 커넥션이 열리지 않는다).
 *
 * 워커(deep-visitor-alert.ts)는 예전에 워크스페이스마다 사이트·최근 세션·클릭·발송·알림 수준·클릭·찾은 세션·…을
 * 따로 조회했다. 지금은 같은 조직의 워크스페이스를 한 번에 읽고, 읽은 줄을 여기서 워크스페이스별 재료로 나눈다.
 * 나눈 재료는 예전 조회 결과와 같아야 한다 — 함수마다 예전의 어느 조회와 같은지 적어 둔다.
 */
import type { FunnelStage } from "@/components/tracker/types/funnel";
import { buildTrackerLabelMaps } from "@/lib/journey/tracker-label-maps";
import type {
    ClickInput,
    DeepAlertLevel,
    FunnelFieldStage,
    SessionInput,
} from "@/lib/deep-visitor-alert-rules";

// ============================================
// 사이트 설정 (탐지 대상 조회에 JSON으로 함께 온다)
// ============================================

/** 사이트의 퍼널 한 줄 (tracker_funnels 일부) */
export interface SiteFunnel {
    id: number;
    orgId: string;
    kind: string;
    isDefault: number;
    /** timestamptz가 JSON 문자열로 온다 */
    createdAt: string;
    stages: FunnelStage[] | null;
}

/** 사이트의 이벤트 별칭 한 줄 (tracker_event_aliases 일부) */
export interface SiteAlias {
    orgId: string;
    eventType: string;
    eventName: string;
    label: string | null;
}

/**
 * 4절 깔때기 단계 — 예전 loadFunnelFieldStages와 같다: 이 조직의 기본(is_default=1) marketing 퍼널 중
 * 가장 늦게 만든 것(created_at DESC LIMIT 1)의 record_field 단계 {field, value}.
 * 만든 시각이 같으면 id가 큰 쪽 (예전 조회는 같은 시각 사이 순서를 정하지 않았다).
 */
export function funnelFieldStagesOf(funnels: readonly SiteFunnel[], orgId: string): FunnelFieldStage[] {
    let pick: SiteFunnel | null = null;
    let pickMs = Number.NEGATIVE_INFINITY;
    for (const f of funnels) {
        if (f.orgId !== orgId || f.kind !== "marketing" || f.isDefault !== 1) continue;
        const ms = new Date(f.createdAt).getTime();
        if (pick === null || ms > pickMs || (ms === pickMs && f.id > pick.id)) {
            pick = f;
            pickMs = ms;
        }
    }
    const out: FunnelFieldStage[] = [];
    for (const st of pick?.stages ?? []) {
        if (st.match?.type === "record_field" && st.match.field && st.match.value) {
            out.push({ field: st.match.field, value: st.match.value });
        }
    }
    return out;
}

/**
 * 카드의 영역·버튼·CUSTOM 이벤트 표시 이름 — 예전 loadEventLabels와 같다. 키 = `${event_type}:${event_name}`.
 * SECTION_VIEW·CLICK은 이 조직의 별칭, CUSTOM은 여정 화면 규칙(buildTrackerLabelMaps: 퍼널 단계 라벨 우선,
 * 그 사이트의 퍼널·CUSTOM 별칭 전부 — 여정 화면 조회처럼 조직으로 거르지 않는다). 줄은 id 순으로 넘긴다.
 */
export function eventLabelsOf(
    aliases: readonly SiteAlias[],
    funnels: readonly SiteFunnel[],
    orgId: string
): Record<string, string> {
    const labels: Record<string, string> = {};
    for (const a of aliases) {
        if (a.orgId !== orgId || (a.eventType !== "SECTION_VIEW" && a.eventType !== "CLICK")) continue;
        if (a.label?.trim()) labels[`${a.eventType}:${a.eventName}`] = a.label.trim();
    }
    const maps = buildTrackerLabelMaps(
        funnels,
        aliases.filter((a) => a.eventType === "CUSTOM")
    );
    for (const [name, label] of maps.customEventLabels) {
        if (label.trim()) labels[`CUSTOM:${name}`] = label.trim();
    }
    return labels;
}

/** 메일 칸 키 — 예전 loadEmailFieldKeys처럼 'email'을 맨 앞에 늘 넣고 중복을 뺀다 */
export function emailKeysOf(keys: readonly unknown[] | null | undefined): string[] {
    const out = ["email"];
    for (const k of keys ?? []) if (typeof k === "string" && !out.includes(k)) out.push(k);
    return out;
}

/** 같은 조직끼리 묶는다 (처음 나온 순서를 지킨다) — 같은 조직 워크스페이스는 조회를 같이 한다 */
export function groupByOrg<T extends { orgId: string }>(items: readonly T[]): T[][] {
    const groups = new Map<string, T[]>();
    for (const item of items) {
        const list = groups.get(item.orgId);
        if (list) list.push(item);
        else groups.set(item.orgId, [item]);
    }
    return [...groups.values()];
}

// ============================================
// 후보 줄 → 워크스페이스별 재료
// ============================================

/**
 * 후보 조회 한 줄: 최근 세션의 click_id → 클릭 → 발송(sent) → 레코드, 그 레코드의 알림 수준,
 * (intent 알림이 없는 레코드만) 그 발송의 클릭 하나와 그 클릭의 click_id로 찾은 세션 하나 (없으면 null).
 */
export interface CandidateRow {
    workspaceId: number;
    recordId: number;
    sendLogId: number;
    sentAt: Date;
    recipientEmail: string;
    hasDeep: boolean;
    hasIntent: boolean;
    clickLogId: number | null;
    clickId: string | null;
    clickedAt: Date | null;
    session: SessionInput | null;
}

export interface WorkspaceCandidates {
    /** 후보 레코드 (발송 id가 작은 것부터 처음 나온 순서) → 그 레코드의 후보 발송 id (작은 순) */
    sendIdsByRecord: Map<number, number[]>;
    /** 레코드별 이미 남긴 알림 수준 (예전 loadExistingLevels — deep·intent만) */
    existingLevels: Map<number, DeepAlertLevel[]>;
    /** 발송 (예전 sends 조회) */
    sendById: Map<number, { id: number; recordId: number; sentAt: Date; recipientEmail: string }>;
    /** 발송의 클릭 전부 (예전 clickRows, intent 없는 레코드만). 클릭 id 순 */
    clicksBySend: Map<number, ClickInput[]>;
    /** click_id → 그 click_id로 찾은 세션 (예전 foundRows). 세션 id 순 */
    sessionsByClick: Map<string, SessionInput[]>;
}

/**
 * 후보 줄을 워크스페이스별 재료로 나눈다. 줄 순서와 상관없이 같은 결과가 나오도록 id로 정렬한다
 * (예전 조회들도 순서를 정하지 않았다 — 판정은 순서에 기대지 않고, 정렬은 알림 줄 순서만 고정한다).
 */
export function splitCandidateRows(
    rows: readonly CandidateRow[],
    workspaceIds: readonly number[]
): Map<number, WorkspaceCandidates> {
    const out = new Map<number, WorkspaceCandidates>();
    for (const id of workspaceIds) {
        out.set(id, {
            sendIdsByRecord: new Map(),
            existingLevels: new Map(),
            sendById: new Map(),
            clicksBySend: new Map(),
            sessionsByClick: new Map(),
        });
    }

    const sorted = [...rows].sort(
        (a, b) =>
            a.sendLogId - b.sendLogId ||
            a.recordId - b.recordId ||
            (a.clickLogId ?? 0) - (b.clickLogId ?? 0) ||
            (a.session?.id ?? 0) - (b.session?.id ?? 0)
    );

    const clickSeen = new Map<number, Set<number>>();
    const sessionSeen = new Map<number, Map<string, Set<number>>>();
    for (const r of sorted) {
        const ws = out.get(r.workspaceId);
        if (!ws) continue;

        const sends = ws.sendIdsByRecord.get(r.recordId);
        if (!sends) ws.sendIdsByRecord.set(r.recordId, [r.sendLogId]);
        else if (!sends.includes(r.sendLogId)) sends.push(r.sendLogId);

        if (!ws.existingLevels.has(r.recordId)) {
            const levels: DeepAlertLevel[] = [];
            if (r.hasDeep) levels.push("deep");
            if (r.hasIntent) levels.push("intent");
            ws.existingLevels.set(r.recordId, levels);
        }
        if (!ws.sendById.has(r.sendLogId)) {
            ws.sendById.set(r.sendLogId, {
                id: r.sendLogId,
                recordId: r.recordId,
                sentAt: r.sentAt,
                recipientEmail: r.recipientEmail,
            });
        }

        if (r.clickLogId === null || r.clickedAt === null) continue;
        let seenClicks = clickSeen.get(r.workspaceId);
        if (!seenClicks) clickSeen.set(r.workspaceId, (seenClicks = new Set()));
        if (!seenClicks.has(r.clickLogId)) {
            seenClicks.add(r.clickLogId);
            const list = ws.clicksBySend.get(r.sendLogId) ?? [];
            list.push({ clickId: r.clickId, clickedAt: r.clickedAt });
            ws.clicksBySend.set(r.sendLogId, list);
        }

        if (r.session === null || r.clickId === null) continue;
        let byClick = sessionSeen.get(r.workspaceId);
        if (!byClick) sessionSeen.set(r.workspaceId, (byClick = new Map()));
        let seenSessions = byClick.get(r.clickId);
        if (!seenSessions) byClick.set(r.clickId, (seenSessions = new Set()));
        if (!seenSessions.has(r.session.id)) {
            seenSessions.add(r.session.id);
            const list = ws.sessionsByClick.get(r.clickId) ?? [];
            list.push(r.session);
            ws.sessionsByClick.set(r.clickId, list);
        }
    }

    // 세션은 id 순 (같은 click_id의 세션이 여러 발송 줄에 흩어져 나와도 같은 순서)
    for (const ws of out.values()) {
        for (const list of ws.sessionsByClick.values()) list.sort((a, b) => a.id - b.id);
        for (const ids of ws.sendIdsByRecord.values()) ids.sort((a, b) => a - b);
    }
    return out;
}

/** 후보 조회 한 줄을 JSON으로 받은 모양 (snake_case, 시각은 ISO 문자열) — 워커가 json_agg로 받는다 */
export interface CandidateJson {
    workspace_id: number;
    record_id: number;
    send_log_id: number;
    sent_at: string | null;
    recipient_email: string;
    has_deep: boolean | null;
    has_intent: boolean | null;
    click_log_id: number | null;
    click_id: string | null;
    clicked_at: string | null;
    s_id: number | null;
    s_site_id: number | null;
    s_visitor_id: number | null;
    s_started_at: string | null;
    s_ended_at: string | null;
    s_duration: number | null;
    s_page_count: number | null;
    s_click_id: string | null;
}

/** ISO 문자열 → Date (없거나 읽을 수 없으면 null) */
function isoToDate(value: string | null): Date | null {
    if (value === null) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * JSON 후보 줄 → CandidateRow (예전 drizzle 조회가 돌려주던 값과 같은 모양).
 * 찾은 세션은 id·사이트·방문자·시작 시각이 다 있을 때만 (LEFT JOIN이라 없으면 null).
 * 보낸 시각이 비면 예전처럼 null을 그대로 둔다 (sent 발송은 늘 시각이 있다).
 */
export function toCandidateRow(r: CandidateJson): CandidateRow {
    return {
        workspaceId: r.workspace_id,
        recordId: r.record_id,
        sendLogId: r.send_log_id,
        sentAt: isoToDate(r.sent_at) as Date,
        recipientEmail: r.recipient_email,
        hasDeep: r.has_deep === true,
        hasIntent: r.has_intent === true,
        clickLogId: r.click_log_id,
        clickId: r.click_id,
        clickedAt: isoToDate(r.clicked_at),
        session:
            r.s_id !== null && r.s_site_id !== null && r.s_visitor_id !== null && r.s_started_at !== null
                ? {
                    id: r.s_id,
                    siteId: r.s_site_id,
                    visitorId: r.s_visitor_id,
                    startedAt: isoToDate(r.s_started_at) as Date,
                    endedAt: isoToDate(r.s_ended_at),
                    duration: r.s_duration,
                    pageCount: r.s_page_count,
                    clickId: r.s_click_id,
                }
                : null,
    };
}

/** (사이트, 방문자) 키 — 여러 워크스페이스의 방문자 재료를 한 번에 읽을 때 워크스페이스(사이트)별로 가른다 */
export function siteVisitorKey(siteId: number, visitorId: number): string {
    return `${siteId}:${visitorId}`;
}

// ============================================
// 4절 재료·카드 근거
// ============================================

/**
 * 같은 메일 레코드 조회의 (워크스페이스, 주소) 짝을 칸 키마다 모은다. 주소가 없는 워크스페이스는 빠진다.
 * 칸 키 K의 짝 = K를 메일 칸으로 쓰는 워크스페이스 × 그 워크스페이스의 받는 주소 — 예전 조건
 * (워크스페이스마다 workspace_id = w AND (칸 키마다 값 IN 그 워크스페이스 주소))과 같은 짝이다.
 */
export function emailPairsByKey(
    specs: ReadonlyArray<{ workspaceId: number; keys: readonly string[]; emails: readonly string[] }>
): Map<string, { ws: number[]; emails: string[] }> {
    const out = new Map<string, { ws: number[]; emails: string[] }>();
    for (const s of specs) {
        if (s.emails.length === 0) continue;
        for (const key of new Set(s.keys)) {
            const p = out.get(key) ?? { ws: [], emails: [] };
            for (const e of s.emails) {
                p.ws.push(s.workspaceId);
                p.emails.push(e);
            }
            out.set(key, p);
        }
    }
    return out;
}

/** 칸 정의 한 줄 (카드 근거 문장이 함께 읽은 전체에서 고른다) */
export interface FieldDefJson {
    key: string;
    label: string;
    field_type: string;
    field_type_id: number | null;
    workspace_id: number | null;
}

export interface FieldDefRow {
    key: string;
    label: string;
    fieldType: string;
}

/**
 * 레코드 파티션의 칸 정의. partitions/[id]/resolved-fields와 같은 해석:
 * 파티션 fieldTypeId → 워크스페이스 defaultFieldTypeId → 없으면 워크스페이스 직속 칸. 받은 줄 순서(sort_order, id) 그대로.
 * rows는 그 해석에 쓰일 수 있는 칸 정의를 함께 읽은 것 — 예전 조회(그 타입의 칸, 또는 그 워크스페이스 칸)와 같은 줄만 고른다.
 * 같은 해석은 cache에서 꺼낸다 (카드 여러 장이 같은 타입을 쓴다).
 */
export function resolveFieldDefs(
    ws: { id: number; defaultFieldTypeId: number | null },
    partition: { fieldTypeId: number | null } | null,
    rows: readonly FieldDefJson[],
    cache: Map<string, FieldDefRow[]>
): FieldDefRow[] {
    const resolvedTypeId = partition?.fieldTypeId ?? ws.defaultFieldTypeId;
    const cacheKey = resolvedTypeId ? `type:${resolvedTypeId}` : `ws:${ws.id}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    const fields = rows
        .filter((r) => (resolvedTypeId ? r.field_type_id === resolvedTypeId : r.workspace_id === ws.id))
        .map((r) => ({ key: r.key, label: r.label, fieldType: r.field_type }));
    cache.set(cacheKey, fields);
    return fields;
}

// ============================================
// 발송
// ============================================

/**
 * 탐지 뒤 한 번 더 예약 시각이 된 줄을 집을 필요가 있나.
 * 탐지 앞 발송이 첫 집기에서 아무 줄도 못 집었고(그때 보낼 줄이 없었다), 이번 탐지가 지금 보낼 줄(pending이고
 * 예약 시각이 지금 이전)을 만들지 않았으면 집을 줄이 없다 — 알림 줄은 락을 잡은 이 워커만 pending으로 만들거나
 * 되돌린다(새 줄·되돌림·재시도 예약). 집지 않으면 빈 조회 한 번을 아낀다.
 */
export function needsPostDetectionDelivery(input: { preDeliveryClaimedAny: boolean; createdDueNow: number }): boolean {
    return input.preDeliveryClaimedAny || input.createdDueNow > 0;
}
