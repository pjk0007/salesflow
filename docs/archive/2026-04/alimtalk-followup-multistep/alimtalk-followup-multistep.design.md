# Design: alimtalk-followup-multistep (알림톡 후속발송 다단계 체인)

> 참조 Plan: [docs/01-plan/features/alimtalk-followup-multistep.plan.md](../../01-plan/features/alimtalk-followup-multistep.plan.md)

## 1. 개요

알림톡 후속발송을 **N단계 체인**으로 확장한다. 이메일 후속발송(`email-followup.ts`)이 이미 동일 패턴으로 동작 중이므로, 그 구조를 알림톡에 맞춰 단순화하여 적용한다.

**핵심 흐름**:
```
자동발송(auto)
    ↓ delay[0]
후속1(followup, step=0)
    ↓ delay[1]
후속2(followup, step=1)
    ↓ delay[2]
후속N(followup, step=N-1)
```

이메일 후속발송과의 차이:
- **읽음 분기 미지원** (NHN 알림톡은 읽음 추적 불가)
- **AI 생성 미지원** (템플릿 기반만)

## 2. DB 스키마 변경

### 2-1. `alimtalk_followup_queue` 에 `step_index` 추가

```ts
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
        status: varchar("status", { length: 20 }).default("pending").notNull(),
        // 신규
        stepIndex: integer("step_index").default(0).notNull(),
        processedAt: timestamptz("processed_at"),
        createdAt: timestamptz("created_at").defaultNow().notNull(),
    },
    (table) => ({
        // 기존 인덱스 유지
        // 신규: 같은 parent_log + step_index 조합 중복 방지
        parentLogStepIdx: uniqueIndex("alfq_parent_log_step_idx")
            .on(table.parentLogId, table.stepIndex),
    })
);
```

### 2-2. `alimtalk_send_logs` 에 `step_index` 추가

체인 추적과 멱등성 체크에 사용.

```ts
export const alimtalkSendLogs = pgTable("alimtalk_send_logs", {
    // ... 기존 컬럼 ...
    triggerType: varchar("trigger_type", { length: 30 }),
    // 신규: 후속발송 시 단계 (auto는 0, followup step N은 N+1)
    stepIndex: integer("step_index").default(0).notNull(),
    // ... 기존 컬럼 ...
});
```

**의미**:
- `triggerType = "auto"` → `stepIndex = 0` (자동발송이 0단계)
- `triggerType = "followup"` → `stepIndex` 는 후속의 단계 번호 (1, 2, 3, ...)

> 또는 followup만 1부터 카운트하는 컨벤션 (auto는 항상 0). **후자 채택** — auto와 followup의 step 의미가 다르므로 명확히 분리.

### 2-3. 마이그레이션 SQL (`drizzle/{seq}_alimtalk_followup_multistep.sql`)

```sql
-- alimtalk_followup_queue: step_index
ALTER TABLE alimtalk_followup_queue
ADD COLUMN IF NOT EXISTS step_index integer DEFAULT 0 NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS alfq_parent_log_step_idx
ON alimtalk_followup_queue (parent_log_id, step_index);

-- alimtalk_send_logs: step_index
ALTER TABLE alimtalk_send_logs
ADD COLUMN IF NOT EXISTS step_index integer DEFAULT 0 NOT NULL;
```

기존 row는 `step_index = 0` 으로 자동 초기화 → 호환성 OK.

### 2-4. `followupConfig` 타입 확장

```ts
type FollowupStep = {
    delayDays?: number;
    delayHours?: number;
    delayMinutes?: number;
    templateCode: string;
    templateName?: string;
    variableMappings?: Record<string, string>;
};

// alimtalkTemplateLinks.followupConfig
followupConfig: jsonb("followup_config").$type<FollowupStep[] | FollowupStep | null>();
```

런타임에서 단일 객체 → 배열로 정규화. DB 마이그레이션 SQL 없음 (사용자 결정 사항).

## 3. 큐 처리 로직 변경

