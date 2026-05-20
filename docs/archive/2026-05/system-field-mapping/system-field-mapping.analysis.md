# Gap Analysis: system-field-mapping

> **Plan**: docs/01-plan/features/system-field-mapping.plan.md
> **Design**: docs/02-design/features/system-field-mapping.design.md
> **Date**: 2026-05-20
> **Analyst**: auto-pdca-finalize

---

## 분석 방법

Design §7 체크리스트 + 각 섹션 명세를 구현 파일과 1:1 대조.

### 의도적 변경 (Gap 아님)

- Design §3.3에서 SYSTEM_FIELD_COLUMNS = 등록일/생성일/수정일 3개.
  구현은 사용자 결정으로 등록일/수정일 2개. "생성일은 등록일과 값이 같아 혼란"이라 제거 → 스코프 축소, Gap 아님.

---

## 항목별 대조

### DB / 마이그레이션

| 항목 | Design | 구현 | 판정 |
|------|--------|------|------|
| 0047_field_system_column.sql | `ADD COLUMN system_column varchar(50)` | `ADD COLUMN IF NOT EXISTS "system_column" varchar(50)` | PASS |
| 0048_convert_registered_at_to_system.sql | UPDATE field_definitions WHERE key='registeredAt' AND system_column IS NULL | 동일, 멱등 구현 | PASS |
| drizzle/meta/_journal.json | idx 47, 48 등록 | 등록됨 | PASS |
| schema.ts systemColumn | `varchar("system_column", { length: 50 })` fieldDefinitions에 추가 | 추가됨 (L144) | PASS |

### 타입

| 항목 | Design | 구현 | 판정 |
|------|--------|------|------|
| FieldDefinition.systemColumn | `string \| null` | 추가됨 | PASS |
| CreateFieldInput.systemColumn | `string \| undefined` (optional) | 추가됨 | PASS |

### system-columns.ts

| 항목 | Design | 구현 | 판정 |
|------|--------|------|------|
| SYSTEM_FIELD_COLUMNS 상수 | registeredAt/createdAt/updatedAt 3개 | registeredAt/updatedAt 2개 (의도적 축소) | PASS (의도적 변경) |
| isValidSystemColumn | 화이트리스트 검증 함수 | 구현됨 | PASS |
| getSystemColumnLabel | label 반환 유틸 | 구현됨 | PASS |
| 기존 토글식 자동표시 제거 | getVisibleSystemColumns, isSystemColumnOverridden 등 전부 제거 | 제거됨 | PASS |

### UI

| 항목 | Design | 구현 | 판정 |
|------|--------|------|------|
| CreateFieldDialog: 커스텀/시스템 선택 | Select UI + fieldKind state | 구현됨 | PASS |
| CreateFieldDialog: 시스템 드롭다운 | SYSTEM_FIELD_COLUMNS 순회 SelectItem | 구현됨 | PASS |
| CreateFieldDialog: 시스템 선택 시 key/타입 숨김 | fieldKind==='system' 분기로 커스텀 입력란 숨김 | 구현됨 | PASS |
| CreateFieldDialog: submit 페이로드 systemColumn 포함 | `onSubmit({ key: systemColumn, systemColumn, ... })` | 구현됨 | PASS |
| EditFieldDialog: 시스템 필드 안내 표시 | `field.systemColumn != null`이면 안내 메시지 | 구현됨 (L161-165) | PASS |
| EditFieldDialog: systemColumn/key/타입 읽기 전용 | 수정 불가 표시 | key/타입 disabled Input으로 구현됨 | PASS |
| RecordTable: systemColumn 렌더 분기 | `field.systemColumn ? record[systemColumn] : data[field.key]` | 구현됨 (L199-206) | PASS |
| RecordTable: readOnly prop 전달 | `readOnly={!!field.systemColumn}` | 구현됨 (L219, L243) | PASS |
| InlineEditCell: readOnly prop | `readOnly?: boolean` | 추가됨 (L25) | PASS |
| InlineEditCell: onSave 옵셔널 | `onSave?: (value) => void` | 옵셔널로 변경됨 | PASS |
| RecordToolbar: getVisibleSystemColumns 의존 제거 | 제거 | 제거됨 | PASS |
| records/page.tsx: getVisibleSystemColumns 의존 제거 | 제거 | 제거됨 | PASS |

