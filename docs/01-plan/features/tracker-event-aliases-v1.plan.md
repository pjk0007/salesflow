# Plan: tracker-event-aliases-v1 (이벤트 이름 별칭 매핑)

> 작성일: 2026-05-29
> 상위 로드맵: [tracker-marketing-roadmap.plan.md](./tracker-marketing-roadmap.plan.md)
> Phase: Plan

## 1. 배경 / 문제

`tracker-engagement-v1`로 페이지 인게이지먼트 추적이 가능해졌다. 다만 운영자(마케터)가 보는 화면에 **개발자가 박은 raw 이름**이 그대로 노출된다:

```
섹션          평균 체류    방문자
hero          5초          1
service-cta   13초         1
trust-logos   9초          1
```

마케터 입장에선 `hero`, `service-cta`가 뭔지 한눈에 안 들어온다. **"메인 소개"**, **"가격 → 가입 CTA"** 같이 사람이 읽는 라벨로 보고 싶음.

업계 표준(Mixpanel, Amplitude, PostHog)은:
1. 개발자가 raw 이름(snake_case/kebab-case)을 박음
2. 운영자가 SaaS 설정에서 별칭(Display Name) 매핑
3. 분석 화면엔 별칭으로 표시, 데이터는 raw 이름으로 저장

이 흐름이 GA4 대비 PLG 도구의 강점. 우리도 채택.

## 2. 목표 (Goal)

운영자가 샌드비 설정 탭에서 **(event_type, event_name) → label** 매핑을 관리할 수 있게 한다.

- 분석 화면(`EngagementCard` 등)이 label 있으면 label로, 없으면 raw로 표시
- 별칭은 사이트 단위로 운영자만 관리 가능 (org 격리)
- raw 이름 변경 없이 운영자 단독으로 라벨 수정 가능

## 3. 범위 (이번 PDCA)

### 3-1. DB 신규 — `tracker_event_aliases`
```sql
CREATE TABLE tracker_event_aliases (
    id           serial PRIMARY KEY,
    org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    site_id      integer NOT NULL REFERENCES tracker_sites(id) ON DELETE CASCADE,
    event_type   varchar(30) NOT NULL,       -- SECTION_VIEW | CLICK
    event_name   varchar(100) NOT NULL,      -- 'hero' 같은 raw 이름
    label        varchar(200) NOT NULL,      -- '메인 소개' 같은 운영자 입력값
    created_at   timestamptz DEFAULT now() NOT NULL,
    updated_at   timestamptz DEFAULT now() NOT NULL,
    UNIQUE (site_id, event_type, event_name)
);
CREATE INDEX tracker_event_aliases_site_idx ON tracker_event_aliases (site_id);
```

### 3-2. CRUD API
- **GET `/api/tracker/event-aliases?siteId=`** — 사이트의 별칭 목록
- **POST `/api/tracker/event-aliases`** — 신규 (siteId, eventType, eventName, label)
- **PATCH `/api/tracker/event-aliases/[id]`** — label 수정
- **DELETE `/api/tracker/event-aliases/[id]`** — 삭제 (raw 이름으로 fallback)

### 3-3. 분석 API 통합
`/api/tracker/analytics/engagement` 응답에 label join:
- sections[i].label (alias 있으면 그 값, 없으면 null)
- clicks[i].label (동일)
- 단일 SELECT + LEFT JOIN으로 처리 (별도 라운드트립 X)

UI는 `label ?? name`으로 표시.

### 3-4. 설정 탭 UI — `EventAliasesCard`
- 설정 탭에 새 카드 추가
- 표 형태: event_type | event_name | label (편집 가능) | [✎] [🗑]
- 신규 추가 다이얼로그 (event_type 드롭다운 + event_name 자동완성 + label 입력)
- event_name 자동완성은 **최근 N일간 실제 발생한 이름** 기반 (이미 들어온 데이터에서 추출)

### 3-5. 자동완성 데이터 API
- **GET `/api/tracker/sites/[id]/event-name-options?days=30`** — 사이트의 최근 N일간 발생한 (event_type, event_name) 목록

## 4. 비범위

- **인라인 편집** (분석 화면에서 클릭→수정) — Phase 2. 일단 설정 탭에서만 관리.
- **다국어 라벨** (i18n) — Phase 3 이후
- **라벨 일괄 import/export** (CSV) — 운영 데이터 양 보고 결정
- **자동 라벨 추천** (AI) — 너무 멀음
- **이벤트 properties.section의 라벨링** — 일단 event_name만. 추가 요구 시 v2.
- **이벤트 카테고리/태그** — 별도 사이클

