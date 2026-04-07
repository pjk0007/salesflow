import {
    db,
    workspaces,
    partitions,
    records,
    alimtalkSendLogs,
    emailSendLogs,
    folders,
} from "@/lib/db";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import type { ApiTokenInfo } from "@/lib/auth";
import { checkTokenAccess } from "@/lib/auth";

type ToolResult = {
    content: { type: "text"; text: string }[];
    isError?: boolean;
};

type ToolHandler = (args: Record<string, unknown>, tokenInfo: ApiTokenInfo) => Promise<ToolResult>;

function ok(data: unknown): ToolResult {
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function err(message: string): ToolResult {
    return { content: [{ type: "text", text: message }], isError: true };
}

// ── Tool Definitions (for tools/list) ──

export const TOOL_DEFINITIONS = [
    {
        name: "list_workspaces",
        description: "워크스페이스 목록을 조회합니다.",
        inputSchema: { type: "object" as const, properties: {} },
    },
    {
        name: "list_partitions",
        description: "파티션 목록을 조회합니다. workspaceId로 필터링할 수 있습니다.",
        inputSchema: {
            type: "object" as const,
            properties: {
                workspaceId: { type: "number", description: "워크스페이스 ID로 필터링" },
            },
        },
    },
    {
        name: "list_records",
        description: "레코드 목록을 조회합니다. 파티션 ID가 필요합니다.",
        inputSchema: {
            type: "object" as const,
            properties: {
                partitionId: { type: "number", description: "파티션 ID (필수)" },
                page: { type: "number", description: "페이지 번호", default: 1 },
                pageSize: { type: "number", description: "페이지 크기 (최대 100)", default: 20 },
                search: { type: "string", description: "검색어" },
            },
            required: ["partitionId"],
        },
    },
    {
        name: "get_record",
        description: "레코드 상세 정보를 조회합니다.",
        inputSchema: {
            type: "object" as const,
            properties: {
                recordId: { type: "number", description: "레코드 ID" },
            },
            required: ["recordId"],
        },
    },
    {
        name: "create_record",
        description: "새 레코드를 생성합니다.",
        inputSchema: {
            type: "object" as const,
            properties: {
                partitionId: { type: "number", description: "파티션 ID" },
                data: { type: "object", description: "레코드 데이터 (필드명: 값)" },
            },
            required: ["partitionId", "data"],
        },
    },
    {
        name: "update_record",
        description: "레코드를 수정합니다. 전달된 필드만 업데이트됩니다.",
        inputSchema: {
            type: "object" as const,
            properties: {
                recordId: { type: "number", description: "레코드 ID" },
                data: { type: "object", description: "업데이트할 필드 (필드명: 값)" },
            },
            required: ["recordId", "data"],
        },
    },
    {
        name: "delete_record",
        description: "레코드를 삭제합니다.",
        inputSchema: {
            type: "object" as const,
            properties: {
                recordId: { type: "number", description: "레코드 ID" },
            },
            required: ["recordId"],
        },
    },
    {
        name: "list_email_logs",
        description: "이메일 발송 이력을 조회합니다.",
        inputSchema: {
            type: "object" as const,
            properties: {
                partitionId: { type: "number", description: "파티션 ID로 필터링" },
                page: { type: "number", description: "페이지 번호", default: 1 },
                pageSize: { type: "number", description: "페이지 크기 (최대 100)", default: 20 },
                status: { type: "string", description: "상태 필터 (sent/failed/pending)" },
            },
        },
    },
    {
        name: "list_alimtalk_logs",
        description: "알림톡 발송 이력을 조회합니다.",
        inputSchema: {
            type: "object" as const,
            properties: {
                partitionId: { type: "number", description: "파티션 ID로 필터링" },
                page: { type: "number", description: "페이지 번호", default: 1 },
                pageSize: { type: "number", description: "페이지 크기 (최대 100)", default: 20 },
                status: { type: "string", description: "상태 필터 (sent/failed/pending)" },
            },
        },
    },
    {
        name: "get_analytics",
        description: "발송 통계를 조회합니다. 오늘의 알림톡/이메일 발송 현황과 레코드 수를 반환합니다.",
        inputSchema: { type: "object" as const, properties: {} },
    },
];

// ── Tool Handlers ──

export function createMcpToolHandlers(): Record<string, ToolHandler> {
    return {
        list_workspaces: async (_args, tokenInfo) => {
            const result = await db
                .select({
                    id: workspaces.id,
                    name: workspaces.name,
                    description: workspaces.description,
                    icon: workspaces.icon,
                    createdAt: workspaces.createdAt,
                })
                .from(workspaces)
                .where(eq(workspaces.orgId, tokenInfo.orgId))
                .orderBy(workspaces.name);
            return ok(result);
        },

        list_partitions: async (args, tokenInfo) => {
            const workspaceId = args.workspaceId as number | undefined;
            const conditions = [eq(workspaces.orgId, tokenInfo.orgId)];
            if (workspaceId) conditions.push(eq(partitions.workspaceId, workspaceId));

            const result = await db
                .select({
                    id: partitions.id,
                    name: partitions.name,
                    workspaceId: partitions.workspaceId,
                    workspaceName: workspaces.name,
                    folderId: partitions.folderId,
                    folderName: folders.name,
                    createdAt: partitions.createdAt,
                })
                .from(partitions)
                .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
                .leftJoin(folders, eq(partitions.folderId, folders.id))
                .where(and(...conditions))
                .orderBy(workspaces.name, partitions.name);
            return ok(result);
        },

        list_records: async (args, tokenInfo) => {
            const partitionId = args.partitionId as number;
            const page = (args.page as number) || 1;
            const pageSize = Math.min((args.pageSize as number) || 20, 100);
            const search = args.search as string | undefined;

            const hasAccess = await checkTokenAccess(tokenInfo, partitionId, "read");
            if (!hasAccess) return err("이 파티션에 대한 접근 권한이 없습니다.");

            const conditions = [
                eq(records.orgId, tokenInfo.orgId),
                eq(records.partitionId, partitionId),
            ];
            if (search) {
                conditions.push(sql`${records.data}::text ILIKE ${'%' + search + '%'}`);
            }

            const whereClause = and(...conditions);
            const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(records).where(whereClause);

            const rows = await db
                .select()
                .from(records)
                .where(whereClause)
                .orderBy(desc(records.createdAt))
                .limit(pageSize)
                .offset((page - 1) * pageSize);

            return ok({
                totalCount: countResult?.count ?? 0,
                page,
                pageSize,
                records: rows.map(r => ({
                    id: r.id, partitionId: r.partitionId, integratedCode: r.integratedCode,
                    data: r.data, createdAt: r.createdAt, updatedAt: r.updatedAt,
                })),
            });
        },

        get_record: async (args, tokenInfo) => {
            const recordId = args.recordId as number;
            const [record] = await db.select().from(records)
                .where(and(eq(records.id, recordId), eq(records.orgId, tokenInfo.orgId))).limit(1);
            if (!record) return err("레코드를 찾을 수 없습니다.");

            const hasAccess = await checkTokenAccess(tokenInfo, record.partitionId, "read");
            if (!hasAccess) return err("이 레코드에 대한 접근 권한이 없습니다.");

            return ok({
                id: record.id, partitionId: record.partitionId, workspaceId: record.workspaceId,
                integratedCode: record.integratedCode, data: record.data,
                createdAt: record.createdAt, updatedAt: record.updatedAt,
            });
        },

        create_record: async (args, tokenInfo) => {
            const partitionId = args.partitionId as number;
            const data = args.data as Record<string, unknown>;

            const hasAccess = await checkTokenAccess(tokenInfo, partitionId, "create");
            if (!hasAccess) return err("레코드 생성 권한이 없습니다.");

            const [partition] = await db.select({ workspaceId: partitions.workspaceId })
                .from(partitions).where(eq(partitions.id, partitionId)).limit(1);
            if (!partition) return err("파티션을 찾을 수 없습니다.");

            const [created] = await db.insert(records).values({
                orgId: tokenInfo.orgId,
                workspaceId: partition.workspaceId,
                partitionId,
                data,
            }).returning();

            return ok({ id: created.id, partitionId: created.partitionId, data: created.data, createdAt: created.createdAt });
        },

        update_record: async (args, tokenInfo) => {
            const recordId = args.recordId as number;
            const data = args.data as Record<string, unknown>;

            const [record] = await db.select().from(records)
                .where(and(eq(records.id, recordId), eq(records.orgId, tokenInfo.orgId))).limit(1);
            if (!record) return err("레코드를 찾을 수 없습니다.");

            const hasAccess = await checkTokenAccess(tokenInfo, record.partitionId, "update");
            if (!hasAccess) return err("레코드 수정 권한이 없습니다.");

            const mergedData = { ...(record.data as Record<string, unknown>), ...data };
            const [updated] = await db.update(records)
                .set({ data: mergedData, updatedAt: new Date() })
                .where(eq(records.id, recordId)).returning();

            return ok({ id: updated.id, data: updated.data, updatedAt: updated.updatedAt });
        },

        delete_record: async (args, tokenInfo) => {
            const recordId = args.recordId as number;
            const [record] = await db.select({ partitionId: records.partitionId }).from(records)
                .where(and(eq(records.id, recordId), eq(records.orgId, tokenInfo.orgId))).limit(1);
            if (!record) return err("레코드를 찾을 수 없습니다.");

            const hasAccess = await checkTokenAccess(tokenInfo, record.partitionId, "delete");
            if (!hasAccess) return err("레코드 삭제 권한이 없습니다.");

            await db.delete(records).where(eq(records.id, recordId));
            return ok({ deleted: true, recordId });
        },

        list_email_logs: async (args, tokenInfo) => {
            const partitionId = args.partitionId as number | undefined;
            const page = (args.page as number) || 1;
            const pageSize = Math.min((args.pageSize as number) || 20, 100);
            const status = args.status as string | undefined;

            if (partitionId) {
                const hasAccess = await checkTokenAccess(tokenInfo, partitionId, "read");
                if (!hasAccess) return err("접근 권한이 없습니다.");
            }

            const conditions = [eq(emailSendLogs.orgId, tokenInfo.orgId)];
            if (partitionId) conditions.push(eq(emailSendLogs.partitionId, partitionId));
            if (status) conditions.push(eq(emailSendLogs.status, status));

            const whereClause = and(...conditions);
            const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(emailSendLogs).where(whereClause);

            const logs = await db.select({
                id: emailSendLogs.id, recipientEmail: emailSendLogs.recipientEmail,
                subject: emailSendLogs.subject, status: emailSendLogs.status,
                triggerType: emailSendLogs.triggerType, isOpened: emailSendLogs.isOpened,
                openedAt: emailSendLogs.openedAt, sentAt: emailSendLogs.sentAt,
                partitionId: emailSendLogs.partitionId, recordId: emailSendLogs.recordId,
            }).from(emailSendLogs).where(whereClause)
                .orderBy(desc(emailSendLogs.sentAt)).limit(pageSize).offset((page - 1) * pageSize);

            return ok({ totalCount: countResult?.count ?? 0, page, pageSize, logs });
        },

        list_alimtalk_logs: async (args, tokenInfo) => {
            const partitionId = args.partitionId as number | undefined;
            const page = (args.page as number) || 1;
            const pageSize = Math.min((args.pageSize as number) || 20, 100);
            const status = args.status as string | undefined;

            if (partitionId) {
                const hasAccess = await checkTokenAccess(tokenInfo, partitionId, "read");
                if (!hasAccess) return err("접근 권한이 없습니다.");
            }

            const conditions = [eq(alimtalkSendLogs.orgId, tokenInfo.orgId)];
            if (partitionId) conditions.push(eq(alimtalkSendLogs.partitionId, partitionId));
            if (status) conditions.push(eq(alimtalkSendLogs.status, status));

            const whereClause = and(...conditions);
            const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(alimtalkSendLogs).where(whereClause);

            const logs = await db.select({
                id: alimtalkSendLogs.id, recipientNo: alimtalkSendLogs.recipientNo,
                templateCode: alimtalkSendLogs.templateCode, templateName: alimtalkSendLogs.templateName,
                status: alimtalkSendLogs.status, content: alimtalkSendLogs.content,
                triggerType: alimtalkSendLogs.triggerType, sentAt: alimtalkSendLogs.sentAt,
                partitionId: alimtalkSendLogs.partitionId, recordId: alimtalkSendLogs.recordId,
            }).from(alimtalkSendLogs).where(whereClause)
                .orderBy(desc(alimtalkSendLogs.sentAt)).limit(pageSize).offset((page - 1) * pageSize);

            return ok({ totalCount: countResult?.count ?? 0, page, pageSize, logs });
        },

        get_analytics: async (_args, tokenInfo) => {
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);

            const [recordCount, workspaceCount, partitionCount, alimtalkStats, emailStats] = await Promise.all([
                db.select({ count: sql<number>`count(*)::int` }).from(records).where(eq(records.orgId, tokenInfo.orgId)),
                db.select({ count: sql<number>`count(*)::int` }).from(workspaces).where(eq(workspaces.orgId, tokenInfo.orgId)),
                db.select({ count: sql<number>`count(*)::int` }).from(partitions)
                    .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
                    .where(eq(workspaces.orgId, tokenInfo.orgId)),
                db.select({ status: alimtalkSendLogs.status, count: sql<number>`count(*)::int` })
                    .from(alimtalkSendLogs)
                    .where(and(eq(alimtalkSendLogs.orgId, tokenInfo.orgId), gte(alimtalkSendLogs.sentAt, todayStart)))
                    .groupBy(alimtalkSendLogs.status),
                db.select({ status: emailSendLogs.status, count: sql<number>`count(*)::int` })
                    .from(emailSendLogs)
                    .where(and(eq(emailSendLogs.orgId, tokenInfo.orgId), gte(emailSendLogs.sentAt, todayStart)))
                    .groupBy(emailSendLogs.status),
            ]);

            const agg = (stats: { status: string; count: number }[]) => {
                let total = 0, sent = 0, failed = 0;
                for (const s of stats) {
                    total += s.count;
                    if (s.status === "sent") sent = s.count;
                    if (s.status === "failed" || s.status === "rejected") failed += s.count;
                }
                return { total, sent, failed };
            };

            return ok({
                recordCount: recordCount[0]?.count ?? 0,
                workspaceCount: workspaceCount[0]?.count ?? 0,
                partitionCount: partitionCount[0]?.count ?? 0,
                todayAlimtalk: agg(alimtalkStats),
                todayEmail: agg(emailStats),
            });
        },
    };
}
