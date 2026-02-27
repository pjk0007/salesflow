# Design: Customer Management (고객 관리)

> 작성일: 2026-02-12
> 상태: Draft
> Plan 참조: [customer-management.plan.md](../../01-plan/features/customer-management.plan.md)

---

## 1. 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────┐
│ Frontend (Next.js Pages Router)                              │
│                                                              │
│  index.tsx (메인 페이지)                                      │
│  ┌──────────────┐  ┌──────────────────────────────────────┐  │
│  │ PartitionNav │  │ RecordTable                          │  │
│  │              │  │  ┌─────────┐ ┌──────────────────┐   │  │
│  │ - 폴더 트리  │  │  │Toolbar  │ │ DataTable        │   │  │
│  │ - 파티션     │  │  │(검색/   │ │ - 동적 컬럼      │   │  │
│  │   선택       │  │  │ 필터/   │ │ - 인라인 편집    │   │  │
│  │              │  │  │ 추가)   │ │ - 체크박스 선택  │   │  │
│  └──────────────┘  │  └─────────┘ └──────────────────┘   │  │
│                    │  ┌──────────────────────────────────┐ │  │
│                    │  │ Pagination                       │ │  │
│                    │  └──────────────────────────────────┘ │  │
│                    └──────────────────────────────────────────┘│
│  ┌────────────────────────────────────────────────────────┐  │
│  │ CreateRecordDialog (필드 기반 동적 입력 폼)              │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           │ SWR + fetch
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ API Routes (Next.js API)                                     │
│                                                              │
│  /api/workspaces              GET    워크스페이스 목록         │
│  /api/workspaces/[id]/partitions  GET  파티션+폴더            │
│  /api/workspaces/[id]/fields  GET    필드 정의                │
│  /api/partitions/[id]/records GET    레코드 목록              │
│  /api/partitions/[id]/records POST   레코드 생성              │
│  /api/records/[id]            PATCH  레코드 수정              │
│  /api/records/[id]            DELETE 레코드 삭제              │
│  /api/records/bulk-delete     POST   일괄 삭제                │
│                                                              │
│  ※ 모든 API에 getUserFromRequest() 인증 미들웨어 적용         │
└─────────────────────────────────────────────────────────────┘
                           │ Drizzle ORM
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ PostgreSQL                                                   │
│  organizations → workspaces → partitions → records (JSONB)  │
│                              fieldDefinitions                │
│                              folders                          │
└─────────────────────────────────────────────────────────────┘
```

## 2. API 상세 설계

### 2.1 공통 인증 패턴

모든 API 핸들러에서 동일한 인증 패턴을 사용한다.
기존 `getUserFromRequest()` 함수를 활용하며, 별도의 미들웨어 래퍼는 만들지 않는다.

```typescript
// 모든 API 핸들러 최상단
const user = getUserFromRequest(req);
if (!user) {
  return res.status(401).json({ success: false, error: "인증이 필요합니다." });
}
// user.orgId를 사용하여 데이터 접근 범위 제한
```

### 2.2 GET /api/workspaces

**목적**: 현재 사용자 조직의 워크스페이스 목록 조회

**파일**: `src/pages/api/workspaces/index.ts`

**Query Parameters**: 없음

**Response (200)**:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "영업관리",
      "description": "메인 영업 워크스페이스",
      "icon": "briefcase"
    }
  ]
}
```

**SQL**:
```sql
SELECT id, name, description, icon
FROM workspaces
WHERE org_id = :orgId
ORDER BY created_at ASC
```

### 2.3 GET /api/workspaces/[id]/partitions

**목적**: 워크스페이스의 폴더/파티션 트리 구조 조회

**파일**: `src/pages/api/workspaces/[id]/partitions.ts`

**Response (200)**:
```json
{
  "success": true,
  "data": {
    "folders": [
      {
        "id": 1,
        "name": "신규고객",
        "displayOrder": 0,
        "partitions": [
          {
            "id": 1,
            "name": "웹 유입",
            "displayOrder": 0
          }
        ]
      }
    ],
    "ungrouped": [
      {
        "id": 3,
        "name": "기타",
        "displayOrder": 0
      }
    ]
  }
}
```