## 5. 해결 방안 비교

| 방안 | 내용 | 평가 |
|------|------|------|
| A. tracker_event_aliases 테이블 | 사이트별 매핑을 DB 테이블에 저장 | 권장 — 단순/확장 가능 |
| B. tracker_sites.aliases jsonb | 사이트 설정에 jsonb 통째로 | 비추 — 라벨 수십 개 넘어가면 row 커짐, 검색·정렬 어려움 |
| C. 별칭 없이 UI에서만 라벨 | 클라이언트 localStorage | 비추 — 사용자 간 공유 X |

**A 권장**. 인덱스로 빠른 lookup + org/site 격리 + 멱등 UNIQUE.

## 6. 영향 범위

**신규**:
- `drizzle/{next}_tracker_event_aliases.sql` + journal
- `src/lib/db/schema.ts` — `trackerEventAliases` 테이블
- `src/lib/tracker/event-alias-validations.ts` — zod
- `src/components/tracker/types/event-alias.ts`
- `src/app/api/tracker/event-aliases/route.ts` (GET/POST)
- `src/app/api/tracker/event-aliases/[id]/route.ts` (PATCH/DELETE)
- `src/app/api/tracker/sites/[id]/event-name-options/route.ts`
- `src/components/tracker/hooks/useEventAliases.ts`
- `src/components/tracker/hooks/useEventNameOptions.ts`
- `src/components/tracker/ui/EventAliasesCard.tsx` (설정 탭 카드)
- `src/components/tracker/ui/EventAliasEditorDialog.tsx`

**변경**:
- `src/app/api/tracker/analytics/engagement/route.ts` — sections/clicks에 label join
- `src/components/tracker/types/engagement.ts` — label 필드 추가
- `src/components/tracker/ui/widgets/EngagementCard.tsx` — `label ?? name` 표시
- `src/components/tracker/ui/TrackerSettingsPanel.tsx` — EventAliasesCard 추가

## 7. 결정 사항 (Design에서 확정)

1. **자동완성 데이터 범위**: 최근 30일? 90일? 전체?
2. **빈 별칭 처리**: label에 빈 문자열 허용 vs DELETE만
3. **event_type 드롭다운 옵션**: SECTION_VIEW/CLICK만? CUSTOM/PURCHASE 등도?
4. **인라인 편집 미리 도입 검토**: 카드 UI를 깔끔하게 만들고 ✎ 클릭 시 인라인 input? (또는 다이얼로그)
5. **별칭 변경 시 캐시 무효화**: SWR 키 어떻게 묶을지

## 8. Definition of Done

- [ ] `tracker_event_aliases` 마이그레이션 + schema 반영
- [ ] CRUD API (목록/생성/수정/삭제) 동작 + 인증·orgId 격리
- [ ] event-name-options API — 최근 발생 이름 자동완성용
- [ ] 설정 탭 `EventAliasesCard` — 표 + 추가/수정/삭제 다이얼로그
- [ ] 분석 응답에 label 포함 + EngagementCard가 label 우선 표시
- [ ] 디하 site_id=1에 6~8개 라벨 등록해서 화면에 한글로 표시되는지 실측
- [ ] tsc 통과, 각 파일 200줄 이내
- [ ] gap-detector Match Rate ≥ 90%

## 9. 리스크 / 주의

- **자동완성 SQL 비용**: tracker_events에 SECTION_VIEW/CLICK이 많이 쌓이면 distinct (type,name) 추출 비용 증가. 최근 30일 + LIMIT 100 권장. 필요시 캐시.
- **label 길이 제한**: 200자로 정의. 그 이상 입력하려는 niche 케이스는 거절.
- **별칭 삭제 시 즉시 raw 표시**: 화면 새로고침 안 하면 SWR 캐시로 옛 라벨 보일 수 있음 → mutate 호출 필수.
- **(event_type, event_name) 자체가 raw 키**: 운영자가 raw를 모르면 못 박음 — 자동완성으로 보완. 발생한 적 없는 이름도 수동 입력 허용 (선제 등록 가능).

## 10. 다음 단계

- `/pdca design tracker-event-aliases-v1` — 결정 사항 5개 확정 + 스키마/API/UI 상세
- Design 통과 후 `/pdca do` — 구현
- 디하 사이트에서 운영자가 실제 라벨링 → 화면에 한글 노출 확인
- 완료 시 [로드맵](./tracker-marketing-roadmap.plan.md#6-진척-추적)에 항목 추가
- 다음 후보: tracker-engagement-inline-edit-v1 (분석 화면에서 인라인 편집)
