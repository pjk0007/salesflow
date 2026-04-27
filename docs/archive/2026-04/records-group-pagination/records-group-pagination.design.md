# 레코드 그룹뷰 페이지네이션 — Design

> Plan: [docs/01-plan/features/records-group-pagination.plan.md](../01-plan/features/records-group-pagination.plan.md)
>
> 옵션 B 채택: 기존 records API 확장 + 그룹 카운트 API 신설

## 1. 데이터 흐름 개요

```
[GroupedRecordView]
    │
    ├─ useGroupCounts(partitionId, groupBy, search/filters)
    │      → GET /api/partitions/{id}/records/group-counts
    │      → { counts: { [groupValue]: number }, uncategorized: number, total: number }
    │
    └─ 각 RecordGroup (그룹별 1개 SWR 키)
           useGroupRecords(partitionId, groupBy, groupValue, page, search/filters)
              → GET /api/partitions/{id}/records?groupBy=...&groupValue=...&page=N&pageSize=50
              → { data: DbRecord[], total, page, pageSize, totalPages }
```

핵심:
- **카운트는 한 번만** 가져온다 (모든 그룹 동시).
- **각 그룹 레코드는 그룹별로 독립적인 SWR 키**로 가져온다 → 그룹별 mutate 가능.
- 페이지 사이즈는 그룹별 50건 고정.

## 2. API 설계

### 2.1 기존 records API 확장

**파일**: [src/app/api/partitions/[id]/records/route.ts](../../../src/app/api/partitions/[id]/records/route.ts)

추가 쿼리 파라미터:

| 파라미터 | 타입 | 설명 |
|---------|------|------|
| `groupBy` | string | 그룹 기준 필드 key (예: `status`) |
| `groupValue` | string | 해당 그룹의 값. 빈 문자열(`""`)이면 미분류 (NULL or empty) |

처리:
- `groupBy` + `groupValue` 둘 다 있을 때만 그룹 필터 적용 (없으면 기존 동작 그대로 = 플랫뷰 호환)
- `groupValue === ""` (미분류): `data->>{groupBy} IS NULL OR data->>{groupBy} = ''`
- 그 외: `data->>{groupBy} = {groupValue}`
- limit/offset, search, filters, sortField/sortOrder는 동일 적용

```ts
// route.ts 추가 부분 (개념)
const groupBy = searchParams.get("groupBy");
const groupValue = searchParams.get("groupValue");

if (groupBy) {
    if (groupValue === "" || groupValue === null) {
        conditions.push(sql`(${records.data}->>${groupBy} IS NULL OR ${records.data}->>${groupBy} = '')`);
    } else {
        conditions.push(sql`${records.data}->>${groupBy} = ${groupValue}`);
    }
}
```

응답 형태는 기존과 동일 (`data`, `total`, `page`, `pageSize`, `totalPages`).

### 2.2 그룹 카운트 API 신설

**파일**: `src/app/api/partitions/[id]/records/group-counts/route.ts` (신규)

요청:
```
GET /api/partitions/{id}/records/group-counts?groupBy=status&search=...&filters=...
```

응답:
```json
{
    "success": true,
    "groupBy": "status",
    "counts": {
        "신규": 247,
        "진행중": 89,
        "완료": 1034
    },
    "uncategorized": 12,
    "total": 1382
}
```

쿼리 (JSONB GROUP BY):
```sql
SELECT
    COALESCE(NULLIF(data->>'{groupBy}', ''), '__uncategorized__') AS group_value,
    COUNT(*) AS cnt
FROM records
WHERE partition_id = ? AND <search/filter conditions>
GROUP BY group_value;
```

- `__uncategorized__`로 들어온 행만 따로 빼서 `uncategorized` 필드로.
- 검색/필터/distributionOrder 조건은 records GET과 동일한 헬퍼로 빌드 → 코드 중복 방지를 위해 `lib/records/buildWhereConditions.ts` 헬퍼 추출 검토 (선택, 너무 추출하기 모호하면 인라인 유지).

성능:
- JSONB `data->>{key}` GROUP BY는 행 많을 때 느릴 수 있음. 1차 릴리스에서는 인덱스 추가 안 함 (이슈 발생 시 partial index 추가 검토).
- SWR 캐싱으로 재호출 최소화 (검색/필터 키에 종속).

### 2.3 인증/권한

기존 `verifyPartitionAccess` 그대로 사용.

## 3. 클라이언트 — 훅

### 3.1 `useGroupCounts` (신규)

**파일**: `src/components/records/hooks/useGroupCounts.ts` (신규, feature-based 구조)

