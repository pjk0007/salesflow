# Completion Report: tracker-funnels-v1 (Phase 2 — 사용자정의 퍼널)

> Date: 2026-05-28 | Match Rate: 95% | Status: Completed

## PDCA Cycle Summary

```
[Plan] ✅ → [Design] ✅ → [Do] ✅ → [Check] ✅ (95%) → [Report] ✅
```

## 1. Feature Overview

사이트별로 마케팅 퍼널 단계를 직접 정의할 수 있는 기능. 기존에 코드에 박혀있던 "signup", "match_stage" 등 도메인 단어를 제거하고, 디하/백오피스랩/픽셀앤로직 등 서로 다른 도메인의 사이트가 각자의 퍼널 단계를 설정 UI에서 정의하면 개요 탭에서 단계별 도달률/이탈률을 시각화할 수 있게 함.

방문/리드는 자동 단계로 고정, 3단부터 3가지 매칭 방식(행동 이벤트/현재 상태/페이지 도달)으로 사용자가 직접 정의.

## 2. Deliverables

### 2.1 DB Layer
| File | Change |
|------|--------|
| `drizzle/0055_tracker_funnels.sql` | tracker_funnels 테이블 + site_idx 인덱스 신규 생성 |
| `drizzle/meta/_journal.json` | 0055 마이그레이션 등록 |
| `src/lib/db/schema.ts` | `trackerFunnels` 테이블 정의 + `TrackerFunnel`/`NewTrackerFunnel` 타입 |

### 2.2 Type / Validation Layer
| File | Change |
|------|--------|
| `src/components/tracker/types/funnel.ts` | `StageMatch`, `FunnelStage`, `FunnelDefinition`, `FunnelStageResult`, `FunnelAnalyticsData`, `FunnelAnalyticsResponse`, `FunnelsListResponse`, `FunnelMutateResponse`, `FunnelOptions`, `FunnelOptionsResponse` |
| `src/lib/tracker/funnel-validations.ts` | zod: `stageMatchSchema` (discriminatedUnion 3타입), `funnelStageSchema`, `funnelCreateSchema`, `funnelUpdateSchema` |

### 2.3 API Layer
| File | Change |
|------|--------|
| `src/app/api/tracker/funnels/route.ts` | GET (목록) + POST (생성, member 차단, isDefault 단일화) |
| `src/app/api/tracker/funnels/[id]/route.ts` | GET (단건) + PATCH (수정) + DELETE (삭제), orgId 격리 |
| `src/app/api/tracker/analytics/funnel/route.ts` | funnelId 지정/is_default 자동 선택, 자동 단계+사용자 정의 단계 집계, device/channel 세그먼트 필터 |
| `src/app/api/tracker/sites/[id]/funnel-options/route.ts` | 편집기용 옵션 데이터: eventTypes(실측+trackHistory), selectFields, popularPaths TOP10 |

### 2.4 Analytics Helper
| File | Change |
|------|--------|
| `src/lib/tracker/funnel-analytics.ts` | `countStageVisitors` (3타입 쿼리), `visitorRecordsAllCte` (N:M visitor-record 합집합), `validateUserStages`, `AUTO_STAGE_VISIT`/`AUTO_STAGE_LEAD` |

### 2.5 Hook Layer
| File | Change |
|------|--------|
| `src/components/tracker/hooks/useTrackerFunnels.ts` | SWR 훅 + `createFunnel`/`updateFunnel`/`deleteFunnel` mutate 함수 |
| `src/components/tracker/hooks/useFunnelAnalytics.ts` | 분석 데이터 SWR 훅 |
| `src/components/tracker/hooks/useFunnelOptions.ts` | 편집기 옵션 SWR 훅 (open 상태에만 fetch) |

### 2.6 UI Layer
| File | Change |
|------|--------|
| `src/components/tracker/ui/FunnelManagerCard.tsx` | 퍼널 목록/추가/편집/삭제/메인 지정 카드 (125줄) |
| `src/components/tracker/ui/FunnelEditorDialog.tsx` | 이름·단계 편집 다이얼로그, 위아래 정렬, key slug 자동 생성 (155줄) |
| `src/components/tracker/ui/FunnelStageEditor.tsx` | 단계 행 컴포넌트 — 3가지 매칭 타입 selector 위임 (115줄) |
| `src/components/tracker/ui/funnel-stage/EventTypeSelector.tsx` | 이벤트 타입+라벨 드롭다운 (83줄) |
| `src/components/tracker/ui/funnel-stage/FieldSelector.tsx` | 필드+값 드롭다운 (72줄) |
| `src/components/tracker/ui/funnel-stage/PageSelector.tsx` | 경로 prefix 입력+인기 경로 제안 (49줄) |
| `src/components/tracker/ui/funnel-stage/constants.ts` | 매칭 타입 상수 |
| `src/components/tracker/ui/funnel-stage/utils.ts` | `slugify`, `defaultMatchFor` 유틸 |
| `src/components/tracker/ui/TrackerSettingsPanel.tsx` | `FunnelManagerCard` 추가 (변경) |
| `src/components/tracker/ui/widgets/FunnelPreview.tsx` | 동적 단계 렌더링, `showSetupHint` fallback 안내 배지 (변경) |
| `src/components/tracker/ui/OverviewTab.tsx` | `useFunnelAnalytics`+`useTrackerFunnels` 연결, `hasFunnelDefined` 판단 (변경) |

## 3. Additional Improvements (Design 범위 초과)

| Feature | Description | Impact |
|---------|-------------|--------|
| funnel-options API | 편집기에서 사용할 이벤트/필드/경로 옵션을 실측 DB에서 추출 | 운영자가 raw text 대신 드롭다운으로 선택 가능 |
| trackHistory 필드 자동 반영 | trackHistory=1 select 필드의 옵션이 행동 이벤트 후보로 자동 등장 | 설정 수정 없이 퍼널 편집기에서 바로 사용 가능 |
| 라벨 자동 추천 | 매칭 값 입력 시 단계 라벨 자동 채움 | 편집기 UX 개선, 빈 라벨 실수 방지 |
| FunnelStageEditor 컴포넌트 분리 | 317줄 → funnel-stage/ 폴더로 selector 3개+utils+constants 분리 → 115줄 | 200줄 룰 준수, 단위 테스트 가능 구조 |

## 4. Quality Metrics

| Metric | Value |
|--------|-------|
| Match Rate | 95% (20/22, 운영 실측 2건 제외 시 100%) |
| TypeScript Errors | 0 |
| Files Created | 20 |
| Files Changed | 3 (TrackerSettingsPanel, FunnelPreview, OverviewTab) |
| Max File Lines | 155줄 (FunnelEditorDialog) |
| Iteration Count | 0 (first pass, tsc 통과 상태로 완료) |
| Domain Words Hardcoded | 0건 |

## 5. Pending (운영 단계)

| Item | Description |
|------|-------------|
| 디하 운영 실측 | 설정 탭 → 퍼널 추가 → "가입 깔때기" 정의 (signup / match_stage 이벤트 기반) → 개요 탭 동적 렌더 확인 |
| 백오피스랩 실측 | "상담 깔때기" 정의 (consult/status 이벤트 기반) → 같은 코드로 다른 단계 표시 확인 (범용성 검증) |

## 6. Next Steps

- Phase 2.5: 기간 비교(compare-v1) — `/pdca plan tracker-compare-v1`
- 로드맵 Phase 2 → ✅ 갱신 (`docs/01-plan/features/tracker-marketing-roadmap.plan.md`)