### API

| 항목 | Design | 구현 | 판정 |
|------|--------|------|------|
| 필드 생성 POST: systemColumn 분기 + 검증 | isValidSystemColumn 검증 + 시스템 경로 분기 | 구현됨 (route.ts L83-134) | PASS |
| 필드 생성 POST: 시스템 필드 key=systemColumn 강제 | `finalKey = isSystemField ? systemColumn : key` | 구현됨 | PASS |
| 필드 생성 POST: 시스템 필드 isSystem=1, cellType=readonly | 강제 세팅 | 구현됨 | PASS |
| 필드 수정 PATCH: systemColumn/key/fieldType 변경 차단 | 명시적 가드 로직 | PATCH 요청 파라미터에서 애초에 미포함 → 사실상 차단. 단 명시적 검증 코드 없음 | PARTIAL |
| records 목록 GET: registeredAt/createdAt/updatedAt select | 시스템 컬럼 select에 포함 | registeredAt/createdAt/updatedAt 모두 포함 (L204-206) | PASS |
| records 목록 GET: createdAt/updatedAt 정렬 분기 | sortField 분기 추가 | createdAt/updatedAt 정렬 분기 추가됨 (L149-152) | PASS |
| records PATCH: 시스템 키 data 저장 차단 | registeredAt/createdAt/updatedAt 삭제 후 저장 | 구현됨 (L68-70) | PASS |

### 마이그레이션 / 정리

| 항목 | Design | 구현 | 판정 |
|------|--------|------|------|
| 기존 등록일 커스텀 → 시스템 매핑 전환 | 0048 마이그레이션 SQL | 구현됨 | PASS |
| webhook data.registeredAt 자동저장 제거 | L228-230 코드 제거 | 제거됨 (주석으로 의도 명시) | PASS |

---

## Gap 요약

### 실제 Gap (기능적 위험)

없음.

### 부분 구현 (PARTIAL) — 기능적으로는 동등, 방어 코드 미흡

**`/api/fields/[id]/route.ts` PATCH — 시스템 필드 명시적 가드 없음**

- Design §5.2: "시스템 매핑 필드는 label/정렬/너비만 반영, systemColumn/key/fieldType 변경 차단"
- 현황: PATCH handler가 `systemColumn`/`key`/`fieldType`을 요청 파라미터에서 받지 않으므로 변경 불가. 기능적으로는 차단됨.
- 단, API를 직접 호출하는 외부 클라이언트가 `systemColumn` 키를 넣어도 아무런 응답 없이 무시됨. Design의 "차단" 의도와는 맥락이 맞으나 명시적 reject는 없음.
- 위험도: 낮음. 현재 클라이언트가 EditFieldDialog 경유이므로 실제 침해 경로 없음.

---

## Match Rate 계산

| 구분 | 전체 항목 | PASS | PARTIAL | FAIL |
|------|----------|------|---------|------|
| DB/마이그레이션 | 4 | 4 | 0 | 0 |
| 타입 | 2 | 2 | 0 | 0 |
| system-columns.ts | 4 | 4 | 0 | 0 |
| UI | 11 | 11 | 0 | 0 |
| API | 8 | 7 | 1 | 0 |
| 마이그레이션/정리 | 2 | 2 | 0 | 0 |
| **합계** | **31** | **30** | **1** | **0** |

**Match Rate: 97%** (30/31 완전 일치, 1건 PARTIAL로 0.5점 처리 시 30.5/31 = 98%)

기준: PASS=1점, PARTIAL=0.5점, FAIL=0점 → 30.5/31 = **98%**

---

## 결론

Match Rate **98%** — 90% 임계값 초과. 리포트 생성 및 아카이빙 진행.

유일한 PARTIAL 항목(`/api/fields/[id]/route.ts` 시스템 필드 가드)은 기능적 위험이 없으며, 현재 클라이언트 구조상 실제 침해 경로가 없음. 추후 API 보안 강화 시 보완 가능.