```ts
interface UseGroupCountsParams {
    partitionId: number | null;
    groupBy: string | null;
    search?: string;
    distributionOrder?: number;
    filters?: FilterCondition[];
}

interface GroupCountsResponse {
    success: boolean;
    groupBy: string;
    counts: Record<string, number>;
    uncategorized: number;
    total: number;
}

export function useGroupCounts(params: UseGroupCountsParams) {
    const key = params.partitionId && params.groupBy
        ? `/api/partitions/${params.partitionId}/records/group-counts?${qs}` : null;
    const { data, error, isLoading, mutate } = useSWR<GroupCountsResponse>(key, defaultFetcher);
    return {
        counts: data?.counts ?? {},
        uncategorized: data?.uncategorized ?? 0,
        total: data?.total ?? 0,
        isLoading,
        mutate,
    };
}
```

### 3.2 `useGroupRecords` (신규)

**파일**: `src/components/records/hooks/useGroupRecords.ts` (신규)

```ts
interface UseGroupRecordsParams {
    partitionId: number | null;
    groupBy: string | null;
    groupValue: string;       // "" → 미분류
    page: number;             // 1부터
    pageSize?: number;        // 기본 50
    search?: string;
    distributionOrder?: number;
    filters?: FilterCondition[];
    sortField?: string;
    sortOrder?: "asc" | "desc";
    enabled?: boolean;        // 그룹 펼쳐졌을 때만 fetch
}

export function useGroupRecords(params: UseGroupRecordsParams) {
    const key = (params.enabled !== false && params.partitionId && params.groupBy != null)
        ? `/api/partitions/${params.partitionId}/records?${qs}` : null;
    const { data, isLoading, mutate } = useSWR<RecordsResponse>(key, defaultFetcher);
    return {
        records: data?.data ?? [],
        total: data?.total ?? 0,
        totalPages: data?.totalPages ?? 0,
        isLoading,
        mutate,
    };
}
```

### 3.3 기존 `useRecords` 변경 여부

- 변경 없음. 플랫뷰가 그대로 사용.
- `useGroupRecords`는 별도 훅으로 분리 — 캐시 키 / 응답 합치기 / enabled 처리가 달라 한 훅에 우겨넣으면 복잡도 ↑.

## 4. 클라이언트 — 컴포넌트

### 4.1 [src/app/records/page.tsx](../../../src/app/records/page.tsx)

변경:
- `useRecords`는 **viewMode === "flat"일 때만** 데이터 사용.
- `viewMode === "grouped"`일 땐 `GroupedRecordView`에 다음만 넘김:
  - `partitionId`, `groupByField` (= 기존 `statusField`)
  - `fields`, `visibleFieldKeys`, `selectedIds/onSelectionChange`
  - `search`, `filters`, `distributionOrder`, `sortField`, `sortOrder`
  - `onUpdateRecord`, `onRecordClick`, `onCreateWithStatus`
  - `duplicateHighlight` — **그룹뷰에서는 비활성화** (현재 페이지 50건 기준이라 그룹뷰와 의미 충돌). 1차 릴리스에서 그룹뷰일 땐 `null` 전달, 후속 작업 메모.
- `page`, `totalPages`, `total`, `pageSize`, `onPageChange`는 더 이상 그룹뷰에 안 넘김.

```tsx
{viewMode === "grouped" && statusField ? (
    <GroupedRecordView
        partitionId={partitionId}
        groupByField={statusField}
        fields={fields}
        visibleFieldKeys={visibleFieldKeys}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        onUpdateRecord={handleUpdateRecord}
        onRecordClick={setDetailRecord}
        search={search}
        filters={filters}
        distributionOrder={distributionOrder}
        sortField={sortField}
        sortOrder={sortOrder}
        onSortChange={handleSortChange}
        onCreateWithStatus={handleCreateWithStatus}
    />
) : (
    <RecordTable ... />
)}
```

### 4.2 [src/components/records/GroupedRecordView.tsx](../../../src/components/records/GroupedRecordView.tsx)

대대적 리팩토링. 책임 변경:
- ~~props로 받은 records를 클라이언트에서 그룹핑~~ → **자체적으로 그룹 카운트 페치**
- ~~하단 페이지네이션 렌더~~ → **제거**
- 각 RecordGroup에 `partitionId`, `groupBy`, `groupValue`, 검색/필터/정렬 등 전달

