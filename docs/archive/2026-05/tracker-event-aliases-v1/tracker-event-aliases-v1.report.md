# Report: tracker-event-aliases-v1 (이벤트 이름 별칭 매핑)

> 완료일: 2026-05-29
> Match Rate: 95%
> 이터레이션: 1회

## 개요

운영자(마케터)가 raw 이벤트 이름(`hero`, `service-cta` 등)에 한글 라벨을 매핑하고,
분석 화면(EngagementCard)이 라벨 우선으로 표시하는 기능 완성.

## 주요 구현

### 신규
- `drizzle/0056_tracker_event_aliases.sql` — 마이그레이션 (UNIQUE 제약 포함)
- `src/lib/db/schema.ts` — `trackerEventAliases` Drizzle 정의
- `src/lib/tracker/event-alias-validations.ts` — zod (빈 라벨 허용)
- `src/components/tracker/types/event-alias.ts` — 응답 타입
- `src/app/api/tracker/event-aliases/route.ts` — GET (발생수 LEFT JOIN) / POST (UNIQUE 409)
- `src/app/api/tracker/event-aliases/[id]/route.ts` — PATCH (label만) / DELETE (orgId 격리)
- `src/app/api/tracker/sites/[id]/event-name-options/route.ts` — 자동완성용 실발생 이벤트 목록
- `src/components/tracker/hooks/useEventAliases.ts` — SWR + engagement SWR 자동 무효화
- `src/components/tracker/hooks/useEventNameOptions.ts` — 자동완성 데이터 SWR hook
- `src/components/tracker/ui/EventAliasesCard.tsx` — 설정 탭 카드 (표 + 필터 토글)
- `src/components/tracker/ui/EventAliasEditorDialog.tsx` — 신규/편집 다이얼로그 (datalist 자동완성)

### 변경
- `src/app/api/tracker/analytics/engagement/route.ts` — sections/clicks에 alias LEFT JOIN
- `src/components/tracker/types/engagement.ts` — label 필드 추가
- `src/components/tracker/ui/widgets/EngagementCard.tsx` — NameCell (label || name)
- `src/components/tracker/ui/TrackerSettingsPanel.tsx` — EventAliasesCard 추가

## 핵심 설계 결정

| 결정 | 내용 |
|------|------|
| 자동완성 방식 | Combobox 컴포넌트 없어 native datalist 사용. 직접 입력도 허용. |
| 빈 라벨 허용 | label="" 저장 가능, UI에서 raw로 fallback |
| SWR 무효화 | 라벨 CUD 시 engagement analytics SWR 키 일괄 무효화 |
| orgId 격리 | loadOwned() — alias → site JOIN으로 orgId 검증 |
| 분석 JOIN | 단일 SELECT + LEFT JOIN, 별도 라운드트립 없음 |

## 검증

- tsc --noEmit: 통과
- 200줄 룰: 전체 통과 (최대 200줄)
- UNIQUE 위반 409: POST 핸들러 catch 블록에서 constraint 이름으로 판별
- 미완: 디하 site_id=1 실측 (수동 확인 필요)

## 다음 사이클 후보

- tracker-engagement-inline-edit-v1: 마케팅 탭에서 이벤트 이름 클릭 → 인라인 라벨 편집
