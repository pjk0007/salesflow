# Design: ai-refactor (AI 아키텍처 리팩토링)

> Plan: [ai-refactor.plan.md](../../01-plan/features/ai-refactor.plan.md)

## 1. 아키텍처 변경

### 변경 전
```
[AiConfigTab UI] → POST /api/ai/config → DB(ai_configs)
                                              ↓
각 AI API 라우트 → getAiClient(orgId) → DB 조회 → AiClient { provider, apiKey, model }
                                                        ↓
                    generateEmail(client, input) → if openai / if gemini / else anthropic
```

### 변경 후
```
.env.local: ANTHROPIC_API_KEY, GEMINI_API_KEY
                    ↓
getAiClient()  → AiClient { provider: "anthropic", apiKey, model }  ← 생성/이메일/폼/위젯/알림톡
getSearchClient() → SearchClient { provider: "gemini", apiKey, model } ← 웹서칭(리서치/제품)
                    ↓
각 AI API 라우트 → checkTokenQuota(orgId) → 통과 시 AI 호출 → updateTokenUsage(orgId)
                    ↓
[AiUsageTab UI] ← GET /api/ai/usage → 월간 사용량/한도 표시
```

## 2. DB 변경

### 2-1. 신규 테이블: `ai_usage_quotas`

```typescript
// src/lib/db/schema.ts
export const aiUsageQuotas = pgTable("ai_usage_quotas", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    month: varchar("month", { length: 7 }).notNull(),  // "2026-03"
    totalTokens: integer("total_tokens").default(0).notNull(),
    quotaLimit: integer("quota_limit").default(100000).notNull(),  // Free 기본값
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
}, (table) => [
    unique().on(table.orgId, table.month),
]);
```

### 2-2. 마이그레이션 SQL

```sql
-- drizzle/XXXX_ai_usage_quotas.sql
CREATE TABLE IF NOT EXISTS "ai_usage_quotas" (
    "id" SERIAL PRIMARY KEY,
    "org_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "month" VARCHAR(7) NOT NULL,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "quota_limit" INTEGER NOT NULL DEFAULT 100000,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE("org_id", "month")
);
```

### 2-3. ai_configs 테이블

- **유지** (DROP 하지 않음) — 기존 데이터 보존
- 코드에서 참조만 제거 (import, getAiClient 등)

## 3. 핵심 모듈: `src/lib/ai.ts` 상세 설계

### 3-1. 타입 변경

```typescript
// 변경 전
interface AiClient {
    provider: "openai" | "anthropic" | "gemini";
    apiKey: string;
    model: string;
}

// 변경 후 — provider 분기 불필요, 타입만 유지
interface AiClient {
    apiKey: string;
    model: string;
}

interface SearchClient {
    apiKey: string;
    model: string;
}
```

### 3-2. 클라이언트 함수

```typescript
// ENV에서 직접 읽기. DB 조회 없음 (async 불필요)
export function getAiClient(): AiClient | null {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    return { apiKey, model: "claude-sonnet-4-6" };
}

export function getSearchClient(): SearchClient | null {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    return { apiKey, model: "gemini-2.5-flash" };
}
```

### 3-3. 제거 함수 목록

| 함수 | 줄 수 | 이유 |
|------|-------|------|
| `callOpenAI()` | L133-171 | OpenAI 제거 |
| `callGemini()` | L222-261 | Gemini 일반 생성 제거 |
| `callGeminiGeneric()` | L265-305 | Gemini 일반 생성 제거 |
| `callOpenAIWithSearch()` | L388-444 | OpenAI 웹서치 제거 |
| `callAnthropicWithSearch()` | L446-530 | Anthropic 웹서치 제거 (Gemini만 사용) |

### 3-4. 유지 함수 (리팩토링)

| 함수 | 변경 내용 |
|------|----------|
| `callAnthropic()` | `client: AiClient` 파라미터 유지, 프로바이더 분기 제거 |
| `callGeminiWithSearch()` | `client: SearchClient` 파라미터로 변경 |
| `extractJson()` | 변경 없음 |
| `buildSystemPrompt()` (이메일) | 변경 없음 |
| `buildEmailSystemPrompt()` | 변경 없음 |
| `logAiUsage()` | 변경 없음 |

