# Report: visitor-multi-record

> **Date**: 2026-05-21
> **Feature**: 방문자-레코드 다중 연결 (Visitor Multi-Record Link)
> **Match Rate**: 98%
> **Status**: 완료 — 아카이빙

---

## 요약

한 방문자(tracker visitor)가 여러 파티션의 record를 거칠 때 연결이 끊기던 문제를 해결. `visitor_record_links` N:M 연결 테이블로 visitor가 거쳐간 모든 record를 누적 보존하고, journey API에서 파티션 경계를 넘어 통합 여정을 제공.

핵심 해결: 메일파티션 record A(클릭) + 회원가입 record B → 같은 visitor → 링크 2건 → journey 통합 타임라인.

---

## 구현 범위

### DB
- `drizzle/0050_visitor_record_links.sql` — CREATE TABLE + UNIQUE(visitor_id, record_id) + 인덱스 2개 + 백필 INSERT(source='backfill')
- `schema.ts` visitorRecordLinks + VisitorRecordLink 타입
- 기존 tracker_visitors.record_id 유지 — "현재 대표 record" 하위호환

### lib
- `src/lib/visitor-links.ts` — `linkVisitorRecord(orgId, visitorId, recordId, source)` 멱등 헬퍼
- onConflictDoNothing unique 충돌 무시

### API — collect
- click_id 매칭 시 링크 누적 (source="click_id") — 항상 시도
- 대표 record_id는 비었을 때만 set (기존 유지)
- site.orgId 활용

### API — identify
- matchField(신뢰) 매칭 → 링크 누적 + 대표 갱신
- email(신뢰) 매칭 → 링크 누적 + 대표 갱신
- phone fallback → 대표 record_id만 갱신, 링크 X (오연결 방지)
- trustMatchedRecordId 패턴으로 신뢰/비신뢰 구분

### API — journey merge 모드
- 기본: merge=visitor (통합), ?merge=none으로 단일 모드
- directVisitors (링크 경유) + repVisitors (tracker_visitors.record_id 직접) 합집합
- linked records (visitor → record 역조회)
- orgId 교차검증 (다른 org record 제외)
- 1-hop 제한 (재귀 없음)
- tracker visitorIds = record_id 직접 + 링크 합집합으로 tracker 이벤트 완전 수집

---

## 미구현 / 한계

없음. 모든 Design 항목 구현 완료.

의도적 설계 (Gap 아님):
- phone 링크 미누적 — 오연결 방지 (번호 공유 케이스)
- 디하 레포 sendSignupToSales 수정 — 별도 레포, sendb 범위 외

---

## 파일 목록

```
drizzle/0050_visitor_record_links.sql
src/lib/visitor-links.ts
src/app/api/tracker/collect/route.ts  (수정)
src/app/api/tracker/identify/route.ts  (수정)
src/app/api/records/[id]/journey/route.ts  (merge 모드 추가)
```

schema 추가:
- src/lib/db.ts (또는 schema.ts) — visitorRecordLinks

---

## 검증

- 로컬 실데이터 e2e 통과 (visitor 425, 캠페인record + 가입record 링크 통합)
- 메일발송 → 클릭 → 사이트 → 회원가입 전 플로우 journey 통합 확인
- tsc 통과
- 멱등성(upsert 중복 방지) 동작 확인
- phone 매칭 → 링크 미생성 확인
- 백필 후 기존 visitor 연결 보존 확인

---

## 후속 과제

- 링크 관계 관리 UI (잘못된 링크 수동 해제) — 운영 필요 시
- 2-hop 이상 체인 지원 — 현재 1-hop 제한, 극단적 케이스 발생 시
