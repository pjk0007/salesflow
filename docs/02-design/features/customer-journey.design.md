# Design: 고객 여정 인텔리전스 (Customer Journey Intelligence)

> **Plan**: `docs/01-plan/features/customer-journey.plan.md`
> **Project**: Sendb (Salesflow)
> **Author**: jaehun
> **Date**: 2026-05-20
> **Status**: Draft

---

## 0. 확정 결정 (Plan 반영)
- 퍼널 단계 순서: **사용자 지정** — 추적 select 필드 옵션 순서를 퍼널 순서로 (Q1-A)
- 사이트 방문: **세션 단위로 묶고 펼치기** (Q2-B)
- 진입: **record 상세 메인** + 트래커 visitor 상세 보조 (Q3)
- 지표: 전부 — 단계별 소요시간/전환소요일/첫유입/활동밀도/이탈경고/현재단계/일별활동(폭증강조)
- 신규 테이블 없음 — 조회 시점 normalize

---

## 1. 데이터 소스 & join (이미 존재하는 컬럼)

| 소스 | 시각 컬럼 | record 연결 | 가져올 필드 |
|---|---|---|---|
| `record_events` | occurredAt | record_id (FK) | type, label, meta |
| `tracker_events` | occurredAt | visitor.record_id → visitor_id | eventType, eventName, pageUrl, pageTitle, properties, sessionId |
| `tracker_sessions` | startedAt | visitor_id | sessionKey, duration, landingPage, referrer (세션 묶기/유입경로) |
| `email_send_logs` | sentAt, openedAt | record_id | subject, status, isOpened |
| `email_click_logs` | clickedAt | send_log_id → record_id | url |

### join 경로 (API)
```
record(:id)
 ├─ record_events       WHERE record_id = :id
 ├─ tracker_visitors    WHERE record_id = :id  → visitorIds
 │    ├─ tracker_events    WHERE visitor_id IN (visitorIds)
 │    └─ tracker_sessions  WHERE visitor_id IN (visitorIds)
 └─ email_send_logs     WHERE record_id = :id
      └─ email_click_logs WHERE send_log_id IN (sendLogIds)
```
> 전부 orgId 격리. tracker/email join 시 record.orgId 재확인.

---

## 2. API — `GET /api/records/[id]/journey`

**파일**: `src/app/api/records/[id]/journey/route.ts` (신규)
인증: `getUserFromNextRequest` + `record.orgId === user.orgId` (404 격리)

### 2.1 쿼리 옵션
- `?channel=business|tracker|email` (필터, 복수 가능)
- `?from=&to=` (기간, ISO)

### 2.2 처리
```
1. record 조회 + orgId 검증
2. 4개 소스 병렬 조회 (Promise.all)
3. 각각 JourneyEvent로 normalize (§2.3)
4. tracker 페이지뷰는 sessionId로 그룹 → 세션 묶음 이벤트 + children
5. 시각순 정렬
6. summary 지표 계산 (§2.4)
7. 응답
```

### 2.3 JourneyEvent normalize
```ts
interface JourneyEvent {
  at: string;                 // ISO
  source: 'business' | 'tracker' | 'email';
  channel: '단계' | '상태' | '상담' | '사이트' | '메일' | string;
  type: string;
  label: string;
  meta: Record<string, unknown>;
  // 세션 묶음일 때
  children?: JourneyEvent[];  // 세션 내 페이지뷰들
  groupCount?: number;        // 묶인 개수
}
```

매핑 규칙:
| 원천 | source | channel | label | meta |
|---|---|---|---|---|
| record_events type=match_stage | business | 단계 | label | {from,to} |
| record_events type=status | business | 상태 | label | {from,to,by} |
| record_events type=consult | business | 상담 | label | {source} |
| record_events 기타 | business | type | label | meta 그대로 |
| tracker_session (묶음) | tracker | 사이트 | "사이트 방문 N페이지" | {duration,landingPage,referrer}, children=페이지뷰 |
| tracker_event (세션 없는 단건) | tracker | 사이트 | pageTitle ?? pageUrl | {pageUrl,duration} |
| email_send_logs | email | 메일 | "메일 발송: {subject}" | {subject,status,isOpened} |
| email_send_logs.openedAt | email | 메일 | "메일 열람" | {subject} (openedAt 있을 때 별도 이벤트) |
| email_click_logs | email | 메일 | "메일 링크 클릭" | {url} |

