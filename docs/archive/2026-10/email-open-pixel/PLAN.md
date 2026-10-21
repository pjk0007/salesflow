# PLAN — 이메일 오픈 픽셀 (우리 서버가 직접 기록하는 오픈 추적)

- **track**: Full
- **사이클 ID**: `2026-10-20-email-open-pixel`

경로는 저장소 루트 기준이고, 줄 번호는 2026-10-20 main 기준이다.

## 목표

메일 HTML에 보이지 않는 1x1 픽셀을 넣는다. 수신자의 메일 앱이 이 이미지를 불러오면 우리 서버(`/api/track/open`)가 오픈을 직접 기록한다(IP·UA·시각).

- **기계 오픈**: 발송 60초 안의 요청과 알려진 프리페치·보안 검사기 UA는 기계 오픈으로 표시한다. Gmail 이미지 프록시는 사람이 열 때도 거치므로 UA만으로 기계로 보지 않는다.
- **오픈율**: (사람 오픈 픽셀 ∪ 사람 클릭) / 발송.
- **보여 줄 곳**: 클릭 옆에 오픈을 보여 준다.
  - 대시보드: 요약, 추세, 규칙별, 날짜별, 홈 발송 분석
  - 발송 이력 두 표: /email, /logs와 레코드 상세
  - MCP `list_email_logs`
- **기계 오픈 표시**: 클릭 봇 아이콘처럼 표시한다.
- **안내 문구**: 추정치라는 점과 Apple MPP의 한계를 적는다.
- **픽셀을 넣는 자리**: 클릭 링크 래핑과 같은 자리다. 서명·수신거부 꼬리를 붙이고 발송 로그를 insert한 뒤이며, 모든 발송 경로에 넣는다.
- **기록 방식**: 클릭 경로에서 문제가 됐던 잠금 대기를 피하려고, 잠금 없이 기록한다.
- **쓰지 않는 것**: NHN `isOpened`는 쓰지 않는다. 후속 분기는 지금처럼 클릭 기준이다.

## 배경

- 2026-03에 NHN `isOpened`를 폴링해 읽음을 표시했다. 부정확해서 후속 분기를 클릭 기준으로 바꿨고(0057), 이어서 0058(2026-06-02, f977264)에서 칸을 지웠다. 사용자 지시에 따라 NHN 값은 근거로 쓰지 않는다.
- 2026-10-16에 NHN 값으로 가늠한 참고치는 아래와 같다.
  - 오픈 1,052건 중 529건이 도착 15초 안이었다.
  - Gmail은 오픈의 100%가 60초 안이었고, 사람 클릭은 0건이었다.
  - 기계 오픈을 빼면 12.1%가 5.8%가 되고, 오픈∪사람 클릭은 6.2%다.

## 조사 결과

1. **클릭 래핑 지점**
   - 래핑 함수는 `wrapTrackingUrls(html, sendLogId)`(`src/lib/email-click-tracking.ts:29-49`)다.
   - 모든 경로가 같은 순서로 처리한다. 서명 → 수신거부 꼬리 → 로그 insert → 래핑 → NHN 발송.
   - DB `body`는 래핑 전 본문이다. 그래서 픽셀도 래핑 자리에서 넣으면 저장 본문에는 픽셀이 없다. 발송 이력에서 본문을 미리 봐도 오픈이 기록되지 않는다.

   | 경로 | trigger_type | 래핑 위치 |
   |---|---|---|
   | 템플릿 자동·반복 | auto·repeat | `src/lib/email-automation.ts:212` |
   | 수동 | manual | `src/app/api/email/send/route.ts:222` |
   | AI 자동 | ai_auto | `src/lib/auto-personalized-email.ts:519` |
   | 템플릿 후속 | followup | `src/lib/email-followup.ts:697` |
   | AI 후속 | ai_followup | `src/lib/email-followup.ts:930` |
   | 방문 감사 | visit_ack | `src/lib/email-visit-ack-delivery.ts:476` |
   | 후속 테스트 | test_followup | `src/app/api/email/auto-personalized/test-followup/route.ts:221` |

   로그 없이 보내는 4곳은 대상이 아니다: `test-send`, AI `test-send`, 초대, 발신 프로필 확인.
