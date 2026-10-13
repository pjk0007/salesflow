# DESIGN — 이메일 클릭 봇 필터

- **track**: Full
- **사이클 ID**: `2026-10-13-email-click-bot-filter`
- **근거**: PLAN.md(2026-10-13 승인), behaviors.json B1~B28
- **브랜치**: `main` (사용자 지시 — AGENTS.md의 dev 규칙은 이 작업에 적용하지 않는다). `main` c94ab8c에는 dev 78efbb4가 병합돼 있어 `drizzle/` 상태가 같다. 다음 번호는 0080이다.
- **마이그레이션**: `drizzle/0080_email_click_bot.sql`, journal idx 80, when 1774300000000
- **새 의존성**: 없음
- **화면 기준**: 루트 `DESIGN.md`는 없다. 다음 기존 관례를 따른다.
  - `Badge` (`src/components/ui/badge.tsx`). `[&>svg]:size-3 gap-1`이 들어 있다.
  - 기존 클릭 뱃지 (`bg-blue-600`, `N회`)
  - `ReplyKindBadge`의 `title` 툴팁
- 줄 번호는 2026-10-13 작업 트리 기준이다. 어긋나면 인용된 코드로 찾는다.

## 0. 판정 입력 원칙 (모든 결정의 전제)

- **봇 판정(`is_bot`·`bot_reason`)의 입력은 클릭 기록뿐이다.**
  1. 그 클릭의 UA: `email_click_logs.user_agent`
  2. 그 클릭 시각과 발송 시각: `email_click_logs.clicked_at`, `email_send_logs.sent_at`
  3. 같은 발송의 다른 클릭 시각: 같은 `send_log_id`의 `clicked_at`
- **트래커 사이트 이벤트가 있는지 없는지로 봇을 판정하지 않는다.** 트래커가 있는 사이트로 간 클릭이든 없는 사이트(구글폼 등)로 간 클릭이든, 같은 3규칙(ua, early, burst)만 적용한다.
- 트래커 데이터(`tracker_sessions`, `tracker_events`, `tracker_sites`)는 **2단계 표시용 `hasSiteAction`에만** 쓴다(6절). 사이트 행동이 있어도 봇을 사람으로 되돌리지 않는다(범위 밖).
- 이 원칙은 코드로 지킨다.
  - `email-click-bot-rules.ts`에는 import가 없다.
  - `recordClick()`은 트래커 표를 읽지 않는다.
  - 0080 SQL은 `tracker_` 표를 참조하지 않는다.
  - `email-click-bot-sql.test.ts`가 위 세 가지를 정적으로 확인한다(13-2).

## 1. 결정 요약

| # | 질문 | 결정 |
|---|---|---|
| ① | 사유 값·우선순위 | `bot_reason`은 `ua`, `early`, `burst` 중 하나다. NULL이면 사람이다. 사유는 하나만 남기고 ua → early → burst 순으로 정한다. 이미 봇인 클릭의 사유는 덮어쓰지 않는다. |
| ② | `recordClick` 순서·잠금 | 트랜잭션 밖에서 발송을 읽는다. 트랜잭션 안에서 잠금(`0x5c4edf14`, send_log_id) → clickedAt(JS) → ua/early 판정 → insert → ±20초 창 읽기 → burst update(`is_bot = false`인 행만) 순으로 처리한다. |
| ③ | 클릭 신호 도우미 | 새 파일 `src/lib/email-click-signals.ts`의 `clickSignalsForSendLogs(orgId, logIds)`. 발송별 그룹 쿼리 하나로 사람 클릭 수, 봇 클릭 수, hasSiteAction(같은 조직 사이트의 CLICK·CUSTOM)을 구한다. |
| ④ | 통합 로그 클릭 수 | UNION 안의 상관 서브쿼리를 지운다. 페이지를 가져온 뒤 이메일 줄 id로 ③을 호출해 붙인다. |
| ⑤ | 백필 (b) SQL | 창 함수 `count(*) OVER (PARTITION BY send_log_id ORDER BY clicked_at RANGE BETWEEN interval '10 seconds' PRECEDING AND interval '10 seconds' FOLLOWING) - 1 >= 2`. `is_bot = false`인 행만 update한다. |
| ⑥ | 봇 제외 공통 조각 | 만들지 않는다. 9곳에서 `is_bot = false` 또는 `eq(emailClickLogs.isBot, false)`를 직접 쓴다. |
| ⑦ | 클릭 칸 시각 | 순수 함수 `clickCellView()`가 표시를 결정하고, `ClickCountCell`은 그리기만 한다. 사람 클릭은 기존 파란 `N회`다. 사이트 행동이 있으면 `MousePointerClick` 아이콘, 굵은 글씨, `ring-2`를 더한다. 봇 클릭만 있으면 흐린 점선 테두리에 `Bot` 아이콘만 둔다. 툴팁은 `title`로 단다. 보이는 한글은 기존 `회`뿐이다. |

PLAN에서 바뀐 점은 두 가지다.
- 도우미를 `email-click-tracking.ts`에 넣지 않고 새 파일로 분리한다(6-1).
- B13 테스트를 `src/lib/email-click-bot-sql.test.ts`로 분리한다. 성격이 다르고, 합치면 200줄을 넘는다.

## 2. 결정 ① 사유 값·우선순위·규칙 파일

### 2-1. 비교

| 안 | 장점 | 단점 |
|---|---|---|
| **A. 사유 하나 + 우선순위 (택함)** | 칸 하나로 끝난다. 백필이 UPDATE 3단으로 단순하다. 집계는 `is_bot`만 보면 된다. | 여러 규칙이 동시에 맞았다는 정보는 남지 않는다. |
| B. 규칙별 boolean 3칸 | 분석용 정보가 남는다. | 재판정과 백필에서 3칸을 함께 맞춰야 한다. 쓸 곳이 없다(YAGNI). |
| C. UA 판정 라이브러리(`isbot` 등) | 목록을 남이 관리해 준다. | 메일 보안 검사기 모양(`Mozilla/5.0 Chrome/`, `MSIE`)을 잡지 못한다. 운영에서 검증한 R6와 결과가 달라진다. 백필 SQL과 같은 뜻으로 유지하기도 어렵다. |

대가: 토큰 목록을 우리가 관리해야 한다. B13 테스트가 TS 상수와 SQL을 묶어서 둘이 어긋나지 않게 한다.

### 2-2. `src/lib/email-click-bot-rules.ts` (신규, import 없음)

```ts
/** 발송 뒤 이 시간 "미만"에 온 클릭은 봇 (음수 포함). 정확히 15초는 사람 쪽 */
export const EARLY_CLICK_MS = 15_000;
/** 한 클릭 기준 ± 이 폭 (정각 포함) 안의 같은 발송 클릭을 이웃으로 센다 */
export const BURST_WINDOW_MS = 10_000;
/** 이웃이 이만큼 이상이면 연속 클릭(봇) */
export const BURST_MIN_NEIGHBORS = 2;
/**
 * 봇 UA (대소문자 무시). JS `new RegExp(.., "i")`와 PostgreSQL `~*`에서 같은 뜻이 되게
 * 역슬래시·작은따옴표 없이 쓴다 — 점은 "[.]". 0080 SQL에 같은 문자열이 그대로 있다 (B13)
 */
export const BOT_UA_PATTERN =
    "curl|python|node-fetch|ruby|go-http|java/|guard|antispam|linker|scan|bot|spider|preview|headless|wget|okhttp|msie|^mozilla/5[.]0 chrome/";

/** 우선순위 순서. NULL(=사람)은 사유 없음 */
export type BotReason = "ua" | "early" | "burst";

export interface BurstClick {
    id: number;
    sendLogId: number;
    clickedAt: Date;
    isBot: boolean;
}

/** null·undefined·공백뿐(trim 뒤 "")이거나 BOT_UA_PATTERN에 맞으면 true (B1~B3) */
export function isBotUserAgent(userAgent: string | null | undefined): boolean;

/** clickedAt - sentAt < EARLY_CLICK_MS (B4) */
export function isEarlyClick(sentAt: Date, clickedAt: Date): boolean;

/** 클릭 한 건만으로 정해지는 사유. ua가 early보다 앞선다. 둘 다 아니면 null (B5) */
export function instantBotReason(input: {
    userAgent: string | null | undefined;
    sentAt: Date;
    clickedAt: Date;
}): "ua" | "early" | null;

/**
 * burst로 "새로" 표시할 클릭 id. 오름차순, 중복 없음 (B6·B7·B11).
 * - 클릭마다 같은 sendLogId의 다른 클릭 중 |Δ| ≤ BURST_WINDOW_MS인 것을 센다. isBot인 클릭도 이웃으로 센다.
 * - 이웃 ≥ BURST_MIN_NEIGHBORS이고 isBot === false인 클릭만 돌려준다.
 * - 입력 순서 무관. 발송별 시각 정렬 후 두 포인터 (O(n log n)).
 */
export function newBurstClickIds(clicks: readonly BurstClick[]): number[];
```

