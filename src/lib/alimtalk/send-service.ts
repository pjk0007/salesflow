import { isKnownAlimtalkRejection } from "@/lib/nhn-submit-result";
import { db, alimtalkConfigs, alimtalkSendLogs, alimtalkTemplateLinks } from "@/lib/db";
import { and, eq, gte, inArray, isNotNull, or, sql } from "drizzle-orm";
import { getAlimtalkClient, normalizePhoneNumber } from "@/lib/nhn-alimtalk";
import { extractAllTemplateVariables } from "@/lib/alimtalk-template-utils";

export interface SendAlimtalkRecipientInput {
    phoneNumber: string;
    templateParameter?: Record<string, string>;
    recordId?: number;
    templateLinkId?: number;
    partitionId?: number;
    stepIndex?: number;
}

export interface SendAlimtalkInput {
    orgId: string;
    senderKey?: string;
    templateCode: string;
    recipients: SendAlimtalkRecipientInput[];
    triggerType?: string;
    sentBy?: string | null;
    requestDate?: string;
    /** 자동 큐의 원래 예정 시각. 복구가 늦어져도 같은 회차를 재발송하지 않는다. */
    dedupeSince?: Date;
}

export interface SendAlimtalkRecipientResult {
    phoneNumber: string;
    recipientSeq?: number;
    logId: number;
    recordId?: number;
    status: "pending" | "failed" | "unknown";
    resultCode: string;
    resultMessage: string;
}

export interface SendAlimtalkPreError {
    phoneNumber: string;
    recordId?: number;
    error: string;
}

export interface SendAlimtalkOk {
    ok: true;
    data: {
        requestId: string;
        totalCount: number;
        successCount: number;
        failCount: number;
        unknownCount: number;
        warning?: string;
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
        stepIndex?: number;
    }> = [];
    const preErrors: SendAlimtalkPreError[] = [];

