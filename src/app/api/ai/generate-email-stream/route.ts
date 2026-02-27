import { NextRequest, NextResponse } from "next/server";
import { db, products, records } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { getAiClient, buildEmailSystemPrompt, logAiUsage } from "@/lib/ai";
import type { AiClient, GenerateEmailInput } from "@/lib/ai";

type Usage = { promptTokens: number; completionTokens: number };

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const client = await getAiClient(user.orgId);
    if (!client) {
        return NextResponse.json({ success: false, error: "AI 설정이 필요합니다." }, { status: 400 });
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
                    let usage: Usage = { promptTokens: 0, completionTokens: 0 };

                    if (client.provider === "openai") {
                        usage = await streamOpenAI(client, systemPrompt, input.prompt, sendEvent);
                    } else {
                        usage = await streamAnthropic(client, systemPrompt, input.prompt, sendEvent);
                    }

                    sendEvent("done", { usage });
                    controller.close();

                    // 사용량 로깅 (응답 종료 후 비동기)
                    logAiUsage({
                        orgId: user.orgId,
                        userId: user.userId,
                        provider: client.provider,
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

async function streamOpenAI(
    client: AiClient,
    systemPrompt: string,
    userPrompt: string,
    sendEvent: SendEvent
): Promise<Usage> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${client.apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: client.model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ],
            stream: true,
            stream_options: { include_usage: true },
        }),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error?.message || "OpenAI API 호출에 실패했습니다.");
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
            if (data === "[DONE]") continue;

            try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) {
                    sendEvent("chunk", { text: delta });
                }
                if (parsed.usage) {
                    usage.promptTokens = parsed.usage.prompt_tokens ?? 0;
                    usage.completionTokens = parsed.usage.completion_tokens ?? 0;
                }
            } catch {
                // ignore
            }
        }
    }

    return usage;
}

async function streamAnthropic(
    client: AiClient,
    systemPrompt: string,
    userPrompt: string,
    sendEvent: SendEvent
): Promise<Usage> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "x-api-key": client.apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: client.model,
            max_tokens: 16384,
            system: systemPrompt,
            messages: [{ role: "user", content: userPrompt }],
            stream: true,
        }),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error?.message || "Anthropic API 호출에 실패했습니다.");
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

                if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                    sendEvent("chunk", { text: parsed.delta.text });
                }
                if (parsed.type === "message_start" && parsed.message?.usage) {
                    usage.promptTokens = parsed.message.usage.input_tokens ?? 0;
                }
                if (parsed.type === "message_delta" && parsed.usage) {
                    usage.completionTokens = parsed.usage.output_tokens ?? 0;
                }
            } catch {
                // ignore
            }
        }
    }

    return usage;
}
