# Plan: 이메일 읽음 확인 (Email Read Tracking)

## 개요
NHN Cloud Email API의 `isOpened`/`openedDate` 데이터를 활용하여 발송된 이메일의 읽음 여부를 추적하고 UI에 표시하는 기능.

## 배경
- NHN Cloud Email API `queryMails` 응답에 `isOpened` (Boolean) + `openedDate` (String) 필드가 이미 존재
- 현재 sync API (`/api/email/logs/sync`)는 `status`, `resultCode`, `resultMessage`, `completedAt`만 업데이트
- `NhnEmailQueryResult` 타입에 `isOpened`/`openedDate` 필드 미포함
- 현재 sync는 `status = "pending"` 로그만 대상 — 이미 sent된 로그의 읽음 상태는 추적 불가

## 요구사항

### 필수
1. `email_send_logs` 테이블에 `is_opened` (boolean) + `opened_at` (timestamptz) 컬럼 추가
2. sync API 확장: pending 상태 동기화 + sent 상태의 읽음 여부 동기화
3. 이메일 발송 이력 탭 (EmailSendLogTable): 읽음 상태 표시
4. 레코드 상세 발송 이력 (UnifiedLogTable): 읽음 상태 표시
5. 통합 로그 API에 읽음 데이터 포함

### 선택
- 읽음 필터 (전체/읽음/안읽음)

## 기술 분석

### NHN API 응답 구조 (queryMails)
```json
{
  "requestId": "...",
  "mailStatusCode": "SST2",
  "isOpened": true,
  "openedDate": "2019-01-01 00:00:00",
  "receiveMailAddr": "user@example.com",
  ...
}
```

### 현재 sync 동작
- `status = "pending"` 로그만 조회 (최대 100건)
- requestId별 NHN API 호출 → status/resultCode/resultMessage/completedAt 업데이트
- **문제**: sent 상태로 바뀐 후 읽음 여부 변경 추적 불가

### 변경 접근
- sync 대상 확장: `pending` + `sent이면서 is_opened=false`인 로그도 포함
- 기존 sync 로직에 `isOpened`/`openedDate` 업데이트 추가
- sent 상태 로그의 읽음 동기화는 최근 7일 이내 로그만 대상 (성능)

## 변경 파일

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 1 | `src/lib/db/schema.ts` | `isOpened` (integer, default 0) + `openedAt` (timestamptz) 컬럼 추가 |
| 2 | `drizzle/0023_email_read_tracking.sql` | ALTER TABLE 마이그레이션 |
| 3 | `drizzle/meta/_journal.json` | 마이그레이션 엔트리 추가 |
| 4 | `src/lib/nhn-email.ts` | `NhnEmailQueryResult`에 `isOpened`, `openedDate` 필드 추가 |
| 5 | `src/app/api/email/logs/sync/route.ts` | sync 로직 확장 (읽음 상태 동기화) |
| 6 | `src/components/email/EmailSendLogTable.tsx` | 읽음 배지 표시 + 상세 Sheet에 읽음 정보 |
| 7 | `src/app/api/logs/unified/route.ts` | SELECT에 is_opened, opened_at 추가 |
| 8 | `src/types/index.ts` | UnifiedLog에 isOpened, openedAt 추가 |
| 9 | `src/components/logs/UnifiedLogTable.tsx` | 읽음 상태 표시 |

## 구현 순서

| # | 작업 | 예상 LOC |
|---|------|----------|
| 1 | DB 스키마 + 마이그레이션 | ~10 |
| 2 | NHN 타입 확장 | ~5 |
| 3 | Sync API 확장 | ~30 |
| 4 | EmailSendLogTable UI | ~20 |
| 5 | 통합 로그 API + 타입 | ~10 |
| 6 | UnifiedLogTable UI | ~15 |
| 7 | 빌드 검증 | - |

## 제약사항
- NHN API의 읽음 추적은 이메일 내 추적 픽셀 기반 — 수신자가 이미지 로딩을 차단하면 읽음으로 표시되지 않음
- 실시간이 아닌 sync 버튼 클릭 시 동기화 방식
- 기존 로그도 sync 시 읽음 상태 반영 가능 (requestId가 있는 경우)
