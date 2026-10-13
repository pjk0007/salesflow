# PLAN — 이메일 클릭 봇 필터

- **track**: Full
- **사이클 ID**: `2026-10-13-email-click-bot-filter`

Full로 판정한 근거는 설계에서 정할 질문이 남아 있다는 점이다. 남은 질문은 다음과 같다.
- 연속 클릭 (b)의 사후 재판정을 동시 요청에서 어떻게 지킬지 (발송 단위 잠금)
- 백필을 마이그레이션 안에서 할 때 생기는 잠금과 부팅 실패 영향
- 통합 로그 API에서 클릭 수를 어디서 계산할지
- 2단계 표기의 시각 사양

## 배경

2026-10-13 운영 DB를 읽기 전용으로 분석했다. 클릭 35,366건 중 트래커 도메인 클릭은 18,559건이다.

- **사람 판정 근거**: 클릭의 click_id로 이어진 트래커 세션에 CLICK·CUSTOM 이벤트가 있는 경우다. SECTION_VIEW는 렌더링 스캐너도 남기므로 근거로 쓰지 않는다.
- **R6 규칙**: 아래 셋 중 하나라도 맞으면 봇으로 본다.
  - (a) 발송 후 15초 안에 들어온 클릭
  - (b) 같은 발송에서 ±10초 안에 다른 클릭이 2건 이상인 클릭
  - (c) 봇 UA
- **성능**: R6는 클릭의 60%를 걸러내고, 사람은 1.9%만 잃는다. "2분 안" 기준은 사람 5.2%를 잃어서 쓰지 않는다.
- **영향**
  - 클릭한 발송의 약 35%는 봇 클릭만 있다.
  - 후속 분기에서 clicked로 판정된 12,305건 중 927건은 봇 클릭만 있었다.

## 목표

메일 보안 검사기가 링크를 미리 연 클릭을 기록할 때 R6 규칙으로 판정하고, 결과를 `email_click_logs.is_bot`·`bot_reason`에 저장한다. 연속 클릭은 뒤 클릭이 들어올 때 앞 클릭까지 다시 판정한다. 과거 약 3.5만 행도 같은 규칙으로 채운다.

후속 메일 분기, 대시보드·분석, 발송 로그, MCP, 후속 테스트의 클릭 판정과 집계는 사람 클릭만 쓴다. click_id 기반 트래커 매칭, 깊이 알림, 고객 여정 카드는 지금처럼 둔다.

2단계로, 트래커 사이트에서 CLICK·CUSTOM 행동이 이어진 발송을 발송 이력 표와 통합 로그 표의 클릭 칸에 아이콘과 굵기로 표시한다. 보이는 한글 글자는 늘리지 않는다.

## 조사 결과 (근거)

1. **클릭 기록**
   - `src/lib/email-click-tracking.ts:52-78`의 `recordClick()`은 send log의 orgId만 읽고 판정 없이 insert한다.
   - `clicked_at`은 DB 기본값이다.
   - 라우트(`src/app/api/track/click/route.ts:24-33`)는 기록이 실패해도 302로 보낸다.
2. **후속 분기**
   - 판정 지점은 `hasClicked()`(`email-click-tracking.ts:84-91`) 하나이고, 부르는 곳은 `src/lib/email-followup.ts:453`뿐이다.
   - 처리할 때마다 다시 판정하므로, 배포 뒤 대기 중인 후속도 새 기준을 탄다.
3. **집계 지점** (`email_click_logs|emailClickLogs` grep, 18개 파일 전수)
   - `analytics/summary`: `:98-114` (inner join)
   - `analytics/templates`: `:58`, `:81` (LEFT JOIN). 조건을 WHERE에 두면 클릭 없는 발송이 total·sent에서 빠진다.
   - `analytics/trends`: `:50` (EXISTS)
   - `analytics/email-daily`: `:99-101` (EXISTS)
   - `email/logs`: 필터 `:61-67`, 클릭 수 `:110-125`
   - `logs/unified`: `:32-34` (UNION 안의 상관 서브쿼리)
   - `mcp/tools.ts`: `:305-316`
   - test-followup GET: `:56-65`
   - `tracker/journey.ts`: `:149-153`, `:188-197`, `:266`