### 3-5. 고수준 함수 리팩토링

각 generate 함수에서 3-way 분기를 **단일 호출**로 교체:

**generateEmail:**
```typescript
export async function generateEmail(client: AiClient, input: GenerateEmailInput): Promise<GenerateEmailResult> {
    const systemPrompt = buildSystemPrompt(input);
    return callAnthropic(client, systemPrompt, input.prompt);
}
```

**generateProduct** (웹서칭 필요):
```typescript
export async function generateProduct(searchClient: SearchClient, input: GenerateProductInput): Promise<GenerateProductResult> {
    const systemPrompt = buildProductSystemPrompt();
    const pattern = /\{[\s\S]*"name"[\s\S]*"description"[\s\S]*\}/;
    const result = await callGeminiWithSearch(searchClient, systemPrompt, input.prompt, pattern);
    // ... 결과 매핑
}
```

**generateCompanyResearch** (웹서칭 필요):
```typescript
export async function generateCompanyResearch(searchClient: SearchClient, input: CompanyResearchInput): Promise<CompanyResearchResult> {
    // callGeminiWithSearch 직접 호출
}
```

**generateWebForm / generateDashboard / generateWidget / generateAlimtalk:**
```typescript
// 모든 함수 동일 패턴: Anthropic 직접 호출
export async function generateWebForm(client: AiClient, input: GenerateWebFormInput): Promise<GenerateWebFormResult> {
    const systemPrompt = buildWebFormSystemPrompt(input.workspaceFields);
    // callAnthropic 직접 호출 (인라인, 프로바이더 분기 없음)
}
```

인라인 Anthropic 호출 블록을 **공통 헬퍼** `callAnthropicJson()`으로 추출:

```typescript
async function callAnthropicJson(
    client: AiClient,
    systemPrompt: string,
    userPrompt: string,
    maxTokens: number = 4096
): Promise<{ content: string; usage: { promptTokens: number; completionTokens: number } }> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "x-api-key": client.apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: client.model,
            max_tokens: maxTokens,
            system: systemPrompt,
            messages: [{ role: "user", content: userPrompt }],
        }),
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error?.message || "AI API 호출에 실패했습니다.");
    }
    const data = await response.json();
    const textBlock = data.content?.find((b: { type: string }) => b.type === "text");
    return {
        content: textBlock?.text || "",
        usage: {
            promptTokens: data.usage?.input_tokens ?? 0,
            completionTokens: data.usage?.output_tokens ?? 0,
        },
    };
}
```

이렇게 하면 `generateWebForm`, `generateDashboard`, `generateWidget`, `generateAlimtalk` 4개 함수의 중복 Anthropic 호출 코드가 모두 `callAnthropicJson()` 한 줄로 대체됩니다.

### 3-6. 토큰 쿼터 함수