- 정규식은 모듈 최상위에서 `const BOT_UA_RE = new RegExp(BOT_UA_PATTERN, "i")`로 한 번만 만든다.
- 공백뿐인 UA는 JS에서 `trim() === ""`, SQL에서 `~ '^[[:space:]]*$'`로 판정한다.
- 함수 이름이 깊이 알림의 `isHumanClick`, `HUMAN_CLICK_AFTER_MS`와 겹치지 않는다.

## 3. 결정 ② `recordClick` 트랜잭션과 잠금

### 3-1. 비교

| 안 | 장점 | 단점 |
|---|---|---|
| **A. 발송 단위 advisory xact 잠금 (택함)** | 같은 발송끼리만 순서를 지킨다. `email-prepared-sends.ts` 선례가 있다. | 동시 클릭이 몇 ms씩 기다린다. |
| B. `email_send_logs` 행 `FOR UPDATE` | 새 잠금 키가 필요 없다. | FK 잠금이나 발송 상태 갱신과 충돌해 관계없는 쓰기까지 막는다. |
| C. 정기 작업으로 재판정 | 요청 경로에 잠금이 없다. | cron을 새로 만들어야 한다. 판정되기 전까지는 사람으로 보인다. |
| D. 잠금 없음 | 가장 단순하다. | READ COMMITTED에서 동시 요청이 서로의 행을 못 봐 연속 클릭을 놓친다(B10 위반). |

### 3-2. 잠금 키

- `const CLICK_BURST_LOCK = 0x5c4edf14;`를 `email-click-tracking.ts`의 파일 상수로 둔다(export하지 않음).
- 호출 형태는 `pg_advisory_xact_lock(0x5c4edf14, send_log_id)`다.
  - 기존 키는 01~0a, 10~13을 쓰고 있어 14는 비어 있다.
  - 1548672788 < 2³¹이라 int4 범위 안이다.
- 이 키를 잡는 곳은 `recordClick` 하나뿐이라 교착이 없다. 그래서 `lock_timeout`은 걸지 않는다(걸면 클릭 기록이 유실될 수 있다).

### 3-3. 순서 (`email-click-tracking.ts:52-78` 교체)

import: `import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";`, `import { BURST_WINDOW_MS, instantBotReason, newBurstClickIds } from "@/lib/email-click-bot-rules";`

```ts
/**
 * 클릭 로그를 기록하고 click_id 토큰을 발급합니다. 봇 판정(R6, is_bot·bot_reason)을 함께 저장합니다.
 * 판정 입력은 UA·발송 시각·같은 발송의 다른 클릭뿐 — 트래커 데이터는 보지 않는다.
 * 봇으로 판정돼도 click_id는 그대로 발급되고 트래커 매칭 키로 쓰인다.
 */
export async function recordClick(
    sendLogId: number,
    url: string,
    ip?: string,
    userAgent?: string,
): Promise<{ clickId: string } | null> {
    // 0) 트랜잭션 밖: 발송 읽기. 없으면 null (없는 id로 트랜잭션·잠금을 만들지 않는다)
    const [log] = await db
        .select({ orgId: emailSendLogs.orgId, sentAt: emailSendLogs.sentAt })
        .from(emailSendLogs)
        .where(eq(emailSendLogs.id, sendLogId))
        .limit(1);
    if (!log) return null;

    const { orgId, sentAt } = log;
    const clickId = `clk_${nanoid(21)}`;
    const ua = userAgent || null;

    await db.transaction(async (tx) => {
        // 1) 발송 단위 잠금 (커밋까지). 뒤 요청은 앞 요청의 클릭이 커밋된 뒤에 판정한다 (B10)
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${CLICK_BURST_LOCK}, ${sendLogId})`);
        // 2) 시각을 정하고 한 건 판정. 저장 값 = 판정 값이라 백필을 다시 돌려도 같은 결과
        const clickedAt = new Date();
        const reason = instantBotReason({ userAgent: ua, sentAt, clickedAt });
        // 3) insert
        await tx.insert(emailClickLogs).values({
            orgId, sendLogId, url, clickId, ip: ip || null, userAgent: ua,
            clickedAt, isBot: reason !== null, botReason: reason,
        });
        // 4) ±2·BURST_WINDOW_MS 창. 새 클릭 ±10초 안 클릭들의 이웃(각자 ±10초)이 모두 들어온다
        const nearby = await tx
            .select({
                id: emailClickLogs.id,
                sendLogId: emailClickLogs.sendLogId,
                clickedAt: emailClickLogs.clickedAt,
                isBot: emailClickLogs.isBot,
            })
            .from(emailClickLogs)
            .where(and(
                eq(emailClickLogs.sendLogId, sendLogId),
                gte(emailClickLogs.clickedAt, new Date(clickedAt.getTime() - 2 * BURST_WINDOW_MS)),
                lte(emailClickLogs.clickedAt, new Date(clickedAt.getTime() + 2 * BURST_WINDOW_MS)),
            ));
        // 5) 아직 봇이 아닌 연속 클릭만 burst (B9·B11). is_bot = false 조건은 DB 쪽 안전장치
        const burstIds = newBurstClickIds(nearby);
        if (burstIds.length > 0) {
            await tx.update(emailClickLogs)
                .set({ isBot: true, botReason: "burst" })
                .where(and(
                    eq(emailClickLogs.sendLogId, sendLogId),
                    inArray(emailClickLogs.id, burstIds),
                    eq(emailClickLogs.isBot, false),
                ));
        }
    });

    return { clickId };
}
```

- 반환값, 라우트(`src/app/api/track/click/route.ts`), `appendSendbCid`는 바꾸지 않는다. 트랜잭션이 실패하면 지금처럼 라우트가 예외를 잡고 sendb_cid 없이 302를 보낸다.
- READ COMMITTED에서는 문장마다 새 스냅샷을 잡는다. 그래서 잠금을 얻은 뒤의 문장은 앞 요청이 커밋한 행을 본다.
- 창을 ±20초로 잡는 이유: 새 클릭 N의 ±10초 안에 있는 r만 상태가 바뀔 수 있고, r의 이웃은 r±10초 안에 있다. 창 가장자리에서는 이웃을 덜 세는데, 덜 세는 쪽은 사람을 봇으로 만들지 않는다.
- `clickedAt`을 JS에서 정하는 이유: DB `now()`는 트랜잭션 시작 시각이라 잠금 대기 전의 시각이다.

### 3-4. `hasClicked()` (`email-click-tracking.ts:84-91`)

```ts
/**
 * 발송 로그에 사람 클릭(is_bot = false)이 한 번이라도 기록됐는지 여부.
 * 후속 메일 분기(clicked/not_clicked)의 판정 기준. 봇 클릭만 있는 발송은 false (B15)
 */
