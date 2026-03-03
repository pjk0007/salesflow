# recurring-billing Design Document

> **Summary**: 월 자동 결제 갱신, 실패 재시도, 구독 일시정지 처리
>
> **Project**: SalesFlow
> **Date**: 2026-03-03
> **Status**: Draft
> **Planning Doc**: [recurring-billing.plan.md](../../01-plan/features/recurring-billing.plan.md)

---

## 1. Overview

### 1.1 Design Goals

- `currentPeriodEnd` 도래 시 자동으로 TossPayments 빌링키 결제 실행
- 결제 실패 시 1/3/7일 간격으로 최대 3회 재시도
- 재시도 모두 실패 시 구독 suspended → Free 다운그레이드
- Next.js API Route 기반 (외부 cron 서비스에서 HTTP 호출)

### 1.2 Design Principles

- 기존 `executeBilling()` 함수 재사용 (검증된 결제 로직)
- API Route는 무상태 — 중복 호출 시에도 이중 결제 방지
- suspended 상태에서 카드 재등록 시 즉시 복구 가능

---

## 2. Architecture

### 2.1 Data Flow

```
외부 Cron (매일 1회)
    │
    ▼
POST /api/billing/renew
    │
    ├─ processRenewals()    ← currentPeriodEnd <= now 인 active 구독
    │   ├─ executeBilling()  → 성공: period 갱신 + payment 기록
    │   └─ 실패: retryCount++ + nextRetryAt 설정
    │
    └─ processRetries()     ← nextRetryAt <= now 인 active 구독
        ├─ executeBilling()  → 성공: retry 초기화 + period 갱신
        └─ 실패: retryCount++ (3회 초과 시 suspendSubscription)
```

### 2.2 Dependencies

| Component | Depends On | Purpose |
|-----------|-----------|---------|
| `/api/billing/renew` | `billing.ts` | 자동 결제 비즈니스 로직 |
| `processRenewals()` | `executeBilling()` | TossPayments 빌링키 결제 |
| `processRetries()` | `executeBilling()`, `suspendSubscription()` | 재시도 + 일시정지 |
| `BillingTab.tsx` | `/api/billing/status` | suspended 상태 UI 반영 |

---

## 3. Data Model

### 3.1 subscriptions 테이블 변경

```typescript
// 기존 컬럼 유지 + 아래 2개 추가
export const subscriptions = pgTable("subscriptions", {
    // ... 기존 컬럼 ...
    retryCount: integer("retry_count").default(0).notNull(),
    nextRetryAt: timestamptz("next_retry_at"),
});
```

| 컬럼 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `retry_count` | integer | 0 | 결제 실패 재시도 횟수 (0~3) |
| `next_retry_at` | timestamptz | null | 다음 재시도 시각 |

### 3.2 Migration SQL

```sql
-- drizzle/0016_billing_retry.sql
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "retry_count" integer DEFAULT 0 NOT NULL;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "next_retry_at" timestamp with time zone;
```

---

## 4. API Specification

### 4.1 Endpoint List

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/billing/renew` | 자동 갱신 + 재시도 처리 | CRON_SECRET |

### 4.2 `POST /api/billing/renew`

**인증**: `Authorization: Bearer {CRON_SECRET}` 헤더 검증

**Request**: Body 없음 (전체 만료 구독 일괄 처리)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "renewed": 5,
    "retried": 2,
    "suspended": 1,
    "errors": []
  }
}
```

**에러:**
- `401 Unauthorized`: CRON_SECRET 불일치
- `500 Internal Server Error`: 처리 중 예외

**환경 변수**: `CRON_SECRET` — .env.local에 추가 필요

---

## 5. Business Logic (billing.ts)

### 5.1 processRenewals()

```typescript
export async function processRenewals(): Promise<{
    renewed: number;
    failed: number;
    errors: string[];
}>
```

**로직:**
1. 조건: `status = "active"` AND `currentPeriodEnd <= now` AND `tossBillingKey IS NOT NULL` AND `retryCount = 0`
2. 각 구독에 대해:
   - plan 정보 조회 (amount, name)
   - `orderId = "renew_{orgId.slice(0,8)}_{timestamp}"`
   - `executeBilling(billingKey, { customerKey, amount, orderId, orderName })`
   - 성공: `currentPeriodStart = now`, `currentPeriodEnd = now + 1 month`, payment 기록
   - 실패: `retryCount = 1`, `nextRetryAt = now + 1일`, payment 기록 (status="failed", failReason)

### 5.2 processRetries()

