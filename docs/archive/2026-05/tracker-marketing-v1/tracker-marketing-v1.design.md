# Design: tracker-marketing-v1 (Phase 1)

> 작성일: 2026-05-27
> Phase: Design
> Plan: [tracker-marketing-v1.plan.md](../../01-plan/features/tracker-marketing-v1.plan.md)
> 로드맵: [tracker-marketing-roadmap.plan.md](../../01-plan/features/tracker-marketing-roadmap.plan.md)

## 1. 설계 개요

트래커 개요 탭에 4가지 마케팅 분석을 추가:
1. **이탈 페이지 TOP10** (bounce 제외)
2. **세그먼트 필터** — 모든 위젯에 일괄 적용
3. **사용자 지정 기간 + URL 보존** (from/to만)
4. **광고 소재 TOP** — 소재명 / 세션수 / 리드율

기존 `/api/tracker/analytics/overview` API를 확장 (단일 통합 엔드포인트 유지).

### Plan 결정 확정
- ✅ 이탈 페이지: **bounce 제외** (광고 도착자 빠지고 진짜 누수만)
- ✅ 세그먼트 필터: **모든 위젯에 일괄 적용**
- ✅ URL sync: **기간(from/to)만** (필터는 화면 state)
- ✅ DateRangePicker: **`src/components/ui/` 공용**
- ✅ 광고 소재: **소재명 + 세션수 + 리드율**

## 2. API 확장

### 2-1. 요청 (추가 인자)
```
GET /api/tracker/analytics/overview
  ?siteId=1
  &from=2026-04-28&to=2026-05-27
  &device=desktop|mobile|tablet           (선택)
  &channel=직접|네이버|구글검색|...        (선택, classifyInflow 결과 라벨)
```

### 2-2. 응답 (필드 추가)
`OverviewData`에:
```ts
interface OverviewData {
    // 기존 필드 ...
    range: { from: string; to: string };
    kpi: { ... };
    dailyPageviews: [...];
    popularPages: [...];
    recentSessions: [...];
    inflowChannels: [...];
    devices: { ... };

    // 신규
    exitPages: Array<{ path: string; title: string | null; exits: number }>;  // 2페이지+ 세션의 이탈
    adContents: Array<{ content: string; sessions: number; leads: number; leadRate: number }>;  // utm_content TOP
}
```

### 2-3. 집계 쿼리

**모든 쿼리에 세그먼트 필터 일괄 적용**:
- `device`가 있으면 visitor 단계에 `tv.device_type = device` 추가
- `channel`이 있으면 session 단계에 classifyInflow가 일치하는 세션만 남기는데, 이건 JS 후처리라 SQL에 못 넣음 → **세션 ID 사전 추출** 후 모든 쿼리에 `session_id IN (...)` 추가
  - 1단계: `sessions` 전체 조회 → JS에서 classifyInflow 통과 ID만 추출
  - 2단계: 그 ID 목록을 다른 쿼리에 IN 절로
  - 운영 규모(sessions 1.9K)에선 충분히 OK
- `device + channel` 결합 시 둘 다 적용 (AND)

**이탈 페이지 (신규)**:
```sql
WITH sess_pv_count AS (
    -- 의미있는 PV 수 (excludePaths 외)
    SELECT ts.id AS session_id, COUNT(ev.id) AS pv_count,
           (ARRAY_AGG(ev.page_url ORDER BY ev.occurred_at DESC))[1] AS last_pv_url,
           (ARRAY_AGG(ev.page_title ORDER BY ev.occurred_at DESC))[1] AS last_pv_title
    FROM tracker_sessions ts
    LEFT JOIN tracker_events ev ON ev.session_id = ts.id
        AND ev.event_type = 'PAGE_VIEW'
        AND ev.occurred_at BETWEEN :from AND :to
        AND ${notExcludedExpr(excludes)}
    WHERE ts.site_id = :siteId AND ts.started_at BETWEEN :from AND :to
      AND ts.id = ANY(:filteredSessionIds)
    GROUP BY ts.id
)
SELECT
    regexp_replace(split_part(COALESCE(ts.exit_page, last_pv_url), '?', 1), '^https?://[^/]+', '') AS path,
    last_pv_title AS title,
    COUNT(*)::int AS exits
FROM sess_pv_count
JOIN tracker_sessions ts ON ts.id = session_id
WHERE pv_count >= 2  -- bounce 제외
GROUP BY 1, 2
ORDER BY exits DESC
LIMIT 10
```

> **exit_page fallback**: `exit_page` NULL이면 마지막 PAGE_VIEW URL을 쓴다. SESSION_END 이벤트 누락된 26% 세션 회수.

