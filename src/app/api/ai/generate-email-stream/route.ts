import { NextRequest, NextResponse } from "next/server";
import { db, products } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { requireRecordAccess } from "@/lib/partition-access";
import { getAiClient, buildEmailSystemPrompt, checkTokenQuota, updateTokenUsage, logAiUsage } from "@/lib/ai";
import type { AiClient, GenerateEmailInput } from "@/lib/ai";
import { callClaudeEmail, EmailResponseError } from "@/lib/ai/claude";

type Usage = { promptTokens: number; completionTokens: number };

export async function POST(req: NextRequest) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const quota = await checkTokenQuota(user.orgId);
    if (!quota.allowed) {
        return NextResponse.json({
            success: false,
            error: "이번 달 AI 사용량을 초과했습니다. 플랜 업그레이드를 고려해주세요.",
        }, { status: 429 });
    }

    const { prompt, productId, recordId, tone, ctaUrl, model } = await req.json();

    const client = getAiClient(model);
    if (!client) {
        return NextResponse.json({ success: false, error: "AI 서비스를 사용할 수 없습니다." }, { status: 503 });
    }

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

        // 프롬프트에 넣을 고객 자료는 내 조직·접근 가능한 파티션의 레코드만 쓴다 — 확인을 통과한 record만 AI 입력이 된다
        let recordData = null;
        if (recordId) {
            const access = await requireRecordAccess(user, Number(recordId), "read");
            if (!access.ok) {
                return NextResponse.json({ success: false, error: access.error }, { status: access.status });
            }
            recordData = access.record.data as Record<string, unknown>;
        }

        const input: GenerateEmailInput = {
            prompt: prompt.trim(),
            product,
            recordData,
            tone,
            ctaUrl,
        };
        const systemPrompt = buildEmailSystemPrompt(input);

        let cancelled = false;
        const stream = new ReadableStream({
            cancel() { cancelled = true; },
            async start(controller) {
                const encoder = new TextEncoder();

                const sendEvent = (event: string, data: unknown) => {
                    if (cancelled) return;
                    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
                };

                // 공급자가 이미 쓴 토큰. 실패(잘림·형식 오류·연결 끊김)로 끝나도 받은 만큼 기록해 한도와 맞춘다.
                const usage: Usage = { promptTokens: 0, completionTokens: 0 };
                const recordUsage = async () => {
                    await updateTokenUsage(user.orgId, usage.promptTokens + usage.completionTokens);
                    await logAiUsage({
                        orgId: user.orgId,
                        userId: user.userId,
                        provider: client.provider,
                        model: client.model,
                        promptTokens: usage.promptTokens,
                        completionTokens: usage.completionTokens,
                        purpose: "email_generation",
                    });
                };

                try {
                    if (client.provider === "claude") {
                        // 기존 Anthropic 어댑터의 JSON·사용량 변환을 재사용한다.
                        // 이 공급자는 완료한 초안을 한 번의 chunk로 보낸다.
                        try {
                            const result = await callClaudeEmail(client, systemPrompt, input.prompt, { strict: true });
                            Object.assign(usage, result.usage);
                            sendEvent("chunk", { text: JSON.stringify({ subject: result.subject, htmlBody: result.htmlBody }) });
                        } catch (error) {
                            if (error instanceof EmailResponseError) Object.assign(usage, error.usage);
                            throw error;
                        }
                    } else if (client.provider === "deepseek") {
                        await streamDeepseek(client, systemPrompt, input.prompt, sendEvent, usage);
                    } else {
                        await streamGemini(client, systemPrompt, input.prompt, sendEvent, usage);
                    }

                    await recordUsage();
                    sendEvent("done", { usage });
                } catch (error) {
                    console.error("AI email stream error:", error);
                    if (usage.promptTokens + usage.completionTokens > 0) {
                        await recordUsage().catch((err) => console.error("AI usage log error:", err));
                    }
                    sendEvent("error", { error: "AI 이메일 생성에 실패했습니다. 잠시 후 다시 시도하거나 조직 AI 연결을 확인해주세요." });
                } finally {
                    if (!cancelled) controller.close();
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
        return NextResponse.json({ success: false, error: "AI 이메일 생성에 실패했습니다." }, { status: 500 });
    }
}

type SendEvent = (event: string, data: unknown) => void;

// DeepSeek (OpenAI 호환) SSE 스트리밍
async function streamDeepseek(
    client: AiClient,
    systemPrompt: string,
    userPrompt: string,
    sendEvent: SendEvent,
    usage: Usage
): Promise<Usage> {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${client.apiKey}`,
        },
        body: JSON.stringify({
            model: client.model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ],
            response_format: { type: "json_object" },
            stream: true,
            stream_options: { include_usage: true },
        }),
        signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error?.message || "DeepSeek API 호출에 실패했습니다.");
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let complete = false;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;
                const data = trimmed.slice(5).trimStart();
                if (data === "[DONE]") { complete = true; continue; }

                const parsed = JSON.parse(data);
                if (parsed.error || (parsed.choices?.[0]?.finish_reason && parsed.choices[0].finish_reason !== "stop"))
                    throw new Error("AI 응답이 완료되지 않았습니다.");
                const text = parsed.choices?.[0]?.delta?.content;
                if (text) {
                    sendEvent("chunk", { text });
                }
                if (parsed.usage) {
                    usage.promptTokens = parsed.usage.prompt_tokens ?? 0;
                    usage.completionTokens = parsed.usage.completion_tokens ?? 0;
                }
            }
        }
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }

    if (!complete) throw new Error("AI 응답이 완료되기 전에 연결이 끊겼습니다.");
    return usage;
}

async function streamGemini(
    client: AiClient,
    systemPrompt: string,
    userPrompt: string,
    sendEvent: SendEvent,
    usage: Usage
): Promise<Usage> {
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(client.model)}:streamGenerateContent?alt=sse`,
        {
            method: "POST",
            // 키는 주소(쿼리)가 아니라 헤더로 보낸다 — 주소는 프록시·접근 로그에 남는다.
            headers: { "Content-Type": "application/json", "x-goog-api-key": client.apiKey },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemPrompt }] },
                contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            }),
            signal: AbortSignal.timeout(120000),
        }
    );

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error?.message || "Gemini API 호출에 실패했습니다.");
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let complete = false;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;
                const data = trimmed.slice(5).trimStart();

                const parsed = JSON.parse(data);
                const candidate = parsed.candidates?.[0];
                if (parsed.error || (candidate?.finishReason && candidate.finishReason !== "STOP"))
                    throw new Error("AI 응답이 완료되지 않았습니다.");
                if (candidate?.finishReason === "STOP") complete = true;
                const text = candidate?.content?.parts?.[0]?.text;

                if (text) {
                    sendEvent("chunk", { text });
                }

                if (parsed.usageMetadata) {
                    usage.promptTokens = parsed.usageMetadata.promptTokenCount ?? 0;
                    usage.completionTokens = parsed.usageMetadata.candidatesTokenCount ?? 0;
                }
            }
        }
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }

    if (!complete) throw new Error("AI 응답이 완료되기 전에 연결이 끊겼습니다.");
    return usage;
}
