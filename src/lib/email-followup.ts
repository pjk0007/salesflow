import {
    db,
    queryClient,
    emailFollowupQueue,
    emailSendLogs,
    emailTemplateLinks,
    emailAutoPersonalizedLinks,
    emailTemplates,
    records,
    products,
} from "@/lib/db";
import { eq, and, ne, sql } from "drizzle-orm";
import { getEmailClient, getEmailConfig, substituteVariables, appendSignature } from "@/lib/nhn-email";
import { getAiClient, generateEmail, checkTokenQuota, updateTokenUsage, logAiUsage } from "@/lib/ai";
import { resolveSignature } from "@/lib/email-sender-resolver";
import { claimSender, releaseSenderSlot } from "@/lib/email-sender-limit";
import { followupSenderOrder, isDeferralOnlyBatch } from "@/lib/email-sender-limit-paths";
import { DEADLINE_BUDGET_MS, isDeadlineExceeded } from "@/lib/email-send-queue-rules";
import { wrapTrackingUrls, hasClicked } from "@/lib/email-click-tracking";
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
import { substitutePromptVariables } from "@/lib/email-utils";

// ============================================
// 타입 정의
// ============================================

interface TemplateFollowupStep {
    delayDays: number;
    onClicked?: { templateId: number };
    onNotClicked?: { templateId: number };
}

interface AiFollowupStep {
    delayDays: number;
    onClicked?: { prompt: string };
    onNotClicked?: { prompt: string };
}

type FollowupConfig = TemplateFollowupStep | AiFollowupStep;

/**
 * 후속 한 건을 처리한 결과.
 *   sent      보냈다
 *   skipped   보내지 않는 게 맞다 (설정 없음·수신거부·NHN 실패 등 — 예전 false)
 *   deferred  첫 메일 주소가 한도·시간대에 막혀 retryAt까지 미룬다 (다른 주소로 넘기지 않는다)
 */
type FollowupHandlerResult = { kind: "sent" } | { kind: "skipped" } | { kind: "deferred"; retryAt: Date };

const SENT: FollowupHandlerResult = { kind: "sent" };
const SKIPPED: FollowupHandlerResult = { kind: "skipped" };

/** 처리에 필요한 큐 칸만. 선점 SQL의 RETURNING과 맞춘다 (시각 칸은 db.execute에서 문자열로 와서 받지 않는다) */
type FollowupQueueItem = Pick<
    typeof emailFollowupQueue.$inferSelect,
    "id" | "parentLogId" | "sourceType" | "sourceId" | "orgId" | "stepIndex"
>;

export interface FollowupRunStats {
    processed: number;
    sent: number;
    skipped: number;
    cancelled: number;
    /** 발신 한도·시간대에 막혀 check_at을 retryAt으로 옮긴 줄 */
    deferred: number;
    /** 멈춘 processing 줄을 pending으로 되돌린 수 */
    reclaimed: number;
    skippedAsLocked?: boolean;
    deadlineHit?: boolean;
}

/** 다른 잡(0x5c4edf01 예약등록, 02 발송 큐, 03·04 깊이 들어온 사람 알림)과 다른 키 — 서로 독립적으로 돈다 */
const FOLLOWUP_LOCK_KEY = 0x5c4edf05;
const FOLLOWUP_BATCH_SIZE = 5;
const FOLLOWUP_BATCH_DELAY_MS = 1000;
/**
 * processing에 이만큼 머물면 죽은 회차의 줄로 보고 pending으로 되돌린다.
 * 회차 예산(8분)에 AI 생성 한 건이 길어지는 것까지 넉넉히 더한 값이다 — 살아 있는 줄을 되돌리면 두 번 나간다.
 */
const FOLLOWUP_STUCK_THRESHOLD_MS = 30 * 60 * 1000;

/** followupConfig를 배열로 정규화 (하위 호환) */
function normalizeFollowupConfig(config: unknown): FollowupConfig[] {
    if (!config) return [];
    if (Array.isArray(config)) return config;
    return [config as FollowupConfig];
}

// ============================================
// AI 후속 메일 생성 (테스트/미리보기용)
// ============================================

export interface GenerateAiFollowupPreviewInput {
    linkId: number;
    parentLogId: number;
    stepIndex: number; // 0-based
    isClicked: boolean;
}

