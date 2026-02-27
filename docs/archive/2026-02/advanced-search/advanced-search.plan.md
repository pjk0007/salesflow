# Plan: advanced-search — 검색/필터링 강화

## 1. 개요

### 배경
현재 RecordToolbar에는 단순 키워드 검색(JSONB 전체 ILIKE)과 분배순서 필터만 존재한다.
레코드 수가 늘어나면 특정 필드 기준 필터링과 정렬이 필수적이다.
백엔드 API에는 이미 `sortField`/`sortOrder` 파라미터가 구현되어 있으나 UI에서 사용하지 않고 있다.

### 목표
1. 필드별 필터 조건을 설정할 수 있는 FilterBuilder UI
2. 다중 필터 AND 조합 지원
3. 컬럼 헤더 클릭으로 정렬 (ASC/DESC 토글)
4. API 쿼리 파라미터 확장 (필드별 필터)

### 범위
- FilterBuilder 컴포넌트 신규 생성
- RecordToolbar에 필터 버튼 추가
- RecordTable 헤더에 정렬 인터랙션 추가
- records API 필드별 필터링 지원 확장
- useRecords 훅에 filters 파라미터 추가
- records.tsx 페이지에 필터/정렬 상태 통합

### 범위 제외 (P3에서 빼는 것)
- OR 조합: AND만 지원 (대부분의 CRM에서 AND가 기본)
- 필터 프리셋 저장/불러오기: 별도 P7으로 분리
- JSONB 필드 정렬: DB 컬럼(registeredAt, integratedCode) 정렬만 지원

## 2. 기능 요구사항

### FR-01: FilterBuilder 컴포넌트
- "필터" 버튼 클릭 시 Popover로 FilterBuilder 표시
- 필터 조건 추가: 필드 선택 → 연산자 선택 → 값 입력
- 필드 타입별 연산자:
  - text/textarea/phone/email: contains, equals, not_equals, is_empty, is_not_empty
  - number/currency: equals, not_equals, gt, gte, lt, lte, is_empty, is_not_empty
  - date/datetime: equals, before, after, between, is_empty, is_not_empty
  - select: equals, not_equals, is_empty, is_not_empty
  - checkbox: is_true, is_false
- 필드 타입별 값 입력 UI:
  - text계열: Input
  - number/currency: Input type=number
  - date/datetime: date picker (Input type=date)
  - select: 해당 필드의 options에서 Select
  - checkbox: 값 입력 불필요 (연산자가 곧 조건)
  - between: 시작/끝 2개 Input
- 다중 조건: "조건 추가" 버튼으로 AND 조건 추가 (최대 10개)
- 각 조건 행에 삭제 버튼 (X)
- "적용" 버튼으로 필터 실행, "초기화" 버튼으로 전체 해제
- 활성 필터 수를 버튼에 Badge로 표시

### FR-02: RecordToolbar 필터 버튼 통합
- 검색 Input 오른쪽에 "필터" 버튼 추가 (Filter 아이콘)
- 필터 활성 시 버튼에 활성 필터 수 Badge
- 기존 키워드 검색은 유지 (필터와 AND 결합)

### FR-03: 컬럼 정렬
- RecordTable 헤더 셀 클릭 시 정렬 토글
- 정렬 순서: none → asc → desc → none
- 정렬 방향 표시: ArrowUp / ArrowDown 아이콘
- 정렬 가능 컬럼: registeredAt (등록일), integratedCode (통합코드)
- JSONB 필드 정렬은 지원하지 않음 (인덱스 없음, 성능 이슈)
- 한 번에 하나의 컬럼만 정렬 (multi-sort 없음)

### FR-04: API 필터 파라미터 확장
- 기존: `search`, `distributionOrder`, `sortField`, `sortOrder`
- 추가: `filters` 쿼리 파라미터 (JSON 인코딩)
- 필터 구조: `[{ field, operator, value }]` 배열
- 서버에서 각 조건을 JSONB 쿼리로 변환
- 각 조건은 AND로 결합

### FR-05: useRecords 훅 확장
- `filters` 파라미터 추가 (FilterCondition[] 타입)
- buildQueryString에서 JSON.stringify로 직렬화
- 필터 변경 시 page 1로 리셋

## 3. 기술 설계 방향

### 필터 조건 타입
```typescript
interface FilterCondition {
    field: string;           // 필드 key (JSONB 키)
    operator: FilterOperator;
    value: string | number | boolean | null;
    valueTo?: string | number; // between 연산자용
}

type FilterOperator =
    | "contains" | "equals" | "not_equals"
    | "gt" | "gte" | "lt" | "lte"
    | "before" | "after" | "between"
    | "is_empty" | "is_not_empty"
    | "is_true" | "is_false";
```

### API 필터 → SQL 변환
```sql
-- text contains
data->>'fieldKey' ILIKE '%value%'

-- number gt
(data->>'fieldKey')::numeric > value

-- date before
(data->>'fieldKey')::date < 'value'

-- is_empty
(data->>'fieldKey' IS NULL OR data->>'fieldKey' = '')

-- checkbox is_true
(data->>'fieldKey')::boolean = true
```

### 기존 재활용
- `useRecords` 훅: filters 파라미터만 추가
- `sortField`/`sortOrder`: 이미 API + 훅에 구현 완료 → UI만 연결
- RecordToolbar: 기존 구조에 필터 버튼 추가
- RecordTable: 기존 TableHead에 클릭 핸들러 + 아이콘 추가

## 4. 변경 파일 목록

| # | 파일 | 변경 유형 | 설명 |
|---|------|-----------|------|
| 1 | `src/types/index.ts` | 수정 | FilterCondition, FilterOperator 타입 추가 |
| 2 | `src/components/records/FilterBuilder.tsx` | 신규 | 필터 조건 빌더 Popover 컴포넌트 |
| 3 | `src/components/records/RecordToolbar.tsx` | 수정 | 필터 버튼 + FilterBuilder 통합 |
| 4 | `src/components/records/RecordTable.tsx` | 수정 | 헤더 정렬 클릭 + 아이콘 |
| 5 | `src/hooks/useRecords.ts` | 수정 | filters 파라미터 추가 |
| 6 | `src/pages/api/partitions/[id]/records.ts` | 수정 | filters 쿼리 파라미터 파싱 + JSONB 필터 SQL |
| 7 | `src/pages/records.tsx` | 수정 | filters/sort 상태 관리 통합 |

## 5. 의존성
- 외부 라이브러리 추가 없음 (ShadCN Popover, Select, Input, Button 모두 기존 사용 중)
- DB 스키마 변경 없음
- 기존 sortField/sortOrder API 재활용

## 6. 검증 기준
- `npx next build` 성공
- 필터 버튼 클릭 → FilterBuilder Popover 표시
- 텍스트 필드 "contains" 필터 적용 → 해당 레코드만 표시
- 숫자 필드 "gt" 필터 적용 → 올바른 결과
- 날짜 필드 "before"/"after" 필터 적용
- select 필드 "equals" 필터 적용
- 다중 필터 AND 조합 → 교집합 결과
- 필터 초기화 → 전체 레코드 복원
- 활성 필터 수 Badge 표시
- 통합코드 헤더 클릭 → 정렬 토글 (asc/desc/none)
- 등록일 헤더 클릭 → 정렬 토글
- 정렬 + 필터 동시 사용
- 기존 키워드 검색 + 필터 동시 사용
