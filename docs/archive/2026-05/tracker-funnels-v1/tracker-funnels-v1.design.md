# Design: tracker-funnels-v1 (Phase 2 — 사용자정의 퍼널)

> 작성일: 2026-05-27
> Phase: Design
> Plan: [tracker-funnels-v1.plan.md](../../01-plan/features/tracker-funnels-v1.plan.md)
> 로드맵: [tracker-marketing-roadmap.plan.md](../../01-plan/features/tracker-marketing-roadmap.plan.md)

## 1. 설계 개요

각 사이트가 **자기 퍼널 단계를 직접 정의**할 수 있게 한다. 트래커 코드에 도메인 단어("signup", "구독중" 등) 0건이 목표.

신규 `tracker_funnels` 테이블 + 정의 UI + 단계별 도달률 집계 API + 동적 시각화.

### Plan 결정 확정
| # | 결정 |
|---|------|
| 1 | 방문/리드 = **모든 퍼널에 강제 자동 1·2단**으로 고정. 사용자는 3단부터 정의 |
| 2 | 메인 퍼널 부재 시 = **conversionStage fallback + 안내 메시지 같이** ("기본 깔때기 표시 중. 설정에서 퍼널을 정의하면 사이트별 단계로 분석됩니다.") |
| 3 | 단계 매칭 시점 = **visitor 단위 기간 내 첫 발생** (중복 카운트 방지) |
| 4 | N:M visitor-record = **visitor가 거친 어느 record라도 매칭되면 통과** (visitor_record_links + tv.record_id 합집합) |
| 5 | page_url 매칭 = **prefix** (excludePaths와 일관) |
| 6 | 편집기 UX = **위/아래 버튼** (라이브러리 추가 없음) |

## 2. 데이터 모델

### 2-1. `tracker_funnels` 테이블 (마이그레이션 0055)
```sql
CREATE TABLE tracker_funnels (
    id           serial PRIMARY KEY,
    org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    site_id      integer NOT NULL REFERENCES tracker_sites(id) ON DELETE CASCADE,
    name         varchar(200) NOT NULL,
    stages       jsonb NOT NULL DEFAULT '[]',   -- FunnelStage[] (3단부터, 방문/리드는 자동)
    is_default   integer NOT NULL DEFAULT 0,    -- 사이트별 0/1 (메인 퍼널 1개만 권장)
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tracker_funnels_site_idx ON tracker_funnels (site_id);
-- 사이트당 default 1개만 보장하지 않음 (운영자 책임 — 다중이면 첫번째 사용)
```

### 2-2. stages JSON 모델
```ts
// 사용자가 정의하는 단계 (방문/리드 자동 단계 제외 — 3단부터)
export interface FunnelStage {
    key: string;        // slug, 응답/내부용 (예: "signup")
    label: string;      // 화면 표시 ("회원가입")
    match: StageMatch;
}

export type StageMatch =
    | { type: "record_event"; eventType: string; label?: string }    // record_events.type[+label]
    | { type: "record_field"; field: string; value: string }         // record.data[field]=value
    | { type: "page_url"; pathPrefix: string };                      // tracker_events.page_url LIKE prefix%
```

방문/리드는 코드에 박힌 자동 단계 — DB에 저장 안 함:
```
stage 1: visit  (모든 visitor)
stage 2: lead   (visitor.record_id NOT NULL or visitor_record_links 존재)
stage 3+: 사용자 정의
```

### 2-3. 디하/백오피스랩 정의 예시

**디하 (가입 깔때기)**:
```json
{
  "name": "가입 깔때기",
  "stages": [
    { "key": "signup",   "label": "회원가입", "match": { "type": "record_event", "eventType": "signup" } },
    { "key": "request",  "label": "신청완료", "match": { "type": "record_event", "eventType": "match_stage", "label": "신청완료" } },
    { "key": "paid",     "label": "구독중",   "match": { "type": "record_event", "eventType": "match_stage", "label": "구독중" } }
  ],
  "is_default": 1
}
```