새 props:
```ts
interface GroupedRecordViewProps {
    partitionId: number;
    groupByField: FieldDefinition;
    fields: FieldDefinition[];
    visibleFieldKeys: string[] | null;
    selectedIds: Set<number>;
    onSelectionChange: (ids: Set<number>) => void;
    onUpdateRecord: (id: number, data: Record<string, unknown>) => void;
    onRecordClick?: (record: DbRecord) => void;
    search?: string;
    filters?: FilterCondition[];
    distributionOrder?: number;
    sortField: string;
    sortOrder: "asc" | "desc";
    onSortChange: (field: string, order: "asc" | "desc") => void;
    onCreateWithStatus?: (statusValue: string) => void;
}
```

내부:
1. `useGroupCounts({ partitionId, groupBy: groupByField.key, search, filters, distributionOrder })`
2. options 순서대로 `groups` 배열 생성 (count > 0인 것만, 미분류 마지막)
3. 각 그룹에 대해 `<RecordGroup ...>` 렌더 — 그룹 컴포넌트 내부에서 SWR로 records fetch

색상 결정 로직(`DEFAULT_COLORS` 등) 유지.

### 4.3 [src/components/records/RecordGroup.tsx](../../../src/components/records/RecordGroup.tsx)

대대적 리팩토링. 책임 변경:
- ~~records prop으로 받음~~ → **자체적으로 useGroupRecords 호출**
- 그룹별 `page` state 내부 관리 (1, 2, 3, ...)
- 누적 records 배열 관리 (페이지 넘어갈 때마다 append)
- "더 보기" 버튼 + IntersectionObserver 둘 다 지원
- 펼침/접힘 유지 — 접혀있으면 `enabled: false`로 fetch 스킵

새 props:
```ts
interface RecordGroupProps {
    partitionId: number;
    groupBy: string;
    statusValue: string;       // 그룹 값 ("" = 미분류)
    statusLabel: string;
    statusColor?: string;
    count: number;             // 그룹 전체 개수
    fields: FieldDefinition[];
    visibleFieldKeys: string[] | null;
    selectedIds: Set<number>;
    onSelectionChange: (ids: Set<number>) => void;
    onUpdateRecord: (id: number, data: Record<string, unknown>) => void;
    onRecordClick?: (record: DbRecord) => void;
    search?: string;
    filters?: FilterCondition[];
    distributionOrder?: number;
    sortField: string;
    sortOrder: "asc" | "desc";
    onSortChange: (field: string, order: "asc" | "desc") => void;
    onCreateWithStatus?: (statusValue: string) => void;
    isSquare?: boolean;
}
```

내부 state:
```ts
const PAGE_SIZE = 50;
const [collapsed, setCollapsed] = useState(false);
const [loadedPages, setLoadedPages] = useState(1); // 1, 2, 3, ...

// 누적 records: page 1..loadedPages를 모두 가져와 합침
// → 단일 SWR 키로 page=1부터 N까지 한번에 받기는 어려움
// → 대안: page별로 분리된 SWR 호출 후 메모이즈해서 concat

// 더 단순한 방식: pageSize를 동적으로 늘림
// page=1, pageSize=50*loadedPages → 한 번에 받음 (fresh load)
const { records, total, isLoading } = useGroupRecords({
    partitionId,
    groupBy,
    groupValue: statusValue,
    page: 1,
    pageSize: PAGE_SIZE * loadedPages,
    enabled: !collapsed,
    search, filters, distributionOrder, sortField, sortOrder,
});

const hasMore = records.length < total;

const handleLoadMore = () => {
    if (isLoading || !hasMore) return;
    setLoadedPages(p => p + 1);
};

// IntersectionObserver
const sentinelRef = useRef<HTMLDivElement>(null);
useEffect(() => {
    if (collapsed || !hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
        ([entry]) => {
            if (entry.isIntersecting) handleLoadMore();
        },
        { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
}, [collapsed, hasMore, isLoading]);

// 검색/필터/정렬 변경 시 loadedPages 리셋
useEffect(() => {
    setLoadedPages(1);
}, [search, JSON.stringify(filters), distributionOrder, sortField, sortOrder]);
```

UI:
- 그룹 헤더 카운트는 prop `count` (그룹 전체) 그대로 표시
- 그룹 바디 마지막에:
  - records.length < total 이면 → `<div ref={sentinelRef} />` + "더 보기 (남은 N건)" 버튼
  - records.length >= total 이면 → 표시 안 함
- 로딩 중이면 스피너 표시 (현재 페이지 추가 로드 중)

#### 페이지네이션 방식 결정 — `pageSize` 늘리기 vs page별 분리 호출

