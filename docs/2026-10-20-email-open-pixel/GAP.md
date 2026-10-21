# GAP — docs/2026-10-20-email-open-pixel/ · 2026-10-21 (1차)

Gap 분석 — unproven: 4 (Match Rate 94% · 참고). 통과 조건인 `unproven == 0`을 아직 충족하지 못한다.

**실행 근거(이번 분석에서 직접 돌린 것)**
- `tsx --test "src/**/*.test.ts"`(`pnpm test`와 같은 러너, 커버리지 포함): tests 1098 / pass 1098 / fail 0.
- `pnpm exec tsc --noEmit`: exit 0.
- 변경·신규 `src/**/*.ts(x)` 전체에 eslint: exit 0.
- `verify-evidence.mjs`: unresolved 0, no-cmd-match 0, no-receipt 0, uncited 14, dead-branch 4.
- API 라우트와 DB 경로(B6~B10, B20~B27)는 서버와 DB가 필요해 재실행하지 못했다. `evidence/`의 로컬 curl·SQL 기록을 근거로 읽었고, 소스 코드와 대조해 일치함을 확인했다.
- `behaviors.json`을 분모로 33개를 모두 대조했다.

**✅ 구현 (29)**
- **B1~B5**
  - `appendOpenPixel`, `openPixelTag`, `applyEmailTracking`은 `src/lib/email-open-pixel.ts`와 `src/lib/email-click-tracking.ts:142`에 있다. 자리 표 9건이 실행에서 통과했다.
  - 7경로의 `applyEmailTracking`과 `openTracked: true`는 `email-open-static.test.ts`가 고정한다. B4 호출 합계 7, insert 뒤 apply 순서(B5), `wrapTrackingUrls(`는 `email-click-tracking.ts` 한 곳뿐이다.
  - `email-visit-ack-delivery.ts`의 원문 INSERT는 칸 14개와 값 14개가 맞다.
- **B6, B8, B9, B10**
  - 라우트 코드는 DESIGN 7-1과 사실상 일치한다. `after(() => recordOpenSafely(…))`가 있고 `await`과 cookie가 없으며, `HEAD`를 내보내고 트랜잭션·advisory 잠금도 없다. 정적 테스트가 이를 확인한다.
  - `17-2-curl.txt`에는 모든 응답이 200 · 43B · `image/gif` · no-store · Set-Cookie 없음으로 기록돼 있다.
  - 같은 URL 200회 동시 요청에서 저장은 4행이었다. 사람 20행 뒤와 기계 10행 뒤에는 더 늘지 않았다.
- **B11~B16**: 규칙 테스트가 59_999/0/-1_000/60_000 경계, 빈 UA 5종, 기계 토큰 22개와 CUBOT에 대소문자 3형태를 확인한다. 프록시·Outlook·Apple UA, `ua`가 `early`보다 우선하는 것, 규칙 파일에 import가 없는 것, `isOpened|openedDate`가 `nhn-email.ts`에만 있는 것도 확인한다.
- **B18, B19**: 마이그레이션 정적 테스트가 통과했다. `17-1-migration.md`에는 filenode 그대로(1066899), `atthasmissing=t`, `{f}`, 기존 213221행 `open_tracked` 0이 기록돼 있다.
- **B20~B25**
  - `openBaseSql`·`openedSendSql` 문자열이 DESIGN 9-2와 정확히 같다.
  - `17-3-api.txt`: summary는 opened 3 / openBase 6 / openRate 50이고, clicked 3 / sent 7 / total 8 / clickRate 42.9는 변경 전과 같다.
  - templates는 기존 칸이 오픈 없는 비교 SQL(8/7/1/3)과 같다. S6(도입 전, 사람 클릭)은 분모와 분자에서 빠지고 clicked에는 남는다.
