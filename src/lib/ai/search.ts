import type { AiClient } from "./client";
import type { Product } from "@/lib/db";
import { callGeminiWithSearch, type WebSearchResult } from "./gemini";

// ---- 제품 생성 (웹서칭) ----

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

    const result = await callGeminiWithSearch(client, systemPrompt, input.prompt, pattern);

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

// ---- 회사 조사 (웹서칭) ----

interface CompanyResearchInput {
    companyName: string;
    additionalContext?: Record<string, unknown>;
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

    let userPrompt = `"${input.companyName}" 회사(기업)에 대해 웹 검색을 수행하고, 업종, 주요 서비스, 기업 규모, 공식 웹사이트 정보를 JSON으로 알려주세요.`;

    if (input.additionalContext && Object.keys(input.additionalContext).length > 0) {
        const hints: string[] = [];
        for (const [key, val] of Object.entries(input.additionalContext)) {
            if (val && typeof val === "string" && val.trim() && !key.startsWith("_")) {
                hints.push(`${key}: ${val}`);
            }
        }
        if (hints.length > 0) {
            userPrompt += `\n\n참고 정보 (검색 정확도를 높이는 데 활용하세요):\n${hints.join("\n")}`;
        }
    }

    let result: WebSearchResult;
    try {
        result = await callGeminiWithSearch(client, systemPrompt, userPrompt, pattern);
    } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (msg.includes("credit") || msg.includes("API") || msg.includes("key") || msg.includes("auth") || msg.includes("401") || msg.includes("403")) {
            throw err;
        }
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

// ---- 레코드 자동 보강 (웹검색) ----

interface FieldEnrichmentInput {
    searchValue: string;
    fields: Array<{ key: string; label: string }>;
    additionalContext?: Record<string, unknown>;
}

interface FieldEnrichmentResult {
    data: Record<string, string>;
    sources: Array<{ url: string; title: string }>;
    usage: { promptTokens: number; completionTokens: number };
}

function buildFieldEnrichmentSystemPrompt(fields: Array<{ key: string; label: string }>): string {
    const fieldList = fields.map((f) => `  "${f.key}": "${f.label}에 해당하는 값"`).join(",\n");
    return `당신은 기업/조직 정보 조사 전문가입니다.
중요: 반드시 웹 검색(web_search)을 먼저 실행한 후 결과를 기반으로 답변하세요.

절차:
1. 사용자가 제공한 검색어로 웹 검색을 실행합니다.
2. 검색 결과를 분석하여 아래 JSON 형식으로 정리합니다.
3. JSON만 반환합니다.

반환 형식:
{
${fieldList}
}

규칙:
- 반드시 웹 검색을 실행한 후 응답하세요.
- JSON 외의 텍스트를 포함하지 마세요.
- 정보를 찾을 수 없는 항목은 빈 문자열("")로 표시하세요.
- 한국어로 작성하세요.`;
}

export async function generateFieldEnrichment(
    client: AiClient,
    input: FieldEnrichmentInput
): Promise<FieldEnrichmentResult> {
    const systemPrompt = buildFieldEnrichmentSystemPrompt(input.fields);
    const keys = input.fields.map((f) => `"${f.key}"`).join("|");
    const pattern = new RegExp(`\\{[\\s\\S]*(${keys})[\\s\\S]*\\}`);

    let userPrompt = `"${input.searchValue}"에 대해 웹 검색을 수행하고, 관련 정보를 JSON으로 알려주세요.`;

    if (input.additionalContext && Object.keys(input.additionalContext).length > 0) {
        const hints: string[] = [];
        for (const [key, val] of Object.entries(input.additionalContext)) {
            if (val && typeof val === "string" && val.trim() && !key.startsWith("_")) {
                hints.push(`${key}: ${val}`);
            }
        }
        if (hints.length > 0) {
            userPrompt += `\n\n참고 정보:\n${hints.join("\n")}`;
        }
    }

    try {
        const result = await callGeminiWithSearch(client, systemPrompt, userPrompt, pattern);
        const data: Record<string, string> = {};
        for (const f of input.fields) {
            const val = result.parsed[f.key];
            if (val && typeof val === "string" && val.trim()) {
                data[f.key] = val;
            }
        }
        return { data, sources: result.sources, usage: result.usage };
    } catch {
        return { data: {}, sources: [], usage: { promptTokens: 0, completionTokens: 0 } };
    }
}
