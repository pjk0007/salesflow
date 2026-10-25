import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db, organizations, users, plans, subscriptions, organizationMembers } from "@/lib/db";
import { eq } from "drizzle-orm";
import { hashPassword, setSessionCookie } from "@/lib/auth";
import { isUniqueViolation } from "@/lib/db/errors";
import type { JWTPayload } from "@/types";

function generateSlug(): string {
    return `org-${crypto.randomBytes(4).toString("hex")}`;
}

export async function POST(req: NextRequest) {
    try {
        const { email, password, name } = await req.json();

        if (!email || !password || !name) {
            return NextResponse.json(
                { success: false, error: "모든 필드를 입력해주세요." },
                { status: 400 }
            );
        }

        if (password.length < 6) {
            return NextResponse.json(
                { success: false, error: "비밀번호는 6자 이상이어야 합니다." },
                { status: 400 }
            );
        }

        // 이메일 중복 체크
        const [existingUser] = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, email.trim().toLowerCase()));

        if (existingUser) {
            return NextResponse.json(
                { success: false, error: "이미 등록된 이메일입니다." },
                { status: 409 }
            );
        }

        const hashedPassword = await hashPassword(password);

        // 조직·구독·계정·멤버십을 한 트랜잭션으로 만든다 — 중간 실패나 같은 이메일 동시 가입에서
        // 사용자 없는 조직·구독 없는 조직이 남지 않는다
        const created = await db.transaction(async (tx) => {
            const [freePlan] = await tx
                .select({ id: plans.id })
                .from(plans)
                .where(eq(plans.slug, "free"));
            // Free 요금제가 없으면 한도가 모두 0인 조직이 생기므로 가입 자체를 멈춘다
            if (!freePlan) return null;

            const [newOrg] = await tx
                .insert(organizations)
                .values({
                    name: `${name.trim()}의 조직`,
                    slug: generateSlug(),
                })
                .returning({ id: organizations.id });

            await tx.insert(subscriptions).values({
                orgId: newOrg.id,
                planId: freePlan.id,
                status: "active",
            });

            const [newUser] = await tx
                .insert(users)
                .values({
                    orgId: newOrg.id,
                    email: email.trim().toLowerCase(),
                    password: hashedPassword,
                    name: name.trim(),
                    role: "owner",
                })
                .returning({
                    id: users.id,
                    email: users.email,
                    name: users.name,
                    role: users.role,
                });

            await tx.insert(organizationMembers).values({
                organizationId: newOrg.id,
                userId: newUser.id,
                role: "owner",
            });
            return { orgId: newOrg.id, user: newUser };
        });

        if (!created) {
            return NextResponse.json(
                { success: false, error: "기본 요금제가 준비되지 않아 가입할 수 없습니다. 고객센터에 문의해주세요." },
                { status: 503 }
            );
        }

        const payload: JWTPayload = {
            userId: created.user.id,
            orgId: created.orgId,
            email: created.user.email,
            name: created.user.name,
            role: created.user.role as "owner" | "admin" | "member",
            // 새 멤버십이라 token_version은 DEFAULT 0. 별도 조회 불필요
            tokenVersion: 0,
        };

        const response = NextResponse.json({ success: true, user: payload });
        await setSessionCookie(response, payload);

        return response;
    } catch (error) {
        // 같은 이메일로 거의 동시에 두 번 가입하면 위의 중복 확인을 둘 다 통과한다 — 고유 제약이 막는다
        if (isUniqueViolation(error)) {
            return NextResponse.json(
                { success: false, error: "이미 등록된 이메일입니다." },
                { status: 409 }
            );
        }
        console.error("Signup error:", error);
        return NextResponse.json(
            { success: false, error: "서버 오류가 발생했습니다." },
            { status: 500 }
        );
    }
}
