import { classifyEmailSubmission, nhnEmailFailureMessage } from "@/lib/nhn-submit-result";
import { NextRequest, NextResponse } from "next/server";
import { db, emailTemplates } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { getEmailClient, getEmailConfig, appendSignature } from "@/lib/nhn-email";
import { resolveSender, resolveSignature } from "@/lib/email-sender-resolver";

export async function POST(req: NextRequest) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const client = await getEmailClient(user.orgId);
    if (!client) {
        return NextResponse.json({ success: false, error: "이메일 설정이 필요합니다." }, { status: 400 });
    }

    try {
        const { templateId, recipientEmail, variables, senderProfileId, signatureId } = await req.json() as {
            templateId?: number;
            recipientEmail?: string;
            variables?: Record<string, unknown>;
            senderProfileId?: number;
            signatureId?: number | null;
        };

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

        // 발신자 결정 (선택값 → 기본 프로필 → 레거시 fallback)
        // config는 프로필 테이블 없이 email_configs만 쓰는 org를 위해 반드시 넘긴다
        const config = await getEmailConfig(user.orgId);

        const sender = await resolveSender(user.orgId, {
            preferredIds: [senderProfileId],
            config,
        });
        if (!sender.fromEmail) {
            return NextResponse.json({ success: false, error: "발신 이메일 주소를 설정해주세요." }, { status: 400 });
        }

        // body에서 온 값을 그대로 넘긴다 — null(서명 없음)과 undefined(미지정)의 구분이 사용자 선택이다
        const signatureJson = await resolveSignature(user.orgId, {
            requestedId: signatureId,
            config,
        });

        // 변수 치환
        let subject = template.subject;
        let body = template.htmlBody || "";
        if (variables && typeof variables === "object") {
            for (const [varName, value] of Object.entries(variables)) {
                subject = subject.replaceAll(varName, String(value));
                body = body.replaceAll(varName, String(value));
            }
        }

        // 서명은 치환 뒤에 붙인다 — 순서를 바꾸면 서명 내용까지 replaceAll 대상이 된다
        if (signatureJson) {
            body = appendSignature(body, signatureJson);
        }

        // 발송
        const result = await client.sendEachMail({
            senderAddress: sender.fromEmail,
            senderName: sender.fromName,
            title: subject,
            body,
            receiverList: [{ receiveMailAddr: recipientEmail, receiveType: "MRT0" }],
        });

        // 다른 발송 경로와 같은 판정 — NHN이 수신자를 거절해도 성공으로 보이지 않게 수신자별 결과 코드까지 본다 (UX-160)
        const submission = classifyEmailSubmission(result);
        if (submission === "sent") {
            return NextResponse.json({
                success: true,
                requestId: result.data?.requestId,
            });
        } else {
            return NextResponse.json({
                success: false,
                // 헤더 성공인데 수신자 결과도 거절도 없을 때만 '결과 미확인' — 수신자를 거절했으면 그 사유를 보인다
                error: submission === "unknown" && result.header.isSuccessful && !result.data?.results?.some((r) => r.resultCode !== 0)
                    ? "테스트 메일 접수 결과를 확인하지 못했습니다. 받은편지함을 확인한 뒤 필요하면 다시 보내주세요."
                    : nhnEmailFailureMessage(result, "테스트 발송"),
            });
        }
    } catch (error) {
        console.error("Email test-send error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