**로직**:
1. 워크스페이스가 현재 사용자 조직에 속하는지 검증
2. 폴더 목록 조회 (displayOrder 순)
3. 파티션 목록 조회 (displayOrder 순)
4. 폴더에 속한 파티션과 미분류 파티션을 분리하여 트리 구조로 반환

### 2.4 GET /api/workspaces/[id]/fields

**목적**: 워크스페이스의 필드 정의 목록 조회

**파일**: `src/pages/api/workspaces/[id]/fields.ts`

**Response (200)**:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "key": "name",
      "label": "고객명",
      "fieldType": "text",
      "category": "기본정보",
      "sortOrder": 0,
      "isRequired": 1,
      "isSystem": 1,
      "defaultWidth": 150,
      "minWidth": 80,
      "cellType": "editable",
      "options": null,
      "statusOptionCategoryId": null,
      "formulaConfig": null
    }
  ]
}
```

**SQL**:
```sql
SELECT * FROM field_definitions
WHERE workspace_id = :workspaceId
ORDER BY sort_order ASC, id ASC
```

### 2.5 GET /api/partitions/[id]/records

**목적**: 파티션 내 레코드 페이지네이션 조회

**파일**: `src/pages/api/partitions/[id]/records.ts`

**Query Parameters**:
| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| page | number | 1 | 페이지 번호 |
| pageSize | number | 50 | 페이지 크기 (최대 200) |
| search | string | - | 키워드 검색 (data JSONB 내 텍스트 검색) |
| distributionOrder | number | - | 분배순서 필터 |
| sortField | string | "registeredAt" | 정렬 필드 |
| sortOrder | string | "desc" | 정렬 방향 (asc/desc) |

**Response (200)**:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "integratedCode": "SALES-0001",
      "distributionOrder": 1,
      "data": {
        "name": "김철수",
        "phone": "010-1234-5678",
        "status": "상담중"
      },
      "registeredAt": "2026-02-12T00:00:00Z",
      "createdAt": "2026-02-12T00:00:00Z",
      "updatedAt": "2026-02-12T00:00:00Z"
    }
  ],
  "total": 150,
  "page": 1,
  "pageSize": 50,
  "totalPages": 3
}
```

**키워드 검색 로직**:
```sql
-- JSONB 내 텍스트 값 검색 (data::text ILIKE)
WHERE partition_id = :partitionId
  AND data::text ILIKE '%검색어%'
```

### 2.6 POST /api/partitions/[id]/records

**목적**: 새 레코드 생성

**파일**: `src/pages/api/partitions/[id]/records.ts` (같은 파일, POST 메서드)

**Request Body**:
```json
{
  "data": {
    "name": "김철수",
    "phone": "010-1234-5678"
  }
}
```

**로직**:
1. 파티션이 현재 사용자 조직에 속하는지 검증 (records → partitions → workspaces → org_id)
2. 중복 체크 (partition.duplicateCheckField 설정 시)
3. 통합코드 자동 발번: `organizations.integratedCodePrefix` + `-` + 시퀀스(zero-padded 4자리)
4. 분배순서 자동 할당 (partition.useDistributionOrder 활성 시)
5. 레코드 INSERT

**통합코드 생성 로직**:
```typescript
// 트랜잭션 내에서 실행
const [org] = await tx.select().from(organizations).where(eq(organizations.id, user.orgId));
const newSeq = org.integratedCodeSeq + 1;
const code = `${org.integratedCodePrefix}-${String(newSeq).padStart(4, '0')}`;
await tx.update(organizations).set({ integratedCodeSeq: newSeq }).where(eq(organizations.id, org.id));
```

**분배순서 자동 할당 로직**:
```typescript
if (partition.useDistributionOrder) {
  const nextOrder = (partition.lastAssignedOrder % partition.maxDistributionOrder) + 1;
  distributionOrder = nextOrder;
  await tx.update(partitions)
    .set({ lastAssignedOrder: nextOrder })
    .where(eq(partitions.id, partition.id));
}
```

**Response (201)**:
```json
{
  "success": true,
  "data": {
    "id": 10,
    "integratedCode": "SALES-0010",
    "distributionOrder": 1,
    "data": { "name": "김철수", "phone": "010-1234-5678" },
    "registeredAt": "2026-02-12T00:00:00Z"
  }
}
```

### 2.7 PATCH /api/records/[id]

