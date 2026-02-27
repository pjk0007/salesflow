# field-management Design Document

> **Summary**: 레코드 속성(필드) 관리 — 설정 페이지에서 워크스페이스 필드 CRUD 및 순서 변경
>
> **Project**: sales-manager
> **Version**: 0.1.0
> **Author**: AI
> **Date**: 2026-02-12
> **Status**: Draft
> **Planning Doc**: [field-management.plan.md](../../01-plan/features/field-management.plan.md)

---

## 1. Overview

### 1.1 Design Goals

- 설정 페이지에서 워크스페이스별 필드 정의를 관리할 수 있는 UI 제공
- 기존 `field_definitions` 테이블 스키마를 그대로 활용
- 기존 프로젝트 패턴(SWR, Dialog, API 응답 형식) 일관성 유지
- 시스템 필드 보호 및 안전한 삭제 확인

### 1.2 Design Principles

- 기존 API/Hook/UI 패턴 준수 (usePartitions, CreatePartitionDialog 등 참고)
- form onSubmit 패턴 사용 (엔터키 이중 제출 방지)
- 최소 변경 원칙 — 기존 useFields 훅 수정 최소화

---

## 2. Architecture

### 2.1 Component Diagram

```
┌──────────────────┐     ┌───────────────────────────────────┐     ┌──────────────┐
│ FieldManagementTab│────▶│ API Routes                        │────▶│ PostgreSQL   │
│ CreateFieldDialog │     │  POST   /api/workspaces/[id]/fields│     │ field_defs   │
│ EditFieldDialog   │     │  PATCH  /api/fields/[id]          │     │ partitions   │
│ DeleteFieldDialog │     │  DELETE /api/fields/[id]          │     └──────────────┘
└──────────────────┘     │  PATCH  /api/workspaces/[id]/fields/reorder │
                         └───────────────────────────────────┘
```

### 2.2 Data Flow

```
사용자 입력 → Dialog Form → Hook (fetch) → API → DB → SWR mutate → UI 갱신
```

---

## 3. Data Model

### 3.1 기존 Entity (수정 없음)

```typescript
// src/lib/db/schema.ts:86-116 — 그대로 사용
interface FieldDefinition {
  id: number;
  workspaceId: number;
  key: string;              // unique per workspace
  label: string;
  fieldType: FieldType;     // text|number|date|datetime|select|phone|textarea|checkbox|file|currency|formula|user_select|email
  category: string | null;
  sortOrder: number;
  isRequired: boolean;      // DB: integer (0/1)
  isSystem: boolean;        // DB: integer (0/1)
  defaultWidth: number;
  minWidth: number;
  cellType: CellType | null;
  cellClassName: string | null;
  options: string[] | null;
  statusOptionCategoryId: number | null;
  formulaConfig: FormulaConfig | null;
}
```

### 3.2 신규 Types

```typescript
// src/types/index.ts에 추가

export interface CreateFieldInput {
  key: string;
  label: string;
  fieldType: FieldType;
  category?: string;
  isRequired?: boolean;
  options?: string[];
}

export interface UpdateFieldInput {
  label?: string;
  category?: string;
  isRequired?: boolean;
  options?: string[];
  defaultWidth?: number;
}

export interface ReorderFieldsInput {
  fieldIds: number[];  // id 배열 (순서대로)
}
```

### 3.3 FieldType → CellType 자동 매핑

```typescript
const FIELD_TYPE_TO_CELL_TYPE: Record<FieldType, CellType> = {
  text: "editable",
  number: "editable",
  currency: "currency",
  date: "date",
  datetime: "date",
  select: "select",
  phone: "phone",
  email: "email",
  textarea: "textarea",
  checkbox: "checkbox",
  file: "file",
  formula: "formula",
  user_select: "user_select",
};
```

---

## 4. API Specification

### 4.1 Endpoint List