```typescript
export async function processRetries(): Promise<{
    retried: number;
    suspended: number;
    errors: string[];
}>
```

**로직:**
1. 조건: `status = "active"` AND `nextRetryAt <= now` AND `retryCount > 0` AND `retryCount <= 3`
2. 각 구독에 대해:
   - `executeBilling()` 실행
   - 성공: `retryCount = 0`, `nextRetryAt = null`, period 갱신 + payment 기록
   - 실패:
     - `retryCount < 3`: `retryCount++`, `nextRetryAt` = 재시도 간격 적용
     - `retryCount >= 3`: `suspendSubscription()` 호출

**재시도 간격:**

| retryCount | 다음 재시도 |
|------------|------------|
| 1 → 2 | +3일 |
| 2 → 3 | +7일 |
| 3 이상 | 일시정지 |

### 5.3 suspendSubscription()

```typescript
export async function suspendSubscription(subscriptionId: number): Promise<void>
```

**로직:**
1. Free 플랜 ID 조회: `WHERE slug = "free"`
2. 구독 업데이트: `status = "suspended"`, `planId = freePlan.id`, `retryCount = 0`, `nextRetryAt = null`
3. payment 기록: `status = "failed"`, `failReason = "재시도 소진 — 구독 일시정지"`

---

## 6. UI/UX Design

### 6.1 BillingTab 변경 사항

**현재 플랜 카드 — suspended 상태 추가:**

```
┌────────────────────────────────────────┐
│ 현재 플랜                              │
│                                        │
│ Free         무료     [suspended 뱃지] │
│                                        │
│ ⚠️ 결제 실패로 구독이 일시정지되었습니다. │
│ 카드를 재등록하면 즉시 복구됩니다.       │
│                                        │
│ [카드 재등록하기]                        │
└────────────────────────────────────────┘
```

**변경 포인트:**

1. **상태 뱃지**: `subscription.status === "suspended"` → 빨간색 `destructive` Badge
2. **경고 메시지**: suspended 상태일 때 안내 문구 표시
3. **카드 재등록 버튼**: suspended 상태에서 `openTossPayment()` 호출 → 빌링키 재발급 → 즉시 결제 → active 복구
4. **다음 결제일**: `currentPeriodEnd` 표시 (기존 로직 유지)

### 6.2 BillingData 인터페이스 확장

```typescript
interface BillingData {
    // ... 기존 ...
    subscription: {
        // ... 기존 ...
        status: string;        // "active" | "suspended"
        retryCount: number;    // 추가
    } | null;
}
```

### 6.3 /api/billing/status 변경

- `getActiveSubscription()` → `status IN ("active", "suspended")` 으로 조건 확장
- 응답에 `retryCount` 필드 추가

---

## 7. Security Considerations

- [x] CRON_SECRET 환경 변수로 renew API 보호 (외부 접근 차단)
- [x] orderId에 타임스탬프 포함 → 동일 결제 중복 방지
- [x] retryCount = 0 조건으로 이미 처리된 갱신 재처리 방지
- [x] suspended 복구 시에도 billingKey 유효성은 TossPayments가 검증

---

## 8. Implementation Guide

### 8.1 File Structure

| # | 파일 | 작업 | LOC(추정) |
|---|------|------|-----------|
| 1 | `src/lib/db/schema.ts` | subscriptions에 retryCount, nextRetryAt 추가 | +3 |
| 2 | `drizzle/0016_billing_retry.sql` | ALTER TABLE 마이그레이션 | +2 |
| 3 | `drizzle/meta/_journal.json` | idx 16 엔트리 추가 | +6 |
| 4 | `src/lib/billing.ts` | processRenewals, processRetries, suspendSubscription | +120 |
| 5 | `src/app/api/billing/renew/route.ts` | POST — cron 호출용 API | +40 |
| 6 | `src/app/api/billing/status/route.ts` | suspended 포함 조회 + retryCount 반환 | ~5 수정 |
| 7 | `src/components/settings/BillingTab.tsx` | suspended 상태 UI + 카드 재등록 | ~30 수정 |

### 8.2 Implementation Order

1. [ ] schema.ts + migration SQL + journal (DB 준비)
2. [ ] billing.ts — 3개 함수 추가 (비즈니스 로직)
3. [ ] /api/billing/renew/route.ts (API 엔드포인트)
4. [ ] /api/billing/status/route.ts 수정 (suspended 포함)
5. [ ] BillingTab.tsx 수정 (UI)
6. [ ] `pnpm build` 검증

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | 2026-03-03 | Initial draft |