    for (const r of input.recipients) {
        if (!r.phoneNumber || typeof r.phoneNumber !== "string") {
            preErrors.push({ phoneNumber: String(r.phoneNumber ?? ""), recordId: r.recordId, error: "수신번호 없음" });
            continue;
        }
        const normalized = normalizePhoneNumber(r.phoneNumber);
        if (normalized.length < 10) {
            preErrors.push({ phoneNumber: r.phoneNumber, recordId: r.recordId, error: "수신번호 형식 오류" });
            continue;
        }
        validRecipients.push({
            phoneNumber: r.phoneNumber,
            recipientNo: normalized,
            templateParameter: r.templateParameter,
            recordId: r.recordId,
            templateLinkId: r.templateLinkId,
            partitionId: r.partitionId,
            stepIndex: r.stepIndex,
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
    if (!templateDetail.header.isSuccessful || !templateDetail.template) {
        return { ok: false, status: 404, error: "템플릿을 찾을 수 없습니다." };
    }
    const templateContent = templateDetail.template.templateContent ?? "";
    const templateName = templateDetail.template.templateName ?? "";

    const required = extractAllTemplateVariables(templateDetail.template).map(v => v.slice(2, -1));
    const missing = validRecipients.some(r => required.some(key => !r.templateParameter?.[key]?.trim()));
    if (missing) return { ok: false, status: 400, error: "템플릿 변수의 매핑과 값을 모두 입력해주세요. 발송하지 않았습니다." };

    const triggerType = input.triggerType ?? "external_api";
    // 외부 호출 전에 내구성 있는 이력을 만든다. 프로세스 종료도 자동 재발송 근거가 되지 않는다.
    const logValues = validRecipients.map((recipient) => {
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
            recipientNo: recipient.recipientNo,
            status: "unknown",
            resultMessage: "접수 결과 확인 필요. 중복 발송 전에 이력을 확인해주세요.",
            content,
            triggerType,
            stepIndex: recipient.stepIndex ?? 0,
            sentBy: input.sentBy ?? null,
        };
    });

    const prepared = await db.transaction(async (tx): Promise<{ logs: { id: number }[] } | SendAlimtalkErr> => {
        if (["auto", "repeat", "followup"].includes(triggerType)) {
            if (validRecipients.some(r => !r.templateLinkId || !r.recordId)) {
                return { ok: false, status: 409, error: "발송 규칙과 레코드를 확인할 수 없어 발송하지 않았습니다." };
            }
            // 모든 자동 진입점이 같은 잠금을 쓴다. 외부 호출은 커밋 후 수행한다.
            const keys = [...new Set(validRecipients.map(r => `${input.orgId}:${r.templateLinkId}:${r.recordId}`))].sort();
            for (const key of keys) await tx.execute(sql`SELECT pg_advisory_xact_lock(1331144460, hashtext(${key}))`);
            for (const r of validRecipients) {
                const [link] = await tx.select({ isActive: alimtalkTemplateLinks.isActive, preventDuplicate: alimtalkTemplateLinks.preventDuplicate })
                    .from(alimtalkTemplateLinks).where(and(eq(alimtalkTemplateLinks.id, r.templateLinkId!), eq(alimtalkTemplateLinks.partitionId, r.partitionId!)));
                if (link?.isActive !== 1) return { ok: false, status: 409, error: "규칙이 꺼져 있어 발송하지 않았습니다." };
                const since = input.dedupeSince ?? new Date(Date.now() - 60 * 60 * 1000);
                const accepted = or(inArray(alimtalkSendLogs.status, ["sent", "pending"]), isNotNull(alimtalkSendLogs.requestId));
                const sameRun = triggerType === "auto"
                    ? and(accepted, link.preventDuplicate ? undefined : gte(alimtalkSendLogs.sentAt, since))
                    : and(accepted, eq(alimtalkSendLogs.triggerType, triggerType), eq(alimtalkSendLogs.stepIndex, r.stepIndex ?? 0), gte(alimtalkSendLogs.sentAt, since));
                const [previous] = await tx.select({ id: alimtalkSendLogs.id }).from(alimtalkSendLogs).where(and(
                    eq(alimtalkSendLogs.orgId, input.orgId), eq(alimtalkSendLogs.recordId, r.recordId!),
                    eq(alimtalkSendLogs.templateLinkId, r.templateLinkId!), or(eq(alimtalkSendLogs.status, "unknown"), sameRun),
                )).limit(1);
                if (previous) return { ok: false, status: 409, error: "이미 접수했거나 이전 접수 결과가 미확인 상태입니다. 자동 재발송하지 않았습니다." };
            }
        }
        const logs = await tx.insert(alimtalkSendLogs).values(logValues).returning({ id: alimtalkSendLogs.id });
        if (logs.length !== validRecipients.length) throw new Error("발송 이력을 준비하지 못했습니다.");
        return { logs };
    });
    if (!("logs" in prepared)) return prepared;
    const { logs } = prepared;
    let response: Awaited<ReturnType<typeof client.sendMessages>> | undefined;
    try {
        response = await client.sendMessages({ senderKey, templateCode: input.templateCode,
            recipientList: validRecipients.map(r => ({ recipientNo: r.recipientNo, templateParameter: r.templateParameter })), requestDate: input.requestDate });
    } catch { /* 호출 뒤 예외는 실패 확정이 아니다. 미리 남긴 unknown 이력을 유지한다. */ }
    const requestId = typeof response?.message?.requestId === "string" ? response.message.requestId : "";
    const providerResults = Array.isArray(response?.message?.sendResults)
        ? response.message.sendResults.filter(item => item && typeof item.recipientNo === "string") : [];
    // 공급자가 순서를 바꾸거나 일부 결과를 생략해도 다른 고객의 성공을 잘못 붙이지 않는다.
    const byPhone = new Map<string, typeof providerResults>();
    for (const item of providerResults) { const list = byPhone.get(item.recipientNo) ?? []; list.push(item); byPhone.set(item.recipientNo, list); }
    const inputPhoneCounts = new Map<string, number>();
    for (const recipient of validRecipients) inputPhoneCounts.set(recipient.recipientNo, (inputPhoneCounts.get(recipient.recipientNo) ?? 0) + 1);
    const results: SendAlimtalkRecipientResult[] = validRecipients.map((recipient, index) => {
        const candidates = byPhone.get(recipient.recipientNo) ?? [];
        // 요청 또는 응답에 같은 번호가 여러 번 있으면 고객별 대응을 확정할 수 없다.
        const match = candidates.length === 1 && inputPhoneCounts.get(recipient.recipientNo) === 1 ? candidates[0] : undefined;
        const rejected = response?.header?.isSuccessful === false && isKnownAlimtalkRejection(response.header.resultCode);
        const status = rejected ? "failed" : response?.header?.isSuccessful && match && Number.isFinite(match.resultCode)
            ? match.resultCode !== 0 ? isKnownAlimtalkRejection(match.resultCode) ? "failed" : "unknown" : requestId && Number.isSafeInteger(match.recipientSeq) ? "pending" : "unknown" : "unknown";
        return { phoneNumber: recipient.phoneNumber, recordId: recipient.recordId, logId: logs[index].id,
            recipientSeq: match?.recipientSeq, status, resultCode: String(match?.resultCode ?? response?.header?.resultCode ?? ""),
            resultMessage: status === "unknown" ? "접수 결과 확인 필요. 중복 발송 전에 이력을 확인해주세요." : typeof match?.resultMessage === "string" ? match.resultMessage : typeof response?.header?.resultMessage === "string" ? response.header.resultMessage : "접수 결과를 확인해주세요." };
    });
    let saveFailed = false;
    for (const result of results) {
        try {
            await db.update(alimtalkSendLogs).set({ requestId: requestId || null, recipientSeq: result.recipientSeq,
                status: result.status, resultCode: result.resultCode, resultMessage: result.resultMessage })
                .where(eq(alimtalkSendLogs.id, result.logId));
        } catch { saveFailed = true; }
    }
    const successCount = results.filter(r => r.status === "pending").length;
    const failCount = results.filter(r => r.status === "failed").length;
    const unknownCount = results.filter(r => r.status === "unknown").length;

    return {
        ok: true,
        data: {
            requestId,
            totalCount: validRecipients.length,
            successCount,
            failCount,
            unknownCount,
            ...(saveFailed ? { warning: "공급자 응답을 받았으나 이력 갱신에 실패했습니다. 다시 발송하지 말고 요청 ID로 접수 결과를 확인해주세요." }
                : unknownCount ? { warning: "접수 결과를 확인할 수 없는 대상이 있습니다. 중복 발송 전에 이력을 확인해주세요." } : {}),
            results,
            errors: preErrors.length > 0 ? preErrors : undefined,
        },
    };
}