**채택**: `pageSize = 50 * loadedPages`로 한 번에 가져오는 방식.

**이유**:
- SWR 키가 `loadedPages`에 종속되어 단순. 페이지별 누적 합치기 로직 불필요.
- 매번 1번부터 다시 받지만, 페이지별로 따로 받아 concat하는 방식도 SWR이 캐시 보유 → 네트워크 비용은 거의 동일 (서버 쿼리는 늘어남).
- **트레이드오프**: pageSize가 커지면 서버 쿼리가 무거워짐. 200건 제한이 API에 있음(`Math.min(200, pageSize)`).
- → **API 상한 제거 필요** (또는 그룹 호출에서만 상한 완화). pageSize는 클라이언트 의도가 명확하면 신뢰. **상한을 1000으로 완화**.

**대안**: page별 분리 호출 (page=1, page=2, ... 각각 SWR 키)
- 누적 records 메모이즈 필요, 코드 복잡도 ↑
- 페이지 상한 영향 없음
- → 1차 릴리스에서는 단순한 방식으로 가고, 그룹당 1000건 넘는 케이스(20+ 페이지) 사용자 발견 시 분리 호출로 전환.

## 5. 동작 시퀀스

### 5.1 그룹뷰 진입
1. `GroupedRecordView` 마운트 → `useGroupCounts` 발사
2. 응답 도착 → groups 배열 결정
3. 각 `RecordGroup` 마운트 → `useGroupRecords` 발사 (page 1, pageSize 50)
4. 그룹별로 첫 50건 표시

### 5.2 "더 보기" 클릭 또는 스크롤 도달
1. `setLoadedPages(p => p + 1)` → SWR 키 변경
2. 새 키로 새 호출 (pageSize = 100, 150, ...)
3. records 누적 표시 (서버에서 정렬된 순서대로 처음부터 N건)
4. records.length === total이면 sentinel + 버튼 비표시

### 5.3 검색/필터/정렬 변경
1. 부모 page.tsx에서 search/filters/sortField 변경
2. `useGroupCounts` SWR 키 변경 → 카운트 다시 가져옴
3. 모든 `RecordGroup`의 `useEffect` 트리거 → `loadedPages` 리셋 → records SWR 키 변경 → 다시 50건부터

### 5.4 레코드 수정
- status 필드(=groupBy 필드) 변경 시 → 모든 그룹 mutate + counts mutate (FR-8 단순 처리)
- 그 외 필드 변경 시 → 해당 그룹만 mutate (records 배열 안에서 부분 업데이트)
- 구현: `RecordGroup` 내부 `handleUpdateRecord` 래퍼에서 status 필드 변경 감지 → 부모에 콜백으로 전체 mutate 알림

```ts
const handleUpdateRecord = (id: number, data: Record<string, unknown>) => {
    const willChangeGroup = data[groupBy] !== undefined;
    onUpdateRecord(id, data); // 부모 호출 (서버 업데이트)
    if (willChangeGroup) {
        onGroupChanged?.(); // 부모가 모든 그룹 + counts mutate
    } else {
        groupMutate(); // 이 그룹만
    }
};
```

부모(GroupedRecordView)에서 `onGroupChanged` 받으면 모든 그룹 SWR 캐시 invalidate:
```ts
import { mutate as globalMutate } from "swr";
const handleGroupChanged = () => {
    countsMutate();
    globalMutate(key => typeof key === "string" && key.startsWith(`/api/partitions/${partitionId}/records?`));
};
```

### 5.5 레코드 추가/삭제
- bulk import / single create / delete → 부모에서 `mutateRecords()` 호출 중. 그룹뷰에서는 동등하게 모든 그룹 + counts 갱신 필요.
- 부모 page.tsx의 createRecord/bulkDelete 등에서 viewMode === "grouped"이면 `globalMutate` 패턴으로 그룹 SWR 전체 invalidate.
- 또는 더 단순하게: **viewMode가 "grouped"일 때도 SSE로 들어오는 record:created/updated/deleted 이벤트를 받아 자동 invalidate**. 현재 [src/hooks/useSSE.ts](../../../src/hooks/useSSE.ts)가 어떻게 mutate 하는지 확인 필요 (Design 검증 시점에 확인).

## 6. SSE 통합

기존 SSE는 `mutateRecords` (단일 키) 호출 중. 그룹뷰에서는 그룹별 키가 N개라 단일 mutate로 안 됨.
**대응**: 부모 page.tsx에서 SSE 이벤트 수신 시 viewMode에 따라 분기:
- `flat`: `mutateRecords()` (현행 유지)
- `grouped`: `globalMutate(key => ...)` 패턴으로 모든 그룹 + counts 캐시 invalidate

