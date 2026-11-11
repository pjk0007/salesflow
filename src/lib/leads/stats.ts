import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db, memos, partitions, recordEvents, records } from "@/lib/db";

const CONVERTED = "전환";
const CLOSED = "종료";
const DAY = 24 * 60 * 60 * 1000;

export interface LeadStats {
    range: { from: string | null; to: string | null };
    totals: { leads: number; converted: number; closed: number; open: number; conversionRate: number | null };
    statusCounts: Array<{ status: string; count: number }>;
    monthly: Array<{ month: string; leads: number; converted: number }>;
    response: {
        /** 첫 댓글까지 걸린 시간(시간 단위) 중앙값 */
        medianFirstResponseHours: number | null;
        respondedWithin24h: number;
        responded: number;
    };
    conversion: {
        /** 첫 유입 → 전환까지 걸린 일수 */
        medianDays: number | null;
        averageDays: number | null;
        /** 전환일을 상태 변경 기록에서 찾은 건수 / 마지막 댓글로 추정한 건수 */
        fromHistory: number;
        inferred: number;
    };
    /** 전환된 리드가 전환 전까지 거친 연락 (종류별 평균) */
    touchesBeforeConversion: Array<{ kind: string; average: number; total: number }>;
    /** 전체 댓글 종류 분포 (댓글의 종류 태그 기준) */
    memoKinds: Array<{ kind: string; count: number }>;
    partitions: Array<{ id: number; name: string; leads: number; converted: number }>;
}

