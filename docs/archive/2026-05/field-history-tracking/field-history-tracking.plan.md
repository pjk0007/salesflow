# Plan: 필드 변경 이력 추적 (Field History Tracking)

> **Summary**: sendb 자체에서 record의 특정 필드(status, 단계, 담당자 등)를 변경할 때, 그 변경을 record_events에 자동으로 이력으로 남긴다. 추적 대상은 **필드별 토글**로 사용자가 지정한다.
>
> **Project**: Sendb (Salesflow)
> **Author**: jaehun
> **Date**: 2026-05-20
> **Status**: Draft
> **Related**: record-events, record-create-with-event (archive/2026-05)

---

## 1. Overview

### 1.1 Purpose
지금까지 record_events에 쌓이는 건 **외부**(디하 매칭 단계, 백오피스랩 도입상담)뿐이다. **sendb UI에서 사용자가 직접 status를 바꾸는 것**(신규→연락중→핵심→전환)은 이력에 안 남는다. 이걸 record_events에 자동 기록해서 통합 여정을 완성한다.

### 1.2 Background — 빠진 구멍
```
디하 트리거          → record_events ✅
백오피스랩 도입상담    → record_events ✅
sendb UI 직접 변경    → record_events ❌  ← 이번에 채움
```
리드 상담을 sendb 화면에서 단계 바꾸는데 이력이 안 남아 "언제 신규→연락중 됐는지" 모름. 여정 분석이 반쪽.

### 1.3 핵심 결정 — 필드별 토글 (B안)
어떤 필드 변경을 이력으로 쌓을지 = **필드 정의에 "변경 이력 추적" 토글** 추가.
- 사용자가 의미 있는 필드만 골라서 추적 (status, 단계, 담당자 등 여러 개 가능)
- 노이즈 없음 (이름 오타 수정 같은 건 추적 안 함)
- **system-field-mapping과 동일 패턴** — 속성 만들/수정 시 체크박스 하나
- `field_definitions`에 `track_history` boolean 컬럼 하나 추가

### 1.4 왜 다른 안이 아닌가
| 안 | 기각 이유 |
|---|---|
| A. 파티션당 필드 1개(statusField) | 추적 대상 2개 이상이면 부족 |
| C. select 타입 자동 추적 | 추적 원치 않는 select도 쌓임 |
| D. 전부 추적 | record_events 폭증 (오타 수정도 이력) |
| **B. 필드별 토글** | ✅ 유연 + 노이즈 없음 + 기존 패턴 일관 |

### 1.5 Related
- `field_definitions`, `record_events`
- PATCH `/api/records/:id` (sendb UI 변경의 단일 통로 — 셀 편집/상세 수정 모두 여기로)
- 속성 설정 UI: CreateFieldDialog / EditFieldDialog
- 공용 헬퍼: `lib/record-events.ts` (insertRecordEvent 재사용)

---

## 2. Scope

### 2.1 In Scope
- [ ] `field_definitions.track_history` boolean 컬럼 추가
- [ ] CreateFieldDialog / EditFieldDialog에 "변경 이력 추적" 토글
- [ ] 필드 생성/수정 API에 trackHistory 처리
- [ ] PATCH `/api/records/:id`에서 추적 필드 변경 감지 → record_events 기록
- [ ] 변경 감지: before(existing.data) vs after(sanitized) 비교, 추적 켜진 필드 중 값이 바뀐 것만

### 2.2 Out of Scope
- ❌ 외부 API(PUT)는 이미 event 옵션 있음 — 자동 감지 안 함 (외부는 명시적으로 event 보냄)
- ❌ 과거 변경 소급 이력 (도입 시점부터)
- ❌ 여정 시각화 (별도)

### 2.3 향후
record_events가 (외부 + sendb UI) 모든 경로에서 쌓이면 → 고객 여정 인텔리전스의 완전한 소스가 됨.

---

## 3. Goals

### 3.1 Primary
1. sendb UI에서 status 등 바꾸면 자동으로 이력 기록
2. 추적 필드는 사용자가 필드별로 선택
3. 외부 + sendb UI 이력이 한 record_events에 시간순 통합

### 3.2 Success Criteria
- status 필드에 "이력 추적" 켜고 신규→연락중 바꾸면 record_events에 `{type:'status', label:'연락중', meta:{from:'신규',to:'연락중'}}` 기록
- 추적 안 켠 필드(이름 등) 바꾸면 이력 안 쌓임
- 셀 인라인 편집 / 상세 수정 둘 다 동일하게 잡힘 (둘 다 PATCH 경유)

