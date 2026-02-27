# Gap Analysis: unified-logs — 통합 발송 이력

> **Design 문서**: [unified-logs.design.md](../02-design/features/unified-logs.design.md)
> **분석일**: 2026-02-19

## 1. 파일별 체크포인트

### 1.1 src/types/index.ts (수정)

| # | 항목 | Design | 구현 | 일치 |
|---|------|--------|------|:----:|
| 1 | UnifiedLogChannel 타입 | `"alimtalk" \| "email"` | `"alimtalk" \| "email"` | O |
| 2 | UnifiedLog 인터페이스 | 13개 필드 | 13개 필드 (동일) | O |
| 3 | 추가 위치 | AlimtalkStats 아래 (~334) | line 336 (AlimtalkStats 아래) | O |

### 1.2 src/pages/api/logs/unified.ts (신규)

| # | 항목 | Design | 구현 | 일치 |
|---|------|--------|------|:----:|
| 4 | import | NextApiRequest/Response, db, sql, getUserFromRequest | 동일 | O |
| 5 | GET only | 405 for non-GET | 동일 | O |
| 6 | 인증 체크 | getUserFromRequest → 401 | 동일 | O |
| 7 | page 파싱 | Math.max(1, ...) | 동일 | O |
| 8 | pageSize 파싱 | Math.min(100, Math.max(1, ...)) | 동일 | O |
| 9 | channel 파라미터 | "" / "alimtalk" / "email" | 동일 | O |
| 10 | status 파라미터 | "" / pending / sent / failed / rejected | 동일 | O |
| 11 | triggerType 파라미터 | 지원 | 동일 | O |
| 12 | startDate/endDate 파라미터 | 지원, endDate 23:59:59 | 동일 | O |
| 13 | recordId 파라미터 | Number 변환, null 기본값 | 동일 | O |
| 14 | search 파라미터 | ILIKE 검색 | 동일 | O |
| 15 | UNION ALL 전략 | 두 서브쿼리 appendConditions → UNION ALL | buildSubquery 함수로 통합 | O |
| 16 | 채널별 분기 | alimtalk만/email만/둘다 | 동일 | O |
| 17 | SELECT 컬럼 | id, channel, org_id, partition_id, record_id, recipient, title, status, trigger_type, result_message, sent_by, sent_at, completed_at | 동일 | O |
| 18 | 정렬 | ORDER BY sent_at DESC | 동일 | O |
| 19 | count 쿼리 | count(*)::int | 동일 | O |
| 20 | 응답 형태 | { success, data, total, page, pageSize, totalPages } | 동일 | O |
| 21 | 에러 핸들링 | try-catch, 500 | 동일 | O |
| 22 | 쿼리 구조 | Design: appendConditions + 별도 alimtalkSelect/emailSelect | 구현: buildSubquery 함수로 통합 (더 간결) | O |

### 1.3 src/hooks/useUnifiedLogs.ts (신규)

| # | 항목 | Design | 구현 | 일치 |
|---|------|--------|------|:----:|
| 23 | UseUnifiedLogsParams | 9개 필드 | 9개 필드 (동일) | O |
| 24 | UnifiedLogsResponse | success, data, total, page, pageSize, totalPages | 동일 | O |
| 25 | fetcher | fetch → json | 동일 | O |
| 26 | buildQueryString | URLSearchParams, 9개 파라미터 | 동일 | O |
| 27 | useUnifiedLogs 반환 | logs, total, page, pageSize, totalPages, isLoading, error, mutate | 동일 | O |
| 28 | API 경로 | /api/logs/unified | 동일 | O |

### 1.4 src/components/logs/UnifiedLogTable.tsx (신규)

