# Design: tracker-engagement-v1 (페이지 인게이지먼트 추적)

> 작성일: 2026-05-29
> Phase: Design
> Plan: [tracker-engagement-v1.plan.md](../../01-plan/features/tracker-engagement-v1.plan.md)

## 1. 설계 개요

`data-track-section` / `data-track-click` 두 속성으로 사이트의 섹션 가시성과 버튼 클릭을 자동 추적한다.
스크롤 깊이는 SECTION_VIEW로 대체되므로 별도 추적 안 함. tracker_events 스키마 그대로 재사용.

### Plan 결정 확정
| # | 결정 |
|---|------|
| 1 | 시인 임계값 = **50% 노출 + 1초 이상 머문** (IntersectionObserver threshold=0.5 + setTimeout 1000ms) |
| 2 | 같은 섹션 반복 입수 = **페이지당 1회만 카운트, dwell_ms는 누적** (들어올 때마다 합산) |
| 3 | 스크롤 깊이 = **추적 안 함** (SECTION_VIEW로 대체 가능) |
| 4 | Batching = **CLICK 즉시 / SECTION_VIEW 누적 후 unload 시 sendBeacon 일괄** |
| 5 | UI 위치 = **마케팅 탭 안에 카드 추가** (페이지 드롭다운 + 섹션 표 + 클릭 표) |
| 6 | 페이지 매칭 단위 = **path** (search/hash 제외, URL에서 origin·querystring 제거) |

## 2. 데이터 모델

### 2-1. `tracker_events` 재사용 (스키마 변경 0)

| 컬럼 | SECTION_VIEW | CLICK |
|------|--------------|-------|
| `event_type` | `"SECTION_VIEW"` | `"CLICK"` |
| `event_name` | section_name (예: "hero", "pricing") | click_name (예: "signup-cta") |
| `page_url` | 발생 페이지 | 발생 페이지 |
| `properties` | `{ dwell_ms, enter_count }` | `{ section?, text?, href?, target_tag? }` |
| `occurred_at` | unload 직전 (sendBeacon 시점) | 클릭 즉시 |

> 첫 unload 시 dwell_ms < 1000 이면 미발화 (Plan 결정 1번).
> click의 `section`은 클릭 요소의 DOM 조상 중 가장 가까운 `data-track-section` 값 (없으면 null).

### 2-2. 새 인덱스 (필요 시 Do 단계에서 결정)
```sql
-- 현재 tracker_events_type_idx = (site_id, event_type) 이미 존재
-- 분석에서 (site_id, event_type, event_name) 그룹별 카운트가 많음
-- 운영 데이터량 보고 0.5초 이상 느려지면 추가:
CREATE INDEX tracker_events_type_name_idx ON tracker_events (site_id, event_type, event_name) WHERE event_type IN ('SECTION_VIEW','CLICK');
```

## 3. Tracker.js 확장 (`public/tracker.js`)

### 3-1. 인터페이스 — 운영자가 박는 attribute

```html
<!-- 섹션 -->
<section data-track-section="hero">...</section>
<section data-track-section="pricing">...</section>

<!-- 클릭 -->
<button data-track-click="signup-cta">가입하기</button>
<a href="/contact" data-track-click="contact-link">문의</a>
```

### 3-2. tracker.js 추가 로직 (의사코드)

