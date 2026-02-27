# email-category Design Document

> **Summary**: 이메일 템플릿 카테고리 관리 — 로컬 CRUD + NHN 동기화
>
> **Plan**: `docs/01-plan/features/email-category.plan.md`
> **Date**: 2026-02-24

---

## 1. 변경 파일 목록

| # | 파일 | 작업 | 설명 |
|---|------|------|------|
| 1 | `src/lib/db/schema.ts` | Edit | `emailCategories` 테이블 + `emailTemplates`에 `categoryId` 추가 |
| 2 | `drizzle/0003_email_categories.sql` | New | 마이그레이션 SQL |
| 3 | `src/lib/nhn-email.ts` | Edit | `listCategories()` 메서드 추가 |
| 4 | `src/pages/api/email/categories/index.ts` | New | GET 목록 / POST 생성 |
| 5 | `src/pages/api/email/categories/[id].ts` | New | PUT 수정 / DELETE 삭제 |
| 6 | `src/pages/api/email/categories/sync.ts` | New | POST NHN 동기화 |
| 7 | `src/hooks/useEmailCategories.ts` | New | SWR 훅 |
| 8 | `src/components/email/EmailCategoryManager.tsx` | New | 카테고리 관리 UI |
| 9 | `src/components/email/EmailTemplateList.tsx` | Edit | 카테고리 필터 추가 |
| 10 | `src/components/email/EmailTemplateEditor.tsx` | Edit | 카테고리 선택 드롭다운 |
| 11 | `src/pages/email.tsx` | Edit | 설정 탭에 카테고리 관리 섹션 추가 |

---

## 2. DB 스키마

### 2.1 emailCategories 테이블 (신규)

```typescript
// src/lib/db/schema.ts
export const emailCategories = pgTable("email_categories", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    description: varchar("description", { length: 1000 }),
    nhnCategoryId: integer("nhn_category_id"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});
```

### 2.2 emailTemplates 변경

```typescript
// 기존 emailTemplates 테이블에 추가:
categoryId: integer("category_id").references(() => emailCategories.id, { onDelete: "set null" }),
```

- `templateType`과 `isActive` 사이에 배치
- nullable — 카테고리 미분류 템플릿 허용
- onDelete: "set null" — 카테고리 삭제 시 템플릿은 미분류로

### 2.3 마이그레이션 SQL

```sql
-- drizzle/0003_email_categories.sql
CREATE TABLE IF NOT EXISTS "email_categories" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "name" varchar(200) NOT NULL,
    "description" varchar(1000),
    "nhn_category_id" integer,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "category_id" integer REFERENCES "email_categories"("id") ON DELETE SET NULL;
```

---

## 3. NHN Email Client 확장

### 3.1 `src/lib/nhn-email.ts` — `listCategories()` 추가

```typescript
// NhnEmailClient 클래스 내부에 추가
async listCategories(): Promise<{
    header: NhnEmailApiHeader;
    data: Array<{
        categoryId: number;
        categoryParentId: number;
        depth: number;
        categoryName: string;
        categoryDesc: string;
        useYn: string;
    }> | null;
}> {
    return this.request("GET", "/email/v2.1/appKeys/{appKey}/categories?pageSize=100");
}
```

- NHN 응답: `{ header, body: { data: [...] } }` — 기존 `request()` 메서드가 `body.data` 추출
- `pageSize=100`으로 전체 조회 (카테고리는 보통 소규모)

---

## 4. API 설계

### 4.1 `GET /api/email/categories` — 카테고리 목록

- Auth: `getUserFromRequest()`
- Query: orgId로 필터
- Response: `{ success, data: EmailCategory[] }`

### 4.2 `POST /api/email/categories` — 카테고리 생성

- Body: `{ name: string, description?: string }`
- 중복 이름 체크 (같은 org 내)
- Response: `{ success, data: EmailCategory }`

### 4.3 `PUT /api/email/categories/[id]` — 카테고리 수정

- Body: `{ name?: string, description?: string }`
- Response: `{ success, data: EmailCategory }`

### 4.4 `DELETE /api/email/categories/[id]` — 카테고리 삭제

- FK cascade: `SET NULL` → 해당 카테고리의 템플릿은 미분류로
- Response: `{ success }`

### 4.5 `POST /api/email/categories/sync` — NHN 동기화

- NHN에서 카테고리 목록 조회 (`listCategories()`)
- 각 NHN 카테고리에 대해:
  - `nhnCategoryId`로 기존 레코드 검색
  - 없으면 INSERT, 있으면 name/description UPDATE
- Response: `{ success, synced: number, created: number, updated: number }`

---

## 5. Hook 설계

### 5.1 `src/hooks/useEmailCategories.ts`