- **B28, B31**: `openCell.test.ts` 13개 케이스와 `openRate.test.ts`가 통과했다. 안내 4줄과 `OpenColumnHead`도 확인했다.
- **B29, B30**
  - 스크린샷 3장에서 S1~S8 칸이 `-`, 기계 아이콘, `1회`, 클릭 아이콘, `-`, 빈칸, 빈칸, `2회`로 DESIGN 17-6과 일치한다.
  - 오픈율 카드 50%와 `3/6`, 안내 4줄, 유형별 50%, 추세의 오픈 선, 날짜별 오픈 3·오픈율 50%, 홈의 규칙별 오픈율 50%도 보인다.
  - `.tsx` 변경은 `openRateText`·`openCountText` 같은 서식 호출과 컴포넌트 배치뿐이다. 판정 로직은 없다. 두 로그 표 `.tsx`에는 `openCount|machineOpenCount|openTracked`가 없다.
- **B32**: 클릭 라우트·`recordClick`·`hasClicked`·봇 규칙·`tracker-tools.ts`는 `git status`에 없다. `email-click-tracking.ts`의 diff는 +6줄(import와 `applyEmailTracking`)뿐이다. 기존 클릭 테스트는 모두 통과했다.
- **B33**: tsc·eslint·test를 내가 다시 돌려 통과를 확인했다. 단 `evidence/tsc.txt`와 `evidence/eslint.txt`는 0바이트라 증거 파일로는 비어 있다. 아래 보완 사항에 적었다.

**⚠️ 부분 (4) — unproven**
- **B7**
  - `17-2-curl.txt`의 기록 행 4개는 `Mozilla/5.0`, GoogleImageProxy, MSIE(Outlook), `Macintosh…`이다. behaviors.json의 evidence는 "Chrome·GoogleImageProxy·Outlook·Mozilla/5.0"이라 Chrome이 빠지고 Macintosh가 들어 있어 주장과 어긋난다. 표에도 `org_id`와 `opened_at` 칸이 없다.
  - 로컬 서버를 막 띄운 직후 동시 상한(4)에 걸려 첫 요청이 버려진 것으로 보인다. PROGRESS에도 같은 관찰이 적혀 있다. 동작 자체는 맞고, 증거 문구를 고치거나 다시 찍으면 된다.
- **B17**
  - 주장한 "빈 DB 서버 부팅 `[migrate] 마이그레이션 완료`, `__drizzle_migrations` max 1775200000000"이 `17-1-migration.md`에 없다. 그 파일에는 "서버 부팅 경로 확인은 다음 단계에서 한다"고만 적혀 있다.
  - "재부팅해도 다시 돌지 않는다"(`created_at` 1건)를 보여 주는 산출물도 없다. PROGRESS의 서술에만 있다.
  - 칸·FK·색인 확인(`BEGIN … ROLLBACK`)과 정적 테스트는 실제 근거다.
- **B26**: `openCount`/`machineOpenCount`/`openTracked` 값은 DESIGN 17-5 기대와 일치한다. 그러나 주장 중 "다른 조직(e1) 행 없음"과 "정렬·페이지·총건수 그대로"는 산출물에 없다. 변경 전 응답 저장본과의 비교도 없다. 코드 diff는 필드를 더하기만 하므로 실제로 깨졌을 가능성은 낮다.
- **B27**: evidence가 `git diff`를 읽은 것이다. 실행 흔적이 아니다. `list_email_logs` 핸들러를 실제로 호출한 기록이 없다. 코드는 검증된 `openSignalsForSendLogs`를 쓰고 `EMPTY_OPEN_SIGNAL`로 `openTracked`까지 붙이며, tsc는 통과한다.

**❌ 누락**
- **behaviors.json 안에는 없다.**
- **behaviors.json 밖, DESIGN 9-9·17-4 성능 관문**
  - 30만 발송 fixture로 4개 라우트 `EXPLAIN (ANALYZE, BUFFERS)`를 변경 전후 비교하는 증거가 없다. 기준은 "변경 전보다 300ms 넘게 늘면 멈추고 보고"다.
  - 확인한 곳: `evidence/*`와 `PROGRESS.md`에서 `explain|17-4|pg_stat_activity`를 검색했다. 해당 항목이 없다.
  - C6의 통과 조건인데 PROGRESS는 "33/33"으로만 닫았다. 운영 `main` 배포 전에 필요하다.
