# Plan: 트래커 기능 (Visitor Behavior Tracker)

> **Summary**: 고객 사이트 head에 스크립트를 심어 모든 방문자(익명 포함)의 행동을 별도 테이블에 수집하고, 식별 시점에 sendb의 리드 record와 양방향으로 연결하는 트래커
>
> **Project**: Sendb (Salesflow)
> **Author**: jaehun
> **Date**: 2026-05-06
> **Status**: Draft (팀장님 컨펌 완료)

---

## 1. Overview

### 1.1 Purpose

고객사 사이트의 모든 방문자(익명 + 식별된 사람) 행동을 수집하여, sendb의 리드 관리 시스템과 자연스럽게 연결한다. **메타광고로 익명 방문 → 사이트 둘러보기 → 문의 폼 제출 → 리드 생성** 같은 흐름에서, 익명 단계의 행동 데이터를 잃지 않고 리드 record와 연결해 영업이 입체적으로 고객을 이해할 수 있게 한다.

### 1.2 팀장님 결정사항 (원문 인용)

```
1. 행동정보를 저장하는 파티션 새로 만들어서 저장
   왜냐하면 record에 없이 메타광고 등으로 유입된 사람이 홈페이지에서
   문의 제출해서 record가 생기는 경우 행동정보를 먼저 저장하고 있으면
   리드관리를 연동할 수 있음

   즉 리드관리 파티션과 행동 파티션 각각 서로를 참조해서
   릴레이션을 가지고 있으면 좋겠다고 생각했습니다

   예를 들면 리드관리 파티션에서 한 사람의 레코드를 조회하면
   관련된 행동정보도 가져오는 거죠

2. 행동정보는 정해진 컬럼이 있어서 별도 테이블을 만들어도 됩니다
   (기존 records는 컬럼을 커스텀할 수 있는 장점이 있지만 컬럼이
   변경되지 않고 sendb 서비스의 메인이 되는 기능이라면 굳이
   컬럼 변경 가능한 테이블을 만들 필요는 없음)
   그리고 데이터가 너무 많아서 기존 records를 썼을 때
   데이터 통계 쿼리가 너무 오래 걸리지 않을까 싶네요
```

### 1.3 핵심 설계 원칙

1. **추적 대상**: **모든 방문자** (익명 + 이메일 클릭자 + 식별된 사용자)
2. **저장 위치**: **별도 테이블** (records 안 씀)
   - 컬럼 고정, 통계 쿼리 성능 보장
3. **리드 연결**: `tracker_visitors.record_id` (FK → records.id) — 단방향 FK로 양방향 조회 모두 지원
4. **UI 노출**: 사용자에겐 **"파티션 형태"** 로 보임 (사이드바에 리드 파티션과 나란히)
5. **식별 트리거 3가지** 모두 지원

### 1.4 식별 트리거 (visitor → record 연결)

```
[케이스 1: 이메일 클릭으로 들어옴] (sendb 강점)
  메일 클릭 → URL에 sendb_cid → tracker.js가 발견
  → 서버에서 click_id로 emailSendLogs.recordId 조회
  → visitor.record_id 자동 채움

[케이스 2: 폼 제출 (메타광고 시나리오)]
  익명 방문 → 페이지 이동/이벤트 누적 → 폼 제출
  → 폼 hidden field에 visitor_id 포함
  → 서버에서 records 생성 + visitor.record_id UPDATE

[케이스 3: SDK identify 호출]
  사이트 코드: sendb.identify({ email: '...', userId: '...' })
  → 서버에서 그 email로 records 조회
     - 있으면: visitor.record_id = 그 record.id
     - 없으면: 새 record 생성 후 연결
```

### 1.5 양방향 조회 (단방향 FK로 가능)

```sql
-- 리드 record 상세화면 → 그 사람의 행동 가져오기
SELECT * FROM tracker_visitors WHERE record_id = 42;

-- 행동 visitor 상세 → 그 사람의 리드 정보 가져오기
SELECT * FROM records
WHERE id = (SELECT record_id FROM tracker_visitors WHERE visitor_id = 'abc');
```

`tracker_visitors.record_id`에 인덱스 1개만 박으면 양쪽 빠르게 조회.

### 1.6 다중 디바이스 / 다중 visitor 처리

`visitor = browser` 단위, `record = 사람` 단위. **1:N 관계**.

```
alice (records.id=42)
  ├─ tracker_visitors.id=1 (데스크탑 visitor_id="abc", record_id=42)
  ├─ tracker_visitors.id=2 (모바일 visitor_id="xyz", record_id=42)
  └─ tracker_visitors.id=3 (다른 브라우저 visitor_id="qrs", record_id=42)
```