4. **매칭 지점**
   - `tracker/collect`, `match-record`, `resolve-attribution`은 click_id 한 건을 조회한다.
   - 깊이 알림은 자체 기준(발송 2분 뒤 클릭 = 사람)을 쓴다. 위치는 `deep-visitor-alert-rules.ts:260,339-342`이다.
   - 고객 여정은 세션에서 출발한다.
5. **sent_at**은 로그 insert 시각(NHN 호출 직전)이다. 미래 시각으로 쓰는 경로는 없다.
6. **마이그레이션**
   - `src/lib/db/migrate.ts`는 밀린 마이그레이션을 한 트랜잭션으로 돌리고, 55P03이 나면 3번 다시 시도한다.
   - 실패하면 `src/instrumentation.ts`가 서버를 띄우지 않는다.
   - 최신은 0079(when 1774200000000)다. 0079는 마이그레이션 안에서 백필한 선례다.
7. **잠금 선례**: `src/lib/email-prepared-sends.ts`의 `pg_advisory_xact_lock(키, 값)`이다. 사용 중인 키는 0x5c4edf01~13이다.
8. **사이트 액션 조회용 색인**이 이미 있다: `tracker_sessions_click_id_idx`, `tracker_events_session_idx`.
9. **화면**
   - 클릭 뱃지가 `EmailSendLogTable.tsx:463-473`과 `UnifiedLogTable.tsx:203-213`에 중복돼 있다.
   - UnifiedLogTable은 `/logs`와 레코드 상세(compact)에서 쓴다.
   - lucide-react에 `Bot`·`MousePointerClick` 아이콘이 있다.
10. **테스트**
    - `package.json`의 `"test": "tsx --test \"src/**/*.test.ts\""`를 쓴다 (node:test).
    - 순수 규칙 파일은 `@/lib/db`를 import하지 않는다.

## 판단·제안

### 트래커 매칭과 봇 판정

| 지점 | 제안 | 이유 |
|---|---|---|
| tracker/collect, match-record, resolve-attribution | **유지** (봇 여부를 보지 않는다) | 판정 오류로 연결이나 출처를 잃으면 되돌릴 수 없다. 폼을 낸 사람은 사람이다. (b)는 사후 판정이다 |
| 깊이 알림, 고객 여정 카드 | **유지** | 자체 기계 판정이 따로 검증돼 있다. R6로 바꾸는 건 별도 사이클로 한다 |
| 리드 여정 (`buildRecordJourney`) | 클릭 집계에서 **봇 제외** (P2) | 매칭이 아니라 표시와 집계다 |

### 사람 클릭 / 전체 표시

- **집계 화면**: 사람 클릭만 보여준다. 백필로 과거 기간도 같은 기준으로 다시 센다.
- **행 화면**: 사람 클릭 수를 주로 표기한다. 봇 클릭만 있는 발송은 "-" 대신 흐린 봇 아이콘 뱃지로 구분한다. 섞인 발송의 전체 수는 툴팁으로 보여준다.
- **API**: 발송 이력, 통합 로그, MCP `list_email_logs`가 `clickCount`(사람)와 `botClickCount`를 함께 준다.

### 2단계 사이트 액션 표기

- **근거**: 발송 클릭의 click_id로 이어진 **같은 조직** 사이트 세션에 CLICK·CUSTOM 이벤트가 1건 이상 있으면 표시한다. 봇 판정과는 무관하게 본다.
- **화면**: 이메일 > 발송 이력(`EmailSendLogTable`), `/logs`, 레코드 상세 발송 이력(`UnifiedLogTable`)
- **모양**: 클릭 칸 뱃지 앞에 `MousePointerClick` 아이콘을 붙이고, 숫자를 굵게 하고, 테두리를 강조한다. 한글 라벨은 쓰지 않는다. 두 표가 같은 셀 컴포넌트를 쓴다.

### 백필 방식

마이그레이션 `0080` 안에서 SQL로 한다.
- **이유**: 3.5만 행이라 짧게 끝나고, 스키마 변경과 원자적으로 들어간다 (0079 선례).
- **대가**: 실패하면 서버가 뜨지 않는다. 그래서 로컬에서 먼저 검증하고, SQL 기준이 TS 상수와 같은지 테스트로 대조한다.