```js
// 모듈 1: SECTION_VIEW 추적
const sectionState = new Map(); // section_name → { observed: bool, dwellMs: 0, lastEnterAt: 0 }

function initSectionTracking() {
    const elements = document.querySelectorAll("[data-track-section]");
    if (!elements.length) return;

    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            const name = entry.target.getAttribute("data-track-section");
            const state = sectionState.get(name) || { observed: false, dwellMs: 0, lastEnterAt: 0 };

            if (entry.intersectionRatio >= 0.5 && !entry.target._enterTimer) {
                // 1초 후에도 여전히 보이면 진입 카운트
                entry.target._enterTimer = setTimeout(() => {
                    state.observed = true;
                    state.lastEnterAt = Date.now();
                    sectionState.set(name, state);
                }, 1000);
            } else if (entry.intersectionRatio < 0.5) {
                // 떠남 — 1초 미만으로 있다 떠나면 타이머 취소
                if (entry.target._enterTimer) {
                    clearTimeout(entry.target._enterTimer);
                    entry.target._enterTimer = null;
                }
                // observed 상태라면 dwell 누적
                if (state.observed && state.lastEnterAt > 0) {
                    state.dwellMs += Date.now() - state.lastEnterAt;
                    state.lastEnterAt = 0;
                    sectionState.set(name, state);
                }
            }
        }
    }, { threshold: [0.5] });

    elements.forEach((el) => observer.observe(el));
    window._sendbSectionObserver = observer; // SPA 라우팅 시 재바인딩용
}

function flushSectionViews() {
    // 현재 보이고 있는 섹션도 dwell 정산
    for (const [name, state] of sectionState) {
        if (state.lastEnterAt > 0) {
            state.dwellMs += Date.now() - state.lastEnterAt;
            state.lastEnterAt = 0;
        }
    }
    // 1초 이상 머문 섹션만 전송 (Plan 결정 1번 보강)
    const payloads = [];
    for (const [name, state] of sectionState) {
        if (state.observed && state.dwellMs >= 1000) {
            payloads.push({
                type: "SECTION_VIEW",
                name: name,
                page_url: location.href,
                page_title: document.title,
                properties: { dwell_ms: state.dwellMs },
            });
        }
    }
    if (payloads.length > 0) {
        // sendBeacon으로 페이지 unload 중에도 보장 전송
        sendCollectBatch(payloads);
    }
    sectionState.clear();
}

window.addEventListener("pagehide", flushSectionViews);
// SPA 라우팅 시에도 정산 (trackPageView 직전)
const originalTrackPageView = trackPageView;
trackPageView = function () {
    flushSectionViews();
    sectionState.clear();
    originalTrackPageView();
    initSectionTracking(); // 새 DOM 기준 재바인딩
};

// 모듈 2: CLICK 추적 (이벤트 위임)
function initClickTracking() {
    document.addEventListener("click", (e) => {
        let el = e.target;
        let clickName = null;
        while (el && el !== document.body) {
            const name = el.getAttribute && el.getAttribute("data-track-click");
            if (name) { clickName = name; break; }
            el = el.parentElement;
        }
        if (!clickName) return;

        // 부모 섹션 자동 매칭
        let sectionName = null;
        let parent = el;
        while (parent && parent !== document.body) {
            const sec = parent.getAttribute && parent.getAttribute("data-track-section");
            if (sec) { sectionName = sec; break; }
            parent = parent.parentElement;
        }

        sendCollect({
            type: "CLICK",
            name: clickName,
            page_url: location.href,
            page_title: document.title,
            properties: {
                section: sectionName,
                text: (el.innerText || "").slice(0, 100),
                href: el.getAttribute("href") || null,
                target_tag: (el.tagName || "").toLowerCase(),
            },
        });
    }, true); // capture phase
}

// 모듈 3: sendCollectBatch (sendBeacon 우선)
function sendCollectBatch(events) {
    const payload = JSON.stringify({ batch: events, visitor_id: getVisitorId(), session_id: getSessionId() });
    if (navigator.sendBeacon) {
        const ok = navigator.sendBeacon(config.endpoint, payload);
        if (ok) return;
    }
    // 폴백: fetch keepalive
    fetch(config.endpoint, { method: "POST", body: payload, keepalive: true }).catch(() => {});
}
```

### 3-3. 코드 규모 추정
- SECTION 모듈: ~60줄
- CLICK 모듈: ~25줄
- batching/sendBeacon: ~20줄
- SPA 재바인딩 hook: ~10줄
- **합계 ~115줄** → tracker.js 490 + 115 = **~605줄** (Plan 200줄 이내 목표 만족)

### 3-4. SPA 페이지 전환 대응
기존 tracker.js는 history.pushState/popstate에 hook을 걸어 `trackPageView`를 호출함.
**전환 시점에 반드시 `flushSectionViews()` 먼저 → 그 다음 `initSectionTracking()` 재호출**해야
이전 페이지 데이터가 새 페이지에 섞이지 않음.

