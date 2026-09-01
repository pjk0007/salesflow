# DESIGN — 대량 발송 큐 이전

PLAN의 behaviors(B1~B8)를 어떻게 만족시킬지 확정한다.

## 큰 그림

```
[업로드/예약등록]  →  큐에 INSERT (pending)  →  즉시 응답
                              ↓
                     ┌────────┴────────┐
              업로드 직후 1회 깨움      외부 cron 10분마다
                     └────────┬────────┘
                              ↓
                     워커: 락 잡고 배치 발송 → sent
```

**큐가 본체다.** 깨우는 두 경로는 어느 쪽이 죽어도 나머지가 커버하고, 둘 다 죽어도 큐에 남아 다음에 나간다.

## 1. 테이블 신설 — `email_send_queue`

`email_automation_queue` 재사용은 **하지 않는다.** 그건 "발송 성공 후 반복 예약" 전용이다 (`email-automation.ts:234`, `if (success && link.repeatConfig)`). 의미가 다른 걸 겸용하면 나중에 둘 다 못 고친다.

```sql
CREATE TABLE email_send_queue (
    id            SERIAL PRIMARY KEY,
    record_id     INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
    partition_id  INTEGER NOT NULL REFERENCES partitions(id) ON DELETE CASCADE,
    org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    trigger_type  VARCHAR(20) NOT NULL,   -- 'on_create' | 'on_update'
    status        VARCHAR(20) NOT NULL DEFAULT 'pending',
    attempts      INTEGER NOT NULL DEFAULT 0,
    last_error    TEXT,
    locked_at     TIMESTAMPTZ,            -- processing 진입 시각 (stuck 판정용)
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at  TIMESTAMPTZ
);

CREATE INDEX esq_pickup_idx ON email_send_queue (status, id);
CREATE UNIQUE INDEX esq_record_trigger_idx ON email_send_queue (record_id, trigger_type);
```

### 설계 근거

**`record_id` 참조만 저장하고 발송 내용은 저장하지 않는다.** 제목·본문은 AI가 발송 시점에 생성하므로 큐에 넣을 시점엔 존재하지 않는다. 워커가 `processAutoPersonalizedEmail`을 그대로 부르면 기존 로직(규칙 조회·조건 평가·AI 생성·발송)이 전부 재사용된다.

**`esq_record_trigger_idx` UNIQUE** — 같은 레코드가 두 번 큐에 들어가는 것을 DB가 막는다. 업로드 재시도나 코드 실수로 중복 INSERT되어도 메일이 두 번 나가지 않는다. `email_followup_queue`의 `efq_parent_log_step_idx`와 같은 방어다.

**status 값**: `pending` → `processing` → `sent` | `failed` | `skipped`
- `skipped`: 규칙 미매칭·쿨다운·중복수신자·구독취소 등 정상적으로 안 보낸 경우. 실패가 아니므로 재시도하지 않는다.

## 2. 워커 — `processEmailSendQueue()`

`src/lib/email-send-queue.ts` 신설.

### 동시 실행 방지 — 기존 패턴 그대로

`scheduled-registration.ts:66-80`의 advisory lock을 그대로 쓴다. 이미 운영에서 도는 검증된 코드다.

```ts
const LOCK_KEY = 0x5c4edf02;  // scheduled-registration(0x5c4edf01)과 다른 키

const conn = await queryClient.reserve();
const [{ acquired }] = await conn`SELECT pg_try_advisory_lock(${LOCK_KEY}) AS acquired`;
if (!acquired) return { skippedAsLocked: true };
try { /* 처리 */ } finally {
    await conn`SELECT pg_advisory_unlock(${LOCK_KEY})`;
    conn.release();
}
```

**락을 잡은 커넥션에서 해제해야 하므로 `reserve()`로 전용 커넥션을 쓴다** — 풀에서 매번 다른 커넥션이 나오면 unlock이 다른 세션에 걸려 락이 영구히 남는다. (B4)

### 픽업 — 조건부 UPDATE로 원자적 선점

```ts
const picked = await tx.execute(sql`
    UPDATE email_send_queue
    SET status = 'processing', locked_at = NOW(), attempts = attempts + 1
    WHERE id IN (
        SELECT id FROM email_send_queue
        WHERE status = 'pending'
        ORDER BY id ASC
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
    )
    RETURNING id, record_id, partition_id, org_id, trigger_type
