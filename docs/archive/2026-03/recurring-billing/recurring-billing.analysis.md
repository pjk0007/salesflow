# recurring-billing Analysis Report

> **Analysis Type**: Gap Analysis (Design vs Implementation)
>
> **Project**: SalesFlow
> **Analyst**: gap-detector
> **Date**: 2026-03-03
> **Design Doc**: [recurring-billing.design.md](../02-design/features/recurring-billing.design.md)
> **Plan Doc**: [recurring-billing.plan.md](../01-plan/features/recurring-billing.plan.md)

---

## 1. Analysis Overview

### 1.1 Analysis Purpose

Verify that the recurring-billing implementation (auto renewal, retry, suspend) matches the design document specifications across all 7 implementation files.

### 1.2 Analysis Scope

- **Design Document**: `docs/02-design/features/recurring-billing.design.md`
- **Plan Document**: `docs/01-plan/features/recurring-billing.plan.md`
- **Implementation Files**:
  1. `src/lib/db/schema.ts` -- subscriptions table columns
  2. `drizzle/0016_billing_retry.sql` -- migration SQL
  3. `drizzle/meta/_journal.json` -- journal idx 16 entry
  4. `src/lib/billing.ts` -- business logic functions
  5. `src/app/api/billing/renew/route.ts` -- cron endpoint
  6. `src/app/api/billing/status/route.ts` -- status query changes
  7. `src/components/settings/BillingTab.tsx` -- suspended UI
- **Analysis Date**: 2026-03-03

---

## 2. Gap Analysis (Design vs Implementation)

### 2.1 Data Model -- subscriptions Table (schema.ts)

| # | Design Specification | Implementation | Status | Notes |
|---|---------------------|----------------|--------|-------|
| 1 | `retryCount: integer("retry_count").default(0).notNull()` | `retryCount: integer("retry_count").default(0).notNull()` (schema.ts:804) | MATCH | Exact match |
| 2 | `nextRetryAt: timestamptz("next_retry_at")` | `nextRetryAt: timestamptz("next_retry_at")` (schema.ts:805) | MATCH | Exact match, nullable as designed |

### 2.2 Migration SQL (drizzle/0016_billing_retry.sql)

| # | Design Specification | Implementation | Status | Notes |
|---|---------------------|----------------|--------|-------|
| 3 | `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "retry_count" integer DEFAULT 0 NOT NULL;` | Identical (line 1) | MATCH | |
| 4 | `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "next_retry_at" timestamp with time zone;` | Identical (line 2) | MATCH | |

### 2.3 Journal Entry (drizzle/meta/_journal.json)

| # | Design Specification | Implementation | Status | Notes |
|---|---------------------|----------------|--------|-------|
| 5 | idx 16 entry for `0016_billing_retry` | `{ "idx": 16, "version": "7", "tag": "0016_billing_retry", "breakpoints": true }` (_journal.json:118-123) | MATCH | |

### 2.4 API Endpoint -- POST /api/billing/renew (route.ts)

| # | Design Specification | Implementation | Status | Notes |
|---|---------------------|----------------|--------|-------|
| 6 | Auth: `Authorization: Bearer {CRON_SECRET}` header | `authHeader !== Bearer ${CRON_SECRET}` check (route.ts:8) | MATCH | |
| 7 | 401 response on auth failure | `{ success: false, error: "Unauthorized" }` with status 401 (route.ts:9-12) | MATCH | |
| 8 | Request body: none (batch processing) | No body parsing (route.ts:16-17) | MATCH | |
| 9 | Calls `processRenewals()` then `processRetries()` | Sequential calls: `processRenewals()` then `processRetries()` (route.ts:16-17) | MATCH | |
| 10 | Response 200: `{ success: true, data: { renewed, retried, suspended, errors } }` | `{ success: true, data: { renewed, renewFailed, retried, suspended, errors } }` (route.ts:19-27) | CHANGED | Extra `renewFailed` field added; design only specifies `renewed`, `retried`, `suspended`, `errors` |
| 11 | 500 response on exception | `{ success: false, error: "..." }` with status 500 (route.ts:30-34) | MATCH | |
| 12 | CRON_SECRET env var check | `const CRON_SECRET = process.env.CRON_SECRET || ""` (route.ts:4) | MATCH | |

### 2.5 Business Logic -- processRenewals() (billing.ts)

