# Plan: tracker-funnels-v1 (Phase 2)

> 작성일: 2026-05-27
> 상위 로드맵: [tracker-marketing-roadmap.plan.md](./tracker-marketing-roadmap.plan.md)
> Phase: Plan

## 1. 배경 / 문제

`tracker-overview` + `tracker-marketing-v1`까지 만들면서 마케팅 깔때기를 보여주는 위젯은 자리잡았지만, **현재 깔때기 단계는 트래커 코드에 박혀있다**:

```
방문 → 리드 → 가입(signup) → 전환(site.conversionStage)
```

- "가입(signup)"이 코드에 박힌 record_event 타입 → **디하 전용** (백오피스랩/픽셀앤로직 무의미)
- 백오피스랩은 깔때기가 "방문 → 리드 → 도입상담 → 종료" 같이 다름
- 픽셀앤로직은 또 다름

운영 데이터로 확인된 단계 종류:
| 워크스페이스 | 단계 종류 |
|---|---|
| 디하(ws=8) | signup, match_stage(테스트/신청완료/구독중) |
| 백오피스랩(ws=9) | consult(도입상담 신청), status(연락중/종료/부재) |
| 픽셀앤로직(ws=10) | status 만 (record_events 0건 — 아직 활용 안 함) |

즉 **"단계"는 사이트마다 다른 record_event 타입/필드값/페이지 도달의 조합**으로 정의돼야 함. 코드 박지 말고 사용자(사이트 운영자)가 정의하게 해야 진짜 범용 제품.

## 2. 목표 (Goal)

각 사이트가 **자기 퍼널 단계를 직접 정의**하고, 단계별 도달률/이탈률을 시각화할 수 있게 한다. 트래커 코드엔 도메인 단어 0건.

### 디하 정의 예시
```
1. 방문 (자동 — 모든 퍼널 공통)
2. 리드 (자동 — visitor.record_id NOT NULL)
3. 가입 (record_event type=signup)
4. 신청완료 (record_event type=match_stage, label=신청완료)
5. 구독중 (record_event type=match_stage, label=구독중)
```

### 백오피스랩 정의 예시
```
1. 방문 (자동)
2. 리드 (자동)
3. 도입상담 (record_event type=consult)
4. 연락중 (record_event type=status, label=연락 중)
5. 종료 (record_event type=status, label=종료)
```

## 3. 범위 (이번 PDCA)

### 3-1. 신규 DB
- **`tracker_funnels`** 테이블
  - id, site_id (FK), name, stages (jsonb 배열), is_default (boolean), created/updated_at
  - 한 사이트에 여러 퍼널 정의 가능 (예: 가입 깔때기, 구매 깔때기)
  - is_default=true인 퍼널이 개요 탭에 노출되는 메인 퍼널

### 3-2. 단계 정의 모델 (stages jsonb)
범용 매칭 조건 3가지 지원:
```ts
type FunnelStage = {
    key: string;        // 내부 식별자 (slug, 예: "signup")
    label: string;      // 표시 이름 ("회원가입")
    match: StageMatch;  // 매칭 조건
};

type StageMatch =
    | { type: "auto_visit" }                                            // 모든 visitor (방문)
    | { type: "auto_lead" }                                             // record_id 있는 visitor
    | { type: "record_event"; eventType: string; label?: string }       // record_events 매칭
    | { type: "record_field"; field: string; value: string }            // record.data[field]=value
    | { type: "page_url"; pathPrefix: string };                         // tracker_events page_url prefix
```

### 3-3. 정의 UI (트래커 설정 탭)
- "퍼널 관리" 카드 신설 — 사이트의 퍼널 목록
- 추가/수정 다이얼로그:
  - 퍼널 이름 입력
  - 단계 목록 (드래그 정렬 또는 위/아래 버튼)
  - 각 단계: 라벨 + 매칭 타입 선택 → 타입별 추가 입력
  - 메인 퍼널 지정 토글
- 검증: 최소 1단계 + label 비어있지 않음

### 3-4. API
- **GET `/api/tracker/funnels?siteId=`** — 사이트의 퍼널 목록
- **POST `/api/tracker/funnels`** — 신규 퍼널
- **PATCH/DELETE `/api/tracker/funnels/[id]`**
- **GET `/api/tracker/analytics/funnel?siteId=&funnelId=&from=&to=&device=&channel=`** — 단계별 visitor 수 + 도달률/이탈률

### 3-5. 시각화 (개요 탭 통합)
- 현재 `FunnelPreview` 위젯을 **사이트의 메인 퍼널 데이터로** 채움
- 단계가 코드 박힘 → 정의 기반으로 동적 렌더링
- 기존 4단(방문→리드→가입→구독중)은 site에 퍼널 정의 없을 때 fallback

## 4. 비범위

- 기간 비교 (compare) — Phase 2.5
- 전환 목표(goals) — Phase 2.6 (퍼널 인프라 재사용)
- 캠페인 트렌드 — Phase 2.6
- 단계별 평균 소요 시간 (cohort analysis)
- 다중 퍼널 동시 비교 시각화
- 퍼널 단계 자동 추천 (AI)

## 5. 해결 방안 비교

