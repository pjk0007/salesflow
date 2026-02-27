import type { NextApiRequest, NextApiResponse } from "next";
import { db, products } from "@/lib/db";
import { eq, and, or, ilike, desc } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";

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

    const { search, category, activeOnly } = req.query;

    try {
        const conditions = [eq(products.orgId, user.orgId)];

        if (activeOnly === "true") {
            conditions.push(eq(products.isActive, 1));
        }

        if (typeof category === "string" && category) {
            conditions.push(eq(products.category, category));
        }

        if (typeof search === "string" && search) {
            const pattern = `%${search}%`;
            conditions.push(
                or(
                    ilike(products.name, pattern),
                    ilike(products.summary, pattern),
                    ilike(products.category, pattern),
                )!
            );
        }

        const result = await db
            .select()
            .from(products)
            .where(and(...conditions))
            .orderBy(products.sortOrder, desc(products.createdAt));

        return res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.error("Products fetch error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    if (user.role === "member") {
        return res.status(403).json({ success: false, error: "접근 권한이 없습니다." });
    }

    const { name, summary, description, category, price, url, imageUrl } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ success: false, error: "제품명을 입력해주세요." });
    }

    try {
        const [created] = await db
            .insert(products)
            .values({
                orgId: user.orgId,
                name: name.trim(),
                summary: summary?.trim() || null,
                description: description?.trim() || null,
                category: category?.trim() || null,
                price: price?.trim() || null,
                url: url?.trim() || null,
                imageUrl: imageUrl?.trim() || null,
            })
            .returning();

        return res.status(201).json({ success: true, data: created });
    } catch (error) {
        console.error("Product create error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