## 단계별 작업

1. **DESIGN**: 아래를 정한다.
   - 사유 값과 우선순위 (`ua` → `early` → `burst`)
   - `recordClick` 트랜잭션 순서와 새 잠금 키
   - 클릭 신호 도우미의 위치와 SQL
   - 통합 로그에서 클릭 수를 어디서 계산할지
   - 백필 (b)의 SQL 형태
   - 봇 제외 조건을 공통 조각으로 둘지
   - 클릭 칸 시각 사양
2. **판정 규칙 TDD**
   - `src/lib/email-click-bot-rules.test.ts`를 먼저 쓰고 RED를 확인한 뒤 `src/lib/email-click-bot-rules.ts`를 만든다.
   - 상수: `EARLY_CLICK_MS = 15_000`, `BURST_WINDOW_MS = 10_000`, `BURST_MIN_NEIGHBORS = 2`, `BOT_UA_PATTERN`
   - 이 파일은 `@/lib/db`를 import하지 않는다.
   - 함수 이름은 깊이 알림의 `isHumanClick`과 겹치지 않게 한다.
3. **스키마·마이그레이션**
   - `emailClickLogs`에 `isBot`(boolean, not null, default false)과 `botReason`(varchar 16)을 추가한다.
   - `drizzle/0080_email_click_bot.sql`
     - `SET LOCAL lock_timeout = '5s'`
     - 칸 2개 추가
     - 백필 3단: ua → early → burst
   - `_journal.json`에 idx 80, when 1774300000000으로 등록한다.
4. **클릭 기록 경로**: `recordClick()`을 한 트랜잭션으로 바꾼다.
   1. 발송 단위 advisory 잠금을 건다.
   2. clickedAt을 정하고 판정한다.
   3. insert한다.
   4. ±20초 창을 읽어 연속 클릭을 판정한다.
   5. 아직 봇이 아닌 행만 `burst`로 update한다.
   - 반환값, 라우트, sendb_cid 부착은 그대로 둔다.
5. **1단계 봇 제외**: 다음 지점에서 봇 클릭을 뺀다.
   - `hasClicked()`
   - summary, templates (LEFT JOIN ON), trends, email-daily
   - email/logs의 `isClicked` 필터
   - test-followup GET
   - journey (P2)
6. **클릭 신호 도우미와 로그 API**
   - send log id 목록을 받아 `{ clickCount, botClickCount, hasSiteAction }` 맵을 돌려준다.
   - email/logs, unified, MCP에 붙인다.
   - unified는 UNION 안의 서브쿼리를 빼고 페이지 뒤에서 붙인다.
7. **2단계 화면**: 다음 순서로 만든다.
   1. `clickCell.test.ts`
   2. `clickCell.ts` (순수 함수)
   3. `ui/ClickCountCell.tsx` (표시만)
   4. 두 표의 클릭 칸 교체
8. **로컬 검증**: 아래 "검증 방법"을 따른다.
9. **커밋·운영 반영**
   - 커밋은 사용자 확인 뒤에 한다.
   - 운영 반영은 사용자가 요청할 때만 한다. 배포하면 부팅 때 0080이 운영 `email_click_logs`를 ALTER하고 약 3.5만 행을 UPDATE한다.

## 건드릴 파일

