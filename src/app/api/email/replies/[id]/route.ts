import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { getReplyForUser } from "@/lib/email-reply-list";
import { claimReplyEffects, stopAutomationForReply } from "@/lib/email-reply-effects";
import { REPLY_KINDS, describeReplyError, resolveReplyConfig, type ReplyKind } from "@/lib/email-reply-rules";

/**
 * 회신 하나 고치기 (DESIGN-RPL 10-3) — [처리함]·[분류 고치기]·[자동 메일 다시 허용].
 * 본문: { handled?: boolean, kind?: human|auto_reply|bounce|system|internal|unknown, stopAutomation?: boolean }
 *
 * - kind를 사람으로 바꾸면 (on, 이어진 줄) effects_applied_kind가 human이 아닐 때 7-2(멈춤·레코드 사건)를 그 자리에서 적용한다 (M5, R54).
 *   멈춤은 pending·held만 바꾸고 사건은 meta.replyId가 있으면 넣지 않으므로 여러 번 고쳐도 한 번이다.
 * - 사람에서 다른 것으로 바꾸면 보내기 직전 막기에서만 빠진다 (멈춘 줄은 그대로). 반송으로 바꿔도 SND 신호는 만들지 않는다.
 * - stopAutomation=false("자동 메일 다시 허용")는 앞으로의 막기만 푼다 — 멈춘 줄은 살아나지 않는다 (R27)
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const { id } = await params;
        const replyId = Number(id);
        if (!Number.isSafeInteger(replyId) || replyId <= 0) {
            return NextResponse.json({ success: false, error: "유효하지 않은 ID입니다." }, { status: 400 });
        }

        let body: { handled?: unknown; kind?: unknown; stopAutomation?: unknown };
        try {
            body = (await req.json()) as typeof body;
        } catch {
            return NextResponse.json({ success: false, error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
        }
        if (body.handled !== undefined && typeof body.handled !== "boolean") {
            return NextResponse.json({ success: false, error: "handled 값이 올바르지 않습니다." }, { status: 400 });
        }
        if (body.stopAutomation !== undefined && typeof body.stopAutomation !== "boolean") {
            return NextResponse.json({ success: false, error: "stopAutomation 값이 올바르지 않습니다." }, { status: 400 });
        }
        if (body.kind !== undefined && !(typeof body.kind === "string" && (REPLY_KINDS as readonly string[]).includes(body.kind))) {
            return NextResponse.json({ success: false, error: "분류 값이 올바르지 않습니다." }, { status: 400 });
        }
        if (body.handled === undefined && body.stopAutomation === undefined && body.kind === undefined) {
            return NextResponse.json({ success: false, error: "바꿀 값이 없습니다." }, { status: 400 });
        }

        // 같은 권한 확인 (목록과 같다 — 볼 수 없는 회신은 404)
        const reply = await getReplyForUser(user, replyId);
        if (!reply) {
            return NextResponse.json({ success: false, error: "회신을 찾을 수 없습니다." }, { status: 404 });
        }

        const nextKind = body.kind as ReplyKind | undefined;
        const config = resolveReplyConfig(process.env);
        let effectsApplied: { followups: number; automation: number; sendQueue: number; recordEventId: number | null } | null = null;

        await db.transaction(async (tx) => {
            if (body.handled !== undefined) {
                await tx.execute(sql`
                    UPDATE email_replies
                    SET handled_by = ${body.handled ? user.userId : null}::uuid,
                        handled_at = ${body.handled ? sql`now()` : sql`NULL`}
                    WHERE id = ${replyId}::int AND org_id = ${user.orgId}::uuid
                `);
            }
            if (body.stopAutomation !== undefined) {
                await tx.execute(sql`
                    UPDATE email_replies SET stop_automation = ${body.stopAutomation}
                    WHERE id = ${replyId}::int AND org_id = ${user.orgId}::uuid
                `);
            }
            if (nextKind !== undefined && nextKind !== reply.kind) {
                await tx.execute(sql`
                    UPDATE email_replies SET kind = ${nextKind}, kind_changed_by = ${user.userId}::uuid, kind_changed_at = now()
                    WHERE id = ${replyId}::int AND org_id = ${user.orgId}::uuid
                `);
            }
            // 사람으로 고쳤으면 고친 분류로 조치가 다시 돈다 (RPL-2 수용 3) — on·이어진 줄만
            if (
                nextKind === "human" &&
                config.syncMode === "on" &&
                reply.matchStatus === "matched" &&
                reply.workspaceId !== null &&
                (await claimReplyEffects(tx, replyId, "human", "reclassify"))
            ) {
                const res = await stopAutomationForReply(
                    tx,
                    {
                        id: replyId,
                        kind: "human",
                        matchStatus: "matched",
                        orgId: user.orgId,
                        workspaceId: reply.workspaceId,
                        recordId: reply.recordId,
                        contactEmail: reply.contactEmail,
                        matchedRecipient: reply.matchedRecipient,
                        receivedAt: reply.receivedAt,
                        sendLogId: reply.sendLogId,
                        ruleKind: reply.ruleKind,
                        ruleId: reply.ruleId,
                        stepIndex: reply.stepIndex,
                    },
                    { dryRun: false }
                );
                effectsApplied = res;
                await tx.execute(sql`
                    UPDATE email_replies
                    SET effects = COALESCE(effects, '{}'::jsonb) || ${JSON.stringify({
                        reclassified: true,
                        followupsCancelled: res.followups,
                        automationCancelled: res.automation,
                        sendQueueSkipped: res.sendQueue,
                        recordEventId: res.recordEventId,
                    })}::jsonb
                    WHERE id = ${replyId}::int
                `);
            }
        });

        const updated = await getReplyForUser(user, replyId);
        return NextResponse.json({ success: true, data: updated, meta: { effectsApplied } });
    } catch (error) {
        console.error("[replies] patch error:", describeReplyError(error));
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
