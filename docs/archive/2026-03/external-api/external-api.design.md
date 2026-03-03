# Design: external-api

## 1. 파일 변경 목록

| # | 파일 | 작업 | LOC |
|---|------|------|-----|
| 1 | `src/lib/db/schema.ts` | `apiTokenScopes` 테이블 추가 | +15 |
| 2 | `drizzle/0014_api_token_scopes.sql` | 마이그레이션 | +10 |
| 3 | `src/lib/auth.ts` | 토큰 권한 검증 함수 추가/수정 | +80 |
| 4 | `src/app/api/api-tokens/route.ts` | 토큰 CRUD (GET, POST) | ~120 |
| 5 | `src/app/api/api-tokens/[id]/route.ts` | 토큰 CRUD (PUT, DELETE) | ~100 |
| 6 | `src/app/api/v1/records/route.ts` | 외부 레코드 목록/생성 | ~180 |
| 7 | `src/app/api/v1/records/[id]/route.ts` | 외부 레코드 상세/수정/삭제 | ~130 |
| 8 | `src/hooks/useApiTokens.ts` | SWR 훅 | ~60 |
| 9 | `src/components/settings/ApiTokensTab.tsx` | 토큰 관리 UI | ~200 |
| 10 | `src/components/settings/ApiTokenCreateDialog.tsx` | 토큰 생성/수정 다이얼로그 | ~250 |
| 11 | `src/app/settings/organization/page.tsx` | 탭 추가 (api-tokens) | +10 |

## 2. 상세 설계

### 2-1. `src/lib/db/schema.ts` — apiTokenScopes 테이블

```typescript
// ============================================
// API 토큰 권한 범위
// ============================================
export const apiTokenScopes = pgTable("api_token_scopes", {
    id: serial("id").primaryKey(),
    tokenId: integer("token_id")
        .references(() => apiTokens.id, { onDelete: "cascade" })
        .notNull(),
    scopeType: varchar("scope_type", { length: 20 }).notNull(), // "workspace" | "folder" | "partition"
    scopeId: integer("scope_id").notNull(),
    permissions: jsonb("permissions")
        .$type<{ read: boolean; create: boolean; update: boolean; delete: boolean }>()
        .notNull(),
});

export type ApiTokenScope = typeof apiTokenScopes.$inferSelect;
```

### 2-2. `drizzle/0014_api_token_scopes.sql` — 마이그레이션

```sql
CREATE TABLE IF NOT EXISTS "api_token_scopes" (
    "id" serial PRIMARY KEY NOT NULL,
    "token_id" integer NOT NULL REFERENCES "api_tokens"("id") ON DELETE CASCADE,
    "scope_type" varchar(20) NOT NULL,
    "scope_id" integer NOT NULL,
    "permissions" jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS "api_token_scopes_token_idx" ON "api_token_scopes" ("token_id");
```

drizzle/meta/_journal.json에 idx 14 항목 추가.

### 2-3. `src/lib/auth.ts` — 토큰 권한 검증 함수

기존 함수 수정 + 새 함수 추가:

```typescript
// --- 기존 verifyApiToken 수정 ---
// 반환 타입 변경: boolean → ApiTokenInfo | null
interface ApiTokenInfo {
    id: number;
    orgId: string;
    scopes: ApiTokenScope[];
}

export async function resolveApiToken(tokenStr: string): Promise<ApiTokenInfo | null> {
    // 1. apiTokens에서 토큰 조회 (isActive=1, 만료되지 않음)
    //    - orgId를 헤더에서 받지 않음! 토큰 자체로 org 식별
    // 2. apiTokenScopes에서 해당 tokenId의 scopes 전부 조회
    // 3. lastUsedAt 업데이트
    // 4. return { id, orgId, scopes }
}

// --- 새 함수 ---
export function getApiTokenFromNextRequest(req: NextRequest): string | null {
    // Authorization: Bearer <token> 또는 x-api-key 헤더
    const authHeader = req.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
        return authHeader.substring(7);
    }
    const apiKey = req.headers.get("x-api-key");
    return apiKey || null;
}

type Permission = "read" | "create" | "update" | "delete";

export async function checkTokenAccess(
    tokenInfo: ApiTokenInfo,
    partitionId: number,
    permission: Permission
): Promise<boolean> {
    // 1. tokenInfo.scopes에서 permission 체크
    // 2. scope 매칭 로직:
    //    - scopeType === "partition": scopeId === partitionId → permissions[permission]
    //    - scopeType === "folder": DB 조회 — partitions.folderId === scopeId → permissions[permission]
    //    - scopeType === "workspace": DB 조회 — partitions.workspaceId === scopeId → permissions[permission]
    // 3. 하나라도 매칭되면 true
}
```