대상 파일: [src/lib/alimtalk-automation.ts](../../../src/lib/alimtalk-automation.ts)

### 3-1. 헬퍼 함수 신규/변경

#### `normalizeFollowupConfig` (신규)

```ts
type FollowupStep = {
    delayDays?: number;
    delayHours?: number;
    delayMinutes?: number;
    templateCode: string;
    templateName?: string;
    variableMappings?: Record<string, string>;
};

function normalizeFollowupConfig(config: unknown): FollowupStep[] {
    if (!config) return [];
    if (Array.isArray(config)) return config as FollowupStep[];
    return [config as FollowupStep];
}
```

#### `enqueueFollowupStep` (신규, 큐 등록 헬퍼)

```ts
async function enqueueFollowupStep(params: {
    parentLogId: number;
    templateLinkId: number;
    orgId: string;
    baseAt: Date;
    step: FollowupStep;
    stepIndex: number;
}): Promise<void> {
    const sendAt = computeFollowupSendAt(params.baseAt, params.step);
    await db
        .insert(alimtalkFollowupQueue)
        .values({
            parentLogId: params.parentLogId,
            templateLinkId: params.templateLinkId,
            orgId: params.orgId,
            sendAt,
            stepIndex: params.stepIndex,
            status: "pending",
        })
        .onConflictDoNothing(); // unique index로 같은 (parent, step) 중복 방지
    console.log(
        `[alimtalk] followup step ${params.stepIndex} enqueued for log ${params.parentLogId}, sendAt: ${sendAt.toISOString()}`
    );
}
```

### 3-2. `processAutoTrigger`: 첫 step 등록 (변경)

```ts
// before (현재): 단일 객체 처리
if (logId && link.followupConfig) {
    const config = link.followupConfig as FollowupStep;
    const sendAt = computeFollowupSendAt(new Date(), config);
    await db.insert(alimtalkFollowupQueue).values({ ... });
}

// after: 배열 정규화 후 첫 step만 등록
if (logId) {
    const steps = normalizeFollowupConfig(link.followupConfig);
    if (steps.length > 0) {
        await enqueueFollowupStep({
            parentLogId: logId,
            templateLinkId: link.id,
            orgId,
            baseAt: new Date(),
            step: steps[0],
            stepIndex: 0,  // 첫 후속은 step 0
        });
    }
}
```

### 3-3. `processFollowupItem`: 발송 후 다음 step 체인 (변경)

```ts
async function processFollowupItem(
    item: typeof alimtalkFollowupQueue.$inferSelect,
    stats: FollowupQueueStats
): Promise<void> {
    stats.processed++;

    try {
        // [1~5] 기존 로직 유지 (parentLog, link, 멱등성, record, followupLink)

        // [6] 발송 (step에 해당하는 config 사용)
        const steps = normalizeFollowupConfig(link.followupConfig);
        const currentStep = steps[item.stepIndex];
        if (!currentStep) {
            // 설정이 줄어든 경우 (사용자가 step 삭제) → skip
            await closeQueueItem(item.id, "failed");
            stats.failed++;
            return;
        }

        const followupLink = {
            ...link,
            templateCode: currentStep.templateCode,
            templateName: currentStep.templateName || null,
            variableMappings: currentStep.variableMappings || link.variableMappings,
        };

        // sendSingle에 stepIndex 전달
        const logId = await sendSingle(
            followupLink,
            record,
            item.orgId,
            "followup",
            item.stepIndex + 1  // send_logs.step_index = stepIndex + 1 (auto가 0이므로)
        );
        await closeQueueItem(item.id, logId ? "sent" : "failed");

        if (logId) {
            stats.sent++;

            // [7] 신규: 다음 step 체인
            const nextStepIndex = item.stepIndex + 1;
            const nextStep = steps[nextStepIndex];
            if (nextStep) {
                await enqueueFollowupStep({
                    parentLogId: logId,        // 이번 발송 로그가 다음 후속의 부모
                    templateLinkId: link.id,
                    orgId: item.orgId,
                    baseAt: new Date(),
                    step: nextStep,
                    stepIndex: nextStepIndex,
                });
            }
        } else {
            stats.failed++;
            // 발송 실패 시 체인 중단 (다음 step 큐 등록 안 함)
        }
    } catch (err) {
        // ... 기존 ...
    }
}
```

