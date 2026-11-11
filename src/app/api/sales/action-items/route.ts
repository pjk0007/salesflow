import { NextRequest } from "next/server";
import { db, salesActionItems } from "@/lib/db";
import { dueDateToTimestamp, syncAfterItemChange } from "@/lib/sales/meetings";
import { fail, ok, recordGuard, salesHandler } from "@/lib/sales/http";

// POST: 액션플랜 하나 추가 {recordId, content, ownerId?, dueDate?, meetingId?}
export async function POST(req: NextRequest) {
    return salesHandler(req, async (user) => {
        const b = (await req.json()) as Record<string, unknown>;
        const recordId = Number(b.recordId);
        const g = await recordGuard(user, recordId, "read");
        if (g.error) return g.error;
        const content = typeof b.content === "string" ? b.content.trim().slice(0, 1000) : "";
        if (!content) return fail("할 일을 입력해주세요.");
        const [item] = await db
            .insert(salesActionItems)
            .values({
                orgId: user.orgId,
                recordId,
                meetingId: typeof b.meetingId === "number" ? b.meetingId : null,
                content,
                ownerId: typeof b.ownerId === "string" && b.ownerId ? b.ownerId : user.userId,
                dueAt: dueDateToTimestamp(typeof b.dueDate === "string" ? b.dueDate : null),
                createdBy: user.userId,
            })
            .returning();
        await syncAfterItemChange(item);
        return ok(item, 201);
    });
}
