# DESIGN — 이메일 오픈 픽셀 (우리 서버가 직접 기록하는 오픈 추적)

- **track**: Full · **사이클 ID**: `2026-10-20-email-open-pixel`
- **근거**: `PLAN.md`(2026-10-21 승인), `behaviors.json` B1~B33
- **사용자 결정**
  - Q1=A: `email_send_logs.open_tracked boolean` 칸을 더한다. 기존 행은 기본값 false이고, 새 발송만 발송 코드가 true로 적는다.
  - Q2=A: 픽셀 서명 키는 `JWT_SECRET`에서 HMAC으로 파생한다. env는 더하지 않는다. `JWT_SECRET`을 바꾸면 그 전에 보낸 메일의 오픈은 더 기록되지 않는다.
  - Q3: 운영 반영 뒤 ghty6323@gmail.com(Gmail)으로 본인 테스트 발송해 확인한다.
- **브랜치**: `main`(사용자 지시)
  - `main` push는 곧 운영 배포다. 0089 DDL이 운영 DB에서 돈다.
  - 커밋은 사용자 확인 뒤에 한다. push는 사용자가 운영 반영을 요청할 때만 한다.
- **마이그레이션**: `drizzle/0120_email_open_tracking.sql`, journal idx 89, when 1775200000000
- **새 의존성**: 없다. `node:crypto`(HMAC), `next/server`의 `after`(설치본 next 16.1.6), 기존 `rateLimit()`(`src/lib/tracker/rate-limit.ts`)을 쓴다.
- 경로는 저장소 루트(`/Users/jaehun/Projects/salesflow`) 기준이다. 줄 번호는 2026-10-21 작업 트리 기준이고, 어긋나면 인용한 코드로 찾는다.

## 0. 원칙

1. **기계 판정 입력은 세 가지뿐이다.** 그 픽셀 요청의 UA, 요청 시각, 그 발송의 `sent_at`이다. NHN `isOpened`·`openedDate`, 트래커, 클릭은 판정에 쓰지 않는다. 클릭은 오픈율 분자에 **합치기만** 한다.
2. **기록에는 잠금이 없다.** 트랜잭션도 advisory 잠금도 쓰지 않는다. 픽셀 응답은 기록과 떼어 놓는다(`after()`). 어떤 경우에도 200 + 43바이트 GIF로 응답한다.
3. **픽셀은 클릭 래핑과 같은 자리에서 붙인다.** 로그 insert 뒤, NHN 직전이다. 그래서 DB `body`에는 붙이기 전 본문이 남는다.
4. **클릭 쪽은 바꾸지 않는다.** `/api/track/click`, `recordClick`, `hasClicked`(후속 분기), R6 규칙, 클릭률이 그 대상이다.

## 1. 결정 요약

| # | 질문 | 결정 |
|---|---|---|
| D1 | 저장 | 새 표 `email_open_logs`에 요청 1건을 1줄로 남긴다. `email_send_logs.open_tracked`를 더한다. 공개 경로는 큰 표를 UPDATE하지 않는다. |
| D2 | 중복·남용 | 요청마다 남기되 발송당 사람 20줄·기계 10줄까지만 남긴다. 인메모리 레이트는 발송당 분당 10회이고, 동시에 기록하는 연결은 4개까지다. |
| D3 | 판정 위치 | TS에서 한다(`src/lib/email-open-rules.ts`, import 없음). SQL에는 기준을 두지 않는다. |
| D4 | 토큰 | `s` = base64url(HMAC-SHA256(K, `"open:"+id`)) 앞 16자(96비트)다. K = HMAC-SHA256(`JWT_SECRET`, `"sendb/email-open-pixel/v1"`)이다. 저장하지 않고, 상수 시간으로 비교한다. |
| D5 | 픽셀 HTML·위치 | 1x1 `<img … alt="">` 하나를 **본문 맨 앞**에 넣는다. 첫 `<body…>` 바로 뒤, 없으면 머리말 뒤, 그것도 없으면 맨 앞이다. |
| D6 | 기계 판정 | UA가 없거나 공백뿐이거나 오픈용 토큰을 담으면 `ua`다(우선). 발송 뒤 60초 미만(음수 포함)이면 `early`다. GoogleImageProxy·YahooMailProxy, Outlook `MSIE 7.0`, Apple(MPP 포함)은 UA만으로는 사람이다. |
| D7 | 오픈율 | 분모는 `open_tracked AND status='sent'`다. 분자는 분모 중 사람 오픈 픽셀이나 사람 클릭이 1건 이상인 발송이다. 분모가 0이면 null이고 화면은 "—"다. |
| D8 | 집계 SQL | 공통 조각 `openBaseSql`·`openedSendSql`(EXISTS)을 4개 API의 `count(*) FILTER`에 넣는다. 오픈 표는 조인하지 않는다. |
| D9 | 행 신호 | 새 파일 `src/lib/email-open-signals.ts`에 `openSignalsForSendLogs(orgId, ids)`를 둔다. 클릭 도우미와 같은 모양이다. |
| D10 | 화면 | 순수 함수 `openCellView()`와 `OpenCountCell`을 둔다(클릭 칸 선례). 안내 4줄은 상수 하나를 카드 아래와 칸 머리 툴팁이 같이 쓴다. |

## 2. 접근법과 트레이드오프

### 2-1. 오픈 기록의 모양

| 안 | 장점 | 대가 |
|---|---|---|
| **A. 새 표 + 요청별 줄 + 종류별 상한 (택함)** | 요청별 증거(UA·IP·시각)가 남아 기준을 바꿔 다시 판정할 수 있다. 큰 표를 UPDATE하지 않는다. 클릭 표와 모양이 같다. | 표 하나와 집계 EXISTS가 는다. 잠금이 없어서 상한이 느슨하다(동시 요청 수만큼, 최대 +3). |
| B. 첫 오픈만 (send_log_id UNIQUE + ON CONFLICT) | 상한이 엄격하고 멱등이다. | 첫 요청은 대개 기계(프리페치·검사기)다. 그 뒤의 사람 오픈이 남지 않고, 다시 판정할 수 없다. |
| C. `email_send_logs`에 `first_opened_at`·`open_count` | 집계가 단순하다. | 공개 경로에서 큰 표의 행을 UPDATE한다(발송 상태 갱신과 경합, bloat). 사람·기계 구분이 없다. |

상한을 사람과 기계로 나눈 이유: 하나로 두면 기계 요청이 상한을 채워 뒤에 온 사람 오픈을 막는다.

### 2-2. "픽셀이 들어간 발송" 표기 (Q1=A의 구현)

| 안 | 장점 | 대가 |
|---|---|---|
| **A. DB 기본값 false + 발송 코드가 insert 때 `openTracked: true` (택함)** | 픽셀을 붙이는 코드 옆에서 적는다. 배포 순간 옛 인스턴스가 픽셀 없이 보낸 발송은 false로 남아 정확하다. 빠뜨려도 분모에서 빠지는 안전한 쪽으로 틀린다. | 7곳 insert에 한 줄씩 늘어난다. 정적 테스트가 지킨다. |
| B. ADD 뒤 `SET DEFAULT true` | 발송 코드를 바꾸지 않는다. | 배포 순간 옛 인스턴스의 발송이 true가 되어 분모가 부푼다. 앞으로 픽셀 없이 로그를 남기는 경로도 true가 된다. |

### 2-3. 판정 위치

| 안 | 장점 | 대가 |
|---|---|---|
| **A. TS (택함)** | 기준이 한 파일에만 있다. 순수 함수 TDD가 된다. 백필이 없으니 SQL·TS 대조 테스트가 필요 없다. | 기록이 두 문장(읽기 → insert)이다. |
| B. SQL `INSERT … SELECT` 안 | 한 문장으로 끝난다. | 60초 기준이 SQL에도 생겨 대조 테스트가 필요하다. |

### 2-4. 토큰

| 안 | 장점 | 대가 |
|---|---|---|
| **A. HMAC 일부, 키 파생 (택함)** | 저장할 것이 없다. 96비트라 위조할 수 없고 URL이 짧다. 라벨 `v1`로 용도를 분리한다. | 키를 바꾸면 옛 메일의 오픈이 끊긴다(Q2 합의). |
| B. 발송마다 무작위 토큰을 저장 | 키 회전과 무관하다. | 큰 표에 칸과 색인(CONCURRENTLY)이 필요하고, 공개 경로가 토큰을 조회한다. |
| C. 서명 없이 id만 | 단순하다. | 누구나 아무 발송의 오픈을 만든다. 클릭 경로의 결함을 되풀이한다. |

### 2-5. 픽셀 위치

| 안 | 장점 | 대가 |
|---|---|---|
| **A. 본문 맨 앞 (택함)** | Gmail이 102KB 넘는 본문을 잘라도 남는다. `alt=""`라 미리보기 글자에 영향이 없다. | 서명·수신거부 꼬리(`</body>` 앞)와 자리가 다르다. 이미지를 막으면 1px 투명 자리가 남는다. |
| B. `</body>` 앞 | `appendSignature`·`appendUnsubscribeFooter`와 같은 자리다. | 잘린 긴 메일의 오픈이 빠진다. |

### 2-6. UA 판정 방식

| 안 | 장점 | 대가 |
|---|---|---|
| **A. 직접 관리하는 토큰 표 + 프록시 예외 (택함)** | 메일 이미지 프록시와 Outlook을 사람 쪽에 두는 요구(B14)를 코드로 고정한다. R6와 같은 방식이라 비교하기 쉽다. | 표를 우리가 관리한다. 국내 웹메일 UA는 운영에서 보고 고친다(O3). |
| B. `isbot` 같은 범용 목록 (새 의존성, 승인 필요) | 목록 관리를 맡길 수 있다. | 웹 봇 목록이라 메일 프록시와 MSIE 메일 UA를 우리 요구대로 다룬다는 보장이 없다. 버전이 바뀌면 판정이 소리 없이 바뀐다. 오픈 판정의 대부분은 60초 규칙이 한다. |

### 2-7. 잠금과 응답

| 안 | 장점 | 대가 |
|---|---|---|
| **A. 잠금 없음 + `after()` + 레이트 + 동시 상한 (택함)** | 잠금 대기가 없다. 응답이 DB를 기다리지 않는다. 풀(20) 중 오픈 기록이 쓰는 연결은 4개를 넘지 않는다. | 상한이 느슨하다. 레이트는 인스턴스 메모리 기준이다. 서버가 내려가는 순간의 `after()` 작업은 잃을 수 있다. |
| B. 클릭처럼 advisory 잠금 + 트랜잭션 | 상한이 엄격하다. | PLAN이 피하려는 잠금 대기와 풀 고갈이 생긴다. |
| C. 큐 표 + 정기 작업 | 공개 경로가 가장 가볍다. | 표와 작업을 새로 만든다(YAGNI). |

잠금 경합도 없다. 오픈 insert의 FK 확인은 발송 행에 `FOR KEY SHARE`를 잡고, 발송 경로의 status UPDATE는 `FOR NO KEY UPDATE`를 잡는다. 둘은 서로 막지 않는다.

### 2-8. 집계

| 안 | 장점 | 대가 |
|---|---|---|
| **A. 공통 조각 + FILTER 안 EXISTS (택함)** | 정의가 한 곳에 있다. 오픈 표를 조인하지 않아 templates에 행 곱이 없다. `open_tracked AND status`를 먼저 보므로 옛 발송은 하위 질의를 돌지 않는다. | 대상 발송 행마다 EXISTS가 최대 2개 돈다. 성능 관문(9-9)을 둔다. |
| B. 오픈 표 LEFT JOIN + count(distinct) | 해시 조인이 된다. | templates의 클릭 LEFT JOIN과 곱해진다. |
| C. 해시 하위 질의 `id IN (SELECT … org_id·기간)` | 큰 범위에서 빠르다. | 조각이 조직·기간 인자를 받아야 하고 색인 `(org_id, opened_at)`이 더 필요하다. 관문을 못 넘으면 대안(F1)으로 쓴다. |

