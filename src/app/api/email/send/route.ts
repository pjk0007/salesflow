import { NextRequest, NextResponse } from "next/server";
import { db, emailTemplateLinks, emailTemplates, emailSendLogs, records, partitions, workspaces, emailSenderProfiles, emailSignatures } from "@/lib/db";
import { eq, and, inArray } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { getEmailClient, getEmailConfig, substituteVariables, appendSignature } from "@/lib/nhn-email";

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
        const { templateLinkId, recordIds, senderProfileId, signatureId } = await req.json();

        // 발신자 프로필 결정
        let senderFromEmail: string | null = null;
        let senderFromName: string | undefined;

        if (senderProfileId) {
            const [profile] = await db
                .select()
                .from(emailSenderProfiles)
                .where(and(eq(emailSenderProfiles.id, senderProfileId), eq(emailSenderProfiles.orgId, user.orgId)));
            if (profile) {
                senderFromEmail = profile.fromEmail;
                senderFromName = profile.fromName;
            }
        }
        if (!senderFromEmail) {
            // 기본 프로필 fallback
            const [defaultProfile] = await db
                .select()
                .from(emailSenderProfiles)
                .where(and(eq(emailSenderProfiles.orgId, user.orgId), eq(emailSenderProfiles.isDefault, true)))
                .limit(1);
            if (defaultProfile) {
                senderFromEmail = defaultProfile.fromEmail;
                senderFromName = defaultProfile.fromName;
            } else if (config?.fromEmail) {
                // 레거시 fallback
                senderFromEmail = config.fromEmail;
                senderFromName = config.fromName || undefined;
            }
        }
        if (!senderFromEmail) {
            return NextResponse.json({ success: false, error: "발신 이메일 주소를 설정해주세요." }, { status: 400 });
        }

        // 서명 결정
        let signatureJson: string | null = null;
        if (signatureId === null) {
            // 명시적으로 "서명 없음" 선택
            signatureJson = null;
        } else if (signatureId) {
            const [sig] = await db
                .select()
                .from(emailSignatures)
                .where(and(eq(emailSignatures.id, signatureId), eq(emailSignatures.orgId, user.orgId)));
            if (sig) signatureJson = sig.signature;
        } else {
            // signatureId 미전달 → 기본 서명
            const [defaultSig] = await db
                .select()
                .from(emailSignatures)
                .where(and(eq(emailSignatures.orgId, user.orgId), eq(emailSignatures.isDefault, true)))
                .limit(1);
            if (defaultSig) signatureJson = defaultSig.signature;
            else if (config?.signatureEnabled && config?.signature) signatureJson = config.signature;
        }

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
            let finalBody = substituteVariables(template.htmlBody, mappings, data);
            if (signatureJson) {
                finalBody = appendSignature(finalBody, signatureJson);
            }

            const nhnResult = await client.sendEachMail({
                senderAddress: senderFromEmail!,
                senderName: senderFromName,
                title: substitutedSubject,
                body: finalBody,
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
                body: finalBody,
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
