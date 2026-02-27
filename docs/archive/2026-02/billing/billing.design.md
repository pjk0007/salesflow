# Design: billing (결제수단 및 요금제)

## 1. DB 스키마

### 1-1. plans 테이블

```typescript
export const plans = pgTable("plans", {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 50 }).notNull(),        // "Free", "Pro", "Enterprise"
    slug: varchar("slug", { length: 50 }).unique().notNull(), // "free", "pro", "enterprise"
    price: integer("price").notNull(),                        // 월 가격 (원), Free=0
    limits: jsonb("limits").$type<{
        workspaces: number;   // -1 = 무제한
        records: number;
        members: number;
    }>().notNull(),
    features: jsonb("features").$type<string[]>().notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
});
```

초기 데이터 (seed):

| slug | price | workspaces | records | members |
|------|-------|:----------:|:-------:|:-------:|
| free | 0 | 1 | 500 | 2 |
| pro | 29000 | 3 | 10000 | 10 |
| enterprise | 99000 | -1 | -1 | -1 |

### 1-2. subscriptions 테이블

```typescript
export const subscriptions = pgTable("subscriptions", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    planId: integer("plan_id").notNull().references(() => plans.id),
    status: varchar("status", { length: 20 }).notNull().default("active"),
        // "active", "canceled", "past_due"
    currentPeriodStart: timestamptz("current_period_start"),
    currentPeriodEnd: timestamptz("current_period_end"),
    tossCustomerKey: varchar("toss_customer_key", { length: 200 }),
    tossBillingKey: varchar("toss_billing_key", { length: 200 }),
    canceledAt: timestamptz("canceled_at"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});
```

### 1-3. payments 테이블

```typescript
export const payments = pgTable("payments", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    subscriptionId: integer("subscription_id").references(() => subscriptions.id),
    amount: integer("amount").notNull(),
    status: varchar("status", { length: 20 }).notNull(),
        // "ready", "done", "canceled", "failed"
    tossPaymentKey: varchar("toss_payment_key", { length: 200 }),
    tossOrderId: varchar("toss_order_id", { length: 200 }),
    paidAt: timestamptz("paid_at"),
    failReason: text("fail_reason"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
});
```

### 1-4. 마이그레이션

```sql
-- drizzle/0008_billing.sql
CREATE TABLE IF NOT EXISTS "plans" (
    "id" serial PRIMARY KEY,
    "name" varchar(50) NOT NULL,
    "slug" varchar(50) UNIQUE NOT NULL,
    "price" integer NOT NULL,
    "limits" jsonb NOT NULL,
    "features" jsonb NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "subscriptions" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
    "plan_id" integer NOT NULL REFERENCES "plans"("id"),
    "status" varchar(20) NOT NULL DEFAULT 'active',
    "current_period_start" timestamptz,
    "current_period_end" timestamptz,
    "toss_customer_key" varchar(200),
    "toss_billing_key" varchar(200),
    "canceled_at" timestamptz,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "payments" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
    "subscription_id" integer REFERENCES "subscriptions"("id"),
    "amount" integer NOT NULL,
    "status" varchar(20) NOT NULL,
    "toss_payment_key" varchar(200),
    "toss_order_id" varchar(200),
    "paid_at" timestamptz,
    "fail_reason" text,
    "created_at" timestamptz DEFAULT now() NOT NULL
);

-- 초기 플랜 데이터
INSERT INTO "plans" ("name", "slug", "price", "limits", "features", "sort_order") VALUES
    ('Free', 'free', 0, '{"workspaces":1,"records":500,"members":2}', '["워크스페이스 1개","레코드 500건","멤버 2명","기본 대시보드","이메일 발송"]', 0),
    ('Pro', 'pro', 29000, '{"workspaces":3,"records":10000,"members":10}', '["워크스페이스 3개","레코드 10,000건","멤버 10명","AI 도우미","이메일/알림톡 자동화","고급 대시보드"]', 1),
    ('Enterprise', 'enterprise', 99000, '{"workspaces":-1,"records":-1,"members":-1}', '["무제한 워크스페이스","무제한 레코드","무제한 멤버","우선 지원","전용 온보딩","API 접근"]', 2);

-- 기존 조직에 Free 구독 생성
INSERT INTO "subscriptions" ("org_id", "plan_id", "status")
    SELECT o."id", (SELECT "id" FROM "plans" WHERE "slug" = 'free'), 'active'
    FROM "organizations" o
    WHERE NOT EXISTS (SELECT 1 FROM "subscriptions" s WHERE s."org_id" = o."id");
```

## 2. 환경변수

```env
# .env.local
TOSS_CLIENT_KEY=test_ck_... # 클라이언트키 (프론트엔드)
TOSS_SECRET_KEY=test_sk_... # 시크릿키 (서버 전용)
NEXT_PUBLIC_TOSS_CLIENT_KEY=test_ck_... # 프론트엔드에서 접근 가능
```

