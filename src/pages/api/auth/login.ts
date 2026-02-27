import type { NextApiRequest, NextApiResponse } from "next";
import { db, users, organizationMembers } from "@/lib/db";
import { eq, desc } from "drizzle-orm";
import { verifyPassword, generateToken, getTokenExpiryMs } from "@/lib/auth";
import type { JWTPayload } from "@/types";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, error: "이메일과 비밀번호를 입력해주세요." });
        }

        const [user] = await db
            .select()
            .from(users)
            .where(eq(users.email, email.trim().toLowerCase()));

        if (!user) {
            return res.status(401).json({ success: false, error: "이메일 또는 비밀번호가 올바르지 않습니다." });
        }

        if (user.password === "ADION_SSO") {
            return res.status(401).json({ success: false, error: "비밀번호 재설정이 필요합니다. 관리자에게 문의해주세요." });
        }

        const isValid = await verifyPassword(password, user.password);
        if (!isValid) {
            return res.status(401).json({ success: false, error: "이메일 또는 비밀번호가 올바르지 않습니다." });
        }

        if (user.isActive !== 1) {
            return res.status(403).json({ success: false, error: "비활성 계정입니다." });
        }

        // organizationMembers에서 소속 조직 조회
        const memberships = await db
            .select({
                organizationId: organizationMembers.organizationId,
                role: organizationMembers.role,
                joinedAt: organizationMembers.joinedAt,
            })
            .from(organizationMembers)
            .where(eq(organizationMembers.userId, user.id))
            .orderBy(desc(organizationMembers.joinedAt));

        if (memberships.length === 0) {
            return res.status(403).json({
                success: false,
                error: "소속된 조직이 없습니다.",
            });
        }

        // users.orgId가 있으면 해당 조직 우선, 없으면 가장 최근 조직
        const selectedOrg = user.orgId
            ? memberships.find(m => m.organizationId === user.orgId) ?? memberships[0]
            : memberships[0];

        const payload: JWTPayload = {
            userId: user.id,
            orgId: selectedOrg.organizationId,
            email: user.email,
            name: user.name,
            role: selectedOrg.role as "owner" | "admin" | "member",
        };

        const token = generateToken(payload);
        const maxAge = Math.floor(getTokenExpiryMs() / 1000);

        const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
        res.setHeader(
            "Set-Cookie",
            `token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
        );

        return res.status(200).json({
            success: true,
            user: payload,
        });
    } catch (error) {
        console.error("Login error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
