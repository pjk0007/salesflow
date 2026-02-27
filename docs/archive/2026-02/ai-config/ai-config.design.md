# Design: AI 설정 (ai-config)

> Plan: [ai-config.plan.md](../../01-plan/features/ai-config.plan.md)

## 1. DB 스키마

### 1.1 ai_configs 테이블

`src/lib/db/schema.ts` — products 테이블 뒤, organizationInvitations 앞에 추가

```typescript
// ============================================
// AI 설정 (조직별)
// ============================================
export const aiConfigs = pgTable("ai_configs", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .unique()
        .notNull(),
    provider: varchar("provider", { length: 50 }).notNull(), // "openai" | "anthropic"
    apiKey: varchar("api_key", { length: 500 }).notNull(),
    model: varchar("model", { length: 100 }),
    isActive: integer("is_active").default(1).notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});
```

타입 추출 섹션에 추가:
```typescript
export type AiConfig = typeof aiConfigs.$inferSelect;
```

`src/lib/db/index.ts`는 이미 `export * from "./schema"` 패턴이므로 변경 불필요.

## 2. API 엔드포인트

### 2.1 GET/POST /api/ai/config

**파일**: `src/pages/api/ai/config.ts` (신규)

```typescript
import type { NextApiRequest, NextApiResponse } from "next";
import { db, aiConfigs } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";

function maskSecret(secret: string): string {
    if (secret.length <= 6) return "***";
    return secret.slice(0, 3) + "***" + secret.slice(-3);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    if (req.method === "GET") {
        // member도 조회 가능
        const [config] = await db
            .select()
            .from(aiConfigs)
            .where(eq(aiConfigs.orgId, user.orgId))
            .limit(1);

        if (!config) {
            return res.status(200).json({ success: true, data: null });
        }

        return res.status(200).json({
            success: true,
            data: {
                id: config.id,
                provider: config.provider,
                apiKey: maskSecret(config.apiKey),
                model: config.model,
                isActive: config.isActive,
            },
        });
    }

    if (req.method === "POST") {
        // admin/owner만 수정 가능
        if (user.role === "member") {
            return res.status(403).json({ success: false, error: "권한이 없습니다." });
        }

        const { provider, apiKey, model } = req.body;
        if (!provider || !apiKey) {
            return res.status(400).json({ success: false, error: "provider와 apiKey는 필수입니다." });
        }
        if (!["openai", "anthropic"].includes(provider)) {
            return res.status(400).json({ success: false, error: "지원하지 않는 provider입니다." });
        }

        const [existing] = await db
            .select({ id: aiConfigs.id })
            .from(aiConfigs)
            .where(eq(aiConfigs.orgId, user.orgId))
            .limit(1);

        if (existing) {
            await db
                .update(aiConfigs)
                .set({ provider, apiKey, model: model || null, updatedAt: new Date() })
                .where(eq(aiConfigs.id, existing.id));
            return res.status(200).json({ success: true, data: { id: existing.id } });
        } else {
            const [created] = await db
                .insert(aiConfigs)
                .values({ orgId: user.orgId, provider, apiKey, model: model || null })
                .returning({ id: aiConfigs.id });
            return res.status(201).json({ success: true, data: { id: created.id } });
        }
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
}
```

### 2.2 POST /api/ai/test

**파일**: `src/pages/api/ai/test.ts` (신규)

```typescript
import type { NextApiRequest, NextApiResponse } from "next";
import { getUserFromRequest } from "@/lib/auth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    const { provider, apiKey } = req.body;
    if (!provider || !apiKey) {
        return res.status(400).json({ success: false, error: "provider와 apiKey는 필수입니다." });
    }

    try {
        if (provider === "openai") {
            const response = await fetch("https://api.openai.com/v1/models", {
                headers: { Authorization: `Bearer ${apiKey}` },
            });
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                return res.status(200).json({
                    success: true,
                    data: { connected: false, error: error?.error?.message || "API 키가 유효하지 않습니다." },
                });
            }
            return res.status(200).json({
                success: true,
                data: { connected: true },
            });
        }

        if (provider === "anthropic") {
            const response = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                    "x-api-key": apiKey,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: "claude-haiku-4-5-20251001",
                    max_tokens: 1,
                    messages: [{ role: "user", content: "test" }],
                }),
            });
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                // authentication_error = 잘못된 키, 그 외 오류도 연결은 됨
                const isAuthError = error?.error?.type === "authentication_error";
                if (isAuthError) {
                    return res.status(200).json({
                        success: true,
                        data: { connected: false, error: "API 키가 유효하지 않습니다." },
                    });
                }
            }
            return res.status(200).json({
                success: true,
                data: { connected: true },
            });
        }

        return res.status(400).json({ success: false, error: "지원하지 않는 provider입니다." });
    } catch (error) {
        console.error("AI connection test error:", error);
        return res.status(200).json({
            success: true,
            data: { connected: false, error: "연결에 실패했습니다." },
        });
    }
}
```

## 3. SWR 훅

**파일**: `src/hooks/useAiConfig.ts` (신규)