**목적**: 레코드 데이터 부분 업데이트

**파일**: `src/pages/api/records/[id].ts`

**Request Body**:
```json
{
  "data": {
    "phone": "010-9999-8888",
    "status": "계약완료"
  }
}
```

**로직**:
1. 레코드가 사용자 조직에 속하는지 검증 (records.orgId === user.orgId)
2. 기존 data와 병합 (spread): `{ ...existingData, ...newData }`
3. updatedAt 갱신

**Response (200)**:
```json
{
  "success": true,
  "data": {
    "id": 10,
    "data": { "name": "김철수", "phone": "010-9999-8888", "status": "계약완료" },
    "updatedAt": "2026-02-12T01:00:00Z"
  }
}
```

### 2.8 DELETE /api/records/[id]

**목적**: 단건 레코드 삭제

**파일**: `src/pages/api/records/[id].ts` (같은 파일, DELETE 메서드)

**로직**:
1. 레코드가 사용자 조직에 속하는지 검증
2. DELETE (cascade로 memos도 함께 삭제)

**Response (200)**:
```json
{
  "success": true,
  "message": "레코드가 삭제되었습니다."
}
```

### 2.9 POST /api/records/bulk-delete

**목적**: 다건 레코드 일괄 삭제

**파일**: `src/pages/api/records/bulk-delete.ts`

**Request Body**:
```json
{
  "ids": [1, 2, 3]
}
```

**로직**:
1. 모든 레코드가 사용자 조직에 속하는지 검증
2. `inArray(records.id, ids)` + `eq(records.orgId, user.orgId)`로 삭제

**Response (200)**:
```json
{
  "success": true,
  "message": "3건의 레코드가 삭제되었습니다.",
  "deletedCount": 3
}
```

## 3. 컴포넌트 설계

### 3.1 파일 구조

```
src/
├── pages/
│   ├── index.tsx                          # 메인 페이지 (수정)
│   └── api/
│       ├── workspaces/
│       │   ├── index.ts                   # GET 워크스페이스 목록
│       │   └── [id]/
│       │       ├── partitions.ts          # GET 파티션+폴더 트리
│       │       └── fields.ts             # GET 필드 정의
│       ├── partitions/
│       │   └── [id]/
│       │       └── records.ts            # GET 목록 / POST 생성
│       └── records/
│           ├── [id].ts                    # PATCH 수정 / DELETE 삭제
│           └── bulk-delete.ts             # POST 일괄삭제
├── components/
│   └── records/
│       ├── PartitionNav.tsx               # 폴더/파티션 사이드 네비게이션
│       ├── RecordTable.tsx                # 레코드 데이터 테이블
│       ├── RecordToolbar.tsx              # 검색, 필터, 추가 버튼 바
│       ├── CreateRecordDialog.tsx         # 레코드 생성 다이얼로그
│       ├── DeleteConfirmDialog.tsx        # 삭제 확인 다이얼로그
│       ├── CellRenderer.tsx              # 필드 타입별 셀 렌더러
│       └── InlineEditCell.tsx            # 인라인 편집 셀
└── hooks/
    ├── useWorkspaces.ts                   # 워크스페이스 SWR 훅
    ├── usePartitions.ts                   # 파티션 SWR 훅
    ├── useFields.ts                       # 필드 정의 SWR 훅
    └── useRecords.ts                      # 레코드 CRUD SWR 훅
```

### 3.2 index.tsx (메인 페이지) 수정

```
┌─ WorkspaceLayout ────────────────────────────────────┐
│  ┌── 좌측 내비 (기존) ──┐  ┌── 메인 콘텐츠 ──────────┐│
│  │  레코드 ← active     │  │ ┌─ PartitionNav ────┐   ││
│  │  알림톡               │  │ │ 워크스페이스 선택  │   ││
│  │  사용자               │  │ │ 폴더1             │   ││
│  │  워크스페이스 설정    │  │ │   └ 파티션A ←sel  │   ││
│  │  조직 설정            │  │ │   └ 파티션B       │   ││
│  │                       │  │ │ 미분류            │   ││
│  │                       │  │ │   └ 파티션C       │   ││
│  │                       │  │ └───────────────────┘   ││
│  │                       │  │ ┌─ RecordToolbar ───┐   ││
│  │                       │  │ │ [검색] [필터] [+] │   ││
│  │                       │  │ └───────────────────┘   ││
│  │                       │  │ ┌─ RecordTable ─────┐   ││
│  │                       │  │ │ □ 통합코드 고객명 │   ││
│  │                       │  │ │ □ SALES-01 김철수  │   ││
│  │                       │  │ │ □ SALES-02 이영희  │   ││
│  │                       │  │ └───────────────────┘   ││
│  │                       │  │ ┌─ Pagination ──────┐   ││
│  │                       │  │ │ < 1 2 3 ... 10 >  │   ││
│  │                       │  │ └───────────────────┘   ││
│  └───────────────────────┘  └────────────────────────┘│
└──────────────────────────────────────────────────────┘
```

