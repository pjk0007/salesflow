# DESIGN-RPL — 회신 받기·짝짓기 → 자동 메일 멈춤 → 알림

- **track**: Full
- **사이클 ID**: 2026-10-11-reply-and-health (이 문서는 회신 몫. 같은 폴더의 발신 건강 설계가 마이그레이션 0075를 쓴다)
- **근거**: 마케팅 마스터 `dev-handoff/09-cold-email-system-prd.md` RPL-1(전체판)·RPL-2(분류 — 이 문서는 규칙 분류 1판만, AI 분류는 뒤)·SEQ-1(회신 멈춤 조건)·5-1 SND-1~3(반송 신호)·12절 여쭐 것 1·2
- **대표 결정 (2026-10-11)**: (1) 샌드비가 회신 메일함을 자동으로 읽어도 된다. (2) 실패율이 높으면 멈추고 알린다 (발신 건강 설계 몫. 이 문서는 반송 신호를 넘긴다)
- **대표 조건 (개인정보)**: 회신 메일함 `ceo@matchesplan.com`에는 채용 제안·급여 같은 메일이 있다. 샌드비는 **샌드비 발신 주소로 온 메일만** 읽고, 그 밖의 메일은 저장·전달하지 않는다. 메일함 주소는 설정값 하나(`REPLY_MAILBOX`)라 나중에 전용 `cs@` 메일함으로 옮길 때 코드를 고치지 않는다
- **브랜치**: `dev` (main 금지). 커밋·push는 대표 승인 뒤 메인 세션이 한다
- **바꾸는 설계 제약**: 06 "회신 메일함 연동을 하지 않는다"(`06-tracker-total-plan.md:445-451`)를 대표 결정으로 바꾼다. 개발팀(정재훈 님)과는 main에 합칠 때 맞춘다
- **검토 반영 (2026-10-11)**: 1차 검토의 B1·B2·M1~M9·m1~m9를 본문에 반영했다. 무엇을 어디서 바꿨는지는 **18절**. 짝 문서 `DESIGN-SND.md`와 반송 안내·`email_send_logs` 색인 약속을 하나로 맞췄다 (B2 — 두 문서 18절·17절 같은 내용)

## 0. 실측으로 확정된 사실 (코드·문서)

- **회신 코드가 없다.** `src`에 reply·In-Reply-To 처리가 없다. 회신 관련으로 남은 것은 쓰지 않는 칸 `workspaces.reply_to_email`(0073)뿐이다
- **NHN은 Reply-To를 넣을 수 없다** (2026-10-04 실제 발송에서 거절, `src/lib/nhn-email-headers.ts:14-33` 금지 헤더 18종). 그래서 PRD의 "Reply-To 주소 꼬리표(`reply+꼬리표@`)" 짝짓기는 **못 한다** → 6절의 Message-ID 짝짓기로 바꾼다
- **회신이 오는 길 (2026-10-10 완료)**: 발신 도메인 약 160곳 모두 MX → Google Workspace. `cs@<발신 도메인>`으로 온 메일은 `ceo@matchesplan.com`에 들어온다
  - `matchesplan.cloud`·`.me`: 사용자 별칭 도메인 + `cs@` 별칭
  - 보조 도메인 158곳: Gmail 기본 라우팅 규칙이 봉투 받는 사람을 `ceo@`로 바꾼다. **`To:` 머리글은 `cs@<도메인>` 그대로**다
  - NHN Return-Path = From(`cs@<도메인>`) → 받는 쪽 서버가 나중에 돌려보내는 **반송 안내(DSN)도 같은 메일함으로 온다**
- **NHN은 보낸 메일의 Message-ID를 발송 응답에 주지 않는다.** `eachMail` 응답은 `requestId`·`results[]`뿐이다 (`src/lib/nhn-email.ts:35-42`). 다만 발송 조회 응답의 `resultId`("SMTP ID", "메일 발송 ID")가 Message-ID 모양이고 앞부분이 요청 번호다: 문서 예 `"requestId":"20210806120100sA3CcWU2"` → `"resultId":"<20210806120100sA3CcWU2@tcmmsapp-92a901>"` (`docs/nhncloud/email.html`, 메일 목록·상세 조회). 샌드비는 `NhnEmailQueryResult`에 이 칸을 담지 않는다 (`nhn-email.ts:44-56`)
- **샌드비는 수신자 한 명마다 `eachMail`을 한 번 부른다** (`auto-personalized-email.ts:403`, `email-automation.ts:202`, `email-followup.ts:603,824`) → `email_send_logs.request_id` 하나가 발송 한 통이다
- `email_send_logs`에는 **수신거부 토큰 말고 색인이 없다** (`drizzle/0060_email_unsubscribe.sql:27`). 마이그레이션은 서버가 켜질 때 drizzle `migrate()`가 **한 트랜잭션 안에서** 돌린다 (`src/lib/db/migrate.ts`) → `CREATE INDEX CONCURRENTLY`를 마이그레이션에 넣을 수 없다. 큰 표에 일반 색인을 만들면 그동안 쓰기가 막히고, 같은 트랜잭션의 `ALTER TABLE … ADD COLUMN`이 쥔 잠금 때문에 읽기까지 막힌다. 마이그레이션이 실패하면 로그만 남고 서버는 뜬다 (`migrate.ts`의 catch)
  - **두 문서의 같은 결론 (B2)**: `email_send_logs` 색인 `(org_id, sent_at)`·`(request_id)`는 마이그레이션(0074·0075)에 넣지 않는다. 부팅 뒤 트랜잭션 밖에서 `CREATE INDEX CONCURRENTLY IF NOT EXISTS`로 만드는 단계 `ensureSendLogIndexes()`(DESIGN-SND 8-3)가 만든다. 이 문서는 그 두 색인을 쓰고 `email_send_logs`에 다른 색인을 더하지 않는다
- 0073 전 발송 기록은 `sender_email`이 NULL이다 → 그때는 `sender_profile_id`의 지금 주소로 본다
- **`email_send_logs.record_id`에는 FK가 없다** (`schema.ts:706`). 레코드를 지우면(일괄 삭제·파티션 비우기·중복 처리의 `delete_old`) 발송 기록에 없는 레코드 번호가 남는다. `record_events.record_id`는 NOT NULL FK다(`schema.ts:1667`) → 이어진 발송의 `record_id`를 그대로 넣으면 FK 위반이 난다 (M6 — 6-1·7-1에서 막는다)
- **`matchesplan.com`은 메일함 도메인이면서 실제 발신 도메인 20곳 중 하나다** (`docs/2026-10-02-sender-warmup/DESIGN-3-reply-to.md:4`). 템플릿 규칙은 늘 조직 기본 주소로 나가고(`email-automation.ts:133-143`, `claimSender(orgId, { mode: "fixed", ids: [] })`), 예전 기본 발신 `email_configs.from_email`도 있다. 메일함에 들어온 메일은 모두 `Delivered-To`가 메일함 주소다 → 주소 모음에 메일함 주소나 메일함 쪽 주소가 섞이면 남의 메일이 "우리 것"이 된다 (B1 — 4-1에서 막는다)
- 주소 정규화 이름 `normalizeSenderAddress`는 이미 있다 (`email-sender-limit-paths.ts:114`, `+태그`를 떼지 않음) → 이 문서의 새 함수는 `normalizeReplyAddress`다 (m9)
- Gmail API는 첨부로 보는 MIME 부분에 `body.data` 대신 `body.attachmentId`만 준다. 반송 안내의 `message/delivery-status`·`message/rfc822`·`text/rfc822-headers` 부분도 이렇게 올 수 있다 (M9 — 4-2에서 그 부분만 받는다)
- 우리 메일 꼬리말은 "이 메일을 더 이상 받고 싶지 않으시면 수신거부를 눌러주세요"다 (`email-unsubscribe.ts:53-55`) → 회신 인용에 이 문장이 남으면 수신거부 말로 잘못 읽힌다 (m4)
- **자동 메일 경로와 지금 멈춤 지점**
  - 후속 대기열 `email_followup_queue` 상태: pending·processing·sent·skipped·cancelled. `result`는 clicked/not_clicked. 사유 칸 없음. 수신거부 확인은 템플릿 `email-followup.ts:528`, AI `:675`. 다음 단계는 보냈을 때만 잡힌다
  - 템플릿 대기열 `email_automation_queue` (kind: repeat·first·first_bulk, 상태: pending·completed·cancelled). `processing` 상태가 없고 마지막 update가 상태 조건 없이 id로 쓴다 (`email-automation.ts:647-658`) → 처리 중에 다른 곳이 취소하면 덮인다
  - 발송 대기열 `email_send_queue` (상태: pending·processing·sent·skipped·failed, priority 0 대량 / 1 문의). `enqueueDeferredSend`는 끝난 줄(sent·skipped·failed)을 다시 pending으로 살린다 (`email-send-queue.ts:295-322`)
  - AI 첫 메일 `processAutoPersonalizedEmail`의 수신거부 확인 `auto-personalized-email.ts:181`, 같은 판정을 대기열이 묶어서 미리 하는 `walkQueueRow` (`email-send-queue-rules.ts:556-566`, 조회 묶음 `QueueWalkLookups`)
  - 후속 손 취소 라우트는 `status='pending'`일 때만 바꾼다 (`src/app/api/email/followup-queue/[id]/route.ts`) — 같은 원칙을 쓴다
- **AI 후속 기록에는 규칙 번호가 없다** (`email-followup.ts:799-813`, PRD SEQ-7). `parent_log_id` 사슬을 거슬러 첫 메일의 `auto_personalized_link_id`를 찾아야 규칙을 안다
- **레코드 사건 표가 있다**: `record_events(type, label, occurred_at, meta)`. 여정 화면은 모든 type을 사업 채널로 보이고, 이름은 `businessChannel`(`src/lib/tracker/journey.ts:34-40`)이 붙인다
- **재사용할 것**: 구글 챗 보내기 `postGoogleChatText` (`src/lib/google-chat.ts`), 한 통씩 보내기·재시도·웹훅 설정 오류 처리 `deliverClaimedBatch` (`src/lib/deep-visitor-alert-delivery.ts:83`), 워크스페이스별 웹훅 `resolveAlertConfig` (`deep-visitor-alert-rules.ts:1422`), 연락 요약 `contactSummaryOf` (`:1031`), 메일 정규화 `normalizeEmail`·`EMAIL_TRIM_CHARS` (`:790-800`), 한국 시각 `src/lib/kst.ts`
- 정기 작업 잠금 키 01~06이 쓰이고 있다 (`email-automation.ts:399-400`). **이 작업은 `0x5c4edf07`**, 발신 건강은 `08`(NHN 결과 동기화)·`09`(건강 판정)·`0a`(부팅 뒤 색인)를 쓴다 (DESIGN-SND와 같은 표)
- 로컬 시험 하네스 `F:/Dev/salesflow/.testenv/mock-fetch.mjs`는 NHN·구글 챗·Anthropic만 가짜로 답하고 **그 밖의 호스트는 503으로 막는다** → 구글 토큰·Gmail 가짜를 더해야 한다 (15절)

## 1. 접근법

5분마다 CloudType Scheduler가 `POST /api/email/replies/sync`를 부른다.

```
토큰 갱신 → 메일함 주인 확인(getProfile = REPLY_MAILBOX)
  → 우리 발신 주소 모음 (메일함 주소·메일함 쪽 도메인 주소는 늘 뺌 — B1)
  → 새 메일 번호 (history 이어 읽기, 처음·끊김이면 목록 조회)
  → 1단계: 받는 사람·스레드 머리글만 읽기 (본문·보낸 사람·제목·snippet 안 읽음)
  → "우리 것" 판정: 받는 주소 = 샌드비 발신 주소 (또는 같은 도메인 + 스레드가 우리 발송에 이어짐)
       아니면 → 버림 (건수만 셈)
  → (운영 서버가 아니면) 1.5단계: 우리 것의 From만 읽어 REPLY_ALLOWED_FROM(직원 시험 주소)만 남김 (M1)
  → 2단계(우리 것만): format=full로 머리글 전부 + 본문 (반송 안내 부분이 첨부로 오면 그 부분만, 64KB까지 — M9)
  → 분류: 사람 회신 / 자동응답 / 반송(DSN) / 시스템 안내 / 내부 직원 / 알 수 없음 (+ 수신거부 말 표시)
  → 짝짓기: Message-ID(요청 번호) → 없으면 (보낸 사람·받은 주소·60일·제목, 사업이 갈리면 애매함 — M4)
  → 저장 email_replies (Gmail 메시지 번호 유일. 데이터 오류는 그 메일만 — M6) → 효과(on일 때만):
       사람 회신: 레코드 사건 'reply' · 대기·보류 중 자동 메일 멈춤(사유 replied, 회신 보낸 사람과 원래 받은 사람 둘 다 — M3) · 구글 챗 카드
       반송: 발송 기록 쓰기·짝짓기·실패 셈은 SND recordBounceSignal() 한 곳 (B2) · 레코드 사건 'email_bounce'
       자동응답·시스템 안내·내부 직원: 기록만
  → 보내기 직전 막기: 자동 메일 경로 모두가 "이 사업에서 이 주소가 회신했나 · 이 조직에서 이 주소가 hard 반송됐나"를 한 번 더 본다
```

## 2. 결정 ① 메일함 접근 방식 — OAuth 갱신 토큰 (gmail.readonly) 하나

| 비교 | **OAuth 갱신 토큰 (추천)** | 서비스 계정 + 도메인 전체 위임 |
|---|---|---|
| 대표님 콘솔 작업 | Cloud 콘솔 4화면 + OAuth Playground 1화면, 관리 콘솔은 막혔을 때만 | Cloud 콘솔 4화면(서비스 계정·키 만들기 포함) + 관리 콘솔 위임 화면 + 키 생성이 조직 정책으로 막혀 있으면 정책 풀기 |
| 권한 범위 | **메일함 하나 전체, 읽기만**. 그 메일함이 `ceo@`면 채용·급여 메일까지 포함된다 — 4절 거르기는 샌드비 코드 안에서만 지켜진다 | 키 하나로 **회사 모든 사람의 메일함**을 읽을 수 있다 (위임은 사용자를 가리지 않는다) |
| 비밀값 모양 | 짧은 글자 3개 (환경 변수에 바로 붙임) | 여러 줄 JSON 개인 키 (줄바꿈 처리 실수가 잦다) |
| 새어 나가면 | 클라이언트 ID·보안 비밀·갱신 토큰 셋이 있으면 **코드 밖에서도 그 메일함 전체를 읽는다**. CloudType 환경 변수를 볼 수 있는 사람은 셋을 다 본다 (M2). 끊기는 13-6 | 회사 전체 메일. 키를 지우고 위임을 다시 해야 함 |
| 끊기는 경우 | 메일함 주인이 비밀번호를 바꾸면 Gmail 권한 토큰은 무효가 된다 → 13-4절로 다시 발급 (약 10분, M8) | 키를 지우거나 정책이 키 만료를 걸 때 |
| 전용 메일함으로 옮길 때 | 13-0 순서대로 (라우팅 먼저, 환경 변수 나중). 코드는 그대로 | `REPLY_MAILBOX`만 바꿈 |

**OAuth를 고른다.** 대표님이 가장 걱정한 것이 "다른 메일까지 읽히는 것"이다. 위임 방식은 그 걱정을 회사 전체로 넓힌다. 콘솔 단계도 OAuth가 적고 관리 콘솔 작업이 기본으로 없다.

### 2-1. 토큰은 회신 전용 메일함 것만 받는다 (M2, 대표 결정 필요)

- 갱신 토큰은 메일함 **전체** 읽기 권한이다. 4절 거르기는 샌드비 코드가 지키는 약속이지, 토큰을 가진 사람을 막지 못한다. `ceo@` 토큰을 CloudType 스페이스 `pjk8197`(`sendb-dev`·운영 `sendb`)에 넣으면 그 환경 변수를 볼 수 있는 사람(개발팀 포함)이 대표님 메일 전체를 읽을 수 있게 된다 — 대표 조건과 어긋난다
- 그래서 순서를 바꾼다. **토큰을 받기 전에** 회신 전용 메일함(라이선스 사용자 1명, 예 `reply@matchesplan.com`)을 만들고, 별칭 `cs@matchesplan.com`과 보조 도메인 158곳 라우팅 규칙의 받는 곳을 그쪽으로 바꾼다 (13-0). 토큰은 그 메일함 것만 받는다. 그 메일함에는 `cs@<발신 도메인>` 앞으로 온 메일만 들어오므로 토큰이 새어도 대표님 메일은 없다. 4절 거르기는 두 번째 울타리로 그대로 둔다
- 구글 그룹(공용 메일함)은 OAuth·Gmail API로 읽을 수 없다 → **라이선스 사용자**여야 한다 (m3)
- 대표님이 옮기기를 미루면 (나) 길: `ceo@` 토큰은 **개발 서버 시험에만**, 시험 기간(하루 이틀)만 넣고 끝나면 13-6으로 끊는다. 운영 서버에는 `ceo@` 토큰을 넣지 않는다 — 운영은 13-0이 끝난 뒤에만 켠다 (14절). (나) 길은 13절 머리의 경고를 읽고 대표님이 승인해야 한다

- 동의 화면 사용자 유형은 **내부(Internal)** 로 한다. 내부 앱은 Google 검증이 필요 없고, 외부 앱 "테스트" 상태의 "7일 뒤 토큰 만료"가 없다. 내부는 **프로젝트가 matchesplan.com 조직 아래 있을 때만** 고를 수 있다 (13-1의 2번 확인)
- 갱신 토큰은 OAuth Playground에서 **우리 OAuth 클라이언트로** 받는다. Playground 기본 클라이언트로 받은 토큰은 24시간 뒤 자동으로 끊긴다
- 범위는 `https://www.googleapis.com/auth/gmail.readonly` 하나. 샌드비는 메일을 고치거나 지우거나 라벨을 붙이지 않는다

## 3. 결정 ② 설정 (환경 변수만, 화면 없음)