| # | Design Specification | Implementation | Status | Notes |
|---|---------------------|----------------|--------|-------|
| 13 | Return type: `{ renewed, failed, errors }` | `{ renewed: number; failed: number; errors: string[] }` (billing.ts:158-161) | MATCH | |
| 14 | Query condition: `status = "active"` | `eq(subscriptions.status, "active")` (billing.ts:178) | MATCH | |
| 15 | Query condition: `currentPeriodEnd <= now` | `lte(subscriptions.currentPeriodEnd, now)` (billing.ts:179) | MATCH | |
| 16 | Query condition: `tossBillingKey IS NOT NULL` | `isNotNull(subscriptions.tossBillingKey)` (billing.ts:180) | MATCH | |
| 17 | Query condition: `retryCount = 0` | `eq(subscriptions.retryCount, 0)` (billing.ts:181) | MATCH | |
| 18 | orderId format: `renew_{orgId.slice(0,8)}_{timestamp}` | `renew_${sub.orgId.replace(/-/g, "").slice(0, 8)}_${Date.now()}` (billing.ts:191) | MATCH | UUID dashes stripped before slice -- acceptable |
| 19 | Success: period start = now, end = now + 1 month | `periodStart = new Date()`, `periodEnd.setMonth(+1)` (billing.ts:201-203) | MATCH | |
| 20 | Success: payment record with status "done" | `status: "done"`, paymentKey, orderId, paidAt (billing.ts:214-222) | MATCH | |
| 21 | Failure: retryCount = 1 | `retryCount: 1` (billing.ts:233) | MATCH | |
| 22 | Failure: nextRetryAt = now + 1 day | `nextRetry.setDate(nextRetry.getDate() + RETRY_INTERVALS[0])` where RETRY_INTERVALS[0] = 1 (billing.ts:228) | MATCH | |
| 23 | Failure: payment record (status="failed", failReason) | `status: "failed"`, `failReason: reason` (billing.ts:239-246) | MATCH | |
| 24 | Plan info query (amount, name) | `db.select().from(plans).where(eq(plans.id, sub.planId))` (billing.ts:188) | MATCH | |
| 25 | Skip if price = 0 | `if (!plan || plan.price === 0) continue` (billing.ts:189) | MATCH | Defensive -- not explicit in design but correct |
| 26 | orderName: `SalesFlow {planName} 플랜 갱신` | `SalesFlow ${plan.name} 플랜 갱신` (billing.ts:198) | MATCH | |

### 2.6 Business Logic -- processRetries() (billing.ts)

| # | Design Specification | Implementation | Status | Notes |
|---|---------------------|----------------|--------|-------|
| 27 | Return type: `{ retried, suspended, errors }` | `{ retried: number; suspended: number; errors: string[] }` (billing.ts:256-259) | MATCH | |
| 28 | Query condition: `status = "active"` | `eq(subscriptions.status, "active")` (billing.ts:276) | MATCH | |
| 29 | Query condition: `nextRetryAt <= now` | `lte(subscriptions.nextRetryAt, now)` (billing.ts:277) | MATCH | |
| 30 | Query condition: `retryCount > 0` | `gt(subscriptions.retryCount, 0)` (billing.ts:278) | MATCH | |
| 31 | Query condition: `retryCount <= 3` | NOT present in implementation | CHANGED | Missing upper bound. Functionally safe because suspended sets status="suspended" and retryCount=0, but defensive check omitted. |
| 32 | Success: retryCount = 0, nextRetryAt = null | `retryCount: 0`, `nextRetryAt: null` (billing.ts:307-308) | MATCH | |
| 33 | Success: period renewal + payment record | Period start/end updated + payment with "done" (billing.ts:298-321) | MATCH | |
| 34 | Failure + retryCount < 3: retryCount++, nextRetryAt interval | `nextCount = sub.retryCount + 1`, interval from `RETRY_INTERVALS[nextCount]` (billing.ts:326-342) | MATCH | |
| 35 | Failure + retryCount >= 3: suspendSubscription() | `if (nextCount >= 3) suspendSubscription(sub.id)` (billing.ts:328-329) | MATCH | |
| 36 | Retry interval: 1->2 = +3 days, 2->3 = +7 days | `RETRY_INTERVALS = [1, 3, 7]`, indexed by `nextCount` (billing.ts:156, 333) | MATCH | |
| 37 | Failure: payment record (failed + failReason) | `status: "failed"`, `failReason: reason` (billing.ts:345-352) | MATCH | |

### 2.7 Business Logic -- suspendSubscription() (billing.ts)

| # | Design Specification | Implementation | Status | Notes |
|---|---------------------|----------------|--------|-------|
| 38 | Param: `subscriptionId: number` | `subscriptionId: number` (billing.ts:361) | MATCH | |
| 39 | Return: `Promise<void>` | `Promise<void>` (billing.ts:361) | MATCH | |
| 40 | Free plan lookup: `slug = "free"` | `eq(plans.slug, "free")` (billing.ts:363-365) | MATCH | |
| 41 | Error if free plan not found | `throw new Error("Free 플랜을 찾을 수 없습니다.")` (billing.ts:368) | MATCH | |
| 42 | Set status = "suspended" | `status: "suspended"` (billing.ts:374) | MATCH | |
| 43 | Set planId = freePlan.id | `planId: freePlan.id` (billing.ts:375) | MATCH | |
| 44 | Set retryCount = 0, nextRetryAt = null | `retryCount: 0`, `nextRetryAt: null` (billing.ts:376-377) | MATCH | |
| 45 | Payment record: status="failed", failReason="재시도 소진 -- 구독 일시정지" | NOT implemented | MISSING | Design section 5.3 specifies a payment record on suspend, but the implementation does not insert one. |

