# Design: 속성 생성 시 시스템 필드 매핑 (System Field Mapping)

> **Plan**: `docs/01-plan/features/system-field-mapping.plan.md`
> **Project**: Sendb (Salesflow)
> **Author**: jaehun
> **Date**: 2026-05-20
> **Status**: Draft

---

## 1. 개요

속성(필드) 생성 시 **커스텀 / 시스템** 을 선택. 시스템이면 등록일/생성일/수정일 중 택 1 → 그 필드는 `data`가 아니라 `records`의 시스템 컬럼 값을 읽어 표시(읽기 전용).

기존 "등록일" 커스텀 필드는 시스템 매핑으로 전환(D1). 모든 작업은 로컬 검증 후 운영 반영(D5).

### 1.1 핵심 흐름

```
[속성 추가]
 종류: ◉ 커스텀  ○ 시스템
   ├ 커스텀 → 기존대로 (key/label/타입)
   └ 시스템 → 드롭다운[등록일/생성일/수정일] + 라벨
              key/타입 자동 결정, 읽기전용
        ↓
 field_definitions INSERT (systemColumn 채움, isSystem=1, cellType='readonly', fieldType='datetime')
        ↓
 RecordTable: field.systemColumn 있으면 record[systemColumn] 표시 (data 안 봄)
```

---

## 2. 데이터 모델

### 2.1 마이그레이션 — `drizzle/0047_field_system_column.sql`

```sql
ALTER TABLE "field_definitions" ADD COLUMN "system_column" varchar(50);
```

> `system_column` NULL = 커스텀(기존 동작), 값 있음 = 시스템 매핑.
> 화이트리스트: `registeredAt` | `createdAt` | `updatedAt`.

**journal**: `{ "idx": 47, "version":"7", "when": 1770951000000, "tag":"0047_field_system_column", "breakpoints": true }`

> ⚠️ 마이그레이션 번호는 record-events(0046) 다음. main 머지 충돌 시 재조정.

### 2.2 schema.ts — `fieldDefinitions`에 추가

```ts
// formulaConfig 아래
systemColumn: varchar("system_column", { length: 50 }),
```

### 2.3 데이터 마이그레이션 (D1) — 기존 등록일 커스텀 전환

```sql
-- 기존 등록일 커스텀 필드를 시스템 매핑으로 전환 (삭제 X)
UPDATE field_definitions
SET system_column = 'registeredAt',
    is_system = 1,
    cell_type = 'readonly',
    field_type = 'datetime'
WHERE key = 'registeredAt' AND field_type = 'datetime' AND system_column IS NULL;
```

> 운영엔 field_type 7의 registeredAt 1건. 다른 타입에도 있으면 함께 전환됨(의도).
> 로컬 복원본에서 먼저 실행·검증 후 운영 적용.

---

## 3. 타입

### 3.1 `FieldDefinition` (src/types/index.ts)
```ts
export interface FieldDefinition {
    ...
    formulaConfig: FormulaConfig | null;
    systemColumn: string | null;   // 신규: 'registeredAt'|'createdAt'|'updatedAt'|null
}
```

### 3.2 `CreateFieldInput`
```ts
export interface CreateFieldInput {
    ...
    cellClassName?: string;
    systemColumn?: string;   // 신규
}
```

### 3.3 시스템 컬럼 화이트리스트 상수 (신규) — `src/components/records/system-columns.ts`에 통합
```ts
export const SYSTEM_FIELD_COLUMNS = [
    { value: "registeredAt", label: "등록일" },
    { value: "createdAt",    label: "생성일" },
    { value: "updatedAt",    label: "수정일" },
] as const;

export type SystemFieldColumn = typeof SYSTEM_FIELD_COLUMNS[number]["value"];

export function isValidSystemColumn(v: unknown): v is SystemFieldColumn {
    return typeof v === "string" && SYSTEM_FIELD_COLUMNS.some((c) => c.value === v);
}
```

> record 객체에 `registeredAt`/`createdAt`/`updatedAt`이 camelCase로 내려오므로 value를 그대로 record 키로 사용 가능.

---

## 4. UI

### 4.1 CreateFieldDialog

상단에 "필드 종류" 라디오/세그먼트 추가:

```tsx
const [fieldKind, setFieldKind] = useState<"custom" | "system">("custom");
const [systemColumn, setSystemColumn] = useState<SystemFieldColumn>("registeredAt");

// 종류 선택
<div className="space-y-1.5">
  <Label>필드 종류 *</Label>
  <Select value={fieldKind} onValueChange={(v) => setFieldKind(v as "custom"|"system")}>
    <SelectContent>
      <SelectItem value="custom">커스텀 필드</SelectItem>
      <SelectItem value="system">시스템 필드</SelectItem>
    </SelectContent>
  </Select>
</div>

{fieldKind === "system" ? (
  <>
    {/* 시스템 컬럼 드롭다운 */}
    <Label>시스템 항목 *</Label>
    <Select value={systemColumn} onValueChange={(v)=>setSystemColumn(v as SystemFieldColumn)}>
      <SelectContent>
        {SYSTEM_FIELD_COLUMNS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
      </SelectContent>
    </Select>
    {/* 라벨만 입력. key/타입 입력란 숨김 */}
    <Label>라벨 *</Label>
    <Input value={label} onChange={...} />
  </>
) : (
  /* 기존 커스텀 입력 (key/label/타입/카테고리/...) */
)}
```

