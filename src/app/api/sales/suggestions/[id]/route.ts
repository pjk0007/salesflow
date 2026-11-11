import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, salesActionItems } from "@/lib/db";
import { syncNextContact } from "@/lib/sales/meetings";
import { fail, ok, recordGuard, salesHandler } from "@/lib/sales/http";

// POST: 추천 처리 {action: "accept" | "dismiss"} — accept면 할 일(open)로, dismiss면 건너뛰기
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    return salesHandler(req, async (user) => {
        const id = Number((await params).id);
        const [item] = id
            ? await db.select().from(salesActionItems).where(and(eq(salesActionItems.id, id), eq(salesActionItems.orgId, user.orgId)))
            : [];
        if (!item || item.status !== "suggested") return fail("추천을 찾을 수 없습니다.", 404);
        const g = await recordGuard(user, item.recordId, "read");
        if (g.error) return g.error;
        const { action } = (await req.json()) as { action?: string };
        if (action === "accept") {
            await db
                .update(salesActionItems)
                .set({ status: "open", ownerId: item.ownerId ?? user.userId, createdBy: user.userId, updatedAt: new Date() })
                .where(eq(salesActionItems.id, id));
            await syncNextContact(item.recordId);
        } else if (action === "dismiss") {
            await db.update(salesActionItems).set({ dismissedAt: new Date(), updatedAt: new Date() }).where(eq(salesActionItems.id, id));
        } else {
            return fail("잘못된 요청입니다.");
        }
        return ok(null);
    });
}