**레이아웃**: 메인 콘텐츠 영역을 좌측 PartitionNav(240px) + 우측 레코드 영역으로 분할.

### 3.3 PartitionNav 컴포넌트

**Props**:
```typescript
interface PartitionNavProps {
  workspaceId: number | null;
  selectedPartitionId: number | null;
  onWorkspaceChange: (workspaceId: number) => void;
  onPartitionSelect: (partitionId: number) => void;
}
```

**동작**:
1. `useWorkspaces()` 훅으로 워크스페이스 목록 조회
2. 워크스페이스 선택 시 `usePartitions(workspaceId)` 훅으로 폴더/파티션 트리 조회
3. 폴더는 Collapsible 컴포넌트로 접기/펼치기
4. 파티션 클릭 시 `onPartitionSelect` 호출

### 3.4 RecordTable 컴포넌트

**Props**:
```typescript
interface RecordTableProps {
  partitionId: number;
  workspaceId: number;
}
```

**동작**:
1. `useFields(workspaceId)` 훅으로 필드 정의 조회 → 컬럼 자동 생성
2. `useRecords(partitionId, filters)` 훅으로 레코드 데이터 조회
3. ShadCN Table 컴포넌트 기반 테이블 렌더링
4. 첫 번째 컬럼은 체크박스 (다건 선택용)
5. 두 번째 컬럼은 통합코드 (읽기 전용)
6. 나머지 컬럼은 필드 정의의 `visibleFields` 또는 전체 필드

**컬럼 생성 로직**:
```typescript
// 파티션의 visibleFields가 있으면 해당 필드만, 없으면 전체 필드
const columns = (partition.visibleFields ?? fields.map(f => f.key))
  .map(key => fields.find(f => f.key === key))
  .filter(Boolean);
```

### 3.5 CellRenderer 컴포넌트

필드 타입에 따른 셀 렌더링 팩토리 패턴.

```typescript
interface CellRendererProps {
  field: FieldDefinition;
  value: unknown;
  record: Record<string, unknown>;
  onUpdate?: (key: string, value: unknown) => void;
}
```

**필드 타입별 렌더링**:

| fieldType | cellType | 렌더링 방식 |
|-----------|----------|-------------|
| text | editable | Input (인라인 편집) |
| number | editable | Input type=number |
| phone | phone | 전화번호 형식 표시, 클릭 시 편집 |
| email | email | 이메일 링크 표시, 클릭 시 편집 |
| date | date | 날짜 형식 표시 (YYYY-MM-DD) |
| datetime | date | 날짜+시간 표시 |
| select | select | Select 드롭다운 |
| select | selectWithStatusBg | 배지 + 배경색 표시 |
| textarea | textarea | 말줄임 표시, 클릭 시 텍스트영역 |
| checkbox | checkbox | 체크박스 |
| currency | currency | 통화 형식 (1,234,000원) |
| formula | formula | 계산 결과 (읽기 전용) |
| user_select | user_select | 사용자 이름 표시 |

### 3.6 InlineEditCell 컴포넌트

셀 클릭 시 편집 모드로 전환하는 래퍼 컴포넌트.

```typescript
interface InlineEditCellProps {
  value: unknown;
  fieldType: FieldType;
  options?: string[];
  onSave: (value: unknown) => void;
}
```

**동작**:
1. 기본 상태: 값 표시 (읽기 모드)
2. 클릭 시: 편집 모드 전환 (Input/Select 등)
3. Enter 또는 blur 시: `onSave` 호출 후 읽기 모드 복귀
4. Escape 시: 편집 취소

