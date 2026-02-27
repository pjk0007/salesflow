import { db, aiConfigs, aiUsageLogs } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import type { Product } from "@/lib/db";

// ---- 타입 ----

interface AiClient {
    provider: "openai" | "anthropic";
    apiKey: string;
    model: string;
}

interface GenerateEmailInput {
    prompt: string;
    product?: Product | null;
    recordData?: Record<string, unknown> | null;
    tone?: string;
    ctaUrl?: string;
}

interface GenerateEmailResult {
    subject: string;
    htmlBody: string;
    usage: { promptTokens: number; completionTokens: number };
}

// ---- getAiClient ----

export async function getAiClient(orgId: string): Promise<AiClient | null> {
    const [config] = await db
        .select()
        .from(aiConfigs)
        .where(and(eq(aiConfigs.orgId, orgId), eq(aiConfigs.isActive, 1)))
        .limit(1);

    if (!config) return null;

    return {
        provider: config.provider as "openai" | "anthropic",
        apiKey: config.apiKey,
        model: config.model || (config.provider === "openai" ? "gpt-4.1" : "claude-sonnet-4-6"),
    };
}

// ---- 시스템 프롬프트 빌드 ----

function buildSystemPrompt(input: GenerateEmailInput): string {
    let prompt = `당신은 B2B 영업/마케팅 이메일 전문가입니다.
사용자의 지시에 따라 이메일을 작성해주세요.
반드시 JSON 형식으로 응답하세요: { "subject": "이메일 제목", "htmlBody": "<html>...</html>" }
htmlBody는 깔끔한 HTML 이메일이어야 합니다. 인라인 스타일을 사용하세요.`;

    if (input.product) {
        prompt += `\n\n[제품 정보]\n- 이름: ${input.product.name}`;
        if (input.product.summary) prompt += `\n- 소개: ${input.product.summary}`;
        if (input.product.description) prompt += `\n- 상세: ${input.product.description}`;
        if (input.product.price) prompt += `\n- 가격: ${input.product.price}`;
        if (input.product.url) prompt += `\n- 사이트: ${input.product.url}`;
    }

    // CTA URL + UTM
    const ctaUrl = input.ctaUrl || input.product?.url;
    if (ctaUrl) {
        prompt += `\n\n[CTA 링크 규칙]
- 이메일의 모든 CTA 버튼/링크 href에 다음 URL을 사용하세요: ${ctaUrl}
- URL에 UTM 파라미터를 추가하세요: utm_source=email&utm_medium=sales&utm_campaign=outreach
- 예시: ${ctaUrl}${ctaUrl.includes("?") ? "&" : "?"}utm_source=email&utm_medium=sales&utm_campaign=outreach
- "자세히 알아보기", "무료 시작하기" 등의 CTA 버튼에 모두 이 URL을 적용하세요.`;
    }

    if (input.recordData) {
        // _companyResearch 데이터가 있으면 별도 섹션으로 추가
        const companyResearch = input.recordData._companyResearch as Record<string, unknown> | undefined;
        if (companyResearch && typeof companyResearch === "object") {
            prompt += "\n\n[상대 회사 정보]";
            if (companyResearch.companyName) prompt += `\n- 회사명: ${companyResearch.companyName}`;
            if (companyResearch.industry) prompt += `\n- 업종: ${companyResearch.industry}`;
            if (companyResearch.description) prompt += `\n- 소개: ${companyResearch.description}`;
            if (companyResearch.services) prompt += `\n- 주요 서비스: ${companyResearch.services}`;
            if (companyResearch.employees) prompt += `\n- 규모: ${companyResearch.employees}`;
            if (companyResearch.website) prompt += `\n- 웹사이트: ${companyResearch.website}`;
        }

        prompt += "\n\n[수신자 정보]";
        for (const [key, value] of Object.entries(input.recordData)) {
            if (key.startsWith("_")) continue; // 내부 필드 제외
            if (value != null && value !== "") {
                prompt += `\n- ${key}: ${String(value)}`;
            }
        }
    }

    if (input.tone) {
        prompt += `\n\n[톤] ${input.tone}`;
    }

    return prompt;
}