| 방안 | 내용 | 평가 |
|------|------|------|
| **A. jsonb stages 배열** | 한 row에 단계 정의 통째로 저장 | 권장 — 단계 순서/추가/삭제 단순, 정의 단위로 작업 |
| B. 별도 funnel_stages 테이블 | 각 단계가 별도 row | 비추 — 단계가 적고(5-10개), 외래키 관리 부담 |

**A 권장**: 데이터 양 적고 단계 단위 일괄 업데이트가 자연스러움.

## 6. 영향 범위

**신규**:
- `drizzle/0055_tracker_funnels.sql` + journal
- `src/lib/db/schema.ts` — `trackerFunnels` 테이블
- `src/lib/tracker/validations.ts` — funnel/stage 검증 zod
- `src/components/tracker/types/funnel.ts` — FunnelStage / FunnelDefinition
- `src/app/api/tracker/funnels/route.ts` (GET/POST)
- `src/app/api/tracker/funnels/[id]/route.ts` (PATCH/DELETE)
- `src/app/api/tracker/analytics/funnel/route.ts` — 단계별 도달률 집계
- `src/components/tracker/ui/FunnelManagerCard.tsx` — 설정 탭 카드
- `src/components/tracker/ui/FunnelEditorDialog.tsx` — 단계 편집 다이얼로그
- `src/components/tracker/hooks/useTrackerFunnels.ts`
- `src/components/tracker/hooks/useFunnelAnalytics.ts`

**변경**:
- `src/components/tracker/ui/TrackerSettingsPanel.tsx` — FunnelManagerCard 추가
- `src/components/tracker/ui/widgets/FunnelPreview.tsx` — 동적 단계 렌더링 (기존 4단 박힘 제거)
- `src/components/tracker/ui/OverviewTab.tsx` — 메인 퍼널 데이터로 채움
- `src/lib/db/schema.ts` — `trackerSites.conversionStage` deprecation 안내 (제거는 다음 사이클)

## 7. 결정 사항 (Design에서 확정)

1. **자동 단계 처리**: 방문/리드를 모든 퍼널에 강제 포함할지, 옵션으로 둘지
2. **메인 퍼널 부재 시 동작**: 사이트에 퍼널 정의 0개면 개요 깔때기 위젯 어떻게 (기존 fallback / 안내 메시지 / 숨김)
3. **단계 매칭 시점**: visitor가 단계 통과한 시각 = record_event.occurred_at vs 기간 내 첫 발생 vs 마지막 발생
4. **여러 record와 N:M 처리**: visitor가 record 여러 개 연결(visitor_record_links)일 때 단계 매칭 기준
5. **page_url 매칭**: 정확 일치 vs prefix vs regex
6. **편집기 UX**: 드래그 정렬 라이브러리 추가 vs 위/아래 버튼만

## 8. Definition of Done

- [ ] `tracker_funnels` 마이그레이션 + schema 반영
- [ ] 단계 정의 모델 (3가지 매칭 타입: record_event / record_field / page_url) 동작
- [ ] CRUD API (목록/생성/수정/삭제)
- [ ] 설정 탭에 퍼널 관리 UI — 추가/수정/삭제/메인 지정
- [ ] 분석 API — 단계별 visitor 수 + 도달률/이탈률 (기간 + 세그먼트 필터 반영)
- [ ] 개요 탭 `FunnelPreview`가 메인 퍼널 정의 따라 동적 렌더링
- [ ] 디하 운영 사이트에 퍼널 1개(가입 깔때기) 직접 정의해서 운영 데이터 위 실측 확인
- [ ] 백오피스랩에도 다른 퍼널(상담 깔때기) 정의 → 같은 코드로 다른 단계 표시 확인
- [ ] **트래커 코드 어디에도 "signup", "matchStep", "구독중" 같은 도메인 단어 없음**
- [ ] tsc 통과, 각 파일 200줄 이내
- [ ] gap-detector Match Rate ≥ 90%

## 9. 리스크 / 주의

- **단계 매칭 SQL 복잡도**: 3가지 매칭 타입이 한 쿼리에 들어가야 함. 동적 SQL이 복잡해질 수 있음 → 매칭 조건별로 분리해 작은 쿼리 여러 개 후 JS 결합도 고려
- **N:M visitor-record 처리**: visitor가 여러 record를 거치면 단계 매칭 모호. Design에서 정책 확정 (예: visitor가 거친 어느 record라도 매칭되면 통과)
- **UI 편집기 복잡도**: 단계 타입별로 입력 폼이 달라짐. Conditional rendering 잘 구조화 안 하면 200줄 초과
- **운영 디하 conversionStage 제거 시점**: Phase 2 완료 후 퍼널로 대체되면 conversionStage 컬럼은 deprecation 후 제거. 이번 PDCA는 둘 다 살려둠 (퍼널 없으면 conversionStage fallback)

## 10. 다음 단계

- `/pdca design tracker-funnels-v1` — 결정사항 6개 확정 + 스키마/API/UI 상세 명세
- Design 통과 후 `/pdca do` — 구현
- 운영 디하 사이트에 퍼널 정의 후 실측
- 완료 시 [로드맵 진척 표](./tracker-marketing-roadmap.plan.md#6-진척-추적)에서 Phase 2 → ✅ 갱신
- 다음: `/pdca plan tracker-compare-v1` (Phase 2.5)
