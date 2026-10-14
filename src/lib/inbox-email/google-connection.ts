import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
    db,
    inboxMailboxes as boxes,
    inboxGoogleConnections as connections,
    inboxGoogleOauthStates as states,
    inboxGoogleSyncJobs as jobs,
    inboxEmailDeliveries as deliveries,
    organizationMembers,
    users,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import type { JWTPayload } from "@/types";
import { sameRequestOrigin } from "@/lib/inbox/rules";
import { InboxError } from "@/lib/inbox/errors";
import { ownedMailbox } from "./repository";
import { appendInboxAudit } from "@/lib/inbox/audit";
import {
    GOOGLE_MAIL_SCOPES,
    googleMailConfig,
    googleMailWorkerEnabled,
    googleHash,
    sealGoogleValue,
    openGoogleValue,
    type GoogleMailConfig,
} from "./google-config";
type Actor = Pick<JWTPayload, "orgId" | "userId" | "name" | "role">;
export const googleCookieName = (stateHash: string) =>
    `sendb_email_oauth_${stateHash.slice(0, 16)}`;
async function currentAdmin(actor: Actor, exec: DbExec) {
    const [member] = await exec
        .select({ role: organizationMembers.role })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(
            and(
                eq(organizationMembers.organizationId, actor.orgId),
                eq(organizationMembers.userId, actor.userId),
                eq(users.isActive, 1),
            ),
        );
    if (!member || !["admin", "owner"].includes(member.role))
        throw new InboxError(
            "현재 관리자만 Google 연결을 변경할 수 있습니다.",
            403,
        );
}
export async function googleConnectionStatus(
    actor: Actor,
    id: string,
    exec: DbExec = db,
) {
    await ownedMailbox(actor, id, exec);
    const [connection] = await exec
        .select({
            status: connections.status,
            version: connections.version,
            connectedAt: connections.connectedAt,
            since: connections.since,
            phase: connections.phase,
            lastPollAt: connections.lastPollAt,
            lastProcessedAt: connections.lastProcessedAt,
            errorCode: connections.errorCode,
        })
        .from(connections)
        .where(eq(connections.mailboxId, id));
    const [counts] = await exec
        .select({
            pending:
                sql<number>`count(*) FILTER (WHERE ${jobs.state} IN ('pending','processing'))`.mapWith(
                    Number,
                ),
            failed: sql<number>`count(*) FILTER (WHERE ${jobs.state}='failed')`.mapWith(
                Number,
            ),
            done: sql<number>`count(*) FILTER (WHERE ${jobs.state}='done')`.mapWith(
                Number,
            ),
        })
        .from(jobs)
        .where(eq(jobs.mailboxId, id));
    let configured = false;
    try {
        googleMailConfig();
        configured = true;
    } catch {}
    return {
        connection: connection ?? { status: "disconnected", version: 0 },
        counts,
        configured,
        workerEnabled: googleMailWorkerEnabled(),
    };
}
export async function beginGoogleConnection(
    actor: Actor,
    id: string,
    raw: unknown,
    origin: string,
    exec: DbExec = db,
    cfg: GoogleMailConfig = googleMailConfig(),
    now = new Date(),
) {
    const input = z
        .object({
            version: z.number().int().positive(),
            lookbackDays: z.union([z.literal(0), z.literal(7), z.literal(30)]),
        })
        .strict()
        .parse(raw);
    if (!sameRequestOrigin(new URL(cfg.redirectUri).origin, origin))
        throw new InboxError(
            "설정된 Google 연결 주소에서 다시 시도해주세요.",
            403,
        );
    return exec.transaction(async (tx) => {
        await currentAdmin(actor, tx);
        const box = await ownedMailbox(actor, id, tx, true);
        if (box.version !== input.version)
            throw new InboxError(
                "메일함 설정이 변경됐습니다. 새로 불러와주세요.",
                409,
            );
        const state = randomBytes(32).toString("base64url"),
            cookie = randomBytes(32).toString("base64url"),
            stateHash = googleHash(state),
            verifier = randomBytes(32).toString("base64url");
        await tx.insert(states).values({
            stateHash,
            mailboxId: id,
            orgId: actor.orgId,
            actorId: actor.userId,
            mailboxVersion: box.version,
            cookieHash: googleHash(cookie),
            verifierCipher: sealGoogleValue(
                verifier,
                `oauth:${stateHash}`,
                cfg,
            ),
            since: new Date(now.getTime() - input.lookbackDays * 86400000),
            expiresAt: new Date(now.getTime() + 600000),
        });
        const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        url.search = new URLSearchParams({
            client_id: cfg.clientId,
            redirect_uri: cfg.redirectUri,
            response_type: "code",
            scope: GOOGLE_MAIL_SCOPES.join(" "),
            access_type: "offline",
            prompt: "consent",
            state,
            login_hint: box.address,
            code_challenge: Buffer.from(googleHash(verifier), "hex").toString(
                "base64url",
            ),
            code_challenge_method: "S256",
        }).toString();
        return {
            authorizationUrl: url.toString(),
            cookieName: googleCookieName(stateHash),
            cookie,
            expiresAt: new Date(now.getTime() + 600000),
        };
    });
}
async function invalidateMailbox(tx: DbExec, box: typeof boxes.$inferSelect) {
    await tx
        .update(boxes)
        .set({ enabled: false, version: box.version + 1 })
        .where(eq(boxes.id, box.id));
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
                eq(deliveries.mailboxId, box.id),
                sql`${deliveries.state} IN ('queued','leased')`,
            ),
        );
}
export async function finishGoogleConnection(
    actor: Actor,
    input: { state: string; cookie: string; code?: string; error?: string },
    exec: DbExec = db,
    cfg: GoogleMailConfig = googleMailConfig(),
    fetchImpl: typeof fetch = fetch,
    now = new Date(),
) {
    z.string().min(40).max(100).parse(input.state);
    const stateHash = googleHash(input.state);
    const state = await exec.transaction(async (tx) => {
        await currentAdmin(actor, tx);
        const [row] = await tx
            .select()
            .from(states)
            .where(
                and(
                    eq(states.stateHash, stateHash),
                    eq(states.orgId, actor.orgId),
                    eq(states.actorId, actor.userId),
                ),
            )
            .for("update");
        if (
            !row ||
            row.usedAt ||
            row.expiresAt <= now ||
            row.cookieHash !== googleHash(input.cookie)
        )
            throw new InboxError(
                "Google 연결 요청이 만료되거나 다른 브라우저에서 시작됐습니다. 다시 연결해주세요.",
                409,
            );
        await tx
            .update(states)
            .set({ usedAt: now })
            .where(eq(states.stateHash, stateHash));
        return row;
    });
    const box = await ownedMailbox(actor, state.mailboxId, exec);
    if (input.error)
        return {
            channelId: box.channelId,
            mailboxId: box.id,
            result: input.error === "access_denied" ? "cancelled" : "failed",
        };
    if (!input.code || input.code.length > 4096)
        throw new InboxError("Google 승인 코드를 확인해주세요.");
    const response = await fetchImpl("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: cfg.clientId,
            client_secret: cfg.clientSecret,
            code: input.code,
            grant_type: "authorization_code",
            redirect_uri: cfg.redirectUri,
            code_verifier: openGoogleValue(
                state.verifierCipher,
                `oauth:${stateHash}`,
                cfg,
            ),
        }).toString(),
        signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
        throw new InboxError(
            "Google 승인을 확인하지 못했습니다. 다시 연결해주세요.",
            409,
        );
    const token = z
        .object({
            access_token: z.string().min(1).max(8192),
            refresh_token: z.string().min(1).max(8192),
            scope: z.string().max(4000),
        })
        .parse(await response.json());
    if (!GOOGLE_MAIL_SCOPES.every((s) => token.scope.split(/\s+/).includes(s)))
        throw new InboxError(
            "메일 읽기와 답장 발송 권한을 모두 승인해주세요.",
            409,
        );
    const profileResponse = await fetchImpl(
        "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        {
            headers: { authorization: `Bearer ${token.access_token}` },
            signal: AbortSignal.timeout(15000),
        },
    );
    if (!profileResponse.ok)
        throw new InboxError("연결한 Gmail 계정을 확인하지 못했습니다.", 409);
    const profile = z
        .object({
            emailAddress: z.email(),
            historyId: z.string().regex(/^\d{1,128}$/),
        })
        .parse(await profileResponse.json());
    if (profile.emailAddress.toLowerCase() !== box.address)
        throw new InboxError(
            "등록한 메일 주소와 Google 계정이 다릅니다. 같은 계정을 선택해주세요.",
            409,
        );
    return exec.transaction(async (tx) => {
        await currentAdmin(actor, tx);
        const locked = await ownedMailbox(actor, box.id, tx, true);
        if (locked.version !== state.mailboxVersion)
            throw new InboxError(
                "승인하는 동안 메일함 설정이 변경됐습니다. 다시 연결해주세요.",
                409,
            );
        const [old] = await tx
                .select()
                .from(connections)
                .where(eq(connections.mailboxId, box.id))
                .for("update"),
            version = (old?.version ?? 0) + 1;
        await invalidateMailbox(tx, locked);
        const saved = {
            version,
            status: "connected",
            clientId: cfg.clientId,
            refreshCipher: sealGoogleValue(
                token.refresh_token,
                `mailbox:${box.id}:${version}`,
                cfg,
            ),
            connectedBy: actor.userId,
            connectedAt: now,
            since: state.since,
            phase: "full",
            historyId: null,
            baselineHistoryId: profile.historyId,
            pageToken: null,
            action: "poll",
            fileCursor: null,
            leaseToken: null,
            leaseUntil: null,
            nextRunAt: now,
            lastPollAt: null,
            lastProcessedAt: null,
            errorCode: null,
            failures: 0,
        };
        await tx
            .insert(connections)
            .values({ mailboxId: box.id, ...saved })
            .onConflictDoUpdate({ target: connections.mailboxId, set: saved });
        await tx
            .update(jobs)
            .set({
                connectionVersion: version,
                state: "pending",
                attempts: 0,
                reasonCode: null,
                leaseToken: null,
                leaseUntil: null,
                eligibleAt: now,
                updatedAt: now,
            })
            .where(
                and(
                    eq(jobs.mailboxId, box.id),
                    sql`${jobs.state} IN ('pending','processing','failed','skipped')`,
                ),
            );
        await appendInboxAudit(tx, {
            orgId: actor.orgId,
            channelId: box.channelId,
            actorId: actor.userId,
            actorName: actor.name,
            action: "email.google.connected",
            changes: {
                connection: {
                    before: old
                        ? { status: old.status, version: old.version }
                        : null,
                    after: {
                        status: "connected",
                        version,
                        since: state.since,
                        enabled: false,
                    },
                },
            },
        });
        return {
            channelId: box.channelId,
            mailboxId: box.id,
            result: "connected",
        };
    });
}
export async function disconnectGoogle(
    actor: Actor,
    id: string,
    version: number,
    exec: DbExec = db,
) {
    return exec.transaction(async (tx) => {
        await currentAdmin(actor, tx);
        const box = await ownedMailbox(actor, id, tx, true),
            [connection] = await tx
                .select()
                .from(connections)
                .where(eq(connections.mailboxId, id))
                .for("update");
        if (!connection || connection.version !== version)
            throw new InboxError("Google 연결 정보가 변경됐습니다.", 409);
        await invalidateMailbox(tx, box);
        await tx
            .update(connections)
            .set({
                version: version + 1,
                status: "disconnected",
                refreshCipher: null,
                leaseToken: null,
                leaseUntil: null,
                errorCode: null,
            })
            .where(eq(connections.mailboxId, id));
        await appendInboxAudit(tx, {
            orgId: actor.orgId,
            channelId: box.channelId,
            actorId: actor.userId,
            actorName: actor.name,
            action: "email.google.disconnected",
            changes: {
                connection: {
                    before: { status: connection.status, version },
                    after: { status: "disconnected", version: version + 1 },
                },
            },
        });
        return { disconnected: true };
    });
}
export async function retryGoogleJobs(
    actor: Actor,
    id: string,
    exec: DbExec = db,
) {
    return exec.transaction(async (tx) => {
        await currentAdmin(actor, tx);
        await ownedMailbox(actor, id, tx, true);
        const [c] = await tx
            .select()
            .from(connections)
            .where(eq(connections.mailboxId, id));
        if (!c || c.status !== "connected")
            throw new InboxError("Google 계정을 다시 연결해주세요.", 409);
        const rows = await tx
            .update(jobs)
            .set({
                state: "pending",
                attempts: 0,
                reasonCode: null,
                leaseToken: null,
                leaseUntil: null,
                eligibleAt: new Date(),
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(jobs.mailboxId, id),
                    eq(jobs.connectionVersion, c.version),
                    eq(jobs.state, "failed"),
                ),
            )
            .returning({ id: jobs.id });
        await tx
            .update(connections)
            .set({ nextRunAt: new Date() })
            .where(eq(connections.mailboxId, id));
        return { retried: rows.length };
    });
}