// ---- generateEmail ----

export async function generateEmail(
    client: AiClient,
    input: GenerateEmailInput
): Promise<GenerateEmailResult> {
    const systemPrompt = buildSystemPrompt(input);

    if (client.provider === "openai") {
        return callOpenAI(client, systemPrompt, input.prompt);
    } else {
        return callAnthropic(client, systemPrompt, input.prompt);
    }
}

// ---- 스트리밍 이메일 생성 ----

export function buildEmailSystemPrompt(input: GenerateEmailInput): string {
    return buildSystemPrompt(input);
}

export type { AiClient, GenerateEmailInput };

// ---- OpenAI 호출 ----

async function callOpenAI(
    client: AiClient,
    systemPrompt: string,
    userPrompt: string
): Promise<GenerateEmailResult> {
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
            response_format: { type: "json_object" },
        }),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error?.message || "OpenAI API 호출에 실패했습니다.");
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;
    const parsed = JSON.parse(content);

    return {
        subject: parsed.subject,
        htmlBody: parsed.htmlBody,
        usage: {
            promptTokens: data.usage?.prompt_tokens ?? 0,
            completionTokens: data.usage?.completion_tokens ?? 0,
        },
    };
}

// ---- Anthropic 호출 ----

async function callAnthropic(
    client: AiClient,
    systemPrompt: string,
    userPrompt: string
): Promise<GenerateEmailResult> {
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
        }),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error?.message || "Anthropic API 호출에 실패했습니다.");
    }

    const data = await response.json();
    const textBlock = data.content?.find((b: { type: string }) => b.type === "text");
    const content = textBlock?.text || "";

    // 토큰 제한으로 잘렸는지 체크
    const truncated = data.stop_reason === "max_tokens";

    // JSON 파싱 (extractJson 3단계 폴백 활용 + 잘림 복구)
    const parsed = extractJson(content, /\{[\s\S]*"subject"[\s\S]*"htmlBody"[\s\S]*\}/, truncated);

    return {
        subject: parsed.subject as string,
        htmlBody: parsed.htmlBody as string,
        usage: {
            promptTokens: data.usage?.input_tokens ?? 0,
            completionTokens: data.usage?.output_tokens ?? 0,
        },
    };
}

// ---- 범용 웹 검색 호출 ----

function extractJson(content: string, jsonPattern: RegExp, truncated = false): Record<string, unknown> {
    // 1) Try regex pattern match first
    const jsonMatch = content.match(jsonPattern);
    if (jsonMatch) {
        try { return JSON.parse(jsonMatch[0]); } catch (e) {
            console.log("[extractJson] Step 1 match found but parse failed:", e);
        }
    }
    // 2) Try markdown code block ```json ... ```
    const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (codeBlockMatch) {
        try { return JSON.parse(codeBlockMatch[1].trim()); } catch (e) {
            console.log("[extractJson] Step 2 match found but parse failed:", e);
        }
    }
    // 3) Try finding any top-level JSON object with balanced braces
    const startIdx = content.indexOf("{");
    if (startIdx !== -1) {
        let depth = 0;
        for (let i = startIdx; i < content.length; i++) {
            if (content[i] === "{") depth++;
            else if (content[i] === "}") depth--;
            if (depth === 0) {
                const candidate = content.substring(startIdx, i + 1);
                try { return JSON.parse(candidate); } catch { /* fall through */ }
                break;
            }
        }
    }
    // 4) 잘린 JSON 복구 — subject와 htmlBody를 직접 추출
    if (truncated || content.includes('"subject"') || content.includes('"htmlBody"')) {
        const recovered = recoverTruncatedEmailJson(content);
        if (recovered) {
            console.log("[extractJson] Step 4: recovered truncated JSON");
            return recovered;
        }
    }
    console.log("[extractJson] All steps failed. Content chars:", JSON.stringify(content.substring(0, 300)));
    throw new Error("AI 응답에서 데이터를 파싱할 수 없습니다.");
}