- **같은 범주의 소규모 누락**
  - R18의 "부하 중 `pg_stat_activity` active ≤ 기준선+4" 기록이 없다.
  - R20 후반의 "1시간 전 발송에 Chrome → 사람 1행" 기록이 없다.
  - 17-6의 다크 모드·레코드 상세 compact·대상 0기간 "—" 화면 확인이 없다. 대상 0의 "—"는 단위 테스트만 있다.

**verify-evidence 보고 (차단 아님)**
- **uncited 14건**: B1, B2, B3, B4, B5, B9, B11, B12, B13, B14, B15, B16, B19, B28
  - `output`이 "1098 pass — …" 형태의 서술이라 러너가 낸 줄이 아니다. 해당 테스트는 내 실행에서 실제로 통과했으므로 내용은 확인됐다. 인용을 `ℹ pass 1098`이나 `✔ B…` 같은 실제 줄로 고치면 된다.
- **dead-branch 4건(lcov, 모두 소스맵 노이즈로 판단)**
  - `email-open-pixel.ts:13`, `:50`, `email-open-rules.ts:8`, `email-open-sql.ts:10`, `openCell.ts:11`은 테스트가 실제로 지나가는 줄이라 노이즈로 봤다.
  - `email-open-pixel.ts:45`의 `?? 0`은 `PROLOG_RE`가 모두 선택 항목이라 항상 매칭되므로 구조상 도달하지 않는다. 무해하다.
  - `email-open-tracking.ts`, `route.ts`, `email-open-signals.ts`는 DB를 쓰므로 단위 테스트에서 import하지 않는 설계(DESIGN 15절)라 커버리지에 없다. 이 부분은 curl과 SQL 증거로 보는 수밖에 없다.

**파일 계획(13절)과 "바꾸지 않음" 목록**
- 파일 계획은 지켜졌다. 계획된 신규·수정 파일이 모두 있고, 계획 밖 `src` 파일은 없다.
- 바꾸지 않기로 한 파일은 변경이 없다. `src/app/api/track/click/route.ts`, `email-click-bot-rules.ts`, `RecordDetailDialog.tsx`, `AnalyticsSection.tsx`, `tracker-tools.ts`, `rate-limit.ts`, `send-log-indexes.ts`, `page.tsx` 전부를 `git status`로 확인했다. `recordClick`·`hasClicked`·`wrapTrackingUrls`도 그대로다.
- 신규 파일 중 200줄을 넘는 것은 없다. 최대는 `email-open-rules.test.ts`의 91줄이다.
- 기존 대형 파일은 줄만 늘었다. `EmailDashboard` 279→290, `UnifiedLogTable` 265→268, `EmailSendLogTable` 605→609. 리팩터하지 않는다는 DESIGN과 일치한다.
- `.tsx`에 로직은 없다.

**➕ 설계 밖 (감점 아님, 정리 후보)**
- `src/app/api/email/send/route.ts`의 `openTracked: true,` 들여쓰기가 어긋났다.
- `src/lib/db/schema.ts`에서 `EmailOpenLog` 뒤에 빈 줄이 두 번 들어갔다.
- `src/lib/request-ip.test.ts`의 테스트 이름이 `B7:`로 붙어 있는데, 실제로는 IP 헬퍼 계약이다. B7은 라우트 기록 행동이다.
- 작업 트리의 `docs/guides/`는 이 사이클 산출물이 아니다. 커밋 범위에서 따로 다뤄야 한다.

**관찰(위반 아님)**
- 동시 4 상한(D2)이 서버가 막 뜬 직후 순차 요청 2건도 버렸다(PROGRESS). 운영에서 발송 직후 프리페치나 사람 오픈이 몰리면 undercount가 날 수 있다. DESIGN O4가 반영 후 분포를 보고 조정하기로 한 항목이다.

**다음**
1. unproven 4건 보완
   - B17: 빈 DB 부팅 로그와 재부팅 뒤 `__drizzle_migrations` 1건을 `17-1-migration.md`에 추가한다.
   - B7: 증거 문구를 실제 행에 맞추거나 다시 찍는다.
   - B26: 변경 전후 1·2페이지 비교와 다른 조직 비노출 기록을 남긴다.
   - B27: `list_email_logs` 핸들러 호출 결과를 남긴다.
