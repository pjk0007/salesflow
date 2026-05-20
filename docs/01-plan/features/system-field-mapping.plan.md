# Plan: 속성 생성 시 시스템 필드 매핑 (System Field Mapping)

> **Summary**: 속성(필드) 생성 시 "커스텀 필드 / 시스템 필드"를 선택할 수 있게 한다. 시스템 필드를 고르면 sendb가 가진 시스템 컬럼(등록일·생성일·수정일)을 드롭다운으로 선택해 매핑하고, 화면은 `data`가 아니라 시스템 컬럼 값을 그대로 보여준다.
>
> **Project**: Sendb (Salesflow)
> **Author**: jaehun
> **Date**: 2026-05-20
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

속성 타입 관리에서 필드를 만들 때 **시스템 필드**를 선택할 수 있게 한다.
- "등록일" 같은 필드는 커스텀 `data.registeredAt`을 만들지 않고, **시스템 컬럼 `records.registered_at`에 매핑**한다.
- 매핑된 필드는 항상 값이 차 있다 (시스템 컬럼은 모든 record에 존재).

### 1.2 Background — 지금 무엇이 문제인가

운영 partition 19("리드관리")의 도입상담 record들에서 화면 "등록일"이 비어 보이는 건이 있다.

원인 분석 결과:
- 화면 "등록일" 컬럼은 **커스텀 필드 `data.registeredAt`** 을 본다.
- 백오피스랩 `createLead`가 만든 일부 record는 `data.registeredAt`을 안 넣음 → 빈칸.
- 반면 시스템 컬럼 `records.registered_at`은 **모든 record에 다 채워져 있다** (NULL 0건).

→ 즉 멀쩡한 시스템 값이 있는데, 커스텀 필드가 그 자리를 차지해서 빈칸으로 보인다. 사용자가 "등록일"을 커스텀으로 만든 게 근본 원인.

### 1.3 핵심 결정사항

1. **필드에 "출처" 개념 추가** — 필드는 `커스텀`이거나 `시스템 매핑`이다.
2. **시스템 매핑 필드는 `data`를 안 본다** — `records`의 시스템 컬럼(registered_at 등)을 직접 읽어 표시. 단일 진실원천.
3. **노출 시스템 컬럼은 3개** — 등록일(`registered_at`), 생성일(`created_at`), 수정일(`updated_at`).
4. **시스템 매핑 필드는 읽기 전용** — 시스템이 관리하는 값이라 사용자가 수정 못 함.
5. **기존 `data.registeredAt` 커스텀 필드는 마이그레이션** — 시스템 매핑으로 전환하거나, 빈 값을 시스템 값으로 보정.

### 1.4 왜 "data 자동 복사"가 아니라 "매핑"인가

대안: record 생성 시 `registered_at` 값을 `data.registeredAt`에도 복사 → 단순.
- ❌ 데이터 중복 (시스템 컬럼 + data 양쪽)
- ❌ 동기화 문제 (updated_at은 계속 바뀌는데 data 복사본은 안 따라감)
- ❌ 기존 빈 건은 여전히 보정 필요

→ **매핑 방식**: 필드가 어떤 시스템 컬럼을 가리키는지만 저장하고, 렌더 시 시스템 값을 읽음. 중복 없음, 항상 최신.

### 1.5 Related

- 필드 생성 UI: `src/components/settings/CreateFieldDialog.tsx`, `EditFieldDialog.tsx`
- 기존 시스템 컬럼 처리: `src/components/records/system-columns.ts` (현재 "등록일" 하드코딩 시스템 컬럼이 별도로 존재)
- 렌더링: `src/components/records/RecordTable.tsx`
- 스키마: `field_definitions` (이미 `isSystem` 컬럼 보유)
- 목록 API: `src/app/api/partitions/[id]/records/route.ts`

---

## 2. Scope

### 2.1 In Scope

- [ ] **필드 생성/편집 다이얼로그**에 "필드 종류: 커스텀 / 시스템" 선택 추가
- [ ] 시스템 선택 시 → 시스템 컬럼 드롭다운(등록일/생성일/수정일)
- [ ] **`field_definitions`에 `system_column` 컬럼 추가** — 매핑된 시스템 컬럼 키 저장 (NULL이면 커스텀)
- [ ] **렌더링 분기** — 시스템 매핑 필드는 `record.{registeredAt|createdAt|updatedAt}` 표시, `data` 안 봄
- [ ] **읽기 전용 처리** — 시스템 매핑 필드 셀은 편집 불가
- [ ] **정렬/필터** — 시스템 매핑 필드 정렬 시 시스템 컬럼 기준
- [ ] **기존 `system-columns.ts` 하드코딩 등록일과의 정합성 정리** — 중복 안 되게
- [ ] 기존 커스텀 "등록일"(`data.registeredAt`) 처리 — 마이그레이션 또는 보정