```typescript
export function useEmailCategories() {
    const { data, isLoading, mutate } = useSWR<CategoriesResponse>("/api/email/categories", fetcher);

    const createCategory = async (data: { name: string; description?: string }) => { ... };
    const updateCategory = async (id: number, data: { name?: string; description?: string }) => { ... };
    const deleteCategory = async (id: number) => { ... };
    const syncFromNhn = async () => { ... };  // POST /api/email/categories/sync

    return { categories, isLoading, createCategory, updateCategory, deleteCategory, syncFromNhn, mutate };
}
```

---

## 6. UI 설계

### 6.1 `EmailCategoryManager.tsx` — 카테고리 관리 섹션

설정 탭의 EmailConfigForm 아래에 배치.

```
┌─────────────────────────────────────────────┐
│ 이메일 카테고리                    [NHN 동기화]  [+ 추가] │
├─────────────────────────────────────────────┤
│ 이름          │ 설명             │ NHN ID │ 작업 │
│ 마케팅        │ 마케팅 관련       │ 12345  │ ✏️ 🗑 │
│ 거래          │ 거래 관련 이메일  │ -      │ ✏️ 🗑 │
│ 알림          │ 시스템 알림       │ 12346  │ ✏️ 🗑 │
└─────────────────────────────────────────────┘
```

- Card 컴포넌트 사용 (EmailConfigForm과 동일 스타일)
- Table로 카테고리 목록
- "NHN 동기화" 버튼: `syncFromNhn()` 호출 → 결과 toast
- "추가" 버튼: 인라인 폼 또는 간단 Dialog
- 편집: 인라인 편집 (이름 클릭 → Input)
- 삭제: confirm 후 삭제

### 6.2 `EmailTemplateList.tsx` — 카테고리 필터

헤더 영역에 카테고리 Select 필터 추가:

```
┌─────────────────────────────────────────────┐
│ 이메일 템플릿    [카테고리: 전체 ▼]   [+ 새 템플릿] │
├─────────────────────────────────────────────┤
│ 이름 │ 제목 │ 카테고리 │ 상태 │ 작업 │
│ ...  │ ...  │ 마케팅   │ 활성 │ ✏️ 🗑 │
└─────────────────────────────────────────────┘
```

- `useEmailCategories()` 훅 사용
- 기존 "유형" 컬럼을 "카테고리" 컬럼으로 변경
- category?.name 표시 (없으면 비움)
- 필터: `useState<number | null>(null)` → 클라이언트 사이드 필터

### 6.3 `EmailTemplateEditor.tsx` — 카테고리 선택

메타 정보 영역의 "유형 (선택)" Input을 카테고리 Select로 교체:

```
┌────────────────────────────────────────┐
│ [이름 Input]        [카테고리 Select ▼] │
│ [제목 Input]                            │
└────────────────────────────────────────┘
```

- `useEmailCategories()` 훅 사용
- Select 드롭다운으로 카테고리 선택 (nullable — "미분류" 옵션)
- `SaveData`에 `categoryId?: number | null` 추가 (기존 `templateType` 유지)

---

## 7. emailTemplates API 변경

### 7.1 `POST /api/email/templates` — categoryId 수락

```typescript
const { name, subject, htmlBody, templateType, status, categoryId } = req.body;
// insert에 categoryId 추가
```

### 7.2 `PUT /api/email/templates/[id]` — categoryId 수락

```typescript
if (categoryId !== undefined) updateData.categoryId = categoryId;
```

### 7.3 `GET /api/email/templates` — categoryId 필터 (optional)

```typescript
// ?categoryId=5 쿼리 파라미터 지원
```

---

## 8. 구현 순서

| # | 파일 | 검증 |
|---|------|------|
| 1 | `src/lib/db/schema.ts` + `drizzle/0003_email_categories.sql` | drizzle-kit push |
| 2 | `src/lib/nhn-email.ts` | 타입 에러 없음 |
| 3 | `src/pages/api/email/categories/index.ts` | 타입 에러 없음 |
| 4 | `src/pages/api/email/categories/[id].ts` | 타입 에러 없음 |
| 5 | `src/pages/api/email/categories/sync.ts` | 타입 에러 없음 |
| 6 | `src/pages/api/email/templates/index.ts` + `[id].ts` | categoryId 수락 |
| 7 | `src/hooks/useEmailCategories.ts` | 타입 에러 없음 |
| 8 | `src/hooks/useEmailTemplates.ts` | categoryId 타입 추가 |
| 9 | `src/components/email/EmailCategoryManager.tsx` | 빌드 확인 |
| 10 | `src/components/email/EmailTemplateList.tsx` | 카테고리 필터 |
| 11 | `src/components/email/EmailTemplateEditor.tsx` | 카테고리 Select |
| 12 | `src/pages/email.tsx` | 설정 탭 배치 |
| 13 | `pnpm build` | 전체 빌드 성공 |

---

## 9. 검증

- `pnpm build` 성공
- `drizzle-kit push`로 DB 마이그레이션 적용
- 카테고리 CRUD 동작 (생성/수정/삭제)
- NHN 동기화 동작
- 템플릿에 카테고리 할당
- 템플릿 목록에서 카테고리 필터