// where: and(eq(emailClickLogs.sendLogId, sendLogId), eq(emailClickLogs.isBot, false))
```

부르는 곳(`email-followup.ts:453`)은 바꾸지 않는다.

## 4. 결정 ⑤ 스키마·0080·백필

### 4-1. `src/lib/db/schema.ts` (`emailClickLogs`)

```ts
    clickId: varchar("click_id", { length: 64 }),  // 기존 줄
    // 봇 판정 (0080, docs/2026-10-13-email-click-bot-filter). 사람 클릭 = isBot false.
    // 쓰는 곳은 recordClick·0080 둘뿐. 사유 값은 src/lib/email-click-bot-rules.ts BotReason
    isBot: boolean("is_bot").default(false).notNull(),
    botReason: varchar("bot_reason", { length: 16 }).$type<BotReason>(),
```

- `import type { BotReason } from "@/lib/email-click-bot-rules";`를 추가한다. 규칙 파일에 import가 없으므로 순환 참조가 생기지 않는다.
- 새 색인과 CHECK 제약은 두지 않는다. 창 조회는 `email_click_logs_send_log_idx`로 충분하다.

### 4-2. 백필 방식 비교

| 안 | 장점 | 단점 |
|---|---|---|
| **A. 창 함수 RANGE 프레임 (택함)** | 정렬을 한 번만 한다(O(n log n)). 정의를 그대로 옮길 수 있다. | PostgreSQL 11 이상이 필요하다. 기존 마이그레이션도 이미 11 이상을 전제한다. |
| B. 상관 서브쿼리 | 정의가 글자 그대로 읽힌다. | 클릭이 수천 건인 발송(curl 버그)에서는 잠금을 쥔 채 오래 돈다. |

### 4-3. `drizzle/0080_email_click_bot.sql` (전문)

```sql
-- 이메일 클릭 봇 판정 R6 (docs/2026-10-13-email-click-bot-filter/DESIGN.md 4절)
-- 칸 두 개를 더하고 기존 클릭을 ua → early → burst 순서로 채운다. 앞 단계에서 봇이 된 줄은 뒤 단계가 덮어쓰지 않는다.
-- 판정 입력은 UA·발송 시각·같은 발송의 다른 클릭뿐이다. 트래커 표는 보지 않는다.
-- 기준(UA 정규식·15초·10초·이웃 2건)은 src/lib/email-click-bot-rules.ts 상수와 같다 — email-click-bot-sql.test.ts가 이 파일을 읽어 대조한다.
-- is_bot은 상수 기본값이라 PostgreSQL 11 이상에서 표를 다시 쓰지 않는다. 3)의 RANGE 창도 11 이상이 필요하다.
-- ALTER가 잡은 ACCESS EXCLUSIVE는 백필이 끝나 커밋될 때까지 이어진다 (약 3.5만 행, 수 초).
-- 잠금을 5초 안에 못 얻으면 55P03으로 되돌리고 migrate.ts가 다시 시도한다 (0075·0078과 같은 값).
-- 1)~3)은 다시 돌려도 같다 — 배포 순간 옛 인스턴스가 판정 없이 남긴 클릭은 세 UPDATE만 다시 돌려 채운다.
SET LOCAL lock_timeout = '5s';

ALTER TABLE "email_click_logs" ADD COLUMN IF NOT EXISTS "is_bot" boolean DEFAULT false NOT NULL;
ALTER TABLE "email_click_logs" ADD COLUMN IF NOT EXISTS "bot_reason" varchar(16);

-- 1) ua: UA가 없거나 공백뿐이거나, 봇 토큰을 담거나, 맨 앞이 mozilla/5.0 chrome/ (대소문자 무시)
UPDATE "email_click_logs" SET "is_bot" = true, "bot_reason" = 'ua'
WHERE "is_bot" = false
  AND ("user_agent" IS NULL
       OR "user_agent" ~ '^[[:space:]]*$'
       OR "user_agent" ~* 'curl|python|node-fetch|ruby|go-http|java/|guard|antispam|linker|scan|bot|spider|preview|headless|wget|okhttp|msie|^mozilla/5[.]0 chrome/');

-- 2) early: 발송 뒤 15초 미만 (음수 포함). 정확히 15초는 사람 쪽
UPDATE "email_click_logs" c SET "is_bot" = true, "bot_reason" = 'early'
FROM "email_send_logs" s
WHERE s."id" = c."send_log_id"
  AND c."is_bot" = false
  AND c."clicked_at" < s."sent_at" + interval '15 seconds';

-- 3) burst: 같은 발송에서 ±10초 안(정각 포함)에 다른 클릭이 2건 이상. 이웃에는 1)·2)에서 봇이 된 클릭도 센다
UPDATE "email_click_logs" c SET "is_bot" = true, "bot_reason" = 'burst'
FROM (
    SELECT "id", count(*) OVER (
        PARTITION BY "send_log_id" ORDER BY "clicked_at"
        RANGE BETWEEN interval '10 seconds' PRECEDING AND interval '10 seconds' FOLLOWING
    ) - 1 AS "neighbors"
    FROM "email_click_logs"
) n
WHERE n."id" = c."id"
  AND c."is_bot" = false
  AND n."neighbors" >= 2;
```

- `--> statement-breakpoint`는 넣지 않는다. 0075·0076처럼 파일 전체를 한 덩어리로 실행한다(simple 프로토콜이라 여러 문장이 가능하다).
- 1)~3)의 문구는 13-2 테스트가 그대로 찾는다. 따옴표와 별칭(`c`, `s`, `n`)을 바꾸지 않는다.

### 4-4. `drizzle/meta/_journal.json`

`entries` 끝(idx 79 다음)에 추가한다.

```json
    {
      "idx": 80,
      "version": "7",
      "when": 1774300000000,
      "tag": "0080_email_click_bot",
      "breakpoints": true
    }
```

### 4-5. 부팅 동작 (B14)

- drizzle는 마지막으로 적용한 `created_at`(1774200000000)이 이 `when`보다 작을 때만 적용하므로 한 번만 돈다.
- 밀린 마이그레이션은 한 트랜잭션에서 돌고, `SET LOCAL`은 커밋까지 유지된다.
- 55P03이 나면 `migrate.ts`가 3초, 10초, 20초 뒤에 재시도한다. 그래도 실패하면 `instrumentation.ts`가 서버를 띄우지 않는다.

## 5. 결정 ⑥ 봇 제외 조건: 공통 조각 없음

| 안 | 장점 | 단점 |
|---|---|---|
| **A. 지점마다 직접 씀 (택함)** | 한 줄이라 바로 읽힌다. `isBot`·`is_bot`을 grep하면 전부 나온다. | 같은 조건이 9곳에 있다. |
| B. 도우미 조각 | 정의가 한 곳에 모인다. | 빌더용과 원시 SQL용 두 형태가 필요하고, 별칭을 인자로 넘겨야 해 오히려 읽기 어렵다. |
| C. DB 뷰 | SQL 어디서나 쓸 수 있다. | DB 객체가 늘고, 빌더 타입 지원이 없다. |

"사람 클릭"의 정의는 `is_bot` 칸 그 자체다. 판정 로직은 쓰는 곳 두 군데에 모여 있으니 조각으로 묶어서 얻는 게 없다.

### 5-2. 지점별 수정

| 파일:줄 | 지금 | 바꿀 것 |
|---|---|---|
| `src/app/api/analytics/summary/route.ts:105`, `:114` | `.where(emailWhere)` (click join 두 쿼리) | `.where(and(emailWhere, eq(emailClickLogs.isBot, false)))` |
| `src/app/api/analytics/summary/route.ts:14` | `// 클릭률 = 발송 대비 링크 클릭 …` | `// 클릭률 = 발송 대비 사람 링크 클릭 (봇 클릭 제외, 0080)` |
| `src/app/api/analytics/templates/route.ts:58`, `:81` | `.leftJoin(emailClickLogs, eq(emailClickLogs.sendLogId, emailSendLogs.id))` | `.leftJoin(emailClickLogs, and(eq(emailClickLogs.sendLogId, emailSendLogs.id), eq(emailClickLogs.isBot, false)))`, 주석 `// 사람 클릭만 — WHERE에 두면 클릭 없는 발송이 total·sent에서 빠진다 (B17)` |
| `src/app/api/analytics/trends/route.ts:50` | `… where ecl.send_log_id = email_send_logs.id)` | `… where ecl.send_log_id = email_send_logs.id and ecl.is_bot = false)` |
| `src/app/api/analytics/email-daily/route.ts:100` | `SELECT 1 FROM email_click_logs ecl WHERE ecl.send_log_id = f.id` | `… AND ecl.is_bot = false` |
| `src/app/api/email/logs/route.ts:63`, `:65` | `EXISTS` / `NOT EXISTS (… ecl.send_log_id = email_send_logs.id)` | 두 곳 괄호 안에 `AND ecl.is_bot = false`를 넣는다. `isClicked=0`의 `status = 'sent'`는 그대로 둔다(B19). |
| `src/app/api/email/auto-personalized/test-followup/route.ts:63` | `.where(inArray(emailClickLogs.sendLogId, logIds))` | `.where(and(inArray(emailClickLogs.sendLogId, logIds), eq(emailClickLogs.isBot, false)))` |
| `src/lib/tracker/journey.ts:150-152` | `.where(inArray(emailClickLogs.sendLogId, …))` | `.where(and(inArray(…), eq(emailClickLogs.isBot, false)))`. 이벤트와 `emailClicks`·`emailClickRate`는 걸러진 목록을 쓴다(B23). |
| `src/lib/email-click-tracking.ts:88` | `hasClicked` | 3-4절 |

