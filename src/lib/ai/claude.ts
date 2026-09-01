import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlock, MessageParam, WebSearchTool20260209 } from "@anthropic-ai/sdk/resources/messages";
import type { AiClient } from "./client";
import { extractJson } from "./json-utils";
import { extractText, extractSearchSources, toUsage, stripCitationTags } from "./claude-parse";
import type { GenerateEmailResult, WebSearchResult } from "./gemini";

const MAX_TOKENS = 4096;

// 타임아웃이 없으면 응답이 오지 않는 호출이 영원히 매달린다.
// 그 호출이 Promise.allSettled 배치에 섞이면 배치 전체가 resolve되지 않아
// 뒤따르는 발송이 전부 멈춘다 (2026-09-01 사고의 직접 원인).
const REQUEST_TIMEOUT_MS = 120_000;

function clientOptions(apiKey: string): ConstructorParameters<typeof Anthropic>[0] {
    return {
        apiKey,
        timeout: REQUEST_TIMEOUT_MS,
        // SDK 기본 재시도(2회)를 끈다 — requestWithRetry가 이미 재시도하므로
        // 그대로 두면 4회가 되어 최악의 대기 시간이 배가 된다.
        maxRetries: 0,
    };
}

// web search 서버 루프가 10회에 도달하면 pause_turn으로 멈춘다.
// 초기 1회 + 재개 3회 = 최대 4회 API 호출.
const MAX_SEARCH_CONTINUATIONS = 3;

// allowed_callers를 빼면 400이 난다 — Haiku 4.5는 programmatic tool calling 미지원.
const SEARCH_TOOL: WebSearchTool20260209 = {
    type: "web_search_20260209",
    name: "web_search",
    max_uses: 3,
    allowed_callers: ["direct"],
};

interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
}

interface ClaudeCallResult {
    text: string;
    blocks: ContentBlock[];
    usage: TokenUsage;
    truncated: boolean;
    pausedOut: boolean;
}

function isRetryableStatus(status: number | undefined): boolean {
    // 401/403/400은 재시도가 무의미하다 — 크레딧 소진에도 재시도하던 Gemini 경로의 실수를 반복하지 않는다.
    return status === 429 || status === 500 || status === 529;
}

// 에러는 래핑하지 않고 원문 그대로 전파한다.
// APIError.message가 `${status} ${body}` 형태라 상위(search.ts)의 401/403 문자열 검사가 그대로 동작한다.
async function requestWithRetry(
    client: Anthropic,
    params: Anthropic.MessageCreateParamsNonStreaming
): Promise<Anthropic.Message> {
    try {
        return await client.messages.create(params);
    } catch (err) {
        if (err instanceof Anthropic.APIError && isRetryableStatus(err.status)) {
            await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1000));
            return await client.messages.create(params);
        }
        throw err;
    }
}

// 툴 없는 단발 호출 (email/json 경로)
async function callClaudeMessage(
    client: AiClient,
    systemPrompt: string,
    userPrompt: string
): Promise<ClaudeCallResult> {
    const anthropic = new Anthropic(clientOptions(client.apiKey));
    const message = await requestWithRetry(anthropic, {
        model: client.model,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
    });

    return {
        text: extractText(message.content),
        blocks: message.content,
        usage: toUsage(message.usage),
        truncated: message.stop_reason === "max_tokens",
        pausedOut: false,
    };
}

// web search 툴 + pause_turn 재개 루프 (search 경로).
// 재개 시 assistant 턴을 그대로 push해야 서버가 툴 상태를 이어받는다.
async function runSearchLoop(
    client: AiClient,
    systemPrompt: string,
    userPrompt: string
): Promise<ClaudeCallResult> {
    const anthropic = new Anthropic(clientOptions(client.apiKey));
    const messages: MessageParam[] = [{ role: "user", content: userPrompt }];
    const blocks: ContentBlock[] = [];
    const usage: TokenUsage = { promptTokens: 0, completionTokens: 0 };

    let truncated = false;
    let pausedOut = false;

    for (let attempt = 0; attempt <= MAX_SEARCH_CONTINUATIONS; attempt++) {
        const message = await requestWithRetry(anthropic, {
            model: client.model,
            max_tokens: MAX_TOKENS,
            system: systemPrompt,
            messages,
            tools: [SEARCH_TOOL],
        });

        blocks.push(...message.content);
        // 재개 요청도 각각 과금되므로 전 구간을 누적해야 쿼터가 맞는다.
        const turn = toUsage(message.usage);
        usage.promptTokens += turn.promptTokens;
        usage.completionTokens += turn.completionTokens;
        truncated = message.stop_reason === "max_tokens";

        if (message.stop_reason !== "pause_turn") {
            return { text: extractText(blocks), blocks, usage, truncated, pausedOut: false };
        }

        if (attempt === MAX_SEARCH_CONTINUATIONS) {
            pausedOut = true;
            break;
        }

        messages.push({ role: "assistant", content: message.content });
    }

    console.warn(
        `[AI] web search paused out: stop_reason=pause_turn, calls=${MAX_SEARCH_CONTINUATIONS + 1}, model=${client.model}`
    );
    return { text: extractText(blocks), blocks, usage, truncated, pausedOut };
}

export async function callClaudeEmail(
    client: AiClient,
    systemPrompt: string,
    userPrompt: string
): Promise<GenerateEmailResult> {
    const { text, usage, truncated } = await callClaudeMessage(client, systemPrompt, userPrompt);
    const parsed = extractJson(text, /\{[\s\S]*"subject"[\s\S]*"htmlBody"[\s\S]*\}/, truncated);

    return {
        subject: (parsed.subject as string).replace(/<[^>]*>/g, ""),
        htmlBody: parsed.htmlBody as string,
        usage,
    };
}

export async function callClaudeJson(
    client: AiClient,
    systemPrompt: string,
    userPrompt: string
): Promise<{ content: string; usage: TokenUsage }> {
    const { text, usage } = await callClaudeMessage(client, systemPrompt, userPrompt);
    return { content: text, usage };
}

export async function callClaudeWithSearch(
    client: AiClient,
    systemPrompt: string,
    userPrompt: string,
    jsonPattern: RegExp
): Promise<WebSearchResult> {
    const { text, blocks, usage, truncated } = await runSearchLoop(client, systemPrompt, userPrompt);

    return {
        parsed: extractJson(stripCitationTags(text), jsonPattern, truncated),
        sources: extractSearchSources(blocks),
        usage,
    };
}
