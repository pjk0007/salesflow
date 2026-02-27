# alimtalk-automation Design Document

> **Summary**: 레코드 생성/수정 시 조건 기반 알림톡 자동 발송 + 반복 발송 시스템
>
> **Project**: Sales Manager
> **Author**: AI
> **Date**: 2026-02-13
> **Status**: Draft
> **Planning Doc**: [alimtalk-automation.plan.md](../../01-plan/features/alimtalk-automation.plan.md)

---

## 1. Overview

### 1.1 Design Goals

- 기존 수동 발송(`triggerType: "manual"`)을 확장하여 자동 발송(`on_create`, `on_update`) 지원
- 레코드 API 응답 지연 없이 fire-and-forget으로 자동 발송
- 반복 발송 큐로 stopCondition 충족 전까지 주기적 재발송
- 기존 TemplateLinkDialog UI를 확장하여 트리거/조건/반복 설정

### 1.2 Design Principles

- 기존 코드 최소 변경: 레코드 API에는 트리거 함수 호출 1줄만 추가
- fire-and-forget: 자동 발송 실패해도 레코드 작업은 정상 완료
- 중복 방지: 같은 record+link에 대해 cooldown 시간 내 재발송 차단
- 기존 패턴 준수: `getUserFromRequest()`, SWR 훅, ShadCN UI

---

## 2. Architecture

### 2.1 Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Client (Browser)                                             │
│  TemplateLinkDialog ── triggerType/condition/repeat 설정     │
│  SendLogTable ── triggerType 필터 ("auto", "repeat" 표시)   │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│ Server (Next.js API)                                         │
│                                                              │
│  POST /api/partitions/[id]/records  ── handlePost()         │
│    └→ processAutoTrigger(record, partitionId, "on_create")  │
│                                                              │
│  PATCH /api/records/[id]  ── handlePatch()                  │
│    └→ processAutoTrigger(record, partitionId, "on_update")  │
│                                                              │
│  POST /api/alimtalk/automation/process-repeats  ── Cron     │
│    └→ processRepeatQueue(orgId)                             │
│                                                              │
│  PUT /api/alimtalk/template-links/[id]  ── triggerType 저장 │
│  POST /api/alimtalk/template-links  ── triggerType 저장     │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│ Infrastructure                                               │
│  src/lib/alimtalk-automation.ts  ── 핵심 자동 발송 로직     │
│  src/lib/nhn-alimtalk.ts  ── NHN Cloud API 클라이언트       │
│  PostgreSQL  ── alimtalk_template_links, _automation_queue  │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow

```
[레코드 생성/수정 API 응답 완료]
    ↓ (fire-and-forget, 비동기)
[processAutoTrigger()]
    ├→ 해당 partitionId의 active templateLinks 조회
    │   (triggerType = "on_create" 또는 "on_update")
    ├→ triggerCondition 평가
    ├→ cooldown 체크 (최근 1시간 내 동일 record+link 발송)
    ├→ NHN Cloud sendMessages() 호출
    ├→ sendLogs 기록 (triggerType: "auto")
    └→ repeatConfig 있으면 automation_queue 등록

[Cron → POST /api/alimtalk/automation/process-repeats]
    ├→ nextRunAt <= now & status=pending 큐 조회 (limit 100)
    ├→ 각 항목의 record 현재 데이터 조회
    ├→ stopCondition 평가 → 충족 시 status=completed
    ├→ NHN Cloud sendMessages() 호출
    ├→ sendLogs 기록 (triggerType: "repeat")
    └→ repeatCount++, nextRunAt 갱신 또는 maxRepeat 도달 시 completed
```

### 2.3 Dependencies

| Component | Depends On | Purpose |
|-----------|-----------|---------|
| `alimtalk-automation.ts` | `nhn-alimtalk.ts`, `db` | 자동 발송 핵심 로직 |
| `partitions/[id]/records.ts` | `alimtalk-automation.ts` | 트리거 호출 (1줄) |
| `records/[id].ts` | `alimtalk-automation.ts` | 트리거 호출 (1줄) |
| `automation/process-repeats.ts` | `alimtalk-automation.ts` | 반복 큐 처리 |
| `TemplateLinkDialog.tsx` | `useAlimtalkTemplateLinks` | UI에서 triggerType 설정 |

---

## 3. Data Model

### 3.1 스키마 변경: alimtalkTemplateLinks

기존 컬럼 활용 + 신규 컬럼 1개 추가.

