# Design: 속성 타입 시스템 (Field Type System)

> Plan 참조: `docs/01-plan/features/field-type-system.plan.md`

## 1. DB 스키마 변경

### 1-1. field_types 테이블 (신규)

```typescript
// src/lib/db/schema.ts
export const fieldTypes = pgTable("field_types", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description"),
    icon: varchar("icon", { length: 50 }),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
}, (table) => ({
    orgNameUnique: unique().on(table.orgId, table.name),
}));
```

### 1-2. field_definitions 변경

```typescript
// 추가 컬럼
fieldTypeId: integer("field_type_id")
    .references(() => fieldTypes.id, { onDelete: "cascade" }),

// 기존 workspaceId는 nullable로 변경 (마이그레이션 호환)
// unique 제약: (fieldTypeId, key) 추가
```

### 1-3. workspaces 변경

```typescript
// 추가 컬럼
defaultFieldTypeId: integer("default_field_type_id")
    .references(() => fieldTypes.id),
```

### 1-4. partitions 변경

```typescript
// 추가 컬럼
fieldTypeId: integer("field_type_id")
    .references(() => fieldTypes.id),
```

### 1-5. 마이그레이션 SQL (0030)

```sql
-- Step 1: field_types 테이블 생성
CREATE TABLE IF NOT EXISTS "field_types" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "name" varchar(100) NOT NULL,
    "description" text,
    "icon" varchar(50),
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL,
    UNIQUE("org_id", "name")
);

-- Step 2: field_definitions에 field_type_id 추가
ALTER TABLE "field_definitions" ADD COLUMN "field_type_id" integer REFERENCES "field_types"("id") ON DELETE CASCADE;
ALTER TABLE "field_definitions" ALTER COLUMN "workspace_id" DROP NOT NULL;

-- Step 3: workspaces에 default_field_type_id 추가
ALTER TABLE "workspaces" ADD COLUMN "default_field_type_id" integer REFERENCES "field_types"("id");

-- Step 4: partitions에 field_type_id 추가
ALTER TABLE "partitions" ADD COLUMN "field_type_id" integer REFERENCES "field_types"("id");
```

## 2. 데이터 마이그레이션 스크립트

### 2-1. 타입 자동 생성 로직

워크스페이스별 속성 구조를 비교하여 동일 구조는 하나의 타입으로 통합:

```
비교 기준: field의 key 집합이 동일하면 같은 구조
```

**현재 데이터 분석 결과:**

| 그룹 | 워크스페이스 | key 집합 | 생성할 타입명 |
|------|-------------|----------|-------------|
| A | WEDLY, 마케팅email, 영업관리 | companyName, contactName, contactTitle, phone, email, address, salesStage, expectedAmount, memo | "영업 기본" |
| B | 테스트 DB | market, companyName, phone, representativeName, businessNumber, email, classification, address, url, registrationDate | "스토어 DB" |
| C | 디하 회원관리 | signUpAt, companyName, username, phone, email, matchStep, plan, matchStartDate, startTime, endTime, hasTempProposal, memo, categoryId, funnel, uuid | "디하 CRM" |

### 2-2. 마이그레이션 순서

```
1. 각 그룹별 field_types INSERT
2. 그룹 A: 대표 워크스페이스(마케팅email)의 field_definitions를 fieldTypeId로 연결
   - WEDLY, 영업관리의 중복 field_definitions는 fieldTypeId만 설정 (삭제는 Phase 4)
3. 그룹 B, C: 해당 워크스페이스의 field_definitions에 fieldTypeId 설정
4. workspaces.default_field_type_id 업데이트
5. partitions.field_type_id는 null (워크스페이스 기본 타입 사용)
```

## 3. 타입 인터페이스 (TypeScript)

### 3-1. 타입 정의

```typescript
// src/types/index.ts

export interface FieldType {
    id: number;
    orgId: string;
    name: string;
    description: string | null;
    icon: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface CreateFieldTypeInput {
    name: string;
    description?: string;
    icon?: string;
}

export interface UpdateFieldTypeInput {
    name?: string;
    description?: string;
    icon?: string;
}
```

