# email-automation Design Document

> **Summary**: NHN Cloud Email API를 활용한 이메일 발송 시스템 — 설정, 템플릿 관리, 수동/자동 발송, 발송 로그
>
> **Project**: Sales Manager
> **Author**: AI
> **Date**: 2026-02-13
> **Status**: Draft
> **Planning Doc**: [email-automation.plan.md](../../01-plan/features/email-automation.plan.md)

---

## 1. Overview

### 1.1 Design Goals

- 알림톡과 동일한 UX 패턴으로 이메일 발송 기능 제공
- NHN Cloud Email API v2.1을 통한 개별/배치 이메일 발송
- 기존 emailConfigs를 SMTP → NHN Cloud로 전환, emailTemplates는 그대로 활용
- 템플릿-파티션 연결 + 자동 발송 + 반복 발송 (알림톡과 동일 패턴)
- 발송 로그 + NHN Cloud 결과 동기화

### 1.2 Design Principles

- 기존 알림톡 패턴 미러링: 동일 구조, 다른 채널
- **NHN Cloud Email API 응답 구조 주의**: `{ header, body: { data } }` — 알림톡 root level과 다름
- fire-and-forget: 자동 발송 실패해도 레코드 API 영향 없음
- 기존 패턴 준수: `getUserFromRequest()`, SWR 훅, ShadCN UI

---

## 2. Architecture

### 2.1 Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ Client (Browser)                                                 │
│  EmailPage (탭: 대시보드/템플릿/연결 관리/로그/설정)             │
│  EmailConfigForm ── appKey + secretKey + 발신주소 설정           │
│  EmailTemplateList ── 템플릿 CRUD                                │
│  EmailTemplateLinkDialog ── 파티션 연결 + 자동/반복 설정         │
│  EmailSendLogTable ── 발송 이력 + 상태 동기화                    │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│ Server (Next.js API)                                             │
│                                                                  │
│  /api/email/config              ── GET/POST (appKey/secretKey)  │
│  /api/email/config/test         ── POST (연결 테스트)            │
│  /api/email/templates           ── GET/POST (CRUD)              │
│  /api/email/templates/[id]      ── GET/PUT/DELETE               │
│  /api/email/template-links      ── GET/POST                     │
│  /api/email/template-links/[id] ── PUT/DELETE                   │
│  /api/email/send                ── POST (수동 발송)              │
│  /api/email/logs                ── GET (로그 조회)               │
│  /api/email/logs/sync           ── POST (NHN 결과 동기화)       │
│  /api/email/automation/process-repeats ── POST (Cron 반복)      │
│                                                                  │
│  POST /api/partitions/[id]/records  ── 이메일 자동 트리거 추가  │
│  PATCH /api/records/[id]            ── 이메일 자동 트리거 추가  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│ Infrastructure                                                   │
│  src/lib/nhn-email.ts           ── NHN Cloud Email API 클라이언트│
│  src/lib/email-automation.ts    ── 자동 발송 / 반복 큐 핵심 로직│
│  PostgreSQL                     ── email_configs, email_templates│
│                                    email_template_links,         │
│                                    email_send_logs,              │
│                                    email_automation_queue        │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow

```
[수동 발송]
  레코드 선택 → 템플릿 연결 선택 → 변수 매핑 확인
  → NHN Cloud eachMail API → emailSendLogs 기록

[자동 발송]
  레코드 생성/수정 → processEmailAutoTrigger()
  → 파티션의 active emailTemplateLinks 조회 (on_create/on_update)
  → triggerCondition 평가 → cooldown 체크
  → NHN Cloud eachMail API → emailSendLogs 기록
  → repeatConfig 있으면 emailAutomationQueue 등록

[반복 발송]
  Cron → POST /api/email/automation/process-repeats
  → processEmailRepeatQueue()
  → nextRunAt <= now & status=pending 큐 조회 (limit 100)
  → stopCondition 평가 → 발송 → 큐 업데이트

[결과 동기화]
  POST /api/email/logs/sync
  → emailSendLogs에서 pending 항목 → NHN Cloud 발송 조회 API
  → 상태 업데이트 (SST2=sent, SST3=failed, SST5=rejected)
```

### 2.3 Dependencies

| Component | Depends On | Purpose |
|-----------|-----------|---------|
| `nhn-email.ts` | NHN Cloud Email API | API 클라이언트 |
| `email-automation.ts` | `nhn-email.ts`, `db` | 자동/반복 발송 핵심 로직 |
| `/api/email/*` | `nhn-email.ts`, `db` | REST API 엔드포인트 |
| `/api/partitions/[id]/records.ts` | `email-automation.ts` | 트리거 호출 (1줄) |
| `/api/records/[id].ts` | `email-automation.ts` | 트리거 호출 (1줄) |

---

## 3. Data Model

### 3.1 스키마 변경: emailConfigs (SMTP → NHN Cloud)

```typescript
export const emailConfigs = pgTable("email_configs", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .unique()
        .notNull(),
    // 삭제: provider, smtpHost, smtpPort, smtpUser, smtpPass
    appKey: varchar("app_key", { length: 200 }).notNull(),
    secretKey: varchar("secret_key", { length: 200 }).notNull(),
    fromName: varchar("from_name", { length: 100 }),
    fromEmail: varchar("from_email", { length: 200 }),
    isActive: integer("is_active").default(1).notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});
```

### 3.2 emailTemplates (변경 없음)

```typescript
export const emailTemplates = pgTable("email_templates", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    subject: varchar("subject", { length: 500 }).notNull(),
    htmlBody: text("html_body").notNull(),
    templateType: varchar("template_type", { length: 50 }),
    isActive: integer("is_active").default(1).notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});
```

