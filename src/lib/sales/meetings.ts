import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { db, records, salesActionItems, salesMeetingRecords, salesMeetings, users } from "@/lib/db";

export interface ActionItemInput {
    content: string;
    ownerId?: string | null;
    /** YYYY-MM-DD (한국 시간 하루) 또는 null */
    dueDate?: string | null;
}

export interface MeetingInput {
    metAt: string;
    title?: string | null;
    attendees?: string | null;
    notes?: string | null;
    transcript?: string | null;
    summary?: string | null;
    audioUrl?: string | null;
    actionItems?: ActionItemInput[];
    /** 함께 참석한 같은 기업 담당자 리드 — 없으면(undefined) 연결을 그대로 둔다 */
    linkedRecordIds?: number[];
}

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** 기한 날짜는 한국 시간 오전 9시로 저장 */
export function dueDateToTimestamp(d: string | null | undefined): Date | null {
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    return new Date(`${d}T09:00:00+09:00`);
}

export function parseMeetingInput(body: unknown): { ok: true; value: MeetingInput } | { ok: false; error: string } {
    const b = (body ?? {}) as Record<string, unknown>;
    const metAt = typeof b.metAt === "string" ? new Date(b.metAt) : null;
    if (!metAt || isNaN(metAt.getTime())) return { ok: false, error: "미팅 날짜를 입력해주세요." };
    const items = Array.isArray(b.actionItems) ? b.actionItems : [];
    if (items.length > 20) return { ok: false, error: "액션플랜은 20개까지 넣을 수 있습니다." };
    const actionItems: ActionItemInput[] = [];
    for (const raw of items) {
        const i = (raw ?? {}) as Record<string, unknown>;
        const content = str(i.content, 1000);
        if (!content) continue;
        actionItems.push({ content, ownerId: str(i.ownerId, 64), dueDate: str(i.dueDate, 10) });
    }
    return {
        ok: true,
        value: {
            metAt: metAt.toISOString(),
            title: str(b.title, 200),
            attendees: str(b.attendees, 2000),
            notes: str(b.notes, 20000),
            transcript: str(b.transcript, 400000),
            summary: str(b.summary, 20000),
            audioUrl: str(b.audioUrl, 2000),
            actionItems,
            linkedRecordIds: Array.isArray(b.linkedRecordIds)
                ? [...new Set(b.linkedRecordIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 50)
                : undefined,
        },
    };
}

/** 이 리드가 함께 참석자로 연결된 미팅 id */
async function linkedMeetingIds(recordId: number) {
    const rows = await db.select({ id: salesMeetingRecords.meetingId }).from(salesMeetingRecords).where(eq(salesMeetingRecords.recordId, recordId));
    return rows.map((r) => r.id);
}

/** 미팅에 함께 참석한 리드 연결을 바꾼다 (처음 기록한 리드는 빼고, 같은 조직 리드만) */
export async function setMeetingLinks(orgId: string, meetingId: number, primaryRecordId: number, recordIds: number[]) {
    const ids = recordIds.filter((id) => id !== primaryRecordId);
    const valid = ids.length
        ? (await db.select({ id: records.id }).from(records).where(and(eq(records.orgId, orgId), inArray(records.id, ids)))).map((r) => r.id)
        : [];
    await db.delete(salesMeetingRecords).where(eq(salesMeetingRecords.meetingId, meetingId));
    if (valid.length) await db.insert(salesMeetingRecords).values(valid.map((recordId) => ({ meetingId, recordId }))).onConflictDoNothing();
}

/** 리드의 미팅(최신순)과 액션플랜 — 함께 참석자로 연결된 미팅과 그 미팅 할 일도 같이 */
export async function listMeetings(recordId: number) {
    const linked = await linkedMeetingIds(recordId);
    const meetings = await db
            .select({
                id: salesMeetings.id,
                metAt: salesMeetings.metAt,
                title: salesMeetings.title,
                attendees: salesMeetings.attendees,
                notes: salesMeetings.notes,
                transcript: salesMeetings.transcript,
                summary: salesMeetings.summary,
                audioUrl: salesMeetings.audioUrl,
                recordId: salesMeetings.recordId,
                createdBy: salesMeetings.createdBy,
                createdByName: users.name,
                createdAt: salesMeetings.createdAt,
            })
            .from(salesMeetings)
            .leftJoin(users, eq(users.id, salesMeetings.createdBy))
            .where(linked.length ? or(eq(salesMeetings.recordId, recordId), inArray(salesMeetings.id, linked)) : eq(salesMeetings.recordId, recordId))
            .orderBy(desc(salesMeetings.metAt), desc(salesMeetings.id));
    // 이 리드의 할 일 + 이 리드에 보이는 모든 미팅의 할 일 (다른 담당자 화면에서 추가한 것도)
    const items = await listActionItems([recordId], meetings.map((m) => m.id));
    const linkRows = meetings.length
        ? await db.select().from(salesMeetingRecords).where(inArray(salesMeetingRecords.meetingId, meetings.map((m) => m.id)))
        : [];
    // 미팅마다 연결된 리드 전체 (처음 기록한 리드 + 함께 참석한 리드)
    return {
        meetings: meetings.map((m) => ({
            ...m,
            linkedRecordIds: [m.recordId, ...linkRows.filter((l) => l.meetingId === m.id).map((l) => l.recordId)],
        })),
        actionItems: items,
    };
}

/** 리드들의 할 일 — meetingIds를 주면 그 미팅(함께 참석한 미팅)의 할 일도 같이 (할 일은 하나라 어디서 체크해도 같이 바뀐다) */
export async function listActionItems(recordIds: number[], meetingIds: number[] = []) {
    if (recordIds.length === 0 && meetingIds.length === 0) return [];
    const scope = meetingIds.length
        ? or(inArray(salesActionItems.recordId, recordIds.length ? recordIds : [-1]), inArray(salesActionItems.meetingId, meetingIds))
        : inArray(salesActionItems.recordId, recordIds);
    return db
        .select({
            id: salesActionItems.id,
            recordId: salesActionItems.recordId,
            meetingId: salesActionItems.meetingId,
            content: salesActionItems.content,
            ownerId: salesActionItems.ownerId,
            ownerName: users.name,
            dueAt: salesActionItems.dueAt,
            doneAt: salesActionItems.doneAt,
            createdAt: salesActionItems.createdAt,
        })
        .from(salesActionItems)
        .leftJoin(users, eq(users.id, salesActionItems.ownerId))
        // 추천(suggested)은 빼고 실제 할 일만
        .where(and(scope, eq(salesActionItems.status, "open")))
        .orderBy(asc(salesActionItems.doneAt), asc(salesActionItems.dueAt), asc(salesActionItems.id));
}

/** 리드의 "다음 연락일"을 안 끝난 가장 가까운 액션플랜 기한으로 맞춘다 (중요 탭·표 기준) */
export async function syncNextContact(recordId: number) {
    const own = await db.select({ id: salesMeetings.id }).from(salesMeetings).where(eq(salesMeetings.recordId, recordId));
    const linked = [...(await linkedMeetingIds(recordId)), ...own.map((m) => m.id)];
    const open = await db
        .select({ dueAt: salesActionItems.dueAt, doneAt: salesActionItems.doneAt })
        .from(salesActionItems)
        .where(
            and(
                linked.length ? or(eq(salesActionItems.recordId, recordId), inArray(salesActionItems.meetingId, linked)) : eq(salesActionItems.recordId, recordId),
                eq(salesActionItems.status, "open"),
            ),
        );
    const due = open
        .filter((i) => !i.doneAt && i.dueAt)
        .map((i) => i.dueAt!.getTime())
        .sort((a, b) => a - b)[0];
    if (due === undefined) return;
    const [rec] = await db.select({ data: records.data }).from(records).where(eq(records.id, recordId));
    if (!rec) return;
    await db
        .update(records)
        .set({ data: { ...(rec.data as Record<string, unknown>), nextContactAt: new Date(due).toISOString() }, updatedAt: new Date() })
        .where(eq(records.id, recordId));
}

export async function createMeeting(orgId: string, userId: string, recordId: number, input: MeetingInput) {
    const meeting = await db.transaction(async (tx) => {
        const [m] = await tx
            .insert(salesMeetings)
            .values({
                orgId,
                recordId,
                metAt: new Date(input.metAt),
                title: input.title ?? null,
                attendees: input.attendees ?? null,
                notes: input.notes ?? null,
                transcript: input.transcript ?? null,
                summary: input.summary ?? null,
                audioUrl: input.audioUrl ?? null,
                createdBy: userId,
            })
            .returning();
        if (input.actionItems?.length) {
            await tx.insert(salesActionItems).values(
                input.actionItems.map((i) => ({
                    orgId,
                    recordId,
                    meetingId: m.id,
                    content: i.content,
                    ownerId: i.ownerId || userId,
                    dueAt: dueDateToTimestamp(i.dueDate),
                    createdBy: userId,
                })),
            );
        }
        return m;
    });
    if (input.linkedRecordIds) await setMeetingLinks(orgId, meeting.id, recordId, input.linkedRecordIds);
    await syncMeetingRecords(meeting.id);
    return meeting;
}

/** 미팅에 연결된 모든 리드(처음 기록한 리드 + 함께 참석한 리드)의 다음 연락일을 맞춘다 */
export async function syncMeetingRecords(meetingId: number) {
    const [m] = await db.select({ recordId: salesMeetings.recordId }).from(salesMeetings).where(eq(salesMeetings.id, meetingId));
    if (!m) return;
    const links = await db.select({ recordId: salesMeetingRecords.recordId }).from(salesMeetingRecords).where(eq(salesMeetingRecords.meetingId, meetingId));
    for (const id of new Set([m.recordId, ...links.map((l) => l.recordId)])) await syncNextContact(id);
}

/** 할 일이 바뀐 뒤 — 미팅 할 일이면 그 미팅에 연결된 리드 모두, 아니면 그 리드만 다음 연락일을 맞춘다 */
export async function syncAfterItemChange(item: { recordId: number; meetingId: number | null }) {
    if (item.meetingId) await syncMeetingRecords(item.meetingId);
    await syncNextContact(item.recordId);
}
