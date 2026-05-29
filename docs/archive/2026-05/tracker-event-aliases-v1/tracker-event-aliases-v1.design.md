# Design: tracker-event-aliases-v1 (이벤트 이름 별칭 매핑)

> 작성일: 2026-05-29
> Phase: Design
> Plan: [tracker-event-aliases-v1.plan.md](../../01-plan/features/tracker-event-aliases-v1.plan.md)

## 1. 설계 개요

운영자가 raw 이벤트 이름(`hero`, `service-cta` 등)에 한글 라벨을 매핑하는 기능.

흐름:
1. 사이트 설정 탭 → "이벤트 라벨" 카드 진입
2. 시스템이 **DB에서 그 사이트의 실제 발생 이벤트 (SECTION_VIEW + CLICK) 전 기간** 조회 → 표로 표시
3. 운영자가 각 줄의 라벨 입력 → 저장
4. 분석 화면(EngagementCard)은 label 있으면 label로, 없으면 raw로 표시

### Plan 결정 확정
| # | 결정 |
|---|------|
| 1 | 이벤트 목록 범위 = **전체 기간** (단순) |
| 2 | 빈 라벨 = **허용** (저장 시 raw 표시로 fallback) |
| 3 | event_type 옵션 = **SECTION_VIEW + CLICK 둘만** |
| 4 | 편집 UX = **다이얼로그 방식** |
| 5 | UI 위치 = **설정 탭에 EventAliasesCard 신설** |

## 2. 데이터 모델

### 2-1. `tracker_event_aliases` 테이블 (마이그레이션 0056)
```sql
CREATE TABLE tracker_event_aliases (
    id           serial PRIMARY KEY,
    org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    site_id      integer NOT NULL REFERENCES tracker_sites(id) ON DELETE CASCADE,
    event_type   varchar(30) NOT NULL,   -- 'SECTION_VIEW' | 'CLICK'
    event_name   varchar(100) NOT NULL,  -- 'hero', 'service-cta' 등 raw
    label        varchar(200) NOT NULL,  -- 운영자 입력. 빈 문자열 허용
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (site_id, event_type, event_name)
);
CREATE INDEX tracker_event_aliases_site_idx ON tracker_event_aliases (site_id);
```

### 2-2. Drizzle schema 정의
```ts
export const trackerEventAliases = pgTable("tracker_event_aliases", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    siteId: integer("site_id").references(() => trackerSites.id, { onDelete: "cascade" }).notNull(),
    eventType: varchar("event_type", { length: 30 }).notNull(),
    eventName: varchar("event_name", { length: 100 }).notNull(),
    label: varchar("label", { length: 200 }).notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
}, (table) => [
    unique("tracker_event_aliases_site_type_name_unique")
        .on(table.siteId, table.eventType, table.eventName),
    index("tracker_event_aliases_site_idx").on(table.siteId),
]);
```

## 3. API

### 3-1. GET `/api/tracker/event-aliases?siteId=`
**목적**: 운영자가 라벨 관리 카드 진입 시 호출.
**응답**: 그 사이트에서 **실제 발생한 (event_type, event_name) 목록** + 등록된 label (있으면).

```json
{
  "success": true,
  "data": [
    { "id": 7,    "eventType": "SECTION_VIEW", "eventName": "hero",            "label": "메인 소개",      "occurrences": 1284 },
    { "id": null, "eventType": "SECTION_VIEW", "eventName": "trust-logos",     "label": null,             "occurrences": 642 },
    { "id": 12,   "eventType": "CLICK",        "eventName": "hero-free-trial", "label": "무료 체험 버튼", "occurrences": 230 }
  ]
}
```

- `id`: alias row id (없으면 null = 미등록)
- `label`: alias.label (없으면 null)
- `occurrences`: 전 기간 발생 횟수 (정렬·우선순위용)

### 3-2. SQL 핵심 (서버 측 조합)
```sql
SELECT
    a.id,
    ev.event_type AS "eventType",
    ev.event_name AS "eventName",
    a.label,
    COUNT(*)::int AS occurrences
FROM tracker_events ev
LEFT JOIN tracker_event_aliases a
    ON a.site_id = ev.site_id
    AND a.event_type = ev.event_type
    AND a.event_name = ev.event_name
WHERE ev.site_id = $1
  AND ev.event_type IN ('SECTION_VIEW', 'CLICK')
  AND ev.event_name IS NOT NULL
GROUP BY a.id, ev.event_type, ev.event_name, a.label
ORDER BY ev.event_type, occurrences DESC
LIMIT 200
```