### 2.4 summary 지표 계산
```ts
interface JourneySummary {
  firstSeenAt: string | null;
  convertedAt: string | null;        // 전환 단계 도달 시각 (구독중 등 — design Q1)
  daysToConvert: number | null;
  totalEvents: number;
  currentStage: string | null;       // record의 추적 필드 현재값
  stages: string[];                  // 정의된 퍼널 순서 (도달한 단계 표시용)
  stageDurations: { from: string; to: string; days: number }[];
  firstChannel: string | null;       // 가장 이른 이벤트의 channel
  channels: Record<string, number>;  // source별 카운트
  density: {
    visits: number; emailSent: number; emailClicks: number;
    emailClickRate: number; avgDwellSec: number; sessions: number;
  };
  inactivity: { lastActiveAt: string | null; daysSince: number; isStale: boolean };  // isStale: daysSince>=14 (기준 design Q2)
  dailyActivity: { date: string; count: number }[];
}
```
- **stageDurations**: 단계 이벤트(business의 단계/상담/상태)만 추려 인접 전이 간 일수
- **firstChannel**: events[0].channel
- **density.avgDwellSec**: tracker_sessions.duration 평균
- **inactivity.daysSince**: now - max(at)
- **dailyActivity**: at의 날짜별 group count

### 2.5 퍼널 단계 순서 소스
- 추적 켠 select 필드(field_definitions where track_history=1, fieldType=select)의 `options` 배열 순서 = 퍼널 순서
- record의 partition → resolvedTypeId → 그 필드의 options
- 디하 match_stage처럼 select 아닌 단계는 등장 순서 폴백 (design Q3)

---

## 3. UI

### 3.1 페이지 — `src/app/records/[id]/journey/page.tsx` (신규 라우트)
조립만. 로직은 컴포넌트/훅.

### 3.2 컴포넌트 (feature 구조)
```
src/components/journey/
├── ui/
│   ├── JourneyPage.tsx          # 조립 (요약+타임라인+관여도)
│   ├── JourneySummaryBar.tsx    # L1: 현재단계 뱃지, 퍼널 계단, 지표들, 이탈 경고
│   ├── FunnelSteps.tsx          # 퍼널 계단 (도달/미도달)
│   ├── JourneyTimeline.tsx      # L2: 시간순, 채널 색/아이콘, 세션 묶음 펼치기
│   ├── JourneyEngagement.tsx    # L3: recharts 일별 활동량 (폭증일 강조)
│   ├── JourneyEventDetail.tsx   # L4: 이벤트 클릭 시 meta 패널
│   └── ChannelFilter.tsx        # 채널 필터 칩
├── hooks/
│   └── useJourney.ts            # SWR
├── api/
│   └── journey.ts               # fetch wrapper
├── types/
│   └── index.ts                 # JourneyEvent, JourneySummary
└── utils/
    └── format.ts                # 체류시간/일수/클릭률 표시 포맷
```

### 3.3 L1 JourneySummaryBar
- 현재 단계 뱃지 (currentStage)
- FunnelSteps: stages를 계단으로, 도달 단계 강조 + stageDurations를 단계 사이에 "2일"
- 지표 칩: 전환 N일 · 첫유입 메일 · 방문 12 · 클릭 2/3(67%) · 평균체류 1:35 · 세션 4
- 이탈: isStale면 `⚠ N일째 무활동` 빨강