리드 조회 시 visitor 행 여러 개 합산해서 표시.

### 1.7 Background

- **현재 상황**: sendb는 이메일 발송/클릭 추적까지 가능. 사이트 행동은 모름. 익명 방문자 추적 수단 없음.
- **참고 구현**: `~/Projects/adion` 트래커 (head 스크립트 + 4계층 스키마). 구조 차용 + sendb 식별 시스템 통합.
- **sendb 차별점**: adion은 광고 분석 전용이라 리드/CRM 연결 없음. sendb는 리드 records와 양방향 릴레이션이 핵심.

### 1.8 Related Documents

- adion 트래커: `/Users/jaehun/Projects/adion/public/tracker.js`, `/Users/jaehun/Projects/adion/app/api/tracker/`
- sendb 레코드 시스템: `src/lib/db/schema.ts:201` (records, partitions, fieldDefinitions)
- sendb 이메일 클릭 추적: `src/lib/db/schema.ts:646` (emailClickLogs), `src/lib/db/schema.ts:613` (emailSendLogs.recordId)
- sendb 웹폼 시스템: `src/lib/db/schema.ts:871` (webForms, webFormFields)

---

## 2. Scope

### 2.1 In Scope

- [ ] **트래커 등록/관리 UI**: 워크스페이스당 1개, 도메인 N개
- [ ] **트래커 스크립트**: `/tracker.js` 정적 파일 (adion 차용)
- [ ] **이벤트 수집 API**: `POST /api/tracker/collect` (CORS, Origin 검증, Rate limit)
- [ ] **자동 추적**: PAGE_VIEW, SPA 라우팅, UTM 파싱, 디바이스 감지, Heartbeat 체류시간
- [ ] **모든 방문자 추적**: 익명도 visitor_id로 추적 시작
- [ ] **별도 테이블 4개** (`tracker_sites`, `tracker_visitors`, `tracker_sessions`, `tracker_events`)
- [ ] **식별 트리거 3종**:
  - 이메일 클릭 시 click_id → recordId 자동 매칭
  - 폼 제출 시 visitor_id 같이 받아 record_id 채움
  - SDK `sendb.identify()` 함수 제공
- [ ] **커스텀 이벤트 SDK**: `window.sendb.track('event_name', props)`
- [ ] **이벤트 등록 UI**: 사용자가 추적할 이벤트 사전 정의 (선택, 검증/필터용)
- [ ] **양방향 UI 통합**:
  - 리드 record 상세화면에 "행동 정보" 패널 (관련 visitor + 최근 이벤트)
  - 사이드바에 트래커 파티션 (또는 메뉴) 추가, 클릭 시 visitor 목록 화면
- [ ] **설치 가이드 페이지**: head 스크립트 복사 + 설치 검증

### 2.2 Out of Scope (이번 안 함)

- ❌ 노코드 클릭 추적 (CSS 셀렉터 룰) — Phase 3 또는 후속
- ❌ Funnel/Cohort 분석, A/B 테스트
- ❌ adion의 conversion_goals (sendb 자동발송 규칙으로 대체)
- ❌ 모바일 앱 SDK
- ❌ Server-side tracking
- ❌ IP 기반 reverse lookup

### 2.3 향후 확장

- 노코드 클릭 룰 (`tracker_click_rules` 테이블) → Phase 3
- 행동 기반 자동발송 규칙 (예: "특정 페이지 3회 방문하면 메일") → 후속
- Funnel 분석 화면 → 후속

---

## 3. Goals

### 3.1 Primary Goals

1. **익명 → 식별 끊김 없는 추적**: 메타광고 클릭 → 익명 행동 → 폼 제출 시점에 과거 행동까지 다 리드로 합쳐짐
2. **리드 입체화**: 영업이 alice 리드를 보면 "어떤 페이지를 봤고, 몇 번 방문했고, 어디서 들어왔는지" 한눈에
3. **통계 성능 보장**: 별도 테이블 + 정해진 컬럼 → 행동 데이터 1억 row 쌓여도 빠른 집계

### 3.2 Success Criteria

- 익명 방문자가 사이트 5번 보고 폼 제출 → 영업이 보는 리드에 그 5번의 행동이 다 연결돼 있음
- 사이트 head에 1줄 심으면 5분 안에 visitor 데이터 들어옴
- 리드 record 상세화면 로딩이 1초 이내 (행동 데이터 join 포함)
- visitor 1억 row 쌓여도 단일 visitor 조회 < 50ms

