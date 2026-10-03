# DESIGN — 발신 주소 웜업·하루 한도·분산 발송

- **track**: Full
- **사이클 ID**: 2026-10-02-sender-warmup
- **근거**: 대표 요청(2026-10-02) "발신 도메인 분산 … 마케팅 수신받은 DB를 대상으로 웜업하는 기능". 법무 검토 완료(대표)
- **브랜치**: `dev` (main 금지). 마이그레이션 0071은 아직 커밋 안 된 0070(깊이 들어온 사람 알림) 뒤에 나간다
- **선행 조사**: 발송 경로 10곳·대기열 3종 지도 (이 문서 0절에 요약)

## 0. 실측으로 확정된 사실

- NHN 발송 함수는 `NhnEmailClient.sendEachMail` 하나, 호출부 10곳. 대량 경로는 5갈래
  1. AI 첫 메일 `processAutoPersonalizedEmail` (`auto-personalized-email.ts`) — 대기열(`email_send_queue`)로 오거나, 단건 생성·수정·v1 API·Meta 웹훅에서 `dispatchAutoTriggers`로 **바로** 온다
  2. 후속 메일 `email-followup.ts` (AI·템플릿) — `email_followup_queue.check_at`, 잠금 없음
  3. 템플릿 자동 첫 메일 `processEmailAutoTrigger` — 대기열 없음. 업로드 때 레코드마다 동시에 돈다
  4. 템플릿 반복 `processEmailRepeatQueue` — `email_automation_queue.next_run_at`
  5. 수동 발송 `POST /api/email/send` — 요청 안에서 최대 1000건 루프
- 일회성(테스트 발송, test-followup, 주소 확인, 초대)은 한도에서 뺀다
- `email_send_logs`에는 `(sender_profile_id, sent_at)` 인덱스가 없다 → 사용량을 로그로 세지 않고 **카운터 표**를 둔다
- AI 첫 메일은 발신자를 정한 뒤 회사 조사·AI 생성을 하고 로그를 넣는다 → 판정은 **발신자를 정하는 자리**에서 한다 (토큰을 쓰기 전)
- 레코드 단위 쿨다운(1시간, `checkCooldown`)이 규칙마다 발신자 결정보다 먼저 돈다. 규칙 조회에 정렬이 없다

## 1. 기능

**발신 주소(발신 프로필)마다**
- 하루 최대 발송 수
- 웜업: 첫날 N통, 하루 M통씩 늘려 하루 최대에서 멈춤
- 발송 시간대 (한국 시각, 정시 단위 시작~끝)
- 평일만
- 고르게 나눠 보내기 (하루 한도를 시간대 안에서 같은 간격으로)
- 일시 정지
- 오늘 보낸 수 / 오늘 한도, 웜업 n일째, 앞으로 14일 하루 한도 미리보기

**AI 발송 규칙마다**
- 발신 주소 묶음(여러 개). 메일마다 오늘 보낼 수 있는 주소 중 가장 오래 쉰 주소로 보낸다
- 묶음 전부가 막히면 메일을 버리지 않고 가장 이른 보낼 수 있는 시각으로 미룬다
- 후속 메일은 첫 메일을 보낸 주소로 보낸다 (같은 대화로 이어지게). 막히면 그 주소가 열릴 때로 미루고 다른 주소로 넘기지 않는다

**바뀌지 않는 것**: 한도를 하나도 켜지 않은 주소, 주소가 하나인 규칙은 지금과 똑같이 나간다.

## 2. 결정 ① 판정 규칙 (순수, `src/lib/email-sender-limit-rules.ts`)

이미 있는 미완성 파일을 고쳐 쓴다. KST 계산은 `src/lib/kst.ts`를 쓰고 이 파일의 중복 도우미는 지운다.