**백오피스랩 (상담 깔때기)**:
```json
{
  "name": "상담 깔때기",
  "stages": [
    { "key": "consult", "label": "도입상담",  "match": { "type": "record_event", "eventType": "consult" } },
    { "key": "contact", "label": "연락 중",   "match": { "type": "record_event", "eventType": "status", "label": "연락 중" } },
    { "key": "closed",  "label": "종료",      "match": { "type": "record_event", "eventType": "status", "label": "종료" } }
  ],
  "is_default": 1
}
```

## 3. API

### 3-1. CRUD
```
GET    /api/tracker/funnels?siteId=N           — 사이트의 퍼널 목록
POST   /api/tracker/funnels                    — 신규 (body: { siteId, name, stages, isDefault })
GET    /api/tracker/funnels/[id]               — 단건
PATCH  /api/tracker/funnels/[id]               — 수정
DELETE /api/tracker/funnels/[id]               — 삭제
```
- 인증: `getUserFromNextRequest`
- 사이트 격리: site.orgId === user.orgId 확인
- 권한: member는 GET만, owner/admin은 CUD

### 3-2. 분석 API
```
GET /api/tracker/analytics/funnel?siteId=&funnelId=&from=&to=&device=&channel=
```
- funnelId 미지정 시 사이트의 is_default=1 퍼널 사용
- 응답:
```ts
interface FunnelAnalyticsResponse {
    funnel: { id: number; name: string; stages: FunnelStage[] };
    range: { from: string; to: string };
    // 단계별 visitor 수 (visit/lead + 정의된 단계들 순서대로)
    stages: Array<{
        key: string;          // "visit", "lead", "signup" 등 (자동 단계는 visit/lead 고정)
        label: string;        // 표시 이름
        visitors: number;     // 해당 단계 통과한 distinct visitor 수
        // 이전 단계 대비 전환율/이탈률은 클라이언트가 계산
    }>;
}
```

### 3-3. 단계별 visitor 집계 SQL 구조
모든 단계는 **기간 내 첫 발생** 기준. visitor 단위 distinct.

**자동 단계**:
```sql
-- visit: 기간 내 first_seen visitor 중 의미있는 PV 있는 visitor (excludePaths 외)
-- 기존 aggregateRange 로직 재사용 (visitors KPI와 동일)

-- lead: 위 + (visitor.record_id NOT NULL OR EXISTS visitor_record_links)
```

**사용자 정의 단계 (3가지 매칭)**:
```sql
-- record_event 매칭
SELECT DISTINCT tv.id FROM tracker_visitors tv
WHERE tv.id IN (meaningfulVisitorIds)  -- 1·2단 후보군 재사용
  AND EXISTS (
    SELECT 1
    FROM record_events re
    JOIN visitor_records_all vra ON vra.record_id = re.record_id  -- visitor가 거친 모든 record
    WHERE vra.visitor_id = tv.id
      AND re.type = :eventType
      AND (:label IS NULL OR re.label = :label)
      AND re.occurred_at BETWEEN :from AND :to  -- 기간 내 발생
  )

-- visitor_records_all = N:M 합집합
WITH visitor_records_all AS (
  SELECT id AS visitor_id, record_id FROM tracker_visitors WHERE record_id IS NOT NULL
  UNION
  SELECT visitor_id, record_id FROM visitor_record_links
)

-- record_field 매칭
SELECT DISTINCT tv.id FROM tracker_visitors tv
JOIN visitor_records_all vra ON vra.visitor_id = tv.id
JOIN records r ON r.id = vra.record_id
WHERE tv.id IN (meaningfulVisitorIds)
  AND r.data->>:field = :value

-- page_url prefix 매칭
SELECT DISTINCT tv.id FROM tracker_visitors tv
WHERE tv.id IN (meaningfulVisitorIds)
  AND EXISTS (
    SELECT 1 FROM tracker_events ev
    WHERE ev.visitor_id = tv.id
      AND ev.event_type = 'PAGE_VIEW'
      AND regexp_replace(split_part(ev.page_url,'?',1),'^https?://[^/]+','') LIKE :pathPrefix || '%'
      AND ev.occurred_at BETWEEN :from AND :to
  )
```

> 구현은 stage별로 독립 쿼리 실행 후 응답에서 결합. 한 쿼리에 다 넣으면 jsonb 분기 SQL이 복잡해짐.

## 4. UI