| 이름 | 값 | 기본 |
|---|---|---|
| `REPLY_SYNC_MODE` | `off` / `dry_run` / `on` | `dry_run` (값이 없거나 모르는 값이면 dry_run). **운영 서버가 아니면 `on`은 시험 제한이 있을 때만** — 없으면 dry_run으로 돈다 (아래 "운영 서버 판정", M1) |
| `REPLY_ALERT_MODE` | `off` / `dry_run` / `live` | `dry_run` (같은 규칙. `live`도 같은 제한) |
| `REPLY_MAILBOX` | 읽을 메일함 주소. `getProfile`이 돌려주는 **기본 주소와 똑같아야** 한다 — 별칭을 넣으면 `mailbox_mismatch`로 멈춘다 (m3) | `ceo@matchesplan.com` (13-0 뒤 `reply@matchesplan.com`) |
| `REPLY_GOOGLE_CLIENT_ID` | OAuth 클라이언트 ID | 없음 |
| `REPLY_GOOGLE_CLIENT_SECRET` | OAuth 클라이언트 보안 비밀 (**비밀**) | 없음 |
| `REPLY_GOOGLE_REFRESH_TOKEN` | 메일함 주인의 갱신 토큰 (**비밀**, 메일함 전체 읽기 권한 — 2-1) | 없음 |
| `REPLY_PRIVATE_DOMAINS` | 메일함 주인 계정의 별칭 도메인처럼 **회사 사람 메일이 오는 도메인** (쉼표). 이 도메인과 메일함 도메인 위의 주소는 우리 발신 주소가 될 수 없다 — 다음 칸에 적은 주소만 예외 (B1) | 없음 (메일함 도메인은 늘 들어간다). 운영 값: `matchesplan.cloud,matchesplan.me,designer-hire.com,offio.kr,pixl.kr` (대표 계정 별칭 도메인 — 13-3에서 관리 콘솔 값으로 확인) |
| `REPLY_SHARED_DOMAIN_ADDRESSES` | 위 도메인 위에 있지만 **샌드비 발신 주소인 것** (쉼표). 이 주소로 온 메일만 읽는다 | 없음. 운영 값: `cs@matchesplan.cloud,cs@matchesplan.me` (+ `cs@matchesplan.com`을 실제 발신에 쓰면 그것) |
| `REPLY_WORKSPACE_IDS` | 회신을 처리할 워크스페이스 (쉼표). 주소는 이 워크스페이스들의 **조직** 단위로 모으지만, 이어진 발송의 워크스페이스가 이 목록 밖이면 **저장하지 않는다** (건수 `outOfScope`만, m8) | 비면 `DEEP_ALERT_WORKSPACE_IDS` |
| `REPLY_SENDER_EMAILS` | 있으면 **이 주소만** 우리 발신 주소로 본다 (시험용, 쉼표). 4-1의 빼는 규칙은 그대로 걸린다 | 없음 → 4-1 주소 모음 |
| `REPLY_ALLOWED_FROM` | 보낸 사람이 이 주소(쉼표)인 메일만 2단계로 읽는다 (직원 시험 주소). **운영 서버가 아니면 이 값이 없을 때 2단계를 하지 않는다** (M1) | 없음 |
| `REPLY_BACKFILL_DAYS` | 처음 한 번 거슬러 읽을 날 수 (0~60). 운영 서버가 아니면 최대 1 (M1) | 운영 서버 14 / 그 밖 0 |
| `REPLY_OPS_WEBHOOK_URL` | 메일함 연결이 끊겼거나 읽기가 멈췄을 때 알릴 구글 챗 웹훅 (**비밀**) | 없으면 `SEND_HEALTH_WEBHOOK_URL`(SND 운영 스페이스) → 그것도 없으면 `DEEP_ALERT_WEBHOOK_URL` (M7). 셋 다 없을 때만 화면 띠·로그뿐 |
| (재사용) `DEEP_ALERT_WEBHOOK_URL_<워크스페이스>`·`DEEP_ALERT_WEBHOOK_URL` | 회신 카드도 깊이 들어온 사람 알림과 **같은 사업 스페이스**로 간다 (PRD 장면 1) | — |
| (재사용) `CRON_SECRET`, `NEXT_PUBLIC_BASE_URL` | 정기 작업 인증, 카드 링크 | — |

**모드 뜻**

| | `off` | `dry_run` | `on` |
|---|---|---|---|
| Gmail 읽기 | 안 함 (호출 0) | 함 | 함 |
| `email_replies` 저장 (우리 것만) | — | 함 (`detected_mode='dry_run'`) | 함 |
| 레코드 사건·자동 메일 멈춤·발송 실패 표시 | — | 안 함. `effects`에 "멈출 예정" 숫자만 | 함 |
| 보내기 직전 막기 (7-4) | 꺼짐 | 꺼짐 | 켜짐 — dry_run 때 남은 줄도 본다 |

- `dry_run`이 기본인 까닭: 배포만으로 고객에게 나가는 메일이 바뀌지 않게. dry_run 기록이 PRD RPL-1 관문 2("회신 수 2주 손 집계")를 대신한다
- `dry_run` → `on`으로 바꾸면 다음 회차가 **14일 안 dry_run 줄의 효과를 적용**한다 (밀린 효과). 알림은 보내지 않는다 (8절)
- `REPLY_ALERT_MODE`는 `DEEP_ALERT_MODE`와 같은 뜻이다: `dry_run`은 카드 글자를 `alert_message`에 남기고 보내지 않는다. 나중에 `live`로 바꿔도 dry_run 카드는 보내지 않는다
- 비밀값 셋 중 하나라도 비면 `{ configured: false }`로 끝나고 Google을 부르지 않는다
- 비밀값은 코드·문서·로그·응답·DB에 남기지 않는다. 로그에는 "있음/없음"만. 메일 주소는 로그에서 `a***@도메인`으로 가린다
- **한 메일함은 한 환경만 `on`으로 읽는다.** 개발 서버와 운영 서버가 같은 토큰으로 둘 다 `on`이면 카드가 두 번 가고, 개발 DB(실제 고객 데이터 사본)의 대기열도 멈춘다. 운영을 켜는 날 개발은 `off`로 바꾼다 (14절). 이 원칙은 운영 절차에만 맡기지 않고 아래 "운영 서버 판정"이 코드로 지킨다

**운영 서버 판정 (M1)** — `NEXT_PUBLIC_BASE_URL`의 origin이 코드 상수 `REPLY_PRODUCTION_ORIGIN = "https://sendb.kr"`와 같으면 운영 서버, 아니면 **시험 서버**다. 시험 서버(개발 서버·로컬)에서는:
- 2단계(본문 읽기)는 `REPLY_ALLOWED_FROM`의 보낸 사람 메일만 한다 (4-2의 1.5단계). 값이 없으면 1단계 판정 숫자만 세고 **아무것도 저장하지 않는다**
- `REPLY_SYNC_MODE=on`·`REPLY_ALERT_MODE=live`는 `REPLY_SENDER_EMAILS`와 `REPLY_ALLOWED_FROM`이 **둘 다** 있을 때만 받는다. 아니면 dry_run으로 돌고 회신 탭 띠에 "시험 서버 — 시험 주소·직원 주소 없이 on을 켤 수 없습니다"
- 거슬러 읽기는 최대 1일 (기본 0)
- 그래서 개발 서버에 운영 값을 그대로 복사해도, 직원이 보낸 시험 메일 말고는 개발 DB에 저장·멈춤·카드가 생기지 않는다
- 로컬 시험 전용 값 `REPLY_TEST_ASSUME_PRODUCTION=1`은 `DATABASE_URL` 호스트가 `127.0.0.1`·`localhost`일 때만 운영 서버처럼 보게 한다 (15-3). 원격 DB를 쓰는 CloudType 서버에서는 무시된다

**코드 상수 (환경 변수 아님, `email-reply-rules.ts`)**: 막기 기간 90일, 짝짓기 기간 60일(반송 짝짓기는 SND 7일 — DESIGN-SND 4-4), 발췌 저장 500자·카드 300자, 알림 나이 한도 24시간, 밀린 효과 14일, 회차 예산 4분, 1단계 최대 500통, 본문 최대 50통, 반송 안내 첨부 부분 64KB, Gmail 동시 요청 4, 운영 알림 간격 6시간, 회신 읽기 정체 기준 6시간 (M7), 운영 origin `https://sendb.kr`.

## 4. 결정 ③ 개인정보 거르기 — "우리 것"만 읽는다

### 4-1. 우리 발신 주소 모음 (회차마다 한 번, `getProfile` 뒤)

- 조직: `REPLY_WORKSPACE_IDS`(비면 `DEEP_ALERT_WORKSPACE_IDS`)의 워크스페이스가 속한 조직들. 둘 다 비면 아무것도 처리하지 않는다 (`noWorkspaces`). 샌드비는 여러 조직이 쓰는 서비스라 다른 조직 메일을 우리 DB에 이으면 안 된다
- 후보 주소 (그 조직들의)
  1. `email_sender_profiles.from_email`
  2. `email_configs.from_email` (예전 기본 발신)
  3. 최근 90일 `email_send_logs.sender_email`의 DISTINCT 값 — 프로필을 지우거나 주소를 바꾼 뒤 옛 주소로 온 회신(그 주소로 나간 최근 발송에 대한 답)도 잇기 위해서다 (m2). `(org_id, sent_at)` 색인(DESIGN-SND 8-3)으로 범위를 좁힌다. 색인이 아직 없으면(`pg_indexes`에 없거나 `indisvalid=false`) 이 줄을 건너뛰고 1·2만 쓴다
  - `REPLY_SENDER_EMAILS`가 있으면 후보는 **그것만**
- **빼는 주소 (늘, B1)** — 후보에 있어도 우리 주소가 아니다
  1. `REPLY_MAILBOX`와 `getProfile().emailAddress`
  2. **메일함 쪽 도메인** 위의 주소: `REPLY_MAILBOX` 도메인, `getProfile` 주소의 도메인, `REPLY_PRIVATE_DOMAINS`. 단 `REPLY_SHARED_DOMAIN_ADDRESSES`에 적은 주소는 남긴다 (예 `cs@matchesplan.cloud`)
  - 까닭: 메일함의 모든 메일은 `Delivered-To`가 메일함 주소이고, 별칭 도메인 위의 공용 주소(`hr@`·`info@` 등)로는 채용·급여 메일이 온다. 프로필이나 `email_configs`에 이런 주소가 하나라도 있으면 그 메일이 "주소 일치"로 본문까지 읽혀 저장·카드로 나간다
  - 뺀 주소는 상태 `stats.excluded`에 가린 모양(`c***@matchesplan.com`)으로 남고 회신 탭 띠에 보인다: "우리 주소에서 뺀 주소 N개 (메일함 쪽 주소) — 이 주소로 온 회신은 읽지 않습니다. 샌드비 발신 주소가 맞으면 REPLY_SHARED_DOMAIN_ADDRESSES에 적어 주세요"
- 비교 형태 `normalizeReplyAddress` (m9 — 기존 `normalizeSenderAddress`와 다른 이름): 앞뒤 공백 문자 제거(`EMAIL_TRIM_CHARS`) + 소문자 + 로컬 부분의 `+태그` 제거 (`cs+x@d` = `cs@d`. Google은 + 주소를 같은 메일함으로 받는다)
- 주소 → 조직 지도: 같은 주소가 여러 조직 프로필에 있으면 주소 하나에 조직 여럿
- 도메인 모음: 남은 주소들의 도메인. **메일함 쪽 도메인은 늘 빠진다** (`REPLY_SHARED_DOMAIN_ADDRESSES`가 그 도메인 위에 있어도 도메인으로는 넣지 않는다 — 그 주소 자체만 맞춘다)

### 4-2. 세 단계로 읽는다

1. **번호만**: history(`messageAdded`) 또는 목록 조회로 새 메일 번호와 라벨만 받는다. `SENT`·`DRAFT`·`CHAT` 라벨은 여기서 버린다
2. **1단계 머리글 (모든 새 메일)**: 받는 사람과 스레드 머리글만, snippet 없이

   ```
   GET /gmail/v1/users/me/messages/{id}?format=metadata
       &metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Delivered-To
       &metadataHeaders=X-Original-To&metadataHeaders=X-Gm-Original-To
       &metadataHeaders=In-Reply-To&metadataHeaders=References
       &fields=id,threadId,labelIds,internalDate,sizeEstimate,payload/headers
   ```

   - 남의 메일의 **보낸 사람·제목·본문 앞부분조차 받지 않는다.** PRD 지시(머리글에 From·Subject 포함)보다 좁혔다. From·Subject는 2단계에서 우리 것만 받는다
   - `fields`에 `snippet`을 넣지 않는다 — metadata 응답에도 본문 앞부분이 들어 있어서다
3. **판정**
   - 머리글 값은 `normalizeReplyAddress`로 맞춘 뒤 4-1 주소 모음과만 비교한다. **메일함 주소와 메일함 쪽 도메인 위의 값은 판정에 쓰지 않는다** — 특히 `Delivered-To`·`X-Original-To`는 메일함의 모든 메일에서 메일함 주소라 그 값으로는 아무것도 우리 것이 되지 않는다 (B1)
   - **주소 일치** (`ours_reason='address'`): To·Cc·Delivered-To·X-Original-To·X-Gm-Original-To 중 하나가 우리 발신 주소와 같다 → 우리 것
   - **도메인 + 스레드** (`ours_reason='domain_thread'`): 주소는 다르지만 도메인이 4-1 도메인 모음에 있고(메일함 쪽 도메인은 들어 있지 않다), **In-Reply-To·References가 우리 발송 기록에 이어진다**(6-1과 같은 조회) → 우리 것. 이어지지 않으면 남의 것
   - 그 밖은 남의 것 → **2단계로 가지 않는다.** 저장하지 않는다. 회차 숫자 `notOurs`에 1을 더할 뿐이다 (메시지 번호·해시도 남기지 않는다. history 커서가 다시 읽지 않게 해 주므로 필요 없다)
   - 보낸 사람 확인은 2단계 뒤: From이 `REPLY_MAILBOX`이거나 우리 발신 주소면(대표님 시험 메일·자기에게 보낸 메일) 버린다
   - **1.5단계 (시험 서버만, M1)**: 3절 "운영 서버 판정"이 시험 서버이면, 우리 것으로 판정된 메일에 한해 `format=metadata&metadataHeaders=From&fields=id,payload/headers`로 From만 읽는다. `REPLY_ALLOWED_FROM`에 없으면 버린다 (`notAllowedFrom` 1 더함, 저장 0, 2단계 0). 값이 없으면 이 단계에서 모두 버린다. 남의 메일에는 이 요청도 하지 않는다
4. **2단계 (우리 것만)**: `format=full`로 머리글 전부와 본문. `sizeEstimate`가 5MB를 넘으면 `format=metadata`(머리글 전부)만 받고 발췌는 비운다. 첨부 파일은 받지 않는다 (`attachmentId`를 따라가지 않는다)
   - **예외 하나 — 반송·시스템 안내의 보고 부분 (M9)**: 최상위가 `multipart/report`이거나 From 로컬 부분이 `mailer-daemon`·`postmaster`·`mail-daemon`인 메일에서, MIME 형식이 `message/delivery-status`·`message/rfc822`·`text/rfc822-headers`·`message/feedback-report`인 부분이 `body.data` 없이 `body.attachmentId`로만 오고 `body.size`가 64KB 이하면 **그 부분만** `messages.attachments.get`으로 받는다. 그 밖의 첨부(파일·이미지 등)는 어떤 경우에도 받지 않는다. `message/rfc822`는 머리글(첫 빈 줄 앞)만 쓰고 본문은 바로 버린다
5. **저장 범위**
   - 저장: 이어진 회신·반송 전부, 주소 일치이고 못 이은 메일(미분류), `internal`·`system`(효과 없음, 5절)
   - **저장 안 함**: 스팸 라벨이면서 못 이은 메일 (주소 일치라도 — `cs@`로 오는 스팸), 2단계에서 보낸 사람이 우리 자신인 메일, 1.5단계에서 버린 메일, 이어진 발송의 워크스페이스가 `REPLY_WORKSPACE_IDS` 밖인 메일 (`outOfScope` 건수만, m8)
   - 저장하는 칸은 9절 표의 칸뿐이다. 본문 원문·첨부·다른 받는 사람(Cc 목록)·인용된 앞 메일은 저장하지 않는다. 발췌는 인용을 뗀 앞 500자 (PRD 11절 "회신은 앞 500자와 분류만 저장하고 원문은 구글 메일함에 둔다")
6. **로그**: 회차 요약 숫자만 (`[reply-sync] listed=… ours=… notOurs=… stored=…`). 주소는 가리고, 제목·본문·발췌는 어떤 경우에도 로그에 찍지 않는다. 오류 객체를 통째로 찍지 않는다 (쿼리 매개변수에 발췌가 섞인다 — `describeDeepAlertError`와 같은 방식)

## 5. 결정 ④ 분류 (규칙, AI 없음)

순서대로 처음 맞는 것. 순수 함수 `classifyReply(headers, parsedBody, ctx)` (`ctx` = 조직 사용자 주소 모음·메일함 쪽 도메인). **애매하면 사람 회신으로 둔다** — 잘못 멈추는 손해(담당이 이어받으면 끝)가 회신을 놓치고 후속을 계속 보내는 손해보다 작다 (M5).

| 분류 `kind` | 판정 |
|---|---|
| `bounce` (반송) | (가) 최상위 `Content-Type: multipart/report; report-type=delivery-status`, 또는 (나) From 로컬 부분이 `mailer-daemon`·`postmaster`·`mail-daemon`(대소문자 무시), 또는 (다) `Return-Path: <>`**이면서** 제목이 `Undeliver`·`Delivery Status Notification`·`Mail delivery failed`·`Returned mail`·`failure notice`·`메일 (발송|전송|전달) 실패`·`반송`. **제목 말만으로는 반송이 아니다** (M5 — "Re: 제품 반송 문의"는 사람 회신) |
| `system` (시스템 안내) | 최상위가 `multipart/report`인데 `report-type`이 `delivery-status`가 아님 — 읽음 확인 `disposition-notification`, 스팸 신고 `feedback-report`(ARF) 등 (m7). `feedback-report`는 SND에 스팸 신고 신호로 넘긴다 (7-3) |
| `internal` (내부 직원) | 보낸 사람이 그 조직 사용자(`users.org_id` = 조직, `lower(email)` 같음)이거나 메일함 쪽 도메인(4-1) 위의 주소 (m6 — 대표님이 `ceo@`에서 고객에게 답하며 직원을 참조에 넣으면 직원의 "전체 답장"에 `cs@<도메인>`이 남는다). 저장만, 효과·카드·막기 없음 |
| `auto_reply` (자동응답) | 자동 머리글: `Auto-Submitted`가 있고 값이 `no`가 아님 · `X-Autoreply`·`X-Autorespond` 있음 · `Precedence: auto_reply`·`bulk`·`junk`·`list` · `Return-Path: <>`. 또는 자동응답 제목 `^(자동\s*(회신|응답)|\[?자동응답\]?|부재\s*중|Automatic reply|Auto(matic)?[- ]?(reply|response)|Out of (the )?office|OOO\b)`. **본문 글만으로는 자동응답이 아니다** (M5 — "출장 중이라 복귀 후 연락드리겠습니다"는 사람 답장). 예전의 본문 규칙(부재·휴가·출장 + 복귀)은 쓰지 않는다 |
| `human` (사람 회신) | 위에 안 걸림 |
| `unknown` | 머리글·본문을 읽다 오류가 났거나, 메일 하나의 DB 데이터 오류로 최소 줄만 남겼다 (`process_error`, 7-1). 효과 없음 |

**반송 자세히** (`parseDeliveryStatus`)
- `message/delivery-status` 부분(본문이든 4-2의 첨부 예외로 받은 것이든)에서 수신자 묶음마다 `Original-Recipient`·`Final-Recipient`(`rfc822;` 뗌), `Action`, `Status`, `Diagnostic-Code`(300자)를 읽는다. 여러 수신자면 모두 SND에 넘긴다 (샌드비는 1통 1수신자라 보통 하나)
- `bounce_type`은 **SND의 순수 함수 `classifyDsn(action, status)` 하나로** 정한다 (B2. `src/lib/email-status-sync-rules.ts`, 이 문서 규칙 파일은 import만 — 두 모듈이 다른 기준을 쓰지 않게)
  - `Action: failed` + `Status 5.x.x` (또는 Action 없이 5.x.x) → `hard` (주소 없음 등 영구 실패)
  - `Action: failed` + `4.x.x` → `expired` (재시도 끝 — 배달은 실패했지만 주소가 없다는 뜻은 아니다. 예 4.4.7)
  - `Action: delayed`, 또는 그 밖의 4.x.x → `soft` (아직 시도 중)
  - delivery-status 부분이 없음(네이버·다음식 안내 메일 등) → `unknown`
- 원본 머리글: `text/rfc822-headers` 부분 또는 `message/rfc822` 부분의 머리글에서 `Message-ID`를 읽어 6-1 짝짓기에 쓴다
- `contact_email` = 반송된 받는 주소 (Final → Original 순서. SND가 발송 받는 주소와 비교하는 값과 같다)
- 반송은 발췌를 저장하지 않는다 (DSN 본문은 우리 원래 메일의 사본이다). `dsn_status`·`dsn_diagnostic`만

