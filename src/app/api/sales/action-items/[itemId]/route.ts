import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, salesActionItems } from "@/lib/db";
import { dueDateToTimestamp, syncNextContact } from "@/lib/sales/meetings";
import { fail, ok, recordGuard, salesHandler } from "@/lib/sales/http";

async function loadItem(orgId: string, id: number) {
    const [i] = id
        ? await db.select().from(salesActionItems).where(and(eq(salesActionItems.id, id), eq(salesActionItems.orgId, orgId)))
        : [];
    return i ?? null;
}

// PATCH: 액션플랜 완료/되돌리기·내용·담당·기한 수정 {done?, content?, ownerId?, dueDate?}
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
    return salesHandler(req, async (user) => {
        const item = await loadItem(user.orgId, Number((await params).itemId));
        if (!item) return fail("할 일을 찾을 수 없습니다.", 404);
        const g = await recordGuard(user, item.recordId, "read");
        if (g.error) return g.error;
        const b = (await req.json()) as Record<string, unknown>;
        const set: Partial<typeof salesActionItems.$inferInsert> = { updatedAt: new Date() };
        if (typeof b.done === "boolean") set.doneAt = b.done ? new Date() : null;
        if (typeof b.content === "string") {
            if (!b.content.trim()) return fail("할 일을 입력해주세요.");
            set.content = b.content.trim().slice(0, 1000);
        }
        if (b.ownerId !== undefined) set.ownerId = typeof b.ownerId === "string" && b.ownerId ? b.ownerId : null;
        if (b.dueDate !== undefined) set.dueAt = dueDateToTimestamp(typeof b.dueDate === "string" ? b.dueDate : null);
        const [updated] = await db.update(salesActionItems).set(set).where(eq(salesActionItems.id, item.id)).returning();
        await syncNextContact(item.recordId);
        return ok(updated);
    });
}

// DELETE: 액션플랜 삭제
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
    return salesHandler(req, async (user) => {
        const item = await loadItem(user.orgId, Number((await params).itemId));
        if (!item) return fail("할 일을 찾을 수 없습니다.", 404);
        const g = await recordGuard(user, item.recordId, "read");
        if (g.error) return g.error;
        await db.delete(salesActionItems).where(eq(salesActionItems.id, item.id));
        await syncNextContact(item.recordId);
        return ok(null);
    });
}