/**
 * 토큰 제한으로 잘린 JSON에서 subject와 htmlBody를 직접 추출합니다.
 * { "subject": "...", "htmlBody": "..." } 형태에서 각 값을 regex로 꺼냅니다.
 */
function recoverTruncatedEmailJson(content: string): Record<string, unknown> | null {
    // subject 추출
    const subjectMatch = content.match(/"subject"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (!subjectMatch) return null;

    // htmlBody 추출 — 값이 잘렸을 수 있으므로 시작 위치부터 끝까지 가져옴
    const htmlBodyStart = content.match(/"htmlBody"\s*:\s*"/);
    if (!htmlBodyStart || htmlBodyStart.index === undefined) return null;

    const valueStart = htmlBodyStart.index + htmlBodyStart[0].length;
    let htmlBody = "";
    let i = valueStart;
    // escaped string 파싱
    while (i < content.length) {
        if (content[i] === "\\" && i + 1 < content.length) {
            const next = content[i + 1];
            if (next === "n") { htmlBody += "\n"; i += 2; continue; }
            if (next === "t") { htmlBody += "\t"; i += 2; continue; }
            if (next === '"') { htmlBody += '"'; i += 2; continue; }
            if (next === "\\") { htmlBody += "\\"; i += 2; continue; }
            htmlBody += next; i += 2; continue;
        }
        if (content[i] === '"') break; // 정상 종료
        htmlBody += content[i];
        i++;
    }

    if (!htmlBody) return null;

    return { subject: subjectMatch[1], htmlBody };
}

interface WebSearchResult {
    parsed: Record<string, unknown>;
    sources: Array<{ url: string; title: string }>;
    usage: { promptTokens: number; completionTokens: number };
}

async function callOpenAIWithSearch(
    client: AiClient,
    systemPrompt: string,
    userPrompt: string,
    jsonPattern: RegExp
): Promise<WebSearchResult> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${client.apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: "gpt-4o-search-preview",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ],
            web_search_options: {
                user_location: {
                    type: "approximate",
                    approximate: { country: "KR" },
                },
            },
        }),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error?.message || "OpenAI API 호출에 실패했습니다.");
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content || "";

    console.log("[OpenAI WebSearch] Raw content length:", content.length);
    console.log("[OpenAI WebSearch] Content preview:", content.substring(0, 500));

    const parsed = extractJson(content, jsonPattern);

    const annotations = data.choices[0]?.message?.annotations ?? [];
    const sources = annotations
        .filter((a: { type: string }) => a.type === "url_citation")
        .map((a: { url: string; title?: string }) => ({
            url: a.url,
            title: a.title || a.url,
        }));

    return {
        parsed,
        sources,
        usage: {
            promptTokens: data.usage?.prompt_tokens ?? 0,
            completionTokens: data.usage?.completion_tokens ?? 0,
        },
    };
}