### 3-3. POST `/api/tracker/event-aliases`
신규 별칭 등록. body: `{ siteId, eventType, eventName, label }`. UNIQUE 제약으로 중복 방지.
- 인증 + orgId/siteId 격리 (`site.orgId === user.orgId`)
- event_type은 `["SECTION_VIEW", "CLICK"]`만 허용

### 3-4. PATCH `/api/tracker/event-aliases/[id]`
label만 수정. body: `{ label }`.

### 3-5. DELETE `/api/tracker/event-aliases/[id]`
별칭 제거 → 분석 화면에서 raw 이름으로 fallback.

### 3-6. 검증 zod
```ts
export const eventAliasCreateSchema = z.object({
    siteId: z.number().int().positive(),
    eventType: z.enum(["SECTION_VIEW", "CLICK"]),
    eventName: z.string().min(1).max(100),
    label: z.string().max(200), // 빈 문자열 허용 (Plan 결정 2)
});
export const eventAliasUpdateSchema = z.object({
    label: z.string().max(200),
});
```

## 4. 분석 API 통합 — `/api/tracker/analytics/engagement`

기존 sections / clicks 응답에 label join:

```sql
-- sections (수정 후)
SELECT
    ev.event_name AS name,
    a.label AS label,                       -- NEW
    COUNT(DISTINCT ev.visitor_id)::int AS visitors,
    COUNT(*)::int AS pageviews,
    COALESCE(AVG((ev.properties->>'dwell_ms')::numeric), 0)::int AS "avgDwellMs"
FROM tracker_events ev
JOIN tracker_visitors tv ON tv.id = ev.visitor_id
LEFT JOIN tracker_event_aliases a
    ON a.site_id = ev.site_id
    AND a.event_type = 'SECTION_VIEW'
    AND a.event_name = ev.event_name
WHERE ev.site_id = ${siteId}
  AND ev.event_type = 'SECTION_VIEW'
  ...
GROUP BY ev.event_name, a.label
ORDER BY visitors DESC
```

clicks SQL도 동일 패턴(`event_type='CLICK'` join).

### 4-1. 응답 타입 변경
```ts
// types/engagement.ts
export interface EngagementSectionStat {
    name: string;
    label: string | null;   // NEW — null 또는 빈 문자열이면 name으로 표시
    visitors: number;
    pageviews: number;
    avgDwellMs: number;
    viewRate: number;
}
export interface EngagementClickStat {
    name: string;
    label: string | null;   // NEW
    section: string | null;
    clicks: number;
    visitors: number;
    clickRate: number;
}
```

### 4-2. UI 표시 로직 (EngagementCard)
```tsx
<td>{r.label && r.label.trim() ? r.label : r.name}</td>
```

빈 문자열도 raw로 fallback (Plan 결정 2).

## 5. UI — `EventAliasesCard` (설정 탭)

### 5-1. 카드 구조
```
[이벤트 라벨]                                                  [+ 새 별칭 등록]

설명: 운영자가 보기 좋은 라벨을 설정하면 마케팅 탭에서 별칭으로 표시됩니다.

[필터 토글] 전체 | SECTION_VIEW | CLICK

┌────────────────────────────────────────────────────────────────────┐
│ 타입         │ 이름             │ 라벨            │ 발생 │ 액션    │
├────────────────────────────────────────────────────────────────────┤
│ SECTION_VIEW │ hero             │ 메인 소개       │ 1284 │ [✎] [🗑] │
│ SECTION_VIEW │ trust-logos      │ (미설정)        │  642 │ [+ 추가] │
│ CLICK        │ hero-free-trial  │ 무료 체험 버튼  │  230 │ [✎] [🗑] │
│ CLICK        │ nav-portfolio    │ (미설정)        │  187 │ [+ 추가] │
└────────────────────────────────────────────────────────────────────┘
```

### 5-2. 다이얼로그 (EventAliasEditorDialog)
**신규 모드** ("+ 새 별칭 등록"):
- 이벤트 타입 드롭다운 (SECTION_VIEW / CLICK)
- 이벤트 이름 입력 (Combobox — 사이트의 실제 이벤트에서 선택 또는 직접 입력)
- 라벨 입력
- [취소] [저장]

