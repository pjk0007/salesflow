# Design: email-followup (이메일 후속 발송)

## 1. 데이터 모델

### 1-1. followupConfig 타입 (공용)

```typescript
interface FollowupConfig {
    delayDays: number;                    // 1~30일
    onOpened?: {                          // 읽었을 때 (선택)
        templateId?: number;              // 연결 관리용: 후속 템플릿 ID
        prompt?: string;                  // AI 자동 발송용: AI 지시사항
    };
    onNotOpened?: {                       // 읽지 않았을 때 (선택)
        templateId?: number;
        prompt?: string;
    };
}
```

### 1-2. emailTemplateLinks 테이블 수정

기존 `emailTemplateLinks`에 컬럼 추가:

| 컬럼 | 타입 | 설명 |
|------|------|------|
| followupConfig | jsonb (nullable) | FollowupConfig JSON (templateId만 사용) |

스키마 추가:
```typescript
followupConfig: jsonb("followup_config").$type<FollowupConfig | null>(),
```

### 1-3. emailAutoPersonalizedLinks 테이블 수정

기존 `emailAutoPersonalizedLinks`에 컬럼 추가:

| 컬럼 | 타입 | 설명 |
|------|------|------|
| followupConfig | jsonb (nullable) | FollowupConfig JSON (prompt만 사용) |

스키마 추가:
```typescript
followupConfig: jsonb("followup_config").$type<FollowupConfig | null>(),
```

### 1-4. emailSendLogs 테이블 수정

| 컬럼 | 타입 | 설명 |
|------|------|------|
| parentLogId | integer (nullable) | 원본 이메일 로그 ID (자기참조 FK) |

스키마 추가:
```typescript
parentLogId: integer("parent_log_id"),
```

### 1-5. emailFollowupQueue 테이블 (신규)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | serial PK | |
| parentLogId | integer NOT NULL, FK→emailSendLogs(id) cascade | 원본 발송 로그 |
| sourceType | varchar(20) NOT NULL | "template" \| "ai" |
| sourceId | integer NOT NULL | templateLinkId 또는 autoPersonalizedLinkId |
| orgId | uuid NOT NULL | |
| checkAt | timestamptz NOT NULL | 읽음 체크 시각 (sentAt + delayDays) |
| status | varchar(20) default "pending" | pending \| sent \| skipped \| cancelled |
| result | varchar(20) | "opened" \| "not_opened" (처리 후 기록) |
| processedAt | timestamptz | 처리 완료 시각 |
| createdAt | timestamptz | |

인덱스:
- `(status, checkAt)` — 크론 처리용
- `(parentLogId)` unique — 동일 원본에 중복 큐 방지

### 1-6. 마이그레이션: `drizzle/0025_email_followup.sql`

```sql
-- 1. emailTemplateLinks에 followupConfig 추가
ALTER TABLE email_template_links ADD COLUMN followup_config jsonb;

-- 2. emailAutoPersonalizedLinks에 followupConfig 추가
ALTER TABLE email_auto_personalized_links ADD COLUMN followup_config jsonb;

-- 3. emailSendLogs에 parentLogId 추가
ALTER TABLE email_send_logs ADD COLUMN parent_log_id integer;

-- 4. emailFollowupQueue 생성
CREATE TABLE email_followup_queue (
    id serial PRIMARY KEY,
    parent_log_id integer NOT NULL REFERENCES email_send_logs(id) ON DELETE CASCADE,
    source_type varchar(20) NOT NULL,
    source_id integer NOT NULL,
    org_id uuid NOT NULL,
    check_at timestamptz NOT NULL,
    status varchar(20) DEFAULT 'pending' NOT NULL,
    result varchar(20),
    processed_at timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX efq_status_check_idx ON email_followup_queue (status, check_at);
CREATE UNIQUE INDEX efq_parent_log_idx ON email_followup_queue (parent_log_id);
```

## 2. API 설계

### 2-1. 기존 API 수정 — template-links POST/PUT

**파일**: `src/app/api/email/template-links/route.ts`, `[id]/route.ts`

request body에 `followupConfig` 필드 추가:
```typescript
// POST & PUT body에 추가
followupConfig?: {
    delayDays: number;
    onOpened?: { templateId: number };
    onNotOpened?: { templateId: number };
} | null;
```

INSERT/UPDATE에 `followupConfig` 포함.

### 2-2. 기존 API 수정 — auto-personalized POST/PUT

**파일**: `src/app/api/email/auto-personalized/route.ts`, `[id]/route.ts`

request body에 `followupConfig` 필드 추가:
```typescript
followupConfig?: {
    delayDays: number;
    onOpened?: { prompt: string };
    onNotOpened?: { prompt: string };
} | null;
```

