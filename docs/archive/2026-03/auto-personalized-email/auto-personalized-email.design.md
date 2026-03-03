# Design: auto-personalized-email

## 1. 파일 변경 목록

| # | 파일 | 작업 | LOC |
|---|------|------|-----|
| 1 | `src/lib/db/schema.ts` | `emailAutoPersonalizedLinks` 테이블 추가 | +20 |
| 2 | `drizzle/0015_email_auto_personalized.sql` | 마이그레이션 | +15 |
| 3 | `src/lib/auto-personalized-email.ts` | 자동화 엔진 (핵심 파이프라인) | ~150 |
| 4 | `src/app/api/email/auto-personalized/route.ts` | GET, POST API | ~120 |
| 5 | `src/app/api/email/auto-personalized/[id]/route.ts` | PUT, DELETE API | ~100 |
| 6 | `src/hooks/useAutoPersonalizedEmail.ts` | SWR 훅 | ~60 |
| 7 | `src/components/email/AutoPersonalizedEmailConfig.tsx` | 관리 UI (규칙 목록 + 생성/수정 Dialog) | ~350 |
| 8 | `src/app/email/page.tsx` | "AI 자동발송" 탭 추가 | +10 |
| 9 | `src/app/api/partitions/[id]/records/route.ts` | 트리거 호출 추가 (on_create) | +5 |
| 10 | `src/app/api/records/[id]/route.ts` | 트리거 호출 추가 (on_update) | +5 |
| 11 | `src/app/api/v1/records/route.ts` | 트리거 호출 추가 (on_create) | +5 |
| 12 | `src/app/api/v1/records/[id]/route.ts` | 트리거 호출 추가 (on_update) | +5 |

## 2. 상세 설계

### 2-1. `src/lib/db/schema.ts` — emailAutoPersonalizedLinks 테이블

```typescript
// ============================================
// AI 개인화 이메일 자동 발송 규칙
// ============================================
export const emailAutoPersonalizedLinks = pgTable("email_auto_personalized_links", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    partitionId: integer("partition_id")
        .references(() => partitions.id, { onDelete: "cascade" })
        .notNull(),
    productId: integer("product_id")
        .references(() => products.id, { onDelete: "set null" }),
    recipientField: varchar("recipient_field", { length: 100 }).notNull(),
    companyField: varchar("company_field", { length: 100 }).notNull(),
    prompt: text("prompt"),
    tone: varchar("tone", { length: 50 }),
    triggerType: varchar("trigger_type", { length: 20 }).default("on_create").notNull(),
    triggerCondition: jsonb("trigger_condition").$type<{
        field?: string;
        operator?: "eq" | "ne" | "contains";
        value?: string;
    }>(),
    autoResearch: integer("auto_research").default(1).notNull(),
    isActive: integer("is_active").default(1).notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

export type EmailAutoPersonalizedLink = typeof emailAutoPersonalizedLinks.$inferSelect;
```

타입 export는 schema.ts 맨 아래 기존 type 블록에 추가.

### 2-2. `drizzle/0015_email_auto_personalized.sql` — 마이그레이션

```sql
CREATE TABLE IF NOT EXISTS "email_auto_personalized_links" (
    "id" serial PRIMARY KEY NOT NULL,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "partition_id" integer NOT NULL REFERENCES "partitions"("id") ON DELETE CASCADE,
    "product_id" integer REFERENCES "products"("id") ON DELETE SET NULL,
    "recipient_field" varchar(100) NOT NULL,
    "company_field" varchar(100) NOT NULL,
    "prompt" text,
    "tone" varchar(50),
    "trigger_type" varchar(20) NOT NULL DEFAULT 'on_create',
    "trigger_condition" jsonb,
    "auto_research" integer NOT NULL DEFAULT 1,
    "is_active" integer NOT NULL DEFAULT 1,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "eapl_partition_idx" ON "email_auto_personalized_links" ("partition_id");
```

drizzle/meta/_journal.json에 idx 15 항목 추가.

### 2-3. `src/lib/auto-personalized-email.ts` — 자동화 엔진

