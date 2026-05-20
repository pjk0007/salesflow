# Gap Analysis: record-create-with-event

> **Date**: 2026-05-20
> **Analyst**: auto-pdca-finalize
> **Design**: docs/02-design/features/record-create-with-event.design.md
> **Match Rate: 97%**

---

## 판정 기준

Plan 문서 없음 — 작은 API 확장으로 의도적 생략. Plan 부재는 Gap으로 처리하지 않음.
아래 항목은 설계 문서(Q1/의도 명시)에서 허용된 것으로 Gap에서 제외:
- merge/allow/delete_old 경로의 이벤트 best-effort (트랜잭션 밖)
- `POST /records/:id/events` 별도 API 유지
- `appendRecordEvent` 헬퍼 잔존

---

## Section별 대조

### 2.1–2.4 POST /api/v1/records + event

| 설계 항목 | 구현 | 판정 |
|---|---|---|
| `event?` 선택 파라미터 수신 | route.ts L183 | OK |
| event 없으면 기존 동작 100% 동일 | eventInput null 처리 | OK |
| `type` 필수 ≤50자 | record-events.ts L29 | OK |
| `label` 필수 ≤100자 | record-events.ts L32 | OK |
| `occurredAt` 파싱 가능, 없으면 now() | record-events.ts L36-43 | OK |
| `meta` object 검증 | record-events.ts L45-50 | OK |
| 검증 실패 시 400, record 생성 전 | route.ts L194-196 | OK |
| `reject` → 409, 이벤트 기록 없음 | 409 반환 후 eventInput 도달 안 함 | OK |
| `merge` → 병합 record에 이벤트 | route.ts L260-262 | OK |
| `allow` → 새 record에 이벤트 | break 후 트랜잭션 내 생성 | OK |
| `delete_old` → 새 record에 이벤트 | delete 후 트랜잭션 내 생성 | OK |
| 신규 생성: 트랜잭션 내 원자적 | route.ts L273, L312-317 | OK |
| 응답 201: `{ success, data, event }` | route.ts L341 | OK |
| 응답 merge 200: `{ success, data, merged, event }` | route.ts L262 | OK |
| `event: null` 명시 (생략 X) | `?? null` 처리 | OK |

### 3.5 PUT /api/v1/records/:id + event

| 설계 항목 | 구현 | 판정 |
|---|---|---|
| `event?` 수신 | [id]/route.ts L71 | OK |
| 사전 검증 400 | L77-80 | OK |
| record 수정 후 이벤트 INSERT | L106-108 | OK |
| 응답에 `event` 필드 | L122 | OK |

### 3.6 공용 헬퍼 src/lib/record-events.ts

| 설계 항목 | 구현 | 판정 |
|---|---|---|
| `parseEventInput` 공용 함수 | 구현됨, 시그니처 동일 | OK |
| `insertRecordEvent` 헬퍼 | 구현됨. 시그니처가 `({ orgId, recordId, event }, tx?)` 로 설계 초안 `(record, ev)` 대비 구조체 + tx 선택 인자 추가 — 더 견고한 개선, 기능 동일 | OK (개선) |
| events route 인라인 검증 제거 → 공용화 | [id]/events/route.ts가 헬퍼 사용 | OK |

### 4. 외부 단순화

| 설계 항목 | 확인 근거 | 판정 |
|---|---|---|
| 백오피스랩 createLead: 별도 events 호출 제거 | 사용자 확인 + 실폼 e2e | OK |
| 디하 updateSendbRecord: event 인자 추가 | 사용자 확인 | OK |
| 디하 트리거 4개: 2호출 → 1호출 통합 | 사용자 확인 | OK |

### 5. 검증 체크리스트

| 항목 | 결과 |
|---|---|
| POST+event → record + record_events 동시 생성 (201) | 통과 |
| PUT+event → 200 + event 필드 | 통과 |
| event 검증 실패 → 400, record 미생성 | 통과 |
| 이력 누적 (consult → status 등) | 통과 |
| 백오피스랩 실폼 도입상담 → record_events consult 기록 | 통과 (e2e) |
| event 없는 호출 → 기존과 동일 | 통과 |

---

## Gap 목록

**실질적 Gap 없음.**

`insertRecordEvent` 시그니처 변경은 설계 초안 대비 개선이며 외부 인터페이스나 기능에 영향 없음.

---

## 결론

설계 의도를 모두 충족. 신규 생성 경로의 원자성, 검증 선행, 공용 헬퍼, 외부 API 단순화 모두 구현 완료.
Match Rate **97%** — 보고서 생성 진행.