#### 시스템 선택 시 submit 페이로드
```ts
onSubmit({
    key: systemColumn,            // key = systemColumn (워크스페이스 내 유일성 확보용)
    label: label.trim(),
    fieldType: "datetime",
    systemColumn,
    isSortable: true,
    // category/options/defaultValue 등은 미사용
});
```

> key를 `systemColumn` 값으로 둠 → 기존 등록일 커스텀(key='registeredAt')과 자연스럽게 일치(전환 시 충돌 방지). `(field_type_id, key)` unique라 같은 타입에 등록일 중복 추가 차단됨.

#### 검증
- 시스템 종류: `systemColumn`이 화이트리스트인지, `label` 필수
- key 정규식 검증은 시스템일 때 스킵(시스템 컬럼 값 사용)

### 4.2 EditFieldDialog
- 시스템 매핑 필드(`field.systemColumn != null`)면: key/타입/시스템항목은 **읽기 전용 표시**, 라벨·정렬·너비만 수정 가능
- 커스텀이면 기존 그대로

### 4.3 RecordTable — 렌더 분기 (핵심)

L242, L265의 `data[field.key]`를 분기:
```ts
const cellValue = field.systemColumn
    ? (record as Record<string, unknown>)[field.systemColumn]   // 시스템 값
    : data[field.key];

<InlineEditCell
    field={field}
    value={cellValue}
    readOnly={!!field.systemColumn}          // 시스템 매핑 = 읽기 전용
    onSave={field.systemColumn ? undefined : (val)=>handleCellSave(record.id, field.key, val)}
/>
```

- `InlineEditCell`에 `readOnly` prop 없으면 추가 (datetime 포맷 표시만, 편집 차단)
- 시스템 매핑 필드는 `handleCellSave` 호출 안 함

### 4.4 system-columns.ts 정리 (D2) — 자동 표시 완전 제거

**결정: 시스템 컬럼은 타입에 명시적으로 추가해야만 보인다. 자동 표시 제거.**

기존 동작(커밋 458e28e): "타입에 커스텀 등록일이 없으면 시스템 등록일 컬럼을 **자동 표시**". 이게 두 메커니즘 공존을 만들어 혼란의 원인 → **제거**.

- 토글식 `__registeredAt__` 시스템 컬럼 + override(`isSystemColumnOverridden`/`getVisibleSystemColumns`/`isSystemColumnVisible`) **전부 제거**
- 의존처 정리:
  - `RecordTable.tsx` L70-74(showRegisteredAt), L158-168(헤더), L215-226(셀) → 제거 (등록일은 일반 필드로 렌더)
  - `RecordToolbar.tsx` L269(getVisibleSystemColumns) → 제거
  - `records/page.tsx` L398(getVisibleSystemColumns) → 제거
- → 등록일/생성일/수정일은 **오직 field_definitions의 시스템 매핑 필드로만** 표시. 추가 안 하면 안 보임.

**⚠️ 회귀 영향 (의도된 동작)**
- 현재 커스텀 등록일이 없어 **자동 표시되던 7개 타입**(WEDLY/마케팅email/영업관리/디하 회원관리/디하파트너즈/채용공고/유튜버)은 등록일이 **사라진다.**
- 필요한 타입엔 사용자가 "시스템 필드 → 등록일"을 직접 추가해야 함 (또는 §2.3 마이그레이션으로 일괄 추가).
- 이건 "명시적이어야 덜 헷갈린다"는 결정에 따른 의도된 동작.

### 4.4.1 (선택) 자동표시 타입 일괄 보정 마이그레이션
자동 표시에 의존하던 타입에 등록일을 유지하고 싶으면, 시스템 매핑 등록일 필드를 일괄 INSERT:
```sql
-- 등록일 시스템 필드가 없는 타입에 추가 (원하는 타입만 선별 실행 권장)
INSERT INTO field_definitions (field_type_id, key, label, field_type, system_column, is_system, cell_type, is_sortable, sort_order)
SELECT ft.id, 'registeredAt', '등록일', 'datetime', 'registeredAt', 1, 'readonly', 1, 999
FROM field_types ft
WHERE NOT EXISTS (
    SELECT 1 FROM field_definitions fd WHERE fd.field_type_id = ft.id AND fd.key = 'registeredAt'
);
```
> 로컬에서 먼저 실행해 보고, 어떤 타입에 넣을지 선별 후 운영 적용. (전부 넣을지 일부만 넣을지는 사용자 판단)

### 4.5 RecordDetailDialog
- L60-62의 `record.registeredAt` 직접 표시는 유지해도 무방(상세 메타). 단 필드 목록 렌더 시 시스템 매핑 필드도 동일 분기 적용.

---

## 5. API

