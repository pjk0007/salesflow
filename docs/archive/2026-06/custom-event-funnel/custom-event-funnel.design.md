# 커스텀 이벤트 전용 퍼널 Design Document

> **Summary**: CUSTOM 트래커 이벤트(행동) 기반 퍼널을 마케팅 퍼널(상태 기반)과 분리 — kind 구분, 역산 미적용 카운트, 마케팅 탭 행동 퍼널 위젯의 상세 설계
>
> **Project**: Sendb (Salesflow)
> **Author**: jaehun
> **Date**: 2026-06-05
> **Status**: Implemented (v0.2 — 구현 반영)
> **Planning Doc**: [custom-event-funnel.plan.md](../../01-plan/features/custom-event-funnel.plan.md)

---

## 1. Overview

### 1.1 Design Goals

- 기존 `tracker_funnels` 재사용 + `kind`로 마케팅/행동 퍼널 구분 (새 테이블 없음)
- 행동 퍼널은 **각 단계 실제 이벤트 발생 visitor**만 카운트 (cumulative 역산 미적용 → 상태 도달자 오집계 제거)
- 기존 마케팅 퍼널 동작 **완전 불변** (default 'marketing')
- 선행 작업(custom_event 매칭, 이벤트 정의 단일화, 타임라인 표시) 위에 얹기

### 1.2 Design Principles

- **기존 패턴 준수**: tracker_funnels CRUD/분석 API/위젯 구조 그대로, 분기만 추가
- **멀티테넌시**: 코드에 사이트별 단계명 박지 않음 — 사이트가 자기 이벤트로 자기 퍼널 정의
- **무영향 원칙**: kind 컬럼 default 'marketing' → 기존 퍼널·쿼리 회귀 없음
- **단일 출처**: 단계 라벨은 이벤트 라벨 카드(tracker_event_aliases)에서 (선행 완료)

### 1.3 선행 완료분 (브랜치 feat/custom-event-funnel)

| 항목 | 상태 | 위치 |
|------|------|------|
| StageMatch에 custom_event 매칭 | ✅ 완료 | `types/funnel.ts`, `funnel-analytics.ts` |
| 이벤트 정의 단일화(라벨카드 CUSTOM) | ✅ 완료 | `EventAliasesCard.tsx`, `event-aliases/route.ts` |
| 퍼널 드롭다운 라벨 연동 | ✅ 완료 | `funnel-options/route.ts`, `CustomEventSelector.tsx` |
| 타임라인 CUSTOM 표시(라벨/단계행/입력항목) | ✅ 완료 | `journey/route.ts`, `JourneyEventDetail.tsx` |
| 디하 sendb.track 발사 | ✅ 완료 | new-designer-hire (별도 레포) |
| **kind 구분 + 역산 분기** | ⬜ 본 설계 | 신규 |
| **행동 퍼널 분석 위젯** | ⬜ 본 설계 | 신규 |

---

## 2. Architecture

### 2.1 퍼널 종류 분리

```
tracker_funnels (kind 컬럼 추가)
│
├── kind = 'marketing'  (기존, default)
│   ├── 단계: 방문(자동) → 리드(자동) → record_field / page_url
│   ├── 카운트: computeSequentialStageCounts (cumulative 역산)
│   │           = 상위 단계 도달자는 하위도 통과한 것으로 카운트
│   ├── 모수: 방문 코호트
│   └── 화면: 개요 탭 FunnelPreview (메인 1개)
│
└── kind = 'event'  (신규)
    ├── 단계: custom_event 단계만 (방문/리드 자동단계 없음, 방문만 모수 표시)
    ├── 카운트: 각 단계 getStageVisitorIds 결과를 역산 없이 그대로
    │           = 그 이벤트를 실제 발생시킨 visitor 수
    ├── 모수: 방문 코호트 (Plan 결정 2 — 방문 기준)
    └── 화면: 행동 탭 EventFunnelCard (N개, 드롭다운 선택)
```

> **표시 위치 변경 (v0.2)**: Plan/Design 초안은 "마케팅 탭 위젯"이었으나, 마케팅 탭이 위젯 8개로 과밀해 행동 퍼널이 묻혔다. 마케팅(유입/채널/광고)과 행동(사이트 내 행동)은 보는 질문이 달라(Plan 1.2 참조) **행동 탭을 신설**해 분리했다. 행동 탭 = 행동 퍼널 + 페이지 인게이지먼트(섹션 시인·클릭).