| 파일 | 변경 요지 |
|---|---|
| `src/lib/email-click-bot-rules.ts` **(신규)** | R6 상수와 순수 판정 함수 |
| `src/lib/email-click-bot-rules.test.ts` **(신규)** | B1~B7, B13 |
| `drizzle/0080_email_click_bot.sql` **(신규)** | 칸 2개와 백필 3단 |
| `drizzle/meta/_journal.json` | idx 80 등록 |
| `src/lib/db/schema.ts` | `emailClickLogs`에 `isBot`·`botReason` |
| `src/lib/email-click-tracking.ts` | `recordClick()`에 판정·잠금·재판정, `hasClicked()`는 사람만, 클릭 신호 도우미 |
| `src/app/api/analytics/summary/route.ts` | 봇 제외 2곳 |
| `src/app/api/analytics/templates/route.ts` | LEFT JOIN ON 2곳에 봇 제외 |
| `src/app/api/analytics/trends/route.ts` | EXISTS에 봇 제외 |
| `src/app/api/analytics/email-daily/route.ts` | EXISTS에 봇 제외 |
| `src/app/api/email/logs/route.ts` | 필터 봇 제외, 클릭 수는 도우미로 |
| `src/app/api/logs/unified/route.ts` | 클릭 수 계산을 페이지 뒤로 이동 |
| `src/types/index.ts` | `UnifiedLog`에 `botClickCount?`·`hasSiteAction?` |
| `src/lib/mcp/tools.ts` | `list_email_logs`가 도우미를 쓰고, 도구 설명을 고친다 |
| `src/app/api/email/auto-personalized/test-followup/route.ts` | 사람 클릭 기준 |
| `src/lib/tracker/journey.ts` | 봇 제외 (P2) |
| `src/components/email/clicks/types/index.ts` **(신규)** | `ClickSignal` |
| `src/components/email/clicks/utils/clickCell.ts` **(신규)** | 표시 결정 순수 함수 |
| `src/components/email/clicks/utils/clickCell.test.ts` **(신규)** | B26 |
| `src/components/email/clicks/ui/ClickCountCell.tsx` **(신규)** | 표시만 |
| `src/components/email/EmailSendLogTable.tsx` | 클릭 칸 교체 |
| `src/components/logs/UnifiedLogTable.tsx` | 클릭 칸 교체 |

**변경 없음 (확인만)**
- 클릭 라우트, `email-followup.ts`
- tracker/collect, match-record, resolve-attribution
- deep-visitor-alert, customer-journey
- `migrate.ts`
- 대시보드 컴포넌트

새 의존성은 없다.

## behavior 목록