**광고 소재 (신규)**:
```sql
SELECT
    ts.utm_content AS content,
    COUNT(DISTINCT ts.id)::int AS sessions,
    COUNT(DISTINCT ts.visitor_id) FILTER (WHERE tv.record_id IS NOT NULL)::int AS leads
FROM tracker_sessions ts
JOIN tracker_visitors tv ON tv.id = ts.visitor_id
WHERE ts.site_id = :siteId
  AND ts.started_at BETWEEN :from AND :to
  AND ts.utm_content IS NOT NULL AND ts.utm_content <> ''
  AND ts.id = ANY(:filteredSessionIds)
GROUP BY 1
ORDER BY sessions DESC
LIMIT 10
```
leadRate는 응답 직전 JS에서 `leads / sessions * 100`.

### 2-4. classifyInflow가 SQL 외 처리
- **이슈**: classifyInflow는 JS 함수. 채널 필터링이 SQL에 못 들어감.
- **해결**:
  1. 채널 필터 있을 때만 추가 쿼리 1회 — `SELECT id, referrer, landing_page FROM tracker_sessions WHERE site_id AND started_at BETWEEN`
  2. JS에서 classifyInflow 적용 → 매칭 세션 ID만 추출 (`filteredSessionIds`)
  3. 이후 모든 쿼리에 `id IN (filteredSessionIds)` 또는 `session_id IN ...`
- 채널 필터 없으면 이 단계 스킵 (성능 동일)

## 3. UI 명세

### 3-1. OverviewTab 상단 컨트롤바
```
┌──────────────────────────────────────────────────────────┐
│ [기간 ▼] [디바이스 ▼] [채널 ▼]      [7일 30일 90일 사용자] │
│  활성: 모바일 ×                                            │
└──────────────────────────────────────────────────────────┘
```
- 좌측: 세그먼트 필터 드롭다운 2개 (디바이스, 채널)
- 우측: 기존 RangeSelector + 신규 "사용자지정" 옵션
- 활성 필터 있으면 칩으로 한 줄 아래 표시 + X 버튼

### 3-2. RangeSelector 확장
- 기존 preset 3종(7일 / 30일 / 90일) 유지
- **"사용자지정" 버튼 추가** — 클릭 시 popover에 DateRangePicker
- 사용자지정 선택 시 preset 비활성, 선택 결과 라벨에 `2026-04-28 ~ 2026-05-27` 표기

### 3-3. DateRangePicker (`src/components/ui/date-range-picker.tsx`, 공용 신규)
```tsx
<DateRangePicker
    from={Date | undefined}
    to={Date | undefined}
    onChange={({ from, to }) => ...}
    maxDate={today}
/>
```
- Popover 안에 Calendar 2개 (좌=from / 우=to). 모바일은 세로 스택.
- Apply 버튼으로 확정 (실시간 적용 X — 둘 다 골라야 의미 있음).
- 미래 날짜 비활성.

### 3-4. SegmentFilter (`src/components/tracker/ui/widgets/SegmentFilter.tsx`, 신규)
```tsx
<SegmentFilter
    device={device}
    channel={channel}
    deviceOptions={["desktop","mobile","tablet"]}
    channelOptions={["직접","네이버","구글 검색","구글 검색광고","메타 광고","메일","기타"]}
    onChange={(next) => setFilters(next)}
/>
```
- 드롭다운 2개 + 활성 칩.
- 채널 옵션은 `classifyInflow` 결과 라벨과 1:1 매칭.

### 3-5. ExitPages (`widgets/ExitPages.tsx`, 신규)
PopularPages와 동일 레이아웃, 라벨만 "이탈 페이지 TOP 10". 우측 숫자는 `exits`.

### 3-6. AdContentTop (`widgets/AdContentTop.tsx`, 신규)
```
광고 소재
┌─────────────────────────────────────────────┐
│ dihi          78 세션   12.8% 리드률 (10명) │
│ link_in_bio   21 세션    4.8% 리드률 (1명)  │
│ ...                                          │
└─────────────────────────────────────────────┘
```
- 세션 막대 + 리드율은 우측 작은 숫자.

### 3-7. 레이아웃
```
[KPI 카드 7개]
[일별 페이지뷰 차트]
[인기 페이지 TOP10 | 이탈 페이지 TOP10]  ← 2열
[유입 채널 | 광고 소재 TOP]              ← 2열
[최근 활성 방문자]
[디바이스/브라우저/OS]
```

## 4. State & URL 관리

### 4-1. 상태 모델 (`OverviewTab` 컴포넌트)
```ts
const [range, setRange] = useState<Range>(...);      // URL에 from/to 반영
const [device, setDevice] = useState<string | null>(null);  // in-memory only
const [channel, setChannel] = useState<string | null>(null); // in-memory only
```