`);
```

advisory lock이 있어도 이 방식을 쓴다 — 락 획득과 픽업 사이, 또는 stuck 복구와 겹칠 때를 DB 레벨에서 막는다. **`attempts`를 픽업 시점에 올린다**: 처리 중 프로세스가 죽어도 시도 횟수가 남아 무한 재시도를 막는다. (B4, B6)

### 배치 처리 — 시간 상한으로 끊는다

```ts
const DEADLINE_MS = 8 * 60 * 1000;   // cron 10분 주기 안에 여유 2분
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1000;

const deadline = Date.now() + DEADLINE_MS;
while (Date.now() < deadline) {
    const batch = await pickBatch();
    if (batch.length === 0) break;

    const results = await Promise.allSettled(batch.map(processOne));
    // 결과를 상태로 반영 (아래)

    if (Date.now() < deadline) await sleep(BATCH_DELAY_MS);
}
```

**개수가 아니라 시간으로 끊는 이유**: AI 응답 시간이 날마다 다르다. 개수로 끊으면 느린 날 HTTP 타임아웃에 걸리고, 그때 진행분의 상태가 애매해진다. (B3)

**`BATCH_SIZE=5` + 1초 딜레이는 그대로 유지한다.** 초당 5건이라는 발송 속도 상한을 바꾸지 않는다 — 이번 작업은 유실을 막는 것이지 속도를 올리는 게 아니다. 수신 서버 스팸 판정과 AI rate limit도 이 속도에 맞춰져 있다.

### 결과 반영

```ts
for (const [i, r] of results.entries()) {
    if (r.status === "fulfilled") {
        await markSent(batch[i].id);            // 'sent'
    } else if (batch[i].attempts >= MAX_ATTEMPTS) {
        await markFailed(batch[i].id, r.reason); // 'failed' + last_error
    } else {
        await markPending(batch[i].id, r.reason); // 재시도 대기
    }
}
```

`MAX_ATTEMPTS = 3`. 초과하면 `failed`로 확정하고 사유를 남긴다. (B6)

## 3. stuck 복구

워커가 `processing` 상태에서 죽으면 그 행은 어느 상태에도 안 걸려 영구 정체된다. **오늘 12:26 배포가 정확히 이 케이스다.**

워커 시작 시 한 번 실행:

```sql
UPDATE email_send_queue
SET status = 'pending', last_error = 'stuck: reclaimed'
WHERE status = 'processing'
  AND locked_at < NOW() - INTERVAL '15 minutes'
  AND attempts < 3
```

**15분 기준 근거**: 워커 상한이 8분이므로 정상 처리 중인 행은 최대 8분이면 상태가 바뀐다. 15분이면 확실히 죽은 것이고, advisory lock 덕에 다른 워커가 동시에 그 행을 잡고 있을 수 없다. (B7)

## 4. 진입점 변경

### `record-import.ts` — `dispatchImportTriggers`

```ts
if (hasAiEmail) {
    // 큐에 적재만 한다. 발송은 워커가 한다.
    await db.insert(emailSendQueue)
        .values(insertedRecords.map((r) => ({ ... })))
        .onConflictDoNothing();   // UNIQUE 위반 무시
}
```

기존 `BATCH_SIZE` 루프를 **통째로 삭제**한다. 이게 이번 유실의 코드다. (B1)

`onConflictDoNothing()` — 같은 레코드가 이미 큐에 있으면 조용히 넘어간다.

### 호출부 두 곳 (B8)

- `bulk-import/route.ts:67` — 엑셀 업로드
- `scheduled-registration.ts:105` — 예약 등록

**둘 다 `dispatchImportTriggers`를 부르므로 함수 내부만 바꾸면 자동으로 커버된다.** 호출부는 손대지 않는다.

### 업로드 직후 깨움

`bulk-import/route.ts`에서 큐 INSERT 후:

```ts
// 워커를 깨운다 — 실패해도 무시한다. cron이 10분 내에 어차피 줍는다.
fetch(`${origin}/api/email/queue/process`, {
    method: "POST",
    headers: { "x-secret": process.env.CRON_SECRET! },
}).catch(() => {});
```

**깨움 실패를 무시하는 이유**: 이건 지연을 줄이는 최적화지 정확성의 근거가 아니다. cron이 안전망이다.