클릭 사이클의 결정 ⑥("공통 조각 없음")과 다르게 가는 이유: 오픈 분자는 분모 조건과 두 EXISTS가 묶인 식이라, 4곳에 손으로 쓰면 틀리기 쉽다.

## 3. 데이터 흐름

```
[발송 7경로] 서명 → 수신거부 꼬리 → insert(email_send_logs, body=입히기 전, openTracked=true)
             → applyEmailTracking(html, id)  = appendOpenPixel(wrapTrackingUrls(html, id), id)  (email-click-tracking.ts)
             → NHN sendEachMail(body = 입힌 본문)
   appendOpenPixel → openPixelTag → openPixelUrl → openSignature(HMAC)                          (email-open-pixel.ts)

[메일 앱·프록시] GET /api/track/open?id=&s=                                                      (app/api/track/open/route.ts)
   verifiedOpenId(파싱 + 상수 시간 HMAC) → rateLimit("email-open:"+id, 10/분) → after(recordOpenSafely(hit)) → 200 GIF 43B
   HEAD → 같은 헤더만, 기록 없음
   recordOpenSafely: 동시 4 초과면 버림 → recordOpen: SELECT(org·sent_at·open_tracked·저장 수)
                     → machineOpenReason → shouldStoreOpen → INSERT email_open_logs              (email-open-tracking.ts)

[집계] summary · trends · templates · email-daily ← openBaseSql / openedSendSql (email-open-sql.ts) + openRatePercent
[행]   email/logs · logs/unified · MCP list_email_logs ← openSignalsForSendLogs (email-open-signals.ts)
[화면] OpenCountCell(openCellView) · OpenColumnHead · OpenRateNotice
       → EmailSendLogTable · UnifiedLogTable(/logs, 레코드 상세 compact) · EmailDashboard · DailyEmailTable · TemplateRanking · TrendChart
[그대로] /api/track/click · recordClick · hasClicked(email-followup.ts:473) · R6 · 트래커 툴 · page.tsx 전부 · RecordDetailDialog · AnalyticsSection
```

## 4. 데이터 모델

### 4-1. `drizzle/0120_email_open_tracking.sql` (전문)

```sql
-- 이메일 오픈 픽셀 (docs/2026-10-20-email-open-pixel/DESIGN.md 4절)
-- 1) email_send_logs.open_tracked: 본문에 오픈 픽셀을 넣어 보낸 발송. 기존 행은 false(픽셀 없음), 새 발송은 발송 코드가 true로 적는다.
--    상수 기본값 + NOT NULL이라 PostgreSQL 11 이상에서는 메타데이터만 바뀐다(attmissingval). 표를 다시 쓰지 않고 기존 행을 UPDATE하지 않는다.
--    운영이 11 이상인 근거: 0080의 RANGE 창(interval PRECEDING)이 운영에서 돌았다.
-- 2) email_open_logs: 픽셀 요청 한 건 = 한 줄. 발송당 사람 20줄·기계 10줄까지(src/lib/email-open-rules.ts). 판정은 앱(TS)이 하고 이 SQL에는 기준이 없다.
-- 3) 색인 (send_log_id, is_machine): 사람 오픈 EXISTS(is_machine = false)·발송별 수·상한 확인·cascade 삭제를 하나로 받는다. 새 표라 비어 있어 곧바로 만들어진다.
--    email_send_logs에는 색인을 만들지 않는다(큰 표 색인은 send-log-indexes.ts가 부팅 뒤 CONCURRENTLY로 만드는 관례).
-- 잠금: ALTER가 email_send_logs의 ACCESS EXCLUSIVE를 커밋까지 쥔다(수 ms). 가장 센 잠금을 먼저 잡아 FK가 같은 표를 잠글 때 잠금 올리기가 없게 한다.
-- 5초 안에 못 얻으면 55P03으로 되돌리고 migrate.ts가 다시 시도한다(0075·0078·0080·0082·0088과 같은 값). 다시 돌려도 같다(IF NOT EXISTS).
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "email_send_logs" ADD COLUMN IF NOT EXISTS "open_tracked" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_open_logs" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL,
    "send_log_id" integer NOT NULL REFERENCES "email_send_logs"("id") ON DELETE CASCADE,
    "opened_at" timestamptz DEFAULT now() NOT NULL,
    "ip" varchar(50),
    "user_agent" text,
    "is_machine" boolean NOT NULL,
    "machine_reason" varchar(16)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_open_logs_send_log_machine_idx" ON "email_open_logs" ("send_log_id", "is_machine");
--> statement-breakpoint
-- 9-2 F1: 집계 하위 질의가 조직·기간으로 오픈·클릭을 좁힌다. email_click_logs는 운영 3.6만 행(2026-10-21)이라 트랜잭션 안 CREATE INDEX도 짧다
CREATE INDEX IF NOT EXISTS "email_open_logs_org_opened_idx" ON "email_open_logs" ("org_id", "opened_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_click_logs_org_clicked_idx" ON "email_click_logs" ("org_id", "clicked_at");
```

- `org_id`에는 FK를 두지 않는다(`email_click_logs`와 같다). 값은 쓰는 순간 발송 로그에서 복사한다.
- CHECK 제약은 두지 않는다. 쓰는 곳이 `recordOpen` 하나뿐이고, 사유 값은 TS 타입으로 고정한다.

### 4-2. `drizzle/meta/_journal.json` (idx 88 다음)

```json
    {
      "idx": 89,
      "version": "7",
      "when": 1775200000000,
      "tag": "0120_email_open_tracking",
      "breakpoints": true
    }
```

### 4-3. `src/lib/db/schema.ts`

- 맨 위에 `import type { MachineOpenReason } from "@/lib/email-open-rules";`를 추가한다. 규칙 파일에는 import가 없어 순환 참조가 생기지 않는다.
- `emailSendLogs`(:705-753)의 `deliveryFailSide` 다음에 아래를 넣는다.

```ts
    /** 본문에 오픈 픽셀을 넣어 보낸 발송 (0089). 0089 전 행은 false — 오픈율 분자·분모는 true만 센다. 쓰는 곳: 발송 7경로 insert */
    openTracked: boolean("open_tracked").default(false).notNull(),
```

- `emailClickLogs` 다음(:776 뒤)에 아래를 넣는다.

```ts
// ============================================
// 이메일 오픈 픽셀 (0089). 요청 1건 = 1줄. 쓰는 곳은 recordOpen 하나
// ============================================
export const emailOpenLogs = pgTable("email_open_logs", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id").notNull(),
    sendLogId: integer("send_log_id").references(() => emailSendLogs.id, { onDelete: "cascade" }).notNull(),
    openedAt: timestamptz("opened_at").defaultNow().notNull(),
    ip: varchar("ip", { length: 50 }),
    userAgent: text("user_agent"),
    isMachine: boolean("is_machine").notNull(),
    machineReason: varchar("machine_reason", { length: 16 }).$type<MachineOpenReason>(),
}, (table) => [
    index("email_open_logs_send_log_machine_idx").on(table.sendLogId, table.isMachine),
]);

export type EmailOpenLog = typeof emailOpenLogs.$inferSelect;
```

### 4-4. 큰 표 ALTER가 메타데이터만 바꾸는지 (B18)

- PostgreSQL 11 이상에서 상수 DEFAULT와 NOT NULL로 ADD COLUMN을 하면 표를 다시 쓰지 않는다. 기존 행 값은 `pg_attribute.attmissingval`로 채워진다. NOT NULL 검증 스캔도 없다. 기본값이 null이 아니라는 것을 이미 알기 때문이다.
- 잠금은 ACCESS EXCLUSIVE를 짧게 잡는다. 진행 중인 조회가 끝나기를 최대 5초 기다리고, 그동안 뒤의 발송 기록과 조회가 줄을 선다(O2). 실패하면 3초·10초·20초 뒤에 다시 하고, 그래도 안 되면 서버를 띄우지 않는다(`instrumentation.ts`).
- 로컬 확인은 17-1절에서 한다. filenode가 그대로이고 `atthasmissing = t`, `attmissingval = {f}`여야 한다.

## 5. 판정 규칙 — `src/lib/email-open-rules.ts` (신규, import 없음)

### 5-1. 상수와 시그니처

```ts
/** 발송 뒤 이 시간 "미만"(음수 포함)에 온 오픈은 기계(early)다. 정확히 60초는 사람 쪽. 단위 ms */
export const MACHINE_OPEN_WINDOW_MS = 60_000;
/**
 * 오픈용 기계 UA (대소문자 무시, 부분 일치). 클릭 R6(BOT_UA_PATTERN, email-click-bot-rules.ts:7-8)에서 msie를 빼고
 * HTTP 도구 몇 개를 더했다. Outlook 데스크톱은 사람이 열 때도 "MSIE 7.0 … Microsoft Outlook" UA로 이미지를 받는다. 점은 "[.]"
 */
export const MACHINE_OPEN_UA_PATTERN =
    "curl|python|node-fetch|axios|ruby|go-http|java/|okhttp|httpclient|libwww|wget|guard|antispam|linker|scan|bot|spider|crawl|preview|headless|phantomjs|^mozilla/5[.]0 chrome/";
/** 사람이 열 때도 거치는 메일 이미지 프록시. 토큰과 겹쳐도 UA로는 기계가 아니다(60초 규칙만) */
export const HUMAN_IMAGE_PROXY_PATTERN = "googleimageproxy|yahoomailproxy";

export type MachineOpenReason = "ua" | "early";

/** null·undefined·공백뿐 → true. 프록시 예외에 맞으면 false. 기계 토큰에 맞으면 true. 그 밖은 false (B12~B14) */
export function isMachineOpenUserAgent(userAgent: string | null | undefined): boolean;
/** openedAt - sentAt < MACHINE_OPEN_WINDOW_MS (B11) */
export function isEarlyOpen(sentAt: Date, openedAt: Date): boolean;
/** ua가 early보다 앞선다. 둘 다 아니면 null (B15) */
export function machineOpenReason(input: {
    userAgent: string | null | undefined;
    sentAt: Date;
    openedAt: Date;
}): MachineOpenReason | null;

/** 발송당 저장 상한. 기계 요청이 상한을 채워 뒤의 사람 오픈을 막지 않게 따로 센다 (B10) */
export const HUMAN_OPENS_PER_SEND_MAX = 20;
export const MACHINE_OPENS_PER_SEND_MAX = 10;
/** openTracked가 아니면 false. 사람이면 storedHuman < 20, 기계면 storedMachine < 10 */
export function shouldStoreOpen(input: {
    openTracked: boolean;
    isMachine: boolean;
    storedHuman: number;
    storedMachine: number;
}): boolean;

/** 발송 한 건의 픽셀 요청을 인스턴스마다 이 창에서 이만큼까지만 받는다 (rateLimit 인자) */
export const OPEN_RATE_LIMIT = { maxRequests: 10, windowMs: 60_000 } as const;
/** 오픈 기록이 동시에 쓰는 DB 연결 상한 (풀 기본 20) */
export const OPEN_WRITE_CONCURRENCY = 4;
```

- 정규식은 모듈 최상위에서 `new RegExp(…, "i")`로 한 번씩만 만든다.
- 오픈에는 burst 규칙을 쓰지 않는다. 사람이 여러 번 열면 연속 요청이 나오는 게 정상이고, 이웃 판정에는 잠금이 필요하다(원칙 2와 충돌).

### 5-2. 오픈용 기계 UA 토큰 표 (B13)