---

## 4. 데이터 모델

### 4.1 신규 테이블 4개

```ts
// 1. 트래커 등록 정보
tracker_sites: {
  id, org_id (FK), workspace_id (FK),
  name, api_key (unique),
  domains: jsonb<string[]>,
  is_active,
  created_at, updated_at
}

// 2. 방문자 (browser 단위)
tracker_visitors: {
  id, site_id (FK),
  visitor_id (browser uuid, unique per site),
  record_id (FK → records.id, NULLABLE) ⭐,    -- 식별되면 채워짐

  -- 식별 정보 (record와 별개로 캐싱, 빠른 조회용)
  email, name, phone,

  -- 시간
  first_seen, last_seen,

  -- 카운터
  total_visits, total_pageviews, total_events,

  -- 디바이스
  device_type, browser, os,

  -- 유입
  first_utm_source, first_utm_campaign,
  last_utm_source, last_utm_campaign,
  first_referrer, last_referrer,

  -- 마지막 활동
  last_page, last_event, last_event_at,

  created_at, updated_at
}

// 3. 세션 (방문 1회)
tracker_sessions: {
  id, site_id (FK), visitor_id (FK),
  session_key,
  started_at, ended_at, duration,
  landing_page, exit_page, page_count,
  traffic_source,           -- DIRECT|PAID|SOCIAL|EMAIL|ORGANIC|REFERRAL
  referrer,
  utm_source, utm_medium, utm_campaign, utm_term, utm_content,
  click_id,                 -- sendb 이메일 클릭 추적
  is_first_visit,
}

// 4. 이벤트 (시계열 raw 로그)
tracker_events: {
  id, site_id (FK), session_id (FK), visitor_id (FK),
  event_type,               -- PAGE_VIEW|CLICK|CUSTOM|PURCHASE
  event_name,
  page_url, page_title,
  properties: jsonb,
  revenue,
  occurred_at
}
```

### 4.2 records ↔ tracker_visitors 릴레이션

```
records (리드)                tracker_visitors (방문자)
────────                      ──────────────────
id                 ◄──── FK ─ record_id (NULL 가능)
data: { ... }                 visitor_id, email, ...
```

**1 record : N visitors** (한 사람이 여러 디바이스로 방문 가능)

### 4.3 인덱스 전략

```sql
-- 리드 → 행동 조회 (record 상세화면)
CREATE INDEX tracker_visitors_record_id_idx ON tracker_visitors (record_id);

-- visitor 식별 조회
CREATE UNIQUE INDEX tracker_visitors_site_visitor_idx
  ON tracker_visitors (site_id, visitor_id);

-- email로 visitor 찾기 (식별 시점)
CREATE INDEX tracker_visitors_email_idx ON tracker_visitors (email);

-- 이벤트 시계열 조회
CREATE INDEX tracker_events_visitor_occurred_idx
  ON tracker_events (visitor_id, occurred_at DESC);
CREATE INDEX tracker_events_site_occurred_idx
  ON tracker_events (site_id, occurred_at DESC);
```

---

## 5. UI 노출 방식

팀장님 의도: 사용자에겐 **"파티션 형태"** 로 보임.

### 5.1 사이드바
```
[픽셀앤로직 (워크스페이스)]
  + 폴더    + 파티션
  📄 픽셀앤로직 [리드관리]
  📄 메일발송   [리드관리]
  📊 방문자     [트래커]   ⭐ 신규
```

### 5.2 트래커 파티션 클릭 시 화면

records 목록 UI와 비슷하지만 **행동 데이터 전용 컬럼**으로 표시:

```
이메일       이름   방문횟수  마지막방문  디바이스   유입채널    리드?
alice@...    Alice    5      05-06      desktop   google     ✅ 보기
unknown      -        2      05-05      mobile    facebook   - 미연결
...
```

`✅ 보기` 클릭 → 연결된 리드 record 상세화면으로 이동.

### 5.3 리드 record 상세화면에 "행동 정보" 패널

```
┌─ alice@... 상세 ────────────────────────┐
│ [기본 정보]                              │
│   이메일: alice@...                      │
│   회사: Acme                            │
│   상태: 진행중                           │
│                                        │
│ [행동 정보] ⭐ 신규                      │
│   디바이스 2개로 추적 중                  │
│   총 방문: 8회                          │
│   마지막 방문: 5/6 14:25                │
│   주요 유입: google                     │
│                                        │
│   [최근 이벤트 (10건)]                   │
│   05-06 14:25 페이지뷰 /pricing         │
│   05-06 14:23 회원가입_완료             │
│   05-06 14:20 페이지뷰 /                │
│   ...                                   │
│   [전체 행동 보기 →]                    │
└────────────────────────────────────────┘
```

