# Plan: alimtalk-followup-cron (알림톡 후속발송 cron 등록 + 시간 단위 확장 + 동시성 안전장치)

## 배경

현재 알림톡 자동발송 흐름:

1. 레코드 생성/수정 시 `processAutoTrigger`가 즉시 알림톡 발송 (`triggerType: "auto"`) — **정상 동작**
2. `followupConfig`가 설정된 경우, `alimtalk_followup_queue` 테이블에 `sendAt = 발송시각 + delayDays` 로 큐 등록
3. 큐 픽업 cron이 `sendAt <= now` 인 pending 항목을 발송

**문제**: 3번을 호출하는 외부 cron이 등록되어 있지 않아 후속발송이 영영 발송되지 않음. 추가로 시간 단위 후속발송 미지원, 동시성 안전장치 없음, 인덱스 없음 등 구조적 결함 다수.

## 팀장 확인 결과 (2026-04-28)

> 샌드비에 알림톡 예약발송 기능을 넣은 기억이 없네요. 아마 개발해서 추가해야할 것 같아요.
> cron도 이메일처럼 추가해주시면 되지 않을까 싶어요.

→ NHN 측 예약발송으로 처리되는 게 아니라, **자체 cron 누락이 원인** 확정.

## 추가 요구사항 (2026-04-28 발견)

### 시 단위 후속발송 필요

요청 케이스: **"레코드 생성 시 안내 발송 + 3시간 뒤 쿠폰 발송"**

현재 구조는 `delayDays: number` 필드만 존재 → 일 단위만 가능. 3시간 후속발송 불가능.

### 다조직 멀티 테넌트 부하 우려

조직(org)이 늘어나면서 후속발송 큐가 누적될 가능성. cron 1회당 처리량 한계와 DB 부담 고려 필요.

### 동시 실행 / 중복 발송 위험

cron 처리 시간이 cron 주기를 넘기거나, 픽업 후 발송 중 프로세스 종료 시 NHN 중복 발송 가능. 현재 코드는 멱등성 보장 없음.

## 현재 구조 분석

### 코드 위치

- 큐 처리 로직: [src/lib/alimtalk-automation.ts](src/lib/alimtalk-automation.ts) — `processAlimtalkFollowupQueue` (line 367~)
- 큐 등록 로직: 같은 파일 `processAutoTrigger` 내부 (line 220-230)
- 기존 (미사용) cron 엔드포인트: [src/app/api/cron/alimtalk-followup/route.ts](src/app/api/cron/alimtalk-followup/route.ts) — GET + ?token=
- 참고 패턴 (이메일): [src/app/api/email/automation/process-followups/route.ts](src/app/api/email/automation/process-followups/route.ts) — POST + x-secret
- 스키마: [src/lib/db/schema.ts](src/lib/db/schema.ts) — `alimtalkFollowupQueue` (인덱스 없음 ❗)

### 결함 요약

| 항목 | 현재 | 문제 |
|---|---|---|
| 외부 cron | 미등록 | 후속발송 절대 안 나감 |
| 시간 단위 | `delayDays`만 | 3시간 후속 불가 |
| 인덱스 | 없음 | 큐 누적 시 풀스캔 |
| 픽업 atomic | UPDATE 분리 | 동시 cron이면 중복 픽업 |
| 멱등성 | 없음 | 프로세스 kill → NHN 중복 발송 |
| 좀비 처리 | 없음 | 처리 중 끊기면 영구 pending |
| 타임아웃 | 없음 | cron 겹침 가능 |

## 요구사항

### FR-01. 후속발송 cron 엔드포인트 통일

이메일과 동일한 패턴으로 신규 엔드포인트 추가:

- **신규**: `POST /api/alimtalk/automation/process-followups`
- **인증**: `x-secret` 헤더 (또는 Bearer / `?secret=` 쿼리스트링)
- **처리 함수**: 기존 `processAlimtalkFollowupQueue` 재사용 (단, 내부 로직 보강)

### FR-02. 시간 단위 후속발송 지원

스키마/타입 확장:

```ts
interface FollowupConfig {
    // 기존 (하위 호환 유지)
    delayDays?: number;
    // 신규
    delayHours?: number;   // 시간 단위
    delayMinutes?: number; // 분 단위 (선택)
    templateCode: string;
    templateName?: string;
    variableMappings?: Record<string, string>;
}
```

큐 등록 시 계산식 통일:

```ts
const totalMs =
    (config.delayDays ?? 0) * 86400000 +
    (config.delayHours ?? 0) * 3600000 +
    (config.delayMinutes ?? 0) * 60000;
const sendAt = new Date(sentAt.getTime() + totalMs);
```

UI: 후속발송 설정 폼에 단위 선택(일/시/분) + 숫자 입력. **기본 단위는 "일"** (기존 사용자 혼란 방지).

### FR-03. 외부 cron 등록 (클라우드타입 스케줄러)

