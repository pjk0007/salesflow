# Design: alimtalk-followup-cron (알림톡 후속발송 cron + 시간 단위 + 동시성 안전장치)

> 참조 Plan: [docs/01-plan/features/alimtalk-followup-cron.plan.md](../../01-plan/features/alimtalk-followup-cron.plan.md)

## 1. 개요

알림톡 후속발송 시스템을 다음 4가지 축으로 재구축한다.

1. **외부 cron 등록** — `/api/alimtalk/automation/process-followups` 신규 + 매 10분 cron
2. **시간 단위 후속발송** — `delayDays + delayHours + delayMinutes` 하위호환 확장
3. **동시성 안전장치** — atomic 픽업, 좀비 청소, 멱등성, advisory lock, 타임아웃
4. **인덱스 + 처리량** — partial index 추가, 5건 병렬 + 1초 딜레이

기존 코드 영향 최소화를 위해 **`alimtalk-automation.ts`의 큐 처리부만 재작성**, 발송 단건 함수(`sendSingle`)는 멱등성 체크만 추가하고 그대로 유지.

## 2. DB 스키마 변경

### 2-1. `alimtalk_followup_queue` 인덱스 추가 (Drizzle)

```ts
// src/lib/db/schema.ts
export const alimtalkFollowupQueue = pgTable(
    "alimtalk_followup_queue",
    {
        id: serial("id").primaryKey(),
        parentLogId: integer("parent_log_id")
            .references(() => alimtalkSendLogs.id, { onDelete: "cascade" })
            .notNull(),
        templateLinkId: integer("template_link_id")
            .references(() => alimtalkTemplateLinks.id, { onDelete: "cascade" })
            .notNull(),
        orgId: uuid("org_id").notNull(),
        sendAt: timestamptz("send_at").notNull(),
        // status: 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled'
        status: varchar("status", { length: 20 }).default("pending").notNull(),
        processedAt: timestamptz("processed_at"),
        createdAt: timestamptz("created_at").defaultNow().notNull(),
    },
    (table) => ({
        // 신규: pending/processing만 인덱싱하는 partial index
        statusSendAtIdx: index("afq_status_send_at_idx")
            .on(table.status, table.sendAt)
            .where(sql`status IN ('pending', 'processing')`),
    })
);
```

### 2-2. 마이그레이션 SQL (`drizzle/{seq}_alimtalk_followup_idx.sql`)

```sql
CREATE INDEX IF NOT EXISTS afq_status_send_at_idx
ON alimtalk_followup_queue (status, send_at)
WHERE status IN ('pending', 'processing');
```

### 2-3. `followupConfig` 타입 확장 (`alimtalk_template_links.followup_config`)

기존 컬럼은 `jsonb`라 스키마 마이그레이션 불필요. **타입 정의만 확장**.

```ts
// src/lib/db/schema.ts (alimtalkTemplateLinks 정의 내)
followupConfig: jsonb("followup_config").$type<{
    // 하위 호환: 기존 데이터는 delayDays만 갖고 있음
    delayDays?: number;
    // 신규
    delayHours?: number;
    delayMinutes?: number;
    templateCode: string;
    templateName?: string;
    variableMappings?: Record<string, string>;
} | null>(),
```

## 3. 큐 처리 로직 재작성

대상 파일: [src/lib/alimtalk-automation.ts](../../../src/lib/alimtalk-automation.ts)

### 3-1. 큐 등록 헬퍼 신규 (delay 계산 통일)

기존 `processAutoTrigger` 안에서 직접 `delayDays * 24 * 60 * 60 * 1000` 계산하던 부분을 헬퍼로 분리:

```ts
function computeFollowupSendAt(
    baseAt: Date,
    config: {
        delayDays?: number;
        delayHours?: number;
        delayMinutes?: number;
    }
): Date {
    const totalMs =
        (config.delayDays ?? 0) * 86_400_000 +
        (config.delayHours ?? 0) * 3_600_000 +
        (config.delayMinutes ?? 0) * 60_000;

    // 안전장치: 0이면 기본 1일 (delayDays=1과 동일)
    const finalMs = totalMs > 0 ? totalMs : 86_400_000;
    return new Date(baseAt.getTime() + finalMs);
}
```