```ts
export interface SenderLimitSettings {
    dailyLimit: number | null;          // null = 제한 없음
    warmupEnabled: boolean;
    warmupStartCount: number | null;    // null이면 DEFAULT_WARMUP_START
    warmupStep: number | null;          // null이면 DEFAULT_WARMUP_STEP
    warmupStartedOn: string | null;     // "YYYY-MM-DD" KST
    sendWindowStart: number | null;     // 0~23, 포함
    sendWindowEnd: number | null;       // 1~24, 미포함
    weekdaysOnly: boolean;
    spreadEvenly: boolean;
    isPaused: boolean;
}
export const DEFAULT_LIMIT_SETTINGS: SenderLimitSettings;   // 전부 꺼짐
export const DEFAULT_WARMUP_START = 10;
export const DEFAULT_WARMUP_STEP = 5;
export const DEFAULT_RESUME_HOUR = 9;

export function toLimitSettings(row: Partial<Record<keyof SenderLimitSettings, unknown>> | null | undefined): SenderLimitSettings;
export function hasAnyLimit(s: SenderLimitSettings): boolean;
/** 웜업 며칠째 (시작일 = 0). 보낼 수 있는 날만 센다 — 평일만이면 주말은 세지 않는다 */
export function warmupDayIndex(s: SenderLimitSettings, date: string): number;
export function capForDate(s: SenderLimitSettings, date: string): number | null;
export function capSchedule(s: SenderLimitSettings, fromDate: string, days: number): Array<{ date: string; cap: number | null }>;
export function isSendableNow(s: SenderLimitSettings, now: Date): boolean;
export function nextSendableAt(s: SenderLimitSettings, now: Date, skipToday?: boolean): Date;   // 늘 새 Date
/** 고르게 나눌 때 두 발송 사이 최소 간격 (ms). 0 = 간격 없음 */
export function spreadGapMs(s: SenderLimitSettings, cap: number | null): number;
export type SlotDeferReason = "paused" | "outside_window" | "daily_limit" | "spacing";
export type SlotDecision = { ok: true } | { ok: false; retryAt: Date; reason: SlotDeferReason };
export function decideSlot(s: SenderLimitSettings, now: Date, usage: { sentToday: number; lastSentAt: Date | null }): SlotDecision;

export interface PoolCandidate { id: number; settings: SenderLimitSettings; usage: { sentToday: number; lastSentAt: Date | null } }
export type PoolRank = { ok: true; order: number[] } | { ok: false; retryAt: Date; reason: SlotDeferReason };
export function rankPool(cands: readonly PoolCandidate[], now: Date): PoolRank;

export function linkSenderPool(link: { senderProfileId: number | null; senderProfileIds: number[] | null }): number[];
/** API 입력 검사. 배열(또는 null)만 받는다. 양의 정수만, 중복 제거, 순서 유지, 최대 50개. 빈 배열 → ids:null.
 *  배열 길이가 MAX_SENDER_POOL_INPUT(1000)을 넘으면 중복 제거 전에 바로 거절한다 (중복 제거는 Set, O(n)) */
export function normalizeSenderPool(input: unknown): { ok: true; ids: number[] | null } | { ok: false; error: string };
/** 간격으로 막힌 묶음이 한 통씩 더 보낼 수 있게 되는 평균 간격 (주소마다 1/간격을 더해 뒤집음). 0 = 펼치지 않음 */
export function poolSpacingStepMs(cands: readonly PoolCandidate[], now: Date): number;
/** 같은 묶음·같은 retryAt으로 미뤄지는 메일을 순번 × stepMs로 펼친다 (memo는 프로세스 안에서만) */
export function spreadSpacingRetry(memo: SpacingSpreadMemo, poolKey: string, retryAt: Date, stepMs: number, now: Date): Date;
export type SettingsValidation = { ok: true; value: SenderLimitSettings } | { ok: false; error: string };
export function validateLimitSettings(patch: Record<string, unknown>, current: SenderLimitSettings, todayYmd: string): SettingsValidation;
export function describeDeferral(reason: SlotDeferReason, retryAt: Date): string;   // "deferred(daily_limit) until 10/3 09:00"
```

규칙
- `capForDate`: 정지면 0. 웜업이면 `start + step × warmupDayIndex`, 하루 최대가 있으면 그 값에서 멈춤. 웜업이 켜졌는데 시작일이 없으면 그날을 0일째로 본다 (API가 켤 때 반드시 기록한다)
- `warmupDayIndex`: `warmupStartedOn`부터 `date` 전날까지 "보낼 수 있는 날" 수. `weekdaysOnly`면 토·일 제외. `date`가 시작일보다 이르면 0
- `decideSlot` 순서: 정지 → `paused`(다음 보낼 수 있는 날 시작) / 시간대·요일 밖 → `outside_window` / 오늘 보낸 수 ≥ 오늘 한도 → `daily_limit`(다음 날) / 간격 → `spacing`. `spacing`의 retryAt이 시간대 끝을 넘으면 다음 보낼 수 있는 날 시작으로
- `spreadGapMs`: 고르게가 켜져 있고 한도가 있으면 `floor(시간대 길이 ms / 한도)`. 시간대가 없으면 고르게 나누기를 쓰지 않는다 (검증에서 막음)
- `rankPool`: 후보마다 `decideSlot`. 통과한 후보를 `lastSentAt` 오래된 순(없음이 먼저), 같으면 묶음 순서. 전부 막히면 정지 아닌 후보의 가장 이른 retryAt과 그 이유. 전부 정지면 가장 이른 retryAt, `paused`
- `validateLimitSettings`: 현재 값에 patch를 합친 **결과**를 검증한다
  - 숫자: 정수(숫자 또는 숫자 문자열), `null`/`""`는 비움. 범위 — 하루 최대 1~100000, 첫날 1~100000, 하루 증가 0~100000, 시작 0~23, 끝 1~24
  - 참거짓: `true/false`, `"true"/"false"`, `1/0`, `"1"/"0"`만. 그 밖은 오류
  - 시간대는 시작·끝을 함께, 끝 > 시작
  - 웜업은 하루 최대가 있어야 한다
  - 고르게 나누기는 시간대와 한도(하루 최대 또는 웜업)가 있어야 한다
  - 웜업이 꺼짐 → 켜짐이면 `warmupStartedOn = todayYmd`, 켜짐 → 꺼짐이면 `null`. patch에 `warmupStartedOn`이 오면 무시한다 (서버가 정한다)
  - 오류 문구는 한국어, 조사 맞게 ("발송 시작 시각은 …")

