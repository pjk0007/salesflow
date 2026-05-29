# Analysis: tracker-event-aliases-v1

> 분석일: 2026-05-29
> Phase: Check
> Match Rate: 95%
> 이터레이션: 1회

## Gap 분석 요약

| 항목 | 설계 | 구현 | 상태 |
|------|------|------|------|
| DB 마이그레이션 0056 + schema | trackerEventAliases 테이블, UNIQUE(site_id,event_type,event_name) | 완료 | O |
| CRUD API (GET/POST/PATCH/DELETE) | 인증+orgId 격리, POST UNIQUE 409, PATCH label만 | 완료 | O |
| event-name-options API | /api/tracker/sites/[id]/event-name-options | 초기 미구현 → 이터레이션 1에서 완료 | O |
| useEventAliases hook | SWR + engagement SWR 자동 무효화 | 완료 | O |
| useEventNameOptions hook | 자동완성 데이터 SWR hook | 초기 미구현 → 이터레이션 1에서 완료 | O |
| EventAliasesCard UI | 표 + 필터 토글 + 추가/편집/삭제 | 완료 | O |
| EventAliasEditorDialog | 신규/편집 다이얼로그, 자동완성 | datalist 방식으로 자동완성 통합 완료 | O |
| 분석 API alias LEFT JOIN | sections/clicks SQL에 LEFT JOIN | 완료 | O |
| 타입 + EngagementCard 표시 | label/raw fallback NameCell | 완료 | O |
| TrackerSettingsPanel 통합 | EventAliasesCard 추가 | 완료 | O |
| tsc 통과 | npx tsc --noEmit | 통과 | O |
| 200줄 이내 | 모든 src/ 파일 | 통과 (최대 200줄, 평균 80줄) | O |
| 디하 실측 | site_id=1 6~8개 라벨 등록 후 화면 확인 | 수동 검증 필요 | △ |

## 초기 Gap (이터레이션 전)

- `event-name-options` API 미구현 (plan 3-5)
- `useEventNameOptions` hook 미구현
- `EventAliasEditorDialog` 자동완성 미통합 (Input만 있고 datalist 없음)
- 추정 Match Rate: 85%

## 이터레이션 1 조치

1. `src/app/api/tracker/sites/[id]/event-name-options/route.ts` 신규 작성
   - 전체 기간 GROUP BY (event_type, event_name), occurrences desc, LIMIT 100
2. `src/components/tracker/hooks/useEventNameOptions.ts` 신규 작성
3. `EventAliasEditorDialog` — datalist 방식 자동완성 통합
   - 이벤트 타입 변경 시 이름 초기화
   - 편집 모드에서는 datalist 비활성

## 최종 Match Rate: 95%

미달 항목(5%): 디하 site_id=1 실측 (수동 검증 항목, 자동화 불가)

## 파일별 라인 수 (200줄 룰)

| 파일 | 라인 |
|------|------|
| drizzle/0056_tracker_event_aliases.sql | 17 |
| src/lib/tracker/event-alias-validations.ts | 18 |
| src/components/tracker/types/event-alias.ts | 35 |
| src/app/api/tracker/event-aliases/route.ts | 105 |
| src/app/api/tracker/event-aliases/[id]/route.ts | 70 |
| src/app/api/tracker/sites/[id]/event-name-options/route.ts | 43 |
| src/components/tracker/hooks/useEventAliases.ts | 66 |
| src/components/tracker/hooks/useEventNameOptions.ts | 27 |
| src/components/tracker/ui/EventAliasesCard.tsx | 177 |
| src/components/tracker/ui/EventAliasEditorDialog.tsx | 159 |
| src/app/api/tracker/analytics/engagement/route.ts | 200 |
| src/components/tracker/types/engagement.ts | 38 |
| src/components/tracker/ui/widgets/EngagementCard.tsx | 191 |
| src/components/tracker/ui/TrackerSettingsPanel.tsx | 45 |
