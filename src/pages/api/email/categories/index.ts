import type { NextApiRequest, NextApiResponse } from "next";
import { getUserFromRequest } from "@/lib/auth";
import { getEmailClient } from "@/lib/nhn-email";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    const client = await getEmailClient(user.orgId);
    if (!client) {
        return res.status(400).json({ success: false, error: "이메일 설정이 없습니다." });
    }

    if (req.method === "GET") {
        try {
            const result = await client.listCategories();
            if (!result.header.isSuccessful || !result.data) {
                return res.status(500).json({
                    success: false,
                    error: result.header.resultMessage || "카테고리 조회에 실패했습니다.",
                });
            }

            const categories = result.data.map((cat) => ({
                categoryId: cat.categoryId,
                categoryName: cat.categoryName,
                categoryDesc: cat.categoryDesc,
            }));

            return res.status(200).json({ success: true, data: categories });
        } catch (error) {
            console.error("Email categories fetch error:", error);
            return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
        }
    }

    if (req.method === "POST") {
        try {
            const { categoryName, categoryDesc } = req.body;
            if (!categoryName) {
                return res.status(400).json({ success: false, error: "카테고리 이름은 필수입니다." });
            }

            const result = await client.createCategory({
                categoryName,
                categoryDesc: categoryDesc || undefined,
            });

            if (!result.header.isSuccessful) {
                return res.status(500).json({
                    success: false,
                    error: result.header.resultMessage || "카테고리 생성에 실패했습니다.",
                });
            }

            return res.status(201).json({
                success: true,
                data: { categoryId: result.data?.categoryId },
            });
        } catch (error) {
            console.error("Email category create error:", error);
            return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
        }
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
}