## 3. 결정 ② 결과 타입 (순수)

`src/lib/auto-personalized-email-outcome.ts`
```ts
| { kind: "deferred"; linkId: number; retryAt: Date; reason: SlotDeferReason }
SkipReason에 "retry_exhausted" (대기열 줄에서 시도 횟수를 다 써 뺀 규칙 — 돌리지 않음, 실패로 세지 않음)
export type QueueOutcome = "ok" | "skip" | "error" | "defer";
foldOutcome: 미매칭 → skip, failed 있음 → error, deferred 있음 → defer, sent 있음 → ok, 그 밖 → skip
export function deferredUntil(result: RecordOutcome): { retryAt: Date; reason: SlotDeferReason } | null;   // 가장 이른 것, 실패가 섞여도 준다
export function failedLinkIds(result: RecordOutcome): number[];   // 실패한 규칙 id
describeOutcome: "link N: deferred (daily_limit) until 2026-10-03T00:00:00.000Z"
```
기존 시험의 문자열·우선순위는 그대로 둔다. 대기열은 error여도 `deferredUntil`·`failedLinkIds`를 함께 본다 (아래 `planQueueRow`).

`src/lib/email-send-queue-rules.ts`: `ProcessOutcome`에 `"defer"`, `nextStatus("defer") = "pending"`. 다른 export는 그대로 (`isDeadlineExceeded`는 다른 기능이 쓴다).
줄 하나를 처리한 뒤 쓸 값은 순수 함수 `planQueueRow(result) → { status, attempts(절대값), scheduledAt|null, exhaustedLinkIds, stat }`가 정하고 워커(`applyPlan`)는 그대로 쓴다 (리뷰 뒤 추가)
- `ok` → sent / `skip` → skipped (빼 둔 규칙이 있으면 failed — 그 규칙은 끝내 실패했다)
- `defer` → pending, `scheduled_at = retryAt`, 꺼낼 때 올린 시도 1을 되돌림 (0 아래로 안 감) — W14
- `error`, 시도 남음 → pending, `scheduled_at` 그대로 (같은 회차에 바로 다시) — 미룸이 섞여 있어도 같다. 앞 규칙 재시도는 뒤 규칙 한도와 상관없다
- `error`, 시도 다 씀, 미룸 없음 → failed
- `error`, 시도 다 씀, **미룸 있음** → failed로 닫지 않는다. 이번에 실패한 규칙을 `exhausted_link_ids`에 더하고 시도 0, `scheduled_at = retryAt`. 다음에 꺼낼 때 그 규칙은 `retry_exhausted`로 건너뛰므로 AI 생성·발송 비용은 처음 3번으로 끝나고, 미룬 규칙만 다시 시도된다. 새로 뺄 규칙이 없으면 failed — 규칙 수만큼만 되풀이된다
- `revivesOnRequeue(status)`: 처리하는 사이 "다시 처리" 요청(`requeue_at`)이 있으면 skipped·failed는 끝내지 않고 그 시각에 다시 꺼낸다. sent는 다시 꺼내지 않는다 (쿨다운이 막았을 두 번째 메일)

## 4. 결정 ③ 표와 마이그레이션 0071

`drizzle/0071_email_sender_limits.sql`, 저널 `{"idx":71,"version":"7","when":1773400000000,"tag":"0071_email_sender_limits","breakpoints":true}`