### 2.2 카운트 Data Flow

```
GET /api/tracker/analytics/funnel?siteId&funnelId&from&to[&channel&device]
      ↓
funnel 조회 → funnel.kind 확인
      ↓
세그먼트 필터(채널/디바이스) → meaningfulVisitorIds (공통)
      ↓
 ┌── kind='marketing' ──────────────────────────┐
 │  방문/리드 자동단계 카운트                      │
 │  + computeSequentialStageCounts(stages) 역산   │
 │  → 기존 로직 그대로                            │
 └────────────────────────────────────────────┘
 ┌── kind='event' ──────────────────────────────┐
 │  방문 = 모수 (100% 기준)                       │
 │  각 custom_event 단계:                         │
 │    getStageVisitorIds(ctx, match) 크기 그대로  │
 │    (역산 없음, maxIdx 미적용)                  │
 │  단계간 전환율 = 단계[i].visitors / 단계[i-1]  │
 └────────────────────────────────────────────┘
      ↓
stages[] (label, visitors, dropoffRate) 반환
```

### 2.3 Dependencies

| Component | Depends On | Purpose |
|-----------|-----------|---------|
| tracker_funnels.kind | (스키마) | 퍼널 종류 구분 |
| funnel-analytics (event 분기) | tracker_events(CUSTOM), getStageVisitorIds | 행동 단계 카운트 |
| funnel route | tracker_funnels.kind | kind별 카운트 분기 |
| EventFunnelCard | funnel route, useTrackerFunnels | 행동 퍼널 표시 (행동 탭) |
| BehaviorTab | EventFunnelCard, EngagementCard, ControlBar | 행동 탭 컨테이너 (신설) |
| 단계 라벨 | tracker_event_aliases (선행) | 한글 라벨 |

---

## 3. Detailed Design

### 3.1 데이터 모델

#### DB-01: tracker_funnels.kind 컬럼 추가

```sql
ALTER TABLE tracker_funnels
  ADD COLUMN kind varchar(20) NOT NULL DEFAULT 'marketing';
-- 'marketing' | 'event'
```

- 기존 row 전부 'marketing' → 동작 불변
- 마이그레이션: `drizzle/00xx_tracker_funnel_kind.sql` + journal 등록

schema.ts:
```ts
// tracker_funnels
kind: varchar("kind", { length: 20 }).default("marketing").notNull(),
```

> event 퍼널은 자동단계(방문/리드)를 단계로 안 가지므로 stages는 custom_event만. validation에서 kind='event'면 모든 stage가 custom_event인지 권고(강제는 선택).

### 3.2 분석 로직

#### LOGIC-01: funnel route kind 분기 (`analytics/funnel/route.ts`)

```ts
if (funnel.kind === "event") {
    // 자동단계 없음. 방문(모수)만 100% 기준으로.
    const stageCounts = await Promise.all(
        funnel.stages.map((s) =>
            getStageVisitorIds({ siteId, meaningfulVisitorIdsSql }, s.match)
                .then((set) => set.size)
        )
    );
    stages = [
        { key: "visit", label: "방문", visitors: vRow.visitors, isAuto: true },
        ...funnel.stages.map((s, i) => ({
            key: s.key, label: s.label, visitors: stageCounts[i],
        })),
    ];
} else {
    // 기존 marketing 로직 (방문/리드 자동 + computeSequentialStageCounts)
}
```

- **핵심**: event 퍼널은 `computeSequentialStageCounts`(역산) 호출 안 함 → 각 단계 실제 발생자 수만.
- 모수 "방문"은 기존 `meaningfulVisitorIdsSql`(방문 코호트) 재사용 (Plan 결정 2).
- 리드 자동단계는 event 퍼널에 미포함 (행동 흐름엔 의미 약함).

#### LOGIC-02: 응답에 dropoffRate 포함 (선택)

각 단계 `visitors`와 직전 단계 대비 전환율은 UI에서 계산 가능 → API는 visitors만, 전환율/이탈율은 위젯에서 계산 (기존 FunnelPreview 패턴 동일).

### 3.3 API

#### API-01: GET /api/tracker/analytics/funnel (확장)

- 기존 엔드포인트에 kind 분기만 추가. 시그니처 불변 (`siteId`, `funnelId`, `from`, `to`, `channel`, `device`).
- 응답 `data.funnel`에 `kind` 추가 → UI가 표시 방식 결정.