### 3-4. `sendSingle` 시그니처 변경

```ts
// before
async function sendSingle(
    link: AlimtalkTemplateLink,
    record: DbRecord,
    orgId: string,
    triggerType: "auto" | "repeat" | "followup"
): Promise<number | null>

// after
async function sendSingle(
    link: AlimtalkTemplateLink,
    record: DbRecord,
    orgId: string,
    triggerType: "auto" | "repeat" | "followup",
    stepIndex: number = 0  // 신규 (default 0 = auto/repeat)
): Promise<number | null>
```

내부에서 `alimtalkSendLogs.insert` 시 `stepIndex` 값 추가:

```ts
const [log] = await db.insert(alimtalkSendLogs).values({
    // ... 기존 필드 ...
    triggerType,
    stepIndex,    // 신규
    sentAt: new Date(),
}).returning({ id: alimtalkSendLogs.id });
```

기존 호출처 (`processAutoTrigger`, `processRepeatQueue`)는 인자 안 넘기므로 자연스럽게 `stepIndex = 0`.

### 3-5. 멱등성 체크 강화 (step 단위)

```ts
// before: 1시간 윈도우 + record + link + followup 한 번만
const [recentSent] = await db.select({ id: alimtalkSendLogs.id })
    .from(alimtalkSendLogs)
    .where(and(
        eq(alimtalkSendLogs.recordId, parentLog.recordId),
        eq(alimtalkSendLogs.templateLinkId, link.id),
        eq(alimtalkSendLogs.triggerType, "followup"),
        gte(alimtalkSendLogs.sentAt, idempotencyCutoff),
        inArray(alimtalkSendLogs.status, ["sent", "pending"])
    ))
    .limit(1);

// after: step_index 추가
const targetStepIndex = item.stepIndex + 1;
const [recentSent] = await db.select({ id: alimtalkSendLogs.id })
    .from(alimtalkSendLogs)
    .where(and(
        eq(alimtalkSendLogs.recordId, parentLog.recordId),
        eq(alimtalkSendLogs.templateLinkId, link.id),
        eq(alimtalkSendLogs.triggerType, "followup"),
        eq(alimtalkSendLogs.stepIndex, targetStepIndex),  // 신규
        gte(alimtalkSendLogs.sentAt, idempotencyCutoff),
        inArray(alimtalkSendLogs.status, ["sent", "pending"])
    ))
    .limit(1);
```

→ **같은 단계만 중복 차단**, 다른 단계는 통과.

### 3-6. 변경 영향 정리

| 함수 | 상태 |
|---|---|
| `normalizeFollowupConfig` | 신규 |
| `enqueueFollowupStep` | 신규 |
| `processAutoTrigger` | 후속 큐 등록부 변경 (배열 정규화 + 첫 step만) |
| `processFollowupItem` | 발송 후 체인 추가 + 멱등성 step 단위 |
| `sendSingle` | 시그니처 변경 (stepIndex 인자 추가, default 0) |
| `processAlimtalkFollowupQueue` | 변경 없음 (큐 처리 자체는 동일) |
| `processRepeatQueue` | 변경 없음 (sendSingle 호출 시 stepIndex 미전달 → 0 default) |

## 4. UI 변경

### 4-1. 후속발송 폼 (다단계 카드)

대상:
- [src/app/alimtalk/links/new/page.tsx](../../../src/app/alimtalk/links/new/page.tsx)
- [src/app/alimtalk/links/[id]/page.tsx](../../../src/app/alimtalk/links/[id]/page.tsx)

#### 신규 컴포넌트: `FollowupStepsForm`