**핵심 변경**: 기존 `verifyApiToken(token, orgId)` → `resolveApiToken(tokenStr)` — orgId를 헤더에서 받지 않고 토큰 자체로 org 식별. 기존 `verifyApiToken`/`authenticateRequest`는 현재 사용처 없으므로 그대로 유지 (호환성).

### 2-4. `src/app/api/api-tokens/route.ts` — 토큰 관리 API (GET, POST)

```typescript
// GET /api/api-tokens — 토큰 목록 조회
// Auth: JWT (owner/admin만)
export async function GET(req: NextRequest) {
    // 1. getUserFromNextRequest(req) — 인증
    // 2. role 체크: owner/admin만 허용
    // 3. SELECT apiTokens WHERE orgId = user.orgId, ORDER BY createdAt DESC
    // 4. 각 토큰에 대해 apiTokenScopes JOIN
    // 5. 토큰 값은 앞 8자만 표시: token.slice(0, 8) + "..."
    // 6. 반환: { success: true, data: tokens[] }
    //    tokens[]: { id, name, tokenPreview, scopes[], lastUsedAt, expiresAt, isActive, createdAt }
}

// POST /api/api-tokens — 토큰 생성
// Auth: JWT (owner/admin만)
export async function POST(req: NextRequest) {
    // 1. getUserFromNextRequest(req) — 인증 + role 체크
    // 2. body: { name: string, expiresIn?: "30d" | "90d" | "1y" | null, scopes: ScopeInput[] }
    //    ScopeInput: { scopeType, scopeId, permissions: { read, create, update, delete } }
    // 3. 유효성:
    //    - name 필수 (1-100자)
    //    - scopes 최소 1개
    //    - scopeType은 "workspace" | "folder" | "partition" 중 하나
    //    - scopeId는 해당 org에 속하는지 검증
    // 4. 토큰 생성: crypto.randomBytes(32).toString('hex') → 64자
    // 5. expiresAt 계산: expiresIn에 따라 Date 계산 (null이면 null)
    // 6. INSERT apiTokens + INSERT apiTokenScopes (트랜잭션)
    // 7. 반환: { success: true, data: { id, name, token (평문!), scopes, expiresAt } }
    //    ⚠️ 이 응답에서만 평문 토큰 반환. 이후 재조회 불가.
}
```

### 2-5. `src/app/api/api-tokens/[id]/route.ts` — 토큰 관리 API (PUT, DELETE)

```typescript
// PUT /api/api-tokens/[id] — 토큰 수정
// Auth: JWT (owner/admin만)
export async function PUT(req: NextRequest, { params }) {
    // 1. 인증 + role 체크
    // 2. 토큰 소유권 확인 (tokenId, orgId)
    // 3. body: { name?, isActive?, scopes?: ScopeInput[] }
    // 4. name 업데이트 (있으면)
    // 5. isActive 업데이트 (있으면)
    // 6. scopes 업데이트 (있으면): DELETE 기존 scopes → INSERT 새 scopes (트랜잭션)
    // 7. 반환: { success: true, data: updated token }
}

// DELETE /api/api-tokens/[id] — 토큰 삭제
// Auth: JWT (owner/admin만)
export async function DELETE(req: NextRequest, { params }) {
    // 1. 인증 + role 체크
    // 2. 토큰 소유권 확인
    // 3. DELETE apiTokens WHERE id (cascade로 scopes도 삭제)
    // 4. 반환: { success: true, message: "토큰이 삭제되었습니다." }
}
```

