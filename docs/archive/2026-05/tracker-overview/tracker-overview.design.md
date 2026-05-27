# Design: tracker-overview (트래커 사이트 분석 개요 탭)

> 작성일: 2026-05-26
> Phase: Design
> Plan: [tracker-overview.plan.md](../../01-plan/features/tracker-overview.plan.md)

## 1. 설계 개요

트래커 페이지 진입 시 **사이트 분석 개요**를 첫 화면으로. 탭 [**개요**(default) · 방문자 · 설정] + 밑줄형 스타일. 기간 필터(기본 30일) 기반 7개 KPI + 5개 위젯.

### Plan 결정 확정
- **전환율 = 리드 + 가입 둘 다 표시** → KPI 카드 7개
- **밑줄 탭 = 트래커 전용 변형** (전역 `tabs.tsx` 안 건드림)
- **multi-site = active 합산** (1차)
- **캐싱 없음** (1차)
- **차트 = recharts** (이미 사용)

## 2. 라우팅 & 페이지 구조

```
/tracker/page.tsx
  WorkspaceLayout
    PageContainer
      PageHeader  (제목/기간선택)
      TrackerTabs  ← 밑줄형 탭 컨테이너 (신규 격리 컴포넌트)
        [개요]    → OverviewTab (default)
        [방문자]  → VisitorListPage (기존)
        [설정]    → TrackerSettingsPanel (기존)
```

기존 `VisitorListPage` 내부의 탭(방문자/설정)을 **상위 페이지로 끌어올림**. 그래야 개요까지 3탭이 동일 레벨에서 동작.

## 3. 컴포넌트 설계

### 3-1. 신규
| 파일 | 역할 |
|------|------|
| `src/components/tracker/ui/TrackerTabs.tsx` | 밑줄형 탭 컨테이너 (트래커 전용 스타일) |
| `src/components/tracker/ui/OverviewTab.tsx` | 개요 탭 컴포지션 — 데이터 fetch + 위젯 배치 |
| `src/components/tracker/ui/widgets/KpiCards.tsx` | KPI 카드 7개 |
| `src/components/tracker/ui/widgets/DailyPageviewChart.tsx` | 일별 PV area chart |
| `src/components/tracker/ui/widgets/PopularPages.tsx` | 인기 페이지 TOP10 |
| `src/components/tracker/ui/widgets/RecentSessions.tsx` | 최근 방문 세션 |
| `src/components/tracker/ui/widgets/InflowChannels.tsx` | 유입 채널 분포 |
| `src/components/tracker/ui/widgets/DeviceBreakdown.tsx` | 디바이스/브라우저/OS 분포 |
| `src/components/tracker/ui/widgets/RangeSelector.tsx` | 기간 필터 (7/30/90/사용자지정) |
| `src/components/tracker/hooks/useTrackerOverview.ts` | SWR 훅 |
| `src/components/tracker/api/fetchTrackerOverview.ts` | API 호출 wrapper |
| `src/components/tracker/types/overview.ts` | OverviewResponse 타입 |
| `src/app/api/tracker/analytics/overview/route.ts` | **신규 API** — 모든 위젯 데이터 통합 응답 |

### 3-2. 변경
- `src/app/tracker/page.tsx` — TrackerTabs로 교체, 기간 state 보유
- `src/components/tracker/ui/VisitorListPage.tsx` — 내부 Tabs 제거, "방문자 목록" 본문만 남김
- `src/components/tracker/ui/TrackerSettingsPanel.tsx` — 그대로 (탭 콘텐츠로만 노출)

> 파일 200줄 제한 준수: OverviewTab은 위젯 컴포지션만, 각 위젯은 독립 파일.

## 4. 밑줄형 탭 스타일 (트래커 전용)

기존 `src/components/ui/tabs.tsx`(shadcn)를 **재사용**하되 className만 트래커에서 덮어쓰기. 별도 컴포넌트 안 만들고 TrackerTabs는 단순 래퍼.

