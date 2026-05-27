# Plan: tracker-marketing-v1 (Phase 1)

> 작성일: 2026-05-27
> 상위 로드맵: [tracker-marketing-roadmap.plan.md](./tracker-marketing-roadmap.plan.md)
> Phase: Plan

## 1. 배경

`tracker-overview`로 큰 그림 KPI는 잡혔지만, 영업/마케팅이 실제 광고 운용 시 필요한 **누수 지점 / 슬라이싱 / 임의 기간 / 소재 비교**가 빠져있다. 애디온 트래커와 비교한 격차 중 작고 효과 큰 4개를 한 PDCA로 묶는다.

## 2. 범위 (Phase 1)

4가지 기능을 트래커 **개요 탭**에 통합한다.

### 2-1. 이탈 페이지 TOP10 (Exit Pages)
**무엇**: 사용자가 마지막으로 본 페이지 상위 10개. "어디서 사이트를 떠나는지" = 누수 지점.
- 인기 페이지 위젯 옆 또는 아래에 배치
- 동일 페이지를 마지막으로 본 세션 수 카운트
- excludePaths 반영 (마케팅 깔때기 의미 페이지만)
- "Bounce 비율" 같이 표기 (이탈+1페이지짜리 = bounce, 2페이지 이상 후 이탈 = 진짜 누수 지점)

**데이터**:
- 1차 키: `tracker_sessions.exit_page` (1924 중 1423건만 채워져있음)
- **fallback**: exit_page NULL이면 해당 세션의 마지막 PAGE_VIEW 사용
- 처리: 양쪽 모두 normalizePath + excludePaths 필터

### 2-2. 세그먼트 필터
**무엇**: 상단에 디바이스 / 유입 채널 드롭다운. 선택 시 KPI·차트·모든 위젯이 그 세그먼트로 재계산.
- **디바이스**: 전체 / desktop / mobile / tablet
- **유입 채널**: 전체 / 직접 / 네이버 / 구글검색 / 구글광고 / 메타광고 / 메일 / 기타
- 다중 선택 불가 (1차는 단일 선택만, 단순)
- 필터 동작은 visitor 또는 session 수준에서 적용:
  - **디바이스**: `tracker_visitors.device_type`
  - **유입 채널**: 세션의 classifyInflow 결과 → API에서 적용
- 활성 필터는 칩으로 표시 + X 버튼으로 해제

### 2-3. 사용자 지정 기간 (DateRangePicker)
**무엇**: preset 옆에 from/to 직접 선택. 신규 컴포넌트 필요 (기존엔 단일 Calendar만).
- `[7일 | 30일 | 90일 | 사용자지정 ▼]` — 마지막 클릭 시 popover에 두 Calendar
- 선택 후 적용 버튼으로 확정 (실시간 적용 X — 두 날짜 모두 골라야 의미 있음)
- **URL 쿼리 sync**: `?from=YYYY-MM-DD&to=YYYY-MM-DD` — 새로고침/공유 가능. 이번에 처음 도입(현재 state-only).

### 2-4. 광고 소재(utm_content) TOP
**무엇**: 캠페인 소재별 세션/전환 비교. "어떤 광고 소재가 잘 됐나" 측정.
- 운영 데이터에 9종 utm_content 존재 (dihi 78건, link_in_bio 21건 등)
- 위젯: 소재명 / 세션 수 / 리드 전환율
- 신규 또는 인기 페이지 옆 작은 카드로

## 3. 비범위 (Phase 2로 이월)

- 전환 목표(goals) — `tracker_goals` 테이블 필요
- 퍼널 정의 — `tracker_funnels` 테이블 필요
- 기간 비교 (compare)
- 캠페인 트렌드 (시계열)
- 다중 필터 AND/OR

## 4. 해결 방안 비교

| 방안 | 내용 | 평가 |
|------|------|------|
| **A. 기존 overview API 확장** | 같은 엔드포인트에 필터/기간 인자 추가, exitPages·adContents 응답 필드 확장 | 권장 — 한 요청에 다 받아 일관됨 |
| B. 신규 API 분리 | `/api/tracker/analytics/exit-pages` 등 별도 | 비추 — 요청 수 증가, 캐싱 분리 |