### 5.4 구현 옵션 (Design 단계에서 결정)

**옵션 A: partitions 테이블 확장**
- partitions에 `source_table` 컬럼 추가 (`records` | `tracker_visitors`)
- 사이드바/UI 로직이 source_table 따라 분기
- ⚠️ 기존 partitions 시스템에 침투

**옵션 B: 별도 메뉴**
- partitions 시스템 안 건드림
- 사이드바에 "트래커" 별도 항목 (파티션 목록 아래 또는 위)
- ✅ 단순, 안전
- ⚠️ "파티션처럼" 보이긴 하는데 시스템상 파티션은 아님

→ **B로 시작 권장**. 사용자에겐 파티션처럼 보이지만 내부적으론 별도 시스템.

---

## 6. 사용자 시나리오

### 6.1 메타광고 → 폼 제출 (핵심 시나리오)

```
1. alice가 메타광고 클릭 → mysite.com 도착
   - URL: mysite.com/landing?utm_source=meta&fbclid=xxx
   - tracker.js: visitor_id="abc" 발급 (localStorage), record_id=NULL
   - tracker_visitors INSERT, tracker_sessions INSERT (utm_source=meta)
   - tracker_events INSERT (PAGE_VIEW)

2. alice가 /pricing, /features 등 둘러봄
   - tracker_events 누적, visitor.total_pageviews++

3. alice가 문의 폼 제출
   - 폼 hidden field에 visitor_id="abc" 포함하여 sendb에 POST
   - sendb 서버:
     a. records INSERT (id=42, data: { name, email, message })
     b. tracker_visitors UPDATE
        WHERE visitor_id = 'abc'
        SET record_id = 42, email = '...', name = '...'

4. 영업이 alice record 조회
   - records 상세화면에 "행동 정보" 패널 표시
   - "이 사람 메타광고로 들어와서 5번 방문했네"
```

### 6.2 이메일 클릭 시나리오

```
1. 영업이 CSV로 alice 리드 업로드 (records.id=42)
2. alice한테 이메일 발송 (emailSendLogs.recordId=42, click_id 부착)
3. alice가 메일 클릭 → mysite.com/?sendb_cid=clk_xxx
4. tracker.js: 신규 visitor_id="xyz" 발급
5. /api/tracker/collect:
   - click_id로 emailSendLogs.recordId=42 조회
   - tracker_visitors INSERT { visitor_id="xyz", record_id=42, email='...' }
6. 이후 행동 누적
7. 영업이 alice record 조회 → 새 visitor의 행동도 함께 표시
```

### 6.3 SDK identify 시나리오

```
1. 익명 방문자 visitor_id="abc"로 사이트 둘러봄
2. 사이트 회원가입 완료 시점:
   sendb.identify({ email: 'alice@...', userId: 'u_99' });
3. 서버:
   a. emails로 records 조회
      - 있으면 → visitor.record_id 채움
      - 없으면 → records INSERT 후 연결
4. 이후 자동 추적
```

### 6.4 트래커 설치 (마케터)

1. 워크스페이스 설정 → 트래커 탭 → "트래커 시작"
2. 도메인 입력 → 트래커 생성
3. head 스크립트 복사 → 사이트 head에 붙여넣기 → 배포
4. 설치 검증 버튼 → 5분 안에 첫 이벤트 수신 확인
5. (선택) 이벤트 등록 UI에서 "회원가입 완료" 같은 이벤트 사전 정의
6. (선택) 사이트 코드에 `sendb.track('signup_completed')` 추가

### 6.5 자동발송 연동

- 리드 records 파티션에 자동발송 규칙 그대로 적용
- 추가 가능 (Phase 4): "방문 횟수 >= 5인 사람한테 자동 메일" 같은 행동 기반 규칙

---

## 7. Phased Delivery

### Phase 1 — MVP: 트래커 작동 + 익명 추적
- DB 마이그레이션 (4개 테이블)
- `/tracker.js` (adion 변형, 모든 방문자 추적)
- `POST /api/tracker/collect`
- 트래커 등록 UI (head 스크립트 발급)
- 트래커 사이드바 메뉴 + visitor 목록 화면

### Phase 2 — 식별 통합
- 이메일 click_id 자동 매칭 (sendb_cid 부착 + collect에서 처리)
- 폼 제출 visitor_id 매칭 (web-forms submit API 확장)
- SDK `sendb.identify()` 함수
- 리드 record 상세화면에 "행동 정보" 패널

