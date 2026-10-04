import { db, queryClient, emailTemplateLinks, emailSendLogs, emailAutomationQueue, emailTemplates, records } from "@/lib/db";
import { eq, ne, and, gt, gte, lte, asc, inArray, notInArray, sql } from "drizzle-orm";
import { getEmailClient, getEmailConfig, substituteVariables, appendSignature } from "@/lib/nhn-email";
import { evaluateCondition } from "@/lib/alimtalk-automation";
import { resolveDefaultSignature } from "@/lib/email-sender-resolver";
import { claimSender, releaseSenderSlot } from "@/lib/email-sender-limit";
import type { SendPurpose, SlotDeferReason } from "@/lib/email-sender-limit-rules";
import { enqueueFollowup } from "@/lib/email-followup";
import { DEADLINE_BUDGET_MS, isDeadlineExceeded } from "@/lib/email-send-queue-rules";
import {
    activeBlock,
    purposeBlockKey,
    recordPurposeBlock,
    templateFirstKind,
    templateFirstKindsBlockedBy,
    templateFirstPurpose,
    TEMPLATE_FIRST_KINDS,
    REPEAT_QUEUE_PHASES,
} from "@/lib/email-sender-limit-paths";
import { wrapTrackingUrls } from "@/lib/email-click-tracking";
import {
    isUnsubscribed,
    resolveWorkspaceId,
    generateUnsubscribeToken,
    buildUnsubscribeUrl,
    appendUnsubscribeFooter,
    buildListUnsubscribeHeaders,
} from "@/lib/email-unsubscribe";
import { newReplyToResolver } from "@/lib/email-reply-to";
import type { ReplyToResolver } from "@/lib/email-reply-to";
import { buildCustomHeaders } from "@/lib/reply-to-rules";
import type { DbRecord, EmailTemplateLink } from "@/lib/db";

// ============================================
// 쿨다운 체크 (중복 발송 방지)
// ============================================

async function checkEmailCooldown(
    recordId: number,
    templateLinkId: number,
    cooldownHours: number = 1
): Promise<boolean> {
    const since = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);

    const [existing] = await db
        .select({ id: emailSendLogs.id })
        .from(emailSendLogs)
        .where(
            and(
                eq(emailSendLogs.recordId, recordId),
                eq(emailSendLogs.templateLinkId, templateLinkId),
                gte(emailSendLogs.sentAt, since),
                inArray(emailSendLogs.status, ["sent", "pending"])
            )
        )
        .limit(1);

    return !existing;
}

// ============================================
// 중복 수신자 체크 (같은 규칙 + 같은 이메일로 이미 발송한 이력)
// ============================================

async function checkDuplicateRecipient(
    templateLinkId: number,
    recipientEmail: string
): Promise<boolean> {
    const [existing] = await db
        .select({ id: emailSendLogs.id })
        .from(emailSendLogs)
        .where(
            and(
                eq(emailSendLogs.templateLinkId, templateLinkId),
                eq(emailSendLogs.recipientEmail, recipientEmail),
                eq(emailSendLogs.status, "sent")
            )
        )
        .limit(1);
    return !existing;
}

// ============================================
// 단건 자동 발송
// ============================================

/**
 * 템플릿 메일의 기본 발송 목적 (DESIGN-2 2절). 첫 메일(폼 제출 등 한 건씩 생긴 레코드, 미뤄 둔 kind='first' 포함)은 문의,
 * 반복은 대량이다. 가져오기·예약 등록으로 생긴 레코드의 첫 메일은 부르는 쪽이 "bulk"를 넘긴다 (kind='first_bulk').
 */
function templatePurpose(triggerType: "auto" | "repeat"): SendPurpose {
    return triggerType === "repeat" ? "bulk" : "inbound";
}

/** 한 통 결과. deferred가 있으면 기본 발신 주소가 한도·시간대에 막혀 보내지 않았다 (retryAt에 다시) */
interface TemplateSendResult {
    success: boolean;
    logId?: number;
    deferred?: { retryAt: Date; reason: SlotDeferReason };
}

