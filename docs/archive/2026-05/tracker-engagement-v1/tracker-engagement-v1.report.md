# Report: tracker-engagement-v1 (페이지 인게이지먼트 추적)

> 완료일: 2026-05-29
> Match Rate: **95%**
> 이터레이션: 1회 (90% 초과로 자동 완료)

## 요약

트래커에 페이지 인게이지먼트 추적 기능 추가 완료.
`data-track-section` / `data-track-click` 속성으로 운영자가 사이트에 선언적으로 추적 지점을 지정하고, tracker.js가 자동으로 수집하는 방식.

## 구현 메트릭

| 항목 | 목표 | 실제 |
|------|------|------|
| tracker.js 추가 줄 수 | ≤ 200줄 | ~190줄 추가 (490 → 683줄) |
| DB 스키마 변경 | 0건 | 0건 |
| 운영자 작업 | HTML attribute 1~2줄 | attribute 1줄 |
| tsc 에러 | 0 | 0 |
| 신규 파일 줄 수 | ≤ 200줄 | 최대 189줄 |

## 핵심 구현 결정 (Plan/Design 대비 변경)

### IntersectionObserver 임계값 변경
- Plan: `threshold: 0.5` (50% 노출)
- 최종: `rootMargin: '-25% 0px -25% 0px' + threshold: 0` (뷰포트 중앙 50% 영역)
- 이유: 뷰포트보다 큰 섹션(예: 긴 hero 섹션)이 50% 임계값으로 감지 안 되는 실측 문제. 업계 표준(GA4/Hotjar) 조사 후 변경.

### 1초 dwell 필터 위치 이관
- Design: tracker.js의 flushSectionViews에서 `>= 1000ms` 필터
- 최종: tracker.js는 `>= 100ms` (노이즈만 제거), 분석 SQL에서 `>= 1000ms` 필터
- 이유: 원시 데이터 손실 최소화. 분석 기준 변경 시 재수집 없이 SQL만 조정 가능.

### 배치 payload 키명
- Design: `{ batch: [...] }`
- 최종: `{ events: [...] }` (collectBatchSchema와 통일)

## 구현된 파일

**신규**
- `src/app/api/tracker/analytics/engagement/route.ts` — 189줄
- `src/components/tracker/types/engagement.ts` — 35줄
- `src/components/tracker/hooks/useEngagementAnalytics.ts` — 33줄
- `src/components/tracker/ui/widgets/EngagementCard.tsx` — 178줄

**변경**
- `public/tracker.js` — SECTION_VIEW/CLICK/sendBeacon batch/MutationObserver SPA 대응
- `src/lib/tracker/validations.ts` — SECTION_VIEW/CLICK 타입 + collectBatchSchema
- `src/app/api/tracker/collect/route.ts` — batch 분기 처리
- `src/components/tracker/ui/MarketingTab.tsx` — EngagementCard 통합
- `src/components/tracker/ui/EmbedScriptCard.tsx` — 인게이지먼트 가이드 토글

## Gap 요약 (95%)

| Gap | 종류 | 영향 |
|-----|------|------|
| enter_count 미전송 | Minor | 없음 (분석 쿼리 미사용) |
| batch 키명 변경 (batch→events) | Minor | 없음 (클라이언트-서버 일관성 있게 처리) |

## 실측 검증

디하 랜딩 페이지에 8개 섹션 `data-track-section` attribute 적용 후 SECTION_VIEW 이벤트 정상 수집 확인.

## 다음 단계 / 비범위

- **히트맵 시각화** — Phase 2
- **세션 리코딩** — Phase 3
- tracker_events 인덱스 추가 — 운영 1주 후 쿼리 성능 관찰 후 결정
  ```sql
  CREATE INDEX tracker_events_type_name_idx ON tracker_events (site_id, event_type, event_name)
  WHERE event_type IN ('SECTION_VIEW', 'CLICK');
  ```
