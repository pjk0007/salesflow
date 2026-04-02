# Design: 리드 상태별 그룹 뷰

> Plan 문서: `docs/01-plan/features/lead-status-grouping.plan.md`

## 1. 아키텍처 개요

```
┌─ RecordsPage ─────────────────────────────────────────────┐
│                                                           │
│  ┌─ RecordToolbar ──────────────────────────────────────┐ │
│  │  [검색] [필터] ... [그룹 뷰 토글 ▤/≡] [추가]       │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                           │
│  viewMode === "grouped"                                   │
│  ┌─ GroupedRecordView ──────────────────────────────────┐ │
│  │                                                      │ │
│  │  ┌─ RecordGroup ("연락 중", 41건) ────────────────┐  │ │
│  │  │  ▼ ● 연락 중  41                               │  │ │
│  │  │  ┌─ RecordTable (헤더 없는 미니 버전) ────────┐ │  │ │
│  │  │  │  □ SALES-001  메타광고  리뷰  체험 요청   │ │  │ │
│  │  │  │  □ SALES-002  메타광고  리뷰  체험 요청   │ │  │ │
│  │  │  └────────────────────────────────────────────┘ │  │ │
│  │  │  + 신규 Item                                    │  │ │
│  │  └────────────────────────────────────────────────┘  │ │
│  │                                                      │ │
│  │  ┌─ RecordGroup ("핵심", 3건) ────────────────────┐  │ │
│  │  │  ▼ ● 핵심  3                                    │  │ │
│  │  │  ┌─ RecordTable ─────────────────────────────┐  │  │ │
│  │  │  │  ...                                      │  │  │ │
│  │  │  └───────────────────────────────────────────┘  │  │ │
│  │  │  + 신규 Item                                    │  │ │
│  │  └────────────────────────────────────────────────┘  │ │
│  │                                                      │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                           │
│  viewMode === "flat" (기존 그대로)                         │
│  ┌─ RecordTable ────────────────────────────────────────┐ │
│  │  기존 플랫 테이블 (변경 없음)                        │ │
│  └──────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────┘
```

## 2. 컴포넌트 설계

### 2.1 새로 만들 파일

#### `src/components/records/GroupedRecordView.tsx`

그룹 뷰의 최상위 컨테이너. 레코드를 상태 필드 기준으로 그룹핑하여 RecordGroup들을 렌더링.

```typescript
interface GroupedRecordViewProps {
    records: DbRecord[];
    fields: FieldDefinition[];
    visibleFieldKeys: string[] | null;
    isLoading: boolean;
    selectedIds: Set<number>;
    onSelectionChange: (ids: Set<number>) => void;
    onUpdateRecord: (id: number, data: Record<string, unknown>) => void;
    onRecordClick?: (record: DbRecord) => void;
    // 그룹핑 기준
    groupByField: FieldDefinition;  // cellType === "selectWithStatusBg" 인 필드
    // 정렬 (그룹 내)
    sortField: string;
    sortOrder: "asc" | "desc";
    onSortChange: (field: string, order: "asc" | "desc") => void;
    // 전체 건수 표시
    total: number;
    // 중복 표시
    duplicateHighlight?: { color: string; ids: Set<number> } | null;
    // 신규 레코드 추가
    onCreateWithStatus?: (statusValue: string) => void;
}
```

**핵심 로직** — `groupRecordsByStatus()`:
```typescript
// 1. groupByField.options 에서 상태 옵션 목록 추출 (순서 유지)
// 2. records를 순회하며 data[groupByField.key] 값으로 그룹 분류
// 3. options에 없는 값이나 빈 값 → "미분류" 그룹
// 4. 결과: { statusValue, statusLabel, records, count }[]
```

#### `src/components/records/RecordGroup.tsx`

개별 그룹 (헤더 + 테이블 + 추가 버튼).

```typescript
interface RecordGroupProps {
    statusValue: string;      // 상태 값 (예: "연락 중")
    statusLabel: string;      // 표시 라벨
    statusColor?: string;     // 배지 배경색 (bgColor)
    count: number;            // 해당 그룹 레코드 수
    records: DbRecord[];
    fields: FieldDefinition[];
    visibleFieldKeys: string[] | null;
    selectedIds: Set<number>;
    onSelectionChange: (ids: Set<number>) => void;
    onUpdateRecord: (id: number, data: Record<string, unknown>) => void;
    onRecordClick?: (record: DbRecord) => void;
    sortField: string;
    sortOrder: "asc" | "desc";
    onSortChange: (field: string, order: "asc" | "desc") => void;
    duplicateHighlight?: { color: string; ids: Set<number> } | null;
    onCreateWithStatus?: (statusValue: string) => void;
    defaultCollapsed?: boolean;
}
```