**권장: A**. tracker-overview의 패턴(단일 통합 API) 유지.

## 5. 영향 범위

**변경**:
- `src/app/api/tracker/analytics/overview/route.ts` — segments 인자, exitPages·adContents 필드, classifyInflow 필터링
- `src/components/tracker/types/overview.ts` — exitPages, adContents 타입
- `src/components/tracker/hooks/useTrackerOverview.ts` — 필터/기간 인자
- `src/components/tracker/ui/OverviewTab.tsx` — 세그먼트 필터 UI, URL sync
- `src/components/tracker/ui/widgets/RangeSelector.tsx` — 사용자지정 옵션
- `src/components/tracker/ui/widgets/PopularPages.tsx` — 인기/이탈 페이지 한 카드 2탭 또는 별도 카드

**신규**:
- `src/components/tracker/ui/widgets/ExitPages.tsx`
- `src/components/tracker/ui/widgets/AdContentTop.tsx`
- `src/components/tracker/ui/widgets/SegmentFilter.tsx`
- `src/components/ui/date-range-picker.tsx` — popover + 두 Calendar (재사용 가능한 공용 컴포넌트, Tracker 외에도 쓸 수 있음)

## 6. 결정 사항 (Design에서 확정)

1. **이탈 페이지 정의**:
   - bounce(1페이지짜리 세션)는 이탈에 포함하나 표시 분리하나
   - exit_page NULL fallback (마지막 PAGE_VIEW) 적용 여부
2. **세그먼트 필터 적용 범위**:
   - KPI 7개 모두 / 일부만(예: 디바이스는 visitor 단위라 KPI 다 적용, 채널은 session 단위라 visitor 카운트엔 영향 어떻게)
3. **URL sync 범위**:
   - 기간만 / 필터까지 모두
4. **DateRangePicker 위치**:
   - `src/components/ui/` 공용 / `src/components/tracker/ui/widgets/` 전용
5. **소재 위젯 표시**:
   - 단순 TOP만 / 리드율까지 (집계 비용 ↑)

## 7. Definition of Done

- [ ] 이탈 페이지 TOP10 표시 (exit_page + fallback)
- [ ] 세그먼트 필터 (디바이스 + 채널) 단일 선택 동작, 활성 칩 + 해제
- [ ] 사용자지정 기간 picker 동작, URL `?from&to` 보존 + 새로고침 유지
- [ ] 광고 소재 TOP 위젯 표시 (운영 데이터 9종 노출 확인)
- [ ] excludePaths 정책 유지 (이탈 페이지에도 적용)
- [ ] tsc 통과, 각 파일 200줄 이내
- [ ] 운영 덤프 위 실측 확인
- [ ] gap-detector Match Rate ≥ 90%

## 8. 리스크 / 주의

- **exit_page 누락 26%**: fallback(마지막 PAGE_VIEW) 처리. 그래도 SESSION_END 안 온 케이스가 운영에서 더 많을 가능성 → 데이터 확인 후 정책 조정 가능
- **필터 + 기간 + URL state 복잡도**: useState 3개 + URL sync 동시 관리. 1차에선 단일 selection만 허용해 복잡도 제한
- **classifyInflow가 JS 후처리**: 채널 필터링도 결국 in-memory. 운영 규모(sessions 1.9K)는 OK, 장기적으론 traffic_source 컬럼 채워서 SQL로 이전 고려
- **DateRangePicker 컴포넌트 신규 작성**: shadcn에 없음. Calendar 2개 popover로 단순 조립 — 외부 라이브러리 추가 없음

## 9. 다음 단계

- `/pdca design tracker-marketing-v1` — 결정사항 5개 확정 + API 스키마/UI 명세
- Design 통과 후 `/pdca do tracker-marketing-v1`로 구현
- 완료 시 [로드맵 진척 표](./tracker-marketing-roadmap.plan.md#6-진척-추적)에서 Phase 1 → ✅ 갱신
