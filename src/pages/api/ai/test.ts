import type { NextApiRequest, NextApiResponse } from "next";
import { getUserFromRequest } from "@/lib/auth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    const { provider, apiKey } = req.body;
    if (!provider || !apiKey) {
        return res.status(400).json({ success: false, error: "provider와 apiKey는 필수입니다." });
    }

    try {
        if (provider === "openai") {
            const response = await fetch("https://api.openai.com/v1/models", {
                headers: { Authorization: `Bearer ${apiKey}` },
            });
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                return res.status(200).json({
                    success: true,
                    data: { connected: false, error: error?.error?.message || "API 키가 유효하지 않습니다." },
                });
            }
            return res.status(200).json({
                success: true,
                data: { connected: true },
            });
        }

        if (provider === "anthropic") {
            const response = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                    "x-api-key": apiKey,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: "claude-haiku-4-5-20251001",
                    max_tokens: 1,
                    messages: [{ role: "user", content: "test" }],
                }),
            });
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                if (error?.error?.type === "authentication_error") {
                    return res.status(200).json({
                        success: true,
                        data: { connected: false, error: "API 키가 유효하지 않습니다." },
                    });
                }
            }
            return res.status(200).json({
                success: true,
                data: { connected: true },
            });
        }

        return res.status(400).json({ success: false, error: "지원하지 않는 provider입니다." });
    } catch (error) {
        console.error("AI connection test error:", error);
        return res.status(200).json({
            success: true,
            data: { connected: false, error: "연결에 실패했습니다." },
        });
    }
}