**UI 구성**:
```
┌────────────────────────────────────────────────────┐
│ ▼ ● 연락 중  41                                    │  ← 그룹 헤더 (클릭 시 접기/펼치기)
├────────────────────────────────────────────────────┤
│ □ │ 통합코드  │ 출처     │ 소재  │ 체험 요청 │ ... │  ← 컬럼 헤더 (첫 그룹만, 또는 모든 그룹)
│ □ │ SALES-001 │ 메타광고 │ 리뷰  │ 체험 요청 │ ... │
│ □ │ SALES-002 │ 메타광고 │ 리뷰  │ 체험 요청 │ ... │
├────────────────────────────────────────────────────┤
│ + 신규 Item                                        │  ← 해당 상태로 레코드 추가
└────────────────────────────────────────────────────┘
```

### 2.2 수정할 파일

#### `src/app/records/page.tsx` — 변경사항

1. **viewMode 상태 추가**:
```typescript
const [viewMode, setViewMode] = useState<"flat" | "grouped">(() => {
    if (typeof window === "undefined") return "flat";
    return (localStorage.getItem("records_view_mode") as "flat" | "grouped") || "flat";
});
```

2. **상태 필드 탐색**:
```typescript
// cellType이 "selectWithStatusBg"인 필드 찾기
const statusField = useMemo(() =>
    fields.find(f => f.cellType === "selectWithStatusBg"),
    [fields]
);
```

3. **조건부 렌더링**:
```typescript
{viewMode === "grouped" && statusField ? (
    <GroupedRecordView
        records={records}
        fields={fields}
        groupByField={statusField}
        // ... 기존 RecordTable과 동일한 props
        onCreateWithStatus={(statusValue) => {
            // CreateRecordDialog 열면서 상태 기본값 설정
        }}
    />
) : (
    <RecordTable ... />  // 기존 그대로
)}
```

#### `src/components/records/RecordToolbar.tsx` — 변경사항

1. **뷰 모드 토글 버튼 추가**:
```typescript
// 새 props
interface RecordToolbarProps {
    // ... 기존 props
    viewMode: "flat" | "grouped";
    onViewModeChange: (mode: "flat" | "grouped") => void;
    hasStatusField: boolean;  // 상태 필드 존재 여부 (없으면 버튼 숨김)
}
```

2. **UI**: 필터 영역 옆에 아이콘 버튼 추가
```
[≡ 리스트] [▤ 그룹]   ← ToggleGroup 사용
```
- `List` 아이콘 (lucide): 플랫 뷰
- `LayoutList` 아이콘 (lucide): 그룹 뷰
- 상태 필드가 없으면 버튼 표시 안 함

#### `src/components/records/RecordTable.tsx` — 변경사항

1. **그룹 내 사용 시 페이지네이션/빈 상태 숨김 옵션 추가**:
```typescript
interface RecordTableProps {
    // ... 기존 props
    compact?: boolean;  // true면 페이지네이션, 빈 상태 UI 숨김
    hideHeader?: boolean; // true면 테이블 헤더 숨김 (그룹에서 첫 번째만 보여줄 때)
}
```

## 3. 데이터 흐름

### 3.1 그룹핑 로직 (클라이언트사이드)

```
API 응답 (플랫 리스트)
    │
    ▼
records: DbRecord[]
    │
    ▼ groupByField.options (예: ["신규", "연락 중", "핵심", "테스트", "종료"])
    │
    ▼ groupRecordsByStatus(records, groupByField)
    │
    ├─ { status: "연락 중", records: [...41건], count: 41 }
    ├─ { status: "핵심",    records: [...3건],  count: 3  }
    ├─ { status: "테스트",  records: [...1건],  count: 1  }
    ├─ { status: "종료",    records: [...18건], count: 18 }
    └─ { status: "미분류",  records: [...0건],  count: 0  }  ← 값이 없는 레코드
```

### 3.2 상태 옵션 정보 소스

현재 `fieldDefinitions.options` (JSONB `string[]`)에 select 옵션이 저장됨.
- 이 값으로 그룹 순서 결정 (배열 순서 = 표시 순서)
- 색상: `statusOptionCategories` / `statusOptions` 테이블에 `bgColor` 존재하지만, 현재 CellRenderer에서 사용하지 않음 → **1차에서는 기본 Badge 색상 사용**, 추후 색상 연동 가능