### 3.3 신규 테이블: emailTemplateLinks

알림톡 `alimtalkTemplateLinks`와 동일 패턴. `senderKey`/`templateCode` 대신 `emailTemplateId` 참조.

```typescript
export const emailTemplateLinks = pgTable("email_template_links", {
    id: serial("id").primaryKey(),
    partitionId: integer("partition_id")
        .references(() => partitions.id, { onDelete: "cascade" })
        .notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    emailTemplateId: integer("email_template_id")
        .references(() => emailTemplates.id, { onDelete: "cascade" })
        .notNull(),
    recipientField: varchar("recipient_field", { length: 100 }).notNull(),
    variableMappings: jsonb("variable_mappings").$type<Record<string, string>>(),
    triggerType: varchar("trigger_type", { length: 30 }).default("manual").notNull(),
    // "manual" | "on_create" | "on_update"
    triggerCondition: jsonb("trigger_condition").$type<{
        field?: string;
        operator?: "eq" | "ne" | "contains";
        value?: string;
    }>(),
    repeatConfig: jsonb("repeat_config").$type<{
        intervalHours: number;     // 1~168
        maxRepeat: number;         // 1~10
        stopCondition: {
            field: string;
            operator: "eq" | "ne";
            value: string;
        };
    } | null>(),
    isActive: integer("is_active").default(1).notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});
```

### 3.4 신규 테이블: emailSendLogs

```typescript
export const emailSendLogs = pgTable("email_send_logs", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id").notNull(),
    templateLinkId: integer("template_link_id").references(
        () => emailTemplateLinks.id,
        { onDelete: "set null" }
    ),
    partitionId: integer("partition_id"),
    recordId: integer("record_id"),
    emailTemplateId: integer("email_template_id"),
    recipientEmail: varchar("recipient_email", { length: 200 }).notNull(),
    subject: varchar("subject", { length: 500 }),
    requestId: varchar("request_id", { length: 100 }),
    status: varchar("status", { length: 20 }).default("pending").notNull(),
    // "pending" | "sent" | "failed" | "rejected"
    resultCode: varchar("result_code", { length: 20 }),
    resultMessage: text("result_message"),
    triggerType: varchar("trigger_type", { length: 30 }),
    // "manual" | "auto" | "repeat"
    sentBy: uuid("sent_by").references(() => users.id),
    sentAt: timestamptz("sent_at").defaultNow().notNull(),
    completedAt: timestamptz("completed_at"),
});
```

### 3.5 신규 테이블: emailAutomationQueue

```typescript
export const emailAutomationQueue = pgTable(
    "email_automation_queue",
    {
        id: serial("id").primaryKey(),
        templateLinkId: integer("template_link_id")
            .references(() => emailTemplateLinks.id, { onDelete: "cascade" })
            .notNull(),
        recordId: integer("record_id")
            .references(() => records.id, { onDelete: "cascade" })
            .notNull(),
        orgId: uuid("org_id").notNull(),
        repeatCount: integer("repeat_count").default(0).notNull(),
        nextRunAt: timestamptz("next_run_at").notNull(),
        status: varchar("status", { length: 20 }).default("pending").notNull(),
        // "pending" | "completed" | "cancelled"
        createdAt: timestamptz("created_at").defaultNow().notNull(),
        updatedAt: timestamptz("updated_at").defaultNow().notNull(),
    },
    (table) => ({
        statusNextRunIdx: index("eq_status_next_run_idx").on(table.status, table.nextRunAt),
        templateRecordIdx: index("eq_template_record_idx").on(table.templateLinkId, table.recordId),
    })
);
```

### 3.6 Entity Relationships

```
[organizations] 1 ──── 1 [emailConfigs]
[organizations] 1 ──── N [emailTemplates]
[emailTemplates] 1 ──── N [emailTemplateLinks]
[partitions] 1 ──── N [emailTemplateLinks]
[emailTemplateLinks] 1 ──── N [emailSendLogs]
[emailTemplateLinks] 1 ──── N [emailAutomationQueue]
[records] 1 ──── N [emailAutomationQueue]
```

### 3.7 Type Exports (schema.ts 하단에 추가)

```typescript
export type EmailTemplateLink = typeof emailTemplateLinks.$inferSelect;
export type EmailSendLog = typeof emailSendLogs.$inferSelect;
export type EmailAutomationQueueRow = typeof emailAutomationQueue.$inferSelect;
```

### 3.8 DB Migration SQL