`processAutoTrigger` 후속발송 큐 등록부 수정:

```ts
// before: const sendAt = new Date(Date.now() + config.delayDays * 24 * 60 * 60 * 1000);
const sendAt = computeFollowupSendAt(new Date(), config);
```

### 3-2. `processAlimtalkFollowupQueue` 전면 재작성

```ts
const FOLLOWUP_CRON_LOCK_KEY = 0x4f57a70b; // alimtalk-followup advisory lock 전용 키 (고정 정수 상수)
const PICKUP_LIMIT = 5000;
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1000;
const ZOMBIE_THRESHOLD_MS = 10 * 60 * 1000; // 10분
const PROCESS_TIMEOUT_MS = 8 * 60 * 1000;   // 8분
const IDEMPOTENCY_WINDOW_MS = 60 * 60 * 1000; // 1시간

export async function processAlimtalkFollowupQueue(): Promise<{
    processed: number;
    sent: number;
    failed: number;
    skipped: number;
    skippedAsLocked?: boolean;
}> {
    const stats = { processed: 0, sent: 0, failed: 0, skipped: 0 };

    // [1] advisory lock 획득 (cron 겹침 방지)
    // 주의: drizzle-orm + postgres-js 조합에서 db.execute()는 row 배열을 직접 반환 (.rows 아님)
    const lockResult = await db.execute<{ acquired: boolean }>(
        sql`SELECT pg_try_advisory_lock(${FOLLOWUP_CRON_LOCK_KEY}) AS acquired`
    );
    const acquired = lockResult[0]?.acquired === true;
    if (!acquired) {
        return { ...stats, skippedAsLocked: true };
    }

    const startTime = Date.now();

    try {
        // [2] 좀비 청소: 10분 이상 processing 상태 → pending 복구
        const zombieCutoff = new Date(Date.now() - ZOMBIE_THRESHOLD_MS);
        await db.update(alimtalkFollowupQueue)
            .set({ status: "pending" })
            .where(and(
                eq(alimtalkFollowupQueue.status, "processing"),
                lte(alimtalkFollowupQueue.processedAt, zombieCutoff),
            ));

        // [3] atomic 픽업: pending → processing (LIMIT + SKIP LOCKED)
        // 반환 row는 snake_case 컬럼이므로, 이후 처리에서 camelCase로 매핑 필요
        const items = await db.execute<{
            id: number;
            parent_log_id: number;
            template_link_id: number;
            org_id: string;
            send_at: Date;
            status: string;
            processed_at: Date | null;
            created_at: Date;
        }>(sql`
            UPDATE alimtalk_followup_queue
            SET status = 'processing', processed_at = NOW()
            WHERE id IN (
                SELECT id FROM alimtalk_followup_queue
                WHERE status = 'pending' AND send_at <= NOW()
                ORDER BY send_at ASC
                LIMIT ${PICKUP_LIMIT}
                FOR UPDATE SKIP LOCKED
            )
            RETURNING *
        `);
        if (items.length === 0) return stats;

        // [4] 5건 병렬 + 1초 딜레이 배치 처리
        for (let i = 0; i < items.length; i += BATCH_SIZE) {
            // 타임아웃 가드
            if (Date.now() - startTime > PROCESS_TIMEOUT_MS) {
                console.warn(
                    `[alimtalk-followup] timeout at batch ${i}/${items.length}, deferring`
                );
                // 남은 항목은 좀비 복구 사이클로 다음 cron이 회수
                break;
            }

            const batch = items.slice(i, i + BATCH_SIZE);
            const results = await Promise.allSettled(
                batch.map((item) => processFollowupItem(item, stats))
            );
            for (const r of results) {
                if (r.status === "rejected") {
                    console.error("[alimtalk-followup] batch error:", r.reason);
                }
            }

            if (i + BATCH_SIZE < items.length) {
                await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
            }
        }

        return stats;
    } finally {
        // [5] advisory lock 해제 (반드시 finally)
        await db.execute(sql`SELECT pg_advisory_unlock(${FOLLOWUP_CRON_LOCK_KEY})`);
    }
}
```

