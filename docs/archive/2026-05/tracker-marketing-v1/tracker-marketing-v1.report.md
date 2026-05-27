# Report: 트래커 마케팅 분석 v1 (tracker-marketing-v1)

> **Date**: 2026-05-27
> **Branch**: main
> **Status**: 완료
> **Match Rate**: 100%

---

## 요약

트래커 개요 탭에 마케팅 분석 4종을 추가하고, 마케팅 전용 탭(`MarketingTab`)으로 분리했다. Design 명세(이탈 페이지 TOP10 / 세그먼트 필터 / DateRangePicker / 광고 소재 TOP) 전항목 완료 외, 채널별 전환율 비교·일별 가입/구독 추이·마케팅 깔때기 4단·채널 분류 정확도 개선·성능 인덱스를 추가 구현했다. 운영 덤프 실측 완료, tsc 통과.

---

## 구현 완료 항목

### DB / 마이그레이션

| 파일 | 내용 |
|------|------|
| `drizzle/0053_tracker_events_session_idx.sql` | `tracker_events(session_id, occurred_at)` 복합 인덱스 — 핵심 쿼리 697ms→23ms (30배) |
| `drizzle/0054_tracker_site_conversion_stage.sql` | `tracker_sites.conversionStage` — 전환완료 단계명 컬럼 |

### API 확장 (`src/app/api/tracker/analytics/overview/route.ts`)

- `device` / `channel` 쿼리 인자 수신 + 세그먼트 필터 SQL 적용
- `exitPages`: bounce 제외(pv_count ≥ 2) + `exit_page` NULL fallback(마지막 PAGE_VIEW), excludePaths 반영
- `adContents`: `utm_content` TOP10 + `source/medium/campaign` 포함 (채널 배지용)
- `channelConversions`: 채널별 visitor/leads/leadRate 집계
- `dailyConversions`: 일별 signups/paid 추이
- `funnel`: 방문→리드→가입→전환완료 4단 (site.conversionStage 없으면 paid=null로 3단 자연 축소)
- 채널 필터: JS에서 `classifyInflow` → 매칭 세션 ID → 모든 쿼리 `IN (...)` 적용

### 신규 컴포넌트

| 파일 | 역할 |
|------|------|
| `src/components/ui/date-range-picker.tsx` | 공용 DateRangePicker — Popover + Calendar 2개, Apply 확정, 미래 날짜 비활성 |
| `src/lib/tracker/session-filter.ts` | 채널 필터 헬퍼 (`getSessionIdsByChannel`) |
| `src/components/tracker/ui/MarketingTab.tsx` | 마케팅 탭 메인 — 이탈 페이지 / 광고 소재 / 채널 전환율 레이아웃 |
| `src/components/tracker/ui/widgets/SegmentFilter.tsx` | 디바이스 + 채널 드롭다운 + 일괄 해제 버튼 |
| `src/components/tracker/ui/widgets/ExitPages.tsx` | 이탈 페이지 TOP10 (bounce 제외 설명 포함) |
| `src/components/tracker/ui/widgets/AdContentTop.tsx` | 광고 소재 TOP — 소재명/세션수/리드율/채널 배지 |
| `src/components/tracker/ui/widgets/FunnelPreview.tsx` | 마케팅 깔때기 4단 (conversionStage 기반) |
| `src/components/tracker/ui/widgets/DailyConversions.tsx` | 일별 가입/구독 추이 차트 |
| `src/components/tracker/ui/widgets/ChannelConversion.tsx` | 채널별 전환율 비교 |

### 수정 컴포넌트

| 파일 | 변경 내용 |
|------|-----------|
| `src/components/tracker/ui/OverviewTab.tsx` | URL `?from&to` sync + SegmentFilter 통합 + ControlBar 분리 (MarketingTab과 공유) |
| `src/components/tracker/ui/VisitorListPage.tsx` | 탭 4개([개요·마케팅·방문자·설정]) 평탄화 — 이중탭 회피 |
| `src/components/tracker/ui/widgets/RangeSelector.tsx` | "사용자지정" 옵션 + DateRangePicker 통합 |
| `src/components/tracker/types/overview.ts` | `exitPages`, `adContents`, `channelConversions`, `dailyConversions`, `funnel` 타입 추가 |
| `src/components/tracker/hooks/useTrackerOverview.ts` | `device` / `channel` 인자 추가 |
| `src/components/journey/utils/referrer.ts` | `classifyInflow` 강화 — Threads/Instagram/Facebook/X organic 소셜 분류, 자체도메인 직접 처리, `medium=social` 처리 |

### 삭제

- `src/components/tracker/ui/widgets/HourlyHeatmap.tsx` — B2B 무의미, 전문가 리서치 결론 반영

---

## 검증

| 항목 | 결과 |
|------|------|
| tsc --noEmit | 통과 |
| 이탈 페이지 TOP10 (bounce 제외 + exit_page fallback) | 운영 덤프 실측 확인 |
| 채널별 전환율 (직접 33% / 메일 24% / 구글광고 15%) | 운영 덤프 실측 확인 |
| 깔때기 4단 (가입 ≥ 구독중) | 디하 사이트 실측 확인 |
| 기타 채널 감소 (148건→17건) | classifyInflow 개선 효과 |
| 성능 인덱스 0053 | 697ms→23ms |

---

## Design 초과 구현 (Phase 1 확장)

Design 명세에 없었으나 전문가 리서치 및 운영 실측 결과 추가한 항목:

| 항목 | 근거 |
|------|------|
| 채널별 전환율 (`channelConversions`) | 광고 ROAS 재분배 결정에 핵심 — 우선순위 1위 확정 |
| 일별 가입/구독 추이 (`dailyConversions`) | 일별 PV 차트와 보조로 "왜 이번 기간 전환 변했나" 파악 |
| 마케팅 깔때기 4단 (`funnel`) | site.conversionStage로 전환완료 단계 동적 정의 |
| `MarketingTab` 분리 | OverviewTab 비대화 방지 + 역할 명확화 |
| 채널 분류 정확도 강화 | 기타 148건→17건 (91% 감소) |
| 성능 인덱스 0053 | 실운영 쿼리 30배 향상 |

---

## 미결 / 후속 과제

| # | 내용 | Phase |
|---|------|-------|
| 1 | 전환 목표(goals) 정의 + 퍼널 단계 설정 UI | Phase 2 (tracker-funnels-v1) |
| 2 | 기간 비교(compare) — 직전 동일 기간 오버레이 | Phase 2 |
| 3 | 캠페인 트렌드 (utm_campaign 시계열) | Phase 2 |
| 4 | classifyInflow → traffic_source 컬럼 이전 (sessions 10K+ 시) | 장기 |

---

## Out of Scope (확정)

- Phase 2 항목(goals/funnels/compare/캠페인트렌드) — 별도 PDCA
- 다중 필터 AND/OR — 1차는 단일 선택
- 필터 URL sync — from/to만 보존 (필터는 in-memory state)
