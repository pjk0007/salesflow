import crypto from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { db, organizations, users, plans, subscriptions, organizationMembers } from "@/lib/db";
import { eq } from "drizzle-orm";
import { hashPassword, generateToken, getTokenExpiryMs } from "@/lib/auth";
import type { JWTPayload } from "@/types";

function generateSlug(): string {
    return `org-${crypto.randomBytes(4).toString("hex")}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    try {
        const { email, password, name } = req.body;

        if (!email || !password || !name) {
            return res.status(400).json({ success: false, error: "모든 필드를 입력해주세요." });
        }

        if (password.length < 6) {
            return res.status(400).json({ success: false, error: "비밀번호는 6자 이상이어야 합니다." });
        }

        // 이메일 중복 체크
        const [existingUser] = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, email.trim().toLowerCase()));

        if (existingUser) {
            return res.status(409).json({ success: false, error: "이미 등록된 이메일입니다." });
        }

        const hashedPassword = await hashPassword(password);

        // 조직 자동 생성
        const [newOrg] = await db
            .insert(organizations)
            .values({
                name: `${name.trim()}의 조직`,
                slug: generateSlug(),
            })
            .returning({ id: organizations.id });

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

        // owner 유저 생성
        const [newUser] = await db
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

        // organizationMembers에 owner 멤버십 생성
        await db.insert(organizationMembers).values({
            organizationId: newOrg.id,
            userId: newUser.id,
            role: "owner",
        });

        const payload: JWTPayload = {
            userId: newUser.id,
            orgId: newOrg.id,
            email: newUser.email,
            name: newUser.name,
            role: newUser.role as "owner" | "admin" | "member",
        };

        const token = generateToken(payload);
        const maxAge = Math.floor(getTokenExpiryMs() / 1000);
        const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
        res.setHeader(
            "Set-Cookie",
            `token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
        );

        return res.status(200).json({ success: true, user: payload });
    } catch (error) {
        console.error("Signup error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
