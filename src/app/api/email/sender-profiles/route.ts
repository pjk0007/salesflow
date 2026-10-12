import { NextRequest, NextResponse } from "next/server";
import { db, emailConfigs, emailSenderProfiles } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { requireAdmin } from "@/lib/auth-admin";
import { kstParts } from "@/lib/kst";
import { pickLimitPatch } from "@/lib/email-sender-limit";
import { DEFAULT_LIMIT_SETTINGS, toLimitSettings, validateLimitSettings } from "@/lib/email-sender-limit-rules";
import { senderProfileChangeNeedsAdmin } from "@/lib/email-sender-limit-paths";
import { newSenderDomainNeedsAdmin } from "@/lib/email-reply-rules";
import { isReplyScopeOrg } from "@/lib/email-reply-list";
import type { SenderLimitSettings } from "@/lib/email-sender-limit-rules";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        // 전체 칸을 돌려준다 — 한도·웜업 칸도 함께 나간다 (설정 화면이 그대로 채운다)
        const profiles = await db
            .select()
            .from(emailSenderProfiles)
            .where(eq(emailSenderProfiles.orgId, user.orgId))
            .orderBy(emailSenderProfiles.createdAt);

        return NextResponse.json({ success: true, data: profiles });
    } catch (error) {
        console.error("Sender profiles fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { name, fromName, fromEmail } = body;

        // 한도는 하루 발송량을 바꾸는 설정이라 관리자만 정한다. 한도 칸 없이 만드는 예전 화면은 그대로 둔다
        const limitPatch = pickLimitPatch(body);
        if (limitPatch) {
            const auth = await requireAdmin(req);
            if (!auth.ok) {
                return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
            }
        }

        if (!name || !fromName || !fromEmail) {
            return NextResponse.json({ success: false, error: "이름, 발신자명, 발신 이메일은 필수입니다." }, { status: 400 });
        }

        // 새 주소는 "전부 꺼짐"에서 시작한다 — 웜업을 켜서 만들면 시작일이 오늘(KST)로 잡힌다
        let limits: SenderLimitSettings | null = null;
        if (limitPatch) {
            const checked = validateLimitSettings(limitPatch, DEFAULT_LIMIT_SETTINGS, kstParts(new Date()).date);
            if (!checked.ok) {
                return NextResponse.json({ success: false, error: checked.error }, { status: 400 });
            }
            limits = checked.value;
        }

        // 같은 조직의 주소들 (한도 칸 포함) — 첫 프로필인지, 같은 주소에 한도가 걸려 있는지 본다
        const existing = await db
            .select()
            .from(emailSenderProfiles)
            .where(eq(emailSenderProfiles.orgId, user.orgId));

        // 한도가 걸린 주소와 같은 주소로 한도 없는 프로필을 더 만들면 한도를 피해 간다 — 그때는 관리자만
        let adminChecked = !!limitPatch;
        if (!adminChecked) {
            const reason = senderProfileChangeNeedsAdmin({
                current: null,
                nextFromEmail: String(fromEmail),
                others: existing.map((p) => ({ fromEmail: p.fromEmail, limits: toLimitSettings(p) })),
            });
            if (reason) {
                const auth = await requireAdmin(req);
                if (!auth.ok) {
                    const error = auth.status === 403 ? reason : auth.error;
                    return NextResponse.json({ success: false, error }, { status: auth.status });
                }
                adminChecked = true;
            }
        }

        // 회신 읽기 대상 조직에서 처음 쓰는 발신 도메인은 관리자만 (RH-SEC-2) — 발신 주소 앞으로 온 메일을 대표 메일함에서 읽는다
        if (!adminChecked) {
            const configs = await db.select({ fromEmail: emailConfigs.fromEmail }).from(emailConfigs).where(eq(emailConfigs.orgId, user.orgId));
            const reason = newSenderDomainNeedsAdmin({
                nextFromEmail: String(fromEmail),
                currentFromEmail: null,
                knownEmails: [...existing.map((p) => p.fromEmail), ...configs.map((c) => c.fromEmail)],
            });
            if (reason && (await isReplyScopeOrg(user.orgId))) {
                const auth = await requireAdmin(req);
                if (!auth.ok) {
                    const error = auth.status === 403 ? reason : auth.error;
                    return NextResponse.json({ success: false, error }, { status: auth.status });
                }
            }
        }

        // 첫 프로필이면 isDefault=true
        const isDefault = existing.length === 0;

        const [profile] = await db
            .insert(emailSenderProfiles)
            .values({
                orgId: user.orgId,
                name: name.trim(),
                fromName: fromName.trim(),
                fromEmail: fromEmail.trim().toLowerCase(),
                isDefault,
                ...(limits ?? {}),
                // 멈춘 채로 만들면 사람이 멈춘 것이다 (DESIGN-SND 6-3 — 자동 멈춤과 가른다)
                ...(limits?.isPaused ? { pausedSource: "manual", pausedAt: new Date() } : {}),
            })
            .returning();

        return NextResponse.json({ success: true, data: profile }, { status: 201 });
    } catch (error) {
        console.error("Sender profile create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
