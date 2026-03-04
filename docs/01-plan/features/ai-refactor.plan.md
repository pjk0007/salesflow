# Plan: ai-refactor (AI 아키텍처 리팩토링)

## 1. 개요

### 배경
현재 AI 시스템은 조직별로 DB에 API 키를 저장하고, OpenAI/Anthropic/Gemini 3개 프로바이더 중 조직이 선택한 1개를 모든 용도에 사용합니다. 이를 **용도별 프로바이더 고정 + ENV 기반 키 관리 + 토큰 사용량 제한** 구조로 리팩토링합니다.

### 목표
1. **기본 AI: Claude(Anthropic) 고정** — 이메일/제품/폼/대시보드/위젯/알림톡 생성
2. **웹서칭: Gemini 고정** — 회사 리서치 (Google Search Grounding)
3. **API 키: .env 기반** — 서버 환경변수에서 관리, 조직별 DB 설정 제거
4. **토큰 사용량 제한** — 조직별 월간 토큰 쿼터, 초과 시 차단

## 2. 현재 상태

### 현재 아키텍처
```
[조직 설정 페이지] → DB(ai_configs) 저장
  ↓
getAiClient(orgId) → DB에서 provider/apiKey/model 조회
  ↓
각 AI 함수에서 client.provider로 분기
  - "openai" → callOpenAI / callOpenAIWithSearch
  - "anthropic" → callAnthropic / callAnthropicWithSearch
  - "gemini" → callGemini / callGeminiWithSearch
```

### 관련 파일 (10개)
| 파일 | 역할 |
|------|------|
| `src/lib/ai.ts` | 핵심 AI 모듈 (1358줄) — 모든 AI 함수, 프로바이더 분기 |
| `src/lib/db/schema.ts` | `aiConfigs` + `aiUsageLogs` 테이블 정의 |
| `src/components/settings/AiConfigTab.tsx` | AI 설정 UI (프로바이더/키/모델 선택) |
| `src/app/api/ai/config/route.ts` | AI 설정 CRUD API |
| `src/app/api/ai/test/route.ts` | 연결 테스트 API |
| `src/app/api/ai/generate-email/route.ts` | 이메일 생성 API |
| `src/app/api/ai/generate-email-stream/route.ts` | 이메일 스트리밍 API |
| `src/app/api/ai/generate-product/route.ts` | 제품 생성 API |
| `src/app/api/ai/research-company/route.ts` | 회사 리서치 API |
| `src/app/api/ai/generate-webform/route.ts` | 웹폼 생성 API |
| `src/app/api/ai/generate-dashboard/route.ts` | 대시보드 생성 API |
| `src/app/api/ai/generate-widget/route.ts` | 위젯 생성 API |
| `src/app/api/ai/generate-alimtalk/route.ts` | 알림톡 생성 API |
| `src/lib/auto-personalized-email.ts` | 자동 이메일 발송 |

### 현재 DB 테이블
- `ai_configs`: orgId, provider, apiKey, model, isActive
- `ai_usage_logs`: orgId, userId, provider, model, promptTokens, completionTokens, purpose

## 3. 변경 계획

### 3-1. ENV 기반 API 키 관리

**`.env.local` 추가:**
```
ANTHROPIC_API_KEY=sk-ant-api03-...
GEMINI_API_KEY=AIzaSy...
```

**`getAiClient()` 변경:**
```typescript
// 변경 전: DB에서 조회
export async function getAiClient(orgId: string): Promise<AiClient | null> {
    const [config] = await db.select().from(aiConfigs)...
}

// 변경 후: ENV에서 직접 읽기
export function getAiClient(): AiClient {
    return {
        provider: "anthropic",
        apiKey: process.env.ANTHROPIC_API_KEY!,
        model: "claude-sonnet-4-6",
    };
}

export function getSearchClient(): SearchClient {
    return {
        provider: "gemini",
        apiKey: process.env.GEMINI_API_KEY!,
        model: "gemini-2.5-flash",
    };
}
```

### 3-2. 프로바이더 고정 — 불필요한 코드 제거

**제거 대상:**
- `callOpenAI()`, `callOpenAIWithSearch()` — OpenAI 관련 함수 전체
- `callGemini()`, `callGeminiGeneric()` — Gemini 일반 생성 함수 (웹서치만 남김)
- `streamOpenAI()`, `streamGemini()` — OpenAI/Gemini 스트리밍
- 모든 `if (client.provider === "openai")`, `if (client.provider === "gemini")` 분기
- `AiConfigTab.tsx` — 프로바이더/키 선택 UI 제거
- `api/ai/config/route.ts` — 설정 저장 API 제거
- `api/ai/test/route.ts` — 연결 테스트 API 제거

**유지:**
- `callAnthropic()` — 기본 AI (이메일/제품/폼 등 생성)
- `callAnthropicWithSearch()` → 제거 (웹서치는 Gemini로)
- `callGeminiWithSearch()` — 웹서칭 전용
- `streamAnthropic()` — 이메일 스트리밍

**결과:** ai.ts 1358줄 → ~600줄로 대폭 축소

### 3-3. 토큰 사용량 제한

