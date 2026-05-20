# Plan: 레코드 이벤트 (Record Events)

> **Summary**: 레코드에 일어난 비즈니스 이벤트(단계 변경, 상담 신청 등)를 시간순으로 기록하는 범용 이벤트 시스템. 이후 "고객 여정 인텔리전스"의 데이터 기반이 된다.
>
> **Project**: Sendb (Salesflow)
> **Author**: jaehun
> **Date**: 2026-05-19
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

레코드(리드/고객) 한 명에게 일어나는 **비즈니스 이벤트의 이력**을 시간순으로 쌓는다. 디하의 "신청완료 → 테스트 → 구독 → 종료" 같은 단계 변화, 백오피스랩의 "도입상담 신청" 등 — 무엇이든 "이 record에 언제 무슨 일이 일어났나"를 기록한다.

이 데이터는 다음 단계인 **고객 여정 인텔리전스**(별도 Plan)의 핵심 소스가 된다.

### 1.2 Background

- **현재 상황**: sendb는 record의 **현재 상태**만 안다. 디하 트리거가 `matchStep`을 덮어쓰기로 갱신 → "지금 구독중"은 알지만 "언제 신청했고 언제 구독됐는지", "테스트→구독→테스트로 역행했는지"는 모름.
- **트래커는 이미 시계열**: `tracker_events`가 사이트 행동(페이지뷰 등)을 시간순으로 쌓고 있음. 근데 record 단위의 "비즈니스 이벤트"는 그런 게 없음.
- **여정 분석 불가능**: 단계 이력이 없으면 "어떤 행동 → 전환" 같은 퍼널 분석을 못 함.

### 1.3 핵심 결정사항

1. **범용 이벤트 시스템** — sendb는 "단계"가 무엇인지 모른다. `type`/`label`을 자유롭게 받는 범용 구조. 디하 전용 개념(매칭 단계)이 sendb API에 박히지 않는다.
2. **별도 테이블** `record_events` — JSONB 배열이 아니라 테이블. 이벤트가 많아져도(역행/재진입) 무겁지 않음. `tracker_events`와 같은 패턴.
3. **이벤트는 append-only** — 한 번 기록된 이벤트는 수정/삭제 안 함. 이력이라 불변.
4. **현재 상태 + 이력 공존** — `record.data.matchStep`(현재값)은 그대로 두고, `record_events`에 이력을 추가. 현재 보기 / 이력 보기 둘 다 가능.

### 1.4 왜 디하 전용이 아니라 범용인가

```
디하        → type='match_stage',  label='테스트' / '구독중' ...
백오피스랩   → type='consult',      label='도입상담 신청'
일반 고객사 → type 자유              label 자유
```

→ sendb API는 `type`/`label`/`occurred_at`/`meta`만 받음. 의미는 고객사(디하 트리거 등)가 정함. "stage" 같은 디하 용어가 sendb에 없음.

### 1.5 Related Documents

- 트래커: `docs/01-plan/features/tracker.plan.md`
- 디하 서버 트리거: `~/Projects/designer-hire-server/src/trigger/` (createProposal, createMatch, updateMatch)
- 디하 sendb 연동: `~/Projects/designer-hire-server/src/util/sendb.ts`
- sendb 외부 API: `src/app/api/v1/records/`
- 후속 Plan: 고객 여정 인텔리전스 (record_events 완료 후 별도 작성)

---

## 2. Scope

### 2.1 In Scope

- [ ] **`record_events` 테이블** 신규 (record_id, org_id, type, label, occurred_at, meta)
- [ ] **이벤트 추가 API** — `POST /api/v1/records/:id/events` (외부 토큰 인증, CORS)
- [ ] **이벤트 조회 API** — `GET /api/v1/records/:id/events` (또는 내부용 `/api/records/:id/events`)
- [ ] **디하 서버 트리거 수정** — createProposal/createMatch/updateMatch가 단계 변경 시 이벤트 기록
  - `updateSendbRecord`(현재값 갱신)는 유지 + 이벤트 추가 병행
- [ ] **디하 `util/sendb.ts`에 `appendRecordEvent` 헬퍼** 추가
- [ ] (선택) sendb record 상세 화면에 이벤트 타임라인 표시 — 단순 목록 수준

### 2.2 Out of Scope (이번 안 함 — 별도 Plan)

- ❌ 고객 여정 인텔리전스 시각화 (퍼널 계단 + 관여도 + 채널 통합 차트) → **별도 Plan**
- ❌ 메일/트래커 데이터와의 통합 타임라인 → 별도 Plan (여정 인텔리전스)
- ❌ 회사 단위 묶기 — 일단 record(담당자) 단위
- ❌ 백오피스랩 이벤트 연동 — 디하 먼저, 백오피스랩은 후속

### 2.3 향후 (다음 Plan)

`record_events` 데이터가 쌓이면 → **고객 여정 인텔리전스** Plan:
- record_events + tracker_events + email_logs 를 record 기준 시간순 통합
- 퍼널 단계 계단 + 관여도 그래프 + 채널 + 이벤트 마커를 한 화면에
- "한눈에 이해" + "전문가 상세 지표" 둘 다 (depth 위계로)