### 3-3. 단건 처리 함수 신규 (`processFollowupItem`)

```ts
async function processFollowupItem(
    item: typeof alimtalkFollowupQueue.$inferSelect,
    stats: { processed: number; sent: number; failed: number; skipped: number }
): Promise<void> {
    stats.processed++;

    try {
        // [1] 부모 로그 → record 조회
        const [parentLog] = await db
            .select({ recordId: alimtalkSendLogs.recordId })
            .from(alimtalkSendLogs)
            .where(eq(alimtalkSendLogs.id, item.parentLogId));

        if (!parentLog?.recordId) {
            await closeQueueItem(item.id, "failed");
            stats.failed++;
            return;
        }

        // [2] 링크 + followupConfig 조회
        const [link] = await db
            .select()
            .from(alimtalkTemplateLinks)
            .where(eq(alimtalkTemplateLinks.id, item.templateLinkId));

        if (!link?.followupConfig) {
            await closeQueueItem(item.id, "failed");
            stats.failed++;
            return;
        }

        // [3] 멱등성 체크: 같은 record + link + followup이 직전 1시간 내 발송됐으면 skip
        const idempotencyCutoff = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS);
        const [recentSent] = await db.select({ id: alimtalkSendLogs.id })
            .from(alimtalkSendLogs)
            .where(and(
                eq(alimtalkSendLogs.recordId, parentLog.recordId),
                eq(alimtalkSendLogs.templateLinkId, link.id),
                eq(alimtalkSendLogs.triggerType, "followup"),
                gte(alimtalkSendLogs.sentAt, idempotencyCutoff),
                inArray(alimtalkSendLogs.status, ["sent", "pending"]),
            )).limit(1);

        if (recentSent) {
            // 이미 발송됨 — 큐만 닫고 skip
            await closeQueueItem(item.id, "sent");
            stats.skipped++;
            return;
        }

        // [4] 레코드 조회
        const [record] = await db
            .select()
            .from(records)
            .where(eq(records.id, parentLog.recordId));

        if (!record) {
            await closeQueueItem(item.id, "failed");
            stats.failed++;
            return;
        }

        // [5] 후속발송용 링크 가공 (templateCode, mappings 교체)
        const config = link.followupConfig as {
            templateCode: string;
            templateName?: string;
            variableMappings?: Record<string, string>;
        };
        const followupLink = {
            ...link,
            templateCode: config.templateCode,
            templateName: config.templateName || null,
            variableMappings: config.variableMappings || link.variableMappings,
        };

        // [6] 발송
        const logId = await sendSingle(followupLink, record, item.orgId, "followup");
        await closeQueueItem(item.id, logId ? "sent" : "failed");

        if (logId) stats.sent++;
        else stats.failed++;
    } catch (err) {
        console.error(`[alimtalk-followup] item ${item.id} error:`, err);
        await closeQueueItem(item.id, "failed");
        stats.failed++;
    }
}

async function closeQueueItem(id: number, status: "sent" | "failed") {
    await db.update(alimtalkFollowupQueue)
        .set({ status, processedAt: new Date() })
        .where(eq(alimtalkFollowupQueue.id, id));
}
```

### 3-4. 변경 영향 정리

| 함수 | 상태 | 비고 |
|---|---|---|
| `processAlimtalkFollowupQueue` | **재작성** | 기존 시그니처 유지(반환 타입에 `skipped` 추가) |
| `processFollowupItem` | **신규 추출** | 기존 inline 처리부에서 분리 + 멱등성 추가 |
| `computeFollowupSendAt` | **신규 헬퍼** | delay 계산 통일 |
| `closeQueueItem` | **신규 헬퍼** | 큐 마무리 update 단축 |
| `sendSingle` | **변경 없음** | 그대로 사용 |
| `processAutoTrigger` | **부분 수정** | 큐 등록부에서 헬퍼 호출 |
| `evaluateCondition` | **변경 없음** | |
| `processRepeatQueue` | **변경 없음** | (별도 plan에서 동일 안전장치 추가 가능) |

