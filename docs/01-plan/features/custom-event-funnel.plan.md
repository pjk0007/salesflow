# Plan: 커스텀 이벤트 전용 퍼널 (Custom Event Funnel)

> **Summary**: CUSTOM 트래커 이벤트(예: 구독신청 폼 단계)만으로 구성하는 "행동 퍼널"을, 기존 마케팅 퍼널(record 상태 기반)과 분리해 별도로 정의·분석한다.
>
> **Project**: Sendb (Salesflow)
> **Author**: jaehun
> **Date**: 2026-06-04
> **Status**: Approved

---

## 1. Overview

### 1.1 Purpose

사이트(테넌트)가 `sendb.track('subscribe_step_2')` 같은 CUSTOM 이벤트로 보내는 **사용자 행동 단계**(예: 구독신청 폼 step1→step2→...→완료)를, 단계별 도달/이탈로 분석하는 **전용 퍼널**을 만든다. 동시에 개별 고객의 타임라인에서 "어느 단계에서 무엇을 입력하고 넘어갔는지"를 본다.

### 1.2 Background

- **선행 작업(완료, 브랜치 `feat/custom-event-funnel`)**: 퍼널 단계에 `custom_event` 매칭 추가, 이벤트 정의 단일화(이벤트 라벨 카드), 타임라인 CUSTOM 표시(라벨·단계행·입력항목), 디하 측 `sendb.track` 발사.
- **발견된 문제**: 기존 "구독 전환 흐름" 퍼널에 `custom_event` 단계(subscribe_step)와 `record_field` 단계(신청완료/구독중)를 **한 퍼널에 섞었더니** sequential 역산이 꼬임. 실제 step_1 도달자는 1명인데 "구독중(18명) 도달자가 단계 순서상 뒤라서 step_1도 통과한 걸로 역산" → step_1이 9명으로 잘못 집계됨.
- **근본 원인**: 두 단계는 **차원이 다름**.
  - `custom_event`(행동) = "이 행동을 실제로 했는가" — 안 한 사람은 안 잡혀야 함
  - `record_field`(상태) = "이 상태에 도달한 적 있는가" — 트래킹 도입 전 고객도 잡힘
  - 한 퍼널에서 cumulative 역산을 공유하면 상태 도달자가 행동 단계까지 통과한 것으로 오집계됨.
- **비즈니스 필요**: 디하 구독신청처럼 다단계 폼의 **단계별 이탈 지점**을 봐야 폼 개선 액션이 나옴. 마케팅 전환 퍼널(방문→리드→구독중)과는 보는 질문이 다름.

### 1.3 두 퍼널의 차이

| 항목 | 마케팅 퍼널 (기존) | 커스텀 이벤트 퍼널 (신규) |
|------|------------------|------------------------|
| 질문 | "어디서 온 트래픽이 전환되나" | "폼/행동 흐름 어디서 이탈하나" |
| 단계 소스 | record_field / page_url (상태·방문) | custom_event (행동 이벤트) |
| 도달 의미 | 그 상태에 도달한 적 있음 (이력) | 그 행동을 실제로 발생시킴 |
| 모수 | 방문 코호트 → 리드 → 전환 | 보통 첫 단계 이벤트 발생자 |
| 표시 위치 | 개요 탭 마케팅 퍼널 위젯 (메인 1개) | 별도 위치 (마케팅 탭 또는 전용 섹션) |
| 카운트 방식 | cumulative 역산(상위 도달=하위 통과) | 단계별 실제 발생(역산 미적용 또는 strict) |

### 1.4 Related Documents

- 선행 구현: 브랜치 `feat/custom-event-funnel` (커밋 cccce0e, a77f360, b4927bb)
- 기존 퍼널 분석: `src/lib/tracker/funnel-analytics.ts`, `src/app/api/tracker/analytics/funnel/route.ts`
- 마케팅 로드맵: `docs/01-plan/features/tracker-marketing-roadmap.plan.md`
- 디하 이벤트 발사: `new-designer-hire/src/hooks/request/useStepNavigation.ts`

---

## 2. Scope

### 2.1 In Scope

- [ ] 커스텀 이벤트 퍼널을 마케팅 퍼널과 **개념·데이터·화면에서 분리**
- [ ] 행동 단계에 맞는 카운트 방식 (cumulative 역산이 행동 단계를 오집계하지 않게)
- [ ] 커스텀 이벤트 퍼널 분석 화면 (단계별 도달/이탈/전환율) — 별도 위치
- [ ] 개별 고객 타임라인의 단계+입력항목 표시 (선행 완료분 활용/보강)

### 2.2 Out of Scope

- 이벤트 정의/코드 안내 (선행 작업에서 완료 — 이벤트 라벨 카드)
- custom_event 매칭 로직 (선행 작업에서 완료)
- 디하 측 sendb.track 발사 (선행 작업에서 완료)
- 순서 규칙 옵션(strict/loose/any order) — YAGNI, 추후
- 입력 "값" 표시 (개인정보라 filled_keys만; 값은 record에 있음)

---

## 3. Requirements

