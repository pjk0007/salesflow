import { NextRequest, NextResponse } from "next/server";
import { db, emailTemplateLinks, emailTemplates, emailSendLogs, records, partitions, workspaces } from "@/lib/db";
import { eq, and, inArray } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { getEmailClient, getEmailConfig, substituteVariables, appendSignature } from "@/lib/nhn-email";
import { resolveSender, resolveSignature } from "@/lib/email-sender-resolver";
import { claimSender, releaseSenderSlot } from "@/lib/email-sender-limit";
import type { SenderSlot } from "@/lib/email-sender-limit";
import { blocksRestOfBatch, describeLimitedSend } from "@/lib/email-sender-limit-paths";
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

        // 보낼 주소가 아예 없으면 레코드를 돌기 전에 알린다. 실제 발송 주소와 오늘 자리는 레코드마다 claimSender가 정한다
        const sender = await resolveSender(user.orgId, {
            preferredIds: [senderProfileId],
            config,
        });
        if (!sender.fromEmail) {
            return NextResponse.json({ success: false, error: "발신 이메일 주소를 설정해주세요." }, { status: 400 });
        }

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

        // 이메일 템플릿 조회 — 이 조직 템플릿만. 연결이 이 조직 것이어도 연결이 가리키는 템플릿 id는 따로 확인해야 한다
        // (예전 연결 API가 남의 템플릿 id를 그대로 저장했다 — 조건이 없으면 다른 조직 템플릿 내용이 발송된다)
        const [template] = await db
            .select()
            .from(emailTemplates)
            .where(and(eq(emailTemplates.id, templateLink.emailTemplateId), eq(emailTemplates.orgId, user.orgId)))
            .limit(1);

        if (!template) {
            return NextResponse.json({ success: false, error: "이메일 템플릿을 찾을 수 없습니다." }, { status: 404 });
        }

        // 레코드 조회 — 이 조직 레코드만. 조직 조건이 없으면 남의 레코드 id를 넣어 그 주소로 보낼 수 있다
        const recordList = await db
            .select()
            .from(records)
            .where(and(inArray(records.id, recordIds), eq(records.orgId, user.orgId)));

        // 보내지 않은 레코드와 이유. 화면이 누구인지 보이도록 이미 읽은 레코드 코드와 수신 이메일 칸 값을 함께 준다
        const errors: Array<{ recordId: number; error: string; email: string | null; code: string | null }> = [];
        let successCount = 0;
        let failCount = 0;
        // 발신 프로필 한도(하루 최대·시간대·정지·간격)에 걸려 보내지 않은 건수
        let limitedCount = 0;
        // 남은 레코드도 똑같이 막히는 이유로 막혔으면 그 문구. 이후 레코드는 자리 잡기를 다시 하지 않는다
        let batchBlockedMessage: string | null = null;

        const mappings = (templateLink.variableMappings as Record<string, string>) || {};

        for (const record of recordList) {
            const data = record.data as Record<string, unknown>;
            const email = data[templateLink.recipientField];
            const notSent = (error: string) => {
                errors.push({
                    recordId: record.id,
                    error,
                    email: typeof email === "string" && email.trim() !== "" ? email : null,
                    code: record.integratedCode ?? null,
                });
            };

            if (!email || typeof email !== "string" || !email.includes("@")) {
                notSent("유효하지 않은 이메일");
                continue;
            }

            if (await isUnsubscribed(workspaceId, email)) {
                notSent("수신거부한 주소입니다.");
                continue;
            }

            if (batchBlockedMessage) {
                notSent(batchBlockedMessage);
                limitedCount++;
                continue;
            }

            // 고른 발신 프로필의 오늘 자리 하나. 사용자가 직접 고른 주소라 다른 주소로 넘기지 않는다 (fixed).
            // 수동 발송은 미뤄 둘 곳이 없어 막히면 보내지 않고 건수와 이유를 돌려준다
            const claim = await claimSender(user.orgId, {
                mode: "fixed",
                ids: [senderProfileId],
                config,
                // 수동 발송은 문의와 같이 그날 한도 전체를 쓴다 — 대량 명단에 남겨 둔 문의 몫까지 (DESIGN-2 2절)
                purpose: "inbound",
            });
            if (!claim.ok) {
                const message = describeLimitedSend(claim.reason, claim.retryAt);
                notSent(message);
                limitedCount++;
                if (blocksRestOfBatch(claim.reason)) batchBlockedMessage = message;
                continue;
            }
            const slot: SenderSlot = claim.slot;
            const slotSender = slot.sender;
            if (!slotSender.fromEmail) {
                // 요청 처음에 확인한 주소가 그사이 지워진 경우
                await releaseSenderSlot(slot);
                notSent("발신 이메일 주소를 설정해주세요.");
                continue;
            }
            const slotFromEmail = slotSender.fromEmail;

            // sendEachMail을 부르기 전에 던지면 자리를 돌려준다 — 부른 뒤에는 나갔을 수 있어 돌려주지 않는다
            let sendAttempted = false;
            try {
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
                    senderProfileId: slotSender.profileId,
                    // 보낼 때 쓴 주소 그대로 (DESIGN-3 4-1)
                    senderEmail: slotFromEmail,
                }).returning({ id: emailSendLogs.id });

                const trackedBody = wrapTrackingUrls(finalBody, logEntry.id);

                sendAttempted = true;
                const nhnResult = await client.sendEachMail({
                    senderAddress: slotFromEmail,
                    senderName: slotSender.fromName,
                    title: substitutedSubject,
                    body: trackedBody,
                    receiverList: [{ receiveMailAddr: email, receiveType: "MRT0" }],
                    ...(unsubscribeToken
                        ? { customHeaders: buildListUnsubscribeHeaders(unsubscribeToken) }
                        : {}),
                });

                const sendResult = nhnResult.data?.results?.[0];
                const isSuccess = nhnResult.header.isSuccessful && (!sendResult || sendResult.resultCode === 0);
                // NHN이 받지 않았다 — 나가지 않았으니 자리를 돌려준다
                if (!isSuccess) await releaseSenderSlot(slot);

                await db.update(emailSendLogs)
                    .set({
                        requestId: nhnResult.data?.requestId,
                        status: isSuccess ? "sent" : "failed",
                        resultCode: sendResult ? String(sendResult.resultCode) : null,
                        resultMessage: sendResult?.resultMessage ?? nhnResult.header.resultMessage,
                    })
                    .where(eq(emailSendLogs.id, logEntry.id));

                if (isSuccess) {
                    successCount++;
                } else {
                    failCount++;
                    // NHN이 받지 않은 레코드도 "보내지 않은 레코드"에 넣어 화면이 누구인지 보이게 한다
                    const reason = sendResult?.resultMessage ?? nhnResult.header.resultMessage;
                    notSent(`NHN이 발송을 받지 않았습니다${reason ? ` (${reason})` : ""}.`);
                }
            } catch (err) {
                if (!sendAttempted) await releaseSenderSlot(slot);
                throw err;
            }
        }

        return NextResponse.json({
            success: true,
            data: {
                totalCount: recordList.length,
                successCount,
                failCount,
                limitedCount,
                errors: errors.length > 0 ? errors : undefined,
            },
        });
    } catch (error) {
        console.error("Email send error:", error);
        return NextResponse.json({ success: false, error: "발송에 실패했습니다." }, { status: 500 });
    }
}