| 토큰 | 대상 | 테스트 예시 UA |
|---|---|---|
| curl | HTTP 도구 | `curl/8.4.0` |
| python | 파이썬 | `python-requests/2.31.0` |
| node-fetch | Node | `node-fetch/1.0 (+https://github.com/bitinn/node-fetch)` |
| axios | Node | `axios/1.7.2` |
| ruby | Ruby | `Ruby` |
| go-http | Go | `Go-http-client/1.1` |
| java/ | Java | `Java/17.0.2` |
| okhttp | Java·Android | `okhttp/4.12.0` |
| httpclient | Apache·.NET | `Apache-HttpClient/4.5.14` |
| libwww | Perl | `libwww-perl/6.72` |
| wget | 도구 | `Wget/1.21.4` |
| guard | 링크 검사기 | `Mozilla/5.0 (compatible; LinkGuard/2.0)` |
| antispam | 스팸 검사 | `AntiSpam-Engine/3.1` |
| linker | 링크 검사 | `Linker/1.0` |
| scan | 보안 검사 | `Mozilla/5.0 (compatible; URLScan/4.0)` |
| bot | 봇 | `Mozilla/5.0 (compatible; Googlebot/2.1)` |
| spider | 크롤러 | `Baiduspider/2.0` |
| crawl | 크롤러 | `Mozilla/5.0 (compatible; ExampleCrawler/1.0)` |
| preview | 링크 미리보기 | `Mozilla/5.0 (Windows NT 10.0) LinkPreview/1.0` |
| headless | 헤드리스 | `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36` |
| phantomjs | 헤드리스 | `Mozilla/5.0 (Unknown; Linux x86_64) AppleWebKit/538.1 (KHTML, like Gecko) PhantomJS/2.1.1 Safari/538.1` |
| `^mozilla/5[.]0 chrome/` | 껍데기 Chrome UA | `Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36` |

예시마다 토큰이 하나씩만 들어 있다. 알려진 오탐인 CUBOT 폰(`… Android 10; CUBOT X30 …`)은 R6와 같이 기계로 판정되는 것을 테스트에 고정해 둔다.

### 5-3. UA로 사람 쪽에 두는 것 (B14 — 60초 규칙만 적용)

| 구분 | UA |
|---|---|
| Gmail 이미지 프록시 | `Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)` |
| Yahoo 프록시 | `YahooMailProxy; https://help.yahoo.com/kb/yahoo-mail-proxy-SLN28749.html` |
| Outlook 데스크톱 | `Mozilla/4.0 (compatible; MSIE 7.0; Windows NT 10.0; WOW64; Trident/7.0; .NET4.0C; .NET4.0E; Microsoft Outlook 16.0.17928; ms-office; MSOffice 16)` |
| Apple 메일(macOS) | `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)` |
| Apple MPP 프록시 | `Mozilla/5.0` — Apple 프록시는 기계로 보지 않는다(결정) |
| iOS 메일 | `Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148` |
| 일반 브라우저 | 클릭 테스트의 Chrome·Edge·Firefox·Safari·삼성 인터넷·카카오톡 인앱 UA |
| 예외 우선 확인 | `Mozilla/5.0 (via ggpht.com GoogleImageProxy) scan` → UA 규칙 false |

## 6. 토큰·픽셀 — `src/lib/email-open-pixel.ts` (신규, `node:crypto`만 import)

### 6-1. 시그니처

```ts
export interface OpenPixelOptions { secret?: string; baseUrl?: string }   // 기본: env JWT_SECRET, env NEXT_PUBLIC_BASE_URL || "https://sendb.kr" (호출 때 읽는다)

/** "1"~"2147483647"의 정규 10진수만 받는다(/^[1-9][0-9]{0,9}$/ + int4 상한). 그 밖은 null */
export function parseOpenId(raw: string | null | undefined): number | null;
/** K = HMAC-SHA256(secret, "sendb/email-open-pixel/v1"), base64url(HMAC-SHA256(K, `open:${id}`)).slice(0, 16) */
export function openSignature(sendLogId: number, secret: string): string;
/** /^[A-Za-z0-9_-]{16}$/가 아니거나 secret이 비면 false. 같은 길이 Buffer를 timingSafeEqual로 비교. 던지지 않는다 */
export function verifyOpenSignature(sendLogId: number, signature: string | null | undefined, secret: string | undefined = process.env.JWT_SECRET): boolean;
/** parseOpenId(id) → verifyOpenSignature(s). 통과한 id 또는 null. 던지지 않는다 */
export function verifiedOpenId(params: URLSearchParams, secret: string | undefined = process.env.JWT_SECRET): number | null;
/** `${baseUrl}/api/track/open?id=${id}&s=${sig}` (B3). secret이 없으면 던진다(auth.ts와 같은 문구) */
export function openPixelUrl(sendLogId: number, opts?: OpenPixelOptions): string;
/** <img> 한 개. src의 &는 &amp;로 쓴다 */
export function openPixelTag(sendLogId: number, opts?: OpenPixelOptions): string;
/** 이름은 B1을 따르지만 넣는 자리는 본문 맨 앞이다 (6-2) */
export function appendOpenPixel(html: string, sendLogId: number, opts?: OpenPixelOptions): string;
export const PIXEL_GIF: Uint8Array;
export const PIXEL_HEADERS: Readonly<Record<string, string>>;
```

### 6-2. 태그와 자리 (B1)

```ts
// openPixelTag(id) 결과 (url은 openPixelUrl(id)에서 & → &amp;)
`<img src="${url}" width="1" height="1" alt="" border="0" style="display:block;width:1px;height:1px;border:0;margin:0;padding:0" />`

const BODY_OPEN_RE = /<body\b[^>]*>/i;
const PROLOG_RE = /^\s*(?:<!doctype[^>]*>\s*)?(?:<html\b[^>]*>\s*)?(?:<head\b[^>]*>[\s\S]*?<\/head>\s*)?/i;
// 자리 = 첫 <body…> 끝. 없으면 PROLOG_RE가 맞은 길이(조각이면 0 또는 앞 공백 뒤)
// 결과 = html.slice(0, at) + tag + html.slice(at)
```

- `display:none`은 쓰지 않는다. 숨긴 이미지는 받지 않는 클라이언트가 있다.
- `display:block`을 쓰는 이유: 줄 높이 공백 대신 1px만 차지한다.
- `<body>`가 없고 `<!doctype>`이나 `<head>`만 있는 문서에서도 doctype 앞에 넣지 않는다. 앞에 넣으면 quirks 모드가 될 수 있다.
- 클릭 래핑(`wrapTrackingUrls`)이 먼저 돌고 픽셀은 그 뒤에 붙는다. 그래서 픽셀은 래핑 대상이 될 수 없다(B2).
- 래핑 정규식은 `<a\s…href`만 보므로 `<img>`는 맞지도 않는다.

### 6-3. GIF와 헤더 (B6·B8)

```ts
// 43바이트 투명 GIF89a (base64 "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==").
// Buffer 대신 Uint8Array 리터럴로 둔다 — BodyInit 타입(TS 5.9의 ArrayBufferLike)에 걸리지 않게
export const PIXEL_GIF = new Uint8Array([
    0x47,0x49,0x46,0x38,0x39,0x61, 0x01,0x00,0x01,0x00, 0x80,0x00,0x00,
    0x00,0x00,0x00, 0xff,0xff,0xff,
    0x21,0xf9,0x04,0x01,0x00,0x00,0x00,0x00,
    0x2c,0x00,0x00,0x00,0x00,0x01,0x00,0x01,0x00,0x00,
    0x02,0x02,0x44,0x01,0x00,
    0x3b,
]);
export const PIXEL_HEADERS = {
    "Content-Type": "image/gif",
    "Content-Length": "43",
    "Cache-Control": "no-store, no-cache, must-revalidate, private, max-age=0",
    "Pragma": "no-cache",
    "Expires": "Thu, 01 Jan 1970 00:00:00 GMT",
    "X-Content-Type-Options": "nosniff",
} as const;   // Set-Cookie 없음
```

### 6-4. `src/lib/request-ip.ts` (신규, 순수)

```ts
const IP_RE = /^[0-9A-Fa-f:.]{2,45}$/;
/**
 * 클릭 라우트(src/app/api/track/click/route.ts:18-21)와 같은 순서로 본다: x-forwarded-for 첫 값 → x-real-ip.
 * 앞뒤 공백을 잘라 IP 모양이면 쓰고, 아니면 다음 후보로 넘어간다. 모두 아니면 null. varchar(50)을 넘는 값으로 insert가 실패하지 않게 한다
 */
export function requestIp(headers: Headers): string | null;
```

새 코드는 이 헬퍼를 쓴다. 클릭 라우트는 이번에 바꾸지 않는다(20절 메모).

## 7. 공개 경로

### 7-1. `src/app/api/track/open/route.ts` (신규)

```ts
import { after, type NextRequest } from "next/server";
import { rateLimit } from "@/lib/tracker/rate-limit";
import { OPEN_RATE_LIMIT } from "@/lib/email-open-rules";
import { PIXEL_GIF, PIXEL_HEADERS, verifiedOpenId } from "@/lib/email-open-pixel";
import { requestIp } from "@/lib/request-ip";
import { recordOpenSafely } from "@/lib/email-open-tracking";

function pixel(withBody: boolean): Response {   // export하지 않는다 (route.ts는 HTTP 메서드만 내보낸다)
    return new Response(withBody ? PIXEL_GIF : null, { status: 200, headers: PIXEL_HEADERS });
}

/** 메일 오픈 픽셀. 어떤 경우에도 200 + 43바이트 GIF (B6). 기록은 응답 뒤 after()에서 (B9) */
export function GET(req: NextRequest): Response {
    try {
        const sendLogId = verifiedOpenId(req.nextUrl.searchParams);
        // 서명을 먼저 본다 — 틀린 서명이 정상 발송의 레이트 칸을 채우지 못하게
        if (sendLogId !== null && rateLimit(`email-open:${sendLogId}`, OPEN_RATE_LIMIT).allowed) {
            const hit = { sendLogId, openedAt: new Date(), ip: requestIp(req.headers), userAgent: req.headers.get("user-agent") };
            after(() => recordOpenSafely(hit));
        }
    } catch {
        // 픽셀은 늘 돌려준다
    }
    return pixel(true);
}

/** 같은 헤더만 주고 기록하지 않는다 (B8). 내보내지 않으면 Next가 HEAD를 GET으로 처리한다 */
export function HEAD(): Response {
    return pixel(false);
}
```

- `openedAt`은 요청 시각이다. `after()` 실행 시각을 쓰지 않는다.
- 이 라우트에는 `await`도 쿠키도 없다(정적 테스트로 확인).

### 7-2. `src/lib/email-open-tracking.ts` (신규)

```ts
export interface OpenHit { sendLogId: number; openedAt: Date; ip: string | null; userAgent: string | null }

/**
 * 오픈 요청 한 건을 기록한다. 트랜잭션·advisory 잠금 없이 두 문장 (B9). 저장했으면 true.
 * 상한은 느슨하다 — 동시 요청은 서로의 행을 못 봐 동시 기록 수만큼 넘을 수 있다(최대 OPEN_WRITE_CONCURRENCY - 1)
 */
export async function recordOpen(hit: OpenHit): Promise<boolean>;
/** after()가 부른다. 동시에 OPEN_WRITE_CONCURRENCY개를 넘으면 버리고, 실패는 SQLSTATE만 한 줄 찍는다. 던지지 않는다 */
export async function recordOpenSafely(hit: OpenHit): Promise<void>;
```

`recordOpen` 순서:
1. UA를 정규화한다. `const userAgent = hit.userAgent ? hit.userAgent.slice(0, 512) : null;` 판정 입력은 저장할 값 그대로다.
2. 발송을 읽는다. 원문 SQL을 쓴다. builder 단일 표 select는 칼럼에 표 이름을 붙이지 않아서, 하위 질의의 바깥 참조가 안쪽 표에 묶인다(`email-click-signals.ts:17-18` 주석과 같은 이유).

```sql
SELECT s.org_id AS "orgId", s.sent_at AS "sentAt", s.open_tracked AS "openTracked",
       (SELECT count(*)::int FROM email_open_logs o WHERE o.send_log_id = s.id AND o.is_machine = false) AS "storedHuman",
       (SELECT count(*)::int FROM email_open_logs o WHERE o.send_log_id = s.id AND o.is_machine = true) AS "storedMachine"
FROM email_send_logs s
WHERE s.id = ${hit.sendLogId}
```

