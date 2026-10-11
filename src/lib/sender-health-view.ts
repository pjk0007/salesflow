/**
 * 발신 건강 화면 데이터 (GET /api/email/send-health, DESIGN-SND 9절·10절) — DB.
 *
 * 회차가 남긴 하루 건강(email_health_daily, 가장 최근 날짜)·풀리지 않은 보류·발신 주소·최근 14일 사건·동기화 상태를 모은다.
 * 멤버는 볼 수 있는 명단만 (partition-access 범위 규칙). 주소·도메인은 조직 공통이라 모두 본다.
 * 받는 사람 주소는 내보내지 않는다 (숫자와 사유 코드만).
 */
import { and, eq, sql } from "drizzle-orm";
import { db, partitions, workspaces } from "@/lib/db";
import { filterAccessiblePartitions, loadOrgScopes } from "@/lib/partition-access";
import { capForDate, shiftWarmupStart, toLimitSettings, warmupDayIndex } from "@/lib/email-sender-limit-rules";
import { kstParts } from "@/lib/kst";
import { countHeldQueue } from "@/lib/partition-hold";
import { resolveSendHealthConfig, syncGate } from "@/lib/sender-health-rules";
import { resolveSendHealthOrgScope } from "@/lib/sender-health";
import { pgErrorOf } from "@/lib/email-reply-rules";
import { loadChatDeliveryStatus, type ChatDeliveryStatusRow } from "@/lib/chat-webhook-status";
import type { JWTPayload } from "@/types";

type Row = Record<string, unknown>;

async function q<T = Row>(query: ReturnType<typeof sql>): Promise<T[]> {
    return (await db.execute(query)) as unknown as T[];
}