---

## 3. Goals

### 3.1 Primary Goals

1. **이력 보존**: record의 단계가 언제 어떻게 바뀌었는지(역행 포함) 전부 시간순 기록
2. **범용성**: 디하·백오피스랩·미래 고객사 누구나 자기 `type`으로 이벤트 기록. sendb에 특정 도메인 개념 없음
3. **여정 분석의 기반**: 이 데이터로 이후 퍼널/전환 분석이 가능해짐

### 3.2 Success Criteria

- 디하에서 "테스트 → 구독 → 테스트로 역행" 한 회사의 record_events에 전이 4건이 시간순으로 다 남는다
- "테스트만 하고 종료" vs "구독 후 종료"가 이벤트 이력으로 구분된다
- sendb API는 `type='match_stage'`든 `type='consult'`든 동일하게 받는다 (디하 종속 0)
- 디하 트리거 변경이 기존 `matchStep` 갱신을 깨지 않는다 (현재값 + 이력 병행)

---

## 4. 데이터 모델

### 4.1 `record_events` 테이블 (신규)

```ts
record_events: {
  id            // PK
  org_id        // FK organizations — 조직 격리
  record_id     // FK records — 어느 레코드의 이벤트
  type          // 이벤트 종류 (자유) — 'match_stage', 'consult', ...
  label         // 사람이 읽는 라벨 (자유) — '테스트', '구독중', '도입상담 신청'
  occurred_at   // 이벤트 발생 시각 (클라이언트가 주거나 서버 now())
  meta          // jsonb — 추가 정보 (자유). 예: { from: '테스트', to: '구독중' }
  created_at    // 레코드 생성 시각 (기록된 시각)
}
```

**인덱스**:
- `(record_id, occurred_at)` — record의 이벤트를 시간순 조회
- `(org_id, type)` — 조직별 특정 타입 집계

**설계 원칙**:
- append-only. UPDATE/DELETE 안 함 (record 삭제 시 cascade는 허용)
- `type`/`label`은 sendb가 검증 안 함 (범용). 의미 부여는 고객사 몫
- `meta`로 확장 — 단계 전이면 `{ from, to }`, 금액 있으면 `{ amount }` 등

### 4.2 현재 상태 vs 이력

```
record.data.matchStep = '구독중'        ← 현재 단계 (디하 트리거가 갱신, 유지)
record_events                           ← 단계 변경 이력 (신규)
  { type:'match_stage', label:'신청완료', occurred_at:'5/1' }
  { type:'match_stage', label:'테스트',   occurred_at:'5/3' }
  { type:'match_stage', label:'구독중',   occurred_at:'5/10' }
  { type:'match_stage', label:'테스트',   occurred_at:'5/20' }  ← 역행
  ...
```

→ 둘 다 유지. "지금 상태"는 `matchStep`, "어떻게 왔나"는 `record_events`.

---

## 5. API 설계

### 5.1 `POST /api/v1/records/:id/events` — 이벤트 추가 (외부)

외부 고객사(디하 서버 등)가 호출. 기존 `/api/v1/records`와 동일하게 API 토큰 인증.

**Request**:
```json
{
  "type": "match_stage",
  "label": "구독중",
  "occurredAt": "2026-05-10T...",   // 선택, 없으면 서버 now()
  "meta": { "from": "테스트", "to": "구독중" }   // 선택
}
```

**처리**:
```
1. API 토큰 인증 + record 접근 권한 검증
2. record_events INSERT (org_id는 record에서)
3. 201 응답
```

- CORS 허용 (브라우저/서버 양쪽 호출 가능)
- `type`/`label` 필수, `occurredAt`/`meta` 선택

### 5.2 `GET /api/records/:id/events` — 이벤트 조회 (내부)

sendb UI가 record 상세에서 이벤트 타임라인 보여줄 때. `occurred_at` 역순.

### 5.3 범용성 보장

API 어디에도 "stage", "match" 같은 디하 용어 없음. `type` 문자열을 받을 뿐. 디하가 `match_stage`로 쓰는 건 디하 트리거 코드의 선택.

---

## 6. 디하 서버 연동

### 6.1 현재 (디하 server 트리거)

```
createProposal  status 'seek'    → updateSendbRecord(host, { matchStep:'신청완료' })
createMatch     status 'test'    → updateSendbRecord(host, { matchStep:'테스트', ... })
                status 'proceed' → updateSendbRecord(host, { matchStep:'구독중', ... })
updateMatch     status 변경      → updateSendbRecord(host, { matchStep:'...' })
```

→ `matchStep` **덮어쓰기**만. 이력 없음.

### 6.2 변경 — 이벤트 기록 추가

`util/sendb.ts`에 `appendRecordEvent` 헬퍼 추가:
```ts
appendRecordEvent(uuid, {
  type: 'match_stage',
  label: '구독중',
  meta: { from: '테스트', to: '구독중' },
})
// → uuid로 record 찾아 → POST /api/v1/records/:id/events
```

