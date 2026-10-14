import {
    customerStaffActor,
    requireCustomerAccess,
} from "@/lib/customer-access/access";
import { randomUUID } from "node:crypto";
import { and, eq, or, lte, isNull, asc, sql } from "drizzle-orm";
import { z } from "zod";
import {
    db,
    inboxGoogleConnections as connections,
    inboxGoogleSyncJobs as jobs,
    inboxMailboxes as boxes,
    inboxEmailDeliveries as deliveries,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { GmailApiError, type GmailCredentials } from "@/lib/gmail-client";
import { InboxError } from "@/lib/inbox/errors";
import {
    gmailReader,
    receiveGmailMessage,
    retryGmailFiles,
    deliverGmailReply,
} from "./gmail";
import {
    googleMailConfig,
    googleMailWorkerEnabled,
    openGoogleValue,
    type GoogleMailConfig,
} from "./google-config";
import { googleTransport } from "./google-transport";
type Connection = typeof connections.$inferSelect;
type Box = typeof boxes.$inferSelect;
type Claim = { connection: Connection; box: Box };
type Options = {
    exec?: DbExec;
    now?: () => Date;
    config?: GoogleMailConfig;
    fetchImpl?: typeof fetch;
    mailboxId?: string;
};
const nextAction = {
    poll: "receive",
    receive: "files",
    files: "send",
    send: "poll",
} as const;
const sourceId = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
    historyId = z.string().regex(/^\d{1,128}$/),
    pageToken = z.string().min(1).max(10000);
const source = z.object({ id: sourceId });
const fullPage = z.object({
    messages: z.array(source).max(50).optional(),
    nextPageToken: pageToken.optional(),
});
const historyPage = z.object({
    historyId,
    nextPageToken: pageToken.optional(),
    history: z
        .array(
            z.object({
                messagesAdded: z
                    .array(z.object({ message: source }))
                    .optional(),
                labelsAdded: z
                    .array(
                        z.object({
                            message: source,
                            labelIds: z.array(z.string()).optional(),
                        }),
                    )
                    .optional(),
            }),
        )
        .max(1000)
        .optional(),
});
async function lockCurrent(tx: DbExec, job: Claim, now: Date) {
    const [box] = await tx
        .select()
        .from(boxes)
        .where(eq(boxes.id, job.box.id))
        .for("update");
    const [c] = await tx
        .select()
        .from(connections)
        .where(eq(connections.mailboxId, job.box.id))
        .for("update");
    return box?.enabled &&
        box.version === job.box.version &&
        c?.status === "connected" &&
        c.version === job.connection.version &&
        c.leaseToken === job.connection.leaseToken &&
        c.leaseUntil &&
        c.leaseUntil > now
        ? c
        : null;
}
async function claim(
    exec: DbExec,
    now: Date,
    id?: string,
): Promise<Claim | null> {
    const [hint] = await exec
        .select({ id: connections.mailboxId })
        .from(connections)
        .innerJoin(boxes, eq(boxes.id, connections.mailboxId))
        .where(
            and(
                eq(connections.status, "connected"),
                eq(boxes.enabled, true),
                lte(connections.nextRunAt, now),
                or(
                    isNull(connections.leaseUntil),
                    lte(connections.leaseUntil, now),
                ),
                id ? eq(connections.mailboxId, id) : undefined,
            ),
        )
        .orderBy(asc(connections.nextRunAt), asc(connections.mailboxId))
        .limit(1);
    if (!hint) return null;
    return exec.transaction(async (tx) => {
        const [box] = await tx
            .select()
            .from(boxes)
            .where(eq(boxes.id, hint.id))
            .for("update");
        const [c] = await tx
            .select()
            .from(connections)
            .where(eq(connections.mailboxId, hint.id))
            .for("update");
        if (
            !box.enabled ||
            c.status !== "connected" ||
            c.nextRunAt > now ||
            (c.leaseUntil && c.leaseUntil > now)
        )
            return null;
        const [saved] = await tx
            .update(connections)
            .set({
                leaseToken: randomUUID(),
                leaseUntil: new Date(now.getTime() + 120000),
            })
            .where(eq(connections.mailboxId, hint.id))
            .returning();
        return { box, connection: saved };
    });
}
async function actorFor(job: Claim, exec: DbExec) {
    try {
        if (!job.connection.connectedBy) throw new Error("missing actor");
        const actor = await customerStaffActor(
            job.box.orgId,
            job.connection.connectedBy,
            "메일 자동 연결",
            exec,
        );
        await requireCustomerAccess(actor, job.box.workspaceId, "manage", exec);
        return actor;
    } catch {
        throw new GmailApiError(
            "auth",
            null,
            "연결한 직원의 사업 운영 권한을 확인해주세요.",
        );
    }
}
async function enqueuePage(
    job: Claim,
    ids: string[],
    patch: Partial<Connection>,
    exec: DbExec,
    now: Date,
) {
    return exec.transaction(async (tx) => {
        if (!(await lockCurrent(tx, job, now))) return false;
        for (const id of new Set(ids)) {
            await tx
                .insert(jobs)
                .values({
                    mailboxId: job.box.id,
                    connectionVersion: job.connection.version,
                    providerMessageId: id,
                    eligibleAt: now,
                })
                .onConflictDoNothing();
            // A message moved out of Spam/Trash can become eligible later. Done receipts stay immutable.
            await tx
                .update(jobs)
                .set({
                    state: "pending",
                    connectionVersion: job.connection.version,
                    attempts: 0,
                    reasonCode: null,
                    eligibleAt: now,
                    updatedAt: now,
                })
                .where(
                    and(
                        eq(jobs.mailboxId, job.box.id),
                        eq(jobs.providerMessageId, id),
                        eq(jobs.state, "skipped"),
                        eq(jobs.reasonCode, "excluded_label"),
                    ),
                );
        }
        await tx
            .update(connections)
            .set({ ...patch, lastPollAt: now })
            .where(eq(connections.mailboxId, job.box.id));
        return true;
    });
}
async function poll(
    job: Claim,
    credentials: GmailCredentials,
    exec: DbExec,
    now: () => Date,
    fetchImpl: typeof fetch,
) {
    const c = job.connection,
        get = await gmailReader(credentials, fetchImpl),
        profile = z
            .object({ emailAddress: z.email(), historyId })
            .parse(await get("profile"));
    if (profile.emailAddress.toLowerCase() !== job.box.address)
        throw new GmailApiError("auth", null, "메일 계정 주소를 확인해주세요.");
    if (c.phase === "full") {
        const query = new URLSearchParams({
            q: `after:${Math.floor(c.since!.getTime() / 1000)} -in:sent -in:drafts -in:spam -in:trash`,
            maxResults: "50",
            ...(c.pageToken ? { pageToken: c.pageToken } : {}),
        });
        const page = fullPage.parse(
            await get(`messages?${query}`, 1024 * 1024),
        );
        await enqueuePage(
            job,
            (page.messages ?? []).map((m) => m.id),
            page.nextPageToken
                ? { pageToken: page.nextPageToken }
                : {
                      phase: "history",
                      pageToken: null,
                      historyId: c.baselineHistoryId ?? profile.historyId,
                  },
            exec,
            now(),
        );
        return;
    }
    try {
        const query = new URLSearchParams({
            startHistoryId: historyId.parse(c.historyId),
            maxResults: "50",
            ...(c.pageToken ? { pageToken: c.pageToken } : {}),
        });
        query.append("historyTypes", "messageAdded");
        query.append("historyTypes", "labelAdded");
        const page = historyPage.parse(
            await get(`history?${query}`, 4 * 1024 * 1024),
        );
        const ids = (page.history ?? []).flatMap((h) =>
            [...(h.messagesAdded ?? []), ...(h.labelsAdded ?? [])].map(
                (m) => m.message.id,
            ),
        );
        await enqueuePage(
            job,
            ids,
            page.nextPageToken
                ? { pageToken: page.nextPageToken }
                : { pageToken: null, historyId: page.historyId },
            exec,
            now(),
        );
    } catch (error) {
        if (!(error instanceof GmailApiError) || error.code !== "not_found")
            throw error;
        // History expired: retain original intake window and capture a fresh baseline before re-scanning.
        await enqueuePage(
            job,
            [],
            {
                phase: "full",
                pageToken: null,
                historyId: null,
                baselineHistoryId: profile.historyId,
            },
            exec,
            now(),
        );
    }
}
async function receiveOne(
    job: Claim,
    client: ReturnType<typeof googleTransport>,
    credentials: GmailCredentials,
    exec: DbExec,
    now: () => Date,
    fetchImpl: typeof fetch,
) {
    const sourceJob = await exec.transaction(async (tx) => {
        if (!(await lockCurrent(tx, job, now()))) return null;
        await tx
            .update(jobs)
            .set({
                state: "failed",
                reasonCode: "retry_limit",
                leaseToken: null,
                leaseUntil: null,
                updatedAt: now(),
            })
            .where(
                and(
                    eq(jobs.mailboxId, job.box.id),
                    eq(jobs.state, "processing"),
                    lte(jobs.leaseUntil, now()),
                    sql`${jobs.attempts}>=5`,
                ),
            );
        const [row] = await tx
            .select()
            .from(jobs)
            .where(
                and(
                    eq(jobs.mailboxId, job.box.id),
                    eq(jobs.connectionVersion, job.connection.version),
                    lte(jobs.eligibleAt, now()),
                    or(
                        eq(jobs.state, "pending"),
                        and(
                            eq(jobs.state, "processing"),
                            lte(jobs.leaseUntil, now()),
                        ),
                    ),
                ),
            )
            .orderBy(asc(jobs.createdAt), asc(jobs.id))
            .limit(1)
            .for("update");
        if (!row) return null;
        const [saved] = await tx
            .update(jobs)
            .set({
                state: "processing",
                attempts: row.attempts + 1,
                leaseToken: randomUUID(),
                leaseUntil: job.connection.leaseUntil,
                updatedAt: now(),
            })
            .where(eq(jobs.id, row.id))
            .returning();
        return saved;
    });
    if (!sourceJob) return;
    let patch: Partial<typeof jobs.$inferInsert>, fatal: unknown;
    try {
        const result = await receiveGmailMessage(
            client,
            {
                mailboxId: job.box.id,
                address: job.box.address,
                messageId: sourceJob.providerMessageId,
                since: job.connection.since!,
            },
            credentials,
            fetchImpl,
        );
        patch = result.receipt
            ? {
                  state: "done",
                  receiptId: result.receipt.receiptId,
                  reasonCode: result.receipt.ignoredReason,
              }
            : { state: "skipped", reasonCode: result.skippedReason };
    } catch (error) {
        const code =
            error instanceof GmailApiError
                ? error.code
                : error instanceof InboxError
                  ? "intake_rejected"
                  : "invalid_source";
        const retry =
            (error instanceof GmailApiError &&
                ["transient", "rate_limited", "auth", "scope"].includes(
                    code,
                )) ||
            (error instanceof Error &&
                ["AbortError", "TimeoutError", "TypeError"].includes(
                    error.name,
                ));
        patch =
            code === "not_found"
                ? { state: "skipped", reasonCode: "source_missing" }
                : {
                      state:
                          retry && sourceJob.attempts < 5
                              ? "pending"
                              : "failed",
                      reasonCode: code,
                      eligibleAt: new Date(
                          now().getTime() +
                              [30000, 120000, 300000, 900000][
                                  Math.min(3, sourceJob.attempts - 1)
                              ],
                      ),
                  };
        if (["auth", "scope", "config"].includes(code)) fatal = error;
    }
    await exec.transaction(async (tx) => {
        if (!(await lockCurrent(tx, job, now()))) return;
        await tx
            .update(jobs)
            .set({
                ...patch,
                leaseToken: null,
                leaseUntil: null,
                updatedAt: now(),
            })
            .where(
                and(
                    eq(jobs.id, sourceJob.id),
                    eq(jobs.leaseToken, sourceJob.leaseToken!),
                ),
            );
        await tx
            .update(connections)
            .set({ lastProcessedAt: now() })
            .where(eq(connections.mailboxId, job.box.id));
    });
    if (fatal) throw fatal;
}
async function finish(job: Claim, error: unknown, exec: DbExec, now: Date) {
    await exec.transaction(async (tx) => {
        if (!(await lockCurrent(tx, job, now))) return;
        const code =
                error instanceof GmailApiError
                    ? error.code
                    : error
                      ? "processing_failed"
                      : null,
            reconnect =
                code === "auth" || code === "scope" || code === "config";
        if (reconnect) {
            await tx
                .update(boxes)
                .set({ enabled: false, version: job.box.version + 1 })
                .where(eq(boxes.id, job.box.id));
            await tx
                .update(deliveries)
                .set({
                    state: "cancelled",
                    errorCode: "mailbox_changed",
                    leaseToken: null,
                    leaseUntil: null,
                })
                .where(
                    and(
                        eq(deliveries.mailboxId, job.box.id),
                        sql`${deliveries.state} IN ('queued','leased')`,
                    ),
                );
        }
        await tx
            .update(connections)
            .set({
                status: reconnect ? "reconnect" : "connected",
                action: nextAction[
                    job.connection.action as keyof typeof nextAction
                ],
                leaseToken: null,
                leaseUntil: null,
                errorCode: code,
                failures: error ? job.connection.failures + 1 : 0,
                nextRunAt: new Date(
                    now.getTime() +
                        (error
                            ? Math.min(
                                  900000,
                                  30000 *
                                      2 ** Math.min(5, job.connection.failures),
                              )
                            : 1500),
                ),
            })
            .where(eq(connections.mailboxId, job.box.id));
    });
}
/** Bounded single phase; injectable transport/clock for isolated tests. Scheduler alone checks deployment flag. */
export async function processGoogleMailQueue(options: Options = {}) {
    const exec = options.exec ?? db,
        now = options.now ?? (() => new Date()),
        job = await claim(exec, now(), options.mailboxId);
    if (!job) return { processed: 0 };
    let error: unknown;
    try {
        const cfg = options.config ?? googleMailConfig();
        if (
            job.connection.clientId !== cfg.clientId ||
            !job.connection.refreshCipher ||
            !job.connection.since
        )
            throw new GmailApiError(
                "config",
                null,
                "메일 연결 설정이 변경되었습니다.",
            );
        let refreshToken: string;
        try {
            refreshToken = openGoogleValue(
                job.connection.refreshCipher,
                `mailbox:${job.box.id}:${job.connection.version}`,
                cfg,
            );
        } catch {
            throw new GmailApiError(
                "config",
                null,
                "메일 연결 암호화 설정을 확인하고 다시 연결해주세요.",
            );
        }
        const actor = await actorFor(job, exec),
            credentials = {
                clientId: cfg.clientId,
                clientSecret: cfg.clientSecret,
                refreshToken,
            },
            client = googleTransport(actor, job.connection.version, exec, now);
        // All provider reads share a phase deadline below the DB lease. Never hold SQL locks across HTTP.
        const phaseStartedAt = Date.now(),
            deadline = AbortSignal.timeout(90000),
            fetchImpl: typeof fetch = (input, init) =>
                (options.fetchImpl ?? fetch)(input, {
                    ...init,
                    signal: AbortSignal.any([
                        deadline,
                        ...(init?.signal ? [init.signal] : []),
                    ]),
                });
        if (job.connection.action === "poll")
            await poll(job, credentials, exec, now, fetchImpl);
        else if (job.connection.action === "receive")
            await receiveOne(job, client, credentials, exec, now, fetchImpl);
        else if (job.connection.action === "files") {
            const result = await retryGmailFiles(
                client,
                {
                    workspaceId: job.box.workspaceId,
                    mailboxId: job.box.id,
                    before: job.connection.fileCursor ?? undefined,
                },
                credentials,
                fetchImpl,
            );
            await exec.transaction(async (tx) => {
                if (await lockCurrent(tx, job, now()))
                    await tx
                        .update(connections)
                        .set({ fileCursor: result.nextCursor ?? null })
                        .where(eq(connections.mailboxId, job.box.id));
            });
        } else
            await deliverGmailReply(
                client,
                job.box.id,
                credentials,
                fetchImpl,
                () => {
                    // Keep a full 30 seconds for the sole provider POST before the shared deadline.
                    if (deadline.aborted || Date.now() - phaseStartedAt > 55000)
                        throw new GmailApiError(
                            "transient",
                            null,
                            "발송 준비 시간이 길어 다음 회차에서 다시 확인합니다.",
                        );
                },
            );
    } catch (e) {
        error = e;
    }
    await finish(job, error, exec, now());
    return { processed: 1, action: job.connection.action, failed: !!error };
}
const runtime = globalThis as typeof globalThis & {
    __sendbGoogleMailTimer?: ReturnType<typeof setTimeout>;
};
export function startGoogleMailScheduler() {
    if (!googleMailWorkerEnabled() || runtime.__sendbGoogleMailTimer) return;
    try {
        googleMailConfig();
    } catch {
        console.error("[inbox-email] Google 메일 연결 설정을 확인해주세요.");
        return;
    }
    const tick = async () => {
        try {
            await processGoogleMailQueue();
        } catch {
            console.error(
                "[inbox-email] 메일 대기열 처리 실패, 다음 회차에서 다시 확인",
            );
        } finally {
            runtime.__sendbGoogleMailTimer = setTimeout(
                () => void tick(),
                1500,
            );
            runtime.__sendbGoogleMailTimer.unref();
        }
    };
    runtime.__sendbGoogleMailTimer = setTimeout(() => void tick(), 1500);
    runtime.__sendbGoogleMailTimer.unref();
}