```tsx
// TrackerTabs.tsx (요약)
<Tabs defaultValue="overview" className="space-y-4">
  <TabsList className="h-auto rounded-none border-b bg-transparent p-0">
    <TabsTrigger
      value="overview"
      className="rounded-none border-b-2 border-transparent bg-transparent px-4 py-2 font-medium
                 data-[state=active]:border-foreground data-[state=active]:bg-transparent
                 data-[state=active]:shadow-none"
    >개요</TabsTrigger>
    <TabsTrigger value="visitors" className="...">방문자</TabsTrigger>
    <TabsTrigger value="settings" className="...">설정</TabsTrigger>
  </TabsList>
  ...
</Tabs>
```
- shadcn Tabs 기본은 캡슐(rounded bg-muted). 위 className 오버라이드로 밑줄형 변환.
- 활성: 글자색 진하고 하단 2px 라인. 비활성: 회색.
- **전역 tabs.tsx 미변경** — 다른 페이지 영향 0.

## 5. 기간 필터

```ts
type RangePreset = "7d" | "30d" | "90d" | "custom";
type Range = { from: string; to: string }; // ISO date
```
- URL 쿼리에 `from`, `to`(YYYY-MM-DD) 보존 → 새로고침/공유 가능.
- 기본 `30d` = 오늘 기준 -30일 ~ 오늘. KST 자정 경계.
- 사용자 지정은 `Calendar`(shadcn) 두 개로 from/to. 1차는 preset만 + custom은 다음 단계도 OK 판단 → 1차는 **preset 4종** + custom은 다음.

> 1차 범위 좁히기: **preset 7/30/90 + 사용자지정**까지 다 넣되, custom UI 복잡하면 Do에서 preset 3종만 하고 custom은 next.

## 6. API: GET /api/tracker/analytics/overview

### 요청
```
GET /api/tracker/analytics/overview?from=2026-04-26&to=2026-05-26
Headers: 인증 (getUserFromNextRequest)
```
- 인자: `from`, `to` (YYYY-MM-DD, KST). 미지정 시 기본 30일.
- **워크스페이스/사이트 격리**: 사용자의 현재 워크스페이스의 active `tracker_sites` 모두 합산. (사용자 ws context는 기존 패턴 따라 — verifyAccess 동일)

### 응답 (스키마)
```ts
type OverviewResponse =
  | { success: true; data: OverviewData }
  | { success: false; error: string };

interface OverviewData {
    range: { from: string; to: string; presetDays: number | null };
    kpi: {
        visitors:    { value: number; deltaPct: number | null };
        sessions:    { value: number; deltaPct: number | null };
        pageviews:   { value: number; deltaPct: number | null };
        avgDwellSec: { value: number; deltaPct: number | null };
        bounceRate:  { value: number; deltaPct: number | null }; // 0~1
        leadRate:    { value: number; deltaPct: number | null }; // record 연결 비율
        signupRate:  { value: number; deltaPct: number | null }; // signup record_event 발생 비율
    };
    dailyPageviews: Array<{ date: string; count: number }>;   // YYYY-MM-DD
    popularPages:   Array<{ path: string; title: string | null; views: number }>; // top 10, utm 제거 경로
    recentSessions: Array<{
        id: number;
        visitorEmail: string | null;
        visitorAnonId: string;            // visitor_id (앞 8자)
        landingPath: string | null;       // utm 제거된 경로
        channel: string;                  // classifyInflow 결과
        pageCount: number;
        startedAt: string;
    }>; // 최근 20
    inflowChannels: Array<{ channel: string; sessions: number }>;
    devices: {
        types:    Array<{ name: string; count: number }>;   // desktop/mobile/tablet
        browsers: Array<{ name: string; count: number }>;   // Chrome/Safari/...
        oss:      Array<{ name: string; count: number }>;
    };
}
```

### 집계 쿼리 (요약)
같은 워크스페이스의 active site_id 목록을 먼저 구하고(`siteIds`), 모든 쿼리에 `inArray(site_id, siteIds)` + 기간 조건.