`src/components/alimtalk/FollowupStepsForm.tsx` 신규 생성. 두 페이지에서 공통 사용.

#### Props
```ts
interface FollowupStepsFormProps {
    senderKey: string;
    senders: Array<{ senderKey: string; plusFriendId: string }>;
    fields: Array<{ key: string; label: string }>;
    value: FollowupStepUI[];  // UI state는 단위 분리: { delayValue, delayUnit, templateCode, ... }
    onChange: (steps: FollowupStepUI[]) => void;
    maxSteps?: number;  // default 5
}

interface FollowupStepUI {
    delayValue: number;
    delayUnit: "hours" | "days";
    templateCode: string;
    senderKey?: string;  // 발신 프로필 (선택)
    variableMappings: Record<string, string>;
}
```

#### UI 구조

```
┌─ 후속 발송 ────────────────────────────────┐
│ ☑ 후속 발송 사용                            │
│                                             │
│ ┌─ Step 1 ─────────────────────[삭제]┐     │
│ │ 대기: [3] [시간 ▾]                    │     │
│ │ 발신 프로필: [드롭다운]               │     │
│ │ 템플릿:    [드롭다운]                 │     │
│ │ 변수 매핑: ...                        │     │
│ └────────────────────────────────────────┘     │
│                                             │
│ ┌─ Step 2 ─────────────────────[삭제]┐     │
│ │ ... (같은 구조) ...                   │     │
│ └────────────────────────────────────────┘     │
│                                             │
│ [+ Step 추가] (1/5)                         │
└─────────────────────────────────────────────┘
```

- **Step 추가**: 최대 5개 도달 시 disabled
- **Step 삭제**: 각 카드 우상단 X 버튼 (단, 1단계만 남으면 후속발송 사용 토글 OFF로 자연스럽게 제거)
- **순서 변경**: v1 미지원 (drag-and-drop은 v2)
- **요약 미리보기**: 각 step 카드 상단에 "발송 후 N시간/일 뒤"
- **체인 미리보기**: 폼 하단에 자연어 표현 `자동발송 → 3시간 → 1일` (선택)

#### 호환성 처리 (편집 페이지)

```ts
// 로드 시
useEffect(() => {
    const cfg = link.followupConfig;
    if (cfg) {
        // 단일 객체 → 배열 정규화
        const steps: FollowupStepUI[] = Array.isArray(cfg)
            ? cfg.map(toUiStep)
            : [toUiStep(cfg)];
        setUseFollowup(true);
        setFollowupSteps(steps);
    }
}, [link]);

function toUiStep(s: FollowupStep): FollowupStepUI {
    if (s.delayHours != null) return { delayValue: s.delayHours, delayUnit: "hours", ... };
    if (s.delayMinutes != null) return { delayValue: Math.max(1, Math.round(s.delayMinutes / 60)), delayUnit: "hours", ... };
    return { delayValue: s.delayDays ?? 1, delayUnit: "days", ... };
}
```

#### 저장 시 변환

```ts
const followupConfig: FollowupStep[] = useFollowup
    ? followupSteps.map(s => ({
        ...(s.delayUnit === "hours" && { delayHours: s.delayValue }),
        ...(s.delayUnit === "days" && { delayDays: s.delayValue }),
        templateCode: s.templateCode,
        templateName: templates.find(t => t.templateCode === s.templateCode)?.templateName,
        ...(Object.keys(s.variableMappings).length > 0 && { variableMappings: s.variableMappings }),
    }))
    : null;
```

### 4-2. List 컴포넌트 (체인 자연어 표현)

`src/components/alimtalk/AlimtalkTemplateLinkList.tsx`:

```ts
function formatFollowupDelay(cfg: FollowupStep[] | FollowupStep | null): string {
    if (!cfg) return "—";
    const steps = Array.isArray(cfg) ? cfg : [cfg];
    if (steps.length === 0) return "—";

    return steps.map(formatStepDelay).join(" → ");
}

function formatStepDelay(s: FollowupStep): string {
    if (s.delayMinutes != null) return `${s.delayMinutes}분`;
    if (s.delayHours != null) return `${s.delayHours}시간`;
    if (s.delayDays != null) return `${s.delayDays}일`;
    return "?";
}
```

