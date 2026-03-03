# Plan: recurring-billing (월 자동 결제)

## 현재 상태
- TossPayments 빌링키 발급 + 수동 결제 구현 완료
- DB 테이블: plans, subscriptions (tossBillingKey, currentPeriodEnd 포함), payments
- API: /api/billing/subscribe (수동), /api/billing/issue-billing-key, /api/billing/cancel, /api/billing/status
- 누락: **월 자동 갱신**, **실패 재시도**, **구독 만료 처리**

## 요구사항
1. `currentPeriodEnd` 도래 시 자동으로 `executeBilling()` 실행하여 다음 달 결제
2. 결제 실패 시 재시도 (최대 3회, 1/3/7일 간격)
3. 재시도 모두 실패 시 구독 일시정지(suspended) → Free 다운그레이드
4. Next.js API Route 기반 (외부 cron 서비스에서 호출)

## 기능 범위

### 구현할 것
1. **자동 결제 API** (`POST /api/billing/renew`) — cron에서 호출
   - 만료 예정/만료된 유료 구독 조회 (currentPeriodEnd <= now, 빌링키 있음)
   - `executeBilling()` 실행 → 성공 시 currentPeriodStart/End 갱신 + payment 기록
   - 실패 시 retryCount 증가 + nextRetryAt 설정
   - 인증: API key 또는 secret header (cron 서비스용)

2. **구독 상태 관리 확장**
   - subscriptions에 `retryCount`, `nextRetryAt` 컬럼 추가
   - 재시도 로직: 1일 → 3일 → 7일 간격
   - 3회 실패 시 status = "suspended" + Free 플랜 다운그레이드

3. **billing.ts 함수 추가**
   - `processRenewals()`: 만료 구독 조회 + 갱신 처리
   - `processRetries()`: 실패 구독 재시도
   - `suspendSubscription()`: 재시도 소진 후 일시정지

4. **BillingTab UI 보완**
   - 결제 예정일 표시 (다음 결제일: 2026-04-03)
   - 구독 상태 뱃지: active / suspended
   - suspended 상태에서 카드 재등록 → 즉시 결제 → 복구

### 구현하지 않을 것
- Webhook (TossPayments 웹훅은 결제 확인용이나, 빌링키 결제는 즉시 응답으로 충분)
- PDF 인보이스
- 이메일 알림 (별도 기능으로 분리)
- 프로레이션(일할 계산)

## 파일 변경 목록

| # | 파일 | 작업 |
|---|------|------|
| 1 | `src/lib/db/schema.ts` | subscriptions에 retryCount, nextRetryAt 추가 |
| 2 | `drizzle/0016_billing_retry.sql` | 마이그레이션 |
| 3 | `src/lib/billing.ts` | processRenewals, processRetries, suspendSubscription 추가 |
| 4 | `src/app/api/billing/renew/route.ts` | POST — cron 호출용 자동 결제 API |
| 5 | `src/components/settings/BillingTab.tsx` | 결제 예정일 + suspended 상태 UI |

## 리스크
- **cron 서비스 선택**: Vercel Cron, 외부 서비스(cron-job.org), 또는 GitHub Actions
  → API Route로 구현하면 어떤 cron이든 HTTP 호출만 하면 됨
- **동시 실행 방지**: renew API가 중복 호출되면 이중 결제 위험
  → 처리 시 status 체크 + orderId에 타임스탬프 포함으로 방지

## 검증
- `pnpm build` 성공
- 테스트: Free→Pro 업그레이드 → currentPeriodEnd 지나면 자동 갱신 확인