2. 9-9·17-4 성능 관문을 측정해 기록한다.
3. `evidence/tsc.txt`와 `evidence/eslint.txt`는 비어 있어 증거로 쓸 수 없으니 exit code를 포함해 다시 만든다. uncited 14건의 인용도 러너 출력 줄로 고친다.
4. 1~3 후 재분석한다. unproven이 0이어야 통과다. 17-7 운영 Gmail 확인은 배포 후 단계라 이번 판정에서 제외했다.

- 파일 경로: `/Users/jaehun/Projects/salesflow/docs/2026-10-20-email-open-pixel/` (DESIGN.md, PLAN.md, behaviors.json, evidence/)
- 이번 분석에서 만든 파일은 `/Users/jaehun/Projects/salesflow/.devkit/lcov.info`뿐이다. GAP.md는 쓰지 않았다.

---

# GAP — 2차 · 2026-10-21

Gap 분석 2차 — unproven: 0 (Match Rate 100% · 참고). 통과 조건 `unproven == 0`을 충족한다. 다만 아래 "보완 권장" 4건은 남아 있고, 그중 둘(cmd 표기, 성능 관문 증거)은 배포 전에 정리하는 편이 낫다.

**이번 분석에서 직접 돌린 것**
- 오픈 테스트 8개 파일을 `pnpm exec tsx --test --experimental-test-coverage …` 로 파이프 없이 실행했다: tests 43 / pass 43 / fail 0. 커버리지(lcov)도 같이 수집했다.
- `pnpm test`: tests 1103 / pass 1103 / fail 0.
- `tsc --noEmit`: exit 0.
- 변경·신규 `src` 46파일 eslint: exit 0.
- `verify-evidence.mjs`: unresolved 0, uncited 0 (1차 14건 해소), no-receipt 0, no-cmd-match 14, dead-branch 4.
- API 라우트·DB 경로(B6~B10, B20~B27)는 서버와 시험 DB가 정리돼 재실행하지 못했다. `evidence/`의 기록(17-1, 17-2, 17-3, 17-5)을 근거로 읽고 소스와 대조했다.

**DESIGN 변경과 코드 대조**
- **4-1 (0089 SQL):** `drizzle/0089_email_open_tracking.sql`이 DESIGN 전문과 같다. 색인 2개가 더해졌다: `email_open_logs_org_opened_idx`, `email_click_logs_org_clicked_idx`. 정적 테스트가 두 색인 문구를 확인한다. 부팅과 재부팅 기록은 `17-1-migration.md`에 있다.
- **9-2 (F1B):** `src/lib/email-open-sql.ts`의 `openedSendSql(ref, {orgId, since})`가 DESIGN과 일치한다. 조직·기간 `IN (SELECT …)`이고 params는 `[orgId, since, orgId, since]`이다.
  - 호출부 5곳이 모두 새 시그니처를 쓴다. summary·trends·templates(2곳)는 `since: start`, email-daily는 `since: fromIso`다. `fromIso`는 바깥 쿼리의 `s.sent_at >= fromIso`와 같은 값이다.
  - 테스트 3건(B20 ×3)이 params와 SQL 모양을 고정한다.
- **리뷰 🟡2 반영:**
  - `recordOpenSafely`가 버린 건수를 세고 60초마다 `console.warn`을 남긴다. 판단 함수 `shouldLogDroppedOpens`는 테스트 2건으로 고정돼 있다.
  - route의 `catch`가 `console.error`를 남긴다.
  - `Promise.all`로 묶은 3곳(email/logs, unified, MCP)은 필드를 더하기만 한 diff다.

**✅ 구현 (33/33)**
- **B1~B5, B9, B11~B16, B19, B28 (테스트 근거 14건)**
  - 위 8개 파일 실행에서 `✔ B1: 본문 앞 또는 머리말 뒤에 하나만 삽입…`, `✔ B4: 7개 발송 경로는 공통 추적만 호출`, `✔ B5: insert 뒤에만 픽셀을 입힌다`, `✔ B28: 오픈 칸 계약 1~13` 등이 통과했다.
  - dead-branch 4건은 소스맵 줄 밀림이다. 예로 `email-open-sql.ts:13`의 Date 분기는 테스트 `Date는 ISO 문자열로 변환…`이 실행한다. `email-open-pixel.ts:45`의 `?? 0`은 구조상 도달하지 않아 무해하다.