## 5. 범위 밖 — 이번엔 건드리지 않는다

`record-import.ts:190-197`의 알림톡·일반 이메일·자동보강은 배치 제한조차 없이 3,000건을 한꺼번에 던진다(`await` 없는 `for` 루프). **AI 이메일보다 위험하지만 이번 사이클에서 바꾸지 않는다** — 한 번에 여러 경로를 바꾸면 회귀 시 원인이 여러 개가 된다. 별도 사이클로 남긴다.

## 6. Anthropic 타임아웃 (B5)

`src/lib/ai/claude.ts:63, 87`:

```ts
const anthropic = new Anthropic({
    apiKey: client.apiKey,
    timeout: 120_000,   // 2분
    maxRetries: 0,      // SDK 재시도 끔 — requestWithRetry가 이미 한다
});
```

**큐가 있어도 타임아웃이 필요한 이유**: 큐는 유실을 막지만, 매달린 호출이 워커의 8분을 통째로 잡아먹는 것은 못 막는다. 둘은 대체재가 아니라 짝이다.

**`maxRetries: 0` 근거**: SDK 기본값은 2회 재시도인데 `requestWithRetry`(claude.ts:42)가 이미 재시도한다. 그대로 두면 2×2=4회가 되어 타임아웃 상한이 8분까지 늘어난다.

**120초 근거**: `runSearchLoop`은 web search 툴로 최대 4회 연속 호출한다(`MAX_SEARCH_CONTINUATIONS=3`). 타임아웃은 **개별 HTTP 요청**에 걸리므로 한 번의 검색 호출이 2분을 넘는 것은 비정상이다.

## 7. 중복 발송 — 이미 있는 방어

`auto-personalized-email.ts`에 두 겹이 이미 있다:

- `checkCooldown` — 같은 record + `ai_auto`로 1시간 내 발송 이력이 있으면 skip
- `checkDuplicateRecipientForAiAuto` — 같은 파티션 + 같은 이메일로 발송 이력이 있으면 skip

**재시도가 실제 중복 발송으로 이어지지 않는 근거다.** 발송 직후 프로세스가 죽어 `sent` 마킹을 못 해도, 재시도 시 쿨다운이 막는다.

여기에 큐의 UNIQUE 인덱스와 advisory lock이 더해져 **세 겹**이 된다.

## 8. 파일 계획

| 파일 | 작업 |
|---|---|
| `drizzle/XXXX_email_send_queue.sql` | 신규 — 테이블 + 인덱스 |
| `src/lib/db/schema.ts` | 수정 — `emailSendQueue` 정의 |
| `src/lib/email-send-queue.ts` | 신규 — 워커 |
| `src/lib/email-send-queue-rules.ts` | 신규 — 순수 로직 (TDD 대상) |
| `src/lib/email-send-queue-rules.test.ts` | 신규 — 테스트 |
| `src/app/api/email/queue/process/route.ts` | 신규 — cron 엔드포인트 |
| `src/lib/record-import.ts` | 수정 — 배치 루프 → 큐 INSERT |
| `src/app/api/partitions/[id]/records/bulk-import/route.ts` | 수정 — 깨움 추가 |
| `src/lib/ai/claude.ts` | 수정 — 타임아웃 2줄 |

**순수 로직 분리 이유**: `@/lib/db`를 import하면 모듈 로드 시점에 postgres 커넥션이 생겨 `tsx --test`가 붙잡힌다. 상태 전이·재시도 판정은 DB를 모르는 함수로 빼서 테스트한다.

### TDD 대상 (`-rules.ts`)

```ts
// 배치 결과 → 다음 상태
export function nextStatus(
    result: "ok" | "skip" | "error",
    attempts: number,
    maxAttempts: number
): "sent" | "skipped" | "failed" | "pending";

// stuck 판정
export function isStuck(lockedAt: Date, now: Date, thresholdMs: number): boolean;

// 데드라인 초과 판정
export function isDeadlineExceeded(startedAt: number, now: number, budgetMs: number): boolean;
```

## 9. 검증 계획

