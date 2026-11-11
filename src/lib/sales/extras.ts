import { desc, inArray } from "drizzle-orm";
import { db, salesMeetings, users } from "@/lib/db";
import { listActionItems } from "./meetings";

export interface SalesExtras {
    nextAction: { content: string; dueAt: string | null; ownerName: string | null } | null;
    openActions: number;
    lastMeetingAt: string | null;
    meetingCount: number;
    ownerName: string | null;
}

/** 영업 리드 표에 붙일 값 — 안 끝난 액션플랜 중 기한이 가장 가까운 것, 최근 미팅, 우리 담당자 이름(data.owner) */
export async function salesExtrasFor(ids: number[], rows: Array<{ id: number; data: Record<string, unknown> }>) {
    const result = new Map<number, SalesExtras>();
    if (ids.length === 0) return result;
    const ownerIds = [...new Set(rows.map((r) => r.data.owner).filter((v): v is string => typeof v === "string" && v.length > 0))];
    const [items, meetings, owners] = await Promise.all([
        listActionItems(ids),
        db
            .select({ recordId: salesMeetings.recordId, metAt: salesMeetings.metAt })
            .from(salesMeetings)
            .where(inArray(salesMeetings.recordId, ids))
            .orderBy(desc(salesMeetings.metAt)),
        ownerIds.length ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ownerIds)) : Promise.resolve([]),
    ]);
    const ownerName = new Map(owners.map((o) => [o.id, o.name]));
    for (const r of rows) {
        const open = items
            .filter((i) => i.recordId === r.id && !i.doneAt)
            .sort((a, b) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity));
        const ms = meetings.filter((m) => m.recordId === r.id);
        const next = open[0];
        result.set(r.id, {
            nextAction: next ? { content: next.content, dueAt: next.dueAt?.toISOString() ?? null, ownerName: next.ownerName } : null,
            openActions: open.length,
            lastMeetingAt: ms[0]?.metAt.toISOString() ?? null,
            meetingCount: ms.length,
            ownerName: typeof r.data.owner === "string" ? ownerName.get(r.data.owner) ?? null : null,
        });
    }
    return result;
}