| Method | Path | Description | Auth | Role |
|--------|------|-------------|------|------|
| GET | `/api/workspaces/[id]/fields` | 필드 목록 (기존) | Required | any |
| POST | `/api/workspaces/[id]/fields` | 필드 생성 | Required | admin+ |
| PATCH | `/api/fields/[id]` | 필드 수정 | Required | admin+ |
| DELETE | `/api/fields/[id]` | 필드 삭제 | Required | admin+ |
| PATCH | `/api/workspaces/[id]/fields/reorder` | 순서 일괄 변경 | Required | admin+ |

### 4.2 POST /api/workspaces/[id]/fields (필드 생성)

**파일**: `src/pages/api/workspaces/[id]/fields.ts` (기존 GET에 POST 추가)

**Request:**
```json
{
  "key": "customerType",
  "label": "고객 유형",
  "fieldType": "select",
  "category": "고객정보",
  "isRequired": false,
  "options": ["개인", "법인", "기관"]
}
```

**Response (201):**
```json
{
  "success": true,
  "data": { "id": 12, "key": "customerType", "label": "고객 유형" }
}
```

**처리 로직:**
1. 인증 + 권한(admin+) 체크
2. 워크스페이스 소유권 검증
3. key 검증: 영문 소문자+숫자+camelCase, 빈 값 불가
4. key 중복 체크 (DB unique constraint 활용)
5. `cellType` 자동 매핑 (fieldType 기반)
6. `sortOrder`: 현재 max + 1
7. INSERT field_definitions
8. 기존 파티션의 visibleFields에 새 key 추가 (FR-11)

**Error Responses:**
- `400`: key/label 미입력, key 형식 오류
- `401`: 인증 필요
- `403`: 권한 부족 (member)
- `409`: key 중복

### 4.3 PATCH /api/fields/[id] (필드 수정)

**파일**: `src/pages/api/fields/[id].ts` (신규)

**Request:**
```json
{
  "label": "고객 유형 (수정)",
  "category": "분류",
  "isRequired": true,
  "options": ["개인", "법인", "기관", "기타"],
  "defaultWidth": 150
}
```

**Response (200):**
```json
{
  "success": true,
  "data": { "id": 12, "label": "고객 유형 (수정)" }
}
```

**처리 로직:**
1. 인증 + 권한(admin+) 체크
2. 필드 조회 + 워크스페이스 소유권 검증 (fieldDefinitions JOIN workspaces)
3. key, fieldType은 수정 불가 (요청에 포함되어도 무시)
4. UPDATE field_definitions

### 4.4 DELETE /api/fields/[id] (필드 삭제)

**파일**: `src/pages/api/fields/[id].ts` (위와 같은 파일)

**Response (200):**
```json
{ "success": true }
```

**처리 로직:**
1. 인증 + 권한(admin+) 체크
2. 필드 조회 + 소유권 검증
3. isSystem 체크 — 시스템 필드는 삭제 불가 (400 반환)
4. DELETE field_definitions
5. 기존 파티션의 visibleFields에서 해당 key 제거

**Error Responses:**
- `400`: 시스템 필드 삭제 시도
- `401`: 인증 필요
- `403`: 권한 부족
- `404`: 필드 없음

### 4.5 PATCH /api/workspaces/[id]/fields/reorder (순서 변경)

**파일**: `src/pages/api/workspaces/[id]/fields/reorder.ts` (신규)

**Request:**
```json
{
  "fieldIds": [1, 3, 2, 4, 5, 6, 7, 8, 9, 10, 11]
}
```

**Response (200):**
```json
{ "success": true }
```

**처리 로직:**
1. 인증 + 권한(admin+) 체크
2. 워크스페이스 소유권 검증
3. fieldIds 배열의 각 id에 대해 sortOrder = index로 UPDATE (트랜잭션)

---

## 5. UI/UX Design

### 5.1 Screen Layout — FieldManagementTab

