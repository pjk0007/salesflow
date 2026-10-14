import { db, emailAutoPersonalizedLinks, emailAssets, emailSendLogs, records, products } from "@/lib/db";
import { eq, and, gte, inArray } from "drizzle-orm";
import { getEmailClient, getEmailConfig, appendSignature } from "@/lib/nhn-email";
import { getSearchAiClient, generateCompanyResearch, checkTokenQuota, updateTokenUsage, logAiUsage } from "@/lib/ai";
import { buildEmailSystemPrompt } from "@/lib/ai/email";
import { prepareManagedEmail, attachManagedEmail } from "@/lib/ai-copy/runtime";
import { CopyDeferredError } from "@/lib/ai-copy/generation";
import { prepareEmailExperiment, recordExperimentDelivery } from "@/lib/email-experiments/runtime";
import { findCachedCompanyResearch } from "@/lib/ai/company-research-cache";
import { evaluateCondition } from "@/lib/alimtalk-automation";
import { resolveSignature } from "@/lib/email-sender-resolver";
import { claimSender, releaseSenderSlot } from "@/lib/email-sender-limit";
import type { SenderSlot } from "@/lib/email-sender-limit";
import { linkSenderPool } from "@/lib/email-sender-limit-rules";
import type { SendPurpose } from "@/lib/email-sender-limit-rules";
import type { ClaimTurn } from "@/lib/email-send-queue-rules";
import { enqueueFollowup } from "@/lib/email-followup";
import { wrapTrackingUrls } from "@/lib/email-click-tracking";
import {
    isUnsubscribed,
    resolveWorkspaceId,
    generateUnsubscribeToken,
    buildUnsubscribeUrl,
    appendUnsubscribeFooter,
    buildListUnsubscribeHeaders,
} from "@/lib/email-unsubscribe";
import { substitutePromptVariables } from "@/lib/email-utils";
import type { DbRecord } from "@/lib/db";
import type { LinkOutcome, RecordOutcome } from "@/lib/auto-personalized-email-outcome";
import { findReplyStop } from "@/lib/email-reply-guard";
import { acceptedOrPendingCondition, acceptedSendCondition } from "@/lib/email-send-log-status";
import { getActiveHold } from "@/lib/partition-hold";
import { beginPreparedDelivery, cancelPreparedSend, finishPreparedDelivery, loadPreparedSend, reservePreparedSend, savePreparedContent } from "./email-prepared-sends";
import type { PreparationReservation } from "./email-prepared-sends";
import { isDeliveryDue, preparedSourceHash, PREPARATION_LEAD_MS } from "./email-random-schedule-rules";
import type { PreparedEmailPayload } from "./db";

// ============================================
// 쿨다운 체크 (같은 record + ai_auto에 1시간 내 발송 이력)
// ============================================
// "발송 이력"은 NHN이 받아 간 발송 + 보내는 중이다 — 배달 결과로 failed가 된 기록도 센다 (DESIGN-SND 6-6, SND-11)
async function checkCooldown(recordId: number, cooldownHours: number = 1): Promise<boolean> {
    const since = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);
    const [existing] = await db
        .select({ id: emailSendLogs.id })
        .from(emailSendLogs)
        .where(
            and(
                eq(emailSendLogs.recordId, recordId),
                eq(emailSendLogs.triggerType, "ai_auto"),
                gte(emailSendLogs.sentAt, since),
                await acceptedOrPendingCondition()
            )
        )
        .limit(1);
    return !existing;
}

// ============================================
// 중복 수신자 체크 (같은 파티션 + 같은 이메일로 AI 자동 발송 이력)
// ============================================
// NHN이 받아 간 발송을 본다 — 반송·SST3으로 failed가 된 주소를 다시 가져와도 AI 메일을 다시 쓰지 않는다 (SND-11).
// 보낼 때 거절(NHN이 받지 않음)은 지금처럼 다시 보낼 수 있다
async function checkDuplicateRecipientForAiAuto(
    partitionId: number,
    recipientEmail: string
): Promise<boolean> {
    const [existing] = await db
        .select({ id: emailSendLogs.id })
        .from(emailSendLogs)
        .where(
            and(
                eq(emailSendLogs.partitionId, partitionId),
                eq(emailSendLogs.recipientEmail, recipientEmail),
                eq(emailSendLogs.triggerType, "ai_auto"),
                await acceptedSendCondition()
            )
        )
        .limit(1);
    return !existing;
}