3. 행이 없으면 false를 반환한다.
4. 판정한다. `reason = machineOpenReason({ userAgent, sentAt: new Date(row.sentAt), openedAt: hit.openedAt })`
5. `shouldStoreOpen({ openTracked: row.openTracked === true, isMachine: reason !== null, … })`가 false면 false를 반환한다.
6. 넣는다. `db.insert(emailOpenLogs).values({ orgId: row.orgId, sendLogId, openedAt: hit.openedAt, ip: hit.ip, userAgent, isMachine: reason !== null, machineReason: reason })`

`recordOpenSafely`:
- 모듈에 `let inFlight = 0`을 둔다. 상한을 넘으면 그냥 반환한다.
- `try { await recordOpen } catch (e) { console.error(\`[open-pixel] 오픈 기록 실패 (send_log ${id}): ${pgErrorOf(e)?.code ?? "unknown"}\`) } finally { inFlight-- }`
- `pgErrorOf`는 기존 `@/lib/email-reply-rules`를 재사용한다.

## 8. 발송 경로

### 8-1. `src/lib/email-click-tracking.ts`에 추가 (140줄 → 약 152줄)

```ts
import { appendOpenPixel } from "@/lib/email-open-pixel";

/**
 * 발송 본문에 추적을 입힌다 — 링크 래핑(클릭) 뒤에 오픈 픽셀 1개. 발송 로그 insert 뒤, NHN 직전에 부른다.
 * DB body에는 입히기 전 본문을 저장한다(발송 이력 미리보기가 오픈을 만들지 않게, B5). 픽셀은 래핑 뒤에 붙어 클릭 래핑 대상이 아니다(B2)
 */
export function applyEmailTracking(html: string, sendLogId: number): string {
    return appendOpenPixel(wrapTrackingUrls(html, sendLogId), sendLogId);
}
```

`wrapTrackingUrls`, `recordClick`, `hasClicked`, `appendSendbCid`는 바꾸지 않는다. `wrapTrackingUrls`는 export를 유지한다.

### 8-2. 7곳 (모든 경로가 서명 → 수신거부 꼬리 → insert → 래핑 → NHN 순서다)

| # | 경로 | 파일:줄 | 바꿀 것 |
|---|---|---|---|
| 1 | 템플릿 자동·반복 | `src/lib/email-automation.ts` import :21, insert :193-210, 래핑 :212 | import를 `applyEmailTracking`로 바꾼다. insert 값에 `openTracked: true`. `applyEmailTracking(finalBody, inserted.id)` |
| 2 | 수동 | `src/app/api/email/send/route.ts` :10, :203-220, :222 | 위와 같다. `applyEmailTracking(finalBody, logEntry.id)` |
| 3 | AI 자동 | `src/lib/auto-personalized-email.ts` :18, `logValues` :481-496, :519 | `logValues`에 `openTracked: true`를 넣는다. 두 insert 갈래(`beginPreparedDelivery` → `email-prepared-sends.ts:151`, 그리고 :509)가 이 값을 같이 쓴다. `applyEmailTracking(finalBody, inserted.id)` |
| 4 | 템플릿 후속 | `src/lib/email-followup.ts` :19, :678-695, :697 | import를 `{ applyEmailTracking, hasClicked }`로 바꾼다. `openTracked: true`. `applyEmailTracking(body, inserted.id)` |
| 5 | AI 후속 | 같은 파일 :913-928, :930 | `openTracked: true`. `applyEmailTracking(finalBody, inserted.id)` |
| 6 | 방문 감사 | `src/lib/email-visit-ack-delivery.ts` 원문 INSERT :209-212, :476 | 칸 목록 끝에 `,open_tracked`, 값 끝에 `,true`를 붙인다(`…,${ready.senderEmail},true FROM owned`). `clicks.applyEmailTracking(body, logId)`로 바꾼다. 동적 import 객체(:293)는 그대로 둔다. |
| 7 | 후속 테스트 | `src/app/api/email/auto-personalized/test-followup/route.ts` :9, :205-219, :221 | `openTracked: true`. `applyEmailTracking(result.htmlBody, inserted.id)` |

- 로그 없이 보내는 4곳(test-send, AI test-send, 초대, 발신 프로필 확인)은 바꾸지 않는다.
- `hasClicked` 호출(`email-followup.ts:473`)은 그대로 둔다.
- insert와 NHN 사이에 취소된 행(`findVisitFollowupStop` 등)은 `open_tracked`가 true여도 `status`가 sent가 아니라 분모에 들어가지 않는다.

## 9. 집계

### 9-1. 오픈율 정의 (B20·B25)

- **분모(openBase)**: `open_tracked = true AND status = 'sent'`. 클릭률의 "발송(성공)"과 같은 status 기준이다. 배달 결과로 sent → failed가 된 발송은 빠진다.
- **분자(opened)**: 분모 중 `email_open_logs`의 사람 오픈(`is_machine = false`)이나 `email_click_logs`의 사람 클릭(`is_bot = false`)이 1건 이상인 발송
  - 기계 오픈만 있으면 오픈이 아니다.
  - 픽셀 없이 사람 클릭만 있어도 오픈이다.
- 발송 단위 EXISTS라 같은 요청이 반복돼도 값이 그대로다(멱등).
- **클릭률은 바꾸지 않는다.** 기존 `clicked / sent`를 쓰고, 도입 전 발송도 그대로 포함한다.

### 9-2. `src/lib/email-open-sql.ts` (신규, `drizzle-orm`만 import — DB 없이 테스트한다)

```ts
import { sql, type SQL } from "drizzle-orm";
/** 바깥 쿼리에서 email_send_logs 행을 가리키는 이름. 닫힌 상수만 받는다(sql.raw) */
export type SendLogRef = "email_send_logs" | "f";
/** 오픈율 분모 */
export function openBaseSql(ref: SendLogRef): SQL;   // → `${ref}.open_tracked AND ${ref}.status = 'sent'`
/** 오픈 신호를 찾는 범위. 바깥 쿼리의 조직·기간 시작과 같은 값을 넘긴다 (2026-10-21 F1 적용) */
export interface OpenScope { orgId: string; since: Date | string }
/** 오픈율 분자 */
export function openedSendSql(ref: SendLogRef, scope: OpenScope): SQL;
// → `(${ref}.open_tracked AND ${ref}.status = 'sent') AND (${ref}.id IN (SELECT o.send_log_id FROM email_open_logs o WHERE o.org_id = $1::uuid AND o.is_machine = false AND o.opened_at >= $2::timestamptz) OR ${ref}.id IN (SELECT c.send_log_id FROM email_click_logs c WHERE c.org_id = $3::uuid AND c.is_bot = false AND c.clicked_at >= $4::timestamptz))`
// params = [orgId, since, orgId, since] (Drizzle은 같은 값도 자리마다 매개변수를 새로 만든다. since는 문자열이면 그대로, Date면 toISOString()) — 조직·기간은 sql 매개변수, ref만 sql.raw
```

분모 조건이 앞에 있어서 옛 발송은 하위 질의를 돌지 않는다(AND 단락 평가).

**2026-10-21 F1 적용(9-9 관문 미달로 변경)**: 처음 설계한 EXISTS 상관 하위 질의는 30만 발송 fixture에서 trends +382ms(기준 300ms 초과), summary +292ms였다. 조직·기간으로 좁힌 `IN (SELECT …)`(해시 하위 계획)으로 바꾸면 trends 170ms, summary 50ms로 변경 전보다 빠르다(`evidence/9-9-perf.txt`). 조직·기간 없이 전체 표를 해시하는 안은 오픈 기록이 work_mem을 넘으면 행마다 다시 도는 계획으로 떨어질 수 있어 택하지 않는다. 오픈·클릭은 발송 뒤에 생기므로 `>= since`만 걸면 기간 안 발송의 신호를 빠뜨리지 않는다(끝 시각은 걸지 않는다). 호출부: summary·trends·templates는 `{ orgId, since: start }`, email-daily는 `{ orgId: user.orgId, since: fromIso }`. 색인은 4-1에 두 개를 더한다.

### 9-3. `src/components/email/opens/utils/openRate.ts` (신규, 순수 — API와 화면이 같이 쓴다. 선례: `api/tracker/analytics/overview/route.ts:5`)

```ts
/** 소수 첫째 자리 %. 분모 0이면 null (B21) — 클릭률과 같은 반올림 Math.round(x*1000)/10 */
export function openRatePercent(opened: number, base: number): number | null;
/** "12.3%" 또는 "—" (B30) */
export function openRateText(rate: number | null): string;
/** "오픈/대상" 보조 글자. 대상 0이면 undefined */
export function openRatioText(opened: number, base: number): string | undefined;
/** 오픈 수 칸. 대상 0이면 "—" */
export function openCountText(opened: number, base: number): string;
/** 안내 4줄 (B31) — 카드 아래와 칸 머리 툴팁이 같이 쓴다 */
export const OPEN_NOTICE_LINES: readonly string[] = [
    "오픈은 추정치입니다. 발송 60초 안의 요청과 메일 보안 검사기는 빼고 셉니다.",
    "이미지를 막고 읽으면 오픈이 잡히지 않지만, 링크를 누르면 오픈으로 셉니다.",
    "Apple 메일은 열지 않아도 이미지를 미리 받아 오픈으로 잡힐 수 있습니다.",
    "오픈 추적을 넣은 뒤 보낸 메일만 오픈율에 셉니다.",
];
export const OPEN_NOTICE_TITLE = OPEN_NOTICE_LINES.join("\n");
```

### 9-4. summary (`src/app/api/analytics/summary/route.ts`, B21)

- 유형별 쿼리(:88-96)에 두 칸을 더한다.
  - `openBase: sql<number>\`count(*) filter (where ${openBaseSql("email_send_logs")})::int\``
  - `opened: sql<number>\`count(*) filter (where ${openedSendSql("email_send_logs")})::int\``
- `triggerData`(:119-130)에 `opened`, `openBase`, `openRate: openRatePercent(t.opened, t.openBase)`를 더한다.
- 전체 값은 유형별 값을 더해서 만든다(모든 행이 유형 하나에만 속한다). 쿼리는 늘지 않는다. `email: { ...aggregateStats(…), opened, openBase, openRate }`
- `aggregateStats`, 클릭 쿼리 2개(:98-114), 기존 칸은 그대로 둔다.

### 9-5. trends (`trends/route.ts`, B22)

- `emailTrends`(:44-59)에 `opened: sql<number>\`count(*) filter (where ${openedSendSql("email_send_logs")})::int\`.as("opened")`를 더한다.
- 맵 타입(:62-69)에 `emailOpened`를 더한다. 알림톡만 있는 날은 0이다.

### 9-6. templates (`templates/route.ts`, B23)

- 두 쿼리(:47-68, :71-92)의 기존 LEFT JOIN, `count(distinct …)`, 정렬은 **그대로** 둔다.
- 두 칸을 더한다.
  - `openBase: sql<number>\`count(distinct ${emailSendLogs.id}) filter (where ${openBaseSql("email_send_logs")})::int\`.as("openBase")`
  - `opened: …같은 모양으로 openedSendSql….as("opened")`
- 오픈 표는 조인하지 않으므로 total·sent·failed·clicked가 바뀔 수 없다.
- `combined`의 이메일 줄에 `opened`, `openBase`, `openRate`를 더한다. 알림톡 줄은 `opened: 0, openBase: 0, openRate: null`이다.

### 9-7. email-daily (`email-daily/route.ts`, B24)

```sql
-- log_origin 기본(:38-54): s.sent_at 다음에 →  s.open_tracked, s.status,
-- 재귀(:59-74): lo.sent_at 다음에 →  lo.open_tracked, lo.status,      (부모가 아니라 원래 발송의 값)
-- resolved(:78-82): SELECT DISTINCT ON (id) id, campaign, product, trigger_type, sent_at, open_tracked, status
-- final(:85-92) 두 갈래 모두 끝에: …, lo.open_tracked, lo.status  /  …, open_tracked, status FROM resolved
-- 바깥 SELECT(:93-104) clicked 다음에:
    count(*) FILTER (WHERE ${openBaseSql("f")})::int AS "openBase",
    count(*) FILTER (WHERE ${openedSendSql("f")})::int AS opened
```

