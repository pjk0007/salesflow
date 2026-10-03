import { NextRequest, NextResponse } from "next/server";
import { db, emailSenderProfiles } from "@/lib/db";
import { eq, and, ne } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { requireAdmin } from "@/lib/auth-admin";
import { kstParts } from "@/lib/kst";
import { pickLimitPatch } from "@/lib/email-sender-limit";
import { toLimitSettings, validateLimitSettings } from "@/lib/email-sender-limit-rules";
import type { SenderLimitSettings } from "@/lib/email-sender-limit-rules";
import {
    restartedWarmupStartedOn,
    senderProfileChangeNeedsAdmin,
    senderProfileDeleteNeedsAdmin,
} from "@/lib/email-sender-limit-paths";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const { id } = await params;
        const profileId = parseInt(id);
        const body = await req.json();
        const { name, fromName, fromEmail, isDefault } = body;

        // 한도는 하루 발송량을 바꾸는 설정이라 관리자만 바꾼다. 이름·주소만 고치는 예전 화면은 그대로 둔다
        const limitPatch = pickLimitPatch(body);
        if (limitPatch) {
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
                updatedAt: new Date(),
            })
            .where(eq(emailSenderProfiles.id, profileId))
            .returning();

        return NextResponse.json({ success: true, data: updated });
    } catch (error) {
        console.error("Sender profile update error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = getUserFromNextRequest(req);
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