```
┌──────────────────────────────────────────────────────────┐
│ 설정                                                      │
│ [워크스페이스] [조직] [사용자] [속성 관리]                  │
├──────────────────────────────────────────────────────────┤
│                                                          │
│ ┌───────────────────────────────────────────────────────┐│
│ │ 워크스페이스 목록 (카드 그리드) — WorkspaceSettingsTab │ │
│ │ 과 동일한 방식으로 워크스페이스 선택                    ││
│ └───────────────────────────────────────────────────────┘│
│                                                          │
│ ──────────────────────────────────────────────────────── │
│                                                          │
│ 속성 목록                            [+ 속성 추가]       │
│                                                          │
│ ┌────┬────────────┬──────────┬───────┬──────┬────────┐  │
│ │ 순서│ 라벨       │ key      │ 타입  │ 필수 │ 작업   │  │
│ ├────┼────────────┼──────────┼───────┼──────┼────────┤  │
│ │ ↑↓ │ 통합코드   │integra.. │ text  │      │ 🔒     │  │
│ │ ↑↓ │ 등록일     │registr.. │ datet.│      │ 🔒     │  │
│ │ ↑↓ │ 진행상태   │progres.. │ select│      │ ✏️ 🗑️ │  │
│ │ ↑↓ │ 상호명     │company.. │ text  │      │ ✏️ 🗑️ │  │
│ │ ↑↓ │ 대표자명   │represe.. │ text  │      │ ✏️ 🗑️ │  │
│ │ ↑↓ │ 대표 연락처│represe.. │ phone │      │ ✏️ 🗑️ │  │
│ │ ↑↓ │ 사업자번호 │busines.. │ text  │      │ ✏️ 🗑️ │  │
│ │ ↑↓ │ 사업장 주소│busines.. │ texta.│      │ ✏️ 🗑️ │  │
│ │ ↑↓ │ 이메일     │email     │ email │      │ ✏️ 🗑️ │  │
│ │ ↑↓ │ 담당 영업자│salespe.. │ text  │      │ ✏️ 🗑️ │  │
│ │ ↑↓ │ 비고       │note      │ texta.│      │ ✏️ 🗑️ │  │
│ └────┴────────────┴──────────┴───────┴──────┴────────┘  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 5.2 CreateFieldDialog

```
┌──────────────────────────────────┐
│ 새 속성 추가                      │
├──────────────────────────────────┤
│                                  │
│ Key (영문) *                     │
│ [___________________________]    │
│                                  │
│ 라벨 *                           │
│ [___________________________]    │
│                                  │
│ 타입 *                           │
│ [텍스트              ▼]          │
│                                  │
│ 카테고리                          │
│ [___________________________]    │
│                                  │
│ ☐ 필수 항목                      │
│                                  │
│ ── 옵션 (select 타입 시 표시) ── │
│ [옵션1] [x]                      │
│ [옵션2] [x]                      │
│ [+ 옵션 추가]                    │
│                                  │
├──────────────────────────────────┤
│              [취소]  [추가]      │
└──────────────────────────────────┘
```

### 5.3 EditFieldDialog

```
┌──────────────────────────────────┐
│ 속성 수정                         │
├──────────────────────────────────┤
│                                  │
│ Key (읽기전용)                    │
│ [companyName           ] (회색)  │
│                                  │
│ 타입 (읽기전용)                   │
│ [텍스트] (회색)                   │
│                                  │
│ 라벨 *                           │
│ [___________________________]    │
│                                  │
│ 카테고리                          │
│ [___________________________]    │
│                                  │
│ 기본 너비 (px)                    │
│ [120]                            │
│                                  │
│ ☐ 필수 항목                      │
│                                  │
│ ── 옵션 (select 타입 시 표시) ── │
│ [옵션1] [x]                      │
│ [옵션2] [x]                      │
│ [+ 옵션 추가]                    │
│                                  │
├──────────────────────────────────┤
│              [취소]  [저장]      │
└──────────────────────────────────┘
```

### 5.4 DeleteFieldDialog

```
┌──────────────────────────────────┐
│ 속성 삭제                         │
├──────────────────────────────────┤
│                                  │
│ "상호명" 속성을 삭제합니다.       │
│                                  │
│ 이 속성의 기존 레코드 데이터는    │
│ 테이블에서 더 이상 표시되지       │
│ 않습니다.                        │
│                                  │
├──────────────────────────────────┤
│              [취소]  [삭제]      │
└──────────────────────────────────┘
```

### 5.5 User Flow

```
설정 > 속성 관리 탭 → 워크스페이스 선택 → 필드 목록 표시
  ├── [+ 속성 추가] → CreateFieldDialog → 입력 → API POST → 목록 갱신
  ├── [✏️] 클릭 → EditFieldDialog → 수정 → API PATCH → 목록 갱신
  ├── [🗑️] 클릭 → DeleteFieldDialog → 확인 → API DELETE → 목록 갱신
  └── [↑↓] 클릭 → 즉시 순서 변경 → API PATCH reorder → 목록 갱신
