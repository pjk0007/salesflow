import { NextRequest, NextResponse } from "next/server";
import { db, alimtalkConfigs } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

function maskSecret(secret: string): string {
    if (secret.length <= 6) return "***";
    return secret.slice(0, 3) + "***" + secret.slice(-3);
}

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const [config] = await db
            .select()
            .from(alimtalkConfigs)
            .where(eq(alimtalkConfigs.orgId, user.orgId))
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
                defaultSenderKey: config.defaultSenderKey,
                isActive: config.isActive,
            },
        });
    } catch (error) {
        console.error("Alimtalk config fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const { appKey, secretKey } = await req.json();
        if (!appKey || !secretKey) {
            return NextResponse.json({ success: false, error: "appKey와 secretKey는 필수입니다." }, { status: 400 });
        }

        const [existing] = await db
            .select({ id: alimtalkConfigs.id })
            .from(alimtalkConfigs)
            .where(eq(alimtalkConfigs.orgId, user.orgId))
            .limit(1);

        if (existing) {
            await db
                .update(alimtalkConfigs)
                .set({ appKey, secretKey, updatedAt: new Date() })
                .where(eq(alimtalkConfigs.id, existing.id));
            return NextResponse.json({ success: true, data: { id: existing.id } });
        } else {
            const [created] = await db
                .insert(alimtalkConfigs)
                .values({ orgId: user.orgId, appKey, secretKey })
                .returning({ id: alimtalkConfigs.id });
            return NextResponse.json({ success: true, data: { id: created.id } }, { status: 201 });
        }
    } catch (error) {
        console.error("Alimtalk config save error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
