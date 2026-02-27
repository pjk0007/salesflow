import type { NextApiRequest, NextApiResponse } from "next";
import { db, products } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === "PUT") return handlePut(req, res);
    if (req.method === "DELETE") return handleDelete(req, res);
    return res.status(405).json({ success: false, error: "Method not allowed" });
}

async function handlePut(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    if (user.role === "member") {
        return res.status(403).json({ success: false, error: "접근 권한이 없습니다." });
    }

    const id = Number(req.query.id);
    if (!id) {
        return res.status(400).json({ success: false, error: "유효하지 않은 ID입니다." });
    }

    const { name, summary, description, category, price, url, imageUrl, isActive, sortOrder } = req.body;

    try {
        const updateData: Record<string, unknown> = { updatedAt: new Date() };

        if (name !== undefined) updateData.name = name.trim();
        if (summary !== undefined) updateData.summary = summary?.trim() || null;
        if (description !== undefined) updateData.description = description?.trim() || null;
        if (category !== undefined) updateData.category = category?.trim() || null;
        if (price !== undefined) updateData.price = price?.trim() || null;
        if (url !== undefined) updateData.url = url?.trim() || null;
        if (imageUrl !== undefined) updateData.imageUrl = imageUrl?.trim() || null;
        if (isActive !== undefined) updateData.isActive = isActive;
        if (sortOrder !== undefined) updateData.sortOrder = sortOrder;

        const [updated] = await db
            .update(products)
            .set(updateData)
            .where(and(eq(products.id, id), eq(products.orgId, user.orgId)))
            .returning();

        if (!updated) {
            return res.status(404).json({ success: false, error: "제품을 찾을 수 없습니다." });
        }

        return res.status(200).json({ success: true, data: updated });
    } catch (error) {
        console.error("Product update error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    if (user.role === "member") {
        return res.status(403).json({ success: false, error: "접근 권한이 없습니다." });
    }

    const id = Number(req.query.id);
    if (!id) {
        return res.status(400).json({ success: false, error: "유효하지 않은 ID입니다." });
    }

    try {
        const [deleted] = await db
            .delete(products)
            .where(and(eq(products.id, id), eq(products.orgId, user.orgId)))
            .returning({ id: products.id });

        if (!deleted) {
            return res.status(404).json({ success: false, error: "제품을 찾을 수 없습니다." });
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error("Product delete error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
