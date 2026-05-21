# Plan: 방문자-레코드 다중 연결 (Visitor Multi-Record Link)

> **Summary**: 한 방문자(트래커 visitor)가 여러 record에 연결될 수 있게 한다. 지금은 `tracker_visitors.record_id`가 1:1이라 메일발송 파티션 record와 회원가입 파티션 record가 끊긴다. 연결 테이블(N:M)을 신설해 visitor가 거쳐간 모든 record를 잇고, 여정을 파티션 경계 넘어 통합한다.
>
> **Project**: Sendb (Salesflow)
> **Author**: jaehun
> **Date**: 2026-05-20
> **Status**: Draft
> **Related**: tracker, record-events, customer-journey (feat/customer-journey)

---

## 1. Overview

### 1.1 Purpose
**파티션 간 여정 끊김**을 해결한다. 현재 visitor는 record 하나만 가리켜(1:1), 같은 사람이 여러 파티션에 record가 있어도 그 중 하나만 연결된다.

### 1.2 문제 (확인된 구멍)
```
[메일발송 파티션 30]        [회원가입 파티션 14]
 record A                    record B
 - 메일 클릭                  - 회원가입
 - 사이트 방문                - 테스트→구독 전환
        └──── 연결 없음 ──────┘   (같은 사람인데 record 분리)
```
- 메일 클릭 시 collect가 visitor.record_id를 30번으로 set
- 회원가입 시 identify가 uuid로 14번 찾아 record_id를 14번으로 **덮어씀**
- → 30번과의 끈이 끊기고, "어떤 메일 → 회원가입 → 전환"을 추적 못 함

근본 원인: `tracker_visitors.record_id`가 **단일 컬럼(1:1)**.

### 1.3 핵심 결정 (N:M 연결 테이블)
- `visitor_record_links` 신설 — visitor ↔ record 다대다
- 기존 `tracker_visitors.record_id`는 **"현재 대표 record"**로 유지 (하위호환, 마지막 식별값)
- collect/identify가 record를 매칭할 때마다 **링크에 누적**(덮어쓰기 X, append/upsert)
- journey API는 visitor 기준으로 **연결된 모든 record의 이벤트를 통합**

### 1.4 왜 연결 테이블(A)인가
- 양방향 조회 필요: "이 visitor가 거쳐간 record들" + "이 record에 연결된 visitor들"
- record 1개에 visitor 여러 개(시크릿모드/기기 다름)도 가능 → 진짜 N:M
- 기존 record_id 컬럼은 안 건드려 하위호환

### 1.5 Related (set 지점)
- `src/app/api/tracker/collect/route.ts` L120-129 (click_id 매칭)
- `src/app/api/tracker/identify/route.ts` L71-121 (matchField/email/phone)
- `src/app/api/records/[id]/journey/route.ts` (여정 통합 — visitor 기준 확장)

---

## 2. Scope

### 2.1 In Scope
- [ ] `visitor_record_links` 테이블 신설 (visitor_id, record_id, org_id, linked_at, source)
- [ ] collect/identify가 record 매칭 시 링크 **upsert** (기존 record_id 덮어쓰기는 "대표"로만 유지)
- [ ] journey API: record 기준 → **visitor를 거쳐 연결된 모든 record의 이벤트 통합** 옵션
- [ ] 기존 visitor.record_id 데이터를 링크 테이블로 백필(마이그레이션)

### 2.2 Out of Scope
- ❌ 회사/사람(person) 단위 격상 — record 묶기는 visitor 경유로만
- ❌ record 수동 병합 UI
- ❌ 여정 시각화 변경 최소화 (API가 통합해주면 기존 UI 그대로)

### 2.3 핵심 시나리오 해결
메일파티션 record A + 회원가입 record B를 같은 visitor가 거치면 → 링크에 A,B 둘 다 → journey가 A+B 이벤트를 한 타임라인에.

---

## 3. Goals

### 3.1 Primary
1. visitor가 거쳐간 모든 record를 보존 (끊김 해소)
2. 파티션 경계를 넘어 한 사람의 여정 통합
3. "메일 캠페인 → 회원가입 → 전환" 퍼널 추적 가능

### 3.2 Success Criteria
- 메일파티션 record로 들어온 visitor가 회원가입(다른 파티션) → 두 record가 링크로 연결됨
- journey API(통합 모드)가 두 record의 이벤트를 시간순 한 타임라인으로 반환
- 기존 단일 record 여정은 그대로 동작 (회귀 없음)

---

## 4. 데이터 모델