- **visitors**: `COUNT(DISTINCT id) FROM tracker_visitors WHERE site_id IN ... AND first_seen_at BETWEEN`  
  → 기간 내 신규 방문자. 또는 `last_seen_at`/`first_seen_at` 정책 결정 필요.
  - **결정: `first_seen_at` 기준** (=신규 방문자 수, GA의 New Users 개념).
- **sessions**: `COUNT(*) FROM tracker_sessions WHERE started_at BETWEEN`
- **pageviews**: `COUNT(*) FROM tracker_events WHERE event_type='PAGE_VIEW' AND occurred_at BETWEEN`
- **avgDwellSec**: `AVG(duration) FROM sessions WHERE duration > 0`
- **bounceRate**: `COUNT(*) FILTER (page_count=1) / COUNT(*) FROM sessions`
- **leadRate**: `COUNT(DISTINCT visitors.id) FILTER (record_id IS NOT NULL) / COUNT(*)`  
  ※ 기간 내 first_seen 한 visitor 기준.
- **signupRate**: 기간 내 visitor 중 그 record로 signup `record_events`가 있는 visitor 수 / 전체 visitor.  
  → 조인: visitor.record_id = record_events.record_id AND record_events.type='signup' AND record_events.occurred_at BETWEEN range.
- **dailyPageviews**: `events WHERE PAGE_VIEW GROUP BY occurred_at::date ORDER BY date`
- **popularPages**: `events WHERE PAGE_VIEW GROUP BY normalizePath(page_url) ORDER BY COUNT DESC LIMIT 10`  
  - normalizePath = url에서 `?` 이전만, host 제거.
- **recentSessions**: `sessions JOIN visitors ON visitor_id ORDER BY started_at DESC LIMIT 20` + 채널은 응답 직전 `classifyInflow(referrer, landing_page)` 계산.
- **inflowChannels**: sessions 각각 `classifyInflow` 후 GROUP BY in-memory (또는 SQL 분류 — JS 후처리가 단순).
- **devices**: `visitors GROUP BY device_type / browser / os`.
- **deltaPct**: 같은 길이의 직전 기간 (예: 30일 → 직전 30일)으로 동일 KPI 재계산 후 `((curr - prev) / prev) * 100`. prev=0이면 null.

전부 **단일 라우트에서 병렬 Promise.all**로 발행. 응답 1~3초 이내 목표 (운영 데이터 규모면 충분).

## 7. UI 위젯 명세

### 7-1. KpiCards (7개)
가로 7카드 (sm 이상). 1카드: 아이콘 + 라벨 + 큰 숫자 + 전기대비 ±%.
- 방문자 (Users) · 세션 (MousePointer) · 페이지뷰 (Eye) · 평균 체류 (Clock) · 바운스율 (CornerUpLeft) · **리드** (UserCheck) · **가입** (UserPlus)
- delta가 null → "—" 표시. 양수 녹색/음수 빨강.
- 평균 체류는 `formatDwell()`(이미 utils에 있음) 재사용.

### 7-2. DailyPageviewChart
recharts `AreaChart`. xAxis = date(M/D), yAxis = count. 빈 날은 0 채움 (range 전체 일자 enumerate). 높이 280.

### 7-3. PopularPages
`<ul>`. 행: `path` (path 모노스페이스) + 우측 `views` 수. utm 제거 경로. title은 `title=` 툴팁.

### 7-4. RecentSessions
table 또는 list. 컬럼: 방문자(이메일 or `익명 · xxxxxx`) / 채널 배지 / 랜딩 경로 / 페이지수 / 시간.
방문자 클릭 → `/tracker/visitors/{id}`.

### 7-5. InflowChannels
가로 막대. 채널별 색상 (광고/자연/직접/메일 톤). 0건 채널 숨김.

