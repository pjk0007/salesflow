import { NextRequest, NextResponse } from "next/server";
import { db, emailTemplates, emailSenderProfiles } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { getEmailClient, getEmailConfig } from "@/lib/nhn-email";

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const client = await getEmailClient(user.orgId);
    if (!client) {
        return NextResponse.json({ success: false, error: "이메일 설정이 필요합니다." }, { status: 400 });
    }

    try {
        const { templateId, recipientEmail, variables } = await req.json();

        if (!templateId || !recipientEmail || !recipientEmail.includes("@")) {
            return NextResponse.json({ success: false, error: "템플릿 ID와 유효한 수신자 이메일이 필요합니다." }, { status: 400 });
        }

        // 템플릿 조회
        const [template] = await db
            .select()
            .from(emailTemplates)
            .where(and(eq(emailTemplates.id, templateId), eq(emailTemplates.orgId, user.orgId)));
        if (!template) {
            return NextResponse.json({ success: false, error: "템플릿을 찾을 수 없습니다." }, { status: 404 });
        }

        // 발신자 결정 (기본 프로필 → 레거시 fallback)
        let senderFromEmail: string | null = null;
        let senderFromName: string | undefined;

        const [defaultProfile] = await db
            .select()
            .from(emailSenderProfiles)
            .where(and(eq(emailSenderProfiles.orgId, user.orgId), eq(emailSenderProfiles.isDefault, true)))
            .limit(1);
        if (defaultProfile) {
            senderFromEmail = defaultProfile.fromEmail;
            senderFromName = defaultProfile.fromName;
        } else {
            const config = await getEmailConfig(user.orgId);
            if (config?.fromEmail) {
                senderFromEmail = config.fromEmail;
                senderFromName = config.fromName || undefined;
            }
        }
        if (!senderFromEmail) {
            return NextResponse.json({ success: false, error: "발신 이메일 주소를 설정해주세요." }, { status: 400 });
        }

        // 변수 치환
        let subject = template.subject;
        let body = template.htmlBody || "";
        if (variables && typeof variables === "object") {
            for (const [varName, value] of Object.entries(variables)) {
                subject = subject.replaceAll(varName, String(value));
                body = body.replaceAll(varName, String(value));
            }
        }

        // 발송
        const result = await client.sendEachMail({
            senderAddress: senderFromEmail,
            senderName: senderFromName,
            title: subject,
            body,
            receiverList: [{ receiveMailAddr: recipientEmail, receiveType: "MRT0" }],
        });

        if (result.header.isSuccessful) {
            return NextResponse.json({
                success: true,
                requestId: result.data?.requestId,
            });
        } else {
            return NextResponse.json({
                success: false,
                error: result.header.resultMessage || "발송에 실패했습니다.",
            });
        }
    } catch (error) {
        console.error("Email test-send error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