**수신거부 말 표시** (`unsubscribe_hint`, 표시만): 사람 회신의 제목·발췌에 `수신\s*거부`·`그만\s*(보내|받)`·`보내지\s*(마|말)`·`메일\s*사절`·`빼\s*주(세요|십시오)`·`unsubscribe`·`remove me`·`stop (sending|emailing)` → `true`. 자동으로 수신거부 목록에 넣지 않는다 (AI 분류 RPL-2 뒤). 대신 카드에 경고 줄을 넣고, 보내기 직전 막기는 기한 없이 막는다 (7-4)
- **검사 전에 우리 꼬리말을 지운다 (m4)**: 인용을 뗀 글에서 우리 꼬리말 문장(`이 메일을 더 이상 받고 싶지 않으시면`, `수신거부를 눌러주세요`)이 든 줄과, 수신거부 경로(`UNSUBSCRIBE_PATH`·`/api/email/unsubscribe`)가 든 URL 줄을 지운 뒤 검사한다. 인용 떼기가 실패해 우리 글이 남아도 거짓 경고·기한 없는 막기가 붙지 않게

**본문에서 발췌 만들기** (`extractBodies`, `stripQuoted`, `makeExcerpt`)
- `text/plain`(첨부가 아닌 첫 부분) → 없으면 `text/html`에서 태그·스타일·스크립트를 걷어낸 글
- **HTML 인용 떼기 (m4)**: 태그를 걷기 **전에** 처음 나오는 `<blockquote`, `class="gmail_quote"`(`gmail_quote_container` 포함), `id="divRplyFwdMsg"`(Outlook), `id="appendonsend"`, `class="yahoo_quoted"` 요소와 **그 뒤 전부**를 버린다
- `body.data`는 base64url이다. 문자 집합은 `Content-Type`의 `charset`으로 `TextDecoder`에 넘긴다 (`ks_c_5601-1987`·`cp949` → `euc-kr`. 모르는 값은 utf-8). 머리글의 RFC 2047 인코딩(`=?UTF-8?B?…?=`, `=?EUC-KR?Q?…?=`)도 푼다
- 인용 떼기: `>`로 시작하는 줄 제거. 다음 줄부터 버림 — `-----Original Message-----`·`----- 원본 메시지 -----`·`-------- Forwarded message --------`·`---------- 전달된 메시지 ----------`·`On … wrote:`(두 줄에 걸쳐도)·`2026. 10. 10. 오후 3:12, … 작성:`·`2026년 10월 10일 (토) … 님이 작성:`·`From:`/`보낸 사람:` 다음 4줄 안에 `Sent:`/`Date:`/`보낸 날짜:`/`받는 사람:`이 있는 머리 블록
- 공백 정리 뒤 저장 500자, 카드 300자. 사용자 값의 `<` `>`는 카드에서 `‹` `›`로 바꾼다 (깊이 알림과 같음)

## 6. 결정 ⑤ 발송 기록과 짝짓기

### 6-1. 스레드 머리글 (가장 정확)

- In-Reply-To·References의 `<로컬@호스트>`마다 후보 요청 번호를 만든다: 로컬 부분 전체, 그리고 앞머리가 `^\d{14}[A-Za-z0-9]{8}`이면 그 22자 (NHN 요청 번호 모양)
- 반송은 원본 머리글의 Message-ID로 같은 일을 하고, 찾은 발송 id를 SND `recordBounceSignal`에 `threadLogId`로 넘긴다 (7-3)
- 조회 (회차에 모은 후보를 **배열 하나로 한 번**):
  ```sql
  SELECT l.id, l.org_id, r.id AS record_id, l.partition_id, p.workspace_id, l.recipient_email, l.sender_email,
         l.sender_profile_id, l.subject, l.sent_at, l.status, l.trigger_type, l.template_link_id,
         l.auto_personalized_link_id, l.parent_log_id, l.request_id
  FROM email_send_logs l
  LEFT JOIN records r    ON r.id = l.record_id AND r.org_id = l.org_id   -- 지워진 레코드면 NULL (M6)
  LEFT JOIN partitions p ON p.id = l.partition_id
  WHERE l.request_id = ANY($1::text[]) AND l.org_id = ANY($2::uuid[])
  ```
  `(request_id)` 색인(DESIGN-SND 8-3)을 쓴다
- **`record_id`는 레코드가 지금 있을 때만 넣는다** (M6). 없으면 `email_replies.record_id = NULL`, 레코드 사건을 넣지 않는다. 짝·멈춤·막기는 그대로 한다 (발송 기록과 받는 주소로 하므로)
- 이어진 발송의 조직이 그 메일이 온 우리 주소의 조직(4-1 지도)에 없으면 이어 붙이지 않는다 (`ambiguous`)
- 이어진 발송의 워크스페이스가 `REPLY_WORKSPACE_IDS` 밖이면 저장하지 않는다 (`outOfScope`, m8)
- 보낸 사람이 발송 받는 사람과 달라도 잇는다 (전달받은 동료의 답장, 같은 회사 다른 주소). 이때 `contact_email`은 회신 보낸 사람이고, **`matched_recipient`에 이어진 발송의 받는 주소(원래 받은 사람)를 따로 남긴다** (M3). 멈춤(7-2)과 막기(7-4)는 두 주소 모두에 건다 — `info@회사`로 보낸 메일에 `kim@회사`가 답하면 `info@`의 후속도 멈춘다
- **Message-ID를 새로 저장하지 않는다.** NHN 문서상 Message-ID 앞부분이 요청 번호라 이미 있는 `request_id`로 잇는다. 이 가정은 첫 실제 회신으로 확인한다 (17절 확인 1). 가정이 틀리면 처음에는 모든 회신이 6-2로 가므로, 6-2의 워크스페이스 갈림 규칙(M4)이 잘못 붙는 일을 막는다. 틀리면 다음 판에서 상태 동기화가 `resultId`를 `email_send_logs.message_id`로 저장하게 한다 (발신 건강의 NHN 상태 동기화가 같은 조회를 하므로 거기에 붙인다). 그동안은 6-2가 잇는다. `match_method`로 비율을 잰다

### 6-2. 대체 짝짓기 (스레드 머리글로 못 이을 때)

조건 (모두):
- 회신 보낸 사람(정규화) = `lower(btrim(recipient_email))`
- 회신이 온 우리 주소 = 그 발송의 `sender_email` (NULL이면 `sender_profile_id` 프로필의 지금 `from_email`). 둘 다 없는 아주 예전 기록이면 이 조건 없이 보고 `match_method='fallback_from_only'`
- `sent_at`이 회신 도착 전 60일 안 (반송은 이 짝짓기를 쓰지 않는다 — 아래)
- 조직 = 그 우리 주소의 조직

고르기 (제목 맞추기 = 양쪽 다 `Re:`·`RE:`·`Fw:`·`Fwd:`·`회신:`·`답장:`·`전달:`·`[외부]`·`[EXTERNAL]`·`(광고)` 앞머리를 되풀이해 떼고 공백을 하나로):
1. 후보가 **한 워크스페이스**에만 있으면: 제목이 같은 것이 있으면 그중 가장 최근(`fallback_subject`), 없으면 가장 최근(`fallback_latest`)
2. 후보가 **여러 워크스페이스**에 걸치면 (M4 — 같은 기본 주소를 여러 사업이 쓴다. 템플릿 규칙은 늘 조직 기본 주소로 나가고, 같은 사람에게 가는 두 번째 접촉은 대부분 다른 사업의 첫 메일이다): 제목이 같은 후보가 **한 워크스페이스에만** 있으면 그 워크스페이스에서 1번처럼 고른다. 아니면 `match_status='ambiguous'`, `match_method='fallback_multi_ws'` — 효과·카드 없이 관리자가 회신 탭에서 본다. "가장 최근"으로 엉뚱한 사업에 붙여 그 사업만 멈추는 일을 하지 않는다
- 반송은 이 대체 짝짓기를 쓰지 않는다. Message-ID 짝이 없으면 SND `recordBounceSignal`이 Final-Recipient·받은 우리 주소·7일로 잇는다 (DESIGN-SND 4-4, B2)

조회 (회차에 모은 주소를 배열 하나로 한 번):
```sql
SELECT l.…, r.id AS record_id, p.workspace_id
FROM email_send_logs l
LEFT JOIN records r    ON r.id = l.record_id AND r.org_id = l.org_id
LEFT JOIN partitions p ON p.id = l.partition_id
WHERE l.org_id = ANY($orgs) AND l.sent_at >= $since
  AND lower(btrim(l.recipient_email, $trim)) = ANY($emails)
ORDER BY l.sent_at DESC
```

- **`email_send_logs`에 이 문서만의 색인을 만들지 않는다.** `(org_id, sent_at)` 색인(DESIGN-SND 8-3, 부팅 뒤 CONCURRENTLY — 두 문서 같은 결론)으로 60일 범위를 좁힌 뒤 거른다. 한 회차에 우리 것이 있을 때만 표를 많아야 두 번(6-1, 6-2) 읽는다. 우리 것이 없는 회차(대부분)는 0번이다. 색인이 생기기 전에는 느리게 돈다 — 실데이터 사본에서 `EXPLAIN ANALYZE`로 시간을 잰다 (15-4)

### 6-3. 못 이음·애매함

- `match_status='unmatched'`: 레코드·발송 없음. 효과 없음. 회신 탭 "미분류"에 남는다
  - 사업 추정: 그 우리 주소로 최근 60일 보낸 발송의 워크스페이스가 **하나뿐**이면 `workspace_id`에 넣고 `workspace_guessed=true`. 그 사업에 "못 이은 회신" 카드를 보낸다 (8절). 둘 이상이면 비운다
- `ambiguous`: 허용 조직 둘 이상의 기록이 맞거나, 조직이 어긋나거나, 대체 짝짓기 후보가 여러 워크스페이스에 걸쳐 제목으로 하나가 정해지지 않음(M4). 효과·알림 없음. 관리자만 본다. 옆 창에 후보 발송(사업·규칙·보낸 때)을 보여 주고, 관리자가 필요하면 후속 큐에서 손으로 멈춘다 (회신을 손으로 발송에 잇는 버튼은 다음 판)

### 6-4. 규칙·단계 찾기

이어진 발송에서 `parent_log_id`를 거슬러 첫 메일까지 간다 (최대 10번, 회차 안 이어진 발송을 모아 `WITH RECURSIVE` 한 문장).
- `root_log_id` = 첫 메일, `step_index` = 거슬러 간 횟수 (0 = 첫 메일)
- `rule_kind`·`rule_id` = 첫 메일의 `auto_personalized_link_id`(ai) → `template_link_id`(template) → 둘 다 없으면 `manual`
- 카드 단계 글자: `첫 메일` / `{n}번째 후속 (첫 메일 +{d}일)` (d = 두 발송 시각 차이 반올림)

## 7. 결정 ⑥ 효과 (on일 때, 한 번만)

### 7-1. 한 번만 하기

- 저장: `INSERT … ON CONFLICT DO NOTHING RETURNING id` — 유일 키 `(mailbox, gmail_message_id)`와 `(org_id, rfc_message_id)`. 이미 있으면 그 메일은 끝 (두 회차가 겹치거나 history가 같은 번호를 두 번 줘도 줄 1개)
- **메일 하나 격리 (M6)**: 메일마다 저장점(`SAVEPOINT`) 안에서 저장·효과를 한다
  - 데이터 오류(SQLSTATE `22xxx`·`23xxx` — FK·NOT NULL·길이·형식)가 나면 저장점으로 되돌리고, 최소 줄(`kind='unknown'`, `process_error`=SQLSTATE와 제약 이름만, 제목·발췌 없음, 효과 없음)을 남긴 뒤 **다음 메일로 간다. 커서는 넘어간다.** 그 최소 줄도 못 남기면 건수(`dbErrors`)만 세고 넘어간다
  - 연결·자원 오류(`08xxx`·`53xxx`·`57xxx`, 시간 초과)만 회차를 멈추고 커서를 그 묶음 앞에 둔다 (다음 회차가 다시 — 유일 키로 안전)
  - 그래서 메일 하나(예: 지워진 레코드에 이어진 회신)가 회신 읽기 전체를 영구히 막지 못한다
- 효과는 트랜잭션 하나: 먼저 `UPDATE email_replies SET effects_applied_at=now(), effects_applied_kind=kind WHERE id=$1 AND effects_applied_at IS NULL RETURNING id`로 차지한 뒤에만 아래를 한다. 결과 숫자는 `effects` jsonb에 남긴다 `{followupsCancelled, automationCancelled, sendQueueSkipped, bounceSignals, logMarkedFailed, recordEventId}`
  - **알림 줄도 같은 트랜잭션에서 만든다 (m1)**: 카드 대상이면(8절) `alert_status='pending'`, `alert_next_at=now()`, `alert_message`(멈춘 수 포함)를 함께 쓴다. 효과가 되돌려지면 알림 줄도 함께 없어지고, 다음 회차 밀린 효과가 둘 다 다시 만든다
- dry_run: 같은 조건의 `SELECT count(*)`로 숫자만 `effects`에 남기고 `effects_applied_at`은 비운다
- 밀린 효과: on 회차 첫머리에 `effects_applied_at IS NULL AND match_status='matched' AND kind IN ('human','bounce') AND received_at > now()-14일`을 50줄씩 적용한다. 반송 줄은 SND `applyPendingBounceSignals`로 넘긴다 (7-3)
  - 알림: `detected_mode='on'`이고 도착 24시간 안인 줄(on으로 처음 저장됐는데 효과 단계에서 일시 오류가 난 줄)은 카드를 만든다 (m1). `detected_mode='dry_run'`으로 저장된 줄은 카드 없음 (R31)
- **분류를 고쳤을 때 (M5, 10-3 PATCH)**: 효과는 분류별로 기록된다(`effects_applied_kind`). 담당이 `kind`를 `human`으로 바꿨고 `effects_applied_kind`가 `human`이 아니면(효과가 없었거나 반송·자동응답으로 처리됐으면) 그 자리에서 7-2를 적용하고 `effects_applied_kind='human'`으로 바꾼다. 멈춤은 `pending`·`held` 줄만 바꾸므로 두 번 해도 안전하고, 레코드 사건은 `meta.replyId`가 이미 있으면 넣지 않는다. 사람에서 다른 것으로 바꾸면 막기에서만 빠진다 (멈춘 줄은 그대로)

### 7-2. 사람 회신 (`kind='human'`, 이어짐)

1. **레코드 사건** (레코드가 있을 때만, M6): `record_events(type='reply', label='회신', occurred_at=received_at, meta={replyId, sendLogId, ruleKind, ruleId, stepIndex})`. 발췌는 넣지 않는다 (지울 곳을 한 곳으로). 여정 화면 이름은 `businessChannel`에 `reply → 회신`을 더한다 (단계 사건 아님)
2. **멈춤** — 같은 조직·**같은 사업(워크스페이스)**·같은 주소의 **대기 중(`pending`)과 명단 보류 중(`held`, DESIGN-SND 6-2)** 자동 메일. 다른 사업은 멈추지 않는다 (방침 "사업이 달라도 재접촉은 막지 않는다", PRD "같은 회사 다른 사람" 선택 항목은 처음 값 끔이라 하지 않음)
   - **주소는 둘이다 (M3)**: 회신 보낸 사람(`contact_email`)과 원래 받은 사람(`matched_recipient`). 둘이 다르면(동료 답장·같은 회사 다른 주소) 둘 다 멈춘다. `$emails`에는 두 주소의 소문자 값과 `+태그`를 뗀 값을 함께 넣는다
   - 후속 (AI·템플릿 모두):
     ```sql
     UPDATE email_followup_queue q SET status='cancelled', processed_at=now(), stop_reason='replied'
     FROM email_send_logs l JOIN partitions p ON p.id = l.partition_id
     WHERE q.status IN ('pending','held') AND q.org_id=$org AND l.id=q.parent_log_id AND l.org_id=$org
       AND p.workspace_id=$ws AND lower(btrim(l.recipient_email, $trim)) = ANY($emails)
     RETURNING q.id
     ```
   - 템플릿 대기열: 그 레코드(있을 때)의 `kind IN ('first','first_bulk','repeat') AND status IN ('pending','held')` → `cancelled`, `stop_reason='replied'`
   - 발송 대기열: 그 레코드(있을 때)의 `status IN ('pending','held')`(우선순위 둘 다) → `skipped`, `last_error='회신으로 멈춤 (회신 #{id})'`, `processed_at=now()`, `locked_at=NULL`. 표에 없는 새 상태를 만들지 않는다 — 화면·통계가 모르는 값이 생기지 않게
   - `held`를 함께 바꾸는 까닭 (SND-01): 보류가 풀리면 `held` 줄이 `pending`으로 돌아가 나간다. 지금 닫아 두면 풀려도 나가지 않는다. 그래도 남는 줄은 7-4 막기가 잡는다
   - `processing`인 줄은 건드리지 않는다 (워커가 쥐고 있다). 그 줄은 7-4 막기에서 멈춘다
   - **멈춘 줄은 저절로 살아나지 않는다** (SEQ-1 수용 기준 2). 담당이 회신을 "자동 메일 다시 허용"으로 바꿔도 앞으로의 막기만 풀린다
3. **알림**: 8절
4. **알림톡은 멈추지 않는다** (결정): 다른 채널이고 상담 일정 안내 같은 거래성 알림이 많다. 대기열 열쇠도 다르다. 필요하면 담당이 알림톡 화면에서 취소한다

### 7-3. 반송·스팸 신고 — 발송 기록은 SND 한 곳이 쓴다 (B2)

두 문서의 약속 (DESIGN-SND 4절과 같은 내용):

| 하는 일 | 맡는 쪽 |
|---|---|
| 반송 알아보기(5절), `message/delivery-status` 풀기, 원본 Message-ID로 발송 찾기(6-1), 장부 줄(`email_replies`, `kind='bounce'`) | RPL |
| 대체 짝짓기(Final-Recipient·받은 우리 주소·7일), hard/soft 기준(`classifyDsn`), 받는 사람 같음 확인, `email_send_logs` 쓰기, 실패 한 번만 세기, 중복 막기, 신호 표 `email_bounce_signals` | SND `recordBounceSignal()` |
| 반송된 주소로 자동 메일 안 보내기 | 7-4 막기가 `email_bounce_signals`를 읽는다 (대기열을 미리 고치지 않는다) |

- **RPL은 `email_send_logs`를 직접 고치지 않는다.** 반송 안내 한 통마다 `recordBounceSignal()`을 한 번 부른다:
  - 넘기는 것: `orgIds`(받은 우리 주소의 조직들, 4-1 지도), `threadLogId`(원본 Message-ID로 6-1처럼 찾은 발송 id, 없으면 null), `toAddress`(받은 우리 주소), `gmailMessageId`, `receivedAt`, 받는 사람 묶음(`finalRecipient`·`originalRecipient`·`action`·`status`·`diagnostic`), `signal: 'dsn'`, `apply`(RPL이 `on`이면 true)
  - 받는 것: 받는 사람마다 `{ signalId, sendLogId, recordId, kind, recipientMatch, applied, counted }`
  - Message-ID 짝이 없으면 SND가 Final-Recipient(없으면 Original)·받은 우리 주소·7일로 잇는다. RPL의 6-2(60일 대체 짝짓기)는 반송에 쓰지 않는다
  - **받는 사람이 같을 때만 실패로 (M3)**: SND는 Final(없으면 Original)-Recipient가 이어진 발송의 받는 주소와 같을 때만 발송을 실패로 바꾼다. 다르면(별칭 전개·전달받은 주소에서 난 반송) 신호 줄만 남긴다(`recipient_match='different'`) — 잘 받은 원래 발송을 실패로 바꿔 실패율을 올리지 않게
  - 판정은 늘 `delivery_fail_source='dsn'`으로 한다. `result_code`는 표시용으로 `DSN:5.1.1` 모양이고, **어느 문서도 `result_code LIKE 'DSN:%'`로 판정하지 않는다**
  - NHN 동기화와의 순서(반송 먼저·SST2 먼저·처음 채우기)는 SND가 맞춘다 (DESIGN-SND 3-8·4-5)
  - `dry_run`이면 `apply=false`: SND는 신호 줄만 남기고(`applied_at` NULL) 발송 기록은 그대로 둔다. `on`이 되면 밀린 효과(7-1)가 SND `applyPendingBounceSignals(orgIds, 14일)`를 부른다
  - SND 함수가 던지는 DB 오류는 7-1의 메일 하나 격리를 따른다