```typescript
import { sql } from "drizzle-orm";

// 쿼터 조회/생성 (upsert)
async function getOrCreateQuota(orgId: string, month: string): Promise<{ totalTokens: number; quotaLimit: number }> {
    const [existing] = await db
        .select({ totalTokens: aiUsageQuotas.totalTokens, quotaLimit: aiUsageQuotas.quotaLimit })
        .from(aiUsageQuotas)
        .where(and(eq(aiUsageQuotas.orgId, orgId), eq(aiUsageQuotas.month, month)))
        .limit(1);

    if (existing) return existing;

    // 플랜별 한도 조회
    const limit = await getQuotaLimitForOrg(orgId);
    const [created] = await db
        .insert(aiUsageQuotas)
        .values({ orgId, month, totalTokens: 0, quotaLimit: limit })
        .onConflictDoNothing()
        .returning({ totalTokens: aiUsageQuotas.totalTokens, quotaLimit: aiUsageQuotas.quotaLimit });

    return created ?? { totalTokens: 0, quotaLimit: limit };
}

// 플랜별 기본 한도
async function getQuotaLimitForOrg(orgId: string): Promise<number> {
    const [sub] = await db
        .select({ planId: subscriptions.planId })
        .from(subscriptions)
        .where(and(eq(subscriptions.orgId, orgId), eq(subscriptions.status, "active")))
        .limit(1);

    if (!sub?.planId) return 100_000; // Free

    const [plan] = await db
        .select({ name: plans.name })
        .from(plans)
        .where(eq(plans.id, sub.planId))
        .limit(1);

    if (plan?.name === "Enterprise") return 10_000_000;
    if (plan?.name === "Pro") return 1_000_000;
    return 100_000; // Free
}

// 쿼터 체크 (AI 호출 전 사용)
export async function checkTokenQuota(orgId: string): Promise<{ allowed: boolean; remaining: number }> {
    const month = new Date().toISOString().slice(0, 7);
    const quota = await getOrCreateQuota(orgId, month);
    const remaining = quota.quotaLimit - quota.totalTokens;
    return { allowed: remaining > 0, remaining };
}

// 사용량 업데이트 (AI 호출 후 사용)
export async function updateTokenUsage(orgId: string, tokens: number): Promise<void> {
    const month = new Date().toISOString().slice(0, 7);

    // upsert: 있으면 증가, 없으면 생성
    const [existing] = await db
        .select({ id: aiUsageQuotas.id })
        .from(aiUsageQuotas)
        .where(and(eq(aiUsageQuotas.orgId, orgId), eq(aiUsageQuotas.month, month)))
        .limit(1);

    if (existing) {
        await db
            .update(aiUsageQuotas)
            .set({
                totalTokens: sql`${aiUsageQuotas.totalTokens} + ${tokens}`,
                updatedAt: new Date(),
            })
            .where(eq(aiUsageQuotas.id, existing.id));
    } else {
        const limit = await getQuotaLimitForOrg(orgId);
        await db
            .insert(aiUsageQuotas)
            .values({ orgId, month, totalTokens: tokens, quotaLimit: limit })
            .onConflictDoNothing();
    }
}
```

## 4. API 라우트 변경

### 4-1. 공통 패턴 (8개 라우트 모두 동일)

```typescript
// 변경 전
const client = await getAiClient(user.orgId);
if (!client) {
    return NextResponse.json({ success: false, error: "AI 설정이 필요합니다." }, { status: 400 });
}

// 변경 후
const client = getAiClient();
if (!client) {
    return NextResponse.json({ success: false, error: "AI 서비스를 사용할 수 없습니다." }, { status: 503 });
}

// 토큰 쿼터 체크 (신규)
const quota = await checkTokenQuota(user.orgId);
if (!quota.allowed) {
    return NextResponse.json({
        success: false,
        error: "이번 달 AI 사용량을 초과했습니다. 플랜 업그레이드를 고려해주세요.",
    }, { status: 429 });
}
```

```typescript
// 변경 후 — AI 호출 후 사용량 업데이트
const totalTokens = result.usage.promptTokens + result.usage.completionTokens;
await updateTokenUsage(user.orgId, totalTokens);
```

### 4-2. 라우트별 변경사항

| 라우트 | getAiClient | 토큰체크 | 추가 변경 |
|--------|-------------|---------|----------|
| `generate-email/route.ts` | `getAiClient()` (orgId 제거) | 추가 | `client.provider` → `"anthropic"` in logAiUsage |
| `generate-email-stream/route.ts` | `getAiClient()` | 추가 | streamOpenAI/streamGemini 제거, Anthropic만 |
| `generate-product/route.ts` | `getSearchClient()` | 추가 | 웹서칭이므로 SearchClient |
| `research-company/route.ts` | `getSearchClient()` | 추가 | 웹서칭이므로 SearchClient |
| `generate-webform/route.ts` | `getAiClient()` | 추가 | - |
| `generate-dashboard/route.ts` | `getAiClient()` | 추가 | - |
| `generate-widget/route.ts` | `getAiClient()` | 추가 | - |
| `generate-alimtalk/route.ts` | `getAiClient()` | 추가 | - |