### 2-6. `src/app/api/v1/records/route.ts` — 외부 레코드 API (GET, POST)

```typescript
// 공통 인증 헬퍼 (이 파일 내 로컬 함수)
async function authenticateExternalRequest(req: NextRequest) {
    // 1. getApiTokenFromNextRequest(req) → tokenStr
    // 2. resolveApiToken(tokenStr) → ApiTokenInfo | null
    // 3. null이면 401 응답
    // 4. return tokenInfo
}

// GET /api/v1/records?partitionId=N&page=1&pageSize=50&search=...&filters=[...]
export async function GET(req: NextRequest) {
    // 1. authenticateExternalRequest(req)
    // 2. partitionId 필수 (query param)
    // 3. checkTokenAccess(tokenInfo, partitionId, "read") — 403 if false
    // 4. 기존 GET /api/partitions/[id]/records 로직 재사용:
    //    - page, pageSize, search, sortField, sortOrder, filters 파라미터
    //    - WHERE partitionId + 필터 조건
    //    - ORDER BY + LIMIT/OFFSET
    // 5. 반환: { success: true, data: records[], total, page, pageSize, totalPages }
}

// POST /api/v1/records
export async function POST(req: NextRequest) {
    // 1. authenticateExternalRequest(req)
    // 2. body: { partitionId: number, data: Record<string, unknown> }
    // 3. checkTokenAccess(tokenInfo, partitionId, "create") — 403 if false
    // 4. verifyPartitionAccess(partitionId, tokenInfo.orgId) — 404 if false
    // 5. 플랜 제한 체크 (checkPlanLimit)
    // 6. 중복 체크 (duplicateCheckField)
    // 7. 트랜잭션: 통합코드 발번 + 분배순서 + 레코드 생성
    //    (기존 POST /api/partitions/[id]/records 로직과 동일)
    // 8. 자동화 트리거 (alimtalk/email)
    // 9. SSE broadcast
    // 10. 반환: { success: true, data: record }
}
```

### 2-7. `src/app/api/v1/records/[id]/route.ts` — 외부 레코드 API (GET, PUT, DELETE)

```typescript
// GET /api/v1/records/[id] — 레코드 상세 조회
export async function GET(req: NextRequest, { params }) {
    // 1. authenticateExternalRequest(req)
    // 2. records WHERE id AND orgId → record
    // 3. checkTokenAccess(tokenInfo, record.partitionId, "read") — 403 if false
    // 4. 반환: { success: true, data: record }
}

// PUT /api/v1/records/[id] — 레코드 수정
export async function PUT(req: NextRequest, { params }) {
    // 1. authenticateExternalRequest(req)
    // 2. body: { data: Record<string, unknown> }
    // 3. 기존 레코드 조회 (orgId 검증)
    // 4. checkTokenAccess(tokenInfo, record.partitionId, "update") — 403 if false
    // 5. data 병합 (기존 PATCH 로직 동일: {...existing.data, ...newData})
    // 6. UPDATE + returning
    // 7. 자동화 트리거 + SSE broadcast
    // 8. 반환: { success: true, data: updated }
}

// DELETE /api/v1/records/[id] — 레코드 삭제
export async function DELETE(req: NextRequest, { params }) {
    // 1. authenticateExternalRequest(req)
    // 2. 기존 레코드 조회 (orgId 검증)
    // 3. checkTokenAccess(tokenInfo, record.partitionId, "delete") — 403 if false
    // 4. DELETE record
    // 5. SSE broadcast
    // 6. 반환: { success: true, message: "레코드가 삭제되었습니다." }
}
```

### 2-8. `src/hooks/useApiTokens.ts` — SWR 훅