| 항목 | 값 | 이유 |
|---|---|---|
| 이름 | 알림톡 후속 발송 | |
| 메서드 | POST | 이메일 패턴 동일 |
| URL | `https://salesflow.kr/api/alimtalk/automation/process-followups` | |
| Cron | `0 */10 * * * *` (**매 10분**) | 시간 단위 후속발송 정밀도 + NHN 부하 분산 |
| X-Secret | `CRON_SECRET` (env) | |

**왜 매 10분인가**:
- 정밀도: 3시간 후속발송 시 최대 10분 오차 (정각 cron은 60분 오차)
- 부하 분산: 정각 cron은 모든 조직의 후속발송이 정각에 NHN으로 spike → 매 10분이 평탄
- 운영 일관성: 위들리 알림톡 cron(`0 */10 * * * *`)과 동일 패턴 → 학습비용 0
- DB 부하: 인덱스만 있으면 빈 큐 체크는 1ms 미만 → 144회/일 호출도 사실상 0

**왜 정각/매일이 아닌가**:
- 매일 9시 1회: 시간 단위 후속발송 자체가 작동 안 함 (24시간 오차)
- 정각 1회: NHN 발송 spike 위험 + 사용자 동시 도달이 부자연스러움 + 정밀도 부족

### FR-04. 인덱스 추가 (필수)

```sql
CREATE INDEX alimtalk_fq_pending_send_at_idx
ON alimtalk_followup_queue (status, send_at)
WHERE status IN ('pending', 'processing');
```

partial index로 인덱스 크기 최소화. 풀스캔 제거 → 큐 100만 건 누적 시에도 픽업 쿼리 1ms 미만.

### FR-05. 동시성 안전장치 (핵심)

#### 5-1. 픽업 atomic화: status `processing` 도입

기존: SELECT pending → 처리 → UPDATE status (atomic 아님 → 중복 픽업 가능)

변경: **UPDATE ... RETURNING** 으로 한 번에 픽업 + status 변경

