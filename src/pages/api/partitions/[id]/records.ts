import type { NextApiRequest, NextApiResponse } from "next";
import { db, records, partitions, workspaces, organizations } from "@/lib/db";
import { eq, and, sql, desc, asc, count } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";
import { checkPlanLimit, getResourceCount } from "@/lib/billing";
import { processAutoTrigger } from "@/lib/alimtalk-automation";
import { processEmailAutoTrigger } from "@/lib/email-automation";
import { assignDistributionOrder } from "@/lib/distribution";
import { broadcastToPartition } from "@/lib/sse";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === "GET") return handleGet(req, res);
    if (req.method === "POST") return handlePost(req, res);
    return res.status(405).json({ success: false, error: "Method not allowed" });
}

async function verifyPartitionAccess(partitionId: number, orgId: string) {
    const result = await db
        .select({
            partition: partitions,
            workspaceOrgId: workspaces.orgId,
        })
        .from(partitions)
        .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
        .where(and(eq(partitions.id, partitionId), eq(workspaces.orgId, orgId)));

    return result[0] ?? null;
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    const partitionId = Number(req.query.id);
    if (!partitionId) {
        return res.status(400).json({ success: false, error: "파티션 ID가 필요합니다." });
    }

    try {
        const access = await verifyPartitionAccess(partitionId, user.orgId);
        if (!access) {
            return res.status(404).json({ success: false, error: "파티션을 찾을 수 없습니다." });
        }

        const page = Math.max(1, Number(req.query.page) || 1);
        const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
        const search = (req.query.search as string) || "";
        const distributionOrder = req.query.distributionOrder
            ? Number(req.query.distributionOrder)
            : undefined;
        const sortField = (req.query.sortField as string) || "registeredAt";
        const sortOrder = req.query.sortOrder === "asc" ? "asc" : "desc";

        // filters 파싱
        let filters: Array<{ field: string; operator: string; value: unknown; valueTo?: unknown }> = [];
        if (req.query.filters) {
            try {
                filters = JSON.parse(req.query.filters as string);
            } catch { /* 무시 */ }
        }

        const offset = (page - 1) * pageSize;

        // WHERE 조건 구성
        const conditions = [eq(records.partitionId, partitionId)];

        if (search) {
            conditions.push(sql`${records.data}::text ILIKE ${"%" + search + "%"}`);
        }

        if (distributionOrder !== undefined) {
            conditions.push(eq(records.distributionOrder, distributionOrder));
        }

        // 필드별 필터 조건
        for (const f of filters) {
            const key = f.field;
            const val = f.value;
            switch (f.operator) {
                case "contains":
                    conditions.push(sql`${records.data}->>${key} ILIKE ${"%" + val + "%"}`);
                    break;
                case "equals":
                    conditions.push(sql`${records.data}->>${key} = ${String(val)}`);
                    break;
                case "not_equals":
                    conditions.push(sql`${records.data}->>${key} != ${String(val)}`);
                    break;
                case "gt":
                    conditions.push(sql`(${records.data}->>${key})::numeric > ${Number(val)}`);
                    break;
                case "gte":
                    conditions.push(sql`(${records.data}->>${key})::numeric >= ${Number(val)}`);
                    break;
                case "lt":
                    conditions.push(sql`(${records.data}->>${key})::numeric < ${Number(val)}`);
                    break;
                case "lte":
                    conditions.push(sql`(${records.data}->>${key})::numeric <= ${Number(val)}`);
                    break;
                case "before":
                    conditions.push(sql`(${records.data}->>${key})::date < ${String(val)}::date`);
                    break;
                case "after":
                    conditions.push(sql`(${records.data}->>${key})::date > ${String(val)}::date`);
                    break;
                case "between":
                    conditions.push(sql`(${records.data}->>${key})::date >= ${String(val)}::date`);
                    conditions.push(sql`(${records.data}->>${key})::date <= ${String(f.valueTo)}::date`);
                    break;
                case "is_empty":
                    conditions.push(sql`(${records.data}->>${key} IS NULL OR ${records.data}->>${key} = '')`);
                    break;
                case "is_not_empty":
                    conditions.push(sql`(${records.data}->>${key} IS NOT NULL AND ${records.data}->>${key} != '')`);
                    break;
                case "is_true":
                    conditions.push(sql`(${records.data}->>${key})::boolean = true`);
                    break;
                case "is_false":
                    conditions.push(sql`(${records.data}->>${key} IS NULL OR (${records.data}->>${key})::boolean = false)`);
                    break;
            }
        }

        const whereClause = and(...conditions);

        // 정렬
        const orderBy =
            sortField === "registeredAt"
                ? sortOrder === "asc"
                    ? asc(records.registeredAt)
                    : desc(records.registeredAt)
                : sortField === "integratedCode"
                    ? sortOrder === "asc"
                        ? asc(records.integratedCode)
                        : desc(records.integratedCode)
                    : sortOrder === "asc"
                        ? asc(records.createdAt)
                        : desc(records.createdAt);

        // 총 건수
        const [totalResult] = await db
            .select({ value: count() })
            .from(records)
            .where(whereClause);
        const total = totalResult?.value ?? 0;

        // 레코드 목록
        const data = await db
            .select()
            .from(records)
            .where(whereClause)
            .orderBy(orderBy)
            .limit(pageSize)
            .offset(offset);

        return res.status(200).json({
            success: true,
            data,
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
        });
    } catch (error) {
        console.error("Records fetch error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    const partitionId = Number(req.query.id);
    if (!partitionId) {
        return res.status(400).json({ success: false, error: "파티션 ID가 필요합니다." });
    }

    const { data: recordData } = req.body;
    if (!recordData || typeof recordData !== "object") {
        return res.status(400).json({ success: false, error: "레코드 데이터가 필요합니다." });
    }

    try {
        const access = await verifyPartitionAccess(partitionId, user.orgId);
        if (!access) {
            return res.status(404).json({ success: false, error: "파티션을 찾을 수 없습니다." });
        }

        const partition = access.partition;

        // 플랜 제한 체크
        const currentCount = await getResourceCount(user.orgId, "records");
        const limit = await checkPlanLimit(user.orgId, "records", currentCount);
        if (!limit.allowed) {
            return res.status(403).json({
                success: false,
                error: `레코드 한도(${limit.limit}건)를 초과했습니다. 플랜 업그레이드가 필요합니다.`,
                upgradeRequired: true,
            });
        }

        // 중복 체크
        if (partition.duplicateCheckField) {
            const checkValue = recordData[partition.duplicateCheckField];
            if (checkValue) {
                const [duplicate] = await db
                    .select({ id: records.id })
                    .from(records)
                    .where(
                        and(
                            eq(records.partitionId, partitionId),
                            sql`${records.data}->>
                                ${partition.duplicateCheckField} = ${String(checkValue)}`
                        )
                    )
                    .limit(1);

                if (duplicate) {
                    return res.status(409).json({
                        success: false,
                        error: `중복된 데이터가 존재합니다. (${partition.duplicateCheckField}: ${checkValue})`,
                    });
                }
            }
        }

        // 트랜잭션으로 통합코드 발번 + 레코드 생성
        const result = await db.transaction(async (tx) => {
            // 통합코드 생성
            const [org] = await tx
                .select()
                .from(organizations)
                .where(eq(organizations.id, user.orgId));

            const newSeq = org.integratedCodeSeq + 1;
            const integratedCode = `${org.integratedCodePrefix}-${String(newSeq).padStart(4, "0")}`;

            await tx
                .update(organizations)
                .set({ integratedCodeSeq: newSeq })
                .where(eq(organizations.id, org.id));

            // 분배순서 자동 할당 (원자적)
            let distributionOrder: number | null = null;
            let finalData = recordData;
            const distribution = await assignDistributionOrder(tx, partition.id);
            if (distribution) {
                distributionOrder = distribution.distributionOrder;
                // defaults를 recordData에 병합 (빈 필드만)
                finalData = { ...distribution.defaults };
                for (const [k, v] of Object.entries(recordData)) {
                    if (v !== undefined && v !== null && v !== "") finalData[k] = v;
                }
            }

            // 레코드 생성
            const [newRecord] = await tx
                .insert(records)
                .values({
                    orgId: user.orgId,
                    workspaceId: partition.workspaceId,
                    partitionId,
                    integratedCode,
                    distributionOrder,
                    data: finalData,
                })
                .returning();

            return newRecord;
        });

        processAutoTrigger({
            record: result,
            partitionId,
            triggerType: "on_create",
            orgId: user.orgId,
        }).catch((err) => console.error("Auto trigger error:", err));

        processEmailAutoTrigger({
            record: result,
            partitionId,
            triggerType: "on_create",
            orgId: user.orgId,
        }).catch((err) => console.error("Email auto trigger error:", err));

        broadcastToPartition(partitionId, "record:created", {
            partitionId,
            recordId: result.id,
        }, req.headers["x-session-id"] as string);

        return res.status(201).json({ success: true, data: result });
    } catch (error) {
        console.error("Record create error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
