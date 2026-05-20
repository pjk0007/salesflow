# Report: record-create-with-event

> **Date**: 2026-05-20
> **Author**: jaehun
> **Status**: Done
> **Match Rate**: 97%

---

## 요약

`POST /api/v1/records`와 `PUT /api/v1/records/:id`에 선택적 `event` 파라미터를 추가해 외부 고객사가 **1회 호출로 record 작업 + 비즈니스 이벤트 기록**을 동시에 처리할 수 있도록 API를 확장했다.

기존 2회 왕복(record → events) 패턴을 제거하고, 신규 생성 경로는 트랜잭션 내 원자적으로 record + event를 함께 저장한다.

---

## 변경 범위

### sendb (salesflow)

| 파일 | 변경 내용 |
|---|---|
| `src/lib/record-events.ts` | 신규. `parseEventInput` + `insertRecordEvent` 공용 헬퍼. POST/PUT/events 3개 route 공용. |
| `src/app/api/v1/records/route.ts` | handlePost에 event 사전 검증 + 분기별 이벤트 INSERT. 신규 생성은 트랜잭션 내 원자적. 응답에 `event` 필드 추가. |
| `src/app/api/v1/records/[id]/route.ts` | PUT에 event 사전 검증 + 수정 후 이벤트 INSERT. 응답에 `event` 필드 추가. |
| `src/app/api/v1/records/[id]/events/route.ts` | 인라인 검증 제거 → 공용 헬퍼로 리팩터. 기능 동일. |

### 외부 레포 (back-office-lab, designer-hire-server)

| 레포 | 변경 내용 |
|---|---|
| back-office-lab `src/api/createLead.ts` | 별도 events 호출 제거. POST body에 `event` 포함 (1회 호출). |
| designer-hire-server `src/util/sendb.ts` | `updateSendbRecord`에 선택적 event 인자 추가. |
| designer-hire-server 트리거 4개 | `updateSendbRecord + appendRecordEvent` 2호출 → `updateSendbRecord(..., event)` 1호출. |

---

## 핵심 설계 결정

1. **신규 생성만 원자적**: 트랜잭션 내 record + event 동시 INSERT. merge/allow/delete_old는 트랜잭션 밖 best-effort (Q1에서 허용).
2. **사전 검증(400 우선)**: record 생성 전에 event 유효성 검증. record만 생기고 이벤트 실패하는 케이스 방지.
3. **별도 events API 유지**: `POST /records/:id/events`는 data 변경 없이 이벤트만 추가하는 특수 케이스용으로 존속.
4. **공용 헬퍼**: `insertRecordEvent`는 tx 선택 인자를 받아 트랜잭션 안팎에서 동일하게 사용.

---

## 검증 결과

| 시나리오 | 결과 |
|---|---|
| POST+event → 201, record + event 동시 생성 | 통과 |
| PUT+event → 200, event 필드 포함 | 통과 |
| event 검증 실패 → 400, record 미생성 | 통과 |
| merge 케이스 → 기존 record에 이벤트 누적 | 통과 |
| 백오피스랩 실폼 도입상담 e2e → consult 기록 확인 | 통과 |
| event 없는 호출 → 기존 동작 유지 | 통과 |
| 3개 레포 tsc/build | 통과 |

---

## 관련 문서

- Design: `docs/02-design/features/record-create-with-event.design.md`
- Analysis: `docs/03-analysis/features/record-create-with-event.analysis.md`
- 이전 기반 기능: `docs/archive/2026-05/record-events/`
