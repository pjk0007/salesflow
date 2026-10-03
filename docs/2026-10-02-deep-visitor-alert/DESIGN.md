# DESIGN — 깊이 들어온 사람 알림 (구글 챗)

- **track**: Full
- **사이클 ID**: 2026-10-02-deep-visitor-alert
- **근거**: 대표 요청(2026-10-02) "깊이 들어온 사람에 대한 모든 CRM 근거를 찾아서 구글 챗 지표 스페이스로 쏘는 걸로". 마케팅 마스터 `dev-handoff/07-site-signup-path.md`(알림 요청), `08-tracker-features.md` B2·B3·A1·8절, `research/icp-advanced-2026-10-01.md`, `tools/icp-journey/build_journey.py`(판정 규칙 원본)
- **브랜치**: `dev` (main 금지)

## 0. 실측으로 확정된 사실

- 메일 클릭 → 방문: `email_click_logs.click_id` = `tracker_sessions.click_id` (`clk_` + nanoid 21). tracker.js가 `sendb_cid`를 localStorage에 30일 두고 **이후 세션에도 같이 보낸다** → 다시 온 세션도 click_id로 찾을 수 있다
- 클릭마다 click_id가 새로 나온다. URL에 새 `sendb_cid`가 오면 tracker.js가 저장값을 덮어쓴다 → 후속 메일을 누른 뒤의 세션에는 후속 메일 click_id만 붙고, 1통째 메일 뒤 세션에는 1통째 click_id가 남는다. 회사 메일 보안 장비가 연 링크와 사람이 연 링크는 서로 다른 click_id·방문자가 된다
- 사업의 자기 사이트: `tracker_sites.workspace_id`(UNIQUE) = `records.workspace_id`. 도메인으로 사업을 가르지 않는다 (designer-hire.com이 두 사이트에 등록돼 있다)
- 저장되는 이벤트 종류: `PAGE_VIEW`(event_name 없음, page_url 전체), `SECTION_VIEW`(event_name = 영역 이름, `properties.dwell_ms`), `CLICK`(event_name = 버튼 이름, `properties.text`), `CUSTOM`(`sendb.track` 이름), `PURCHASE`
- SECTION_VIEW는 탭을 숨기거나 닫을 때 몰아서 온다 → **마지막 활동 뒤 10분이 지나야** 판정한다
- `email_send_logs`에는 `record_id` 인덱스가 없다 → 레코드별 메일 조회는 후보를 다 거른 뒤 마지막에만 한다
- 샌드비는 여러 조직이 쓰는 서비스다 → **알림은 환경 변수에 적은 워크스페이스만** 처리한다. 다른 조직의 고객 정보가 우리 챗으로 가면 안 된다
- 개발 DB는 2026-10-01 덤프라 새 방문이 들어오지 않는다 → 미리보기에 `now`를 넣어 그 시점 기준으로 시험한다
- 저장소에 구글 챗·슬랙 연동이 없다. 새로 만든다 (수신 웹훅, `POST {text}`)

## 1. 접근법

5분마다 외부 스케줄러(CloudType Scheduler)가 `POST /api/tracker/deep-alerts/process`를 부른다.

1. **후보 찾기** — 허용된 워크스페이스의 자기 사이트에서 최근 48시간 안에 시작했고 `click_id`가 있는 세션 → 그 클릭 → 발송 → 레코드
2. **판정** (DB를 모르는 순수 함수) — 연구 규칙 그대로: 사람 클릭, 약한 방문, 여러 사이트 검사기, 기존 방문자, 단계(둘러봄 → 서비스 깊이 확인 → 행동 → 신청 시작 → 제출), 연락 각도 A~E
3. **알림 대상** — 사람이고, 기존 방문자가 아니고, 이미 가입·신청·구독한 사람이 아니고, 수신거부하지 않았고, `서비스 깊이 확인` 이상이거나 쿠폰·AI 입력·신청 시작을 누른 사람
4. **CRM 근거 모으기** — 레코드 칸 전부(라벨·값), 회사 조사, 받은 메일 전부와 클릭 시각, 사이트에서 본 페이지·영역·누른 것, 상태 이력, 메모, 같은 사람의 다른 레코드(폼·가입), 알림톡 건수
5. **기록과 발송** — `deep_visitor_alerts`에 (레코드, 단계 수준)당 한 줄. 근무시간이면 바로, 밖이면 다음 평일 09:00. `live` 모드일 때만 실제로 보낸다. 보내기 직전에 수신거부·가입·intent 여부를 다시 확인한다 (7절)

## 2. 결정 ① 설정 (환경 변수만, 화면 없음)

| 이름 | 값 | 기본 |
|---|---|---|
| `DEEP_ALERT_MODE` | `off` / `dry_run` / `live` | `dry_run` (값이 없거나 모르는 값이면 dry_run) |
| `DEEP_ALERT_WORKSPACE_IDS` | 쉼표로 나눈 워크스페이스 번호, 예 `8,9,14` | 없음 → 아무것도 처리하지 않는다 |
| `DEEP_ALERT_WEBHOOK_URL` | 구글 챗 수신 웹훅 주소 (모든 허용 워크스페이스 공통) | 없음 |
| `DEEP_ALERT_WEBHOOK_URL_<워크스페이스번호>` | 그 워크스페이스만 다른 스페이스로 보낼 때 | 없음 → 공통 주소 |
| `NEXT_PUBLIC_BASE_URL` | 레코드 링크용 (기존) | `https://sendb.kr` |
| `CRON_SECRET` | 정기 작업 인증 (기존) | — |

- 웹훅 주소는 비밀값이다. 코드·문서·로그·응답에 절대 남기지 않는다. 로그에는 "웹훅 있음/없음"만
- `dry_run`: 판정하고 카드를 만들어 표에 `status='dry_run'`으로 남기지만 보내지 않는다. 나중에 `live`로 바꿔도 dry_run 줄은 보내지 않는다 (밀린 알림이 한꺼번에 나가지 않게)
- `live`에서 `off`·`dry_run`으로 내렸다가, 또는 허용 목록에서 뺐다가 되돌려도 묵은 카드가 몰려 나가지 않게 **예약 시각이 24시간 넘게 지난 `pending`은 보내지 않고** `skipped`, `last_error='오래되어 보내지 않음 (예약 시각 24시간 지남)'`으로 닫는다. 예약 시각 기준이라 금 18:00 → 월 09:00 대기와 상관없다
- `live`인데 그 워크스페이스의 웹훅이 없으면 `status='skipped'`, `last_error='웹훅 주소 없음'`