async function callAnthropicWithSearch(
    client: AiClient,
    systemPrompt: string,
    userPrompt: string,
    jsonPattern: RegExp
): Promise<WebSearchResult> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "x-api-key": client.apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: client.model,
            max_tokens: 4096,
            system: systemPrompt,
            messages: [{ role: "user", content: userPrompt }],
            tools: [
                {
                    type: "web_search_20250305",
                    name: "web_search",
                    max_uses: 3,
                },
            ],
        }),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error?.message || "Anthropic API 호출에 실패했습니다.");
    }

    const data = await response.json();

    console.log("[Anthropic WebSearch] stop_reason:", data.stop_reason);
    console.log("[Anthropic WebSearch] content blocks:", data.content?.map((b: { type: string }) => b.type));

    // web_search_tool_result 블록에서 소스 추출
    const searchResults: Array<{ url: string; title: string }> = [];
    for (const block of data.content ?? []) {
        if (block.type === "server_tool_use" && block.name === "web_search") {
            console.log("[Anthropic WebSearch] Search query:", block.input?.query);
        }
        if (block.type === "web_search_tool_result") {
            for (const result of block.content ?? []) {
                if (result.type === "web_search_result" && result.url) {
                    searchResults.push({ url: result.url, title: result.title || result.url });
                }
            }
        }
    }
    console.log("[Anthropic WebSearch] Search results found:", searchResults.length);

    const textBlock = data.content?.find(
        (b: { type: string }) => b.type === "text"
    );
    const content = textBlock?.text || "";
    console.log("[Anthropic WebSearch] Text content preview:", content.substring(0, 300));

    const parsed = extractJson(content, jsonPattern);

    const sources: Array<{ url: string; title: string }> = [];
    // 1) web_search_tool_result에서 가져온 소스
    sources.push(...searchResults);
    // 2) textBlock citations에서 추가
    if (textBlock?.citations) {
        for (const cite of textBlock.citations) {
            if (cite.type === "web_search_result_location" && cite.url) {
                if (!sources.some((s) => s.url === cite.url)) {
                    sources.push({ url: cite.url, title: cite.title || cite.url });
                }
            }
        }
    }

    return {
        parsed,
        sources,
        usage: {
            promptTokens: data.usage?.input_tokens ?? 0,
            completionTokens: data.usage?.output_tokens ?? 0,
        },
    };
}

// ---- 제품 생성 ----

interface GenerateProductInput {
    prompt: string;
}

interface GenerateProductResult {
    name: string;
    summary: string;
    description: string;
    category: string;
    price: string;
    url?: string;
    imageUrl?: string;
    sources: Array<{ url: string; title: string }>;
    usage: { promptTokens: number; completionTokens: number };
}

function buildProductSystemPrompt(): string {
    return `당신은 제품/서비스 정보 조사 전문가입니다.
사용자가 제품명, URL, 또는 키워드를 제공하면:
1. 웹 검색으로 해당 제품/서비스의 최신 정보를 조사합니다
2. 조사 결과를 바탕으로 다음 JSON을 반드시 반환합니다:

{
  "name": "정확한 제품/서비스명",
  "summary": "한줄 소개 (50자 이내)",
  "description": "제품의 특징, 장점, 대상 고객을 포함한 상세 설명 (200-500자)",
  "category": "카테고리 (예: SaaS, 하드웨어, 컨설팅 등)",
  "price": "가격 정보 (예: 월 9,900원, 연 120만원, 무료 등)",
  "url": "공식 웹사이트 URL (예: https://example.com)",
  "imageUrl": "제품 로고 또는 대표 이미지 URL (찾을 수 없으면 빈 문자열)"
}

중요:
- 반드시 JSON 형식으로만 응답하세요
- 가격을 찾을 수 없으면 "문의" 로 표시
- 한국어로 작성하세요
- url은 제품/서비스의 공식 웹사이트 URL을 정확히 기재하세요
- imageUrl은 공식 웹사이트의 이미지만 사용하세요`;
}

export async function generateProduct(
    client: AiClient,
    input: GenerateProductInput
): Promise<GenerateProductResult> {
    const systemPrompt = buildProductSystemPrompt();
    const pattern = /\{[\s\S]*"name"[\s\S]*"description"[\s\S]*\}/;

    const result = client.provider === "openai"
        ? await callOpenAIWithSearch(client, systemPrompt, input.prompt, pattern)
        : await callAnthropicWithSearch(client, systemPrompt, input.prompt, pattern);

    return {
        name: result.parsed.name as string || "",
        summary: result.parsed.summary as string || "",
        description: result.parsed.description as string || "",
        category: result.parsed.category as string || "",
        price: result.parsed.price as string || "",
        url: (result.parsed.url as string) || undefined,
        imageUrl: (result.parsed.imageUrl as string) || undefined,
        sources: result.sources,
        usage: result.usage,
    };
}