## 3. 토스페이먼츠 연동 헬퍼

### src/lib/billing.ts

```typescript
// 토스 API 기본 설정
const TOSS_API_BASE = "https://api.tosspayments.com/v1";
const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY!;
const authHeader = `Basic ${Buffer.from(TOSS_SECRET_KEY + ":").toString("base64")}`;

// 빌링키 발급
export async function issueBillingKey(authKey: string, customerKey: string);

// 빌링키로 결제 실행
export async function executeBilling(billingKey: string, params: {
    customerKey: string;
    amount: number;
    orderId: string;
    orderName: string;
});

// 플랜 제한 체크 (서버사이드)
export async function checkPlanLimit(
    orgId: string,
    resource: "workspaces" | "records" | "members",
    currentCount: number
): Promise<{ allowed: boolean; limit: number; plan: string }>;

// 구독 상태 조회 헬퍼
export async function getActiveSubscription(orgId: string);
```

## 4. 결제 플로우

### 4-1. 빌링키 발급 (카드 등록)

```
[클라이언트]                    [서버]                [토스]
    |                             |                     |
    |-- loadTossPayments() ------>|                     |
    |-- requestBillingAuth() -----|                     |
    |   (customerKey, amount,     |                     |
    |    successUrl, failUrl)     |                     |
    |                             |                     |
    |<-- 토스 결제창 표시 --------|                     |
    |    (카드 정보 입력)         |                     |
    |                             |                     |
    |-- [성공] redirect to ------>|                     |
    |   successUrl?authKey=xxx    |                     |
    |   &customerKey=yyy          |                     |
    |                             |-- POST /v1/billing/ |
    |                             |   authorizations/   |
    |                             |   issue             |
    |                             |   {authKey,         |
    |                             |    customerKey}      |
    |                             |                     |
    |                             |<-- billingKey -------|
    |                             |                     |
    |                             |-- DB 저장 ----------|
    |                             |   subscription.     |
    |                             |   tossBillingKey     |
    |<-- 완료 -------------------|                     |
```

### 4-2. 정기결제 (구독 시작)

```
[클라이언트]                    [서버]                [토스]
    |                             |                     |
    |-- POST /api/billing/       |                     |
    |   subscribe                 |                     |
    |   {planSlug}                |                     |
    |                             |                     |
    |                             |-- POST /v1/billing/ |
    |                             |   {billingKey}      |
    |                             |   {amount, orderId, |
    |                             |    customerKey,      |
    |                             |    orderName}        |
    |                             |                     |
    |                             |<-- paymentKey ------|
    |                             |                     |
    |                             |-- DB 저장:          |
    |                             |   subscription 업데이트
    |                             |   payment 생성      |
    |<-- 성공 -------------------|                     |
```

## 5. API 설계

### 5-1. GET /api/billing/status

현재 구독 상태 + 플랜 정보 + 최근 결제 내역 조회.

```typescript
// 응답
{
    success: true,
    data: {
        plan: { name, slug, price, limits, features },
        subscription: { status, currentPeriodStart, currentPeriodEnd, hasBillingKey },
        payments: [{ amount, status, paidAt, tossOrderId }],
        allPlans: [{ name, slug, price, limits, features }]
    }
}
```

### 5-2. POST /api/billing/issue-billing-key

빌링키 발급 (successUrl에서 호출). authKey + customerKey로 토스 API 호출.

```typescript
// 요청
{ authKey: string; customerKey: string }
// 처리: issueBillingKey() → subscription에 tossBillingKey 저장
```

### 5-3. POST /api/billing/subscribe

플랜 변경 + 빌링키로 결제 실행.

```typescript
// 요청
{ planSlug: string }
// 처리:
// 1. 빌링키 확인 (없으면 400)
// 2. Free면 다운그레이드 (결제 없이 변경)
// 3. 유료면 executeBilling() → payment 저장 → subscription 업데이트
```

### 5-4. POST /api/billing/cancel

구독 취소 (Free로 다운그레이드).

```typescript
// 처리: subscription.status = "canceled", planId = Free
```

## 6. UI — BillingTab (설정 > 요금제 탭)

### 6-1. 레이아웃