## 4. API 엔드포인트

### 4-1. 신규: `POST /api/alimtalk/automation/process-followups`

`process-repeats` 패턴 그대로 복제:

```ts
// src/app/api/alimtalk/automation/process-followups/route.ts
import { NextRequest, NextResponse } from "next/server";
import { processAlimtalkFollowupQueue } from "@/lib/alimtalk-automation";

export async function POST(req: NextRequest) {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
        return NextResponse.json(
            { success: false, error: "CRON_SECRET이 설정되지 않았습니다." },
            { status: 500 }
        );
    }

    const token =
        req.headers.get("x-secret") ||
        req.headers.get("authorization")?.replace("Bearer ", "") ||
        req.nextUrl.searchParams.get("secret");

    if (token !== cronSecret) {
        return NextResponse.json(
            { success: false, error: "인증에 실패했습니다." },
            { status: 401 }
        );
    }

    try {
        const result = await processAlimtalkFollowupQueue();
        return NextResponse.json({ success: true, data: result });
    } catch (error) {
        console.error("Process alimtalk followups error:", error);
        return NextResponse.json(
            { success: false, error: "처리에 실패했습니다." },
            { status: 500 }
        );
    }
}
```

### 4-2. 삭제: `GET /api/cron/alimtalk-followup`

[src/app/api/cron/alimtalk-followup/route.ts](../../../src/app/api/cron/alimtalk-followup/route.ts) 파일 삭제.

이미 외부 cron에 등록된 적 없는 dead route. 삭제 안전.

## 5. UI 변경

### 5-1. 후속발송 폼 (시간 단위 추가)

대상 페이지:
- [src/app/alimtalk/links/new/page.tsx](../../../src/app/alimtalk/links/new/page.tsx)
- [src/app/alimtalk/links/[id]/page.tsx](../../../src/app/alimtalk/links/[id]/page.tsx)

**현재 상태**: `followupDelayDays: number` state 1개 + 입력 필드 1개 (일 단위만)

**변경**: 단위 선택 + 숫자 입력 패턴

```
┌─ 후속발송 ──────────────────────────────────────┐
│ ☑ 후속발송 사용                                  │
│                                                  │
│ 발송 지연:  [  3  ] [시간 ▾]                     │
│                       ├─ 분                      │
│                       ├─ 시간 (기본)             │
│                       └─ 일                      │
│                                                  │
│ 후속 템플릿:  [드롭다운: 후속용 템플릿 선택]     │
│ 변수 매핑:   ...                                 │
└──────────────────────────────────────────────────┘
```

#### 상태 정의

```tsx
const [useFollowup, setUseFollowup] = useState(false);
const [followupDelayValue, setFollowupDelayValue] = useState<number>(1);
const [followupDelayUnit, setFollowupDelayUnit] =
    useState<"minutes" | "hours" | "days">("days"); // 기본 "days" (하위호환)
```

#### followupConfig 빌드

```ts
const followupConfig = useFollowup && followupTemplateCode ? {
    ...(followupDelayUnit === "minutes" && { delayMinutes: followupDelayValue }),
    ...(followupDelayUnit === "hours" && { delayHours: followupDelayValue }),
    ...(followupDelayUnit === "days" && { delayDays: followupDelayValue }),
    templateCode: followupTemplateCode,
    templateName: followupTemplates.find(t => t.templateCode === followupTemplateCode)?.templateName,
    ...(Object.keys(followupVariableMappings).length > 0 && {
        variableMappings: followupVariableMappings,
    }),
} : null;
```

#### 기존 데이터 로드 (edit 페이지)