- **B6, B8, B10:** `17-2-curl.txt`에 모든 경우의 응답이 200 · 43B · `image/gif` · no-store · Set-Cookie 없음으로 기록돼 있다(HEAD 포함, 표 없음 42P01도 200). 200회 동시 요청 뒤 저장은 4행, 사람 20행과 기계 10행에서 멈췄다.
- **B7 (1차 unproven 해소):** 2차 기록(다른 조직 e1의 1시간 전 발송 id 9, 1초 간격)에서 6행이 저장됐다.
  - `org_id`는 e1이고 `opened_at − sent_at`은 01:00:00.99~01:00:06.99다.
  - 사람 4행은 `is_machine=f`, `curl/8.7.1`과 빈 UA 2행은 `t/ua`다.
- **B17 (해소):** `17-1-migration.md`에 빈 DB 부팅 `[migrate] 새 DB 감지 → 마이그레이션 완료`, `__drizzle_migrations 1775200000000` 1행, 색인 3개가 있다. 재부팅에서도 `[migrate] 완료`에 1행이 그대로다. `lock_timeout 5s`는 정적 테스트가 확인한다.
- **B18:** filenode 그대로(1066899), `atthasmissing=t`, 기존 213,221행의 `open_tracked`는 0이다. 7경로의 `openTracked: true`는 정적 테스트가 확인한다.
- **B20~B25:** `17-3-api.txt`에서 opened 3 / openBase 6 / openRate 50, 기존 칸(total 8, sent 7, failed 1, clicked 3, clickRate 42.9)은 그대로다. 코드가 F1B로 바뀐 뒤의 값은 PROGRESS에 "집계 4종 F1B로 같은 값"으로만 적혀 있고 별도 산출물은 없다.
- **B26 (해소):** 조직 e2 토큰으로 호출했다. 같은 DB에 조직 e1의 발송 id 9와 오픈 6행이 있다. 다른 조직 id 9는 응답에 없다.
  - `email/logs`는 [8,7,6][5,4,3][2,1]에 totalCount 8이다.
  - `unified`는 [2,3,1][4,5,6][7,8]에 total 8, totalPages 3이다.
  - 코드 diff는 필드를 더하기만 하고, 알림톡 줄은 `{...log, clickCount: 0}` 그대로다. fixture에 알림톡 행이 없어 알림톡 줄은 diff로만 확인했고, 변경 전 응답과의 직접 비교는 없다.
- **B27 (해소):** `mcp-call.ts`가 `createMcpToolHandlers().list_email_logs`를 직접 호출했다. 8행에 `openCount`·`machineOpenCount`·`openTracked`가 붙었고, 도구 설명에 "오픈은 추정치입니다"가 있다. `tracker-tools.ts`는 `git status`에 없다.
- **B29~B31 (visual):** 1차 스크린샷 5장이 근거다. 이후 `.tsx`는 import 병합과 들여쓰기만 바뀌었다는 설명이고, `git diff`로 본 `DailyEmailTable`·`EmailDashboard` 변경은 오픈 칸 추가뿐이다. 재캡처 생략은 수용한다.
- **B32:** 클릭 라우트·`email-click-bot-rules.ts`·`tracker-tools.ts`·`rate-limit.ts`는 `git diff --quiet` 무변경이다. `email-click-tracking.ts`는 import와 `applyEmailTracking`만 더했다.
- **B33:** test 1103/1103, tsc exit 0, eslint exit 0을 내가 다시 확인했다. `tsc.txt`와 `eslint.txt`는 이제 내용과 exit code가 있다.

