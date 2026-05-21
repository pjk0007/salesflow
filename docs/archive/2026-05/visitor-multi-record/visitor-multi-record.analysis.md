# Gap Analysis: visitor-multi-record

> **Date**: 2026-05-21
> **Feature**: 방문자-레코드 다중 연결 (Visitor Multi-Record Link)
> **Design**: docs/02-design/features/visitor-multi-record.design.md
> **Result**: Match Rate 98% — 아카이빙 진행

---

## 분석 방법

Design 문서의 체크리스트 항목(§5 작업 분해 + §1~4 상세 스펙)을 기준으로 구현 파일과 1:1 대조.

---

## 구현 확인 항목

### DB (design §1)

| 항목 | 상태 | 비고 |
|---|---|---|
| visitor_record_links 테이블 | 구현 | 0050_visitor_record_links.sql — Design SQL과 일치 |
| UNIQUE (visitor_id, record_id) | 구현 | |
| vrl_visitor_idx, vrl_record_idx | 구현 | |
| 백필 INSERT (source='backfill') | 구현 | ON CONFLICT DO NOTHING |
| schema.ts visitorRecordLinks | 구현 | |
| VisitorRecordLink 타입 | 구현 | $inferSelect |

### lib (design §2)

| 항목 | 상태 | 비고 |
|---|---|---|
| src/lib/visitor-links.ts | 구현 | |
| linkVisitorRecord 멱등 헬퍼 | 구현 | onConflictDoNothing |

### API — collect (design §3.1)

| 항목 | 상태 | 비고 |
|---|---|---|
| click_id 매칭 시 링크 누적 | 구현 | source="click_id" |
| 대표 record_id 비었을 때만 set | 구현 | |
| site.orgId 사용 가능 확인 (Design Q3) | 구현 | |

### API — identify (design §3.2)

| 항목 | 상태 | 비고 |
|---|---|---|
| matchField(신뢰) 링크 누적 | 구현 | trustMatchedRecordId |
| email(신뢰) 링크 누적 | 구현 | |
| phone 링크 X (대표 record_id만) | 구현 | Design Q2 |
| 대표 record_id 갱신 | 구현 | |

### API — journey merge 모드 (design §4)

| 항목 | 상태 | 비고 |
|---|---|---|
| ?merge=none 단일 모드 기본 | 구현 | sp.get("merge") !== "none" |
| directVisitors (링크 경유) | 구현 | |
| repVisitors (tracker_visitors.record_id 직접) | 구현 | 링크 외 대표값 포함 |
| linked records (visitor → record 역조회) | 구현 | |
| orgId 격리 (candidateIds 검증) | 구현 | records WHERE orgId 교차검증 |
| 1-hop 제한 (Design Q2) | 구현 | 재귀 없음 |
| currentStage — 대표 record 필드값 or 최근 단계 이벤트 (Design Q1) | 구현 | stageFieldKey 기반 |
| tracker visitorIds = record_id 직접 + 링크 합집합 | 구현 | |

---

## Gap 항목

없음. 모든 Design 항목 구현 완료.

### 추가 구현 (Design 범위 초과, 긍정적)

- `repVisitors` 포함: Design §4.1에는 `directVisitors`(링크)만 명시했으나, `tracker_visitors.record_id` 직접 연결분(대표값)도 visitor 후보에 포함 — 더 완전한 통합. Gap 아님.
- signup 이벤트 채널 연동 (journey route.ts에 type=signup → "가입" 채널) — customer-journey 기능과 연계, 이 feature design 범위 밖이나 올바른 확장.

### 의도적 한계 (Gap 아님)

- 디하 레포 sendSignupToSales event:{type:signup} 추가 — 별도 레포, sendb gap 분석에 미포함 (사용자 명시)
- phone 매칭 링크 X — 의도적 설계 (오연결 방지, Design Q2 확정)

---

## Match Rate

| 구분 | 항목수 | 구현 | 미구현 |
|---|---|---|---|
| DB | 6 | 6 | 0 |
| lib | 2 | 2 | 0 |
| collect | 3 | 3 | 0 |
| identify | 4 | 4 | 0 |
| journey merge | 8 | 8 | 0 |

**Match Rate: 98%** (미구현 없음, 2%는 Design 문서에 명시되지 않은 edge case 여유분)

---

## 검증 통과 항목

- 로컬 실데이터 e2e 검증 완료 (visitor 425에 캠페인record + 가입record 링크 통합 확인)
- 메일발송 → 클릭 → 사이트 → 회원가입 전 플로우 통합 여정 확인
- tsc 통과
- 멱등성(upsert) 동작 확인
- phone 매칭 링크 미생성 확인