- RPL 장부 줄: `email_replies`에 `kind='bounce'`, `bounce_type`(SND 결과의 kind), `dsn_status`, `dsn_diagnostic`, `contact_email`(Final → Original), `send_log_id`(SND가 이은 발송), `matched_recipient`. 발췌 없음. 회신 탭에서 관리자가 보고, 사람 회신을 반송으로 잘못 나눴으면 고친다 (M5)
- RPL이 하는 효과(on): SND 결과 중 `kind='hard'`·`recipientMatch='same'`·이번에 처음 적용된 신호마다 레코드 사건 `type='email_bounce'`, `label='반송'`(레코드가 있을 때만), 여정 이름 `email_bounce → 반송`. 숫자는 `effects`에 `{bounceSignals, logMarkedFailed}`
- **반송 뒤 멈춤은 보내기 직전 막기 하나로 한다**: 대기열 줄을 미리 고치지 않는다. 7-4가 `email_bounce_signals`를 읽어, 그 주소로 가려던 자동 메일을 보낼 차례에 `cancelled`(`stop_reason='bounced'`)로 닫는다 (SEQ-1 "첫 메일 실패"). 주소가 없는 것은 사업과 상관없으므로 반송 막기는 **조직 단위**다 (SND-2 조직 막기 목록의 앞선 몫)
- `expired`(재시도 끝): SND가 실패로 세지만 막지는 않는다. `soft`·`unknown`: 신호 줄만
- **스팸 신고** (`system` 중 `feedback-report`, m7): 원본 Message-ID로 이은 발송과 함께 `recordBounceSignal({ signal: 'complaint', … })`. 발송 기록은 바꾸지 않고, SND 매일 보고에 "스팸 신고 N통"으로 나온다. 카드·멈춤 없음 (1판)

### 7-4. 보내기 직전 막기 (경쟁 상태와 새로 생긴 줄을 위해)

대기열 멈춤은 그때 있던 줄만 멈춘다. 처리 중이던 줄, 나중에 생긴 줄(다른 파티션의 같은 사람, 반복 재등록, `enqueueDeferredSend`가 되살린 줄)도 막으려면 보내는 자리에서 한 번 더 봐야 한다.

- `src/lib/email-reply-guard.ts`: `findReplyStop(orgId, workspaceId, email, now)` → `{ replyId?, signalId?, reason: 'replied'|'bounced' } | null`
  - `REPLY_SYNC_MODE`가 `on`이 아니면 늘 null (dry_run에서는 고객 메일이 바뀌지 않는다)
  - 사람 회신 (사업 단위): `email_replies`에서 `workspace_id=$ws AND (contact_email=$정규화 OR matched_recipient=$정규화) AND stop_automation AND kind='human' AND (unsubscribe_hint OR received_at > now-90일)`. 색인 `er_stop_idx`·`er_stop_recipient_idx` (M3 — 원래 받은 사람도 막는다)
  - 반송 (조직 단위, B2): `email_bounce_signals`에서 `org_id=$org AND recipient_email = ANY($소문자 값, $정규화 값) AND kind='hard' AND recipient_match='same' AND applied_at IS NOT NULL AND received_at > now-90일`. 색인 `ebs_org_recipient_idx` (DESIGN-SND 8-1)
  - 수신거부 말이 있는 회신은 기한 없이 막는다
  - 둘 다 맞으면 회신을 먼저 돌려준다. 42P01(표 없음)이면 null — 발송을 막지 않는다
- 넣는 자리 (모두 수신거부 확인 **바로 뒤**, AI 호출·자리 잡기 전. 명단 보류 확인(DESIGN-SND 6-2)과는 보류 확인 → 회신 막기 순서)

  | 경로 | 자리 | 막혔을 때 |
  |---|---|---|
  | 템플릿 후속 | `email-followup.ts:528` 뒤 | 처리기가 `{ kind:'stopped', reason }`을 돌려주고 `processFollowupItem`이 `cancelled` + `stop_reason` (지금 `FollowupHandlerResult`(`:54`)에 종류를 더함) |
  | AI 후속 | `email-followup.ts:675` 뒤 | 같음 |
  | 템플릿 자동·반복·미룬 첫 메일 | `sendEmailSingle` `email-automation.ts:131` 뒤 | `{ success:false, stopped: reason }` → `sendTemplateFirst`가 새 종류 `{ kind:'stopped', reason }`을 돌려준다 (`TemplateFirstOutcome`에 더함 — 지금은 success:false를 `failed`로 바꾼다, `:276-278`, m5) → 반복 대기열의 첫 메일 줄(`first`·`first_bulk`)·반복 줄 모두 `cancelled`+`stop_reason` |
  | AI 첫 메일 | `auto-personalized-email.ts:181` 뒤 | outcome `{ kind:'skipped', reason:'replied' }` (`'bounced'`) |
  | 발송 대기열 미리 판정 | `walkQueueRow` `email-send-queue-rules.ts:562` 뒤 | 같은 순서·같은 결과. `QueueWalkLookups.isReplyStopped(email)`을 더하고 워커가 묶음 주소를 한 번에 읽는다 (`loadReplyStops(workspaceId, emails)`) — 두 판정이 어긋나면 안 된다 (그 파일 주석의 원칙) |

- **수동 발송은 막지 않는다** — 사람이 고른 일이다
- 템플릿 대기열을 처리하는 `processRepeatItem`의 **모든 마지막 update**에 `AND status='pending'` 조건을 더한다 (m5): 첫 메일 줄 `completed`(`email-automation.ts:590-593`), 규칙 꺼짐 `cancelled`(`:599-602`), 중단 조건 `completed`(`:616-619`), 반복 줄(`:647-658`). 처리하는 사이 회신으로 `cancelled`가 되거나 명단 보류로 `held`가 된 줄을 덮지 않게 (`processing` 상태가 없는 표라 이 조건이 유일한 보호다)
- **결정 (바꿀 수 있음)**: 문의로 생긴 첫 메일(`kind='first'`, 발송 대기열 우선순위 1, 즉시 경로의 문의 목적)도 멈추고 막는다. PRD 스킬 규칙 "답장하면 자동 발송을 멈추고 사람이 이어받는다"를 그대로 따랐다. 문의 안내만은 보내야 하면 `findReplyStop`에 목적(`purpose === 'inbound'`)을 넘겨 건너뛰고, 7-2의 `first`·우선순위 1 줄을 멈춤에서 빼면 된다 (두 곳)

## 8. 결정 ⑦ 알림 카드 (구글 챗)

**보낼 때**: `REPLY_ALERT_MODE=live`(시험 서버면 3절 제한 안에서만), 사람 회신, (이어짐이거나 6-3 사업 추정), 그 워크스페이스가 허용 목록에 있음, 도착이 24시간 안. 웹훅 = `DEEP_ALERT_WEBHOOK_URL_<워크스페이스>` → 없으면 `DEEP_ALERT_WEBHOOK_URL` (`resolveAlertConfig`를 회신 허용 목록으로 불러 재사용). 자동응답·반송·시스템 안내·내부 직원·애매함은 카드 없음. 알림 줄은 효과 차지와 같은 트랜잭션에서 만든다 (7-1, m1).

- 24시간 넘은 회신(처음 거슬러 읽기·밀린 효과)은 `alert_status='skipped'`, `alert_last_error='오래된 회신 (24시간 지남) — 알림 안 함'`. 단 **마지막 성공 뒤에 도착한 회신**(Gmail 장애로 늦게 읽음)은 오래되어도 카드를 보낸다 (구글 챗 QA RC-2)
- 카드 보내기는 Gmail 읽기와 떼어 둔다 — Gmail 오류(토큰 끊김 등)로 회차가 실패해도 이미 만든 카드는 보낸다 (RC-1). 읽기는 회차 예산에서 보내기 몫 60초를 늘 남기고 멈춘다 (RC-14)
- 근무시간 밖에도 바로 보낸다 — 회신은 드물고 당일 응대가 목표다 (PRD 3-2). 깊이 알림처럼 미루지 않는다. 대신 첫 줄 기한을 근무시간 규칙으로 쓴다
- 같은 사람이 두 번 회신하면 두 번 보낸다 (메일마다 새 내용이다)

**카드 글자** (`buildReplyAlertMessage`, 3,800자에서 자름)

```
⏰ *답장 기한: {기한}*            ← 근무시간(평일 09~18 KST) 안: "오늘 안 · 10/12(월) 18:00까지", 밖: "출근하면 먼저 · 10/12(월) 12:00까지".
                                   보낼 때 그 순간 기준으로 다시 쓴다 (늦게 나간 카드에 지난 기한이 가지 않게, RC-12)
👤 {이름} · {전화} · {메일} · {회사}       ← contactSummaryOf(레코드 칸). 없으면 "{보낸 사람 이름} ‹{주소}›"
✉️ 회신한 사람: {이름} ‹{주소}› (레코드 연락처와 다름)   ← 동료가 대신 회신했을 때만 (RC-6)
💬 *{사업 40자} · 회신* — 규칙 "{규칙 이름 40자}" · {단계 글자}에 회신 ({M/D HH:mm} 도착)
레코드 {integratedCode} (#{recordId}) · {파티션 40자}
<{base}/records?id={recordId}|레코드 열기> · <{base}/email?tab=replies&reply={replyId}|회신 보기·처리함> · <{base}/records/{recordId}/journey|고객 여정>

> {발췌 300자, 줄바꿈은 공백}
이 고객에게 가던 자동 메일을 멈췄습니다: 후속 {n}통 · 템플릿 반복 {m}건 · 발송 대기열 {k}건   ← 0인 항목은 뺀다. 다 0이면 "이 고객에게 가던 자동 메일은 없습니다"
⚠️ 수신거부 요청으로 보입니다 — 확인 뒤 수신거부에 넣어 주세요   ← unsubscribe_hint일 때만
_자동 답장은 나가지 않습니다. 원문을 보고 직접 답장해 주세요._
```

- 사용자 값(사업·규칙·파티션 이름, 보낸 사람, 제목, 발췌)은 `< >`를 `‹ ›`로, 꾸밈 글자(별표·밑줄·물결·백틱)를 비슷한 전각 글자로 바꾸고, 맨 URL은 `hxxps://`처럼 눌리지 않게 한다 (RC-7). 공통 보내기도 마지막에 `<users/`를 막는다

예 (PRD 장면 1을 이 모양으로):
```
⏰ *답장 기한: 오늘 안 · 10/12(월) 18:00까지*
👤 김OO · 010-0000-0000 · kim@oo.co.kr · (주)OO상사
💬 *백오피스랩 · 회신* — 규칙 "백오피스랩 회계 첫 메일" · 1번째 후속 (첫 메일 +3일)에 회신 (10/12 10:42 도착)
레코드 BO-0042 (#4242) · 콜드메일 10월
<…|레코드 열기> · <…|회신 보기·처리함> · <…|고객 여정>

> 비용이 어느 정도인지 궁금합니다
이 고객에게 가던 자동 메일을 멈췄습니다: 후속 1통
_자동 답장은 나가지 않습니다. 원문을 보고 직접 답장해 주세요._
```

**못 이은 회신 카드** (6-3 사업 추정일 때, RC-10)
```
⏰ *답장 기한: {기한}*
💬 *{사업} · 새 회신 (어느 메일의 답장인지 못 찾음)* — {M/D HH:mm} 도착
보낸 사람 {이름} ‹{주소}› → 받은 주소 {cs@도메인}
제목 "{제목 100자}"
> {발췌 300자}
<{base}/email?tab=replies&reply={replyId}|회신 보기>
이 주소로 나갈 자동 메일은 보내기 직전에 막힙니다
_자동 답장은 나가지 않습니다. 원문을 보고 직접 답장해 주세요._
```

- **다른 메일 내용은 넣지 않는다**: 그 회신의 인용 뗀 발췌만. Cc 목록·첨부 이름·스레드의 다른 메일·우리 원래 본문은 넣지 않는다
- 구글 챗 웹훅은 버튼 콜백을 못 받는다 → PRD의 [답장함]·[분류 고치기]는 "회신 보기·처리함" 링크 하나로 (11절 화면에서 누른다)
- dry_run 카드는 `alert_message`에 남아 회신 탭에서 "나갈 카드"로 보인다 (dry_run 기간에 모양을 확인)

**보내기**: 깊이 알림의 `deliverClaimedBatch`를 그대로 쓴다 — 1.1초 간격, 429·5xx는 3번까지 10분 뒤, 400은 실패, 401·403·404(웹훅 설정 오류)·웹훅 없음은 시도로 세지 않고 되돌림(기다림), 예약 24시간 지나면 닫음(직전 원인은 뒤에 남김), 예외 뒤 보내지 않은 줄 되돌림, `sent` 기록 3번 재시도. 바꿀 것 두 가지(작음): `ClaimedAlert.recordId`를 `number | null`로(못 이은 회신), 로그 머리말을 deps로 받기(`[deep-alert]` 고정 → `[reply-alert]`).
- 구글 챗 QA로 더한 것 (docs/2026-10-11-reply-and-health/CHAT-QA.md): 공통 보내기가 스페이스마다 1.1초 줄을 세워 깊이·회신·발송 건강 알림이 서로 부딪히지 않게 한다 (스페이스당 초당 1통 공유 한도). 응답 시간 초과는 바로 다시 보내지 않고(이미 올라갔을 수 있음), 늦거나 다시 보내도 실패한 스페이스는 그 회차에 건너뛰어 다른 사업 카드를 먼저 보낸다. 웹훅 문제는 운영 스페이스에 6시간에 한 번 알린다

**운영 알림 (M7)**: 받는 곳은 `REPLY_OPS_WEBHOOK_URL` → 없으면 `SEND_HEALTH_WEBHOOK_URL`(SND 운영 스페이스) → 없으면 `DEEP_ALERT_WEBHOOK_URL`. 기본값만으로도 이미 쓰는 채널로 간다 — 토큰이 끊겨도 화면 띠와 로그뿐인 일이 없게. 연결 오류(토큰 무효·권한 부족·메일함 주인 다름·1시간 넘는 연속 실패)와 **on인데 마지막 성공이 6시간을 넘음**은 6시간에 한 번, 다시 되면 한 번. 알림 글에 주소·제목·본문은 없다.
```
⚠️ 샌드비 회신 읽기 멈춤: {짧은 원인}                  ← 정체(6시간)면 "6시간 넘게 회신을 읽지 못했습니다 — 원인: {짧은 원인}"
영향: {마지막 성공} 뒤로 회신한 사람에게도 후속·AI 첫 메일이 나갈 수 있습니다   ← dry_run이면 "자동 메일 멈춤은 아직 꺼져 있습니다 — 기록·카드만 늦어집니다"
할 일: {원래 원인에 맞는 할 일 — 개발 담당에게 무엇을 부탁할지}    ← auth·scope: 13-4절 토큰 다시 받기, mailbox_mismatch: `REPLY_MAILBOX`
<{base}/email?tab=replies|회신 탭 보기>
```
- 시험(개발) 서버면 첫 줄에 `[개발 서버 · {호스트}]` (RO-10). 같은 원인은 6시간에 한 번, 원인이 바뀌면 바로 (RO-7). 회복 뒤 1시간 안에 같은 문제가 다시 나면 1시간 넘게 이어질 때만 (RO-15)
- 회복 글: `✅ 샌드비 회신 읽기가 다시 됩니다 ({시각}) — 직전 원인: {짧은 원인}. 멈춘 동안 온 회신도 이어서 읽고 카드를 보냅니다` — 보내지 못하면 다음 성공 회차에 다시 (RO-6)
- 분류 밖 오류(스키마 어긋남·코드 예외)도 `internal`로 상태에 남겨 띠·운영 알림·정체 판정이 돈다 (RO-1). 운영 서버인데 `REPLY_PRIVATE_DOMAINS`가 비어 읽지 않으면(`read_blocked`) 운영 스페이스에 6시간에 한 번 (RO-13)
- 운영 웹훅이 401·403·404로 고장이면 1시간에 한 번만 다시 해 보고, 회신 탭 띠에 "운영 알림을 보내지 못하고 있습니다"를 보인다. 다른 운영 후보 웹훅으로 웹훅 문제 알림이 간다 (RO-4·WPN-3)
- **매일 보고에도 싣는다**: SND 매일 보고(DESIGN-SND 7-4)가 `email_reply_mailbox_state`를 읽어 "회신 읽기: 마지막 성공 {시각} · 모드 {on/dry_run} · 어제 회신 {n}·반송 {m}" 한 줄을 넣는다. 알림을 놓쳐도 다음 날 아침에는 보인다
- 회신 읽기가 오래 멈췄을 때 후속을 자동으로 미룰지는 **대표 결정 항목**이다 (17절). 1판은 알림만 한다

## 9. 결정 ⑧ 표 (마이그레이션 0074)

`drizzle/0074_email_replies.sql` — 더하기만, 다시 돌려도 같음. 저널: `{"idx":74,"version":"7","when":1773700000000,"tag":"0074_email_replies","breakpoints":true}`. (0075는 발신 건강 몫)