## 3. 결정 ② 판정 규칙 (build_journey.py 이식)

정규식은 원본과 같다 (대소문자 무시).

```
TRUST           ^(trust-cases|trust-reviews|review-portfolio-more|nav-portfolio|footer-portfolio)$
PRICE           ^(subsidy-calc-cta)$                     (SECTION_VIEW만)
PRICE_PAGE      ^/(pricing|plan)
DETAIL_SECTIONS ^(faq|how-it-works|dashboard|intelligence|security|service-cta|service-pricing|service-workspace)$
CONTENT_PAGE    ^/(portfolio|accounting|secretary|subsidy/|pricing|plan|faq|blog|resources|insight)
ACTION          (demo|consult|contact|trial|meeting|brochure|phone)
ACTION_PAGE     ^/(consult|consulting|contact)
START           (subscribe_step_1$|manual_entry_click|^signup$)
AI_START        ^ai_entry_click$
COUPON          (hero-free-trial|nav-free-trial)
SUBMIT          (subscribe_submit|signup_complete)
```

- `service-workspace`는 07 문서 #9의 이름 바꾸기(`service-pricing` → `service-workspace`)에 미리 대비해 더했다. 나머지는 원본 그대로
- 경로(path)는 `page_url`에서 주소 앞부분·`?` 뒤·`#` 뒤를 뗀 것

입력 하나 = **발송 한 통**(그 발송의 클릭 전부)과 그 사람의 사이트 활동.

| 판정 | 규칙 |
|---|---|
| `start` | 그 발송의 첫 클릭 시각 (모든 클릭 중 가장 이른 것). 없으면 고른 세션 시작 |
| 사람 클릭 있음 | 클릭 중 하나라도 `clicked_at > sent_at + 2분` (정확히 120초는 기계) |
| `found` | 그 발송의 모든 click_id로 찾은 세션 (모든 사이트) |
| `own` | `found` 중 자기 사이트 세션. 자기 사이트가 없는 워크스페이스는 `found` 전부 |
| 자매 사이트만 | `found`는 있는데 `own`이 없음 → 알림 없음 (자매 사이트 사업이 따로 판정) |
| 고른 세션 | `own` 중 `started_at`이 가장 이른 것. **이 세션이 기계로 판정되면** 사람 클릭(발송 2분 뒤)의 click_id로 찾은 `own` 세션 중 가장 이른 것(처음 고른 세션 제외)으로 한 번 더 판정하고, 그것이 기계가 아니면 그 판정을 쓴다 (아래 "연구 규칙과 다른 점") |
| `later` | 같은 방문자의 세션 중 고른 세션보다 뒤이고 30일 안 |
| `pages` | 고른 세션 `page_count` + `later`의 `page_count` 합 |
| 재방문 | `later` 중 고른 세션 30분 뒤 이후이고 `page_count >= 1` |
| 이벤트 범위 | 같은 방문자의 이벤트 중 `start <= occurred_at <= start+30일` 이고 `<= now` |
| `secs` | 범위 안 SECTION_VIEW 이름 (중복 제거한 개수로 센다) |
| `inter` | 범위 안 CLICK·CUSTOM 개수 |
| 둘러봄 | `pages >= 2` 또는 고른 세션 `duration >= 30` 또는 영역 3개 이상 |
| 사례 봄 | SECTION_VIEW·CLICK·CUSTOM 이름이 TRUST, 또는 PAGE_VIEW 경로가 `/portfolio`로 시작 |
| 가격 봄 | SECTION_VIEW 이름이 PRICE, 또는 PAGE_VIEW 경로가 PRICE_PAGE |
| 상세 봄 | SECTION_VIEW 이름이 DETAIL_SECTIONS, 또는 PAGE_VIEW 경로가 CONTENT_PAGE |
| 서비스 깊이 확인 | 사례 봄 또는 가격 봄 또는 상세 봄 |
| 행동 | CLICK·CUSTOM 이름이 ACTION, 또는 PAGE_VIEW 경로가 ACTION_PAGE (`page:<첫 경로 조각>`으로 기록) |
| 신청 시작 | CLICK·CUSTOM 이름이 START, 또는 PAGE_VIEW 경로가 `/signup`으로 시작하고 `/signup/complete`가 아님 (가입 화면도 표시) |
| AI 입력 시작 | CLICK·CUSTOM 이름이 AI_START (단계 아님, 따로) |
| 쿠폰 | CLICK·CUSTOM 이름이 COUPON (따로) |
| 제출·가입 | CLICK·CUSTOM 이름이 SUBMIT, PAGE_VIEW `/signup/complete`, PAGE_VIEW `/main/`(앱 사용 = 이미 계정 있음), 또는 4절의 "이미 깔때기 안" |
| 약한 방문 | 고른 세션 `duration < 3` 이고 `page_count <= 1` 이고 그 세션에 SECTION_VIEW·CLICK·CUSTOM 없음, 재방문 없음, 제출 없음 |
| 2분 안 클릭만 | 사람 클릭 없음 이고 아님(`pages >= 3` 또는 영역 2개 이상 또는 `inter > 0` 또는 제출) |
| 검사기 | `found`의 사이트가 2개 이상이고 `found` 세션 시작 시각 폭이 60초 이하이고, 아님(`pages >= 2` 또는 `duration >= 30` 또는 영역 3개 이상), 제출 없음 |
| 기계 | 약한 방문 또는 2분 안 클릭만 또는 검사기 → 알림 없음 |
| 기존 방문자 | 그 방문자의 자기 사이트 세션 중 `start - 1분`보다 이른 것이 3개 이상(**같은 레코드가 받은 메일의 click_id가 붙은 세션은 빼고**), 또는 그 방문자(브라우저)가 메일 클릭으로 이어진 **서로 다른 레코드가 3개 이상** → 알림 없음 |
| 가장 깊은 단계 | 0 발송 · 3 사이트 도착 · 4 둘러봄 · 5 서비스 깊이 확인 · 6 행동 · 7 신청 시작 · 8 제출·가입 (켜진 것 중 가장 큰 번호) |