각 트리거에서 `matchStep` 갱신과 **함께** 호출:
```js
// 기존 유지
updateSendbRecord(host, { matchStep: '구독중', ... });
// 추가
appendRecordEvent(host, { type: 'match_stage', label: '구독중' });
```

→ 현재값(`matchStep`)은 그대로 갱신 + 이력(`record_events`)도 쌓임. 기존 동작 안 깨짐.

### 6.3 단계 이벤트 정의 (디하)

| 트리거 | 조건 | 이벤트 label |
|---|---|---|
| createProposal | status 'seek' | 신청완료 |
| createMatch / updateMatch | status 'test' | 테스트 |
| createMatch / updateMatch | status 'proceed' | 구독중 |
| updateMatch | status 'end' | 종료 |

→ 역행(구독→테스트)도 그냥 이벤트 한 줄 더 추가되는 거라 자동으로 기록됨.

### 6.4 동시성 — read-modify-write 회피

`record_events`는 INSERT만 하므로 — 디하 트리거가 동시에 여러 번 돌아도 안전 (배열 append처럼 기존 값을 읽을 필요 없음). 이게 JSONB 배열 대신 테이블을 택한 이유 중 하나.

---

## 7. 작업 범위 (체크리스트)

### sendb
- [ ] `record_events` 테이블 — 마이그레이션 SQL + schema.ts
- [ ] `POST /api/v1/records/:id/events` — 이벤트 추가 (토큰 인증, CORS)
- [ ] `GET /api/records/:id/events` — 이벤트 조회 (내부)
- [ ] (선택) record 상세 화면에 이벤트 타임라인 목록

### 디하 server
- [ ] `util/sendb.ts`에 `appendRecordEvent` 헬퍼
- [ ] `createProposal` 트리거 — 신청완료 이벤트
- [ ] `createMatch` 트리거 — 테스트/구독중 이벤트
- [ ] `updateMatch` 트리거 — 테스트/구독중/종료 이벤트

### 검증
- [ ] 디하에서 단계 변경 → record_events에 이력 쌓이는지
- [ ] 역행 케이스(구독→테스트) 이력 확인

---

## 8. Risks & Considerations

### 8.1 디하 server 배포 별개
sendb와 디하 server는 다른 레포/배포. **API(sendb)가 먼저 배포**돼야 디하 트리거가 호출 가능. 순서: sendb API 배포 → 디하 트리거 배포.

### 8.2 uuid로 record 못 찾는 경우
`appendRecordEvent`는 uuid로 record를 찾음(`findRecordByUuid`). 그 uuid의 record가 sendb에 없으면 이벤트 유실. → 현재 `updateSendbRecord`도 같은 한계. 회원가입(`sendSignupToSales`)이 record를 먼저 만드므로 보통 OK. 못 찾으면 조용히 skip (기존 동작과 동일).

### 8.3 이벤트 폭증
record_events는 계속 쌓이기만 함. 디하 단계 변경은 record당 몇 건 수준이라 문제 없음. 다만 향후 트래커 이벤트까지 합쳐 보면 — record_events는 "비즈니스 이벤트"만, 사이트 행동은 tracker_events에 그대로. 섞지 않음.

### 8.4 기존 데이터 — 소급 이력 없음
이미 "구독중"인 record들은 — record_events 도입 전이라 과거 이력이 없음. 도입 시점부터의 이벤트만 쌓임. 과거 소급은 안 함 (데이터 없음).

### 8.5 type/label 표기 일관성
범용이라 sendb가 검증 안 함 → 디하가 `'구독중'`/`'구독'` 섞어 쓰면 분석 시 혼란. → 디하 트리거에서 label 상수로 관리 (matchStepMap처럼).

---

## 9. Dependencies

- sendb: `records`, `api_tokens`(외부 인증), `/api/v1/records` 패턴
- 디하 server: `util/sendb.ts`, 트리거 3종
- 추가 라이브러리: 없음

---

## 10. Open Questions

### Q1. 회사 단위 묶기
디하는 회사당 담당자 여러 명, 매칭은 신청자(host) 1명 record에만 기록. 초대된 담당자 record엔 단계 이력 없음.
→ **이번엔 record(담당자) 단위로만.** 회사 단위 묶기는 여정 인텔리전스 Plan에서 다룸.

### Q2. record 상세 이벤트 타임라인 UI — 이번에 넣을지
이벤트 수집이 핵심이고 화면은 여정 인텔리전스 Plan 소관. 다만 검증용으로 **단순 목록**(시각+label) 정도는 이번에 넣는 게 디버깅에 좋음. → 단순 목록만, 시각화는 다음 Plan.

### Q3. 백오피스랩 이벤트 연동
백오피스랩 도입상담도 `type='consult'`로 이벤트 기록 가능. → 이번 범위 밖. 디하 검증 후 백오피스랩 `createLead`에도 추가.

---

## 11. Next Step

- [ ] Plan 검토
- [ ] `/pdca design record-events` — 마이그레이션 SQL, API 스펙, 디하 트리거 변경 상세, 작업 분해
- [ ] (이후) record_events 데이터 쌓인 뒤 → 고객 여정 인텔리전스 Plan 별도 작성
