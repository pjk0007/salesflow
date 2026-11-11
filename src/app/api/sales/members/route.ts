import { NextRequest } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db, organizationMembers, users } from "@/lib/db";
import { ok, salesHandler } from "@/lib/sales/http";

// GET: 담당자 고르기용 같은 조직 팀원 (이름만 — 멤버도 볼 수 있다)
export async function GET(req: NextRequest) {
    return salesHandler(req, async (user) => {
        const rows = await db
            .select({ id: users.id, name: users.name })
            .from(organizationMembers)
            .innerJoin(users, eq(users.id, organizationMembers.userId))
            .where(and(eq(organizationMembers.organizationId, user.orgId), eq(users.isActive, 1)))
            .orderBy(asc(users.name));
        return ok(rows);
    });
}