```sql
-- 1. emailConfigs 변경: SMTP → NHN Cloud
ALTER TABLE email_configs
DROP COLUMN IF EXISTS provider,
DROP COLUMN IF EXISTS smtp_host,
DROP COLUMN IF EXISTS smtp_port,
DROP COLUMN IF EXISTS smtp_user,
DROP COLUMN IF EXISTS smtp_pass;

ALTER TABLE email_configs
ADD COLUMN app_key VARCHAR(200) NOT NULL DEFAULT '',
ADD COLUMN secret_key VARCHAR(200) NOT NULL DEFAULT '';

-- DEFAULT 제거 (기존 행 없으므로 안전)
ALTER TABLE email_configs ALTER COLUMN app_key DROP DEFAULT;
ALTER TABLE email_configs ALTER COLUMN secret_key DROP DEFAULT;

-- 2. emailTemplateLinks 테이블
CREATE TABLE email_template_links (
    id SERIAL PRIMARY KEY,
    partition_id INTEGER NOT NULL REFERENCES partitions(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    email_template_id INTEGER NOT NULL REFERENCES email_templates(id) ON DELETE CASCADE,
    recipient_field VARCHAR(100) NOT NULL,
    variable_mappings JSONB,
    trigger_type VARCHAR(30) NOT NULL DEFAULT 'manual',
    trigger_condition JSONB,
    repeat_config JSONB,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. emailSendLogs 테이블
CREATE TABLE email_send_logs (
    id SERIAL PRIMARY KEY,
    org_id UUID NOT NULL,
    template_link_id INTEGER REFERENCES email_template_links(id) ON DELETE SET NULL,
    partition_id INTEGER,
    record_id INTEGER,
    email_template_id INTEGER,
    recipient_email VARCHAR(200) NOT NULL,
    subject VARCHAR(500),
    request_id VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    result_code VARCHAR(20),
    result_message TEXT,
    trigger_type VARCHAR(30),
    sent_by UUID REFERENCES users(id),
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- 4. emailAutomationQueue 테이블
CREATE TABLE email_automation_queue (
    id SERIAL PRIMARY KEY,
    template_link_id INTEGER NOT NULL REFERENCES email_template_links(id) ON DELETE CASCADE,
    record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
    org_id UUID NOT NULL,
    repeat_count INTEGER NOT NULL DEFAULT 0,
    next_run_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX eq_status_next_run_idx ON email_automation_queue(status, next_run_at);
CREATE INDEX eq_template_record_idx ON email_automation_queue(template_link_id, record_id);
```

---

## 4. NHN Cloud Email API Client

### 4.1 NhnEmailClient (`src/lib/nhn-email.ts`)

알림톡 `NhnAlimtalkClient`와 동일 패턴. **응답 구조가 다름에 주의**: `{ header, body: { data } }`.

```typescript
// ============================================
// 타입 정의
// ============================================

export interface NhnEmailApiHeader {
    resultCode: number;
    resultMessage: string;
    isSuccessful: boolean;
}

export interface NhnEmailSendRequest {
    senderAddress: string;
    senderName?: string;
    title: string;
    body: string;
    receiverList: Array<{
        receiveMailAddr: string;
        receiveType: "MRT0";  // 수신자
        templateParameter?: Record<string, string>;
    }>;
}

export interface NhnEmailSendResult {
    requestId: string;
    results: Array<{
        receiveMailAddr: string;
        resultCode: number;
        resultMessage: string;
    }>;
}

export interface NhnEmailQueryResult {
    requestId: string;
    mailStatusCode: string;   // SST0~SST5
    mailStatusName: string;
    resultCode: string;
    resultCodeName: string;
    receiveMailAddr: string;
    title: string;
    requestDate: string;
    resultDate: string;
}

// ============================================
// NHN Cloud Email API 클라이언트
// ============================================

export class NhnEmailClient {
    private baseUrl = "https://email.api.nhncloudservice.com";
    private appKey: string;
    private secretKey: string;

    constructor(appKey: string, secretKey: string) {
        this.appKey = appKey;
        this.secretKey = secretKey;
    }

    private async request<T = unknown>(
        method: string,
        path: string,
        body?: unknown
    ): Promise<{ header: NhnEmailApiHeader; data: T | null }> {
        const url = `${this.baseUrl}${path.replace("{appKey}", this.appKey)}`;
        const res = await fetch(url, {
            method,
            headers: {
                "Content-Type": "application/json",
                "X-Secret-Key": this.secretKey,
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) {
            return {
                header: {
                    resultCode: res.status,
                    resultMessage: `HTTP ${res.status}: ${res.statusText}`,
                    isSuccessful: false,
                },
                data: null,
            };
        }
        const json = await res.json();
        // NHN Email API: { header, body: { data } }
        return {
            header: json.header,
            data: json.body?.data ?? null,
        };
    }

    // --- 개별 발송 ---

    async sendEachMail(data: NhnEmailSendRequest): Promise<{
        header: NhnEmailApiHeader;
        data: NhnEmailSendResult | null;
    }> {
        return this.request<NhnEmailSendResult>(
            "POST",
            "/email/v2.1/appKeys/{appKey}/sender/eachMail",
            data
        );
    }

    // --- 발송 조회 ---

    async queryMails(params: {
        requestId?: string;
        startSendDate?: string;
        endSendDate?: string;
        pageNum?: number;
        pageSize?: number;
    }): Promise<{
        header: NhnEmailApiHeader;
        data: NhnEmailQueryResult[] | null;
    }> {
        const qs = new URLSearchParams();
        if (params.requestId) qs.set("requestId", params.requestId);
        if (params.startSendDate) qs.set("startSendDate", params.startSendDate);
        if (params.endSendDate) qs.set("endSendDate", params.endSendDate);
        if (params.pageNum) qs.set("pageNum", String(params.pageNum));
        if (params.pageSize) qs.set("pageSize", String(params.pageSize));
        return this.request<NhnEmailQueryResult[]>(
            "GET",
            `/email/v2.1/appKeys/{appKey}/sender/mails?${qs.toString()}`
        );
    }

    // --- 발송 상태 업데이트 조회 ---

    async queryUpdatedMails(params: {
        startUpdateDate: string;
        endUpdateDate: string;
        pageNum?: number;
        pageSize?: number;
    }): Promise<{
        header: NhnEmailApiHeader;
        data: NhnEmailQueryResult[] | null;
    }> {
        const qs = new URLSearchParams();
        qs.set("startUpdateDate", params.startUpdateDate);
        qs.set("endUpdateDate", params.endUpdateDate);
        if (params.pageNum) qs.set("pageNum", String(params.pageNum));
        if (params.pageSize) qs.set("pageSize", String(params.pageSize));
        return this.request<NhnEmailQueryResult[]>(
            "GET",
            `/email/v2.1/appKeys/{appKey}/sender/update-mails?${qs.toString()}`
        );
    }
}

// ============================================
// 헬퍼 함수
// ============================================

export async function getEmailClient(orgId: string): Promise<NhnEmailClient | null> {
    const [config] = await db
        .select()
        .from(emailConfigs)
        .where(and(eq(emailConfigs.orgId, orgId), eq(emailConfigs.isActive, 1)))
        .limit(1);

    if (!config) return null;
    return new NhnEmailClient(config.appKey, config.secretKey);
}

// 이메일 ##변수## 추출
export function extractEmailVariables(content: string): string[] {
    const matches = content.match(/##([^#]+)##/g);
    if (!matches) return [];
    return [...new Set(matches)];
}
```