### 3.7 CreateRecordDialog 컴포넌트

**Props**:
```typescript
interface CreateRecordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partitionId: number;
  workspaceId: number;
  onCreated: () => void;
}
```

**동작**:
1. `useFields(workspaceId)` 훅으로 필드 정의 조회
2. react-hook-form + zod로 동적 폼 생성
3. 필수 필드(isRequired)에 대한 유효성 검사
4. 필드 타입별 입력 컴포넌트 렌더링
5. 제출 시 POST `/api/partitions/[id]/records` 호출
6. 성공 시 `onCreated` 콜백 + toast 표시

### 3.8 RecordToolbar 컴포넌트

```typescript
interface RecordToolbarProps {
  onSearch: (keyword: string) => void;
  onFilterChange: (filters: RecordFilter) => void;
  onCreateClick: () => void;
  onBulkDelete: () => void;
  selectedCount: number;
  distributionOrderMax?: number;
}
```

**구성**:
- 좌측: 키워드 검색 Input (debounce 300ms)
- 중앙: 분배순서 필터 (Select), 추가 필터 (Popover)
- 우측: 선택 삭제 버튼 (selectedCount > 0일 때), 추가 버튼

## 4. SWR 훅 설계

### 4.1 useWorkspaces

```typescript
// src/hooks/useWorkspaces.ts
export function useWorkspaces() {
  const { data, error, isLoading } = useSWR<ApiResponse<Workspace[]>>(
    '/api/workspaces'
  );
  return {
    workspaces: data?.data ?? [],
    isLoading,
    error,
  };
}
```

### 4.2 usePartitions

```typescript
// src/hooks/usePartitions.ts
interface PartitionTree {
  folders: (Folder & { partitions: Partition[] })[];
  ungrouped: Partition[];
}

export function usePartitions(workspaceId: number | null) {
  const { data, error, isLoading } = useSWR<ApiResponse<PartitionTree>>(
    workspaceId ? `/api/workspaces/${workspaceId}/partitions` : null
  );
  return {
    partitionTree: data?.data ?? null,
    isLoading,
    error,
  };
}
```

### 4.3 useFields

```typescript
// src/hooks/useFields.ts
export function useFields(workspaceId: number | null) {
  const { data, error, isLoading } = useSWR<ApiResponse<FieldDefinition[]>>(
    workspaceId ? `/api/workspaces/${workspaceId}/fields` : null
  );
  return {
    fields: data?.data ?? [],
    isLoading,
    error,
  };
}
```

### 4.4 useRecords

