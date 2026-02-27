import type { NextApiRequest, NextApiResponse } from "next";
import { db, workspaces } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";
import { checkPlanLimit, getResourceCount } from "@/lib/billing";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === "GET") {
        return handleGet(req, res);
    }
    if (req.method === "POST") {
        return handlePost(req, res);
    }
    return res.status(405).json({ success: false, error: "Method not allowed" });
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    try {
        const result = await db
            .select({
                id: workspaces.id,
                name: workspaces.name,
                description: workspaces.description,
                icon: workspaces.icon,
            })
            .from(workspaces)
            .where(eq(workspaces.orgId, user.orgId))
            .orderBy(workspaces.createdAt);

        return res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.error("Workspaces fetch error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    if (user.role === "member") {
        return res.status(403).json({ success: false, error: "접근 권한이 없습니다." });
    }

    const { name, description, icon } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ success: false, error: "이름을 입력해주세요." });
    }

    try {
        // 플랜 제한 체크
        const currentCount = await getResourceCount(user.orgId, "workspaces");
        const limit = await checkPlanLimit(user.orgId, "workspaces", currentCount);
        if (!limit.allowed) {
            return res.status(403).json({
                success: false,
                error: `워크스페이스 한도(${limit.limit}개)를 초과했습니다. 플랜 업그레이드가 필요합니다.`,
                upgradeRequired: true,
            });
        }

        const [created] = await db
            .insert(workspaces)
            .values({
                orgId: user.orgId,
                name: name.trim(),
                description: description?.trim() || null,
                icon: icon?.trim() || null,
            })
            .returning({
                id: workspaces.id,
                name: workspaces.name,
                description: workspaces.description,
                icon: workspaces.icon,
            });

        return res.status(201).json({ success: true, data: created });
    } catch (error) {
        console.error("Workspace create error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