### 4.2 알림톡과의 핵심 차이점

| 항목 | 알림톡 | 이메일 |
|------|--------|--------|
| Base URL | `api-alimtalk.cloud.toast.com` | `email.api.nhncloudservice.com` |
| 응답 구조 | `{ header, ...data }` (root level) | `{ header, body: { data } }` |
| 발송 API | POST `.../messages` | POST `.../sender/eachMail` |
| 수신자 필드 | `recipientNo` (전화번호) | `receiveMailAddr` (이메일) |
| 템플릿 변수 | `#{변수명}` | `##변수명##` |
| 발신자 설정 | `senderKey` (카카오 채널) | `senderAddress` (이메일 주소) |
| 템플릿 관리 | NHN Cloud 서버 (승인 필요) | Sales DB (자체 관리) |
| 상태 코드 | resultCode 숫자 | SST0~SST5 문자열 |

---

## 5. API Specification

### 5.1 Endpoint List

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET/POST | `/api/email/config` | 이메일 설정 조회/저장 | JWT |
| POST | `/api/email/config/test` | 연결 테스트 | JWT |
| GET/POST | `/api/email/templates` | 템플릿 목록/생성 | JWT |
| GET/PUT/DELETE | `/api/email/templates/[id]` | 템플릿 상세/수정/삭제 | JWT |
| GET/POST | `/api/email/template-links` | 연결 목록/생성 | JWT |
| PUT/DELETE | `/api/email/template-links/[id]` | 연결 수정/삭제 | JWT |
| POST | `/api/email/send` | 수동 이메일 발송 | JWT |
| GET | `/api/email/logs` | 발송 로그 조회 | JWT |
| POST | `/api/email/logs/sync` | NHN Cloud 결과 동기화 | JWT |
| POST | `/api/email/automation/process-repeats` | 반복 큐 처리 | CRON_SECRET |

### 5.2 GET/POST /api/email/config

**GET Response (200):**
```json
{
    "success": true,
    "data": {
        "id": 1,
        "appKey": "abc123",
        "secretKey": "abc***xyz",
        "fromName": "Sales Manager",
        "fromEmail": "noreply@example.com",
        "isActive": 1
    }
}
```

**POST Request:**
```json
{
    "appKey": "abc123",
    "secretKey": "xyz789",
    "fromName": "Sales Manager",
    "fromEmail": "noreply@example.com"
}
```

**POST Response (200/201):**
```json
{ "success": true, "data": { "id": 1 } }
```

**로직**: 알림톡 config.ts와 동일 패턴 — upsert (existing → update, else → insert). secretKey는 GET 응답에서 마스킹.

### 5.3 POST /api/email/config/test

**Request:**
```json
{ "appKey": "abc123", "secretKey": "xyz789" }
```

**로직**: NhnEmailClient 생성 → `queryMails({ pageNum: 1, pageSize: 1 })` 호출로 연결 확인.

**Response (200):**
```json
{ "success": true, "message": "연결 성공" }
```

### 5.4 GET/POST /api/email/templates

**GET Query Params**: `?page=1&pageSize=20`

**GET Response:**
```json
{
    "success": true,
    "data": [
        {
            "id": 1,
            "name": "환영 이메일",
            "subject": "##name##님, 환영합니다!",
            "htmlBody": "<h1>환영합니다, ##name##님!</h1>",
            "templateType": "welcome",
            "isActive": 1,
            "createdAt": "2026-02-13T..."
        }
    ],
    "totalCount": 5
}
```

**POST Request:**
```json
{
    "name": "환영 이메일",
    "subject": "##name##님, 환영합니다!",
    "htmlBody": "<h1>환영합니다, ##name##님!</h1>",
    "templateType": "welcome"
}
```

**로직**: `emailTemplates` INSERT, orgId는 JWT에서 추출.

### 5.5 GET/PUT/DELETE /api/email/templates/[id]

**GET**: orgId 소유권 확인 후 반환.

**PUT Request:**
```json
{
    "name": "환영 이메일 v2",
    "subject": "##name##님 환영합니다",
    "htmlBody": "<h1>반갑습니다, ##name##님</h1>",
    "isActive": 1
}
```

**DELETE**: orgId 소유권 확인 후 삭제. 연결된 emailTemplateLinks는 ON DELETE CASCADE.

### 5.6 GET/POST /api/email/template-links

알림톡 template-links와 동일 패턴.

**GET Query Params**: `?partitionId=1`

**GET Response:**
```json
{
    "success": true,
    "data": [
        {
            "id": 1,
            "partitionId": 5,
            "name": "신규 고객 환영",
            "emailTemplateId": 1,
            "recipientField": "email",
            "variableMappings": { "##name##": "name", "##company##": "company" },
            "triggerType": "on_create",
            "triggerCondition": { "field": "status", "operator": "eq", "value": "active" },
            "repeatConfig": null,
            "isActive": 1
        }
    ]
}
```