// ---- 회사 조사 ----

interface CompanyResearchInput {
    companyName: string;
}

export interface CompanyResearchResult {
    companyName: string;
    industry: string;
    description: string;
    services: string;
    employees: string;
    website: string;
    sources: Array<{ url: string; title: string }>;
    usage: { promptTokens: number; completionTokens: number };
}

function buildCompanyResearchSystemPrompt(): string {
    return `당신은 기업 정보 조사 전문가입니다.

중요: 반드시 웹 검색(web_search)을 먼저 실행한 후 결과를 기반으로 답변하세요.
사전 지식만으로 답변하지 마세요. 반드시 실시간 웹 검색을 수행해야 합니다.

절차:
1. 사용자가 제공한 회사명으로 웹 검색을 실행합니다.
2. 검색 결과를 분석하여 아래 JSON 형식으로 정리합니다.
3. JSON만 반환합니다.

반환 형식:
{
  "companyName": "정확한 회사/기관명 (법인명 또는 브랜드명)",
  "industry": "업종 (예: IT, 건축/인테리어, 제조, 금융 등)",
  "description": "회사 소개 — 주요 사업 분야, 설립 배경, 시장 위치, 특징 등 (200-500자)",
  "services": "주요 제품/서비스 목록 (쉼표로 구분)",
  "employees": "직원 수 또는 기업 규모 (예: 약 50명, 중소기업 등)",
  "website": "공식 웹사이트 URL"
}

규칙:
- 반드시 웹 검색을 실행한 후 응답하세요.
- JSON 외의 텍스트를 포함하지 마세요.
- 검색 결과가 부족하더라도 찾은 만큼 JSON에 채워서 반환하세요.
- 정보를 찾을 수 없는 항목은 "정보 없음"으로 표시하세요.
- 한국어로 작성하세요`;
}

export async function generateCompanyResearch(
    client: AiClient,
    input: CompanyResearchInput
): Promise<CompanyResearchResult> {
    const systemPrompt = buildCompanyResearchSystemPrompt();
    const pattern = /\{[\s\S]*"companyName"[\s\S]*"description"[\s\S]*\}/;

    const userPrompt = `"${input.companyName}" 회사(기업)에 대해 웹 검색을 수행하고, 업종, 주요 서비스, 기업 규모, 공식 웹사이트 정보를 JSON으로 알려주세요.`;

    console.log("[CompanyResearch] provider:", client.provider, "model:", client.model);

    let result: WebSearchResult;
    try {
        result = client.provider === "openai"
            ? await callOpenAIWithSearch(client, systemPrompt, userPrompt, pattern)
            : await callAnthropicWithSearch(client, systemPrompt, userPrompt, pattern);
    } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        // API 인증/크레딧/네트워크 에러는 사용자에게 전파
        if (msg.includes("credit") || msg.includes("API") || msg.includes("key") || msg.includes("auth") || msg.includes("401") || msg.includes("403")) {
            throw err;
        }
        // JSON 파싱 실패 — 검색 결과 없음으로 처리
        return {
            companyName: input.companyName,
            industry: "정보 없음",
            description: "해당 회사에 대한 정보를 찾을 수 없습니다. 회사명을 확인하거나 더 구체적인 이름을 입력해주세요.",
            services: "정보 없음",
            employees: "정보 없음",
            website: "정보 없음",
            sources: [],
            usage: { promptTokens: 0, completionTokens: 0 },
        };
    }

    return {
        companyName: result.parsed.companyName as string || input.companyName,
        industry: result.parsed.industry as string || "정보 없음",
        description: result.parsed.description as string || "정보 없음",
        services: result.parsed.services as string || "정보 없음",
        employees: result.parsed.employees as string || "정보 없음",
        website: result.parsed.website as string || "정보 없음",
        sources: result.sources,
        usage: result.usage,
    };
}

// ---- 웹폼 생성 ----

