import { NextRequest, NextResponse } from "next/server";
import { db, users } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getUserFromNextRequest, hashPassword, verifyPassword, generateToken, getTokenExpiryMs } from "@/lib/auth";
import type { JWTPayload } from "@/types";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json(
            { success: false, error: "인증이 필요합니다." },
            { status: 401 }
        );
    }

    try {
        const [profile] = await db
            .select({
                id: users.id,
                email: users.email,
                name: users.name,
                phone: users.phone,
            })
            .from(users)
            .where(eq(users.id, user.userId));

        if (!profile) {
            return NextResponse.json(
                { success: false, error: "사용자를 찾을 수 없습니다." },
                { status: 404 }
            );
        }

        return NextResponse.json({ success: true, data: profile });
    } catch (error) {
        console.error("Profile fetch error:", error);
        return NextResponse.json(
            { success: false, error: "서버 오류가 발생했습니다." },
            { status: 500 }
        );
    }
}

export async function PATCH(req: NextRequest) {
    const currentUser = getUserFromNextRequest(req);
    if (!currentUser) {
        return NextResponse.json(
            { success: false, error: "인증이 필요합니다." },
            { status: 401 }
        );
    }

    try {
        const { name, phone, currentPassword, newPassword } = await req.json();

        // 비밀번호 변경 요청 시 검증
        if (newPassword) {
            if (!currentPassword) {
                return NextResponse.json(
                    { success: false, error: "현재 비밀번호를 입력해주세요." },
                    { status: 400 }
                );
            }

            if (newPassword.length < 6) {
                return NextResponse.json(
                    { success: false, error: "새 비밀번호는 6자 이상이어야 합니다." },
                    { status: 400 }
                );
            }

            const [userRecord] = await db
                .select({ password: users.password })
                .from(users)
                .where(eq(users.id, currentUser.userId));

            if (!userRecord) {
                return NextResponse.json(
                    { success: false, error: "사용자를 찾을 수 없습니다." },
                    { status: 404 }
                );
            }

            const isValid = await verifyPassword(currentPassword, userRecord.password);
            if (!isValid) {
                return NextResponse.json(
                    { success: false, error: "현재 비밀번호가 일치하지 않습니다." },
                    { status: 400 }
                );
            }
        }

        const updateData: Record<string, unknown> = {
            updatedAt: new Date(),
        };

        if (name !== undefined) {
            if (!name.trim()) {
                return NextResponse.json(
                    { success: false, error: "이름을 입력해주세요." },
                    { status: 400 }
                );
            }
            updateData.name = name.trim();
        }

        if (phone !== undefined) {
            updateData.phone = phone || null;
        }

        if (newPassword) {
            updateData.password = await hashPassword(newPassword);
        }

        const [updated] = await db
            .update(users)
            .set(updateData)
            .where(eq(users.id, currentUser.userId))
            .returning({
                id: users.id,
                email: users.email,
                name: users.name,
                phone: users.phone,
            });

        // 이름 변경 시 JWT 재발급 (JWT에 name 포함)
        if (name !== undefined && name.trim() !== currentUser.name) {
            const payload: JWTPayload = {
                ...currentUser,
                name: name.trim(),
            };
            const token = generateToken(payload);
            const maxAge = Math.floor(getTokenExpiryMs() / 1000);

            const response = NextResponse.json({ success: true, data: updated });
            response.cookies.set("token", token, {
                path: "/",
                httpOnly: true,
                sameSite: "lax",
                maxAge,
                secure: process.env.NODE_ENV === "production",
            });
            return response;
        }

        return NextResponse.json({ success: true, data: updated });
    } catch (error) {
        console.error("Profile update error:", error);
        return NextResponse.json(
            { success: false, error: "서버 오류가 발생했습니다." },
            { status: 500 }
        );
    }
}