## 4. 수집 API (`/api/tracker/collect`)

### 4-1. 변경 없음 (단건)
- 기존 라우트가 `{ type, name, page_url, page_title, properties }` 받음
- `SECTION_VIEW`, `CLICK` 타입을 허용 목록에 추가 (validations.ts)

### 4-2. 배치 추가 (sendBeacon용)
- 동일 라우트가 `{ batch: [...] }` 형태도 받도록 확장
- 처리: `if (body.batch) { body.batch.forEach(insertEvent) } else { insertEvent(body) }`

### 4-3. validations.ts 확장
```ts
// 허용 event_type에 SECTION_VIEW, CLICK 추가
const ALLOWED_EVENT_TYPES = ["PAGE_VIEW", "CUSTOM", "PURCHASE", "SECTION_VIEW", "CLICK"];

// SECTION_VIEW의 properties.dwell_ms는 0 ~ 24h 사이 숫자
// CLICK의 properties: section?(string|null), text?(string), href?(string), target_tag?(string)
```

## 5. 분석 API (`/api/tracker/analytics/engagement`)

### 5-1. 쿼리 파라미터
| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| siteId | number | ✓ | |
| from / to | string | ✓ | YYYY-MM-DD |
| device | string | | 세그먼트 |
| channel | string | | 세그먼트 (그룹 라벨) |
| channelMode | "all"\|"paid"\|"organic" | | |
| page | string | | path prefix (예: `/pricing`). 미지정 시 사이트 전체 페이지 합산 |

### 5-2. 응답
```ts
{
  success: true,
  data: {
    range: { from, to },
    pages: Array<{ path: string; title: string | null; pageviews: number }>; // 페이지 드롭다운용 TOP 20
    sections: Array<{
      name: string;
      visitors: number;          // 그 섹션을 본 distinct visitor
      pageviews: number;         // 그 섹션이 발생한 PV (visitor 중복 포함)
      avgDwellMs: number;
      viewRate: number;          // 페이지 PV 중 섹션 시인율 (0~1)
    }>;
    clicks: Array<{
      name: string;
      section: string | null;    // 가장 흔히 일어난 섹션
      clicks: number;            // 총 클릭 수
      visitors: number;          // 클릭한 distinct visitor
      clickRate: number;         // 페이지 PV 대비 클릭율
    }>;
  }
}
```

### 5-3. SQL 핵심 (sections)
```sql
WITH cohort_sessions AS (
    -- device/channel/channelMode 필터 적용된 세션 집합 (overview/funnel과 동일 패턴)
),
page_pv AS (
    SELECT visitor_id, page_url FROM tracker_events
    WHERE site_id = $1 AND event_type='PAGE_VIEW'
      AND occurred_at >= $2 AND occurred_at <= $3
      AND (session_id IN cohort_sessions OR cohort_sessions IS NULL)
      -- page 필터: regexp_replace(split_part(page_url,'?',1), '^https?://[^/]+','') LIKE $page||'%'
),
section_events AS (
    SELECT visitor_id, event_name AS section, properties->>'dwell_ms' AS dwell_ms
    FROM tracker_events
    WHERE site_id = $1 AND event_type='SECTION_VIEW'
      AND occurred_at >= $2 AND occurred_at <= $3
      AND (session_id IN cohort_sessions OR cohort_sessions IS NULL)
)
SELECT
    s.section AS name,
    COUNT(DISTINCT s.visitor_id)::int AS visitors,
    COUNT(*)::int AS pageviews,
    AVG((s.dwell_ms)::numeric)::int AS avgDwellMs,
    COUNT(DISTINCT s.visitor_id)::float / NULLIF((SELECT COUNT(DISTINCT visitor_id) FROM page_pv), 0) AS viewRate
FROM section_events s
GROUP BY s.section
ORDER BY visitors DESC
LIMIT 50;
```

## 6. UI — `EngagementCard` (마케팅 탭 안에 통합)

### 6-1. 위치
`src/components/tracker/ui/MarketingTab.tsx`에 신규 카드 추가:

```
[KPI 카드들]
[채널 전환]
[광고 콘텐츠 TOP]
[페이지 인게이지먼트] ← 신규
```

