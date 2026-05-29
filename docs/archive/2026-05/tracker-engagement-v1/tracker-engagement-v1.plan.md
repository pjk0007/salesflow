# Plan: tracker-engagement-v1 (페이지 인게이지먼트 추적)

> 작성일: 2026-05-29
> 상위 로드맵: [tracker-marketing-roadmap.plan.md](./tracker-marketing-roadmap.plan.md)
> Phase: Plan

## 1. 배경 / 문제

현재 트래커는 페이지 단위(PV/세션/체류시간/이탈률)와 record_event(가입·매치 단계)만 추적한다.
그래서 다음 같은 마케팅·UX 질문에 답할 수 없다:

- "랜딩페이지 hero 섹션을 본 사람 중 몇 %가 pricing 섹션까지 스크롤했는가?"
- "Pricing 페이지에서 '가입하기' 버튼 vs '문의하기' 버튼 클릭률 차이는?"
- "FAQ 섹션에 평균 얼마나 머무는가? (관심도가 높은가?)"

지금은 PV만 보고 추측해야 함. 섹션 단위 인게이지먼트(체류·도달·상호작용)를 측정하는 인프라가 없다.

## 2. 목표 (Goal)

각 사이트가 **섹션 가시성·체류시간·요소 클릭**을 추적해서 페이지 안에서 사용자가 어떤 부분에 반응하는지 분석할 수 있게 한다.

### 핵심 정량 목표
- tracker.js 코드 늘어남: **<= 200줄 추가** (현재 ~490줄 → 690줄 이내)
- 운영자(사이트 측) 부담: **HTML attribute 한두 줄만** 박으면 자동 추적
- DB 스키마 변경: **0건** (`tracker_events` 재사용, `event_type` 신규 추가만)

## 3. 범위 (이번 PDCA)

### 3-1. 자동 추적 — tracker.js 확장

#### a. 섹션 가시성 (`SECTION_VIEW`)
- 사이트 측이 `data-track-section="hero"` 같은 attribute를 박은 요소들을 IntersectionObserver로 감시
- 50% 이상 노출 시 진입(enter) / 떠날 때 이탈(exit) 시각 기록
- 이벤트: `{ event_type: "SECTION_VIEW", event_name: section_name, properties: { dwell_ms, entered_at, exited_at } }`

#### b. 클릭 (`CLICK`)
- 사이트 측이 `data-track-click="signup-cta"` 박은 요소들을 클릭 위임으로 감시
- 이벤트: `{ event_type: "CLICK", event_name: click_name, properties: { section?, text?, href? } }`
- "어느 섹션 안의 어떤 버튼인지" 추적 가능 (DOM 조상 중 `data-track-section` 검색)

#### c. 스크롤 깊이 (`SCROLL`)
- 25/50/75/100% 임계값 도달 시 한 번씩 발화 (페이지 단위, 중복 발화 X)
- 이벤트: `{ event_type: "SCROLL", event_name: "depth_50", properties: { depth_pct } }`

### 3-2. 수집 API 확장
- 기존 `/api/tracker/collect`가 이미 `event_type/event_name/properties` 받음 → **그대로 재사용**
- 다만 SECTION_VIEW의 dwell_ms 같은 숫자 필드를 properties.dwell_ms로 받아서 집계 가능하도록 보강

### 3-3. 분석 API (`/api/tracker/analytics/engagement`)
세 가지 응답:
- **`sections`**: 섹션별 (시인율 = 해당 페이지 PV 중 그 섹션 본 사람 %, 평균 체류시간, 진입자 수)
- **`clicks`**: 클릭별 (event_name별 distinct visitor·세션 수, 어떤 섹션에서 일어났는지)
- **`scroll`**: 페이지별 25/50/75/100 도달 비율

세그먼트(device/channel/channelMode) + 기간 + 페이지(URL prefix) 필터 적용 가능.

### 3-4. UI — 트래커 신규 탭 또는 위젯
- 마케팅 탭에 **"페이지 인게이지먼트"** 카드 신설:
  - 페이지 선택 드롭다운 (사이트의 인기 페이지 TOP N)
  - 그 페이지의 섹션별 진입률 + 평균 체류 시간
  - 그 페이지의 클릭 이벤트별 카운트
- (또는 별도 "인게이지먼트" 탭 추가 — Design에서 결정)

## 4. 비범위

- **히트맵 시각화**(클릭 위치를 페이지 위에 점으로) — Phase 2
- **세션 리코딩** — Phase 3 (별도 인프라 필요)
- **A/B 테스트** — 별도 기능
- **마우스무브·dwell** 디테일 (Hotjar 수준) — 데이터 양 폭증 위험
- **자동 셀렉터 추론** ("클릭된 요소의 텍스트로 자동 이벤트명") — false positive 많아 명시 추적 우선
- 일반 form 이벤트 (focus/blur/submit) — 별도 케이스

## 5. 해결 방안 비교