### 4-1. 설정 탭에 "퍼널 관리" 카드 (`FunnelManagerCard.tsx`)
```
┌────────────────────────────────────────┐
│ 🎯 퍼널 관리                            │
│                          [+ 퍼널 추가]  │
├────────────────────────────────────────┤
│ ⭐ 가입 깔때기 (메인)                   │
│    회원가입 → 신청완료 → 구독중         │
│    [편집] [삭제]                         │
│ ── ── ── ── ── ── ── ── ── ── ── ── ── │
│ ○ 결제 깔때기                           │
│    구독중 → 정산                         │
│    [편집] [삭제] [메인으로]              │
└────────────────────────────────────────┘
```

### 4-2. 편집 다이얼로그 (`FunnelEditorDialog.tsx`)
```
┌─ 퍼널 편집 ──────────────────────────────┐
│ 이름:  [가입 깔때기                ]      │
│ ☑ 메인 퍼널로 설정                        │
│                                          │
│ 단계 (방문/리드는 자동 포함):              │
│ ┌──────────────────────────────────────┐ │
│ │ 1. 방문 (자동)                        │ │
│ │ 2. 리드 (자동)                        │ │
│ │ 3. [회원가입       ] ↑ ↓ ✕           │ │
│ │    매칭: [이벤트 ▼]                   │ │
│ │       타입: [signup     ]            │ │
│ │       라벨: [           ] (선택)      │ │
│ │ 4. [신청완료       ] ↑ ↓ ✕           │ │
│ │    매칭: [이벤트 ▼]                   │ │
│ │       타입: [match_stage]            │ │
│ │       라벨: [신청완료    ]            │ │
│ │ [+ 단계 추가]                          │ │
│ └──────────────────────────────────────┘ │
│                          [취소] [저장]    │
└──────────────────────────────────────────┘
```

매칭 타입 선택:
- **이벤트** (record_event): 타입 + 라벨(선택)
- **필드값** (record_field): 필드명 + 값
- **페이지 도달** (page_url): 경로 prefix

### 4-3. 개요 탭 깔때기 위젯 (`FunnelPreview.tsx` 재사용 + 동적화)
- 메인 퍼널 있으면 → API에서 받은 stages 그대로 렌더
- 메인 퍼널 없으면:
  - conversionStage 있으면 → 기존 4단 fallback + 상단에 안내 배지: "기본 깔때기 표시 중. 설정에서 퍼널을 정의하면 사이트 맞춤 단계로 분석됩니다." [설정 →] 링크
  - conversionStage도 없으면 → 3단(방문→리드→[비어있음]) + 같은 안내

### 4-4. 단계 표시
각 단계 카드:
```
회원가입  회원가입 단계                      전환 67%  105   -33%
████████████████████░░░░░░░░░░░░░░░░░░░░░░
```
- 라벨 + 매칭 조건 짧게 ("이벤트: signup" 등 hover 시 툴팁)
- 전환율 = 직전 단계 대비
- 이탈률 = 직전 단계 대비 감소율
- 막대 폭 = 1단(방문) 대비 비율

## 5. 검증 / 엣지

| 케이스 | 처리 |
|--------|------|
| 퍼널 0개 | conversionStage fallback + 안내 메시지 |
| stages 빈 배열 | "단계 미정의 — 편집해주세요" 안내, 깔때기는 방문/리드 2단만 |
| 같은 visitor가 한 단계 여러 번 도달 | distinct visitor — 첫 발생만 카운트 |
| visitor가 N개 record 거침 | visitor_records_all CTE로 합집합 매칭 (OR) |
| 단계 이름 중복 | label은 중복 허용, key는 자동 slug 생성으로 unique |
| record_field 매칭에 record_events 없는 visitor | record.data 직접 조회로 매칭 가능 (이벤트 이력 없어도 됨) |
| isDefault 동시 여러 개 | 첫 번째(id 작은) 사용 — DB constraint 미설정, 운영자 책임 |
| 단계 정의에서 eventType 비어있음 | 검증 실패, 저장 차단 |

## 6. 권한 / 인가

- **읽기 (GET)**: 사이트 접근 권한 있는 모든 user
- **CUD**: org owner/admin만 (`user.role !== "member"`)
- 외부 트래커 스크립트 API에는 funnel 노출 없음 (분석 화면 전용)