- **B1** [TDD] UA가 null이거나 빈 문자열이거나 공백뿐이면 봇이고, 사유는 `ua`다. (P1)
- **B2** [TDD] UA가 R6 정규식 토큰(curl, python, node-fetch, ruby, go-http, java/, guard, antispam, linker, scan, bot, spider, preview, headless, wget, okhttp, msie)을 대소문자 구분 없이 포함하면 봇이고, 사유는 `ua`다. (P1)
- **B3** [TDD] 맨 앞이 `mozilla/5.0 chrome/`인 UA는 봇이다. 일반 Chrome, Safari, Edge, Firefox, 삼성 인터넷 UA는 봇이 아니다. (P1)
- **B4** [TDD] 발송 시각과의 차이가 15초 미만(14.999초, 0초, 음수)이면 봇이고, 사유는 `early`다. 15초 이상이면 이 규칙으로는 봇이 아니다. (P1)
- **B5** [TDD] 규칙이 여럿 맞으면 사유는 `ua` → `early` → `burst` 순서로 하나만 남는다. (P2)
- **B6** [TDD] 같은 발송에서 한 클릭의 ±10초 안(10초 정각 포함)에 다른 클릭이 2건 이상이면 그 클릭은 봇이고, 사유는 `burst`다. 1건이면 봇이 아니다. 0·9·18초 사슬이면 가운데 1건만 봇이다. (P1)
- **B7** [TDD] 연속 클릭의 이웃 수에는 이미 `ua`나 `early`로 봇인 클릭도 들어간다. 다른 발송의 클릭은 들어가지 않는다. (P1)
- **B8** 클릭을 기록하면 is_bot·bot_reason이 함께 저장된다. 봇이어도 302 리다이렉트와 sendb_cid 부착은 지금과 같다. (P1)
- **B9** 사람으로 저장된 두 클릭 뒤 10초 안에 세 번째 클릭이 오면, 앞의 두 클릭도 `burst`로 다시 판정된다. (P1)
- **B10** 같은 발송에 클릭 요청이 동시에 여러 건 와도 연속 클릭 판정이 빠지지 않는다. (P1)
- **B11** 재판정은 아직 봇이 아닌 클릭만 바꾼다. 이미 봇인 클릭의 사유는 덮어쓰지 않는다. (P2)
- **B12** 0080을 적용하면 `is_bot boolean NOT NULL DEFAULT false`와 `bot_reason`이 생기고, 기존 행이 B1~B7 규칙대로 채워진다. (P1)
- **B13** [TDD] 0080 SQL의 UA 정규식과 15초·10초 기준이 TS 상수와 같다. 테스트가 SQL 파일을 읽어서 대조한다. (P1)
- **B14** 0080이 journal idx 80으로 등록돼 한 번만 적용되고, 재부팅해도 다시 돌지 않는다. `SET LOCAL lock_timeout = '5s'`를 건다. (P1)
- **B15** `hasClicked()`는 봇 클릭만 있는 발송이면 false, 사람 클릭이 1건이라도 있는 발송이면 true를 돌려준다. (P1)
- **B16** summary의 clicked·clickRate와 발송 유형별 clicked는 사람 클릭이 있는 발송만 센다. (P1)
- **B17** templates의 clicked는 사람 클릭만 센다. 클릭이 없거나 봇 클릭만 있는 발송도 total·sent에는 그대로 들어간다. (P1)
- **B18** trends와 email-daily의 clicked는 사람 클릭이 있는 발송만 센다. (P1)
- **B19** 발송 이력 API에서 `isClicked=1`은 사람 클릭이 있는 발송만 돌려준다. `isClicked=0`은 사람 클릭이 없는 발송(봇 클릭만 있는 발송 포함)을 돌려준다. (P1)
- **B20** 발송 이력 API와 통합 로그 API의 이메일 행에 clickCount(사람)와 botClickCount가 온다. 통합 로그의 정렬, 페이지, 총건수는 바뀌지 않는다. (P1)
- **B21** MCP `list_email_logs`의 clickCount는 사람 클릭 수이고, botClickCount가 함께 온다. 도구 설명에 봇 클릭 제외가 적혀 있다. (P1)
- **B22** test-followup GET의 isClicked는 사람 클릭 기준이다. (P2)
- **B23** 리드 여정(`buildRecordJourney`)의 클릭 이벤트와 emailClicks·emailClickRate에서 봇 클릭이 빠진다. (P2)
- **B24** 봇으로 판정된 클릭의 click_id로도 트래커 연결(tracker/collect, match-record)과 유입 출처(resolve-attribution)가 지금처럼 잡힌다. 깊이 알림·고객 여정의 기존 테스트도 통과한다. (P1)
- **B25** 두 로그 API가 발송마다 hasSiteAction을 준다. 같은 조직 사이트 세션에 CLICK·CUSTOM이 1건 이상이면 true다. SECTION_VIEW·PAGE_VIEW만 있거나 다른 조직 세션뿐이면 false다. (P1)
- **B26** [TDD] 클릭 칸 표시 결정 함수는 다음과 같이 정한다. 어떤 경우에도 한글 라벨을 추가하지 않는다. (P1)
  - 발송 아님 → 빈칸
  - 클릭 없음 → "-"
  - 사람 클릭 → 파란 횟수 뱃지
  - 사람 클릭 + 사이트 액션 → 아이콘과 굵기로 강조
  - 봇 클릭만 → 흐린 봇 아이콘 뱃지
  - 봇 클릭만 + 사이트 액션 → 봇 뱃지에 액션 아이콘도
- **B27** 발송 이력 표와 통합 로그 표(`/logs`, 레코드 상세 compact)가 같은 클릭 칸 컴포넌트로 B26대로 그려진다. 두 .tsx에는 판정이나 계산 로직이 없다. (P1)
- **B28** `pnpm test`, `pnpm exec tsc --noEmit`, 변경 파일 eslint가 통과한다. (P1)

## 리스크/불확실성

