# Completion Report: csv-import-export

> **Feature**: CSV 가져오기/내보내기 (P5)
> **PDCA Cycle**: Plan → Design → Do → Check → Report
> **Date**: 2026-02-19

## 1. Overview

| Item | Value |
|------|-------|
| Feature | csv-import-export |
| Roadmap | P5 (roadmap-v2) |
| Match Rate | 100% |
| Iterations | 0 (first pass) |
| Build Status | Pass |
| Files Changed | 8 (3 new, 5 modified) |

## 2. Requirements Fulfillment

| FR | Requirement | Status | Notes |
|----|-------------|:------:|-------|
| FR-01 | CSV 내보내기 API | Done | GET /api/partitions/:id/records/export, BOM+UTF-8, 최대 10,000건 |
| FR-02 | CSV 내보내기 UI | Done | RecordToolbar 내보내기 버튼, blob 다운로드, 0건 시 비활성화 |
| FR-03 | CSV 가져오기 API | Done | POST /api/partitions/:id/records/bulk-import, 트랜잭션, 중복체크, 최대 1,000건 |
| FR-04 | CSV 가져오기 UI (ImportDialog) | Done | 3단계: 파일선택 → 매핑 → 미리보기/가져오기 |
| FR-05 | 데이터 유효성 검사 | Done | 필수/숫자/날짜/select/checkbox 클라이언트 검증 |

## 3. Implementation Summary

### Changed Files

| # | File | Change | Lines |
|---|------|--------|:-----:|
| 1 | `package.json` | papaparse + @types/papaparse 의존성 추가 | +2 |
| 2 | `src/types/index.ts` | ImportError, ImportResult 타입 추가 | +14 |
| 3 | `src/pages/api/partitions/[id]/records/export.ts` | **New** — CSV 내보내기 API | +189 |
| 4 | `src/pages/api/partitions/[id]/records/bulk-import.ts` | **New** — CSV 가져오기 API | +126 |
| 5 | `src/hooks/useRecords.ts` | exportCsv, bulkImport 함수 추가 | +36 |
| 6 | `src/components/records/ImportDialog.tsx` | **New** — 3단계 가져오기 다이얼로그 | +446 |
| 7 | `src/components/records/RecordToolbar.tsx` | 내보내기/가져오기 버튼 추가 | +27 |
| 8 | `src/pages/records.tsx` | ImportDialog 상태, handleExport 핸들러 연결 | +25 |

### Architecture Decisions

1. **클라이언트 파싱 (papaparse)** — 서버 업로드 없이 브라우저에서 CSV 파싱, 서버 부하 최소화
2. **트랜잭션 기반 bulk insert** — 개별 INSERT 루프로 integratedCode 순차 생성, 중복 체크 포함 (한 번의 트랜잭션)
3. **intra-batch 중복 방지** — existingValues Set에 새 레코드 값도 추가하여 배치 내 중복까지 차단
4. **BOM 접두사** — Excel에서 한글 CSV를 UTF-8로 인식시키기 위한 \uFEFF 추가
5. **자동 매핑** — CSV 헤더와 field.label 정확 일치로 자동 매핑, 수동 조정은 Select 드롭다운
6. **에러 행 제외 삽입** — 클라이언트 유효성 검증 에러 행을 제외하고 유효한 행만 API에 전송
7. **export 필터 복제** — records.ts의 14개 필터 연산자를 export.ts에 그대로 복제하여 일관성 유지

### Key Components

**Export API (export.ts)** — CSV 생성 엔진
- 14개 필터 연산자 지원 (contains, equals, not_equals, gt/gte/lt/lte, before/after/between, is_empty/is_not_empty, is_true/is_false)
- `formatValue()`: date→YYYY-MM-DD, datetime→YYYY-MM-DD HH:mm, checkbox→TRUE/FALSE
- `escapeCsv()`: 콤마/따옴표/줄바꿈 포함 시 따옴표 감싸기
- 파일명: `{partitionName}_{YYYYMMDD}.csv`

**Bulk Import API (bulk-import.ts)** — 트랜잭션 삽입 엔진
- 1,000건 제한 검증
- organizations 테이블에서 prefix/seq 조회 → integratedCode 생성 (padStart 4자리)
- duplicateCheckField 기반 중복 체크 (기존 DB + 배치 내)
- 조직 시퀀스 일괄 업데이트

**ImportDialog** — 3단계 가져오기 UX
- Step 1: 파일 선택 (papaparse header:false, skipEmptyLines)
- Step 2: 헤더→필드 매핑 (자동매핑 + Select 수동조정 + 중복처리 옵션)
- Step 3: 미리보기 5행 + 유효성 에러 표시 + 가져오기 실행 + 결과 요약

## 4. Gap Analysis Results

| Metric | Value |
|--------|-------|
| Total Checkpoints | 142 |
| Matched | 142 |
| Gaps | 0 |
| Match Rate | **100%** |
| Positive Extras | 5 |

### Positive Extras
1. `bulkImport` 명시적 `Promise<ImportResult>` 반환 타입 (타입 안전성)
2. `useRef` 파일 입력 클릭 트리거 (필요 패턴)
3. `e.target.value = ""` 같은 파일 재선택 허용 (UX 개선)
4. `disabled={activeMappings.length === 0}` 매핑 없이 진행 차단 (UX 개선)
5. `handleExport` useCallback 래핑 (성능 최적화)

## 5. Dependencies

- **papaparse** ^5.5.3 — 클라이언트 CSV 파싱
- **@types/papaparse** ^5.5.2 — TypeScript 타입 정의
- DB 스키마 변경 없음
- 기존 records API 변경 없음 (새 엔드포인트만 추가)

## 6. What Went Well

- Plan→Design→Do→Check 전 단계 0회 반복으로 100% 달성
- 기존 records.ts의 필터 로직을 export.ts에 충실히 복제하여 내보내기 결과 일관성 보장
- 3단계 ImportDialog UX: 파일→매핑→미리보기 플로우가 직관적
- 트랜잭션 기반 bulk insert로 부분 실패 시에도 데이터 무결성 유지
- papaparse 클라이언트 파싱으로 서버 부하 제로

## 7. Lessons Learned

1. **handleExport 변수 선언 순서** — `currentPartition` 이후에 `handleExport`를 정의해야 TS 컴파일 에러 방지 (block-scoped variable)
2. **intra-batch 중복 방지 필수** — existingValues에 새 값도 추가하지 않으면 동일 배치 내 중복 레코드가 삽입됨
3. **BOM(\uFEFF) 추가 중요** — 한글 CSV를 Excel에서 열 때 UTF-8 인식 필수
4. **CSV escapeCsv 패턴** — 콤마/따옴표/줄바꿈 포함 셀은 반드시 따옴표로 감싸야 파싱 안정성 확보

## 8. Next Steps

- `/pdca archive csv-import-export` — archive completed PDCA documents
- Continue roadmap-v2: P6 (고급 통계/대시보드) or P7 (알림 설정)