```

### 5.6 Component List

| Component | Location | Responsibility |
|-----------|----------|----------------|
| FieldManagementTab | `src/components/settings/FieldManagementTab.tsx` | 워크스페이스 선택 + 필드 테이블 + 순서 변경 버튼 |
| CreateFieldDialog | `src/components/settings/CreateFieldDialog.tsx` | 필드 생성 폼 다이얼로그 |
| EditFieldDialog | `src/components/settings/EditFieldDialog.tsx` | 필드 수정 폼 다이얼로그 |
| DeleteFieldDialog | `src/components/settings/DeleteFieldDialog.tsx` | 필드 삭제 확인 (AlertDialog) |

---

## 6. Hook Design

### 6.1 useFields 수정

```typescript
// src/hooks/useFields.ts — mutate 반환 추가
export function useFields(workspaceId: number | null) {
    const { data, error, isLoading, mutate } = useSWR<ApiResponse<FieldDefinition[]>>(
        workspaceId ? `/api/workspaces/${workspaceId}/fields` : null,
        fetcher
    );

    return {
        fields: data?.data ?? [],
        isLoading,
        error,
        mutate,  // 추가
    };
}
```

### 6.2 useFieldManagement (신규)

```typescript
// src/hooks/useFieldManagement.ts
export function useFieldManagement(workspaceId: number | null, mutate: () => void) {
    const createField = async (input: CreateFieldInput) => {
        const res = await fetch(`/api/workspaces/${workspaceId}/fields`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const updateField = async (id: number, input: UpdateFieldInput) => {
        const res = await fetch(`/api/fields/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const deleteField = async (id: number) => {
        const res = await fetch(`/api/fields/${id}`, { method: "DELETE" });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const reorderFields = async (fieldIds: number[]) => {
        const res = await fetch(`/api/workspaces/${workspaceId}/fields/reorder`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fieldIds }),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return { createField, updateField, deleteField, reorderFields };
}
```

---

## 7. Error Handling

### 7.1 Error Responses

| Code | Message | Cause | Handling |
|------|---------|-------|----------|
| 400 | "이름을 입력해주세요." | key/label 미입력 | toast.error |
| 400 | "시스템 필드는 삭제할 수 없습니다." | isSystem=1 삭제 시도 | toast.error |
| 400 | "key는 영문 소문자와 숫자만 사용 가능합니다." | key 형식 오류 | toast.error |
| 401 | "인증이 필요합니다." | 미인증 | 로그인 리다이렉트 |
| 403 | "접근 권한이 없습니다." | member 역할 | toast.error |
| 409 | "이미 존재하는 key입니다." | key 중복 | toast.error |
| 500 | "서버 오류가 발생했습니다." | 서버 에러 | toast.error |

---

## 8. Security Considerations

- [x] 인증 체크 (getUserFromRequest)
- [x] 권한 체크 (role !== "member")
- [x] 워크스페이스 소유권 검증 (orgId 매칭)
- [x] 시스템 필드 삭제 보호 (isSystem)
- [x] key 입력 검증 (영문+숫자 camelCase, SQL injection 방지)
- [x] XSS 방지 (React 기본 이스케이프)

---

## 9. Implementation Guide

### 9.1 File Structure

```
src/
├── pages/
│   ├── settings.tsx                              # 수정: "속성 관리" 탭 추가
│   └── api/
│       ├── workspaces/[id]/
│       │   ├── fields.ts                         # 수정: POST 추가
│       │   └── fields/
│       │       └── reorder.ts                    # 신규
│       └── fields/
│           └── [id].ts                           # 신규: PATCH/DELETE
├── hooks/
│   ├── useFields.ts                              # 수정: mutate 반환
│   └── useFieldManagement.ts                     # 신규
├── components/settings/
│   ├── FieldManagementTab.tsx                    # 신규
│   ├── CreateFieldDialog.tsx                     # 신규
│   ├── EditFieldDialog.tsx                       # 신규
│   └── DeleteFieldDialog.tsx                     # 신규
└── types/
    └── index.ts                                  # 수정: CreateFieldInput, UpdateFieldInput, ReorderFieldsInput 추가
```

### 9.2 Implementation Order

1. [ ] **Types**: `CreateFieldInput`, `UpdateFieldInput`, `ReorderFieldsInput` 추가 (`src/types/index.ts`)
2. [ ] **API**: `src/pages/api/workspaces/[id]/fields.ts` — POST 핸들러 추가 (필드 생성 + 파티션 visibleFields 추가)
3. [ ] **API**: `src/pages/api/fields/[id].ts` — PATCH/DELETE 핸들러 (필드 수정/삭제)
4. [ ] **API**: `src/pages/api/workspaces/[id]/fields/reorder.ts` — 순서 변경
5. [ ] **Hook**: `src/hooks/useFields.ts` — mutate 반환 추가
6. [ ] **Hook**: `src/hooks/useFieldManagement.ts` — CRUD 함수
7. [ ] **UI**: `src/components/settings/FieldManagementTab.tsx` — 워크스페이스 선택 + 필드 테이블
8. [ ] **UI**: `src/components/settings/CreateFieldDialog.tsx` — 필드 생성 다이얼로그
9. [ ] **UI**: `src/components/settings/EditFieldDialog.tsx` — 필드 수정 다이얼로그
10. [ ] **UI**: `src/components/settings/DeleteFieldDialog.tsx` — 필드 삭제 AlertDialog
11. [ ] **Page**: `src/pages/settings.tsx` — "속성 관리" 탭 추가
12. [ ] **Build**: `pnpm build` 검증

### 9.3 Coding Conventions

| Item | Convention |
|------|-----------|
| Component naming | PascalCase (FieldManagementTab.tsx) |
| File organization | settings/ 폴더 내 배치 |
| State management | SWR + useFields mutate |
| Form pattern | `<form onSubmit>` + `type="submit"` / `type="button"` |
| Error handling | toast.error (sonner) |
| API 응답 | `{ success: boolean, data?, error? }` |
| 권한 체크 | getUserFromRequest + role !== "member" |

---

## 10. FieldType 선택 UI

필드 생성 시 사용자가 선택 가능한 타입 목록 (formula, user_select 제외):

| fieldType | 표시 라벨 | 비고 |
|-----------|----------|------|
| text | 텍스트 | 기본 |
| number | 숫자 | |
| currency | 금액 | |
| date | 날짜 | |
| datetime | 날짜+시간 | |
| select | 선택 | options 입력 필요 |
| phone | 전화번호 | |
| email | 이메일 | |
| textarea | 장문 텍스트 | |
| checkbox | 체크박스 | |

> formula, user_select는 Out of Scope (별도 PDCA)

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-02-12 | Initial draft | AI |
