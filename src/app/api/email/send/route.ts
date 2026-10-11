import { NextRequest, NextResponse } from "next/server";
import { db, emailTemplateLinks, emailTemplates, emailSendLogs, records, partitions, workspaces } from "@/lib/db";
import { eq, and, inArray } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { getEmailClient, getEmailConfig, substituteVariables, appendSignature } from "@/lib/nhn-email";
import { resolveSender, resolveSignature } from "@/lib/email-sender-resolver";
import { wrapTrackingUrls } from "@/lib/email-click-tracking";
import {
    isUnsubscribed,
    generateUnsubscribeToken,
    buildUnsubscribeUrl,
    appendUnsubscribeFooter,
    buildListUnsubscribeHeaders,
} from "@/lib/email-unsubscribe";

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const client = await getEmailClient(user.orgId);
    if (!client) {
        return NextResponse.json({ success: false, error: "이메일 설정이 필요합니다." }, { status: 400 });
    }

    const config = await getEmailConfig(user.orgId);

    try {
        const { templateLinkId, recordIds, senderProfileId, signatureId } = await req.json() as {
            templateLinkId?: number;
            recordIds?: unknown;
            senderProfileId?: number;
            signatureId?: number | null;
        };

        const sender = await resolveSender(user.orgId, {
            preferredIds: [senderProfileId],
            config,
        });
        if (!sender.fromEmail) {
            return NextResponse.json({ success: false, error: "발신 이메일 주소를 설정해주세요." }, { status: 400 });
        }
        const senderFromEmail = sender.fromEmail;

        // signatureId는 body에서 온 값을 그대로 넘긴다 — null(서명 없음)과 undefined(미지정)의 구분이 사용자 선택이다
        const signatureJson = await resolveSignature(user.orgId, {
            requestedId: signatureId,
            config,
        });

        if (!templateLinkId || !recordIds || !Array.isArray(recordIds) || recordIds.length === 0) {
            return NextResponse.json({
                success: false,
                error: "templateLinkId와 recordIds는 필수입니다.",
            }, { status: 400 });
        }

        if (recordIds.length > 1000) {
            return NextResponse.json({
                success: false,
                error: "한 번에 최대 1,000건까지 발송할 수 있습니다.",
            }, { status: 400 });
        }

        // 템플릿 연결 정보 조회 (소유권 확인)
        const [linkRow] = await db
            .select()
            .from(emailTemplateLinks)
            .innerJoin(partitions, eq(partitions.id, emailTemplateLinks.partitionId))
            .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
            .where(
                and(
                    eq(emailTemplateLinks.id, templateLinkId),
                    eq(workspaces.orgId, user.orgId)
                )
            )
            .limit(1);

        if (!linkRow) {
            return NextResponse.json({ success: false, error: "템플릿 연결을 찾을 수 없습니다." }, { status: 404 });
        }

        const templateLink = linkRow.email_template_links;
        const workspaceId = linkRow.workspaces.id;

        // 이메일 템플릿 조회
        const [template] = await db
            .select()
            .from(emailTemplates)
            .where(eq(emailTemplates.id, templateLink.emailTemplateId))
            .limit(1);

        if (!template) {
            return NextResponse.json({ success: false, error: "이메일 템플릿을 찾을 수 없습니다." }, { status: 404 });
        }

        // 레코드 조회
        const recordList = await db
            .select()
            .from(records)
            .where(inArray(records.id, recordIds));

        const errors: Array<{ recordId: number; error: string }> = [];
        let successCount = 0;
        let failCount = 0;

        const mappings = (templateLink.variableMappings as Record<string, string>) || {};

        for (const record of recordList) {
            const data = record.data as Record<string, unknown>;
            const email = data[templateLink.recipientField];

            if (!email || typeof email !== "string" || !email.includes("@")) {
                errors.push({ recordId: record.id, error: "유효하지 않은 이메일" });
                continue;
            }

            if (await isUnsubscribed(workspaceId, email)) {
                errors.push({ recordId: record.id, error: "수신거부한 주소입니다." });
                continue;
            }

            const substitutedSubject = substituteVariables(template.subject, mappings, data);
            let finalBody = substituteVariables(template.htmlBody, mappings, data);
            if (signatureJson) {
                finalBody = appendSignature(finalBody, signatureJson);
            }

            const unsubscribeToken = template.useUnsubscribe ? generateUnsubscribeToken() : null;
            if (unsubscribeToken) {
                finalBody = appendUnsubscribeFooter(finalBody, buildUnsubscribeUrl(unsubscribeToken));
            }

            // 로그 먼저 insert → logId 획득 → 트래킹 URL 삽입 → 발송 → status 업데이트
            const [logEntry] = await db.insert(emailSendLogs).values({
                orgId: user.orgId,
                templateLinkId: templateLink.id,
                partitionId: templateLink.partitionId,
                recordId: record.id,
                emailTemplateId: template.id,
                recipientEmail: email,
                subject: substitutedSubject,
                body: finalBody,
                status: "pending",
                triggerType: "manual",
                sentBy: user.userId,
                unsubscribeToken,
                senderProfileId: sender.profileId,
            }).returning({ id: emailSendLogs.id });

            const trackedBody = wrapTrackingUrls(finalBody, logEntry.id);

            const nhnResult = await client.sendEachMail({
                senderAddress: senderFromEmail,
                senderName: sender.fromName,
                title: substitutedSubject,
                body: trackedBody,
                receiverList: [{ receiveMailAddr: email, receiveType: "MRT0" }],
                ...(unsubscribeToken
                    ? { customHeaders: buildListUnsubscribeHeaders(unsubscribeToken) }
                    : {}),
            });

            const sendResult = nhnResult.data?.results?.[0];
            const isSuccess = nhnResult.header.isSuccessful && (!sendResult || sendResult.resultCode === 0);

            await db.update(emailSendLogs)
                .set({
                    requestId: nhnResult.data?.requestId,
                    status: isSuccess ? "sent" : "failed",
                    resultCode: sendResult ? String(sendResult.resultCode) : null,
                    resultMessage: sendResult?.resultMessage ?? nhnResult.header.resultMessage,
                })
                .where(eq(emailSendLogs.id, logEntry.id));

            if (isSuccess) successCount++;
            else failCount++;
        }

        return NextResponse.json({
            success: true,
            data: {
                totalCount: recordList.length,
                successCount,
                failCount,
                errors: errors.length > 0 ? errors : undefined,
            },
        });
    } catch (error) {
        console.error("Email send error:", error);
        return NextResponse.json({ success: false, error: "발송에 실패했습니다." }, { status: 500 });
    }
}