```ts
// 기존: followupConfig.delayDays만 존재
// 신규: delayHours / delayMinutes도 가능
useEffect(() => {
    if (link?.followupConfig) {
        const cfg = link.followupConfig as {
            delayDays?: number;
            delayHours?: number;
            delayMinutes?: number;
            templateCode: string;
        };

        if (cfg.delayMinutes != null) {
            setFollowupDelayUnit("minutes");
            setFollowupDelayValue(cfg.delayMinutes);
        } else if (cfg.delayHours != null) {
            setFollowupDelayUnit("hours");
            setFollowupDelayValue(cfg.delayHours);
        } else {
            setFollowupDelayUnit("days");
            setFollowupDelayValue(cfg.delayDays ?? 1);
        }
        // ... 나머지 필드 ...
    }
}, [link]);
```

### 5-2. 리스트 표시 (`AlimtalkTemplateLinkList.tsx`)

현재 `{delayDays}일 후` 만 표시. 단위별 라벨링 추가:

```tsx
function formatFollowupDelay(cfg: {
    delayDays?: number;
    delayHours?: number;
    delayMinutes?: number;
}): string {
    if (cfg.delayMinutes != null) return `${cfg.delayMinutes}분 후`;
    if (cfg.delayHours != null) return `${cfg.delayHours}시간 후`;
    if (cfg.delayDays != null) return `${cfg.delayDays}일 후`;
    return "—";
}

// 사용처
{link.followupConfig ? (
    <Badge variant="secondary">
        {formatFollowupDelay(link.followupConfig as ...)}
    </Badge>
) : ...}
```

## 6. 외부 cron 등록 (운영 작업)

클라우드타입 스케줄러에 추가:

| 항목 | 값 |
|---|---|
| 이름 | 알림톡 후속 발송 |
| 메서드 | POST |
| URL | `https://salesflow.kr/api/alimtalk/automation/process-followups` |
| Cron | `0 */10 * * * *` |
| X-Secret | `(CRON_SECRET 환경변수 값)` |

기존 `알림톡 반복 발송` cron의 `X-Secret`(`sf_cron_a7x9k2m4p8q1w3e6`) 동일값 사용.

## 7. 구현 순서 (Phase별)

### Phase 1: 인프라 (1~2시간)
1. `drizzle/{seq}_alimtalk_followup_idx.sql` 마이그레이션 작성
2. `schema.ts` 인덱스 정의 추가 + `followupConfig` 타입 확장
3. 로컬 DB 마이그레이션 적용 + 검증

### Phase 2: 큐 처리 로직 (2~3시간)
1. `computeFollowupSendAt` 헬퍼 추가
2. `closeQueueItem` 헬퍼 추가
3. `processFollowupItem` 신규 함수 추출 + 멱등성 체크 추가
4. `processAlimtalkFollowupQueue` 전면 재작성
5. `processAutoTrigger` 큐 등록부에서 헬퍼 호출로 변경

### Phase 3: API 엔드포인트 (30분)
1. `POST /api/alimtalk/automation/process-followups` 신규 작성 (process-repeats 복제)
2. `GET /api/cron/alimtalk-followup` 삭제

### Phase 4: 시간 단위 UI (1~2시간)
1. `links/new/page.tsx` 후속발송 폼 — state + 단위 선택 + followupConfig 빌드
2. `links/[id]/page.tsx` 후속발송 폼 — 동일 + 기존 데이터 로드 로직
3. `AlimtalkTemplateLinkList.tsx` `formatFollowupDelay` 헬퍼 적용

### Phase 5: 운영 (사용자 작업)
1. 클라우드타입 스케줄러 등록 (운영 배포 후)
2. 검증 SQL 실행

## 8. 테스트 시나리오

### 8-1. 단위 동작
- [ ] 분 단위 후속발송 (5분)
- [ ] 시간 단위 후속발송 (3시간)
- [ ] 일 단위 후속발송 (1일) — 기존 동작 회귀 확인
- [ ] 기존 데이터(`{delayDays: 1}` 만 있음) 로드 및 발송

### 8-2. 동시성
- [ ] cron 중복 호출 시 advisory lock으로 두 번째 즉시 종료
- [ ] processing 10분 초과 → 다음 cron이 좀비 복구
- [ ] 좀비 복구 후 재처리 시 멱등성 체크로 NHN 중복 발송 방지

