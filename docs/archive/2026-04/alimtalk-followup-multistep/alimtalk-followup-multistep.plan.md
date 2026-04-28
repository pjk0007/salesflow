# Plan: alimtalk-followup-multistep (알림톡 후속발송 다단계 체인)

## 배경

현재 알림톡 후속발송은 **1단계만** 지원:

```
자동발송 → 후속발송 1회 → 끝
```

요구사항: **N단계 체인**으로 리마인드/단계별 메시지 가능해야 함

```
자동발송 → 후속1 (3시간 후, "쿠폰 발급") → 후속2 (1일 후, "사용 안내") → 후속3 (2주 후, "리마인드") → ...
```

## 비즈니스 케이스

기존 운영 사례:
- 생성 시: 서비스 소개서 발송
- 3시간 뒤: 쿠폰 발급 안내
- 2주 뒤: 사용 리마인드 (예전에는 이거도 보냈음)

이런 시나리오를 **링크 1개에 N단계로** 정의 가능해야 함. 매번 새로운 링크/트리거 만들면 운영 복잡.

## 기존 자산: 이메일 후속발송이 이미 N단계 지원

[email-followup.ts](src/lib/email-followup.ts) + `email_followup_queue` 테이블 구조:

```ts
// 이미 N단계 + 읽음 분기까지 지원
followupConfig: Array<{
    delayDays: number;
    onOpened?: { templateId: number };    // 이메일 전용 (읽음 분기)
    onNotOpened?: { templateId: number };
}>

// 큐 테이블에 step_index 컬럼 존재
emailFollowupQueue: {
    parentLogId, sourceType, sourceId, stepIndex, checkAt, status, result, ...
}

// 발송 후 다음 step 자동 큐 등록 (체인)
const nextStep = steps[item.stepIndex + 1];
if (nextStep) await enqueueFollowup({ ...,  stepIndex: item.stepIndex + 1 });
```

→ 알림톡도 동일 패턴 적용. 다만 **읽음 분기는 알림톡엔 없음** (NHN이 읽음 추적 미지원). 단순 다단계만.

## 요구사항

### FR-01. followupConfig 배열 확장

기존 단일 객체 → 배열로:

```ts
// alimtalkTemplateLinks.followupConfig 타입
type FollowupStep = {
    delayDays?: number;
    delayHours?: number;
    delayMinutes?: number;
    templateCode: string;
    templateName?: string;
    variableMappings?: Record<string, string>;
};

// 배열 또는 단일 객체 (하위호환)
followupConfig: FollowupStep[] | FollowupStep | null
```

런타임에서 단일 객체 → 배열로 정규화 (이메일 패턴 동일):

```ts
function normalizeFollowupConfig(config: unknown): FollowupStep[] {
    if (!config) return [];
    if (Array.isArray(config)) return config;
    return [config as FollowupStep];
}
```

### FR-02. 큐 테이블에 step_index 컬럼 추가

```sql
ALTER TABLE alimtalk_followup_queue
ADD COLUMN step_index integer DEFAULT 0 NOT NULL;
```

기존 row는 모두 `step_index = 0` (1단계)이라 호환 OK.

### FR-03. processAutoTrigger: 첫 step 큐 등록

자동발송 성공 후 `steps[0]` 등록 (현재와 거의 동일, `step_index = 0` 명시).

```ts
const steps = normalizeFollowupConfig(link.followupConfig);
if (logId && steps.length > 0) {
    const firstStep = steps[0];
    const sendAt = computeFollowupSendAt(new Date(), firstStep);
    await db.insert(alimtalkFollowupQueue).values({
        parentLogId: logId,
        templateLinkId: link.id,
        orgId,
        sendAt,
        stepIndex: 0,
        status: "pending",
    });
}
```

### FR-04. processFollowupItem: 발송 후 다음 step 체인

발송 성공 후 `steps[stepIndex + 1]` 있으면 자동 큐 등록:

```ts
async function processFollowupItem(item, stats) {
    // ... 기존 발송 로직 ...

    const logId = await sendSingle(followupLink, record, item.orgId, "followup");
    await closeQueueItem(item.id, logId ? "sent" : "failed");

    // 신규: 다음 step 체인
    if (logId) {
        const steps = normalizeFollowupConfig(link.followupConfig);
        const nextStep = steps[item.stepIndex + 1];
        if (nextStep) {
            const sendAt = computeFollowupSendAt(new Date(), nextStep);
            await db.insert(alimtalkFollowupQueue).values({
                parentLogId: logId,        // ← 이번 후속 발송이 다음 후속의 부모
                templateLinkId: link.id,
                orgId: item.orgId,
                sendAt,
                stepIndex: item.stepIndex + 1,
                status: "pending",
            });
        }
        stats.sent++;
    }
}
```

**중요**: `parentLogId`는 이번 발송 로그 ID로 갱신. 체인 추적 가능.

### FR-05. 멱등성 체크 보강

기존 1시간 윈도우 체크 → step별로 분리:

```ts
// step_index 추가해서 같은 step만 중복 체크
const [recentSent] = await db.select({ id: alimtalkSendLogs.id })
    .from(alimtalkSendLogs)
    .where(and(
        eq(alimtalkSendLogs.recordId, parentLog.recordId),
        eq(alimtalkSendLogs.templateLinkId, link.id),
        eq(alimtalkSendLogs.triggerType, "followup"),
        // 기존: sentAt >= cutoff
        gte(alimtalkSendLogs.sentAt, idempotencyCutoff),
        inArray(alimtalkSendLogs.status, ["sent", "pending"])
    ))
    .limit(1);
```

문제: send_logs에는 step_index 컬럼 없음. **두 가지 해결책**:

#### 옵션 A: send_logs에도 step_index 추가
- `alimtalk_send_logs`에 `step_index integer` 컬럼 추가
- 가장 정확한 체인 추적 가능
- 기존 row는 `0`으로 초기화

#### 옵션 B: 멱등성 체크 윈도우만 사용 (현재 방식 유지)
- 1시간 윈도우 내 같은 (record, link, followup) 발송 1회만 허용
- step간 간격이 1시간 미만이면 두 번째 step이 차단됨 → 문제

**결정**: **옵션 A 채택**. step_index 컬럼 추가가 필요. 멱등성을 정확히 step 단위로 체크.

### FR-06. UI: 다단계 폼

후속발송 섹션을 카드 리스트로:

```
┌─ 후속 발송 ──────────────────────────┐
│ ☑ 후속 발송 사용                      │
│                                       │
│ ┌─ Step 1 ────────────────[삭제]┐   │
│ │ 대기: [3] [시간 ▾]               │   │
│ │ 후속 템플릿: [드롭다운]          │   │
│ │ 변수 매핑: ...                   │   │
│ └──────────────────────────────────┘   │
│                                       │
│ ┌─ Step 2 ────────────────[삭제]┐   │
│ │ 대기: [1] [일 ▾]                 │   │
│ │ 후속 템플릿: [드롭다운]          │   │
│ │ 변수 매핑: ...                   │   │
│ └──────────────────────────────────┘   │
│                                       │
│ [+ Step 추가]                         │
└───────────────────────────────────────┘
```

#### 제약사항
- 최대 5개 step (오남용 방지)
- 각 step은 이전 step 발송 시점 기준 + delay
- 순서 변경(드래그)은 v2로 미루고 v1은 추가/삭제만

#### 리스트 라벨
`AlimtalkTemplateLinkList.tsx`에서:
- 1단계: `3시간 후` (현재 동일)
- N단계: `다단계 (N개)` 또는 `3시간 → 1일 → 2주`

### FR-07. 데이터 마이그레이션 (자동 호환)

기존 followupConfig가 단일 객체로 저장된 데이터:
```json
{ "delayHours": 1, "templateCode": "BOL-2", ... }
```