- 원본의 "기존 방문자 per_vid ≥ 3"은 "한 방문자에게 이어진 첫 메일 3통"이었다. 실시간에서는 후속 메일 클릭도 같은 방문자로 이어지므로 **서로 다른 레코드 3개**로 바꿨다 (사내 직원·시험 브라우저가 여러 레코드를 누른 모양)
- 원본 연구는 첫 메일만 봤다. 여기서는 후속 메일 클릭도 그 발송의 `sent_at` 기준으로 같은 규칙을 쓴다

**연구 규칙과 다른 점** (실시간에서 생기는 놓침을 막으려고 바꿨다)

- **기존 방문자의 "메일 전 방문"에서 같은 레코드의 앞선 메일 세션을 뺀다.** 원본은 첫 메일만 봐서 그보다 이른 세션은 메일과 무관한 방문이었다. 후속 메일에 같은 규칙을 그대로 쓰면 1통째 메일로 세 번 다시 온 사람(가장 뜨거운 리드)이 후속 메일에서 신청을 시작해도 기존 방문자로 빠지고, 1통째로 `deep`을 받은 레코드의 `intent` 올림도 막힌다. 워커는 그 방문자 세션의 click_id → 클릭 → 발송 → 레코드를 읽어 같은 레코드의 click_id를 넘긴다(`sameRecordClickIds`). sendb_cid 30일이 지나 click_id 없이 온 세션은 여전히 센다 (남는 빈틈)
- **고른 세션이 기계면 사람 클릭 세션으로 다시 판정한다.** 회사 메일 보안 장비가 발송 직후 링크를 열어 1초·1쪽 세션(방문자 V1)을 남기면, 몇 시간 뒤 사람이 같은 메일을 자기 브라우저(V2)로 눌러 깊이 봐도 원본은 늘 장비 세션을 골라 약한 방문(기계)으로 뺐다. 연구 내보내기에서 이런 발송이 11건(디하 6건, 모두 회사 메일)이었다. 후보는 **사람 클릭(발송 2분 뒤)의 click_id에 직접 이어진 자기 사이트 세션**만이다 — 장비가 연 세션·다른 메일로 온 세션은 후보가 아니다. 다시 판정할 때 방문자 재료(세션·이벤트·연결 레코드·기존 방문자)는 그 세션의 방문자 것으로 바꾸고, `start`(그 발송의 첫 클릭)와 `found`(검사기 판정)는 그대로 둔다. 전달받은 동료가 연 세션도 사람 클릭이라 같은 레코드의 알림이 될 수 있는데, 이것은 동료가 먼저 연 경우 원본 규칙에서도 그랬다

**알림 대상과 수준**

- 대상: 기계 아님, 기존 방문자 아님, 제출·가입 아님, 수신거부 아님, 그리고 (가장 깊은 단계 >= 5 또는 쿠폰 또는 AI 입력 시작)
  - 원본 목록은 5~7단계만 봐서 AI 입력만 누른 사람이 빠졌다 (`definition` 지도 "모순 1") → 쿠폰·AI 입력도 넣는다
- 수준 `level`: 신청 시작·쿠폰·AI 입력이 있으면 `intent`, 아니면 `deep`
- 같은 레코드에 `intent`가 이미 있으면 `deep`은 만들지 않는다. `deep`이 있은 뒤 `intent`가 생기면 한 번 더 보낸다 (올라갈 때만)

**연락 각도** (첫 번째로 맞는 것)

| 각도 | 조건 | 기한 |
|---|---|---|
| A 신청 이어 하기 | 신청 시작 또는 쿠폰 또는 AI 입력 시작 | 근무시간이면 1시간 안, 밖이면 다음 근무일 10:00까지 |
| B 바로 상담 일정 | 행동에 consult·contact·phone·meeting | 오늘 18:00까지 (근무시간 밖이면 다음 근무일 12:00까지) |
| C 체험 다음 단계 | 행동에 demo 또는 trial(쿠폰 제외) | 다음 평일 12:00까지 |
| D 가격 안내 | 가격 봄 | 다음 평일 12:00까지 |
| E 사례·상세 보여 주기 | 그 밖 (사례 봄·상세 봄) | 다음 평일 12:00까지 |

- 원본의 마지막 기본값은 D였지만 백오피스랩 18명이 디하용 "가격·쿠폰" 각도를 받는 문제가 있었다 → 기본값을 E로 바꾸고 이름에서 "쿠폰"을 뺐다
- 근무시간: 한국 시각 평일 09:00~18:00. 공휴일 달력은 없다 (범위 밖)
- **기한 글자** (`deadlineText`, 2026-10-03 다듬음 — 위 시각 규칙은 그대로): `{급함 말} · {M/D(요일) HH:mm}까지`
  - A: 근무시간 `1시간 안 · 10/2(금) 15:20까지`, 밖 `출근하면 바로 · 10/5(월) 10:00까지`
  - B: 근무시간 `오늘 안 · 10/1(목) 18:00까지`, 밖 `출근하면 먼저 · 10/5(월) 12:00까지`
  - C~E: `10/5(월) 12:00까지` (급함 말 없음)
  - 근무시간 밖 카드는 다음 근무 시작에 읽히므로 "다음 평일" 같은 상대 말을 쓰지 않는다 (토요일에 탐지한 카드를 월요일에 읽으면 "다음 평일"이 화요일로 읽혔다). 예전 글자는 C~E에 "오전까지"라고 쓰고 12:00을 보였고, 근무시간 밖 B(상담 요청)와 E가 똑같이 보였다 → B에만 "출근하면 먼저"를 붙였다

## 4. 결정 ③ "이미 깔때기 안" (가입·신청·구독 판정)

깔때기 단계: 그 사이트의 기본 마케팅 깔때기(`tracker_funnels.kind='marketing' AND is_default=1`)의 `record_field` 단계들 `{field, value}`. 예: 디하 `match_stage` ∈ {신청완료, 테스트, 구독중}.

아래 레코드 중 하나라도 `data[field] === value`이면 "이미 깔때기 안" → 알림 없음.

