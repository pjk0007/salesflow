import { normalizeEmail } from "./deep-visitor-alert-rules";
import { evaluateJourney } from "./customer-journey-card";
import { loadCandidates, enrichedInput } from "./customer-journey-source";
import {
    measuredVisitSeconds,
    nextVisitAckBusinessTime,
    visitAckBody,
    visitAckConfig,
    visitAckScheduledAt,
    VISIT_ACK_MAX_AGE_MS,
    VISIT_ACK_SUBJECT,
} from "./email-visit-ack-rules";
import type { VisitAckConnection, VisitAckRow } from "./email-visit-ack";
import type { JourneyCardInput } from "./customer-journey-card";

type Env = Record<string, string | undefined>;
export interface VisitAckParent extends VisitAckRow {
    recipient_email: string;
    sender_email: string | null;
    sender_profile_id: number | null;
    partition_id: number | null;
    auto_personalized_link_id: number | null;
    template_link_id: number | null;
}
type Outcome =
    | { kind: "sent" }
    | { kind: "skipped" }
    | { kind: "uncertain" }
    | { kind: "deferred"; retryAt: Date };
interface SendResult {
    kind: "accepted" | "rejected" | "uncertain";
    requestId?: string;
    code?: string;
    message?: string;
}
export interface VisitAckReady {
    kind: "ready";
    body: string;
    unsubscribeToken: string;
    senderEmail: string;
    senderProfileId: number | null;
    send: (logId: number) => Promise<SendResult>;
    release: () => Promise<void>;
}
export interface VisitAckDeliveryDeps {
    env: Env;
    now: () => Date;
    random?: () => number;
    checkStop: (parent: VisitAckParent) => Promise<string | null>;
    prepare: (
        parent: VisitAckParent,
        input: JourneyCardInput,
    ) => Promise<VisitAckReady | { kind: "deferred"; retryAt: Date }>;
    timeoutMs?: number;
}

