import { NextRequest, NextResponse } from "next/server";
import { db, emailAutoPersonalizedLinks, emailSendLogs, emailClickLogs, records } from "@/lib/db";
import { eq, and, desc, isNotNull, inArray } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { generateAiFollowupPreview } from "@/lib/email-followup";
import { getEmailClient, getEmailConfig } from "@/lib/nhn-email";
import { resolveDefaultSender } from "@/lib/email-sender-resolver";
import { wrapTrackingUrls } from "@/lib/email-click-tracking";

/**
 * GET /api/email/auto-personalized/test-followup?linkId=...
 * 해당 규칙으로 발송된 최근 로그 목록 반환 (테스트 대상 후보)
 */
export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const linkId = Number(req.nextUrl.searchParams.get("linkId"));
    if (!linkId) {
        return NextResponse.json({ success: false, error: "linkId가 필요합니다." }, { status: 400 });
    }

    const [link] = await db
        .select()
        .from(emailAutoPersonalizedLinks)
        .where(and(eq(emailAutoPersonalizedLinks.id, linkId), eq(emailAutoPersonalizedLinks.orgId, user.orgId)))
        .limit(1);
    if (!link) {
        return NextResponse.json({ success: false, error: "규칙을 찾을 수 없습니다." }, { status: 404 });
    }

    const rawLogs = await db
        .select({
            id: emailSendLogs.id,
            subject: emailSendLogs.subject,
            recipientEmail: emailSendLogs.recipientEmail,
            sentAt: emailSendLogs.sentAt,
            recordId: emailSendLogs.recordId,
            recordData: records.data,
        })
        .from(emailSendLogs)
        .leftJoin(records, eq(records.id, emailSendLogs.recordId))
        .where(
            and(
                eq(emailSendLogs.orgId, user.orgId),
                eq(emailSendLogs.autoPersonalizedLinkId, linkId),
                isNotNull(emailSendLogs.recordId)
            )
        )
        .orderBy(desc(emailSendLogs.sentAt))
        .limit(100);

    // 로그별 링크 클릭 여부 일괄 조회 (N+1 방지)
    const logIds = rawLogs.map((l) => l.id);
    const clickedSet = new Set<number>();
    if (logIds.length > 0) {
        const clicks = await db
            .selectDistinct({ sendLogId: emailClickLogs.sendLogId })
            .from(emailClickLogs)
            .where(inArray(emailClickLogs.sendLogId, logIds));
        for (const c of clicks) if (c.sendLogId != null) clickedSet.add(c.sendLogId);
    }

    // 레코드 데이터에서 채널명/회사명 등 식별성 높은 필드 추출
    const IDENTIFIER_KEYS = [
        "채널명",
        "channelName",
        "회사명",
        "companyName",
        "name",
        "이름",
        "대표자",
        "contactName",
    ];
    const logs = rawLogs.map(({ recordData, ...log }) => {
        const data = (recordData ?? {}) as Record<string, unknown>;
        let identifier: string | null = null;
        for (const key of IDENTIFIER_KEYS) {
            const v = data[key];
            if (v != null && v !== "") {
                identifier = String(v);
                break;
            }
        }
        return { ...log, identifier, isClicked: clickedSet.has(log.id) };
    });

    return NextResponse.json({ success: true, data: { link, logs } });
}

/**
 * POST /api/email/auto-personalized/test-followup
 * body: { linkId, parentLogId, stepIndex, isClicked, testEmail?, mode: "preview" | "send" }
 * mode === "preview": 본문만 생성해서 반환
 * mode === "send": testEmail로 실제 발송도 진행
 */
export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const body = await req.json();
    const {
        linkId,
        parentLogId,
        stepIndex,
        isClicked,
        testEmail,
        mode = "preview",
    }: {
        linkId: number;
        parentLogId: number;
        stepIndex: number;
        isClicked: boolean;
        testEmail?: string;
        mode?: "preview" | "send";
    } = body;

    if (!linkId || !parentLogId || stepIndex == null || isClicked == null) {
        return NextResponse.json(
            { success: false, error: "linkId, parentLogId, stepIndex, isClicked가 필요합니다." },
            { status: 400 }
        );
    }
    if (mode === "send" && (!testEmail || !testEmail.includes("@"))) {
        return NextResponse.json(
            { success: false, error: "send 모드에서는 유효한 testEmail이 필요합니다." },
            { status: 400 }
        );
    }

    const result = await generateAiFollowupPreview(
        { linkId, parentLogId, stepIndex, isClicked },
        user.orgId
    );

    if (!result.success) {
        return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    // 어떤 레코드 데이터로 치환됐는지 디버그용으로 반환
    let recordPreview: Record<string, unknown> | null = null;
    const [parentLog] = await db
        .select({ recordId: emailSendLogs.recordId })
        .from(emailSendLogs)
        .where(eq(emailSendLogs.id, parentLogId))
        .limit(1);
    if (parentLog?.recordId) {
        const [rec] = await db
            .select({ data: records.data })
            .from(records)
            .where(eq(records.id, parentLog.recordId))
            .limit(1);
        recordPreview = rec?.data as Record<string, unknown> | null;
    }

    if (mode === "preview") {
        return NextResponse.json({
            success: true,
            data: {
                subject: result.subject,
                htmlBody: result.htmlBody,
                recordData: recordPreview,
            },
        });
    }

    // mode === "send": 실제 발송
    const emailConfig = await getEmailConfig(user.orgId);
    const sender = await resolveDefaultSender(user.orgId, emailConfig);
    if (!sender.fromEmail) {
        return NextResponse.json(
            { success: false, error: "기본 발신 프로필이 설정되어 있지 않습니다." },
            { status: 400 }
        );
    }
    const client = await getEmailClient(user.orgId);
    if (!client) {
        return NextResponse.json(
            { success: false, error: "이메일 클라이언트가 설정되어 있지 않습니다." },
            { status: 400 }
        );
    }

    const testSubject = `[테스트 후속] ${result.subject}`;
    const [inserted] = await db
        .insert(emailSendLogs)
        .values({
            orgId: user.orgId,
            autoPersonalizedLinkId: linkId,
            recipientEmail: testEmail!,
            subject: testSubject,
            body: result.htmlBody,
            status: "pending",
            triggerType: "test_followup",
        })
        .returning();

    const trackedBody = wrapTrackingUrls(result.htmlBody, inserted.id);

    const nhnResult = await client.sendEachMail({
        senderAddress: sender.fromEmail,
        senderName: sender.fromName,
        title: testSubject,
        body: trackedBody,
        receiverList: [{ receiveMailAddr: testEmail!, receiveType: "MRT0" }],
    });

    const sendResult = nhnResult.data?.results?.[0];
    const isSuccess = nhnResult.header.isSuccessful && (!sendResult || sendResult.resultCode === 0);

    await db
        .update(emailSendLogs)
        .set({
            requestId: nhnResult.data?.requestId,
            status: isSuccess ? "sent" : "failed",
            resultCode: sendResult ? String(sendResult.resultCode) : null,
            resultMessage: sendResult?.resultMessage ?? nhnResult.header.resultMessage,
        })
        .where(eq(emailSendLogs.id, inserted.id));

    if (!isSuccess) {
        return NextResponse.json(
            {
                success: false,
                error: sendResult?.resultMessage ?? nhnResult.header.resultMessage ?? "발송 실패",
            },
            { status: 500 }
        );
    }

    return NextResponse.json({
        success: true,
        data: {
            subject: result.subject,
            htmlBody: result.htmlBody,
            recordData: recordPreview,
        },
    });
}
