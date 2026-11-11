import { NextRequest } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db, records, salesActionItems, salesMeetings } from "@/lib/db";
import { draftSuggestionMessage } from "@/lib/sales/ai";
import { fail, ok, recordGuard, salesHandler } from "@/lib/sales/http";

// POST: 추천에 맞는 연락 문구 초안 만들기 (메모·최근 미팅 요약 참고) — 결과는 추천에 저장
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    return salesHandler(req, async (user) => {
        const id = Number((await params).id);
        const [item] = id
            ? await db.select().from(salesActionItems).where(and(eq(salesActionItems.id, id), eq(salesActionItems.orgId, user.orgId)))
            : [];
        if (!item) return fail("추천을 찾을 수 없습니다.", 404);
        const g = await recordGuard(user, item.recordId, "read");
        if (g.error) return g.error;
        const [rec] = await db.select({ data: records.data }).from(records).where(eq(records.id, item.recordId));
        const [meeting] = await db
            .select({ title: salesMeetings.title, summary: salesMeetings.summary, metAt: salesMeetings.metAt })
            .from(salesMeetings)
            .where(eq(salesMeetings.recordId, item.recordId))
            .orderBy(desc(salesMeetings.metAt))
            .limit(1);
        const d = (rec?.data ?? {}) as Record<string, unknown>;
        const draft = await draftSuggestionMessage(user.orgId, user.userId, {
            action: item.content,
            reason: item.reason ?? "",
            company: String(d.companyName ?? d.companyname ?? ""),
            person: [d.name ?? d.contactName, d.contactTitle].filter(Boolean).join(" "),
            memo: String(d.profileNote ?? ""),
            lastMeeting: meeting ? `${meeting.title ?? ""} ${meeting.summary ?? ""}`.trim() : "",
        });
        await db.update(salesActionItems).set({ draft, updatedAt: new Date() }).where(eq(salesActionItems.id, id));
        return ok({ draft });
    });
}