interface GenerateWebFormInput {
    prompt: string;
    workspaceFields?: Array<{ key: string; label: string }>;
}

interface GenerateWebFormField {
    label: string;
    description: string;
    placeholder: string;
    fieldType: string;
    linkedFieldKey: string;
    isRequired: boolean;
    options: string[];
}

interface GenerateWebFormResult {
    name: string;
    title: string;
    description: string;
    fields: GenerateWebFormField[];
    usage: { promptTokens: number; completionTokens: number };
}

function buildWebFormSystemPrompt(workspaceFields?: Array<{ key: string; label: string }>): string {
    let prompt = `당신은 웹폼 필드 설계 전문가입니다.
사용자의 요청에 맞는 웹 폼을 설계하세요.

반드시 다음 JSON 형식으로 응답하세요:
{
  "name": "폼 관리용 이름 (짧고 간결하게, 예: 무료체험 신청)",
  "title": "폼 제목 (사용자에게 보이는 제목)",
  "description": "폼 설명",
  "fields": [
    {
      "label": "필드 이름",
      "description": "",
      "placeholder": "플레이스홀더",
      "fieldType": "text",
      "linkedFieldKey": "",
      "isRequired": true,
      "options": []
    }
  ]
}

규칙:
- fieldType은 text, email, phone, textarea, select, checkbox, date 중 하나만 사용
- 이메일 수집 필드는 반드시 fieldType: "email" 사용
- 전화번호는 fieldType: "phone" 사용
- select 타입은 options 배열 필수, 나머지는 빈 배열 []
- 한국어로 작성
- 5~10개 적절한 필드 생성
- JSON만 반환하세요`;

    if (workspaceFields && workspaceFields.length > 0) {
        prompt += `\n\n[워크스페이스 필드 목록]\n이 필드들과 매핑 가능한 폼 필드는 linkedFieldKey에 해당 key를 설정하세요.`;
        for (const f of workspaceFields) {
            prompt += `\n- ${f.key} (${f.label})`;
        }
    }

    return prompt;
}

export async function generateWebForm(
    client: AiClient,
    input: GenerateWebFormInput
): Promise<GenerateWebFormResult> {
    const systemPrompt = buildWebFormSystemPrompt(input.workspaceFields);
    const pattern = /\{[\s\S]*"title"[\s\S]*"fields"[\s\S]*\}/;

    let content: string;
    let usage: { promptTokens: number; completionTokens: number };

    if (client.provider === "openai") {
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
                    { role: "user", content: input.prompt },
                ],
                response_format: { type: "json_object" },
            }),
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error?.error?.message || "OpenAI API 호출에 실패했습니다.");
        }
        const data = await response.json();
        content = data.choices[0]?.message?.content || "";
        usage = {
            promptTokens: data.usage?.prompt_tokens ?? 0,
            completionTokens: data.usage?.completion_tokens ?? 0,
        };
    } else {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "x-api-key": client.apiKey,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: client.model,
                max_tokens: 4096,
                system: systemPrompt,
                messages: [{ role: "user", content: input.prompt }],
            }),
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error?.error?.message || "Anthropic API 호출에 실패했습니다.");
        }
        const data = await response.json();
        const textBlock = data.content?.find((b: { type: string }) => b.type === "text");
        content = textBlock?.text || "";
        usage = {
            promptTokens: data.usage?.input_tokens ?? 0,
            completionTokens: data.usage?.output_tokens ?? 0,
        };
    }

    const parsed = extractJson(content, pattern);
    const fields = (parsed.fields as any[] || []).map((f: any) => ({
        label: f.label || "",
        description: f.description || "",
        placeholder: f.placeholder || "",
        fieldType: f.fieldType || "text",
        linkedFieldKey: f.linkedFieldKey || "",
        isRequired: !!f.isRequired,
        options: Array.isArray(f.options) ? f.options : [],
    }));

    return {
        name: parsed.name as string || "",
        title: parsed.title as string || "",
        description: parsed.description as string || "",
        fields,
        usage,
    };
}

