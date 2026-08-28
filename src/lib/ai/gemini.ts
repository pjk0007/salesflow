// provider dispatch 진입점 — gemini/deepseek/claude 세 경로가 여기서 갈린다.
// (파일명은 히스토리상 gemini.ts지만 Gemini 전용이 아니다)
import type { AiClient } from "./client";
import { extractJson } from "./json-utils";
import { callClaudeEmail, callClaudeJson, callClaudeWithSearch } from "./claude";

export interface GenerateEmailResult {
    subject: string;
    htmlBody: string;
    usage: { promptTokens: number; completionTokens: number };
}

export interface WebSearchResult {
    parsed: Record<string, unknown>;
    sources: Array<{ url: string; title: string }>;
    usage: { promptTokens: number; completionTokens: number };
}

export async function callGeminiEmail(
    client: AiClient,
    systemPrompt: string,
    userPrompt: string
): Promise<GenerateEmailResult> {
    if (client.provider === "claude") {
        return callClaudeEmail(client, systemPrompt, userPrompt);
    }

    if (client.provider === "deepseek") {
        const { content, usage, truncated } = await callDeepseek(client, systemPrompt, userPrompt);
        const parsed = extractJson(content, /\{[\s\S]*"subject"[\s\S]*"htmlBody"[\s\S]*\}/, truncated);
        return {
            subject: (parsed.subject as string).replace(/<[^>]*>/g, ""),
            htmlBody: parsed.htmlBody as string,
            usage,
        };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${client.model}:generateContent?key=${client.apiKey}`;
    const body = JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    });

    let response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
    });

    // 서버 에러(429/500/503) 시 1~2초 대기 후 1회 재시도
    if (!response.ok && [429, 500, 503].includes(response.status)) {
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
        response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
        });
    }

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error?.message || "AI API 호출에 실패했습니다.");
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const textParts = candidate?.content?.parts?.filter(
        (p: { text?: string }) => p.text
    ) ?? [];
    const content = textParts.map((p: { text: string }) => p.text).join("");

    const truncated = candidate?.finishReason === "MAX_TOKENS";
    const parsed = extractJson(content, /\{[\s\S]*"subject"[\s\S]*"htmlBody"[\s\S]*\}/, truncated);

    return {
        subject: (parsed.subject as string).replace(/<[^>]*>/g, ""),
        htmlBody: parsed.htmlBody as string,
        usage: {
            promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
            completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        },
    };
}

export async function callGeminiJson(
    client: AiClient,
    systemPrompt: string,
    userPrompt: string
): Promise<{ content: string; usage: { promptTokens: number; completionTokens: number } }> {
    if (client.provider === "claude") {
        return callClaudeJson(client, systemPrompt, userPrompt);
    }

    if (client.provider === "deepseek") {
        const { content, usage } = await callDeepseek(client, systemPrompt, userPrompt);
        return { content, usage };
    }

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${client.model}:generateContent?key=${client.apiKey}`,
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
        throw new Error(error?.error?.message || "AI API 호출에 실패했습니다.");
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const textParts = candidate?.content?.parts?.filter(
        (p: { text?: string }) => p.text
    ) ?? [];
    return {
        content: textParts.map((p: { text: string }) => p.text).join(""),
        usage: {
            promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
            completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        },
    };
}

export async function callGeminiWithSearch(
    client: AiClient,
    systemPrompt: string,
    userPrompt: string,
    jsonPattern: RegExp
): Promise<WebSearchResult> {
    if (client.provider === "claude") {
        return callClaudeWithSearch(client, systemPrompt, userPrompt, jsonPattern);
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${client.model}:generateContent?key=${client.apiKey}`;
    const headers = { "Content-Type": "application/json" };

    let response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            tools: [{ google_search: {} }],
        }),
    });

    // 검색 그라운딩 quota 초과 시 검색 없이 fallback
    let usedSearch = true;
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const msg = error?.error?.message || "";
        if (response.status === 429 || msg.includes("quota") || msg.includes("rate")) {
            console.warn("[AI] 검색 그라운딩 quota 초과, 검색 없이 재시도");
            usedSearch = false;
            response = await fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    system_instruction: { parts: [{ text: systemPrompt }] },
                    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
                }),
            });
        }
        if (!response.ok) {
            const fallbackError = usedSearch ? msg : (await response.json().catch(() => ({}))).error?.message;
            throw new Error(fallbackError || "Gemini API 호출에 실패했습니다.");
        }
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const textParts = candidate?.content?.parts?.filter(
        (p: { text?: string }) => p.text
    ) ?? [];
    const content = textParts.map((p: { text: string }) => p.text).join("");

    const parsed = extractJson(content, jsonPattern);

    const sources: Array<{ url: string; title: string }> = [];
    if (usedSearch) {
        const grounding = candidate?.groundingMetadata;
        if (grounding?.groundingChunks) {
            for (const chunk of grounding.groundingChunks) {
                if (chunk.web?.uri) {
                    sources.push({ url: chunk.web.uri, title: chunk.web.title || chunk.web.uri });
                }
            }
        }
    }

    return {
        parsed,
        sources,
        usage: {
            promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
            completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        },
    };
}

// DeepSeek (OpenAI 호환) 호출. 검색 미지원 텍스트 생성용.
async function callDeepseek(
    client: AiClient,
    systemPrompt: string,
    userPrompt: string
): Promise<{ content: string; usage: { promptTokens: number; completionTokens: number }; truncated: boolean }> {
    const url = "https://api.deepseek.com/chat/completions";
    const body = JSON.stringify({
        model: client.model,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
    });
    const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${client.apiKey}`,
    };

    let response = await fetch(url, { method: "POST", headers, body });

    // 서버 에러(429/500/503) 시 1~2초 대기 후 1회 재시도
    if (!response.ok && [429, 500, 503].includes(response.status)) {
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
        response = await fetch(url, { method: "POST", headers, body });
    }

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error?.message || "AI API 호출에 실패했습니다.");
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    return {
        content: choice?.message?.content ?? "",
        usage: {
            promptTokens: data.usage?.prompt_tokens ?? 0,
            completionTokens: data.usage?.completion_tokens ?? 0,
        },
        truncated: choice?.finish_reason === "length",
    };
}