**POST Request:**
```json
{
    "partitionId": 5,
    "name": "신규 고객 환영",
    "emailTemplateId": 1,
    "recipientField": "email",
    "variableMappings": { "##name##": "name" },
    "triggerType": "on_create",
    "triggerCondition": { "field": "status", "operator": "eq", "value": "active" },
    "repeatConfig": null
}
```

**소유권 확인**: partitionId → workspaceId → orgId 조인으로 검증 (알림톡과 동일).

### 5.7 PUT/DELETE /api/email/template-links/[id]

**PUT**: name, recipientField, variableMappings, isActive, triggerType, triggerCondition, repeatConfig 업데이트.

**DELETE**: 소유권 확인 후 삭제. 관련 emailAutomationQueue는 ON DELETE CASCADE.

### 5.8 POST /api/email/send

수동 발송. 알림톡 send.ts와 동일 패턴.

**Request:**
```json
{
    "templateLinkId": 1,
    "recordIds": [10, 11, 12]
}
```

**로직:**
1. templateLink 조회 + 소유권 확인 (partitions → workspaces → orgId)
2. emailTemplate 조회 (templateLink.emailTemplateId)
3. emailConfigs 조회 (fromEmail, fromName)
4. records 조회 + 이메일 주소 추출 (recipientField)
5. 변수 매핑: `##key##` → 레코드 필드 값
6. NHN Cloud eachMail API 호출 (senderAddress, title: template.subject, body: template.htmlBody)
7. emailSendLogs 저장

**Response (200):**
```json
{
    "success": true,
    "data": {
        "requestId": "20260213...",
        "totalCount": 3,
        "successCount": 3,
        "failCount": 0
    }
}
```

**변수 치환**: `##key##` 패턴으로 subject와 htmlBody 모두에서 치환.

```typescript
function substituteVariables(
    text: string,
    mappings: Record<string, string>,
    data: Record<string, unknown>
): string {
    let result = text;
    for (const [variable, fieldKey] of Object.entries(mappings)) {
        const value = data[fieldKey] != null ? String(data[fieldKey]) : "";
        result = result.replaceAll(variable, value);
    }
    return result;
}
```

> **참고**: NHN Cloud eachMail의 `templateParameter`도 `##key##` 치환을 지원하지만, Sales에서 직접 치환 후 발송한다 (htmlBody를 DB에서 관리하므로 NHN 서버 측 치환 불필요).

### 5.9 GET /api/email/logs

**Query Params**: `?partitionId=1&page=1&pageSize=50&triggerType=auto`

**Response:**
```json
{
    "success": true,
    "data": [
        {
            "id": 1,
            "recipientEmail": "user@example.com",
            "subject": "환영합니다",
            "status": "sent",
            "triggerType": "manual",
            "sentAt": "2026-02-13T..."
        }
    ],
    "totalCount": 100
}
```

**로직**: orgId 필터 + 선택적 partitionId, triggerType 필터. 최신 순 정렬.

### 5.10 POST /api/email/logs/sync

NHN Cloud에서 발송 결과 동기화. 알림톡 logs/sync.ts와 동일 패턴.

**로직:**
1. emailSendLogs에서 status="pending" 항목 조회 (limit 100)
2. 각 requestId로 NHN Cloud queryMails API 호출
3. mailStatusCode 기반 상태 매핑:
   - `SST2` (발송완료) → "sent"
   - `SST3` (발송실패) → "failed"
   - `SST5` (수신거부) → "rejected"
   - `SST0`, `SST1` → 유지 (아직 처리중)
4. emailSendLogs 업데이트

### 5.11 POST /api/email/automation/process-repeats

**인증**: `CRON_SECRET` 환경변수 (Bearer token)

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

**로직**: `processEmailRepeatQueue()` 호출 — `alimtalk-automation.ts`의 `processRepeatQueue()`와 동일 구조.

---

## 6. Core Logic: src/lib/email-automation.ts

알림톡 `alimtalk-automation.ts`와 동일 구조, 이메일 전용.

### 6.1 processEmailAutoTrigger()

```typescript
interface EmailAutoTriggerParams {
    record: DbRecord;
    partitionId: number;
    triggerType: "on_create" | "on_update";
    orgId: string;
}

export async function processEmailAutoTrigger(params: EmailAutoTriggerParams): Promise<void> {
    // 1. emailTemplateLinks 조회
    //    WHERE partitionId AND triggerType AND isActive = 1
    // 2. 각 link에 대해:
    //    a. evaluateCondition(link.triggerCondition, record.data)
    //    b. checkEmailCooldown(record.id, link.id)
    //    c. emailTemplate 조회 → subject/htmlBody 변수 치환
    //    d. emailConfigs 조회 → fromEmail, fromName
    //    e. NHN Cloud sendEachMail() 호출
    //    f. emailSendLogs INSERT (triggerType: "auto")
    //    g. link.repeatConfig 있으면 emailAutomationQueue INSERT
}
```

### 6.2 evaluateCondition()

알림톡과 동일 — 공유 가능 (`alimtalk-automation.ts`에서 import하거나 공통 유틸로 추출).

```typescript
// 재사용: alimtalk-automation.ts의 evaluateCondition 동일 로직
export { evaluateCondition } from "./alimtalk-automation";
```

### 6.3 checkEmailCooldown()

```typescript
async function checkEmailCooldown(
    recordId: number,
    templateLinkId: number,
    cooldownHours: number = 1
): Promise<boolean> {
    // emailSendLogs에서 조회:
    //   WHERE recordId AND templateLinkId AND sentAt > now - cooldownHours
    //   AND status IN ('sent', 'pending')
    // → 존재하면 false (발송 차단)
}
```