// ---- 대시보드 생성 ----

interface GenerateDashboardInput {
    prompt: string;
    workspaceFields: Array<{ key: string; label: string; fieldType: string }>;
}

interface GenerateDashboardWidget {
    title: string;
    widgetType: string;
    dataColumn: string;
    aggregation: string;
    groupByColumn: string;
    stackByColumn: string;
}

interface GenerateDashboardResult {
    name: string;
    widgets: GenerateDashboardWidget[];
    usage: { promptTokens: number; completionTokens: number };
}

function buildDashboardSystemPrompt(workspaceFields: Array<{ key: string; label: string; fieldType: string }>): string {
    let prompt = `당신은 데이터 대시보드 설계 전문가입니다.
사용자의 요청에 맞는 대시보드를 설계하세요.

반드시 다음 JSON 형식으로 응답하세요:
{
  "name": "대시보드 이름",
  "widgets": [
    {
      "title": "위젯 제목",
      "widgetType": "scorecard",
      "dataColumn": "필드 key",
      "aggregation": "count",
      "groupByColumn": "",
      "stackByColumn": ""
    }
  ]
}

규칙:
- widgetType: scorecard, bar, bar_horizontal, bar_stacked, line, donut 중 하나
- scorecard는 groupByColumn 빈 문자열 ""
- bar_stacked만 stackByColumn 사용, 나머지는 빈 문자열 ""
- dataColumn과 groupByColumn은 반드시 아래 워크스페이스 필드 목록의 key 값 사용
- aggregation: count, sum, avg 중 하나
- 3~8개 적절한 위젯 생성
- 첫 위젯은 scorecard로 전체 건수 요약 권장
- 한국어로 작성
- JSON만 반환하세요`;

    if (workspaceFields.length > 0) {
        prompt += `\n\n[워크스페이스 필드 목록]`;
        for (const f of workspaceFields) {
            prompt += `\n- ${f.key} (${f.label}) [${f.fieldType}]`;
        }
    }

    return prompt;
}

export async function generateDashboard(
    client: AiClient,
    input: GenerateDashboardInput
): Promise<GenerateDashboardResult> {
    const systemPrompt = buildDashboardSystemPrompt(input.workspaceFields);
    const pattern = /\{[\s\S]*"name"[\s\S]*"widgets"[\s\S]*\}/;

    let content: string;
    let usage: { promptTokens: number; completionTokens: number };

    if (client.provider === "openai") {
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
                    { role: "user", content: input.prompt },
                ],
                response_format: { type: "json_object" },
            }),
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error?.error?.message || "OpenAI API 호출에 실패했습니다.");
        }
        const data = await response.json();
        content = data.choices[0]?.message?.content || "";
        usage = {
            promptTokens: data.usage?.prompt_tokens ?? 0,
            completionTokens: data.usage?.completion_tokens ?? 0,
        };
    } else {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "x-api-key": client.apiKey,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: client.model,
                max_tokens: 4096,
                system: systemPrompt,
                messages: [{ role: "user", content: input.prompt }],
            }),
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error?.error?.message || "Anthropic API 호출에 실패했습니다.");
        }
        const data = await response.json();
        const textBlock = data.content?.find((b: { type: string }) => b.type === "text");
        content = textBlock?.text || "";
        usage = {
            promptTokens: data.usage?.input_tokens ?? 0,
            completionTokens: data.usage?.output_tokens ?? 0,
        };
    }

    const parsed = extractJson(content, pattern);
    const widgets = (parsed.widgets as any[] || []).map((w: any) => ({
        title: w.title || "",
        widgetType: w.widgetType || "scorecard",
        dataColumn: w.dataColumn || "",
        aggregation: w.aggregation || "count",
        groupByColumn: w.groupByColumn || "",
        stackByColumn: w.stackByColumn || "",
    }));

    return {
        name: parsed.name as string || "",
        widgets,
        usage,
    };
}

// ---- 위젯 설정 생성 ----