```ts
// 픽업 (atomic)
const items = await db.execute(sql`
    UPDATE alimtalk_followup_queue
    SET status = 'processing', processed_at = NOW()
    WHERE id IN (
        SELECT id FROM alimtalk_followup_queue
        WHERE status = 'pending' AND send_at <= NOW()
        ORDER BY send_at ASC
        LIMIT 5000
        FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
`);
```

`FOR UPDATE SKIP LOCKED`로 동시 cron 인스턴스가 동일 row를 픽업하지 못하게 방어.

#### 5-2. 좀비 청소 (선행 단계로 cron 시작 시 실행)

```ts
// processing 상태가 10분 이상 지속되면 좀비 → pending으로 복구
await db.update(alimtalkFollowupQueue)
    .set({ status: "pending" })
    .where(and(
        eq(alimtalkFollowupQueue.status, "processing"),
        lte(alimtalkFollowupQueue.processedAt, tenMinutesAgo),
    ));
```

**위험**: 좀비 복구 → 다음 cron 픽업 → NHN 중복 발송 가능. 5-3로 방어.

#### 5-3. 멱등성 체크 (NHN 발송 직전)

```ts
// 발송 직전: 같은 record + templateLink + triggerType=followup 발송 이력 확인
const [recentSent] = await db.select({ id: alimtalkSendLogs.id })
    .from(alimtalkSendLogs)
    .where(and(
        eq(alimtalkSendLogs.recordId, record.id),
        eq(alimtalkSendLogs.templateLinkId, link.id),
        eq(alimtalkSendLogs.triggerType, "followup"),
        gte(alimtalkSendLogs.sentAt, since),  // 직전 1시간 등
    )).limit(1);

if (recentSent) {
    await db.update(alimtalkFollowupQueue)
        .set({ status: "sent", processedAt: new Date() })
        .where(eq(alimtalkFollowupQueue.id, item.id));
    continue; // 이미 발송됨, 큐만 닫고 skip
}
```

이걸로 좀비 복구 시 발생할 수 있는 NHN 중복 발송 차단.

#### 5-4. cron 동시 실행 방어 (advisory lock)

```ts
const [{ acquired }] = await db.execute(sql`
    SELECT pg_try_advisory_lock(hashtext('alimtalk-followup-cron')) as acquired
`);
if (!acquired) {
    return { skipped: true, reason: "another instance running" };
}
try {
    // ... 처리 ...
} finally {
    await db.execute(sql`SELECT pg_advisory_unlock(hashtext('alimtalk-followup-cron'))`);
}
```

이전 cron이 아직 처리 중이면 다음 cron은 즉시 종료. 겹침 방지.

#### 5-5. 타임아웃 보호 (8분)

```ts
const TIMEOUT_MS = 8 * 60 * 1000;
const startTime = Date.now();
for (const batch of batches) {
    if (Date.now() - startTime > TIMEOUT_MS) {
        console.warn("[alimtalk-followup] timeout, deferring rest to next cron");
        break;
    }
    // ... 배치 처리 ...
}
```

처리되지 못한 항목은 다음 cron(2분 후)이 이어서 처리.

### FR-06. 처리량 확보 (대규모 조직 대응)

이메일 패턴 채택 (`email-followup.ts:96-113`):

```ts
const BATCH_SIZE = 5;          // 5건 병렬
const BATCH_DELAY_MS = 1000;   // 배치 간 1초 (NHN rate limit 보호)
```

처리량 추정:
- 5건/초 = 300건/분
- cron 8분 처리: 최대 2,400건/cron
- 일일: 2,400 × 144 = **약 34만 건/일**
- 조직당 50건/일 가정 시 → **약 6,800개 조직 커버**

이 이상 가면 별도 plan(샤딩, 큐 시스템 도입 등) 필요. 현재 단계에선 충분.

### FR-07. 발송 완료 항목 보존 정책

큐 테이블이 시간이 지나면 비대해짐. 별도 cron으로 30일 이상 지난 `sent`/`failed` 항목 정리:

- **이번 plan에는 포함하지 않음** (별도 plan으로 분리)
- 다만 `idx_alimtalk_followup_queue_status_send_at` partial index가 `pending`/`processing`만 인덱싱하므로 `sent` 항목이 늘어나도 **픽업 쿼리 성능에는 영향 없음**

### FR-08. 기존 GET 엔드포인트 처리

`/api/cron/alimtalk-followup` (GET + ?token=) 은 외부 cron에 등록된 적 없는 dead route. 신규 엔드포인트 만든 후 **삭제**.

## 작업 항목

### Phase 1: 인프라
- [ ] `alimtalk_followup_queue` 인덱스 마이그레이션 (`status, send_at` partial)
- [ ] 스키마 status enum 확장: `pending | processing | sent | failed | cancelled`

### Phase 2: 큐 처리 로직 보강 (`processAlimtalkFollowupQueue` 재작성)
- [ ] 좀비 청소 (cron 시작 시)
- [ ] advisory lock 획득
- [ ] atomic 픽업 (`UPDATE ... RETURNING ... FOR UPDATE SKIP LOCKED`)
- [ ] 5건 병렬 + 1초 딜레이 배치 처리
- [ ] 멱등성 체크 (NHN 발송 직전)
- [ ] 타임아웃 8분 보호
- [ ] advisory lock 해제 (finally)

### Phase 3: API 엔드포인트
- [ ] `POST /api/alimtalk/automation/process-followups` 신규
- [ ] `GET /api/cron/alimtalk-followup` 삭제

### Phase 4: 시간 단위 후속발송
- [ ] `FollowupConfig` 타입에 `delayHours`, `delayMinutes` 추가
- [ ] 큐 등록 계산식 통일
- [ ] UI: 일/시/분 단위 선택 드롭다운 (`AlimtalkLinkForm` 또는 동등 컴포넌트)

### Phase 5: 운영 작업
- [ ] 클라우드타입 스케줄러에 cron 등록 (`0 */10 * * * *`)
- [ ] 운영 검증 SQL 가이드 문서화

## 검증 방법

```sql
-- cron 등록 전: 후속발송 설정된 링크 / 후속 트리거 발송 이력 확인
SELECT id, name, followup_config FROM alimtalk_template_links
WHERE followup_config IS NOT NULL;

SELECT trigger_type, COUNT(*) FROM alimtalk_send_logs GROUP BY trigger_type;

-- cron 등록 후 검증
SELECT status, COUNT(*) FROM alimtalk_followup_queue GROUP BY status;

SELECT id, status, send_at, processed_at, created_at
FROM alimtalk_followup_queue
ORDER BY created_at DESC LIMIT 20;

-- 멱등성 검증: 같은 (recordId, templateLinkId, followup) 가 여러 번 안 들어갔는지
SELECT record_id, template_link_id, COUNT(*)
FROM alimtalk_send_logs
WHERE trigger_type = 'followup'
GROUP BY record_id, template_link_id
HAVING COUNT(*) > 1;
```

## 우려 사항 / 결정 필요

- [ ] `delayHours` UI 노출 시 NHN 발송 정책상 야간(22~08시) 발송 차단 정책 적용 여부
- [ ] 멱등성 체크 시 "직전 N시간" 윈도우 — 1시간? 동일 후속발송 1회만 보장하려면 더 넓혀야 할 수도
- [ ] 이메일 후속발송도 동일한 동시성 결함 있음 — 별도 plan으로 분리 (`email-followup-concurrency-fix.plan.md`)

## 우선순위

**높음** — 후속발송이 실제로 작동하지 않는 기능 결손 + 동시성 위험. 사용자 신뢰 직결.

## 영향 범위

| 영역 | 변경 |
|---|---|
| DB | 인덱스 추가, status enum 확장 |
| API | 신규 1개, 삭제 1개 |
| 라이브러리 | `alimtalk-automation.ts` 큐 처리부 전면 재작성 |
| UI | 후속발송 설정 폼 단위 선택 추가 |
| 운영 | cron 1개 신규 등록 |
| 호환성 | 기존 `delayDays` 필드 하위 호환 유지 |