```sql
-- email_sender_profiles: 한도 칸 (전부 기본값이 "꺼짐"이라 기존 주소는 그대로 나간다)
ALTER TABLE "email_sender_profiles" ADD COLUMN IF NOT EXISTS "daily_limit" integer;
ALTER TABLE "email_sender_profiles" ADD COLUMN IF NOT EXISTS "warmup_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "email_sender_profiles" ADD COLUMN IF NOT EXISTS "warmup_start_count" integer;
ALTER TABLE "email_sender_profiles" ADD COLUMN IF NOT EXISTS "warmup_step" integer;
ALTER TABLE "email_sender_profiles" ADD COLUMN IF NOT EXISTS "warmup_started_on" varchar(10);
ALTER TABLE "email_sender_profiles" ADD COLUMN IF NOT EXISTS "send_window_start" integer;
ALTER TABLE "email_sender_profiles" ADD COLUMN IF NOT EXISTS "send_window_end" integer;
ALTER TABLE "email_sender_profiles" ADD COLUMN IF NOT EXISTS "weekdays_only" boolean DEFAULT false NOT NULL;
ALTER TABLE "email_sender_profiles" ADD COLUMN IF NOT EXISTS "spread_evenly" boolean DEFAULT false NOT NULL;
ALTER TABLE "email_sender_profiles" ADD COLUMN IF NOT EXISTS "is_paused" boolean DEFAULT false NOT NULL;

-- 주소별 하루 사용량 (KST 날짜). 예약 수를 센다 — 로그를 세지 않는다
CREATE TABLE IF NOT EXISTS "email_sender_daily_usage" (
    "sender_profile_id" integer NOT NULL REFERENCES "email_sender_profiles"("id") ON DELETE CASCADE,
    "usage_date" varchar(10) NOT NULL,
    "sent_count" integer DEFAULT 0 NOT NULL,
    "last_sent_at" timestamp with time zone,
    PRIMARY KEY ("sender_profile_id", "usage_date")
);

-- AI 규칙의 발신 주소 묶음 (순서 있음). sender_profile_id는 첫 원소로 맞춰 둔다
ALTER TABLE "email_auto_personalized_links" ADD COLUMN IF NOT EXISTS "sender_profile_ids" jsonb;

-- 후속 대기열 잠금 (processing 상태와 회수용)
ALTER TABLE "email_followup_queue" ADD COLUMN IF NOT EXISTS "locked_at" timestamp with time zone;

-- 템플릿 자동 첫 메일을 미룰 때 반복 대기열에 'first'로 넣는다
ALTER TABLE "email_automation_queue" ADD COLUMN IF NOT EXISTS "kind" varchar(10) DEFAULT 'repeat' NOT NULL;

-- (리뷰 뒤 추가) 발송 대기열: 시도 횟수를 다 쓴 AI 규칙 id — planQueueRow
ALTER TABLE "email_send_queue" ADD COLUMN IF NOT EXISTS "exhausted_link_ids" jsonb;
-- (리뷰 뒤 추가) 발송 대기열: 워커가 처리하는 사이 바로 보내는 경로가 남긴 "다시 처리" 시각 — enqueueDeferredSend
ALTER TABLE "email_send_queue" ADD COLUMN IF NOT EXISTS "requeue_at" timestamp with time zone;
```
0071은 아직 어느 DB에도 적용하지 않은 상태에서 위 두 줄을 더했다. 혹시 이미 적용한 DB가 있으면 마이그레이터가 0071을 다시 돌리지 않으므로 두 `ALTER`를 손으로 실행해야 한다.
`usage_date`는 `varchar(10)` "YYYY-MM-DD" — `date` 형으로 하면 DB 세션 시간대에 따라 바뀔 수 있다. `schema.ts`에 같은 칸·표·타입(`EmailSenderDailyUsage`)을 넣는다.

## 5. 결정 ④ 자리 잡기 (DB, 새 파일 `src/lib/email-sender-limit.ts`)

```ts
export interface SenderSlot { sender: ResolvedSender; reservation: { profileId: number; usageDate: string } | null }
export type ClaimResult =
    | { ok: true; slot: SenderSlot }
    | { ok: false; retryAt: Date; reason: SlotDeferReason; profileId: number | null };
export async function claimSender(orgId: string, opts: {
    mode: "pool" | "fixed";
    ids: ReadonlyArray<number | null | undefined>;
    config: LegacyEmailConfig | null;
    now?: Date;
    spreadDeferrals?: boolean;   // (리뷰 뒤 추가) 간격 미룸을 순번대로 펼친다 — 대기열로 다시 시도하는 경로만 켠다
}): Promise<ClaimResult>;
export async function releaseSenderSlot(slot: SenderSlot | null | undefined): Promise<void>;   // 던지지 않는다
export interface SenderUsageView { profileId: number; usageDate: string; sentToday: number; cap: number | null; warmupDay: number | null; schedule: Array<{ date: string; cap: number | null }> }
export async function getSenderUsage(orgId: string, now?: Date): Promise<SenderUsageView[]>;
```