### 2.8 API -- /api/billing/status (route.ts changes)

| # | Design Specification | Implementation | Status | Notes |
|---|---------------------|----------------|--------|-------|
| 46 | Query: `status IN ("active", "suspended")` | `or(eq(status, "active"), eq(status, "suspended"))` (route.ts:35-38) | MATCH | |
| 47 | Response includes `retryCount` field | `retryCount: sub.retryCount` (route.ts:88) | MATCH | |
| 48 | Design says update `getActiveSubscription()` | Inline query in route.ts instead; `getActiveSubscription()` in billing.ts unchanged (still active only) | CHANGED | Functional equivalent achieved via separate inline query, but helper function not updated as designed |

### 2.9 UI -- BillingTab.tsx

| # | Design Specification | Implementation | Status | Notes |
|---|---------------------|----------------|--------|-------|
| 49 | BillingData.subscription.retryCount added | `retryCount: number` in BillingData interface (BillingTab.tsx:42) | MATCH | |
| 50 | BillingData.subscription.status includes "suspended" | `status: string` (BillingTab.tsx:37) | MATCH | String type accommodates both |
| 51 | Suspended badge: red `destructive` variant | `<Badge variant="destructive">일시정지</Badge>` (BillingTab.tsx:196-197) | MATCH | |
| 52 | Warning message on suspended | AlertTriangle icon + "결제 실패로 구독이 일시정지되었습니다." (BillingTab.tsx:204-211) | MATCH | |
| 53 | Sub-message: card re-register prompt | "카드를 재등록하면 즉시 결제 후 구독이 복구됩니다." (BillingTab.tsx:210-211) | MATCH | Slightly different wording ("즉시 결제 후" added, "즉시 복구" in design) -- acceptable |
| 54 | Card re-register button calling `openTossPayment()` | `<Button onClick={() => openTossPayment(currentSlug)}>카드 재등록하기</Button>` (BillingTab.tsx:213-219) | MATCH | |
| 55 | Next payment date display (currentPeriodEnd) | `formatDate(data.subscription.currentPeriodEnd)` shown when not suspended (BillingTab.tsx:199-203) | MATCH | |
| 56 | Hide cancel button when suspended | Cancel button rendered only when `isPaid && !isSuspended` (BillingTab.tsx:222) | MATCH | Correct -- suspended users should not see cancel |
| 57 | `isSuspended` derived from status | `const isSuspended = data.subscription?.status === "suspended"` (BillingTab.tsx:177) | MATCH | |

### 2.10 Environment Variable

| # | Design Specification | Implementation | Status | Notes |
|---|---------------------|----------------|--------|-------|
| 58 | CRON_SECRET in .env.local | No `.env.example` file exists; CRON_SECRET used in code via `process.env.CRON_SECRET` | CHANGED | Design says ".env.local에 추가 필요" -- no `.env.example` template documents this variable |

---

## 3. Match Rate Summary

```
Total Items Checked:  58
  MATCH:              53  (91.4%)
  CHANGED:             4  ( 6.9%)
  MISSING:             1  ( 1.7%)

Overall Match Rate:  91.4%
```

---

## 4. Differences Found

### 4.1 MISSING -- Design O, Implementation X

| # | Item | Design Location | Description |
|---|------|-----------------|-------------|
| 45 | suspendSubscription payment record | design.md Section 5.3 | Design specifies inserting a payment record with `status="failed"` and `failReason="재시도 소진 -- 구독 일시정지"` when suspending. Implementation only updates the subscription row without creating a payment log. |

### 4.2 CHANGED -- Design != Implementation

| # | Item | Design | Implementation | Impact |
|---|------|--------|----------------|--------|
| 10 | Renew API response shape | `{ renewed, retried, suspended, errors }` | `{ renewed, renewFailed, retried, suspended, errors }` | Low -- extra field `renewFailed` added, no field removed |
| 31 | processRetries query upper bound | `retryCount <= 3` in WHERE clause | No upper bound filter | Low -- functionally safe (suspended sets retryCount=0 + status change), but missing defensive guard |
| 48 | getActiveSubscription update | Design says update `getActiveSubscription()` to include suspended | Inline query in status route instead; original helper unchanged | Low -- functional result identical, but code diverges from designed approach |
| 58 | CRON_SECRET .env.example | Design mentions .env.local addition needed | No .env.example file exists to document the variable | Low -- operational documentation gap |

