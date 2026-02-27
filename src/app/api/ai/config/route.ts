import { NextRequest, NextResponse } from "next/server";
import { db, aiConfigs } from "@/lib/db";
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
            .from(aiConfigs)
            .where(eq(aiConfigs.orgId, user.orgId))
            .limit(1);

        if (!config) {
            return NextResponse.json({ success: true, data: null });
        }

        return NextResponse.json({
            success: true,
            data: {
                id: config.id,
                provider: config.provider,
                apiKey: maskSecret(config.apiKey),
                model: config.model,
                isActive: config.isActive,
            },
        });
    } catch (error) {
        console.error("AI config fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "권한이 없습니다." }, { status: 403 });
    }

    try {
        const { provider, apiKey, model } = await req.json();
        if (!provider || !apiKey) {
            return NextResponse.json({ success: false, error: "provider와 apiKey는 필수입니다." }, { status: 400 });
        }
        if (!["openai", "anthropic"].includes(provider)) {
            return NextResponse.json({ success: false, error: "지원하지 않는 provider입니다." }, { status: 400 });
        }

        const [existing] = await db
            .select({ id: aiConfigs.id })
            .from(aiConfigs)
            .where(eq(aiConfigs.orgId, user.orgId))
            .limit(1);

        if (existing) {
            await db
                .update(aiConfigs)
                .set({ provider, apiKey, model: model || null, updatedAt: new Date() })
                .where(eq(aiConfigs.id, existing.id));
            return NextResponse.json({ success: true, data: { id: existing.id } });
        } else {
            const [created] = await db
                .insert(aiConfigs)
                .values({ orgId: user.orgId, provider, apiKey, model: model || null })
                .returning({ id: aiConfigs.id });
            return NextResponse.json({ success: true, data: { id: created.id } }, { status: 201 });
        }
    } catch (error) {
        console.error("AI config save error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