- `email-sender-resolver.ts`의 프로필 조회를 `loadOrgSenderProfiles(orgId)`로 빼서 `resolveSender`와 `claimSender`가 같이 쓴다 (한도 칸 포함). `resolveSender` 시그니처는 그대로
- 후보 고르기는 순수 함수 `pickSenderCandidates(profiles, opts)` (`email-sender-limit-paths.ts`)가 한다 — W1 시험이 `pickSender`와 같은 주소인지 본다
- `pool`: `ids` 중 이 조직 주소 전부가 후보. 하나도 없으면 `pickSender` 결과 하나 (기본 → 레거시 설정)
- `fixed`: `pickSender` 순서의 첫 유효 주소 하나만. 막히면 그 주소의 retryAt으로 미룬다
- 레거시 설정 발신자(`profileId: null`)는 예약 없이 통과
- 간격 미룸 펼치기 (`spreadDeferrals: true`, 리뷰 뒤 추가): 간격(`spacing`) retryAt은 "마지막 발송 + 간격" 하나라서, 막힌 줄이 전부 같은 시각에 깨어나 한 통만 나가고 나머지가 다시 미뤄지기를 간격마다 되풀이했다 (밀린 줄 수 × 쿼리 10여 개). 이제 같은 묶음·같은 retryAt으로 미뤄지는 k번째 메일은 `retryAt + k × 묶음 간격`(`poolSpacingStepMs`: 주소마다 1/간격의 합을 뒤집은 값)으로 미룬다. 묶음 속도보다 촘촘하게 펼치므로 제 차례보다 늦게 깨지는 않는다. 기록은 프로세스 안에서만 이어지고(재시작·다른 인스턴스는 0번부터) 지난 retryAt은 버린다. AI 첫 메일·후속·템플릿이 켜고, 수동 발송은 안내 문구에 실제 열리는 시각을 보여야 해서 켜지 않는다
- 날짜 키는 `kstParts(now).date`를 한 번만 계산해 판정과 SQL에 같이 쓴다
- 예약 (한 문장 = 한 트랜잭션, 동시 실행에 안전):
```sql
INSERT INTO email_sender_daily_usage AS u (sender_profile_id, usage_date, sent_count, last_sent_at)
VALUES ($pid, $day, 1, $now)
ON CONFLICT (sender_profile_id, usage_date) DO UPDATE
   SET sent_count = u.sent_count + 1, last_sent_at = EXCLUDED.last_sent_at
 WHERE ($cap::int IS NULL OR u.sent_count < $cap::int)
   AND ($gapMs::bigint = 0 OR u.last_sent_at IS NULL
        OR u.last_sent_at <= $now::timestamptz - $gapMs::bigint * INTERVAL '1 millisecond')
RETURNING sent_count
```
  0행이면 경쟁에서 진 것 → 그 줄을 다시 읽어 `decideSlot`으로 retryAt을 구하고 다음 후보로
- 반환: `UPDATE … SET sent_count = sent_count - 1 WHERE … usage_date = $예약한날 AND sent_count > 0`
  - 돌려주는 때: 예약 뒤 `sendEachMail`을 부르기 전 예외(회사 조사·AI·로그 insert), NHN `isSuccessful:false`
  - 돌려주지 않는 때: `sendEachMail`이 던짐(나갔을 수 있다), 발송 뒤 DB 갱신 실패
- 한도가 없는 주소도 사용량은 기록한다 (화면 표시, 하루 중간에 한도를 켤 때, 묶음 순번)

## 6. 결정 ⑤ 경로별 연결