**편집 모드** (✎):
- 이벤트 타입·이름 비활성 (변경 불가)
- 라벨만 수정 가능

### 5-3. 표 행 클릭 → 편집 다이얼로그 (UX 보강)
- "+ 추가" 행은 신규 다이얼로그를 해당 (type, name)으로 prefill해서 열기
- ✎ 행은 편집 다이얼로그

### 5-4. 빈 상태
사이트에 SECTION_VIEW/CLICK 이벤트가 0건이면:
```
아직 추적된 이벤트가 없습니다.
페이지에 data-track-section / data-track-click 속성을 박은 후
방문이 발생하면 이곳에 표시됩니다.
[설치 가이드 보기]
```

## 6. 영향 파일 목록

**신규**:
- `drizzle/0056_tracker_event_aliases.sql` + journal 갱신
- `src/lib/db/schema.ts` — `trackerEventAliases` 정의
- `src/lib/tracker/event-alias-validations.ts` — zod 스키마
- `src/components/tracker/types/event-alias.ts` — 응답 타입
- `src/app/api/tracker/event-aliases/route.ts` — GET (목록 + 발생수 join) / POST
- `src/app/api/tracker/event-aliases/[id]/route.ts` — PATCH / DELETE
- `src/components/tracker/hooks/useEventAliases.ts` — SWR hook
- `src/components/tracker/ui/EventAliasesCard.tsx` — 설정 탭 카드
- `src/components/tracker/ui/EventAliasEditorDialog.tsx` — 신규/편집 다이얼로그

**변경**:
- `src/app/api/tracker/analytics/engagement/route.ts` — sections/clicks SQL에 alias LEFT JOIN
- `src/components/tracker/types/engagement.ts` — label 필드 추가
- `src/components/tracker/ui/widgets/EngagementCard.tsx` — `label || name` 표시
- `src/components/tracker/ui/TrackerSettingsPanel.tsx` — EventAliasesCard 추가

## 7. 검증 체크리스트

- [ ] `npx tsc --noEmit` 통과
- [ ] 새 마이그레이션 0056 정상 적용 (UNIQUE 제약 동작)
- [ ] GET event-aliases가 발생수 desc 정렬 + 등록된 라벨 함께 반환
- [ ] POST: 중복 등록 시 UNIQUE 위반 → 적절한 에러 응답 (409 또는 400)
- [ ] PATCH: 빈 문자열 label 저장 가능
- [ ] DELETE 후 분석 화면이 raw 이름으로 fallback
- [ ] EngagementCard에서 라벨 있으면 라벨, 없으면 raw 표시
- [ ] 다른 org 토큰으로 PATCH/DELETE 시도 → 401/403 격리 확인
- [ ] 각 파일 200줄 이내
- [ ] 디하 site_id=1에 6~8개 라벨 등록해서 마케팅 탭에 한글로 표시되는지 실측

## 8. 리스크 / 주의

- **GET 발생수 계산 비용**: tracker_events에서 GROUP BY로 distinct (type, name) 추출. site별로 수십만 이벤트일 수 있어 인덱스 활용 필수. `tracker_events_type_idx (site_id, event_type)` 이미 있음. 200건 LIMIT으로 폭주 방지.
- **분석 응답 캐싱**: 라벨 변경 후 EngagementCard에서 SWR 캐시가 옛 라벨 보일 수 있음 → useEventAliases의 mutate 호출 시 `useEngagementAnalytics` 키도 같이 무효화. 또는 useSWR `revalidateOnFocus: true`로 자연 해결.
- **빈 라벨의 의미**: zod에서 허용했지만 UI에선 "(미설정)" 표시. 데이터는 별칭 row가 있지만 사실상 raw 표시되는 상태.
- **운영자가 같은 이름을 다른 타입에 박을 수 있음**: 예 `hero`가 SECTION_VIEW에도, CLICK에도 존재 가능. UNIQUE는 (site_id, event_type, event_name) 조합이라 OK.

## 9. 다음 단계

- `/pdca do tracker-event-aliases-v1` — 구현 (마이그레이션 → API → UI 순)
- 로컬에서 디하 site_id=1에 별칭 5개 정도 등록 → 마케팅 탭 한글 표시 확인
- gap-detector 분석 → report → archive
- 다음 사이클 후보: **tracker-engagement-inline-edit-v1** (마케팅 탭에서 ✎ 클릭으로 인라인 편집)