/** HTTP 요청 전에 결과 미확인을 기록한다. 응답이 불명확한 메일은 자동 재전송하지 않는다. */
export async function deliverVisitAcknowledgement(
    conn: VisitAckConnection,
    item: { id: number; sourceId: number; orgId: string; parentLogId: number },
    deps: VisitAckDeliveryDeps,
): Promise<Outcome> {
    const [parent] = await conn<VisitAckParent[]>`
        SELECT a.*,q.id AS queue_id,l.recipient_email,l.sender_email,l.sender_profile_id,l.partition_id,l.template_link_id,
            COALESCE(l.auto_personalized_link_id,(SELECT f.source_id FROM email_followup_queue f
                WHERE f.parent_log_id=l.parent_log_id AND f.org_id=l.org_id AND f.source_type='ai' ORDER BY f.id DESC LIMIT 1)) AS auto_personalized_link_id
        FROM email_visit_acknowledgements a JOIN email_send_logs l ON l.id=a.source_log_id AND l.org_id=a.org_id
        JOIN email_followup_queue q ON q.parent_log_id=a.source_log_id AND q.source_type='visit_ack' AND q.source_id=a.id AND q.org_id=a.org_id
        WHERE a.id=${item.sourceId} AND a.org_id=${item.orgId} AND a.source_log_id=${item.parentLogId} AND q.id=${item.id} AND q.status='processing'`;
    if (!parent) return { kind: "skipped" };
    if (parent.status !== "pending")
        return {
            kind: parent.status === "uncertain" ? "uncertain" : "skipped",
        };
    const now = deps.now();
    const config = visitAckConfig(deps.env);
    const cancel = async (reason: string, logId?: number): Promise<Outcome> => {
        await conn`UPDATE email_visit_acknowledgements SET status='cancelled',reason=${reason},updated_at=${deps.now().toISOString()} WHERE id=${parent.id}`;
        if (logId)
            await conn`UPDATE email_send_logs SET status='cancelled',result_message=${reason} WHERE id=${logId} AND org_id=${item.orgId}`;
        return { kind: "skipped" };
    };
    const defer = async (retryAt: Date): Promise<Outcome> => {
        const due = nextVisitAckBusinessTime(retryAt);
        await conn`UPDATE email_visit_acknowledgements SET scheduled_at=${due.toISOString()},updated_at=${deps.now().toISOString()} WHERE id=${parent.id} AND status='pending'`;
        return { kind: "deferred", retryAt: due };
    };
    if (
        config.mode !== "live" ||
        !config.ids.includes(parent.workspace_id) ||
        new Date(parent.observed_at) < config.startAt
    )
        return cancel("방문 감사 자동 발송 설정 해제");
    if (
        now.getTime() - new Date(parent.observed_at).getTime() >
        VISIT_ACK_MAX_AGE_MS
    )
        return cancel("방문 확인 후 7일 경과");
    if (
        nextVisitAckBusinessTime(now).getTime() !== now.getTime() ||
        now.getTime() - new Date(parent.scheduled_at).getTime() > 5 * 60_000
    )
        return defer(visitAckScheduledAt(now, deps.random));
    const load = async () => {
        const at = deps.now();
        const [source] = await loadCandidates(
            conn,
            parent.workspace_id,
            at,
            new Date(
                Math.max(
                    config.startAt.getTime(),
                    at.getTime() - VISIT_ACK_MAX_AGE_MS,
                ),
            ),
            { sessionId: parent.session_id, orgId: parent.org_id },
            {
                startAt: config.startAt,
                orgId: parent.org_id,
                email: normalizeEmail(parent.recipient_email),
            },
        );
        if (!source || source.send_log_id !== parent.source_log_id) return null;
        const input = await enrichedInput(
            conn,
            source,
            deps.env.NEXT_PUBLIC_BASE_URL ?? "https://sendb.kr",
            at,
            [],
            (deps.env.JOURNEY_ALERT_INTERNAL_DOMAINS ?? "").split(","),
        );
        const seconds = measuredVisitSeconds(input, at);
        if (
            seconds === null ||
            seconds < 5 ||
            evaluateJourney(input, at).verdict.machine ||
            input.audience?.internal ||
            input.audience?.sharedVisitor ||
            input.audience?.unsubscribed ||
            input.audience?.alreadyConverted
        )
            return null;
        return input;
    };
    const input = await load();
    if (!input) return cancel("방문 조건 변경·내부·공유·수신거부·전환 완료");
    const stop = await deps.checkStop(parent);
    if (stop) return cancel(stop);
    if (
        input.audience?.lastActivityAt &&
        now.getTime() - input.audience.lastActivityAt.getTime() < 10 * 60_000
    )
        return defer(visitAckScheduledAt(now, deps.random));
    let ready: Awaited<ReturnType<VisitAckDeliveryDeps["prepare"]>>;
    try {
        ready = await deps.prepare(parent, input);
    } catch {
        return defer(new Date(deps.now().getTime() + 3600_000));
    }
    if (ready.kind === "deferred") return defer(ready.retryAt);
    let attempted = false;
    let slotReleased = false;
    const release = async () => {
        if (!slotReleased) {
            slotReleased = true;
            await ready.release();
        }
    };
    let logId: number | undefined;
    try {
        // 준비 중 답장·거부·내부 식별·전환이 생기면 발신 자리만 반환한다.
        const freshInput = await load();
        if (!freshInput) {
            await release();
            return cancel("전송 전 방문 조건 변경");
        }
        const freshNow = deps.now();
        if (
            nextVisitAckBusinessTime(freshNow).getTime() !==
                freshNow.getTime() ||
            (freshInput.audience?.lastActivityAt &&
                freshNow.getTime() -
                    freshInput.audience.lastActivityAt.getTime() <
                    10 * 60_000)
        ) {
            await release();
            return defer(visitAckScheduledAt(freshNow, deps.random));
        }
        const latestStop = await deps.checkStop(parent);
        if (latestStop) {
            await release();
            return cancel(latestStop);
        }
        const [claimed] = await conn<{ id: number }[]>`
            WITH owned AS (
                UPDATE email_visit_acknowledgements a SET status='uncertain',reason='전송 응답 확인 대기',updated_at=${deps.now().toISOString()}
                WHERE a.id=${parent.id} AND a.org_id=${item.orgId} AND a.status='pending'
                  AND EXISTS (SELECT 1 FROM email_followup_queue q WHERE q.id=${item.id} AND q.org_id=a.org_id AND q.status='processing')
                RETURNING a.id
            )
            INSERT INTO email_send_logs
                (org_id,partition_id,record_id,recipient_email,subject,body,status,trigger_type,parent_log_id,sent_at,unsubscribe_token,sender_profile_id,sender_email)
            SELECT ${parent.org_id},${parent.partition_id},${parent.record_id},${parent.recipient_email},${VISIT_ACK_SUBJECT},${ready.body},'uncertain','visit_ack',
                ${parent.source_log_id},${deps.now().toISOString()},${ready.unsubscribeToken},${ready.senderProfileId},${ready.senderEmail} FROM owned RETURNING id`;
        if (!claimed) {
            await release();
            return { kind: "skipped" };
        }
        logId = claimed.id;
        await conn`UPDATE email_visit_acknowledgements SET send_log_id=${logId} WHERE id=${parent.id}`;
        await conn`UPDATE email_followup_queue SET status='uncertain' WHERE id=${item.id} AND status='processing'`;
        const finalStop = await deps.checkStop(parent);
        if (finalStop || !(await load())) {
            await release();
            return cancel(finalStop ?? "전송 직전 방문 조건 변경", logId);
        }
        attempted = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([
            ready.send(logId),
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error("send timeout")),
                    deps.timeoutMs ?? 45_000,
                );
            }),
        ]).finally(() => {
            if (timer) clearTimeout(timer);
        });
        if (result.kind === "uncertain") return { kind: "uncertain" };
        if (result.kind === "rejected") await release();
        const status = result.kind === "accepted" ? "sent" : "failed";
        await conn`UPDATE email_send_logs SET status=${status},request_id=${result.requestId ?? null},result_code=${result.code ?? null},result_message=${result.message ?? null}
            WHERE id=${logId} AND org_id=${item.orgId}`;
        await conn`UPDATE email_visit_acknowledgements SET status=${status},reason=${result.message ?? null},updated_at=${deps.now().toISOString()} WHERE id=${parent.id}`;
        return { kind: result.kind === "accepted" ? "sent" : "skipped" };
    } catch {
        if (!attempted) {
            await release();
            if (!logId) return defer(new Date(deps.now().getTime() + 3600_000));
        }
        // CAS 이후의 DB 오류·타임아웃도 결과 미확인이다. 자동으로 재시도하지 않는다.
        return { kind: "uncertain" };
    }
}