**⚠️ 보완 권장 (unproven에는 안 넣음, 배포 전 정리)**
1. **cmd 표기 (verify-evidence `no-cmd-match` 14건: B1~B5, B9, B11~B16, B19, B28)**
   - behaviors.json의 `cmd`가 자리표시자 `pnpm exec tsx --test <오픈 테스트 8개 파일> (…)`다. 이 문자열로 실행된 기록이 있을 수 없다.
   - 같은 테스트를 실제 명령으로 돌려 통과를 확인했고 인용 줄도 일치(uncited 0)하므로, 실질 증거는 확인된 것으로 쳤다.
   - 파일 8개를 풀어 쓴 실제 명령으로 `cmd`를 바꿔야 receipt 자동 대조가 통과한다.
2. **9-9 성능 관문 증거 (behaviors.json 밖)**
   - `9-9-perf.txt`에 F1B 결과가 요약 숫자로만 있다: summary 50ms, trends 147ms, templates 70ms, email-daily 1853ms. 변경 전은 각각 84ms, 211ms, 239ms, 3923ms다.
   - `9-9-perf-queries.sql`과 `9-9-perf-raw.txt`는 EXISTS 안(OVER 판정)의 것이다. F1B 질의문과 원본 EXPLAIN은 evidence에 없다.
   - F1B 숫자는 재현 불가이므로, 색인을 갖춘 상태의 EXPLAIN 원문을 `evidence/`에 남기기를 권한다. fixture가 삭제돼 이번엔 다시 측정하지 못했다.
   - DESIGN R18의 "부하 중 `pg_stat_activity` active ≤ 기준선+4" 기록은 여전히 없다.
3. **stale 문구:** B32의 `output`이 "1098 pass"인데 현재는 1103이다(B33은 1103).
4. **운영 위험 (배포 판단용):** 0089가 기존 `email_click_logs`에 일반 `CREATE INDEX`를 만든다. 운영 3.6만 행이라 수 ms이고 `lock_timeout 5s`가 있다. 그래도 빌드 중 클릭 INSERT는 잠깐 막힌다. 리뷰 권고대로 트래픽이 적은 시간에 배포한다.

**미검증으로 남은 것 (판정 제외, 사유 있음)**
- 17-7 운영 Gmail 확인은 배포 후 단계다.
- 17-6의 다크 모드, 레코드 상세 compact, 대상 0기간 "—" 화면은 확인하지 않았다. "—"는 `openRate` 단위 테스트(`✔ B21·B30: 대상 0은 null·대시…`)로 고정돼 있다.

**➕ 설계 밖 (감점 아님)**
- 색인 2개와 F1B 변경은 성능 관문에서 나왔고, DESIGN 4-1·9-2에 반영돼 코드와 일치한다.
- 동시 상한 경고(`shouldLogDroppedOpens`)와 route catch 로그는 리뷰 🟡 반영이다. DESIGN 본문에는 `shouldLogDroppedOpens`가 없으니 다음에 DESIGN 7절에 적는다.
- `docs/guides/`는 이 사이클 산출물이 아니다. 커밋 범위에서 따로 다룬다.
- `request-ip.test.ts`의 `B7:` 접두 이름은 1차 지적 그대로다.

**리뷰의 "확인 필요" (범위 밖, 결정 대기)**
- `/api/track/click`이 서명이 없어 사람 클릭을 위조할 수 있다. 사람 클릭도 오픈으로 세므로 오픈율도 위조된다.
- `test_followup` 테스트 발송이 오픈율 분모에 들어간다.

**다음**
1. 보완 권장 1~3을 정리한다. 1은 기재 수정만으로 끝나고, 2는 F1B EXPLAIN 원문을 남기는 것이다.
2. 배포 후 17-7(운영 Gmail)에서 사람 오픈 1행과 Apple/프록시 분류를 확인한다.

파일: `/Users/jaehun/Projects/salesflow/docs/2026-10-20-email-open-pixel/` (behaviors.json, DESIGN.md, evidence/). 이번 분석에서 만든 파일은 `/Users/jaehun/Projects/salesflow/.devkit/lcov.info` 갱신뿐이고, GAP.md는 쓰지 않았다.

> 2차 뒤 정리: 테스트 항목 cmd를 실제 명령(open-tests.txt 첫 줄)으로 교체, B32 문구 1103으로 갱신. F1B EXPLAIN 원문은 fixture 삭제로 남기지 못함(요약 수치만 9-9-perf.txt).