```typescript
// src/hooks/useRecords.ts
interface UseRecordsParams {
  partitionId: number | null;
  page?: number;
  pageSize?: number;
  search?: string;
  distributionOrder?: number;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
}

export function useRecords(params: UseRecordsParams) {
  const queryString = buildQueryString(params);
  const { data, error, isLoading, mutate } = useSWR<PaginatedResponse<DbRecord>>(
    params.partitionId
      ? `/api/partitions/${params.partitionId}/records?${queryString}`
      : null
  );

  const createRecord = async (recordData: Record<string, unknown>) => {
    const res = await fetch(`/api/partitions/${params.partitionId}/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: recordData }),
    });
    const result = await res.json();
    if (result.success) mutate();
    return result;
  };

  const updateRecord = async (id: number, recordData: Record<string, unknown>) => {
    const res = await fetch(`/api/records/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: recordData }),
    });
    const result = await res.json();
    if (result.success) mutate();
    return result;
  };

  const deleteRecord = async (id: number) => {
    const res = await fetch(`/api/records/${id}`, { method: 'DELETE' });
    const result = await res.json();
    if (result.success) mutate();
    return result;
  };

  const bulkDelete = async (ids: number[]) => {
    const res = await fetch('/api/records/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    const result = await res.json();
    if (result.success) mutate();
    return result;
  };

  return {
    records: data?.data ?? [],
    total: data?.total ?? 0,
    page: data?.page ?? 1,
    pageSize: data?.pageSize ?? 50,
    totalPages: data?.totalPages ?? 0,
    isLoading,
    error,
    mutate,
    createRecord,
    updateRecord,
    deleteRecord,
    bulkDelete,
  };
}
```

## 5. 상태 관리

### 5.1 페이지 상태 (index.tsx)

```typescript
// URL query 기반 상태 (뒤로가기 지원)
const [workspaceId, setWorkspaceId] = useState<number | null>(null);
const [partitionId, setPartitionId] = useState<number | null>(null);

// 로컬 상태
const [page, setPage] = useState(1);
const [search, setSearch] = useState('');
const [filters, setFilters] = useState<RecordFilter>({});
const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
const [createDialogOpen, setCreateDialogOpen] = useState(false);
```

### 5.2 첫 번째 워크스페이스 자동 선택

워크스페이스가 로드되면 첫 번째 워크스페이스를 자동 선택.
파티션은 사용자가 직접 선택해야 레코드가 로드됨.

## 6. 에러 처리

### API 응답 규약

모든 API는 기존 패턴을 따른다:
```typescript
// 성공
{ success: true, data: ... }

// 실패
{ success: false, error: "에러 메시지" }
```

### 프론트엔드 에러 처리

- API 호출 실패 시 `toast.error()` (sonner) 표시
- SWR 로딩 시 Skeleton 컴포넌트 표시
- 빈 상태: "레코드가 없습니다" 메시지 + 등록 버튼

## 7. 구현 순서 (Implementation Checklist)

### Phase 1: API 구현

- [ ] 1-1. `src/pages/api/workspaces/index.ts` - GET 워크스페이스 목록
- [ ] 1-2. `src/pages/api/workspaces/[id]/partitions.ts` - GET 파티션 트리
- [ ] 1-3. `src/pages/api/workspaces/[id]/fields.ts` - GET 필드 정의
- [ ] 1-4. `src/pages/api/partitions/[id]/records.ts` - GET 레코드 목록 + POST 생성
- [ ] 1-5. `src/pages/api/records/[id].ts` - PATCH 수정 + DELETE 삭제
- [ ] 1-6. `src/pages/api/records/bulk-delete.ts` - POST 일괄삭제

### Phase 2: SWR 훅

- [ ] 2-1. `src/hooks/useWorkspaces.ts`
- [ ] 2-2. `src/hooks/usePartitions.ts`
- [ ] 2-3. `src/hooks/useFields.ts`
- [ ] 2-4. `src/hooks/useRecords.ts`

### Phase 3: UI 컴포넌트

- [ ] 3-1. `src/components/records/PartitionNav.tsx` - 파티션 네비게이션
- [ ] 3-2. `src/components/records/CellRenderer.tsx` - 셀 렌더러
- [ ] 3-3. `src/components/records/RecordTable.tsx` - 레코드 테이블
- [ ] 3-4. `src/components/records/RecordToolbar.tsx` - 툴바
- [ ] 3-5. `src/components/records/CreateRecordDialog.tsx` - 생성 다이얼로그
- [ ] 3-6. `src/components/records/DeleteConfirmDialog.tsx` - 삭제 확인
- [ ] 3-7. `src/components/records/InlineEditCell.tsx` - 인라인 편집

### Phase 4: 페이지 통합

- [ ] 4-1. `src/pages/index.tsx` 수정 - 전체 통합

## 8. 데이터 흐름 다이어그램

```
사용자 액션             SWR 훅              API                   DB
─────────────────────────────────────────────────────────────────────
페이지 로드
  → useWorkspaces()  → GET /workspaces     → SELECT workspaces
  ← 워크스페이스 목록

워크스페이스 선택
  → usePartitions()  → GET /ws/[id]/parts  → SELECT folders, partitions
  ← 파티션 트리
  → useFields()      → GET /ws/[id]/fields → SELECT field_definitions
  ← 필드 정의

파티션 선택
  → useRecords()     → GET /pt/[id]/recs   → SELECT records (paginated)
  ← 레코드 목록

레코드 생성
  → createRecord()   → POST /pt/[id]/recs  → INSERT records + UPDATE org seq
  ← 새 레코드
  → mutate()         (SWR 리밸리데이션)

셀 인라인 편집
  → updateRecord()   → PATCH /recs/[id]    → UPDATE records.data (merge)
  ← 수정된 레코드       (debounce 500ms)
  → mutate()

다건 삭제
  → bulkDelete()     → POST /recs/bulk-del → DELETE records WHERE id IN(...)
  ← 삭제 결과
  → mutate()
```