### 3-2. 기존 타입 변경

```typescript
// FieldDefinition에 추가
export interface FieldDefinition {
    // ... 기존 필드 ...
    fieldTypeId: number | null;  // 추가
}
```

## 4. API 설계

### 4-1. 타입 CRUD API

**GET /api/field-types**
- 조직의 모든 타입 목록 조회
- 응답: `{ success: true, data: FieldType[] }`

**POST /api/field-types**
- 새 타입 생성
- body: `{ name, description?, icon? }`
- 응답: `{ success: true, data: { id } }`

**PATCH /api/field-types/[id]**
- 타입 수정
- body: `{ name?, description?, icon? }`

**DELETE /api/field-types/[id]**
- 타입 삭제
- 사용 중인 워크스페이스/파티션이 있으면 400 에러
- 응답에 사용처 목록 포함

### 4-2. 타입의 필드 관리 API

**GET /api/field-types/[id]/fields**
- 해당 타입의 필드 목록 조회
- `sortOrder` 기준 정렬
- 응답: `{ success: true, data: FieldDefinition[] }`

**POST /api/field-types/[id]/fields**
- 타입에 필드 추가
- 기존 `POST /api/workspaces/[id]/fields`와 동일한 로직

**PATCH /api/field-types/[id]/fields/reorder**
- 필드 순서 변경

### 4-3. 파티션의 resolved 필드 조회

**GET /api/partitions/[id]/resolved-fields**
- 파티션에 적용되는 실제 필드 목록
- 로직:
  1. `partition.fieldTypeId` 확인
  2. null이면 `workspace.defaultFieldTypeId` 사용
  3. 해당 타입의 fields 반환

### 4-4. 기존 API 호환

**GET /api/workspaces/[id]/fields** (기존 유지)
- 내부적으로 `workspace.defaultFieldTypeId`의 필드를 반환
- 점진적 전환을 위해 유지

## 5. 필드 조회 훅 변경

### 5-1. useFieldType (신규)

```typescript
// src/hooks/useFieldTypes.ts
export function useFieldTypes() {
    // GET /api/field-types
    // 조직의 모든 타입 목록
}
```

### 5-2. useFields 변경

```typescript
// src/hooks/useFields.ts
// 기존: useFields(workspaceId)
// 변경: useFields(workspaceId) 내부에서 workspace의 defaultFieldTypeId 사용

// 신규: useFieldsByType(fieldTypeId)
export function useFieldsByType(fieldTypeId: number | null) {
    // GET /api/field-types/{fieldTypeId}/fields
}

// 신규: useResolvedFields(partitionId)
export function useResolvedFields(partitionId: number | null) {
    // GET /api/partitions/{partitionId}/resolved-fields
}
```

### 5-3. 레코드 페이지에서 사용

```typescript
// 현재: const { fields } = useFields(workspaceId);
// 변경: const { fields } = useResolvedFields(partitionId);
```

파티션이 바뀔 때 해당 파티션의 타입에 맞는 필드가 자동으로 로드됨.

## 6. UI 설계

### 6-1. 설정 페이지 탭 변경

```
현재: 워크스페이스 관리 | 속성 관리 | 자동화
변경: 워크스페이스 관리 | 속성 타입 관리 | 자동화
```

### 6-2. 속성 타입 관리 탭 (FieldTypeManagementTab)

```
┌─────────────────────────────────────────────┐
│ 속성 타입 목록                    [+ 타입 추가] │
├─────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│ │ 영업 기본  │ │ 스토어 DB │ │ 디하 CRM  │     │
│ │ 3곳 사용중 │ │ 1곳 사용중 │ │ 1곳 사용중 │     │
│ └──────────┘ └──────────┘ └──────────┘     │
├─────────────────────────────────────────────┤
│ "영업 기본" 타입의 속성 목록                    │
│ ┌───┬────────┬──────────┬──────┬────┐      │
│ │ ⠿ │ 회사명   │ companyName│ 텍스트│ 편집│      │
│ │ ⠿ │ 담당자명  │ contactName│ 텍스트│ 편집│      │
│ │ ⠿ │ ...    │          │      │    │      │
│ └───┴────────┴──────────┴──────┴────┘      │
│                                             │
│ ⚠️ 이 타입은 3개 워크스페이스에서 사용 중입니다.│
│    변경 시 모든 곳에 영향을 줍니다.            │
└─────────────────────────────────────────────┘
```

