# Plan: visitor-record-rematch (방문자-레코드 사후 자동 재연결)

> 작성일: 2026-05-21
> Phase: Plan

## 1. 배경 / 문제

트래커 방문자(`tracker_visitors`)가 가입·전환했는데도 CRM record와 **연결되지 않고 "익명"으로 남는** 케이스가 운영에서 반복 발생.

### 실제 사례 (운영)
- visitor 578 (gpggi1005@naver.com)
  - `first_seen_at` 03:39:37 → identify 호출
  - record 159764 (kakao 가입) `created_at` 03:40:18 — **identify보다 41초 늦게 생성**
  - 결과: identify 시점엔 매칭할 record가 없어 `recordId = NULL` → 이후 영구 익명

### 근본 원인
현재 매칭은 **identify가 호출되는 그 순간의 record만** 본다 (`src/app/api/tracker/identify/route.ts`).
1. 매칭 우선순위 matchField(uuid) → email → phone — 모두 **그 시점에 record가 존재해야** 잡힘.
2. **record 생성 시점에 visitor를 역매칭하는 호출이 없음**.
   - `linkVisitorByFormSubmit()` (record 생성 후 역매칭 함수)는 `src/lib/tracker/match-record.ts`에 **이미 존재**하지만:
     - `src/app/api/records/[id]/route.ts`의 POST/PATCH에서 **호출되지 않음**
     - 또한 클라이언트 `visitorId`(브라우저 쿠키)를 인자로 받아야 동작 → 카카오/소셜 가입처럼 visitorId가 record 생성 요청에 안 실리면 매칭 불가
3. visitor가 이후 페이지에서 다시 identify를 쏘면 matchField는 항상 재시도해 교정되지만(코드 76~89行), 가입 직후 이탈하면 재 identify가 오지 않아 영구 미연결.

### 타이밍 다이어그램
```
03:39:37  visitor identify  → record 없음 → recordId=NULL  ❌
03:40:18  record 생성        → visitor 역매칭 호출 없음     ❌
(이후)     재방문 없음        → 영구 익명                    ❌
```

## 2. 목표 (Goal)

가입/전환으로 record가 생성·갱신될 때, **이미 존재하는 미연결 visitor를 신뢰 키(matchField/email)로 사후 자동 연결**한다. visitorId 쿠키에 의존하지 않는다.

## 2-1. 설계 원칙 (제품 범용성) ⭐

이 기능은 **디하 전용 패치가 아니라 트래커 제품 전체의 매칭 규약**이다. 다음 3원칙을 반드시 만족.

1. **제품 무관 (any product)**: 디하/백오피스랩/외부 고객사 어느 워크스페이스든 동일하게 동작. 특정 제품·파티션·필드명 하드코딩 금지.
2. **범용 매칭 키**: 매칭 필드를 코드에 박지 않는다. 사이트별 설정 `tracker_sites.matchField`(예: uuid, userId, memberId 등) + 표준 키 `email`을 사용. `user_id`(identify 페이로드) ↔ `matchField` 매핑은 이미 존재하는 계약.
3. **사용자는 명세대로 스크립트 + API만**: 고객사는 기존 트래커 스크립트(`sendb.identify({ visitor_id, email, user_id, ... })`)와 사이트 설정(matchField)만 그대로 쓰면 된다. 내부 역매칭 로직을 몰라도 자동 연결돼야 한다.

### 외부 계약은 불변 (Breaking Change 금지)
현재 외부 인터페이스(`src/lib/tracker/validations.ts`)는 이미 범용적이고 충분하다:
- **스크립트/identify**: `{ visitor_id, email, user_id, name, phone }` — `user_id`가 사이트 matchField 값
- **사이트 설정**: `createSite/updateSite`의 `matchField`로 매칭 키 지정 (uuid 하드코딩 아님)
- **결론**: 이번 작업은 **순수 내부(서버) 타이밍 버그 수정**. 외부 페이로드/스크립트 스펙은 **변경하지 않는다.** 고객사는 코드 한 줄 안 바꿔도 자동 연결 혜택을 받는다.

## 3. 비목표 (Non-Goals)

- phone 단독 매칭으로 자동 연결 (오연결 위험 — 기존 정책 유지, matchField site 제외)
- 회사 단위(같은 도메인 다른 담당자) 묶기 — 별도 과제
- 트래커 visitor/event 데이터 구조 변경

## 4. 해결 방안 후보