INSERT/UPDATE에 `followupConfig` 포함. GET 응답에도 `followupConfig` 필드 포함.

### 2-3. 신규 API — 후속 발송 크론

**파일**: `src/app/api/email/automation/process-followups/route.ts`

| 항목 | 값 |
|------|---|
| Method | POST |
| Auth | CRON_SECRET (Bearer 또는 ?secret) |
| 처리 | processEmailFollowupQueue() 호출 |
| 응답 | `{ success, data: { processed, sent, skipped, cancelled } }` |

## 3. 비즈니스 로직

### 3-1. 후속 큐 등록 — enqueueFollowup()

**파일**: `src/lib/email-followup.ts` (신규)

```typescript
async function enqueueFollowup(params: {
    logId: number;
    sourceType: "template" | "ai";
    sourceId: number;
    orgId: string;
    sentAt: Date;
    followupConfig: FollowupConfig;
}): Promise<void>
```

호출 시점:
1. `email-automation.ts` — `sendEmailSingle()` 성공 후, link.followupConfig가 있으면 호출
2. `auto-personalized-email.ts` — NHN 발송 성공 후, link.followupConfig가 있으면 호출

checkAt 계산: `sentAt + delayDays * 24 * 60 * 60 * 1000`

중복 방지: parentLogId unique 인덱스로 DB 레벨에서 보장. INSERT ON CONFLICT DO NOTHING.

### 3-2. 후속 큐 처리 — processEmailFollowupQueue()

**파일**: `src/lib/email-followup.ts`

```typescript
export async function processEmailFollowupQueue(): Promise<{
    processed: number;
    sent: number;
    skipped: number;
    cancelled: number;
}>
```

처리 플로우:
1. `status=pending AND checkAt <= now()` 항목 최대 100개 조회
2. 각 항목에 대해:
   a. 원본 emailSendLog 조회 — 없으면 cancelled
   b. **읽음 상태 최신화**: 원본 로그의 requestId로 NHN API queryMails() 호출
      - isOpened 업데이트 (기존 sync 로직 재사용)
   c. 읽음 여부 판단: `parentLog.isOpened === 1` → opened, 아니면 not_opened
   d. sourceType에 따라 분기:
      - `"template"`: followupConfig에서 조건에 맞는 templateId 확인
        - templateId 있으면 → `sendFollowupFromTemplate()` 호출
        - 없으면 → skipped
      - `"ai"`: followupConfig에서 조건에 맞는 prompt 확인
        - prompt 있으면 → `sendFollowupFromAi()` 호출
        - 없으면 → skipped
   e. 큐 상태 업데이트: sent/skipped + result + processedAt

### 3-3. 템플릿 기반 후속 발송 — sendFollowupFromTemplate()

**파일**: `src/lib/email-followup.ts`

기존 `sendEmailSingle()` 패턴을 재사용:
- templateLink 조회 → recipientField/variableMappings 활용
- 후속 templateId로 템플릿 조회
- 변수 치환 + 서명 + NHN 발송
- emailSendLogs에 triggerType="followup", parentLogId=원본 로그 ID로 기록

```typescript
async function sendFollowupFromTemplate(params: {
    parentLog: EmailSendLog;
    templateLink: EmailTemplateLink;
    followupTemplateId: number;
    orgId: string;
}): Promise<boolean>
```

### 3-4. AI 기반 후속 발송 — sendFollowupFromAi()

**파일**: `src/lib/email-followup.ts`

기존 `processAutoPersonalizedEmail()` 패턴을 참고:
- autoPersonalizedLink 조회 → 설정값 활용
- 원본 이메일의 subject/body를 AI 컨텍스트에 포함
- AI에게 "이전 이메일에 대한 후속 이메일" 지시
- emailSendLogs에 triggerType="ai_followup", parentLogId=원본 로그 ID로 기록

```typescript
async function sendFollowupFromAi(params: {
    parentLog: EmailSendLog;
    autoLink: AutoPersonalizedLink;
    followupPrompt: string;
    orgId: string;
}): Promise<boolean>
```

AI 프롬프트에 추가할 컨텍스트:
```
이전에 발송한 이메일:
- 제목: {parentLog.subject}
- 본문 요약: {parentLog.body의 처음 500자}
- 읽음 여부: {opened/not_opened}

위 이메일에 대한 후속 이메일을 작성해주세요.
사용자 지시: {followupPrompt}
```

### 3-5. 기존 코드 수정 — email-automation.ts

`sendEmailSingle()` 함수 수정:
- 반환값을 `{ success: boolean; logId?: number }`로 변경 (INSERT된 로그 ID 반환)
- `processEmailAutoTrigger()`에서 발송 성공 + link.followupConfig 존재 시 → `enqueueFollowup()` 호출

### 3-6. 기존 코드 수정 — auto-personalized-email.ts

