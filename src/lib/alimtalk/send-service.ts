import { db, alimtalkConfigs, alimtalkSendLogs } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { getAlimtalkClient, normalizePhoneNumber } from "@/lib/nhn-alimtalk";

export interface SendAlimtalkRecipientInput {
    phoneNumber: string;
    templateParameter?: Record<string, string>;
    recordId?: number;
    templateLinkId?: number;
    partitionId?: number;
}

export interface SendAlimtalkInput {
    orgId: string;
    senderKey?: string;
    templateCode: string;
    recipients: SendAlimtalkRecipientInput[];
    triggerType?: string;
    sentBy?: string | null;
    requestDate?: string;
}

export interface SendAlimtalkRecipientResult {
    phoneNumber: string;
    recipientSeq: number;
    status: "sent" | "failed";
    resultCode: string;
    resultMessage: string;
}

export interface SendAlimtalkPreError {
    phoneNumber: string;
    error: string;
}

export interface SendAlimtalkOk {
    ok: true;
    data: {
        requestId: string;
        totalCount: number;
        successCount: number;
        failCount: number;
        results: SendAlimtalkRecipientResult[];
        errors?: SendAlimtalkPreError[];
    };
}

export interface SendAlimtalkErr {
    ok: false;
    status: number;
    error: string;
    errors?: SendAlimtalkPreError[];
}

export type SendAlimtalkResult = SendAlimtalkOk | SendAlimtalkErr;

async function resolveSenderKey(orgId: string, override?: string): Promise<string | null> {
    if (override) return override;
    const [config] = await db
        .select({ defaultSenderKey: alimtalkConfigs.defaultSenderKey })
        .from(alimtalkConfigs)
        .where(and(eq(alimtalkConfigs.orgId, orgId), eq(alimtalkConfigs.isActive, 1)))
        .limit(1);
    return config?.defaultSenderKey ?? null;
}

export async function sendAlimtalkForOrg(
    input: SendAlimtalkInput,
): Promise<SendAlimtalkResult> {
    if (!input.templateCode) {
        return { ok: false, status: 400, error: "templateCode는 필수입니다." };
    }
    if (!Array.isArray(input.recipients) || input.recipients.length === 0) {
        return { ok: false, status: 400, error: "recipients는 1건 이상이어야 합니다." };
    }
    if (input.recipients.length > 1000) {
        return { ok: false, status: 400, error: "한 번에 최대 1,000건까지 발송할 수 있습니다." };
    }

    const client = await getAlimtalkClient(input.orgId);
    if (!client) {
        return { ok: false, status: 404, error: "알림톡 설정이 없습니다." };
    }

    const senderKey = await resolveSenderKey(input.orgId, input.senderKey);
    if (!senderKey) {
        return { ok: false, status: 400, error: "senderKey가 필요합니다." };
    }

    // 수신자 정규화
    const validRecipients: Array<{
        phoneNumber: string;
        recipientNo: string;
        templateParameter?: Record<string, string>;
        recordId?: number;
        templateLinkId?: number;
        partitionId?: number;
    }> = [];
    const preErrors: SendAlimtalkPreError[] = [];

    for (const r of input.recipients) {
        if (!r.phoneNumber || typeof r.phoneNumber !== "string") {
            preErrors.push({ phoneNumber: String(r.phoneNumber ?? ""), error: "수신번호 없음" });
            continue;
        }
        const normalized = normalizePhoneNumber(r.phoneNumber);
        if (normalized.length < 10) {
            preErrors.push({ phoneNumber: r.phoneNumber, error: "수신번호 형식 오류" });
            continue;
        }
        validRecipients.push({
            phoneNumber: r.phoneNumber,
            recipientNo: normalized,
            templateParameter: r.templateParameter,
            recordId: r.recordId,
            templateLinkId: r.templateLinkId,
            partitionId: r.partitionId,
        });
    }

    if (validRecipients.length === 0) {
        return {
            ok: false,
            status: 400,
            error: "유효한 수신자가 없습니다.",
            errors: preErrors,
        };
    }

    // 템플릿 본문 + 이름 조회 (로그용)
    const templateDetail = await client.getTemplate(senderKey, input.templateCode);
    if (!templateDetail.template) {
        return { ok: false, status: 404, error: "템플릿을 찾을 수 없습니다." };
    }
    const templateContent = templateDetail.template.templateContent ?? "";
    const templateName = templateDetail.template.templateName ?? "";

    // NHN 발송
    const nhnResult = await client.sendMessages({
        senderKey,
        templateCode: input.templateCode,
        recipientList: validRecipients.map((r) => ({
            recipientNo: r.recipientNo,
            templateParameter: r.templateParameter,
        })),
        requestDate: input.requestDate,
    });

    if (!nhnResult.header.isSuccessful) {
        return {
            ok: false,
            status: 502,
            error: `발송 실패: ${nhnResult.header.resultMessage}`,
        };
    }

    const sendResponse = nhnResult.message;
    if (!sendResponse) {
        return { ok: false, status: 502, error: "NHN Cloud에서 응답을 받지 못했습니다." };
    }

    // 로그 저장 + 결과 집계
    let successCount = 0;
    let failCount = 0;
    const triggerType = input.triggerType ?? "external_api";

    const logValues = sendResponse.sendResults.map((result, index) => {
        const recipient = validRecipients[index];
        const isSuccess = result.resultCode === 0;
        if (isSuccess) successCount++;
        else failCount++;

        let content = templateContent;
        if (recipient.templateParameter) {
            for (const [key, value] of Object.entries(recipient.templateParameter)) {
                content = content.replaceAll(`#{${key}}`, value);
            }
        }

        return {
            orgId: input.orgId,
            templateLinkId: recipient.templateLinkId ?? null,
            partitionId: recipient.partitionId ?? null,
            recordId: recipient.recordId ?? null,
            senderKey,
            templateCode: input.templateCode,
            templateName,
            recipientNo: result.recipientNo,
            requestId: sendResponse.requestId,
            recipientSeq: result.recipientSeq,
            status: isSuccess ? "sent" : "failed",
            resultCode: String(result.resultCode),
            resultMessage: result.resultMessage,
            content,
            triggerType,
            sentBy: input.sentBy ?? null,
        };
    });

    if (logValues.length > 0) {
        await db.insert(alimtalkSendLogs).values(logValues);
    }

    const results: SendAlimtalkRecipientResult[] = sendResponse.sendResults.map(
        (result, index) => ({
            phoneNumber: validRecipients[index].phoneNumber,
            recipientSeq: result.recipientSeq,
            status: result.resultCode === 0 ? "sent" : "failed",
            resultCode: String(result.resultCode),
            resultMessage: result.resultMessage,
        }),
    );

    return {
        ok: true,
        data: {
            requestId: sendResponse.requestId,
            totalCount: validRecipients.length,
            successCount,
            failCount,
            results,
            errors: preErrors.length > 0 ? preErrors : undefined,
        },
    };
}
