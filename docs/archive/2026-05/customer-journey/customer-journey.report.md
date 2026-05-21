# Report: customer-journey

> **Date**: 2026-05-21
> **Feature**: 고객 여정 인텔리전스 (Customer Journey Intelligence)
> **Match Rate**: 96%
> **Status**: 완료 — 아카이빙

---

## 요약

record 1명의 전 채널 이벤트(비즈니스/사이트/메일)를 시간순으로 통합해 여정을 시각화하는 기능. L1(요약/퍼널) → L2(타임라인) → L3(관여도) → L4(상세) depth 위계로 "한눈에 + 전문가 지표"를 함께 제공.

---

## 구현 범위

### API
- `GET /api/records/[id]/journey` — 4소스(record_events + tracker_events + tracker_sessions + email) 통합, Promise.all 병렬, orgId 격리
- 세션 묶기: 같은 sessionId 페이지뷰를 세션 단위로 묶고 children으로 펼치기
- 이메일 발송/열람/클릭 개별 이벤트
- summary 지표: firstSeenAt, convertedAt, daysToConvert, currentStage, stages, reachedStages, stageDurations, firstChannel, channels, density(visits/emailSent/emailClicks/emailClickRate/avgDwellSec/sessions), inactivity, dailyActivity
- 퍼널 단계 순서: 추적 select 필드 options 순서 재사용 (별도 설정 UI 없음)
- 쿼리: ?channel(source 필터), ?from/?to(기간), ?merge=none(단일 모드)

### UI
- JourneySummaryBar (L1): 현재단계 뱃지, FunnelSteps 계단(도달/미도달), 핵심 지표 칩, 이탈 경고
- FunnelSteps: stages 순서대로, 단계 간 소요일(stageDurations) 표시
- JourneyTimeline (L2): 세로 타임라인, 채널별 색/점, 세션 묶음 펼치기(▾), 이벤트 클릭 → L4
- JourneyEngagement (L3): recharts BarChart, 폭증일(평균×1.5) orange 강조
- JourneyEventDetail (L4): 선택 이벤트 meta JSON + children 페이지 목록
- ChannelFilter: business/tracker/email source 단위 필터 칩

### 진입 동선
- RecordDetailDialog → "고객 여정 보기" → /records/:id/journey
- VisitorDetailPage → "여정 보기" (visitor.recordId 있을 때)

### 추가 구현 (design 범위 외)
- signup 채널 (type=signup → "가입", rose 색상) — visitor-multi-record e2e와 연계

---

## 미구현 / 한계

| 항목 | 분류 | 내용 |
|---|---|---|
| ChannelFilter 세분화 | 경미 Gap | Design에 단계/상태/상담/사이트/메일 개별 필터 명시, source 단위로 단순화 |
| api/journey.ts 파일 | 의도적 | useJourney에서 직접 SWR 호출, 불필요한 중간 레이어 제거 |
| utils/normalize.ts | 의도적 | 서버 전용 normalize, 클라이언트 공유 필요 없음 |
| 시각화 고도화 | 의도적 | MVP 수준 — 유입경로 세분화/고급 차트는 후속 "시각화 v2"로 분리 |

---

## 파일 목록

```
src/app/api/records/[id]/journey/route.ts
src/app/records/[id]/journey/page.tsx
src/components/journey/
├── ui/JourneyPage.tsx
├── ui/JourneySummaryBar.tsx
├── ui/FunnelSteps.tsx
├── ui/JourneyTimeline.tsx
├── ui/JourneyEngagement.tsx
├── ui/JourneyEventDetail.tsx
├── ui/ChannelFilter.tsx
├── hooks/useJourney.ts
├── types/index.ts
└── utils/format.ts
```

진입 동선 수정:
- src/components/records/RecordDetailDialog.tsx
- src/components/tracker/ui/VisitorDetailPage.tsx

---

## 검증

- 로컬 실데이터 e2e 통과 (visitor 425, 메일→클릭→사이트→회원가입 플로우)
- tsc 통과
- 4소스 통합 타임라인, 세션 묶기, 채널 필터, L4 패널, 이탈 경고 동작 확인

---

## 후속 과제

- ChannelFilter 세분화 (단계/상태/상담 개별 필터) — 사용 시 니즈 확인 후
- 시각화 v2 — 유입경로 세분화, 고급 차트
- isStale 기준일 설정화 (현재 하드코딩 14일)
- 전환 단계 커스텀 설정