## 7. 에러 처리 / 빈 상태

- 그룹 카운트 에러: 전체 영역에 에러 메시지 + 재시도 버튼
- 그룹 records 에러: 해당 그룹 영역에만 에러 표시
- counts 응답이 모두 0: "레코드가 없습니다" (기존 동일)
- 펼친 그룹의 records 응답이 빈 배열 (count > 0인데 페이지에 0건): 발생 X (count 기반 가드)

## 8. 타입 변경

### 추가
- `src/components/records/types/index.ts` (신규):
  ```ts
  export interface GroupCountsResponse {
      success: boolean;
      groupBy: string;
      counts: Record<string, number>;
      uncategorized: number;
      total: number;
  }
  ```

### 수정
- `RecordGroupProps`, `GroupedRecordViewProps` (위 4.2, 4.3 참조)

## 9. 영향 범위 정리

| 파일 | 변경 종류 | 라인 추정 |
|------|----------|-----------|
| `src/app/api/partitions/[id]/records/route.ts` | 수정 (groupBy/groupValue + pageSize 상한 완화) | +15 |
| `src/app/api/partitions/[id]/records/group-counts/route.ts` | 신규 | ~80 |
| `src/components/records/hooks/useGroupCounts.ts` | 신규 | ~50 |
| `src/components/records/hooks/useGroupRecords.ts` | 신규 | ~60 |
| `src/components/records/GroupedRecordView.tsx` | 대폭 수정 | ±150 |
| `src/components/records/RecordGroup.tsx` | 대폭 수정 | ±180 |
| `src/app/records/page.tsx` | 부분 수정 (그룹뷰 props, SSE 분기) | ±40 |
| `src/components/records/types/index.ts` | 신규 (선택) | ~20 |

200줄 초과 위험:
- `RecordGroup.tsx`: 현재 124줄 → 약 200줄 예상. observer/loadMore 로직을 `useInfiniteScroll` 훅으로 분리해 150줄 이하로 유지.
- `useInfiniteScroll`: `src/components/records/hooks/useInfiniteScroll.ts` 신규 가능.

## 10. 테스트 / 검증 (Zero Script QA 가이드)

### 수동 시나리오
1. **그룹뷰 진입**: 카운트가 모두 표시되는지, 첫 50건이 그룹별로 보이는지
2. **더 보기 클릭**: 그룹 records가 50건씩 추가되는지, 다른 그룹 영향 X
3. **무한 스크롤**: 그룹 끝까지 스크롤 → 자동 로드, 모두 로드 후 sentinel 비표시
4. **검색**: 검색어 입력 → 모든 그룹 카운트 + 첫 페이지 갱신
5. **필터**: 필터 추가 → 동일
6. **정렬**: 정렬 필드 변경 → 모든 그룹 페이지 리셋 + 정렬 적용
7. **그룹 접기/펼치기**: 접으면 fetch 안 함, 펼치면 그 시점에 fetch
8. **레코드 status 변경**: 그룹 간 이동 → 양쪽 그룹 카운트 + records 갱신
9. **레코드 일반 필드 수정**: 해당 그룹 records만 부분 업데이트
10. **새 레코드 생성**: 해당 그룹에 추가됨
11. **bulk delete**: 여러 그룹에 걸쳐 선택된 레코드 삭제 → 모든 그룹 갱신
12. **플랫뷰 전환**: 그룹뷰 → 플랫뷰 → 플랫 페이지네이션 정상
13. **SSE**: 다른 세션에서 레코드 생성/수정/삭제 → 그룹뷰에 반영

### 회귀 체크
- 플랫뷰 페이지네이션 (변경 없음) 정상 동작
- duplicateHighlight: 플랫뷰는 정상, 그룹뷰는 비활성 (메모)

## 11. 후속 작업 (이번 스코프 외)

- [ ] 그룹뷰 duplicateHighlight 지원 (그룹별 중복 감지 로직 재설계 필요)
- [ ] status 그룹 간 이동 낙관적 업데이트 (현재는 전체 mutate)
- [ ] 그룹별 카운트 인덱싱 최적화 (성능 이슈 발생 시)
- [ ] 그룹 펼침/접힘 상태 영속화 (localStorage 또는 partition 설정)
- [ ] 그룹뷰 전용 페이지당 N건 옵션 (현재 50 고정)

## 12. 다음 단계

→ `/pdca do records-group-pagination`
