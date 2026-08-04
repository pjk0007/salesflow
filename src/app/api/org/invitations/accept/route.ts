import { NextRequest, NextResponse } from "next/server";
import { db, organizationInvitations, users, organizationMembers } from "@/lib/db";
import { eq, and, gt } from "drizzle-orm";
import { hashPassword, generateToken, getTokenExpiryMs } from "@/lib/auth";
import type { OrgRole } from "@/types";

export async function GET(req: NextRequest) {
    try {
        const token = req.nextUrl.searchParams.get("token");
        if (!token) {
            return NextResponse.json({ success: false, error: "토큰이 필요합니다." }, { status: 400 });
        }

        const [invitation] = await db
            .select({
                id: organizationInvitations.id,
                email: organizationInvitations.email,
                role: organizationInvitations.role,
                orgId: organizationInvitations.orgId,
                expiresAt: organizationInvitations.expiresAt,
            })
            .from(organizationInvitations)
            .where(
                and(
                    eq(organizationInvitations.token, token),
                    eq(organizationInvitations.status, "pending"),
                    gt(organizationInvitations.expiresAt, new Date())
                )
            );

        if (!invitation) {
            return NextResponse.json({ success: false, error: "만료되었거나 유효하지 않은 초대입니다." }, { status: 400 });
        }

        // 이미 가입한 이메일이면 신규 가입 폼 대신 로그인 후 수락으로 유도
        const [existingUser] = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, invitation.email));

        return NextResponse.json({
            success: true,
            data: {
                email: invitation.email,
                role: invitation.role,
                hasAccount: Boolean(existingUser),
            },
        });
    } catch (error) {
        console.error("Invitation validate error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const { token, name, password } = await req.json();

        if (!token || !name || !password) {
            return NextResponse.json({ success: false, error: "모든 필드를 입력해주세요." }, { status: 400 });
        }

        if (password.length < 6) {
            return NextResponse.json({ success: false, error: "비밀번호는 6자 이상이어야 합니다." }, { status: 400 });
        }

        const [invitation] = await db
            .select()
            .from(organizationInvitations)
            .where(
                and(
                    eq(organizationInvitations.token, token),
                    eq(organizationInvitations.status, "pending"),
                    gt(organizationInvitations.expiresAt, new Date())
                )
            );

        if (!invitation) {
            return NextResponse.json({ success: false, error: "만료되었거나 유효하지 않은 초대입니다." }, { status: 400 });
        }

        // 이미 가입한 계정이면 새 유저를 만들지 않는다.
        // users에는 unique(org_id, email) 제약이 있어 그대로 insert하면 충돌하고,
        // 충돌을 피해 만들어도 로그인이 이메일당 한 행만 집어가므로 접근 불가 계정이 생긴다.
        const [existingUser] = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, invitation.email));

        if (existingUser) {
            const [existingMember] = await db
                .select({ id: organizationMembers.id })
                .from(organizationMembers)
                .where(and(
                    eq(organizationMembers.userId, existingUser.id),
                    eq(organizationMembers.organizationId, invitation.orgId)
                ));

            if (existingMember) {
                return NextResponse.json({ success: false, error: "이미 조직에 소속된 이메일입니다." }, { status: 400 });
            }

            return NextResponse.json({
                success: false,
                error: "이미 가입된 이메일입니다. 로그인 후 초대를 수락해주세요.",
                requiresLogin: true,
            }, { status: 409 });
        }

        const hashedPassword = await hashPassword(password);

        // 유저 생성 + 멤버 등록 + 초대 수락을 한 트랜잭션으로 묶는다.
        // 따로 두면 중간 실패 시 멤버십 없는 유령 계정이 남아 재초대까지 막힌다.
        const newUser = await db.transaction(async (tx) => {
            const [created] = await tx
                .insert(users)
                .values({
                    orgId: invitation.orgId,
                    email: invitation.email,
                    name: name.trim(),
                    password: hashedPassword,
                    role: invitation.role,
                })
                .returning({
                    id: users.id,
                    email: users.email,
                    name: users.name,
                    role: users.role,
                });

            await tx.insert(organizationMembers).values({
                organizationId: invitation.orgId,
                userId: created.id,
                role: invitation.role,
            });

            await tx
                .update(organizationInvitations)
                .set({ status: "accepted" })
                .where(eq(organizationInvitations.id, invitation.id));

            return created;
        });

        // JWT 생성
        const jwtToken = generateToken({
            userId: newUser.id,
            orgId: invitation.orgId,
            email: newUser.email,
            name: newUser.name,
            role: newUser.role as OrgRole,
        });

        const maxAge = Math.floor(getTokenExpiryMs() / 1000);
        const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
        const cookieString = `token=${jwtToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;

        const response = NextResponse.json({
            success: true,
            data: {
                userId: newUser.id,
                orgId: invitation.orgId,
            },
        });
        response.headers.set("Set-Cookie", cookieString);
        return response;
    } catch (error) {
        console.error("Invitation accept error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