### 8-3. 부하
- [ ] 큐 5,000건 적재 후 cron 실행 — 8분 안에 완료 또는 타임아웃 후 다음 cron 회수
- [ ] 큐 비어있을 때 cron 호출 — 1ms 내 종료 (인덱스 효과)

### 8-4. 검증 SQL

```sql
-- 큐 상태 분포
SELECT status, COUNT(*) FROM alimtalk_followup_queue GROUP BY status;

-- 멱등성 위반 확인 (직전 1시간 내 같은 (record, link) 후속이 2건 이상이면 위반)
SELECT record_id, template_link_id, COUNT(*)
FROM alimtalk_send_logs
WHERE trigger_type = 'followup'
  AND sent_at >= NOW() - INTERVAL '1 hour'
GROUP BY record_id, template_link_id
HAVING COUNT(*) > 1;

-- 좀비 잔존 확인 (10분 이상 processing이면 좀비)
SELECT id, status, processed_at, send_at
FROM alimtalk_followup_queue
WHERE status = 'processing'
  AND processed_at < NOW() - INTERVAL '10 minutes';
```

## 9. 트레이드오프

### 9-1. 멱등성 윈도우 1시간
- 너무 짧으면: 좀비 복구 후 1시간 지나면 중복 발송 가능
- 너무 길면: 같은 사용자에게 의도된 후속발송이 차단됨 (1일 단위 후속을 1시간마다 다시 보내려는 케이스 등)
- **결정**: 1시간 (현재 알림톡 후속발송 최단 단위가 분/시간임을 고려, 1시간 이내 같은 후속은 중복으로 간주)
- 향후 `followupConfig`에 `idempotencyWindowMinutes` 옵션 추가 가능

### 9-2. advisory lock 키 충돌
- 32비트 정수 1개 사용 (`0x4f57a70b`)
- `pg_try_advisory_lock(bigint)` 시그니처 사용 (단일 인자)
- 다른 cron(`processRepeatQueue` 등)과 키가 다르면 OK
- 본 작업은 단일 상수만 사용하지만, 다른 cron에 동일 패턴 추가 시 `lib/db/locks.ts` 같은 파일에 상수 모아 키 충돌 방지 권장
- `hashtext()` 미사용 사유: 정수 상수가 결정론적이고 가독성 명확

### 9-3. 시간 단위 후속발송 야간 차단
- 새벽 3시 발송 같은 케이스 — NHN 정책상 0~8시 알림톡 발송 제한 가능
- **이번 plan에는 포함 안 함**. 별도 plan(`alimtalk-night-block.plan.md`)으로 분리
- 임시 가이드: UI 안내 문구 "야간 발송 시 NHN 정책에 의해 지연될 수 있습니다"

## 10. 회귀 위험

| 위험 | 완화 |
|---|---|
| 기존 `delayDays` 데이터 로드 실패 | 하위호환: `delayDays`를 그대로 읽음, UI도 `days`를 기본 단위로 |
| 기존 `processAutoTrigger` 큐 등록 동작 변경 | 헬퍼만 추가하고 로직 동일 (`delayDays * 24h` = `computeFollowupSendAt({delayDays})`) |
| 좀비 복구 후 NHN 중복 발송 | 멱등성 체크로 차단 (FR-05-3) |
| advisory lock 미해제로 영구 잠김 | `try/finally`로 항상 해제 |
| 인덱스 마이그레이션 실패 | `IF NOT EXISTS` 사용, 실패해도 픽업 쿼리는 동작(느릴 뿐) |

## 11. Out of Scope (이번 작업 제외)

- 이메일 후속발송의 동시성 결함 보강 — **별도 plan** (`email-followup-concurrency-fix.plan.md`)
- 발송 완료된 큐 항목 정리 cron — **별도 plan**
- 야간 발송 차단 정책 — **별도 plan**
- `processRepeatQueue`의 동일 안전장치 적용 — **별도 plan** 또는 후속 작업
