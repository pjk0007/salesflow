# Gap Analysis: ai-config

> **Analysis Type**: Gap Analysis (Design vs Implementation)
>
> **Project**: Sales Manager
> **Analyst**: gap-detector
> **Date**: 2026-02-20
> **Design Doc**: [ai-config.design.md](../02-design/features/ai-config.design.md)

---

## Summary

- **Total checkpoints**: 97
- **Matched**: 97
- **Gaps**: 0
- **Match Rate**: 100%

---

## Checkpoint Details

### 1. DB Schema - aiConfigs table (15 checkpoints)

| # | Checkpoint | Design | Implementation | Status |
|:-:|-----------|--------|----------------|:------:|
| 1 | Table name | `ai_configs` | `ai_configs` (schema.ts:549) | ✅ |
| 2 | id field | `serial("id").primaryKey()` | `serial("id").primaryKey()` (schema.ts:550) | ✅ |
| 3 | orgId field | `uuid("org_id").references(organizations.id, onDelete cascade).unique().notNull()` | `uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).unique().notNull()` (schema.ts:551-554) | ✅ |
| 4 | provider field | `varchar("provider", { length: 50 }).notNull()` | `varchar("provider", { length: 50 }).notNull()` (schema.ts:555) | ✅ |
| 5 | apiKey field | `varchar("api_key", { length: 500 }).notNull()` | `varchar("api_key", { length: 500 }).notNull()` (schema.ts:556) | ✅ |
| 6 | model field | `varchar("model", { length: 100 })` | `varchar("model", { length: 100 })` (schema.ts:557) | ✅ |
| 7 | isActive field | `integer("is_active").default(1).notNull()` | `integer("is_active").default(1).notNull()` (schema.ts:558) | ✅ |
| 8 | createdAt field | `timestamptz("created_at").defaultNow().notNull()` | `timestamptz("created_at").defaultNow().notNull()` (schema.ts:559) | ✅ |
| 9 | updatedAt field | `timestamptz("updated_at").defaultNow().notNull()` | `timestamptz("updated_at").defaultNow().notNull()` (schema.ts:560) | ✅ |
| 10 | Table position | After products, before organizationInvitations | products at L529-544, aiConfigs at L549-561, organizationInvitations at L566-580 (schema.ts) | ✅ |
| 11 | AiConfig type export | `export type AiConfig = typeof aiConfigs.$inferSelect` | `export type AiConfig = typeof aiConfigs.$inferSelect` (schema.ts:617) | ✅ |
| 12 | Comment header | `// AI 설정 (조직별)` | `// AI 설정 (조직별)` (schema.ts:547-548) | ✅ |
| 13 | provider comment | `// "openai" \| "anthropic"` | `// "openai" \| "anthropic"` (schema.ts:555) | ✅ |
| 14 | orgId unique constraint | `.unique()` on orgId | `.unique()` present (schema.ts:553) | ✅ |
| 15 | onDelete cascade | `onDelete: "cascade"` | `{ onDelete: "cascade" }` (schema.ts:552) | ✅ |

### 2. API - GET/POST /api/ai/config (33 checkpoints)