```sql
-- 회신 받기 (docs/2026-10-11-reply-and-health/DESIGN-RPL.md 9절). 새 표 둘과 NULL 허용 칸 둘만 더한다.
-- 큰 표(email_send_logs)는 건드리지 않는다. 그 표의 (org_id, sent_at)·(request_id) 색인은 부팅 뒤 트랜잭션 밖 단계가
-- CREATE INDEX CONCURRENTLY로 만든다 (DESIGN-SND 8-3 ensureSendLogIndexes — 두 문서 같은 결론)

CREATE TABLE IF NOT EXISTS "email_replies" (
    "id" serial PRIMARY KEY NOT NULL,
    "org_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE,   -- 애매함이면 NULL
    "workspace_id" integer,
    "workspace_guessed" boolean DEFAULT false NOT NULL,                  -- 못 이었지만 발신 주소로 사업을 추정 (6-3)
    "record_id" integer REFERENCES "records"("id") ON DELETE SET NULL,   -- 레코드를 지워도 막기 기록은 남긴다. 넣을 때는 records에 있는 것만 (6-1 LEFT JOIN, M6)
    "send_log_id" integer,                                               -- FK 없음 (깊이 알림과 같은 이유)
    "root_log_id" integer,
    "rule_kind" varchar(10),                                             -- ai | template | manual
    "rule_id" integer,
    "step_index" integer,                                                -- 0 = 첫 메일, n = n번째 후속
    "mailbox" varchar(200) NOT NULL,
    "gmail_message_id" varchar(64) NOT NULL,
    "gmail_thread_id" varchar(64),
    "rfc_message_id" varchar(300),
    "from_email" varchar(200) NOT NULL,                                  -- 정규화
    "from_name" varchar(200),
    "to_email" varchar(200) NOT NULL,                                    -- 받은 우리 주소
    "contact_email" varchar(200) NOT NULL,                               -- 사람·자동응답 = 보낸 사람, 반송 = 반송된 받는 주소 (Final → Original)
    "matched_recipient" varchar(200),                                    -- 이어진 발송의 받는 주소(원래 받은 사람). 멈춤·막기는 contact_email과 둘 다 (M3)
    "subject" varchar(300),
    "excerpt" text,                                                      -- 인용 뗀 앞 500자. 반송·시스템·큰 메일은 NULL
    "kind" varchar(20) NOT NULL,                                         -- human | auto_reply | bounce | system | internal | unknown
    "bounce_type" varchar(10),                                           -- hard | expired | soft | unknown (SND classifyDsn 하나로)
    "dsn_status" varchar(20),
    "dsn_diagnostic" varchar(300),
    "unsubscribe_hint" boolean DEFAULT false NOT NULL,
    "ours_reason" varchar(20) NOT NULL,                                  -- address | domain_thread
    "match_status" varchar(20) NOT NULL,                                 -- matched | unmatched | ambiguous
    "match_method" varchar(20),                                          -- thread | dsn_headers | fallback_subject | fallback_latest | fallback_from_only | fallback_multi_ws | dsn_fallback
    "received_at" timestamp with time zone NOT NULL,                     -- Gmail internalDate
    "detected_at" timestamp with time zone DEFAULT now() NOT NULL,
    "detected_mode" varchar(10) NOT NULL,                                -- dry_run | on
    "process_error" varchar(80),                                         -- 메일 하나의 데이터 오류 (SQLSTATE·제약 이름만, M6)
    "effects_applied_at" timestamp with time zone,
    "effects_applied_kind" varchar(20),                                  -- 효과를 적용할 때의 kind. 사람으로 고치면 다시 적용 (M5)
    "effects" jsonb,
    "stop_automation" boolean DEFAULT true NOT NULL,                     -- 담당이 끄면 보내기 직전 막기에서 빠진다
    "alert_status" varchar(20),                                          -- NULL(대상 아님) | pending | processing | sent | failed | skipped | dry_run
    "alert_attempts" integer DEFAULT 0 NOT NULL,
    "alert_next_at" timestamp with time zone,
    "alert_locked_at" timestamp with time zone,
    "alert_message" text,
    "alert_last_error" text,
    "alert_sent_at" timestamp with time zone,
    "handled_by" uuid,
    "handled_at" timestamp with time zone,
    "kind_changed_by" uuid,
    "kind_changed_at" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "er_mailbox_gmail_idx" ON "email_replies" ("mailbox", "gmail_message_id");
CREATE UNIQUE INDEX IF NOT EXISTS "er_org_rfc_idx" ON "email_replies" ("org_id", "rfc_message_id")
    WHERE "org_id" IS NOT NULL AND "rfc_message_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "er_stop_idx" ON "email_replies" ("workspace_id", "contact_email");
CREATE INDEX IF NOT EXISTS "er_stop_recipient_idx" ON "email_replies" ("workspace_id", "matched_recipient")
    WHERE "matched_recipient" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "er_send_log_idx" ON "email_replies" ("send_log_id");
CREATE INDEX IF NOT EXISTS "er_record_idx" ON "email_replies" ("record_id");
CREATE INDEX IF NOT EXISTS "er_org_received_idx" ON "email_replies" ("org_id", "received_at");
CREATE INDEX IF NOT EXISTS "er_alert_pickup_idx" ON "email_replies" ("alert_status", "alert_next_at", "id");

-- 메일함마다 어디까지 읽었나. 남의 메일에 대해서는 건수(stats)만 남는다
CREATE TABLE IF NOT EXISTS "email_reply_mailbox_state" (
    "mailbox" varchar(200) PRIMARY KEY NOT NULL,
    "history_id" varchar(32),
    "backfill_after" timestamp with time zone,
    "backfill_before" timestamp with time zone,
    "backfill_done_at" timestamp with time zone,
    "last_run_at" timestamp with time zone,
    "last_success_at" timestamp with time zone,
    "last_error_code" varchar(30),       -- auth | scope | mailbox_mismatch | rate_limited | transient | config | stale
    "last_error" text,                    -- 한국어 한 줄. 비밀값·주소 없음
    "last_error_at" timestamp with time zone,
    "ops_alerted_at" timestamp with time zone,
    "stats" jsonb,                        -- 마지막 회차와 오늘(KST) 누적 숫자: listed·notOurs·notAllowedFrom·outOfScope·ours·stored·matched·dbErrors …
                                          -- + excluded(뺀 주소, 가린 모양 — B1)·serverKind(production | test)
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- 멈춤 사유 (replied | bounced). SEQ-1이 같은 칸에 rule_off·first_failed·unsubscribed·manual을 쓴다
ALTER TABLE "email_followup_queue" ADD COLUMN IF NOT EXISTS "stop_reason" varchar(30);
ALTER TABLE "email_automation_queue" ADD COLUMN IF NOT EXISTS "stop_reason" varchar(30);
```

- `src/lib/db/schema.ts`: `emailReplies`·`emailReplyMailboxState` 표와 타입, 두 대기열에 `stopReason`. 부분 유일 색인은 `uniqueIndex(...).on(...).where(sql\`…\`)`로 같은 이름
- 표가 없을 때(42P01, 마이그레이션 실패) 워커는 조용히 `{ tableMissing: true }`. 보내기 직전 막기도 42P01이면 null (발송을 막지 않는다)
- Gmail 메시지 번호는 메일함마다 다르므로 유일 키를 (메일함, 번호)로 둔다. 메일함을 옮겨 같은 메일이 두 번 보이면 `(org_id, rfc_message_id)`가 막는다

## 10. 결정 ⑨ 워커·라우트·주기·한도·실패

### 10-1. `processReplySync(opts?: { now?: Date }): Promise<ReplySyncStats>` (`src/lib/email-reply-sync.ts`)

1. 설정 읽기 (`resolveReplyConfig(process.env)`, 순수). 운영 서버 판정과 시험 서버 제한(3절)을 여기서 적용한다 — 제한에 걸린 `on`·`live`는 `dry_run`으로 바뀌고 `configWarnings`에 남는다. `off` → `{mode:'off'}`. 비밀값 없음 → `{configured:false}`. 허용 워크스페이스 없음 → `{noWorkspaces:true}`
2. `queryClient.reserve()` → `pg_try_advisory_lock(0x5c4edf07)` → 못 잡으면 `{skippedAsLocked:true}` (Gmail 호출 0). `finally`에서 풀고 `release()`
3. 상태 줄 읽기(없으면 만든다), 알림 `processing` 15분 넘은 줄 되돌리기
4. 토큰 → `getProfile`. `emailAddress`(소문자) ≠ `REPLY_MAILBOX`면 `mailbox_mismatch`로 멈춘다 (메시지를 하나도 읽지 않는다). 띠 글: "메일함 주소가 맞지 않습니다 — REPLY_MAILBOX에는 별칭이 아니라 그 계정의 기본 주소를 넣어 주세요" (m3)
4-1. 4-1절 주소 모음을 만든다 (빼는 주소에 `getProfile` 주소를 더한다, B1). 조직 사용자 주소 모음(`users`, 5절 `internal`)도 함께 읽는다
5. (on) 밀린 효과 50줄 (7-1). 반송 줄은 SND `applyPendingBounceSignals`
6. **새 메일 번호**
   - 상태에 `history_id`가 없음(처음): 지금 `profile.historyId`를 `history_id`로 적고, `backfill_after = now - REPLY_BACKFILL_DAYS`, `backfill_before = now`
   - 있음: `history.list(startHistoryId, historyTypes=messageAdded, maxResults=500)`를 페이지대로. **404(너무 오래됨)** → 목록 조회 `q = after:{last_success_at - 1시간 (최소 2일 전, 최대 30일 전), 초} -in:sent -in:chats -in:drafts`, `includeSpamTrash=true`로 이어 읽고 `history_id`를 지금 profile 값으로 새로 잡는다
7. 4절 1단계 → 판정 → (시험 서버) 1.5단계 → 2단계 → 5절 분류 → 6절 짝짓기 → 저장 → (on) 7절 효과·알림 줄 (한 트랜잭션). 메일마다 저장점으로 격리한다 (7-1, M6). 처리는 history 기록 순서대로 묶음(최대 50통)으로 하고, 묶음이 끝날 때마다 커서를 **그 묶음의 마지막 history 기록 번호**로 옮긴다. 모두 끝나면 응답의 `historyId`로
8. 예산이 남으면 **처음 거슬러 읽기**: `q = after:{backfill_after} before:{backfill_before} -in:sent -in:chats -in:drafts`, `includeSpamTrash=true`, 최근 것부터. 처리한 가장 이른 `internalDate`로 `backfill_before`를 당긴다. 결과가 비면 `backfill_done_at`. 경계의 같은 메일은 유일 키가 막는다
9. 알림 보내기 (8절, 예산 60초)
10. 상태 저장: `last_success_at`, `stats`, 오류 비움 (오류였다가 되면 운영 "다시 됨" 알림). on인데 `last_success_at`이 6시간을 넘은 채 이 회차도 실패하면 `last_error_code='stale'`과 운영 알림 (8절, M7)

**한도**: 회차 예산 4분(5분 주기보다 짧게), 1단계 500통, 2단계(본문) 50통, Gmail 동시 4개. 한도에 닿으면 처리한 데까지만 커서를 옮기고 다음 회차가 이어 간다 (`budgetHit: true`).

**Gmail 사용량** (Google 공개 값: `getProfile` 1단위, `history.list` 2, `messages.list` 5, `messages.get` 5, `messages.attachments.get` 5. 사용자당 분당 15,000단위): 보통 회차 = 1 + 2 + 새 메일 수 × 5. 최악 회차(1단계 500 + 본문 50 + 반송 첨부 부분 50 + 목록 1) ≈ 3,010단위 → 분당 한도의 1/5. 동시 4개·응답 0.1~0.3초면 초당 약 100단위로 사용자당 초당 한도(250) 아래다. 결제·할당량 신청 필요 없음. 전용 메일함(2-1)이면 새 메일 수 자체가 회신·반송뿐이라 훨씬 적다.

### 10-2. Gmail 클라이언트 (`src/lib/gmail-client.ts`, DB 모름)

| 함수 | 요청 |
|---|---|
| `getAccessToken(cfg, fetchImpl)` | `POST https://oauth2.googleapis.com/token` (form: `client_id`, `client_secret`, `refresh_token`, `grant_type=refresh_token`). 모듈 메모리에 `expires_in - 60초` 동안 보관 |
| `getProfile()` | `GET https://gmail.googleapis.com/gmail/v1/users/me/profile` |
| `listHistory(startHistoryId, pageToken?)` | `GET …/users/me/history?startHistoryId=…&historyTypes=messageAdded&maxResults=500` |
| `listMessages(q, pageToken?)` | `GET …/users/me/messages?q=…&maxResults=500&includeSpamTrash=true` |
| `getMessageRecipients(id)` | 4-2의 1단계 요청 그대로 |
| `getMessageFrom(id)` | 4-2의 1.5단계 (`format=metadata&metadataHeaders=From&fields=id,payload/headers`, 시험 서버만) |
| `getMessageFull(id)` | `GET …/users/me/messages/{id}?format=full` |
| `getReportPart(id, attachmentId)` | `GET …/users/me/messages/{id}/attachments/{attachmentId}` — 4-2의 반송 보고 부분 예외만. 부르는 쪽이 MIME 형식·64KB를 먼저 확인하고, 이 함수도 응답 `size`가 64KB를 넘으면 버린다 (M9) |

- 시간 제한 15초. 오류 분류: `invalid_grant`·401 → `auth` · 403 `insufficientPermissions` → `scope` · 429, 403 `rateLimitExceeded`·`userRateLimitExceeded` → `rate_limited` · history 404 → `history_expired` · 메시지 404 → 그 메일 건너뜀 (그사이 지워짐) · 5xx·연결 오류 → 1.5초 뒤 한 번 다시, 그래도면 `transient`
- 오류 글에서 토큰·`client_secret`·`refresh_token`·`access_token` 값과 주소의 쿼리를 지운다 (`google-chat.ts`의 `scrub`과 같은 방식)

**실패 처리**

| 경우 | 회차 결과 | 커서 | 알림 |
|---|---|---|---|
| `auth`·`scope`·`mailbox_mismatch` | 200 `{error:'auth'…}` — 스케줄러가 재시도 폭주하지 않게 | 그대로 | 운영 알림(6시간에 1번) + 회신 탭 빨간 띠 |
| `rate_limited` | 처리한 데까지 저장하고 멈춤 | 처리한 데까지 | 1시간 넘게 이어지면 운영 알림 |
| `transient` | 같음 | 처리한 데까지 | 같음 |
| `history_expired` | 목록 조회로 이어 읽음 (놓침 없음) | 새로 잡음 | 없음 |
| 메일 하나 해석 오류 | 우리 것이면 `kind='unknown'` 줄만 남기고 계속 | 계속 | 없음 |
| 메일 하나의 DB 데이터 오류 (`22xxx`·`23xxx`, 예: 지워진 레코드 FK) | 저장점으로 되돌리고 최소 줄(`kind='unknown'`, `process_error`)만 남기고 계속 (M6) | **계속 (넘어간다)** | 없음. 회차 `dbErrors`·회신 탭에 보임 |
| DB 연결·자원 오류 (`08xxx`·`53xxx`·`57xxx`·시간 초과) | 그 묶음에서 멈추고 500 | 그 묶음 앞까지 (다음 회차가 다시 — 유일 키로 안전) | 1시간 넘게 이어지면 운영 알림. 단 DB가 계속 안 되면 상태(`ops_alerted_at`)를 적을 수 없어 운영 알림도 보내지 못한다 — 이 경우는 스케줄러가 받는 500과 CloudType 감시가 맡는다 (설계 한계, 구글 챗 QA RO-14) |
| 분류 밖 오류 (스키마 어긋남·코드 예외) | 상태에 `internal`로 남기고 다시 던짐 (500) | 그 묶음 앞까지 | 1시간 넘게 이어지면 운영 알림, 띠에 보임 (RO-1) |

### 10-3. 라우트

- `POST /api/email/replies/sync` — `CRON_SECRET` 검사(깊이 알림 라우트와 똑같이: `x-secret` 머리글·Bearer·`?secret=`). 본문 없음. `{success, data: stats}`. stats에는 숫자와 모드만 (주소·제목 없음). 예외는 `describe…Error`로 짧게 찍고 500
- `GET /api/email/replies?page&pageSize&kind&matchStatus&workspaceId&recordId&sendLogId&handled` — 로그인 필요. 사용자가 볼 수 있는 파티션(`loadOrgScopes` + `filterAccessiblePartitions`)의 발송에 이어진 회신만. 미분류·애매함은 관리자만(`role !== 'member'`). `meta.sync`에 연결 상태(모드·알림 모드·가린 메일함 주소·마지막 성공·오류 한국어·거슬러 읽기 끝남 여부)
- `PATCH /api/email/replies/[id]` — `{ handled?: boolean, kind?: 'human'|'auto_reply'|'bounce'|'system'|'internal'|'unknown', stopAutomation?: boolean }`. 같은 권한 확인. `handled` → `handled_by/at` (PRD 지표 "회신 → 첫 응대 시간"). `kind`를 사람으로 바꾸면(on, 이어진 줄) `effects_applied_kind`가 `human`이 아닐 때 7-2를 적용한다 — 효과가 없었든 반송·자동응답으로 이미 처리됐든 (M5, RPL-2 수용 3 "고친 분류로 조치가 다시 돈다"). 반송으로 바꿔도 SND 신호는 만들지 않는다(반송 안내 부분이 없는 메일이다). 사람에서 다른 것으로 바꾸면 막기에서만 빠지고 멈춘 줄은 그대로
- `GET /api/email/replies/stats?days=28` — `{ byRule: { "ai:12": {human, auto_reply, bounce}, "template:5": {…} }, total }`. 조직·기간 색인 `er_org_received_idx`
- 기존 수정: `GET /api/email/logs`가 쪽의 발송마다 `reply: {id, kind, receivedAt} | null`을 붙이고(클릭 수와 같은 방식, `logs/route.ts:104-116`, 사람 회신 먼저) `hasReply=1` 필터를 받는다. `GET /api/email/followup-queue`가 `stopReason`을 내려준다

### 10-4. 주기

CloudType Scheduler: `POST {base}/api/email/replies/sync`, cron `30 */5 * * * *` (깊이 알림과 같은 초에 겹치지 않게 30초 어긋나게 — 같은 사업 스페이스를 함께 쓴다, 구글 챗 QA RC-5), 머리글 `X-Secret: <CRON_SECRET>`. PRD 수용 1 "회신 10분 안에 사건·멈춤·알림"을 5분 주기 + 회차 1분 안으로 맞춘다. 실시간 푸시(Gmail watch + Pub/Sub)는 하지 않는다 — Pub/Sub 설정이 대표님 콘솔 단계를 크게 늘린다.

## 11. 화면

폴더 규칙대로 `src/components/email/replies/{ui,hooks,api,types,utils}`.

1. **이메일 → "회신" 탭** (`src/app/email/page.tsx`에 탭 하나, "후속 큐" 뒤)
   - 위 띠: 연결 상태 — `시험 모드(dry_run) · 마지막 확인 10/11 10:45 · 메일함 r***@matchesplan.com`. 오류면 빨간 띠 "메일함 연결이 끊겼습니다 — 갱신 토큰을 다시 받아 주세요 (마지막 성공 …)"
   - 띠 둘째 줄(있을 때만): "우리 주소에서 뺀 주소 N개 (메일함 쪽 주소)" + 펼치면 가린 주소 목록 (B1, 4-1) · "시험 서버 — 직원 주소(REPLY_ALLOWED_FROM)가 보낸 메일만 읽습니다" (M1) · "on을 켤 수 없습니다 — 시험 주소·직원 주소가 필요합니다" (M1) · "메일함 주소가 별칭입니다 — 기본 주소를 넣어 주세요" (m3)
   - 거르개: 분류(사람·자동응답·반송·시스템·내부·전부), 상태(이어짐·미분류·애매함), 처리(안 함·함), 사업
   - 줄: 도착 시각 · 사업 · 보낸 사람 · 제목 · 분류 배지 · 규칙·단계 · 처리 여부
   - 줄을 누르면 옆 창: 발췌, 이어진 발송(제목·보낸 때·보낸 주소), 레코드 링크, 효과(멈춘 줄 수 또는 dry_run "멈출 예정"), dry_run 카드 미리보기, 버튼 **[처리함]** **[분류 고치기]** **[자동 메일 다시 허용]**
2. **발송 이력** (`EmailSendLogTable.tsx`): 줄에 배지 `회신`(초록)·`자동응답`(회색)·`반송`(빨강). 거르개 "회신 있음"
3. **규칙 목록**: AI 규칙 카드(`AutoPersonalizedEmailConfig.tsx`, `RuleQueueBadges` 옆)와 템플릿 자동발송 목록(`EmailTemplateLinkList.tsx`)에 `회신 3 · 28일`. `useReplyStats` 한 번 불러 규칙 번호로 찾는다
4. **레코드**: 상세(`RecordDetailDialog.tsx`)에 "회신함 · 10/12 10:42" 배지와 최근 발췌 한 줄 (`GET /api/email/replies?recordId=`). 여정에는 '회신'·'반송' 사건이 보인다 (`journey.ts` 이름 두 줄)
5. **후속 큐** (`FollowupQueueTable.tsx`): `취소` 배지 옆에 `(회신)`·`(반송)`

## 12. 파일 배치

