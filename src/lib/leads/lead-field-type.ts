import { and, eq, ne, or, isNull, sql } from "drizzle-orm";
import { db, fieldDefinitions, fieldTypes, partitions, workspaces } from "@/lib/db";
import { ensureLeadBaseFields } from "./base-fields";

/** 리드 전용 타입으로 복사하지 않는 칸 */
const SKIP_KEYS = new Set(["CouponExpiration"]);

/**
 * 리드 파티션이 다른 구분(레코드 등) 파티션과 같은 속성 타입을 쓰면 워크스페이스의 "<워크스페이스> 리드" 타입으로 옮긴다.
 * 그 타입이 없으면 지금 타입의 칸을 복사해 만든다. 영업 파티션은 조직 공통 "영업 리드" 타입(아래).
 * 끝나면 기본 칸을 채운다. drizzle/0133_lead_field_types.sql 과 같은 규칙.
 */
export async function ensureLeadFieldType(partitionId: number) {
    return ensureCategoryFieldType(partitionId, "lead");
}

export async function ensureCategoryFieldType(partitionId: number, category: "lead" | "sales") {
    if (category === "sales") return ensureSalesFieldType(partitionId);
    const [row] = await db
        .select({
            id: partitions.id,
            workspaceId: partitions.workspaceId,
            fieldTypeId: partitions.fieldTypeId,
            orgId: workspaces.orgId,
            wsName: workspaces.name,
            defaultFieldTypeId: workspaces.defaultFieldTypeId,
        })
        .from(partitions)
        .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
        .where(eq(partitions.id, partitionId));
    if (!row) return;
    const sourceType = row.fieldTypeId ?? row.defaultFieldTypeId;
    if (!sourceType) return;

    // 같은 타입을 쓰는 콜드 파티션이 있는지 (파티션 타입이 비면 워크스페이스 기본 타입을 쓴다)
    const [shared] = await db
        .select({ id: partitions.id })
        .from(partitions)
        .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
        .where(
            and(
                ne(partitions.category, category),
                ne(partitions.id, partitionId),
                or(
                    eq(partitions.fieldTypeId, sourceType),
                    and(isNull(partitions.fieldTypeId), eq(workspaces.defaultFieldTypeId, sourceType)),
                ),
            ),
        )
        .limit(1);
    if (!shared) {
        await ensureLeadBaseFields(sourceType);
        return;
    }

    const typeName = `${row.wsName} 리드`.slice(0, 100);
    const targetId = await db.transaction(async (tx) => {
        let [target] = await tx
            .select({ id: fieldTypes.id })
            .from(fieldTypes)
            .where(and(eq(fieldTypes.orgId, row.orgId), eq(fieldTypes.name, typeName)));
        if (!target) {
            [target] = await tx
                .insert(fieldTypes)
                .values({ orgId: row.orgId, name: typeName, description: "리드관리 전용 속성 타입 — 레코드(콜드)와 분리", category: "lead" })
                .returning({ id: fieldTypes.id });
        }
        const [source, existing] = await Promise.all([
            tx.select().from(fieldDefinitions).where(eq(fieldDefinitions.fieldTypeId, sourceType)),
            tx.select({ key: fieldDefinitions.key }).from(fieldDefinitions).where(eq(fieldDefinitions.fieldTypeId, target.id)),
        ]);
        const have = new Set(existing.map((f) => f.key));
        const copies = source
            .filter((f) => !SKIP_KEYS.has(f.key) && !have.has(f.key))
            .map((f) => {
                const copy: Partial<typeof f> = { ...f };
                delete copy.id;
                delete copy.createdAt;
                delete copy.updatedAt;
                return { ...(copy as Omit<typeof f, "id" | "createdAt" | "updatedAt">), workspaceId: null, fieldTypeId: target.id };
            });
        if (copies.length > 0) await tx.insert(fieldDefinitions).values(copies);
        await tx
            .update(partitions)
            .set({ fieldTypeId: target.id, updatedAt: sql`now()` })
            .where(eq(partitions.id, partitionId));
        return target.id;
    });
    await ensureLeadBaseFields(targetId);
}

/** 영업관리 공통 속성 타입 이름 — 조직에 하나, 모든 사업이 같이 쓴다 */
export const SALES_FIELD_TYPE_NAME = "영업 리드";

/** 영업 파티션은 조직 공통 "영업 리드" 타입을 쓴다 (없으면 만들고 영업 칸을 채운다) */
async function ensureSalesFieldType(partitionId: number) {
    const [row] = await db
        .select({ orgId: workspaces.orgId })
        .from(partitions)
        .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
        .where(eq(partitions.id, partitionId));
    if (!row) return;
    let [type] = await db
        .select({ id: fieldTypes.id })
        .from(fieldTypes)
        .where(and(eq(fieldTypes.orgId, row.orgId), eq(fieldTypes.name, SALES_FIELD_TYPE_NAME)));
    if (!type) {
        [type] = await db
            .insert(fieldTypes)
            .values({ orgId: row.orgId, name: SALES_FIELD_TYPE_NAME, description: "영업관리 공통 속성 타입 — 모든 사업이 같이 쓴다", category: "sales" })
            .returning({ id: fieldTypes.id });
    }
    await db.update(partitions).set({ fieldTypeId: type.id, updatedAt: sql`now()` }).where(eq(partitions.id, partitionId));
    await ensureLeadBaseFields(type.id, { sales: true });
}
