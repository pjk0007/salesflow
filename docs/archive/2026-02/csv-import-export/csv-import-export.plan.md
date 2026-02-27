# Plan: csv-import-export — CSV 가져오기/내보내기

## 1. 개요

### 배경
현재 레코드 입력은 CreateRecordDialog를 통해 1건씩 수동 입력만 가능하다.
대량의 고객 데이터를 시스템에 올리거나, 현재 데이터를 백업/분석하려면 CSV 기능이 필수적이다.

### 기존 인프라
- **records 테이블**: `data` JSONB 컬럼에 필드 값 저장, `integratedCode` 자동 생성
- **POST /api/partitions/:id/records**: 단건 생성 (data 객체 받음, integratedCode 자동 부여, 중복체크 지원)
- **POST /api/records/bulk-delete**: 기존 벌크 작업 패턴 (ids 배열)
- **FieldDefinition**: 13개 필드 타입 (text, number, date, datetime, select, phone, textarea, checkbox, file, currency, formula, user_select, email)
- **RecordToolbar**: 검색 + 필터 + 추가 버튼 구조 (spacer 이후에 버튼 추가 가능)
- **partition.duplicateCheckField**: 중복 체크 필드 설정 (있으면 해당 필드값 기준 중복 차단)

### 목표
1. 현재 필터 결과를 CSV 파일로 다운로드 (내보내기)
2. CSV 파일 업로드 → 필드 매핑 → 미리보기 → 일괄 삽입 (가져오기)
3. 중복 처리 옵션 제공
4. 에러 행 리포트

### 범위
- CSV 내보내기 API + 클라이언트 다운로드
- CSV 가져오기: 파일 파싱 → 매핑 UI → 미리보기 → bulk insert API
- RecordToolbar에 내보내기/가져오기 버튼 추가
- useRecords 훅에 bulkCreate 함수 추가

### 범위 제외
- Excel (.xlsx) 지원 (CSV만)
- 가져오기 시 기존 레코드 업데이트 (건너뛰기 또는 에러만)
- 파일/formula/user_select 필드 가져오기 (내보내기 시 읽기전용 표시, 가져오기 시 무시)
- 실시간 진행률 (WebSocket) — 단순 await로 처리
- 비동기 백그라운드 처리 (프론트에서 동기 요청)

## 2. 기능 요구사항

### FR-01: CSV 내보내기 API
- `GET /api/partitions/:id/records/export`
- 현재 필터/검색 조건 적용 (filters, search, sortField, sortOrder)
- 전체 레코드 반환 (pageSize 제한 없음, 최대 10,000건)
- 응답: CSV 텍스트 (Content-Type: text/csv, Content-Disposition: attachment)
- 헤더 행: 필드 label (한글)
- 첫 컬럼: 통합코드 (integratedCode)
- 필드 순서: fields API의 sortOrder 순
- 제외 필드: file, formula, user_select (내보내기 불가)
- 데이터 포맷:
  - date → `YYYY-MM-DD`
  - datetime → `YYYY-MM-DD HH:mm`
  - checkbox → `TRUE` / `FALSE`
  - number/currency → 숫자 그대로 (로케일 포맷 X)
  - select → 값 그대로
  - null/undefined → 빈 문자열

### FR-02: CSV 내보내기 UI
- RecordToolbar에 "내보내기" 버튼 (Download 아이콘)
- 클릭 시 현재 필터 조건으로 API 호출 → CSV 파일 다운로드
- 파일명: `{partitionName}_{YYYYMMDD}.csv`
- 레코드 0건이면 버튼 비활성화 또는 토스트 메시지

### FR-03: CSV 가져오기 API
- `POST /api/partitions/:id/records/bulk-import`
- 요청 바디: `{ records: Array<Record<string, unknown>>, duplicateAction: "skip" | "error" }`
- 트랜잭션 내에서 처리:
  - 각 레코드에 integratedCode 자동 생성
  - duplicateCheckField가 있으면 중복 체크
  - duplicateAction=skip → 중복 건너뛰기, duplicateAction=error → 중복 시 해당 행 에러
- 응답: `{ success, totalCount, insertedCount, skippedCount, errors: Array<{ row: number, message: string }> }`
- 최대 1,000건 제한