### 3.1 데이터 모델

#### FR-01: 퍼널 종류(kind) 구분

기존 `tracker_funnels`를 재사용하되, 퍼널이 "마케팅(상태 기반)"인지 "행동(이벤트 기반)"인지 구분한다.

옵션 A (권장): `tracker_funnels`에 `kind` 컬럼 추가
```
tracker_funnels
└── kind: varchar(20) default 'marketing'  -- 'marketing' | 'event'
```
- `marketing`: 기존 동작 (방문/리드 자동 단계 + cumulative 역산)
- `event`: 자동 단계(방문/리드) 없이 custom_event 단계만, 역산 미적용(또는 strict)

옵션 B: 별도 테이블. → 퍼널 stages/분석 로직을 재발명하게 되어 비권장.

> **결정 필요**: kind 컬럼 추가 vs stages 구성으로 자동 판별(모든 stage가 custom_event면 event 퍼널로 간주). 후자는 마이그레이션 없지만 의도가 암묵적.

### 3.2 카운트 로직

#### FR-02: 행동 퍼널은 cumulative 역산 미적용

`computeSequentialStageCounts`의 maxIdx 역산("상위 도달자는 하위도 통과")은 **마케팅 퍼널 전용**으로 두고, 행동 퍼널은 **각 단계 실제 발생 visitor 수**를 그대로 카운트한다.
- 근거: 행동은 "실제로 했는가"가 본질. step_1을 안 쏜 사람이 step_1 통과로 잡히면 안 됨.
- 단, "전환된 후 종료된 사람도 도달에 포함"이라는 기존 의도는 **마케팅 퍼널에서만 유지**.

#### FR-03: 행동 퍼널 모수(첫 단계)

- 마케팅 퍼널: 방문 코호트가 모수.
- 행동 퍼널: 첫 단계 이벤트 발생자(또는 방문) 중 무엇을 100% 기준으로 할지 결정.
  > **결정 필요**: 모수를 "방문"으로 둘지 "1단계 이벤트 발생자"로 둘지.

### 3.3 분석 API

#### FR-04: funnel 분석 API의 kind 분기

`/api/tracker/analytics/funnel`이 퍼널 kind에 따라:
- marketing → 기존 로직 (방문/리드 자동 + 역산)
- event → 자동 단계 없이 custom_event 단계만, 역산 없이 단계별 실제 카운트
- 채널/디바이스 세그먼트 필터는 양쪽 공통 적용

### 3.4 UI 요구사항

#### FR-05: 커스텀 이벤트 퍼널 분석 화면

- **위치**: 마케팅 탭 내 별도 위젯 (개요 탭 메인 마케팅 퍼널과 구분)
- **표시**: 단계별 막대 + 단계명(라벨) + 도달 수 + 단계간 전환율 + 이탈율(드롭오프)
- **퍼널 선택**: 사이트에 event 퍼널이 여러 개면 드롭다운으로 선택
- 단계명은 이벤트 라벨 카드의 한글 라벨 사용 (선행 작업의 라벨 연동 활용)

#### FR-06: 퍼널 관리에서 kind 선택

`FunnelManagerCard`/`FunnelEditorDialog`에서 퍼널 생성 시 "마케팅 퍼널 / 행동(이벤트) 퍼널" 선택. 행동 퍼널이면 자동 단계(방문/리드) 안내 숨기고 custom_event 단계만 구성.

#### FR-07: 개별 타임라인 (선행 완료, 검증)

record 상세 타임라인에서 custom_event 단계 이벤트의 "입력한 항목"(filled_keys) 표시 — 선행 작업으로 구현됨. 행동 퍼널 도입 후 동작 재확인.

### 3.5 Non-Functional Requirements

| Category | Criteria | Measurement |
|----------|----------|-------------|
| Correctness | 행동 단계 카운트 = 실제 이벤트 발생자 수 (역산 오집계 0) | SQL 대조 |
| 멀티테넌시 | 사이트가 자기 이벤트로 자기 퍼널 정의, 코드에 도메인 단어 없음 | 코드 리뷰 |
| 호환성 | 기존 마케팅 퍼널 동작 불변 | 기존 퍼널 회귀 검증 |

---

## 4. Architecture

### 4.1 퍼널 종류 분리

```
tracker_funnels (kind 구분)
├── kind='marketing' (기존)
│   stages: 방문(자동) → 리드(자동) → record_field/page_url 단계
│   카운트: cumulative 역산 (상위 도달 = 하위 통과)
│   화면: 개요 탭 마케팅 퍼널 위젯
└── kind='event' (신규)
    stages: custom_event 단계만 (자동 단계 없음)
    카운트: 단계별 실제 이벤트 발생 visitor (역산 없음)
    화면: 마케팅 탭 행동 퍼널 위젯
```

### 4.2 카운트 분기 플로우

```
GET /api/tracker/analytics/funnel?funnelId=N
       ↓
funnel.kind 확인
   ├── marketing → computeSequentialStageCounts (역산) + 방문/리드 자동단계
   └── event     → 각 custom_event 단계의 getStageVisitorIds 결과를 역산 없이 그대로
       ↓
세그먼트 필터(채널/디바이스) 공통 적용 → 단계별 visitor 수 반환
```