export async function generateAiFollowupPreview(
    input: GenerateAiFollowupPreviewInput,
    orgId: string
): Promise<
    | { success: true; subject: string; htmlBody: string }
    | { success: false; error: string }
> {
    const [link] = await db
        .select()
        .from(emailAutoPersonalizedLinks)
        .where(
            and(
                eq(emailAutoPersonalizedLinks.id, input.linkId),
                eq(emailAutoPersonalizedLinks.orgId, orgId)
            )
        )
        .limit(1);

    if (!link) return { success: false, error: "규칙을 찾을 수 없습니다." };
    if (!link.followupConfig) return { success: false, error: "후속 발송 설정이 없습니다." };

    const steps = normalizeFollowupConfig(link.followupConfig);
    const currentStep = steps[input.stepIndex] as AiFollowupStep | undefined;
    if (!currentStep) return { success: false, error: "해당 후속 단계가 없습니다." };

    const action = input.isClicked ? currentStep.onClicked : currentStep.onNotClicked;
    if (!action?.prompt) {
        return {
            success: false,
            error: `이 단계의 ${input.isClicked ? "클릭함" : "클릭 안 함"} 분기에 프롬프트가 설정되어 있지 않습니다.`,
        };
    }

    const [parentLog] = await db
        .select()
        .from(emailSendLogs)
        .where(and(eq(emailSendLogs.id, input.parentLogId), eq(emailSendLogs.orgId, orgId)))
        .limit(1);
    if (!parentLog) return { success: false, error: "이전 발송 로그를 찾을 수 없습니다." };

    const aiClient = getAiClient(link.model || undefined);
    if (!aiClient) return { success: false, error: "AI 클라이언트가 구성되지 않았습니다." };

    const quota = await checkTokenQuota(orgId);
    if (!quota.allowed) return { success: false, error: "AI 토큰 한도를 초과했습니다." };

    const emailConfig = await getEmailConfig(orgId);
    // 미리보기 서명이 실제 발송과 어긋나지 않도록 규칙 지정값을 따른다
    const signatureJson = await resolveSignature(orgId, {
        requestedId: link.signatureId ?? undefined,
        config: emailConfig,
    });

    let recordData: Record<string, unknown> = {};
    if (parentLog.recordId) {
        const [record] = await db
            .select()
            .from(records)
            .where(eq(records.id, parentLog.recordId))
            .limit(1);
        if (record) recordData = record.data as Record<string, unknown>;
    }

    let product = null;
    if (link.productId) {
        const [p] = await db.select().from(products).where(eq(products.id, link.productId)).limit(1);
        product = p ?? null;
    }

    const followupPrompt = substitutePromptVariables(action.prompt, recordData);
    const previousEmailContext = [
        `[최우선 지시사항]`,
        `${followupPrompt}`,
        ``,
        `[참고: 이전 발송 이메일]`,
        `- 제목: ${parentLog.subject || "(없음)"}`,
        `- 본문 요약: ${(parentLog.body || "").substring(0, 300)}`,
        `- 링크 클릭 여부: ${input.isClicked ? "클릭함" : "클릭하지 않음"}`,
        `- 후속 단계: ${input.stepIndex + 1}단계`,
        ``,
        `위 지시사항을 반드시 따르되, 이전 이메일은 맥락 파악용으로만 참고하세요. 이전 이메일의 내용을 반복하지 마세요.`,
    ].join("\n");

    let senderPersona: { name: string; title?: string; company?: string } | null = null;
    if (link.useSignaturePersona === 1 && signatureJson) {
        try {
            const sig = JSON.parse(signatureJson);
            if (sig && typeof sig === "object" && sig.name) {
                senderPersona = { name: sig.name, title: sig.title || undefined, company: sig.company || undefined };
            }
        } catch { /* skip */ }
    }

    const emailResult = await generateEmail(aiClient, {
        prompt: previousEmailContext,
        product,
        recordData,
        tone: link.tone || undefined,
        ctaUrl: link.ctaUrl || product?.url || undefined,
        format: (link.format as "plain" | "designed") || "plain",
        senderPersona,
    });

    const tokens = emailResult.usage.promptTokens + emailResult.usage.completionTokens;
    await updateTokenUsage(orgId, tokens);
    await logAiUsage({
        orgId,
        userId: null,
        provider: aiClient.provider,
        model: aiClient.model,
        promptTokens: emailResult.usage.promptTokens,
        completionTokens: emailResult.usage.completionTokens,
        purpose: "followup_email_test",
    });

    let finalBody = emailResult.htmlBody;
    if (signatureJson) {
        finalBody = appendSignature(finalBody, signatureJson);
    }

    return { success: true, subject: emailResult.subject, htmlBody: finalBody };
}

