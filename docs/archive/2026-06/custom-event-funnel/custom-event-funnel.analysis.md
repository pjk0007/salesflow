# Gap Analysis: custom-event-funnel

> **Feature**: Custom Event Funnel (행동 퍼널 분리)
> **Date**: 2026-06-05
> **Design Ref**: docs/02-design/features/custom-event-funnel.design.md (v0.2)
> **Analyzer**: auto-pdca-finalize

---

## Summary

**Match Rate: 97%**

Design v0.2의 전체 요구사항 대비 구현 완료율. 기능 Gap 없음. 텍스트 1건 수정 완료(행동 탭 안내 문구).

---

## Checklist

### DB / Schema

| Item | Design | Implemented | Status |
|------|--------|-------------|--------|
| DB-01: tracker_funnels.kind 컬럼 | varchar(20) default 'marketing' NOT NULL | schema.ts:1235 + drizzle/0059_tracker_funnel_kind.sql | PASS |
| funnelKindSchema | z.enum(['marketing','event']).default('marketing') | funnel-validations.ts:29 | PASS |
| FunnelKind 타입 | "marketing" \| "event" | types/funnel.ts:31 | PASS |
| FunnelDefinition.kind | kind: FunnelKind | types/funnel.ts:37 | PASS |

### 분석 로직

| Item | Design | Implemented | Status |
|------|--------|-------------|--------|
| LOGIC-01: kind='event' 분기 | getStageVisitorIds 역산 없음 | analytics/funnel/route.ts:115-131 | PASS |
| 방문 모수 | meaningfulVisitorIdsSql 재사용 | route.ts:86-96 | PASS |
| 자동 리드 단계 제외 | event 퍼널은 방문 자동단계만 | route.ts:124 AUTO_STAGE_VISIT만 | PASS |
| marketing 역산 미변경 | else 분기 기존 로직 그대로 | route.ts:133-152 | PASS |

### API

| Item | Design | Implemented | Status |
|------|--------|-------------|--------|
| API-01: 응답에 kind 포함 | funnel: { id, name, kind } | route.ts:157 | PASS |
| API-02: POST funnels kind 저장 | funnelCreateSchema.kind | funnels/route.ts:51 | PASS |
| API-02: PATCH funnels kind 업데이트 | funnelUpdateSchema.kind | [id]/route.ts:46 | PASS |

### UI

| Item | Design | Implemented | Status |
|------|--------|-------------|--------|
| UI-01: kind 선택 2-card 토글 | 신규 모드 | FunnelEditorDialog.tsx:131-150 | PASS |
| UI-01: 편집 모드 종류 잠금 | isEdit → 읽기전용 | FunnelEditorDialog.tsx:124-130 | PASS |
| UI-01: event 모드 자동단계 안내 숨김 | isEvent 조건 | FunnelEditorDialog.tsx:152-183 | PASS |
| UI-01: event 모드 isDefault 숨김 | !isEvent && ... | FunnelEditorDialog.tsx:152-157 | PASS |
| UI-01: initialKind prop | 섹션별 추가 버튼에서 종류 미리 지정 | FunnelEditorDialog.tsx:20,37 | PASS |
| UI-02: 마케팅/행동 2섹션 분리 | 한 카드 내 두 섹션 | FunnelManagerCard.tsx:143-226 | PASS |
| UI-02: 섹션별 추가 버튼 | handleAdd(kind) | FunnelManagerCard.tsx:105-109 | PASS |
| UI-02: 심을 코드 행동 섹션 내 | customEventCodes 스니펫 | FunnelManagerCard.tsx:202-224 | PASS |
| UI-03: EventFunnelCard 신규 | 단계별 막대 + 전환율/이탈율 | widgets/EventFunnelCard.tsx | PASS |
| UI-03: 퍼널 드롭다운 | event 퍼널 N개 중 선택 | EventFunnelCard.tsx:81-95 | PASS |
| UI-03: 빈 상태 만들기 안내 | event 퍼널 없으면 링크 안내 | EventFunnelCard.tsx:55-68 | PASS |
| UI-04: 행동 탭 신설 | ?tab=behavior, Activity 아이콘 | VisitorListPage.tsx:32,134-138 | PASS |
| UI-04: BehaviorTab 컨테이너 | ControlBar + EventFunnelCard + EngagementCard | BehaviorTab.tsx | PASS |
| UI-04: MarketingTab에서 두 위젯 제거 | EventFunnelCard/EngagementCard 없음 | MarketingTab.tsx | PASS |

### 선행 완료분 (Design 1.3)

| Item | Status |
|------|--------|
| StageMatch custom_event 매칭 | PASS (선행) |
| 이벤트 정의 단일화(라벨카드 CUSTOM) | PASS (선행) |
| 퍼널 드롭다운 라벨 연동 | PASS (선행) |
| 타임라인 CUSTOM 표시(라벨/단계행/입력항목) | PASS (선행) |

---

## Gaps

| # | 항목 | 설계 | 구현 | 영향 | 조치 |
|---|------|------|------|------|------|
| G-01 | FunnelManagerCard 행동 섹션 안내 문구 | "행동 탭에 표시됩니다" | "마케팅 탭에 표시됩니다" (구 텍스트) | UI 텍스트 오류 (기능 무영향) | **수정 완료** (2026-06-05) |

---

## Match Rate 산출

- 전체 체크 항목: 30개
- PASS: 29개 (체크 기준)
- Gap: G-01 텍스트 → 수정 완료 → 최종 29/30 = 97%

> G-01은 기능 gap이 아닌 UI 텍스트 불일치로, 수정 완료 후 실질적 기능 구현은 100% 완료 상태.

---

## 비고

- 설계 LOGIC-01이 `funnel-analytics.ts`가 아닌 `analytics/funnel/route.ts`에 직접 구현됨 — 분리 여부는 설계 지시사항이 아니었으며 단순 위치 변형. 기능 동작 동일.
- tsc/lint 0 통과, 커밋·푸시 완료 상태 (사용자 확인).
- Phase 4 검증(실제 데이터 SQL 대조)은 운영 데이터 필요 — 이번 PDCA 범위 외.