표시 예시:
- 단일 step: `3시간 후` (의미상 동일하지만 일관성 위해 `3시간`만 표시할지 결정)
- 다단계: `3시간 → 1일 → 2주`

→ Badge 안에 텍스트 길어지면 줄바꿈 또는 truncate. 길이 제한 없으면 `Badge` 가 가로 길어짐. **테이블 컬럼 너비 고려해 적절히 처리** (예: max 3개까지 표시, 4개 이상은 `+N`).

```tsx
{steps.length <= 3 ? (
    <Badge>{formattedChain}</Badge>
) : (
    <Badge>{first3Joined} +{steps.length - 3}</Badge>
)}
```

## 5. 검증 SQL

### 5-1. step별 큐 분포

```sql
SELECT step_index, status, COUNT(*)
FROM alimtalk_followup_queue
GROUP BY step_index, status
ORDER BY step_index, status;
```

### 5-2. 체인 추적

특정 record의 자동/후속 발송 이력:
```sql
SELECT id, parent_log_id, trigger_type, step_index, template_code, status, sent_at
FROM alimtalk_send_logs
WHERE record_id = ?
ORDER BY sent_at;
```

기대:
```
id=100 | NULL    | auto      | 0 | BOL-1 | sent
id=101 | 100     | followup  | 1 | BOL-2 | sent  ← 자동발송이 부모, step 1
id=102 | 101     | followup  | 2 | BOL-3 | sent  ← 후속1이 부모, step 2
```

### 5-3. 멱등성 위반 (단계별)

```sql
-- 같은 (record, link, step)에 후속 2건 이상이면 위반
SELECT record_id, template_link_id, step_index, COUNT(*)
FROM alimtalk_send_logs
WHERE trigger_type = 'followup'
  AND sent_at >= NOW() - INTERVAL '24 hours'
GROUP BY record_id, template_link_id, step_index
HAVING COUNT(*) > 1;
```

### 5-4. 끊긴 체인

```sql
-- 후속 N단계 발송 성공인데 N+1 step 큐가 없음 (정상: 마지막 step) vs (비정상: 체인 끊김)
WITH last_steps AS (
    SELECT l.id, l.template_link_id, l.step_index, l.status
    FROM alimtalk_send_logs l
    WHERE l.trigger_type = 'followup' AND l.status = 'sent'
)
SELECT ls.*,
       (SELECT array_length(followup_config::jsonb, 1)
        FROM alimtalk_template_links WHERE id = ls.template_link_id) AS total_steps,
       EXISTS(SELECT 1 FROM alimtalk_followup_queue WHERE parent_log_id = ls.id) AS has_next
FROM last_steps ls
ORDER BY ls.id DESC
LIMIT 20;
```

## 6. 구현 순서 (Phase별)

### Phase 1: DB (30분)
- [ ] 마이그레이션 SQL 작성: `alimtalk_followup_queue.step_index` + unique index, `alimtalk_send_logs.step_index`
- [ ] schema.ts 타입 확장: `followupConfig` 배열 + `stepIndex` 컬럼
- [ ] 로컬 마이그레이션 적용 + 검증

### Phase 2: 큐 처리 로직 (1시간)
- [ ] `normalizeFollowupConfig`, `enqueueFollowupStep` 헬퍼 추가
- [ ] `processAutoTrigger` 큐 등록부 수정 (배열 정규화)
- [ ] `processFollowupItem` 체인 등록 + step 단위 멱등성
- [ ] `sendSingle` 시그니처에 `stepIndex` 추가

### Phase 3: UI (1.5시간)
- [ ] `FollowupStepsForm.tsx` 신규 컴포넌트
- [ ] `links/new/page.tsx` 후속발송 영역 교체
- [ ] `links/[id]/page.tsx` 후속발송 영역 교체 + 기존 데이터 로드 호환
- [ ] `AlimtalkTemplateLinkList.tsx` 체인 자연어 표시