| # | 항목 | Design | 구현 | 일치 |
|---|------|--------|------|:----:|
| 29 | Props | recordId?, compact? | 동일 | O |
| 30 | CHANNEL_MAP | alimtalk=secondary, email=outline | 동일 | O |
| 31 | STATUS_MAP | pending=secondary, sent=default, failed=destructive, rejected=destructive | 동일 | O |
| 32 | TRIGGER_TYPE_MAP | manual=outline, auto=default, repeat=secondary | 동일 | O |
| 33 | 내부 상태 8개 | page, channel, status, triggerType, startDate, endDate, search, searchInput | 동일 | O |
| 34 | 훅 호출 | useUnifiedLogs with all params, pageSize=compact?20:50 | 동일 | O |
| 35 | 검색 핸들러 | handleSearch + handleSearchKeyDown (Enter) | 동일 | O |
| 36 | 필터바 (full) | 채널/상태/방식 Select + 날짜 범위 + 검색 | 동일 | O |
| 37 | 필터바 (compact) | 숨김 | 동일 | O |
| 38 | 테이블 컬럼 (full) | 채널, 수신자, 제목, 상태, 방식, 발송일시, 결과 | 동일 | O |
| 39 | 테이블 컬럼 (compact) | 채널, 수신자, 제목, 상태, 발송일시 (방식/결과 제외) | 동일 | O |
| 40 | row key | `${log.channel}-${log.id}` | 동일 | O |
| 41 | 페이지네이션 | totalPages>1, 총 N건, prev/next, page/totalPages | 동일 | O |
| 42 | 로딩 Skeleton | compact?5:10 | 동일 | O |
| 43 | 빈 상태 | "발송 이력이 없습니다" 메시지 | 동일 | O |

### 1.5 src/pages/logs.tsx (신규)

| # | 항목 | Design | 구현 | 일치 |
|---|------|--------|------|:----:|
| 44 | WorkspaceLayout | 사용 | 동일 | O |
| 45 | 페이지 제목 | "발송 이력" h1 + "알림톡/이메일 통합 발송 이력" p | 동일 | O |
| 46 | UnifiedLogTable | props 없이 사용 | 동일 | O |

### 1.6 src/components/dashboard/sidebar.tsx (수정)

| # | 항목 | Design | 구현 | 일치 |
|---|------|--------|------|:----:|
| 47 | History import | lucide-react에서 추가 | 동일 | O |
| 48 | navItems | { href: "/logs", label: "발송 이력", icon: History } | 동일 | O |
| 49 | 위치 | 이메일 다음 | 동일 (4번째→5번째) | O |

### 1.7 src/components/records/RecordDetailDialog.tsx (수정)

| # | 항목 | Design | 구현 | 일치 |
|---|------|--------|------|:----:|
| 50 | import | UnifiedLogTable from "@/components/logs/UnifiedLogTable" | 동일 | O |
| 51 | 발송 이력 섹션 위치 | 필드 목록 아래, SheetFooter 위 | 동일 | O |
| 52 | h3 제목 | "발송 이력" (text-sm font-medium text-muted-foreground) | 동일 | O |
| 53 | UnifiedLogTable props | recordId={record.id} compact | 동일 | O |

## 2. 빌드 검증

| # | 항목 | 결과 |
|---|------|------|
| 54 | `npx next build` | 성공 (에러 0) |
| 55 | /logs 라우트 등록 | `○ /logs` 확인 |
| 56 | /api/logs/unified 라우트 등록 | `ƒ /api/logs/unified` 확인 |

## 3. Gap 요약

| Gap # | 항목 | Design | 구현 | 심각도 | 설명 |
|-------|------|--------|------|:------:|------|
| — | 없음 | — | — | — | 모든 항목 일치 |

## 4. 분석 결과

- **총 체크포인트**: 56개
- **일치**: 56개
- **불일치**: 0개
- **Match Rate**: **100%**

## 5. 비고

- Design에서 API 쿼리를 `appendConditions` 헬퍼 + 별도 `alimtalkSelect`/`emailSelect`로 설계했으나, 구현에서는 `buildSubquery` 함수 하나로 통합. 동일한 결과를 더 간결하게 달성하므로 개선으로 판정.
- Design 문서의 의사코드와 실제 구현의 세부 구조가 다르지만 (Design은 두 개의 기본 쿼리 + appendConditions, 구현은 하나의 buildSubquery 함수), 기능적으로 동일한 UNION ALL 쿼리를 생성.