### 4-3. 제거 라우트

| 라우트 | 이유 |
|--------|------|
| `api/ai/config/route.ts` | ENV 기반으로 전환, 설정 저장 불필요 |
| `api/ai/test/route.ts` | 연결 테스트 불필요 |

### 4-4. 신규 라우트: `api/ai/usage/route.ts`

```typescript
// GET: 이번 달 사용량 + 용도별 내역 조회
export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) return 401;

    const month = new Date().toISOString().slice(0, 7);

    // 1. 쿼터 조회
    const quota = await getOrCreateQuota(user.orgId, month);

    // 2. 용도별 사용량 (ai_usage_logs 집계)
    const purposeBreakdown = await db
        .select({
            purpose: aiUsageLogs.purpose,
            totalPrompt: sql<number>`SUM(${aiUsageLogs.promptTokens})`,
            totalCompletion: sql<number>`SUM(${aiUsageLogs.completionTokens})`,
            count: sql<number>`COUNT(*)`,
        })
        .from(aiUsageLogs)
        .where(and(
            eq(aiUsageLogs.orgId, user.orgId),
            gte(aiUsageLogs.createdAt, new Date(`${month}-01`)),
        ))
        .groupBy(aiUsageLogs.purpose);

    return NextResponse.json({
        success: true,
        data: {
            month,
            totalTokens: quota.totalTokens,
            quotaLimit: quota.quotaLimit,
            remaining: quota.quotaLimit - quota.totalTokens,
            usagePercent: Math.round((quota.totalTokens / quota.quotaLimit) * 100),
            breakdown: purposeBreakdown,
        },
    });
}
```

### 4-5. `generate-email-stream/route.ts` 상세

```typescript
// 제거: streamOpenAI(), streamGemini() 함수 + 프로바이더 분기
// 유지: streamAnthropic() → 함수명 변경 없이 직접 호출

// 변경 전 (L63-69)
if (client.provider === "openai") {
    usage = await streamOpenAI(client, systemPrompt, input.prompt, sendEvent);
} else if (client.provider === "gemini") {
    usage = await streamGemini(client, systemPrompt, input.prompt, sendEvent);
} else {
    usage = await streamAnthropic(client, systemPrompt, input.prompt, sendEvent);
}

// 변경 후
usage = await streamAnthropic(client, systemPrompt, input.prompt, sendEvent);
```

## 5. `auto-personalized-email.ts` 변경

```typescript
// 변경 전 (L73-74)
const aiClient = await getAiClient(orgId);
if (!aiClient) continue;

// 변경 후 — AI는 getAiClient(), 웹서칭은 getSearchClient()
const aiClient = getAiClient();
if (!aiClient) continue;

// 토큰 쿼터 체크 (신규)
const quota = await checkTokenQuota(orgId);
if (!quota.allowed) continue;

// L84-87: 회사 리서치는 searchClient 사용
if (link.autoResearch === 1 && !recordData._companyResearch) {
    const searchClient = getSearchClient();
    if (searchClient && companyName) {
        const research = await generateCompanyResearch(searchClient, { companyName, additionalContext: data });
        // ...
    }
}

// L126: 이메일 생성은 aiClient(Anthropic) 사용
const emailResult = await generateEmail(aiClient, { prompt, product, recordData, tone, ctaUrl });
```

## 6. UI 변경

### 6-1. `AiConfigTab.tsx` → `AiUsageTab.tsx`

프로바이더/키 선택 UI를 **토큰 사용량 대시보드**로 교체:

```
┌─────────────────────────────────────────────┐
│ AI 사용량                                     │
│ "이번 달 AI 토큰 사용 현황"                      │
├─────────────────────────────────────────────┤
│                                             │
│  이번 달 사용량    245,000 / 1,000,000 (24%) │
│  ████████░░░░░░░░░░░░░░░░░░░░░░░░  24%     │
│                                             │
│  잔여 토큰         755,000                    │
│  현재 플랜         Pro                        │
│                                             │
│  ─────── 용도별 사용량 ───────               │
│  이메일 생성        120,000 (49%)             │
│  회사 리서치         80,000 (33%)             │
│  제품 생성           30,000 (12%)             │
│  웹폼 생성           10,000 (4%)              │
│  기타                 5,000 (2%)              │
│                                             │
└─────────────────────────────────────────────┘
```