- 메일 받은 레코드 자신
- 그 방문자에 이어진 레코드 (`tracker_visitors.record_id` ∪ `visitor_record_links`)
- 같은 워크스페이스에서 받는 메일 주소가 같은 레코드 (그 워크스페이스 `email` 형식 칸들과 `email` 키에서 소문자로 같은 값). 가입 레코드가 메일 방문자와 이어지지 않는 경우가 많아서다 (gaps 14)

또 위 레코드들의 `record_events` 중 `type='signup'`이거나 `label`이 깔때기 단계 값이면 같은 판정. 깔때기가 없는 사이트는 이벤트 규칙(SUBMIT·/signup/complete·/main/)만 쓴다.

수신거부: `email_unsubscribes`에서 `record_id`가 같거나 (`workspace_id`가 같고 소문자 메일이 같은) 줄이 있으면 알림 없음. 두 조건은 한 조회에서 OR로 본다 — 목록은 배열 매개변수 하나(`= ANY(...)`)로 넘기므로 매개변수 상한(65,535)에 걸리지 않는다.

- 메일 비교: 앞뒤의 공백·탭·줄바꿈·세로 탭·폼 피드·CR·NBSP·전각 공백·BOM·폭 없는 공백을 지우고 소문자로 (`EMAIL_TRIM_CHARS`). SQL은 `lower(btrim(x, 같은 문자열))`, JS는 `normalizeEmail` — Postgres `trim()`은 공백만 지워 엑셀에서 온 줄바꿈·NBSP가 붙은 주소를 놓쳤다
- 판정은 규칙 파일의 순수 함수로 한다: `isFunnelRecordEvent`, `isRecordInFunnel`, `buildUnsubscribeIndex`·`isUnsubscribedBy`, `normalizeEmail`. 워커는 DB에서 줄만 읽는다
- 같은 메일 레코드 조회는 워크스페이스 레코드를 jsonb로 훑는다 (표현식 인덱스 없음). 그래서 **먼저 4절 없이 판정해 알림이 될 수 있는 레코드만** 4절 재료(같은 메일 레코드·이어진 레코드·record_events·수신거부)를 읽고 다시 판정한다. 4절은 알림을 빼기만 하므로 결과는 같다 (시험 B26). 그 밖의 레코드는 건너뛴 이유를 4절 앞의 이유(`machine`·`not_deep` 등)로 세고, 4절 없이 알림이 되더라도 이미 같은 수준 알림이 있어 올라갈 수 없으면 읽지 않고 `already_alerted`로 센다 (알림 뒤 48시간 동안 다시 오는 사람 때문에 회차마다 훑지 않게)

## 5. 결정 ④ 카드 (구글 챗 text 한 통)

구글 챗 수신 웹훅은 버튼 콜백을 받을 수 없다 → 링크만 둔다 (`<주소|글자>`). 길이는 3,800자에서 자르고 끝에 "… 나머지는 레코드에서 보세요"를 붙인다. 사용자 값의 `<` `>`는 `‹` `›`로 바꿔 링크 문법이 깨지지 않게 한다.

한 줄이 예산을 다 먹어 뒤 블록(CRM 정보·받은 메일·메모)이 통째로 잘리지 않게 값마다 길이를 자른다.

- 본 페이지 경로는 퍼센트 인코딩을 풀어 보인다 (`decodeURI`, 잘못된 `%`면 원문). 판정은 원문 경로로 한다. 푼 뒤에 `<` `>`를 바꾼다
- 사이트 활동 항목(경로·영역·버튼·신청 흐름 이름)은 80자, 그 목록 한 줄은 400자까지 보이고 나머지는 "외 N개"
- 메일 제목 100자, 규칙 이름·작성자·파티션 40자, 칸 라벨 40자, 상태 이력 글자 80자

머리 네다섯 줄은 할 일 순서다: **언제까지(기한) → 누구에게 어떻게(연락 요약) → 무엇을(사업·각도) → 어디서(레코드·링크)**. 챗 알림 미리보기에는 앞 한두 줄만 보인다 — 기한과 연락처가 거기 있어야 카드를 다 읽지 않고도 움직인다 (2026-10-03: 예전에는 연락처가 사이트 활동 뒤 *CRM 정보* 4째 줄, 평균 461자 뒤에 있었다).

- 연락 요약(`contactSummaryOf`): 이름 · 전화(전부) · 메일(전부) · 회사. 같은 값은 한 번만. 이름은 20자, 회사 40자까지. 연락할 칸이 없으면 줄을 두지 않는다
  - 메일·전화는 칸 형식(`field_type` = `email`·`phone`)으로 고른다. 형식이 `text`인 칸은 키·라벨로 이름(담당자·고객명·이름·성함·대표자 …)과 회사(회사명·업체명·상호 …)를 고르고, 메일·전화는 라벨 힌트와 값 모양이 둘 다 맞을 때만 고른다 (`contactKindOf`, "이메일 수신 동의: 예"는 메일이 아니다)
  - 워커는 이미 읽은 칸 정의의 `key`·`fieldType`을 `fields`에 같이 넘긴다 (쿼리 추가 없음)
  - 같은 값은 *CRM 정보*에도 라벨과 함께 그대로 남는다 — 카드에서 빠지는 근거는 없다
- 상태 이력의 `type`이 칸 키면(`callStatus`) 칸 라벨(`콜 상태`)로 보인다. 워커가 칸 정의로 만든 `fieldLabels`(키 → 라벨)를 넘긴다. 칸이 아닌 type은 그대로