### 3.4 L2 JourneyTimeline
- 세로 타임라인. 각 이벤트: 시각 + 채널 아이콘/색 + label
- 채널 색: 단계(굵게/강조), 상태, 상담, 사이트, 메일 각각 구분
- 세션 묶음: "사이트 방문 6페이지 ▾" → 펼치면 children 페이지뷰 목록
- 이벤트 클릭 → L4 패널

### 3.5 L3 JourneyEngagement (recharts)
- BarChart: dailyActivity (x=날짜, y=count)
- 폭증일(평균 대비 높은 날) 막대 색 강조 + 수치 라벨
- 접기/펼치기

### 3.6 L4 JourneyEventDetail
- 사이드/하단 패널. 선택 이벤트의 meta 전체 (from/to, pageUrl, url, duration, by 등)
- 평소 숨김 → 클릭 시 노출 (노이즈 방지, 전문가용)

### 3.7 진입 동선
- `RecordDetailDialog`에 "여정 보기" 버튼 → `/records/:id/journey`
- 트래커 visitor 상세(VisitorDetailPage)에 "여정 보기" 링크 (visitor.recordId 있을 때)

---

## 4. 작업 분해 (Plan §7 + 상세)

### Phase 0 — 단계 순서
- [ ] journey API에서 추적 select 필드 options를 퍼널 순서로 로드

### Phase 1 — API + L1 + L2
- [ ] `GET /api/records/[id]/journey` (4소스 join + normalize + 세션 묶기 + summary)
- [ ] journey types
- [ ] useJourney 훅 + journey api + format utils
- [ ] `/records/[id]/journey` 라우트 + JourneyPage
- [ ] JourneySummaryBar + FunnelSteps (현재단계/계단/지표/이탈)
- [ ] JourneyTimeline (채널색/아이콘 + 세션 묶음 펼치기)
- [ ] 진입: RecordDetailDialog 버튼 + VisitorDetailPage 링크

### Phase 2 — 관여도 + 필터
- [ ] JourneyEngagement (recharts, 폭증일 강조)
- [ ] ChannelFilter (business/tracker/email + 단계/상태/상담/사이트/메일)

### Phase 3 — 상세 + 지표 + 기간
- [ ] JourneyEventDetail (L4 meta 패널)
- [ ] summary 지표 전부 노출 (소요시간/전환/첫유입/밀도/이탈/현재단계)
- [ ] 기간 필터 (from/to)

### 검증 (로컬 복원본)
- [ ] 디하 #148374(노트킹) 여정 — 단계 계단 + 사이트/메일 시간순
- [ ] #159755 (consult + status) 여정
- [ ] 채널 필터 / 세션 묶기 펼치기
- [ ] tracker_events 많은 record 성능
- [ ] 이벤트 클릭 → meta
- [ ] 빈 record(활동 없음) 빈 상태 UI
- [ ] tsc 통과

---

## 5. 성능 / 주의
- tracker_events 대량 → 세션 묶기로 타임라인 항목 수 축소. API에서 session join으로 그룹.
- 4소스 병렬 조회(Promise.all). 인덱스: record_events(record_id,occurred_at), tracker_events(visitor,occurred), email은 send_log/record 인덱스 존재.
- orgId 격리: tracker_visitors/email_send_logs도 record.orgId로 교차검증.

---

## 6. Open Questions (Design)
- **Q1.** "전환" 기준 단계를 뭘로? (구독중=전환? 조직마다 다름) → 최초엔 퍼널 마지막 단계 도달=전환, 또는 설정값. design 진행 중 단순화: 마지막 단계 직전까지 도달 여부.
- **Q2.** isStale 기준 일수 (14일?) → 기본 14일, 후속 설정화.
- **Q3.** select 아닌 단계(디하 match_stage)는 순서 어떻게? → 등장 순서 폴백. 명시 순서는 후속.
- **Q4.** email "열람"을 별도 이벤트로 vs 발송 이벤트 meta로 → 별도 이벤트(타임라인에 열람 시점 표시가 유용).