| 파일 | 내용 |
|---|---|
| `src/lib/email-reply-rules.ts` (신규, 순수, `@/lib/db` import 금지) | `resolveReplyConfig(env)`(운영 서버 판정·시험 서버 제한 포함), 주소 목록 해석·RFC 2047 풀기, `normalizeReplyAddress`(+태그 — 기존 `normalizeSenderAddress`와 다른 이름, m9), `buildOurAddressSet`(빼는 주소 규칙, B1), `recipientOwnership`, `threadRequestIdCandidates`, `normalizeSubject`·`subjectsMatch`, `pickFallbackLog`(워크스페이스 갈림 → 애매함, M4), `classifyReply`, `parseDeliveryStatus`, `reportPartsToFetch`(M9), `extractBodies`·`decodePartData`(charset)·`stripHtmlQuote`, `stripQuoted`, `stripOurFooter`(m4), `makeExcerpt`, `hasUnsubscribeHint`, `isDataError`(SQLSTATE 22·23, M6), `stepLabel`, `replyDeadlineText`, `buildReplyAlertMessage`·`buildUnmatchedReplyAlertMessage`·`buildOpsAlertMessage`, `resolveOpsWebhook`(M7), `maskEmail`, Gmail 쿼리 만들기(`recipientsRequestPath`, `fromRequestPath`, `fallbackListQuery`, `backfillListQuery`). `classifyDsn`은 SND의 `email-status-sync-rules.ts`에서 import (B2) |
| `src/lib/email-reply-rules.test.ts` (신규) | 16절 R 시험 중 순수 함수 몫 |
| `src/lib/gmail-client.ts` (신규, DB 모름) | 10-2 |
| `src/lib/gmail-client.test.ts` (신규) | 가짜 fetch로 토큰 보관·오류 분류·비밀값 지우기·1단계 요청 모양 |
| `src/lib/email-reply-sync.ts` (신규, DB) | `processReplySync`, 주소 모음 읽기, 메일 하나 격리(저장점), 밀린 효과, 알림 보내기 연결 |
| `src/lib/email-reply-effects.ts` (신규, DB) | `applyReplyEffects(tx, reply)`·`planReplyEffects(reply)` (같은 WHERE를 쓰는 update/count, `pending`·`held`, 두 주소), 반송은 SND `recordBounceSignal`·`applyPendingBounceSignals` 부르기 |
| `src/lib/email-reply-guard.ts` (신규, DB) | `findReplyStop`, `loadReplyStops` (회신 = `email_replies`, 반송 = `email_bounce_signals`) |
| `src/lib/email-bounce-signal.ts` (SND 신규 — 이 문서는 부르기만) | `recordBounceSignal`, `applyPendingBounceSignals` (DESIGN-SND 4절) |
| `src/lib/email-followup.ts` (수정) | 두 처리기 막기, `stopped` 결과, `cancelled`+`stop_reason` |
| `src/lib/email-automation.ts` (수정) | `sendEmailSingle` 막기, `TemplateFirstOutcome`에 `stopped`, `processRepeatItem`의 모든 마지막 update에 `status='pending'` 조건 (m5) |
| `src/lib/auto-personalized-email.ts`, `src/lib/email-send-queue-rules.ts`, `src/lib/email-send-queue.ts` (수정) | AI 첫 메일 막기, 미리 판정 같은 자리, 묶음 조회 |
| `src/lib/deep-visitor-alert-delivery.ts` (작게 수정) | `recordId: number | null`, 로그 머리말 deps |
| `src/lib/tracker/journey.ts` (수정) | `reply → 회신`, `email_bounce → 반송` |
| `src/lib/db/schema.ts`, `drizzle/0074_email_replies.sql`, `drizzle/meta/_journal.json` | 9절 |
| `src/app/api/email/replies/sync/route.ts`, `…/replies/route.ts`, `…/replies/[id]/route.ts`, `…/replies/stats/route.ts` (신규) | 10-3 |
| `src/app/api/email/logs/route.ts`, `src/app/api/email/followup-queue/route.ts` (수정) | 회신 붙이기, 멈춤 사유 |
| `src/components/email/replies/…` (신규), `src/app/email/page.tsx`, `EmailSendLogTable.tsx`, `FollowupQueueTable.tsx`, `AutoPersonalizedEmailConfig.tsx`, `EmailTemplateLinkList.tsx`, `src/components/records/RecordDetailDialog.tsx` (수정) | 11절 |
| `.testenv/mock-fetch.mjs`, `.testenv/fake-gmail.json`, `.testenv/rpl-scenario.ts` (로컬만, 커밋 안 함 — `.git/info/exclude`) | 15절 |
| (의존) `src/lib/db/send-log-indexes.ts`, `src/instrumentation.ts` | DESIGN-SND 8-3 — `email_send_logs` 색인 두 개를 부팅 뒤 CONCURRENTLY로. 이 문서의 6-1·6-2·4-1(3)이 쓴다 |

PRD 8-x의 파일 이름(`reply-intake.ts`, `reply-classify.ts`, `/api/cron/reply-poll`)은 저장소의 `email-*` 이름 규칙과 기존 정기 작업 경로(`/api/email/…/process`)에 맞춰 위처럼 바꿨다.

## 13. 대표님 설정 안내 (한 번, 13-0 포함 약 40분)

> ⚠️ **먼저 읽어 주세요 (M2)**: 여기서 받는 갱신 토큰은 **그 메일함 전체를 읽을 수 있는 열쇠**입니다. 샌드비 코드는 샌드비 발신 주소로 온 메일만 읽지만, 클라이언트 ID·보안 비밀·갱신 토큰 셋을 가진 사람은 코드 밖에서 그 메일함 전체를 읽을 수 있습니다. CloudType 환경 변수는 스페이스 `pjk8197`에 접근할 수 있는 사람(개발팀 포함)이 볼 수 있습니다. 그래서 **`ceo@`가 아니라 회신 전용 메일함의 토큰을 받는 것**을 권합니다 (13-0 먼저). `ceo@` 토큰을 개발 서버 시험에만 잠깐 넣는 (나) 길은 대표님이 이 경고를 읽고 승인하셔야 합니다 (2-1).
>
> 비밀값(클라이언트 보안 비밀, 갱신 토큰)은 Claude 대화창·메신저·문서에 붙이지 마세요. CloudType 환경 변수 칸에만 바로 넣습니다. 화면 이름은 구글이 가끔 바꿉니다 — 괄호 안 예전 이름도 함께 적었습니다.

### 13-0. 회신 전용 메일함 만들고 회신을 그리로 돌리기 (권장 — 토큰보다 먼저, 약 20분, m3)

순서가 중요합니다. **라우팅을 먼저 바꾸고 샌드비 환경 변수는 나중에** 바꿔야 놓치는 메일이 없습니다.

1. admin.google.com (ceo@로 로그인) → **사용자** → **새 사용자 추가** → `reply@matchesplan.com` (라이선스 1개). 구글 그룹(공용 메일함)은 안 됩니다 — Gmail API로 읽을 수 없습니다
2. **별칭 옮기기** (발송이 적은 저녁에): 사용자 `ceo@` → 사용자 정보 → 대체 이메일(별칭)에서 `cs@` 별칭을 지움 → 곧바로 `reply@` → 대체 이메일에 `cs`를 넣고 저장. 지우고 넣는 사이(1~2분) 이 주소로 온 메일은 반송될 수 있습니다. 별칭 도메인 `matchesplan.cloud`·`.me`의 `cs@`는 사용자 별칭을 따라 함께 옮겨집니다 — 4번에서 확인합니다
3. **라우팅 규칙 받는 곳 바꾸기**: 앱 → Google Workspace → Gmail → **라우팅**(기본 라우팅) → 보조 도메인 158곳 규칙 → "봉투 받는 사람 변경"을 `ceo@matchesplan.com` → `reply@matchesplan.com`으로 → 저장 (반영까지 최대 1시간)
4. **확인**: 다른 계정(개인 Gmail 등)에서 `cs@matchesplan.cloud`, `cs@matchesplan.me`, `cs@<보조 도메인 하나>`로 시험 메일 → `reply@` 받은편지함에 오고 `ceo@`에는 오지 않는지
5. 그 뒤 13-1~13-3을 진행합니다. 13-2의 8번에서 **`reply@`로 로그인**합니다. `REPLY_MAILBOX=reply@matchesplan.com` — 구글이 돌려주는 **기본 주소**와 똑같이 넣습니다 (별칭 `cs@…`를 넣으면 샌드비가 "메일함 주소가 맞지 않습니다"로 멈춥니다)
6. (이미 `ceo@`로 돌고 있던 샌드비를 옮길 때만) 3번을 끝낸 **뒤에** CloudType의 `REPLY_MAILBOX`·`REPLY_GOOGLE_REFRESH_TOKEN`을 바꾸고 배포 → 새 메일함은 처음 회차에 14일을 거슬러 읽습니다 → 회신 탭에서 "거슬러 읽기 끝남" 확인 → 옛 `ceo@` 연결 끊기 (13-6). 거꾸로 하면 라우팅이 바뀌기 전 `ceo@`에 들어온 회신을 아무도 읽지 않습니다

### 13-1. Google Cloud 콘솔 (ceo@matchesplan.com으로 로그인 — 관리자 계정이면 됩니다)

1. https://console.cloud.google.com 접속 → 맨 위 프로젝트 고르기 → **새 프로젝트**
2. 프로젝트 이름 `sendb-reply` → **위치(조직)가 `matchesplan.com`인지 확인** → 만들기. (조직이 아니면 3번에서 "내부"를 고를 수 없습니다)
3. 왼쪽 메뉴 **API 및 서비스 → 라이브러리** → `Gmail API` 검색 → **사용**
4. 왼쪽 메뉴 **Google 인증 플랫폼**(예전: OAuth 동의 화면) → **시작하기**
   - 앱 이름 `Sendb 회신 읽기`, 사용자 지원 이메일 `ceo@matchesplan.com`
   - 대상(사용자 유형): **내부** → 연락처 이메일 `ceo@matchesplan.com` → 동의 → **만들기**
5. **데이터 액세스**(예전: 범위) → **범위 추가 또는 삭제** → 아래 칸에 `https://www.googleapis.com/auth/gmail.readonly` 입력 → 표에 추가 → **업데이트** → **저장**
6. **클라이언트**(예전: 사용자 인증 정보 → OAuth 클라이언트 ID) → **클라이언트 만들기**
   - 애플리케이션 유형: **웹 애플리케이션**, 이름 `sendb-reply`
   - 승인된 리디렉션 URI → **URI 추가** → `https://developers.google.com/oauthplayground` (끝에 / 없이)
   - **만들기** → 뜨는 창에서 **클라이언트 ID**와 **클라이언트 보안 비밀**을 바로 메모장에 옮깁니다 (보안 비밀은 이 창에서만 다시 볼 수 없게 바뀌었습니다. JSON 다운로드도 됩니다)

### 13-2. OAuth Playground에서 갱신 토큰 받기

7. https://developers.google.com/oauthplayground 접속 → 오른쪽 위 **톱니바퀴**
   - **Use your own OAuth credentials** 체크 → 6번의 Client ID·Client secret 붙여 넣기 → 닫기
   - (이걸 켜야 토큰이 24시간 뒤에 끊기지 않습니다)
8. 왼쪽 **Step 1** 아래 "Input your own scopes" 칸에 `https://www.googleapis.com/auth/gmail.readonly` 입력 → **Authorize APIs** → **`reply@matchesplan.com`**(13-0) 고르기 — (나) 길이면 `ceo@matchesplan.com` → **허용**
   - "관리자가 이 앱을 차단했습니다"가 나오면 13-5를 먼저 합니다
9. **Step 2** → **Exchange authorization code for tokens** → 나온 **Refresh token** 값을 메모장에 옮깁니다 → 창을 닫습니다

### 13-3. CloudType 환경 변수 (먼저 `sendb-dev`)

10. CloudType → 스페이스 `pjk8197` → 프로젝트 → **`sendb-dev`**(운영 `sendb`가 아님) → 설정 → 환경 변수에 아래를 넣고 저장 → **배포하기**

    | 이름 | 값 |
    |---|---|
    | `REPLY_GOOGLE_CLIENT_ID` | 6번 클라이언트 ID |
    | `REPLY_GOOGLE_CLIENT_SECRET` | 6번 보안 비밀 |
    | `REPLY_GOOGLE_REFRESH_TOKEN` | 9번 Refresh token |
    | `REPLY_MAILBOX` | `reply@matchesplan.com` ((나) 길이면 `ceo@matchesplan.com`) |
    | `REPLY_SYNC_MODE` | `dry_run` |
    | `REPLY_ALERT_MODE` | `off` (개발 서버는 카드를 보내지 않음) |
    | `REPLY_PRIVATE_DOMAINS` | `matchesplan.cloud,matchesplan.me,designer-hire.com,offio.kr,pixl.kr` — 관리 콘솔 → 계정 → 도메인 관리에서 "사용자 별칭 도메인"으로 보이는 도메인 전부 (B1) |
    | `REPLY_SENDER_EMAILS` | **고객 발송에 한 번도 쓰지 않은 시험 전용 주소** 하나 — NHN 발신 인증은 끝났지만 발송 기록이 0인 보조 도메인의 `cs@` (개발 DB에서만 새 발신 프로필로 만든다). `cs@matchesplan.cloud`·`.me`·`.my`는 **운영 발신 주소**(운영 프로필 10·11·12)라 쓰지 않는다 (M1) |
    | `REPLY_ALLOWED_FROM` | 시험 답장을 보낼 직원 주소 (쉼표). 이 사람들이 보낸 메일만 개발 DB에 저장된다 (M1) |
    | `REPLY_BACKFILL_DAYS` | `0` (시험 서버는 최대 1) |

11. 메모장의 비밀값을 지웁니다

### 13-4. 토큰이 끊겼을 때 (메일함 주인이 비밀번호를 바꾼 뒤 등, 약 10분, M8)

회신 탭에 빨간 띠가 뜨거나 운영 알림이 오면 둘 중 하나로 합니다. 보안 비밀은 만들 때 한 번만 보이고 11번에서 메모도 지웠으므로, 다시 구하는 길을 고릅니다.

- **(가) CloudType에 넣어 둔 보안 비밀을 다시 쓰기** (권장): CloudType → 해당 서버 → 설정 → 환경 변수 → `REPLY_GOOGLE_CLIENT_SECRET` 값 복사 → 7번(Playground 톱니바퀴에 ID·보안 비밀) → 8~9번(새 Refresh token) → CloudType의 `REPLY_GOOGLE_REFRESH_TOKEN`만 바꾸고 **배포하기** → 회신 탭 띠가 정상으로 돌아오는지 확인 → 메모 지우기
- **(나) 새 보안 비밀 만들기** (CloudType 값을 볼 수 없을 때): Cloud 콘솔 → Google 인증 플랫폼 → **클라이언트** → `sendb-reply` → **보안 비밀 추가** → 새 값 메모 → 7~9번을 새 값으로 → CloudType의 `REPLY_GOOGLE_CLIENT_SECRET`과 `REPLY_GOOGLE_REFRESH_TOKEN` **둘 다** 바꾸고 배포 → 띠가 정상이 되면 콘솔에서 옛 보안 비밀 **사용 중지** → 메모 지우기
- 운영·개발 두 서버에 넣었다면 두 곳 다 바꿉니다

### 13-5. (막혔을 때만) 구글 관리 콘솔

admin.google.com → **보안 → 액세스 및 데이터 관리 → API 제어** → **타사 앱 액세스 관리** → **앱 구성 → OAuth 앱 이름 또는 클라이언트 ID** → 6번 클라이언트 ID 검색 → 선택 → 액세스 **신뢰할 수 있음** → 구성. 그 뒤 8번부터.

### 13-6. 끊고 싶을 때

myaccount.google.com → 보안 → **타사 앱 및 서비스 연결** → `Sendb 회신 읽기` → 모든 연결 삭제. 또는 13-1의 클라이언트를 지웁니다. 샌드비는 다음 회차부터 아무것도 읽지 못하고 빨간 띠를 띄웁니다.

### 13-7. 나중에 다른 메일함으로 옮길 때

13-0과 같은 순서입니다: 라이선스 사용자 만들기 → 별칭 옮기기 → 라우팅 규칙 받는 곳 바꾸기 → 시험 메일 확인 → 새 메일함 계정으로 7~9번 → `REPLY_MAILBOX`(기본 주소 그대로)와 `REPLY_GOOGLE_REFRESH_TOKEN`을 바꾸고 배포 → 거슬러 읽기 끝남 확인 → 옛 연결 끊기. 코드는 그대로입니다.

## 14. 배포 순서 (사람이 할 일)

1. 로컬 시험 통과 (15절) → 대표 승인 → 메인 세션이 dev 커밋·push → CloudType `sendb-dev` 배포 → 로그 `[migrate] 마이그레이션 완료!`와 `[indexes] email_send_logs 색인 준비됨`(DESIGN-SND 8-3)
2. **대표 결정 (M2, 2-1)**: (가) 회신 전용 메일함 먼저 — 13-0 (권장) / (나) `ceo@` 토큰을 개발 서버 시험에만 잠깐 (경고 승인). 어느 쪽이든 **운영 서버에는 13-0이 끝난 뒤에만** 토큰을 넣는다
3. 대표님 13-1~13-3 (개발 서버, `dry_run`, 알림 `off`, 시험 전용 주소 하나, 직원 주소, 거슬러 읽기 0)
4. 개발 서버 Scheduler 추가: `POST https://port-next-sendb-dev-1ru12mlw8nvyar.sel5.cloudtype.app/api/email/replies/sync`, `30 */5 * * * *`, `X-Secret`
5. **실제 회신 시험** (대표 승인 필요 — 개발 서버 발송도 실제로 나간다): 시험 파티션(83 "발송 시험")에서 **시험 전용 주소로** 직원 주소에 시험 메일 → 직원이 (가) 그냥 답장 (나) 부재중 자동응답 켠 계정 (다) 없는 주소 하나(반송) (라) Outlook·Gmail 웹에서 HTML로 답장(인용 포함) → 10분 안에 회신 탭 확인
   - 확인 1: (가)가 `match_method='thread'`로 이어졌나 → NHN Message-ID 앞부분 = 요청 번호 가정 확인 (6-1)
   - 확인 2: 보조 도메인 시험 주소로 온 답장의 To가 `cs@…`로 남는가 (라우팅 규칙 메일 머리글)
   - 확인 3: (다)의 DSN이 `hard`로 읽히고 발송 이력이 실패로 바뀌나 (on 단계에서). **그 반송 메일의 MIME 부분 모양**(부분마다 형식·`body.data`인지 `attachmentId`인지·크기)을 서버 로그 한 줄로 남겨 4-2 첨부 예외가 필요한지 확인한다 — 형식·크기만, 내용 없음 (M9)
   - 확인 4: (라)의 발췌에 인용·우리 꼬리말이 없고 `unsubscribe_hint=false`인가 (m4)
   - 확인 5: 회신 탭 띠의 "뺀 주소" 목록에 메일함 쪽 주소가 보이고, 그 주소로 온 메일이 저장되지 않았나 (B1)
6. 개발 서버 `REPLY_SYNC_MODE=on`(시험 서버 제한이 다 있어야 켜진다), 시험 후속이 걸린 시험 레코드로 멈춤 확인 → 시험 스페이스 웹훅으로 `REPLY_ALERT_MODE=live` 카드 1건 확인 → 시험 끝나면 개발 서버 `REPLY_SYNC_MODE=off`, Scheduler 끔. (나) 길이면 **여기서 `ceo@` 연결을 끊고**(13-6) 개발 서버 환경 변수에서 토큰을 지운다
7. 운영 반영 (개발팀이 main에 합친 뒤, **13-0이 끝난 뒤에만**): 운영 환경 변수에 `reply@` 토큰, `REPLY_PRIVATE_DOMAINS`·`REPLY_SHARED_DOMAIN_ADDRESSES`(운영 값), `REPLY_SYNC_MODE=dry_run`, `REPLY_ALERT_MODE=dry_run`. `REPLY_SENDER_EMAILS`·`REPLY_ALLOWED_FROM`은 **넣지 않는다** → Scheduler `POST https://sendb.kr/api/email/replies/sync` 5분
8. dry_run 이틀 확인: 회신 탭에서 이어짐 비율·미분류·애매함·잘못 이은 줄이 없는지, "멈출 예정" 숫자, 카드 미리보기, 띠의 "뺀 주소"가 기대와 같은지
9. `REPLY_SYNC_MODE=on` (밀린 효과가 14일치 적용됨) → 하루 뒤 `REPLY_ALERT_MODE=live`. 사업 스페이스 웹훅(`DEEP_ALERT_WEBHOOK_URL_8`·`_9`·`_14`)은 깊이 알림과 같은 것을 쓴다 — 아직 없으면 스페이스 관리자가 발급
10. 개발 서버는 `off` 유지 (한 메일함 한 환경. 켜더라도 시험 서버 제한 때문에 직원 시험 메일만 다룬다)

