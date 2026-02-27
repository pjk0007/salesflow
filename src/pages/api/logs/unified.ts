import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50));
        const offset = (page - 1) * pageSize;
        const channel = (req.query.channel as string) || "";
        const status = (req.query.status as string) || "";
        const triggerType = (req.query.triggerType as string) || "";
        const startDate = (req.query.startDate as string) || "";
        const endDate = (req.query.endDate as string) || "";
        const recordId = req.query.recordId ? Number(req.query.recordId) : null;
        const search = (req.query.search as string) || "";

        function buildSubquery(
            type: "alimtalk" | "email",
            orgId: string,
        ) {
            const table = type === "alimtalk" ? "alimtalk_send_logs" : "email_send_logs";
            const recipientCol = type === "alimtalk" ? "recipient_no" : "recipient_email";
            const titleCol = type === "alimtalk" ? "template_name" : "subject";

            let q = sql`
                SELECT id, ${sql.raw(`'${type}'`)}::text as channel, org_id, partition_id, record_id,
                       ${sql.raw(recipientCol)} as recipient, ${sql.raw(titleCol)} as title,
                       status, trigger_type, result_message, sent_by, sent_at, completed_at
                FROM ${sql.raw(table)}
                WHERE org_id = ${orgId}
            `;

            if (status) q = sql`${q} AND status = ${status}`;
            if (triggerType) q = sql`${q} AND trigger_type = ${triggerType}`;
            if (startDate) q = sql`${q} AND sent_at >= ${startDate}::timestamptz`;
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                q = sql`${q} AND sent_at <= ${end.toISOString()}::timestamptz`;
            }
            if (recordId) q = sql`${q} AND record_id = ${recordId}`;
            if (search) {
                const like = `%${search}%`;
                q = sql`${q} AND (${sql.raw(recipientCol)} ILIKE ${like} OR ${sql.raw(titleCol)} ILIKE ${like})`;
            }

            return q;
        }

        let unionQuery;

        if (channel === "alimtalk") {
            unionQuery = buildSubquery("alimtalk", user.orgId);
        } else if (channel === "email") {
            unionQuery = buildSubquery("email", user.orgId);
        } else {
            const qa = buildSubquery("alimtalk", user.orgId);
            const qe = buildSubquery("email", user.orgId);
            unionQuery = sql`(${qa}) UNION ALL (${qe})`;
        }

        const countQuery = sql`SELECT count(*)::int as count FROM (${unionQuery}) t`;
        const dataQuery = sql`SELECT * FROM (${unionQuery}) t ORDER BY sent_at DESC LIMIT ${pageSize} OFFSET ${offset}`;

        const [countResult] = await db.execute(countQuery) as { count: number }[];
        const total = countResult.count;
        const logs = await db.execute(dataQuery);

        return res.status(200).json({
            success: true,
            data: logs,
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
        });
    } catch (error) {
        console.error("Unified logs error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
