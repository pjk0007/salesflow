import { NextRequest, NextResponse } from "next/server";
import { db, emailConfigs, emailSenderProfiles } from "@/lib/db";
import { eq, and, ne } from "drizzle-orm";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { requireAdmin } from "@/lib/auth-admin";
import { kstParts } from "@/lib/kst";
import { pickHealthPatch, pickLimitPatch } from "@/lib/email-sender-limit";
import { shiftWarmupStart, toLimitSettings, validateLimitSettings } from "@/lib/email-sender-limit-rules";
import type { SenderLimitSettings } from "@/lib/email-sender-limit-rules";
import {
    restartedWarmupStartedOn,
    senderProfileChangeNeedsAdmin,
    senderProfileDeleteNeedsAdmin,
} from "@/lib/email-sender-limit-paths";
import { releaseSenderPause, senderWorkspaceIds } from "@/lib/partition-hold";
import type { ReleaseSenderResult } from "@/lib/partition-hold";
import { notifyRelease } from "@/lib/sender-health";
import { newSenderDomainNeedsAdmin } from "@/lib/email-reply-rules";
import { isReplyScopeOrg } from "@/lib/email-reply-list";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const { id } = await params;
        const profileId = parseInt(id);
        const body = await req.json();
        const { name, fromName, fromEmail, isDefault } = body;

        // 한도는 하루 발송량을 바꾸는 설정이라 관리자만 바꾼다. 이름·주소만 고치는 예전 화면은 그대로 둔다.
        // 발신 건강 조치 방식(healthAction)도 한도 칸처럼 관리자만 (DESIGN-SND 9절 pickHealthPatch)
        const limitPatch = pickLimitPatch(body);
        const healthPatch = pickHealthPatch(body);
        if (healthPatch && !healthPatch.ok) {
            return NextResponse.json({ success: false, error: healthPatch.error }, { status: 400 });
        }
        if (limitPatch || healthPatch) {
            const auth = await requireAdmin(req);
            if (!auth.ok) {
                return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
            }
        }

        // 소유권 확인
        const [existing] = await db
            .select()
            .from(emailSenderProfiles)
            .where(and(
                eq(emailSenderProfiles.id, profileId),
                eq(emailSenderProfiles.orgId, user.orgId)
            ));

        if (!existing) {
            return NextResponse.json({ success: false, error: "프로필을 찾을 수 없습니다." }, { status: 404 });
        }

        const currentLimits = toLimitSettings(existing);
        const nextFromEmail = fromEmail !== undefined ? String(fromEmail) : undefined;

        // 한도 칸이 없어도 주소를 바꾸면 한도를 피해 갈 수 있다 — 한도가 걸린 주소를 바꾸거나,
        // 한도가 걸린 다른 프로필과 같은 주소로 바꾸는 것은 관리자만 (한도 칸이 있으면 위에서 이미 확인했다)
        if (!limitPatch && nextFromEmail !== undefined) {
            const others = await db
                .select()
                .from(emailSenderProfiles)
                .where(and(eq(emailSenderProfiles.orgId, user.orgId), ne(emailSenderProfiles.id, profileId)));
            const reason = senderProfileChangeNeedsAdmin({
                current: { fromEmail: existing.fromEmail, limits: currentLimits },
                nextFromEmail,
                others: others.map((p) => ({ fromEmail: p.fromEmail, limits: toLimitSettings(p) })),
            });
            if (reason) {
                const auth = await requireAdmin(req);
                if (!auth.ok) {
                    const error = auth.status === 403 ? reason : auth.error;
                    return NextResponse.json({ success: false, error }, { status: auth.status });
                }
            } else {
                // 회신 읽기 대상 조직에서 처음 쓰는 발신 도메인으로 바꾸는 것은 관리자만 (RH-SEC-2)
                const configs = await db.select({ fromEmail: emailConfigs.fromEmail }).from(emailConfigs).where(eq(emailConfigs.orgId, user.orgId));
                const domainReason = newSenderDomainNeedsAdmin({
                    nextFromEmail,
                    currentFromEmail: existing.fromEmail,
                    knownEmails: [...others.map((p) => p.fromEmail), ...configs.map((c) => c.fromEmail)],
                });
                if (domainReason && (await isReplyScopeOrg(user.orgId))) {
                    const auth = await requireAdmin(req);
                    if (!auth.ok) {
                        const error = auth.status === 403 ? domainReason : auth.error;
                        return NextResponse.json({ success: false, error }, { status: auth.status });
                    }
                }
            }
        }

        // 보낸 칸만이 아니라 현재 값과 합친 결과를 검증한다 — 시작 시각만 바꿔 끝보다 늦어지는 경우를 막는다.
        // 웜업 시작일은 서버가 정한다 (꺼짐 → 켜짐이면 오늘 KST). 기본 주소 해제보다 먼저 해야 오류 때 아무것도 바뀌지 않는다
        const todayYmd = kstParts(new Date()).date;
        let limits: SenderLimitSettings | null = null;
        if (limitPatch) {
            const checked = validateLimitSettings(limitPatch, currentLimits, todayYmd);
            if (!checked.ok) {
                return NextResponse.json({ success: false, error: checked.error }, { status: 400 });
            }
            limits = checked.value;
        }

        // 정지 스위치 (DESIGN-SND 6-3·6-5): 켜면 사람이 멈춘 것으로 적는다. 자동으로 멈춘 주소를 끄면 풀기 API와 같은 기록
        // (health_reset_at·웜업 시작일 미루기 — releaseSenderPause 한 함수)을 남긴다. 손으로 멈춘 주소를 끄면 멈춤 칸을 비우고
        // 웜업 시작일은 자동 해제와 같은 규칙(shiftWarmupStart)으로 멈춘 기간만큼 미룬다 (UX-138)
        const pausing = !!limits && limits.isPaused && !existing.isPaused;
        const unpausing = !!limits && !limits.isPaused && existing.isPaused;
        let autoRelease: ReleaseSenderResult | null = null;
        if (unpausing && existing.pausedSource === "auto") {
            autoRelease = await releaseSenderPause(user.orgId, profileId);
            // 이 요청이 웜업을 다시 시작하지 않았으면 미룬 시작일을 지킨다 (아래 update가 예전 시작일로 덮지 않게)
            if (autoRelease.ok && limits && limits.warmupStartedOn === currentLimits.warmupStartedOn) {
                limits = { ...limits, warmupStartedOn: autoRelease.warmupStartedOn };
            }
        }

        if (unpausing && !autoRelease && limits && limits.warmupStartedOn === currentLimits.warmupStartedOn) {
            const pausedAt = existing.pausedAt ? new Date(existing.pausedAt) : null;
            const pausedOn = pausedAt && Number.isFinite(pausedAt.getTime()) ? kstParts(pausedAt).date : null;
            limits = { ...limits, warmupStartedOn: shiftWarmupStart(limits, pausedOn, todayYmd) };
        }

        // 주소를 바꾸면 웜업을 오늘 0일째부터 다시 센다 — 이전 주소의 웜업 날수가 처음 쓰는 주소로 넘어가면 안 된다
        const restartedOn = nextFromEmail !== undefined
            ? restartedWarmupStartedOn(existing.fromEmail, nextFromEmail, limits ?? currentLimits, todayYmd)
            : null;

        // 기본 프로필로 설정 시 다른 것들 해제
        if (isDefault) {
            await db
                .update(emailSenderProfiles)
                .set({ isDefault: false, updatedAt: new Date() })
                .where(and(
                    eq(emailSenderProfiles.orgId, user.orgId),
                    ne(emailSenderProfiles.id, profileId)
                ));
        }

        const [updated] = await db
            .update(emailSenderProfiles)
            .set({
                ...(name !== undefined && { name: name.trim() }),
                ...(fromName !== undefined && { fromName: fromName.trim() }),
                ...(fromEmail !== undefined && { fromEmail: fromEmail.trim().toLowerCase() }),
                ...(isDefault !== undefined && { isDefault }),
                ...(limits ?? {}),
                ...(restartedOn !== null && { warmupStartedOn: restartedOn }),
                ...(pausing && { pausedSource: "manual", pausedAt: new Date(), pausedReason: null }),
                ...(unpausing && !autoRelease && { pausedSource: null, pausedAt: null, pausedReason: null }),
                ...(healthPatch?.ok ? healthPatch.value : {}),
                updatedAt: new Date(),
            })
            .where(eq(emailSenderProfiles.id, profileId))
            .returning();

        if (autoRelease?.ok) {
            await notifyRelease({
                orgId: user.orgId,
                kind: "sender",
                entityId: profileId,
                workspaceIds: await senderWorkspaceIds(user.orgId, profileId, autoRelease.pausedAt),
                name: autoRelease.fromEmail,
                releasedAt: autoRelease.releasedAt,
                actorUserId: user.userId,
                actorName: user.name ?? null,
                // 사람이 쓴 메모가 아니라 풀린 경로다 (HR-9)
                note: null,
                via: "settings",
                todayCap: autoRelease.todayCap,
                warmupDay: autoRelease.warmupDay,
            });
        }

        return NextResponse.json({ success: true, data: updated });
    } catch (error) {
        console.error("Sender profile update error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const { id } = await params;
        const profileId = parseInt(id);

        const [existing] = await db
            .select()
            .from(emailSenderProfiles)
            .where(and(
                eq(emailSenderProfiles.id, profileId),
                eq(emailSenderProfiles.orgId, user.orgId)
            ));

        if (!existing) {
            return NextResponse.json({ success: false, error: "프로필을 찾을 수 없습니다." }, { status: 404 });
        }

        // 정지·한도가 걸린 주소를 지우면 그 주소만 묶은 규칙이 기본 주소로 흘러 바로 나간다 — 관리자만 지운다
        const deleteReason = senderProfileDeleteNeedsAdmin(toLimitSettings(existing));
        if (deleteReason) {
            const auth = await requireAdmin(req);
            if (!auth.ok) {
                const error = auth.status === 403 ? deleteReason : auth.error;
                return NextResponse.json({ success: false, error }, { status: auth.status });
            }
        }

        await db.delete(emailSenderProfiles).where(eq(emailSenderProfiles.id, profileId));

        // 삭제한 게 기본이었으면 남은 첫 번째를 기본으로
        if (existing.isDefault) {
            const [first] = await db
                .select({ id: emailSenderProfiles.id })
                .from(emailSenderProfiles)
                .where(eq(emailSenderProfiles.orgId, user.orgId))
                .orderBy(emailSenderProfiles.createdAt)
                .limit(1);

            if (first) {
                await db
                    .update(emailSenderProfiles)
                    .set({ isDefault: true, updatedAt: new Date() })
                    .where(eq(emailSenderProfiles.id, first.id));
            }
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Sender profile delete error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