### Phase 3 — 커스텀 이벤트 + UX
- `sendb.track()` SDK
- 이벤트 등록/관리 UI (선택, 검증용)
- 설치 검증 버튼
- visitor 상세화면 (타임라인)

### Phase 4 — 노코드 클릭 추적 (선택, 후순위)
- `tracker_click_rules` 테이블
- UI에서 CSS 셀렉터 + 이벤트명 등록
- tracker.js에서 클릭 자동 캡처

---

## 8. Risks & Considerations

### 8.1 데이터 폭증
- 트래픽 큰 사이트는 PAGE_VIEW가 일 수만~수십만 건 → tracker_events 빠르게 커짐
- **대응**:
  - Phase 1: 인덱스 (`visitor_id, occurred_at`), `(site_id, occurred_at)` 박음
  - 1년치 데이터는 단일 테이블 OK
  - 1000만 row 넘기면 PostgreSQL 파티셔닝 (월별 테이블) 검토
- 통계는 visitor 단위로 미리 집계해두므로(`total_visits` 등) 기본 화면 빠름

### 8.2 visitor → record 연결 시점의 race condition
- alice가 동시에 두 탭에서 폼 제출하면? → record 2개 생기고 visitor가 한쪽만 가리킴
- **대응**: records.email에 unique constraint 또는 중복 처리 정책 (현재 sendb의 duplicate handling 활용)

### 8.3 다중 visitor 1 record 통합 화면
- alice가 디바이스 3개로 방문 → tracker_visitors row 3개
- 리드 상세화면에서 셋을 합산해 보여줘야 함
- **대응**: API 단에서 `SUM(total_visits)`, `MAX(last_seen)` 등으로 집계
- 이벤트 타임라인은 3개 visitor의 events를 union하여 시간순 정렬

### 8.4 폼 제출 시 visitor_id 전달
- sendb의 기존 web-forms `submit.ts` API에 visitor_id 파라미터 추가 필요
- 외부에서 만든 폼(랜딩페이지 빌더 등)이면 → 가이드에 hidden input 추가하라고 안내

### 8.5 보안
- API 키만으로 collect 호출 가능 → Origin 헤더로 등록 도메인만 허용
- API 키 단위 Rate Limit (분당 200건)
- 페이로드 10KB 제한
- click_id 검증 (emailClickLogs 실제 존재 확인)

### 8.6 PII / GDPR
- IP 주소 저장 X (또는 해시)
- 익명 방문자 데이터 보관 정책 필요 (90일/180일/무기한 — 운영 결정)
- 쿠키/localStorage 동의 배너는 고객사 책임

### 8.7 partitions 시스템 영향
- **별도 메뉴 방식(옵션 B)** 으로 가면 partitions에 침투 X → 안전
- 만약 옵션 A로 가면 fieldDefinitions, partitions 코드 영향 검토 필요

---

## 9. Dependencies

- 참고: adion 트래커 코드
- 사용:
  - sendb records, partitions, fieldDefinitions
  - emailClickLogs, emailSendLogs (recordId 기반 매칭)
  - webForms, webFormFields (폼 제출 시 visitor_id 받기)
  - 자동발송 규칙
- 추가 라이브러리: 없음

---

## 10. Open Questions (Design 단계에서 결정)

### Q1. UI 노출 방식
- 옵션 A (partitions 확장) vs 옵션 B (별도 메뉴)
- **현재 권장: B**

### Q2. 익명 방문자 데이터 보관 기간
- 30일 / 90일 / 180일 / 무기한
- 정책 결정 필요. **권장: 180일** (이메일 마케팅 사이클 고려)

### Q3. visitor 통합 vs 디바이스별 분리 (다중 디바이스 동일인)
- 같은 사람이 여러 visitor 가질 때 화면에 합쳐 보여줄지/분리해서 보여줄지
- **권장: 합쳐서 표시 (집계는 SUM/MAX), 디바이스 정보는 디바이스 탭에서**

### Q4. tracker_events 데이터 보관 기간
- visitor는 180일, events는 더 짧아도 됨 (예: 90일)
- **권장: events 90일, 그 후 자동 삭제 또는 archive**

---

## 11. Next Step

- [x] Plan 작성 완료
- [ ] Plan 검토
- [ ] `/pdca design tracker` (DB 마이그레이션 SQL, API 스펙, tracker.js diff, UI 와이어프레임, Phase 1 작업 분해)