| # | Checkpoint | Design | Implementation | Status |
|:-:|-----------|--------|----------------|:------:|
| 16 | File path | `src/pages/api/ai/config.ts` | File exists at this path | ✅ |
| 17 | Import NextApiRequest/Response | `import type { NextApiRequest, NextApiResponse }` | Line 1 | ✅ |
| 18 | Import db, aiConfigs | `import { db, aiConfigs } from "@/lib/db"` | Line 2 | ✅ |
| 19 | Import eq | `import { eq } from "drizzle-orm"` | Line 3 | ✅ |
| 20 | Import getUserFromRequest | `import { getUserFromRequest } from "@/lib/auth"` | Line 4 | ✅ |
| 21 | maskSecret function exists | `function maskSecret(secret: string): string` | Lines 6-9 | ✅ |
| 22 | maskSecret short key handling | `if (secret.length <= 6) return "***"` | Line 7 | ✅ |
| 23 | maskSecret format | `secret.slice(0, 3) + "***" + secret.slice(-3)` | Line 8 | ✅ |
| 24 | Auth check | `getUserFromRequest(req)` + 401 if null | Lines 12-14 | ✅ |
| 25 | 401 response format | `{ success: false, error: "..." }` | Line 14 | ✅ |
| 26 | GET: select from aiConfigs | `db.select().from(aiConfigs).where(eq(orgId)).limit(1)` | Lines 19-23 | ✅ |
| 27 | GET: null config response | `200 + { success: true, data: null }` | Line 26 | ✅ |
| 28 | GET: config response fields | `id, provider, apiKey(masked), model, isActive` | Lines 31-36 | ✅ |
| 29 | GET: apiKey masking | `maskSecret(config.apiKey)` | Line 34 | ✅ |
| 30 | GET: success response wrapper | `{ success: true, data: {...} }` | Lines 29-38 | ✅ |
| 31 | POST: member role check | `user.role === "member"` -> 403 | Lines 46-48 | ✅ |
| 32 | POST: 403 error message | `"권한이 없습니다."` | Line 47 | ✅ |
| 33 | POST: body destructuring | `{ provider, apiKey, model }` | Line 51 | ✅ |
| 34 | POST: required fields check | `!provider \|\| !apiKey` -> 400 | Lines 52-54 | ✅ |
| 35 | POST: required fields error msg | `"provider와 apiKey는 필수입니다."` | Line 53 | ✅ |
| 36 | POST: provider validation | `!["openai", "anthropic"].includes(provider)` -> 400 | Lines 55-57 | ✅ |
| 37 | POST: provider error msg | `"지원하지 않는 provider입니다."` | Line 56 | ✅ |
| 38 | POST: check existing config | `select id where orgId` | Lines 59-63 | ✅ |
| 39 | POST: update existing | `db.update(aiConfigs).set(...)` | Lines 66-69 | ✅ |
| 40 | POST: update set fields | `provider, apiKey, model: model \|\| null, updatedAt: new Date()` | Line 68 | ✅ |
| 41 | POST: update response | `200 + { success: true, data: { id } }` | Line 70 | ✅ |
| 42 | POST: insert new | `db.insert(aiConfigs).values(...).returning(id)` | Lines 72-75 | ✅ |
| 43 | POST: insert values | `orgId, provider, apiKey, model: model \|\| null` | Line 74 | ✅ |
| 44 | POST: insert response | `201 + { success: true, data: { id } }` | Line 76 | ✅ |
| 45 | 405 response | `{ success: false, error: "Method not allowed" }` | Line 84 | ✅ |
| 46 | GET: try-catch with 500 error | Design mentions 500 in error handling table | Lines 18,39-42 (try-catch + 500 response) | ✅ |
| 47 | POST: try-catch with 500 error | Design mentions 500 in error handling table | Lines 50,78-81 (try-catch + 500 response) | ✅ |
| 48 | 500 error message | `"서버 오류가 발생했습니다."` | Lines 41, 80 | ✅ |

### 3. API - POST /api/ai/test (18 checkpoints)

| # | Checkpoint | Design | Implementation | Status |
|:-:|-----------|--------|----------------|:------:|
| 49 | File path | `src/pages/api/ai/test.ts` | File exists at this path | ✅ |
| 50 | Method check | `req.method !== "POST"` -> 405 | Lines 5-7 | ✅ |
| 51 | Auth check | `getUserFromRequest(req)` + 401 | Lines 9-12 | ✅ |
| 52 | Body destructuring | `{ provider, apiKey }` | Line 14 | ✅ |
| 53 | Required fields check | `!provider \|\| !apiKey` -> 400 | Lines 15-17 | ✅ |
| 54 | OpenAI test URL | `https://api.openai.com/v1/models` | Line 21 | ✅ |
| 55 | OpenAI auth header | `Authorization: Bearer ${apiKey}` | Line 22 | ✅ |
| 56 | OpenAI failure response | `200 + { connected: false, error: message }` | Lines 26-29 | ✅ |
| 57 | OpenAI success response | `200 + { connected: true }` | Lines 31-34 | ✅ |
| 58 | Anthropic test URL | `https://api.anthropic.com/v1/messages` | Line 38 | ✅ |
| 59 | Anthropic method | `POST` | Line 39 | ✅ |
| 60 | Anthropic headers | `x-api-key, anthropic-version, Content-Type` | Lines 41-43 | ✅ |
| 61 | Anthropic test body | model: claude-haiku-4-5, max_tokens: 1, messages: test | Lines 45-48 | ✅ |
| 62 | Anthropic auth error check | `error?.error?.type === "authentication_error"` | Line 53 | ✅ |
| 63 | Anthropic auth error response | `200 + { connected: false }` | Lines 54-57 | ✅ |
| 64 | Anthropic success response | `200 + { connected: true }` | Lines 60-63 | ✅ |
| 65 | Unsupported provider | `400 + "지원하지 않는 provider입니다."` | Line 66 | ✅ |
| 66 | Catch block (network error) | `200 + { connected: false, error: "연결에 실패했습니다." }` | Lines 67-73 | ✅ |

### 4. SWR Hook - useAiConfig (14 checkpoints)