## 15. 로컬 검증 계획 (가짜 Gmail, 실제 Google·NHN 호출 0)

### 15-1. 순수 시험

`npm test` (`tsx --test "src/**/*.test.ts"`) — `email-reply-rules.test.ts`, `gmail-client.test.ts`, 바뀐 대기열 판정 시험(`email-send-queue-rules.test.ts`에 회신 막기 경우). 그 밖에 `node_modules/.bin/tsc --noEmit`, `node_modules/.bin/eslint`, `npm run build`.

### 15-2. 가짜 Google (`.testenv/mock-fetch.mjs`에 더함)

- `oauth2.googleapis.com /token`: `refresh_token`이 픽스처의 시험 값이면 `{access_token:"fake-access-<n>", expires_in:3600}`, 픽스처 `tokenError`면 400 `{"error":"invalid_grant"}`
- `gmail.googleapis.com`: 픽스처 `.testenv/fake-gmail.json`(시나리오 스크립트가 회차마다 다시 씀)에서 답한다
  - `profile` → `{emailAddress, historyId}`
  - `history` → `startHistoryId` 뒤 기록, 픽스처 `history404`면 404, `rate429Once`면 한 번 429
  - `messages`(목록) → `after:`/`before:`를 `internalDate`로 걸러 최근 것부터
  - `messages/{id}` → `format=metadata`면 `metadataHeaders`에 적힌 머리글만, `format=full`이면 parts 포함. 픽스처의 부분에 `asAttachment:true`가 있으면 그 부분은 `body:{attachmentId, size}`만 준다 (Gmail 실제 모양, M9)
  - `messages/{id}/attachments/{aid}` → 그 부분의 `{size, data}`
  - **개인정보 감시**: `private:true`인 메시지(채용 제안·급여 카나리아 `CANARY-연봉-7731`)에 `format=full`·`metadataHeaders=From`·`attachments` 요청이 오거나, 1단계 요청에 허용 7개 밖의 `metadataHeaders`·`fields`에 `snippet`이 있거나, 반송·시스템 안내가 아닌 메시지 또는 64KB 넘는 부분에 `attachments` 요청이 오면 `{service:"gmail", kind:"PRIVACY_VIOLATION", id}`를 남기고 403
  - 기록은 경로와 메시지 번호만 남긴다 (머리글 값·본문을 mock-log에 쓰지 않는다)
- 구글 챗은 지금 가짜 그대로 (`TEST-A` 스페이스로 카드 글자 기록)

### 15-3. 시나리오 (`.testenv/rpl-scenario.ts`, 시험 DB `salesflow_test`만)

서버는 기존처럼 `NODE_OPTIONS=--import F:/Dev/salesflow/.testenv/mock-fetch.mjs`로 띄우고, 가짜 값 환경 변수: `REPLY_GOOGLE_*=test-…`, `REPLY_MAILBOX=ceo@matchesplan.test`, `REPLY_PRIVATE_DOMAINS=alias-ceo.test`, `REPLY_WORKSPACE_IDS=<시드 A·B·C>`, `DEEP_ALERT_WEBHOOK_URL_<A>=https://chat.googleapis.com/v1/spaces/TEST-A/messages?key=fake`. 로컬 서버는 "시험 서버"라 대부분의 시나리오는 시험 서버 제한을 끄는 시험 전용 값 `REPLY_TEST_ASSUME_PRODUCTION=1`로 운영처럼 돌리고, RS23만 이 값 없이 돈다. 이 값은 `DATABASE_URL`의 호스트가 `127.0.0.1`·`localhost`일 때만 읽는다 (`resolveReplyConfig`가 확인) — 원격 DB를 쓰는 CloudType 개발 서버에서는 넣어도 무시된다. 스크립트가 시드 조직 A의 레코드에 발송 기록(요청 번호 `mock-…`)·후속 사슬·대기열 줄을 넣고, 픽스처를 쓰고, `POST /api/email/replies/sync`(시험 `CRON_SECRET`)를 부른 뒤 DB를 확인한다. 반송 시나리오는 SND의 `recordBounceSignal`까지 실제로 돈다 (두 설계를 합쳐 시험).

| 시나리오 | 픽스처 | 기대 (R 번호) |
|---|---|---|
| RS1 스레드 회신 | To `hello1@dh-mail1.test`, In-Reply-To `<mock-…@mock-nhn>` | thread로 이어짐, 사건 1, 대기 후속 cancelled(replied), 카드 1 (R17·R23·R32) |
| RS2 머리글 없는 회신 | 같은 사람, 스레드 머리글 없음, 제목 `RE: (시험)…` | fallback_subject (R18) |
| RS3 동료 답장 | `info@co.test`로 보낸 발송에 In-Reply-To 맞음, From `kim@co.test` | 이어짐, contact = `kim@`, matched_recipient = `info@`. **`info@`의 대기 후속도 cancelled(replied)**, 그 뒤 `info@`로 가는 AI 첫 메일·후속도 막힘 (R17·R48) |
| RS4 부재중 | `Auto-Submitted: auto-replied`, 제목 "자동 회신:" | auto_reply, 멈춤·사건·카드 0 (R12·R28) |
| RS5 DSN 5.1.1 | multipart/report, 원본 머리글 Message-ID | 장부 줄 kind=bounce·hard, SND 신호 1줄(`recipient_match='same'`), 발송 `failed`·`delivery_fail_source='dsn'`·`result_code='DSN:5.1.1'`, 사건 email_bounce, 그 주소의 대기 후속은 **처리 차례에** cancelled(bounced) (R13·R21·R29) |
| RS5b DSN 부분이 첨부 모양 | RS5와 같은데 `message/delivery-status`·`text/rfc822-headers`가 `asAttachment:true` (2KB) | `attachments` 요청 2, RS5와 같은 결과, PRIVACY_VIOLATION 0 (R51) |
| RS5c 반송과 NHN 순서 | RS5를 (가) 반송 → NHN SST2 (나) SST2 → 반송 (다) NHN 결과 전 반송 순서로 | (가)(나) 실패 한 번만, `status='failed'` 유지 (다) NHN 결과 전에는 미확정 — DESIGN-SND V7과 같은 경우 (R29) |
| RS5d 전달받은 주소의 반송 | 원본 Message-ID는 우리 발송, Final-Recipient는 다른 주소 | 신호 `recipient_match='different'`, 발송 그대로, 막기 0 (R49) |
| RS6 DSN 4.4.7 delayed / failed+4.4.7 / 네이버식 안내 | | soft / expired / unknown. soft·unknown은 발송 그대로, expired는 SND가 실패로 세지만 막기 0 (R13·R14) |
| RS7 남의 메일 | To `ceo@matchesplan.test`, 제목·본문에 카나리아 | 저장 0, 2단계 요청 0, PRIVACY_VIOLATION 0, DB·mock-log·서버 로그에 카나리아 0 (R5·R6·R7) |
| RS7b 메일함 주소가 프로필에 (B1) | 시드 발신 프로필 `from_email = ceo@matchesplan.test`, `email_configs.from_email = hr@matchesplan.test`, `hr@alias-ceo.test` 프로필 하나. 카나리아 메일 셋: To `ceo@…`(Delivered-To `ceo@…`), To `hr@matchesplan.test`, To `hr@alias-ceo.test` | 세 카나리아 모두 `format=full` 요청 0·저장 0·PRIVACY_VIOLATION 0. 상태 `stats.excluded`에 3개, 회신 탭 띠에 "뺀 주소 3개" (R50) |
| RS7c 허용한 공용 주소 | `REPLY_SHARED_DOMAIN_ADDRESSES=cs@alias-ceo.test`, To `cs@alias-ceo.test` 회신 (스레드 맞음) | 우리 것, 이어짐 (R50) |
| RS8 도메인만 같은 메일 | To `info@dh-mail1.test`, 스레드 없음 / 스레드 있음 | 저장 0 / 이어짐 domain_thread (R6) |
| RS9 다른 조직 주소 | To `hello@other-company.test` (시드 조직 B) | 저장 0 (R11) |
| RS10 두 번 읽기 | 같은 메일을 history에 두 번 + 두 회차 | 줄·사건·카드 각 1 (R30) |
| RS11 dry_run → on | dry_run에서 RS1 → on 회차 | dry_run 때 대기열 그대로, on 뒤 멈춤, 카드 0 (R31·R33) |
| RS12 처리 중 경쟁 | 후속 줄을 processing으로 둔 채 회신 → 워커 회차 | 그 줄 cancelled(replied), NHN 발송 0 (R25·R26) |
| RS13 history 404 / 429 / invalid_grant / 주인 다름 | | 놓침 0·커서 유지·auth 상태·읽기 0 (R3·R4·R37·R40) |
| RS14 수신거부 말 | 본문 "수신거부 부탁드립니다" | hint, 카드 경고 줄, 91일 뒤에도 막기 (R15·R26) |
| RS15 다른 사업 같은 주소 | 같은 주소가 워크스페이스 B에도 대기 후속 | B 후속은 pending 그대로 (R24) |
| RS16 같은 기본 주소, 두 사업, 스레드 머리글 없음 (M4) | 조직 기본 주소로 사업 A(7일 전)·사업 B(2일 전)에 같은 사람에게 발송. 회신은 스레드 머리글 없음, 제목 (가) 둘 다와 다름 (나) A 제목과 같음 | (가) `ambiguous`·`fallback_multi_ws`, 효과·카드 0, A·B 후속 그대로 (나) A에 `fallback_subject`로 이어짐, A 후속만 멈춤 (R52) |
| RS17 제목에 "반송"이 든 사람 회신 (M5) | 제목 `Re: 제품 반송 문의`, 자동 머리글 없음, 보통 From | human, 멈춤·카드 있음 (R53) |
| RS18 "출장 중" 사람 답장 (M5) | 본문 "출장 중이라 복귀 후 연락드리겠습니다", 자동 머리글·자동응답 제목 없음 | human (R53) |
| RS19 분류 고치기 (M5) | RS4의 자동응답 줄(효과 `auto_reply`로 적용됨)을 PATCH `kind='human'` | 그 자리에서 7-2 적용: 후속 cancelled(replied), 사건 1, `effects_applied_kind='human'`. 다시 PATCH해도 사건 1 (R54) |
| RS20 지워진 레코드에 이어진 회신 (M6) | 발송 기록의 `record_id`가 지워진 레코드. 같은 회차에 다른 정상 회신 1통 | 첫 줄 `record_id=NULL`, 사건 0, 멈춤은 받는 주소로 됨. 다음 정상 회신도 처리되고 커서 넘어감. 데이터 오류 흉내: 시나리오 스크립트가 시험 DB에만 `ALTER TABLE email_replies ADD CONSTRAINT rs20_force CHECK (subject NOT LIKE '%FORCE-DB-ERROR%')`를 걸고 그 제목의 회신을 넣으면 → 그 메일만 `kind='unknown'`·`process_error='23514 …'`(제목 없이), 같은 회차 다른 메일은 정상, 회차 200, 커서 넘어감. 끝나면 제약을 지운다 (R55) |
| RS21 내부 직원 전체 답장 (m6) | From = 시드 조직 사용자 주소, Cc `cs@dh-mail1.test`, 스레드 맞음 | kind=internal, 효과·카드·막기 0 (R56) |
| RS22 스팸 신고·읽음 확인 (m7) | `multipart/report; report-type=feedback-report` / `disposition-notification` | system. feedback-report는 SND 신호 `kind='complaint'` 1줄, 발송 그대로. 카드·멈춤 0 (R57) |
| RS23 시험 서버 제한 (M1) | `REPLY_TEST_ASSUME_PRODUCTION` 없이: (가) `REPLY_ALLOWED_FROM` 없음 (나) 직원 주소만 있음 + `REPLY_SYNC_MODE=on`, `REPLY_SENDER_EMAILS` 없음 (다) 둘 다 있음 + on | (가) 우리 것이어도 1.5단계에서 모두 버림, 저장 0, `format=full` 0 (나) 직원이 보낸 메일만 저장, 모드는 dry_run으로 돌고 띠 경고 (다) on으로 돎, 직원 메일만 효과 (R58) |
| RS24 보류 줄도 멈춤 (SND-01) | 대기 후속이 `held`(명단 보류) 상태일 때 회신 → 보류 풀기 | 회신 때 `held` → cancelled(replied), 풀어도 나가지 않음 (R23) |
| RS25 HTML 인용 속 우리 꼬리말 (m4) | `text/html`만, 첫 줄 "네 검토해 볼게요", 그 아래 `<div class="gmail_quote">` 안에 우리 원래 메일과 꼬리말 "…수신거부를 눌러주세요" | 발췌 = "네 검토해 볼게요", `unsubscribe_hint=false` (R16·R15) |
| RS26 허용 목록 밖 워크스페이스 (m8) | 조직 A의 워크스페이스 D(허용 목록 밖) 발송에 스레드로 이어진 회신 | 저장 0, `outOfScope` 1 (R59) |
| RS27 옛 주소로 온 회신 (m2) | 발신 프로필을 지운 뒤, 그 주소로 30일 전 나간 발송에 대한 회신 | 주소 모음(최근 90일 발송 주소)에 있어 우리 것, 이어짐 (R60) |
| RS28 토큰 끊김 운영 알림 (M7) | `REPLY_OPS_WEBHOOK_URL` 없음, `SEND_HEALTH_WEBHOOK_URL=…/TEST-OPS/…`, 픽스처 `tokenError` | 운영 알림 1통이 TEST-OPS로, 6시간 안 다시 0 (R4·R61) |

### 15-4. 실데이터 사본에서 잴 것 (대표님이 사본을 만든 뒤에만, 쓰기 없음)

`salesflow_real`에서 6-1·6-2·4-1(3) 조회를 `EXPLAIN (ANALYZE, BUFFERS)`로 잰다 (주소 20개·요청 번호 20개 배열) — DESIGN-SND 8-3 색인이 **있을 때와 없을 때** 둘 다. `email_send_logs` 줄 수와 시간을 남긴다. 색인이 있는데도 1초를 넘으면 6-2의 조회를 다시 연다. 이 사본으로 서버를 띄울 때도 가짜 하네스를 켠다.

## 16. behavior 목록