## 7. Definition of Done

- [ ] 마이그레이션 0055 + schema.ts + journal
- [ ] CRUD API (목록/생성/단건/수정/삭제) + 권한 + 격리
- [ ] 분석 API — 3가지 매칭 타입 모두 동작, 자동 단계(visit/lead) 포함, 세그먼트 필터(device/channel) 반영
- [ ] 설정 탭 FunnelManagerCard — 목록/추가/편집/삭제/메인 지정
- [ ] FunnelEditorDialog — 단계 추가/제거/위아래 순서/3가지 매칭 타입 입력
- [ ] 개요 탭 깔때기 = 메인 퍼널 정의로 동적 렌더 + fallback + 안내 메시지
- [ ] 디하 운영 사이트에 가입 깔때기 정의 → 화면에 동적 표시
- [ ] 백오피스랩에 상담 깔때기 정의 → 같은 코드로 다른 깔때기 표시 (범용성 검증)
- [ ] **코드 전수 검사: "signup"·"matchStep"·"구독중" 같은 도메인 단어 박힘 0건** (string literal grep)
- [ ] tsc 통과, 각 파일 200줄 이내
- [ ] gap-detector Match Rate ≥ 90%

## 8. 변경 파일 요약

**신규 (10)**:
- `drizzle/0055_tracker_funnels.sql`
- `src/components/tracker/types/funnel.ts` — FunnelStage / StageMatch / FunnelDefinition
- `src/lib/tracker/funnel-validations.ts` — zod
- `src/lib/tracker/funnel-analytics.ts` — stage별 visitor 집계 헬퍼
- `src/app/api/tracker/funnels/route.ts` (GET/POST)
- `src/app/api/tracker/funnels/[id]/route.ts` (GET/PATCH/DELETE)
- `src/app/api/tracker/analytics/funnel/route.ts`
- `src/components/tracker/ui/FunnelManagerCard.tsx`
- `src/components/tracker/ui/FunnelEditorDialog.tsx`
- `src/components/tracker/ui/FunnelStageEditor.tsx` (다이얼로그 안의 단계 한 줄 컴포넌트)
- `src/components/tracker/hooks/useTrackerFunnels.ts`
- `src/components/tracker/hooks/useFunnelAnalytics.ts`

**변경**:
- `drizzle/meta/_journal.json` (0055 등록)
- `src/lib/db/schema.ts` — trackerFunnels 테이블
- `src/components/tracker/ui/TrackerSettingsPanel.tsx` — FunnelManagerCard 추가
- `src/components/tracker/ui/widgets/FunnelPreview.tsx` — 동적 단계 렌더링으로 변경
- `src/components/tracker/ui/OverviewTab.tsx` — 메인 퍼널 데이터 fetch + fallback 안내

## 9. 리스크 / 주의

- **3가지 매칭 SQL이 분기 복잡**: stage 타입별 쿼리 분기 → 별도 헬퍼 모듈(`funnel-analytics.ts`)에 격리. 한 쿼리 안에 다 욱여넣지 않음.
- **visitor_records_all CTE 비용**: visitor 1만+ 시 무거울 수 있음. 현재 운영 1K 규모는 OK. 미래 인덱스 검토.
- **편집 다이얼로그 200줄 초과 가능성**: stage editor row를 별도 컴포넌트(`FunnelStageEditor.tsx`)로 분리.
- **isDefault 중복**: DB 제약 안 검 (`partial unique index` 가능하나 운영 복잡도). 운영자 실수 시 첫 번째 사용 — 안내 문구로 보완.
- **stages key slug 충돌**: 같은 label로 단계 두 개 추가 시 key는 `label-2` 같이 자동 부여. 저장 직전 client/server 양쪽에서.
- **trackerSites.conversionStage 거취**: 이번 PDCA는 fallback으로 살려둠. 다음 사이클(2.5/2.6)에서 운영 안정화 후 제거 검토.

## 10. 다음 단계

- 검토 후 `/pdca do tracker-funnels-v1`
- 운영 디하 사이트에 직접 퍼널 정의 → 실측
- 끝나면 로드맵 Phase 2 → ✅, 다음 Phase 2.5(compare-v1) plan