```
⏰ *{기한 글자}*
👤 {이름} · {전화} · {메일} · {회사}                ← 연락할 칸이 있을 때만
🔔 *{사업} · 깊이 들어온 사람* — {각도 글자}
레코드 {integratedCode} (#{recordId}) · {파티션} · {명단 종류}
<{base}/records?id={id}|레코드 열기> · <{base}/records/{id}/journey|고객 여정>

*왜 알림이 왔나*
메일 {N}통째 "{제목}"에서 {클릭 시각} 클릭 (발송 {X} 뒤) → {가장 깊은 단계 글자}{, 가입은 안 함}

*사이트에서 한 일* (첫 방문 {시각}, 체류 {m분 s초}, {pages}쪽{, 다시 옴})
• 본 페이지: / → /portfolio/ → /signup/   (순서대로, 연속 중복 제거, 최대 12)
• 본 영역: {별칭 라벨 또는 이름, 최대 15}
• 누른 것: {별칭 라벨 또는 text 또는 이름, 최대 15}
• 신청 흐름: {CUSTOM 이벤트 라벨, 최대 10}

*CRM 정보*
• {칸 라벨}: {값}   (빈 값·`_`로 시작하는 키·파일 칸 제외, 값은 120자까지, 칸 정의 순서)

*회사 조사*  (data._companyResearch가 있을 때) 업종 · 직원 · 웹사이트 · 설명 200자

*받은 메일* ({전체 수}통, 최근 8통)
{n}. {발송 시각} [{규칙 이름 또는 트리거}] {제목} — {클릭 없음 | 클릭 hh:mm (사람) | 클릭 hh:mm (발송 직후·기계 의심)}

*상태 이력* (최근 8)  {시각} {칸 라벨 또는 type}: {label}   ← 8개보다 많을 때만 "(최근 8)"
*메모* (최근 3)  {시각} {작성자}: {내용 200자}     ← 빈 메모를 뺀 뒤 3개보다 많을 때만 "(최근 3)"
*같은 사람의 다른 레코드*  {파티션} {integratedCode} ({생성일}) {깔때기 칸 값}
*알림톡*  {n}건 보냄                                ← status='sent'만 센다 (실패·대기 제외, 메일 근거와 같은 기준)

_고객에게 "사이트에서 무엇을 봤는지"는 말하지 않습니다._
```

시각은 모두 한국 시각 `M/D HH:mm` (기한만 `M/D(요일) HH:mm`). 워커는 상태 이력·메모를 자르지 않고 전부 넘긴다 — 미리 자르면 머리가 붙지 않아 보이는 줄이 전부인 것처럼 읽힌다.

예 (시험 시드 S2, 토요일 탐지 → 월 09:00에 올라감):

```
⏰ *출근하면 먼저 · 10/5(월) 12:00까지*
👤 이지우(시험) · 010-0000-0002 · s2.consult@company-b.test · 나래디자인(시험)
🔔 *디자이너하이어(시험) · 깊이 들어온 사람* — B 바로 상담 일정
레코드 DH-0002 (#2) · T2 채용공고 웹디자이너(시험) · 채용공고 수집
<…/records?id=2|레코드 열기> · <…/records/2/journey|고객 여정>
```

## 6. 결정 ⑤ 표 `deep_visitor_alerts` (마이그레이션 0070)

```sql
CREATE TABLE IF NOT EXISTS "deep_visitor_alerts" (
    "id" serial PRIMARY KEY NOT NULL,
    "org_id" uuid NOT NULL,
    "workspace_id" integer NOT NULL,
    "site_id" integer,
    "record_id" integer NOT NULL REFERENCES "records"("id") ON DELETE CASCADE,
    "send_log_id" integer,
    "session_id" integer,
    "visitor_id" integer,
    "level" varchar(20) NOT NULL,          -- deep | intent
    "angle" varchar(5) NOT NULL,           -- A~E
    "deepest_stage" integer NOT NULL,
    "status" varchar(20) DEFAULT 'pending' NOT NULL,  -- pending | processing | sent | failed | skipped | dry_run
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_error" text,
    "message" text NOT NULL,
    "detected_at" timestamp with time zone DEFAULT now() NOT NULL,
    "scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
    "locked_at" timestamp with time zone,
    "sent_at" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "dva_record_level_idx" ON "deep_visitor_alerts" ("record_id", "level");
CREATE INDEX IF NOT EXISTS "dva_pickup_idx" ON "deep_visitor_alerts" ("status", "scheduled_at", "id");
CREATE INDEX IF NOT EXISTS "dva_org_detected_idx" ON "deep_visitor_alerts" ("org_id", "detected_at");
```

- `send_log_id`·`session_id`·`visitor_id`는 FK를 걸지 않는다 (원본이 지워져도 알림 기록은 남긴다)
- `message`에 카드 글자를 그대로 남긴다 → dry_run에서 무엇이 나갈지 확인할 수 있다
- 저널: `{"idx":70,"version":"7","when":1773300000000,"tag":"0070_deep_visitor_alerts","breakpoints":true}`
- 마이그레이션은 서버가 켜질 때 자동으로 돈다. 실패해도 서버는 켜지므로 워커는 표가 없을 때(42P01) 조용히 `tableMissing: true`를 돌려준다

## 7. 결정 ⑥ 워커와 라우트

**`processDeepVisitorAlerts(opts?: { now?: Date }): Promise<DeepAlertRunStats>`** (`src/lib/deep-visitor-alert.ts`)

1. 모드 `off`면 바로 `{ mode:'off' }`. 허용 워크스페이스가 없으면 `{ noWorkspaces: true }`
2. `queryClient.reserve()` → `pg_try_advisory_lock(0x5c4edf03)` → 못 잡으면 `skippedAsLocked`. `finally`에서 풀고 `release()`
3. 처리 중 15분 넘은 줄(`processing`) 되돌리기
4. (`live`) 예약 시각이 24시간 넘게 지난 `pending`을 `skipped`로 닫는다 (2절). 이어서 **이미 예약된 줄을 탐지보다 먼저** 보낸다 (6단계와 같은 절차, 예산 60초) — 탐지가 예산을 다 쓰거나 실패해도 월 09:00 몫·재시도 줄은 나가게. 여기서 오류가 나면 탐지는 계속하고 끝에 오류를 다시 던져 500으로 드러낸다
5. **탐지**: 레코드마다 가장 깊은 판정 하나. 이미 같은 수준 이상 알림이 있는 레코드는 건너뛴다. 시작 워크스페이스를 회차마다 돌린다(5분 단위). 워크스페이스 하나에서 오류가 나면 로그(`describeDeepAlertError`)와 `failedWorkspaces`에 남기고 다음 워크스페이스로 간다 (표 없음 오류만 회차를 끝낸다). 후보마다 근거를 모아 `message`를 만들고 `insert ... onConflictDoNothing().returning()`
   - `dry_run`이면 `status='dry_run'`, 아니면 `pending`, `scheduled_at` = `nextAlertTime(now)`
