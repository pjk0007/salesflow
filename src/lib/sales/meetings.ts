import { asc, desc, eq, inArray } from "drizzle-orm";
import { db, records, salesActionItems, salesMeetings, users } from "@/lib/db";

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
        },
    };
}

/** 리드의 미팅(최신순)과 액션플랜 */
export async function listMeetings(recordId: number) {
    const [meetings, items] = await Promise.all([
        db
            .select({
                id: salesMeetings.id,
                metAt: salesMeetings.metAt,
                title: salesMeetings.title,
                attendees: salesMeetings.attendees,
                notes: salesMeetings.notes,
                transcript: salesMeetings.transcript,
                summary: salesMeetings.summary,
                audioUrl: salesMeetings.audioUrl,
                createdBy: salesMeetings.createdBy,
                createdByName: users.name,
                createdAt: salesMeetings.createdAt,
            })
            .from(salesMeetings)
            .leftJoin(users, eq(users.id, salesMeetings.createdBy))
            .where(eq(salesMeetings.recordId, recordId))
            .orderBy(desc(salesMeetings.metAt), desc(salesMeetings.id)),
        listActionItems([recordId]),
    ]);
    return { meetings, actionItems: items };
}

export async function listActionItems(recordIds: number[]) {
    if (recordIds.length === 0) return [];
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
        .where(inArray(salesActionItems.recordId, recordIds))
        .orderBy(asc(salesActionItems.doneAt), asc(salesActionItems.dueAt), asc(salesActionItems.id));
}

/** 리드의 "다음 연락일"을 안 끝난 가장 가까운 액션플랜 기한으로 맞춘다 (중요 탭·표 기준) */
export async function syncNextContact(recordId: number) {
    const open = await db
        .select({ dueAt: salesActionItems.dueAt, doneAt: salesActionItems.doneAt })
        .from(salesActionItems)
        .where(eq(salesActionItems.recordId, recordId));
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
    await syncNextContact(recordId);
    return meeting;
}