// ============================================
// 후속 발송 큐 등록
// ============================================

export async function enqueueFollowup(params: {
    logId: number;
    sourceType: "template" | "ai";
    sourceId: number;
    orgId: string;
    sentAt: Date;
    delayDays: number;
    stepIndex?: number;
}): Promise<void> {
    const stepIndex = params.stepIndex ?? 0;
    const checkAt = new Date(params.sentAt.getTime() + params.delayDays * 24 * 60 * 60 * 1000);

    await db
        .insert(emailFollowupQueue)
        .values({
            parentLogId: params.logId,
            sourceType: params.sourceType,
            sourceId: params.sourceId,
            orgId: params.orgId,
            stepIndex,
            checkAt,
            status: "pending",
        })
        .onConflictDoNothing();
}

// ============================================
// 후속 큐 처리 (크론에서 호출)
// ============================================

/**
 * 후속 큐 워커.
 *
 * 줄을 5건씩 processing으로 선점해 처리한다. 예전처럼 한 번에 읽어 두고 돌면 cron 회차가 겹칠 때
 * 같은 줄이 두 번 나간다 — 잠금과 선점이 있어야 cron 주기를 줄일 수 있다 (시간대가 09시보다 늦은 주소의 후속).
 * 예산(8분)을 쓰면 남은 줄은 pending 그대로 다음 회차가 이어받는다. 선점은 배치 단위라 남는 processing 줄이 없다.
 */
export async function processEmailFollowupQueue(): Promise<FollowupRunStats> {
    const stats: FollowupRunStats = {
        processed: 0,
        sent: 0,
        skipped: 0,
        cancelled: 0,
        deferred: 0,
        reclaimed: 0,
    };

    // 락을 잡은 커넥션에서 해제해야 하므로 전용 커넥션을 확보한다 (email-send-queue.ts와 같은 방식).
    // 풀에서 매번 다른 커넥션이 나오면 unlock이 다른 세션에 걸려 락이 영구히 남는다.
    const conn = await queryClient.reserve();
    let acquired = false;

    try {
        const lockResult = await conn<{ acquired: boolean }[]>`
            SELECT pg_try_advisory_lock(${FOLLOWUP_LOCK_KEY}) AS acquired
        `;
        acquired = lockResult[0]?.acquired === true;
        if (!acquired) {
            console.log("[Followup] another worker running, skip");
            return { ...stats, skippedAsLocked: true };
        }

        stats.reclaimed = await reclaimStuckFollowups();

        // 답장 받을 주소는 회차 동안 워크스페이스마다 한 번만 읽는다 (DESIGN-3)
        const replyTo = newReplyToResolver();
        const startedAt = Date.now();
        while (!isDeadlineExceeded(startedAt, Date.now(), DEADLINE_BUDGET_MS)) {
            const batch = await claimFollowupBatch();
            if (batch.length === 0) break;

            const results = await Promise.allSettled(batch.map((item) => processFollowupItem(item, stats, replyTo)));
            for (const r of results) {
                if (r.status === "rejected") {
                    // 상태 갱신까지 던진 줄은 processing으로 남는다 — 30분 뒤 회수가 다시 집는다
                    console.error("[Followup] Batch item error:", r.reason);
                }
            }

            // 미룸만 나온 배치는 NHN을 부르지 않았으니 쉬지 않는다
            const deferredOnly = isDeferralOnlyBatch(
                results.map((r) => r.status === "fulfilled" && r.value === "deferred")
            );
            if (!deferredOnly && !isDeadlineExceeded(startedAt, Date.now(), DEADLINE_BUDGET_MS)) {
                await new Promise((r) => setTimeout(r, FOLLOWUP_BATCH_DELAY_MS));
            }
        }

        if (isDeadlineExceeded(startedAt, Date.now(), DEADLINE_BUDGET_MS)) {
            stats.deadlineHit = true;
        }

        console.log(
            `[Followup] processed=${stats.processed} sent=${stats.sent} skipped=${stats.skipped} ` +
            `cancelled=${stats.cancelled} deferred=${stats.deferred} reclaimed=${stats.reclaimed}`
        );
        return stats;
    } finally {
        if (acquired) {
            await conn`SELECT pg_advisory_unlock(${FOLLOWUP_LOCK_KEY})`;
        }
        conn.release();
    }
}