컴포넌트 구조:
- `Progress` (ShadCN) — 사용량 프로그레스바
- 용도별 목록: `purpose` → 한글 라벨 매핑
- role 제한 없음 (모든 멤버 조회 가능)

### 6-2. `useAiConfig.ts` → `useAiUsage.ts`

```typescript
export function useAiUsage() {
    const { data, isLoading } = useSWR<{ success: boolean; data: AiUsageData | null }>(
        "/api/ai/usage",
        fetcher
    );
    return { usage: data?.data ?? null, isLoading };
}

interface AiUsageData {
    month: string;
    totalTokens: number;
    quotaLimit: number;
    remaining: number;
    usagePercent: number;
    breakdown: Array<{
        purpose: string;
        totalPrompt: number;
        totalCompletion: number;
        count: number;
    }>;
}
```

### 6-3. purpose 한글 매핑

```typescript
const PURPOSE_LABELS: Record<string, string> = {
    email_generation: "이메일 생성",
    auto_personalized_email: "자동 이메일",
    auto_company_research: "자동 회사 리서치",
    company_research: "회사 리서치",
    product_generation: "제품 생성",
    webform_generation: "웹폼 생성",
    dashboard_generation: "대시보드 생성",
    widget_generation: "위젯 생성",
    alimtalk_generation: "알림톡 생성",
};
```

## 7. `.env.local` 변경

```
# 기존
DATABASE_URL=...
JWT_SECRET=...
NEXT_PUBLIC_TOSS_CLIENT_KEY=...
TOSS_SECRET_KEY=...
CRON_SECRET=...

# 신규 추가
ANTHROPIC_API_KEY=sk-ant-api03-...
GEMINI_API_KEY=AIzaSy...
```

## 8. 구현 순서

| # | 작업 | 파일 | 검증 |
|---|------|------|------|
| 1 | .env.local에 키 추가 | `.env.local` | - |
| 2 | schema.ts + migration SQL | `schema.ts`, `drizzle/` | `drizzle-kit push` |
| 3 | ai.ts 리팩토링 | `ai.ts` | 타입 에러 없음 |
| 4 | generate-email-stream 정리 | `generate-email-stream/route.ts` | 타입 에러 없음 |
| 5 | 8개 AI API 라우트 수정 | `api/ai/*.ts` | 타입 에러 없음 |
| 6 | auto-personalized-email 수정 | `auto-personalized-email.ts` | 타입 에러 없음 |
| 7 | 사용량 API 신규 | `api/ai/usage/route.ts` | 타입 에러 없음 |
| 8 | useAiUsage hook 신규 | `hooks/useAiUsage.ts` | 타입 에러 없음 |
| 9 | AiUsageTab UI 교체 | `AiConfigTab.tsx` → `AiUsageTab.tsx` | 타입 에러 없음 |
| 10 | config/test 라우트 + useAiConfig 제거 | 3개 파일 삭제 | `pnpm build` 성공 |

## 9. 예상 코드 변화량

| 구분 | 줄 수 |
|------|-------|
| ai.ts 제거 | -750줄 (OpenAI/Gemini 일반 + 프로바이더 분기) |
| ai.ts 추가 | +80줄 (callAnthropicJson, 토큰 쿼터 함수) |
| generate-email-stream 제거 | -100줄 (streamOpenAI, streamGemini) |
| API 라우트 수정 | 각 +5줄 (토큰 체크/업데이트), 총 +40줄 |
| 신규 파일 | +150줄 (usage API, useAiUsage, AiUsageTab) |
| 삭제 파일 | -150줄 (config API, test API, useAiConfig) |
| **순 변경** | **약 -730줄** |
