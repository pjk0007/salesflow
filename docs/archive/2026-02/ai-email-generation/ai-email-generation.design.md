# Design: AI 이메일 생성 (ai-email-generation)

> Plan: [ai-email-generation.plan.md](../../01-plan/features/ai-email-generation.plan.md)

## 1. DB 스키마

### 1.1 ai_usage_logs 테이블

`src/lib/db/schema.ts` — aiConfigs 테이블 뒤, organizationInvitations 앞에 추가

```typescript
// ============================================
// AI 사용량 로그
// ============================================
export const aiUsageLogs = pgTable("ai_usage_logs", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    userId: uuid("user_id")
        .references(() => users.id, { onDelete: "set null" }),
    provider: varchar("provider", { length: 50 }).notNull(),
    model: varchar("model", { length: 100 }).notNull(),
    promptTokens: integer("prompt_tokens").notNull(),
    completionTokens: integer("completion_tokens").notNull(),
    purpose: varchar("purpose", { length: 50 }).notNull(), // "email_generation"
    createdAt: timestamptz("created_at").defaultNow().notNull(),
});
```

타입 추출 섹션에 추가:
```typescript
export type AiUsageLog = typeof aiUsageLogs.$inferSelect;
```

## 2. AI 유틸리티

### 2.1 src/lib/ai.ts (신규)

OpenAI/Anthropic 통합 클라이언트. 외부 SDK 없이 fetch로 직접 호출.

```typescript
import { db, aiConfigs, aiUsageLogs, products } from "@/lib/db";
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
        model: config.model || (config.provider === "openai" ? "gpt-4o" : "claude-sonnet-4-20250514"),
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
    }

    if (input.recordData) {
        prompt += "\n\n[수신자 정보]";
        for (const [key, value] of Object.entries(input.recordData)) {
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
            max_tokens: 4096,
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

    // JSON 파싱 (코드블록 안에 있을 수 있음)
    const jsonMatch = content.match(/\{[\s\S]*"subject"[\s\S]*"htmlBody"[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI 응답에서 이메일 데이터를 파싱할 수 없습니다.");
    const parsed = JSON.parse(jsonMatch[0]);

    return {
        subject: parsed.subject,
        htmlBody: parsed.htmlBody,
        usage: {
            promptTokens: data.usage?.input_tokens ?? 0,
            completionTokens: data.usage?.output_tokens ?? 0,
        },
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
```

## 3. API 엔드포인트

### 3.1 POST /api/ai/generate-email

**파일**: `src/pages/api/ai/generate-email.ts` (신규)

```typescript
import type { NextApiRequest, NextApiResponse } from "next";
import { db, products, records } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";
import { getAiClient, generateEmail, logAiUsage } from "@/lib/ai";

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
        return res.status(400).json({ success: false, error: "AI 설정이 필요합니다. 설정 > AI 탭에서 API 키를 등록해주세요." });
    }

    const { prompt, productId, recordId, tone } = req.body;
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
        return res.status(400).json({ success: false, error: "프롬프트를 입력해주세요." });
    }

    try {
        // 제품 정보 조회 (선택)
        let product = null;
        if (productId) {
            const [p] = await db
                .select()
                .from(products)
                .where(and(eq(products.id, productId), eq(products.orgId, user.orgId)))
                .limit(1);
            product = p ?? null;
        }

        // 레코드 정보 조회 (선택)
        let recordData = null;
        if (recordId) {
            const [r] = await db.select().from(records).where(eq(records.id, recordId)).limit(1);
            if (r) recordData = r.data as Record<string, unknown>;
        }

        const result = await generateEmail(client, {
            prompt: prompt.trim(),
            product,
            recordData,
            tone,
        });

        // 사용량 로깅
        await logAiUsage({
            orgId: user.orgId,
            userId: user.userId,
            provider: client.provider,
            model: client.model,
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            purpose: "email_generation",
        });

        return res.status(200).json({
            success: true,
            data: {
                subject: result.subject,
                htmlBody: result.htmlBody,
            },
        });
    } catch (error) {
        console.error("AI email generation error:", error);
        const message = error instanceof Error ? error.message : "AI 이메일 생성에 실패했습니다.";
        return res.status(500).json({ success: false, error: message });
    }
}
```

## 4. SWR 훅

### 4.1 src/hooks/useAiEmail.ts (신규)

```typescript
import { useState } from "react";

interface GenerateEmailInput {
    prompt: string;
    productId?: number;
    recordId?: number;
    tone?: string;
}

interface GenerateEmailResult {
    subject: string;
    htmlBody: string;
}

export function useAiEmail() {
    const [isGenerating, setIsGenerating] = useState(false);

    const generateEmail = async (input: GenerateEmailInput): Promise<{
        success: boolean;
        data?: GenerateEmailResult;
        error?: string;
    }> => {
        setIsGenerating(true);
        try {
            const res = await fetch("/api/ai/generate-email", {
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

    return { generateEmail, isGenerating };
}
```

## 5. UI 컴포넌트

### 5.1 AiEmailPanel (신규)

**파일**: `src/components/email/AiEmailPanel.tsx`