### 5.1 필드 생성 — `field-types/[id]/fields/route.ts` POST

```ts
const { key, label, fieldType, ..., systemColumn } = await req.json();

if (systemColumn) {
    if (!isValidSystemColumn(systemColumn)) {
        return NextResponse.json({ success:false, error:"유효하지 않은 시스템 항목입니다." }, { status:400 });
    }
    // key는 systemColumn으로 강제, 타입 datetime, readonly, isSystem
    await db.insert(fieldDefinitions).values({
        fieldTypeId: typeId,
        key: systemColumn,
        label: label.trim(),
        fieldType: "datetime",
        systemColumn,
        isSystem: 1,
        cellType: "readonly",
        isSortable: 1,
        ...
    });
} else {
    // 기존 커스텀 경로 그대로 (key 정규식 검증 등)
}
```

### 5.2 필드 수정 — `fields/[id]/route.ts`
- 시스템 매핑 필드는 label/정렬/너비만 반영, systemColumn/key/fieldType 변경 차단

### 5.3 records 목록 — `partitions/[id]/records/route.ts`
- select에 이미 `registeredAt` 포함(L202). `createdAt`/`updatedAt`도 포함되는지 확인 후 없으면 추가
- 정렬: sortField가 시스템 컬럼(`registeredAt`/`createdAt`/`updatedAt`)이면 `records.{컬럼}` 기준 (L145 패턴 확장)
- export route도 동일 분기

### 5.4 셀 저장 가드 — `records/[id]` PATCH
- 시스템 매핑 필드 key로 들어온 값은 무시(읽기 전용 강제). UI에서 막지만 API에서도 방어.

---

## 6. webhook 정리 (D3)

`src/app/api/webhooks/meta/route.ts` L228-230 제거:
```ts
// 제거 — data.registeredAt 자동저장 (시스템 컬럼으로 일원화)
- if (!recordData.registeredAt) {
-     recordData.registeredAt = new Date().toISOString();
- }
```
> `registeredAt: new Date()` (시스템 컬럼 INSERT, L279)는 유지 — 어차피 defaultNow지만 명시는 무방.

---

## 7. 작업 분해 (체크리스트)

### 환경
- [ ] 운영 DB 덤프 → 로컬 복원

### DB/타입
- [ ] `0047_field_system_column.sql` + journal
- [ ] schema.ts `systemColumn` 추가
- [ ] FieldDefinition / CreateFieldInput 타입 추가
- [ ] system-columns.ts에 SYSTEM_FIELD_COLUMNS + isValidSystemColumn

### UI
- [ ] CreateFieldDialog — 커스텀/시스템 선택 + 시스템 드롭다운
- [ ] EditFieldDialog — 시스템 필드 읽기전용 처리
- [ ] RecordTable — systemColumn 렌더 분기 + readOnly
- [ ] InlineEditCell — readOnly prop
- [ ] system-columns.ts 토글식 잔재 제거 (RecordTable/Toolbar/page)

### API
- [ ] 필드 생성 API — systemColumn 분기 + 검증
- [ ] 필드 수정 API — 시스템 필드 가드
- [ ] records 목록/정렬/export — createdAt/updatedAt 포함 + 정렬 분기
- [ ] records PATCH — 시스템 필드 저장 차단

### 마이그레이션
- [ ] 기존 등록일 커스텀 → 시스템 매핑 전환 SQL (로컬 검증 후 운영)

### 정리
- [ ] webhook data.registeredAt 자동저장 제거

### 검증 (로컬)
- [ ] 시스템 등록일 필드 생성 → 전 record 값 표시
- [ ] 읽기 전용 확인 (셀 편집 차단)
- [ ] 정렬 동작 (등록일/생성일/수정일)
- [ ] 기존 등록일 커스텀 전환 후 빈칸 9건 해소
- [ ] 커스텀 필드 기존 동작 회귀 없음

---

## 8. 검증 기준 (Plan §3.2 매핑)

| Plan 성공 기준 | 검증 |
|---|---|
| 시스템 등록일 필드가 전 record 표시 | 로컬: 빈칸 0 |
| 시스템 매핑 필드 읽기 전용 | 셀 편집 시도 → 무변화 |
| 시스템 매핑 정렬 = 시스템 컬럼 기준 | 등록일 정렬 동작 |
| partition 19 빈칸 해소 | 전환 후 9건 채워짐 |

---

## 9. Open Questions (Design)

- **Q1.** 시스템 매핑 필드의 key를 `systemColumn`과 동일하게 둘지(전환 호환) vs 별도 prefix(`__sys_registeredAt__`). → 전환 호환 위해 **동일(systemColumn 값)** 채택. 단 커스텀이 같은 key를 못 만들게 막혀야 함(이미 unique).
- **Q2.** `createdAt`/`updatedAt`이 records 목록 API 응답에 포함되는지 — 구현 시 확인 후 누락이면 추가.
- **Q3.** RecordDetailDialog의 시스템 필드 표시를 일반 필드 루프에 맡길지 별도 메타로 둘지 — 구현 시 결정.