```typescript
import { db, emailAutoPersonalizedLinks, emailSendLogs, records, products } from "@/lib/db";
import { eq, and, gte, inArray } from "drizzle-orm";
import { getEmailClient, getEmailConfig } from "@/lib/nhn-email";
import { getAiClient, generateEmail, generateCompanyResearch, logAiUsage } from "@/lib/ai";
import { evaluateCondition } from "@/lib/alimtalk-automation";
import type { DbRecord } from "@/lib/db";

// ============================================
// 쿨다운 체크 (같은 record + link에 1시간 내 발송 이력)
// ============================================
async function checkCooldown(
    recordId: number,
    linkId: number,
    cooldownHours: number = 1
): Promise<boolean> {
    const since = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);
    const [existing] = await db
        .select({ id: emailSendLogs.id })
        .from(emailSendLogs)
        .where(
            and(
                eq(emailSendLogs.recordId, recordId),
                eq(emailSendLogs.triggerType, "ai_auto"),
                gte(emailSendLogs.sentAt, since),
                inArray(emailSendLogs.status, ["sent", "pending"])
            )
        )
        .limit(1);
    return !existing;
}

// ============================================
// 메인 자동화 함수
// ============================================
interface AutoPersonalizedParams {
    record: DbRecord;
    partitionId: number;
    triggerType: "on_create" | "on_update";
    orgId: string;
}

export async function processAutoPersonalizedEmail(params: AutoPersonalizedParams): Promise<void> {
    const { record, partitionId, triggerType, orgId } = params;

    // 1. 매칭되는 규칙 조회
    const links = await db
        .select()
        .from(emailAutoPersonalizedLinks)
        .where(
            and(
                eq(emailAutoPersonalizedLinks.partitionId, partitionId),
                eq(emailAutoPersonalizedLinks.triggerType, triggerType),
                eq(emailAutoPersonalizedLinks.isActive, 1)
            )
        );

    if (links.length === 0) return;

    const data = record.data as Record<string, unknown>;

    for (const link of links) {
        try {
            // 2. 조건 평가
            if (!evaluateCondition(link.triggerCondition as Parameters<typeof evaluateCondition>[0], data)) {
                continue;
            }

            // 3. 쿨다운 체크
            const canSend = await checkCooldown(record.id, link.id);
            if (!canSend) continue;

            // 4. 수신자 이메일 추출
            const email = data[link.recipientField];
            if (!email || typeof email !== "string" || !email.includes("@")) continue;

            // 5. AI 클라이언트 확인
            const aiClient = await getAiClient(orgId);
            if (!aiClient) continue;

            // 6. 이메일 클라이언트 확인
            const emailClient = await getEmailClient(orgId);
            if (!emailClient) continue;
            const emailConfig = await getEmailConfig(orgId);
            if (!emailConfig?.fromEmail) continue;

            // 7. 회사 조사 (autoResearch && _companyResearch 없으면)
            let recordData = { ...data };
            if (link.autoResearch === 1 && !recordData._companyResearch) {
                const companyName = data[link.companyField] as string;
                if (companyName && typeof companyName === "string" && companyName.trim()) {
                    const research = await generateCompanyResearch(aiClient, { companyName });
                    recordData._companyResearch = {
                        ...research,
                        sources: research.sources,
                        researchedAt: new Date().toISOString(),
                    };

                    // 레코드에 _companyResearch 저장
                    await db
                        .update(records)
                        .set({ data: { ...data, _companyResearch: recordData._companyResearch } })
                        .where(eq(records.id, record.id));

                    await logAiUsage({
                        orgId,
                        userId: "system",
                        provider: aiClient.provider,
                        model: aiClient.model,
                        promptTokens: research.usage.promptTokens,
                        completionTokens: research.usage.completionTokens,
                        purpose: "auto_company_research",
                    });
                }
            }

            // 8. 제품 조회
            let product = null;
            if (link.productId) {
                const [p] = await db
                    .select()
                    .from(products)
                    .where(eq(products.id, link.productId))
                    .limit(1);
                product = p ?? null;
            }

            // 9. AI 이메일 생성
            const prompt = link.prompt || "이 회사에 적합한 제품 소개 이메일을 작성해주세요.";
            const emailResult = await generateEmail(aiClient, {
                prompt,
                product,
                recordData,
                tone: link.tone || undefined,
                ctaUrl: product?.url || undefined,
            });

            await logAiUsage({
                orgId,
                userId: "system",
                provider: aiClient.provider,
                model: aiClient.model,
                promptTokens: emailResult.usage.promptTokens,
                completionTokens: emailResult.usage.completionTokens,
                purpose: "auto_personalized_email",
            });

            // 10. NHN Cloud 이메일 발송
            const nhnResult = await emailClient.sendEachMail({
                senderAddress: emailConfig.fromEmail,
                senderName: emailConfig.fromName || undefined,
                title: emailResult.subject,
                body: emailResult.htmlBody,
                receiverList: [{ receiveMailAddr: email, receiveType: "MRT0" }],
            });

            const isSuccess = nhnResult.header.isSuccessful;
            const sendResult = nhnResult.data?.results?.[0];

            // 11. 발송 로그 기록
            await db.insert(emailSendLogs).values({
                orgId,
                partitionId,
                recordId: record.id,
                recipientEmail: email,
                subject: emailResult.subject,
                requestId: nhnResult.data?.requestId,
                status: isSuccess ? "sent" : "failed",
                resultCode: sendResult ? String(sendResult.resultCode) : null,
                resultMessage: sendResult?.resultMessage ?? nhnResult.header.resultMessage,
                triggerType: "ai_auto",
                sentAt: new Date(),
            });
        } catch (err) {
            console.error(`Auto personalized email error (link ${link.id}, record ${record.id}):`, err);
        }
    }
}
```