```typescript
export function useApiTokens() {
    const { data, error, isLoading, mutate } = useSWR<ApiResponse<ApiTokenWithScopes[]>>(
        "/api/api-tokens",
        fetcher
    );

    const createToken = async (input: CreateTokenInput) => {
        // POST /api/api-tokens
        // 성공 시 mutate() + return result (평문 토큰 포함)
    };

    const updateToken = async (id: number, input: UpdateTokenInput) => {
        // PUT /api/api-tokens/{id}
        // 성공 시 mutate()
    };

    const deleteToken = async (id: number) => {
        // DELETE /api/api-tokens/{id}
        // 성공 시 mutate()
    };

    return {
        tokens: data?.data ?? [],
        isLoading,
        error,
        createToken,
        updateToken,
        deleteToken,
    };
}

// 타입
interface ApiTokenWithScopes {
    id: number;
    name: string;
    tokenPreview: string; // 앞 8자 + "..."
    scopes: Array<{
        id: number;
        scopeType: string;
        scopeId: number;
        scopeName?: string; // UI 표시용 — API에서 JOIN해서 반환
        permissions: { read: boolean; create: boolean; update: boolean; delete: boolean };
    }>;
    lastUsedAt: string | null;
    expiresAt: string | null;
    isActive: number;
    createdAt: string;
}

interface CreateTokenInput {
    name: string;
    expiresIn: "30d" | "90d" | "1y" | null;
    scopes: Array<{
        scopeType: "workspace" | "folder" | "partition";
        scopeId: number;
        permissions: { read: boolean; create: boolean; update: boolean; delete: boolean };
    }>;
}

interface UpdateTokenInput {
    name?: string;
    isActive?: number;
    scopes?: CreateTokenInput["scopes"];
}
```

### 2-9. `src/components/settings/ApiTokensTab.tsx` — 토큰 관리 UI

```
레이아웃:
┌──────────────────────────────────────────────┐
│ Card: API 토큰                                │
│ ┌────────────────────────────────────────────┐│
│ │ CardHeader: "API 토큰" + "토큰 생성" 버튼   ││
│ ├────────────────────────────────────────────┤│
│ │ Table:                                     ││
│ │ | 이름 | 토큰 | 권한 | 마지막 사용 | 만료 | 상태 | 액션 | ││
│ │ | ... | sk_xxxx... | 3개 범위 | 2분 전 | 2026-06-01 | ✅ | ⋯ | ││
│ └────────────────────────────────────────────┘│
└──────────────────────────────────────────────┘
```

- **토큰 목록 테이블**:
  - 이름 (varchar)
  - 토큰 미리보기 (앞 8자 + "..." — font-mono)
  - 권한 범위 요약 (Badge: "3개 범위")
  - 마지막 사용 (상대 시간)
  - 만료일 (없으면 "무제한")
  - 상태 (활성/비활성 — Switch 토글)
  - 액션 (DropdownMenu: 수정, 삭제)
- **빈 상태**: "등록된 API 토큰이 없습니다."
- **삭제**: AlertDialog 확인
- **상태 토글**: Switch 변경 즉시 updateToken({ isActive: 0|1 })

### 2-10. `src/components/settings/ApiTokenCreateDialog.tsx` — 생성/수정 다이얼로그

```
다이얼로그 구조:
┌──────────────────────────────────────────────┐
│ DialogHeader: "API 토큰 생성" / "수정"        │
├──────────────────────────────────────────────┤
│ [토큰 이름] Input                             │
│ [만료 기간] Select: 없음/30일/90일/1년         │
├──────────────────────────────────────────────┤
│ 권한 범위 설정:                                │
│ ┌────────────────────────────────────────┐   │
│ │ 워크스페이스 선택: Select               │   │
│ │                                        │   │
│ │ 범위 목록 (추가된 항목들):              │   │
│ │ ┌──────────────────────────────────┐   │   │
│ │ │ [전체] 워크스페이스 "영업팀"       │   │   │
│ │ │ ☑ 조회 ☑ 생성 ☐ 수정 ☐ 삭제     │   │   │
│ │ │                            [삭제] │   │   │
│ │ └──────────────────────────────────┘   │   │
│ │ ┌──────────────────────────────────┐   │   │
│ │ │ [파티션] "신규 리드"              │   │   │
│ │ │ ☑ 조회 ☑ 생성 ☑ 수정 ☑ 삭제     │   │   │
│ │ │                            [삭제] │   │   │
│ │ └──────────────────────────────────┘   │   │
│ │                                        │   │
│ │ [+ 범위 추가]                          │   │
│ └────────────────────────────────────────┘   │
├──────────────────────────────────────────────┤
│ [취소] [생성]                                 │
└──────────────────────────────────────────────┘

범위 추가 Popover:
┌──────────────────────────────────────┐
│ 범위 유형: ○ 워크스페이스 ○ 폴더 ○ 파티션 │
│ 대상 선택: Select (유형에 따라 목록 변경) │
│ [추가]                                │
└──────────────────────────────────────┘
```

