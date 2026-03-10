# codebase-refactor Design Document

> **Summary**: SWR fetcher 통합, API handler wrapper, 자동화 공통 로직 추출, 대형 파일 분리, 품질 개선
>
> **Project**: SalesFlow
> **Date**: 2026-03-09
> **Status**: Draft
> **Planning Doc**: [codebase-refactor.plan.md](../01-plan/features/codebase-refactor.plan.md)

---

## 1. Overview

### 1.1 Design Goals

- 37개 SWR hook의 중복 fetcher를 1개로 통합
- 100+ API route의 인증/에러 보일러플레이트를 wrapper로 추출
- 자동화 3파일(alimtalk/email/ai-email)의 ~528줄 중복 코드를 공통 모듈로 추출
- ai.ts (1,095 LOC)를 9개 모듈로 분리
- 기능 변경 없음 (순수 리펙토링)

### 1.2 Design Principles

- **점진적 적용**: 한 번에 모든 파일을 바꾸지 않고, 유틸리티 생성 → 파일별 마이그레이션
- **하위 호환**: 기존 import 경로가 깨지지 않도록 re-export barrel 유지
- **최소 변경**: 각 파일에서 import 1줄 변경 + fetcher/boilerplate 삭제만

---

## 2. Phase 1: 공통 유틸리티 추출

### 2.1 SWR Fetcher 통합

**신규 파일**: `src/lib/swr-fetcher.ts`

```typescript
export const defaultFetcher = (url: string) => fetch(url).then((r) => r.json());
```

**적용 대상**: 37개 hook (Pattern A — 단순 fetch+json)

**마이그레이션 패턴**:
```typescript
// Before (각 hook 내부)
const fetcher = (url: string) => fetch(url).then((r) => r.json());
const { data } = useSWR(key, fetcher);

// After
import { defaultFetcher } from "@/lib/swr-fetcher";
const { data } = useSWR(key, defaultFetcher);
```

**제외**: `useAlimtalkSend.ts` (RequestInit 옵션 받는 별도 fetcher — 그대로 유지)

**적용 파일 목록**:

| # | 파일 | 비고 |
|---|------|------|
| 1 | useAlimtalkConfig.ts | |
| 2 | useAlimtalkTemplateCategories.ts | |
| 3 | useAlimtalkCategories.ts | |
| 4 | useAlimtalkLogs.ts | |
| 5 | useAlimtalkSenders.ts | |
| 6 | useAlimtalkStats.ts | |
| 7 | useAlimtalkTemplates.ts | |
| 8 | useAlimtalkTemplateLinks.ts | |
| 9 | useAnalytics.ts | |
| 10 | useApiTokens.ts | |
| 11 | useAiUsage.ts | |
| 12 | useAutoEnrich.ts | |
| 13 | useAutoPersonalizedEmail.ts | |
| 14 | useDashboardData.ts | |
| 15 | useDashboardSummary.ts | |
| 16 | useDashboards.ts | |
| 17 | useEmailAnalytics.ts | |
| 18 | useEmailCategories.ts | |
| 19 | useEmailConfig.ts | |
| 20 | useEmailLogs.ts | |
| 21 | useEmailTemplates.ts | |
| 22 | useEmailTemplateLinks.ts | |
| 23 | useFields.ts | |
| 24 | useOrgInvitations.ts | |
| 25 | useOrgMembers.ts | |
| 26 | useOrgSettings.ts | |
| 27 | usePartitions.ts | |
| 28 | useProducts.ts | |
| 29 | useRecords.ts | |
| 30 | useSignatures.ts | |
| 31 | useSenderProfiles.ts | |
| 32 | useUnifiedLogs.ts | |
| 33 | useUsers.ts | |
| 34 | useWebForms.ts | |
| 35 | useWorkspaces.ts | |
| 36 | useWorkspaceSettings.ts | |

---

### 2.2 API Handler Wrapper

**신규 파일**: `src/lib/api-handler.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest, type JWTPayload } from "@/lib/auth";

type ApiHandler = (
    req: NextRequest,
    user: JWTPayload,
    params?: Record<string, string>
) => Promise<NextResponse>;

interface ApiHandlerOptions {
    /** 최소 역할. "admin" | "owner" 지정 시 member 접근 차단 */
    minRole?: "admin" | "owner";
}

export function withAuth(handler: ApiHandler, options?: ApiHandlerOptions) {
    return async (req: NextRequest, context?: { params: Promise<Record<string, string>> }) => {
        const user = getUserFromNextRequest(req);
        if (!user) {
            return NextResponse.json(
                { success: false, error: "인증이 필요합니다." },
                { status: 401 }
            );
        }

        if (options?.minRole) {
            const roleOrder = { member: 0, admin: 1, owner: 2 };
            if ((roleOrder[user.role as keyof typeof roleOrder] ?? 0) < roleOrder[options.minRole]) {
                return NextResponse.json(
                    { success: false, error: "접근 권한이 없습니다." },
                    { status: 403 }
                );
            }
        }

        try {
            const params = context?.params ? await context.params : undefined;
            return await handler(req, user, params);
        } catch (error) {
            console.error(`API error [${req.method} ${req.nextUrl.pathname}]:`, error);
            return NextResponse.json(
                { success: false, error: "서버 오류가 발생했습니다." },
                { status: 500 }
            );
        }
    };
}
```