/**
 * processing에서 멈춘 줄을 pending으로 되돌린다. 잠금 아래서 돌지만 시각으로도 거른다 —
 * 락 커넥션만 끊기고 프로세스는 아직 처리 중일 수 있어서다.
 */
async function reclaimStuckFollowups(): Promise<number> {
    const result = (await db.execute(sql`
        UPDATE email_followup_queue
        SET status = 'pending', locked_at = NULL
        WHERE status = 'processing'
          AND (locked_at IS NULL
               OR locked_at < NOW() - (${FOLLOWUP_STUCK_THRESHOLD_MS}::bigint * INTERVAL '1 millisecond'))
        RETURNING id
    `)) as unknown as Array<{ id: number }>;
    if (result.length > 0) {
        console.log(`[Followup] reclaimed ${result.length} stuck rows`);
    }
    return result.length;
}

/** 때가 된 pending을 원자적으로 선점한다. 오래 기다린 줄부터 (check_at, id 순) */
async function claimFollowupBatch(): Promise<FollowupQueueItem[]> {
    const rows = (await db.execute(sql`
        UPDATE email_followup_queue
        SET status = 'processing', locked_at = NOW()
        WHERE id IN (
            SELECT id FROM email_followup_queue
            WHERE status = 'pending'
              AND check_at <= NOW()
            ORDER BY check_at ASC, id ASC
            LIMIT ${FOLLOWUP_BATCH_SIZE}
            FOR UPDATE SKIP LOCKED
        )
        RETURNING id, parent_log_id, source_type, source_id, org_id, step_index
    `)) as unknown as Array<{
        id: number;
        parent_log_id: number;
        source_type: string;
        source_id: number;
        org_id: string;
        step_index: number | null;
    }>;
    return rows.map((r) => ({
        id: r.id,
        parentLogId: r.parent_log_id,
        sourceType: r.source_type,
        sourceId: r.source_id,
        orgId: r.org_id,
        stepIndex: r.step_index ?? 0,
    }));
}

/**
 * 개별 후속 큐 항목 처리. 어느 길로 나가도 줄을 끝난 상태(sent·skipped·cancelled)나 pending(미룸)으로 둔다 —
 * processing으로 남는 것은 상태 갱신마저 던졌을 때뿐이고, 그 줄은 회수가 다시 집는다.
 */
async function processFollowupItem(
    item: FollowupQueueItem,
    stats: FollowupRunStats,
    replyTo: ReplyToResolver
): Promise<"sent" | "skipped" | "deferred" | "cancelled"> {
    stats.processed++;

    try {
        // 1. 원본 발송 로그 조회
        const [parentLog] = await db
            .select()
            .from(emailSendLogs)
            .where(eq(emailSendLogs.id, item.parentLogId))
            .limit(1);

        if (!parentLog) {
            await updateQueueStatus(item.id, "cancelled", null);
            stats.cancelled++;
            return "cancelled";
        }

        // 2. 링크 클릭 여부로 분기 판정 (수신확인보다 정확 — 우리가 직접 기록)
        // 미뤘다가 다시 볼 때도 그때의 클릭 여부로 다시 판정한다 — 기다리는 사이 클릭했으면 그 분기가 맞다
        const isClicked = await hasClicked(item.parentLogId);
        const result = isClicked ? "clicked" : "not_clicked";

        // 3. sourceType에 따라 분기 (모르는 종류는 예전처럼 skipped)
        let outcome: FollowupHandlerResult = SKIPPED;

        if (item.sourceType === "template") {
            outcome = await handleTemplateFollowup(item, parentLog, isClicked, replyTo);
        } else if (item.sourceType === "ai") {
            outcome = await handleAiFollowup(item, parentLog, isClicked, replyTo);
        }

        if (outcome.kind === "deferred") {
            await deferQueueItem(item.id, outcome.retryAt);
            stats.deferred++;
            return "deferred";
        }
        if (outcome.kind === "sent") {
            await updateQueueStatus(item.id, "sent", result);
            stats.sent++;
            return "sent";
        }
        await updateQueueStatus(item.id, "skipped", result);
        stats.skipped++;
        return "skipped";
    } catch (err) {
        console.error(`[Followup] Error processing queue item ${item.id}:`, err);
        await updateQueueStatus(item.id, "cancelled", null);
        stats.cancelled++;
        return "cancelled";
    }
}