### 6-2. 컴포넌트 구조
```tsx
<EngagementCard siteId={siteId} range={range} filters={filters}>
  - 페이지 드롭다운 (data.pages에서, "전체 페이지" 옵션 포함)
  - 좌우 분할 영역:
    [섹션 표]                          [클릭 표]
    이름 | 시인율 | 평균 체류           이름 | 섹션 | 클릭 수 | 클릭율
    hero | 78%   | 1m 20s             signup-cta | hero | 230 | 12%
    pricing | 45% | 45s                ...
    ...
</EngagementCard>
```

### 6-3. 빈 상태 안내
사이트에 `SECTION_VIEW`/`CLICK` 이벤트가 0건이면:
> "data-track-section / data-track-click 속성을 페이지에 박으면 여기에 분석 결과가 표시됩니다. 설치 가이드"

링크는 설정 탭의 EmbedScriptCard로.

### 6-4. EmbedScriptCard 가이드 추가
[src/components/tracker/ui/EmbedScriptCard.tsx](../../../src/components/tracker/ui/EmbedScriptCard.tsx)에 토글 섹션 신설:
> **인게이지먼트 추적 (선택)**
> ```html
> <section data-track-section="hero">...</section>
> <button data-track-click="signup-cta">가입</button>
> ```
> 페이지의 주요 섹션과 버튼에 위 속성을 박으면 마케팅 탭의 "페이지 인게이지먼트"에서 시인율·클릭율을 분석할 수 있어요.

## 7. 영향 파일 목록

**신규**:
- `src/app/api/tracker/analytics/engagement/route.ts`
- `src/components/tracker/hooks/useEngagementAnalytics.ts`
- `src/components/tracker/ui/widgets/EngagementCard.tsx`
- `src/components/tracker/types/engagement.ts`

**변경**:
- `public/tracker.js` — SECTION_VIEW/CLICK 모듈 + sendBeacon batch
- `src/lib/tracker/validations.ts` — SECTION_VIEW/CLICK 타입 허용
- `src/app/api/tracker/collect/route.ts` — batch 페이로드 처리
- `src/components/tracker/ui/MarketingTab.tsx` — EngagementCard 통합
- `src/components/tracker/ui/EmbedScriptCard.tsx` — 인게이지먼트 가이드 토글

**미변경**:
- DB 스키마 (`tracker_events` 그대로)
- 인덱스 (운영 데이터 보고 Do 단계에서 결정)

## 8. 검증 체크리스트

- [ ] tsc 통과
- [ ] tracker.js 추가 코드 ≤ 200줄
- [ ] 분리된 파일 모두 ≤ 200줄
- [ ] 데모 페이지(로컬 또는 디하 한 페이지) 박고 SECTION_VIEW/CLICK 들어옴 DB 확인
- [ ] SPA 라우팅 후에도 새 페이지 섹션 정상 트래킹
- [ ] 채널/디바이스 필터 적용 동작
- [ ] 빈 상태(이벤트 0건) 안내 노출

## 9. 리스크 / 주의

- **dwell_ms 정확도 vs sendBeacon 한계**: `pagehide` 이벤트가 모바일에서 안 부르거나 백그라운드 갈 때만 부르는 경우 있음. `visibilitychange` 이벤트도 동시에 hook 걸어 보강.
- **CLICK + section 매칭 비용**: capture phase에서 매 클릭마다 DOM 조상 traversal. 깊은 DOM이면 O(depth) 부담. 다만 클릭 빈도 자체가 낮아 무시 가능.
- **속성 박는 가이드 부족**: 운영자 박는 거 잊으면 데이터 0. EmbedScriptCard 가이드 + 빈 상태 안내 둘 다 명시.
- **데이터 양 모니터링 필요**: 운영 배포 후 1주일 tracker_events 증가율 관찰 → 필요시 인덱스 추가.

## 10. 다음 단계

- `/pdca do tracker-engagement-v1`로 구현 시작
- 구현 후 로컬에서 demo 페이지로 검증 → 디하 한 페이지에 attribute 박고 운영 데이터 확인
- gap-detector 분석 → report → archive