6. **발송** (`live`이고 탐지가 예산을 남겼을 때): `status='pending' AND scheduled_at <= now AND scheduled_at >= now-24시간`을 `FOR UPDATE SKIP LOCKED LIMIT 20`으로 `processing`으로 집는다
   - **보내기 직전 재확인**: 근무시간 밖에 탐지한 줄은 최대 약 63시간 기다린다. 집은 줄마다 탐지와 같은 함수로 수신거부, 4절 "이미 깔때기 안"(레코드·그 방문자에 이어진 레코드·같은 메일 레코드·record_events), 탐지 1시간 전부터 그 방문자의 제출·가입 신호(`isSubmitSignal`)를 다시 본다. `deep` 줄은 같은 레코드에 `pending`·`processing`·`sent`인 `intent` 줄이 있으면 낡은 카드다. 걸리면 보내지 않고 `skipped`, `last_error='보내기 전 재확인: …'`. 재확인 조회가 실패하면 보내지 않고 집은 줄을 되돌린 뒤 오류를 올린다
   - 하나씩 보내고 1.1초 쉰다. 성공 → `sent`, `sent_at` (기록이 일시 오류로 실패하면 0.3초 간격으로 3번까지 다시 기록 — 이미 올라간 카드가 15분 뒤 다시 나가지 않게)
   - 실패 → 400은 바로 `failed`. 429·5xx·연결 오류는 시도가 3번 미만이면 `pending`·`scheduled_at = now+10분`, 3번이면 `failed`
   - **웹훅 설정 오류(401·403·404)**는 줄이 아니라 설정 문제다 → 시도로 세지 않고 `pending`으로 되돌리며(`last_error='웹훅 설정 오류, 주소를 고칠 때까지 기다림 — …'`), 그 회차에는 그 워크스페이스 줄을 더 집지 않는다. 고치면 다음 회차에 나가고, 24시간 넘게 못 고치면 위 4단계에서 닫힌다. 예전처럼 바로 `failed`로 두면 (레코드, 수준) 유니크 키 때문에 그 알림을 다시 만들 수 없었다
   - 줄 처리 중 예외(일시 DB 오류 등)가 나면 아직 보내지 않은 줄을 바로 `pending`으로 되돌리고(시도 수도 되돌림) 오류를 올린다. 이미 보낸 지금 줄은 되돌리지 않는다 (15분 뒤 3단계가 처리)
7. 예산 4분 (5분 주기보다 짧게). 로그 머리말 `[deep-alert]`. 통계에 `skippedAtSend`(웹훅 없음·재확인으로 닫음)·`deferred`(웹훅 설정 오류)·`expired`(24시간 지남)·`failedWorkspaces`를 더한다

**조회 묶기** (2026-10-03, 결과는 위 순서대로 할 때와 같다)
- 한 회차의 조회는 락을 잡은 전용 연결 하나로 보낸다. 목록은 배열 매개변수 하나로 넘기고, 문장은 이름 없이 보내 매번 그 값으로 계획을 세운다 (이름 붙인 문장은 같은 연결에서 다섯 번째부터 값을 모르는 공용 계획으로 바뀌어 배열 조회가 몇 배 느려졌다)
- 첫 문장 = 2~4단계의 락·되돌리기·닫기·첫 묶음 집기 + 탐지 대상 설정(사이트·퍼널·별칭·메일 칸 키) + 후보(세션 → 클릭 → 발송 → 레코드, 알림 수준, intent 없는 레코드의 클릭 전부와 찾은 세션). 쓰기는 락을 잡았을 때만 한다. 멈춘 줄을 되돌렸으면 닫기·집기는 그 뒤에 따로 한다 (되돌린 줄도 이번 회차 첫 묶음에 들어가게)
- 후보는 첫 문장에서 읽은 알림 수준을 쓴다 → 저장 문장이 `deep` 줄을 넣기 전에 같은 레코드의 `intent` 줄을 다시 보고, 있으면 넣지 않는다 (락을 잡기 직전에 끝난 워커가 남긴 알림과 겹쳐도 결과가 같게)
- 탐지 앞 발송이 줄을 집었으면 탐지 재료는 발송 뒤에 새로 읽는다 (그사이 들어온 방문을 놓치지 않게). 첫 문장이 표 없음 말고 다른 오류로 실패하면 락을 풀고 예전처럼 나눠서 한다 (한 워크스페이스 오류가 회차를 막지 않게)
- 탐지는 조직마다: 고른 방문자의 세션·이벤트 1문장, 4절 재료(이어진 레코드·수신거부·같은 메일 레코드·깔때기 이벤트) 1문장, 카드 근거(파티션·받은 메일·상태 이력·메모·알림톡·칸 정의) 1문장, 저장 1문장
- 회차 문장 수(시험 시드): 새 알림이 생기는 회차 6, 할 일 없는 회차 4 (예전 95·46). 시드 + 300명도 6·4 (예전 96·47) — 후보 수와 상관없다
- 미리보기: 미리보기 락 + 대상 설정 + 후보 1문장, 그 뒤는 같은 세 문장 + 락 풀기

**판정 가능 시점**: 그 방문자의 자기 사이트 마지막 활동(세션 `ended_at`·이벤트 `occurred_at` 중 가장 늦은 것, 없으면 세션 시작)이 `now - 10분`보다 이르면 판정. 아니면 다음 회차로 미룬다.

**후보 탐색 범위**: 자기 사이트 세션 중 `started_at`이 `now - 48시간` ~ `now`이고 `click_id`가 있는 것. 워크스페이스(사이트)마다 조건을 걸어 한 조회로 읽고 `tracker_sessions_started_idx`를 탄다.

