import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, inboxMacros as macros } from "@/lib/db";
import { requireCustomerAccess, type CustomerActor } from "@/lib/customer-access/access";
import { InboxError } from "@/lib/inbox/errors";

const columns = { id: macros.id, name: macros.name, body: macros.body, sortOrder: macros.sortOrder };
const input = z.object({
    id: z.number().int().positive().optional(),
    // 이름은 # 뒤에 붙여 쓰므로 띄어쓰기·# 없이
    name: z
        .string()
        .trim()
        .transform((s) => s.replace(/^#+/, ""))
        .pipe(z.string().min(1, "매크로 이름을 입력해주세요.").max(50).regex(/^[^\s#]+$/, "이름에는 띄어쓰기와 #을 쓸 수 없어요.")),
    body: z.string().trim().min(1, "매크로 내용을 입력해주세요.").max(5000),
});

/** 사업부 매크로 목록 — 상담 열람 권한이면 볼 수 있다 */
export async function listMacros(actor: CustomerActor, workspaceId: number) {
    await requireCustomerAccess(actor, workspaceId, "read");
    return db
        .select(columns)
        .from(macros)
        .where(and(eq(macros.workspaceId, workspaceId), eq(macros.orgId, actor.orgId)))
        .orderBy(asc(macros.sortOrder), asc(macros.id));
}

/** 매크로 추가·수정 — 사업부 관리 권한 필요 */
export async function saveMacro(actor: CustomerActor, workspaceId: number, raw: unknown) {
    await requireCustomerAccess(actor, workspaceId, "manage");
    const parsed = input.safeParse(raw);
    if (!parsed.success) throw new InboxError(parsed.error.issues[0]?.message ?? "입력값을 확인해주세요.");
    const { id, name, body } = parsed.data;
    try {
        if (id) {
            const [row] = await db
                .update(macros)
                .set({ name, body, updatedAt: new Date() })
                .where(and(eq(macros.id, id), eq(macros.workspaceId, workspaceId), eq(macros.orgId, actor.orgId)))
                .returning(columns);
            if (!row) throw new InboxError("매크로를 찾을 수 없습니다.", 404);
            return row;
        }
        const [row] = await db
            .insert(macros)
            .values({
                orgId: actor.orgId,
                workspaceId,
                name,
                body,
                sortOrder: sql`(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM inbox_macros WHERE workspace_id = ${workspaceId})`,
            })
            .returning(columns);
        return row;
    } catch (e) {
        if ((e as { code?: string }).code === "23505" || (e as { cause?: { code?: string } }).cause?.code === "23505")
            throw new InboxError("같은 이름의 매크로가 이미 있어요.", 409);
        throw e;
    }
}

export async function deleteMacro(actor: CustomerActor, workspaceId: number, id: number) {
    await requireCustomerAccess(actor, workspaceId, "manage");
    await db.delete(macros).where(and(eq(macros.id, id), eq(macros.workspaceId, workspaceId), eq(macros.orgId, actor.orgId)));
    return { deleted: true };
}