```ts
data: {
    funnel: { id, name, kind },   // kind 추가
    range: { from, to },
    stages: [{ key, label, visitors, isAuto? }],
}
```

#### API-02: 퍼널 CRUD (`funnels/route.ts`, `[id]/route.ts`)

- POST/PATCH body에 `kind` 추가. validation(`funnel-validations.ts`)에 `kind: z.enum(['marketing','event']).default('marketing')`.
- event 퍼널은 `isDefault` 무관 (개요 메인 퍼널은 marketing만 대상).

### 3.4 UI

#### UI-01: 퍼널 편집 — kind 선택 (`FunnelEditorDialog.tsx`)

- 상단에 퍼널 종류 선택: **마케팅 퍼널** / **행동(이벤트) 퍼널** (2-card 토글)
- kind='event' 선택 시:
  - "방문 → 리드 자동 포함" 안내 숨김 (행동 퍼널은 자동단계 없음)
  - 빈 단계 매칭 타입을 custom_event로 기본 + 안내 문구 "이벤트 발생 단계로 구성"
  - 메인 퍼널 체크박스 숨김 (event 퍼널은 개요 메인 대상 아님)
- kind='marketing'이면 기존 그대로
- **종류 변경 잠금 (추가)**: 신규 모드에서만 종류 선택 가능. 편집 모드는 종류를 읽기전용 안내로 표시 — kind별 카운트 로직(역산 적용/미적용)이 달라 생성 후 변경하면 데이터 의미가 깨지므로.
- `initialKind` prop: 관리 카드의 섹션별 추가 버튼이 종류를 미리 지정해 연다.

#### UI-02: 퍼널 관리 — 2섹션 분리 (`FunnelManagerCard.tsx`)

- 한 카드 안에서 **마케팅 퍼널 / 행동 퍼널 두 섹션**으로 분리, 섹션마다 자체 "추가" 버튼.
- 마케팅 섹션: 메인(별) 표시·설정, 방문→리드 자동단계 프리픽스.
- 행동 섹션: custom_event 단계만, "심을 코드"(sendb.track) 스니펫을 이 섹션 안에 표시 (선행 완료분 이동).
- 종류 배지 대신 섹션 헤더로 구분 (행 단위 중복 배지 제거).

#### UI-03: 행동 탭 — 행동 퍼널 위젯 (`EventFunnelCard.tsx`, 신규)

```
행동 탭 (신설)
├── ControlBar (기간/세그먼트 — 다른 탭과 URL 공유)
├── 행동 퍼널 (EventFunnelCard)
│   ├── 퍼널 선택 드롭다운 (event 퍼널 N개 중)
│   ├── 방문(모수) + 단계별 막대 (라벨 + 도달 수 + 직전 대비 전환율 + 이탈율)
│   └── 빈 상태: "행동 퍼널이 없습니다. 퍼널 관리에서 만드세요." (숨기지 않고 안내)
└── 페이지 인게이지먼트 (EngagementCard, 마케팅 탭에서 이동)
```

- 데이터: `useFunnelAnalytics`(기존 훅) 재사용, funnelId만 event 퍼널로
- 단계 막대는 FunnelPreview와 동일 패턴으로 EventFunnelCard 내부 구현 (FunnelPreview는 "마케팅 퍼널" 타이틀 고정이라 재사용 대신 별도 렌더)

#### UI-04: 탭 재구성 (`BehaviorTab.tsx` 신규, `VisitorListPage.tsx`, `MarketingTab.tsx`)

- **행동 탭 신설**: 탭 순서 개요 → 마케팅 → **행동** → 방문자 → 설정 (`VisitorListPage.tsx`, URL `?tab=behavior`, Activity 아이콘).
- `BehaviorTab.tsx`: ControlBar + EventFunnelCard + EngagementCard. range/filter는 다른 탭과 URL(`?from&to`)로 공유.
- `MarketingTab.tsx`: EventFunnelCard·EngagementCard 제거 → 유입/채널/광고 전용 (인기·이탈 페이지, 유입 채널, 광고 소재, 광고 성과, 디바이스).
- event 퍼널 없을 때: 마케팅 탭 숨김이 아니라 행동 탭에서 만들기 안내 노출.

---

## 4. Implementation Order