// ============================================
// 내부 헬퍼: 큐 상태 업데이트
// ============================================

async function updateQueueStatus(
    queueId: number,
    status: string,
    result: string | null
) {
    await db
        .update(emailFollowupQueue)
        .set({ status, result, processedAt: new Date() })
        .where(eq(emailFollowupQueue.id, queueId));
}

/**
 * 첫 메일 주소가 열릴 때(retryAt)까지 줄을 재운다. 아직 끝나지 않았으므로 result·processed_at은 비워 둔다.
 * locked_at을 비워야 회수 대상에 다시 걸리지 않는다.
 * 그사이 사용자가 취소한 줄은 되살리지 않는다 (30분 회수 뒤 pending에서 취소된 경우) — 취소한 후속이 나가면 안 된다.
 * 상태를 processing으로 묶지 않는 것은 회수된 뒤에도 이 결과를 써야 해서다 (updateQueueStatus와 같은 이유).
 */
async function deferQueueItem(queueId: number, retryAt: Date) {
    await db
        .update(emailFollowupQueue)
        .set({ status: "pending", checkAt: retryAt, lockedAt: null })
        .where(and(eq(emailFollowupQueue.id, queueId), ne(emailFollowupQueue.status, "cancelled")));
}

// ============================================
// 템플릿 기반 후속 발송
// ============================================