### 6-3. 워크스페이스 관리 탭 변경

기존 워크스페이스 수정 폼에 추가:

```
워크스페이스 이름: [____________]
설명: [____________]
기본 속성 타입: [영업 기본 ▼]    ← 신규
```

### 6-4. 파티션 생성/수정 다이얼로그 변경

```
파티션 이름: [____________]
속성 타입:
  ○ 워크스페이스 기본 타입 사용 (영업 기본)    ← 기본 선택
  ○ 다른 타입 선택: [디하 CRM ▼]
```

### 6-5. 타입 생성 다이얼로그

```
┌─────────────────────────┐
│ 속성 타입 생성            │
│                          │
│ 타입 이름 *              │
│ [________________]       │
│                          │
│ 설명                     │
│ [________________]       │
│                          │
│ 초기 속성                │
│ ○ 빈 타입 (속성 없이 시작) │
│ ○ 기존 타입 복제: [▼]     │
│ ○ 템플릿에서 시작: [▼]    │
│                          │
│        [취소] [생성]      │
└─────────────────────────┘
```

## 7. 구현 순서

| 순서 | 작업 | 파일 | Phase |
|------|------|------|-------|
| 1 | field_types 테이블 스키마 추가 | `schema.ts` | 1 |
| 2 | field_definitions, workspaces, partitions 컬럼 추가 | `schema.ts` | 1 |
| 3 | 마이그레이션 SQL 생성 | `drizzle/0030_field_type_system.sql` | 1 |
| 4 | 마이그레이션 적용 | DB | 1 |
| 5 | 데이터 마이그레이션 스크립트 작성/실행 | `scripts/migrate-field-types.ts` | 2 |
| 6 | TypeScript 타입 추가 | `types/index.ts` | 3 |
| 7 | 타입 CRUD API | `api/field-types/` | 3 |
| 8 | 타입 필드 API | `api/field-types/[id]/fields/` | 3 |
| 9 | resolved-fields API | `api/partitions/[id]/resolved-fields/` | 3 |
| 10 | useFieldTypes, useFieldsByType, useResolvedFields 훅 | `hooks/` | 3 |
| 11 | FieldTypeManagementTab UI | `components/settings/` | 3 |
| 12 | 워크스페이스 설정 UI 변경 | `components/settings/` | 3 |
| 13 | 파티션 다이얼로그 변경 | `components/records/` | 3 |
| 14 | 레코드 페이지 useFields → useResolvedFields | `app/records/page.tsx` | 3 |
| 15 | 기존 API 호환 래퍼 | `api/workspaces/[id]/fields/` | 3 |
| 16 | field_definitions 중복 정리 | DB | 4 |
| 17 | workspaceId 컬럼 deprecated 처리 | `schema.ts` | 4 |

## 8. 엣지 케이스

- **타입 삭제 시**: 사용 중인 워크스페이스/파티션이 있으면 삭제 불가. API에서 사용처 목록 반환
- **타입 속성 수정 시**: 해당 타입을 쓰는 모든 곳에 영향. UI에 "N곳에서 사용 중" 경고
- **파티션 타입 변경 시**: 기존 레코드의 data JSONB는 변경 없음. 새 타입에 없는 key는 테이블에서 안 보일 뿐, 데이터는 유지
- **워크스페이스 기본 타입 변경 시**: fieldTypeId가 null인 파티션들 모두 영향
- **동일 key의 속성이 다른 타입에 존재**: 문제 없음. 레코드 data는 key 기반이므로 타입 전환해도 key가 같으면 데이터 유지
