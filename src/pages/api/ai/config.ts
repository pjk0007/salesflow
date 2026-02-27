import type { NextApiRequest, NextApiResponse } from "next";
import { db, aiConfigs } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";

function maskSecret(secret: string): string {
    if (secret.length <= 6) return "***";
    return secret.slice(0, 3) + "***" + secret.slice(-3);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    if (req.method === "GET") {
        try {
            const [config] = await db
                .select()
                .from(aiConfigs)
                .where(eq(aiConfigs.orgId, user.orgId))
                .limit(1);

            if (!config) {
                return res.status(200).json({ success: true, data: null });
            }

            return res.status(200).json({
                success: true,
                data: {
                    id: config.id,
                    provider: config.provider,
                    apiKey: maskSecret(config.apiKey),
                    model: config.model,
                    isActive: config.isActive,
                },
            });
        } catch (error) {
            console.error("AI config fetch error:", error);
            return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
        }
    }

    if (req.method === "POST") {
        if (user.role === "member") {
            return res.status(403).json({ success: false, error: "권한이 없습니다." });
        }

        try {
            const { provider, apiKey, model } = req.body;
            if (!provider || !apiKey) {
                return res.status(400).json({ success: false, error: "provider와 apiKey는 필수입니다." });
            }
            if (!["openai", "anthropic"].includes(provider)) {
                return res.status(400).json({ success: false, error: "지원하지 않는 provider입니다." });
            }

            const [existing] = await db
                .select({ id: aiConfigs.id })
                .from(aiConfigs)
                .where(eq(aiConfigs.orgId, user.orgId))
                .limit(1);

            if (existing) {
                await db
                    .update(aiConfigs)
                    .set({ provider, apiKey, model: model || null, updatedAt: new Date() })
                    .where(eq(aiConfigs.id, existing.id));
                return res.status(200).json({ success: true, data: { id: existing.id } });
            } else {
                const [created] = await db
                    .insert(aiConfigs)
                    .values({ orgId: user.orgId, provider, apiKey, model: model || null })
                    .returning({ id: aiConfigs.id });
                return res.status(201).json({ success: true, data: { id: created.id } });
            }
        } catch (error) {
            console.error("AI config save error:", error);
            return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
        }
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
}
