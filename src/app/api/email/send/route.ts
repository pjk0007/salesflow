import { NextRequest, NextResponse } from "next/server";
import { db, emailTemplateLinks, emailTemplates, emailSendLogs, records, partitions, workspaces } from "@/lib/db";
import { eq, and, inArray } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { getEmailClient, getEmailConfig, substituteVariables } from "@/lib/nhn-email";

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
    if (!config?.fromEmail) {
        return NextResponse.json({ success: false, error: "발신 이메일 주소를 설정해주세요." }, { status: 400 });
    }

    try {
        const { templateLinkId, recordIds } = await req.json();

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

            const substitutedSubject = substituteVariables(template.subject, mappings, data);
            const substitutedBody = substituteVariables(template.htmlBody, mappings, data);

            const nhnResult = await client.sendEachMail({
                senderAddress: config.fromEmail,
                senderName: config.fromName || undefined,
                title: substitutedSubject,
                body: substitutedBody,
                receiverList: [{ receiveMailAddr: email, receiveType: "MRT0" }],
            });

            const isSuccess = nhnResult.header.isSuccessful;
            const sendResult = nhnResult.data?.results?.[0];

            await db.insert(emailSendLogs).values({
                orgId: user.orgId,
                templateLinkId: templateLink.id,
                partitionId: templateLink.partitionId,
                recordId: record.id,
                emailTemplateId: template.id,
                recipientEmail: email,
                subject: substitutedSubject,
                requestId: nhnResult.data?.requestId,
                status: isSuccess ? "sent" : "failed",
                resultCode: sendResult ? String(sendResult.resultCode) : null,
                resultMessage: sendResult?.resultMessage ?? nhnResult.header.resultMessage,
                triggerType: "manual",
                sentBy: user.userId,
            });

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
