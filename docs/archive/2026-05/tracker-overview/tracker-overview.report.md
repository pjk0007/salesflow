# Completion Report: tracker-overview (트래커 사이트 분석 개요 탭)

> Date: 2026-05-27 | Match Rate: 93% | Status: Completed

## PDCA Cycle Summary

```
[Plan] -> [Design] -> [Do] -> [Check] (93%) -> [Report]
```

## 1. Feature Overview

트래커 페이지 진입 시 방문자 리스트 대신 **사이트 분석 개요**가 첫 화면으로 표시.
탭 [개요(default) / 방문자 / 설정] 구조로 재편 + 밑줄형 스타일 전환.
기간 필터(7/30/90일, 기본 30일) 기반 7개 KPI + 5개 위젯 구현.

## 2. Deliverables

### 2.1 신규 파일
| File | 역할 |
|------|------|
| `src/app/api/tracker/analytics/overview/route.ts` | 통합 개요 API — 7 KPI + 5 위젯 데이터 반환 |
| `src/components/tracker/ui/OverviewTab.tsx` | 개요 탭 컴포지션 (데이터 fetch + 위젯 배치) |
| `src/components/tracker/ui/widgets/KpiCards.tsx` | KPI 카드 7개 (방문자/세션/PV/체류/바운스/리드/가입) |
| `src/components/tracker/ui/widgets/DailyPageviewChart.tsx` | 일별 PV area chart (recharts) |
| `src/components/tracker/ui/widgets/PopularPages.tsx` | 인기 페이지 TOP10 |
| `src/components/tracker/ui/widgets/RecentSessions.tsx` | 최근 활성 방문자 (DISTINCT ON visitor, 최대 20) |
| `src/components/tracker/ui/widgets/InflowChannels.tsx` | 유입 채널 가로 막대 (채널별 색상) |
| `src/components/tracker/ui/widgets/DeviceBreakdown.tsx` | 디바이스 도넛 + 브라우저/OS 가로바 3컬럼 |
| `src/components/tracker/ui/widgets/RangeSelector.tsx` | 기간 필터 칩 (7일/30일/90일 preset) |
| `src/components/tracker/hooks/useTrackerOverview.ts` | SWR 훅 — range 변경 시 자동 재조회 |
| `src/components/tracker/api/fetchTrackerOverview.ts` | placeholder (SWR defaultFetcher 직접 사용) |
| `src/components/tracker/types/overview.ts` | OverviewResponse / OverviewData 타입 |
| `drizzle/0052_tracker_site_exclude_paths.sql` | trackerSites.excludePaths 컬럼 |

### 2.2 변경 파일
| File | 변경 내용 |
|------|-----------|
| `src/components/tracker/ui/VisitorListPage.tsx` | Tabs [개요/방문자/설정] + variant="line" 밑줄형 탭 추가 |
| `src/lib/db/schema.ts` | trackerSites.excludePaths 컬럼 추가 |
| `src/lib/tracker/validations.ts` | updateSiteSchema에 excludePaths 추가 |
| `src/app/api/tracker/sites/[id]/route.ts` | PATCH에서 excludePaths 반영 |
| `src/components/tracker/api/trackerSites.ts` | excludePaths 인자 지원 |
| `src/components/tracker/types/index.ts` | TrackerSite.excludePaths 타입 추가 |
| `src/components/tracker/ui/TrackerSettingsPanel.tsx` | ExcludePathsCard 추가 |

## 3. 주요 구현 사항

### 3-1. API 집계 로직
- **excludePaths 필터**: 설정된 경로 prefix에 매칭되는 PV/세션/방문자 전면 제외 (마케팅 깔때기 순수 수치 추출)
- **의미있는 세션 기준**: excludePaths 제외 후 PV >= 1회인 세션만 카운트 (바운스 정의도 동일 기준 적용)
- **delta 계산**: 직전 동일 길이 기간 재집계 후 `((curr-prev)/prev)*100`, prev=0이면 null
- **inflowChannels**: sessions 전체에 classifyInflow JS 후처리로 채널 집계 (기존 유틸 재사용)
- **KST 자정 경계**: from `T00:00:00+09:00` / to `T23:59:59.999+09:00` 변환

### 3-2. Design 대비 조정 사항
| 항목 | Design | 실제 구현 | 사유 |
|------|--------|-----------|------|
| TrackerTabs.tsx 별도 파일 | 명시 | VisitorListPage 내 직접 구현 | variant="line" 직접 사용으로 충분, 래퍼 불필요 |
| 차트 높이 | 280px | 260px | 렌더 시 padding 포함 시 동등 |
| URL 쿼리 보존 (from/to) | 권장 | state만 (URL 미적용) | 새로고침 공유 요건 낮음, 1차 제외 |
| custom date picker | 1차 가능하면 포함 | preset 3종만 | Design 명시 "복잡하면 next" |

## 4. Definition of Done 체크

- [x] 트래커 진입 시 개요 탭 default 표시
- [x] 탭 스타일 밑줄형 (variant="line"), 개요/방문자/설정 순서
- [x] KPI 7개 + 전기대비 delta (prev=0이면 "—")
- [x] 일별 PV 차트 / 인기 페이지 TOP10 / 최근 활성 방문자 / 유입 채널 / 디바이스 분포
- [x] 기간 필터 7/30/90일, 기본 30일
- [x] 빈 데이터 상태 처리 ("데이터 없음")
- [x] tsc --noEmit 통과
- [x] 전역 tabs.tsx 미변경
- [x] 운영 데이터 기반 화면 확인 완료

## 5. Gap Analysis

Match Rate: **93%**

핵심 기능 20개 항목 기준:
- TrackerTabs.tsx 별도 파일 미생성 (기능 동등 구현): -3%
- URL 쿼리 보존 미구현: -3%
- 차트 높이 미세 차이: -1%

## 6. 다음 단계 후보

- custom date picker (from/to date range picker)
- URL 쿼리 보존 (from/to param → 새로고침/공유)
- 실시간 자동 새로고침 모드
- 전환/마케팅/퍼널 추가 탭
