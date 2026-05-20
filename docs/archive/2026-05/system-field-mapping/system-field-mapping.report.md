# Completion Report: system-field-mapping (속성 생성 시 시스템 필드 매핑)

> Date: 2026-05-20 | Match Rate: 98% | Status: Completed

## PDCA Cycle Summary

```
[Plan] -> [Design] -> [Do] -> [Check] 98% -> [Report]
```

## 1. Feature Overview

속성(필드) 생성 시 "커스텀 / 시스템" 종류를 선택할 수 있게 한다. 시스템 필드를 선택하면 `records` 테이블의 시스템 컬럼(등록일·수정일)을 직접 읽어 표시하고 읽기 전용으로 처리한다.

### 배경

운영 partition 19("리드관리")의 record들에서 "등록일"이 비어 보이는 건이 9건 발생. 원인은 화면 "등록일"이 커스텀 필드 `data.registeredAt`을 읽는데, 백오피스랩 `createLead`가 해당 값을 넣지 않았기 때문. 반면 시스템 컬럼 `records.registered_at`은 모든 record에 채워져 있음. 근본 해결을 위해 시스템 컬럼 매핑 기능을 도입.

### 스코프 축소 (의도적 결정)

Design에서 시스템 컬럼 3개(등록일/생성일/수정일)를 명시했으나, 사용자 결정으로 생성일을 제거. "생성일은 등록일과 값이 같아 혼란"이라는 판단. 최종 시스템 컬럼: 등록일/수정일 2개.

---

## 2. Deliverables

### 2.1 DB Layer

| File | Change |
|------|--------|
| `drizzle/0047_field_system_column.sql` | `field_definitions.system_column varchar(50)` 컬럼 추가 (IF NOT EXISTS, 멱등) |
| `drizzle/0048_convert_registered_at_to_system.sql` | 기존 등록일 커스텀 필드를 시스템 매핑으로 전환 (멱등) |
| `drizzle/meta/_journal.json` | idx 47, 48 등록 |
| `src/lib/db/schema.ts` | `fieldDefinitions`에 `systemColumn: varchar("system_column", { length: 50 })` 추가 |

### 2.2 Type Layer

| File | Change |
|------|--------|
| `src/types/index.ts` | `FieldDefinition.systemColumn: string \| null` 추가 |
| `src/types/index.ts` | `CreateFieldInput.systemColumn?: string` 추가 |

### 2.3 Core Logic

| File | Change |
|------|--------|
| `src/components/records/system-columns.ts` | 전면 재작성: SYSTEM_FIELD_COLUMNS 상수(등록일/수정일), isValidSystemColumn, getSystemColumnLabel. 기존 토글식 자동표시 로직(getVisibleSystemColumns, isSystemColumnOverridden 등) 완전 제거 |

### 2.4 UI Layer

| File | Change |
|------|--------|
| `src/components/settings/CreateFieldDialog.tsx` | "필드 종류" 선택(커스텀/시스템) + 시스템 선택 시 드롭다운 + 라벨 입력. 시스템 선택 시 key/타입 입력란 숨김 |
| `src/components/settings/EditFieldDialog.tsx` | 시스템 필드(`field.systemColumn != null`)이면 안내 메시지 표시. key/타입 disabled Input 표시 |
| `src/components/records/RecordTable.tsx` | systemColumn 렌더 분기(`field.systemColumn ? record[systemColumn] : data[field.key]`) + `readOnly={!!field.systemColumn}` 전달. 기존 하드코딩 등록일 시스템 컬럼 렌더 코드 제거 |
| `src/components/records/InlineEditCell.tsx` | `readOnly?: boolean` prop 추가. `onSave` 옵셔널로 변경 |
| `src/components/records/RecordToolbar.tsx` | getVisibleSystemColumns 의존 제거 |
| `src/app/records/page.tsx` | getVisibleSystemColumns 의존 제거 |
| `src/components/tracker/ui/TrackerSettingsTab.tsx` | 삭제 (기존 system-columns.ts 구조 의존 컴포넌트) |

### 2.5 API Layer

| File | Change |
|------|--------|
| `src/app/api/field-types/[id]/fields/route.ts` POST | systemColumn 분기: isValidSystemColumn 검증 + key/타입/cellType/isSystem 자동 결정 |
| `src/app/api/partitions/[id]/records/route.ts` GET | updatedAt 정렬 분기 추가. registeredAt/createdAt/updatedAt select 포함 확인 |
| `src/app/api/records/[id]/route.ts` PATCH | 시스템 키(registeredAt/createdAt/updatedAt)를 data에 저장하지 않도록 차단 |
| `src/app/api/webhooks/meta/route.ts` | data.registeredAt 자동저장 죽은코드 제거 |

---

## 3. Gap Analysis 결과

**분석 파일**: `docs/03-analysis/features/system-field-mapping.analysis.md`

| 구분 | 항목 수 | PASS | PARTIAL | FAIL |
|------|--------|------|---------|------|
| DB/마이그레이션 | 4 | 4 | 0 | 0 |
| 타입 | 2 | 2 | 0 | 0 |
| system-columns.ts | 4 | 4 | 0 | 0 |
| UI | 11 | 11 | 0 | 0 |
| API | 8 | 7 | 1 | 0 |
| 마이그레이션/정리 | 2 | 2 | 0 | 0 |
| **합계** | **31** | **30** | **1** | **0** |

**Match Rate: 98%**

### PARTIAL 항목

`/api/fields/[id]/route.ts` PATCH에서 시스템 필드의 `systemColumn`/`key`/`fieldType` 변경을 명시적으로 거부하는 코드가 없음. 다만 PATCH handler가 해당 파라미터를 수신·처리하지 않으므로 기능적으로는 차단됨. 현재 클라이언트 구조(EditFieldDialog)상 실제 침해 경로 없음. 위험도 낮음.

---

## 4. 검증 결과

- tsc 통과
- dev 환경 동작 확인
- 기존 등록일 커스텀 필드 → 시스템 매핑 전환(0048 마이그레이션) 로컬 검증

---

## 5. 잔여 사항 / 후속 권고

1. `/api/fields/[id]/route.ts` PATCH에 시스템 필드 명시적 가드 추가 (낮은 우선순위):
   ```ts
   if (access.field.systemColumn) {
       // systemColumn/key/fieldType 변경 요청 무시 또는 400 반환
   }
   ```

2. 자동표시 의존 타입(WEDLY/마케팅email 등 7개)에 등록일 시스템 필드 수동 추가 필요 (Design §4.4.1 참고). 운영 반영 시 사용자 결정 필요.

---

## 6. 운영 반영 체크리스트

- [ ] 0047, 0048 마이그레이션 운영 실행
- [ ] 자동표시 의존 타입에 등록일 시스템 필드 추가 여부 결정
- [ ] partition 19 빈칸 9건 해소 확인 (0048 실행 후 자동)