```typescript
// 기존 (변경 없음)
triggerType: varchar("trigger_type", { length: 30 }).default("manual").notNull(),
// 값: "manual" | "on_create" | "on_update"

// 기존 (타입 구조만 확장, DB 변경 없음 — jsonb)
triggerCondition: jsonb("trigger_condition").$type<{
    field?: string;
    operator?: "eq" | "ne" | "contains";  // 추가 (기존 데이터는 operator 없으면 "eq" 기본)
    value?: string;
}>(),

// 신규 컬럼 추가
repeatConfig: jsonb("repeat_config").$type<{
    intervalHours: number;     // 반복 간격 (1~168시간, 1주)
    maxRepeat: number;         // 최대 반복 횟수 (1~10)
    stopCondition: {
        field: string;
        operator: "eq" | "ne";
        value: string;
    };
} | null>(),
```

### 3.2 신규 테이블: alimtalkAutomationQueue

```typescript
export const alimtalkAutomationQueue = pgTable(
    "alimtalk_automation_queue",
    {
        id: serial("id").primaryKey(),
        templateLinkId: integer("template_link_id")
            .references(() => alimtalkTemplateLinks.id, { onDelete: "cascade" })
            .notNull(),
        recordId: integer("record_id")
            .references(() => records.id, { onDelete: "cascade" })
            .notNull(),
        orgId: uuid("org_id").notNull(),
        repeatCount: integer("repeat_count").default(0).notNull(),
        nextRunAt: timestamptz("next_run_at").notNull(),
        status: varchar("status", { length: 20 }).default("pending").notNull(),
        // status: "pending" | "completed" | "cancelled"
        createdAt: timestamptz("created_at").defaultNow().notNull(),
        updatedAt: timestamptz("updated_at").defaultNow().notNull(),
    },
    (table) => ({
        statusNextRunIdx: index("aq_status_next_run_idx").on(table.status, table.nextRunAt),
        templateRecordIdx: index("aq_template_record_idx").on(table.templateLinkId, table.recordId),
    })
);
```

### 3.3 Entity Relationships

```
[alimtalkTemplateLinks] 1 ──── N [alimtalkAutomationQueue]
[records]               1 ──── N [alimtalkAutomationQueue]
[alimtalkTemplateLinks] 1 ──── N [alimtalkSendLogs] (기존)
```

### 3.4 DB Migration SQL

```sql
-- 1. repeatConfig 컬럼 추가
ALTER TABLE alimtalk_template_links
ADD COLUMN repeat_config JSONB;

-- 2. 자동 발송 큐 테이블
CREATE TABLE alimtalk_automation_queue (
    id SERIAL PRIMARY KEY,
    template_link_id INTEGER NOT NULL REFERENCES alimtalk_template_links(id) ON DELETE CASCADE,
    record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
    org_id UUID NOT NULL,
    repeat_count INTEGER NOT NULL DEFAULT 0,
    next_run_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX aq_status_next_run_idx ON alimtalk_automation_queue(status, next_run_at);
CREATE INDEX aq_template_record_idx ON alimtalk_automation_queue(template_link_id, record_id);
```

---

## 4. API Specification

### 4.1 Endpoint List

| Method | Path | Description | Auth | 변경유형 |
|--------|------|-------------|------|---------|
| POST | /api/partitions/[id]/records | 레코드 생성 | JWT | 수정 — 트리거 호출 추가 |
| PATCH | /api/records/[id] | 레코드 수정 | JWT | 수정 — 트리거 호출 추가 |
| POST | /api/alimtalk/template-links | 템플릿 연결 생성 | JWT | 수정 — triggerType/condition/repeatConfig 저장 |
| PUT | /api/alimtalk/template-links/[id] | 템플릿 연결 수정 | JWT | 수정 — triggerType/condition/repeatConfig 저장 |
| POST | /api/alimtalk/automation/process-repeats | 반복 큐 처리 | CRON_SECRET | 신규 |

### 4.2 수정: POST /api/partitions/[id]/records

**변경 내용**: `handlePost()` 함수 끝에 1줄 추가

```typescript
// 기존 코드 유지, return 직전에 추가:
processAutoTrigger({
    record: result,
    partitionId,
    triggerType: "on_create",
    orgId: user.orgId,
}).catch((err) => console.error("Auto trigger error:", err));

return res.status(201).json({ success: true, data: result });
```

### 4.3 수정: PATCH /api/records/[id]

**변경 내용**: `handlePatch()` 함수 끝에 1줄 추가

```typescript
// 기존 코드 유지, return 직전에 추가:
processAutoTrigger({
    record: updated,
    partitionId: updated.partitionId,
    triggerType: "on_update",
    orgId: user.orgId,
}).catch((err) => console.error("Auto trigger error:", err));

return res.status(200).json({ success: true, data: updated });
```

