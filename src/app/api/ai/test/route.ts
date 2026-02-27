import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { provider, apiKey } = await req.json();
    if (!provider || !apiKey) {
        return NextResponse.json({ success: false, error: "provider와 apiKey는 필수입니다." }, { status: 400 });
    }

    try {
        if (provider === "openai") {
            const response = await fetch("https://api.openai.com/v1/models", {
                headers: { Authorization: `Bearer ${apiKey}` },
            });
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                return NextResponse.json({
                    success: true,
                    data: { connected: false, error: error?.error?.message || "API 키가 유효하지 않습니다." },
                });
            }
            return NextResponse.json({
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
                    return NextResponse.json({
                        success: true,
                        data: { connected: false, error: "API 키가 유효하지 않습니다." },
                    });
                }
            }
            return NextResponse.json({
                success: true,
                data: { connected: true },
            });
        }

        return NextResponse.json({ success: false, error: "지원하지 않는 provider입니다." }, { status: 400 });
    } catch (error) {
        console.error("AI connection test error:", error);
        return NextResponse.json({
            success: true,
            data: { connected: false, error: "연결에 실패했습니다." },
        });
    }
}