**라우트**
- `POST /api/tracker/deep-alerts/process` — `CRON_SECRET` 검사(이메일 큐 라우트와 똑같이). 본문 없음. `{success, data: stats}`
- `GET /api/tracker/deep-alerts?limit=50` — `requireAdmin`. 자기 조직의 최근 알림 줄(메시지 포함)
- `GET /api/tracker/deep-alerts/preview?workspaceId=8&now=2026-10-01T15:00:00%2B09:00` — `requireAdmin`. **읽기만** 한다 (표에 쓰지 않고, 보내지 않음). 그 워크스페이스가 자기 조직 것일 때만. 지금 판정하면 나갈 카드 목록을 돌려준다. 허용 목록(`DEEP_ALERT_WORKSPACE_IDS`)과 무관하게 자기 조직 안에서 미리 볼 수 있다
  - **브라우저로 열면 HTML**: `Accept`가 JSON보다 `text/html`을 원하면(주소창) 같은 결과를 읽을 수 있는 HTML 한 장으로 준다 (`renderDeepAlertPreviewHtml`). 맨 위 한 줄 `카드 N · 후보 N · 제외 N` 바로 아래 카드들이 챗처럼(줄바꿈·굵게·기울임·링크) 보이고, 카드마다 끝에 `레코드 #id · 수준 · 각도 · 단계`, 맨 아래에 건너뛴 이유(한국어)·판정 시점·안내가 있다. 그 밖의 요청(fetch 기본 `*/*`, API 클라이언트, `Accept: application/json`, 같은 q)은 예전과 같은 JSON. 쿼리 매개변수·주소는 그대로다
    - 사용자 값은 모두 이스케이프한 뒤 꾸밈만 태그로 바꾼다. 링크는 `http(s)`만. 응답에 `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'` (스크립트·외부 자원 없음), `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. 두 모양 모두 `Vary: Accept`
    - 오류(401·403·400·404·409·500)도 브라우저에는 같은 상태 코드의 짧은 HTML로 준다
  - 미리보기는 `email_send_logs`·워크스페이스 레코드를 인덱스 없이 훑는다 → 전용 잠금 `pg_try_advisory_lock(0x5c4edf04)`으로 서비스 전체에서 한 번에 하나만 돈다. 다른 미리보기가 돌고 있으면 409 "다른 미리보기가 도는 중입니다". 정기 작업 키(…03)와 나눠야 미리보기가 정기 작업 회차를 막지 않는다

## 8. 파일 배치

| 파일 | 내용 |
|---|---|
| `src/lib/kst.ts` (신규, 순수) | `kstParts(now)`, `kstToDate(ymd, hour, minute?)`, `addDaysYmd(ymd, n)`, `formatKstShort(date)` "M/D HH:mm", `isBusinessHours(now)`, `nextBusinessStart(now)` |
| `src/lib/deep-visitor-alert-rules.ts` (신규, 순수, `@/lib/db` import 금지) | 정규식, 타입, `evaluateSend`, `evaluateSendWithFallback`, `pickChosenSession`, `humanClickFallbackSession`, `decideAlert`, `angleOf`, `deadlineText`, `nextAlertTime`, `listTypeOf`, `pathOf`, `isSubmitSignal`, `buildAlertMessage`, `resolveAlertConfig(env)`, `isLevelUpgrade`, 4절 판정(`isFunnelRecordEvent`, `isRecordInFunnel`, `normalizeEmail`, `buildUnsubscribeIndex`, `isUnsubscribedBy`, `summarizeVisitorClicks`), `recheckSkipReason`, `rotateStart`, 5절 연락 요약(`contactKindOf`, `contactSummaryOf`), 미리보기 HTML(`prefersHtml`, `chatTextToHtml`, `renderDeepAlertPreviewHtml`, `renderDeepAlertPreviewErrorHtml`) |
| `src/lib/deep-visitor-alert-delivery.ts` (신규, 순수) | 집은 줄을 한 통씩 보내는 순서 `deliverClaimedBatch` (DB 쓰기·웹훅은 deps로 받음), `isWebhookConfigError` |
| `src/lib/deep-visitor-alert-delivery.test.ts` (신규) | 가짜 deps로 재확인 건너뛰기·웹훅 설정 오류·예외 뒤 되돌리기·sent 기록 재시도 |
| `src/lib/deep-visitor-alert-rules.test.ts` (신규) | 3절·4절·5절 경계 시험 (behavior B1~) |
| `src/lib/kst.test.ts` (신규) | 근무시간·다음 평일 |
| `src/lib/google-chat.ts` (신규, DB 모름) | `postGoogleChatText(webhookUrl, text, fetchImpl?)` 10초 시간 제한, 429·5xx 한 번 재시도, 웹훅 주소를 오류 글에 넣지 않음 |
| `src/lib/google-chat.test.ts` (신규) | 가짜 fetch로 재시도·오류 |
| `src/lib/deep-visitor-alert.ts` (신규, DB) | 탐지·근거 수집·저장·발송, `previewDeepVisitorAlerts` |
| `src/lib/db/schema.ts` (수정) | `deepVisitorAlerts` 표, `DeepVisitorAlert` 타입 |
| `drizzle/0070_deep_visitor_alerts.sql`, `drizzle/meta/_journal.json` (신규·수정) | 6절 |
| `src/app/api/tracker/deep-alerts/process/route.ts` (신규) | 정기 작업 |
| `src/app/api/tracker/deep-alerts/route.ts` (신규) | 목록 |
| `src/app/api/tracker/deep-alerts/preview/route.ts` (신규) | 미리보기 (Accept로 JSON·HTML) |

## 9. 배포 순서 (사람이 할 일)

1. dev에 올리고 CloudType `sendb-dev`에서 배포 → 로그에서 `[migrate] 마이그레이션 완료!` 확인
2. 개발 서버에 대표 계정으로 로그인한 채 미리보기 주소를 연다 (아무것도 보내지 않는다)
   `/api/tracker/deep-alerts/preview?workspaceId=8&now=2026-10-01T15:00:00%2B09:00`
3. **사업마다 각자 스페이스로 보낸다** (대표 결정 2026-10-02). 사업별 구글 챗 스페이스에서 **앱 및 통합 → 웹훅 관리 → 웹훅 추가**로 주소를 만든다 (스페이스 관리자)
   - 디하(워크스페이스 8) → '1-디하 지표 트래커' 등 디하 스페이스 → `DEEP_ALERT_WEBHOOK_URL_8`
   - 백오피스랩(9) → 백오피스랩 스페이스 → `DEEP_ALERT_WEBHOOK_URL_9`
   - 오피오(14) → 오피오 스페이스 → `DEEP_ALERT_WEBHOOK_URL_14`
   - 공통 `DEEP_ALERT_WEBHOOK_URL`은 비워 둔다 — 한 사업의 카드가 다른 사업 스페이스로 가지 않게
4. 운영에 반영될 때(개발팀이 main에 합친 뒤) CloudType 운영 환경 변수에 2절 값을 넣는다. 처음에는 `DEEP_ALERT_MODE=dry_run`, `DEEP_ALERT_WORKSPACE_IDS=8,9,14`
5. CloudType Scheduler 작업 추가: `POST https://sendb.kr/api/tracker/deep-alerts/process`, cron `0 */5 * * * *`, 머리글 `X-Secret: <CRON_SECRET>`
6. dry_run 기록을 하루 본 뒤 `live`로 바꾼다

