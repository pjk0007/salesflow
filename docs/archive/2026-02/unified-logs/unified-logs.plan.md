# Plan: unified-logs — 통합 발송 이력

## 1. 개요

### 배경
현재 알림톡 로그(`alimtalk.tsx` > 발송 이력 탭)와 이메일 로그(`email.tsx` > 발송 이력 탭)가 별도 페이지에 분리되어 있다.
운영자가 특정 레코드/고객의 전체 발송 이력을 확인하려면 두 페이지를 왔다갔다 해야 한다.

### 기존 인프라
- **alimtalkSendLogs** 테이블: recipientNo, templateName, status(pending/sent/failed), triggerType, sentAt, resultMessage
- **emailSendLogs** 테이블: recipientEmail, subject, status(pending/sent/failed/rejected), triggerType, sentAt, resultMessage
- **공통 필드**: orgId, partitionId, recordId, status, triggerType, sentBy, sentAt, completedAt
- **기존 API**: GET /api/alimtalk/logs, GET /api/email/logs (각각 별도 필터/페이지네이션)
- **기존 훅**: useAlimtalkLogs (날짜/상태/templateLinkId 필터), useEmailLogs (triggerType 필터)
- **기존 컴포넌트**: SendLogTable (알림톡), EmailSendLogTable (이메일)

### 목표
1. 알림톡 + 이메일 로그를 시간순으로 합쳐 보여주는 통합 뷰
2. 채널/상태/기간/트리거타입 필터
3. 레코드 상세에서 해당 레코드 발송 이력 조회
4. 기존 개별 로그 페이지는 유지 (통합 뷰는 추가)

### 범위
- 통합 로그 API 1개 (두 테이블 UNION 쿼리)
- 통합 로그 페이지 또는 탭 1개
- 통합 로그 SWR 훅 1개
- UnifiedLogTable 컴포넌트 1개
- RecordDetailDialog에 발송 이력 탭 추가

### 범위 제외
- 기존 alimtalk.tsx, email.tsx 발송 이력 탭 제거 (유지)
- 로그 데이터 통합 테이블 마이그레이션 (기존 테이블 유지, UNION으로 조회)
- 결과 동기화 (기존 sync API 각각 유지)
- 실시간 업데이트 (SWR polling으로 충분)

## 2. 기능 요구사항

### FR-01: 통합 로그 API
- `GET /api/logs/unified` — 알림톡 + 이메일 로그 UNION 쿼리
- 쿼리 파라미터:
  - `page`, `pageSize` (기본 50)
  - `channel` (all / alimtalk / email)
  - `status` (all / pending / sent / failed)
  - `triggerType` (all / manual / auto / repeat)
  - `startDate`, `endDate` (날짜 범위)
  - `recordId` (특정 레코드 이력)
  - `search` (수신자 번호/이메일, 템플릿명/제목 검색)
- 응답: `{ success, data: UnifiedLog[], total, page, pageSize, totalPages }`
- 정렬: sentAt DESC (최신 순)

### FR-02: 통합 로그 타입
- `UnifiedLog` 인터페이스:
  - `id`, `channel` ("alimtalk" | "email"), `orgId`
  - `partitionId`, `recordId`, `integratedCode` (레코드 통합코드)
  - `recipient` (전화번호 또는 이메일)
  - `title` (알림톡: templateName, 이메일: subject)
  - `status`, `triggerType`
  - `resultMessage`
  - `sentAt`, `completedAt`
  - `sentBy`

### FR-03: 통합 로그 SWR 훅
- `useUnifiedLogs(params)` — GET /api/logs/unified
- 파라미터: channel, status, triggerType, startDate, endDate, recordId, search, page, pageSize
- 반환: logs, total, page, pageSize, totalPages, isLoading

