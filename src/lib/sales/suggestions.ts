import { and, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { db, records, salesActionItems, salesMeetings, salesRules, users } from "@/lib/db";
import type { OrgRole } from "@/types";
import { visibleSalesPartitions } from "./leads";

type User = { userId: string; orgId: string; role: OrgRole };
const DAY = 86_400_000;

// ─── 규칙 ───────────────────────────────────────────────────────────
export const RULE_DEFAULTS = {
    /** 오래 연락 안 함 — 마지막 연락(미팅·끝낸 할 일·등록) 후 days일 지나면 안부 연락 추천 */
    dormant: { enabled: true, days: 60 },
    /** 명절 인사 — 설·추석 daysBefore일 전부터 인사 추천 */
    holiday: { enabled: true, daysBefore: 7 },
} as const;
export type RuleKind = keyof typeof RULE_DEFAULTS;
export type Rules = { dormant: { enabled: boolean; days: number }; holiday: { enabled: boolean; daysBefore: number } };

/** 설·추석 (양력, 연휴 중 당일) */
export const HOLIDAYS = [
    { key: "2027-seollal", name: "설날", date: "2027-02-07" },
    { key: "2027-chuseok", name: "추석", date: "2027-09-15" },
    { key: "2028-seollal", name: "설날", date: "2028-01-27" },
    { key: "2028-chuseok", name: "추석", date: "2028-10-03" },
    { key: "2026-chuseok", name: "추석", date: "2026-09-25" },
];

export async function getRules(orgId: string): Promise<Rules> {
    const rows = await db.select().from(salesRules).where(eq(salesRules.orgId, orgId));
    const by = new Map(rows.map((r) => [r.kind, r]));
    const d = by.get("dormant");
    const h = by.get("holiday");
    return {
        dormant: { enabled: d ? d.enabled : RULE_DEFAULTS.dormant.enabled, days: Number(d?.params.days) || RULE_DEFAULTS.dormant.days },
        holiday: { enabled: h ? h.enabled : RULE_DEFAULTS.holiday.enabled, daysBefore: Number(h?.params.daysBefore) || RULE_DEFAULTS.holiday.daysBefore },
    };
}

export async function saveRule(orgId: string, kind: RuleKind, enabled: boolean, params: Record<string, unknown>) {
    await db
        .insert(salesRules)
        .values({ orgId, kind, enabled, params })
        .onConflictDoUpdate({ target: [salesRules.orgId, salesRules.kind], set: { enabled, params, updatedAt: new Date() } });
}

// ─── 추천 만들기 ──────────────────────────────────────────────────────
const kstDate = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
const at9 = (ymd: string) => new Date(`${ymd}T09:00:00+09:00`);
const addDays = (ymd: string, n: number) => kstDate(new Date(at9(ymd).getTime() + n * DAY));

/**
 * 볼 수 있는 영업 리드에 규칙을 돌려 새 추천을 만든다. 같은 추천을 두 번 만들지 않는다.
 * - 오래 연락 안 함: 안 끝난 할 일이 있으면 건너뜀, 마지막 연락 이후 이미 만든(또는 건너뛴) 추천이 있으면 건너뜀
 * - 명절 인사: 같은 명절 추천이 이미 있으면 건너뜀
 */
export async function generateSuggestions(user: User) {
    const rules = await getRules(user.orgId);
    const parts = await visibleSalesPartitions(user);
    if (parts.length === 0) return { created: 0 };
    const leads = await db
        .select({ id: records.id, data: records.data, registeredAt: records.registeredAt })
        .from(records)
        .where(and(eq(records.orgId, user.orgId), inArray(records.partitionId, parts.map((p) => p.id))));
    if (leads.length === 0) return { created: 0 };
    const ids = leads.map((l) => l.id);

    const [meetings, items] = await Promise.all([
        db
            .select({ recordId: salesMeetings.recordId, lastMet: max(salesMeetings.metAt), title: sql<string>`(array_agg(${salesMeetings.title} ORDER BY ${salesMeetings.metAt} DESC))[1]` })
            .from(salesMeetings)
            .where(inArray(salesMeetings.recordId, ids))
            .groupBy(salesMeetings.recordId),
        db
            .select({
                recordId: salesActionItems.recordId,
                status: salesActionItems.status,
                ruleKey: salesActionItems.ruleKey,
                doneAt: salesActionItems.doneAt,
                createdAt: salesActionItems.createdAt,
            })
            .from(salesActionItems)
            .where(inArray(salesActionItems.recordId, ids)),
    ]);
    const meetingBy = new Map(meetings.map((m) => [m.recordId, m]));
    const today = kstDate(new Date());
    const inserts: Array<typeof salesActionItems.$inferInsert> = [];

    for (const lead of leads) {
        const d = (lead.data ?? {}) as Record<string, unknown>;
        const owner = typeof d.owner === "string" && d.owner ? d.owner : null;
        const mine = items.filter((i) => i.recordId === lead.id);
        const m = meetingBy.get(lead.id);
        const doneTimes = mine.filter((i) => i.status === "open" && i.doneAt).map((i) => i.doneAt!.getTime());
        const last = Math.max(lead.registeredAt.getTime(), m?.lastMet?.getTime() ?? 0, ...doneTimes);

        // 오래 연락 안 함
        if (rules.dormant.enabled) {
            const days = Math.floor((Date.now() - last) / DAY);
            const hasOpen = mine.some((i) => i.status === "open" && !i.doneAt);
            const already = mine.some((i) => i.ruleKey === "dormant" && i.createdAt.getTime() > last);
            if (days >= rules.dormant.days && !hasOpen && !already) {
                inserts.push({
                    orgId: user.orgId,
                    recordId: lead.id,
                    content: "안부 연락하기",
                    ownerId: owner,
                    dueAt: at9(addDays(today, 3)),
                    status: "suggested",
                    ruleKey: "dormant",
                    reason: `마지막 연락 ${days}일 전${m?.title ? ` · 지난 미팅 '${m.title}'` : m?.lastMet ? ` · 지난 미팅 ${kstDate(m.lastMet)}` : ""}`,
                });
            }
        }

        // 명절 인사
        if (rules.holiday.enabled) {
            for (const h of HOLIDAYS) {
                const from = addDays(h.date, -rules.holiday.daysBefore);
                if (today < from || today > h.date) continue;
                const key = `holiday:${h.key}`;
                if (mine.some((i) => i.ruleKey === key)) continue;
                const due = addDays(h.date, -2) < today ? today : addDays(h.date, -2);
                inserts.push({
                    orgId: user.orgId,
                    recordId: lead.id,
                    content: `${h.name} 인사 보내기`,
                    ownerId: owner,
                    dueAt: at9(due),
                    status: "suggested",
                    ruleKey: key,
                    reason: `${h.name}(${h.date.slice(5).replace("-", "/")})이 다가와요`,
                });
            }
        }
    }
    if (inserts.length) await db.insert(salesActionItems).values(inserts);
    return { created: inserts.length };
}

/** 아직 처리 안 한 추천 목록 (담당자·기업 정보 포함) */
export async function listSuggestions(user: User) {
    const parts = await visibleSalesPartitions(user);
    if (parts.length === 0) return [];
    const rows = await db
        .select({
            id: salesActionItems.id,
            recordId: salesActionItems.recordId,
            content: salesActionItems.content,
            ownerId: salesActionItems.ownerId,
            ownerName: users.name,
            dueAt: salesActionItems.dueAt,
            ruleKey: salesActionItems.ruleKey,
            reason: salesActionItems.reason,
            draft: salesActionItems.draft,
            data: records.data,
        })
        .from(salesActionItems)
        .innerJoin(records, eq(records.id, salesActionItems.recordId))
        .leftJoin(users, eq(users.id, salesActionItems.ownerId))
        .where(
            and(
                eq(salesActionItems.orgId, user.orgId),
                inArray(records.partitionId, parts.map((p) => p.id)),
                eq(salesActionItems.status, "suggested"),
                isNull(salesActionItems.dismissedAt),
            ),
        )
        .orderBy(salesActionItems.dueAt, desc(salesActionItems.id))
        .limit(500);
    return rows.map(({ data, ...r }) => {
        const d = (data ?? {}) as Record<string, unknown>;
        return {
            ...r,
            company: String(d.companyName ?? d.companyname ?? "").trim(),
            personName: String(d.name ?? d.contactName ?? "").trim(),
            personTitle: String(d.contactTitle ?? "").trim(),
        };
    });
}