### 2.2 Out of Scope

- ❌ 시스템 컬럼 추가 노출 (통합코드 등) — 이번엔 3개만
- ❌ 시스템 매핑 필드 값 편집 기능 — 읽기 전용 고정
- ❌ 트래커/record-events 관련 (별개 작업)

### 2.3 마이그레이션 대상 (운영)

기존에 `data.registeredAt`을 쓰던 record들:
- 빈 9건(partition 19) — `data.registeredAt`이 비어 화면에 빈칸
- 처리안: (a) 빈 값을 `registered_at`으로 보정, 또는 (b) 커스텀 필드 자체를 시스템 매핑으로 전환하면 data 무관해짐 → (b)가 근본

---

## 3. Goals

### 3.1 Primary Goals

1. **시스템 필드 매핑 가능** — 등록일/생성일/수정일을 커스텀 필드 없이 시스템 값으로 표시
2. **빈칸 문제 해소** — 시스템 컬럼은 항상 값이 있으므로 빈칸이 안 생김
3. **재발 방지** — 앞으로 "등록일"을 커스텀으로 만들 필요 없음 → 외부 연동(createLead)이 안 넣어도 무관

### 3.2 Success Criteria

- 속성 추가 시 "시스템 필드 → 등록일" 선택하면, 모든 record에 등록일이 채워져 보인다
- 시스템 매핑 필드는 편집 시도해도 안 바뀐다 (읽기 전용)
- 시스템 매핑 필드로 정렬하면 시스템 컬럼 기준으로 정렬된다
- partition 19의 도입상담 record 빈 등록일이 사라진다

---

## 4. 데이터 모델

### 4.1 `field_definitions.system_column` 추가

```ts
fieldDefinitions: {
  ...
  isSystem: integer  // 이미 있음 (시스템 필드 여부 플래그)
  systemColumn: varchar(50) | null  // 신규 — 매핑된 시스템 컬럼 키
                                    // 'registeredAt' | 'createdAt' | 'updatedAt' | null(커스텀)
}
```

- `systemColumn`이 NULL → 일반 커스텀 필드 (지금까지와 동일)
- `systemColumn`이 값 있음 → 그 시스템 컬럼을 가리킴. `key`/`data`는 표시에 안 씀

### 4.2 시스템 컬럼 화이트리스트

```
registeredAt → records.registered_at  (등록일)
createdAt    → records.created_at      (생성일)
updatedAt    → records.updated_at      (수정일)
```

→ 이 3개만 허용. API에서 화이트리스트 검증.

### 4.3 기존 system-columns.ts와의 관계

현재 `system-columns.ts`에 "등록일"이 **하드코딩 시스템 컬럼**으로 이미 존재(토글 가능). 이게 새 "시스템 매핑 필드"와 **개념이 겹친다.**

→ 결정 필요 (Open Question Q1): 기존 하드코딩 시스템 컬럼을 유지하면서 매핑 필드를 추가할지, 아니면 매핑 필드로 통합할지.

---

## 5. 동작 설계

### 5.1 필드 생성 플로우

```
[속성 추가 다이얼로그]
1. "필드 종류" 선택: ◉ 커스텀  ○ 시스템
2-a. 커스텀 → 기존 그대로 (key/label/타입/...)
2-b. 시스템 → 시스템 컬럼 드롭다운 [등록일 / 생성일 / 수정일]
              + 라벨만 입력 (key/타입은 시스템이 결정: datetime, readonly)
3. 저장 → field_definitions INSERT (systemColumn 채움, isSystem=1, cellType='readonly')
```

### 5.2 렌더링 분기 (RecordTable)

```ts
const value = field.systemColumn
    ? record[field.systemColumn]      // 시스템 값 (registeredAt 등)
    : record.data[field.key];          // 커스텀 값 (기존)
```

- 시스템 매핑 필드 → 시스템 값, 읽기 전용 셀
- 커스텀 → 기존 그대로

### 5.3 목록 API

`partitions/[id]/records/route.ts`는 이미 `registeredAt`/`createdAt`/`updatedAt`을 select에 포함하는지 확인 필요. 없으면 추가. 정렬도 시스템 컬럼 분기.

---

## 6. 작업 범위 (체크리스트)

### DB
- [ ] `field_definitions.system_column` 마이그레이션 + schema.ts

### 타입
- [ ] `FieldDefinition.systemColumn`, `CreateFieldInput.systemColumn` 추가

### UI
- [ ] CreateFieldDialog — 커스텀/시스템 선택 + 시스템 컬럼 드롭다운
- [ ] EditFieldDialog — 동일
- [ ] RecordTable — 시스템 매핑 필드 렌더 분기 + 읽기 전용
- [ ] system-columns.ts 정합성 정리