### FR-04: 통합 로그 테이블 컴포넌트
- `UnifiedLogTable` — 필터바 + 테이블 + 페이지네이션
- 필터바: 채널 Select, 상태 Select, 트리거타입 Select, 날짜 범위, 검색 Input
- 테이블 컬럼: 채널(Badge), 수신자, 제목, 상태(Badge), 트리거(Badge), 발송일시, 결과
- 채널 Badge 색상: 알림톡=yellow, 이메일=blue
- 상태 Badge 색상: sent=green, failed=red, pending=gray, rejected=orange
- 페이지네이션 (기존 RecordTable 패턴 동일)

### FR-05: 통합 로그 페이지
- `/logs` 경로로 새 페이지 추가
- WorkspaceLayout 안에 배치
- 사이드바 네비게이션에 "발송 이력" 메뉴 추가
- 전체 발송 이력 표시 (채널 통합)

### FR-06: 레코드 상세 발송 이력
- RecordDetailDialog에 "발송 이력" 탭 추가
- 해당 레코드의 recordId로 필터링된 통합 로그 표시
- 간소화된 테이블 (채널, 수신자, 제목, 상태, 발송일)

## 3. 기술 설계 방향

### UNION 쿼리 전략
두 테이블을 Drizzle ORM의 `sql` 템플릿으로 UNION ALL 쿼리:
```sql
SELECT id, 'alimtalk' as channel, org_id, partition_id, record_id,
       recipient_no as recipient, template_name as title,
       status, trigger_type, result_message, sent_at, completed_at, sent_by
FROM alimtalk_send_logs
WHERE org_id = $1
UNION ALL
SELECT id, 'email' as channel, org_id, partition_id, record_id,
       recipient_email as recipient, subject as title,
       status, trigger_type, result_message, sent_at, completed_at, sent_by
FROM email_send_logs
WHERE org_id = $1
ORDER BY sent_at DESC
LIMIT $2 OFFSET $3
```

### 상태 정규화
- 알림톡: pending, sent, failed
- 이메일: pending, sent, failed, rejected
- 통합: pending, sent, failed, rejected (4가지)

### integratedCode 조인
- UNION 결과에서 recordId로 records 테이블 JOIN하여 integratedCode 가져오기
- 또는 서브쿼리로 처리

## 4. 변경 파일 목록

| # | 파일 | 변경 유형 | 설명 |
|---|------|-----------|------|
| 1 | `src/types/index.ts` | 수정 | UnifiedLog, UnifiedLogChannel 타입 추가 |
| 2 | `src/pages/api/logs/unified.ts` | 신규 | UNION 쿼리 API |
| 3 | `src/hooks/useUnifiedLogs.ts` | 신규 | SWR 훅 |
| 4 | `src/components/logs/UnifiedLogTable.tsx` | 신규 | 통합 로그 테이블 + 필터바 |
| 5 | `src/pages/logs.tsx` | 신규 | 통합 로그 페이지 |
| 6 | `src/components/layouts/WorkspaceLayout.tsx` | 수정 | 사이드바에 "발송 이력" 메뉴 추가 |
| 7 | `src/components/records/RecordDetailDialog.tsx` | 수정 | 발송 이력 탭 추가 |

## 5. 의존성
- 외부 라이브러리 추가 없음
- DB 스키마 변경 없음 (기존 테이블 UNION 조회만)
- 기존 alimtalk/email 로그 페이지 변경 없음

## 6. 검증 기준
- `npx next build` 성공
- /logs 페이지 접근 → 통합 로그 테이블 표시
- 채널 필터 (알림톡만, 이메일만) → 올바른 결과
- 상태 필터 (sent, failed 등) → 올바른 결과
- 날짜 범위 필터 → 해당 기간 로그만 표시
- 검색 (수신자/제목) → 올바른 결과
- 페이지네이션 동작
- 레코드 상세에서 해당 레코드 발송 이력 표시
- 사이드바 "발송 이력" 메뉴 클릭 → /logs 이동
