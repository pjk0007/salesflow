import type { NextApiRequest, NextApiResponse } from "next";
import { getUserFromRequest } from "@/lib/auth";
import { getEmailClient } from "@/lib/nhn-email";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    const categoryId = Number(req.query.id);
    if (!categoryId) {
        return res.status(400).json({ success: false, error: "유효하지 않은 카테고리 ID입니다." });
    }

    const client = await getEmailClient(user.orgId);
    if (!client) {
        return res.status(400).json({ success: false, error: "이메일 설정이 없습니다." });
    }

    if (req.method === "PUT") {
        try {
            const { categoryName, categoryDesc } = req.body;

            const result = await client.updateCategory(categoryId, {
                categoryName: categoryName || undefined,
                categoryDesc: categoryDesc !== undefined ? categoryDesc : undefined,
            });

            if (!result.header.isSuccessful) {
                return res.status(500).json({
                    success: false,
                    error: result.header.resultMessage || "카테고리 수정에 실패했습니다.",
                });
            }

            return res.status(200).json({ success: true });
        } catch (error) {
            console.error("Email category update error:", error);
            return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
        }
    }

    if (req.method === "DELETE") {
        try {
            const result = await client.deleteCategory(categoryId);

            if (!result.header.isSuccessful) {
                return res.status(500).json({
                    success: false,
                    error: result.header.resultMessage || "카테고리 삭제에 실패했습니다.",
                });
            }

            return res.status(200).json({ success: true });
        } catch (error) {
            console.error("Email category delete error:", error);
            return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
        }
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
}