```typescript
import useSWR from "swr";

interface AiConfigData {
    id: number;
    provider: string;
    apiKey: string; // masked
    model: string | null;
    isActive: number;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useAiConfig() {
    const { data, error, isLoading, mutate } = useSWR<{ success: boolean; data: AiConfigData | null }>(
        "/api/ai/config",
        fetcher
    );

    const saveConfig = async (input: { provider: string; apiKey: string; model?: string }) => {
        const res = await fetch("/api/ai/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const testConnection = async (input: { provider: string; apiKey: string }) => {
        const res = await fetch("/api/ai/test", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        return res.json();
    };

    return {
        config: data?.data ?? null,
        isLoading,
        error,
        mutate,
        saveConfig,
        testConnection,
    };
}
```

## 4. UI 컴포넌트

### 4.1 AiConfigTab

**파일**: `src/components/settings/AiConfigTab.tsx` (신규)

**구조**:
```
Card: AI 설정
├── CardHeader: "AI 설정" + "AI 모델 연동을 위한 API 키를 설정합니다."
├── CardContent (max-w-lg):
│   ├── 권한 안내 (member일 때): "AI 설정은 관리자 이상만 수정할 수 있습니다."
│   ├── AI 제공자 Select: OpenAI / Anthropic
│   ├── API 키 Input (type="password"): placeholder "sk-..." or "sk-ant-..."
│   │   └── 저장된 키가 있으면 마스킹된 값 표시 (disabled)
│   │   └── "변경" 버튼으로 편집 모드 진입
│   ├── 기본 모델 Select (provider에 따라 옵션 변경):
│   │   ├── OpenAI: gpt-4o, gpt-4o-mini, gpt-4-turbo, gpt-3.5-turbo
│   │   └── Anthropic: claude-sonnet-4-20250514, claude-haiku-4-5-20251001, claude-opus-4-20250115
│   ├── 연결 테스트 Button (variant="outline")
│   └── 저장 Button
```

**Provider별 모델 옵션 (하드코딩)**:
```typescript
const PROVIDER_OPTIONS = [
    { value: "openai", label: "OpenAI" },
    { value: "anthropic", label: "Anthropic" },
];

const MODEL_OPTIONS: Record<string, { value: string; label: string }[]> = {
    openai: [
        { value: "gpt-4o", label: "GPT-4o" },
        { value: "gpt-4o-mini", label: "GPT-4o Mini" },
        { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
        { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
    ],
    anthropic: [
        { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
        { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
        { value: "claude-opus-4-20250115", label: "Claude Opus 4" },
    ],
};
```

**상태 관리**:
- `provider`: 선택된 제공자
- `apiKey`: 입력 중인 API 키
- `model`: 선택된 모델
- `isEditing`: API 키 편집 모드 (기존 설정이 있을 때 false → "변경" 클릭으로 true)
- `isTesting`: 테스트 진행 중
- `isSubmitting`: 저장 진행 중

**동작 흐름**:
1. 페이지 로드 → useAiConfig()로 기존 설정 조회
2. 설정 없으면 빈 폼, 있으면 마스킹된 키 + 기존 provider/model 표시
3. provider 변경 시 model 초기화 (해당 provider의 첫 번째 모델)
4. "연결 테스트" 클릭 → testConnection → toast 결과
5. "저장" 클릭 → saveConfig → toast 결과 → mutate로 UI 갱신

### 4.2 설정 페이지 탭 추가

**파일**: `src/pages/settings.tsx` (수정)

변경 사항:
- `AiConfigTab` import 추가
- TabsList에 `<TabsTrigger value="ai">AI</TabsTrigger>` 추가 (fields 뒤)
- TabsContent에 `<TabsContent value="ai"><AiConfigTab /></TabsContent>` 추가

## 5. 구현 순서

| 순서 | 파일 | 작업 | 검증 |
|:----:|------|------|------|
| 1 | `src/lib/db/schema.ts` | aiConfigs 테이블 + AiConfig 타입 | `pnpm db:push` 성공 |
| 2 | `src/pages/api/ai/config.ts` | GET/POST API | curl 확인 |
| 3 | `src/pages/api/ai/test.ts` | 연결 테스트 API | curl 확인 |
| 4 | `src/hooks/useAiConfig.ts` | SWR 훅 | 타입 에러 없음 |
| 5 | `src/components/settings/AiConfigTab.tsx` | AI 설정 UI | 빌드 확인 |
| 6 | `src/pages/settings.tsx` | "AI" 탭 추가 | `pnpm build` 성공 |

## 6. 에러 핸들링

| 상황 | 처리 |
|------|------|
| 미인증 | 401 + "인증이 필요합니다." |
| member가 POST | 403 + "권한이 없습니다." |
| provider/apiKey 누락 | 400 + validation 메시지 |
| 잘못된 provider | 400 + "지원하지 않는 provider입니다." |
| DB 오류 | 500 + console.error + "서버 오류가 발생했습니다." |
| 연결 테스트 실패 | 200 + { connected: false, error: message } |
| 네트워크 오류 (test) | 200 + { connected: false, error: "연결에 실패했습니다." } |

## 7. 보안 고려사항

- API 키는 GET 시 항상 maskSecret()으로 마스킹
- POST는 admin/owner만 허용
- 연결 테스트 API는 서버 사이드에서만 외부 API 호출 (클라이언트에 키 노출 방지)
- 향후: AES 암호화 저장 고려 (현재는 plaintext DB 저장)