**핵심 설계 포인트**:
- `emailSendLogs.templateLinkId`는 null (AI 생성이므로 기존 templateLink 없음)
- `emailSendLogs.emailTemplateId`도 null (템플릿 사용하지 않음)
- `triggerType: "ai_auto"` — 기존 "manual"/"auto"/"repeat"와 구분
- `logAiUsage` userId: `"system"` — 자동 트리거이므로 유저 없음
- 각 link 처리를 try/catch로 감싸서 하나의 실패가 다른 링크에 영향 안줌
- `_companyResearch` 저장 시 기존 data를 스프레드하여 다른 필드 보존

### 2-4. `src/app/api/email/auto-personalized/route.ts` — GET, POST

```typescript
// GET /api/email/auto-personalized?partitionId=N
// Auth: JWT
export async function GET(req: NextRequest) {
    // 1. getUserFromNextRequest(req) — 인증
    // 2. partitionId 필수 (query param)
    // 3. 파티션 소유권 확인 (partitions JOIN workspaces WHERE orgId)
    // 4. SELECT emailAutoPersonalizedLinks WHERE partitionId
    //    LEFT JOIN products ON productId = products.id (제품명 포함)
    // 5. 반환: { success: true, data: links[] }
    //    links[]: { ...link, productName: string | null }
}

// POST /api/email/auto-personalized
// Auth: JWT
export async function POST(req: NextRequest) {
    // 1. getUserFromNextRequest(req) — 인증
    // 2. body: {
    //      partitionId, productId?, recipientField, companyField,
    //      prompt?, tone?, triggerType, triggerCondition?,
    //      autoResearch?
    //    }
    // 3. 유효성:
    //    - partitionId, recipientField, companyField 필수
    //    - triggerType: "on_create" | "on_update"
    // 4. 파티션 소유권 확인
    // 5. productId 있으면 → 해당 제품이 org에 속하는지 확인
    // 6. INSERT emailAutoPersonalizedLinks
    //    orgId는 user.orgId에서 가져옴
    // 7. 반환: { success: true, data: created }
}
```

### 2-5. `src/app/api/email/auto-personalized/[id]/route.ts` — PUT, DELETE

```typescript
// PUT /api/email/auto-personalized/[id]
// Auth: JWT
export async function PUT(req: NextRequest, { params }) {
    // 1. 인증
    // 2. 링크 소유권 확인 (orgId)
    // 3. body: { productId?, recipientField?, companyField?, prompt?, tone?,
    //           triggerType?, triggerCondition?, autoResearch?, isActive? }
    // 4. productId 변경 시 → org 소유권 확인
    // 5. UPDATE emailAutoPersonalizedLinks SET ... WHERE id
    // 6. 반환: { success: true, data: updated }
}

// DELETE /api/email/auto-personalized/[id]
// Auth: JWT
export async function DELETE(req: NextRequest, { params }) {
    // 1. 인증
    // 2. 링크 소유권 확인 (orgId)
    // 3. DELETE emailAutoPersonalizedLinks WHERE id
    // 4. 반환: { success: true, message: "규칙이 삭제되었습니다." }
}
```

### 2-6. `src/hooks/useAutoPersonalizedEmail.ts` — SWR 훅