### 6.4 sendEmailSingle()

```typescript
async function sendEmailSingle(
    link: EmailTemplateLink,
    record: DbRecord,
    orgId: string,
    triggerType: "auto" | "repeat"
): Promise<boolean> {
    // 1. getEmailClient(orgId) — null이면 false
    // 2. emailConfigs에서 fromEmail, fromName 조회
    // 3. emailTemplates에서 subject, htmlBody 조회
    // 4. record.data에서 recipientField로 이메일 주소 추출
    // 5. variableMappings로 subject + htmlBody 변수 치환
    // 6. client.sendEachMail({
    //        senderAddress: fromEmail,
    //        senderName: fromName,
    //        title: substitutedSubject,
    //        body: substitutedHtmlBody,
    //        receiverList: [{ receiveMailAddr, receiveType: "MRT0" }]
    //    })
    // 7. emailSendLogs INSERT
    // 8. return success
}
```

### 6.5 processEmailRepeatQueue()

알림톡 `processRepeatQueue()`와 동일 구조.

```typescript
export async function processEmailRepeatQueue(): Promise<{
    processed: number;
    sent: number;
    completed: number;
    failed: number;
}> {
    // 1. emailAutomationQueue에서 pending & nextRunAt <= now (limit 100)
    // 2. 각 항목:
    //    a. record 조회 (없으면 cancelled)
    //    b. templateLink 조회 (없으면 cancelled)
    //    c. evaluateCondition(stopCondition, record.data) → true면 completed
    //    d. sendEmailSingle()
    //    e. repeatCount++ → maxRepeat 도달 시 completed
    //    f. nextRunAt = now + intervalHours
    // 3. 결과 반환
}
```

---

## 7. UI/UX Design

### 7.1 Email 대시보드 페이지 (`src/pages/email.tsx`)

알림톡 `alimtalk.tsx`와 동일 탭 구조.

```
┌────────────────────────────────────────────────────────────────┐
│ 이메일                                                          │
│ NHN Cloud Email을 통해 이메일을 발송하고 관리합니다.            │
│                                                                 │
│ [대시보드] [템플릿] [연결 관리] [발송 이력] [설정]             │
│ ─────────────────────────────────────────                       │
│                                                                 │
│  (각 탭 컨텐츠)                                                 │
└────────────────────────────────────────────────────────────────┘
```

### 7.2 설정 탭 (`EmailConfigForm`)

```
┌────────────────────────────────────────────────┐
│ NHN Cloud Email 설정                            │
│ ────────────────                                │
│ App Key:    [___________________________]      │
│ Secret Key: [___________________________]      │
│ 발신 이름:  [___________________________]      │
│ 발신 이메일: [__________________________]      │
│                                                 │
│ [연결 테스트]   [저장]                          │
└────────────────────────────────────────────────┘
```

### 7.3 템플릿 탭 (`EmailTemplateList` + `EmailTemplateDialog`)

```
┌────────────────────────────────────────────────────────────────┐
│ [+ 새 템플릿]                                                   │
│                                                                 │
│ ┌──────────────────────────────────────────────────────────┐  │
│ │ 환영 이메일      | welcome | 활성 | 2026-02-13 | [편집] │  │
│ │ 결제 확인        | payment | 활성 | 2026-02-13 | [편집] │  │
│ └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘

템플릿 편집 Dialog:
┌────────────────────────────────────────────────┐
│ 이메일 템플릿 편집                              │
│ ────────────────                                │
│ 이름: [_______________]                         │
│ 유형: [_______________]                         │
│ 제목: [##name##님, 환영합니다!___]             │
│                                                 │
│ HTML 본문:                                      │
│ ┌──────────────────────────────────────────┐  │
│ │ <h1>환영합니다, ##name##님!</h1>         │  │
│ │ <p>##company##에서 보내드립니다.</p>     │  │
│ └──────────────────────────────────────────┘  │
│                                                 │
│ 감지된 변수: ##name##, ##company##             │
│                                                 │
│ [취소]   [저장]                                 │
└────────────────────────────────────────────────┘
```

### 7.4 연결 관리 탭 (`EmailTemplateLinkDialog`)

알림톡 `TemplateLinkDialog`와 동일 패턴.

```
┌────────────────────────────────────────────────┐
│ 이메일 템플릿-파티션 연결                       │
│ ────────────────────                            │
│ 연결 이름: [_______________]                    │
│ 파티션 선택: [▼ 파티션 목록]                   │
│ 이메일 템플릿: [▼ 템플릿 목록]                │
│ 수신 이메일 필드: [▼ 필드 목록]               │
│ 변수 매핑:                                      │
│   ##name## → [▼ 필드 선택]                    │
│   ##company## → [▼ 필드 선택]                 │
│                                                 │
│ ─── 자동 발송 설정 ────────                    │
│                                                 │
│ 발송 방식: [▼ 수동 / 생성 시 / 수정 시]      │
│                                                 │
│ ┌─ 조건 (발송 방식 ≠ 수동일 때) ─────┐       │
│ │ 필드: [▼ 필드 목록]                 │       │
│ │ 조건: [▼ 같음/다름/포함]            │       │
│ │ 값:   [_______________]             │       │
│ │ □ 조건 없이 항상 발송               │       │
│ └─────────────────────────────────────┘       │
│                                                 │
│ ┌─ 반복 발송 (선택) ─────────────────┐       │
│ │ □ 반복 발송 사용                    │       │
│ │ 간격: [▼ 1시간~168시간]            │       │
│ │ 최대 횟수: [▼ 1~10]               │       │
│ │ 중단 조건:                          │       │
│ │   필드: [▼ 필드 목록]              │       │
│ │   조건: [▼ 같음/다름]              │       │
│ │   값:   [_______________]           │       │
│ └─────────────────────────────────────┘       │
│                                                 │
│ [취소]   [연결]                                 │
└────────────────────────────────────────────────┘
```