| behavior | 방법 |
|---|---|
| B1 | 로컬 3,000건 업로드 → 응답 시점 `email_send_logs` 0건, 큐 3,000건 확인 |
| B2 | 워커 1회 실행 → `sent` 증가 + 발송 로그 생성 확인 |
| B3 | 처리 중 워커 강제 종료(SIGKILL) → 남은 행 `pending`/`processing` 확인 → 재실행 시 이어서 처리 |
| B4 | 워커 2개 동시 실행 → 두 번째가 `skippedAsLocked` 반환, 발송 로그 record당 1건 |
| B5 | AI 호출을 인위적으로 지연시키는 스텁 → 타임아웃 후 다음 배치 진행 확인 |
| B6 | 발송 실패 스텁 → `attempts` 증가 → 3회 후 `failed` + `last_error` |
| B7 | `locked_at`을 과거로 조작한 `processing` 행 → 워커 실행 → `pending` 복귀 |
| B8 | 예약 등록 경로로 레코드 생성 → 큐 적재 확인 |

**운영 DB는 조회만 한다.** 모든 검증은 로컬(`postgresql://jaehun@localhost:5432/salesflow`).

## 10. 배포 순서

1. 마이그레이션 (테이블 생성) — 기존 코드에 영향 없음
2. 코드 배포 — 이 시점부터 업로드가 큐로 들어간다
3. **CloudType Scheduler에 Job 추가** — URL은 배포 후 확정 통보
   ```
   이름: 이메일 발송 큐
   POST https://sendb.kr/api/email/queue/process
   Cron: 0 */10 * * * *
   ```

**3을 빼먹으면 업로드분이 큐에만 쌓이고 안 나간다.** 업로드 직후 깨움이 있어 평소엔 돌지만, 그게 실패하면 주워줄 안전망이 없다.

## 11. 남은 문제 (이번 범위 밖)

**이메일 followup이 평균 24시간 늦게 나간다.** cron이 `0 0 9 * * *`(하루 1번)이라 09:06에 때가 된 건은 다음날 09:05까지 기다린다. 실측: 최근 7일 처리분 9,490건이 24시간 이내 구간, 111건이 24시간 초과, 최대 지연 24시간 1분.

주기를 줄이면 해결되지만 **`processEmailFollowupQueue`에는 락이 없어** 회차가 겹치면 중복 발송 위험이 있다. 별도 사이클에서 락을 넣고 주기를 조정한다.

---

## 12. 추가 — `scheduled_at` (구현 중 확정)

### 왜 필요했나

구현 후 배포 시점을 잡다가 드러났다. **기존 코드에는 발송 시각을 정하는 수단이 아예 없다.** 오늘 사고 3건 모두 업로드 30~60초 뒤 발송이 시작됐다:

| 파티션 | 업로드 | 발송 시작 |
|---|---|---|
| 56 | 10:37:41 | 10:38:18 |
| 55 | 11:13:57 | 11:14:46 |
| 34 | 11:50:20 | 11:50대 |

3,000건이면 초당 5건이라 2~3시간 걸린다. 밤에 업로드하면 밤새 나간다. 미발송 8,006건을 재적재할 때 그대로 야간 발송이 된다.

### 설계

```sql
scheduled_at timestamptz NOT NULL DEFAULT now()
```

픽업 조건에 한 줄 추가:

```sql
WHERE status = 'pending' AND scheduled_at <= NOW()
ORDER BY scheduled_at ASC, id ASC
```

**기본값이 `now()`라 일반 업로드 동작은 그대로다.** 미래 시각을 넣은 행만 그때까지 대기한다.

인덱스도 `(status, scheduled_at, id)`로 바꿨다 — 픽업 조건과 정렬 순서를 그대로 따른다.

### `enqueueSends` 공통화

업로드 경로와 재발송 스크립트가 같은 적재 규칙을 쓰도록 `email-send-queue.ts`에 함수를 뒀다. 적재 규칙이 두 곳으로 갈리면 한쪽만 고쳐져 중복 발송이 난다.

### 재발송 스크립트

`scripts/enqueue-unsent.ts` — 기본 dry-run, `--apply`를 붙여야 실제 적재한다.

```
tsx --env-file=.env.local scripts/enqueue-unsent.ts \
  --partitions=56,55,34 --since=2026-09-01 --at="2026-09-02 12:00" --apply
```

이미 발송 로그가 있거나 이미 큐에 있는 레코드는 제외한다(`notExists` 2개). 500건씩 나눠 INSERT한다 — 한 번에 넣으면 파라미터 한도에 걸린다.