**마이그레이션 패턴**:
```typescript
// Before
export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    try {
        const data = await db.select()...;
        return NextResponse.json({ success: true, data });
    } catch (error) {
        console.error("Error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

// After
import { withAuth } from "@/lib/api-handler";

export const GET = withAuth(async (req, user) => {
    const data = await db.select()...;
    return NextResponse.json({ success: true, data });
});

// 역할 체크 필요한 경우
export const POST = withAuth(async (req, user) => {
    const body = await req.json();
    // ... business logic
    return NextResponse.json({ success: true, data }, { status: 201 });
}, { minRole: "admin" });
```

**적용 범위**: 모든 API route (100+)
**점진적 적용**: Phase 1에서는 유틸리티만 생성. API route 마이그레이션은 Phase 1 완료 후 점진적으로 진행 (한 번에 전부 바꾸면 리스크 큼)

---

### 2.3 자동화 공통 로직 추출

**신규 파일**: `src/lib/automation-shared.ts`

```typescript
import { db } from "@/lib/db";
import { eq, and, gte, inArray } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

/**
 * 범용 쿨다운 체크 — 지정 시간 내 동일 레코드에 발송 이력이 있는지 확인
 */
export async function checkCooldown(opts: {
    logTable: PgTable & { id: any; recordId: any; sentAt: any; status: any };
    recordId: number;
    additionalWhere: SQL;
    cooldownHours?: number;
}): Promise<boolean> {
    const since = new Date(Date.now() - (opts.cooldownHours ?? 1) * 3600_000);
    const [existing] = await db
        .select({ id: opts.logTable.id })
        .from(opts.logTable)
        .where(
            and(
                eq(opts.logTable.recordId, opts.recordId),
                opts.additionalWhere,
                gte(opts.logTable.sentAt, since),
                inArray(opts.logTable.status, ["sent", "pending"])
            )
        )
        .limit(1);
    return !existing;
}
```

**신규 파일**: `src/lib/email-sender-resolver.ts`

```typescript
import { db, emailSenderProfiles, emailSignatures } from "@/lib/db";
import { eq, and } from "drizzle-orm";

/** 기본 발신자 프로필 조회 (emailConfigs fallback 포함) */
export async function resolveDefaultSender(
    orgId: string,
    fallbackConfig?: { fromEmail: string | null; fromName: string | null }
): Promise<{ fromEmail: string | null; fromName?: string }> {
    const [defaultProfile] = await db
        .select()
        .from(emailSenderProfiles)
        .where(and(eq(emailSenderProfiles.orgId, orgId), eq(emailSenderProfiles.isDefault, true)))
        .limit(1);

    if (defaultProfile) {
        return { fromEmail: defaultProfile.fromEmail, fromName: defaultProfile.fromName };
    }
    if (fallbackConfig?.fromEmail) {
        return { fromEmail: fallbackConfig.fromEmail, fromName: fallbackConfig.fromName || undefined };
    }
    return { fromEmail: null };
}

/** 기본 서명 조회 (emailConfigs fallback 포함) */
export async function resolveDefaultSignature(
    orgId: string,
    fallbackConfig?: { signatureEnabled: boolean | null; signature: string | null }
): Promise<string | null> {
    const [defaultSig] = await db
        .select()
        .from(emailSignatures)
        .where(and(eq(emailSignatures.orgId, orgId), eq(emailSignatures.isDefault, true)))
        .limit(1);

    if (defaultSig) return defaultSig.signature;
    if (fallbackConfig?.signatureEnabled && fallbackConfig?.signature) return fallbackConfig.signature;
    return null;
}
```

**마이그레이션**:

| 기존 코드 위치 | 교체 내용 |
|---------------|-----------|
| `alimtalk-automation.ts:42-63` checkCooldown | `import { checkCooldown } from "./automation-shared"` + alimtalkSendLogs 전달 |
| `email-automation.ts:11-32` checkEmailCooldown | 동일 패턴, emailSendLogs 전달 |
| `auto-personalized-email.ts:11-26` checkCooldown | 동일 패턴, triggerType 조건 전달 |
| `email-automation.ts:49-77` sender+signature 조회 | `import { resolveDefaultSender, resolveDefaultSignature }` |
| `auto-personalized-email.ts:89-117` sender+signature 조회 | 동일 |

