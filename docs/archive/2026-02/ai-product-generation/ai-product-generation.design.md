# Design: AI 제품 생성 (ai-product-generation)

> Plan: [ai-product-generation.plan.md](../../01-plan/features/ai-product-generation.plan.md)

## 1. DB 스키마

DB 변경 없음. 기존 `aiUsageLogs` 테이블 재사용 (purpose = "product_generation").

## 2. AI 유틸리티 확장

### 2.1 src/lib/ai.ts — 타입 추가

```typescript
// ---- 제품 생성 타입 ----

interface GenerateProductInput {
    prompt: string; // 제품명, URL, 또는 설명 키워드
}

interface GenerateProductResult {
    name: string;
    summary: string;
    description: string;
    category: string;
    price: string;
    imageUrl?: string;
    sources: Array<{ url: string; title: string }>; // 웹 검색 출처
    usage: { promptTokens: number; completionTokens: number };
}
```

### 2.2 src/lib/ai.ts — generateProduct 함수

기존 `callOpenAI`, `callAnthropic`과 별도로 웹 검색 전용 함수 추가. 웹 검색 활성화 방식이 provider별로 근본적으로 다르므로 분리.

```typescript
// ---- generateProduct (웹 검색 포함) ----

export async function generateProduct(
    client: AiClient,
    input: GenerateProductInput
): Promise<GenerateProductResult> {
    if (client.provider === "openai") {
        return callOpenAIWithSearch(client, input.prompt);
    } else {
        return callAnthropicWithSearch(client, input.prompt);
    }
}
```

### 2.3 callOpenAIWithSearch

OpenAI는 `gpt-4o-search-preview` 모델을 사용하면 웹 검색이 자동 활성화됨.
**주의**: 설정된 model을 무시하고 `gpt-4o-search-preview`를 강제 사용. 일반 모델은 검색 불가.

```typescript
async function callOpenAIWithSearch(
    client: AiClient,
    userPrompt: string
): Promise<GenerateProductResult> {
    const systemPrompt = buildProductSystemPrompt();

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
                user_location: { type: "approximate", country: "KR" },
            },
        }),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error?.message || "OpenAI API 호출에 실패했습니다.");
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content || "";

    // JSON 파싱 (웹 검색 결과에는 response_format 미지원이므로 수동 추출)
    const jsonMatch = content.match(/\{[\s\S]*"name"[\s\S]*"description"[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI 응답에서 제품 데이터를 파싱할 수 없습니다.");
    const parsed = JSON.parse(jsonMatch[0]);

    // annotations에서 출처 URL 추출
    const annotations = data.choices[0]?.message?.annotations ?? [];
    const sources = annotations
        .filter((a: { type: string }) => a.type === "url_citation")
        .map((a: { url: string; title?: string }) => ({
            url: a.url,
            title: a.title || a.url,
        }));

    return {
        name: parsed.name || "",
        summary: parsed.summary || "",
        description: parsed.description || "",
        category: parsed.category || "",
        price: parsed.price || "",
        imageUrl: parsed.imageUrl || undefined,
        sources,
        usage: {
            promptTokens: data.usage?.prompt_tokens ?? 0,
            completionTokens: data.usage?.completion_tokens ?? 0,
        },
    };
}
```

### 2.4 callAnthropicWithSearch

Anthropic은 `web_search_20250305` 서버 도구를 tools 배열에 추가. Claude가 자동으로 웹 검색 실행.

```typescript
async function callAnthropicWithSearch(
    client: AiClient,
    userPrompt: string
): Promise<GenerateProductResult> {
    const systemPrompt = buildProductSystemPrompt();

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

    // text 블록에서 JSON 추출
    const textBlock = data.content?.find(
        (b: { type: string }) => b.type === "text"
    );
    const content = textBlock?.text || "";

    const jsonMatch = content.match(/\{[\s\S]*"name"[\s\S]*"description"[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI 응답에서 제품 데이터를 파싱할 수 없습니다.");
    const parsed = JSON.parse(jsonMatch[0]);

    // citations에서 출처 URL 추출
    const sources: Array<{ url: string; title: string }> = [];
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
        name: parsed.name || "",
        summary: parsed.summary || "",
        description: parsed.description || "",
        category: parsed.category || "",
        price: parsed.price || "",
        imageUrl: parsed.imageUrl || undefined,
        sources,
        usage: {
            promptTokens: data.usage?.input_tokens ?? 0,
            completionTokens: data.usage?.output_tokens ?? 0,
        },
    };
}
```