| 경로 | 바꾸는 것 | 막혔을 때 |
|---|---|---|
| AI 첫 메일 (`auto-personalized-email.ts`) | 규칙 조회에 `orderBy(id)`. `resolveSender` → `claimSender({mode:"pool", ids: linkSenderPool(link)})`. 발송 실패·예외 때 반환 | `deferred`를 넣고 **루프를 끝낸다** (`break`) — 앞 규칙이 미뤄졌는데 뒤 규칙이 쿨다운을 통과해 나가는 것을 막는다 |
| 발송 대기열 (`email-send-queue.ts`) | 줄을 처리한 뒤 `planQueueRow`(3절) 결과를 `applyPlan` 한 문장으로 쓴다. `defer`: `status='pending'`, `scheduled_at=retryAt`, 꺼낼 때 올린 시도 1 되돌림, `locked_at=null`, `last_error=describeDeferral(...)`. 실패 + 미룸으로 시도를 다 쓰면 실패 규칙만 `exhausted_link_ids`로 빼고 retryAt에 다시 (꺼낼 때 `skipLinkIds`로 넘겨 그 규칙은 돌리지 않음). 통계 `deferred`. 미룸만 나온 배치는 1초 쉬지 않는다 | — |
| 바로 보내는 AI (`automation-dispatch.ts`) | 결과에 `deferredUntil`이 있으면 `enqueueDeferredSend` (대기열 upsert: 끝난 줄이면 pending으로 되살리고 scheduled_at=retryAt, attempts=0, 빼 둔 규칙 비움. 이미 pending이면 둔다. **processing이면 `requeue_at`만 남기고**, 워커가 skipped·failed로 끝내려 할 때 `applyPlan`이 그 시각에 다시 꺼낸다 — 워커가 고치기 전 레코드를 읽었을 수 있다) | 대기열로 |
| 후속 (`email-followup.ts`) | 잠금 `0x5c4edf05`, `processing` 선점(`FOR UPDATE SKIP LOCKED`, `locked_at`), 30분 넘은 processing 회수, 예산 8분. 반환형 `{kind:"sent"}|{kind:"skipped"}|{kind:"deferred"; retryAt}`. AI 후속 발신 순서 `[parentLog.senderProfileId, ...linkSenderPool(link)]` (첫 메일 주소 먼저), 템플릿 후속 `[parentLog.senderProfileId]`, 둘 다 `mode:"fixed"`. 예약은 AI 생성 전. 템플릿 후속의 템플릿은 **이 조직 것만** 읽는다. 취소 API(`PATCH /api/email/followup-queue/[id]`)는 `status='pending'`일 때만 바꾸고 아니면 409 | `status='pending'`, `check_at=retryAt`, `locked_at=null` (취소된 줄은 되살리지 않음) |
| 템플릿 자동·반복 (`email-automation.ts`) | `resolveDefaultSender` 대신 `claimSender({mode:"fixed", ids:[]})` (기본 주소). 로그에 `senderProfileId`. 규칙별 본문을 `sendTemplateFirst`로 빼서 반복 대기열에서 다시 씀. 템플릿은 **이 조직 것만** 읽는다. 반복 대기열 워커(리뷰 뒤 바뀜): 잠금 `0x5c4edf06`, 예산 8분 동안 회차 시작 시각까지 기한이 된 줄을 id 순으로 100줄씩 한 번씩, 줄이 던져도 계속. 한 조직의 기본 주소가 막히면 그 조직의 기한 된 `kind='first'` 줄을 한 문장으로 retryAt에 옮기고, 그 조직의 반복 줄은 중단 조건만 본 뒤 발송 준비 없이 옮긴다 | 첫 메일: `email_automation_queue`에 `kind='first'`, `next_run_at=retryAt`. 반복: `next_run_at=retryAt` (repeat_count 그대로) |
| 수동 (`api/email/send`) | 레코드마다 `claimSender({mode:"fixed", ids:[senderProfileId]})`. 레코드 조회에 **조직 조건 추가** (지금 없음). 템플릿 조회에도 **조직 조건** (리뷰 뒤 추가) | 보내지 않고 `limitedCount`와 이유를 돌려줌. `daily_limit`·`paused`·`outside_window`면 남은 레코드는 바로 같은 이유로 묶음 |
| 테스트 발송·test-followup | 발신 순서만 실제와 같게 (`linkSenderPool`, 첫 메일 주소 먼저). 예약하지 않음. AI 테스트 발송 레코드 조회에 **조직 조건 추가**. AI 테스트 발송은 id가 양의 정수가 아니면 400, 500 응답은 고정 문구 (원래 오류는 서버 로그에만) | — |
| `scripts/resend-unsent.ts` | deferred는 성공으로 세지 않음. 발송 대기열에 pending·processing 줄이 있는 레코드는 대상에서 뺀다 (트리거 종류 무관). 미룬 건은 `enqueue-unsent.ts`로 대기열에 넣으라고 안내 (다시 돌리라고 하지 않는다) | — |

## 7. 결정 ⑥ API