### FR-04: CSV 가져오기 UI — ImportDialog
- 3단계 다이얼로그:
  1. **파일 선택**: 드래그앤드롭 또는 파일 선택, papaparse로 파싱
  2. **필드 매핑**: CSV 헤더 → FieldDefinition 매핑 (자동 매칭 + 수동 조정), 중복처리 옵션 선택
  3. **미리보기 및 확인**: 첫 5행 미리보기, 유효성 에러 표시, "가져오기" 버튼
- 매핑 자동 매칭 로직: CSV 헤더 === field.label (정확 일치)
- 매핑 제외: formula, file, user_select 필드
- 가져오기 완료 후: 결과 요약 (성공/건너뛰기/에러 건수), mutate() 호출

### FR-05: 데이터 유효성 검사 (클라이언트)
- 필수 필드 (isRequired) 빈 값 → 에러
- number/currency: 숫자 변환 불가 → 에러
- select: options에 없는 값 → 에러
- date/datetime: 유효하지 않은 날짜 → 에러
- checkbox: TRUE/FALSE/1/0/true/false → boolean 변환, 그 외 → 에러
- phone/email/text/textarea: 문자열 그대로 (추가 검증 없음)

## 3. 기술 설계 방향

### CSV 파싱
- 클라이언트에서 papaparse 사용 (브라우저 내 파싱, 서버 업로드 X)
- UTF-8 BOM 지원 (한글 Excel 호환)

### 내보내기 흐름
```
RecordToolbar "내보내기" 클릭
  → fetch GET /api/partitions/:id/records/export?filters=...
  → 응답 blob → URL.createObjectURL → a.click() 다운로드
```

### 가져오기 흐름
```
RecordToolbar "가져오기" 클릭
  → ImportDialog 열기
  → Step 1: 파일 선택 → papaparse.parse(file)
  → Step 2: 헤더-필드 매핑 UI
  → Step 3: 미리보기 + 유효성 검사
  → "가져오기" 클릭 → POST /api/partitions/:id/records/bulk-import
  → 결과 표시 → Dialog 닫기 → mutate()
```

### Bulk Insert 전략
- 서버에서 트랜잭션 하나로 처리
- integratedCode 자동 생성: seq를 records.length만큼 한번에 증가
- 중복 체크: duplicateCheckField가 있으면 기존 레코드 + 새 레코드 내 중복 모두 검사

## 4. 변경 파일 목록

| # | 파일 | 변경 유형 | 설명 |
|---|------|-----------|------|
| 1 | `package.json` | 수정 | papaparse 의존성 추가 |
| 2 | `src/types/index.ts` | 수정 | ImportResult 타입 추가 |
| 3 | `src/pages/api/partitions/[id]/records/export.ts` | 신규 | CSV 내보내기 API |
| 4 | `src/pages/api/partitions/[id]/records/bulk-import.ts` | 신규 | CSV 가져오기 API |
| 5 | `src/hooks/useRecords.ts` | 수정 | bulkImport 함수 추가 |
| 6 | `src/components/records/ImportDialog.tsx` | 신규 | 3단계 가져오기 다이얼로그 |
| 7 | `src/components/records/RecordToolbar.tsx` | 수정 | 내보내기/가져오기 버튼 추가 |
| 8 | `src/pages/records.tsx` | 수정 | ImportDialog 상태, export 핸들러 연결 |

## 5. 의존성
- **papaparse** (CSV 파싱 라이브러리) — 신규 추가
- **@types/papaparse** (타입 정의) — 신규 추가
- DB 스키마 변경 없음
- 기존 records API 변경 없음 (새 엔드포인트만 추가)

## 6. 검증 기준
- `npx next build` 성공
- 내보내기: 레코드 있는 파티션에서 CSV 다운로드 → 파일 열기 → 한글 헤더 + 데이터 정상
- 내보내기: 필터 적용 상태에서 내보내기 → 필터된 결과만 포함
- 가져오기: 유효한 CSV 업로드 → 매핑 → 미리보기 → 가져오기 → 레코드 추가됨
- 가져오기: 필수 필드 누락 CSV → 에러 표시
- 가져오기: 중복 데이터 → skip 옵션으로 건너뛰기
- 가져오기: 1,000건 초과 → 에러 메시지
- 가져오기: 결과 요약 (성공/건너뛰기/에러 건수) 정상 표시