2. **토큰**
   - 클릭 URL의 id는 발송 로그 serial 값 그대로이고 서명하지 않는다. 그래서 누구나 아무 발송의 클릭을 만들 수 있다.
   - 클릭 경로는 url을 검증 없이 302로 보내는 열린 리다이렉트이기도 하다. 별건이다.
   - 오픈 URL은 `?id=<id>&s=<HMAC 일부>`로 제안한다. 따로 저장할 것이 없다.
3. **잠금과 레이트**
   - `recordClick`은 트랜잭션 안에서 advisory 잠금을 잡는다. 같은 id로 요청이 몰리면 풀이 바닥날 수 있다(클릭 사이클 리뷰에서 감시 항목).
   - 연결 풀은 기본 20이다.
   - 인메모리 `rateLimit()`(`src/lib/tracker/rate-limit.ts`)이 있다.
   - next 16의 `after()`를 쓸 수 있다.
   - 오픈 기록은 잠금 없이 한 문장으로 하고, 응답은 `after()`로 기록과 떼어 놓는다.
4. **픽셀 응답**: 43바이트 투명 GIF와 캐시 금지 헤더로 응답한다. 위조·제한·실패여도 200 GIF를 준다. HEAD는 따로 내보내고 기록하지 않는다(Next는 HEAD를 GET으로 처리하기 때문이다).
5. **중복**: 집계는 발송 단위 EXISTS라 반복 요청이 와도 오픈율은 변하지 않는다. 기록 방식은 둘 중 DESIGN에서 고른다.
   - 요청마다 남기되 발송당 N행까지
   - 첫 오픈만 남기기
6. **저장**: 새 표 `email_open_logs`를 제안한다.
   - 클릭과 모양이 같다.
   - 요청별 증거가 남아 나중에 다시 판정할 수 있다.
   - 큰 표인 `email_send_logs`를 공개 경로에서 UPDATE하지 않는다.
   - 다른 안: `email_send_logs`에 칸 추가, 표 + 칸.
7. **집계**: summary·trends·templates·email-daily 4곳이 사람 클릭 기준이다.
   - templates는 LEFT JOIN이라 오픈을 더하면 행이 곱해진다. EXISTS로 바꾼다.
   - 대시보드가 60초마다 다시 불러온다. 바꾸기 전후로 EXPLAIN으로 측정한다.
8. **화면**
   - EmailDashboard: 카드 5개, 6칸 그리드
   - DailyEmailTable, TemplateRanking, TrendChart
   - EmailSendLogTable, UnifiedLogTable: 레코드 상세가 compact로 같이 쓴다
   - 클릭 칸 선례: `src/components/email/clicks/`(`clickCellView` + `ClickCountCell`)
9. **MCP**: 트래커 툴에는 클릭 지표가 없다. `list_email_logs`의 줄별 `clickCount`·`botClickCount`만 있다.
10. **기계 판정의 함정**
    - R6 UA 정규식에 `msie`가 있다. Outlook 데스크톱은 `MSIE 7.0 … Microsoft Outlook` UA로 이미지를 받기도 하므로, 오픈용 패턴은 따로 둔다.
    - 60초의 기준은 `sent_at`이다. 수동과 후속 테스트는 DB 기본값 `now()`다.
11. **마이그레이션**: 다음은 0089(when 1775200000000)다. 0081처럼 `SET LOCAL lock_timeout = '5s'`를 쓴다.

## 단계별 작업