// ============================================
// 메인 자동화 함수
// ============================================
interface AutoPersonalizedParams {
    /** 대량 큐의 영속 예약·미리 작성한 본문을 연결하는 키. */
    queueId?: number;
    record: DbRecord;
    partitionId: number;
    triggerType: "on_create" | "on_update";
    orgId: string;
    /**
     * 돌리지 않을 규칙 id. 발송 대기열 줄에서 시도 횟수를 다 쓴 규칙이다 — 뒤 규칙이 미뤄진 채 남아 있어
     * 줄을 닫지 않고 다시 꺼낼 때, 이미 끝난 실패 규칙에 AI 생성·발송을 또 쓰지 않게 한다 (대기열 워커만 넘긴다)
     */
    skipLinkIds?: readonly number[];
    /**
     * 발송 목적 (DESIGN-2 2절). 생략하면 "inbound" — 한 건씩 생긴 레코드를 바로 보내는 경로(dispatchAutoTriggers)와 같다.
     * 대기열 워커는 줄의 priority로 정한다: 문의가 막혀 들어온 줄은 "inbound", 가져오기·예약 등록 줄은 "bulk"
     * (15:00 KST 전까지 주소마다 한도의 10%를 문의 몫으로 남긴다)
     */
    purpose?: SendPurpose;
    /**
     * 발신 자리 잡기 차례 (대기열 워커·일괄 재처리 스크립트가 넘긴다 — createClaimTurns). 함께 처리하는 줄들의 자리 잡기를
     * 꺼낸 순서대로 하나씩 하게 한다. 생략하면 바로 잡는다 (한 건씩 보내는 경로)
     */
    claimTurn?: Pick<ClaimTurn, "run">;
}

