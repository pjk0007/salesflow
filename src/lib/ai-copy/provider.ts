import Anthropic from "@anthropic-ai/sdk";
import { getAiClient } from "../ai/client";
import type { PolicySnapshot } from "./types";

export interface CopyProviderResponse {
    content: string;
    promptTokens: number | null;
    completionTokens: number | null;
    truncated: boolean;
}
export class CopyProviderError extends Error {
    constructor(
        readonly code: string,
        readonly retryable: boolean,
    ) {
        super(code);
    }
}
const tokenCount = (value: unknown): number | null =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

/**
 * Claude 5 계열(opus/sonnet/haiku/fable-5…)은 temperature 를 받지 않는다 — 보내면 400 "`temperature` is deprecated
 * for this model" 로 모든 요청이 실패한다. 그 모델에는 빼고 보낸다. 4.x 이하는 그대로 보낸다.
 */
export const acceptsTemperature = (model: string) => !/^claude-(?:opus|sonnet|haiku|fable)-5(?:[-.]|$)/.test(model);

/** 한 호출은 한 과금 시도다. SDK·공급자 내부 재시도를 끄고 작업 계층에서 재시도한다. */
export async function callCopyProvider(
    policy: Pick<PolicySnapshot, "provider" | "model" | "parameters">,
    prompt: { system: string; user: string },
    signal: AbortSignal,
): Promise<CopyProviderResponse> {
    const client = getAiClient(policy.model);
    if (!client || client.model !== policy.model || client.provider !== policy.provider)
        throw new CopyProviderError("provider_not_configured", false);
    if (client.provider === "claude") {
        try {
            const api = new Anthropic({ apiKey: client.apiKey, maxRetries: 0, timeout: 45_000 });
            const message = await api.messages.create(
                {
                    model: policy.model,
                    max_tokens: policy.parameters.maxOutputTokens,
                    ...(acceptsTemperature(policy.model) ? { temperature: policy.parameters.temperature } : {}),
                    system: prompt.system,
                    messages: [{ role: "user", content: prompt.user }],
                },
                { signal },
            );
            return {
                content: message.content
                    .filter((b) => b.type === "text")
                    .map((b) => b.text)
                    .join(""),
                promptTokens: tokenCount(message.usage.input_tokens),
                completionTokens: tokenCount(message.usage.output_tokens),
                truncated: message.stop_reason === "max_tokens",
            };
        } catch (error) {
            if (signal.aborted) throw error;
            const status = error instanceof Anthropic.APIError ? error.status : undefined;
            throw new CopyProviderError(
                status ? `provider_http_${status}` : "provider_network",
                !status || status === 429 || status >= 500,
            );
        }
    }
    const gemini = client.provider === "gemini";
    const response = await fetch(
        gemini
            ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(policy.model)}:generateContent`
            : "https://api.deepseek.com/chat/completions",
        {
            method: "POST",
            signal,
            headers: gemini
                ? { "Content-Type": "application/json", "x-goog-api-key": client.apiKey }
                : { "Content-Type": "application/json", Authorization: `Bearer ${client.apiKey}` },
            body: JSON.stringify(
                gemini
                    ? {
                          system_instruction: { parts: [{ text: prompt.system }] },
                          contents: [{ role: "user", parts: [{ text: prompt.user }] }],
                          generationConfig: {
                              maxOutputTokens: policy.parameters.maxOutputTokens,
                              temperature: policy.parameters.temperature,
                              responseMimeType: "application/json",
                          },
                      }
                    : {
                          model: policy.model,
                          max_tokens: policy.parameters.maxOutputTokens,
                          temperature: policy.parameters.temperature,
                          messages: [
                              { role: "system", content: prompt.system },
                              { role: "user", content: prompt.user },
                          ],
                          response_format: { type: "json_object" },
                      },
            ),
        },
    ).catch((error) => {
        if (signal.aborted) throw error;
        throw new CopyProviderError("provider_network", true);
    });
    if (!response.ok)
        throw new CopyProviderError(
            `provider_http_${response.status}`,
            response.status === 429 || response.status >= 500,
        );
    const data = await response.json();
    if (gemini)
        return {
            content: (data.candidates?.[0]?.content?.parts ?? [])
                .map((p: { text?: string }) => p.text ?? "")
                .join(""),
            promptTokens: tokenCount(data.usageMetadata?.promptTokenCount),
            completionTokens: tokenCount(data.usageMetadata?.candidatesTokenCount),
            truncated: data.candidates?.[0]?.finishReason === "MAX_TOKENS",
        };
    return {
        content: data.choices?.[0]?.message?.content ?? "",
        promptTokens: tokenCount(data.usage?.prompt_tokens),
        completionTokens: tokenCount(data.usage?.completion_tokens),
        truncated: data.choices?.[0]?.finish_reason === "length",
    };
}