async function sendEmailSingle(
    link: EmailTemplateLink,
    record: DbRecord,
    orgId: string,
    triggerType: "auto" | "repeat",
    opts: {
        /** 생략하면 templatePurpose(triggerType) */
        purpose?: SendPurpose;
        /** 답장 받을 주소 조회 (반복 대기열은 회차마다 하나) */
        replyTo: ReplyToResolver;
    }
): Promise<TemplateSendResult> {
    const purpose: SendPurpose = opts.purpose ?? templatePurpose(triggerType);
    const client = await getEmailClient(orgId);
    if (!client) return { success: false };

    const config = await getEmailConfig(orgId);

    // 이메일 템플릿 조회 — 이 조직 템플릿만 (orgId는 규칙 파티션의 조직, 대기열 줄의 조직).
    // 연결에 남의 템플릿 id가 들어 있어도 그 내용을 보내지 않는다
    const [template] = await db
        .select()
        .from(emailTemplates)
        .where(and(eq(emailTemplates.id, link.emailTemplateId), eq(emailTemplates.orgId, orgId)))
        .limit(1);

    if (!template) return { success: false };

    const data = record.data as Record<string, unknown>;
    const email = data[link.recipientField];
    if (!email || typeof email !== "string" || !email.includes("@")) return { success: false };

    const workspaceId = await resolveWorkspaceId(link.partitionId);
    if (!workspaceId) return { success: false };
    if (await isUnsubscribed(workspaceId, email)) return { success: false };

    // 발신 주소 + 오늘 자리 (기본 프로필 → 레거시 fallback). 템플릿 규칙에는 발신 주소 칸이 없어 늘 기본 주소다.
    // 보낼 게 확실해진 뒤(템플릿·주소·수신거부 확인 뒤)에 잡아서 헛예약을 만들지 않는다
    // 막히면 반복 대기열이 retryAt에 다시 본다 — 간격 미룸은 순번대로 펼친다
    // 문의 첫 메일은 그날 한도 전체를, 대량(반복·가져오기 명단의 첫 메일)은 15:00(KST) 전까지 문의 몫을 남긴 한도를 쓴다
    const claim = await claimSender(orgId, {
        mode: "fixed",
        ids: [],
        config,
        spreadDeferrals: true,
        purpose,
    });
    if (!claim.ok) {
        return { success: false, deferred: { retryAt: claim.retryAt, reason: claim.reason } };
    }
    const slot = claim.slot;
    const sender = slot.sender;
    if (!sender.fromEmail) {
        await releaseSenderSlot(slot);
        return { success: false };
    }
    const senderFromEmail = sender.fromEmail;
    const senderFromName = sender.fromName;

    // sendEachMail을 부르기 전에 던지면 자리를 돌려준다 — 부른 뒤에는 나갔을 수 있어 돌려주지 않는다
    let sendAttempted = false;
    try {
        // 답장 받을 주소 — 받는 레코드의 워크스페이스 값 (없으면 Reply-To 없음, DESIGN-3)
        const replyTo = await opts.replyTo.forWorkspace(record.workspaceId || workspaceId);

        // 서명 결정 (기본 서명 → 레거시 fallback)
        const signatureJson = await resolveDefaultSignature(orgId, config);

        // 변수 매핑
        const mappings = (link.variableMappings as Record<string, string>) || {};
        const substitutedSubject = substituteVariables(template.subject, mappings, data);
        let finalBody = substituteVariables(template.htmlBody, mappings, data);
        if (signatureJson) {
            finalBody = appendSignature(finalBody, signatureJson);
        }

        const unsubscribeToken = template.useUnsubscribe ? generateUnsubscribeToken() : null;
        if (unsubscribeToken) {
            finalBody = appendUnsubscribeFooter(finalBody, buildUnsubscribeUrl(unsubscribeToken));
        }

        const [inserted] = await db.insert(emailSendLogs).values({
            orgId,
            templateLinkId: link.id,
            partitionId: link.partitionId,
            recordId: record.id,
            emailTemplateId: template.id,
            recipientEmail: email,
            subject: substitutedSubject,
            body: finalBody,
            status: "pending",
            triggerType,
            sentAt: new Date(),
            unsubscribeToken,
            // 후속 메일이 첫 메일을 보낸 주소를 이어 쓰게 남긴다 (예전 로그는 null → 후속은 그때의 기본 주소)
            senderProfileId: sender.profileId,
            // 보낼 때 쓴 주소 그대로 (DESIGN-3 4-1)
            senderEmail: senderFromEmail,
        }).returning({ id: emailSendLogs.id });

        const trackedBody = wrapTrackingUrls(finalBody, inserted.id);

        sendAttempted = true;
        const nhnResult = await client.sendEachMail({
            senderAddress: senderFromEmail,
            senderName: senderFromName,
            title: substitutedSubject,
            body: trackedBody,
            receiverList: [{ receiveMailAddr: email, receiveType: "MRT0" }],
            ...buildCustomHeaders({
                listUnsubscribe: unsubscribeToken ? buildListUnsubscribeHeaders(unsubscribeToken) : null,
                replyTo,
            }),
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
            .where(eq(emailSendLogs.id, inserted.id));

        return { success: isSuccess, logId: inserted?.id };
    } catch (err) {
        if (!sendAttempted) await releaseSenderSlot(slot);
        throw err;
    }
}

// ============================================
// 규칙 하나로 첫 메일 보내기
// ============================================

type TemplateFirstOutcome =
    | { kind: "sent" }
    | { kind: "skipped" }
    | { kind: "failed" }
    | { kind: "deferred"; retryAt: Date; reason: SlotDeferReason };

/**
 * 템플릿 규칙 하나로 레코드에 첫 메일을 보낸다: 조건 → 쿨다운 → 중복 수신자 → 발송 → 후속·반복 큐 등록.
 *
 * 바로 보내는 경로(processEmailAutoTrigger)와, 발신 한도로 미뤄 둔 첫 메일(반복 대기열 kind='first'·'first_bulk')이 같이 쓴다 —
 * 본문이 두 벌이면 한쪽만 고쳐진다. 미뤘다 보낼 때도 조건·쿨다운·중복을 그때의 레코드로 다시 본다.
 * purpose: 문의는 그날 한도 전체, 대량(가져오기·예약 등록 명단)은 15:00(KST) 전까지 문의 몫을 남긴다.
 * replyTo: 답장 받을 주소 조회 (반복 대기열은 회차마다 하나, 바로 보내는 경로는 호출마다 하나)
 */
async function sendTemplateFirst(
    link: EmailTemplateLink,
    record: DbRecord,
    orgId: string,
    purpose: SendPurpose,
    replyTo: ReplyToResolver
): Promise<TemplateFirstOutcome> {
    const data = record.data as Record<string, unknown>;

    // 조건 평가
    if (!evaluateCondition(link.triggerCondition as Parameters<typeof evaluateCondition>[0], data)) {
        return { kind: "skipped" };
    }

    // 쿨다운 체크
    const canSend = await checkEmailCooldown(record.id, link.id);
    if (!canSend) return { kind: "skipped" };

    // 중복 수신자 체크
    if (link.preventDuplicate) {
        const email = (data[link.recipientField] as string) || "";
        if (email) {
            const canSendDup = await checkDuplicateRecipient(link.id, email);
            if (!canSendDup) {
                console.log(`[EmailAuto] Duplicate recipient skipped: linkId=${link.id}, email=${email}`);
                return { kind: "skipped" };
            }
        }
    }

    // 발송
    const { success, logId, deferred } = await sendEmailSingle(link, record, orgId, "auto", { purpose, replyTo });
    if (deferred) return { kind: "deferred", retryAt: deferred.retryAt, reason: deferred.reason };
    if (!success) return { kind: "failed" };

    // 후속 발송 큐 등록
    if (logId && link.followupConfig) {
        const steps = Array.isArray(link.followupConfig) ? link.followupConfig : [link.followupConfig];
        const first = steps[0] as { delayDays: number } | undefined;
        if (first?.delayDays) {
            await enqueueFollowup({
                logId,
                sourceType: "template",
                sourceId: link.id,
                orgId,
                sentAt: new Date(),
                delayDays: first.delayDays,
            });
        }
    }

    // 반복 발송 큐 등록
    if (link.repeatConfig) {
        const config = link.repeatConfig as {
            intervalHours: number;
            maxRepeat: number;
            stopCondition: { field: string; operator: "eq" | "ne"; value: string };
        };

        const nextRunAt = new Date(Date.now() + config.intervalHours * 60 * 60 * 1000);

        await db.insert(emailAutomationQueue).values({
            templateLinkId: link.id,
            recordId: record.id,
            orgId,
            repeatCount: 0,
            nextRunAt,
            status: "pending",
            kind: "repeat",
        });
    }

    return { kind: "sent" };
}

/**
 * 발신 한도로 막힌 템플릿 첫 메일을 반복 대기열에 넣는다 (next_run_at = retryAt). kind는 발송 목적대로:
 * 문의 'first', 대량(가져오기·예약 등록 명단) 'first_bulk' — 다시 꺼낼 때 같은 목적으로 자리를 잡는다 (templateFirstKind).
 * 바로 보내는 경로에는 다시 시도할 곳이 없어 넣지 않으면 메일이 사라진다.
 * 같은 (규칙, 레코드)의 첫 메일 줄이 이미 기다리고 있으면 넣지 않는다 — 막힌 동안 레코드를 여러 번 고쳐도 한 통이다.
 */
async function enqueueDeferredTemplateFirst(
    templateLinkId: number,
    recordId: number,
    orgId: string,
    retryAt: Date,
    purpose: SendPurpose
): Promise<void> {
    // db.execute에서는 drizzle이 시각 직렬화를 꺼 두므로 ISO 문자열로 넘기고 형을 붙인다
    const retryAtIso = retryAt.toISOString();
    const kind = templateFirstKind(purpose);
    await db.execute(sql`
        INSERT INTO email_automation_queue (template_link_id, record_id, org_id, repeat_count, next_run_at, status, kind)
        SELECT ${templateLinkId}::int, ${recordId}::int, ${orgId}::uuid, 0, ${retryAtIso}::timestamptz, 'pending', ${kind}::varchar
        WHERE NOT EXISTS (
            SELECT 1 FROM email_automation_queue
            WHERE template_link_id = ${templateLinkId}::int
              AND record_id = ${recordId}::int
              AND kind IN (${sql.join(TEMPLATE_FIRST_KINDS.map((k) => sql`${k}::varchar`), sql`, `)})
              AND status = 'pending'
        )
    `);
}

// ============================================
// 자동 트리거 처리 (레코드 생성/수정 후 호출)
// ============================================

interface EmailAutoTriggerParams {
    record: DbRecord;
    partitionId: number;
    triggerType: "on_create" | "on_update";
    orgId: string;
    /**
     * 첫 메일의 발송 목적 (DESIGN-2 2절). 생략하면 "inbound" — 폼 제출·단건 생성·수정처럼 한 건씩 생긴 레코드 (예전 동작).
     * 가져오기·예약 등록(dispatchImportTriggers)은 "bulk"를 넘긴다 — 15:00(KST) 전까지 주소마다 문의 몫을 남긴다
     */
    purpose?: SendPurpose;
    /**
     * 답장 받을 주소 조회 (DESIGN-3). 가져오기처럼 여러 레코드를 잇달아 부르는 쪽은 하나를 만들어 함께 넘긴다 —
     * 같은 워크스페이스를 레코드마다 다시 읽지 않게. 생략하면 이 호출 안에서만 쓴다
     */
    replyTo?: ReplyToResolver;
}

export async function processEmailAutoTrigger(params: EmailAutoTriggerParams): Promise<void> {
    const { record, partitionId, triggerType, orgId } = params;
    const purpose: SendPurpose = params.purpose ?? "inbound";
    const replyTo = params.replyTo ?? newReplyToResolver();

    const links = await db
        .select()
        .from(emailTemplateLinks)
        .where(
            and(
                eq(emailTemplateLinks.partitionId, partitionId),
                eq(emailTemplateLinks.triggerType, triggerType),
                eq(emailTemplateLinks.isActive, 1)
            )
        );

    if (links.length === 0) return;

    // 규칙마다 따로 본다 — 템플릿 쿨다운이 (레코드, 규칙) 단위라 한 규칙이 미뤄져도 다른 규칙과 엉키지 않는다
    for (const link of links) {
        const outcome = await sendTemplateFirst(link, record, orgId, purpose, replyTo);
        if (outcome.kind === "deferred") {
            console.log(
                `[EmailAuto] linkId=${link.id}, record=${record.id}: deferred (${outcome.reason}) ` +
                `until ${outcome.retryAt.toISOString()}`
            );
            await enqueueDeferredTemplateFirst(link.id, record.id, orgId, outcome.retryAt, purpose);
        }
    }
}

// ============================================
// 반복 큐 처리 (Cron에서 호출)
// ============================================

/** 다른 잡(0x5c4edf01 예약등록, 02 발송 큐, 03·04 깊이 들어온 사람 알림, 05 후속)과 다른 키 — 서로 독립적으로 돈다 */
const REPEAT_LOCK_KEY = 0x5c4edf06;
const REPEAT_BATCH_SIZE = 100;

export interface RepeatQueueRunStats {
    processed: number;
    sent: number;
    completed: number;
    failed: number;
    /** 발신 한도·시간대에 막혀 next_run_at을 retryAt으로 옮긴 줄 (반복 횟수를 쓰지 않는다). 한꺼번에 옮긴 줄도 센다 */
    deferred: number;
    skippedAsLocked?: boolean;
    deadlineHit?: boolean;
}

/**
 * 반복 대기열 워커 (템플릿 반복 메일 + 발신 한도로 미뤄 둔 템플릿 첫 메일 kind='first'·'first_bulk').
 *
 * 예전에는 회차마다 정렬 없이 100줄만 읽고 끝났다. 웜업 중인 기본 주소로 큰 업로드를 하면 'first' 줄이 수만 개
 * 쌓여 매일 같은 시각에 기한이 되는데, 100줄/회차로는 다 보지도 못해 같은 표를 쓰는 다른 조직의 반복 메일이
 * 며칠씩 밀렸다. 이제는
 *   - 잠금을 잡고(회차가 겹쳐 같은 줄을 두 번 보내지 않게) 예산(8분) 동안 기한이 된 줄을 100줄씩 이어서 본다
 *   - 회차를 시작한 시각까지 기한이 된 줄만, id 순으로 한 번씩만 본다 — 처리 뒤에도 기한 안에 남는 줄(던진 줄,
 *     간격이 0인 반복)이 같은 회차에 거듭 나가지 않게. 문의 첫 메일('first')을 먼저 다 보고 나머지('first_bulk'·반복)를
 *     본다 (REPEAT_QUEUE_PHASES, DESIGN-3 4-1) — 같은 시각에 열린 가져오기 명단의 첫 메일이 남은 한 칸을 문의보다 먼저 가져가지 않게
 *   - 한 조직의 기본 주소가 막히면(템플릿 메일은 늘 그 조직의 기본 주소로 나간다) 그 조직의 'first' 줄을 한 문장으로
 *     열리는 시각까지 미루고, 그 조직의 반복 줄도 이번 회차에는 발송 준비 없이 바로 미룬다
 *   - 막힘은 발송 목적별로 적는다 (DESIGN-2 2절): 'first'는 문의(한도 전체), 반복·'first_bulk'(가져오기 명단의 첫 메일)는
 *     대량(15:00 전까지 문의 몫을 남긴다). 대량이 문의 몫 앞에서 막혀도 'first' 줄은 그대로 보낸다. 'first'가 막히면 대량도
 *     막힌 것으로 본다
 *   - 한 줄이 던져도 회차를 멈추지 않는다
 */
export async function processEmailRepeatQueue(): Promise<RepeatQueueRunStats> {
    const stats: RepeatQueueRunStats = { processed: 0, sent: 0, completed: 0, failed: 0, deferred: 0 };

    // 락을 잡은 커넥션에서 해제해야 하므로 전용 커넥션을 확보한다 (email-send-queue.ts와 같은 방식)
    const conn = await queryClient.reserve();
    let acquired = false;

    try {
        const lockResult = await conn<{ acquired: boolean }[]>`
            SELECT pg_try_advisory_lock(${REPEAT_LOCK_KEY}) AS acquired
        `;
        acquired = lockResult[0]?.acquired === true;
        if (!acquired) {
            console.log("[EmailRepeat] another worker running, skip");
            return { ...stats, skippedAsLocked: true };
        }

        const startedAt = Date.now();
        const runStart = new Date(startedAt);
        const run: RepeatRunState = {
            runStart,
            blockedUntil: new Map(),
            movedIds: new Set(),
            // 답장 받을 주소는 회차 동안 워크스페이스마다 한 번만 읽는다 (DESIGN-3)
            replyTo: newReplyToResolver(),
        };

        // 문의 첫 메일('first')을 먼저 다 보고 나머지('first_bulk'·'repeat')를 본다. 차례 안에서는 id 순 (REPEAT_QUEUE_PHASES, R8)
        for (const phase of REPEAT_QUEUE_PHASES) {
            if (isDeadlineExceeded(startedAt, Date.now(), DEADLINE_BUDGET_MS)) break;
            const kindFilter = phase.exclude
                ? notInArray(emailAutomationQueue.kind, [...phase.kinds])
                : inArray(emailAutomationQueue.kind, [...phase.kinds]);
            let lastId = 0;

            while (!isDeadlineExceeded(startedAt, Date.now(), DEADLINE_BUDGET_MS)) {
                const items = await db
                    .select()
                    .from(emailAutomationQueue)
                    .where(
                        and(
                            eq(emailAutomationQueue.status, "pending"),
                            lte(emailAutomationQueue.nextRunAt, runStart),
                            gt(emailAutomationQueue.id, lastId),
                            kindFilter
                        )
                    )
                    .orderBy(asc(emailAutomationQueue.id))
                    .limit(REPEAT_BATCH_SIZE);
                if (items.length === 0) break;

                for (const item of items) {
                    if (isDeadlineExceeded(startedAt, Date.now(), DEADLINE_BUDGET_MS)) break;
                    lastId = item.id;
                    // 이번 배치를 읽은 뒤 조직이 막혀 한꺼번에 옮긴 줄 — 이미 미뤘다
                    if (run.movedIds.has(item.id)) continue;
                    try {
                        await processRepeatItem(item, stats, run);
                    } catch (err) {
                        // 이 줄은 기한 안에 그대로 남는다 — 다음 회차가 다시 본다. 다른 줄은 계속 처리한다
                        console.error(`[EmailRepeat] queue item ${item.id} error:`, err);
                        stats.failed++;
                    }
                }
            }
        }

        if (isDeadlineExceeded(startedAt, Date.now(), DEADLINE_BUDGET_MS)) {
            stats.deadlineHit = true;
        }

        console.log(
            `[EmailRepeat] processed=${stats.processed} sent=${stats.sent} completed=${stats.completed} ` +
            `failed=${stats.failed} deferred=${stats.deferred}`
        );
        return stats;
    } finally {
        if (acquired) {
            await conn`SELECT pg_advisory_unlock(${REPEAT_LOCK_KEY})`;
        }
        conn.release();
    }
}

type RepeatQueueItem = typeof emailAutomationQueue.$inferSelect;

/** 회차 하나의 상태 */
interface RepeatRunState {
    /** 이 시각까지 기한이 된 줄만 본다 */
    runStart: Date;
    /** 이번 회차에 조직의 기본 발신 주소가 막힌 시각 (purposeBlockKey(orgId, 목적) → 열리는 시각) */
    blockedUntil: Map<string, Date>;
    /** 조직이 막혀 한꺼번에 옮긴 줄 id — 이미 읽어 둔 배치에 있어도 다시 보지 않는다 */
    movedIds: Set<number>;
    /** 답장 받을 주소 회차 캐시 */
    replyTo: ReplyToResolver;
}

/** 줄 하나를 끝내거나(완료·취소) 다음 시각으로 옮긴다 */
async function processRepeatItem(
    item: RepeatQueueItem,
    stats: RepeatQueueRunStats,
    run: RepeatRunState
): Promise<void> {
    const now = new Date();
    stats.processed++;

    const [record] = await db
        .select()
        .from(records)
        .where(eq(records.id, item.recordId))
        .limit(1);

    if (!record) {
        await db
            .update(emailAutomationQueue)
            .set({ status: "cancelled", updatedAt: now })
            .where(eq(emailAutomationQueue.id, item.id));
        stats.completed++;
        return;
    }

    const [link] = await db
        .select()
        .from(emailTemplateLinks)
        .where(eq(emailTemplateLinks.id, item.templateLinkId))
        .limit(1);

    // 발신 한도로 미뤄 둔 첫 메일 — 반복 설정과 상관없이 규칙이 살아 있으면 보낸다 (문의 'first' / 대량 'first_bulk')
    const firstPurpose = templateFirstPurpose(item.kind);
    if (firstPurpose) {
        if (!link || link.isActive !== 1) {
            await db
                .update(emailAutomationQueue)
                .set({ status: "cancelled", updatedAt: now })
                .where(eq(emailAutomationQueue.id, item.id));
            stats.completed++;
            return;
        }

        // 이번 회차에 이 조직의 기본 주소가 이 줄의 목적으로 이미 막혔다 — 조건·쿨다운·발송 준비 없이 열리는 시각으로 옮긴다
        // (보낼 수 있을 때 sendTemplateFirst가 조건·쿨다운을 다시 본다)
        const blocked = activeBlock(run.blockedUntil, purposeBlockKey(item.orgId, firstPurpose), now);
        if (blocked) {
            await deferRepeatItem(item.id, blocked, now);
            stats.deferred++;
            return;
        }

        const outcome = await sendTemplateFirst(link, record, item.orgId, firstPurpose, run.replyTo);
        if (outcome.kind === "deferred") {
            // 아직 막혀 있다 — 다음 열리는 시각에 다시 본다. 같은 조직의 다른 첫 메일 줄도 같은 주소라 함께 옮긴다
            // (문의가 막혔으면 문의·대량 줄 모두, 대량만 막혔으면 대량 줄만 — templateFirstKindsBlockedBy)
            await deferRepeatItem(item.id, outcome.retryAt, now);
            stats.deferred++;
            stats.deferred += await markOrgBlocked(run, item.orgId, outcome.retryAt, item.id, firstPurpose);
            return;
        }

        if (outcome.kind === "sent") stats.sent++;
        else if (outcome.kind === "failed") stats.failed++;

        // 보냈든(반복은 sendTemplateFirst가 따로 넣었다) 조건·쿨다운으로 건너뛰었든 이 줄의 일은 끝났다
        await db
            .update(emailAutomationQueue)
            .set({ status: "completed", updatedAt: now })
            .where(eq(emailAutomationQueue.id, item.id));
        stats.completed++;
        return;
    }

    if (!link || link.isActive !== 1 || !link.repeatConfig) {
        await db
            .update(emailAutomationQueue)
            .set({ status: "cancelled", updatedAt: now })
            .where(eq(emailAutomationQueue.id, item.id));
        stats.completed++;
        return;
    }

    const config = link.repeatConfig as {
        intervalHours: number;
        maxRepeat: number;
        stopCondition: { field: string; operator: "eq" | "ne"; value: string };
    };

    // 중단 조건 평가
    const data = record.data as Record<string, unknown>;
    if (evaluateCondition(config.stopCondition, data)) {
        await db
            .update(emailAutomationQueue)
            .set({ status: "completed", updatedAt: now })
            .where(eq(emailAutomationQueue.id, item.id));
        stats.completed++;
        return;
    }

    // 이번 회차에 이 조직의 기본 주소가 대량으로 이미 막혔다 — 발송 준비 없이 열리는 시각으로 옮긴다 (반복 횟수를 쓰지 않는다)
    const blocked = activeBlock(run.blockedUntil, purposeBlockKey(item.orgId, templatePurpose("repeat")), now);
    if (blocked) {
        await deferRepeatItem(item.id, blocked, now);
        stats.deferred++;
        return;
    }

    // 발송
    const { success, deferred } = await sendEmailSingle(link, record, item.orgId, "repeat", { replyTo: run.replyTo });

    if (deferred) {
        // 한도·시간대에 막혀 보내지 않았다 — 반복 횟수를 쓰지 않고 열리는 시각에 다시 본다.
        // 대량으로만 막혔다고 적는다 — 'first' 줄(문의)은 문의 몫으로 나갈 수 있어 함께 옮기지 않는다.
        // 'first_bulk' 줄은 다음에 꺼낼 때 이 기록(activeBlock)으로 발송 준비 없이 미뤄진다
        await deferRepeatItem(item.id, deferred.retryAt, now);
        stats.deferred++;
        recordPurposeBlock(run.blockedUntil, item.orgId, templatePurpose("repeat"), deferred.retryAt);
        return;
    }

    const newCount = item.repeatCount + 1;
    const isMaxReached = newCount >= config.maxRepeat;

    if (success) stats.sent++;
    else stats.failed++;

    await db
        .update(emailAutomationQueue)
        .set({
            repeatCount: newCount,
            status: isMaxReached ? "completed" : "pending",
            nextRunAt: isMaxReached ? item.nextRunAt : new Date(Date.now() + config.intervalHours * 60 * 60 * 1000),
            updatedAt: now,
        })
        .where(eq(emailAutomationQueue.id, item.id));

    if (isMaxReached) stats.completed++;
}

async function deferRepeatItem(id: number, retryAt: Date, now: Date): Promise<void> {
    await db
        .update(emailAutomationQueue)
        .set({ nextRunAt: retryAt, updatedAt: now })
        .where(eq(emailAutomationQueue.id, id));
}

/**
 * 조직의 기본 발신 주소가 이 목적으로 retryAt까지 막혔다고 적고, 그 조직의 기한 된 첫 메일 줄 중 같은 이유로 막히는 줄
 * (templateFirstKindsBlockedBy — 문의가 막혔으면 'first'·'first_bulk', 대량만 막혔으면 'first_bulk')을 한 문장으로 retryAt에 옮긴다.
 * 템플릿 메일은 늘 그 조직의 기본 주소로 나가므로 같은 이유로 막힌다 — 줄마다 조건·쿨다운·발송 준비 조회를
 * 되풀이하지 않는다. 옮긴 줄 수를 돌려준다. 반복 줄은 중단 조건을 먼저 봐야 해서 여기서 옮기지 않는다 (activeBlock).
 * 문의가 막혔으면 대량(반복)도 막혔다고 함께 적는다 (recordPurposeBlock).
 */
async function markOrgBlocked(
    run: RepeatRunState,
    orgId: string,
    retryAt: Date,
    exceptId: number,
    purpose: SendPurpose
): Promise<number> {
    recordPurposeBlock(run.blockedUntil, orgId, purpose, retryAt);
    const moved = await db
        .update(emailAutomationQueue)
        .set({ nextRunAt: retryAt, updatedAt: new Date() })
        .where(
            and(
                eq(emailAutomationQueue.orgId, orgId),
                inArray(emailAutomationQueue.kind, templateFirstKindsBlockedBy(purpose)),
                eq(emailAutomationQueue.status, "pending"),
                lte(emailAutomationQueue.nextRunAt, run.runStart),
                ne(emailAutomationQueue.id, exceptId)
            )
        )
        .returning({ id: emailAutomationQueue.id });
    for (const m of moved) run.movedIds.add(m.id);
    if (moved.length > 0) {
        console.log(`[EmailRepeat] org ${orgId}: 기본 발신 주소가 막혀(${purpose}) 첫 메일 ${moved.length}줄을 함께 미룸`);
    }
    return moved.length;
}