- 그룹(:114-137)에 `totalOpened`, `totalOpenBase`를 더하고, breakdown 줄에 `opened`, `openBase`를 더한다.
- 기존 `sent`(상태와 무관한 전체 로그 수)와 `clicked`는 그대로 둔다. 화면의 오픈율은 `sent`가 아니라 `openBase`로 나눈다.

### 9-8. 훅 타입

- `src/hooks/useEmailAnalytics.ts`
  - `EmailStats`, `TriggerBreakdownItem`에 `opened: number; openBase: number; openRate: number | null;`
  - `TrendItem`에 `emailOpened: number;`
- `src/hooks/useAnalytics.ts`
  - `TrendItem`에 `emailOpened`
  - `TemplatePerformance`에 `opened`, `openBase`, `openRate: number | null`
- `src/hooks/useEmailDaily.ts`
  - `EmailDailyBreakdown`에 `opened`, `openBase`
  - `EmailDailyGroup`에 `totalOpened`, `totalOpenBase`

### 9-9. 성능 관문

- **fixture**: 로컬에 30만 발송을 만든다(한 조직, 90일, 1/3 `open_tracked`). 대상 발송의 5%에 오픈 1~3건(30% 기계), 전체의 2%에 클릭(10% 봇)을 넣는다.
- **측정**: 4개 라우트의 주 쿼리를 `EXPLAIN (ANALYZE, BUFFERS)`로 변경 전후 3회씩 돌려 중앙값을 비교한다.
- **기준**: 각 쿼리가 **변경 전보다 300ms 넘게 늘면 멈추고 보고한다.** templates는 기존 칸 값이 같아야 한다.
- **대안 F1**: 조각을 `ref.id IN (SELECT o.send_log_id FROM email_open_logs o WHERE o.org_id = $org AND o.is_machine = false AND o.opened_at >= $start)`로 바꾼다(해시 하위 질의, 클릭도 같은 모양). 색인 `(org_id, opened_at)`을 추가한다. DESIGN을 먼저 고친 뒤 적용한다.

## 10. 행 신호·MCP

### 10-1. `src/lib/email-open-signals.ts` (신규, `clickSignalsForSendLogs`와 같은 모양)

```ts
export const EMPTY_OPEN_SIGNAL: OpenSignal = { openCount: 0, machineOpenCount: 0, openTracked: false };
/** 발송별 오픈 신호. 요청한 id 중 이 조직 발송 모두를 담는다(오픈이 없어도 openTracked를 준다) */
export async function openSignalsForSendLogs(orgId: string, logIds: number[]): Promise<Map<number, OpenSignal>>;
```

```sql
SELECT s.id AS "sendLogId", s.open_tracked AS "openTracked",
       count(o.id) FILTER (WHERE o.is_machine = false)::int AS "openCount",
       count(o.id) FILTER (WHERE o.is_machine = true)::int AS "machineOpenCount"
FROM email_send_logs s
LEFT JOIN email_open_logs o ON o.send_log_id = s.id AND o.org_id = s.org_id
WHERE s.org_id = ${orgId}::uuid AND s.id = ANY(${sql.param(logIds)}::int[])
GROUP BY s.id, s.open_tracked
```

조직 격리는 두 겹이다. 발송의 org로 한 번, 오픈 org가 발송 org와 같은지로 한 번 더 거른다.

### 10-2. 붙이는 곳 (B26·B27)

| 파일:줄 | 바꿀 것 |
|---|---|
| `src/app/api/email/logs/route.ts` :111-126 | `openSignalsForSendLogs(user.orgId, logIds)`를 부른다. 줄을 `{ ...log, ...(클릭 신호), ...(openSignals.get(log.id) ?? EMPTY_OPEN_SIGNAL), reply }`로 만든다. 조건·정렬·totalCount는 그대로 둔다. |
| `src/app/api/logs/unified/route.ts` :81-89 | 이메일 줄 id로 같은 호출을 한다. 이메일 줄에만 펼친다. 알림톡 줄 `{ ...log, clickCount: 0 }`은 그대로 둔다. |
| `src/types/index.ts` `UnifiedLog` :413-418 다음 | `openCount?: number`, `machineOpenCount?: number`, `openTracked?: boolean`. 주석에 "이메일 줄만"이라고 적는다. |
| `src/lib/mcp/tools.ts` :97, :305-309 | 줄에 `openCount`, `machineOpenCount`(+O1이면 `openTracked`)를 더한다. 설명은 아래 문구로 바꾼다. 트래커 툴(`tracker-tools.ts`)은 그대로 둔다. |

MCP 설명:
> 이메일 발송 이력을 조회합니다. clickCount는 사람 클릭 수입니다(메일 보안 검사기 같은 봇 클릭은 빼고 셉니다). botClickCount는 봇으로 판정된 클릭 수입니다. openCount는 사람 오픈 추정 수(오픈 픽셀 요청 중 발송 60초 안과 검사기 UA를 뺀 수), machineOpenCount는 기계 오픈으로 본 수입니다. 오픈은 추정치입니다 — 이미지를 막으면 빠지고 Apple 메일은 열지 않아도 잡힐 수 있습니다. openTracked가 false인 발송은 픽셀이 없어 오픈을 알 수 없습니다.

## 11. 화면

### 11-1. `src/components/email/opens/types/index.ts` (신규)

```ts
export interface OpenSignal {
    /** 사람 오픈으로 본 픽셀 요청 수 (is_machine = false, 발송당 20까지 저장) */
    openCount: number;
    /** 기계 오픈(발송 60초 안·검사기 UA)으로 본 수 */
    machineOpenCount: number;
    /** 본문에 픽셀을 넣어 보낸 발송 (0089 뒤). false면 오픈을 알 수 없다 */
    openTracked: boolean;
}
/** 오픈 칸이 받는 줄. 사람 클릭 수도 본다 — 이미지를 막아도 클릭했으면 오픈이다 */
export interface OpenCellSource extends Partial<OpenSignal> { channel?: string; status: string; clickCount?: number }
export type OpenCellTone = "human" | "byClick" | "machine";
export type OpenCellView =
    | { kind: "empty" }
    | { kind: "dash" }
    | { kind: "badge"; tone: OpenCellTone; text: string; machineIcon: boolean; clickIcon: boolean; title: string };
```

### 11-2. `utils/openCell.ts` — `openCellView(src)` (B28)

1. `src.channel`이 있으면서 `"email"`이 아니거나, `status !== "sent"`이거나, `openTracked !== true`이면 `empty`를 반환한다. 알림톡·미발송·픽셀 없는 발송이 여기에 해당한다.
2. `human = openCount ?? 0`, `machine = machineOpenCount ?? 0`, `clicks = clickCount ?? 0`(사람 클릭)이 셋 다 0 이하면 `dash`를 반환한다.
3. title은 아래 조각을 순서대로 골라 `" · "`로 잇는다.
   - `사람 오픈 {human}회` (human > 0일 때)
   - `사람 클릭 {clicks}회로 오픈 셈` (human = 0이고 clicks > 0일 때)
   - `기계 오픈 {machine}회` (machine > 0일 때)
   - `사람 오픈 없음` (human = 0이고 clicks = 0일 때)
4. 반환값
   - human > 0이면 `{ tone: "human", text: "{human}회", machineIcon: false, clickIcon: false }`
   - clicks > 0이면 `{ tone: "byClick", text: "", clickIcon: true }`
   - 그 외에는 `{ tone: "machine", text: "", machineIcon: true }`

### 11-3. `ui/OpenCountCell.tsx` (표시만, `"use client"`, `ClickCountCell`과 같은 틀)

| tone | 상황 | variant | className | 아이콘 |
|---|---|---|---|---|
| human | 사람 오픈 | default | `bg-teal-600 text-xs` | 없음, 글자 `N회` |
| byClick | 사람 오픈 없이 사람 클릭 | outline | `border-teal-500 text-xs text-teal-700 dark:text-teal-300` | `MousePointerClick` |
| machine | 기계 오픈만 | outline | `border-dashed text-xs text-muted-foreground/70` | `Bot` (클릭 봇 칸과 같은 흐린 점선) |

- `empty`는 `null`을 그린다.
- `dash`는 `<span className="text-xs text-muted-foreground">-</span>`을 그린다.
- 툴팁은 `title`로 단다. 아이콘 크기는 Badge의 `[&>svg]:size-3`을 따른다.

### 11-4. 안내 조각

- `ui/OpenColumnHead.tsx`: `({ label = "오픈" })`를 받아 `<span className="inline-flex items-center gap-1" title={OPEN_NOTICE_TITLE}>{label}<Info className="h-3 w-3 text-muted-foreground" aria-hidden /></span>`를 그린다.
- `ui/OpenRateNotice.tsx`: `OPEN_NOTICE_LINES`를 `<ul className="space-y-0.5 text-xs text-muted-foreground">`에 4개의 `<li>`로 그린다.

### 11-5. 화면별 변경

| 파일 | 위치 | 바꿀 것 |
|---|---|---|
| `src/components/email/EmailSendLogTable.tsx` | 행 타입 :49-50, 머리 :437 뒤, 칸 :469 뒤 | `& Partial<OpenSignal>`. `<TableHead><OpenColumnHead /></TableHead>`. `<TableCell><OpenCountCell log={log} /></TableCell>` |
| `src/components/logs/UnifiedLogTable.tsx` | 머리 :177 뒤, 칸 :207 뒤 | 같은 두 줄. compact(레코드 상세)에서도 보인다. `RecordDetailDialog`는 바꾸지 않는다. |
| `src/components/email/EmailDashboard.tsx` | 카드 :103-127 | 6번째 카드 `{ label: "오픈율", value: openRateText(email?.openRate ?? null), sub: email ? openRatioText(email.opened, email.openBase) : undefined, icon: MailOpen, color: "text-teal-600" }` (6칸 그리드가 찬다) |
| | 카드 그리드 :166 뒤 | `<OpenRateNotice />` |
| | 유형별 표 :188-202 | 클릭률 다음에 `<TableHead className="text-right"><OpenColumnHead label="오픈율" /></TableHead>`와 `{openRateText(row.openRate)}` |
| | 추세 :236-243 뒤 | `<Line type="monotone" dataKey="emailOpened" name="오픈" stroke="#0d9488" strokeWidth={2} dot={false} />` |
| `src/components/email/DailyEmailTable.tsx` | 제목 :46·:56, 머리 :66 뒤, 줄 :98-100 뒤, 펼친 줄 :117 뒤 | 제목을 "날짜별 발송·클릭·오픈"으로 바꾼다. `오픈`, `<OpenColumnHead label="오픈율" />` 두 칸을 더한다. 값은 `openCountText(…)`, `openRateText(openRatePercent(…))` |
| `src/components/dashboard/TemplateRanking.tsx` | 머리 :38 뒤, 칸 :70 뒤 | `<TableHead className="w-[80px] text-right"><OpenColumnHead label="오픈율" /></TableHead>`. `item.channel === "email" ? openRateText(item.openRate) : "-"` |
| `src/components/dashboard/TrendChart.tsx` | 이메일 계열 :90 뒤 | `<Area type="monotone" dataKey="emailOpened" name="이메일 오픈" stroke="#0d9488" fill="#0d9488" fillOpacity={0.2} />` (stackId 없음) |

두 로그 표 `.tsx`에는 `openCount`, `machineOpenCount`, `openTracked`가 나오지 않는다(B29, 정적 테스트).

## 12. API 계약 변화 (모두 필드를 더하기만 한다)