### 4.1 `visitor_record_links` (신규)
```ts
visitorRecordLinks: {
  id            // PK
  orgId         // 격리
  visitorId     // FK tracker_visitors
  recordId      // FK records
  source        // 'click_id' | 'identify_match' | 'backfill' 등 (어떻게 연결됐나)
  linkedAt      // 연결 시각
}
```
- unique (visitorId, recordId) — 중복 링크 방지
- 인덱스: (visitorId), (recordId)

### 4.2 기존 `tracker_visitors.record_id`
- **유지**. "현재 대표 record"(가장 신뢰/최근 식별). 목록·요약 표시용.
- 링크 테이블은 "거쳐간 전체 이력".

### 4.3 백필
- 기존 visitor.record_id가 NOT NULL인 건 → visitor_record_links에 1건씩 INSERT (source='backfill')

---

## 5. 매칭 로직 변경

### 5.1 collect (click_id 매칭)
```
기존: visitor.recordId 비었을 때만 set
변경: 매칭되면 → 링크 upsert + (대표 record 비었으면 record_id도 set)
```

### 5.2 identify (matchField/email/phone)
```
기존: recordId 찾으면 visitor.record_id 덮어씀
변경: 찾으면 → 링크 upsert + 대표 record_id 갱신(현재값으로)
       기존 링크는 유지(누적)
```
- 대표 record_id는 "가장 최근 식별"로 갱신해도 됨(현재 상태 표시용). 링크엔 이력 다 남음.

### 5.3 멱등
- 같은 visitor+record 재매칭 → unique로 중복 안 생김 (upsert).

---

## 6. journey API 확장

### 6.1 통합 모드
`GET /api/records/:id/journey?merge=visitor` (또는 기본 통합):
```
1. record :id → 연결된 visitor들 (visitor_record_links WHERE record_id=:id)
2. 그 visitor들 → 연결된 모든 record (links WHERE visitor_id IN ...)
3. 그 record들의 record_events + email + 그 visitor들의 tracker_events 통합
4. 시간순 정렬
```
- 단일 record 모드도 유지(`?merge=none`).
- 기본값은 통합(merge=visitor)으로 — 끊김 없이 보는 게 목적.

### 6.2 권한
- 연결된 record/visitor 전부 같은 orgId 검증.

---

## 7. 작업 분해

### DB
- [ ] `visitor_record_links` 마이그레이션 + schema.ts
- [ ] 백필 SQL (기존 record_id → 링크)

### API
- [ ] collect — 링크 upsert
- [ ] identify — 링크 upsert + 대표 record_id 갱신
- [ ] journey — visitor 경유 통합 모드 (record들 합치기)
- [ ] 링크 upsert 공용 헬퍼 (lib)

### 검증 (로컬)
- [ ] 메일파티션 record로 collect → 링크 생성
- [ ] 같은 visitor가 identify(다른 파티션 record) → 링크 2개
- [ ] journey 통합 모드 → 두 record 이벤트 한 타임라인
- [ ] 기존 단일 record 여정 회귀 없음
- [ ] 백필 후 기존 visitor 연결 보존

---

## 8. Risks

### 8.1 여정 폭증/혼선
visitor가 record 여러 개 거치면 여정에 다 합쳐짐 → 의도(통합)지만, 다른 사람 record가 잘못 링크되면 오염. → 링크 생성은 click_id/matchField 같은 **신뢰 키**로만. phone fallback 링크는 신중(오연결 방지, identify 수정과 동일 원칙).

### 8.2 대표 record_id 의미
"현재 대표"를 뭐로 둘지 — 마지막 식별 vs 최초. 표시용이라 마지막으로. (링크에 이력 다 있으니 중요도 낮음)

### 8.3 기존 코드 영향
record_id 읽는 곳(목록/요약)은 그대로 동작(대표값 유지). 링크는 추가 기능이라 하위호환.

---

## 9. Open Questions

### Q1. journey 기본 모드 = 통합 vs 단일?
- 통합이 목적이나, record 상세에서 "이 record만" 보고 싶을 수도. → 기본 통합, `?merge=none` 옵션 제공.

### Q2. phone fallback도 링크에 누적?
- phone은 오연결 위험(번호 공유). matchField/click_id/email만 링크, phone은 대표 record_id만(이력 누적 X)? → design에서 확정.

### Q3. 백필 범위
- record_id 있는 visitor 전부 백필. 운영 95건 수준이라 가벼움.

---

## 10. Next Step
- [ ] Plan 검토 + Q1~Q3
- [ ] `/pdca design visitor-multi-record` — 테이블 SQL, upsert 헬퍼, journey 통합 쿼리, 백필