/** 기존 발신 한도·NHN 클라이언트·서명·수신거부 처리를 재사용한다. */
export async function handleVisitAcknowledgement(item: {
    id: number;
    sourceId: number;
    orgId: string;
    parentLogId: number;
}): Promise<Outcome> {
    const [
        { queryClient, db, emailAutoPersonalizedLinks, emailTemplateLinks },
        { eq, and },
        mail,
        sender,
        limits,
        unsub,
        replies,
        holds,
        clicks,
        replyRules,
    ] = await Promise.all([
        import("./db"),
        import("drizzle-orm"),
        import("./nhn-email"),
        import("./email-sender-resolver"),
        import("./email-sender-limit"),
        import("./email-unsubscribe"),
        import("./email-reply-guard"),
        import("./partition-hold"),
        import("./email-click-tracking"),
        import("./email-reply-rules"),
    ]);
    const conn = await queryClient.reserve();
    try {
        return await deliverVisitAcknowledgement(conn, item, {
            env: process.env,
            now: () => new Date(),
            checkStop: async (p) => {
                if (
                    await unsub.isUnsubscribed(
                        p.workspace_id,
                        p.recipient_email,
                    )
                )
                    return "수신거부";
                // 감사 메일은 REPLY_SYNC_MODE 설정과 무관하게 이미 저장된 사람 회신을 반드시 확인한다.
                const replyEmail = replyRules.normalizeReplyAddress(
                    p.recipient_email,
                );
                const [reply] = await conn<
                    { id: number }[]
                >`SELECT id FROM email_replies WHERE org_id=${p.org_id} AND workspace_id=${p.workspace_id}
                    AND kind='human' AND (contact_email=${replyEmail} OR matched_recipient=${replyEmail}) LIMIT 1`;
                if (reply) return "이미 회신한 고객";
                if (
                    await replies.findReplyStop(
                        p.org_id,
                        p.workspace_id,
                        p.recipient_email,
                    )
                )
                    return "회신·반송으로 중단";
                return null;
            },
            prepare: async (p, input) => {
                if (
                    p.partition_id !== null &&
                    (await holds.getActiveHold(
                        p.org_id,
                        p.partition_id,
                        "bulk",
                    ))
                )
                    return {
                        kind: "deferred",
                        retryAt: new Date(Date.now() + 3600_000),
                    };
                const config = await mail.getEmailConfig(p.org_id);
                const client = await mail.getEmailClient(p.org_id);
                if (!client)
                    return {
                        kind: "deferred",
                        retryAt: new Date(Date.now() + 3600_000),
                    };
                const claim = await limits.claimSender(p.org_id, {
                    mode: "fixed",
                    ids: [p.sender_profile_id],
                    config,
                    spreadDeferrals: true,
                    purpose: "bulk",
                });
                if (!claim.ok)
                    return { kind: "deferred", retryAt: claim.retryAt };
                const slot = claim.slot;
                let slotReleased = false;
                const release = async () => {
                    if (!slotReleased) {
                        slotReleased = true;
                        await limits.releaseSenderSlot(slot);
                    }
                };
                const fromEmail = slot.sender.fromEmail;
                // 삭제·변경된 원래 발신 주소 대신 다른 주소로 감사 메일을 보내지 않는다.
                if (
                    !fromEmail ||
                    !p.sender_email ||
                    normalizeEmail(fromEmail) !==
                        normalizeEmail(p.sender_email) ||
                    (p.sender_profile_id !== null &&
                        slot.sender.profileId !== p.sender_profile_id)
                ) {
                    await release();
                    return {
                        kind: "deferred",
                        retryAt: new Date(Date.now() + 3600_000),
                    };
                }
                try {
                    let signatureId: number | undefined;
                    if (p.auto_personalized_link_id !== null) {
                        const [link] = await db
                            .select()
                            .from(emailAutoPersonalizedLinks)
                            .where(
                                and(
                                    eq(
                                        emailAutoPersonalizedLinks.id,
                                        p.auto_personalized_link_id,
                                    ),
                                    eq(
                                        emailAutoPersonalizedLinks.orgId,
                                        p.org_id,
                                    ),
                                ),
                            )
                            .limit(1);
                        if (
                            !link ||
                            link.isActive !== 1 ||
                            link.isDraft === 1
                        ) {
                            await release();
                            return {
                                kind: "deferred",
                                retryAt: new Date(Date.now() + 3600_000),
                            };
                        }
                        signatureId = link?.signatureId ?? undefined;
                    }
                    if (p.template_link_id !== null) {
                        const [link] = await db
                            .select()
                            .from(emailTemplateLinks)
                            .where(
                                and(
                                    eq(
                                        emailTemplateLinks.id,
                                        p.template_link_id,
                                    ),
                                    eq(
                                        emailTemplateLinks.partitionId,
                                        p.partition_id ?? -1,
                                    ),
                                ),
                            )
                            .limit(1);
                        if (!link || link.isActive !== 1) {
                            await release();
                            return {
                                kind: "deferred",
                                retryAt: new Date(Date.now() + 3600_000),
                            };
                        }
                    }
                    const signature = await sender.resolveSignature(p.org_id, {
                        requestedId: signatureId,
                        config,
                    });
                    const token = unsub.generateUnsubscribeToken();
                    let body = visitAckBody(input.fields);
                    if (signature) body = mail.appendSignature(body, signature);
                    body = unsub.appendUnsubscribeFooter(
                        body,
                        unsub.buildUnsubscribeUrl(token),
                    );
                    return {
                        kind: "ready",
                        body,
                        unsubscribeToken: token,
                        senderEmail: fromEmail,
                        senderProfileId: slot.sender.profileId,
                        release,
                        send: async (logId) => {
                            const result = await client.sendEachMail({
                                senderAddress: fromEmail,
                                senderName: slot.sender.fromName,
                                title: VISIT_ACK_SUBJECT,
                                body: clicks.wrapTrackingUrls(body, logId),
                                receiverList: [
                                    {
                                        receiveMailAddr: p.recipient_email,
                                        receiveType: "MRT0",
                                    },
                                ],
                                customHeaders:
                                    unsub.buildListUnsubscribeHeaders(token),
                            });
                            const recipient = result.data?.results?.find(
                                (r) =>
                                    normalizeEmail(r.receiveMailAddr) ===
                                    normalizeEmail(p.recipient_email),
                            );
                            const kind =
                                result.header.isSuccessful &&
                                result.data?.requestId &&
                                recipient?.resultCode === 0
                                    ? "accepted"
                                    : (!result.header.isSuccessful &&
                                            result.header.resultCode < 500 &&
                                            ![408, 429].includes(
                                                result.header.resultCode,
                                            )) ||
                                        (recipient &&
                                            recipient.resultCode !== 0)
                                      ? "rejected"
                                      : "uncertain";
                            return {
                                kind,
                                requestId: result.data?.requestId,
                                code: String(
                                    recipient?.resultCode ??
                                        result.header.resultCode,
                                ),
                                message:
                                    recipient?.resultMessage ??
                                    result.header.resultMessage,
                            };
                        },
                    };
                } catch (error) {
                    await release();
                    throw error;
                }
            },
        });
    } finally {
        conn.release();
    }
}