0. **DESIGN**: Q1~Q3 답을 반영해 DESIGN을 쓰고 승인받는다. 구현은 Codex에 위임한다.
1. **판정 규칙 TDD**: `src/lib/email-open-rules.ts`(+test). 60초 상수, 오픈용 기계 UA 패턴, 프록시 예외, `machineOpenReason()`. → B11~B16
2. **픽셀 TDD**: `src/lib/email-open-pixel.ts`(+test). 오픈 URL, 서명과 검증, `appendOpenPixel()`. → B1·B3
3. **스키마**: `drizzle/0089_email_open_tracking.sql`, journal, `schema.ts`, 정적 테스트. 로컬에서 부팅해 확인한다. → B17~B19
4. **공개 경로**: `src/lib/email-open-tracking.ts`의 `recordOpen()`, `src/app/api/track/open/route.ts`. → B6~B10
5. **발송 경로**: `email-click-tracking.ts`에 `applyEmailTracking()`을 만들고, 7곳의 호출을 바꾸고, 정적 테스트를 붙인다. → B2·B4·B5
6. **집계**: summary·trends·templates·email-daily를 고치고 성능을 측정한다. → B20~B25
7. **행 신호**: `src/lib/email-open-signals.ts`를 email/logs·unified·`UnifiedLog` 타입·MCP에 붙인다. → B26·B27
8. **화면**: `src/components/email/opens/{types,utils,ui}`의 `openCellView` TDD, `OpenCountCell`, 두 표, 대시보드·홈, 안내. → B28~B31
9. **검증**: 아래 검증 방법대로 한다. → B32·B33
10. **커밋과 운영 반영**: 커밋은 사용자 확인 뒤에 한다. 운영 반영(0089 DDL)은 사용자가 요청할 때만 한다. 반영 뒤 본인 주소로 실제 메일 앱에서 확인한다(Q3).

## 건드릴 파일

**새 파일**
- `drizzle/0089_email_open_tracking.sql`
- `src/lib/email-open-rules.ts`(+test)
- `src/lib/email-open-pixel.ts`(+test)
- `src/lib/email-open-tracking.ts`
- `src/lib/email-open-signals.ts`
- `src/lib/email-open-static.test.ts`
- `src/app/api/track/open/route.ts`
- `src/components/email/opens/types/index.ts`
- `src/components/email/opens/utils/openCell.ts`(+test)
- `src/components/email/opens/utils/openRate.ts`
- `src/components/email/opens/ui/OpenCountCell.tsx`
- `src/components/email/opens/ui/OpenRateNotice.tsx`

**고칠 파일**
- 마이그레이션·스키마: `drizzle/meta/_journal.json`, `src/lib/db/schema.ts`
- 추적: `src/lib/email-click-tracking.ts`(`applyEmailTracking` 추가)
- 발송 경로 7곳(위 표)
- 집계 API: `src/app/api/analytics/{summary,trends,templates,email-daily}/route.ts`
- 행 API: `src/app/api/email/logs/route.ts`, `src/app/api/logs/unified/route.ts`
- 타입·MCP: `src/types/index.ts`, `src/lib/mcp/tools.ts`
- 훅: `src/hooks/{useEmailAnalytics,useAnalytics,useEmailDaily}.ts`
- 화면: `src/components/email/{EmailDashboard,DailyEmailTable,EmailSendLogTable}.tsx`, `src/components/dashboard/{TemplateRanking,TrendChart}.tsx`, `src/components/logs/UnifiedLogTable.tsx`

**바꾸지 않음**: 클릭 라우트, 후속 분기(`hasClicked`), `RecordDetailDialog`(UnifiedLogTable로 따라옴), MCP 트래커 툴, page.tsx 전부. 새 의존성은 없다.

## behavior 목록