- **운영 반영은 곧 운영 DB 쓰기다.** 배포하면 0080이 ALTER와 약 3.5만 행 UPDATE를 한다. 실패하면 서버가 뜨지 않으므로, 로컬에서 B12·B14가 통과한 뒤에만 배포한다. 배포는 사용자가 요청할 때만 한다.
- **잠금**: ALTER의 ACCESS EXCLUSIVE 잠금이 백필이 끝날 때까지 이어진다. 수 초 안에 끝날 것으로 본다. `lock_timeout 5s`와 재시도로 무한 대기를 막는다.
- **배포 순간의 틈**: 백필이 끝난 뒤 옛 인스턴스가 기록한 클릭 몇 건은 판정 없이 남을 수 있다. 필요하면 백필 SQL을 한 번 더 돌린다.
- **연속 클릭의 동시성**: 검사기는 링크를 동시에 연다. 그래서 발송 단위 advisory 잠금을 쓰고, 그 때문에 리다이렉트가 몇 ms 늦어진다.
- **숫자가 내려간다.** 대시보드의 클릭 수와 클릭률이 과거 기간까지 약 35% 내려간다. 팀에 미리 알려야 한다.
- **후속 분기가 바뀐다.** 봇 클릭만 있는 발송은 앞으로 "클릭 안 함" 분기로 간다(과거 기준 약 7.5%). 이미 처리된 후속은 그대로 둔다.
- **사람 손실 1.9%**: 잘못 걸러진 사람이 생긴다. 2단계 표기로 의심 사례를 화면에서 볼 수 있다.
- **UA 부분 일치 오탐**: `bot`, `scan`, `preview`가 들어간 사람 UA도 봇이 될 수 있다. 테스트 사례로 남긴다.
- **"사람 클릭" 기준이 둘 공존한다.** 깊이 알림 카드는 2분 규칙을 쓰고, 로그와 집계는 R6를 쓴다.
- **통합 로그 재구성**: 클릭 수 계산 위치를 옮기므로 정렬, 페이지, 총건수 회귀를 확인한다.

## 검증 방법

1. **`pnpm test`**: TDD 대상(B1~B7, B13, B26)은 구현 전에 실패하고 구현 뒤에 통과해야 한다. 기존 테스트에 회귀가 없어야 한다.
2. **`pnpm exec tsc --noEmit`과 변경 파일 eslint** (B28)
3. **마이그레이션·백필** (B12·B14)
   - 로컬 DB에 가상 조직의 fixture를 넣는다: 빈 UA, curl, `Mozilla/5.0 Chrome/`, 14.999초/15초, 3연속, 0·9·18초 사슬, 봇만 있는 발송, 섞인 발송
   - 부팅해서 마이그레이션을 적용한 뒤 기대값과 대조한다.
   - 재부팅해서 마이그레이션이 다시 돌지 않는지 확인한다.
4. **기록 경로** (B8~B11): 로컬 `/api/track/click`을 UA·시점·연속·병렬(`xargs -P5`) 조합으로 호출한다.
5. **소비 지점** (B15~B23): 같은 fixture로 각 API를 호출해 숫자를 대조한다. `hasClicked()`는 scratchpad 스크립트로 확인한다.
6. **매칭 회귀** (B24): 봇 click_id로 `POST /api/tracker/collect`를 보낸 뒤 연결이 생기는지 확인한다.
7. **사이트 액션** (B25): fixture 세션 4종(CLICK, CUSTOM, SECTION_VIEW만, 다른 조직)으로 대조한다.
8. **화면** (B26·B27): ego-browser로 세 화면을 캡처해서 확인한다.
9. **운영 확인** (사용자가 요청할 때만, 읽기 전용): `bot_reason`별 분포를 분석치와 견준다.

## 범위 밖

- 오픈 픽셀 추적 (다음 사이클)
- `https://designer-hire.com'` 깨진 링크를 curl로 12,840회 호출한 버그
- 2분 기준, 영역 노출 기준, IP 공유 기준
- 깊이 알림·고객 여정 카드의 판정을 R6로 바꾸는 일
- 사이트 액션을 근거로 봇을 사람으로 되돌리는 보정, 수동 변경 화면
- 이미 처리된 후속 큐의 수정이나 재발송
- 집계 화면에 전체 클릭 수, 안내 문구, "봇만" 필터를 추가하는 일
- MCP에 hasSiteAction을 노출하는 일, 발송 상세 시트에 클릭 목록을 보여주는 일
- 트래커 연결 단계에서 봇을 차단하는 일
- 두 로그 표의 나머지 로직을 feature 폴더로 옮기는 리팩토링