**바꾸지 않는 곳**
- 클릭 라우트
- `email-followup.ts`
- `tracker/collect`, `match-record.ts`, `resolve-attribution.ts`
- `deep-visitor-alert*`, `customer-journey-*`
- `migrate.ts`
- 대시보드 컴포넌트

## 6. 결정 ③ 클릭 신호 도우미

### 6-1. 위치

`src/lib/email-click-signals.ts`를 새로 만든다.
- 쓰기 경로(공개 리다이렉트)와 읽기 경로를 분리한다.
- `email-click-tracking.ts`가 200줄 한도에 가까워지는 것을 피한다.
- `repliesForSendLogs`(`email-reply-list.ts`)와 같은 모양이다.
- `email/logs/route.ts:110-125`와 `mcp/tools.ts:305-316`에 중복된 코드를 없앤다.

### 6-2. 시그니처와 SQL

```ts
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { ClickSignal } from "@/components/email/clicks/types";

/** 클릭이 없는 발송의 신호. 맵에 없는 발송은 이 값으로 채운다 */
export const EMPTY_CLICK_SIGNAL: ClickSignal = { clickCount: 0, botClickCount: 0, hasSiteAction: false };

/**
 * 발송별 클릭 신호 (발송 이력·통합 로그·MCP). 클릭이 있는 발송만 맵에 담는다.
 * - clickCount: 사람 클릭 수(is_bot = false), botClickCount: 봇 클릭 수
 * - hasSiteAction: 이 발송 클릭의 click_id로 이어진 "같은 조직" 사이트 세션에 CLICK·CUSTOM 이벤트가 1건 이상.
 *   봇 클릭의 click_id도 본다. 표시용이며 봇 판정에는 쓰지 않는다 (0절)
 */
export async function clickSignalsForSendLogs(orgId: string, logIds: number[]): Promise<Map<number, ClickSignal>> {
    const out = new Map<number, ClickSignal>();
    if (logIds.length === 0) return out;
    // 원문 SQL로 쓴다 — builder의 단일 표 select는 칼럼에 표 이름을 붙이지 않아(isSingleTable),
    // 서브쿼리 안의 바깥 칼럼 참조가 안쪽 표(ts.click_id, st.org_id)에 묶여 늘 참이 된다
    const rows = (await db.execute(sql`
        SELECT c.send_log_id AS "sendLogId",
               count(*) FILTER (WHERE c.is_bot = false)::int AS "clickCount",
               count(*) FILTER (WHERE c.is_bot = true)::int AS "botClickCount",
               EXISTS (
                   SELECT 1
                   FROM email_click_logs c2
                   JOIN tracker_sessions ts ON ts.click_id = c2.click_id
                   JOIN tracker_sites st ON st.id = ts.site_id AND st.org_id = c2.org_id
                   JOIN tracker_events te ON te.session_id = ts.id
                   WHERE c2.send_log_id = c.send_log_id
                     AND c2.org_id = ${orgId}::uuid
                     AND te.event_type IN ('CLICK', 'CUSTOM')
               ) AS "hasSiteAction"
        FROM email_click_logs c
        WHERE c.org_id = ${orgId}::uuid
          AND c.send_log_id = ANY(${sql.param(logIds)}::int[])
        GROUP BY c.send_log_id
    `)) as unknown as Array<{ sendLogId: number; clickCount: number; botClickCount: number; hasSiteAction: boolean }>;
    for (const r of rows) {
        out.set(r.sendLogId, {
            clickCount: r.clickCount,
            botClickCount: r.botClickCount,
            hasSiteAction: r.hasSiteAction === true,
        });
    }
    return out;
}
```

- 바깥 참조는 GROUP BY 칼럼 `c.send_log_id` 하나뿐이다. 조직은 파라미터로 넘긴다(GROUP BY하지 않은 `c.org_id`를 서브쿼리에서 쓰면 오류).
- 배열 파라미터는 `ANY(${sql.param(ids)}::int[])` 형태로 넘긴다(선례 `deep-visitor-alert.ts:743`).

- 테넌트 격리는 두 겹이다. 클릭 org로 한 번, 사이트 org가 클릭 org와 같은지로 한 번 더 거른다.
- `tracker_sites.is_active`는 보지 않는다. 이미 있었던 이벤트는 사실이기 때문이다.
- `click_id`가 NULL인 옛 클릭은 false가 된다.
- 필요한 색인은 이미 있다(`tracker_sessions_click_id_idx`, `tracker_events_session_idx`). 페이지당 한 번 호출한다.
- MCP도 이 도우미를 쓰되 `hasSiteAction`은 버린다.

## 7. 결정 ④ 통합 로그·발송 이력·MCP

### 7-1. 통합 로그 비교

| 안 | 장점 | 단점 |
|---|---|---|
| A. UNION 안에 서브쿼리 추가 | 바꿀 줄이 적다. | 정렬 전에 모든 줄에서 서브쿼리 3개가 돈다. 신호 SQL이 중복된다. |
| B. 바깥 `LEFT JOIN LATERAL` | 왕복이 한 번이다. | ③의 SQL을 다시 써야 한다(중복). |
| **C. 페이지 뒤에 ③ 호출 (택함)** | 정렬, 페이지, 총건수가 그대로다. 정의가 한 곳에 있다. 서브쿼리가 페이지 줄에만 돈다. | 왕복이 한 번(약 1ms) 늘어난다. |

### 7-2. `src/app/api/logs/unified/route.ts`

- 32-34줄의 `clickCol`을 지우고, 42줄의 `${sql.raw(clickCol)}`와 그 앞 쉼표도 지운다. 두 갈래 모두 `... sent_at as "sentAt", completed_at as "completedAt"`로 끝나게 한다.
- `countQuery`와 `dataQuery`의 정렬·페이지는 그대로 둔다(B20).
- 81줄 이후는 아래처럼 바꾼다.