### 4-2. URL sync (기간만)
- 초기 마운트 시 `useSearchParams()`로 `from`, `to` 읽고 state 초기화.
- range 변경 시 `router.replace(?from=...&to=...)` (push 아님 — 히스토리 오염 방지).
- 필터(device, channel)는 URL 안 건드림.

```ts
// 초기화 (마운트 시)
const sp = useSearchParams();
const initialRange = sp.get("from") && sp.get("to")
    ? { from: sp.get("from")!, to: sp.get("to")!, preset: "custom" }
    : presetRange("30d");
```

## 5. 결정 사항 (확정)

| # | 결정 |
|---|------|
| 1 | 이탈 페이지: bounce(1페이지 세션) **제외** |
| 2 | 세그먼트 필터: **모든 위젯에 일괄 적용** |
| 3 | URL sync: **기간(from/to)만** |
| 4 | DateRangePicker: **공용 `src/components/ui/`** |
| 5 | 광고 소재 위젯: **소재명 + 세션수 + 리드율** |

## 6. 엣지 케이스

| 케이스 | 처리 |
|--------|------|
| 필터 결과 0 세션 | 모든 위젯 0/빈 상태, "선택한 필터에 해당하는 데이터 없음" |
| 사용자지정 from > to | DateRangePicker 내부에서 자동 swap |
| from/to 동일 날짜 | 그날 하루 00:00~23:59 |
| utm_content 없음 | 광고 소재 위젯 "데이터 없음" |
| URL에 잘못된 날짜 | parse 실패 시 기본 30일로 fallback |
| 채널 필터로 sessions 0개 → 다른 쿼리 IN 절 비어있음 | `id IN ()`는 PG 에러 → 채널 매칭 0이면 즉시 빈 응답 반환 |

## 7. Definition of Done

- [ ] `/api/tracker/analytics/overview`에 `device`, `channel` 인자 + `exitPages`, `adContents` 필드 추가
- [ ] 이탈 페이지 TOP10 (bounce 제외 + exit_page fallback)
- [ ] 세그먼트 필터 UI (디바이스 + 채널 드롭다운) — 모든 위젯 일괄 재계산
- [ ] DateRangePicker `src/components/ui/`에 공용 추가
- [ ] RangeSelector에 "사용자지정" 옵션
- [ ] URL `?from&to` 보존 (새로고침/공유 동작)
- [ ] 광고 소재 TOP 위젯 (소재명/세션수/리드율) — 운영 데이터 9종 확인
- [ ] excludePaths 정책 유지 (이탈 페이지에도 적용)
- [ ] 빈 상태 처리
- [ ] tsc 통과, 각 파일 200줄 이내
- [ ] 운영 덤프 위 실측 확인
- [ ] gap-detector Match Rate ≥ 90%

## 8. 변경 파일 요약

**신규 (5)**:
- `src/components/ui/date-range-picker.tsx` (공용)
- `src/components/tracker/ui/widgets/SegmentFilter.tsx`
- `src/components/tracker/ui/widgets/ExitPages.tsx`
- `src/components/tracker/ui/widgets/AdContentTop.tsx`
- `src/lib/tracker/session-filter.ts` (channel 필터링 헬퍼)

**변경 (4)**:
- `src/app/api/tracker/analytics/overview/route.ts` — segments + 신규 필드
- `src/components/tracker/types/overview.ts` — exitPages, adContents 타입 + filter
- `src/components/tracker/hooks/useTrackerOverview.ts` — filter 인자
- `src/components/tracker/ui/OverviewTab.tsx` — 필터 UI + URL sync + 신규 위젯 배치
- `src/components/tracker/ui/widgets/RangeSelector.tsx` — 사용자지정 옵션

## 9. 리스크

- **classifyInflow SQL 외 처리** — 운영 규모(sessions 1.9K)는 OK. 10배 되면 traffic_source 컬럼 채워 SQL 이전 검토.
- **URL sync + 워크스페이스/site 컨텍스트 충돌** — 이번엔 from/to만 보존이라 안전. 필터까지 넣었으면 워크스페이스 변경 시 URL state 꼬일 가능성 있었음.
- **DateRangePicker 신규 컴포넌트** — shadcn 미제공. Calendar 2개 popover로 직접 조립. 모바일 UX 주의.
- **exit_page fallback이 정확한가** — 마지막 PAGE_VIEW가 실제 이탈 페이지인지 검증 필요. 운영 데이터에서 두 값(exit_page vs 마지막 PV)이 일치하는 비율 확인 후 신뢰도 판단.