## 10. 범위 밖 (이번에 하지 않음)

- 비교군(연락하지 않고 남기기) — 08 질문 7 답을 받은 뒤
- 담당 칸·"내 오늘" 목록·[연락함] 버튼 (B1) — 웹훅은 버튼 콜백을 못 받는다. 샌드비 화면 쪽에서 만든다
- 설정 화면 — 웹훅 주소를 화면에 저장하면 가림 처리가 필요하다. 지금은 환경 변수
- 공휴일 달력, 사내 직원 IP 제외
- `email_send_logs.record_id` 인덱스 — 운영 표가 커서 마이그레이션 안에서 만들면 쓰기가 잠긴다. 따로 정한다 (`CREATE INDEX CONCURRENTLY`)
- 같은 메일 레코드 조회용 표현식 인덱스 `(workspace_id, lower(btrim(data->>'email', …)))` — 위와 같은 이유로 따로 정한다. 지금은 알림이 될 수 있는 레코드가 있을 때만 훑는다 (4절)
- 구글 챗 쪽 중복 방지 키(`messageId`·`requestId`) — 수신 웹훅에서 되는지, 같은 키로 다시 보내면 409를 주는지 시험해 보지 않았다. 지금은 `sent` 기록 재시도와 예외 뒤 되돌리기로 중복을 줄인다
- `failed`·`skipped` 줄을 `pending`으로 되살리는 관리 경로 — 필요하면 SQL로 한다

## 11. behavior 목록

| ID | 내용 |
|---|---|
| B1 | 클릭이 발송 120초 뒤면 기계, 121초면 사람 |
| B2 | 2분 안 클릭만 있고 2쪽·영역 1개·클릭 0이면 기계, 3쪽이면 사람 |
| B3 | 약한 방문(2초·1쪽·영역 0·클릭 0·재방문 없음)은 기계 |
| B4 | 60초 안 두 사이트 + 둘러보지 않음 → 검사기 |
| B5 | `found`에 자기 사이트가 없으면 자매 사이트만 → 알림 없음 |
| B6 | 첫 클릭 1분 전보다 이른 자기 사이트 세션 3개 → 기존 방문자. 같은 레코드의 앞선 메일 click_id가 붙은 세션은 세지 않는다 (1통째로 3번 온 뒤 후속 메일에서 신청 시작 → intent) |
| B7 | 한 방문자가 서로 다른 레코드 3개 → 기존 방문자 |
| B8 | hero·trust-logos·trust-stats·solution만 본 사람은 깊이 확인 아님 |
| B9 | trust-cases 영역 → 사례 봄 → 단계 5, 각도 E |
| B10 | `/signup/` 페이지 → 신청 시작 → intent, 각도 A |
| B11 | `/signup/complete`·`/main/`·`subscribe_submit`·깔때기 단계 레코드 → 제출, 알림 없음 |
| B12 | ai_entry_click만 (단계 4) → intent, 각도 A |
| B13 | consult 버튼 → 각도 B |
| B14 | 수신거부 → 알림 없음 |
| B15 | 근무시간 밖 탐지 → 다음 평일 09:00 예약. 기한 글자는 `{급함 말} · M/D(요일) HH:mm까지`, 근무시간 밖 B만 "출근하면 먼저", 12:00을 "오전"이라 쓰지 않음 |
| B16 | deep 뒤 intent는 다시 보냄, intent 뒤 deep은 보내지 않음 |
| B17 | 카드 3,800자 자르기, `<` `>` 바꾸기. 긴 한글 슬러그 경로 12개여도 CRM 정보·받은 메일·메모가 남음, "(최근 8)"·"(최근 3)" 머리, 빈 메모를 거른 뒤 최근 3개. 첫 줄 기한·둘째 줄 연락 요약(이름·전화·메일·회사, 연락처가 46자 안), CRM 정보는 그대로, 상태 이력은 칸 라벨 |
| B18 | 모드 기본값 dry_run, 허용 워크스페이스 없으면 처리 안 함, 워크스페이스별 웹훅 우선 |
| B19 | 웹훅 429·5xx 한 번 재시도, 오류 글에 웹훅 주소 없음 |
| B20 | 마지막 활동 10분 안이면 판정 미룸 |
| B21 | 보안 장비가 먼저 연 약한 세션 + 몇 시간 뒤 다른 브라우저의 사람 클릭 세션이 깊이 봄 → 사람 세션으로 다시 판정해 알림. 사람 클릭이 없거나 그 세션도 약하면 기계 |
| B22 | 보내기 직전 재확인: 수신거부·가입·제출 신호면 `skipped`, `deep`은 같은 레코드에 살아 있는 `intent`가 있으면 `skipped` |
| B23 | 예약 시각 24시간 지난 `pending`은 보내지 않고 닫음 (멈췄다 다시 켤 때) |
| B24 | 웹훅 401·403·404는 시도로 세지 않고 `pending`으로 되돌리고, 그 회차에는 그 워크스페이스를 보내지 않음 |
| B25 | 발송 중 예외 → 보내지 않은 줄은 바로 되돌림, 이미 보낸 줄은 그대로. `sent` 기록 실패는 3번까지 다시 |
| B26 | 4절 판정: data에 단계 칸이 없어도 record_events로 잡음, 깔때기 없는 사이트는 이벤트 규칙만, 다른 워크스페이스 수신거부 메일로는 막지 않음, 대소문자·앞뒤 공백 문자 무시 |
| B27 | 미리보기를 브라우저로 열면 같은 결과를 HTML로(글자 그대로의 `\n` 0개, 첫 카드 연락처가 페이지 글자 63자 안), 그 밖은 JSON 그대로. 사용자 값 이스케이프, `http(s)` 링크만 |
