import type { NextApiRequest, NextApiResponse } from "next";
import { getUserFromRequest } from "@/lib/auth";
import { getAlimtalkClient } from "@/lib/nhn-alimtalk";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
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

    try {
        const templateCode = req.query.templateCode as string;
        const { senderKey, comment } = req.body as { senderKey: string; comment: string };

        if (!templateCode || !senderKey || !comment) {
            return res.status(400).json({
                success: false,
                error: "templateCode, senderKey, comment는 필수입니다.",
            });
        }

        const result = await client.commentTemplate(senderKey, templateCode, comment);

        if (!result.header.isSuccessful) {
            return res.status(200).json({ success: false, error: result.header.resultMessage });
        }

        return res.status(200).json({ success: true, message: "검수 요청이 완료되었습니다." });
    } catch (error) {
        console.error("Template comment error:", error);
        return res.status(500).json({ success: false, error: "검수 요청에 실패했습니다." });
    }
}
