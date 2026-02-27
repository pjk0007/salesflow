import type { NextApiRequest, NextApiResponse } from "next";
import { getUserFromRequest } from "@/lib/auth";
import { getAlimtalkClient } from "@/lib/nhn-alimtalk";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
            const pageNum = req.query.pageNum ? Number(req.query.pageNum) : undefined;
            const pageSize = req.query.pageSize ? Number(req.query.pageSize) : undefined;
            const result = await client.listSenders({ pageNum, pageSize });

            if (!result.header.isSuccessful) {
                return res.status(200).json({ success: false, error: result.header.resultMessage });
            }

            return res.status(200).json({
                success: true,
                data: {
                    senders: result.senders,
                    totalCount: result.totalCount,
                },
            });
        } catch (error) {
            console.error("Senders list error:", error);
            return res.status(500).json({ success: false, error: "발신프로필 조회에 실패했습니다." });
        }
    }

    if (req.method === "POST") {
        try {
            const { plusFriendId, phoneNo, categoryCode } = req.body;
            if (!plusFriendId || !phoneNo || !categoryCode) {
                return res.status(400).json({
                    success: false,
                    error: "plusFriendId, phoneNo, categoryCode는 필수입니다.",
                });
            }

            const result = await client.registerSender({ plusFriendId, phoneNo, categoryCode });

            if (!result.header.isSuccessful) {
                return res.status(200).json({ success: false, error: result.header.resultMessage });
            }

            return res.status(200).json({
                success: true,
                message: "발신프로필 등록 요청이 완료되었습니다. 인증 토큰을 입력해주세요.",
            });
        } catch (error) {
            console.error("Sender register error:", error);
            return res.status(500).json({ success: false, error: "발신프로필 등록에 실패했습니다." });
        }
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
}
