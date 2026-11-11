import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, salesMeetings } from "@/lib/db";
import { parseMeetingInput, syncNextContact } from "@/lib/sales/meetings";
import { fail, ok, recordGuard, salesHandler } from "@/lib/sales/http";

async function loadMeeting(orgId: string, id: number) {
    const [m] = id
        ? await db.select().from(salesMeetings).where(and(eq(salesMeetings.id, id), eq(salesMeetings.orgId, orgId)))
        : [];
    return m ?? null;
}

// PATCH: 미팅 기록 수정 — 리드를 볼 수 있는 사람 누구나 (삭제는 작성자만)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ meetingId: string }> }) {
    return salesHandler(req, async (user) => {
        const meeting = await loadMeeting(user.orgId, Number((await params).meetingId));
        if (!meeting) return fail("미팅 기록을 찾을 수 없습니다.", 404);
        const g = await recordGuard(user, meeting.recordId, "read");
        if (g.error) return g.error;
        const parsed = parseMeetingInput(await req.json());
        if (!parsed.ok) return fail(parsed.error);
        const v = parsed.value;
        const [updated] = await db
            .update(salesMeetings)
            .set({
                metAt: new Date(v.metAt),
                title: v.title ?? null,
                attendees: v.attendees ?? null,
                notes: v.notes ?? null,
                transcript: v.transcript ?? null,
                summary: v.summary ?? null,
                updatedAt: new Date(),
            })
            .where(eq(salesMeetings.id, meeting.id))
            .returning();
        return ok(updated);
    });
}

// DELETE: 미팅 기록 삭제 (작성자 본인) — 이 미팅의 액션플랜도 같이 지워진다
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ meetingId: string }> }) {
    return salesHandler(req, async (user) => {
        const meeting = await loadMeeting(user.orgId, Number((await params).meetingId));
        if (!meeting) return fail("미팅 기록을 찾을 수 없습니다.", 404);
        const g = await recordGuard(user, meeting.recordId, "read");
        if (g.error) return g.error;
        if (meeting.createdBy !== user.userId) return fail("본인이 쓴 미팅 기록만 삭제할 수 있습니다.", 403);
        await db.delete(salesMeetings).where(eq(salesMeetings.id, meeting.id));
        await syncNextContact(meeting.recordId);
        return ok(null);
    });
}