interface GenerateWidgetInput {
    prompt: string;
    workspaceFields: Array<{ key: string; label: string; fieldType: string }>;
}

interface GenerateWidgetResult {
    title: string;
    widgetType: string;
    dataColumn: string;
    aggregation: string;
    groupByColumn: string;
    stackByColumn: string;
    usage: { promptTokens: number; completionTokens: number };
}

function buildWidgetSystemPrompt(workspaceFields: Array<{ key: string; label: string; fieldType: string }>): string {
    let prompt = `당신은 데이터 대시보드 위젯 설정 전문가입니다.
사용자의 요청에 맞는 위젯 1개를 설계하세요.

반드시 다음 JSON 형식으로 응답하세요:
{
  "title": "위젯 제목",
  "widgetType": "bar",
  "dataColumn": "필드 key",
  "aggregation": "count",
  "groupByColumn": "필드 key 또는 빈 문자열",
  "stackByColumn": ""
}

규칙:
- widgetType: scorecard, bar, bar_horizontal, bar_stacked, line, donut 중 하나
- scorecard는 groupByColumn 빈 문자열 ""
- bar_stacked만 stackByColumn 사용, 나머지는 빈 문자열 ""
- dataColumn과 groupByColumn은 반드시 아래 필드 목록의 key 값 사용
- aggregation: count, sum, avg 중 하나
- 한국어로 제목 작성
- JSON만 반환하세요

[시스템 필드 - 날짜 기반 그룹핑에 사용]
- _sys:registeredAt (등록일시)
- _sys:createdAt (생성일시)
- _sys:updatedAt (수정일시)`;

    if (workspaceFields.length > 0) {
        prompt += `\n\n[워크스페이스 필드 목록]`;
        for (const f of workspaceFields) {
            prompt += `\n- ${f.key} (${f.label}) [${f.fieldType}]`;
        }
    }

    return prompt;
}

export async function generateWidget(
    client: AiClient,
    input: GenerateWidgetInput
): Promise<GenerateWidgetResult> {
    const systemPrompt = buildWidgetSystemPrompt(input.workspaceFields);
    const pattern = /\{[\s\S]*"title"[\s\S]*"widgetType"[\s\S]*\}/;

    let content: string;
    let usage: { promptTokens: number; completionTokens: number };

    if (client.provider === "openai") {
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
                    { role: "user", content: input.prompt },
                ],
                response_format: { type: "json_object" },
            }),
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error?.error?.message || "OpenAI API 호출에 실패했습니다.");
        }
        const data = await response.json();
        content = data.choices[0]?.message?.content || "";
        usage = {
            promptTokens: data.usage?.prompt_tokens ?? 0,
            completionTokens: data.usage?.completion_tokens ?? 0,
        };
    } else {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "x-api-key": client.apiKey,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: client.model,
                max_tokens: 2048,
                system: systemPrompt,
                messages: [{ role: "user", content: input.prompt }],
            }),
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error?.error?.message || "Anthropic API 호출에 실패했습니다.");
        }
        const data = await response.json();
        const textBlock = data.content?.find((b: { type: string }) => b.type === "text");
        content = textBlock?.text || "";
        usage = {
            promptTokens: data.usage?.input_tokens ?? 0,
            completionTokens: data.usage?.output_tokens ?? 0,
        };
    }

    const parsed = extractJson(content, pattern);

    return {
        title: (parsed.title as string) || "",
        widgetType: (parsed.widgetType as string) || "scorecard",
        dataColumn: (parsed.dataColumn as string) || "",
        aggregation: (parsed.aggregation as string) || "count",
        groupByColumn: (parsed.groupByColumn as string) || "",
        stackByColumn: (parsed.stackByColumn as string) || "",
        usage,
    };
}

// ---- 사용량 로깅 ----

export async function logAiUsage(params: {
    orgId: string;
    userId: string;
    provider: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    purpose: string;
}) {
    await db.insert(aiUsageLogs).values(params);
}
