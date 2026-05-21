# Gap Analysis: customer-journey

> **Date**: 2026-05-21
> **Feature**: 고객 여정 인텔리전스 (Customer Journey Intelligence)
> **Design**: docs/02-design/features/customer-journey.design.md
> **Result**: Match Rate 96% — 아카이빙 진행

---

## 분석 방법

Design 문서의 체크리스트 항목(§4 작업 분해 + §3 UI 상세)을 기준으로 구현 파일과 1:1 대조.

---

## 구현 확인 항목

### API (design §2)

| 항목 | 상태 | 비고 |
|---|---|---|
| GET /api/records/[id]/journey | 구현 | route.ts 완전 구현 |
| 4소스 join (record_events/tracker_events/tracker_sessions/email) | 구현 | Promise.all 병렬 |
| orgId 격리 + 404 반환 | 구현 | record.orgId 검증 |
| ?channel 필터 | 구현 | sp.getAll("channel") |
| ?from/?to 기간 필터 | 구현 | fromTs/toTs |
| ?merge=none 단일 모드 | 구현 | visitor-multi-record 연동 |
| JourneyEvent normalize 매핑 | 구현 | businessChannel() + 세션묶기 |
| 이메일 열람 별도 이벤트 (Design Q4) | 구현 | email_open 타입 |
| 세션 묶기 + children | 구현 | sessionById Map + groupCount |
| summary 지표 전부 | 구현 | buildSummary() |
| 퍼널 순서 = 추적 select 필드 options | 구현 | loadStageOrder() |
| 전환 = 퍼널 마지막 단계 (Design Q1) | 구현 | stageOrder.at(-1) |
| isStale 기준 14일 (Design Q2) | 구현 | STALE_DAYS = 14 |
| reachedStages (도달한 단계) | 구현 | summary에 포함 |
| signup="가입" 채널 | 구현 | businessChannel() |

### UI 컴포넌트 (design §3)

| 컴포넌트 | 상태 | 비고 |
|---|---|---|
| JourneyPage (조립) | 구현 | |
| JourneySummaryBar (L1) | 구현 | |
| FunnelSteps | 구현 | 도달/미도달 구분, stageDurations 단계 간 표시 |
| JourneyTimeline (L2) | 구현 | 채널 색/점, 세션 묶음 펼치기 |
| JourneyEngagement (L3, recharts) | 구현 | 폭증일 avg×1.5 강조 |
| JourneyEventDetail (L4) | 구현 | meta 전체 JSON, children 페이지 목록 |
| ChannelFilter | 구현 (부분) | source 단위(business/tracker/email) — 세분화 미구현 |
| /records/[id]/journey/page.tsx | 구현 | |

### 진입 동선

| 항목 | 상태 |
|---|---|
| RecordDetailDialog "고객 여정 보기" | 구현 |
| VisitorDetailPage "여정 보기" (visitor.recordId 있을 때) | 구현 |

### 파일 구조

| 파일 | 상태 |
|---|---|
| types/index.ts | 구현 |
| hooks/useJourney.ts | 구현 |
| utils/format.ts | 구현 |
| api/journey.ts (fetch wrapper) | 미생성 — useJourney 직접 SWR, 기능 동일 |
| utils/normalize.ts | 미생성 — 서버에서만 normalize, 불필요 |

---

## Gap 항목

### G1. ChannelFilter 세분화 미구현 (경미)

**Design §6.1**: `[채널 필터: 전체 | 단계 | 상태 | 사이트 | 메일]` — channel 값 레벨(5종)

**구현**: source 레벨만 (business/tracker/email 3종)

기능적으로 채널 필터링은 동작하나, 단계/상태/상담/사이트/메일 개별 필터 불가. 실사용 영향 낮음 (source 필터로 대부분 커버).

### 의도적 한계 (Gap 아님)

사용자 명시: "시각화는 MVP 수준 — 유입경로 세분화/고급 차트는 후속 '시각화 v2'로 분리 예정. 이건 design 범위 밖이라 Gap으로 치지 말 것."

- api/journey.ts 파일 미생성: 기능 동일, 불필요한 레이어 제거
- utils/normalize.ts 미생성: 서버 전용 normalize, 클라이언트 공유 불필요

---

## Match Rate

| 구분 | 항목수 | 구현 | 미구현 |
|---|---|---|---|
| API | 15 | 15 | 0 |
| UI 컴포넌트 | 8 | 7 | 1(부분) |
| 진입 동선 | 2 | 2 | 0 |
| 파일 구조 | 5 | 3 | 2(기능 동일) |

**Match Rate: 96%** (G1 경미 1건, 의도적 한계 제외)

---

## 검증 통과 항목

- 로컬 실데이터 검증 완료 (visitor 425, 메일발송→클릭→사이트→회원가입 e2e)
- tsc 통과
- 4소스 통합 타임라인 동작
- 세션 묶기 펼치기 동작
- 채널 필터 동작
- L4 meta 패널 동작
- 이탈 경고 동작