### Phase 1: kind 구분 + 카운트 분기
1. `tracker_funnels.kind` 컬럼 + 마이그레이션 + schema
2. funnel-validations에 kind 추가
3. funnel route: kind='event' 분기 (역산 미적용, 자동단계 제외), 응답에 kind
4. **기존 marketing 퍼널 회귀 검증** (동작·숫자 불변)

### Phase 2: 퍼널 관리 UI
5. FunnelEditorDialog: kind 선택 + event 모드 안내 분기 + 편집 시 종류 잠금 + initialKind
6. FunnelManagerCard: 마케팅/행동 2섹션 분리 (섹션별 추가 버튼, 심을 코드 행동 섹션 내)
7. (운영) "구독 전환 흐름"에서 subscribe_step 제거 + 새 event 퍼널 "구독신청 과정" 생성

### Phase 3: 행동 퍼널 위젯 + 행동 탭
8. EventFunnelCard 신규 (단계별 막대 + 전환율/이탈율 + 퍼널 드롭다운 + 빈 상태)
9. BehaviorTab 신설 (행동 퍼널 + 인게이지먼트), VisitorListPage에 행동 탭 추가, MarketingTab에서 두 위젯 이동

### Phase 4: 검증
10. 실제 데이터로 단계 카운트 정확성 SQL 대조 (step_1 = 실제 발생자 수, 역산 0)
11. 타임라인 입력항목 동작 재확인

---

## 5. Test Strategy

| 검증 | 방법 | 기대 |
|------|------|------|
| event 퍼널 단계 카운트 | SQL 대조 (getStageVisitorIds vs 직접 쿼리) | 실제 이벤트 발생자 수 일치 |
| 역산 미적용 | step_1 발생 1명일 때 카운트 1 | 9명(역산) 아님 |
| marketing 회귀 | 기존 퍼널 분석 전후 비교 | 숫자 불변 |
| 멀티테넌시 | 다른 사이트 event 퍼널 격리 | orgId/siteId 격리 |
| 빈 상태 | event 퍼널 없는 사이트 | 위젯 숨김 |

검증 방식: JWT 발급 → 실제 API 호출 → DB 직접 쿼리 대조 (이번 세션에서 쓴 방식).

---

## 6. Key Design Decisions

| Decision | Selected | Rationale |
|----------|----------|-----------|
| 퍼널 종류 | tracker_funnels + kind 컬럼 | 새 테이블 없이 stages/분석/CRUD 재사용 |
| 행동 카운트 | 역산 미적용 (실제 발생) | 상태 도달자 오집계(9명 버그) 제거 |
| 모수 | 방문 코호트 | 마케팅 퍼널과 일관, 전체 흐름 |
| 자동단계 | event 퍼널은 방문만 (리드 제외) | 행동 흐름에 리드 단계 의미 약함 |
| 표시 | **행동 탭 신설** (v0.2 변경) | 마케팅 탭 과밀(위젯 8개) 해소, 유입 vs 행동 질문 분리 |
| 종류 변경 | 편집 시 잠금 | kind별 카운트 로직이 달라 사후 변경 시 데이터 의미 깨짐 |
| 관리 UI | 한 카드 2섹션 | 마케팅/행동 형제 관계 — 위계상 한 카드 내 구분이 적합 |
| 호환 | kind default 'marketing' | 기존 무영향 |

---

## 7. Success Criteria (Design 검증 기준)

- [ ] kind='event' 퍼널이 각 단계 실제 발생자 수로 카운트 (역산 0)
- [ ] 기존 marketing 퍼널 숫자 불변
- [ ] 행동 탭에서 행동 퍼널 단계별 도달/이탈/전환율 표시
- [ ] 퍼널 편집에서 kind 선택 가능, event 모드 UI 분기, 편집 시 종류 잠금
- [ ] 퍼널 관리 마케팅/행동 2섹션 분리 + 섹션별 추가
- [ ] 단계명 한글 라벨 표시 (이벤트 라벨 카드 연동)
- [ ] tsc/lint 0, 실제 데이터 검증 통과

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-06-05 | Initial design (Plan 결정 4개 반영) | jaehun |
| 0.2 | 2026-06-05 | 구현 반영: 표시 위치 마케팅 탭→행동 탭 신설, 퍼널 관리 2섹션 분리, 편집 시 종류 잠금, EventFunnelCard 빈 상태 | jaehun |