```typescript
import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface AutoPersonalizedLink {
    id: number;
    orgId: string;
    partitionId: number;
    productId: number | null;
    productName: string | null; // JOIN으로 가져옴
    recipientField: string;
    companyField: string;
    prompt: string | null;
    tone: string | null;
    triggerType: string;
    triggerCondition: {
        field?: string;
        operator?: "eq" | "ne" | "contains";
        value?: string;
    } | null;
    autoResearch: number;
    isActive: number;
    createdAt: string;
    updatedAt: string;
}

interface CreateInput {
    partitionId: number;
    productId?: number | null;
    recipientField: string;
    companyField: string;
    prompt?: string;
    tone?: string;
    triggerType: "on_create" | "on_update";
    triggerCondition?: { field: string; operator: string; value: string } | null;
    autoResearch?: number;
}

interface UpdateInput {
    productId?: number | null;
    recipientField?: string;
    companyField?: string;
    prompt?: string;
    tone?: string;
    triggerType?: string;
    triggerCondition?: { field: string; operator: string; value: string } | null;
    autoResearch?: number;
    isActive?: number;
}

export function useAutoPersonalizedEmail(partitionId: number | null) {
    const { data, error, isLoading, mutate } = useSWR(
        partitionId ? `/api/email/auto-personalized?partitionId=${partitionId}` : null,
        fetcher
    );

    const createLink = async (input: CreateInput) => {
        const res = await fetch("/api/email/auto-personalized", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const updateLink = async (id: number, input: UpdateInput) => {
        const res = await fetch(`/api/email/auto-personalized/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const deleteLink = async (id: number) => {
        const res = await fetch(`/api/email/auto-personalized/${id}`, {
            method: "DELETE",
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        links: (data?.data ?? []) as AutoPersonalizedLink[],
        isLoading,
        error,
        createLink,
        updateLink,
        deleteLink,
    };
}
```

### 2-7. `src/components/email/AutoPersonalizedEmailConfig.tsx` — 관리 UI

```
레이아웃:
┌──────────────────────────────────────────────┐
│ Card: AI 개인화 이메일 자동 발송               │
│ ┌────────────────────────────────────────────┐│
│ │ CardHeader: 제목 + 파티션 Select + "규칙 추가" 버튼 ││
│ ├────────────────────────────────────────────┤│
│ │ 빈 상태: "등록된 자동 발송 규칙이 없습니다." ││
│ │                                            ││
│ │ 규칙 목록 (각 항목):                        ││
│ │ ┌────────────────────────────────────┐     ││
│ │ │ 🟢 "SalesFlow Pro" | on_create    │     ││
│ │ │ 수신: email | 회사: company       │     ││
│ │ │ 자동 조사: ✅ | 톤: 전문적         │     ││
│ │ │              Switch [수정] [삭제]  │     ││
│ │ └────────────────────────────────────┘     ││
│ └────────────────────────────────────────────┘│
└──────────────────────────────────────────────┘

생성/수정 Dialog:
┌──────────────────────────────────────────────┐
│ DialogHeader: "AI 개인화 발송 규칙 추가/수정"  │
├──────────────────────────────────────────────┤
│ [제품] Select (products 목록, 선택)            │
│ [트리거] Select (레코드 생성 시 / 수정 시)      │
│ [수신자 이메일 필드] Select (workspace fields)  │
│ [회사명 필드] Select (workspace fields)        │
│ [AI 지시사항] Textarea (optional)             │
│ [톤] Select (전문적/친근한/격식있는, optional)   │
│ [발송 조건] optional expandable:              │
│   - 필드 Select + 연산자 Select + 값 Input    │
│ [회사 자동 조사] Switch (default: on)          │
├──────────────────────────────────────────────┤
│ [취소] [저장]                                 │
└──────────────────────────────────────────────┘
```

**Props**:
```typescript
interface AutoPersonalizedEmailConfigProps {
    partitions: Array<{ id: number; name: string }>;
    fields: Array<{ key: string; label: string; fieldType: string }>;
}
```

**State**:
```typescript
const [selectedPartitionId, setSelectedPartitionId] = useState<number | null>(null);
const [dialogOpen, setDialogOpen] = useState(false);
const [editingLink, setEditingLink] = useState<AutoPersonalizedLink | null>(null);
const [deleteTarget, setDeleteTarget] = useState<AutoPersonalizedLink | null>(null);
```

**Dialog form state**:
```typescript
const [productId, setProductId] = useState<number | null>(null);
const [triggerType, setTriggerType] = useState<"on_create" | "on_update">("on_create");
const [recipientField, setRecipientField] = useState("");
const [companyField, setCompanyField] = useState("");
const [prompt, setPrompt] = useState("");
const [tone, setTone] = useState("");
const [autoResearch, setAutoResearch] = useState(true);
const [conditionEnabled, setConditionEnabled] = useState(false);
const [conditionField, setConditionField] = useState("");
const [conditionOperator, setConditionOperator] = useState("eq");
const [conditionValue, setConditionValue] = useState("");
const [submitting, setSubmitting] = useState(false);
```

**제품 목록 조회**: `useProducts()` 훅 또는 `useSWR("/api/products?activeOnly=1", fetcher)` 로 활성 제품 목록 가져옴.

**UI 컴포넌트 사용**: Card, CardHeader, CardTitle, CardContent, Select, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Textarea, Switch, Button, Badge, AlertDialog, Loader2

**규칙 목록 각 항목**:
- 제품명 (Badge) + 트리거 유형 (Badge: "생성 시" / "수정 시")
- 수신 필드 + 회사 필드 (텍스트)
- 자동 조사 여부 + 톤 (텍스트)
- 활성/비활성 Switch — 즉시 updateLink({ isActive: 0|1 })
- 수정 버튼 → Dialog 열기 (editingLink 설정)
- 삭제 버튼 → AlertDialog 확인

**톤 옵션**:
```typescript
const TONE_OPTIONS = [
    { value: "", label: "기본" },
    { value: "professional", label: "전문적" },
    { value: "friendly", label: "친근한" },
    { value: "formal", label: "격식있는" },
];
```

### 2-8. `src/app/email/page.tsx` — "AI 자동발송" 탭 추가

```diff
+ import AutoPersonalizedEmailConfig from "@/components/email/AutoPersonalizedEmailConfig";

  <TabsList>
      ...
      <TabsTrigger value="settings">설정</TabsTrigger>
+     <TabsTrigger value="ai-auto">AI 자동발송</TabsTrigger>
  </TabsList>

+ <TabsContent value="ai-auto" className="mt-6">
+     <AutoPersonalizedEmailConfig partitions={partitions} fields={fields} />
+ </TabsContent>
```

### 2-9~12. 레코드 API 4곳 — 트리거 호출 추가

각 파일에 import + 호출 추가. 기존 `processAutoTrigger`/`processEmailAutoTrigger` 패턴과 동일:

```typescript
// import 추가
import { processAutoPersonalizedEmail } from "@/lib/auto-personalized-email";

// 레코드 생성/수정 후 (기존 processEmailAutoTrigger 호출 바로 다음):
processAutoPersonalizedEmail({
    record: result,  // 또는 updated (PATCH/PUT에서)
    partitionId,     // 또는 updated.partitionId
    triggerType: "on_create",  // 또는 "on_update"
    orgId: user.orgId,  // 또는 tokenInfo.orgId (외부 API)
}).catch((err) => console.error("Auto personalized email error:", err));
```

**파일별 변경 위치**:

| 파일 | 변경 위치 | triggerType |
|------|-----------|-------------|
| `partitions/[id]/records/route.ts` | POST 핸들러, `processEmailAutoTrigger` 다음 | `"on_create"` |
| `records/[id]/route.ts` | PATCH 핸들러, `processEmailAutoTrigger` 다음 | `"on_update"` |
| `v1/records/route.ts` | POST 핸들러, `processEmailAutoTrigger` 다음 | `"on_create"` |
| `v1/records/[id]/route.ts` | PUT 핸들러, `processEmailAutoTrigger` 다음 | `"on_update"` |

## 3. 구현 순서

| # | 파일 | 의존 | 검증 |
|---|------|------|------|
| 1 | `schema.ts` + `0015_email_auto_personalized.sql` + `_journal.json` | 없음 | 타입 에러 없음 |
| 2 | `auto-personalized-email.ts` (자동화 엔진) | schema, ai.ts, nhn-email.ts | 타입 에러 없음 |
| 3 | `/api/email/auto-personalized/route.ts` (GET, POST) | schema | 타입 에러 없음 |
| 4 | `/api/email/auto-personalized/[id]/route.ts` (PUT, DELETE) | schema | 타입 에러 없음 |
| 5 | 레코드 API 4곳에 트리거 추가 | auto-personalized-email.ts | 타입 에러 없음 |
| 6 | `useAutoPersonalizedEmail.ts` | API routes | — |
| 7 | `AutoPersonalizedEmailConfig.tsx` | hook, useProducts | — |
| 8 | `email/page.tsx` — 탭 추가 | component | `pnpm build` 성공 |
