# Completion Report: email-read-tracking

## 개요
NHN Cloud Email API의 `isOpened`/`openedDate` 데이터를 활용하여 발송된 이메일의 읽음 여부를 추적하고 UI에 표시하는 기능.

## PDCA 결과

| Phase | Status | 비고 |
|-------|--------|------|
| Plan | 완료 | NHN API 분석, 변경 범위 정의 |
| Design | 완료 | 9개 파일, 7단계 구현 순서 |
| Do | 완료 | 8개 파일 변경, ~90 LOC |
| Check | 완료 | Match Rate 100% (25/25 항목) |
| Act | N/A | 100% 달성, iteration 불필요 |

## 변경 파일 (8개)

| 파일 | 변경 내용 | LOC |
|------|-----------|-----|
| `src/lib/db/schema.ts` | `isOpened` (integer) + `openedAt` (timestamptz) 컬럼 | +2 |
| `drizzle/0023_email_read_tracking.sql` | ALTER TABLE 마이그레이션 | +2 |
| `drizzle/meta/_journal.json` | idx 23 엔트리 | +6 |
| `src/lib/nhn-email.ts` | `NhnEmailQueryResult`에 `isOpened?`, `openedDate?` | +2 |
| `src/app/api/email/logs/sync/route.ts` | 2단계 sync: pending + sent 읽음 (7일 이내) | +50 |
| `src/components/email/EmailSendLogTable.tsx` | 읽음 Badge 컬럼 + Sheet 상세 읽음 정보 + toast | +20 |
| `src/app/api/logs/unified/route.ts` | email `isOpened`/`openedAt`, alimtalk `0`/`NULL` | +5 |
| `src/types/index.ts` | `UnifiedLog`에 `isOpened`/`openedAt` | +2 |
| `src/components/logs/UnifiedLogTable.tsx` | email+sent일 때 읽음/안읽음 Badge | +10 |

**총 ~99 LOC, 0 iterations**

## 기술 상세

### Sync 2단계 전략
1. **Stage 1 (기존)**: `status=pending` 로그 → NHN API로 발송 상태 + 읽음 동시 업데이트
2. **Stage 2 (신규)**: `status=sent, isOpened=0, sentAt >= 7일 전` 로그 → 읽음만 업데이트

### UI 표시 로직
- `sent` + `isOpened=1` → 초록 "읽음" Badge
- `sent` + `isOpened=0` → outline "안읽음" Badge
- pending/failed/rejected → 표시 안함
- 알림톡 → 표시 안함 (읽음 추적 불가)

### 제약사항
- NHN 추적 픽셀 기반 — 이미지 차단 시 감지 불가
- 실시간 아닌 수동 sync 방식
- 기존 로그도 requestId 있으면 읽음 반영 가능

## 검증
- `npx next build` 성공
- Gap Analysis 25/25 항목 일치 (100%)
