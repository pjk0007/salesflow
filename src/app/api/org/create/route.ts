import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db, organizations, plans, subscriptions, organizationMembers } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getUserFromNextRequest, generateToken, getTokenExpiryMs } from "@/lib/auth";

function generateSlug(): string {
    return `org-${crypto.randomBytes(4).toString("hex")}`;
}

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const { name } = await req.json();

        if (!name?.trim()) {
            return NextResponse.json({ success: false, error: "조직 이름을 입력해주세요." }, { status: 400 });
        }

        // 조직 생성
        const [newOrg] = await db
            .insert(organizations)
            .values({
                name: name.trim(),
                slug: generateSlug(),
            })
            .returning({ id: organizations.id, name: organizations.name, slug: organizations.slug });

        // Free 구독 자동 생성
        const [freePlan] = await db
            .select({ id: plans.id })
            .from(plans)
            .where(eq(plans.slug, "free"));

        if (freePlan) {
            await db.insert(subscriptions).values({
                orgId: newOrg.id,
                planId: freePlan.id,
                status: "active",
            });
        }

        // owner 멤버십 생성
        await db.insert(organizationMembers).values({
            organizationId: newOrg.id,
            userId: user.userId,
            role: "owner",
        });

        // 새 조직으로 JWT 전환
        const payload = {
            userId: user.userId,
            email: user.email,
            name: user.name,
            orgId: newOrg.id,
            role: "owner" as const,
        };

        const token = generateToken(payload);
        const maxAge = Math.floor(getTokenExpiryMs() / 1000);
        const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
        const cookieString = `token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;

        const response = NextResponse.json({
            success: true,
            data: { id: newOrg.id, name: newOrg.name, slug: newOrg.slug, role: "owner" },
        });
        response.headers.set("Set-Cookie", cookieString);
        return response;
    } catch (error) {
        console.error("Create org error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