- `PUT /api/email/sender-profiles/[id]`: 한도 칸을 받는다. 한도 칸이 하나라도 있으면 `requireAdmin`. `validateLimitSettings(patch, 현재, 오늘)` → 합친 값 저장
- `POST /api/email/sender-profiles`: 같은 한도 칸을 받는다 (관리자)
- (리뷰 뒤 추가) 한도·사용량은 주소가 아니라 프로필 id에 걸려서, 한도 칸 없이도 한도를 피해 갈 수 있었다. 아래는 한도 칸이 없어도 `requireAdmin` (`senderProfileChangeNeedsAdmin`·`senderProfileDeleteNeedsAdmin`, `email-sender-limit-paths.ts`)
  - 한도가 하나라도 켜진 다른 프로필과 같은 주소(앞뒤 공백·대소문자 무시)로 만들거나 바꾸기
  - 한도가 켜진 프로필의 주소 바꾸기
  - 한도가 켜진 프로필 지우기 (지우면 그 주소만 묶은 규칙이 기본 주소로 흘러 바로 나간다)
  - 한도가 하나도 없는 주소끼리는 예전처럼 누구나. 403이면 이유 문구를 돌려준다
- (리뷰 뒤 추가) 주소를 바꾸면 웜업이 켜져 있을 때 `warmupStartedOn = 오늘(KST)` — 새 주소는 0일째부터 (`restartedWarmupStartedOn`)
- (리뷰 뒤 추가) 템플릿 발송 규칙 `POST /api/email/template-links`, `PUT …/[id]`: `emailTemplateId`와 `followupConfig`의 `onClicked/onNotClicked.templateId`가 모두 이 조직 템플릿인지 확인, 아니면 400 (`collectLinkTemplateIds` → `checkLinkTemplatesOwned`)
- 목록 응답은 한도 칸을 포함한다
- `GET /api/email/sender-profiles/usage`: `getSenderUsage(orgId)` → 주소별 오늘 사용량·한도·웜업 n일째·14일 미리보기
- AI 규칙 `POST /api/email/auto-personalized`, `PUT …/[id]`: `senderProfileIds`를 받는다. `normalizeSenderPool` → 이 조직 주소인지 확인(모르는 id는 400) → `senderProfileId = ids[0] ?? null`로 맞춰 저장. `senderProfileId`만 오면 `senderProfileIds = id ? [id] : null`. 목록·상세 응답에 `senderProfileIds`. 기존 `senderProfileId`도 이 조직 주소인지 확인한다 (지금 없음)

## 8. 결정 ⑦ 화면

- `SenderProfileManager.tsx` 대화상자에 "발송 한도·웜업" 구역 (`src/components/email/sender-profiles/ui/SenderLimitSection.tsx`): 하루 최대, 웜업 켜기(첫날·하루 증가), 발송 시간대(시작·끝 시), 평일만, 고르게 나눠 보내기, 일시 정지, 14일 미리보기 표(`capSchedule`). 저장 오류는 토스트로
- 주소 목록 줄에 배지: "정지", "웜업 n일째", "오늘 x/한도"
- AI 규칙 만들기·고치기 화면의 발신 주소 선택을 묶음 선택(`SenderPoolField.tsx`, 체크박스 목록 + 순서)으로. 아무것도 고르지 않으면 "기본 발신 주소"
- 규칙 복제 때 `senderProfileIds`도 복제. 지금 프로필 목록에 없는(지워진) id는 빼고 보내고 몇 개 뺐는지 알린다 (다 빠지면 기본 발신 프로필). 목록을 못 읽었으면 거르지 않는다. 실패하면 서버 사유를 토스트로 보여 준다
- 후속 대기열 취소가 409(그사이 발송 처리에 들어감)면 사유를 토스트로 보여 주고 목록을 다시 읽는다
- `SendEmailDialog`: 한도로 못 보낸 건수 표시
- `FollowupQueueTable`: `processing` 라벨
- 타입은 `src/components/email/sender-profiles/types/index.ts` 한 곳에

## 9. 운영 (사람이 할 일)

- 배포 뒤 로그 `[migrate] 마이그레이션 완료!` 확인 (실패해도 서버는 켜지고 새 칸 조회가 500을 낸다)
- CloudType Scheduler 주기
  - 발송 대기열 `/api/email/queue/process`: 10분 → **1분** 권장 (잠금이 있어 안전). 고르게 나눠 보내기의 실제 간격 하한이 주기다
  - 후속 대기열 `/api/email/automation/process-followups`: 하루 1번(09:00) → **10분** (이번에 잠금을 넣었다). 지금처럼 하루 1번이면 시간대가 09시보다 늦게 시작하는 주소의 후속은 다음 날로 밀린다
  - 반복 대기열 `/api/email/automation/process-repeats`: 10분 (리뷰 뒤 잠금 `0x5c4edf06`과 8분 예산을 넣었다 — 회차가 겹치면 뒤 회차는 건너뛴다)
