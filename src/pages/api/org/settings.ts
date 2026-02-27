import type { NextApiRequest, NextApiResponse } from "next";
import { db, organizations, organizationMembers } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromRequest, generateToken, getTokenExpiryMs } from "@/lib/auth";
import type { JWTPayload } from "@/types";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    if (user.role === "member") {
        return res.status(403).json({ success: false, error: "접근 권한이 없습니다." });
    }

    if (req.method === "GET") {
        return handleGet(req, res, user.orgId);
    }
    if (req.method === "PATCH") {
        return handlePatch(req, res, user.orgId);
    }
    if (req.method === "DELETE") {
        if (user.role !== "owner") {
            return res.status(403).json({ success: false, error: "조직 삭제는 소유자만 가능합니다." });
        }
        return handleDelete(req, res, user);
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
}

async function handleGet(_req: NextApiRequest, res: NextApiResponse, orgId: string) {
    try {
        const [org] = await db
            .select({
                id: organizations.id,
                name: organizations.name,
                slug: organizations.slug,
                branding: organizations.branding,
                integratedCodePrefix: organizations.integratedCodePrefix,
                settings: organizations.settings,
            })
            .from(organizations)
            .where(eq(organizations.id, orgId));

        if (!org) {
            return res.status(404).json({ success: false, error: "조직을 찾을 수 없습니다." });
        }

        return res.status(200).json({ success: true, data: org });
    } catch (error) {
        console.error("Org settings fetch error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}

async function handlePatch(req: NextApiRequest, res: NextApiResponse, orgId: string) {
    try {
        const { name, branding, settings, integratedCodePrefix } = req.body;

        if (name !== undefined && !name.trim()) {
            return res.status(400).json({ success: false, error: "이름을 입력해주세요." });
        }

        // 기존 데이터 조회
        const [existing] = await db
            .select()
            .from(organizations)
            .where(eq(organizations.id, orgId));

        if (!existing) {
            return res.status(404).json({ success: false, error: "조직을 찾을 수 없습니다." });
        }

        // 업데이트할 필드 구성
        const updateData: Record<string, unknown> = {
            updatedAt: new Date(),
        };

        if (name !== undefined) {
            updateData.name = name.trim();
        }

        if (branding !== undefined) {
            updateData.branding = { ...existing.branding, ...branding };
        }

        if (settings !== undefined) {
            updateData.settings = { ...existing.settings, ...settings };
        }

        if (integratedCodePrefix !== undefined && integratedCodePrefix.trim()) {
            updateData.integratedCodePrefix = integratedCodePrefix.trim();
        }

        const [updated] = await db
            .update(organizations)
            .set(updateData)
            .where(eq(organizations.id, orgId))
            .returning({
                id: organizations.id,
                name: organizations.name,
                slug: organizations.slug,
                branding: organizations.branding,
                integratedCodePrefix: organizations.integratedCodePrefix,
                settings: organizations.settings,
            });

        return res.status(200).json({ success: true, data: updated });
    } catch (error) {
        console.error("Org settings update error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}

async function handleDelete(_req: NextApiRequest, res: NextApiResponse, user: JWTPayload) {
    try {
        // 사용자의 다른 조직 찾기
        const otherOrgs = await db
            .select({
                organizationId: organizationMembers.organizationId,
                role: organizationMembers.role,
            })
            .from(organizationMembers)
            .where(
                and(
                    eq(organizationMembers.userId, user.userId),
                    // 현재 삭제할 조직 제외 — 삭제 전에 먼저 조회
                )
            );

        const nextOrg = otherOrgs.find((o) => o.organizationId !== user.orgId);

        // 조직 삭제
        await db.delete(organizations).where(eq(organizations.id, user.orgId));

        if (nextOrg) {
            // 다른 조직으로 JWT 전환
            const payload: JWTPayload = {
                userId: user.userId,
                email: user.email,
                name: user.name,
                orgId: nextOrg.organizationId,
                role: nextOrg.role as "owner" | "admin" | "member",
            };
            const token = generateToken(payload);
            const maxAge = Math.floor(getTokenExpiryMs() / 1000);
            const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
            res.setHeader(
                "Set-Cookie",
                `token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
            );
            return res.status(200).json({ success: true, switchedTo: nextOrg.organizationId });
        } else {
            // 다른 조직 없음 — 쿠키 삭제
            res.setHeader(
                "Set-Cookie",
                "token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
            );
            return res.status(200).json({ success: true, noOrgsLeft: true });
        }
    } catch (error) {
        console.error("Org delete error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