async function handleTemplateFollowup(
    item: FollowupQueueItem,
    parentLog: typeof emailSendLogs.$inferSelect,
    isClicked: boolean,
    replyToResolver: ReplyToResolver
): Promise<FollowupHandlerResult> {
    // 1. templateLink 조회
    const [link] = await db
        .select()
        .from(emailTemplateLinks)
        .where(eq(emailTemplateLinks.id, item.sourceId))
        .limit(1);

    if (!link || !link.followupConfig) return SKIPPED;

    const steps = normalizeFollowupConfig(link.followupConfig);
    const currentStep = steps[item.stepIndex] as TemplateFollowupStep | undefined;
    if (!currentStep) return SKIPPED;

    // 2. 조건에 맞는 templateId 확인
    const action = isClicked ? currentStep.onClicked : currentStep.onNotClicked;
    if (!action?.templateId) return SKIPPED;

    // 3. 후속 템플릿 조회 — 이 조직 템플릿만. followupConfig의 templateId는 연결 API가 검사 없이 받던 값이다
    const [template] = await db
        .select()
        .from(emailTemplates)
        .where(and(eq(emailTemplates.id, action.templateId), eq(emailTemplates.orgId, item.orgId)))
        .limit(1);

    if (!template) return SKIPPED;

    // 4. 서명 결정. 발신 주소는 로그 insert 직전에 정한다 (자리 잡기를 보낼 게 확실해진 뒤로 미룬다)
    const emailConfig = await getEmailConfig(item.orgId);
    // emailTemplateLinks에는 signatureId 컬럼이 없다 — 템플릿 규칙은 서명을 지정할 수 없으므로 기본 서명을 쓴다
    const signatureJson = await resolveSignature(item.orgId, { config: emailConfig });

    // 5. 원본 레코드 조회 (변수 치환용). 답장 받을 주소도 이 레코드의 워크스페이스로 정한다
    let data: Record<string, unknown> = {};
    let recordWorkspaceId: number | null = null;
    if (parentLog.recordId) {
        const [record] = await db
            .select()
            .from(records)
            .where(eq(records.id, parentLog.recordId))
            .limit(1);
        if (record) {
            data = record.data as Record<string, unknown>;
            recordWorkspaceId = record.workspaceId;
        }
    }

    // 6. 수신거부 확인 — 첫 메일 이후 거부했을 수 있으므로 후속 발송 직전에 다시 본다
    const workspaceId = await resolveWorkspaceId(link.partitionId);
    if (!workspaceId) return SKIPPED;
    if (await isUnsubscribed(workspaceId, parentLog.recipientEmail)) return SKIPPED;

    // 7. 변수 치환 + 서명
    const mappings = (link.variableMappings as Record<string, string>) || {};
    const subject = substituteVariables(template.subject, mappings, data);
    let body = substituteVariables(template.htmlBody, mappings, data);
    if (signatureJson) {
        body = appendSignature(body, signatureJson);
    }

    const unsubscribeToken = template.useUnsubscribe ? generateUnsubscribeToken() : null;
    if (unsubscribeToken) {
        body = appendUnsubscribeFooter(body, buildUnsubscribeUrl(unsubscribeToken));
    }

    // 8. NHN 발송
    const client = await getEmailClient(item.orgId);
    if (!client) return SKIPPED;

    // 8-1. 발신 주소 + 오늘 자리 — 원본 메일을 보낸 주소로만 보낸다 (같은 대화로 이어지게).
    // 막히면 다른 주소로 넘기지 않고 그 주소가 열릴 때로 미룬다.
    // parentLog.senderProfileId가 null(구 로그)이거나 그 프로필이 삭제됐으면
    // 후보에 없으므로 자동으로 현재 기본 프로필로 흐른다.
    const claim = await claimSender(item.orgId, {
        mode: "fixed",
        ids: [parentLog.senderProfileId],
        config: emailConfig,
        // 막히면 check_at을 retryAt으로 옮긴다 — 간격 미룸은 순번대로 펼쳐 한꺼번에 깨어나지 않게 한다
        spreadDeferrals: true,
        // 후속은 대량이다 — 15:00(KST) 전까지 문의 몫(한도의 10%)을 남긴다 (DESIGN-2 2절)
        purpose: "bulk",
    });
    if (!claim.ok) {
        console.log(`[Followup] item ${item.id}: deferred (${claim.reason}) until ${claim.retryAt.toISOString()}`);
        return { kind: "deferred", retryAt: claim.retryAt };
    }
    const slot = claim.slot;
    const sender = slot.sender;
    if (!sender.fromEmail) {
        await releaseSenderSlot(slot);
        return SKIPPED;
    }
    const senderFromEmail = sender.fromEmail;

    // sendEachMail을 부르기 전에 던지면 자리를 돌려준다 — 부른 뒤에는 나갔을 수 있어 돌려주지 않는다
    let sendAttempted = false;
    try {
        // 8-2. 답장 받을 주소 — 받는 레코드의 워크스페이스 값 (레코드를 지웠으면 규칙 파티션의 워크스페이스). 없으면 Reply-To 없음
        const replyTo = await replyToResolver.forWorkspace(recordWorkspaceId ?? workspaceId);

        // 9. 로그 먼저 insert → 트래킹 URL → 발송 → status 업데이트
        const [inserted] = await db.insert(emailSendLogs).values({
            orgId: item.orgId,
            templateLinkId: link.id,
            partitionId: link.partitionId,
            recordId: parentLog.recordId,
            emailTemplateId: template.id,
            recipientEmail: parentLog.recipientEmail,
            subject,
            body,
            status: "pending",
            triggerType: "followup",
            parentLogId: parentLog.id,
            sentAt: new Date(),
            unsubscribeToken,
            senderProfileId: sender.profileId,
            // 보낼 때 쓴 주소 그대로 (DESIGN-3 4-1)
            senderEmail: senderFromEmail,
        }).returning({ id: emailSendLogs.id });

        const trackedBody = wrapTrackingUrls(body, inserted.id);

        sendAttempted = true;
        const nhnResult = await client.sendEachMail({
            senderAddress: senderFromEmail,
            senderName: sender.fromName,
            title: subject,
            body: trackedBody,
            receiverList: [{ receiveMailAddr: parentLog.recipientEmail, receiveType: "MRT0" }],
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

        // 9. 체인: 다음 step이 있으면 큐 등록
        if (isSuccess && inserted?.id) {
            const nextStep = steps[item.stepIndex + 1] as TemplateFollowupStep | undefined;
            if (nextStep) {
                await enqueueFollowup({
                    logId: inserted.id,
                    sourceType: "template",
                    sourceId: link.id,
                    orgId: item.orgId,
                    sentAt: new Date(),
                    delayDays: nextStep.delayDays,
                    stepIndex: item.stepIndex + 1,
                });
            }
        }

        return isSuccess ? SENT : SKIPPED;
    } catch (err) {
        if (!sendAttempted) await releaseSenderSlot(slot);
        throw err;
    }
}

// ============================================
// AI 기반 후속 발송
// ============================================

async function handleAiFollowup(
    item: FollowupQueueItem,
    parentLog: typeof emailSendLogs.$inferSelect,
    isClicked: boolean,
    replyToResolver: ReplyToResolver
): Promise<FollowupHandlerResult> {
    // 1. autoPersonalizedLink 조회
    const [link] = await db
        .select()
        .from(emailAutoPersonalizedLinks)
        .where(eq(emailAutoPersonalizedLinks.id, item.sourceId))
        .limit(1);

    if (!link || !link.followupConfig) return SKIPPED;

    const steps = normalizeFollowupConfig(link.followupConfig);
    const currentStep = steps[item.stepIndex] as AiFollowupStep | undefined;
    if (!currentStep) return SKIPPED;

    // 2. 조건에 맞는 prompt 확인
    const action = isClicked ? currentStep.onClicked : currentStep.onNotClicked;
    if (!action?.prompt) return SKIPPED;

    // 3. 수신거부 확인 — AI 호출(토큰 소모) 전에 걸러낸다
    const workspaceId = await resolveWorkspaceId(link.partitionId);
    if (!workspaceId) return SKIPPED;
    if (await isUnsubscribed(workspaceId, parentLog.recipientEmail)) return SKIPPED;

    // 4. AI 클라이언트 확인
    const aiClient = getAiClient(link.model || undefined);
    if (!aiClient) return SKIPPED;

    const quota = await checkTokenQuota(item.orgId);
    if (!quota.allowed) return SKIPPED;

    // 이메일 클라이언트는 자리를 잡기 전에 본다 — 못 보낼 게 뻔한데 자리를 잡았다 돌려주지 않게
    const emailClient = await getEmailClient(item.orgId);
    if (!emailClient) return SKIPPED;

    // 4-1. 발신 주소 + 오늘 자리 — 원본 메일을 보낸 주소 먼저 (같은 대화로 이어지게), 그 주소가 없을 때만 규칙 묶음 → 기본.
    // fixed 모드라 막히면 다른 주소로 넘기지 않고 그 주소가 열릴 때로 미룬다. AI 생성(토큰)보다 먼저 한다
    const emailConfig = await getEmailConfig(item.orgId);
    const claim = await claimSender(item.orgId, {
        mode: "fixed",
        ids: followupSenderOrder(parentLog.senderProfileId, link),
        config: emailConfig,
        spreadDeferrals: true,
        // 후속은 대량이다 — 15:00(KST) 전까지 문의 몫(한도의 10%)을 남긴다 (DESIGN-2 2절)
        purpose: "bulk",
    });
    if (!claim.ok) {
        console.log(`[Followup] item ${item.id}: deferred (${claim.reason}) until ${claim.retryAt.toISOString()}`);
        return { kind: "deferred", retryAt: claim.retryAt };
    }
    const slot = claim.slot;
    const sender = slot.sender;
    if (!sender.fromEmail) {
        await releaseSenderSlot(slot);
        return SKIPPED;
    }
    const senderFromEmail = sender.fromEmail;

    // sendEachMail을 부르기 전에(서명·AI 생성·로그 insert) 던지면 자리를 돌려준다 — 부른 뒤에는 나갔을 수 있어 돌려주지 않는다
    let sendAttempted = false;
    try {
        // DB의 null은 "미지정"이므로 undefined로 정규화 (HTTP body의 null과 의미가 다르다)
        const signatureJson = await resolveSignature(item.orgId, {
            requestedId: link.signatureId ?? undefined,
            config: emailConfig,
        });

        // 5. 원본 레코드 + 제품 조회
        let recordData: Record<string, unknown> = {};
        let recordWorkspaceId: number | null = null;
        if (parentLog.recordId) {
            const [record] = await db
                .select()
                .from(records)
                .where(eq(records.id, parentLog.recordId))
                .limit(1);
            if (record) {
                recordData = record.data as Record<string, unknown>;
                recordWorkspaceId = record.workspaceId;
            }
        }

        // 5-1. 답장 받을 주소 — 받는 레코드의 워크스페이스 값 (레코드를 지웠으면 규칙 파티션의 워크스페이스). AI 생성(토큰)보다 먼저
        const replyTo = await replyToResolver.forWorkspace(recordWorkspaceId ?? workspaceId);

        let product = null;
        if (link.productId) {
            const [p] = await db.select().from(products).where(eq(products.id, link.productId)).limit(1);
            product = p ?? null;
        }

        // 6. AI 프롬프트 구성 (사용자 지시 우선, 이전 이메일 컨텍스트 참고용)
        // 후속 발송 프롬프트의 ##필드명## 변수도 레코드 값으로 치환
        const followupPrompt = substitutePromptVariables(action.prompt, recordData);
        const previousEmailContext = [
            `[최우선 지시사항]`,
            `${followupPrompt}`,
            ``,
            `[참고: 이전 발송 이메일]`,
            `- 제목: ${parentLog.subject || "(없음)"}`,
            `- 본문 요약: ${(parentLog.body || "").substring(0, 300)}`,
            `- 링크 클릭 여부: ${isClicked ? "클릭함" : "클릭하지 않음"}`,
            `- 후속 단계: ${item.stepIndex + 1}단계`,
            ``,
            `위 지시사항을 반드시 따르되, 이전 이메일은 맥락 파악용으로만 참고하세요. 이전 이메일의 내용을 반복하지 마세요.`,
        ].join("\n");

        // 7. 발신자 페르소나
        let senderPersona: { name: string; title?: string; company?: string } | null = null;
        if (link.useSignaturePersona === 1 && signatureJson) {
            try {
                const sig = JSON.parse(signatureJson);
                if (sig && typeof sig === "object" && sig.name) {
                    senderPersona = { name: sig.name, title: sig.title || undefined, company: sig.company || undefined };
                }
            } catch { /* skip */ }
        }

        // 8. AI 이메일 생성
        const emailResult = await generateEmail(aiClient, {
            prompt: previousEmailContext,
            product,
            recordData,
            tone: link.tone || undefined,
            ctaUrl: link.ctaUrl || product?.url || undefined,
            format: (link.format as "plain" | "designed") || "plain",
            senderPersona,
        });

        const emailTokens = emailResult.usage.promptTokens + emailResult.usage.completionTokens;
        await updateTokenUsage(item.orgId, emailTokens);
        await logAiUsage({
            orgId: item.orgId,
            userId: null,
            provider: aiClient.provider,
            model: aiClient.model,
            promptTokens: emailResult.usage.promptTokens,
            completionTokens: emailResult.usage.completionTokens,
            purpose: "followup_email",
        });

        // 9. NHN 발송
        let finalBody = emailResult.htmlBody;
        if (signatureJson) {
            finalBody = appendSignature(finalBody, signatureJson);
        }

        const unsubscribeToken = link.useUnsubscribe ? generateUnsubscribeToken() : null;
        if (unsubscribeToken) {
            finalBody = appendUnsubscribeFooter(finalBody, buildUnsubscribeUrl(unsubscribeToken));
        }

        // 10. 로그 먼저 insert → 트래킹 URL → 발송 → status 업데이트
        const [inserted] = await db.insert(emailSendLogs).values({
            orgId: item.orgId,
            partitionId: parentLog.partitionId,
            recordId: parentLog.recordId,
            recipientEmail: parentLog.recipientEmail,
            subject: emailResult.subject,
            body: finalBody,
            status: "pending",
            triggerType: "ai_followup",
            parentLogId: parentLog.id,
            sentAt: new Date(),
            unsubscribeToken,
            senderProfileId: sender.profileId,
            // 보낼 때 쓴 주소 그대로 (DESIGN-3 4-1)
            senderEmail: senderFromEmail,
        }).returning({ id: emailSendLogs.id });

        const trackedBody = wrapTrackingUrls(finalBody, inserted.id);

        sendAttempted = true;
        const nhnResult = await emailClient.sendEachMail({
            senderAddress: senderFromEmail,
            senderName: sender.fromName,
            title: emailResult.subject,
            body: trackedBody,
            receiverList: [{ receiveMailAddr: parentLog.recipientEmail, receiveType: "MRT0" }],
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

        // 11. 체인: 다음 step이 있으면 큐 등록
        if (isSuccess && inserted?.id) {
            const nextStep = steps[item.stepIndex + 1] as AiFollowupStep | undefined;
            if (nextStep) {
                await enqueueFollowup({
                    logId: inserted.id,
                    sourceType: "ai",
                    sourceId: link.id,
                    orgId: item.orgId,
                    sentAt: new Date(),
                    delayDays: nextStep.delayDays,
                    stepIndex: item.stepIndex + 1,
                });
            }
        }

        return isSuccess ? SENT : SKIPPED;
    } catch (err) {
        if (!sendAttempted) await releaseSenderSlot(slot);
        throw err;
    }
}