### 7.5 발송 이력 탭 (`EmailSendLogTable`)

```
┌────────────────────────────────────────────────────────────────┐
│ 필터: [전체 ▼] [수동 / 자동 / 반복]    [동기화]              │
│                                                                 │
│ 수신자             | 제목       | 상태 | 방식   | 발송일      │
│ user@example.com   | 환영합니다 | 발송 | 수동   | 02-13 14:30│
│ test@example.com   | 결제 확인  | 실패 | 자동   | 02-13 14:25│
│ admin@company.com  | 리마인더   | 대기 | 반복   | 02-13 14:20│
└────────────────────────────────────────────────────────────────┘
```

### 7.6 Component List

| Component | Location | Responsibility | 유형 |
|-----------|----------|----------------|------|
| `EmailPage` | `src/pages/email.tsx` | 탭 레이아웃 (대시보드/템플릿/연결/로그/설정) | 신규 |
| `EmailDashboard` | `src/components/email/` | 이메일 대시보드 (통계 요약) | 신규 |
| `EmailConfigForm` | `src/components/email/` | NHN Cloud 설정 폼 | 신규 |
| `EmailTemplateList` | `src/components/email/` | 템플릿 목록 + CRUD | 신규 |
| `EmailTemplateDialog` | `src/components/email/` | 템플릿 생성/편집 Dialog | 신규 |
| `EmailTemplateLinkList` | `src/components/email/` | 연결 목록 | 신규 |
| `EmailTemplateLinkDialog` | `src/components/email/` | 연결 생성/편집 Dialog (조건+반복) | 신규 |
| `EmailSendLogTable` | `src/components/email/` | 발송 이력 테이블 | 신규 |
| `TriggerConditionForm` | `src/components/alimtalk/` | 재사용 — 조건 설정 폼 | 기존 |
| `RepeatConfigForm` | `src/components/alimtalk/` | 재사용 — 반복 설정 폼 | 기존 |

---

## 8. Hooks

### 8.1 useEmailConfig (`src/hooks/useEmailConfig.ts`)

알림톡 `useAlimtalkConfig`와 동일 패턴.

```typescript
export function useEmailConfig() {
    // SWR: GET /api/email/config
    // saveConfig: POST /api/email/config { appKey, secretKey, fromName, fromEmail }
    // testConnection: POST /api/email/config/test { appKey, secretKey }
    return { config, isConfigured, isLoading, error, saveConfig, testConnection };
}
```

### 8.2 useEmailTemplates (`src/hooks/useEmailTemplates.ts`)

```typescript
export function useEmailTemplates() {
    // SWR: GET /api/email/templates
    // createTemplate: POST /api/email/templates
    // updateTemplate: PUT /api/email/templates/[id]
    // deleteTemplate: DELETE /api/email/templates/[id]
    return { templates, totalCount, isLoading, error, createTemplate, updateTemplate, deleteTemplate };
}
```

### 8.3 useEmailTemplateLinks (`src/hooks/useEmailTemplateLinks.ts`)

알림톡 `useAlimtalkTemplateLinks`와 동일 패턴.

```typescript
export function useEmailTemplateLinks(partitionId: number | null) {
    // SWR: GET /api/email/template-links?partitionId={id}
    // createLink: POST /api/email/template-links
    // updateLink: PUT /api/email/template-links/[id]
    // deleteLink: DELETE /api/email/template-links/[id]
    return { templateLinks, isLoading, error, createLink, updateLink, deleteLink };
}
```

### 8.4 useEmailLogs (`src/hooks/useEmailLogs.ts`)

```typescript
export function useEmailLogs(params?: { partitionId?: number; triggerType?: string }) {
    // SWR: GET /api/email/logs?partitionId=...&triggerType=...
    // syncLogs: POST /api/email/logs/sync
    return { logs, totalCount, isLoading, error, syncLogs };
}
```

### 8.5 useEmailSend (`src/hooks/useEmailSend.ts`)

```typescript
export function useEmailSend() {
    // sendEmail: POST /api/email/send { templateLinkId, recordIds }
    return { sendEmail, isSending };
}
```

---

## 9. Record API 수정 (자동 트리거 주입)

### 9.1 POST /api/partitions/[id]/records

기존 `handlePost()` return 직전에 1줄 추가:

```typescript
import { processEmailAutoTrigger } from "@/lib/email-automation";

// return 직전:
processEmailAutoTrigger({
    record: result,
    partitionId,
    triggerType: "on_create",
    orgId: user.orgId,
}).catch((err) => console.error("Email auto trigger error:", err));
```

### 9.2 PATCH /api/records/[id]

기존 `handlePatch()` return 직전에 1줄 추가:

```typescript
import { processEmailAutoTrigger } from "@/lib/email-automation";

// return 직전:
processEmailAutoTrigger({
    record: updated,
    partitionId: updated.partitionId,
    triggerType: "on_update",
    orgId: user.orgId,
}).catch((err) => console.error("Email auto trigger error:", err));
```

---

## 10. Error Handling

### 10.1 자동 발송