### 2.5 buildProductSystemPrompt

```typescript
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
  "imageUrl": "제품 로고 또는 대표 이미지 URL (찾을 수 없으면 빈 문자열)"
}

중요:
- 반드시 JSON 형식으로만 응답하세요
- 가격을 찾을 수 없으면 "문의" 로 표시
- 한국어로 작성하세요
- imageUrl은 공식 웹사이트의 이미지만 사용하세요`;
}
```

## 3. API 엔드포인트

### 3.1 POST /api/ai/generate-product

**파일**: `src/pages/api/ai/generate-product.ts` (신규)

```typescript
import type { NextApiRequest, NextApiResponse } from "next";
import { getUserFromRequest } from "@/lib/auth";
import { getAiClient, generateProduct, logAiUsage } from "@/lib/ai";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    const client = await getAiClient(user.orgId);
    if (!client) {
        return res.status(400).json({
            success: false,
            error: "AI 설정이 필요합니다. 설정 > AI 탭에서 API 키를 등록해주세요.",
        });
    }

    const { prompt } = req.body;
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
        return res.status(400).json({ success: false, error: "제품명 또는 URL을 입력해주세요." });
    }

    try {
        const result = await generateProduct(client, { prompt: prompt.trim() });

        // 사용량 로깅
        await logAiUsage({
            orgId: user.orgId,
            userId: user.userId,
            provider: client.provider,
            model: client.provider === "openai" ? "gpt-4o-search-preview" : client.model,
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            purpose: "product_generation",
        });

        return res.status(200).json({
            success: true,
            data: {
                name: result.name,
                summary: result.summary,
                description: result.description,
                category: result.category,
                price: result.price,
                imageUrl: result.imageUrl,
                sources: result.sources,
            },
        });
    } catch (error) {
        console.error("AI product generation error:", error);
        const message = error instanceof Error ? error.message : "AI 제품 생성에 실패했습니다.";
        return res.status(500).json({ success: false, error: message });
    }
}
```

**타임아웃**: Next.js API route는 기본 60초. 웹 검색 포함 시 최대 30초 소요 예상되므로 기본값으로 충분.

## 4. SWR 훅

### 4.1 src/hooks/useAiProduct.ts (신규)

```typescript
import { useState } from "react";

interface GenerateProductInput {
    prompt: string;
}

interface GenerateProductResult {
    name: string;
    summary: string;
    description: string;
    category: string;
    price: string;
    imageUrl?: string;
    sources: Array<{ url: string; title: string }>;
}

export function useAiProduct() {
    const [isGenerating, setIsGenerating] = useState(false);

    const generateProduct = async (input: GenerateProductInput): Promise<{
        success: boolean;
        data?: GenerateProductResult;
        error?: string;
    }> => {
        setIsGenerating(true);
        try {
            const res = await fetch("/api/ai/generate-product", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(input),
            });
            return await res.json();
        } catch {
            return { success: false, error: "서버에 연결할 수 없습니다." };
        } finally {
            setIsGenerating(false);
        }
    };

    return { generateProduct, isGenerating };
}
```

## 5. UI 컴포넌트

### 5.1 AiProductPanel (신규)

**파일**: `src/components/products/AiProductPanel.tsx`

프롬프트 입력 → AI 제품 생성 → 결과 + 출처 표시 → 폼 필드 채움

**Props**:
```typescript
interface AiProductPanelProps {
    onGenerated: (result: {
        name: string;
        summary: string;
        description: string;
        category: string;
        price: string;
        imageUrl?: string;
        sources: Array<{ url: string; title: string }>;
    }) => void;
}
```

**구조**:
```
div.space-y-3.p-3.bg-muted/50.rounded-lg.border.border-dashed
├── div.space-y-1.5:
│   ├── Label: "제품명, URL, 또는 키워드"
│   └── Input (placeholder="예: Notion, https://notion.so, 프로젝트 관리 SaaS")
├── p.text-xs.text-muted-foreground: "AI가 웹을 검색하여 제품 정보를 자동으로 조사합니다"
├── Button.w-full: "AI로 제품 정보 생성" (Sparkles icon)
│   └── isGenerating 시: Loader2 + "웹 검색 중..." (검색이 오래 걸릴 수 있으므로 안내)
└── (sources가 있을 때) div.text-xs.text-muted-foreground:
    ├── "출처:"
    └── sources.map → a 태그 (href, target="_blank", rel="noopener noreferrer")