### 3.3 페이지네이션 처리

**그룹 뷰에서의 전략**:
- 기존 API 페이지네이션 유지 (변경 없음)
- 현재 페이지에 가져온 레코드만 그룹핑 → 그룹별 건수는 "현재 페이지 내" 건수
- 하단에 전체 페이지네이션 표시 (GroupedRecordView 하단)
- 향후 개선: 서버사이드 그룹핑으로 그룹별 전체 건수 표시

## 4. 상태 관리

### 4.1 접기/펼치기 상태

```typescript
// RecordGroup 내부 상태
const [collapsed, setCollapsed] = useState(defaultCollapsed ?? false);
```
- 각 그룹은 독립적으로 접기/펼치기
- 접힌 상태에서는 헤더만 표시: `▶ ● 종료  18`
- 기본값: 모두 펼침

### 4.2 뷰 모드 저장

```typescript
// localStorage key: "records_view_mode"
// 값: "flat" | "grouped"
// 저장 시점: 뷰 모드 토글 시
```

### 4.3 선택(체크박스) 관리

- 기존 `selectedIds: Set<number>` 그대로 유지
- 그룹 뷰에서도 동일한 Set 공유
- 각 그룹의 전체 선택은 해당 그룹 레코드만 토글

## 5. 구현 순서

| 순서 | 작업 | 파일 | 설명 |
|------|------|------|------|
| 1 | RecordTable compact 모드 | `RecordTable.tsx` | `compact` prop 추가, 페이지네이션 조건부 숨김 |
| 2 | RecordGroup 컴포넌트 | `RecordGroup.tsx` (신규) | 그룹 헤더 + 접기/펼치기 + RecordTable + 추가 버튼 |
| 3 | GroupedRecordView 컴포넌트 | `GroupedRecordView.tsx` (신규) | 그룹핑 로직 + RecordGroup 목록 + 페이지네이션 |
| 4 | RecordToolbar 토글 | `RecordToolbar.tsx` | viewMode 토글 버튼 추가 |
| 5 | page.tsx 통합 | `page.tsx` | viewMode 상태, 조건부 렌더링, statusField 탐색 |

## 6. UI/UX 상세

### 6.1 그룹 헤더 디자인

```
▼ ● 연락 중  41
```
- `▼` / `▶`: 접기/펼치기 화살표 (ChevronDown / ChevronRight)
- `●`: 상태 색상 도트 (배지 색상 또는 기본 색상)
- `연락 중`: 상태 라벨 (font-medium)
- `41`: 건수 (text-muted-foreground, text-sm)

### 6.2 그룹 간 간격

- 그룹 사이: `mb-4` (16px)
- 그룹 헤더: `px-4 py-2 bg-muted/30 rounded-t border`
- 그룹 바디: `border-x border-b rounded-b`

### 6.3 "+ 신규 Item" 버튼

- 각 그룹 하단, 테이블 아래
- 클릭 시: CreateRecordDialog 열기 + 해당 상태값 기본 세팅
- 스타일: `text-muted-foreground hover:text-foreground text-sm px-4 py-2`

### 6.4 뷰 토글 버튼

- 위치: RecordToolbar의 필터 영역 오른쪽
- lucide 아이콘: `List` (플랫), `LayoutList` (그룹)
- 활성 상태: `bg-accent` 배경
- 상태 필드가 없으면 숨김

## 7. 엣지 케이스

| 케이스 | 처리 |
|--------|------|
| 상태 필드가 없는 파티션 | 그룹 뷰 버튼 숨김, 항상 플랫 뷰 |
| 레코드에 상태값이 없음 | "미분류" 그룹에 포함 (맨 아래) |
| 상태 옵션이 0개인 그룹 | 그룹 자체를 숨김 (레코드 0건인 그룹 미표시) |
| 검색/필터 중 그룹 뷰 | 필터된 결과를 그룹핑 (정상 동작) |
| 인라인 편집으로 상태 변경 | 기존 mutate로 리프레시 → 자동으로 그룹 재배치 |

## 8. 변경하지 않는 것

- API 엔드포인트 (변경 없음)
- DB 스키마 (변경 없음)
- useRecords 훅 (변경 없음)
- 기존 플랫 뷰 동작 (변경 없음)
- 인라인 편집 로직 (변경 없음)
