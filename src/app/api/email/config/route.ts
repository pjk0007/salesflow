import { NextRequest, NextResponse } from "next/server";
import { db, emailConfigs } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { requireAdmin } from "@/lib/auth-admin";

function maskSecret(secret: string): string {
    if (secret.length <= 6) return "***";
    return secret.slice(0, 3) + "***" + secret.slice(-3);
}

export async function GET(req: NextRequest) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const [config] = await db
            .select()
            .from(emailConfigs)
            .where(eq(emailConfigs.orgId, user.orgId))
            .limit(1);

        if (!config) {
            return NextResponse.json({ success: true, data: null });
        }

        return NextResponse.json({
            success: true,
            data: {
                id: config.id,
                appKey: config.appKey,
                secretKey: maskSecret(config.secretKey),
                fromName: config.fromName,
                fromEmail: config.fromEmail,
                signature: config.signature,
                signatureEnabled: config.signatureEnabled,
                isActive: config.isActive,
            },
        });
    } catch (error) {
        console.error("Email config fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const auth = await requireAdmin(req);
    if (!auth.ok) {
        return NextResponse.json({ success: false, error: auth.status === 403 ? "관리자만 이메일 설정을 변경할 수 있습니다." : auth.error }, { status: auth.status });
    }
    const user = auth.user;

    try {
        const { appKey, secretKey, fromName, fromEmail, signature, signatureEnabled } = await req.json();
        if (!appKey || !secretKey) {
            return NextResponse.json({ success: false, error: "appKey와 secretKey는 필수입니다." }, { status: 400 });
        }

        const [existing] = await db
            .select({ id: emailConfigs.id })
            .from(emailConfigs)
            .where(eq(emailConfigs.orgId, user.orgId))
            .limit(1);

        if (existing) {
            await db
                .update(emailConfigs)
                .set({ appKey, secretKey, fromName: fromName || null, fromEmail: fromEmail || null, signature: signature || null, signatureEnabled: signatureEnabled ?? false, updatedAt: new Date() })
                .where(eq(emailConfigs.id, existing.id));
            return NextResponse.json({ success: true, data: { id: existing.id } });
        } else {
            const [created] = await db
                .insert(emailConfigs)
                .values({ orgId: user.orgId, appKey, secretKey, fromName: fromName || null, fromEmail: fromEmail || null, signature: signature || null, signatureEnabled: signatureEnabled ?? false })
                .returning({ id: emailConfigs.id });
            return NextResponse.json({ success: true, data: { id: created.id } }, { status: 201 });
        }
    } catch (error) {
        console.error("Email config save error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