### 7-6. DeviceBreakdown
3 컬럼: 디바이스 도넛 / 브라우저 가로바 TOP5 / OS 가로바 TOP5.

### 7-7. RangeSelector
PageHeader 우측에 배치. 4개 칩 `7일 | 30일 | 90일 | 사용자지정`. 활성 강조. 사용자지정은 1차는 popover로 from/to 선택(가능하면).

## 8. SWR 훅 / 호출

```ts
// useTrackerOverview.ts
export function useTrackerOverview(range: Range) {
    const qs = new URLSearchParams({ from: range.from, to: range.to });
    const { data, isLoading, error } = useSWR<OverviewResponse>(
        `/api/tracker/analytics/overview?${qs}`,
        defaultFetcher,
    );
    return { data: data?.success ? data.data : null, isLoading, error };
}
```
- range 변경 시 key 변경 → 자동 재조회. SWR 기본 캐시(중복 호출 dedupe) 그대로 활용.

## 9. 엣지 케이스

| 케이스 | 처리 |
|--------|------|
| 사이트 없음(active 0개) | 모든 카운트 0, 빈 위젯에 "데이터 없음" |
| 기간 내 데이터 0 | 차트는 0선, KPI는 0, delta=null |
| 직전 기간 0 → curr 양수 | delta=null (∞ 회피) — UI에 "—" |
| 사용자 ws에 site_id 권한 다른 사이트 끼어들기 | siteIds 조회 시 ws/orgId 격리 |
| 기간이 자정 경계 안 맞음 | KST 자정 기준 from 00:00:00, to 23:59:59 변환 |

## 10. Definition of Done

- [ ] `/api/tracker/analytics/overview` 신규, 7 KPI + 5 위젯 데이터 모두 정확 (수동 SQL 대조 통과)
- [ ] 탭 [개요 · 방문자 · 설정] 밑줄형, 기본=개요, **전역 tabs.tsx 미변경**
- [ ] KPI 카드 7개 + 전기대비 ±% 동작 (직전 기간 0이면 "—")
- [ ] 기간 필터 7/30/90일 동작 (custom은 1차 빠질 수 있음, 가능하면 포함)
- [ ] 빈 데이터 상태 처리
- [ ] tsc 통과, 각 파일 200줄 이내
- [ ] gap-detector Match Rate ≥ 90%

## 11. 변경 파일 요약

**신규 (12)**:
- `src/app/api/tracker/analytics/overview/route.ts`
- `src/components/tracker/ui/TrackerTabs.tsx`
- `src/components/tracker/ui/OverviewTab.tsx`
- `src/components/tracker/ui/widgets/KpiCards.tsx`
- `src/components/tracker/ui/widgets/DailyPageviewChart.tsx`
- `src/components/tracker/ui/widgets/PopularPages.tsx`
- `src/components/tracker/ui/widgets/RecentSessions.tsx`
- `src/components/tracker/ui/widgets/InflowChannels.tsx`
- `src/components/tracker/ui/widgets/DeviceBreakdown.tsx`
- `src/components/tracker/ui/widgets/RangeSelector.tsx`
- `src/components/tracker/hooks/useTrackerOverview.ts`
- `src/components/tracker/api/fetchTrackerOverview.ts`
- `src/components/tracker/types/overview.ts`

**변경 (2)**:
- `src/app/tracker/page.tsx`
- `src/components/tracker/ui/VisitorListPage.tsx` (내부 Tabs 제거)

## 12. 리스크 / 주의

- **자정 경계**: KST 자정으로 from/to 변환 누락하면 ±1일 오차.
- **inflowChannel 분류**: JS에서 처리하면 큰 데이터 시 메모리. 1차 규모(sessions 1.5K)는 OK.
- **delta NULL 처리**: 분모 0일 때 NaN 흘러나가지 않게 가드.
- **밑줄 탭 className 오버라이드 누락**: shadcn의 `data-[state=active]` 스타일이 안 먹으면 캡슐로 보임 — Tailwind 4 임포트 순서 확인.
