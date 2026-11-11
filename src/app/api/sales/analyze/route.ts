import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, users, organizationMembers } from "@/lib/db";
import { analyzeMeeting } from "@/lib/sales/ai";
import { fail, ok, salesHandler } from "@/lib/sales/http";

// POST: 전사본·메모로 미팅 요약과 액션플랜 후보 만들기 (저장하지 않음) {transcript, notes?, meetingDate}
export async function POST(req: NextRequest) {
    return salesHandler(req, async (user) => {
        const b = (await req.json()) as Record<string, unknown>;
        const transcript = typeof b.transcript === "string" ? b.transcript.trim() : "";
        const notes = typeof b.notes === "string" ? b.notes.trim() : "";
        if (!transcript && !notes) return fail("전사본이나 메모를 먼저 넣어주세요.");
        const members = await db
            .select({ name: users.name })
            .from(organizationMembers)
            .innerJoin(users, eq(users.id, organizationMembers.userId))
            .where(and(eq(organizationMembers.organizationId, user.orgId)));
        const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
        const meetingDate = typeof b.meetingDate === "string" ? b.meetingDate.slice(0, 10) : today;
        return ok(
            await analyzeMeeting(user.orgId, user.userId, {
                transcript,
                notes,
                meetingDate,
                today,
                members: members.map((m) => m.name).filter(Boolean),
            }),
        );
    });
}