| 경로 | 더해지는 것 | 그대로인 것 |
|---|---|---|
| `GET·HEAD /api/track/open` (신규) | 늘 200 + 43B GIF(HEAD는 본문 없음), 캐시 금지, 쿠키 없음 | — |
| `GET /api/analytics/summary` | `email.{opened, openBase, openRate}`, 유형별 같은 3칸 | 기존 칸, 오류 형식 |
| `GET /api/analytics/trends` | 날짜별 `emailOpened` | 기존 칸 |
| `GET /api/analytics/templates` | 이메일 줄 `opened, openBase, openRate`, 알림톡 줄 `0, 0, null` | total·sent·failed·clicked·정렬·limit |
| `GET /api/analytics/email-daily` | `totalOpened, totalOpenBase`, breakdown `opened, openBase` | sent·clicked |
| `GET /api/email/logs` | 줄마다 `openCount, machineOpenCount, openTracked` | 필터·정렬·totalCount·reply |
| `GET /api/logs/unified` | 이메일 줄에 같은 3칸 | 알림톡 줄, total·page·totalPages |
| MCP `list_email_logs` | `openCount, machineOpenCount`(+O1 `openTracked`), 설명 | 나머지, 트래커 툴 |

## 13. 파일 계획

| 파일 | 구분 | 역할 | 예상 줄 | 단위 |
|---|---|---|---|---|
| `src/lib/email-open-rules.ts` | 신규 | 판정 상수·순수 함수(import 없음) | ~75 | C1 |
| `src/lib/email-open-rules.test.ts` | 신규 | T1 | ~170 | C1 |
| `src/lib/email-open-pixel.ts` | 신규 | 토큰·URL·태그·자리·GIF·헤더 | ~110 | C2 |
| `src/lib/email-open-pixel.test.ts` | 신규 | T2 (200줄을 넘으면 자리 표를 `email-open-pixel-html.test.ts`로 뺀다) | ~190 | C2 |
| `src/lib/request-ip.ts` (+test) | 신규 | IP 헬퍼 | ~20 / ~40 | C2 |
| `drizzle/0120_email_open_tracking.sql` | 신규 | 4-1 | ~30 | C3 |
| `drizzle/meta/_journal.json` | 수정 | idx 89 | +7 | C3 |
| `src/lib/db/schema.ts` | 수정 | `openTracked`, `emailOpenLogs` | +25 | C3 |
| `src/lib/email-open-migration.test.ts` | 신규 | T8 | ~60 | C3 |
| `src/lib/email-open-tracking.ts` | 신규 | `recordOpen`, `recordOpenSafely` | ~70 | C4 |
| `src/app/api/track/open/route.ts` | 신규 | GET·HEAD | ~40 | C4 |
| `src/lib/email-click-tracking.ts` | 수정 | `applyEmailTracking` | +12 | C5 |
| 발송 7곳(8-2) | 수정 | import·호출·`openTracked` | 각 2~3줄 | C5 |
| `src/lib/email-open-static.test.ts` | 신규 | T7 | ~150 | C5(+C8에서 B29 추가) |
| `src/lib/email-open-sql.ts` (+test) | 신규 | 분모·분자 조각 | ~30 / ~30 | C6 |
| `src/components/email/opens/utils/openRate.ts` (+test) | 신규 | 비율·표기·안내 문구 | ~40 / ~50 | C6 |
| `src/app/api/analytics/{summary,trends,templates,email-daily}/route.ts` | 수정 | 9-4~9-7 | 각 +10~15 | C6 |
| `src/hooks/{useEmailAnalytics,useAnalytics,useEmailDaily}.ts` | 수정 | 타입 | 각 +3~6 | C6 |
| `src/components/email/opens/types/index.ts` | 신규 | 11-1 | ~40 | C7 |
| `src/lib/email-open-signals.ts` | 신규 | 10-1 | ~45 | C7 |
| `src/app/api/email/logs/route.ts`, `src/app/api/logs/unified/route.ts`, `src/types/index.ts`, `src/lib/mcp/tools.ts` | 수정 | 10-2 | 각 +3~8 | C7 |
| `src/components/email/opens/utils/openCell.ts` (+test) | 신규 | 11-2 | ~40 / ~110 | C8 |
| `src/components/email/opens/ui/{OpenCountCell,OpenColumnHead,OpenRateNotice}.tsx` | 신규 | 표시만 | ~35 / ~15 / ~20 | C8 |
| `EmailSendLogTable.tsx`, `UnifiedLogTable.tsx`, `EmailDashboard.tsx`, `DailyEmailTable.tsx`, `TemplateRanking.tsx`, `TrendChart.tsx` | 수정 | 11-5 | 각 +3~15 | C8 |

**바꾸지 않음**: `src/app/api/track/click/route.ts`, `recordClick`·`hasClicked`, `email-click-bot-rules.ts`, `RecordDetailDialog.tsx`, `AnalyticsSection.tsx`, `src/lib/mcp/tracker-tools.ts`, `rate-limit.ts`, `send-log-indexes.ts`, page.tsx 전부. 이미 200줄을 넘는 `EmailDashboard`(279줄)·`UnifiedLogTable`(265줄)·`EmailSendLogTable`(605줄)은 줄만 더하고 리팩터하지 않는다(범위 밖).

## 14. behavior → 구현 매핑

| B | 담당 | 고정 방법 |
|---|---|---|
| B1 | `appendOpenPixel`, `openPixelTag` | T2 |
| B2 | `applyEmailTracking` | T2(보존성) + T7(합성 순서) |
| B3 | `openPixelUrl`, `openSignature`, `verifyOpenSignature`, `parseOpenId` | T2 + T7(`timingSafeEqual`) |
| B4 | 8-2의 7곳 | T7 |
| B5 | insert body = 입히기 전, `applyEmailTracking`은 insert 뒤 | T7(위치) + Q3 운영 확인 |
| B6 | `GET`, `PIXEL_GIF`, `PIXEL_HEADERS` | T2 + 17-2 curl |
| B7 | `recordOpen`. "발송이 있으면"은 **open_tracked 발송이 있으면**으로 읽는다 | 17-2 |
| B8 | `HEAD` | 17-2 |
| B9 | `recordOpen`(트랜잭션 없음), `after()` | T7 + 코드 |
| B10 | `rateLimit`(라우트) + `shouldStoreOpen` | T1 + 17-2 |
| B11~B15 | `isEarlyOpen`, `isMachineOpenUserAgent`, `machineOpenReason` | T1 |
| B16 | 규칙 파일 import 없음, `isOpened|openedDate`는 `nhn-email.ts`에만 | T7 |
| B17~B19 | 0089, journal | T8 + 17-1 |
| B18(새 행 true) | 7곳 `openTracked: true` | T7 + Q3 |
| B20 | `openedSendSql` | T4 + 17-3 |
| B21 | summary + `openRatePercent` | T6 + 17-3 |
| B22 | trends | 17-3 |
| B23 | templates | 17-3(전후 같음) |
| B24 | email-daily | 17-3 |
| B25 | `openBaseSql` | T4 + 17-3 |
| B26 | `openSignalsForSendLogs` + 두 라우트 | 17-5 |
| B27 | MCP | 17-5 |
| B28 | `openCellView` | T5 |
| B29 | `OpenCountCell` + 두 표 | T7 + ego-browser |
| B30 | 11-5 대시보드·홈 | ego-browser |
| B31 | `OPEN_NOTICE_LINES`, `OpenRateNotice`, `OpenColumnHead` | T6 + ego-browser |
| B32 | 클릭 쪽 무변경 | 기존 테스트 + 17-3 클릭 값 비교 + `git diff` |
| B33 | 전체 | `pnpm test`, `pnpm exec tsc --noEmit`, 바꾼 파일 eslint |

## 15. TDD로 고정할 계약

`node:test`와 `node:assert/strict`를 쓰고, 테스트 이름은 `"B1: …"` 형식이다. 각 단위는 테스트를 먼저 쓰고 `pnpm test`가 RED인지 확인한 뒤 구현한다. **DB 모듈(`@/lib/db`를 부르는 파일)은 테스트에서 import하지 않는다.**

**T1 `email-open-rules.test.ts`**
- 준비: `SENT = 2026-10-21T00:00:00Z`, `at(ms)`, `CHROME`(클릭 테스트와 같은 UA)
- B11 (UA = CHROME)

| 오픈(ms) | `isEarlyOpen` | `machineOpenReason` |
|---|---|---|
| 59_999 | true | `"early"` |
| 0 | true | `"early"` |
| -1_000 | true | `"early"` |
| 60_000 | false | null |
| 60_001 | false | null |

- B12: `null`, `undefined`, `""`, `"   "`, `"\t"` → `isMachineOpenUserAgent` true, `reason(+120_000)`은 `"ua"`
- B13: 5-2 표의 22개 × (원문·대문자·소문자) → true, `"ua"`. CUBOT도 true.
- B14: 5-3 표 → `isMachineOpenUserAgent` false. `reason(+120_000)`은 null이고 `reason(+1_000)`은 `"early"`다. 예외 우선 UA도 false.
- B15: `(curl, +1_000)` → `"ua"`, `(null, 0)` → `"ua"`, `(Gmail UA, +1_000)` → `"early"`
- 상한 (`shouldStoreOpen`)

| openTracked | isMachine | storedHuman | storedMachine | 기대 |
|---|---|---|---|---|
| true | false | 0 | 0 | true |
| true | false | 19 | 10 | true |
| true | false | 20 | 0 | false |
| true | true | 0 | 9 | true |
| true | true | 50 | 10 | false |
| false | false | 0 | 0 | false |
| false | true | 0 | 0 | false |

**T2 `email-open-pixel.test.ts`** (`opts = { secret: "test-secret", baseUrl: "https://t.example" }`)
- `parseOpenId`: `"1"`→1, `"2147483647"`→2147483647. `"2147483648"`, `"0"`, `"-1"`, `"01"`, `"1.0"`, `"1e3"`, `" 1"`, `"abc"`, `""`, `null`은 모두 null.
- `openSignature(123, k)`: `/^[A-Za-z0-9_-]{16}$/`에 맞고 반복해도 같다. id 124나 다른 secret이면 다르다.
- `verifyOpenSignature`
  - `(123, sig123)`은 true다.
  - 아래는 모두 false다: id 124, 마지막 글자를 바꾼 서명, `""`, `null`, 17자, 다른 secret, secret `""`.
- `verifiedOpenId`: `id=123&s=sig123`은 123이다. s 없음, id 없음, `id=abc`, `id=0123`은 null이다.
- `openPixelUrl(123, opts)`는 `https://t.example/api/track/open?id=123&s=${sig123}`와 정확히 같다.
- `openPixelTag`는 6-2 문자열(`&amp;`)과 같고 `/<a\s/i`에 맞지 않는다.
- `appendOpenPixel` 자리 표(모두 `/api/track/open?`가 정확히 1번 나오고, `out.replace(tag, "") === input`이다)

| 입력 | 기대 자리 |
|---|---|
| `<p>안녕</p>` | 맨 앞 |
| `<html><body style="margin:0"><p>x</p></body></html>` | `<body style="margin:0">` 바로 뒤 |
| `<HTML><BODY><p>x</p></BODY></HTML>` | `<BODY>` 뒤 |
| `<!DOCTYPE html><html><head><title>t</title></head><div>x</div></html>` | `</head>` 뒤 |
| `<!doctype html><div>x</div>` | doctype 뒤 |
| `<html><div>x</div></html>` | `<html>` 뒤 |
| `<body><p>a</p><body>` | 첫 `<body>` 뒤 하나만 |
| `<bodyx>t` | 맨 앞 (`\b`) |
| `""` | 태그만 |

- B2 보존성: `<a href="https://sendb.kr/api/track/click?id=7&url=https%3A%2F%2Fa.example">`가 든 본문에서 링크가 그대로 남고 픽셀이 1개 늘어난다.
- `PIXEL_GIF`
  - 길이 43, 앞 6바이트 `"GIF89a"`
  - `[22] & 1 === 1`(투명), `[25] === 0`
  - `Buffer.from(PIXEL_GIF).toString("base64")`가 6-3의 base64와 같다.
- `PIXEL_HEADERS`: `Content-Type` image/gif, `Content-Length` "43", `Cache-Control`에 no-store가 있고 `Set-Cookie` 키는 없다.

**T3 `request-ip.test.ts`**
- `"203.0.113.7, 10.0.0.1"` → `"203.0.113.7"`
- `" 2001:db8::1 "` → `"2001:db8::1"`
- XFF 없음 + x-real-ip `198.51.100.2` → 그 값
- XFF `"<b>"` + real-ip → real-ip 값
- 46자 → null
- 둘 다 없음 → null

