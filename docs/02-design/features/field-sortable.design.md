# Design: 속성별 정렬 가능 스위치

> Plan 참조: `docs/01-plan/features/field-sortable.plan.md`

## 1. DB 스키마 변경

### 1-1. schema.ts 수정

`fieldDefinitions` 테이블에 `isSortable` 컬럼 추가:

```typescript
// src/lib/db/schema.ts - fieldDefinitions 테이블 내부, isSystem 아래에 추가
isSortable: integer("is_sortable").default(0).notNull(),
```

### 1-2. 마이그레이션 (0028)

```sql
-- drizzle/0028_field_sortable.sql
DO $$ BEGIN
    ALTER TABLE "field_definitions" ADD COLUMN "is_sortable" integer DEFAULT 0 NOT NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
```

## 2. 타입 변경

### 2-1. FieldDefinition

```typescript
// src/types/index.ts
export interface FieldDefinition {
  // ... 기존 필드 ...
  isSortable: boolean;  // isSystem 아래에 추가
}
```

### 2-2. UpdateFieldInput

```typescript
export interface UpdateFieldInput {
  label?: string;
  category?: string;
  isRequired?: boolean;
  isSortable?: boolean;  // 추가
  options?: string[];
  defaultWidth?: number;
}
```

## 3. API 변경

### 3-1. GET /api/workspaces/[id]/fields

변경 없음. `db.select()` 전체 조회이므로 `is_sortable` 컬럼이 자동으로 응답에 포함됨.
단, 클라이언트에서 `isSortable`로 접근 시 drizzle이 camelCase로 자동 매핑.

### 3-2. PATCH /api/fields/[id]

```typescript
// src/app/api/fields/[id]/route.ts - PATCH 핸들러
// 기존 destructuring에 isSortable 추가
const { label, category, isRequired, isSortable, options, defaultWidth } = await req.json();

// updates 빌드 로직에 추가 (defaultWidth 처리 뒤)
if (isSortable !== undefined) {
    updates.isSortable = isSortable ? 1 : 0;
}
```

## 4. UI 변경

### 4-1. EditFieldDialog - 정렬 가능 Switch 추가

**위치**: "필수 항목" 체크박스와 Select 옵션 사이

```
[필수 항목 체크박스]
[정렬 가능 스위치]    ← 추가
[Select 옵션 (fieldType === "select" 일 때만)]
```

**구현 상세**:
- `Switch` 컴포넌트 사용 (`@/components/ui/switch`)
- state: `const [isSortable, setIsSortable] = useState(false)`
- 초기값: `useEffect` 내 `setIsSortable(!!field.isSortable)`
- 저장: `onSubmit` 호출 시 `isSortable` 포함

### 4-2. RecordTable - 조건부 정렬 UI

**현재**: `displayFields.map()` 내 `<TableHead>`에 라벨만 표시
**변경**: `field.isSortable`이 true이면 정렬 아이콘 + 클릭 핸들러 추가

```tsx
{displayFields.map((field) => (
    <TableHead
        key={field.key}
        style={{ minWidth: field.minWidth, width: field.defaultWidth }}
        className={field.isSortable ? "cursor-pointer select-none" : undefined}
        onClick={field.isSortable ? () => handleSort(field.key) : undefined}
    >
        <span className="flex items-center gap-1">
            {field.label}
            {field.isSortable && renderSortIcon(field.key)}
        </span>
    </TableHead>
))}
```

### 4-3. FieldManagementTab - 정렬 컬럼 표시

**변경**: 테이블 헤더에 "정렬" 컬럼 추가 (필수 컬럼 뒤)

```
| 순서 | 라벨 | key | 타입 | 필수 | 정렬 | 카테고리 | 작업 |
```

셀 내용: `field.isSortable`이 true이면 `ArrowUpDown` 아이콘 표시

## 5. 구현 순서

| 순서 | 작업 | 파일 |
|------|------|------|
| 1 | DB 스키마에 isSortable 추가 | `src/lib/db/schema.ts` |
| 2 | 마이그레이션 생성 | `drizzle/0028_field_sortable.sql` |
| 3 | 마이그레이션 적용 | `npx drizzle-kit push` |
| 4 | 타입 업데이트 | `src/types/index.ts` |
| 5 | PATCH API에 isSortable 지원 | `src/app/api/fields/[id]/route.ts` |
| 6 | EditFieldDialog에 Switch 추가 | `src/components/settings/EditFieldDialog.tsx` |
| 7 | RecordTable 조건부 정렬 | `src/components/records/RecordTable.tsx` |
| 8 | FieldManagementTab 정렬 컬럼 | `src/components/settings/FieldManagementTab.tsx` |

## 6. 엣지 케이스

- 기존 필드 전부 `is_sortable = 0` → 기존과 동일하게 동작 (정렬 불가)
- 통합코드 컬럼은 속성 기반이 아니므로 항상 정렬 가능 (변경 없음)
- 시스템 필드(`isSystem`)도 EditFieldDialog에서 수정 불가이므로 영향 없음
- `textarea`, `file` 타입 필드에 정렬을 켜도 서버 정렬은 문자열 기준으로 동작