---

## 5. Code Quality Notes

### 5.1 Positive Patterns (Non-Gap)

- Defensive null checks on `tossBillingKey` and `tossCustomerKey` before processing (billing.ts:186, 283)
- Skip free plans (price === 0) to avoid unnecessary API calls (billing.ts:189, 286)
- UUID dash stripping in orderId for cleaner IDs (billing.ts:191)
- `updatedAt: new Date()` on all subscription updates
- Error aggregation with org-level detail in error arrays
- `RETRY_INTERVALS` constant array for clear retry schedule configuration (billing.ts:156)
- Proper try/catch per subscription (individual failures don't block batch)

### 5.2 Security

- CRON_SECRET empty string fallback prevents undefined comparison bypass (route.ts:4)
- Empty CRON_SECRET check: `!CRON_SECRET || authHeader !== ...` ensures env var must be set (route.ts:8)

---

## 6. Architecture Compliance

| Layer | Component | Expected Location | Actual Location | Status |
|-------|-----------|-------------------|-----------------|--------|
| Infrastructure | schema changes | `src/lib/db/schema.ts` | `src/lib/db/schema.ts` | MATCH |
| Infrastructure | migration | `drizzle/0016_billing_retry.sql` | `drizzle/0016_billing_retry.sql` | MATCH |
| Application | business logic | `src/lib/billing.ts` | `src/lib/billing.ts` | MATCH |
| Presentation (API) | cron endpoint | `src/app/api/billing/renew/route.ts` | `src/app/api/billing/renew/route.ts` | MATCH |
| Presentation (API) | status endpoint | `src/app/api/billing/status/route.ts` | `src/app/api/billing/status/route.ts` | MATCH |
| Presentation (UI) | billing tab | `src/components/settings/BillingTab.tsx` | `src/components/settings/BillingTab.tsx` | MATCH |

Architecture Compliance: 100%

---

## 7. Convention Compliance

### 7.1 Naming

| Category | Convention | Files | Compliance |
|----------|-----------|:-----:|:----------:|
| Functions | camelCase | 3 new functions | 100% |
| Constants | UPPER_SNAKE_CASE | `RETRY_INTERVALS`, `CRON_SECRET`, `TOSS_API_BASE` | 100% |
| Files | kebab-case or standard Next.js | All files | 100% |
| Components | PascalCase | BillingTab | 100% |

### 7.2 Import Order

All files follow: external libraries -> internal absolute imports -> relative imports. No violations found.

Convention Compliance: 100%

---

## 8. Overall Scores

| Category | Score | Status |
|----------|:-----:|:------:|
| Design Match | 91.4% | PASS |
| Architecture Compliance | 100% | PASS |
| Convention Compliance | 100% | PASS |
| **Overall** | **93.1%** | PASS |

---

## 9. Recommended Actions

### 9.1 Immediate (to reach 100%)

| Priority | Item | File | Description |
|----------|------|------|-------------|
| 1 | Add payment record in suspendSubscription | `src/lib/billing.ts:361-381` | Insert a `payments` row with `status: "failed"` and `failReason: "재시도 소진 -- 구독 일시정지"` as designed in Section 5.3 |

### 9.2 Short-term (documentation/defensive)

| Priority | Item | File | Description |
|----------|------|------|-------------|
| 2 | Add `retryCount <= 3` to processRetries query | `src/lib/billing.ts:274-279` | Add defensive upper-bound check matching design specification |
| 3 | Create `.env.example` or document CRON_SECRET | Project root | Add `CRON_SECRET=` entry so the variable is discoverable |

### 9.3 Optional (low impact)

| Priority | Item | File | Description |
|----------|------|------|-------------|
| 4 | Align renew API response with design | `src/app/api/billing/renew/route.ts:19-27` | Either remove `renewFailed` or update design to include it |
| 5 | Update `getActiveSubscription()` helper | `src/lib/billing.ts:63-93` | Add suspended to the helper as designed, or update design to document the inline approach |

---

## 10. Design Document Updates Needed

If choosing to keep implementation as-is, update the design document:

- [ ] Section 4.2: Add `renewFailed` field to response schema
- [ ] Section 5.2: Remove `retryCount <= 3` from query condition description (if not adding to code)
- [ ] Section 5.3: Remove payment record requirement (if not adding to code)
- [ ] Section 6.3: Document inline query approach instead of `getActiveSubscription()` update

---

## 11. Next Steps

- [ ] Fix item #45 (suspendSubscription payment record) -- highest impact gap
- [ ] Decide on defensive `retryCount <= 3` guard
- [ ] Run `pnpm build` to verify no regressions
- [ ] Write completion report (`recurring-billing.report.md`)

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-03-03 | Initial gap analysis -- 58 items, 91.4% match | gap-detector |