**T4 `email-open-sql.test.ts`**
- `new PgDialect().sqlToQuery(openBaseSql("f")).sql`이 `f.open_tracked AND f.status = 'sent'`와 같다.
- `openedSendSql("email_send_logs")`가 9-2 문자열과 정확히 같다.
- 두 조각 모두 params는 `[]`다.

**T5 `openCell.test.ts`** (status를 적지 않으면 `"sent"`)

| # | 입력 | 기대 |
|---|---|---|
| 1 | `{ channel:"alimtalk", status:"sent", openTracked:true, openCount:3 }` | empty |
| 2 | `{ status:"failed", openTracked:true, openCount:1 }` | empty |
| 3 | `{ channel:"email", status:"pending", openTracked:true }` | empty |
| 4 | `{ openTracked:false, openCount:2, clickCount:1 }` | empty (픽셀 없는 발송) |
| 5 | `{ openCount:1 }` (openTracked 없음) | empty |
| 6 | `{ openTracked:true }` | dash |
| 7 | `{ openTracked:true, openCount:0, machineOpenCount:0, clickCount:0 }` | dash |
| 8 | `{ openTracked:true, openCount:2 }` | human, `"2회"`, `"사람 오픈 2회"` |
| 9 | `{ openTracked:true, openCount:1, machineOpenCount:3 }` | human, `"1회"`, `"사람 오픈 1회 · 기계 오픈 3회"` |
| 10 | `{ channel:"email", openTracked:true, openCount:1, clickCount:2 }` | human, `"1회"`, `"사람 오픈 1회"` |
| 11 | `{ openTracked:true, machineOpenCount:4 }` | machine, `""`, machineIcon, `"기계 오픈 4회 · 사람 오픈 없음"` |
| 12 | `{ openTracked:true, clickCount:2 }` | byClick, `""`, clickIcon, `"사람 클릭 2회로 오픈 셈"` |
| 13 | `{ openTracked:true, clickCount:1, machineOpenCount:2 }` | byClick, `"사람 클릭 1회로 오픈 셈 · 기계 오픈 2회"` |
| 14 | 모든 badge의 text | `/^(\d+회)?$/` |

**T6 `openRate.test.ts`**
- `openRatePercent`: `(0,0)` → null, `(1,3)` → 33.3, `(2,2)` → 100, `(0,5)` → 0
- `openRateText`: `null` → `"—"`, `12.3` → `"12.3%"`
- `openRatioText`: `(3,6)` → `"3/6"`, `(0,0)` → undefined
- `openCountText`: `(3,0)` → `"—"`, `(3,6)` → `"3"`
- `OPEN_NOTICE_LINES.length <= 4`이고, 합친 글에 `추정`·`60초`·`검사기`·`링크`·`이미지`·`Apple`이 모두 들어 있다.

**T7 `email-open-static.test.ts`** (파일을 읽어 문자열로 확인한다. 정규식은 `/\bwrapTrackingUrls\(/` 꼴)
- **B4**
  - 7개 파일에 `applyEmailTracking(`가 있고 `wrapTrackingUrls(`는 없다.
  - `src`를 재귀로 읽어(`.test.ts` 제외) `wrapTrackingUrls(`가 나오는 파일은 `src/lib/email-click-tracking.ts` 하나뿐이다.
- **B18(코드)**
  - drizzle 경로 5개 파일에 `openTracked: true`가 있다(`email-followup.ts`는 2번).
  - visit-ack 파일은 `/sender_email,\s*open_tracked\)/`와 `/,\s*true\s+FROM owned/`에 맞는다.
- **B5**: 파일마다 insert 표지(`insert(emailSendLogs)` 또는 `INSERT INTO email_send_logs`)와 `applyEmailTracking(`의 위치를 차례로 짝지었을 때, 언제나 apply가 뒤에 있다.
- **B2**: `email-click-tracking.ts`에 `return appendOpenPixel(wrapTrackingUrls(html, sendLogId), sendLogId);`가 있다.
- **B9**
  - `email-open-tracking.ts`는 `/\.transaction\(|advisory/i`에 맞지 않는다.
  - route.ts는 `/after\(\(\) => recordOpenSafely\(/`에 맞고 `/\bawait\b/`에 맞지 않으며, `export function HEAD(`가 있다.
- **B6**: route.ts는 `/cookie/i`에 맞지 않는다.
- **B3**: `email-open-pixel.ts`에 `timingSafeEqual(`가 있다.
- **B16**
  - `email-open-rules.ts`는 `/^\s*import\s/m`에 맞지 않는다.
  - src(테스트 제외)에서 `/\b(isOpened|openedDate)\b/`가 나오는 파일은 `src/lib/nhn-email.ts` 하나뿐이다.
- **B29**(C8에서 추가): 두 표 `.tsx`에 `<OpenCountCell log={log} />`가 있고 `/openCount|machineOpenCount|openTracked/`는 없다.

**T8 `email-open-migration.test.ts`** (`flat` = 주석 제거 + 공백 하나로)
- `trimStart()`가 `SET LOCAL lock_timeout = '5s';`로 시작한다.
- 들어 있어야 하는 것
  - `ALTER TABLE "email_send_logs" ADD COLUMN IF NOT EXISTS "open_tracked" boolean DEFAULT false NOT NULL;`
  - `CREATE TABLE IF NOT EXISTS "email_open_logs"`
  - `"send_log_id" integer NOT NULL REFERENCES "email_send_logs"("id") ON DELETE CASCADE`
  - `"is_machine" boolean NOT NULL`, `"machine_reason" varchar(16)`, `"opened_at" timestamptz DEFAULT now() NOT NULL`
  - 4-1의 색인 문장
- ALTER가 CREATE TABLE보다 앞에 있다.
- 없어야 하는 것: `/UPDATE\s+"?email_send_logs/i`, `/SET DEFAULT/i`, `/CREATE INDEX[^;]*ON "email_send_logs"/`
- journal: idx 89가 정확히 1개다. tag `0120_email_open_tracking`, when `1775200000000`, idx 88보다 크고 `breakpoints` true다.

API 라우트, SQL 결과, 화면은 17절 로컬 검증으로 본다.

## 16. Codex 구현 단위

지시문에는 **"설계와 어긋나면 지어내지 말고 멈춰서 물어라"**를 넣는다. 답이 설계 변경이면 이 문서를 먼저 고친다.

| # | 내용 | 먼저 RED | behavior | 통과 조건 |
|---|---|---|---|---|
| C1 | `email-open-rules.ts` | T1 | B11~B15, B10(상한) | T1 GREEN, import 없음 |
| C2 | `email-open-pixel.ts`, `request-ip.ts` | T2, T3 | B1, B3, B6(바이트·헤더) | GREEN, tsc |
| C3 | 0089, journal, schema.ts | T8 | B17~B19 | GREEN, tsc, 17-1 로컬 부팅 증거 |
| C4 | `email-open-tracking.ts`, `api/track/open/route.ts` | — | B6~B10 | tsc, eslint, 17-2 curl 표 증거 |
| C5 | `applyEmailTracking` + 7곳 + T7(B2·B4·B5·B9·B16·B3·B6) | T7 | B2, B4, B5, B18(코드) | `pnpm test`, tsc |
| C6 | `email-open-sql.ts`, `opens/utils/openRate.ts`, 집계 4곳, 훅 타입 | T4, T6 | B20~B25 | GREEN, tsc, 17-3 fixture 대조, 9-9 관문 |
| C7 | `opens/types`, `email-open-signals.ts`, 행 API 2곳, `UnifiedLog`, MCP | — | B26, B27 | tsc, 17-5 대조 |
| C8 | `openCell.ts`, ui 3개, 화면 6곳, T7에 B29 추가 | T5 | B28~B31 | GREEN, tsc, eslint. 화면은 Claude가 ego-browser로 본다(17-6). |
| C9 | 마무리 | — | B32, B33 | `pnpm test`, `pnpm exec tsc --noEmit`, 바꾼 파일 eslint(기준선과 비교), 클릭 쪽 `git diff` 무변경 |

**순서와 의존**
- C3은 C4~C7보다 먼저 한다(스키마). C1은 C4보다, C2는 C5보다 먼저 한다.
- C6의 `openRate.ts`와 C7의 `types`는 C8보다 먼저 한다.
- **C4는 C5와 같거나 앞선 커밋에 넣는다.** 라우트 없이 픽셀이 나가면 이미지가 404를 받는다.

**커밋 제안** (각각 사용자 확인 뒤, push는 운영 반영 요청 때 한 번에)
- [C1–C3] 오픈 판정·서명·스키마
- [C4–C5] 오픈 기록 경로와 발송 픽셀
- [C6–C7] 오픈율 집계와 행 신호
- [C8] 오픈 화면

## 17. 로컬 검증 기대값과 운영 확인

로컬 DB(`postgresql://jaehun@localhost:5432/salesflow`)에 가상 조직 uuid로 fixture를 만들고, 끝나면 그 조직의 발송을 지운다(오픈·클릭은 cascade로 함께 지워진다). 증거는 `docs/2026-10-20-email-open-pixel/evidence/`에 둔다. 서명 URL은 로컬 `JWT_SECRET`으로 `openPixelUrl(id)`를 찍는 일회용 명령으로 만든다.

**17-1. 0089 (C3)**
1. 부팅 전에 `SHOW server_version`(11 이상)과 `SELECT pg_relation_filenode('email_send_logs')`를 적어 둔다.
2. 부팅 로그에 `[migrate] 마이그레이션 완료!`가 나온다.
3. `\d email_open_logs`에서 칸, FK(cascade), 색인을 확인한다.
4. filenode가 부팅 전과 같다. `SELECT atthasmissing, attmissingval FROM pg_attribute WHERE attrelid='email_send_logs'::regclass AND attname='open_tracked'`는 `t | {f}`다. `count(*) FILTER (WHERE open_tracked)`는 0이다.
5. 재부팅 뒤 `drizzle.__drizzle_migrations`에 `created_at = 1775200000000`인 줄이 1개뿐이다.

**17-2. 공개 경로 (C4)**
- 발송을 세 개 만든다.
  - A: `sent_at = now() - interval '1 hour'`, tracked
  - B: 검사 직전 `now()`, tracked. 60초 안에 요청한다.
  - C: `open_tracked = false`
- 모든 응답은 `200`, 43B, `image/gif`, no-store, Set-Cookie 없음이어야 한다.

| # | 요청 | 기대 행 |
|---|---|---|
| R1~R4 | A에 Chrome / GoogleImageProxy / Outlook MSIE / `Mozilla/5.0` | 각 1행, `is_machine=false`, 사유 NULL |
| R5·R6 | A에 curl 기본 UA / `-A ""` | `true` / `ua` |
| R7~R12 | B에 R1~R6 | 앞 4개는 `early`, 뒤 2개는 `ua` |
| R13 | 서명 한 글자 바꿈 | 없음 |
| R14 | s 없음, id 없음, `id=abc`, `id=0`, `id=99999999999` | 없음 |
| R15 | 서명은 맞는 없는 id | 없음 |
| R16 | C(서명 맞음) | 없음 |
| R17 | `curl -I` A | 같은 헤더, 본문 없음, 행 없음 |
| R18 | 같은 URL 200회를 `xargs -P50`으로 | 응답은 모두 `200 43`, 새 행은 10 이하(레이트). 부하 중 `pg_stat_activity` active는 기준선+4 이하 |
| R19 | A에 사람 행 20개를 SQL로 넣은 뒤 Chrome 요청 | 늘지 않음 |
| R20 | 방금 보낸 발송에 기계 행 10개를 넣고 curl 요청, 이어서 1시간 전 발송에 Chrome 요청 | 기계는 늘지 않음, 사람은 1행 |
| R21 | `ALTER TABLE email_open_logs RENAME TO email_open_logs_off` 뒤 요청 | 200 GIF. 서버 로그 `[open-pixel] 오픈 기록 실패 … 42P01` 한 줄. 끝나면 이름을 되돌린다. |