### 4.3 Key Architectural Decisions

| Decision | Selected | Rationale |
|----------|----------|-----------|
| 퍼널 분리 방식 | 기존 tracker_funnels + kind 컬럼 | stages/분석 재사용, 별도 테이블 재발명 방지 |
| 행동 퍼널 카운트 | 역산 미적용 (실제 발생) | 행동은 "실제로 했는가"가 본질, 상태 도달자 오집계 방지 |
| 단계명 | 이벤트 라벨 카드 라벨 | 선행 작업의 단일 출처 재사용, 멀티테넌시 |
| 표시 위치 | 마케팅 탭 별도 위젯 | 개요 메인 퍼널(1개)과 충돌 없이 N개 행동 퍼널 표시 |

---

## 5. Implementation Order

### Phase 1: 퍼널 종류 분리 + 카운트 로직
1. `tracker_funnels.kind` 컬럼 + 마이그레이션 (default 'marketing' → 기존 무영향)
2. funnel 분석 API/funnel-analytics: kind='event'일 때 역산 미적용 + 자동단계 제외
3. 기존 마케팅 퍼널 회귀 검증 (동작 불변)

### Phase 2: 퍼널 관리 UI
4. FunnelEditorDialog/FunnelManagerCard에 kind 선택 + event 퍼널 안내 분기
5. 기존 "구독 전환 흐름"에서 subscribe_step 분리 → 새 event 퍼널 "구독신청 과정" 생성(운영)

### Phase 3: 행동 퍼널 분석 화면
6. 마케팅 탭에 행동 퍼널 위젯 (단계별 도달/이탈/전환율 + 퍼널 선택 드롭다운)
7. 단계명 라벨 표시 (이벤트 라벨 카드 연동)

### Phase 4: 검증
8. 개별 타임라인 입력항목 표시 재확인
9. 실제 데이터로 단계별 카운트 정확성 검증 (step_1=실제 발생자 수)

---

## 6. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| kind 분기가 기존 마케팅 퍼널 깨뜨림 | High | Medium | default 'marketing', 기존 퍼널 회귀 검증 필수 |
| 행동/마케팅 카운트 로직 혼동 | Medium | Medium | funnel-analytics에서 분기 명확히, 주석 |
| 사용자가 잘못된 kind로 퍼널 생성 | Low | Medium | 생성 UI에서 kind별 안내 + custom_event만/record_field만 가이드 |
| 기존 섞인 퍼널("구독 전환 흐름") 데이터 | Medium | High | 운영에서 분리 — 마케팅 퍼널은 record 단계만 남기고, 행동은 새 퍼널로 |

---

## 7. Success Criteria

### 7.1 Definition of Done

- [ ] 마케팅 퍼널과 행동 퍼널이 분리되어 각각 정의·표시
- [ ] 행동 퍼널 단계 카운트 = 실제 이벤트 발생 visitor 수 (역산 오집계 없음 — step_1이 1명으로 정확)
- [ ] 행동 퍼널 분석 화면에서 단계별 도달/이탈/전환율 표시
- [ ] 기존 마케팅 퍼널 동작 불변
- [ ] 개별 타임라인에서 단계+입력항목 확인

### 7.2 Quality Criteria

- [ ] 실제 데이터로 카운트 정확성 SQL 대조 검증
- [ ] 멀티테넌시 — 코드에 사이트별 단어 0개
- [ ] tsc/lint 에러 없음

---

## 8. Decisions (확정)

1. **kind 구분 방식**: ✅ **컬럼 추가** — `tracker_funnels.kind`('marketing'/'event'). 퍼널 생성 시 명시 선택. 자동 판별보다 의도가 명확.
2. **행동 퍼널 모수**: ✅ **방문 기준** — 방문 코호트를 100%로, "방문→신청 시작→완료" 전체 흐름을 봄. 기존 마케팅 퍼널과 일관.
3. **역산 정책**: ✅ **완전 미적용** — 각 단계 실제 이벤트 발생 visitor만 카운트. 디하 구독신청처럼 폼이 순서를 강제하면 step_2 발생자는 이미 step_1을 거친 것이라, 데이터 자체가 순서를 보장 → 별도 strict 검사 불필요. (순서 미강제 폼이 나오면 그때 strict 검토 — 현재 YAGNI)
4. **표시 위치**: ✅ **마케팅 탭 위젯** — 가볍게 시작. 행동 분석이 커지면 추후 전용 탭으로 분리.

---

## 9. Next Steps

1. [ ] Open Decisions 확정
2. [ ] Design 문서 작성 (`custom-event-funnel.design.md`)
3. [ ] Phase 1 구현 시작

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-06-04 | Initial draft (선행 작업 완료 후 분리 설계) | jaehun |
| 0.2 | 2026-06-05 | Open Decisions 4개 확정 (kind 컬럼/방문 모수/역산 미적용/마케팅 탭 위젯), Status Approved | jaehun |