```ts
type UnifiedRow = Record<string, unknown> & { id: number; channel: "alimtalk" | "email" };
const logs = (await db.execute(dataQuery)) as unknown as UnifiedRow[];
// 클릭 신호는 이 페이지의 이메일 줄에만 붙인다 (예전에는 UNION 안 상관 서브쿼리가 모든 줄을 셌다)
const signals = await clickSignalsForSendLogs(
    user.orgId,
    logs.filter((l) => l.channel === "email").map((l) => l.id),
);
const data = logs.map((l) =>
    l.channel === "email"
        ? { ...l, ...(signals.get(l.id) ?? EMPTY_CLICK_SIGNAL) }
        : { ...l, clickCount: 0 }, // 알림톡 줄은 예전 응답과 같게
);
// 응답의 data: logs → data. total·page·pageSize·totalPages는 그대로
```

두 표의 id가 겹칠 수 있으므로 반드시 `channel === "email"`인 줄만 넘긴다.

### 7-3. `src/app/api/email/logs/route.ts`

- 110-125줄을 `const signals = await clickSignalsForSendLogs(user.orgId, logIds);`로 바꾼다.
- 135-139줄을 `{ ...log, ...(signals.get(log.id) ?? EMPTY_CLICK_SIGNAL), reply: replies.get(log.id) ?? null }`로 바꾼다.
- 쓰지 않게 된 `emailClickLogs`와 `inArray` import를 지운다.
- 필터는 5-2절대로 바꾼다.

### 7-4. `src/lib/mcp/tools.ts`

- description(97줄)을 `"이메일 발송 이력을 조회합니다. clickCount는 사람 클릭 수입니다(메일 보안 검사기 같은 봇 클릭은 빼고 셉니다). botClickCount는 봇으로 판정된 클릭 수입니다."`로 바꾼다.
- 305-316줄을 아래처럼 바꾼다.

```ts
const signals = await clickSignalsForSendLogs(tokenInfo.orgId, logs.map((l) => l.id));
const logsWithClicks = logs.map((l) => {
    const { clickCount, botClickCount } = signals.get(l.id) ?? EMPTY_CLICK_SIGNAL;
    return { ...l, clickCount, botClickCount };
});
```

- 쓰지 않게 된 `emailClickLogs`와 `inArray` import를 지운다. 지우기 전에 다른 곳에서 쓰는지 grep으로 확인한다.

### 7-5. `src/types/index.ts` (`UnifiedLog`)

```ts
    /** 사람 클릭 수 (이메일 줄). 알림톡 줄은 0 */
    clickCount?: number;
    /** 봇으로 판정된 클릭 수 (이메일 줄만) */
    botClickCount?: number;
    /** 같은 조직 사이트에서 CLICK·CUSTOM이 이어진 발송 (이메일 줄만) */
    hasSiteAction?: boolean;
```

## 8. 결정 ⑦ 클릭 칸 시각 사양

순수 함수와 표시 컴포넌트를 하나씩 두고 두 표가 같이 쓴다. B26을 TDD로 고정할 수 있고, 두 표의 중복과 `.tsx` 안의 로직이 함께 사라진다.

툴팁은 네이티브 `title`로 단다. `ReplyKindBadge` 선례가 있고, Radix Tooltip은 Provider가 필요하다.

### 8-2. `src/components/email/clicks/types/index.ts` (신규)

```ts
/** 발송 한 건의 클릭 신호. 발송 이력·통합 로그 API가 이메일 줄마다 준다 (MCP는 hasSiteAction 없이) */
export interface ClickSignal {
    /** 사람 클릭 수 (is_bot = false) */
    clickCount: number;
    /** 봇으로 판정된 클릭 수 (is_bot = true) */
    botClickCount: number;
    /** click_id로 이어진 같은 조직 사이트 세션에 CLICK·CUSTOM 이벤트가 있다. 봇 판정과 무관한 표시용 */
    hasSiteAction: boolean;
}

/** 클릭 칸이 받는 줄. 발송 이력 줄은 channel이 없다(= 이메일), 통합 로그 줄은 있다 */
export interface ClickCellSource extends Partial<ClickSignal> {
    channel?: string;
    status: string;
}

export type ClickCellTone = "human" | "humanAction" | "bot" | "botAction";

export type ClickCellView =
    | { kind: "empty" }                  // 발송 아님 → 빈칸
    | { kind: "dash" }                   // 클릭 없음 → "-"
    | {
          kind: "badge";
          tone: ClickCellTone;
          /** 보이는 글자: 사람 클릭이면 "N회"(기존 글자 그대로), 봇만이면 "" (아이콘만) */
          text: string;
          botIcon: boolean;
          actionIcon: boolean;
          /** 마우스를 올리면 보이는 툴팁 (title 속성) */
          title: string;
      };
```

### 8-3. `src/components/email/clicks/utils/clickCell.ts` (신규, 순수)

`export function clickCellView(src: ClickCellSource): ClickCellView`

1. `src.channel`이 있으면서 `"email"`이 아니거나 `src.status !== "sent"`이면 `{ kind: "empty" }`를 반환한다.
2. `human = clickCount ?? 0`, `bot = botClickCount ?? 0`이 둘 다 0 이하이면 `{ kind: "dash" }`를 반환한다. 이때 `hasSiteAction`은 보지 않는다.
3. `action = hasSiteAction === true`
4. title은 아래 조각을 순서대로 골라 `" · "`로 잇는다.
   - `사람 클릭 {human}회` (human > 0일 때)
   - `봇 클릭 {bot}회` (bot > 0일 때)
   - `전체 {human+bot}회` (둘 다 > 0일 때)
   - `사람 클릭 없음` (human = 0일 때)
   - `사이트 행동 있음` (action일 때)
5. 반환값
   - human > 0이면 `{ kind: "badge", tone: action ? "humanAction" : "human", text: "{human}회", botIcon: false, actionIcon: action, title }`
   - 그 외에는 `{ kind: "badge", tone: action ? "botAction" : "bot", text: "", botIcon: true, actionIcon: action, title }`

### 8-4. `src/components/email/clicks/ui/ClickCountCell.tsx` (신규, 표시만)

- `"use client"`를 붙인다.
- `export function ClickCountCell({ log }: { log: ClickCellSource })`
- `const view = clickCellView(log)`로 표시를 받는다.
  - `empty`이면 `null`을 반환한다.
  - `dash`이면 `<span className="text-xs text-muted-foreground">-</span>`를 그린다.
  - `badge`이면 `<Badge variant={TONE[view.tone].variant} className={TONE[view.tone].badge} title={view.title}>` 안에 `{view.botIcon && <Bot />}`, `{view.actionIcon && <MousePointerClick className={TONE[view.tone].action} />}`, `{view.text}`를 넣는다.
- 아이콘 크기는 Badge의 `[&>svg]:size-3`을 따른다. 크기 클래스를 따로 붙이지 않는다.

| tone | 상황 | variant | `badge` className | `action` className |
|---|---|---|---|---|
| `human` | 사람 클릭 | `default` | `bg-blue-600 text-xs` (지금과 같음) | — |
| `humanAction` | 사람 클릭 + 사이트 행동 | `default` | `bg-blue-600 text-xs font-bold ring-2 ring-blue-300 dark:ring-blue-400/60` | `""` |
| `bot` | 봇 클릭만 | `outline` | `border-dashed text-xs text-muted-foreground/70` | — |
| `botAction` | 봇 클릭만 + 사이트 행동 | `outline` | `border-dashed border-blue-300 text-xs text-muted-foreground/70 dark:border-blue-400/60` | `text-blue-600 dark:text-blue-400` |

- 강조에는 `ring-2`를 쓴다. ring은 레이아웃 자리를 차지하지 않아 표가 흔들리지 않는다.
- 사람 클릭과 봇 클릭이 섞인 발송은 사람 뱃지로 보이고, 전체 수는 툴팁에서 보인다.
- 보이는 한글은 `회`뿐이다.

### 8-5. 두 표 교체

- `src/components/email/EmailSendLogTable.tsx`
  - 행 타입(47-48줄)을 `EmailSendLog & LogSenderSource & Partial<ClickSignal> & { reply?: … }`로 바꾼다.
  - 463-473줄을 `<TableCell><ClickCountCell log={log} /></TableCell>`로 바꾼다.
  - import 두 줄을 추가한다.