**17-3. 집계 fixture (C6, 모두 같은 날 T, trigger `auto`, 기존 연결 id·파티션 id를 빌려 쓴다)**
- 연결 조인에는 조직 조건이 없어서 기존 id를 빌려도 된다. 빌린 행은 고치지 않는다.

| 발송 | 상태 | tracked | 기록 |
|---|---|---|---|
| S1 | sent | ✓ | 없음 |
| S2 | sent | ✓ | 기계 오픈 1 |
| S3 | sent | ✓ | 사람 오픈 1 |
| S4 | sent | ✓ | 사람 클릭 1 |
| S5 | sent | ✓ | 봇 클릭 1 |
| S6 | sent | ✗ | 사람 클릭 1 |
| S7 | failed | ✓ | 사람 오픈 1 |
| S8 | sent | ✓ | 사람 오픈 2 + 사람 클릭 1 |

- 기대 값
  - openBase = 6 (S1~S5, S8)
  - opened = 3 (S3, S4, S8)
  - openRate = 50.0
  - clicked = 3 (S4, S6, S8), sent = 7, total = 8, clickRate = 42.9 (변경 전과 같다)
- 라우트별
  - summary: 위 값
  - trends: T의 `emailOpened = 3`
  - templates: 빌린 연결 줄이 위 값이고, total·sent·failed·clicked가 변경 전 응답과 같다.
  - email-daily: `totalOpened 3`, `totalOpenBase 6`
- API는 로컬 `JWT_SECRET`으로 가상 조직 사용자 토큰을 만들어 `Authorization: Bearer`로 부른다.

**17-4. 성능**: 9-9 fixture로 측정한다. 기준을 넘으면 멈추고 보고한다.

**17-5. 행 API·MCP (C7)**
- 변경 전에 `/api/email/logs`와 `/api/logs/unified`의 페이지 1·2를 저장해 둔다.
- 변경 뒤 id 순서, total, totalPages가 같아야 한다.
- 행 값: S2는 `0/1/true`, S3는 `1/0/true`, S8은 `2/0/true`, S6은 `openTracked false`. 알림톡 줄에는 새 칸이 없다.

**17-6. 화면 (Claude, ego-browser — PLAN 검증 8의 빈 DB 방식)**
- EmailDashboard는 `appKey`가 있어야 열린다(`useEmailConfig.ts:49`). 그 DB의 가상 조직에 실제 키가 아닌 값으로 설정 행을 넣는다. 개발 모드에서는 발송 스케줄러가 돌지 않는다.
- S1~S8 칸 모양: `-`, 기계 아이콘, `1회`, 클릭 아이콘, `-`, 빈칸, 빈칸, `2회`. 툴팁 문구도 본다.
- 오픈율 카드 50.0%와 `3/6`, 안내 4줄, 유형별·날짜별·규칙별 오픈율, 추세 두 곳의 오픈 선을 본다.
- 대상이 0인 기간은 "—"인지 본다. 레코드 상세 compact 폭과 다크 모드도 한 번 본다.

**17-7. 운영 확인 (Q3, 사용자가 운영 반영을 요청한 뒤)**
1. 본인 레코드 1건에 수동 발송으로 ghty6323@gmail.com에 한 통 보낸다.
2. Gmail "원본 보기"에서 본문 맨 앞에 `/api/track/open?id=…&amp;s=…`가 있는지 본다.
3. 발송 이력에서 그 줄의 오픈 칸이 빈칸이 아니라 `-` 또는 아이콘인지 본다(B18 새 행 true).
4. 60초 안에 Gmail 프리페치가 있으면 기계 아이콘이 생긴다. 없을 수도 있다.
5. 몇 분 뒤 Gmail에서 열면 `1회`가 된다. 다시 열 때 늘어나는지도 본다(프록시 캐시에 따라 다르다).
6. 발송 이력 상세 Sheet로 본문을 미리 봐도 수가 늘지 않는다(B5).
7. UA를 확인해야 하면 사용자 승인을 받아 그 발송 id 하나만 운영 DB에서 읽기 조회한다.

## 18. 도메인 체크리스트

| 영역 | 결과 |
|---|---|
| 데이터 모델 | 새 표 1개(FK cascade, ip·ua·사유는 nullable), 복합 색인 1개, 큰 표에 메타데이터만 바뀌는 칸 1개. 삭제는 발송을 따라 cascade. 보관 기간은 범위 밖. 소급 없음. |
| API 계약 | 필드를 더하기만 한다. 픽셀 라우트는 늘 200 GIF다. 반복 요청은 상한과 레이트로 흡수하고, 집계는 발송 단위 EXISTS라 멱등이다. |
| 상태 관리 | SWR 서버 상태만 쓴다. 새로 고침 주기와 낙관적 업데이트는 바꾸지 않는다. |
| 보안 | 픽셀은 인증 없는 공개 경로라 HMAC 서명(96비트, 상수 시간)이 문지기다. org는 요청이 아니라 발송 로그에서 가져온다. 입력은 라우트에서 검증한다(id·s 정규식, IP 모양, UA 512자). 키는 `JWT_SECRET` 파생이고 찍지 않는다. 집계·행 API는 기존 `getUserFromNextRequest`와 org 조건을 그대로 쓰고, 신호 도우미는 org를 두 겹으로 거른다. |
| 동시성 | 트랜잭션이 없고 insert 한 문장은 autocommit이다. 상한은 느슨하다(+3까지). FK `KEY SHARE`와 발송 status UPDATE `NO KEY UPDATE`는 서로 막지 않는다. 레이트는 인스턴스 기준이다. |
| 성능 | 집계 EXISTS는 복합 색인으로 처리하고, 옛 발송은 단락 평가로 건너뛴다. 9-9 관문을 둔다. 행 신호는 페이지당 1회(≤100 id)다. 번들에는 기존 lucide 아이콘만 더해진다. |

## 19. PLAN과 어긋나는 곳

1. 저장 상한을 단일 N 대신 사람 20·기계 10으로 나눴다(2-1).
2. templates는 PLAN처럼 EXISTS로 다시 쓰지 않는다. 오픈은 조인하지 않고 FILTER로 세므로 행 곱이 없다. 기존 LEFT JOIN·`count(distinct)`는 그대로 두어 기존 칸이 바뀌지 않음을 코드로 보장한다.
3. 오픈율 분모에 `status = 'sent'`를 명시했다(클릭률의 "발송"과 같은 기준).
4. B7의 "발송이 있으면"은 open_tracked 발송으로 읽는다. 픽셀이 없는 발송에는 서명된 URL이 존재할 수 없다는 점의 안전장치다.
5. 새 파일이 늘었다.
   - `src/lib/email-open-sql.ts`(+test): 집계 정의를 한 곳에 둔다.
   - `src/lib/request-ip.ts`(+test): IP 헬퍼
   - `src/lib/email-open-migration.test.ts`: 정적 테스트를 둘로 나눠 200줄을 넘지 않게 했다.
   - `opens/utils/openRate.test.ts`, `opens/ui/OpenColumnHead.tsx`
6. B2는 DB 모듈을 테스트에서 불러오지 않으려고, 순수 보존성 테스트와 정적 합성 순서 확인으로 고정한다.
7. 픽셀 위치를 본문 맨 앞으로 정했다(PLAN에서 미정이던 것).
8. MCP에 `openTracked`를 더하는 안(O1)이 있다.

## 20. 기존 클릭 경로 결함 메모 (이번에 건드리지 않음 — 별건 권장)

1. **열린 리다이렉트**: `/api/track/click`이 `url`을 검증 없이 302로 보낸다(`src/app/api/track/click/route.ts:35-38`).
2. **서명 없는 id**: 누구나 아무 발송의 클릭을 만들 수 있다. 그러면 후속 분기(`hasClicked`)까지 바뀐다.
3. **HEAD도 기록된다**: HEAD를 내보내지 않아 Next가 GET으로 처리하고, HEAD 요청도 클릭으로 기록된다.
4. **잠금 대기**: `recordClick`이 트랜잭션 안에서 advisory 잠금을 잡는다. 같은 발송으로 요청이 몰리면 풀을 점유한다.
5. **IP 처리**: `x-forwarded-for` 첫 값을 쓰는데, 이 값은 클라이언트가 넣을 수 있다. 50자를 넘으면 insert가 실패해 클릭이 사라진다.
6. **느슨한 id 파싱**: `Number(idStr)`라 `"1e3"` 같은 값도 통과한다(경미).

## 21. 리스크와 열린 결정

**리스크**
- **정확도**
  - 이미지를 막으면 오픈이 빠진다(클릭으로만 잡힌다).
  - Apple MPP가 60초 밖에서 미리 받으면 사람으로 센다.
  - Gmail 프록시가 캐시하면 다시 열어도 요청이 오지 않을 수 있다.
  - NHN 발송이 60초 넘게 밀리면 프리페치가 사람으로 샌다.
- **회신·전달 인용**
  - 고객 회신이나 직원 전달 메일의 인용 본문에 픽셀이 따라간다. 직원이 자기 메일함에서 열면 그 발송의 사람 오픈이 남는다.
  - 오픈율은 발송 단위라, 영향을 받는 것은 이미 회신한(= 연) 발송뿐이다. 다만 `N회` 수는 늘 수 있다. 앱의 회신 화면은 HTML을 그리지 않아 해당이 없다.
- **숫자 인식**: 예전 NHN 12%에 익숙하면 새 값은 6% 안팎이다. 팀에 미리 알린다.
- **UA 표**: CUBOT 같은 부분 일치 오탐이 있다. 국내 웹메일(네이버·다음)의 이미지 프록시 UA와 프리페치 여부는 확인되지 않았다(O3).
- **전달률**: 평문형 AI 메일에도 이미지가 하나 붙는다. 반영 뒤 발신 건강(반송·차단)을 지켜본다.
- **마이그레이션**
  - 0089가 `email_send_logs`의 잠금을 잡으려고 최대 5초씩(재시도 3번) 기다리는 동안 그 표의 기록과 조회가 줄을 선다.
  - 실패하면 서버가 뜨지 않는다(기존 F1 동작).
- **롤백**
  - 코드만 되돌려도 칸과 표는 남는다(무해하다. 옛 코드의 insert는 기본값 false다).
  - 이미 보낸 메일의 픽셀은 404가 되어 깨진 1px 이미지가 될 수 있다.
- **키 회전**: `JWT_SECRET`을 바꾸면 그 전 메일의 오픈은 기록되지 않는다(GIF는 그대로 돌려준다). `JWT_SECRET`이 없으면 발송이 NHN 전에 던지고 자리를 돌려준다. `auth.ts`도 import 때 던지므로 새 위험은 아니다.
- **남용**: 레이트는 인스턴스 메모리 기준이다. 인스턴스가 여럿이면 상한이 그 배수가 된다.
- **기타**: `after()` 작업은 배포 순간 잃을 수 있다. 개인정보(IP·UA)는 클릭과 같은 수준으로 저장하고, 보관 정책은 범위 밖이다. 레코드 상세 compact 표 폭은 화면에서 확인한다.

**열린 결정 (기본안과 함께)**
- **O1 (기본안: 포함)**: MCP `list_email_logs`에 `openTracked`도 붙인다. B27은 두 칸만 요구하지만, 0이 "안 열림"인지 "알 수 없음(픽셀 도입 전)"인지 구분하려면 필요하다.
- **O2 (기본안: 발송 창 밖)**: 운영 반영은 평일 09~18시(발송 창) 밖, 대량 발송이 없을 때 한다. 0089의 잠금 대기가 발송 기록을 잠깐 멈출 수 있어서다.
- **O3 (기본안: 가능하면 추가)**: Q3 확인 때 본인 네이버 메일 주소에도 한 통 보낸다. 국내 웹메일의 이미지 UA와 프리페치 여부를 보고, 필요하면 5-2·5-3 표를 고친다. 주소가 없으면 Gmail만 확인한다.
- **O4 (기본안: 그대로)**: 상한·레이트 수치(사람 20·기계 10, 발송당 분당 10회, 동시 4)는 운영의 요청 분포를 본 뒤 조정한다.
