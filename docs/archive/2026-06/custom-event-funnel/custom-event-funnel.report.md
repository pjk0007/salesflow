# Completion Report: custom-event-funnel

## 1. 개요

| 항목 | 값 |
|------|------|
| Feature | Custom Event Funnel (행동 퍼널 분리) |
| Branch | feat/custom-event-funnel |
| 시작일 | 2026-06-04 |
| 완료일 | 2026-06-05 |
| Match Rate | 97% (29/30) |
| Gap | G-01 텍스트 오류 1건 → 즉시 수정 완료 |
| Iteration | 0회 (초기 구현에서 97% 달성) |

## 2. 문제 및 해결

### 문제
기존 "구독 전환 흐름" 퍼널에 `custom_event` 단계(subscribe_step)와 `record_field` 단계(신청완료/구독중)를 한 퍼널에 혼합했더니 sequential 역산 오집계 발생. 실제 step_1 도달자 1명 → 역산으로 9명으로 잘못 집계됨.

근본 원인: custom_event(행동 = "실제 발생했는가")와 record_field(상태 = "이 상태에 도달한 적 있는가")는 차원이 달라 cumulative 역산을 공유할 수 없음.

### 해결
`tracker_funnels.kind` 컬럼으로 퍼널 종류 분리:
- `kind='marketing'`: 기존 로직 완전 불변 (방문/리드 자동단계 + cumulative 역산)
- `kind='event'`: 각 custom_event 단계의 실제 발생 visitor 수만 카운트 (역산 미적용)

행동 퍼널 전용 화면(행동 탭 + EventFunnelCard)을 신설해 마케팅 탭 과밀 해소 및 보는 질문(유입 vs 행동 이탈) 분리.

## 3. 구현 내용

### Phase 1: Kind 구분 + 카운트 분기

| 파일 | 변경 내용 |
|------|-----------|
| `drizzle/0059_tracker_funnel_kind.sql` | tracker_funnels.kind 컬럼 추가 (default 'marketing') |
| `src/lib/db/schema.ts` | trackerFunnels.kind: varchar(20) |
| `src/lib/tracker/funnel-validations.ts` | funnelKindSchema, funnelCreateSchema/funnelUpdateSchema에 kind 추가 |
| `src/components/tracker/types/funnel.ts` | FunnelKind 타입, FunnelDefinition.kind, FunnelAnalyticsData.funnel.kind |
| `src/app/api/tracker/analytics/funnel/route.ts` | kind='event' 분기: 역산 미적용 + 방문 모수만, 응답에 kind 추가 |
| `src/app/api/tracker/funnels/route.ts` | POST에 kind 저장 |
| `src/app/api/tracker/funnels/[id]/route.ts` | PATCH에 kind 업데이트 |

### Phase 2: 퍼널 관리 UI

| 파일 | 변경 내용 |
|------|-----------|
| `src/components/tracker/ui/FunnelEditorDialog.tsx` | kind 선택 2-card 토글(신규), 편집 시 종류 잠금, event 모드 UI 분기(자동단계 안내 숨김/isDefault 숨김), initialKind prop |
| `src/components/tracker/ui/FunnelManagerCard.tsx` | 마케팅/행동 2섹션 분리, 섹션별 추가 버튼, 심을 코드 스니펫 행동 섹션 내 이동 |

### Phase 3: 행동 퍼널 위젯 + 행동 탭

| 파일 | 변경 내용 |
|------|-----------|
| `src/components/tracker/ui/widgets/EventFunnelCard.tsx` | 신규 — event 퍼널 드롭다운 + 단계별 막대 + 전환율/이탈율 + 빈 상태 안내 |
| `src/components/tracker/ui/BehaviorTab.tsx` | 신규 — ControlBar + EventFunnelCard + EngagementCard 컨테이너 |
| `src/components/tracker/ui/VisitorListPage.tsx` | 행동 탭 추가 (?tab=behavior, Activity 아이콘) |
| `src/components/tracker/ui/MarketingTab.tsx` | EventFunnelCard + EngagementCard 제거 (행동 탭으로 이동) |

### 선행 완료분 (이번 PDCA에서 활용)

- `custom_event` StageMatch 타입 + getStageVisitorIds 매칭
- 이벤트 라벨 카드(tracker_event_aliases) 단일화
- 타임라인 CUSTOM 이벤트 표시(라벨/단계행/입력항목 filled_keys)
- 퍼널 드롭다운 커스텀 이벤트 목록(funnel-options/route.ts)

## 4. 설계 결정 (Design v0.2)

| 결정 | 선택 | 이유 |
|------|------|------|
| 퍼널 종류 | tracker_funnels.kind 컬럼 | 새 테이블 없이 stages/분석/CRUD 재사용, default 'marketing' → 기존 무영향 |
| 행동 카운트 | 역산 미적용 (실제 발생) | 상태 도달자 오집계(9명 버그) 제거 |
| 모수 | 방문 코호트 | 마케팅 퍼널과 일관, 전체 흐름 파악 가능 |
| 표시 위치 | 행동 탭 신설 (v0.2 변경) | 마케팅 탭 위젯 8개 과밀 해소, 유입 vs 행동 질문 분리 |
| 종류 변경 | 편집 시 잠금 | kind별 카운트 로직 달라 사후 변경 시 데이터 의미 훼손 |

## 5. Gap 내역

| ID | 항목 | 분류 | 처리 |
|----|------|------|------|
| G-01 | FunnelManagerCard 행동 섹션 안내 "마케팅 탭" → "행동 탭" | 텍스트 오류 (기능 무영향) | 수정 완료 (2026-06-05) |

## 6. 검증

- tsc/lint: 0 에러 (사용자 확인)
- 커밋·푸시: 완료 (branch feat/custom-event-funnel, 커밋 b4927bb~cccce0e)
- 기존 marketing 퍼널 회귀: kind default 'marketing' + else 분기 불변으로 보장
- 실제 데이터 SQL 대조: 운영 환경 별도 검증 필요 (Phase 4)

## 7. 성과

기존 오집계 버그(행동 단계에 역산 적용 → step_1 1명이 9명으로 집계) 구조적 해결.
마케팅 퍼널(상태/전환)과 행동 퍼널(이벤트/이탈)을 개념·데이터·화면에서 완전 분리.
YAGNI 원칙 준수 — 순서 strict 검사, 별도 테이블, 전용 탭 초기 분리 등 불필요한 추상화 없이 kind 컬럼 단일 추가로 해결.