| 방안 | 내용 | 장점 | 단점 |
|------|------|------|------|
| **A. record 생성/갱신 시 역매칭** | sendb record POST/PATCH(특히 가입·signup 이벤트)에서 같은 workspace의 미연결 visitor를 uuid/email로 찾아 연결 | 실시간, 근본적, 방문자 상세에도 즉시 반영 | record 생성 경로(sendb 내부 + 외부 유입)를 모두 커버해야 함 |
| **B. journey 조회 시 email fallback** | 여정 읽을 때 동적으로 email 매칭 | 가볍고 빠른 적용 | 방문자 상세 화면은 여전히 익명, 매 조회 비용, 링크 영구화 안 됨 |
| **C. 주기적 backfill 잡** | 미연결 visitor를 email/uuid로 일괄 연결 (cron) | 단순, 과거 누적분도 청소 | 실시간 아님(지연), 인프라 필요 |

### 권장: A (주) + C (과거 누적분 1회성 정리)
- **A**가 근본 해결. 신규 가입부터 미연결이 안 생김.
- **C**는 A 배포 전 이미 쌓인 dangling/익명 visitor를 1회 정리하는 마이그레이션 성격(스크립트).
- B는 채택 안 함 (방문자 상세 화면 미해결 + 영구화 안 됨).

## 5. 상세 설계 방향 (Design 단계에서 확정)

### A-1. 재사용 가능한 매칭 함수
`src/lib/tracker/match-record.ts`에 **visitorId 비의존** 역매칭 함수 추가/일반화:
```
rematchVisitorsByRecord({ workspaceId, recordId, uuid?, email? })
  → 같은 workspace의 활성 site에서 record_id IS NULL 이고
    (matchField=uuid 또는 email 일치)인 visitor 전부 연결
  → tracker_visitors.record_id 갱신 + visitor_record_links 누적 (멱등)
  → phone은 제외 (기존 정책)
```
- 기존 `identify/route.ts`의 매칭 우선순위 로직과 **중복 제거**(공용화) 검토.

### A-2. 호출 지점
- **sendb record 생성 API** (가입/폼 제출로 record 생김): record insert 직후 `rematchVisitorsByRecord` 호출.
- **record_events `signup` 이벤트 수신 시** (디하가 회원가입 쏠 때): 그 시점에도 역매칭 (가입=전환 신호라 가장 중요).
- 호출 위치 후보: `src/lib/record-events.ts`의 `insertRecordEvent` 또는 sendb POST 핸들러. Design에서 확정.

### C-1. 과거 누적분 정리 스크립트
```sql
-- 미연결 visitor를 email로 살아있는 record에 연결 (workspace 격리, 1:1 확인 후)
-- matchField(uuid) 우선, email 보조. phone 제외.
```
- 운영 적용 전 dry-run으로 매칭 건수/중복 검증 (이메일이 여러 record면 스킵).

## 6. 영향 범위

- `src/lib/tracker/match-record.ts` — 함수 추가/일반화
- `src/lib/record-events.ts` 또는 sendb record 생성 핸들러 — 역매칭 호출 추가
- `src/app/api/tracker/identify/route.ts` — 매칭 로직 공용화 시 리팩토링 (선택)
- 운영 1회성 backfill 스크립트 (코드 아님, 별도 실행)

## 7. Definition of Done (DoD)

- [ ] visitorId 없이 uuid/email로 미연결 visitor를 record에 연결하는 함수 구현 + 단위 동작 확인
- [ ] record 생성/`signup` 이벤트 시점에 역매칭 호출 → 신규 가입에서 익명 미발생 (로컬 e2e: 방문 → 41초 후 가입 → 자동 연결 확인)
- [ ] email이 여러 record에 중복될 때 자동 연결 스킵 (오연결 방지) 검증
- [ ] phone 단독으로는 자동 연결 안 됨 검증 (기존 정책 유지)
- [ ] 운영 과거 누적 미연결 visitor backfill 스크립트 dry-run → 매칭/중복 리포트 → 적용
- [ ] **범용성**: 제품·파티션·필드명 하드코딩 0건 (matchField 설정 + email 표준 키만 사용)
- [ ] **외부 계약 불변**: identify/collect/createSite 페이로드 스펙 변경 없음 (고객사 스크립트 무수정 동작)
- [ ] gap-detector Match Rate ≥ 90%

## 8. 리스크 / 주의

- **오연결**: email/uuid가 1:N이면 잘못 붙음 → 반드시 1:1일 때만 연결, 아니면 스킵.
- **workspace 격리**: 다른 워크스페이스 record로 새지 않게 workspace_id 조건 필수.
- **멱등성**: 같은 visitor-record 중복 링크 방지 (`visitor_record_links` onConflictDoNothing 기존 활용).
- **운영 미반영 스키마**: 로컬엔 `tracker_visitors.match_field` 컬럼 추가됐으나 **운영엔 없음**. Design에서 운영 스키마 기준으로 설계하거나 마이그레이션 동반 여부 결정.