| Scenario | Handling |
|----------|----------|
| NHN Cloud API 실패 | emailSendLogs에 status="failed" 기록, 레코드 API 영향 없음 |
| emailTemplate 비활성/삭제 | 연결 시점에 검증, CASCADE로 정리 |
| emailConfig 없음 | getEmailClient() → null → 발송 건너뜀 |
| 수신 이메일 없음 | 해당 record 건너뜀, 로그 없음 |
| cooldown 기간 내 | 발송 건너뜀, 로그 없음 |

### 10.2 반복 큐

| Scenario | Handling |
|----------|----------|
| record 삭제됨 | ON DELETE CASCADE로 큐 자동 삭제 |
| templateLink 삭제됨 | ON DELETE CASCADE로 큐 자동 삭제 |
| CRON_SECRET 불일치 | 401 응답 |
| NHN Cloud 실패 | 로그에 failed 기록, 큐 항목 유지 (다음 실행에 재시도) |
| maxRepeat 도달 | status="completed" |

---

## 11. Security Considerations

- [ ] JWT 인증 유지 (모든 /api/email/* 엔드포인트)
- [ ] `process-repeats` 엔드포인트 CRON_SECRET 보호
- [ ] emailConfigs.secretKey는 GET 응답에서 마스킹
- [ ] HTML 본문은 관리자만 작성 (sanitize 없이 저장, 렌더링 시 주의)
- [ ] 수동 발송 시 max 1000건 제한
- [ ] triggerCondition/repeatConfig 입력 검증 (operator enum, maxRepeat 1~10, intervalHours 1~168)

---

## 12. Implementation Guide

### 12.1 File Structure

```
src/
├── lib/
│   ├── nhn-email.ts                       # 신규 — NHN Cloud Email API 클라이언트
│   └── email-automation.ts                # 신규 — 자동/반복 발송 핵심 로직
├── lib/db/
│   └── schema.ts                          # 수정 — emailConfigs 변경 + 3 테이블 추가
├── pages/
│   ├── email.tsx                          # 신규 — 이메일 대시보드 페이지
│   └── api/email/
│       ├── config.ts                      # 신규 — GET/POST 설정
│       ├── config/test.ts                 # 신규 — POST 연결 테스트
│       ├── templates/
│       │   ├── index.ts                   # 신규 — GET/POST 템플릿 CRUD
│       │   └── [id].ts                    # 신규 — GET/PUT/DELETE 템플릿 상세
│       ├── template-links/
│       │   ├── index.ts                   # 신규 — GET/POST 연결
│       │   └── [id].ts                    # 신규 — PUT/DELETE 연결
│       ├── send.ts                        # 신규 — POST 수동 발송
│       ├── logs/
│       │   ├── index.ts                   # 신규 — GET 로그 조회
│       │   └── sync.ts                    # 신규 — POST 결과 동기화
│       └── automation/
│           └── process-repeats.ts         # 신규 — POST 반복 큐 처리
├── hooks/
│   ├── useEmailConfig.ts                  # 신규
│   ├── useEmailTemplates.ts               # 신규
│   ├── useEmailTemplateLinks.ts           # 신규
│   ├── useEmailLogs.ts                    # 신규
│   └── useEmailSend.ts                    # 신규
├── components/email/
│   ├── EmailDashboard.tsx                 # 신규
│   ├── EmailConfigForm.tsx                # 신규
│   ├── EmailTemplateList.tsx              # 신규
│   ├── EmailTemplateDialog.tsx            # 신규
│   ├── EmailTemplateLinkList.tsx          # 신규
│   ├── EmailTemplateLinkDialog.tsx        # 신규
│   └── EmailSendLogTable.tsx              # 신규
└── pages/api/
    ├── partitions/[id]/records.ts         # 수정 — processEmailAutoTrigger 호출 추가
    └── records/[id].ts                    # 수정 — processEmailAutoTrigger 호출 추가
```

### 12.2 Implementation Order

1. [ ] **스키마 변경**: emailConfigs SMTP→NHN Cloud + emailTemplateLinks + emailSendLogs + emailAutomationQueue + 타입 export + SQL migration
2. [ ] **NHN Email 클라이언트**: `src/lib/nhn-email.ts` — NhnEmailClient, getEmailClient(), extractEmailVariables()
3. [ ] **설정 API + 훅 + UI**: `/api/email/config`, `/api/email/config/test`, `useEmailConfig`, `EmailConfigForm`
4. [ ] **템플릿 CRUD API + 훅 + UI**: `/api/email/templates`, `useEmailTemplates`, `EmailTemplateList`, `EmailTemplateDialog`
5. [ ] **연결 API + 훅 + UI**: `/api/email/template-links`, `useEmailTemplateLinks`, `EmailTemplateLinkList`, `EmailTemplateLinkDialog`
6. [ ] **수동 발송 API + 훅**: `/api/email/send`, `useEmailSend`
7. [ ] **자동 발송 로직**: `src/lib/email-automation.ts` — processEmailAutoTrigger, sendEmailSingle, checkEmailCooldown
8. [ ] **레코드 API에 트리거 주입**: `partitions/[id]/records.ts` + `records/[id].ts`
9. [ ] **반복 큐 API**: `/api/email/automation/process-repeats` — processEmailRepeatQueue
10. [ ] **로그 API + 동기화**: `/api/email/logs`, `/api/email/logs/sync`, `useEmailLogs`
11. [ ] **이메일 대시보드 페이지**: `src/pages/email.tsx` + `EmailDashboard`, `EmailSendLogTable`
12. [ ] **네비게이션 추가**: 사이드바에 이메일 메뉴 추가
13. [ ] **빌드 검증**: `npx next build` 성공

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-02-13 | Initial draft | AI |
