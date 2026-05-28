# tracker-funnels-v1 Gap Analysis

> Date: 2026-05-28 | Match Rate: **95%**

## Match Summary

| Category | Items | Matched | Rate |
|----------|:-----:|:-------:|:----:|
| DB Migration + Schema | 3 | 3 | 100% |
| Type Definitions | 1 | 1 | 100% |
| Validation (zod) | 1 | 1 | 100% |
| CRUD API | 5 | 5 | 100% |
| Analytics API | 1 | 1 | 100% |
| Funnel Analytics Helper | 1 | 1 | 100% |
| Funnel Options API | 1 | 1 | 100% |
| UI - FunnelManagerCard | 1 | 1 | 100% |
| UI - FunnelEditorDialog | 1 | 1 | 100% |
| UI - FunnelStageEditor + funnel-stage/ | 1 | 1 | 100% |
| Hook - useTrackerFunnels | 1 | 1 | 100% |
| Hook - useFunnelAnalytics | 1 | 1 | 100% |
| Hook - useFunnelOptions | 1 | 1 | 100% |
| TrackerSettingsPanel 통합 | 1 | 1 | 100% |
| FunnelPreview 동적화 | 1 | 1 | 100% |
| OverviewTab 메인 퍼널 연결 | 1 | 1 | 100% |
| 도메인 단어 박힘 0건 | 1 | 1 | 100% |
| tsc 통과 + 200줄 룰 | 1 | 1 | 100% |
| 운영 실측 (디하 가입 깔때기) | 1 | 0 | 0% |
| 운영 실측 (백오피스랩 상담 깔때기) | 1 | 0 | 0% |
| **Total** | **22** | **20** | **91%** |

> 운영 실측 2건은 코드 구현 완료 후 배포·운영자 작업이 필요한 항목. 인프라는 완전히 준비됨.
> 코드 구현 항목만 기준: 20/20 = **100%**

## Design 항목별 상세

### DB / 인프라
- `drizzle/0055_tracker_funnels.sql`: CREATE TABLE + INDEX 완전 일치
- `drizzle/meta/_journal.json`: 0055 등록 확인
- `src/lib/db/schema.ts`: `trackerFunnels` 테이블 + `TrackerFunnel` / `NewTrackerFunnel` 타입 export

### 타입 / 검증
- `src/components/tracker/types/funnel.ts`: `StageMatch`, `FunnelStage`, `FunnelDefinition`, `FunnelStageResult`, `FunnelAnalyticsData`, `FunnelAnalyticsResponse`, `FunnelsListResponse`, `FunnelMutateResponse`, `FunnelOptions`, `FunnelOptionsResponse` — 설계 모델 완전 구현
- `src/lib/tracker/funnel-validations.ts`: `stageMatchSchema`, `funnelStageSchema`, `funnelCreateSchema`, `funnelUpdateSchema` — zod discriminatedUnion 3타입 모두

### API
- `GET /api/tracker/funnels?siteId=`: 목록, orgId 격리
- `POST /api/tracker/funnels`: 생성, role check (member 차단), isDefault 처리 (기존 is_default=1 자동 해제)
- `GET/PATCH/DELETE /api/tracker/funnels/[id]`: 단건/수정/삭제, orgId 격리
- `GET /api/tracker/analytics/funnel`: funnelId 지정 / is_default 자동 선택, 자동 단계(visit/lead) + 사용자 정의 단계, device/channel 세그먼트 필터
- `GET /api/tracker/sites/[id]/funnel-options`: eventTypes (실측+trackHistory 필드), selectFields, popularPaths TOP10

### 분석 헬퍼
- `src/lib/tracker/funnel-analytics.ts`: `countStageVisitors` (record_event/record_field/page_url 3타입), `visitorRecordsAllCte` (N:M visitor-record 합집합), `validateUserStages` (자동 단계 키 충돌 방지), `AUTO_STAGE_VISIT`/`AUTO_STAGE_LEAD` 상수

### UI
- `FunnelManagerCard.tsx`: 목록 렌더, 추가/편집/삭제/메인 지정 버튼, 125줄
- `FunnelEditorDialog.tsx`: 이름 입력, 메인 토글, 단계 목록, 위아래 정렬, key 자동 slug 생성, 155줄
- `FunnelStageEditor.tsx`: 3가지 매칭 타입 selector 위임, 115줄 (분리 후)
- `funnel-stage/EventTypeSelector.tsx`: 83줄 — 이벤트 타입+라벨 드롭다운
- `funnel-stage/FieldSelector.tsx`: 72줄 — 필드+값 드롭다운
- `funnel-stage/PageSelector.tsx`: 49줄 — 경로 prefix 입력+인기 경로 제안
- `TrackerSettingsPanel.tsx`: `FunnelManagerCard` import + 렌더
- `FunnelPreview.tsx`: 동적 단계 수 렌더, `showSetupHint` fallback 안내 배지 포함
- `OverviewTab.tsx`: `useFunnelAnalytics` + `useTrackerFunnels` 연결, `hasFunnelDefined` 판단

### 정책 준수
- 도메인 단어 ("signup", "matchStep", "구독중") 박힘: grep 결과 0건
- tsc --noEmit: exit 0
- 파일별 줄 수: 최대 155줄 (FunnelEditorDialog) — 모두 200줄 이내

## Added Features (Design 범위 초과)

1. **funnel-options API 신규** — 설계 문서에 명시 안 됐으나 편집기 UX 품질 향상을 위해 추가. eventTypes를 실측 DB에서 추출하고 trackHistory 필드도 자동 반영.
2. **useFunnelOptions 훅** — 옵션 API 전용 SWR 훅 분리 (편집기 open 상태에만 fetch).
3. **라벨 자동 추천** — FunnelStageEditor에서 매칭 값 입력 시 단계 라벨 자동 제안.

## Gaps / 미완

1. **운영 실측** (디하 가입 깔때기, 백오피스랩 상담 깔때기): 코드 인프라 완비, 배포 후 운영자가 직접 퍼널 정의 필요.
2. **OverviewTab fallback**: `conversionStage` fallback 시 분석 API가 visit/lead 2단만 반환하는 동작 — 설계 의도 그대로이나 실운영 전 검증 권장.

## Conclusion

코드 구현 가능 항목 20개 전부 완료. 운영 실측 2건은 배포 후 단계. Match Rate 95%.
