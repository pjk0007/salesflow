import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, partitions, records, workspaces } from "@/lib/db";
import { requireWorkspaceCreateAccess } from "@/lib/partition-access";
import { salesPartitionFor } from "@/lib/sales/leads";
import { fail, salesHandler } from "@/lib/sales/http";

const MAX_ROWS = 2000;
const KEYS = ["companyName", "name", "contactTitle", "phone", "email", "address", "profileNote"] as const;

/**
 * POST: 영업 리드 여러 명 한 번에 추가 (명함 여러 장·엑셀 가져오기)
 * {workspaceIds, ownerId?, records: [{companyName, name, …}], duplicateAction: "skip" | "error"}
 * 같은 이메일의 영업 리드가 이미 있으면 skip이면 건너뛰고 error면 실패로 센다.
 */
export async function POST(req: NextRequest) {
    return salesHandler(req, async (user) => {
        const b = (await req.json()) as { workspaceIds?: unknown; ownerId?: unknown; records?: unknown; duplicateAction?: unknown };
        const wsIds = Array.isArray(b.workspaceIds) ? [...new Set(b.workspaceIds.map(Number).filter((n) => n > 0))] : [];
        if (wsIds.length === 0) return fail("사업부를 하나 이상 골라주세요.");
        const rows = Array.isArray(b.records) ? b.records : [];
        if (rows.length === 0) return fail("추가할 영업고객이 없습니다.");
        if (rows.length > MAX_ROWS) return fail(`한 번에 ${MAX_ROWS}명까지 추가할 수 있습니다.`);
        const valid = await db.select({ id: workspaces.id }).from(workspaces).where(and(eq(workspaces.orgId, user.orgId), inArray(workspaces.id, wsIds)));
        if (valid.length !== wsIds.length) return fail("사업부를 찾을 수 없습니다.", 404);
        const access = await requireWorkspaceCreateAccess(user, wsIds[0]);
        if (!access.ok) return fail(access.error, access.status);
        const ownerId = typeof b.ownerId === "string" && b.ownerId ? b.ownerId : user.userId;
        const partitionId = await salesPartitionFor(wsIds[0]);

        // 이미 있는 영업 리드 이메일 (조직 전체)
        const existing = await db
            .select({ email: sql<string>`lower(trim(${records.data}->>'email'))` })
            .from(records)
            .innerJoin(partitions, eq(partitions.id, records.partitionId))
            .where(and(eq(records.orgId, user.orgId), eq(partitions.category, "sales"), sql`coalesce(${records.data}->>'email', '') <> ''`));
        const seen = new Set(existing.map((e) => e.email));

        const errors: Array<{ row: number; message: string }> = [];
        const inserts: Array<typeof records.$inferInsert> = [];
        let skipped = 0;
        rows.forEach((raw, i) => {
            const r = (raw ?? {}) as Record<string, unknown>;
            const data: Record<string, unknown> = {};
            for (const k of KEYS) {
                const v = typeof r[k] === "string" ? (r[k] as string).trim() : r[k] == null ? "" : String(r[k]).trim();
                if (v) data[k] = v.slice(0, k === "profileNote" ? 5000 : 300);
            }
            if (!data.companyName && !data.name) {
                errors.push({ row: i + 1, message: "기업명이나 이름이 없어요." });
                return;
            }
            const email = typeof data.email === "string" ? data.email.toLowerCase() : "";
            if (email && seen.has(email)) {
                if (b.duplicateAction === "error") errors.push({ row: i + 1, message: `이미 있는 이메일 (${email})` });
                else skipped++;
                return;
            }
            if (email) seen.add(email);
            inserts.push({ orgId: user.orgId, workspaceId: wsIds[0], partitionId, data: { ...data, owner: ownerId, workspaceIds: wsIds } });
        });
        for (let i = 0; i < inserts.length; i += 500) await db.insert(records).values(inserts.slice(i, i + 500));
        return NextResponse.json({
            success: errors.length === 0 || inserts.length > 0,
            totalCount: rows.length,
            insertedCount: inserts.length,
            skippedCount: skipped,
            errors,
        });
    });
}