| ID | 내용 |
|---|---|
| R1 | 모드 값이 없거나 오타면 `REPLY_SYNC_MODE`·`REPLY_ALERT_MODE` 모두 dry_run. `off`면 토큰·Gmail 호출 0 |
| R2 | 비밀값 셋 중 하나라도 없으면 `{configured:false}`, 외부 호출 0 |
| R3 | `getProfile` 주소가 `REPLY_MAILBOX`와 다르면 메시지 요청 0, 상태 `mailbox_mismatch` |
| R4 | `invalid_grant`면 상태 `auth`, 운영 알림 6시간에 1번, 응답·로그·DB에 토큰·보안 비밀 글자 0 |
| R5 | 1단계 요청은 `format=metadata` + 받는 사람·스레드 머리글 7개만 + `fields`에 snippet 없음 |
| R6 | 도메인만 같고 스레드가 우리 발송에 이어지지 않으면 2단계 요청 0, 저장 0. 이어지면 `domain_thread`로 저장 |
| R7 | 남의 메일 내용(카나리아)이 `email_replies`·`record_events`·mock-log·서버 로그 어디에도 없다. 상태에는 건수만 |
| R8 | SENT·DRAFT·CHAT 라벨, 보낸 사람이 메일함 주인·우리 발신 주소인 메일은 건너뛴다 |
| R9 | 스팸 라벨이고 못 이은 메일은 저장하지 않는다. 스팸이라도 이어지면 저장 |
| R10 | `REPLY_SENDER_EMAILS`가 있으면 그 주소로 온 것만 우리 것 |
| R11 | 허용 워크스페이스의 조직 발신 주소만 본다 — 다른 조직 주소로 온 회신은 저장 0 |
| R12 | `Auto-Submitted`(no 아님)·`X-Autoreply`·`Precedence: auto_reply|bulk|junk|list`·`Return-Path: <>`·제목 "자동 회신:"·"부재중"·"Out of Office" → auto_reply. **본문 글만으로는 auto_reply가 아니다.** `Auto-Submitted: no`는 사람 |
| R13 | delivery-status를 읽어 `Final-Recipient`·`Original-Recipient`·`Status`·`Action`·`Diagnostic-Code`. 등급은 SND `classifyDsn` 하나: failed+5.x.x → hard, failed+4.x.x → expired, delayed·그 밖 4.x.x → soft |
| R14 | MAILER-DAEMON이지만 delivery-status가 없는 반송은 unknown, 발송 상태 그대로 |
| R15 | 수신거부 말이면 `unsubscribe_hint`, 분류는 human 그대로, 수신거부 목록은 건드리지 않음. 인용·우리 꼬리말 문장·수신거부 URL 줄은 검사 전에 지운다 |
| R16 | 발췌는 인용(>, Original Message, On … wrote:, "… 작성:", HTML `blockquote`·`.gmail_quote`·`#divRplyFwdMsg`와 그 뒤) 앞까지, 저장 500·카드 300자, EUC-KR·RFC 2047이 깨지지 않음 |
| R17 | In-Reply-To의 로컬 부분(또는 앞 22자)이 요청 번호면 thread로 잇는다. 보낸 사람이 달라도 잇는다 |
| R18 | 스레드 머리글이 없으면 (보낸 사람 = 받은 사람, 받은 주소 = 보낸 주소, 60일) 중 제목이 같은 가장 최근, 없으면 가장 최근 |
| R19 | 61일 전 발송만 맞으면 unmatched |
| R20 | 같은 받는 사람이 두 조직 기록에 있으면 회신이 온 주소의 조직 것만. 두 허용 조직이 다 맞으면 ambiguous, 효과·카드 0 |
| R21 | 반송은 원본 Message-ID(RPL이 찾아 `threadLogId`로 넘김) → 없으면 SND가 (반송된 주소 = 받은 사람, DSN 받는 주소 = 보낸 주소, 7일) |
| R22 | `sender_email`이 없는 예전 기록은 프로필의 지금 주소로 비교한다 |
| R23 | on 사람 회신: 사건 `reply` 1(레코드가 있을 때), 그 사업·그 주소(보낸 사람·원래 받은 사람)의 `pending`·`held` 후속 cancelled(replied), 그 레코드 템플릿 대기열 cancelled(replied), 발송 대기열 skipped("회신으로 멈춤") |
| R24 | 다른 사업의 같은 주소 대기 줄은 그대로 |
| R25 | processing 줄은 건드리지 않고, 그 줄은 보내기 직전 막기로 cancelled(replied), 나간 메일 0 |
| R26 | on에서 같은 사업·같은 주소(보낸 사람 또는 원래 받은 사람)의 사람 회신 90일 안(수신거부 말이면 기한 없음), 또는 같은 조직·같은 주소의 hard 반송(받는 사람 같음, 적용됨) 90일 안이면 후속·반복·템플릿 자동(첫 메일 줄 포함)·AI 첫 메일·대기열 미리 판정 모두 멈춤. 수동 발송은 막지 않음. dry_run에서는 막지 않음 |
| R27 | "자동 메일 다시 허용"을 누르면 그 회신은 막기에서 빠지고, 이미 멈춘 줄은 살아나지 않음 |
| R28 | 자동응답은 기록만 (멈춤·사건·카드 0) |
| R29 | on hard 반송: RPL은 `email_send_logs`를 직접 쓰지 않고 SND `recordBounceSignal`만 부른다. 받는 사람이 같으면 SND가 `failed`·`delivery_fail_source='dsn'`·`DSN:5.x.x`(실패는 한 번만), 사건 `email_bounce`. 대기 줄은 미리 고치지 않고 처리 차례에 막기로 cancelled(bounced). NHN 결과와의 순서 세 가지 모두 같은 결과 |
| R30 | 같은 메일을 몇 번 읽어도 줄·사건·멈춤·카드 각 1 |
| R31 | dry_run은 줄과 "멈출 예정" 숫자만. on으로 바꾸면 14일 안 dry_run 줄에 효과 적용, 카드 0 |
| R32 | live 카드: 첫 줄 기한, 둘째 줄 연락 요약, 규칙·단계, 발췌 300자 이하, 멈춘 수, 수신거부 경고(조건). Cc·인용·다른 메일 내용 0, `<` `>` 바꿈, 3,800자 자름 |
| R33 | 알림 dry_run은 `alert_message`만, 나중에 live로 바꿔도 보내지 않음. 24시간 넘은 회신은 skipped |
| R34 | 웹훅 429·5xx 3번까지 10분 뒤, 401·403·404는 시도로 세지 않고 되돌림, 24시간 지나면 닫음 |
| R35 | 못 이은 사람 회신은 그 주소를 60일 쓴 사업이 하나일 때만 "못 이은 회신" 카드, 아니면 카드 0 |
| R36 | 잠금을 못 잡으면 `skippedAsLocked`, Gmail 호출 0 |
| R37 | history 404면 마지막 성공 1시간 전부터 목록으로 이어 읽어 놓침 0, historyId 새로 잡음 |
| R38 | 처음 회차는 historyId를 먼저 잡고 14일을 회차마다 이어 거슬러 읽는다. 끝나면 `backfill_done_at` |
| R39 | 한도(1단계 500·본문 50·4분)에 닿으면 처리한 데까지만 커서를 옮기고 다음 회차가 이어 간다 |
| R40 | 429면 그 회차를 멈추고 처리 안 한 데부터 다음 회차가 읽는다 |
| R41 | `CRON_SECRET`이 틀리면 401, Gmail 호출 0 |
| R42 | 발송 이력 줄에 회신·자동응답·반송 배지, "회신 있음" 거르개 |
| R43 | AI 규칙 카드·템플릿 자동발송 목록에 28일 회신 수 |
| R44 | 레코드 상세에 "회신함" 배지, 여정에 '회신'·'반송' 사건 |
| R45 | 회신 탭은 볼 수 있는 파티션의 회신만, 미분류·애매함은 관리자만. [처리함]이 `handled_at`을 남긴다. 위 띠에 연결 상태 |
| R46 | 후속 큐 화면 취소 배지에 (회신)·(반송) |
| R47 | 단계 글자: 첫 메일 / n번째 후속 (첫 메일 +d일), 규칙은 사슬 첫 메일에서 찾는다 (AI 후속 기록에 규칙 번호가 없어도) |
| R48 | 동료·같은 회사 다른 주소의 회신이면 `matched_recipient`(원래 받은 사람)와 `contact_email`(보낸 사람) 둘 다 멈추고 막는다 (M3) |
| R49 | 반송의 Final(없으면 Original)-Recipient가 이어진 발송의 받는 주소와 다르면 신호만 남고 발송은 그대로, 막기 0 (M3) |
| R50 | 메일함 주소·`getProfile` 주소·메일함 쪽 도메인(`REPLY_MAILBOX` 도메인·`REPLY_PRIVATE_DOMAINS`) 위의 주소는 프로필·`email_configs`·발송 기록에 있어도 우리 주소가 아니다 (`REPLY_SHARED_DOMAIN_ADDRESSES`만 예외). `Delivered-To`·`X-Original-To`의 메일함 주소로는 아무것도 우리 것이 되지 않는다. 뺀 주소는 띠에 보인다 (B1) |
| R51 | 반송·시스템 안내의 보고 부분 4종이 첨부 모양(64KB 이하)이면 그 부분만 `attachments.get`. 그 밖의 첨부·큰 부분·다른 메일에는 `attachments.get` 0 (M9) |
| R52 | 대체 짝짓기 후보가 여러 워크스페이스에 걸치고 제목으로 하나가 정해지지 않으면 ambiguous, 효과·카드 0 (M4) |
| R53 | 제목의 반송 말만으로는 bounce가 아니고(Return-Path `<>` 또는 MAILER-DAEMON·postmaster일 때만), 본문 글만으로는 auto_reply가 아니다. 애매하면 human (M5) |
| R54 | 분류를 human으로 고치면 `effects_applied_kind`가 human이 아닐 때 7-2가 그 자리에서 돈다. 여러 번 고쳐도 사건 1 (M5) |
| R55 | 이어진 발송의 레코드가 지워졌으면 `record_id` NULL·사건 0. 메일 하나의 데이터 오류는 그 메일만 unknown 최소 줄로 남기고 커서를 넘긴다. 연결 오류만 회차를 멈춘다 (M6) |
| R56 | 보낸 사람이 조직 사용자이거나 메일함 쪽 도메인 주소면 internal, 효과·카드·막기 0 (m6) |
| R57 | delivery-status가 아닌 multipart/report는 system. feedback-report는 SND 스팸 신고 신호 (m7) |
| R58 | 시험 서버(운영 origin이 아님): 1.5단계로 `REPLY_ALLOWED_FROM` 메일만 2단계·저장, 값이 없으면 저장 0. `on`·`live`는 `REPLY_SENDER_EMAILS`·`REPLY_ALLOWED_FROM` 둘 다 있을 때만, 거슬러 읽기 최대 1일 (M1) |
| R59 | 이어진 발송의 워크스페이스가 `REPLY_WORKSPACE_IDS` 밖이면 저장 0 (m8) |
| R60 | 최근 90일 발송의 `sender_email`도 주소 모음에 든다 (지운 프로필의 옛 주소) (m2) |
| R61 | 운영 알림은 `REPLY_OPS_WEBHOOK_URL` → `SEND_HEALTH_WEBHOOK_URL` → `DEEP_ALERT_WEBHOOK_URL` 순서로 보낸다. on인데 마지막 성공이 6시간을 넘으면 알림. SND 매일 보고에 회신 읽기 마지막 성공 줄 (M7) |
| R62 | 효과 차지와 알림 줄은 한 트랜잭션. on으로 저장된 줄의 밀린 효과는 도착 24시간 안이면 카드를 만든다 (m1) |
| R63 | 템플릿 첫 메일이 막히면 `TemplateFirstOutcome` `stopped` → 첫 메일 줄도 cancelled+stop_reason. `processRepeatItem`의 마지막 update는 모두 `status='pending'`일 때만 (m5) |

## 17. 범위 밖 · 확인 필요 · 바꿀 수 있는 결정

**범위 밖 (이번에 하지 않음)**
- AI 분류(RPL-2 관심·나중에·거절·담당 아님) — 규칙 분류 1판 뒤 견본이 쌓이면. 분류 칸 `kind`는 그대로 두고 새 칸을 더한다
- 수신거부 요청 자동 반영 — AI 분류와 함께
- 부재중 복귀일 뒤로 후속 미루기 (RPL-2 표) — 지금은 자동응답이면 아무것도 바꾸지 않는다
- 답장 초안(RPL-3), 같은 대화로 잇기(SEQ-6), "같은 회사 다른 사람 회신" 멈춤 (처음 값 끔)
- 조직 단위 반송 막기 목록(SND-2) — 이 문서는 자동 메일 경로의 90일 막기(조직 단위, `email_bounce_signals`)까지. 수동 발송·가져오기 거르기는 SND-2가 같은 신호 표를 재료로 쓴다
- 회신을 손으로 발송에 잇는 버튼 (애매함·미분류 줄) — 다음 판
- 매일 보고의 회신 줄(MEA-3) — 숫자는 `email_replies`·`stats` API로 바로 나온다
- Gmail 푸시(watch + Pub/Sub), 발췌 보관 기한(지금은 지우지 않음), MCP `list_replies` 도구
- 발신 건강(실패율 판정·멈춤·알림)은 같은 폴더 다른 설계 (0075, 잠금 08)

**확인 필요** (첫 실제 회신으로)
1. NHN Message-ID = `<요청 번호@호스트>`인가 (6-1). 아니면 다음 판에서 `resultId` 저장
2. 보조 도메인 라우팅 메일의 `To`가 `cs@<도메인>`으로 남는가, `X-Gm-Original-To`가 붙는가 (4-2)
3. 보조 도메인 실제 수신 (MX 작업 메모상 아직 미검증)
4. 회신 규모 — dry_run 이틀 숫자로 PRD 관문(주 10건)을 바로 본다
5. 반송 안내의 MIME 부분 모양 — 보고 부분이 `body.data`로 오는지 `attachmentId`로 오는지 (14절 5번 확인 3, M9)
6. 대표 계정 별칭 도메인 목록 — `REPLY_PRIVATE_DOMAINS` 운영 값을 관리 콘솔 값으로 확정 (B1)

**대표 결정 필요 (이 문서를 구현하기 전)**
1. **회신 전용 메일함** (2-1, M2): (가) `reply@` 라이선스 사용자를 만들고 토큰은 그것만 (권장, 라이선스 1개 비용) / (나) `ceo@` 토큰을 개발 서버 시험에만 잠깐 (경고 승인). 운영은 어느 쪽이든 (가)가 끝난 뒤
2. **회신 읽기가 오래 멈췄을 때 후속을 미룰지** (M7): 1판은 알림만 한다 (운영 알림 + 매일 보고). 권장: on 모드에서 마지막 성공이 6시간을 넘으면 후속·AI 첫 메일을 "회신 확인 대기"로 미루는 장치를 다음 판에 둔다 — 토큰이 끊긴 동안 회신한 사람에게 후속이 가는 일을 막지만, 잘못 켜지면 발송 전체가 멈추므로 대표님이 고른다

**바꿀 수 있는 결정 (한 줄 이유)**
- OAuth 갱신 토큰 — 메일함 하나만, 콘솔 단계가 적다 (2절). 그 메일함은 회신 전용 (2-1)
- 1단계에서 보낸 사람·제목도 읽지 않음 — 남의 메일은 받는 사람·스레드 번호만 본다 (4-2)
- 메일함 쪽 도메인 주소는 기본으로 우리 주소에서 뺌 — 공용 주소는 환경 변수로 하나씩 허용 (4-1, B1)
- 시험 서버는 직원이 보낸 메일만 저장 — 개발 DB에 실제 고객 회신이 들어가지 않게 (3절, M1)
- Message-ID를 새로 저장하지 않음 — 요청 번호로 잇고 첫 회신으로 확인 (6-1)
- `email_send_logs` 색인은 부팅 뒤 CONCURRENTLY 단계가 만든다 — 마이그레이션 트랜잭션에서는 잠김. 두 문서 같은 결론 (0절, DESIGN-SND 8-3)
- 반송은 SND 한 곳이 발송 기록을 쓰고, 반송 뒤 멈춤은 보내기 직전 막기 하나로 (7-3, B2)
- 애매하면 사람 회신 — 잘못 멈추는 손해가 회신을 놓치는 손해보다 작다 (5절, M5)
- 문의 첫 메일도 멈춤·막기 — 스킬 "답장하면 사람이 이어받는다". 되돌리는 두 곳은 7-4
- 알림톡은 멈추지 않음 — 다른 채널·거래성 알림 (7-2)
- 막기 90일, 같은 사업만 — 대화 중인 사람에게 자동 메일을 다시 보내지 않되, 다른 사업 재접촉은 막지 않는 방침
- 회신 카드는 근무시간 밖에도 바로 — 회신은 드물고 당일 응대가 목표 (8절)

## 18. 검토 반영 (2026-10-11 1차 검토)

| ID | 등급 | 문제 (한 줄) | 반영 | 자리 |
|---|---|---|---|---|
| B1 | 막힘 | 메일함 주소·메일함 쪽 도메인 주소가 "우리 발신 주소"에 들어가면 `Delivered-To`로 채용·급여 메일까지 읽힌다 | 주소 모음에서 `REPLY_MAILBOX`·`getProfile` 주소·메일함 도메인·`REPLY_PRIVATE_DOMAINS` 위 주소를 늘 뺀다 (`REPLY_SHARED_DOMAIN_ADDRESSES`만 예외). 메일함 쪽 값은 판정에 쓰지 않는다. 뺀 주소는 띠에. 시험 RS7b(프로필 = 메일함 주소, `email_configs` = 메일함 도메인 주소 → `format=full` 0·저장 0) | 0절, 3절, 4-1, 4-2, 11절, R50 |
| B2 | 막힘 | DSN 처리 약속이 SND와 정반대, 색인 결론도 어긋남 | RPL은 알아보기·풀기·장부 줄만, `email_send_logs` 쓰기·대체 짝짓기(7일)·실패 셈은 SND `recordBounceSignal` 하나. hard/soft는 SND `classifyDsn` 하나(hard·expired·soft·unknown). 판정은 `delivery_fail_source`, `result_code`는 표시용 `DSN:x.y.z`. 반송 뒤 멈춤은 7-4 막기가 `email_bounce_signals`를 읽는다(조직 단위). 색인은 두 문서 모두 "부팅 뒤 CONCURRENTLY 단계(SND 8-3)" | 0절, 1절, 5절, 6-2, 7-3, 7-4, 9절, RS5·RS5c, R13·R21·R29 |
| M1 | 큼 | 개발 서버 "시험 주소"가 실제 운영 발신 주소라 고객 회신이 개발 DB로 | 시험 전용 주소(고객 발송 0인 보조 도메인 `cs@`), `REPLY_ALLOWED_FROM` 1.5단계, 시험 서버 거슬러 읽기 ≤1일, `on`·`live`는 운영 origin이거나 시험 제한이 다 있을 때만 (코드로) | 3절, 4-2(1.5단계), 13-3, 14절, RS23, R58 |
| M2 | 큼 | 갱신 토큰 = 메일함 전체 읽기, CloudType 접근자가 볼 수 있음 | 회신 전용 메일함을 토큰보다 먼저(13-0, 권장). (나) 길은 개발 시험에만·대표 승인·시험 뒤 끊기. 운영은 13-0 뒤에만. 13절 머리 경고 | 2절, 2-1, 13절, 14절, 17절 |
| M3 | 큼 | 멈춤·막기가 회신 보낸 사람 기준이라 원래 받은 사람에게 후속이 계속 | `matched_recipient` 칸, 멈춤 SQL·막기 모두 두 주소. 반송은 받는 사람이 같을 때만 실패로(SND), 다르면 신호만 | 6-1, 7-2, 7-3, 7-4, 9절, RS3·RS5d, R48·R49 |
| M4 | 큼 | 같은 기본 주소를 여러 사업이 써서 대체 짝짓기가 다른 사업에 붙음 | 후보가 여러 워크스페이스에 걸치고 제목으로 하나가 안 정해지면 ambiguous (`fallback_multi_ws`), 효과·카드 0 | 6-2, 6-3, RS16, R52 |
| M5 | 큼 | 제목 "반송"·본문 "출장 중"으로 사람 회신을 잘못 나누고, 고쳐도 조치가 다시 안 돎 | 제목 말은 `Return-Path <>`·MAILER-DAEMON일 때만, 본문 규칙 없앰, 애매하면 human. `effects_applied_kind`로 고친 분류에 7-2 다시 적용 | 5절, 7-1, 9절, 10-3, RS17~19, R53·R54 |
| M6 | 큼 | 지워진 레코드 FK 위반 하나가 회신 읽기 전체를 영구히 멈춤 | `LEFT JOIN records`로 있는 레코드만, 메일마다 저장점 — 데이터 오류는 그 메일만 unknown 최소 줄로 남기고 커서 넘김, 연결 오류만 멈춤 | 0절, 6-1, 7-1, 7-2, 9절, 10-2 표, RS20, R55 |
| M7 | 큼 | 토큰이 끊기면 조용히 멈추고 후속은 계속 | 운영 알림 기본 받는 곳을 기존 채널로(`SEND_HEALTH_WEBHOOK_URL` → `DEEP_ALERT_WEBHOOK_URL`), on인데 6시간 정체면 알림, SND 매일 보고에 "회신 읽기 마지막 성공". 후속 자동 미루기는 대표 결정 항목 | 3절, 8절, 10-1, 17절, RS28, R61 |
| M8 | 큼 | "3분이면 토큰 다시 받기"가 보안 비밀을 다시 구할 길이 없어 불가 | (가) CloudType 칸에서 복사 (나) 보안 비밀 추가 → 둘 다 바꾸고 옛 비밀 사용 중지. 약 10분 | 2절 표, 13-4 |
| M9 | 큼 | DSN 보고 부분이 첨부(`attachmentId`)로 오면 반송을 못 읽음 | 우리 것인 반송·시스템 안내에 한해 4가지 MIME 형식·64KB 이하 부분만 `attachments.get`. 가짜 Gmail에 첨부 모양 픽스처, 실제 모양은 14절 확인 3에서 기록 | 0절, 4-2, 10-2, 15-2, RS5b, R51, 17절 |
| m1 | 작음 | 알림 줄을 효과 트랜잭션 밖에서 만들어 일시 오류 뒤 카드가 영영 안 나감 | 효과 차지와 같은 트랜잭션에서 알림 줄. 밀린 효과도 `detected_mode='on'`·24시간 안이면 카드 | 7-1, 8절, R62 |
| m2 | 작음 | 지운 프로필의 옛 주소로 온 회신이 버려짐 | 최근 90일 `email_send_logs.sender_email` DISTINCT를 주소 모음에 (색인 있을 때) | 4-1, RS27, R60 |
| m3 | 작음 | 전용 메일함 옮기기 절차가 한 줄이라 빈 곳 | 라이선스 사용자·별칭 옮기기·라우팅 먼저·기본 주소 그대로·거슬러 읽기 확인 순서로. 별칭이면 멈춤 띠 | 2-1, 3절, 10-1, 11절, 13-0, 13-7 |
| m4 | 작음 | HTML 인용 속 우리 꼬리말이 수신거부 말로 읽힘 | HTML `blockquote`·`.gmail_quote`·`#divRplyFwdMsg` 등과 그 뒤 버림, 검사 전 우리 꼬리말·수신거부 URL 줄 지움 | 0절, 5절, 14절 확인 4, RS25, R15·R16 |
| m5 | 작음 | 템플릿 첫 메일 줄 멈춤이 이어지지 않고 상태 조건 없는 update가 덮어씀 | `TemplateFirstOutcome`에 `stopped`, `processRepeatItem`의 마지막 update 넷 모두 `status='pending'` 조건 | 7-4, 12절, R63 |
| m6 | 작음 | 직원 "전체 답장"이 고객 회신이 됨 | `internal` 분류(조직 사용자·메일함 쪽 도메인), 저장만 | 5절, RS21, R56 |
| m7 | 작음 | 스팸 신고·읽음 확인이 사람 회신이 됨 | delivery-status가 아닌 report는 `system`, `feedback-report`는 SND `complaint` 신호 | 5절, 7-3, RS22, R57 |
| m8 | 작음 | `REPLY_WORKSPACE_IDS`가 처리 범위를 좁히지 못함 | 이어진 발송의 워크스페이스가 목록 밖이면 저장하지 않음 (`outOfScope`), 문서와 동작 맞춤 | 3절, 4-2, 6-1, RS26, R59 |
| m9 | 작음 | `normalizeSenderAddress` 이름이 기존 함수와 겹침 | `normalizeReplyAddress`로 | 0절, 4-1, 12절 |