- `src/components/logs/UnifiedLogTable.tsx`
  - 203-213줄을 `<TableCell><ClickCountCell log={log} /></TableCell>`로 바꾼다.
  - import를 추가한다.
- 교체한 뒤 두 `.tsx`에서 `clickCount`, `botClickCount`, `hasSiteAction`을 grep하면 0건이어야 한다(B27).

## 9. 데이터 흐름

```
메일 링크 → GET /api/track/click (변경 없음)
  └ recordClick (email-click-tracking.ts)
      발송 읽기 → tx[잠금(0x5c4edf14, id) → clickedAt → instantBotReason → insert → ±20초 창 → newBurstClickIds → burst update]
  └ 302 + sendb_cid (변경 없음, 봇이어도 같다)

판정 기준: email-click-bot-rules.ts (순수)  ⇄  0080 SQL (같은 기준, 테스트가 대조)

사람 클릭만 보는 곳: hasClicked · summary · templates · trends · email-daily · email/logs isClicked · test-followup · journey
신호(사람/봇/hasSiteAction): clickSignalsForSendLogs → email/logs · logs/unified · MCP(hasSiteAction 제외)
화면: EmailSendLogTable · UnifiedLogTable(/logs, 레코드 상세) → ClickCountCell → clickCellView
그대로 두는 곳: tracker/collect · match-record · resolve-attribution · 깊이 알림 · 고객 여정
```

## 10. 파일 계획

| 파일 | 구분 | 역할 | 예상 줄 |
|---|---|---|---|
| `src/lib/email-click-bot-rules.ts` | 신규 | R6 상수·순수 함수 (import 없음) | ~70 |
| `src/lib/email-click-bot-rules.test.ts` | 신규 | B1~B7 | ~150 |
| `src/lib/email-click-bot-sql.test.ts` | 신규 | B13·B14 정적·판정 입력 가드 | ~60 |
| `drizzle/0080_email_click_bot.sql` | 신규 | 칸 2개 + 백필 3단 | ~40 |
| `drizzle/meta/_journal.json` | 수정 | idx 80 | +7 |
| `src/lib/db/schema.ts` | 수정 | `isBot`·`botReason` | +4 |
| `src/lib/email-click-tracking.ts` | 수정 | `recordClick`(3절), `hasClicked`(3-4) | 107→~145 |
| `src/lib/email-click-signals.ts` | 신규 | 클릭 신호 도우미 | ~45 |
| `src/app/api/analytics/{summary,templates,trends,email-daily}/route.ts` | 수정 | 5-2 | 각 1~2줄 |
| `src/app/api/email/logs/route.ts` | 수정 | 필터 2곳 + 도우미 | 줄어듦 |
| `src/app/api/logs/unified/route.ts` | 수정 | 7-2 | ~+5 |
| `src/types/index.ts` | 수정 | `UnifiedLog` | +4 |
| `src/lib/mcp/tools.ts` | 수정 | 7-4 | 줄어듦 |
| `src/app/api/email/auto-personalized/test-followup/route.ts` | 수정 | 1곳 | 1줄 |
| `src/lib/tracker/journey.ts` | 수정 | 1곳 | 3줄 |
| `src/components/email/clicks/types/index.ts` | 신규 | `ClickSignal` 등 | ~40 |
| `src/components/email/clicks/utils/clickCell.ts` | 신규 | `clickCellView` | ~35 |
| `src/components/email/clicks/utils/clickCell.test.ts` | 신규 | B26 | ~90 |
| `src/components/email/clicks/ui/ClickCountCell.tsx` | 신규 | 표시만 | ~35 |
| `src/components/email/EmailSendLogTable.tsx` | 수정 | 8-5 | 줄어듦 |
| `src/components/logs/UnifiedLogTable.tsx` | 수정 | 8-5 | 줄어듦 |

## 11. API 계약 변화

| 경로 | 바뀌는 것 | 그대로인 것 |
|---|---|---|
| `GET /api/email/logs` | `clickCount`가 사람 클릭 수로 바뀐다. `botClickCount`와 `hasSiteAction`이 추가된다. `isClicked=1`은 사람 클릭이 있는 발송, `=0`은 사람 클릭이 없는 sent 발송이다. | `totalCount`, 나머지 필터, `reply`, 오류 형식 |
| `GET /api/logs/unified` | 이메일 줄에 `clickCount`(사람), `botClickCount`, `hasSiteAction`이 붙는다. | 알림톡 줄의 `clickCount: 0`, total·page·정렬 |
| MCP `list_email_logs` | `clickCount`가 사람 클릭 수로 바뀌고 `botClickCount`가 추가된다. 설명 문구가 바뀐다. | `hasSiteAction`은 없다. 나머지 |
| test-followup GET | `isClicked`가 사람 클릭 기준이 된다. | 나머지 |
| analytics 4종 | `clicked`와 클릭률이 사람 클릭 기준이 된다. | 응답 모양 |

## 12. behavior → 구현 매핑

| B | 담당 |
|---|---|
| B1~B4 | `isBotUserAgent`, `isEarlyClick`, `instantBotReason` |
| B5 | `instantBotReason`(ua가 early보다 우선), `newBurstClickIds`, 0080 단계 순서와 `is_bot = false` |
| B6·B7 | `newBurstClickIds` |
| B8 | `recordClick` insert |
| B9 | `recordClick` 4)~5) |
| B10 | `recordClick` 1)의 잠금 |
| B11 | `newBurstClickIds`, update의 `eq(isBot,false)`, 0080 세 UPDATE의 조건 |
| B12 | 0080 |
| B13 | `email-click-bot-sql.test.ts` |
| B14 | journal과 `SET LOCAL` (정적 검사 13-2) |
| B15 | `hasClicked` |
| B16 | summary |
| B17 | templates LEFT JOIN ON |
| B18 | trends, email-daily |
| B19 | email/logs 필터 |
| B20 | `clickSignalsForSendLogs`, email/logs, unified |
| B21 | MCP |
| B22 | test-followup |
| B23 | journey |
| B24 | 매칭·알림·여정 파일 무변경 + 기존 테스트 |
| B25 | `clickSignalsForSendLogs`의 hasSiteAction |
| B26 | `clickCellView` |
| B27 | `ClickCountCell` + 두 표 |
| B28 | 전체 |

## 13. TDD로 고정할 계약

`node:test`와 `node:assert/strict`를 쓴다. 테스트 이름은 `"B1: …"` 형식이다. 진행 순서는 테스트 작성 → `pnpm test`가 RED인지 확인 → 구현 → GREEN이다.

### 13-1. `src/lib/email-click-bot-rules.test.ts` (B1~B7)

공통 준비
- `SENT = new Date("2026-10-13T00:00:00.000Z")`
- `at(ms) = new Date(SENT.getTime() + ms)`
- `CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"`
- `bc(id, ms, { sendLogId = 1, isBot = false } = {})`

**B1 빈 UA**

| userAgent | `isBotUserAgent` | `instantBotReason(+60_000)` |
|---|---|---|
| `null` | true | `"ua"` |
| `undefined` | true | `"ua"` |
| `""` | true | `"ua"` |
| `"   "` | true | `"ua"` |
| `"\t"` | true | `"ua"` |

**B2 토큰**

예시마다 토큰이 하나씩만 들어 있다. 원문, 대문자, 소문자 모두 true이고 `instantBotReason(+60_000)`은 `"ua"`다.

| 토큰 | 예시 UA |
|---|---|
| curl | `curl/8.4.0` |
| python | `python-requests/2.31.0` |
| node-fetch | `node-fetch/1.0 (+https://github.com/bitinn/node-fetch)` |
| ruby | `Ruby` |
| go-http | `Go-http-client/1.1` |
| java/ | `Java/17.0.2` |
| guard | `Mozilla/5.0 (compatible; LinkGuard/2.0)` |
| antispam | `AntiSpam-Engine/3.1` |
| linker | `Linker/1.0` |
| scan | `Mozilla/5.0 (compatible; URLScan/4.0)` |
| bot | `Mozilla/5.0 (compatible; Googlebot/2.1)` |
| spider | `Baiduspider/2.0` |
| preview | `Mozilla/5.0 (Windows NT 10.0) LinkPreview/1.0` |
| headless | `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36` |
| wget | `Wget/1.21.4` |
| okhttp | `okhttp/4.12.0` |
| msie | `Mozilla/4.0 (compatible; MSIE 7.0; Windows NT 6.1)` |

