import type { NextApiRequest, NextApiResponse } from "next";
import { db, users } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getUserFromRequest, hashPassword, verifyPassword, generateToken, getTokenExpiryMs } from "@/lib/auth";
import type { JWTPayload } from "@/types";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    if (req.method === "GET") {
        return handleGet(res, user.userId);
    }
    if (req.method === "PATCH") {
        return handlePatch(req, res, user);
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
}

async function handleGet(res: NextApiResponse, userId: string) {
    try {
        const [profile] = await db
            .select({
                id: users.id,
                email: users.email,
                name: users.name,
                phone: users.phone,
            })
            .from(users)
            .where(eq(users.id, userId));

        if (!profile) {
            return res.status(404).json({ success: false, error: "사용자를 찾을 수 없습니다." });
        }

        return res.status(200).json({ success: true, data: profile });
    } catch (error) {
        console.error("Profile fetch error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}

async function handlePatch(
    req: NextApiRequest,
    res: NextApiResponse,
    currentUser: JWTPayload
) {
    try {
        const { name, phone, currentPassword, newPassword } = req.body;

        // 비밀번호 변경 요청 시 검증
        if (newPassword) {
            if (!currentPassword) {
                return res.status(400).json({ success: false, error: "현재 비밀번호를 입력해주세요." });
            }

            if (newPassword.length < 6) {
                return res.status(400).json({ success: false, error: "새 비밀번호는 6자 이상이어야 합니다." });
            }

            const [userRecord] = await db
                .select({ password: users.password })
                .from(users)
                .where(eq(users.id, currentUser.userId));

            if (!userRecord) {
                return res.status(404).json({ success: false, error: "사용자를 찾을 수 없습니다." });
            }

            const isValid = await verifyPassword(currentPassword, userRecord.password);
            if (!isValid) {
                return res.status(400).json({ success: false, error: "현재 비밀번호가 일치하지 않습니다." });
            }
        }

        const updateData: Record<string, unknown> = {
            updatedAt: new Date(),
        };

        if (name !== undefined) {
            if (!name.trim()) {
                return res.status(400).json({ success: false, error: "이름을 입력해주세요." });
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
            const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
            res.setHeader(
                "Set-Cookie",
                `token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
            );
        }

        return res.status(200).json({ success: true, data: updated });
    } catch (error) {
        console.error("Profile update error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