function toIso(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    const d = v instanceof Date ? v : new Date(String(v));
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: unknown): number | null {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

export interface SendHealthView {
    mode: string;
    dsnInRate: boolean;
    isAdmin: boolean;
    generatedAt: string;
    healthDate: string | null;
    /** 0075가 아직 없다 (표 없음) */
    unavailable?: boolean;
    sync: {
        lastOkAt: string | null;
        cursor: string | null;
        initialDoneAt: string | null;
        lastError: string | null;
        lastErrorCode: string | null;
        /** 자동 조치를 미루는 까닭 (sync_stale | sync_initial) */
        gate: string | null;
        unconfirmedOld: number;
        /** NHN이 오래된 기간이라 거절해 건너뛴 창 누적 (OPS-7) */
        skippedWindowsTotal: number;
        skippedWindowsLastAt: string | null;
    } | null;
    /** 이 조직이 발신 건강 판정 대상인가 (SEND_HEALTH_ORG_IDS, OPS-2). 아니면 화면 카드를 숨긴다 */
    inScope: boolean;
    partitions: Array<{
        partitionId: number;
        name: string;
        workspaceId: number | null;
        workspaceName: string | null;
        state: string;
        evalWindow: string;
        final: number;
        failed: number;
        rateBp: number | null;
        unknown: number;
        dsnOnly: number;
        senderSide: number;
        nhnUnsub: number;
        held: boolean;
        recovered: boolean;
        unconfirmedBp: number;
        windowStart: string | null;
        evaluatedAt: string | null;
    }>;
    senders: Array<{
        profileId: number;
        email: string;
        isDefault: boolean;
        isPaused: boolean;
        pausedSource: string | null;
        pausedReason: string | null;
        pausedAt: string | null;
        healthAction: string;
        state: string | null;
        final: number;
        failed: number;
        rateBp: number | null;
        outliers: number;
        dsnOnly: number;
        /** 자동 멈춤을 풀면 오늘 한도 (웜업 미루기 반영) */
        releasePreview: { todayCap: number | null; warmupDay: number | null } | null;
    }>;
    domains: Array<{ domain: string; state: string; burst: boolean; senderSide1h: number; senderSide24h: number; final7d: number; rateBp: number | null }>;
    holds: Array<{
        id: number;
        partitionId: number;
        partitionName: string;
        workspaceId: number;
        workspaceName: string | null;
        reasonText: string;
        heldAt: string | null;
        queued: number;
    }>;
    /** 구글 챗 알림 전달 상태 — 받는 곳마다 마지막 성공·지금 문제·기다리는 알림 (WPN-5) */
    chatDelivery: ChatDeliveryStatusRow[];
    events: Array<{
        id: number;
        kind: string;
        level: string;
        mode: string;
        action: string;
        actionNote: string | null;
        entityType: string;
        entityId: number | null;
        entityKey: string | null;
        evalWindow: string | null;
        summary: string;
        createdAt: string | null;
    }>;
}

type RequestUser = Pick<JWTPayload, "userId" | "orgId" | "role">;

async function visiblePartitionIds(user: RequestUser): Promise<{ all: boolean; ids: Set<number>; names: Map<number, { name: string; workspaceId: number; workspaceName: string }> }> {
    const parts = await db
        .select({ id: partitions.id, folderId: partitions.folderId, workspaceId: partitions.workspaceId, name: partitions.name, workspaceName: workspaces.name })
        .from(partitions)
        .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
        .where(and(eq(workspaces.orgId, user.orgId)));
    const names = new Map(parts.map((p) => [p.id, { name: p.name, workspaceId: p.workspaceId, workspaceName: p.workspaceName }]));
    if (user.role !== "member") return { all: true, ids: new Set(parts.map((p) => p.id)), names };
    const orgScopes = await loadOrgScopes(user.orgId);
    const visible = filterAccessiblePartitions({ user, partitions: parts, permission: "read", orgScopes });
    return { all: false, ids: new Set(visible.map((p) => p.id)), names };
}

/** 보류 중인 명단만 (명단 목록·레코드 화면 머리 — 가볍게). 멤버는 볼 수 있는 명단만 */
export async function loadActiveHolds(user: RequestUser): Promise<{ holds: SendHealthView["holds"]; isAdmin: boolean }> {
    const isAdmin = user.role !== "member";
    try {
        const rows = await q<Row>(sql`
            SELECT h.id, h.partition_id, h.workspace_id, h.reason_text, h.held_at, p.name AS partition_name, w.name AS workspace_name, p.folder_id
            FROM email_partition_holds h
            JOIN partitions p ON p.id = h.partition_id
            JOIN workspaces w ON w.id = p.workspace_id
            WHERE h.org_id = ${user.orgId}::uuid AND w.org_id = ${user.orgId}::uuid AND h.released_at IS NULL
            ORDER BY h.held_at
        `);
        if (rows.length === 0) return { holds: [], isAdmin };
        const vis = await visiblePartitionIds(user);
        const holds: SendHealthView["holds"] = [];
        for (const r of rows) {
            const pid = num(r.partition_id);
            if (!vis.ids.has(pid)) continue;
            const c = await countHeldQueue(user.orgId, pid);
            holds.push({
                id: num(r.id),
                partitionId: pid,
                partitionName: String(r.partition_name ?? `명단 ${pid}`),
                workspaceId: num(r.workspace_id),
                workspaceName: (r.workspace_name as string | null) ?? null,
                reasonText: String(r.reason_text ?? ""),
                heldAt: toIso(r.held_at),
                queued: c.sendQueue + c.followup + c.automation,
            });
        }
        return { holds, isAdmin };
    } catch (e) {
        const code = pgErrorOf(e)?.code;
        if (code === "42P01" || code === "42703") return { holds: [], isAdmin };
        throw e;
    }
}

export async function loadSendHealthView(user: RequestUser, env: Record<string, string | undefined> = process.env): Promise<SendHealthView> {
    const config = resolveSendHealthConfig(env);
    const now = new Date();
    const isAdmin = user.role !== "member";
    const base: SendHealthView = {
        mode: config.mode,
        dsnInRate: config.dsnInRate,
        isAdmin,
        generatedAt: now.toISOString(),
        healthDate: null,
        sync: null,
        partitions: [],
        senders: [],
        domains: [],
        holds: [],
        events: [],
        chatDelivery: [],
        inScope: true,
    };
    try {
        // 판정 대상 조직이 아니면 아무것도 읽지 않는다 — 화면 카드를 숨긴다 (OPS-2)
        const scope = await resolveSendHealthOrgScope(config);
        if (scope !== "all" && !scope.includes(user.orgId)) return { ...base, inScope: false };
        return await load(user, config.mode, base, now);
    } catch (e) {
        const code = pgErrorOf(e)?.code;
        if (code === "42P01" || code === "42703") return { ...base, unavailable: true };
        throw e;
    }
}

async function load(user: RequestUser, mode: string, base: SendHealthView, now: Date): Promise<SendHealthView> {
    const orgId = user.orgId;
    const vis = await visiblePartitionIds(user);

    // ── 동기화 ──
    const syncRows = await q<Row>(sql`
        SELECT last_ok_at, update_cursor, initial_done_at, last_error, last_error_code, stats FROM email_status_sync_state WHERE org_id = ${orgId}::uuid
    `);
    const sr = syncRows[0];
    if (sr) {
        const gate = syncGate(
            {
                lastOkAt: sr.last_ok_at ? new Date(String(toIso(sr.last_ok_at))) : null,
                lastErrorCode: (sr.last_error_code as string | null) ?? null,
                initialDoneAt: sr.initial_done_at ? new Date(String(toIso(sr.initial_done_at))) : null,
            },
            now
        );
        const unconfirmed = await q<{ n: number }>(sql`
            SELECT count(*)::int AS n FROM email_send_logs
            WHERE org_id = ${orgId}::uuid AND request_id IS NOT NULL
              AND sent_at >= ${new Date(now.getTime() - 48 * 3600 * 1000).toISOString()}::timestamptz
              AND sent_at <= ${new Date(now.getTime() - 2 * 3600 * 1000).toISOString()}::timestamptz
              AND (nhn_status_code IS NULL OR nhn_status_code IN ('SST0','SST1','SST4'))
              AND COALESCE(trigger_type, '') NOT LIKE 'test%'
        `);
        base.sync = {
            lastOkAt: toIso(sr.last_ok_at),
            cursor: toIso(sr.update_cursor),
            initialDoneAt: toIso(sr.initial_done_at),
            lastError: (sr.last_error as string | null) ?? null,
            lastErrorCode: (sr.last_error_code as string | null) ?? null,
            gate,
            unconfirmedOld: num(unconfirmed[0]?.n),
            skippedWindowsTotal: num((sr.stats as Record<string, unknown> | null)?.skippedWindowsTotal),
            skippedWindowsLastAt: toIso((sr.stats as Record<string, unknown> | null)?.skippedWindowsLastAt ?? null),
        };
    }

    // ── 하루 건강 (가장 최근 날짜) ──
    const dateRow = await q<{ d: string | null }>(sql`SELECT max(health_date) AS d FROM email_health_daily WHERE org_id = ${orgId}::uuid`);
    const healthDate = dateRow[0]?.d ?? null;
    base.healthDate = healthDate;
    const daily = healthDate
        ? await q<Row>(sql`
              SELECT entity_key, workspace_id, final_count, failed_count, sender_side_count, nhn_unsub_count, unknown_count,
                     dsn_only_count, rate_bp, state, eval_window, reasons, window_start, evaluated_at
              FROM email_health_daily WHERE org_id = ${orgId}::uuid AND health_date = ${healthDate}
          `)
        : [];

    const holds = await q<Row>(sql`
        SELECT id, partition_id, workspace_id, reason_text, held_at FROM email_partition_holds
        WHERE org_id = ${orgId}::uuid AND released_at IS NULL ORDER BY held_at
    `);
    const heldIds = new Set(holds.map((h) => num(h.partition_id)));

    const sendersRows = await q<Row>(sql`SELECT * FROM email_sender_profiles WHERE org_id = ${orgId}::uuid ORDER BY id`);
    const dailyByKey = new Map(daily.map((d) => [String(d.entity_key), d]));

    for (const d of daily) {
        const key = String(d.entity_key);
        const reasons = (d.reasons ?? {}) as Record<string, unknown>;
        if (key.startsWith("p:")) {
            const pid = Number(key.slice(2));
            if (!vis.ids.has(pid)) continue;
            const info = vis.names.get(pid);
            base.partitions.push({
                partitionId: pid,
                name: info?.name ?? `명단 ${pid}`,
                workspaceId: info?.workspaceId ?? numOrNull(d.workspace_id),
                workspaceName: info?.workspaceName ?? null,
                state: String(d.state),
                evalWindow: String(d.eval_window),
                final: num(d.final_count),
                failed: num(d.failed_count),
                rateBp: numOrNull(d.rate_bp),
                unknown: num(d.unknown_count),
                dsnOnly: num(d.dsn_only_count),
                senderSide: num(d.sender_side_count),
                nhnUnsub: num(d.nhn_unsub_count),
                held: heldIds.has(pid),
                recovered: reasons.recovered === true,
                unconfirmedBp: num(reasons.unconfirmedBp),
                windowStart: toIso(d.window_start),
                evaluatedAt: toIso(d.evaluated_at),
            });
        } else if (key.startsWith("d:")) {
            base.domains.push({
                domain: key.slice(2),
                state: String(d.state),
                burst: reasons.burst === true,
                senderSide1h: num(reasons.senderSide1h),
                senderSide24h: num(reasons.senderSide24h),
                final7d: num(d.final_count),
                rateBp: numOrNull(d.rate_bp),
            });
        }
    }
    base.partitions.sort((a, b) => (a.workspaceName ?? "").localeCompare(b.workspaceName ?? "") || a.name.localeCompare(b.name));
    base.domains.sort((a, b) => a.domain.localeCompare(b.domain));

    const today = kstParts(now).date;
    for (const p of sendersRows) {
        const id = num(p.id);
        const d = dailyByKey.get(`s:${id}`);
        const reasons = (d?.reasons ?? {}) as Record<string, unknown>;
        let releasePreview: { todayCap: number | null; warmupDay: number | null } | null = null;
        if (p.is_paused === true && p.paused_source === "auto") {
            const s = toLimitSettings({
                dailyLimit: p.daily_limit,
                warmupEnabled: p.warmup_enabled,
                warmupStartCount: p.warmup_start_count,
                warmupStep: p.warmup_step,
                warmupStartedOn: p.warmup_started_on,
                sendWindowStart: p.send_window_start,
                sendWindowEnd: p.send_window_end,
                weekdaysOnly: p.weekdays_only,
                spreadEvenly: p.spread_evenly,
                isPaused: false,
            });
            const pausedAt = toIso(p.paused_at);
            const shifted = shiftWarmupStart(s, pausedAt ? kstParts(new Date(pausedAt)).date : null, today);
            const after = { ...s, warmupStartedOn: shifted };
            releasePreview = { todayCap: capForDate(after, today), warmupDay: after.warmupEnabled ? warmupDayIndex(after, today) + 1 : null };
        }
        base.senders.push({
            profileId: id,
            email: String(p.from_email ?? ""),
            isDefault: p.is_default === true,
            isPaused: p.is_paused === true,
            pausedSource: (p.paused_source as string | null) ?? null,
            pausedReason: (p.paused_reason as string | null) ?? null,
            pausedAt: toIso(p.paused_at),
            healthAction: String(p.health_action ?? "auto"),
            state: d ? String(d.state) : null,
            final: num(d?.final_count),
            failed: num(d?.failed_count),
            rateBp: numOrNull(d?.rate_bp),
            outliers: num(reasons.outliers),
            dsnOnly: num(d?.dsn_only_count),
            releasePreview,
        });
    }

    for (const h of holds) {
        const pid = num(h.partition_id);
        if (!vis.ids.has(pid)) continue;
        const info = vis.names.get(pid);
        const c = await countHeldQueue(orgId, pid);
        base.holds.push({
            id: num(h.id),
            partitionId: pid,
            partitionName: info?.name ?? `명단 ${pid}`,
            workspaceId: num(h.workspace_id),
            workspaceName: info?.workspaceName ?? null,
            reasonText: String(h.reason_text ?? ""),
            heldAt: toIso(h.held_at),
            queued: c.sendQueue + c.followup + c.automation,
        });
    }

    const events = await q<Row>(sql`
        SELECT id, kind, level, mode, action, action_note, entity_type, entity_id, entity_key, eval_window, summary, created_at
        FROM email_health_events
        WHERE org_id = ${orgId}::uuid AND created_at >= ${new Date(now.getTime() - 14 * 24 * 3600 * 1000).toISOString()}::timestamptz
        ORDER BY created_at DESC, id DESC
        LIMIT 100
    `);
    for (const e of events) {
        const type = String(e.entity_type);
        const kind = String(e.kind);
        // 멤버: 볼 수 없는 명단의 사건과 조직 전체 보고는 뺀다 (보고에는 다른 사업 명단 이름이 들어 있다)
        if (!vis.all) {
            if (kind === "report") continue;
            if (type === "partition" && !vis.ids.has(num(e.entity_id))) continue;
        }
        base.events.push({
            id: num(e.id),
            kind,
            level: String(e.level),
            mode: String(e.mode ?? mode),
            action: String(e.action),
            actionNote: (e.action_note as string | null) ?? null,
            entityType: type,
            entityId: numOrNull(e.entity_id),
            entityKey: (e.entity_key as string | null) ?? null,
            evalWindow: (e.eval_window as string | null) ?? null,
            summary: kind === "report" ? String(e.summary ?? "").split("\n")[0] : String(e.summary ?? ""),
            createdAt: toIso(e.created_at),
        });
    }
    // 알림 전달 상태는 관리자에게만 (환경 변수 이름이 들어 있다)
    if (base.isAdmin) base.chatDelivery = await loadChatDeliveryStatus(orgId);
    return base;
}