```

**동작**:
1. 사용자가 제품명/URL/키워드 입력
2. "AI로 제품 정보 생성" 클릭 → `useAiProduct().generateProduct` 호출
3. 성공 시 → `onGenerated(result)` 콜백 + 출처 URL 표시
4. 실패 시 → `toast.error(message)`
5. 출처 URL은 패널 내부에 표시 (외부 링크)

### 5.2 ProductDialog 수정

**파일**: `src/components/products/ProductDialog.tsx`

변경사항 (EmailTemplateDialog 패턴 동일):
- `showAiPanel` state 추가 (boolean, default false)
- `useAiConfig` 훅으로 AI 설정 존재 여부 확인
- DialogTitle 옆에 AI 토글 버튼 (Sparkles icon) — AI 설정 없으면 숨김
- `showAiPanel && !isEdit` 조건에서만 AiProductPanel 표시 (수정 시에는 미표시)
- `onGenerated` 콜백: 모든 폼 필드 자동 채움 (name, summary, description, category, price, imageUrl)

**수정 범위 상세**:

```typescript
// import 추가
import { Sparkles } from "lucide-react";
import { useAiConfig } from "@/hooks/useAiConfig";
import AiProductPanel from "./AiProductPanel";

// state 추가 (기존 state들 아래)
const [showAiPanel, setShowAiPanel] = useState(false);
const { config: aiConfig } = useAiConfig();

// DialogTitle 수정 — 옆에 AI 버튼 추가
<DialogHeader>
    <div className="flex items-center justify-between">
        <DialogTitle>{isEdit ? "제품 수정" : "제품 추가"}</DialogTitle>
        {!isEdit && aiConfig && (
            <Button
                variant={showAiPanel ? "default" : "outline"}
                size="sm"
                onClick={() => setShowAiPanel(!showAiPanel)}
            >
                <Sparkles className="h-4 w-4 mr-1" />
                AI
            </Button>
        )}
    </div>
</DialogHeader>

// 폼 상단에 AiProductPanel 추가 (showAiPanel && !isEdit 일 때)
{showAiPanel && !isEdit && (
    <AiProductPanel
        onGenerated={(result) => {
            setName(result.name);
            setSummary(result.summary);
            setDescription(result.description);
            setCategory(result.category);
            setPrice(result.price);
            setImageUrl(result.imageUrl ?? "");
        }}
    />
)}
```

**출처 URL 표시**: AiProductPanel 내부에서 자체 관리 (sources state). ProductDialog에서는 출처를 따로 저장하지 않음.

## 6. 구현 순서

| 순서 | 파일 | 작업 | 검증 |
|:----:|------|------|------|
| 1 | `src/lib/ai.ts` | generateProduct + 웹 검색 함수 추가 | 타입 에러 없음 |
| 2 | `src/pages/api/ai/generate-product.ts` | POST API 엔드포인트 | 빌드 확인 |
| 3 | `src/hooks/useAiProduct.ts` | 생성 훅 | 타입 에러 없음 |
| 4 | `src/components/products/AiProductPanel.tsx` | AI 제품 생성 패널 | 빌드 확인 |
| 5 | `src/components/products/ProductDialog.tsx` | AI 토글 버튼 추가 | `pnpm build` 성공 |

## 7. 에러 핸들링

| 상황 | 처리 |
|------|------|
| AI 미설정 | 400 + "AI 설정이 필요합니다. 설정 > AI 탭에서 API 키를 등록해주세요." |
| 프롬프트 없음 | 400 + "제품명 또는 URL을 입력해주세요." |
| 웹 검색 실패 | AI가 검색 없이 응답할 수 있음 → sources 빈 배열 |
| AI API 오류 | 500 + 원본 에러 메시지 전달 |
| JSON 파싱 실패 | 500 + "AI 응답에서 제품 데이터를 파싱할 수 없습니다." |
| 네트워크 오류 | 클라이언트에서 "서버에 연결할 수 없습니다." |
| 타임아웃 | fetch 기본 타임아웃 (웹 검색 포함 최대 30초 예상) |

## 8. 보안 고려사항

- AI API 호출 + 웹 검색은 서버 사이드에서만 실행
- OpenAI 웹 검색 시 `gpt-4o-search-preview` 모델 강제 사용 (사용자 설정 model 무시)
- Anthropic 웹 검색 `max_uses: 3`으로 과도한 검색 방지
- imageUrl은 AI가 반환한 외부 URL → 직접 `<img src>`로 사용하지 않음 (XSS 방지)
- 사용량 로깅으로 비정상 사용 추적 가능