### 4.4 수정: POST /api/alimtalk/template-links

**변경 내용**: body에서 `triggerCondition`, `repeatConfig` 추가 수신

```typescript
const {
    partitionId,
    name,
    senderKey,
    templateCode,
    templateName,
    recipientField,
    variableMappings,
    triggerType = "manual",
    triggerCondition,   // 추가
    repeatConfig,       // 추가
} = req.body;

// .values()에 추가:
triggerType,
triggerCondition: triggerCondition || null,
repeatConfig: repeatConfig || null,
```

### 4.5 수정: PUT /api/alimtalk/template-links/[id]

**변경 내용**: `triggerType`, `triggerCondition`, `repeatConfig` 업데이트 허용

```typescript
const { name, recipientField, variableMappings, isActive,
        triggerType, triggerCondition, repeatConfig } = req.body;

// updateData에 추가:
if (triggerType !== undefined) updateData.triggerType = triggerType;
if (triggerCondition !== undefined) updateData.triggerCondition = triggerCondition;
if (repeatConfig !== undefined) updateData.repeatConfig = repeatConfig;
```

### 4.6 신규: POST /api/alimtalk/automation/process-repeats

**파일**: `src/pages/api/alimtalk/automation/process-repeats.ts`

**인증**: `CRON_SECRET` 환경변수로 보호 (Bearer token 또는 query param)

**Request:**
```
POST /api/alimtalk/automation/process-repeats
Authorization: Bearer {CRON_SECRET}
```

**Response (200):**
```json
{
    "success": true,
    "data": {
        "processed": 5,
        "sent": 3,
        "completed": 1,
        "failed": 1
    }
}
```

**처리 로직:**
```typescript
1. CRON_SECRET 검증
2. alimtalk_automation_queue에서 status="pending" AND nextRunAt <= now 조회 (limit 100)
3. 각 항목에 대해:
   a. record 현재 데이터 조회
   b. templateLink 조회 (repeatConfig.stopCondition)
   c. stopCondition 평가 → 충족 시 status="completed", continue
   d. NHN Cloud sendMessages() 호출
   e. sendLogs 기록 (triggerType: "repeat")
   f. repeatCount++ → maxRepeat 도달 시 status="completed"
   g. nextRunAt = now + intervalHours
4. 결과 반환
```

**Error Responses:**
- `401 Unauthorized`: CRON_SECRET 불일치
- `500 Internal Server Error`: 처리 중 오류

---

## 5. Core Logic: src/lib/alimtalk-automation.ts

### 5.1 processAutoTrigger()

```typescript
interface AutoTriggerParams {
    record: DbRecord;         // 생성/수정된 레코드
    partitionId: number;
    triggerType: "on_create" | "on_update";
    orgId: string;
}

export async function processAutoTrigger(params: AutoTriggerParams): Promise<void> {
    // 1. 해당 파티션의 active templateLinks 조회
    //    WHERE partitionId = params.partitionId
    //      AND triggerType = params.triggerType
    //      AND isActive = 1

    // 2. 각 link에 대해:
    //    a. evaluateCondition(link.triggerCondition, record.data)
    //    b. checkCooldown(record.id, link.id) — 최근 1시간 내 발송 이력 체크
    //    c. NHN Cloud sendMessages() (단건)
    //    d. sendLogs INSERT (triggerType: "auto")
    //    e. link.repeatConfig 있으면 automation_queue INSERT
}
```

### 5.2 evaluateCondition()

```typescript
interface TriggerCondition {
    field?: string;
    operator?: "eq" | "ne" | "contains";
    value?: string;
}

export function evaluateCondition(
    condition: TriggerCondition | null,
    data: Record<string, unknown>
): boolean {
    // condition이 null이거나 field가 없으면 → true (무조건 트리거)
    // operator 기본값: "eq"
    // "eq": String(data[field]) === value
    // "ne": String(data[field]) !== value
    // "contains": String(data[field]).includes(value)
}
```

### 5.3 checkCooldown()

```typescript
export async function checkCooldown(
    recordId: number,
    templateLinkId: number,
    cooldownHours: number = 1
): Promise<boolean> {
    // alimtalkSendLogs에서 조회:
    //   WHERE recordId = recordId
    //     AND templateLinkId = templateLinkId
    //     AND sentAt > now - cooldownHours
    //     AND status IN ('sent', 'pending')
    // → 존재하면 false (발송 차단), 없으면 true (발송 허용)
}
```

### 5.4 processRepeatQueue()