재사용 가능한 AI 이메일 생성 패널. EmailTemplateDialog와 SendEmailDialog 양쪽에서 사용.

**Props**:
```typescript
interface AiEmailPanelProps {
    onGenerated: (result: { subject: string; htmlBody: string }) => void;
    recordId?: number;      // SendEmailDialog에서 전달
    defaultProductId?: number;
}
```

**구조**:
```
div.space-y-4
├── Textarea: 프롬프트 입력 (rows=3, placeholder="예: 신규 고객에게 제품 소개 이메일을 작성해줘")
├── div.grid.grid-cols-2.gap-4:
│   ├── Select: 제품 선택 (useProducts 훅, activeOnly=true) + "없음" 옵션
│   └── Select: 톤 선택 (공식적/친근한/전문적/간결한)
└── Button: "AI로 생성" (variant="default", Sparkles icon)
    └── isGenerating 시: Loader2 animate-spin + "생성 중..."
```

**톤 옵션**:
```typescript
const TONE_OPTIONS = [
    { value: "", label: "기본" },
    { value: "formal", label: "공식적" },
    { value: "friendly", label: "친근한" },
    { value: "professional", label: "전문적" },
    { value: "concise", label: "간결한" },
];
```

**동작**:
1. 사용자가 프롬프트 + 옵션 입력
2. "AI로 생성" 클릭 → useAiEmail().generateEmail 호출
3. 성공 시 → onGenerated({ subject, htmlBody }) 콜백
4. 실패 시 → toast.error(message)

### 5.2 EmailTemplateDialog 수정

**파일**: `src/components/email/EmailTemplateDialog.tsx`

변경사항:
- `showAiPanel` state 추가 (boolean, default false)
- DialogHeader 옆에 "AI로 생성" 토글 버튼 (Sparkles icon)
- `showAiPanel=true`일 때 폼 상단에 AiEmailPanel 표시
- AiEmailPanel의 `onGenerated` → setSubject + setHtmlBody + toast.success
- 기존 subject/htmlBody 필드에 AI 결과 채워짐 → 사용자가 수정 후 저장

**수정 범위** (최소한):
- import: AiEmailPanel, useAiConfig, Sparkles 추가
- state: showAiPanel 추가
- DialogTitle 옆에 AI 토글 버튼 (AI 설정 없으면 숨김)
- showAiPanel && <AiEmailPanel onGenerated={...} />

### 5.3 SendEmailDialog 수정

**파일**: `src/components/records/SendEmailDialog.tsx`

변경사항:
- `mode` state: "template" | "ai" (default "template")
- 상단에 모드 전환 탭/버튼: "템플릿 선택" / "AI 작성"
- mode="ai"일 때:
  - AiEmailPanel 표시 (recordId={recordIds[0]} 전달)
  - AI 생성 결과 → subject/htmlBody state에 저장
  - 미리보기 표시 (subject + htmlBody 요약)
  - "발송" 버튼 → 별도 API 호출 (기존 email/send와 다른 흐름, AI 생성 내용 직접 발송)
- **참고**: AI 직접 발송은 templateLinkId 없이 동작해야 하므로, 이 기능은 **V2에서** 구현. V1에서는 EmailTemplateDialog 통합만 구현.

**V1 범위 축소**: SendEmailDialog는 수정하지 않음. AI 이메일 생성은 EmailTemplateDialog에서만 지원.

## 6. 구현 순서

| 순서 | 파일 | 작업 | 검증 |
|:----:|------|------|------|
| 1 | `src/lib/db/schema.ts` | aiUsageLogs 테이블 + 타입 | `pnpm db:push` 성공 |
| 2 | `src/lib/ai.ts` | AI 클라이언트 유틸리티 | 타입 에러 없음 |
| 3 | `src/pages/api/ai/generate-email.ts` | POST API | 빌드 확인 |
| 4 | `src/hooks/useAiEmail.ts` | 생성 훅 | 타입 에러 없음 |
| 5 | `src/components/email/AiEmailPanel.tsx` | AI 생성 패널 | 빌드 확인 |
| 6 | `src/components/email/EmailTemplateDialog.tsx` | AI 버튼 추가 | `pnpm build` 성공 |

## 7. 에러 핸들링

| 상황 | 처리 |
|------|------|
| AI 미설정 | 400 + "AI 설정이 필요합니다. 설정 > AI 탭에서 API 키를 등록해주세요." |
| 프롬프트 없음 | 400 + "프롬프트를 입력해주세요." |
| 제품 없음 | productId 무시 (product=null) |
| AI API 오류 | 500 + 원본 에러 메시지 전달 |
| JSON 파싱 실패 | 500 + "AI 응답에서 이메일 데이터를 파싱할 수 없습니다." |
| 네트워크 오류 | 클라이언트에서 "서버에 연결할 수 없습니다." |

## 8. 보안 고려사항

- AI API 호출은 서버 사이드에서만 실행 (API 키 클라이언트 노출 방지)
- 사용량 로깅으로 비정상 사용 추적 가능
- 인증된 사용자만 호출 가능 (getUserFromRequest)
