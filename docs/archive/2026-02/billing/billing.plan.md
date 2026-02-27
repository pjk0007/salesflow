# Plan: billing (결제수단 및 요금제)

## 배경
현재 모든 조직이 무제한 접근 가능하며, 요금제/결제 인프라가 전혀 없습니다. 클라우드타입 배포를 위해 토스페이먼츠를 연동하여 요금제를 도입합니다.

## 목표
토스페이먼츠 테스트키로 결제 시스템을 구축하고, Free/Pro/Enterprise 요금제를 도입합니다.

## 기능 요구사항

### FR-01: 요금제 정의
- **Free**: 기본 (워크스페이스 1개, 레코드 500건, 멤버 2명)
- **Pro**: 월 29,000원 (워크스페이스 3개, 레코드 10,000건, 멤버 10명, AI 기능)
- **Enterprise**: 월 99,000원 (무제한)
- 신규 가입 시 기본 Free 플랜

### FR-02: DB 스키마 추가
- `plans` 테이블: id, name, price, limits(jsonb), features(jsonb)
- `subscriptions` 테이블: orgId, planId, status, currentPeriodStart/End, tossCustomerKey, tossBillingKey
- `payments` 테이블: orgId, subscriptionId, amount, status, tossPaymentKey, paidAt

### FR-03: 토스페이먼츠 결제 위젯 연동
- `@tosspayments/tosspayments-sdk` NPM 패키지 설치
- 결제 위젯으로 빌링키 발급 (카드 등록)
- 테스트 클라이언트키/시크릿키 사용 (.env)
- 성공/실패 콜백 URL 처리

### FR-04: 결제 API
- `POST /api/billing/subscribe` — 플랜 변경 + 결제 요청
- `POST /api/billing/confirm` — 토스 결제 승인 (successUrl에서 호출)
- `GET /api/billing/status` — 현재 구독 상태 조회
- `POST /api/billing/cancel` — 구독 취소

### FR-05: 요금제 관리 UI
- 설정 페이지에 "요금제" 탭 추가
- 현재 플랜 표시 + 업그레이드/다운그레이드 버튼
- 결제 수단 등록/변경
- 결제 내역 목록

### FR-06: 기능 제한 체크
- API 레벨에서 플랜별 limit 체크 미들웨어
- 레코드 생성 시 건수 제한 체크
- 워크스페이스 생성 시 개수 제한 체크
- 멤버 초대 시 인원 제한 체크
- 제한 초과 시 업그레이드 안내 응답

## 비기능 요구사항

### NFR-01: 토스페이먼츠 테스트 모드
- 테스트 클라이언트키/시크릿키 사용
- 실제 결제 없이 전체 흐름 테스트 가능
- 프로덕션 전환 시 키만 교체

### NFR-02: 보안
- 시크릿키는 서버사이드에서만 사용 (.env)
- 결제 승인은 반드시 서버에서 검증
- 금액 위변조 방지 (서버에서 amount 검증)

## 변경 파일 목록

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 1 | `src/lib/db/schema.ts` | plans, subscriptions, payments 테이블 |
| 2 | `drizzle/XXXX_billing.sql` | 마이그레이션 |
| 3 | `src/pages/api/billing/subscribe.ts` | 구독 생성 API |
| 4 | `src/pages/api/billing/confirm.ts` | 결제 승인 API |
| 5 | `src/pages/api/billing/status.ts` | 구독 상태 조회 |
| 6 | `src/pages/api/billing/cancel.ts` | 구독 취소 |
| 7 | `src/lib/billing.ts` | 토스페이먼츠 API 헬퍼, 플랜 제한 체크 |
| 8 | `src/components/settings/BillingTab.tsx` | 요금제 관리 UI |
| 9 | `src/pages/settings.tsx` | 요금제 탭 추가 |
| 10 | `src/pages/billing/success.tsx` | 결제 성공 리다이렉트 페이지 |
| 11 | `src/pages/billing/fail.tsx` | 결제 실패 리다이렉트 페이지 |

## 구현 순서

| # | 작업 | 검증 |
|---|------|------|
| 1 | DB 스키마 + 마이그레이션 | drizzle-kit push |
| 2 | billing.ts 헬퍼 + 토스 API 연동 | 타입 에러 없음 |
| 3 | billing API 엔드포인트 4개 | 타입 에러 없음 |
| 4 | BillingTab UI + success/fail 페이지 | `pnpm build` 성공 |
| 5 | 기능 제한 미들웨어 | API 제한 동작 확인 |

## 우선순위: 2
## 의존성: 토스페이먼츠 계정 + 테스트키 필요