**B3 `mozilla/5.0 chrome/` 접두와 정상 브라우저**

| UA | 기대 | 확인 |
|---|---|---|
| `Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36` | 봇 | 접두 규칙 |
| `mozilla/5.0 chrome/99` | 봇 | 소문자 |
| `MOZILLA/5.0 CHROME/1` | 봇 | 대문자 |
| `X Mozilla/5.0 Chrome/120` | 사람 | `^` 고정 |
| `Mozilla/5x0 Chrome/1` | 사람 | `[.]`은 실제 점만 |
| `CHROME` | 사람 | 정상 |
| `Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1` | 사람 | Safari iOS |
| `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15` | 사람 | Safari Mac |
| `CHROME + " Edg/129.0.0.0"` | 사람 | Edge |
| `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0` | 사람 | Firefox |
| `Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36` | 사람 | 삼성 인터넷 |
| `Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36;KAKAOTALK 2410710` | 사람 | 카카오톡 인앱 |
| `Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36` | **봇** | 알려진 오탐을 고정 |

**B4 early** (UA는 `CHROME`)

| 클릭(ms) | `isEarlyClick` | `instantBotReason` |
|---|---|---|
| 14_999 | true | `"early"` |
| 0 | true | `"early"` |
| -1_000 | true | `"early"` |
| 15_000 | false | `null` |
| 15_001 | false | `null` |

**B5 우선순위**

| 입력 | 기대 |
|---|---|
| `instantBotReason({ userAgent: "curl/8.4.0", sentAt: SENT, clickedAt: at(1_000) })` | `"ua"` |
| `instantBotReason({ userAgent: null, sentAt: SENT, clickedAt: at(0) })` | `"ua"` |
| `instantBotReason({ userAgent: CHROME, sentAt: SENT, clickedAt: at(1_000) })` | `"early"` |
| `newBurstClickIds([bc(1,0,{isBot:true}), bc(2,2_000,{isBot:true}), bc(3,4_000)])` | `[3]` |
| `newBurstClickIds([bc(1,0,{isBot:true}), bc(2,1_000,{isBot:true}), bc(3,2_000,{isBot:true})])` | `[]` |

**B6 연속 클릭** (같은 발송, 모두 사람)

| 클릭(ms) | 기대 | 확인 |
|---|---|---|
| 0, 5_000, 10_000 | `[1,2,3]` | 10초 정각 포함 |
| 0, 5_000, 10_001 | `[2]` | 10초 초과는 이웃이 아님 |
| 0, 9_000, 18_000 | `[2]` | 사슬에서는 가운데만 |
| 0, 3_000 | `[]` | 이웃이 1건뿐 |
| 0, 0, 0 | `[1,2,3]` | 같은 시각 |
| `[bc(3,10_000), bc(1,0), bc(2,5_000)]` | `[1,2,3]` | 순서 무관, 오름차순 |
| `[]` | `[]` | 빈 입력 |

**B7 이웃 범위**

| 입력 | 기대 | 확인 |
|---|---|---|
| `bc(1,0,{isBot:true}), bc(2,1_000,{isBot:true}), bc(3,2_000)` | `[3]` | 봇도 이웃으로 센다 |
| `bc(1,0,{sendLogId:1}), bc(2,1_000,{sendLogId:2}), bc(3,2_000,{sendLogId:1})` | `[]` | 다른 발송은 세지 않는다 |
| `bc(1,0,{sendLogId:1}), bc(2,500,{sendLogId:2}), bc(3,1_000,{sendLogId:2}), bc(4,1_500,{sendLogId:2}), bc(5,2_000,{sendLogId:1})` | `[2,3,4]` | 발송별로 따로 센다 |

### 13-2. `src/lib/email-click-bot-sql.test.ts` (B13·B14·판정 입력 가드)

- 파일은 `readFileSync(join(process.cwd(), "drizzle", "0080_email_click_bot.sql"), "utf8")`로 읽는다.
- 비교용 문자열은 `flat = sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ")`로 만든다.

