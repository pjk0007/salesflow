import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db, organizations, plans, subscriptions, organizationMembers } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getActiveUserFromNextRequest, setSessionCookie } from "@/lib/auth";
import { isUniqueViolation } from "@/lib/db/errors";

function generateSlug(): string {
    return `org-${crypto.randomBytes(4).toString("hex")}`;
}

export async function POST(req: NextRequest) {
    const user = await getActiveUserFromNextRequest(req, { scope: "account" });
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const { name } = await req.json();

        if (!name?.trim()) {
            return NextResponse.json({ success: false, error: "조직 이름을 입력해주세요." }, { status: 400 });
        }

        // 조직·구독·owner 멤버십을 한 트랜잭션으로 만든다 — 중간 실패 시 멤버 없는 조직이 남지 않는다
        const newOrg = await db.transaction(async (tx) => {
            const [freePlan] = await tx
                .select({ id: plans.id })
                .from(plans)
                .where(eq(plans.slug, "free"));
            // Free 요금제가 없으면 한도가 모두 0인 조직이 생기므로 만들지 않는다
            if (!freePlan) return null;

            const [org] = await tx
                .insert(organizations)
                .values({
                    name: name.trim(),
                    slug: generateSlug(),
                })
                .returning({ id: organizations.id, name: organizations.name, slug: organizations.slug });

            await tx.insert(subscriptions).values({
                orgId: org.id,
                planId: freePlan.id,
                status: "active",
            });

            await tx.insert(organizationMembers).values({
                organizationId: org.id,
                userId: user.userId,
                role: "owner",
            });
            return org;
        });

        if (!newOrg) {
            return NextResponse.json(
                { success: false, error: "기본 요금제가 준비되지 않아 조직을 만들 수 없습니다. 고객센터에 문의해주세요." },
                { status: 503 }
            );
        }

        const response = NextResponse.json({
            success: true,
            data: { id: newOrg.id, name: newOrg.name, slug: newOrg.slug, role: "owner" },
        });
        // 새 조직으로 JWT 전환. 새 멤버십이라 token_version은 DEFAULT 0. 슈퍼관리자 표시는 유지한다
        await setSessionCookie(response, {
            userId: user.userId,
            email: user.email,
            name: user.name,
            orgId: newOrg.id,
            role: "owner",
            tokenVersion: 0,
            ...(user.isSuperAdmin && { isSuperAdmin: true }),
        });
        return response;
    } catch (error) {
        if (isUniqueViolation(error)) {
            return NextResponse.json({ success: false, error: "조직 주소가 겹쳤습니다. 다시 시도해주세요." }, { status: 409 });
        }
        console.error("Create org error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