- B1 — `appendOpenPixel(html, id)`는 오픈 URL을 src로 하는 1x1 `<img>`를 정확히 1개, DESIGN이 정한 자리에 넣고 나머지 HTML은 그대로 둔다 (P1)
- B2 — `applyEmailTracking(html, id)`의 링크 결과는 `wrapTrackingUrls`와 같고 픽셀이 1개 더 있으며, 픽셀 `<img>`는 클릭 래핑 대상이 아니다 (P1)
- B3 — 오픈 URL은 `${BASE_URL}/api/track/open?id=<id>&s=<서명>`이고, 서명은 같은 id에서만 통과하며 다른 id·바뀐 서명·빈 서명·숫자가 아닌 id는 실패한다(상수 시간 비교) (P1)
- B4 — 발송 로그를 남기는 7개 경로가 모두 `applyEmailTracking`을 거친 본문을 NHN에 보내고, 추적 모듈 밖에서 `wrapTrackingUrls(`를 직접 부르는 곳이 없다 (P1)
- B5 — `email_send_logs.body`에는 픽셀이 들어가지 않아, 발송 이력에서 본문을 미리 봐도 오픈이 남지 않는다 (P1)
- B6 — `GET /api/track/open`은 정상·id 없음·서명 불일치·없는 발송·DB 오류·레이트 초과 모두 200 + 43바이트 투명 GIF + 캐시 금지 헤더로 응답하고 쿠키를 쓰지 않는다 (P1)
- B7 — 서명이 맞고 발송이 있으면 `email_open_logs`에 1행(org_id, send_log_id, opened_at, ip, user_agent, is_machine, machine_reason)이 생기고, 아니면 생기지 않는다 (P1)
- B8 — `HEAD /api/track/open`은 B6과 같은 헤더로 응답하고 기록하지 않는다 (P2)
- B9 — 오픈 기록은 트랜잭션·advisory 잠금을 쓰지 않고, 픽셀 응답은 기록이 끝나길 기다리지 않는다(`after()`) (P1)
- B10 — 같은 발송의 반복 요청은 발송당 저장 상한까지만 기록하고, 인메모리 레이트를 넘은 요청도 기록하지 않는다(응답은 B6과 같다) (P1)
- B11 — 오픈 시각과 발송 시각의 차이가 60초 미만이면(0초·음수 포함) 기계(`early`)이고, 60초 이상이면 이 규칙으로는 기계가 아니다 (P1)
- B12 — UA가 null·빈 문자열·공백뿐이면 기계(`ua`)다 (P1)
- B13 — UA가 오픈용 기계 토큰(DESIGN 표)을 대소문자 구분 없이 포함하면 기계(`ua`)다 (P1)
- B14 — Gmail 이미지 프록시·Yahoo 프록시·Outlook 데스크톱(`MSIE 7.0 … Microsoft Outlook`)·Apple 메일·일반 브라우저 UA는 UA 규칙으로 기계가 아니고 60초 규칙만 적용된다 (P1)
- B15 — 두 규칙이 모두 맞으면 사유는 `ua` 하나다 (P2)
- B16 — 오픈 판정 규칙 파일에는 import가 없고, NHN `isOpened`·`openedDate`를 읽는 코드가 새로 생기지 않는다 (P2)
- B17 — 0089를 적용하면 `email_open_logs`(send_log_id FK ON DELETE CASCADE, is_machine, machine_reason)와 사람 오픈 조회 색인이 생기고, `lock_timeout` 5초로 시작하며, 재부팅해도 다시 돌지 않는다 (P1)
- B18 — (Q1=A) 0089 뒤 기존 발송 행은 `open_tracked=false`, 새 발송 행은 `true`이고 표를 다시 쓰지 않는다 (P1)
- B19 — 정적 테스트가 0089 SQL과 journal을 읽어 B17·B18 문구를 확인한다 (P1)
- B20 — "오픈한 발송"은 오픈율 대상 발송 중 사람 오픈이나 사람 클릭이 1건 이상인 발송이다(기계 오픈만 있으면 오픈이 아니고, 픽셀 없이 사람 클릭만 있으면 오픈이다) (P1)
- B21 — summary가 `email.opened`·`openRate`와 유형별 `opened`·`openRate`를 주고, 대상이 0이면 openRate는 null이며, 기존 칸은 그대로다 (P1)
- B22 — trends가 날짜별 `emailOpened`를 주고 기존 칸은 그대로다 (P1)
- B23 — templates가 연결별·AI 파티션별 `opened`·`openRate`를 주고, total·sent·failed·clicked는 오픈 때문에 바뀌지 않는다(행 곱 없음) (P1)
- B24 — email-daily가 날짜 합계와 breakdown에 오픈 수와 오픈율 분모를 주고, 기존 sent·clicked는 그대로다 (P1)
- B25 — 픽셀이 없던 발송(도입 전)은 오픈율의 분자·분모에 들어가지 않고, 클릭률 정의는 바뀌지 않는다 (P1)
- B26 — 발송 이력 API와 통합 로그 API의 이메일 줄에 `openCount`·`machineOpenCount`·`openTracked`가 붙고, 알림톡 줄·정렬·페이지·총건수는 그대로다 (P1)
- B27 — MCP `list_email_logs` 줄에 `openCount`·`machineOpenCount`가 붙고 도구 설명에 추정치라고 적힌다(트래커 툴은 그대로) (P2)
- B28 — `openCellView`가 정하는 표시: 알림톡·미발송·픽셀 없는 발송은 빈칸, 오픈·클릭 없음은 "-", 사람 오픈은 `N회`, 기계 오픈만 있으면 흐린 기계 아이콘, 사람 오픈 없이 사람 클릭만 있으면 클릭으로 오픈 표시, 툴팁에 사람·기계 수 (P1)
- B29 — /email 발송 이력과 /logs·레코드 상세 표가 클릭 칸 옆에 같은 `OpenCountCell`로 "오픈" 칸을 두고, 두 .tsx에 판정 로직이 없다 (P1)
- B30 — 대시보드(오픈율 카드, 유형별 오픈율, 추세 오픈 선, 날짜별 오픈·오픈율)와 홈 발송 분석(규칙별 오픈율, 이메일 오픈 계열)에 오픈 지표가 보이고, 대상이 0이면 "—"다 (P1)
- B31 — 오픈율 카드 근처와 오픈 칸 머리에 4줄 이내 안내(추정치, 60초·검사기 제외, 클릭은 오픈으로 셈, 이미지 차단 시 빠짐, Apple MPP 한계)가 보인다 (P1)
- B32 — 후속 분기(`hasClicked`), 클릭 기록, 봇 판정, 클릭률은 바뀌지 않고 기존 테스트가 통과한다 (P1)
- B33 — `pnpm test`, `tsc --noEmit`, 변경 파일 eslint가 통과한다 (P1)

