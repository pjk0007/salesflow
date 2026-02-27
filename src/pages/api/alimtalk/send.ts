import type { NextApiRequest, NextApiResponse } from "next";
import { db, alimtalkTemplateLinks, alimtalkSendLogs, records, partitions, workspaces } from "@/lib/db";
import { eq, and, inArray } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";
import { getAlimtalkClient, normalizePhoneNumber } from "@/lib/nhn-alimtalk";

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
        const { templateLinkId, recordIds } = req.body;

        if (!templateLinkId || !recordIds || !Array.isArray(recordIds) || recordIds.length === 0) {
            return res.status(400).json({
                success: false,
                error: "templateLinkId와 recordIds는 필수입니다.",
            });
        }

        if (recordIds.length > 1000) {
            return res.status(400).json({
                success: false,
                error: "한 번에 최대 1,000건까지 발송할 수 있습니다.",
            });
        }

        // 템플릿 연결 정보 조회 (소유권 확인 포함)
        const [link] = await db
            .select()
            .from(alimtalkTemplateLinks)
            .innerJoin(partitions, eq(partitions.id, alimtalkTemplateLinks.partitionId))
            .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
            .where(
                and(
                    eq(alimtalkTemplateLinks.id, templateLinkId),
                    eq(workspaces.orgId, user.orgId)
                )
            )
            .limit(1);

        if (!link) {
            return res.status(404).json({ success: false, error: "템플릿 연결을 찾을 수 없습니다." });
        }

        const templateLink = link.alimtalk_template_links;

        // 레코드 조회
        const recordList = await db
            .select()
            .from(records)
            .where(inArray(records.id, recordIds));

        // 수신자 목록 구성
        const recipientList: Array<{
            recipientNo: string;
            templateParameter?: Record<string, string>;
            recordId: number;
        }> = [];

        const errors: Array<{ recordId: number; error: string }> = [];

        for (const record of recordList) {
            const data = record.data as Record<string, unknown>;
            const phone = data[templateLink.recipientField];

            if (!phone || typeof phone !== "string") {
                errors.push({ recordId: record.id, error: "수신번호 없음" });
                continue;
            }

            const normalizedPhone = normalizePhoneNumber(phone);
            if (normalizedPhone.length < 10) {
                errors.push({ recordId: record.id, error: "수신번호 형식 오류" });
                continue;
            }

            // 변수 매핑
            let templateParameter: Record<string, string> | undefined;
            const mappings = templateLink.variableMappings as Record<string, string> | null;
            if (mappings && Object.keys(mappings).length > 0) {
                templateParameter = {};
                for (const [variable, fieldKey] of Object.entries(mappings)) {
                    // #{변수명} → 변수명으로 키 정리
                    const paramKey = variable.replace(/^#\{|\}$/g, "");
                    const fieldValue = data[fieldKey];
                    templateParameter[paramKey] = fieldValue != null ? String(fieldValue) : "";
                }
            }

            recipientList.push({
                recipientNo: normalizedPhone,
                templateParameter,
                recordId: record.id,
            });
        }

        if (recipientList.length === 0) {
            return res.status(400).json({
                success: false,
                error: "유효한 수신자가 없습니다.",
                data: { errors },
            });
        }

        // NHN Cloud 발송 API 호출
        const nhnResult = await client.sendMessages({
            senderKey: templateLink.senderKey,
            templateCode: templateLink.templateCode,
            recipientList: recipientList.map(({ recipientNo, templateParameter }) => ({
                recipientNo,
                templateParameter,
            })),
        });

        if (!nhnResult.header.isSuccessful) {
            return res.status(200).json({
                success: false,
                error: `발송 실패: ${nhnResult.header.resultMessage}`,
            });
        }

        const sendResponse = nhnResult.message;
        if (!sendResponse) {
            return res.status(200).json({
                success: false,
                error: "NHN Cloud에서 응답을 받지 못했습니다.",
            });
        }

        let successCount = 0;
        let failCount = 0;

        // 발송 로그 저장
        const logValues = sendResponse.sendResults.map((result, index) => {
            const recipient = recipientList[index];
            const isSuccess = result.resultCode === 0;
            if (isSuccess) successCount++;
            else failCount++;

            return {
                orgId: user.orgId,
                templateLinkId: templateLink.id,
                partitionId: templateLink.partitionId,
                recordId: recipient.recordId,
                senderKey: templateLink.senderKey,
                templateCode: templateLink.templateCode,
                templateName: templateLink.templateName || "",
                recipientNo: result.recipientNo,
                requestId: sendResponse.requestId,
                recipientSeq: result.recipientSeq,
                status: isSuccess ? "sent" : "failed",
                resultCode: String(result.resultCode),
                resultMessage: result.resultMessage,
                triggerType: "manual",
                sentBy: user.userId,
            };
        });

        if (logValues.length > 0) {
            await db.insert(alimtalkSendLogs).values(logValues);
        }

        return res.status(200).json({
            success: true,
            data: {
                requestId: sendResponse.requestId,
                totalCount: recipientList.length,
                successCount,
                failCount,
                errors: errors.length > 0 ? errors : undefined,
            },
        });
    } catch (error) {
        console.error("Alimtalk send error:", error);
        return res.status(500).json({ success: false, error: "발송에 실패했습니다." });
    }
}