```typescript
export async function processRepeatQueue(): Promise<{
    processed: number;
    sent: number;
    completed: number;
    failed: number;
}> {
    // 1. queue에서 pending & nextRunAt <= now 조회 (limit 100)
    // 2. 각 항목:
    //    a. record 조회 (없으면 cancelled)
    //    b. templateLink 조회 (없으면 cancelled)
    //    c. evaluateCondition(stopCondition, record.data) → true면 completed
    //    d. sendMessages()
    //    e. sendLogs 기록
    //    f. repeatCount++ → maxRepeat 도달 시 completed
    //    g. nextRunAt = now + intervalHours hours
    // 3. 결과 집계 반환
}
```

---

## 6. UI/UX Design

### 6.1 TemplateLinkDialog 확장

기존 폼에 3개 섹션 추가 (triggerType이 manual이 아닐 때만 표시).

```
┌────────────────────────────────────────────┐
│ 템플릿-파티션 연결                          │
│ ────────────────────────                    │
│ 연결 이름: [_______________]               │
│ 파티션 선택: [▼ 파티션 목록]               │
│ 수신번호 필드: [▼ 필드 목록]               │
│ 변수 매핑: [매핑 에디터]                   │
│                                             │
│ ─── 자동 발송 설정 ────────                │
│                                             │
│ 발송 방식: [▼ 수동 / 생성 시 / 수정 시]   │
│                                             │
│ ┌─ 조건 (발송 방식 ≠ 수동일 때) ─────┐    │
│ │ 필드: [▼ 필드 목록]                 │    │
│ │ 조건: [▼ 같음/다름/포함]            │    │
│ │ 값:   [_______________]             │    │
│ │ □ 조건 없이 항상 발송               │    │
│ └─────────────────────────────────────┘    │
│                                             │
│ ┌─ 반복 발송 (선택) ─────────────────┐    │
│ │ □ 반복 발송 사용                    │    │
│ │ 간격: [▼ 1시간~168시간]            │    │
│ │ 최대 횟수: [▼ 1~10]               │    │
│ │ 중단 조건:                          │    │
│ │   필드: [▼ 필드 목록]              │    │
│ │   조건: [▼ 같음/다름]              │    │
│ │   값:   [_______________]           │    │
│ └─────────────────────────────────────┘    │
│                                             │
│ [──────── 연결 ────────]                   │
└────────────────────────────────────────────┘
```

### 6.2 User Flow

```
설정: 템플릿 상세 → 파티션에 연결 → 발송 방식 선택 → 조건 설정 → 반복 설정 → 저장
발동: 레코드 생성/수정 → 자동 발송 → 로그 기록 → (반복 큐 등록)
모니터링: 발송 로그 → triggerType 필터 → "자동"/"반복" Badge 확인
```

### 6.3 Component List

| Component | Location | Responsibility | 변경유형 |
|-----------|----------|----------------|---------|
| `TemplateLinkDialog` | `src/components/alimtalk/` | triggerType/condition/repeat 폼 추가 | 수정 |
| `TriggerConditionForm` | `src/components/alimtalk/` | 조건 설정 폼 (field/operator/value) | 신규 |
| `RepeatConfigForm` | `src/components/alimtalk/` | 반복 설정 폼 (interval/maxRepeat/stopCondition) | 신규 |
| `SendLogTable` | `src/components/alimtalk/` | triggerType Badge 추가 ("수동"/"자동"/"반복") | 수정 |

---

## 7. Hook Changes

### 7.1 useAlimtalkTemplateLinks 수정

`createLink`, `updateLink` 함수의 파라미터에 `triggerType`, `triggerCondition`, `repeatConfig` 추가.

```typescript
const createLink = async (linkData: {
    partitionId: number;
    name: string;
    senderKey: string;
    templateCode: string;
    templateName?: string;
    recipientField: string;
    variableMappings?: Record<string, string>;
    triggerType?: string;              // 추가
    triggerCondition?: TriggerCondition | null;  // 추가
    repeatConfig?: RepeatConfig | null;          // 추가
}) => { ... };

const updateLink = async (
    id: number,
    linkData: {
        name?: string;
        recipientField?: string;
        variableMappings?: Record<string, string>;
        isActive?: number;
        triggerType?: string;              // 추가
        triggerCondition?: TriggerCondition | null;  // 추가
        repeatConfig?: RepeatConfig | null;          // 추가
    }
) => { ... };
```

---

## 8. Type Definitions

### 8.1 신규 타입 (src/types/index.ts 또는 인라인)

```typescript
export interface TriggerCondition {
    field?: string;
    operator?: "eq" | "ne" | "contains";
    value?: string;
}

export interface RepeatConfig {
    intervalHours: number;     // 1~168
    maxRepeat: number;         // 1~10
    stopCondition: {
        field: string;
        operator: "eq" | "ne";
        value: string;
    };
}

export type AlimtalkAutomationQueue = typeof alimtalkAutomationQueue.$inferSelect;
```