## 리스크

- **정확도**
  - 이미지를 막으면 오픈이 빠진다(클릭으로만 잡힌다).
  - Apple MPP가 60초 밖에서 미리 받으면 사람으로 센다.
  - Gmail 프록시가 캐시하면, 사람이 다시 열어도 요청이 오지 않을 수 있다.
  - NHN 발송이 60초 넘게 밀리면 미리 받기 요청이 사람으로 샌다.
- **숫자 인식**: 예전 NHN 12%에 익숙하면 새 값은 6% 안팎이다. 팀에 미리 알린다.
- **UA 오탐**: R6 토큰을 그대로 쓰면 Outlook의 사람 오픈이 기계가 된다. 오픈용 목록을 따로 둔다.
- **전달률**
  - 평문형 AI 메일에도 이미지가 하나 붙는다.
  - Gmail은 102KB를 넘으면 본문을 잘라서 끝에 있는 픽셀이 누락된다. 위치는 DESIGN에서 정한다.
- **남용**: 서명이 있어도 같은 URL은 반복할 수 있다. 상한과 레이트로 막지만, 레이트는 인스턴스 메모리 기준이다.
- **마이그레이션**: 배포 때 0089가 운영 DB에 표를 만들고 email_send_logs를 잠깐 잠근다(FK, Q1=A면 ALTER). 실패하면 서버가 뜨지 않는다.
- **집계 비용**: 발송 행마다 EXISTS가 하나 늘어나므로 전후로 측정한다.
- **서명 키**: 키를 바꾸면 그 전에 보낸 메일의 오픈은 더 기록되지 않는다.
- **개인정보**: IP·UA를 클릭과 같은 수준으로 저장하고, 보관 기간 정책은 없다(범위 밖).

