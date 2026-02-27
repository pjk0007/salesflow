import type { NextApiRequest, NextApiResponse } from "next";
import { db, webForms, webFormFields } from "@/lib/db";
import { eq, and, count } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";
import { nanoid } from "nanoid";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === "GET") return handleGet(req, res);
    if (req.method === "POST") return handlePost(req, res);
    return res.status(405).json({ success: false, error: "Method not allowed" });
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    try {
        const workspaceId = req.query.workspaceId ? Number(req.query.workspaceId) : undefined;

        const conditions = [eq(webForms.orgId, user.orgId)];
        if (workspaceId) {
            conditions.push(eq(webForms.workspaceId, workspaceId));
        }

        const forms = await db
            .select()
            .from(webForms)
            .where(and(...conditions))
            .orderBy(webForms.createdAt);

        // 각 폼의 필드 수 집계
        const fieldCounts = await db
            .select({ formId: webFormFields.formId, value: count() })
            .from(webFormFields)
            .groupBy(webFormFields.formId);

        const countMap = new Map(fieldCounts.map((fc) => [fc.formId, fc.value]));

        const data = forms.map((f) => ({
            ...f,
            fieldCount: countMap.get(f.id) ?? 0,
        }));

        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error("Web forms fetch error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    const { name, workspaceId, partitionId, title, description } = req.body;
    if (!name || !workspaceId || !partitionId || !title) {
        return res.status(400).json({ success: false, error: "필수 항목이 누락되었습니다." });
    }

    try {
        const slug = nanoid(8);

        const [form] = await db
            .insert(webForms)
            .values({
                orgId: user.orgId,
                workspaceId,
                partitionId,
                name,
                slug,
                title,
                description: description || null,
                createdBy: user.userId,
            })
            .returning();

        return res.status(201).json({ success: true, data: form });
    } catch (error) {
        console.error("Web form create error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