`processAutoPersonalizedEmail()`에서:
- emailSendLogs INSERT 후 로그 ID를 받아옴 (.returning())
- link.followupConfig 존재 + 발송 성공 시 → `enqueueFollowup()` 호출

## 4. UI 설계

### 4-1. FollowupConfigForm 컴포넌트 (신규)

**파일**: `src/components/email/FollowupConfigForm.tsx`

두 가지 모드로 동작:

**Props**:
```typescript
interface FollowupConfigFormProps {
    mode: "template" | "ai";
    value: FollowupConfig | null;
    onChange: (config: FollowupConfig | null) => void;
    templates?: EmailTemplate[];     // mode="template"일 때만
}
```

**UI 구성**:
```
┌─────────────────────────────────────────────────┐
│ [Switch] 후속 발송 사용                           │
│                                                  │
│ (활성화 시)                                       │
│ 대기 일수: [___] 일 (1~30)                        │
│                                                  │
│ 📬 읽었을 때:                                     │
│   [mode=template: 템플릿 Select]                  │
│   [mode=ai: Textarea "AI 지시사항"]               │
│                                                  │
│ 📭 읽지 않았을 때:                                 │
│   [mode=template: 템플릿 Select]                  │
│   [mode=ai: Textarea "AI 지시사항"]               │
└─────────────────────────────────────────────────┘
```

- 읽었을 때 / 읽지 않았을 때 모두 선택사항 (둘 다 비워도 됨, 최소 하나 필요)
- 대기 일수 기본값: 3일

### 4-2. EmailTemplateLinkDialog 수정

**파일**: `src/components/email/EmailTemplateLinkDialog.tsx`

변경:
- state 추가: `followupConfig`
- useEffect에서 `link.followupConfig` 로드
- RepeatConfigForm 아래에 `<FollowupConfigForm mode="template" ... />` 추가
- handleSave data에 `followupConfig` 포함

### 4-3. AutoPersonalizedEmailConfig 수정

**파일**: `src/components/email/AutoPersonalizedEmailConfig.tsx`

변경:
- state 추가: `followupConfig`
- openEditDialog에서 `link.followupConfig` 로드
- resetForm에서 followupConfig 초기화
- Dialog 하단 (회사 자동 조사 아래)에 `<FollowupConfigForm mode="ai" ... />` 추가
- handleSubmit data에 `followupConfig` 포함

### 4-4. 연결 관리 목록에 후속 표시

**파일**: `src/components/email/EmailTemplateLinkList.tsx`

- followupConfig가 있는 연결에 Badge 추가: `후속 발송 N일`

### 4-5. AI 자동 발송 목록에 후속 표시

**파일**: `src/components/email/AutoPersonalizedEmailConfig.tsx`

- 카드에 followupConfig 정보 표시: `후속 발송 N일 후`

## 5. Hook 수정

### 5-1. useEmailTemplateLinks.ts

- CreateInput/UpdateInput 타입에 `followupConfig` 추가

### 5-2. useAutoPersonalizedEmail.ts

- AutoPersonalizedLink 인터페이스에 `followupConfig` 추가
- CreateInput/UpdateInput 타입에 `followupConfig` 추가

## 6. 구현 순서

| # | 작업 | 파일 |
|---|------|------|
| 1 | DB 스키마 + 마이그레이션 | schema.ts, 0025_email_followup.sql, _journal.json |
| 2 | 후속 발송 비즈니스 로직 | email-followup.ts (신규) |
| 3 | 기존 발송 로직 수정 (큐 등록) | email-automation.ts, auto-personalized-email.ts |
| 4 | 기존 API 수정 (followupConfig) | template-links/route.ts, [id]/route.ts, auto-personalized/route.ts, [id]/route.ts |
| 5 | 크론 API | process-followups/route.ts (신규) |
| 6 | Hook 수정 | useEmailTemplateLinks.ts, useAutoPersonalizedEmail.ts |
| 7 | FollowupConfigForm UI | FollowupConfigForm.tsx (신규) |
| 8 | Dialog 수정 | EmailTemplateLinkDialog.tsx, AutoPersonalizedEmailConfig.tsx |
| 9 | 목록 Badge 추가 | EmailTemplateLinkList.tsx, AutoPersonalizedEmailConfig.tsx |
| 10 | 빌드 검증 | `npx next build` |

## 7. 검증

- `npx next build` 성공
- 연결 관리 Dialog에서 후속 규칙 설정/저장/수정 확인
- AI 자동 발송 Dialog에서 후속 규칙 설정/저장/수정 확인
- 이메일 발송 성공 시 emailFollowupQueue에 등록되는지 확인
- 크론 API가 읽음 상태 체크 후 조건별로 발송/스킵하는지 확인