**Props**:
```typescript
interface ApiTokenCreateDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    mode: "create" | "edit";
    token?: ApiTokenWithScopes; // mode=edit일 때
    onSuccess: (result: { token?: string }) => void; // create 시 평문 토큰 전달
}
```

**State**:
```typescript
const [name, setName] = useState("");
const [expiresIn, setExpiresIn] = useState<string | null>(null);
const [scopes, setScopes] = useState<ScopeInput[]>([]);
const [submitting, setSubmitting] = useState(false);
```

**범위 추가 플로우**:
1. "+ 범위 추가" 버튼 → Popover 열림
2. 범위 유형 선택: RadioGroup (workspace/folder/partition)
3. 대상 선택: Select (useWorkspaces/usePartitions 훅으로 목록 조회)
   - workspace 선택 시: 워크스페이스 목록
   - folder 선택 시: 워크스페이스 선택 → 폴더 목록
   - partition 선택 시: 워크스페이스 선택 → 파티션 목록 (폴더 그룹화)
4. 추가 버튼 → scopes 배열에 항목 추가 (기본 권한: read=true, 나머지 false)
5. 각 범위 항목에서 권한 체크박스 개별 토글

**토큰 생성 후 표시 다이얼로그** (onSuccess에서 처리):
- ApiTokensTab에서 `createdToken` state로 관리
- AlertDialog: "토큰이 생성되었습니다. 이 토큰은 다시 표시되지 않습니다."
- 토큰 값: font-mono + 복사 버튼 (navigator.clipboard.writeText)
- "확인" 버튼으로 닫기

### 2-11. `src/app/settings/organization/page.tsx` — 탭 추가

```diff
+ import { Key } from "lucide-react";
+ import ApiTokensTab from "@/components/settings/ApiTokensTab";

  <TabsList>
      ...
+     <TabsTrigger value="api-tokens">
+         <Key className="mr-2 h-4 w-4" />
+         API 토큰
+     </TabsTrigger>
  </TabsList>

+ <TabsContent value="api-tokens" className="mt-6">
+     <ApiTokensTab />
+ </TabsContent>
```

## 3. 구현 순서

| # | 파일 | 의존 | 검증 |
|---|------|------|------|
| 1 | `schema.ts` + `0014_api_token_scopes.sql` + `_journal.json` | 없음 | 타입 에러 없음 |
| 2 | `auth.ts` — resolveApiToken, getApiTokenFromNextRequest, checkTokenAccess | schema | 타입 에러 없음 |
| 3 | `/api/api-tokens/route.ts` (GET, POST) | auth | 타입 에러 없음 |
| 4 | `/api/api-tokens/[id]/route.ts` (PUT, DELETE) | auth | 타입 에러 없음 |
| 5 | `/api/v1/records/route.ts` (GET, POST) | auth | 타입 에러 없음 |
| 6 | `/api/v1/records/[id]/route.ts` (GET, PUT, DELETE) | auth | 타입 에러 없음 |
| 7 | `useApiTokens.ts` | API routes | — |
| 8 | `ApiTokenCreateDialog.tsx` | useApiTokens, useWorkspaces, usePartitions | — |
| 9 | `ApiTokensTab.tsx` | useApiTokens, ApiTokenCreateDialog | — |
| 10 | `settings/organization/page.tsx` — 탭 추가 | ApiTokensTab | — |
| 11 | `pnpm build` | 전체 | 빌드 성공 |