---

## 4. 데이터 모델

### 4.1 `field_definitions.track_history` (신규)
```ts
trackHistory: integer("track_history").default(0).notNull()  // 0=추적안함, 1=추적
```
- NULL 없이 기본 0 (기존 필드 영향 없음)

### 4.2 이벤트 형태
추적 필드 변경 시 record_events에:
```
{ type: <field.key>,        // 'status' 등 — 필드 key를 type으로
  label: <새 값>,            // '연락중'
  meta: { field, from, to, by } }  // 필드/이전값/새값/수정자
```
→ 디하(`type:'match_stage'`)와 구분됨. type이 곧 "무슨 필드 변경인지".

> Open Q: type을 field.key로 할지 고정 `'field_change'`로 하고 meta.field에 둘지 — §8 Q1.

---

## 5. 동작 설계

### 5.1 변경 감지 (PATCH /api/records/:id)
```
1. existing 조회 (before)
2. 추적 켜진 필드 목록 로드 (이 record의 field_type 기준 track_history=1)
3. for 각 추적필드:
     before = existing.data[key], after = sanitized[key]
     if (after !== undefined && after !== before):
        record_events INSERT { type:key, label:after, meta:{field:key, from:before, to:after, by:user.userId} }
4. record UPDATE (기존)
```

### 5.2 추적 필드 목록 조회
- record의 partition → field_type_id → `field_definitions WHERE field_type_id=? AND track_history=1`
- PATCH마다 쿼리 1번 추가 (추적 필드 있을 때만 의미)

### 5.3 셀 편집/상세 수정 모두 커버
- sendb UI의 모든 record 변경은 PATCH `/api/records/:id` 경유 (handleCellSave, 상세 저장 등)
- → 한 곳에서 잡으면 전부 커버

---

## 6. 작업 범위 (체크리스트)

### DB/타입
- [ ] `field_definitions.track_history` 마이그레이션 + schema.ts
- [ ] FieldDefinition / CreateFieldInput / UpdateFieldInput에 trackHistory

### UI
- [ ] CreateFieldDialog — "변경 이력 추적" 체크박스
- [ ] EditFieldDialog — 동일

### API
- [ ] 필드 생성/수정 API — trackHistory 저장
- [ ] PATCH `/api/records/:id` — 추적 필드 diff 감지 → insertRecordEvent

### 검증 (로컬)
- [ ] status에 추적 켜고 변경 → 이력 기록
- [ ] 추적 안 켠 필드 변경 → 이력 없음
- [ ] 셀 편집 / 상세 수정 둘 다 기록
- [ ] from/to 정확

---

## 7. Risks & Considerations

### 7.1 PATCH 성능
추적 필드 조회 쿼리 1번 추가. record 수정 빈도 낮아 무시 가능. 추적 필드 없으면 스킵.

### 7.2 일괄 수정(bulk)
bulk-import / bulk update 경로도 PATCH 안 거치면 누락. → 이번엔 단건 PATCH만. bulk는 향후.

### 7.3 type 네이밍 일관성
디하는 `match_stage`, sendb UI는 field.key(`status` 등). 분석 시 둘 섞임 — meta로 구분 가능하나 §8 Q1에서 정리.

### 7.4 같은 값으로 저장
after === before면 기록 안 함 (불필요한 이력 방지). 이미 §5.1에 반영.

---

## 8. 결정사항 (확정)

### D1. event type = field.key
status 변경 → `type='status'`. 필드별 의미 명확, 집계 쉬움. 디하 match_stage와 자연 공존.

### D2. label = 변경 후 값, 상세는 meta
타임라인에 "연락중" 표시, meta에 `{from, to}`.

### D3. 수정자(by) 기록
`meta.by = user.userId` — "누가 바꿨나" 여정 분석에 활용.

→ 최종 이벤트 형태:
```
status: 신규 → 연락중
  { type:'status', label:'연락중', meta:{ field:'status', from:'신규', to:'연락중', by:<userId> } }
```

---

## 9. Next Step
- [ ] Plan 검토
- [ ] `/pdca design field-history-tracking` — 마이그레이션, 토글 UI, PATCH 감지 로직 상세
- [ ] 운영 덤프 복원본에서 로컬 검증 (이미 복원돼 있음)