```
┌─────────────────────────────────────────────────┐
│  현재 플랜                                      │
│  ┌──────────────────────────────────────────┐   │
│  │  Pro 플랜  ₩29,000/월                    │   │
│  │  다음 결제일: 2026-03-26                  │   │
│  │  상태: 활성                               │   │
│  │  [결제 수단 변경]  [구독 취소]            │   │
│  └──────────────────────────────────────────┘   │
│                                                 │
│  플랜 변경                                      │
│  ┌──────┐  ┌──────┐  ┌──────┐                  │
│  │ Free │  │ Pro  │  │ Ent  │                  │
│  │ 무료 │  │29,000│  │99,000│                  │
│  │[현재]│  │[선택]│  │[선택]│                  │
│  └──────┘  └──────┘  └──────┘                  │
│                                                 │
│  결제 내역                                      │
│  ┌──────────────────────────────────────────┐   │
│  │  2026-02-26  ₩29,000  Pro  완료          │   │
│  │  2026-01-26  ₩29,000  Pro  완료          │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### 6-2. 빌링키 없는 경우 (카드 미등록)

유료 플랜 선택 시 → 토스페이먼츠 결제창 호출 (`requestBillingAuth`)
→ successUrl(`/billing/success`) → 서버에서 빌링키 발급 → 구독 시작

### 6-3. 빌링키 있는 경우 (카드 등록 완료)

유료 플랜 선택 시 → 즉시 `POST /api/billing/subscribe` 호출
→ 서버에서 빌링키로 결제 → 완료

## 7. 결제 성공/실패 페이지

### /billing/success

```typescript
// src/pages/billing/success.tsx
// URL: /billing/success?authKey=xxx&customerKey=yyy
// 1. authKey, customerKey 추출
// 2. POST /api/billing/issue-billing-key { authKey, customerKey }
// 3. 성공 시 /settings?tab=billing으로 리다이렉트
// 4. 로딩 + 성공 메시지 표시
```

### /billing/fail

```typescript
// src/pages/billing/fail.tsx
// URL: /billing/fail?code=xxx&message=yyy
// 에러 코드/메시지 표시
// "다시 시도" 버튼 → /settings?tab=billing
```

## 8. 기능 제한 미들웨어

### src/lib/billing.ts — checkPlanLimit()

```typescript
// 사용 위치:
// - POST /api/workspaces → checkPlanLimit(orgId, "workspaces", currentCount)
// - POST /api/partitions/[id]/records → checkPlanLimit(orgId, "records", currentCount)
// - POST /api/org/invitations → checkPlanLimit(orgId, "members", currentCount)

// 제한 초과 시 응답:
// { success: false, error: "플랜 한도를 초과했습니다. 업그레이드가 필요합니다.", upgradeRequired: true }
```

## 9. Signup 시 Free 구독 자동 생성

```typescript
// src/pages/api/auth/signup.ts — 조직 생성 후
// Free 플랜의 subscription 자동 생성
const [freePlan] = await db.select().from(plans).where(eq(plans.slug, "free"));
await db.insert(subscriptions).values({
    orgId: newOrg.id,
    planId: freePlan.id,
    status: "active",
});
```

## 10. 컴포넌트 구조

```
src/lib/billing.ts                      — 토스 API 헬퍼 + 플랜 제한 체크
src/pages/api/billing/
  ├── status.ts                         — GET 구독 상태 조회
  ├── issue-billing-key.ts              — POST 빌링키 발급
  ├── subscribe.ts                      — POST 플랜 변경 + 결제
  └── cancel.ts                         — POST 구독 취소
src/components/settings/BillingTab.tsx  — 요금제 관리 UI
src/pages/billing/
  ├── success.tsx                       — 결제 성공 리다이렉트
  └── fail.tsx                          — 결제 실패 리다이렉트
src/pages/settings.tsx                  — "요금제" 탭 추가
src/pages/api/auth/signup.ts            — Free 구독 자동 생성
```

## 11. 구현 순서

| # | 파일 | 작업 | 검증 |
|---|------|------|------|
| 1 | `src/lib/db/schema.ts` | plans, subscriptions, payments 테이블 | 타입 에러 없음 |
| 2 | `drizzle/0008_billing.sql` | 마이그레이션 + 초기 데이터 | psql 실행 |
| 3 | `src/lib/billing.ts` | 토스 API 헬퍼 + 제한 체크 | 타입 에러 없음 |
| 4 | `src/pages/api/billing/*.ts` | 4개 API | 타입 에러 없음 |
| 5 | `src/components/settings/BillingTab.tsx` | 요금제 UI | 타입 에러 없음 |
| 6 | `src/pages/settings.tsx` | 요금제 탭 추가 | 타입 에러 없음 |
| 7 | `src/pages/billing/success.tsx` | 성공 페이지 | 타입 에러 없음 |
| 8 | `src/pages/billing/fail.tsx` | 실패 페이지 | 타입 에러 없음 |
| 9 | `src/pages/api/auth/signup.ts` | Free 구독 자동 생성 | 타입 에러 없음 |
| 10 | 기능 제한 적용 (workspaces, records, invitations API) | checkPlanLimit 호출 | 타입 에러 없음 |
| 11 | `pnpm build` | 최종 빌드 검증 | 빌드 성공 |
