import { NextRequest, NextResponse } from "next/server";
import { db, products, records } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { getAiClient, buildEmailSystemPrompt, checkTokenQuota, updateTokenUsage, logAiUsage } from "@/lib/ai";
import type { AiClient, GenerateEmailInput } from "@/lib/ai";

type Usage = { promptTokens: number; completionTokens: number };

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const client = getAiClient();
    if (!client) {
        return NextResponse.json({ success: false, error: "AI 서비스를 사용할 수 없습니다." }, { status: 503 });
    }

    const quota = await checkTokenQuota(user.orgId);
    if (!quota.allowed) {
        return NextResponse.json({
            success: false,
            error: "이번 달 AI 사용량을 초과했습니다. 플랜 업그레이드를 고려해주세요.",
        }, { status: 429 });
    }

    const { prompt, productId, recordId, tone, ctaUrl } = await req.json();
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
        return NextResponse.json({ success: false, error: "프롬프트를 입력해주세요." }, { status: 400 });
    }

    try {
        let product = null;
        if (productId) {
            const [p] = await db
                .select()
                .from(products)
                .where(and(eq(products.id, productId), eq(products.orgId, user.orgId)))
                .limit(1);
            product = p ?? null;
        }

        let recordData = null;
        if (recordId) {
            const [r] = await db.select().from(records).where(eq(records.id, recordId)).limit(1);
            if (r) recordData = r.data as Record<string, unknown>;
        }

        const input: GenerateEmailInput = {
            prompt: prompt.trim(),
            product,
            recordData,
            tone,
            ctaUrl,
        };
        const systemPrompt = buildEmailSystemPrompt(input);

        const stream = new ReadableStream({
            async start(controller) {
                const encoder = new TextEncoder();

                const sendEvent = (event: string, data: unknown) => {
                    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
                };

                try {
                    const usage = await streamGemini(client, systemPrompt, input.prompt, sendEvent);

                    sendEvent("done", { usage });
                    controller.close();

                    const totalTokens = usage.promptTokens + usage.completionTokens;
                    await updateTokenUsage(user.orgId, totalTokens);

                    logAiUsage({
                        orgId: user.orgId,
                        userId: user.userId,
                        provider: "gemini",
                        model: client.model,
                        promptTokens: usage.promptTokens,
                        completionTokens: usage.completionTokens,
                        purpose: "email_generation",
                    }).catch((err) => console.error("AI usage log error:", err));
                } catch (error) {
                    console.error("AI email stream error:", error);
                    const message = error instanceof Error ? error.message : "AI 이메일 생성에 실패했습니다.";
                    sendEvent("error", { error: message });
                    controller.close();
                }
            },
        });

        return new Response(stream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
            },
        });
    } catch (error) {
        console.error("AI email stream error:", error);
        const message = error instanceof Error ? error.message : "AI 이메일 생성에 실패했습니다.";
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}

type SendEvent = (event: string, data: unknown) => void;

async function streamGemini(
    client: AiClient,
    systemPrompt: string,
    userPrompt: string,
    sendEvent: SendEvent
): Promise<Usage> {
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${client.model}:streamGenerateContent?alt=sse&key=${client.apiKey}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemPrompt }] },
                contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            }),
        }
    );

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error?.message || "Gemini API 호출에 실패했습니다.");
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const usage: Usage = { promptTokens: 0, completionTokens: 0 };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);

            try {
                const parsed = JSON.parse(data);
                const candidate = parsed.candidates?.[0];
                const text = candidate?.content?.parts?.[0]?.text;

                if (text) {
                    sendEvent("chunk", { text });
                }

                if (parsed.usageMetadata) {
                    usage.promptTokens = parsed.usageMetadata.promptTokenCount ?? 0;
                    usage.completionTokens = parsed.usageMetadata.candidatesTokenCount ?? 0;
                }
            } catch {
                // ignore
            }
        }
    }

    return usage;
}
