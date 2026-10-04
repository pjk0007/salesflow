import { NextRequest, NextResponse } from "next/server";
import { db, emailTemplates, workspaces } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { getEmailClient, getEmailConfig, appendSignature } from "@/lib/nhn-email";
import { resolveSender, resolveSignature } from "@/lib/email-sender-resolver";
import { buildCustomHeaders, replyToHeaderValue } from "@/lib/reply-to-rules";

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
        const { templateId, recipientEmail, variables, senderProfileId, signatureId, workspaceId } = await req.json() as {
            templateId?: number;
            recipientEmail?: string;
            variables?: Record<string, unknown>;
            senderProfileId?: number;
            signatureId?: number | null;
            /** 답장 받을 주소를 가져올 워크스페이스 (DESIGN-3). 생략하면 조직의 워크스페이스가 하나일 때만 그 값을 쓴다 */
            workspaceId?: number | null;
        };

        if (!templateId || !recipientEmail || !recipientEmail.includes("@")) {
            return NextResponse.json({ success: false, error: "템플릿 ID와 유효한 수신자 이메일이 필요합니다." }, { status: 400 });
        }
        if (workspaceId !== undefined && workspaceId !== null && !(Number.isSafeInteger(workspaceId) && workspaceId > 0)) {
            return NextResponse.json({ success: false, error: "워크스페이스 id가 올바르지 않습니다." }, { status: 400 });
        }

        // 답장 받을 주소 (DESIGN-3). 템플릿은 조직 단위라 워크스페이스를 모른다 — 화면이 넘긴 워크스페이스(이 조직 것만),
        // 넘기지 않았으면 조직의 워크스페이스가 하나일 때 그 값. 여럿인데 고르지 않았으면 넣지 않는다 (예전과 같음)
        const orgWorkspaces = await db
            .select({ id: workspaces.id, replyToEmail: workspaces.replyToEmail })
            .from(workspaces)
            .where(
                workspaceId
                    ? and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, user.orgId))
                    : eq(workspaces.orgId, user.orgId)
            )
            .limit(2);
        if (workspaceId && orgWorkspaces.length === 0) {
            return NextResponse.json({ success: false, error: "워크스페이스를 찾을 수 없습니다." }, { status: 404 });
        }
        const replyTo = orgWorkspaces.length === 1 ? replyToHeaderValue(orgWorkspaces[0].replyToEmail) : null;

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
            ...buildCustomHeaders({ replyTo }),
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