| # | Checkpoint | Design | Implementation | Status |
|:-:|-----------|--------|----------------|:------:|
| 67 | File path | `src/hooks/useAiConfig.ts` | File exists at this path | ✅ |
| 68 | Import useSWR | `import useSWR from "swr"` | Line 1 | ✅ |
| 69 | AiConfigData interface | `{ id, provider, apiKey, model, isActive }` | Lines 3-9 | ✅ |
| 70 | AiConfigData.id type | `number` | Line 4 | ✅ |
| 71 | AiConfigData.apiKey comment | `// masked` | Line 6 | ✅ |
| 72 | AiConfigData.model type | `string \| null` | Line 7 | ✅ |
| 73 | AiConfigData.isActive type | `number` | Line 8 | ✅ |
| 74 | Fetcher definition | `(url: string) => fetch(url).then(r => r.json())` | Line 11 | ✅ |
| 75 | SWR key | `"/api/ai/config"` | Line 14 | ✅ |
| 76 | saveConfig function | POST to `/api/ai/config` with provider, apiKey, model | Lines 19-28 | ✅ |
| 77 | saveConfig mutate on success | `if (result.success) mutate()` | Line 26 | ✅ |
| 78 | testConnection function | POST to `/api/ai/test` with provider, apiKey | Lines 30-37 | ✅ |
| 79 | Return values | `config, isLoading, error, mutate, saveConfig, testConnection` | Lines 39-46 | ✅ |
| 80 | Config default null | `data?.data ?? null` | Line 40 | ✅ |

### 5. UI Component - AiConfigTab (13 checkpoints)

| # | Checkpoint | Design | Implementation | Status |
|:-:|-----------|--------|----------------|:------:|
| 81 | File path | `src/components/settings/AiConfigTab.tsx` | File exists at this path | ✅ |
| 82 | PROVIDER_OPTIONS | `[{openai, "OpenAI"}, {anthropic, "Anthropic"}]` | Lines 24-27 | ✅ |
| 83 | MODEL_OPTIONS openai | `gpt-4o, gpt-4o-mini, gpt-4-turbo, gpt-3.5-turbo` | Lines 30-35 | ✅ |
| 84 | MODEL_OPTIONS anthropic | `claude-sonnet-4-20250514, claude-haiku-4-5-20251001, claude-opus-4-20250115` | Lines 37-41 | ✅ |
| 85 | Card header title | `"AI 설정"` | Line 137 | ✅ |
| 86 | Card description | `"AI 모델 연동을 위한 API 키를 설정합니다."` | Line 138 | ✅ |
| 87 | Member permission notice | `"AI 설정은 관리자 이상만 수정할 수 있습니다."` | Line 143 | ✅ |
| 88 | State variables | provider, apiKey, model, isEditing, isTesting, isSubmitting | Lines 48-53 | ✅ |
| 89 | Provider change resets model | `handleProviderChange` sets first model of new provider | Lines 66-72 | ✅ |
| 90 | API key masked display with change button | Existing config shows disabled input + "변경" button | Lines 171-189 | ✅ |
| 91 | API key input type=password | `type="password"` in editing mode | Line 192 | ✅ |
| 92 | Test button variant=outline | `variant="outline"` on test button | Line 225 | ✅ |
| 93 | useAiConfig hook usage | `const { config, isLoading, saveConfig, testConnection } = useAiConfig()` | Line 45 | ✅ |

### 6. Settings Page Integration (4 checkpoints)

| # | Checkpoint | Design | Implementation | Status |
|:-:|-----------|--------|----------------|:------:|
| 94 | AiConfigTab import | `import AiConfigTab from "@/components/settings/AiConfigTab"` | Line 12 | ✅ |
| 95 | AI TabsTrigger | `<TabsTrigger value="ai">AI</TabsTrigger>` after fields | Line 56 | ✅ |
| 96 | AI TabsContent | `<TabsContent value="ai"><AiConfigTab /></TabsContent>` | Lines 75-77 | ✅ |
| 97 | Tab position | After fields tab | fields at L55, ai at L56 | ✅ |

---

## Gaps

No gaps found. All 97 checkpoints match between design and implementation.

---

## Implementation Quality Notes (Non-Gap Observations)

The implementation includes defensive patterns not explicitly specified in the design document but consistent with project conventions:

1. **try-catch on GET handler** (config.ts:18,39-42) - Design only showed the happy path code for GET, but the error handling table (Section 6) specified "500 + console.error + server error message" for DB errors. Implementation correctly adds try-catch blocks on both GET and POST.

2. **console.error logging** (config.ts:40,79; test.ts:68) - Error logging present in all catch blocks, matching the error handling specification.

3. **Cancel button on edit mode** (AiConfigTab.tsx:235-247) - Implementation adds a "Cancel" button when editing an existing config that restores previous values, a reasonable UX enhancement.

4. **Loading state** (AiConfigTab.tsx:125-127) - Loading spinner while fetching config data.

5. **Masked key check before save/test** (AiConfigTab.tsx:75,100) - Prevents submitting masked "***" values.

---

## Overall Score

| Category | Score | Status |
|----------|:-----:|:------:|
| Design Match | 100% | ✅ |
| Architecture Compliance | 100% | ✅ |
| Convention Compliance | 100% | ✅ |
| **Overall** | **100%** | ✅ |

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-02-20 | Initial analysis - 97 checkpoints, 100% match | gap-detector |