| 방안 | 자동 추적 수준 | 운영자 작업량 | 데이터 의미성 |
|------|---|---|---|
| **A. data-attribute 기반 (권장)** | 가시성·클릭·스크롤 자동 | attribute 박기 1줄 | 명확 |
| B. 셀렉터 + 자동 추론 | 모든 클릭 자동 캡처 | 0 | "어떤 클릭인지" 모호 |
| C. 명시 호출만 (`sendb.track`) | 코드에 매번 호출 | 많음 | 명확하지만 부담 |
| D. 외부 도구 (Hotjar/Clarity) | 자동 | 0 | 좋지만 별도 결제·외부 의존 |

**A 권장**: 자동 + 명확. data-attribute 박는 부담은 최소이고, 그 결과로 의미 있는 이벤트가 쌓임.

## 6. 영향 범위

**신규**:
- `src/app/api/tracker/analytics/engagement/route.ts` — 분석 API
- `src/components/tracker/hooks/useEngagementAnalytics.ts`
- `src/components/tracker/ui/widgets/EngagementCard.tsx` (또는 EngagementTab)
- `src/components/tracker/types/engagement.ts`
- `docs/02-design/features/tracker-engagement-v1.design.md`

**변경**:
- `public/tracker.js` — IntersectionObserver, 클릭 위임, 스크롤 깊이 로직 추가 (~150~200줄)
- `src/components/tracker/ui/EmbedScriptCard.tsx` — `data-track-section`, `data-track-click` 사용법 안내 섹션 추가
- (선택) `src/components/tracker/ui/MarketingTab.tsx` — EngagementCard 통합
- `src/lib/tracker/validations.ts` — collect payload에 SECTION_VIEW/CLICK/SCROLL 타입 검증 확장

**미변경**:
- `tracker_events` 테이블 스키마 (그대로 재사용)
- `trackerEvents` Drizzle schema

## 7. 결정 사항 (Design에서 확정)

1. **섹션 가시성 임계값**: 50% / 100% / IntersectionObserver `threshold` 다단계
2. **클릭 위임 vs 직접 바인딩**: 동적 요소 대응 필요 → 위임 권장
3. **스크롤 깊이 측정 단위**: viewport % vs 문서 % (sticky header 영향)
4. **CLICK이 SECTION_VIEW 안에서 발생했는지 매칭**: 클라이언트에서 단계상 묶을지, 서버에서 join할지
5. **이벤트 묶음 (batching) 정책**: 페이지 unload 직전 한번에 보낼지, 즉시 보낼지
6. **인게이지먼트 UI를 마케팅 탭 안에 둘지, 별도 탭으로 둘지**

## 8. Definition of Done

- [ ] tracker.js에 IntersectionObserver 기반 `SECTION_VIEW` 추적 동작 (50% 이상 노출 + dwell_ms)
- [ ] `data-track-click` 클릭 위임 동작 (조상 섹션 자동 매칭)
- [ ] 스크롤 깊이 25/50/75/100 한 번씩 발화
- [ ] `/api/tracker/analytics/engagement` 분석 API — 섹션/클릭/스크롤 응답
- [ ] 마케팅 탭(또는 신규 탭)에 "페이지 인게이지먼트" 카드/표 노출
- [ ] EmbedScriptCard에 `data-track-section` / `data-track-click` 사용법 안내 추가
- [ ] 운영 사이트(예: 디하 랜딩) 한 곳에 attribute 박고 데이터 들어옴 확인 (실측)
- [ ] 채널·디바이스 세그먼트 필터 반영
- [ ] tsc 통과, 각 파일 200줄 이내
- [ ] gap-detector Match Rate ≥ 90%

## 9. 리스크 / 주의

- **데이터 양 폭증**: 한 페이지 PV마다 SECTION_VIEW가 N개 + 클릭 M개 + 스크롤 3~4개 발생 → 이벤트 양이 기존 PV의 10배 이상. 인덱스/쿼리 비용 고려 필요. 페이지 unload batching 으로 네트워크 부하 줄이고, DB는 sites_occurred 인덱스에 event_type 추가 검토.
- **반복 발화 방지**: 같은 섹션이 스크롤 위아래로 N번 들락날락하면 N번 카운트하면 의미 없음 → "최초 진입만 카운트"가 기본.
- **사이트 측 attribute 누락**: 운영자가 attribute 안 박으면 데이터 0. 가이드를 EmbedScriptCard에 명확히.
- **DOM 동적 렌더링**: SPA에서 페이지 전환 시 IntersectionObserver 재바인딩 필요. tracker.js의 history pushState 감지(이미 있음)와 연동.
- **광고차단기**: tracker.js 자체가 막히면 모든 게 0이지만, 이건 기존에도 동일한 리스크.

## 10. 다음 단계

- `/pdca design tracker-engagement-v1` — 결정 사항 6개 확정 + tracker.js 구조 + 분석 API 스펙
- Design 통과 후 `/pdca do` — 구현
- 디하 한 페이지(예: 랜딩)에 attribute 박고 데이터 실측
- 완료 시 [로드맵](./tracker-marketing-roadmap.plan.md#6-진척-추적)에서 항목 추가