| 확인 | 기대 |
|---|---|
| `BOT_UA_PATTERN`에 `'`나 `\`가 없다 | `doesNotMatch(/['\\]/)` |
| `flat`에 `"user_agent" ~* '${BOT_UA_PATTERN}'`가 있다 | 포함 |
| `flat`에 `"user_agent" IS NULL`과 `"user_agent" ~ '^[[:space:]]*$'`가 있다 | 포함 |
| `EARLY_CLICK_MS % 1000 === 0`이고 `flat`에 `< s."sent_at" + interval '${EARLY_CLICK_MS / 1000} seconds'`가 있다 | 포함 |
| `BURST_WINDOW_MS % 1000 === 0`이고 `flat`에 `RANGE BETWEEN interval '${w} seconds' PRECEDING AND interval '${w} seconds' FOLLOWING`가 있다 | 포함 |
| `flat`에 `n."neighbors" >= ${BURST_MIN_NEIGHBORS}`가 있다 | 포함 |
| `flat.trimStart()`가 `SET LOCAL lock_timeout = '5s';`로 시작한다 | true (B14) |
| `"bot_reason" = 'ua'`, `'early'`, `'burst'`가 이 순서로 나온다 | true (B5) |
| `"is_bot" = false`가 정확히 3번 나온다 | 3 (B11) |
| `flat`에 `tracker_`가 없다 | 판정 입력 원칙 |
| `email-click-bot-rules.ts` 원문에 `^\s*import\s`가 없다 | 순수 파일 |
| `email-click-tracking.ts` 원문에 `/tracker(Sessions|Events|Sites)|tracker_/`가 없다 | 판정 입력 원칙 |
| journal idx 80의 tag가 `"0080_email_click_bot"`, when이 `1774300000000`이고 idx 79의 when보다 크다 | true (B14) |

### 13-3. `src/components/email/clicks/utils/clickCell.test.ts` (B26)

`status`를 적지 않은 경우는 `"sent"`다. `channel`이 없으면 발송 이력 줄이다.

| # | 입력 | 기대 |
|---|---|---|
| 1 | `{ channel: "alimtalk", status: "sent", clickCount: 3 }` | `{ kind: "empty" }` |
| 2 | `{ status: "failed", clickCount: 2, botClickCount: 1 }` | `empty` |
| 3 | `{ channel: "email", status: "pending" }` | `empty` |
| 4 | `{ status: "sent" }` | `{ kind: "dash" }` |
| 5 | `clickCount 0, botClickCount 0, hasSiteAction false` | `dash` |
| 6 | `clickCount 0, botClickCount 0, hasSiteAction true` | `dash` |
| 7 | `clickCount 2, botClickCount 0, hasSiteAction false` | `human`, `"2회"`, botIcon false, actionIcon false, `"사람 클릭 2회"` |
| 8 | `clickCount 2, botClickCount 3, hasSiteAction false` | `human`, `"2회"`, false, false, `"사람 클릭 2회 · 봇 클릭 3회 · 전체 5회"` |
| 9 | `{ channel: "email", status: "sent", clickCount 1, botClickCount 0, hasSiteAction true }` | `humanAction`, `"1회"`, false, true, `"사람 클릭 1회 · 사이트 행동 있음"` |
| 10 | `clickCount 2, botClickCount 3, hasSiteAction true` | `humanAction`, `"2회"`, false, true, `"사람 클릭 2회 · 봇 클릭 3회 · 전체 5회 · 사이트 행동 있음"` |
| 11 | `clickCount 0, botClickCount 4, hasSiteAction false` | `bot`, `""`, true, false, `"봇 클릭 4회 · 사람 클릭 없음"` |
| 12 | `clickCount 0, botClickCount 4, hasSiteAction true` | `botAction`, `""`, true, true, `"봇 클릭 4회 · 사람 클릭 없음 · 사이트 행동 있음"` |
| 13 | 모든 badge의 `text` | `/^(\d+회)?$/`에 맞는다 |

## 14. 로컬 검증 기대값

**B12·B14 백필 fixture**
- 0080을 적용하기 전에 로컬 DB에 가상 조직 uuid로 넣는다.
- 모든 발송의 `sent_at`은 T로 같게 두고, `click_id`는 NULL로 둔다.
- 적용한 뒤 아래 표와 대조한다.
- 재부팅해서 `drizzle.__drizzle_migrations`의 1774300000000 줄이 하나뿐인지 확인한다.
- 끝나면 가상 조직의 발송을 삭제한다(클릭은 cascade로 함께 지워진다).

| 발송 | 클릭(T+초, UA) | 기대 | 확인 |
|---|---|---|---|
| F1 | +60 NULL / +200 `'   '` | ua / ua | B1 |
| F2 | +60 `curl/8.4.0` | ua (봇만 있는 발송) | B2·B15·B19 |
| F3 | +60 `Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36` | ua | B3 |
| F4 | +14.999 Chrome | early | B4 |
| F5 | +15.000 Chrome | false / NULL | B4 경계 |
| F6 | +100, +103, +106 Chrome | 셋 다 burst | B6 |
| F7 | +100, +109, +118 Chrome | +109만 burst | 사슬 |
| F8 | +100, +110, +120 Chrome | +110만 burst | 정각 포함 |
| F9 | +100 curl, +102 curl, +104 Chrome | ua, ua, burst | B7 |
| F10 | +2 curl, +5 Chrome, +8 Chrome | ua, early, early | B5 |
| F11a / F11b | F11a +100, F11b +101, F11a +102 (Chrome) | 모두 false | 다른 발송 |
| F12 | +300 Chrome, +600 curl | false, ua (섞인 발송) | B16~B20 |

**B8~B11 기록 경로** (0080 적용 뒤)
- curl의 기본 UA는 봇이므로 사람으로 보낼 때는 `-A "<CHROME>"`을 붙인다.
- 발송은 `sent_at = now() - interval '1 hour'`로 만든다. early를 확인할 때만 `now()`로 만든다.

| B | 방법 | 기대 |
|---|---|---|
| B8 | `-A 'curl/8.4.0'`으로 요청 | 302와 `sendb_cid`가 오고, 행은 ua로 기록된다 |
| B9 | Chrome UA로 0, 3, 6초에 요청 | 세 행 모두 burst |
| B10 | `seq 5 \| xargs -P5 -I{} curl …` | 5행 모두 burst |
| B11 | curl 1번 뒤 10초 안에 Chrome 2번 | 첫 행은 ua 유지, 나머지는 burst |

**B20 회귀**: 바꾸기 전에 `/api/logs/unified` 응답(페이지 1·2, `recordId` 지정)을 저장해 둔다. 바꾼 뒤 id 순서, total, totalPages가 같아야 한다.

**B25**: 같은 조직 사이트 세션에 CLICK이나 CUSTOM이 있으면 true다. SECTION_VIEW나 PAGE_VIEW만 있거나 다른 조직의 세션이면 false다. 확인하려면 가상 조직, 워크스페이스, 사이트를 함께 만들어야 한다.

## 15. 도메인 체크리스트

| 영역 | 결과 |
|---|---|
| 데이터 모델 | 칸 2개를 추가하고 새 색인은 없다. 삭제는 cascade 그대로다. 백필은 마이그레이션 안에서 한다. |
| API 계약 | 필드만 추가한다(11절). burst update와 백필은 `is_bot = false` 조건이 있어 여러 번 돌려도 결과가 같다. |
| 상태 관리 | SWR 서버 상태만 쓴다. |
| 보안 | 인증은 각 라우트의 `getUserFromNextRequest`가 하고, 신호 도우미가 org를 두 겹으로 거른다. UA는 파라미터로 바인딩한다. |
| 동시성 | 발송 단위 advisory xact 잠금, READ COMMITTED. 이미 봇인 클릭의 사유는 덮어쓰지 않는다. |
| 성능 | 클릭 기록의 왕복이 2번에서 6번으로 늘어난다(몇 ms). 신호는 페이지당 1회다. 통합 로그 서브쿼리는 전체 줄에서 페이지 줄로 줄어든다. 백필은 O(n log n)이다. |

## 16. 리스크와 결정된 질문

**결정된 질문**
- **Q1 작업 브랜치**: `main`에서 작업한다(사용자 지시, 2026-10-13).
- **Q2 운영 확인**: 사용자가 요청할 때만 운영 DB를 읽기 전용 세션으로 조회해, `bot_reason`별 분포를 분석치와 견준다(2026-10-13 사용자가 운영 읽기 조회를 직접 지시했다).
- **Q3 봇만 있는 발송의 뱃지**: 아이콘만 보이고, 수는 툴팁에서 보인다. 숫자가 보이면 사람 클릭으로 오해할 수 있기 때문이다. 화면 검증 때 필요하다고 판단되면 바꾼다.

**리스크**
- **잠금 시간**: ALTER의 ACCESS EXCLUSIVE 잠금이 백필 커밋까지 수 초 이어진다. 그동안 클릭 기록과 로그 조회가 기다린다. `lock_timeout 5s`와 재시도로 무한 대기는 막는다.
- **배포 순간의 틈**: 옛 인스턴스가 기록한 클릭은 판정 없이 남을 수 있다. 0080의 UPDATE 1)~3)을 다시 돌리면 채워진다. 운영에서는 사용자가 요청할 때만 한다.
- **정밀도 경계**: JS는 ms, DB는 µs 단위라 경계 ±1ms에서 차이가 날 수 있다. 무시할 수 있는 수준이다. `sent_at`은 DB 시계, `clicked_at`은 앱 시계라 1초 미만의 차이도 생길 수 있다.
- **UA 부분 일치 오탐**: CUBOT 같은 UA는 사람인데 봇으로 걸린다. 테스트에 고정해 둔다.
- **풀 경합**: 검사기가 수십 개 링크를 동시에 열면 연결이 잠깐 대기한다. 트랜잭션이 몇 ms라 곧 풀린다.
- **"사람 클릭" 기준이 둘이다**: 깊이 알림은 2분 기준, 로그와 집계는 R6를 쓴다(범위 밖).
- **숫자 하락과 분기 변화**: 과거까지 클릭 수가 약 35% 줄어든다. 팀에 미리 알린다.
- **PostgreSQL 버전**: 0080의 3)은 11 이상이 필요하다. 로컬에서 `SHOW server_version`으로 확인한다.

## 17. 구현 순서

1. `email-click-bot-rules.test.ts`와 `email-click-bot-sql.test.ts`를 쓰고 RED를 확인한다. 그다음 `email-click-bot-rules.ts`, `0080`, journal을 만들어 GREEN으로 만든다(B1~B7, B13).
2. schema.ts를 바꾸고 `email-click-tracking.ts`를 수정한다.
3. 봇 제외 지점을 반영한다(5-2).
4. `email-click-signals.ts`를 만들고 호출부(email/logs, unified, MCP, types)에 붙인다.
5. types → `clickCell.test.ts` RED → `clickCell.ts` GREEN(B26) → `ClickCountCell.tsx` → 두 표 교체 순으로 진행한다.
6. `pnpm test`, `pnpm exec tsc --noEmit`, 바꾼 파일 eslint(B28)를 돌리고 14절 로컬 검증을 한다.

설계와 어긋나는 곳이 나오면 지어내지 말고 멈춰서 묻는다. 답이 설계 변경이면 이 문서를 먼저 고친다.