**예상 절감**: ~120줄 중복 제거

---

### 2.4 자동화 트리거 디스패치 통합

**신규 파일**: `src/lib/automation-dispatch.ts`

```typescript
import { processAutoTrigger } from "./alimtalk-automation";
import { processEmailAutoTrigger } from "./email-automation";
import { processAutoPersonalizedEmail } from "./auto-personalized-email";

interface AutoTriggerParams {
    record: Record<string, unknown>;
    partitionId: number;
    triggerType: "on_create" | "on_update";
    orgId: string;
}

/** 모든 자동화 트리거를 한 번에 실행 (각각 독립적으로 에러 핸들링) */
export function dispatchAutoTriggers(params: AutoTriggerParams): void {
    processAutoTrigger(params).catch((err) =>
        console.error("Alimtalk auto trigger error:", err)
    );
    processEmailAutoTrigger(params).catch((err) =>
        console.error("Email auto trigger error:", err)
    );
    processAutoPersonalizedEmail(params).catch((err) =>
        console.error("Auto personalized email error:", err)
    );
}
```

**적용 대상**: 3개 API route에서 9줄 → 1줄로

```typescript
// Before (3개 파일 각각 9줄)
processAutoTrigger({...}).catch(...);
processEmailAutoTrigger({...}).catch(...);
processAutoPersonalizedEmail({...}).catch(...);

// After
import { dispatchAutoTriggers } from "@/lib/automation-dispatch";
dispatchAutoTriggers({ record, partitionId, triggerType: "on_create", orgId: user.orgId });
```

---

## 3. Phase 2: 대형 파일 분리

### 3.1 ai.ts 분리 (1,095 LOC → 9 모듈)

**현재**: `src/lib/ai.ts` — 모든 AI 기능이 1파일

**분리 계획**:

```
src/lib/ai/
├── index.ts              (~30 LOC)  — re-export barrel
├── client.ts             (~20 LOC)  — getAiClient, AiClient type
├── gemini.ts             (~100 LOC) — callGeminiEmail, callGeminiJson, callGeminiWithSearch
├── json-utils.ts         (~80 LOC)  — extractJson, recoverTruncatedEmailJson
├── email.ts              (~170 LOC) — buildEmailSystemPrompt, generateEmail
├── search.ts             (~240 LOC) — generateProduct, generateCompanyResearch, generateFieldEnrichment
├── form.ts               (~100 LOC) — generateWebForm + types
├── dashboard.ts          (~170 LOC) — generateDashboard, generateWidget + types
├── alimtalk.ts           (~80 LOC)  — generateAlimtalk + types
└── quota.ts              (~130 LOC) — checkTokenQuota, updateTokenUsage, getUsageData, logAiUsage
```

**의존성 방향**:
```
client.ts ← gemini.ts ← json-utils.ts
                ↑
    ┌───────────┼───────────┬──────────┬──────────┐
  email.ts  search.ts   form.ts  dashboard.ts  alimtalk.ts

quota.ts (독립 — DB만 의존)
```

**index.ts (barrel)**:
```typescript
// 하위 호환을 위한 re-export
export { getAiClient, type AiClient } from "./client";
export { type SearchClient } from "./client"; // deprecated alias
export { extractJson } from "./json-utils";
export { buildEmailSystemPrompt, generateEmail, type GenerateEmailInput } from "./email";
export { generateProduct } from "./search";
export { generateCompanyResearch, type CompanyResearchResult } from "./search";
export { generateFieldEnrichment } from "./search";
export { generateWebForm } from "./form";
export { generateDashboard } from "./dashboard";
export { generateWidget } from "./dashboard";
export { generateAlimtalk } from "./alimtalk";
export { checkTokenQuota, updateTokenUsage, getUsageData, logAiUsage } from "./quota";
```

**기존 `src/lib/ai.ts`**: `index.ts`로 이동 (경로 `@/lib/ai` 유지)
**import 변경 불필요**: `import { generateEmail } from "@/lib/ai"` 그대로 동작

---

### 3.2 dashboards/page.tsx 분리 (612 LOC)

**현재 구조 분석**:
- 대시보드 선택/생성 UI (~150 LOC)
- 위젯 추가/편집/삭제 + 그리드 레이아웃 (~250 LOC)
- AI 대시보드 생성 영역 (~100 LOC)
- 범위 설정 Popover (~100 LOC)

**분리 계획**:

| 신규 파일 | 추출 대상 | 예상 LOC |
|-----------|-----------|----------|
| `src/components/dashboard/DashboardSelector.tsx` | 대시보드 목록 + 생성/삭제 버튼 | ~120 |
| `src/components/dashboard/DashboardEditor.tsx` | 위젯 그리드 + 추가/편집 | ~200 |
| `src/components/dashboard/AiDashboardCreator.tsx` | AI 생성 입력 영역 | ~80 |
| `src/components/dashboard/ScopeSelector.tsx` | 범위 Popover | ~90 |

**page.tsx** (~120 LOC): 상태 관리 + 하위 컴포넌트 조합만 남음

---

### 3.3 EmailConfigForm.tsx 분리 (510 LOC)

**분리 계획**:

| 신규 파일 | 추출 대상 | 예상 LOC |
|-----------|-----------|----------|
| `src/components/email/SenderProfileManager.tsx` | 발신자 프로필 CRUD 카드 + Dialog | ~150 |
| `src/components/email/SignatureManager.tsx` | 서명 CRUD 카드 + Dialog | ~160 |

**EmailConfigForm.tsx** (~200 LOC): NHN API 키 섹션 + 하위 컴포넌트 조합

---

### 3.4 ImportDialog.tsx 분리 (445 LOC)

**분리 계획**:

| 신규 파일 | 추출 대상 | 예상 LOC |
|-----------|-----------|----------|
| `src/components/records/import/FileUploadStep.tsx` | Step 1: 파일 선택 + 파싱 | ~100 |
| `src/components/records/import/FieldMappingStep.tsx` | Step 2: 필드 매핑 테이블 | ~150 |
| `src/components/records/import/ImportResultStep.tsx` | Step 3: 결과 표시 | ~80 |

**ImportDialog.tsx** (~115 LOC): Dialog shell + step state + step 라우팅

---

## 4. Phase 3: 품질 개선

### 4.1 deprecated 코드 정리

| 대상 | 파일 | 작업 |
|------|------|------|
| `SearchClient` type alias | ai.ts (또는 ai/client.ts) | `getSearchClient` alias 제거 (사용처 없음 확인 후) |

### 4.2 CRON_SECRET 일관성

| 파일 | 현재 | 수정 |
|------|------|------|
| `api/alimtalk/automation/process-repeats/route.ts` | CRON_SECRET 선택적 | 필수로 변경 (email과 동일) |

---

## 5. 구현 순서

| # | 작업 | 신규/수정 파일 | 검증 |
|---|------|---------------|------|
| 1 | `swr-fetcher.ts` 생성 + 37개 hook 마이그레이션 | 1 신규 + 36 수정 | `npx next build` |
| 2 | `api-handler.ts` 생성 (유틸리티만) | 1 신규 | `npx next build` |
| 3 | `automation-shared.ts` + `email-sender-resolver.ts` + `automation-dispatch.ts` 생성 | 3 신규 | `npx next build` |
| 4 | 자동화 3파일에 공통 모듈 적용 | 3 수정 | `npx next build` |
| 5 | 트리거 디스패치 3개 API route 적용 | 3 수정 | `npx next build` |
| 6 | ai.ts → ai/ 디렉토리 분리 | 9 신규 + 1 삭제(원본→index) | `npx next build` |
| 7 | dashboards/page.tsx 분리 | 4 신규 + 1 수정 | `npx next build` |
| 8 | EmailConfigForm.tsx 분리 | 2 신규 + 1 수정 | `npx next build` |
| 9 | ImportDialog.tsx 분리 | 3 신규 + 1 수정 | `npx next build` |
| 10 | deprecated 정리 + CRON 일관성 | 2 수정 | `npx next build` |

---

## 6. 리스크 & 완화

| 리스크 | 영향 | 완화 |
|--------|------|------|
| ai.ts barrel re-export 누락 | import 에러 → 빌드 실패 | 분리 후 즉시 `npx next build` |
| SWR fetcher 교체 시 타입 불일치 | 런타임 에러 | 동일 시그니처 보장 (`(url: string) => Promise<any>`) |
| API handler wrapper의 params 구조 | Next.js 16의 async params | `context?.params`를 await 처리 |
| 자동화 공통 로직 타입 안전성 | 테이블 컬럼 타입 불일치 | Drizzle PgTable 제네릭으로 타입 체크 |

---

## 7. 예상 결과

| 메트릭 | Before | After |
|--------|--------|-------|
| 중복 fetcher 정의 | 37개 | 1개 |
| 자동화 중복 코드 | ~528줄 | ~80줄 |
| ai.ts LOC | 1,095 | max ~240 (search.ts) |
| dashboards/page.tsx LOC | 612 | ~120 |
| EmailConfigForm.tsx LOC | 510 | ~200 |
| ImportDialog.tsx LOC | 445 | ~115 |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | 2026-03-09 | Initial draft |