---

## 9. Error Handling

### 9.1 자동 발송 에러

| Scenario | Handling |
|----------|----------|
| NHN Cloud API 실패 | sendLogs에 status="failed" 기록, 레코드 API 영향 없음 |
| templateLink 비활성 | 조회 시 isActive=1 필터로 자동 제외 |
| record 데이터에 수신번호 없음 | sendLogs에 error 기록, 다음 link 계속 처리 |
| cooldown 기간 내 중복 | 발송 건너뜀, 로그 없음 |

### 9.2 반복 큐 에러

| Scenario | Handling |
|----------|----------|
| record 삭제됨 | ON DELETE CASCADE로 큐 자동 삭제 |
| templateLink 삭제됨 | ON DELETE CASCADE로 큐 자동 삭제 |
| CRON_SECRET 불일치 | 401 응답 |
| NHN Cloud API 실패 | sendLogs에 status="failed", 큐 항목은 유지 (다음 실행 시 재시도) |
| maxRepeat 도달 | status="completed" |

---

## 10. Security Considerations

- [x] 기존 JWT 인증 유지 (레코드 API, template-links API)
- [ ] `process-repeats` 엔드포인트 CRON_SECRET 보호
- [ ] triggerCondition/repeatConfig 입력 검증 (operator enum, maxRepeat 1~10, intervalHours 1~168)
- [ ] 자동 발송 시에도 조직 소유권 검증 (orgId 매칭)

---

## 11. Implementation Guide

### 11.1 File Structure

```
src/
├── lib/
│   ├── alimtalk-automation.ts          # 신규 — 핵심 자동 발송 로직
│   └── nhn-alimtalk.ts                 # 기존 (변경 없음)
├── lib/db/
│   └── schema.ts                       # 수정 — repeatConfig 컬럼 + automation_queue 테이블
├── pages/api/
│   ├── partitions/[id]/records.ts      # 수정 — processAutoTrigger 호출 1줄 추가
│   ├── records/[id].ts                 # 수정 — processAutoTrigger 호출 1줄 추가
│   └── alimtalk/
│       ├── template-links/
│       │   ├── index.ts                # 수정 — triggerCondition/repeatConfig 저장
│       │   └── [id].ts                 # 수정 — triggerCondition/repeatConfig 업데이트
│       └── automation/
│           └── process-repeats.ts      # 신규 — 반복 큐 처리 API
├── hooks/
│   └── useAlimtalkTemplateLinks.ts     # 수정 — 파라미터 확장
├── components/alimtalk/
│   ├── TemplateLinkDialog.tsx           # 수정 — 트리거/조건/반복 UI 추가
│   ├── TriggerConditionForm.tsx         # 신규 — 조건 설정 컴포넌트
│   ├── RepeatConfigForm.tsx             # 신규 — 반복 설정 컴포넌트
│   └── SendLogTable.tsx                 # 수정 — triggerType Badge 추가
└── lib/db/
    └── index.ts                        # 수정 — 신규 테이블 export
```

### 11.2 Implementation Order

1. [ ] **스키마 변경**: `schema.ts`에 `repeatConfig` 컬럼 + `alimtalkAutomationQueue` 테이블, `db/index.ts` export, SQL migration 실행
2. [ ] **핵심 로직**: `src/lib/alimtalk-automation.ts` — `processAutoTrigger()`, `evaluateCondition()`, `checkCooldown()`, `processRepeatQueue()`
3. [ ] **레코드 API 수정**: `partitions/[id]/records.ts` handlePost에 트리거 호출 추가
4. [ ] **레코드 API 수정**: `records/[id].ts` handlePatch에 트리거 호출 추가
5. [ ] **template-links API 수정**: `index.ts` POST + `[id].ts` PUT에 triggerType/condition/repeatConfig 저장
6. [ ] **UI 컴포넌트**: `TriggerConditionForm.tsx` + `RepeatConfigForm.tsx` 신규 생성
7. [ ] **TemplateLinkDialog 수정**: 트리거/조건/반복 폼 통합
8. [ ] **useAlimtalkTemplateLinks 수정**: createLink/updateLink 파라미터 확장
9. [ ] **반복 큐 API**: `automation/process-repeats.ts` 생성
10. [ ] **SendLogTable 수정**: triggerType Badge 표시 ("수동"/"자동"/"반복")
11. [ ] **빌드 검증**: `npx next build` 성공 확인

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-02-13 | Initial draft | AI |