마이그레이션 SQL 없이 **런타임에서 자동 처리**:
- 읽기: `normalizeFollowupConfig()`가 단일 객체 → 배열로 변환
- 쓰기: UI 저장 시 항상 배열로 저장 (편집하면 자연스럽게 변환됨)

옵션: 일괄 마이그레이션 SQL 작성 (선택, 없어도 됨):
```sql
UPDATE alimtalk_template_links
SET followup_config = jsonb_build_array(followup_config)
WHERE followup_config IS NOT NULL
  AND jsonb_typeof(followup_config) = 'object';
```

## Out of Scope

- **읽음 분기**: 알림톡엔 읽음 추적이 없어서 미지원
- **조건부 분기**: 데이터 값 기반 분기는 trigger_condition으로 충분, step별 조건은 v2
- **Step 순서 변경 (drag-and-drop)**: 추가/삭제만 v1, drag는 v2
- **Step별 활성/비활성 토글**: 필요 시 추가, v1은 단순화

## 우선순위

**높음** — 운영 핵심 시나리오 (3시간 + 2주 같은 단계별 리마인드).

## 작업 시간 예상

3~4시간:
- DB 마이그레이션 (step_index 2개 컬럼): 30분
- 큐 처리 로직 체인 추가: 1시간
- UI 다단계 폼: 1.5시간
- 검증/테스트: 1시간

## 영향 범위

| 영역 | 변경 |
|---|---|
| DB | `alimtalk_followup_queue.step_index`, `alimtalk_send_logs.step_index` 추가 |
| Schema | `followupConfig` 타입을 배열로 (하위호환) |
| Logic | `normalizeFollowupConfig`, `processFollowupItem`에 체인 추가 |
| UI | new/edit page 후속발송 폼 다단계 |
| UI | List 컴포넌트 N단계 표시 |
| 호환성 | 단일 객체 데이터는 자동으로 배열로 처리 |

## 결정 사항 (2026-04-28 확정)

- [x] **Step 최대 개수: 5개**
- [x] **멱등성: step 단위로 체크** — 같은 단계 메시지 중복 발송만 차단, 다음 단계는 정상 진행
- [x] **기존 데이터: 그대로 둠** — 마이그레이션 SQL 작성 안 함. 런타임에서 단일 객체 → 배열로 자동 정규화
- [x] **List 라벨: 자연어 체인 표현** — `3시간 → 1일 → 2주` 형식

## 검증 시나리오

1. **단일 step (기존 데이터 호환)**: 기존 `delayHours: 1` 데이터 편집 → 단일 step 1로 표시 → 저장 → 발송 정상
2. **2단계 추가**: 3시간 → 1일 추가 → 새 레코드 트리거 → step 0 발송 → 큐에 step 1 등록 → step 1 발송
3. **3단계 + 중간 실패**: step 0 성공, step 1 실패 → step 2 큐 등록 안 됨 (체인 끊김)
4. **멱등성**: 같은 record로 step 0이 두 번 큐 등록되면 두 번째는 skip
5. **링크 비활성화**: step 1 큐 대기 중에 link.isActive=0 → 발송 시 거부

## 검증 SQL

```sql
-- step별 큐 분포
SELECT step_index, status, COUNT(*)
FROM alimtalk_followup_queue
GROUP BY step_index, status
ORDER BY step_index, status;

-- 체인 추적: 한 record의 발송 이력
SELECT id, parent_log_id, template_code, status, sent_at,
       (SELECT step_index FROM alimtalk_followup_queue WHERE parent_log_id = alimtalk_send_logs.id LIMIT 1) AS next_step
FROM alimtalk_send_logs
WHERE record_id = ? AND trigger_type IN ('auto', 'followup')
ORDER BY sent_at;

-- 끊긴 체인 확인 (failed 후속 = 다음 step 큐 없음 정상)
SELECT l.id, l.status, l.sent_at,
       EXISTS(SELECT 1 FROM alimtalk_followup_queue WHERE parent_log_id = l.id) AS has_next
FROM alimtalk_send_logs l
WHERE l.trigger_type = 'followup'
ORDER BY l.id DESC LIMIT 20;
```