### Phase 4: 검증 (1시간)
- [ ] 단일 step (기존 데이터 호환) 시나리오
- [ ] 2단계 / 3단계 시나리오
- [ ] 중간 실패 → 체인 중단
- [ ] 멱등성: 같은 step 두 번 큐 등록 시 unique 충돌
- [ ] 링크 비활성화 / followupConfig 변경 케이스

## 7. 트레이드오프

### 7-1. send_logs 의 step_index = stepIndex + 1

`auto`는 0, `followup` step N은 N+1로 저장. 이유:
- "n번째 메시지" 라는 비즈니스 의미가 명확
- 같은 record로 보낸 N번째 후속을 SQL로 쉽게 조회 (`WHERE step_index = 2`)

대안: followup만 0부터 카운트 → auto와 followup의 step_index 의미가 컨텍스트 의존이라 혼란. **현재안 채택**.

### 7-2. 중간 step 실패 시 체인 중단

발송 실패 → 다음 step 큐 등록 안 함. 이유:
- 1단계가 못 갔는데 2단계가 가는 건 부자연스러움
- 사용자가 의도한 흐름 깨짐

대안: 실패해도 다음 단계 진행 → 옵션으로 향후 확장 가능 (`step.continueOnFailure: true`)

### 7-3. UNIQUE INDEX 충돌 시 onConflictDoNothing

같은 `(parent_log_id, step_index)` 큐가 두 번 들어올 가능성:
- 동일 cron이 멱등 보장 → 거의 없음
- 운영 중 이상 케이스 (수동 SQL 등) → unique로 한 번만 들어가게 보장

`onConflictDoNothing` 으로 silent skip. 로그만 남김.

### 7-4. UI Step 5개 제한

5개 초과는 운영 정책상 제한. 향후 필요 시 `bkit.config.json` 또는 환경변수로 조정 가능.

## 8. Out of Scope (이번 작업 제외)

- Step 순서 변경 (drag-and-drop)
- Step별 활성/비활성 토글
- 조건부 분기 (다음 step을 데이터 값으로 분기)
- 읽음 분기 (알림톡 한계)
- AI 생성 메시지 step
- Step별 발신자 다르게 설정 (현재 design은 step별 senderKey 가능 — 단순화 위해 1차 구현은 link.senderKey 공통 사용 권장. 추후 결정)

## 9. 회귀 위험

| 위험 | 완화 |
|---|---|
| 기존 단일 객체 followupConfig 로드 실패 | `normalizeFollowupConfig` 가 자동 변환 |
| 기존 큐 row의 step_index 값 | `default 0` 으로 안전 (1단계와 동일 의미) |
| 기존 send_logs row의 step_index 값 | `default 0` (auto = 0이므로 의미 부합) |
| send_logs 단계별 멱등성 체크 강화 → 운영 중 후속 중복 발송 | step_index 0인 기존 데이터는 영향 없음 |
| processRepeatQueue가 sendSingle 인자 변경에 영향 | default param `0`이라 호환 |
| onConflictDoNothing 이 silent skip → 디버깅 어려움 | 큐 등록 console.log 유지 |

## 10. 마이그레이션 검증 체크리스트

배포 후:
- [ ] `\d alimtalk_followup_queue` 로 step_index 컬럼 + unique index 확인
- [ ] `\d alimtalk_send_logs` 로 step_index 컬럼 확인
- [ ] 기존 row의 step_index = 0 확인
- [ ] 기존 단일 객체 followupConfig 가진 링크 편집 시 정상 로드 + 다단계 폼으로 자연스럽게 표시
- [ ] 새 레코드 추가 → 자동발송 → 후속 step 0 큐 등록 (기존 동작 회귀)
- [ ] 다단계 추가 (예: 1시간 + 1일) → 두 단계 모두 자동 체인 발송
