import type { NextApiRequest, NextApiResponse } from "next";
import { getUserFromRequest } from "@/lib/auth";
import { getAlimtalkClient } from "@/lib/nhn-alimtalk";
import type { NhnUpdateTemplateRequest } from "@/lib/nhn-alimtalk";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const allowedMethods = ["GET", "PUT", "DELETE"];
    if (!allowedMethods.includes(req.method!)) {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    const client = await getAlimtalkClient(user.orgId);
    if (!client) {
        return res.status(400).json({ success: false, error: "알림톡 설정이 필요합니다." });
    }

    const templateCode = req.query.templateCode as string;
    if (!templateCode) {
        return res.status(400).json({ success: false, error: "templateCode는 필수입니다." });
    }

    // GET: 템플릿 상세 조회
    if (req.method === "GET") {
        try {
            const senderKey = req.query.senderKey as string;
            if (!senderKey) {
                return res.status(400).json({ success: false, error: "senderKey는 필수입니다." });
            }

            const result = await client.getTemplate(senderKey, templateCode);

            if (!result.header.isSuccessful) {
                return res.status(200).json({ success: false, error: result.header.resultMessage });
            }

            return res.status(200).json({ success: true, data: result.template });
        } catch (error) {
            console.error("Template detail error:", error);
            return res.status(500).json({ success: false, error: "템플릿 상세 조회에 실패했습니다." });
        }
    }

    // PUT: 템플릿 수정
    if (req.method === "PUT") {
        try {
            const { senderKey, ...templateData } = req.body as { senderKey: string } & NhnUpdateTemplateRequest;

            if (!senderKey || !templateData.templateName || !templateData.templateContent) {
                return res.status(400).json({
                    success: false,
                    error: "senderKey, templateName, templateContent는 필수입니다.",
                });
            }

            const result = await client.updateTemplate(senderKey, templateCode, templateData);

            if (!result.header.isSuccessful) {
                return res.status(200).json({ success: false, error: result.header.resultMessage });
            }

            return res.status(200).json({ success: true, message: "템플릿이 수정되었습니다." });
        } catch (error) {
            console.error("Template update error:", error);
            return res.status(500).json({ success: false, error: "템플릿 수정에 실패했습니다." });
        }
    }

    // DELETE: 템플릿 삭제
    try {
        const senderKey = req.query.senderKey as string;
        if (!senderKey) {
            return res.status(400).json({ success: false, error: "senderKey는 필수입니다." });
        }

        const result = await client.deleteTemplate(senderKey, templateCode);

        if (!result.header.isSuccessful) {
            return res.status(200).json({ success: false, error: result.header.resultMessage });
        }

        return res.status(200).json({ success: true, message: "템플릿이 삭제되었습니다." });
    } catch (error) {
        console.error("Template delete error:", error);
        return res.status(500).json({ success: false, error: "템플릿 삭제에 실패했습니다." });
    }
}