export async function processAutoPersonalizedEmail(
    params: AutoPersonalizedParams
): Promise<RecordOutcome> {
    const { record, partitionId, triggerType, orgId } = params;
    const purpose: SendPurpose = params.purpose ?? "inbound";
    const skipLinkIds = new Set(params.skipLinkIds ?? []);
    const outcomes: LinkOutcome[] = [];

    console.log(`[AutoEmail] Start: record=${record.id}, partition=${partitionId}, trigger=${triggerType}`);

    // 1. 매칭되는 규칙 조회 — id 순으로 고정한다. 앞 규칙이 발신 한도로 미뤄지면 뒤 규칙을 멈추므로(아래 break)
    // 순서가 매번 같아야 다시 꺼냈을 때 같은 규칙부터 본다
    const links = await db
        .select()
        .from(emailAutoPersonalizedLinks)
        .where(
            and(
                eq(emailAutoPersonalizedLinks.partitionId, partitionId),
                eq(emailAutoPersonalizedLinks.triggerType, triggerType),
                eq(emailAutoPersonalizedLinks.isActive, 1)
            )
        )
        .orderBy(emailAutoPersonalizedLinks.id);

    if (links.length === 0) {
        console.log(`[AutoEmail] No matching rules`);
        return { noMatchingRules: true, outcomes };
    }
    console.log(`[AutoEmail] Found ${links.length} rules`);

    // 1-1. 명단 보류 (DESIGN-SND 6-2) — 대량 줄만 본다. AI 호출·발신 자리 잡기보다 먼저 해서 토큰·한도를 쓰지 않는다.
    // 문의(바로 보내는 경로·대기열 priority 1)는 보지 않는다 (getActiveHold가 inbound면 늘 null) — 주소 멈춤·반송 막기는 그대로 따른다
    const hold = await getActiveHold(orgId, partitionId, purpose);
    if (hold) {
        console.log(`[AutoEmail] partition ${partitionId} is held (hold ${hold.id}) — bulk send not run`);
        return { noMatchingRules: false, outcomes, held: { holdId: hold.id } };
    }

    const data = record.data as Record<string, unknown>;

    for (const link of links) {
        if (skipLinkIds.has(link.id)) {
            console.log(`[AutoEmail] Rule ${link.id}: retry exhausted on this queue row, not run again`);
            outcomes.push({ kind: "skipped", linkId: link.id, reason: "retry_exhausted" });
            continue;
        }

        // 잡은 발신 자리. sendEachMail을 부르기 전에 끝나면 돌려준다 — 부른 뒤에는 나갔을 수 있어 돌려주지 않는다
        let slot: SenderSlot | null = null;
        let sendAttempted = false;
        let sendCompleted = false;
        let preparedLogId: number | null = null;
        let createdLogId: number | null = null;
        let planned: Extract<PreparationReservation, { kind: "reserved" }> | null = null;
        try {
            // 2. 조건 평가
            if (!evaluateCondition(link.triggerCondition as Parameters<typeof evaluateCondition>[0], data)) {
                console.log(`[AutoEmail] Rule ${link.id}: condition not met`);
                outcomes.push({ kind: "skipped", linkId: link.id, reason: "condition_not_met" });
                continue;
            }

            // 3. 쿨다운 체크
            const canSend = await checkCooldown(record.id);
            if (!canSend) {
                console.log(`[AutoEmail] Rule ${link.id}: cooldown active`);
                outcomes.push({ kind: "skipped", linkId: link.id, reason: "cooldown" });
                continue;
            }

            // 3-1. 중복 수신자 체크
            if (link.preventDuplicate) {
                const recipientEmail = data[link.recipientField] as string;
                if (recipientEmail) {
                    const canSendDup = await checkDuplicateRecipientForAiAuto(link.partitionId, recipientEmail);
                    if (!canSendDup) {
                        console.log(`[AutoEmail] Rule ${link.id}: duplicate recipient skipped: ${recipientEmail}`);
                        outcomes.push({ kind: "skipped", linkId: link.id, reason: "duplicate_recipient" });
                        continue;
                    }
                }
            }

            // 4. 수신자 이메일 추출
            const email = data[link.recipientField];
            if (!email || typeof email !== "string" || !email.includes("@")) {
                console.log(`[AutoEmail] Rule ${link.id}: no valid email in field "${link.recipientField}" (got: ${email})`);
                outcomes.push({ kind: "skipped", linkId: link.id, reason: "invalid_email" });
                continue;
            }

            // 수신거부 확인 — AI 호출(토큰 소모) 전에 걸러낸다
            const workspaceId = await resolveWorkspaceId(partitionId);
            if (!workspaceId) {
                console.log(`[AutoEmail] Rule ${link.id}: workspace not found for partition ${partitionId}`);
                outcomes.push({ kind: "skipped", linkId: link.id, reason: "workspace_not_found" });
                continue;
            }
            if (await isUnsubscribed(workspaceId, email)) {
                console.log(`[AutoEmail] Rule ${link.id}: skipped, unsubscribed (${email})`);
                outcomes.push({ kind: "skipped", linkId: link.id, reason: "unsubscribed" });
                continue;
            }
            // 보내기 직전 막기 — 이 사업에서 회신했거나 조직에서 hard 반송된 주소 (DESIGN-RPL 7-4, on일 때만).
            // 대기열 미리 판정(walkQueueRow의 isReplyStopped)이 같은 자리·같은 조건을 본다
            const replyStop = await findReplyStop(orgId, workspaceId, email);
            if (replyStop) {
                console.log(`[AutoEmail] Rule ${link.id}: skipped, ${replyStop.reason}`);
                outcomes.push({ kind: "skipped", linkId: link.id, reason: replyStop.reason });
                continue;
            }

            const sourceHash = preparedSourceHash(data, link);
            const cached = purpose === "bulk" && params.queueId ? await loadPreparedSend(params.queueId, link.id) : undefined;
            let content: PreparedEmailPayload | null = cached?.sourceHash === sourceHash ? cached.payload : null;

            // 이미 생성한 작업은 쿼터와 관계없이 본문을 재사용한다. 새 호출의 한도는 생성 계층에서 확인한다.
            const generationKey = `initial:${link.id}:${record.id}:${triggerType}:${(triggerType === "on_create" ? record.createdAt : record.updatedAt).toISOString()}`;

            // 6. 이메일 클라이언트 확인
            const emailClient = await getEmailClient(orgId);
            if (!emailClient) {
                console.log(`[AutoEmail] Rule ${link.id}: no email client`);
                outcomes.push({ kind: "skipped", linkId: link.id, reason: "no_email_client" });
                continue;
            }
            const emailConfig = await getEmailConfig(orgId);

            const reserve = (forceReplan = false) => reservePreparedSend({
                queueId: params.queueId!, linkId: link.id, orgId, ids: linkSenderPool(link),
                config: emailConfig, sourceHash, forceReplan,
            });
            let immediateIds = linkSenderPool(link);
            if (purpose === "bulk" && params.queueId) {
                const reservation = params.claimTurn ? await params.claimTurn.run(() => reserve()) : await reserve();
                if (reservation.kind === "deferred") {
                    outcomes.push({ kind: "deferred", linkId: link.id, retryAt: reservation.retryAt, reason: reservation.reason });
                    break;
                }
                if (reservation.kind === "uncertain") {
                    outcomes.push({ kind: "skipped", linkId: link.id, reason: "delivery_uncertain" });
                    break;
                }
                if (reservation.kind === "sent") {
                    outcomes.push({ kind: "sent", linkId: link.id });
                    continue;
                }
                if (reservation.kind === "reserved") {
                    planned = reservation;
                    content = reservation.row.payload;
                }
                if (reservation.kind === "legacy" && reservation.ids) immediateIds = reservation.ids;
            }

            // 대량 예약은 오늘 작성할 자리만 확보했다. 실제 사용량은 예약 시각에 올린다.
            // 문의·한도 없는 주소는 기존 자리 잡기 → 작성 → 즉시 전송 흐름을 따른다.
            let sender: SenderSlot["sender"];
            if (planned) {
                sender = { fromEmail: planned.sender.fromEmail, fromName: planned.sender.fromName, profileId: planned.sender.id };
            } else {
                const claimNow = () =>
                    claimSender(orgId, {
                        mode: "pool",
                        ids: immediateIds,
                        config: emailConfig,
                        spreadDeferrals: true,
                        purpose,
                    });
                const claim = params.claimTurn ? await params.claimTurn.run(claimNow) : await claimNow();
                if (!claim.ok) {
                    console.log(
                        `[AutoEmail] Rule ${link.id}: deferred (${claim.reason}) until ${claim.retryAt.toISOString()}`
                    );
                    outcomes.push({ kind: "deferred", linkId: link.id, retryAt: claim.retryAt, reason: claim.reason });
                    // 뒤 규칙은 보지 않는다 — 이 규칙의 로그가 없어 뒤 규칙이 쿨다운을 통과해 먼저 나가 버린다.
                    // 레코드를 통째로 미루고, 다시 꺼낼 때 이 규칙부터 본다
                    break;
                }
                slot = claim.slot;
                sender = slot.sender;
            }
            if (!sender.fromEmail) {
                await releaseSenderSlot(slot);
                outcomes.push({ kind: "skipped", linkId: link.id, reason: "no_sender" });
                continue;
            }
            let senderFromEmail = sender.fromEmail;
            const experimentEnrollment = !content || content.experimentAssignmentId ? await prepareEmailExperiment({
                orgId, workspaceId, ruleId: link.id, recordId: record.id, email,
                company: link.companyField ? data[link.companyField] : undefined,
                plannedAt: planned?.row.scheduledAt ?? new Date(), senderId: sender.profileId, senderEmail: senderFromEmail,
            }) : { kind: "none" as const };
            if (experimentEnrollment.kind === "excluded") {
                await releaseSenderSlot(slot); slot = null;
                outcomes.push({ kind: "skipped", linkId: link.id, reason: "experiment_excluded" });
                continue;
            }

            const newlyPrepared = !content;
            if (!content) {
                // 6-2. 서명 결정. DB의 null은 "미지정"이므로 undefined로 정규화한다
                // (HTTP body에서 온 값과 달리 여기서는 null이 "서명 없음"을 뜻하지 않는다)
                const signatureJson = await resolveSignature(orgId, {
                    requestedId: link.signatureId ?? undefined,
                    config: emailConfig,
                });

                // 7. 회사 조사 (autoResearch && _companyResearch 없으면)
                const recordData = { ...data };
                if (link.autoResearch === 1 && !recordData._companyResearch) {
                    const companyName = data[link.companyField] as string;
                    const searchClient = getSearchAiClient();  // 회사 리서치는 웹검색 필요 → SEARCH_MODEL_ID 고정
                    if (searchClient && companyName && typeof companyName === "string" && companyName.trim()) {
                        // 같은 org에서 이미 조사한 회사면 재사용한다 — 웹서치 1건이 약 19,000 input tokens라
                        // 대량 발송에서 회사가 겹치는 만큼 그대로 중복 과금된다.
                        const cached = await findCachedCompanyResearch(orgId, companyName);

                        if (cached) {
                            recordData._companyResearch = { ...cached, researchedAt: new Date().toISOString() };
                            await db
                                .update(records)
                                .set({ data: { ...data, _companyResearch: recordData._companyResearch } })
                                .where(eq(records.id, record.id));
                            console.log(`[AutoEmail] Company research cache hit: ${companyName}`);
                        } else {
                            if (!(await checkTokenQuota(orgId)).allowed) throw new CopyDeferredError(new Date(Date.now() + 3600_000), "회사 조사 사용량 한도", true);
                            const research = await generateCompanyResearch(searchClient, { companyName, additionalContext: data });
                            recordData._companyResearch = {
                                ...research,
                                sources: research.sources,
                                researchedAt: new Date().toISOString(),
                            };

                            // 레코드에 _companyResearch 저장
                            await db
                                .update(records)
                                .set({ data: { ...data, _companyResearch: recordData._companyResearch } })
                                .where(eq(records.id, record.id));

                            const researchTokens = research.usage.promptTokens + research.usage.completionTokens;
                            await updateTokenUsage(orgId, researchTokens);

                            await logAiUsage({
                                orgId,
                                userId: null,
                                provider: searchClient.provider,
                                model: searchClient.model,
                                promptTokens: research.usage.promptTokens,
                                completionTokens: research.usage.completionTokens,
                                purpose: "auto_company_research",
                            });
                        }
                    }
                }

                // 8. 제품 조회
                let product = null;
                if (link.productId) {
                    const [p] = await db
                        .select()
                        .from(products)
                        .where(eq(products.id, link.productId))
                        .limit(1);
                    product = p ?? null;
                }

                // 8-0. 에셋 URL 조회 (규칙에 assetIds가 있으면)
                let assetUrls: string[] = [];
                const assetIds = (link as Record<string, unknown>).assetIds as number[] | null | undefined;
                if (Array.isArray(assetIds) && assetIds.length > 0) {
                    const assets = await db
                        .select({ id: emailAssets.id, url: emailAssets.url })
                        .from(emailAssets)
                        .where(inArray(emailAssets.id, assetIds));
                    // 규칙에 저장된 순서를 유지
                    const urlById = new Map(assets.map((a) => [a.id, a.url]));
                    assetUrls = assetIds.map((id) => urlById.get(id)).filter((u): u is string => !!u);
                }

                // 8-1. 발신자 페르소나 (서명에서 추출)
                if (experimentEnrollment.kind === "assigned") {
                    assetUrls = experimentEnrollment.experiment.config.ruleSnapshot.assetUrls as string[];
                }
                let senderPersona: { name: string; title?: string; company?: string } | null = null;
                if (link.useSignaturePersona === 1 && signatureJson) {
                    try {
                        const sig = JSON.parse(signatureJson);
                        if (sig && typeof sig === "object" && sig.name) {
                            senderPersona = {
                                name: sig.name,
                                title: sig.title || undefined,
                                company: sig.company || undefined,
                            };
                        }
                    } catch { /* legacy plain text signature — skip */ }
                }

                // 8-2. AI 이메일 생성 — 프롬프트의 ##필드명## 변수를 레코드 값으로 치환
                const rawPrompt = link.prompt || "이 회사에 적합한 제품 소개 이메일을 작성해주세요.";
                const prompt = substitutePromptVariables(rawPrompt, recordData);
                const emailInput = {
                    prompt,
                    product,
                    recordData,
                    tone: link.tone || undefined,
                    ctaUrl: link.ctaUrl || product?.url || undefined,
                    assetUrls: assetUrls.length > 0 ? assetUrls : undefined,
                    format: (link.format as "plain" | "designed") || "plain",
                    senderPersona,
                };
                const emailResult = await prepareManagedEmail({
                    orgId, workspaceId, purpose: "initial_email", ruleId: link.id,
                    key: experimentEnrollment.kind === "assigned" ? `experiment-assignment:${experimentEnrollment.assignment.id}` : generationKey,
                    model: link.model ?? undefined,
                    legacyContext: { system: buildEmailSystemPrompt(emailInput), user: prompt },
                    approvedContext: { system: buildEmailSystemPrompt({ ...emailInput, product: null, format: "plain",
                        ctaUrl: experimentEnrollment.kind === "assigned" ? String(experimentEnrollment.experiment.config.ruleSnapshot.resolvedCtaUrl ?? "") || undefined : emailInput.ctaUrl }), user: prompt,
                        fixedSubject: experimentEnrollment.kind === "assigned" ? experimentEnrollment.experiment.config.subject : undefined,
                        allowedUrls: experimentEnrollment.kind === "assigned" ? [experimentEnrollment.experiment.config.ruleSnapshot.resolvedCtaUrl, ...assetUrls].filter((url): url is string => typeof url === "string" && !!url)
                            : [link.ctaUrl, product?.url, ...assetUrls].filter((url): url is string => !!url) },
                    pinned: experimentEnrollment.kind === "assigned" ? { policy: experimentEnrollment.policy, knowledge: experimentEnrollment.knowledge, assignmentId: experimentEnrollment.assignment.id } : undefined,
                });
                console.log(`[AutoEmail] Email generated for record ${record.id}: subject="${emailResult.subject}"`);

                // 9. NHN Cloud 이메일 발송
                let finalBody = emailResult.htmlBody;
                if (signatureJson) {
                    finalBody = appendSignature(finalBody, signatureJson);
                }

                const unsubscribeToken = link.useUnsubscribe ? generateUnsubscribeToken() : null;
                if (unsubscribeToken) {
                    finalBody = appendUnsubscribeFooter(finalBody, buildUnsubscribeUrl(unsubscribeToken));
                }

                content = { recipientEmail: email, subject: emailResult.subject, body: finalBody, unsubscribeToken, aiCopyJobId: emailResult.jobId, experimentAssignmentId: emailResult.assignmentId };
                if (planned) await savePreparedContent(planned.row.id, content);
            }

            if (planned) {
                // 준비가 오래 걸리거나 서버가 늦게 깨어났으면 즉시 몰아서 보내지 않고 미래 구간에 다시 배정한다.
                if (newlyPrepared && planned.row.scheduledAt.getTime() < Date.now() + PREPARATION_LEAD_MS) {
                    const replacement = await reserve(true);
                    if (replacement.kind === "reserved") planned = replacement;
                    else if (replacement.kind === "deferred") {
                        outcomes.push({ kind: "deferred", linkId: link.id, retryAt: replacement.retryAt, reason: replacement.reason });
                        break;
                    } else throw new Error("메일 예약을 다시 배정하지 못했습니다.");
                }
                if (newlyPrepared || !isDeliveryDue(planned.row.scheduledAt, new Date())) {
                    outcomes.push({ kind: "deferred", linkId: link.id, retryAt: planned.row.scheduledAt, reason: "scheduled" });
                    break;
                }
                const claimNow = () => claimSender(orgId, {
                    mode: "fixed", ids: [planned!.sender.id], config: emailConfig, purpose: "bulk", prepared: true,
                });
                const claim = params.claimTurn ? await params.claimTurn.run(claimNow) : await claimNow();
                if (!claim.ok) {
                    outcomes.push({ kind: "deferred", linkId: link.id, retryAt: claim.retryAt, reason: claim.reason });
                    break;
                }
                slot = claim.slot;
                sender = slot.sender;
                if (!sender.fromEmail) throw new Error("예약한 발신 주소를 찾을 수 없습니다.");
                senderFromEmail = sender.fromEmail;
            }
            const finalBody = content.body;
            const unsubscribeToken = content.unsubscribeToken;

            // 10. 로그 먼저 insert → 트래킹 URL 삽입 → 발송 → status 업데이트
            const logValues = {
                orgId,
                partitionId,
                recordId: record.id,
                recipientEmail: email,
                subject: content.subject,
                body: finalBody,
                status: "pending",
                triggerType: "ai_auto",
                autoPersonalizedLinkId: link.id,
                sentAt: new Date(),
                unsubscribeToken,
                senderProfileId: sender.profileId,
                // 보낼 때 쓴 주소 그대로 — 프로필 주소를 나중에 바꿔도 이력의 보낸 주소는 그대로다 (DESIGN-3 4-1)
                senderEmail: senderFromEmail,
            };
            let inserted: { id: number };
            if (planned) {
                const delivery = await beginPreparedDelivery(planned.row.id, logValues, link.preventDuplicate === 1);
                if ("skip" in delivery) {
                    await releaseSenderSlot(slot);
                    slot = null;
                    outcomes.push({ kind: "skipped", linkId: link.id, reason: delivery.skip });
                    break;
                }
                inserted = { id: delivery.logId };
                preparedLogId = delivery.logId;
            } else {
                [inserted] = await db.insert(emailSendLogs).values(logValues).returning({ id: emailSendLogs.id });
            }
            createdLogId = inserted.id;
            if (content.aiCopyJobId && !(await attachManagedEmail({ orgId, jobId: content.aiCopyJobId, logId: inserted.id }))) {
                await db.update(emailSendLogs).set({ status: "cancelled", resultMessage: "동일 생성 작업의 발송 이력 존재" }).where(eq(emailSendLogs.id, inserted.id));
                await releaseSenderSlot(slot); slot = null;
                outcomes.push({ kind: "skipped", linkId: link.id, reason: "duplicate_recipient" });
                break;
            }

            const trackedBody = wrapTrackingUrls(finalBody, inserted.id);

            sendAttempted = true;
            const nhnResult = await emailClient.sendEachMail({
                senderAddress: senderFromEmail,
                senderName: sender.fromName,
                title: content.subject,
                body: trackedBody,
                receiverList: [{ receiveMailAddr: email, receiveType: "MRT0" }],
                ...(unsubscribeToken
                    ? { customHeaders: buildListUnsubscribeHeaders(unsubscribeToken) }
                    : {}),
            });
            sendCompleted = true;

            const sendResult = nhnResult.data?.results?.[0];
            const isSuccess = nhnResult.header.isSuccessful && (!sendResult || sendResult.resultCode === 0);
            // NHN이 받지 않았다 — 나가지 않았으니 자리를 돌려준다. 로그 갱신보다 먼저 해야 갱신이 던져도 돌려준다
            if (!isSuccess) await releaseSenderSlot(slot);
            if (planned) await finishPreparedDelivery(planned.row.id, isSuccess ? "sent" : "ready");

            await db.update(emailSendLogs)
                .set({
                    requestId: nhnResult.data?.requestId,
                    status: isSuccess ? "sent" : "failed",
                    resultCode: sendResult ? String(sendResult.resultCode) : null,
                    resultMessage: sendResult?.resultMessage ?? nhnResult.header.resultMessage,
                })
                .where(eq(emailSendLogs.id, inserted.id));
            if (content.aiCopyJobId && content.experimentAssignmentId) await recordExperimentDelivery({ orgId, jobId: content.aiCopyJobId, logId: inserted.id, accepted: isSuccess, sentAt: new Date() })
                .catch(() => console.error("[email-experiments] 전송 결과 연결 지연 — 발송 로그 기준으로 복구 필요"));
            console.log(`[AutoEmail] Rule ${link.id}: ${isSuccess ? "sent" : "failed"} to ${email}`);
            if (isSuccess) {
                outcomes.push({ kind: "sent", linkId: link.id });
            } else {
                outcomes.push({
                    kind: "failed",
                    linkId: link.id,
                    error: sendResult?.resultMessage ?? nhnResult.header.resultMessage ?? "send failed",
                });
            }

            // 11. 후속 발송 큐 등록
            if (isSuccess && inserted?.id && link.followupConfig) {
                const steps = Array.isArray(link.followupConfig) ? link.followupConfig : [link.followupConfig];
                const first = steps[0] as { delayDays: number } | undefined;
                if (first?.delayDays) {
                    await enqueueFollowup({
                        logId: inserted.id,
                        sourceType: "ai",
                        sourceId: link.id,
                        orgId,
                        sentAt: new Date(),
                        delayDays: first.delayDays,
                    });
                }
            }
        } catch (err) {
            // 회사 조사·AI·로그 insert에서 던졌으면 메일이 나가지 않았다 → 자리를 돌려준다.
            // sendEachMail이 던졌거나 발송 뒤 DB 갱신이 던졌으면 나갔을 수 있다 → 돌려주지 않는다 (한도를 넘지 않는 쪽)
            if (!sendAttempted) await releaseSenderSlot(slot);
            if (createdLogId && !sendAttempted) await db.update(emailSendLogs).set({ status: "failed", resultMessage: "전송 요청 전 준비 실패" }).where(eq(emailSendLogs.id, createdLogId));
            if (planned && preparedLogId && !sendAttempted) {
                await db.update(emailSendLogs).set({ status: "failed", resultMessage: "전송 요청 전 준비 실패" })
                    .where(eq(emailSendLogs.id, preparedLogId));
                await finishPreparedDelivery(planned.row.id, "ready");
            }
            if (planned && sendAttempted && !sendCompleted) await finishPreparedDelivery(planned.row.id, "uncertain");
            if (err instanceof CopyDeferredError && !sendAttempted) {
                outcomes.push(err.reason === "작업 취소"
                    ? { kind: "skipped", linkId: link.id, reason: "copy_cancelled" }
                    : { kind: "deferred", linkId: link.id, retryAt: err.retryAt, reason: "scheduled" });
                break;
            }
            console.error(`Auto personalized email error (link ${link.id}, record ${record.id}):`, err);
            // 삼키지 않는다 — 큐 워커가 재시도 여부를 판단하려면 실패가 결과에 남아야 한다
            outcomes.push({
                kind: "failed",
                linkId: link.id,
                error: err instanceof Error ? err.message : String(err),
            });
        } finally {
            if (purpose === "bulk" && params.queueId && outcomes.at(-1)?.kind === "skipped") {
                await cancelPreparedSend(params.queueId, link.id);
            }
        }
    }

    return { noMatchingRules: false, outcomes };
}
