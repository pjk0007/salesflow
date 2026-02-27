import type { NextApiRequest, NextApiResponse } from "next";
import { db, alimtalkConfigs } from "@/lib/db";
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
                .from(alimtalkConfigs)
                .where(eq(alimtalkConfigs.orgId, user.orgId))
                .limit(1);

            if (!config) {
                return res.status(200).json({ success: true, data: null });
            }

            return res.status(200).json({
                success: true,
                data: {
                    id: config.id,
                    appKey: config.appKey,
                    secretKey: maskSecret(config.secretKey),
                    defaultSenderKey: config.defaultSenderKey,
                    isActive: config.isActive,
                },
            });
        } catch (error) {
            console.error("Alimtalk config fetch error:", error);
            return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
        }
    }

    if (req.method === "POST") {
        try {
            const { appKey, secretKey } = req.body;
            if (!appKey || !secretKey) {
                return res.status(400).json({ success: false, error: "appKey와 secretKey는 필수입니다." });
            }

            const [existing] = await db
                .select({ id: alimtalkConfigs.id })
                .from(alimtalkConfigs)
                .where(eq(alimtalkConfigs.orgId, user.orgId))
                .limit(1);

            if (existing) {
                await db
                    .update(alimtalkConfigs)
                    .set({ appKey, secretKey, updatedAt: new Date() })
                    .where(eq(alimtalkConfigs.id, existing.id));
                return res.status(200).json({ success: true, data: { id: existing.id } });
            } else {
                const [created] = await db
                    .insert(alimtalkConfigs)
                    .values({ orgId: user.orgId, appKey, secretKey })
                    .returning({ id: alimtalkConfigs.id });
                return res.status(201).json({ success: true, data: { id: created.id } });
            }
        } catch (error) {
            console.error("Alimtalk config save error:", error);
            return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
        }
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
}
