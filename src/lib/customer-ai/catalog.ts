import {
    requireCustomerAccess,
    customerAccessPredicate,
} from "@/lib/customer-access/access";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import {
    db,
    customerAiSettings as settings,
    customerAiSettingsHistory as history,
    aiCopyKnowledgeVersions as knowledge,
    workspaces,
    organizationMembers,
    users,
    queryClient,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import type { SalesActor } from "@/lib/customer-platform/sales-repository";
import { InboxError } from "@/lib/inbox/errors";
import { AI_MODELS } from "@/lib/ai/models";
import { getAiClient } from "@/lib/ai/client";
import {
    createKnowledgeVersion,
    approveKnowledge,
    blockVersion,
} from "@/lib/ai-copy/versions";
import { CopyActionError } from "@/lib/ai-copy/errors";
import type { CopyConnection } from "@/lib/ai-copy/types";
import {
    aiSettingsInput,
    defaultAiSettings,
    type AiSettingsSnapshot,
    type AiSource,
} from "./rules";
import { supportWorkerEnabled } from "./worker-policy";
export const aiWorkerEnabled = (workspaceId?: number) =>
    supportWorkerEnabled(process.env, workspaceId);
export async function getSupportSettings(
    orgId: string,
    workspaceId: number,
    exec: DbExec = db,
    lock = false,
): Promise<AiSettingsSnapshot> {
    const query = exec
        .select()
        .from(settings)
        .where(
            and(
                eq(settings.orgId, orgId),
                eq(settings.workspaceId, workspaceId),
            ),
        );
    const [row] = lock ? await query.for("share") : await query;
    return row
        ? aiSettingsInput.parse({
              version: row.version,
              mode: row.mode,
              knowledgeVersionId: row.knowledgeVersionId,
              model: row.model,
              instructions: row.instructions,
              handoffAssigneeId: row.handoffAssigneeId,
              handoffMessage: row.handoffMessage,
              maxJobsPerDay: row.maxJobsPerDay,
          })
        : { ...defaultAiSettings };
}
export async function chatKnowledge(
    orgId: string,
    workspaceId: number,
    id: number | null,
    exec: DbExec = db,
    now = new Date(),
    lock = false,
) {
    if (!id) return { version: null, sources: [] as AiSource[] };
    const query = exec
        .select()
        .from(knowledge)
        .where(
            and(
                eq(knowledge.id, id),
                eq(knowledge.orgId, orgId),
                eq(knowledge.workspaceId, workspaceId),
            ),
        );
    const [version] = lock ? await query.for("share") : await query;
    if (!version || version.state !== "approved")
        return { version: null, sources: [] as AiSource[] };
    const sources = version.snapshot.claims.flatMap((c, index) =>
        c.purposes.includes("customer_chat") &&
        Date.parse(c.checkedAt) <= now.getTime() &&
        now.getTime() - Date.parse(c.checkedAt) <= 90 * 86400000
            ? [
                  {
                      id: `knowledge:${version.id}:claim:${index}`,
                      text: c.text,
                      sourceUrl: c.sourceUrl,
                      checkedAt: c.checkedAt,
                      knowledgeVersionId: version.id,
                      fingerprint: version.fingerprint,
                  },
              ]
            : [],
    );
    return { version, sources };
}
export async function supportCatalog(
    actor: SalesActor,
    workspaceId: number,
    exec: DbExec = db,
) {
    await requireCustomerAccess(actor, workspaceId, "read", exec);
    const config = await getSupportSettings(actor.orgId, workspaceId, exec),
        versions = await exec
            .select()
            .from(knowledge)
            .where(
                and(
                    eq(knowledge.orgId, actor.orgId),
                    eq(knowledge.workspaceId, workspaceId),
                ),
            )
            .orderBy(desc(knowledge.id))
            .limit(100),
        events = await exec
            .select()
            .from(history)
            .where(
                and(
                    eq(history.orgId, actor.orgId),
                    eq(history.workspaceId, workspaceId),
                ),
            )
            .orderBy(desc(history.createdAt), desc(history.id))
            .limit(100);
    if (
        config.knowledgeVersionId &&
        !versions.some((v) => v.id === config.knowledgeVersionId)
    ) {
        const [bound] = await exec
            .select()
            .from(knowledge)
            .where(
                and(
                    eq(knowledge.id, config.knowledgeVersionId),
                    eq(knowledge.orgId, actor.orgId),
                    eq(knowledge.workspaceId, workspaceId),
                ),
            );
        if (bound) versions.push(bound);
    }
    const now = Date.now();
    return {
        settings: config,
        knowledge: versions.map((v) => ({
            id: v.id,
            name: v.name,
            state: v.state,
            fingerprint: v.fingerprint,
            claims: v.snapshot.claims.filter(
                (c) =>
                    c.purposes.includes("customer_chat") &&
                    Date.parse(c.checkedAt) <= now &&
                    now - Date.parse(c.checkedAt) <= 90 * 86400000,
            ).length,
            approvedAt: v.approvedAt,
        })),
        history: events,
        models: AI_MODELS.map((m) => ({
            ...m,
            configured: !!getAiClient(m.id),
        })),
        workerEnabled: aiWorkerEnabled(workspaceId),
    };
}
export async function saveSupportSettings(
    actor: SalesActor,
    workspaceId: number,
    raw: unknown,
    exec: DbExec = db,
) {
    const input = aiSettingsInput.parse(raw);
    await requireCustomerAccess(actor, workspaceId, "manage", exec);
    return exec.transaction(async (tx) => {
        await tx
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(eq(workspaces.id, workspaceId))
            .for("update");
        const current = await getSupportSettings(actor.orgId, workspaceId, tx);
        if (input.version !== current.version)
            throw new InboxError(
                "AI 설정이 변경되었습니다. 최신 설정을 불러온 뒤 저장해주세요.",
                409,
            );
        if (input.knowledgeVersionId) {
            const facts = await chatKnowledge(
                actor.orgId,
                workspaceId,
                input.knowledgeVersionId,
                tx,
            );
            if (!facts.version || !facts.sources.length)
                throw new InboxError(
                    "같은 사업의 승인된 고객 상담 지식이 필요합니다. 확인일은 최근 90일 이내여야 합니다.",
                );
        }
        if (
            input.mode !== "manual" &&
            (!input.knowledgeVersionId || !getAiClient(input.model))
        )
            throw new InboxError(
                "자동 생성 전 승인 지식과 AI 모델 연결을 준비해주세요.",
            );
        if (input.handoffAssigneeId) {
            const [member] = await tx
                .select({ id: users.id })
                .from(users)
                .innerJoin(
                    organizationMembers,
                    eq(organizationMembers.userId, users.id),
                )
                .where(
                    and(
                        eq(users.id, input.handoffAssigneeId),
                        eq(users.isActive, 1),
                        eq(organizationMembers.organizationId, actor.orgId),
                        customerAccessPredicate(
                            actor.orgId,
                            users.id,
                            sql`${workspaceId}`,
                            "respond",
                        ),
                    ),
                );
            if (!member)
                throw new InboxError("같은 조직의 활성 담당자를 선택해주세요.");
        }
        const snapshot = { ...input, version: current.version + 1 };
        await tx
            .insert(settings)
            .values({
                ...snapshot,
                workspaceId,
                orgId: actor.orgId,
                changedBy: actor.userId,
            })
            .onConflictDoUpdate({
                target: settings.workspaceId,
                set: {
                    ...snapshot,
                    changedBy: actor.userId,
                    updatedAt: new Date(),
                },
            });
        await tx.insert(history).values({
            orgId: actor.orgId,
            workspaceId,
            version: snapshot.version,
            actorName: actor.name,
            snapshot,
        });
        return snapshot;
    });
}
export async function listSupportKnowledge(
    actor: SalesActor,
    workspaceId: number,
    before?: number,
    exec: DbExec = db,
) {
    await requireCustomerAccess(actor, workspaceId, "read", exec);
    const rows = await exec
        .select()
        .from(knowledge)
        .where(
            and(
                eq(knowledge.orgId, actor.orgId),
                eq(knowledge.workspaceId, workspaceId),
                before ? lt(knowledge.id, before) : undefined,
            ),
        )
        .orderBy(desc(knowledge.id))
        .limit(50);
    return {
        rows: rows.map((v) => ({
            ...v,
            workspace_id: v.workspaceId,
            created_by: v.createdBy,
            created_at: v.createdAt,
            last_changed_at: v.lastChangedAt,
            last_changed_by: v.lastChangedBy,
            state_reason: v.stateReason,
        })),
        hasMore: rows.length === 50,
    };
}
export async function manageSupportKnowledge(
    actor: SalesActor,
    workspaceId: number,
    input: {
        action: "create" | "approve" | "block";
        id?: number;
        name?: string;
        snapshot?: unknown;
        reason?: string;
    },
    exec: DbExec = db,
    provided?: CopyConnection,
) {
    await requireCustomerAccess(actor, workspaceId, "manage", exec);
    if (input.action !== "create") {
        const [owned] = await exec
            .select({ id: knowledge.id })
            .from(knowledge)
            .where(
                and(
                    eq(knowledge.id, input.id!),
                    eq(knowledge.orgId, actor.orgId),
                    eq(knowledge.workspaceId, workspaceId),
                ),
            );
        if (!owned) throw new InboxError("지식 버전을 찾을 수 없습니다.", 404);
    }
    const conn = provided ?? (await queryClient.reserve());
    try {
        if (input.action === "create")
            return createKnowledgeVersion(conn, {
                orgId: actor.orgId,
                workspaceId,
                userId: actor.userId,
                name: input.name!,
                snapshot: input.snapshot,
            });
        if (input.action === "approve") {
            await approveKnowledge(conn, {
                orgId: actor.orgId,
                id: input.id!,
                userId: actor.userId,
                now: new Date(),
            });
            return { approved: true };
        }
        return blockVersion(conn, {
            orgId: actor.orgId,
            userId: actor.userId,
            id: input.id!,
            kind: "knowledge",
            reason: input.reason ?? "",
        });
    } catch (error) {
        if (error instanceof CopyActionError)
            throw new InboxError(error.message);
        throw error;
    } finally {
        if (!provided) conn.release();
    }
}