**새 DB 테이블: `ai_usage_quotas`**
```sql
CREATE TABLE ai_usage_quotas (
    id SERIAL PRIMARY KEY,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    month VARCHAR(7) NOT NULL,           -- "2026-03"
    total_tokens INTEGER DEFAULT 0,       -- 누적 사용량
    quota_limit INTEGER DEFAULT 500000,   -- 월간 한도 (기본 50만 토큰)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, month)
);
```

**플랜별 기본 한도:**
| 플랜 | 월간 토큰 한도 |
|------|---------------|
| Free | 100,000 (10만) |
| Pro | 1,000,000 (100만) |
| Enterprise | 10,000,000 (1000만) |

**체크 로직:**
```typescript
// AI 함수 호출 전 체크
async function checkTokenQuota(orgId: string): Promise<boolean> {
    const month = new Date().toISOString().slice(0, 7); // "2026-03"
    const quota = await getOrCreateQuota(orgId, month);
    return quota.totalTokens < quota.quotaLimit;
}

// AI 함수 호출 후 사용량 업데이트
async function updateTokenUsage(orgId: string, tokens: number) {
    const month = new Date().toISOString().slice(0, 7);
    await db.update(aiUsageQuotas)
        .set({ totalTokens: sql`total_tokens + ${tokens}`, updatedAt: new Date() })
        .where(and(eq(aiUsageQuotas.orgId, orgId), eq(aiUsageQuotas.month, month)));
}
```

### 3-4. AiConfigTab UI 변경

**변경 전:** 프로바이더 선택 + API 키 입력 + 모델 선택 + 연결 테스트
**변경 후:** 토큰 사용량 대시보드
- 이번 달 사용량 / 한도 (프로그레스바)
- 용도별 사용량 내역 (이메일, 리서치, 제품 등)
- 잔여 토큰

### 3-5. ai_configs 테이블 처리

- `ai_configs` 테이블은 더 이상 사용하지 않음
- 마이그레이션: DROP TABLE 또는 deprecated 마킹
- `getAiClient(orgId)` → `getAiClient()` (orgId 불필요)

## 4. 변경 파일 목록

| # | 파일 | 변경 내용 |
|---|------|----------|
| 1 | `.env.local` | ANTHROPIC_API_KEY, GEMINI_API_KEY 추가 |
| 2 | `src/lib/db/schema.ts` | aiUsageQuotas 테이블 추가, aiConfigs 유지(deprecated) |
| 3 | `drizzle/XXXX_ai_usage_quotas.sql` | 마이그레이션 SQL |
| 4 | `src/lib/ai.ts` | getAiClient ENV 전환, OpenAI/Gemini 일반 함수 제거, 토큰 체크/업데이트 |
| 5 | `src/app/api/ai/generate-email-stream/route.ts` | streamOpenAI/streamGemini 제거, Anthropic만 |
| 6 | `src/app/api/ai/*.ts` (8개 API) | getAiClient() 호출부 수정 (orgId 파라미터 제거) |
| 7 | `src/lib/auto-personalized-email.ts` | getAiClient 호출 수정 |
| 8 | `src/components/settings/AiConfigTab.tsx` | 토큰 사용량 대시보드 UI로 교체 |
| 9 | `src/app/api/ai/config/route.ts` | 제거 또는 사용량 조회 API로 전환 |
| 10 | `src/app/api/ai/test/route.ts` | 제거 |
| 11 | `src/app/api/ai/usage/route.ts` | (신규) 사용량 조회 API |
| 12 | `src/hooks/useAiConfig.ts` | useAiUsage로 전환 |

## 5. 구현 순서

| # | 작업 | 검증 |
|---|------|------|
| 1 | .env.local에 키 추가 + schema.ts에 quotas 테이블 + migration | drizzle-kit push |
| 2 | ai.ts 리팩토링 (ENV 전환 + 함수 정리 + 토큰 체크) | 타입 에러 없음 |
| 3 | generate-email-stream 정리 (Anthropic only) | 타입 에러 없음 |
| 4 | 8개 AI API 라우트 수정 | 타입 에러 없음 |
| 5 | auto-personalized-email.ts 수정 | 타입 에러 없음 |
| 6 | 사용량 API + Hook 추가 | 타입 에러 없음 |
| 7 | AiConfigTab → 사용량 UI 교체 | 타입 에러 없음 |
| 8 | config/test 라우트 제거 | pnpm build 성공 |

## 6. 검증

- `pnpm build` 성공
- AI 이메일 생성: Claude(Anthropic) 사용 확인
- 회사 리서치: Gemini 웹서칭 사용 확인
- 토큰 한도 초과 시 에러 메시지 반환
- 토큰 사용량 UI 정상 표시

## 7. 리스크

| 리스크 | 대응 |
|--------|------|
| 기존 ai_configs 데이터 유실 | 테이블은 유지 (deprecated), 코드만 ENV 전환 |
| ENV 미설정 시 서버 크래시 | getAiClient()에서 키 없으면 null 반환 + 에러 메시지 |
| OpenAI 사용 중인 조직 | 공지 후 전환 (현재 테스트 단계이므로 영향 없음) |