### API
- [ ] 필드 생성/수정 API — systemColumn 화이트리스트 검증
- [ ] records 목록 API — 시스템 컬럼 select/정렬 분기 확인

### 마이그레이션
- [ ] 기존 커스텀 "등록일" 처리 방안 적용 (운영)

### 검증
- [ ] 시스템 등록일 필드 생성 → 모든 record 값 표시
- [ ] 읽기 전용 확인
- [ ] 정렬 동작
- [ ] partition 19 빈칸 해소

---

## 7. Risks & Considerations

### 7.1 기존 system-columns.ts 중복
이미 "등록일" 하드코딩 시스템 컬럼이 있음. 새 매핑 필드와 충돌/중복 가능 → Q1에서 정리.

### 7.2 기존 데이터
`data.registeredAt`을 쓰던 record/필드가 이미 있음. 시스템 매핑으로 전환 시 기존 커스텀 필드를 어떻게 할지(삭제/전환) 결정 필요.

### 7.3 정렬/필터 일관성
시스템 매핑 필드는 `data->>key`가 아니라 실제 컬럼으로 정렬해야 함. API 분기 누락 시 정렬 깨짐.

### 7.4 읽기 전용 강제
시스템 값은 수정 불가여야 함. 셀 편집·bulk-import·외부 API 모두에서 막아야 일관됨 (최소 셀 편집은 필수).

---

## 8. 전수 조사로 확정된 사실 (2026-05-20)

### 8.1 필드는 워크스페이스가 아니라 "속성 타입"(field_type)에 정의된다
- `partitions.field_type_id` → `field_definitions.field_type_id`로 연결
- 예: partition 19("리드관리") → field_type 7 → 그 타입에 필드 정의
- ⚠️ workspace_id로 field_definitions를 찾으면 안 됨

### 8.2 화면 "등록일"의 정체 = 커스텀 필드 `registeredAt`
- field_type 7에 `key='registeredAt', label='등록일', field_type='datetime', is_system=0` 커스텀 필드 존재
- 화면 "등록일" 컬럼 = 이 커스텀 필드. `data.registeredAt`을 읽음
- 백오피스랩 createLead가 `data.registeredAt`을 안 넣어 빈칸(9건). meta webhook은 넣어서 채워짐

### 8.3 시스템 컬럼 등록일도 별도로 존재 (system-columns.ts)
- `__registeredAt__` 토글식 시스템 컬럼이 이미 구현됨 (커밋 8b860df)
- `SYSTEM_COLUMN_OVERRIDE_KEYS`로 "커스텀 registeredAt 있으면 시스템 컬럼 숨김"(커밋 458e28e)
- → 리드관리 타입엔 커스텀 등록일이 있어 시스템 컬럼이 가려져 있음

### 8.4 등록일 처리의 역사 (왜 엉켰나)
- 4/1 `6dcd45d`: data.registeredAt 자동저장 도입
- 4/30 `8b860df`: 시스템 컬럼 방식으로 전환 (방향 바뀜)
- 4/30 `458e28e`: 둘 공존 충돌을 override로 가림 (땜빵)
- → 한 기능에 두 방식 공존. 이번에 시스템 방식으로 일원화하며 청소

### 8.5 data.registeredAt 쓰기 지점
- meta webhook (`webhooks/meta/route.ts:228`)만 `data.registeredAt` 자동저장
- 그 외 읽기는 모두 시스템 컬럼 `record.registeredAt`

## 9. 결정사항 (확정)

### D1. 기존 등록일 커스텀 필드는 "전환"(A안)
- 기존 `registeredAt` 커스텀 필드를 **삭제하지 않고** `systemColumn='registeredAt'`로 전환
- 컬럼 위치/visible_fields/정렬 설정 유지된 채 값만 시스템 값으로 바뀜
- 마이그레이션: 해당 필드 `system_column` 채우고 `cell_type='readonly'`, `is_system=1`로 UPDATE

### D2. system-columns.ts 하드코딩 시스템 컬럼은 제거(통합)
- 토글식 `__registeredAt__`/override 로직 제거 → "시스템 필드 매핑"으로 일원화

### D3. meta webhook의 data.registeredAt 자동저장 제거
- `webhooks/meta/route.ts:228` 줄 제거 (시스템 컬럼으로 일원화하므로 불필요)

### D4. 빈 9건은 별도 보정 불필요
- 등록일 커스텀 필드를 시스템 매핑으로 전환하면 `records.registered_at`(다 차있음)을 보게 되어 빈칸 자동 해소

### D5. 모든 작업은 로컬 검증 후 운영 반영
- 운영 DB 덤프 → 로컬 복원 → 로컬에서 기능/마이그레이션 검증 → 운영 적용

## 10. Next Step

- [ ] Plan 검토
- [ ] `/pdca design system-field-mapping`
- [ ] 운영 덤프 → 로컬 복원 (검증 환경)
