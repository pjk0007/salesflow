import type { NextApiRequest, NextApiResponse } from "next";
import { getUserFromRequest } from "@/lib/auth";
import { getAlimtalkClient } from "@/lib/nhn-alimtalk";
import type { NhnRegisterTemplateRequest } from "@/lib/nhn-alimtalk";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET" && req.method !== "POST") {
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

    if (req.method === "GET") {
        try {
            const senderKey = req.query.senderKey as string;
            if (!senderKey) {
                return res.status(400).json({ success: false, error: "senderKey는 필수입니다." });
            }

            const result = await client.listTemplates(senderKey);

            if (!result.header.isSuccessful) {
                return res.status(200).json({ success: false, error: result.header.resultMessage });
            }

            return res.status(200).json({
                success: true,
                data: {
                    templates: result.templates,
                    totalCount: result.totalCount,
                },
            });
        } catch (error) {
            console.error("Templates list error:", error);
            return res.status(500).json({ success: false, error: "템플릿 조회에 실패했습니다." });
        }
    }

    // POST: 템플릿 등록
    try {
        const { senderKey, ...templateData } = req.body as { senderKey: string } & NhnRegisterTemplateRequest;

        if (!senderKey || !templateData.templateCode || !templateData.templateName || !templateData.templateContent) {
            return res.status(400).json({
                success: false,
                error: "senderKey, templateCode, templateName, templateContent는 필수입니다.",
            });
        }

        const result = await client.registerTemplate(senderKey, templateData);

        if (!result.header.isSuccessful) {
            return res.status(200).json({ success: false, error: result.header.resultMessage });
        }

        return res.status(200).json({
            success: true,
            message: "템플릿이 등록되었습니다.",
        });
    } catch (error) {
        console.error("Template register error:", error);
        return res.status(500).json({ success: false, error: "템플릿 등록에 실패했습니다." });
    }
}