- 개발 DB는 실제 고객 데이터다 → 개발 서버에서 발송이 걸린 시험은 대표 확인 후, 시험용 파티션·내부 주소로만

## 10. 범위 밖

- 웜업 날수에서 정지한 날 빼기 (정지 이력이 없다)
- 분 단위 시간대
- 도메인별 합계 한도 (지금은 주소별)
- 서명 페르소나를 주소별로 바꾸기 (서명은 규칙당 하나)
- NHN 요청 타임아웃

## 11. behavior 목록

| ID | 내용 |
|---|---|
| W1 | 한도가 하나도 없으면 `hasAnyLimit=false`, 바로 보냄, 고르는 주소가 `pickSender`와 같음 |
| W2 | 웜업 10/5, 하루 최대 50: 0일째 10, 3일째 25, 8일째 50, 20일째 50 |
| W3 | 평일만 + 웜업: 금 → 월은 한 단계만 오름 |
| W4 | 정지 → 한도 0, `paused`, 다음 보낼 수 있는 날 시작으로 |
| W5 | 시간대 9~18: 08:59 → 09:00으로, 18:00 → 다음 날 09:00으로, 평일만이면 금 18:00 → 월 09:00 |
| W6 | 오늘 보낸 수 = 한도 → `daily_limit`, 다음 날 |
| W7 | 고르게: 9~18, 한도 54 → 간격 10분. 한도 600 → 간격 54초 (0이 되지 않음) |
| W8 | 간격 retryAt이 시간대 끝을 넘으면 다음 날 시작 |
| W9 | 묶음: 통과한 주소 중 가장 오래 쉰 주소 먼저, 전부 막히면 정지 아닌 주소의 가장 이른 시각 |
| W10 | 검증: 합친 값으로, `"false"`는 거짓, 시작만 바꿔 끝보다 늦어지면 오류, 웜업은 하루 최대 필요, 고르게는 시간대 필요 |
| W11 | 웜업 꺼짐 → 켜짐이면 시작일 = 오늘(KST), 00:30 KST에도 그날 |
| W12 | 결과 접기: failed > deferred > sent, 기존 문자열 그대로 |
| W13 | `nextStatus("defer") = pending` |
| W14 | 미룬 대기열 줄은 시도 횟수를 쓰지 않는다 (`planQueueRow`: 꺼낼 때 +1 → 미루면 -1, 0 아래로 안 감) |
| W15 | AI 첫 메일: 첫 규칙이 미뤄지면 뒤 규칙은 처리하지 않는다 |
| W16 | 후속: 첫 메일 주소로만, 막히면 check_at을 미룸 |
| W17 | 동시 예약 두 개가 한도를 넘지 않는다 (SQL 조건부 upsert) |
| W18 | 보내기 전 실패면 자리 반환, NHN 호출이 던지면 반환하지 않음 |
| W19 | 규칙 API: 다른 조직 주소 id는 400 |
| W20 | 수동 발송·AI 테스트 발송: 다른 조직 레코드는 조회되지 않는다 |
| W21 | (리뷰 뒤) 대기열: 앞 규칙 실패 + 뒤 규칙 미룸으로 시도를 다 쓰면 failed로 닫지 않고 실패 규칙만 빼서 retryAt에 미룬 규칙을 다시 한다. 뺀 규칙은 다시 돌리지 않는다 |
| W22 | (리뷰 뒤) 간격 미룸은 같은 묶음·같은 retryAt이면 순번 × 묶음 간격으로 펼친다 (주소 둘이 각자 10분이면 5분) |
| W23 | (리뷰 뒤) 워커 처리 중에 바로 보내는 경로가 미룬 요청은 skipped·failed로 끝내지 않고 그 시각에 다시 꺼낸다. sent면 다시 꺼내지 않는다 |
| W24 | (리뷰 뒤) 템플릿 규칙·수동 발송·템플릿 자동·템플릿 후속: 다른 조직 템플릿은 저장도 발송도 안 된다 |
| W25 | (리뷰 뒤) 한도가 켜진 주소와 같은 주소로 만들기·한도 켜진 프로필의 주소 바꾸기·지우기는 관리자만. 주소를 바꾸면 웜업 0일째부터 |
| W26 | (리뷰 뒤) 규칙 API 묶음 배열이 1000개를 넘으면 중복 제거 전에 거절한다 |