function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const s = [...values].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function monthKey(d: Date) {
    // 한국 시간 기준 월
    const k = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** 워크스페이스 리드(리드 관리 파티션) 통계 — from~to(포함) 사이에 들어온 리드만, 없으면 전체 */
export async function getLeadStats(
    orgId: string,
    workspaceId: number,
    period: { from: Date | null; to: Date | null },
): Promise<LeadStats> {
    const { from, to } = period;

    const leadPartitions = await db
        .select({ id: partitions.id, name: partitions.name })
        .from(partitions)
        .where(and(eq(partitions.workspaceId, workspaceId), eq(partitions.category, "lead")));
    const partitionIds = leadPartitions.map((p) => p.id);

    const empty: LeadStats = {
        range: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
        totals: { leads: 0, converted: 0, closed: 0, open: 0, conversionRate: null },
        statusCounts: [],
        monthly: [],
        response: { medianFirstResponseHours: null, respondedWithin24h: 0, responded: 0 },
        conversion: { medianDays: null, averageDays: null, fromHistory: 0, inferred: 0 },
        touchesBeforeConversion: [],
        memoKinds: [],
        partitions: leadPartitions.map((p) => ({ ...p, leads: 0, converted: 0 })),
    };
    if (partitionIds.length === 0) return empty;

    const leadRows = await db
        .select({
            id: records.id,
            partitionId: records.partitionId,
            status: sql<string>`coalesce(${records.data}->>'status', '')`,
            registeredAt: records.registeredAt,
        })
        .from(records)
        .where(
            and(
                eq(records.orgId, orgId),
                inArray(records.partitionId, partitionIds),
                from ? gte(records.registeredAt, from) : undefined,
                to ? lt(records.registeredAt, to) : undefined,
            ),
        );
    if (leadRows.length === 0) return empty;
    const ids = leadRows.map((r) => r.id);

    const [memoRows, statusEvents] = await Promise.all([
        db
            .select({ recordId: memos.recordId, kind: memos.kind, createdAt: memos.createdAt })
            .from(memos)
            .where(inArray(memos.recordId, ids))
            .orderBy(asc(memos.createdAt)),
        db
            .select({ recordId: recordEvents.recordId, meta: recordEvents.meta, occurredAt: recordEvents.occurredAt })
            .from(recordEvents)
            .where(and(inArray(recordEvents.recordId, ids), eq(recordEvents.type, "status")))
            .orderBy(asc(recordEvents.occurredAt)),
    ]);

    const memosBy = new Map<number, typeof memoRows>();
    for (const m of memoRows) {
        const list = memosBy.get(m.recordId) ?? [];
        list.push(m);
        memosBy.set(m.recordId, list);
    }
    // 처음 "전환"이 된 시각 (상태 변경 기록)
    const convertedAt = new Map<number, Date>();
    for (const e of statusEvents) {
        const to = (e.meta as { to?: unknown } | null)?.to;
        if (to === CONVERTED && !convertedAt.has(e.recordId)) convertedAt.set(e.recordId, e.occurredAt);
    }

    // 상태 분포
    const statusMap = new Map<string, number>();
    for (const r of leadRows) statusMap.set(r.status || "미지정", (statusMap.get(r.status || "미지정") ?? 0) + 1);

    const converted = leadRows.filter((r) => r.status === CONVERTED);
    const closed = leadRows.filter((r) => r.status === CLOSED).length;

    // 월별 유입·전환 (전환은 전환일 기준, 없으면 유입 월)
    const monthly = new Map<string, { leads: number; converted: number }>();
    const bump = (k: string, field: "leads" | "converted") => {
        const v = monthly.get(k) ?? { leads: 0, converted: 0 };
        v[field] += 1;
        monthly.set(k, v);
    };

    // 첫 응답, 전환까지 일수, 전환 전 연락 수
    const firstResponseHours: number[] = [];
    let within24h = 0;
    const conversionDays: number[] = [];
    let fromHistory = 0;
    let inferred = 0;
    const touchTotals = new Map<string, number>();

    for (const r of leadRows) {
        bump(monthKey(r.registeredAt), "leads");
        const list = memosBy.get(r.id) ?? [];
        if (list.length > 0) {
            const h = (list[0].createdAt.getTime() - r.registeredAt.getTime()) / (60 * 60 * 1000);
            if (h >= 0) {
                firstResponseHours.push(h);
                if (h <= 24) within24h += 1;
            }
        }
        if (r.status !== CONVERTED) continue;
        // 전환일: 상태 변경 기록 → 없으면 마지막 댓글 시각으로 추정
        let at = convertedAt.get(r.id) ?? null;
        if (at) fromHistory += 1;
        else if (list.length > 0) {
            at = list[list.length - 1].createdAt;
            inferred += 1;
        }
        bump(monthKey(at ?? r.registeredAt), "converted");
        if (at) {
            const d = (at.getTime() - r.registeredAt.getTime()) / DAY;
            if (d >= 0) conversionDays.push(d);
            for (const m of list) {
                if (m.createdAt.getTime() > at.getTime()) continue;
                const kind = m.kind ?? "etc";
                touchTotals.set(kind, (touchTotals.get(kind) ?? 0) + 1);
            }
        }
    }

    // 댓글에 달린 종류 태그 기준 (종류 없는 댓글은 기타)
    const kindCounts = new Map<string, number>();
    for (const m of memoRows) {
        const k = m.kind ?? "etc";
        kindCounts.set(k, (kindCounts.get(k) ?? 0) + 1);
    }

    const perPartition = new Map<number, { leads: number; converted: number }>();
    for (const r of leadRows) {
        const v = perPartition.get(r.partitionId) ?? { leads: 0, converted: 0 };
        v.leads += 1;
        if (r.status === CONVERTED) v.converted += 1;
        perPartition.set(r.partitionId, v);
    }

    const decided = converted.length + closed;
    return {
        range: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
        totals: {
            leads: leadRows.length,
            converted: converted.length,
            closed,
            open: leadRows.length - decided,
            conversionRate: leadRows.length ? converted.length / leadRows.length : null,
        },
        statusCounts: [...statusMap].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
        monthly: [...monthly].map(([month, v]) => ({ month, ...v })).sort((a, b) => a.month.localeCompare(b.month)),
        response: {
            medianFirstResponseHours: median(firstResponseHours),
            respondedWithin24h: within24h,
            responded: firstResponseHours.length,
        },
        conversion: {
            medianDays: median(conversionDays),
            averageDays: conversionDays.length ? conversionDays.reduce((a, b) => a + b, 0) / conversionDays.length : null,
            fromHistory,
            inferred,
        },
        touchesBeforeConversion: [...touchTotals]
            .map(([kind, total]) => ({ kind, total, average: converted.length ? total / converted.length : 0 }))
            .sort((a, b) => b.total - a.total),
        memoKinds: [...kindCounts].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
        partitions: leadPartitions
            .map((p) => ({ ...p, ...(perPartition.get(p.id) ?? { leads: 0, converted: 0 }) }))
            .sort((a, b) => b.leads - a.leads),
    };
}

/** 리드 파티션이 있는 워크스페이스 + 리드 수 (리드 관리 상단 탭) */
export async function getLeadWorkspaces(orgId: string) {
    const rows = await db.execute<{ id: number; name: string; icon: string | null; display_no: string | null; leads: number; new_leads: number }>(sql`
        SELECT w.id, w.name, w.icon, w.settings->>'displayNo' AS display_no,
               count(r.id)::int AS leads,
               count(r.id) FILTER (WHERE coalesce(r.data->>'status', '') IN ('', '신규'))::int AS new_leads
        FROM workspaces w
        JOIN partitions p ON p.workspace_id = w.id AND p.category = 'lead'
        LEFT JOIN records r ON r.partition_id = p.id
        WHERE w.org_id = ${orgId} AND w.hidden_at IS NULL
        GROUP BY w.id, w.name, w.icon, w.settings
        ORDER BY w.id
    `);
    return Array.from(rows).map((r) => ({ id: r.id, name: r.name, icon: r.icon, displayNo: r.display_no, leads: r.leads, newLeads: r.new_leads }));
}