## 검증 방법

1. `pnpm test`: TDD 대상은 구현 전에 RED를 확인한다. 정적 검사와 기존 테스트에 회귀가 없어야 한다.
2. `tsc --noEmit`과 변경 파일 eslint.
3. 0089: 로컬에서 부팅해 `\d email_open_logs`, 기존·신규 행의 `open_tracked`, 재부팅 시 재적용 여부를 본다.
4. 공개 경로: 로컬에서 curl로 확인한다.
   - 헤더와 43바이트 응답
   - UA 6종 × 시점 2종의 판정 대조
   - 위조·없는 발송·HEAD는 행 없음
   - 같은 URL 200회 병렬로 상한과 연결 수
5. 집계: 로컬 가상 조직에 fixture 조합을 넣어 4개 API를 SQL 기대값과 대조하고, templates의 기존 칸이 그대로인지 본다.
6. 성능: 로컬에 발송 30만 건 fixture를 만들고 EXPLAIN (ANALYZE, BUFFERS)로 전후를 비교한다.
7. 행 API·MCP: 페이지와 총건수가 그대로인지, 오픈 필드를 대조한다.
8. 화면: ego-browser로 확인한다. 메일 설정이 없는 빈 DB 방식으로 한다.
9. 실제 메일 앱: 운영 반영 뒤 본인 주소로만 확인한다(Q3). 원문의 픽셀, 60초 안 기계 판정, 몇 분 뒤 사람 오픈, 다시 열 때 요청이 오는지, 미리보기에서는 오픈이 안 생기는지를 본다.

## 범위 밖

- NHN `isOpened`·`openedDate` 재도입
- 과거 메일 소급
- 후속 분기를 오픈 기준으로 바꾸기
- `designer-hire.com'` 깨진 링크 버그
- 클릭 경로 개선(잠금 대기, HEAD 기록, 서명 없는 id)과 클릭 라우트의 열린 리다이렉트(별건으로 권함)
- 리드 여정·깊이 알림·고객 여정 카드의 오픈 표시
- 오픈/미오픈 거르개, 오픈 시각 목록
- Apple MPP·프록시 IP 대역 거르기
- 오픈 기반 리드 점수
- MCP 트래커 툴 변경
- 오픈 기록 보관 기간 정책
- 로그 표 리팩터

## DESIGN에서 정할 것

1. 저장 구조: 색인, "픽셀이 들어간 발송" 표기 방식(Q1)
2. 토큰: HMAC 형식·길이·인코딩, 키 출처(Q2)
3. 픽셀 HTML: 태그 모양, 위치(`</body>` 앞 또는 `<body>` 뒤, Gmail 잘림 고려)
4. 기록 경로: 판정을 TS에서 할지 SQL에서 할지, `after()` 오류 처리, HEAD, 발송당 상한 N, 레이트 키·값, IP 헬퍼 공유
5. 기계 판정: 오픈용 UA 토큰 표, 프록시 예외, Apple 프록시를 기계로 보지 않는다는 결정
6. 집계 SQL: API별 분자·분모, EXISTS 또는 반조인, templates 구조, 성능 목표
7. 행 신호 도우미: 새 파일 또는 클릭 도우미 확장
8. 화면 사양: 아이콘·색·툴팁·compact 폭, 안내 문구 최종안
9. MCP 필드 이름과 설명
10. TDD 계약 표

## 질문

- Q1 — 답(A): email_send_logs에 open_tracked 칸을 더해 픽셀이 들어간 발송만 센다.
- Q2 — 답(A): 서명 키는 기존 JWT_SECRET에서 파생한다(env 추가 없음). JWT_SECRET을 바꾸면 이전 메일의 오픈은 기록되지 않는다.
- Q3 — 답: 운영 반영 뒤 ghty6323@gmail.com(Gmail)으로 본인 테스트 발송해 확인한다.
