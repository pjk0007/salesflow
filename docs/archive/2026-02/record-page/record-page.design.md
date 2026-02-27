# record-page Design Document

> **Summary**: 레코드 페이지 개선 — "0" 버그 수정 + 파티션/폴더 CRUD
>
> **Plan Reference**: `docs/01-plan/features/record-page.plan.md`
> **Date**: 2026-02-12
> **Status**: Draft

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│ index.tsx (레코드 페이지)                                │
│  ├─ PartitionNav (수정)                                  │
│  │   ├─ 워크스페이스 Select                              │
│  │   ├─ [+ 폴더] [+ 파티션] 버튼                        │
│  │   ├─ 폴더 Collapsible (DropdownMenu [⋯])            │
│  │   │   └─ 파티션 Button (DropdownMenu [⋯])           │
│  │   └─ 미분류 파티션 Button (DropdownMenu [⋯])        │
│  ├─ RecordToolbar                                        │
│  └─ RecordTable                                          │
│                                                          │
│ Dialogs:                                                 │
│  ├─ CreatePartitionDialog (신규)                         │
│  ├─ CreateFolderDialog (신규)                            │
│  ├─ RenameDialog (신규, 공용)                            │
│  └─ DeletePartitionDialog (신규)                         │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Bug Fix: "0" 렌더링 (FR-01)

### 2.1 원인

`field_definitions.is_required`가 PostgreSQL integer(0/1)로 저장되고 API가 변환 없이 반환.
React에서 `{0 && <JSX>}` → 숫자 `0`이 텍스트로 렌더링됨.

### 2.2 수정 대상

| File | Line | Before | After |
|------|------|--------|-------|
| `CreateRecordDialog.tsx` | 197 | `{field.isRequired && (` | `{!!field.isRequired && (` |

동일 패턴이 다른 파일에도 존재할 수 있으므로 전체 프로젝트에서 `isRequired &&`, `isSystem &&` 패턴 검색 후 일괄 수정.

---

## 3. Data Model

### 3.1 기존 테이블 (변경 없음)

**partitions**
```
id, workspaceId, name, folderId, displayOrder,
visibleFields, useDistributionOrder, maxDistributionOrder,
lastAssignedOrder, distributionDefaults, duplicateCheckField,
statusOptionIds, createdAt, updatedAt
```

**folders**
```
id, workspaceId, name, displayOrder, createdAt, updatedAt
```

### 3.2 Client Types (신규)

```typescript
// src/types/index.ts에 추가
export interface CreatePartitionInput {
    name: string;
    folderId?: number | null;
}

export interface CreateFolderInput {
    name: string;
}
```

---

## 4. API Design

### 4.1 POST /api/workspaces/[id]/partitions — 파티션 생성

기존 GET 핸들러에 POST 추가.

**Request:**
```json
{ "name": "신규 고객", "folderId": 1 }
```

**Response (201):**
```json
{ "success": true, "data": { "id": 5, "name": "신규 고객", "folderId": 1 } }
```

**Logic:**
1. JWT 인증 + role !== "member"
2. 워크스페이스 소유권 검증
3. name 필수 검증
4. folderId가 있으면 해당 폴더가 같은 워크스페이스에 속하는지 검증
5. visibleFields 기본값: 워크스페이스의 전체 필드 key 목록 (FR-08)
6. INSERT → returning

### 4.2 PATCH /api/partitions/[id] — 파티션 수정

**파일**: `src/pages/api/partitions/[id]/index.ts` (신규)

**Request:**
```json
{ "name": "기존 고객 (수정)" }
```

**Response (200):**
```json
{ "success": true, "data": { "id": 5, "name": "기존 고객 (수정)" } }
```

**Logic:**
1. JWT 인증 + role !== "member"
2. 파티션 → 워크스페이스 → 조직 소유권 검증 (JOIN)
3. name 필수 검증
4. UPDATE name, updatedAt → returning

### 4.3 DELETE /api/partitions/[id] — 파티션 삭제

같은 파일 (`/api/partitions/[id]/index.ts`)에 DELETE 핸들러 추가.

**Response (200):**
```json
{ "success": true }
```

**Logic:**
1. JWT 인증 + role !== "member"
2. 파티션 → 워크스페이스 → 조직 소유권 검증
3. CASCADE 삭제 (records, alimtalkTemplateLinks 등 FK 관계)
4. DELETE

**Note:** 최소 1개 보호 없음 (Plan 5.2에 따라 0개 가능). 삭제 확인은 UI에서 레코드 수 경고로 처리.

### 4.4 GET /api/partitions/[id]/stats — 파티션 통계

기존 `[id]/records.ts`와 별도로, 삭제 확인 다이얼로그용 통계 엔드포인트.

**파일**: `src/pages/api/partitions/[id]/index.ts` — GET 핸들러

**Response:**
```json
{ "success": true, "data": { "recordCount": 42 } }
```

**Logic:**
1. JWT 인증 + role !== "member"
2. 파티션 소유권 검증
3. `SELECT count(*) FROM records WHERE partition_id = ?`

### 4.5 POST /api/workspaces/[id]/folders — 폴더 생성

**파일**: `src/pages/api/workspaces/[id]/folders.ts` (신규)

**Request:**
```json
{ "name": "영업팀" }
```

**Response (201):**
```json
{ "success": true, "data": { "id": 3, "name": "영업팀" } }
```

**Logic:**
1. JWT 인증 + role !== "member"
2. 워크스페이스 소유권 검증
3. name 필수 검증
4. INSERT → returning

### 4.6 DELETE /api/folders/[id] — 폴더 삭제

**파일**: `src/pages/api/folders/[id].ts` (신규)

**Response (200):**
```json
{ "success": true }
```

**Logic:**
1. JWT 인증 + role !== "member"
2. 폴더 → 워크스페이스 → 조직 소유권 검증
3. 하위 파티션의 folderId를 null로 업데이트 (미분류로 이동)
4. DELETE folder

### 4.7 PATCH /api/folders/[id] — 폴더 이름 수정

같은 파일 (`/api/folders/[id].ts`)에 PATCH 핸들러 추가.

**Request:**
```json
{ "name": "지원팀 (수정)" }
```

**Logic:**
1. JWT 인증 + role !== "member"
2. 폴더 소유권 검증
3. UPDATE name, updatedAt → returning

---

## 5. Hook Design

### 5.1 usePartitions 확장

```typescript
// src/hooks/usePartitions.ts (수정)
export function usePartitions(workspaceId: number | null) {
    const { data, error, isLoading, mutate } = useSWR<ApiResponse<PartitionTree>>(
        workspaceId ? `/api/workspaces/${workspaceId}/partitions` : null,
        fetcher
    );

    const createPartition = async (input: CreatePartitionInput) => {
        const res = await fetch(`/api/workspaces/${workspaceId}/partitions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const renamePartition = async (id: number, name: string) => {
        const res = await fetch(`/api/partitions/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const deletePartition = async (id: number) => {
        const res = await fetch(`/api/partitions/${id}`, { method: "DELETE" });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const createFolder = async (input: CreateFolderInput) => {
        const res = await fetch(`/api/workspaces/${workspaceId}/folders`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const renameFolder = async (id: number, name: string) => {
        const res = await fetch(`/api/folders/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const deleteFolder = async (id: number) => {
        const res = await fetch(`/api/folders/${id}`, { method: "DELETE" });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        partitionTree: data?.data ?? null,
        isLoading,
        error,
        mutate,
        createPartition,
        renamePartition,
        deletePartition,
        createFolder,
        renameFolder,
        deleteFolder,
    };
}
```

---

## 6. UI Component Design

### 6.1 PartitionNav 수정

**변경 내용:**
- props에 CRUD 콜백 추가
- 헤더에 [+ 폴더] [+ 파티션] 버튼 추가
- 각 폴더/파티션 항목에 `[⋯]` DropdownMenu 추가
- DropdownMenu 항목: "이름 변경", "삭제"

**추가 Props:**
```typescript
interface PartitionNavProps {
    // 기존
    workspaceId: number | null;
    selectedPartitionId: number | null;
    onWorkspaceChange: (workspaceId: number) => void;
    onPartitionSelect: (partitionId: number) => void;
    // 신규
    onCreatePartition: () => void;
    onCreateFolder: () => void;
    onRenamePartition: (id: number, currentName: string) => void;
    onRenameFolder: (id: number, currentName: string) => void;
    onDeletePartition: (id: number, name: string) => void;
    onDeleteFolder: (id: number, name: string) => void;
}
```

**DropdownMenu 레이아웃:**
```tsx
<DropdownMenu>
    <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
            <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onRenamePartition(id, name)}>
            <Pencil className="h-3.5 w-3.5 mr-2" /> 이름 변경
        </DropdownMenuItem>
        <DropdownMenuItem
            className="text-destructive"
            onClick={() => onDeletePartition(id, name)}
        >
            <Trash2 className="h-3.5 w-3.5 mr-2" /> 삭제
        </DropdownMenuItem>
    </DropdownMenuContent>
</DropdownMenu>
```

### 6.2 CreatePartitionDialog (신규)

**파일**: `src/components/records/CreatePartitionDialog.tsx`

**Pattern**: CreateWorkspaceDialog 패턴 준수

**Props:**
```typescript
interface CreatePartitionDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    folders: { id: number; name: string }[];
    onSubmit: (input: CreatePartitionInput) => Promise<{ success: boolean; error?: string }>;
}
```

**Form Fields:**
- 이름 (Input, 필수)
- 폴더 (Select, 선택 — "미분류" 옵션 포함)

### 6.3 CreateFolderDialog (신규)

**파일**: `src/components/records/CreateFolderDialog.tsx`

**Pattern**: CreateWorkspaceDialog 패턴 (name만 입력)

**Props:**
```typescript
interface CreateFolderDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (input: CreateFolderInput) => Promise<{ success: boolean; error?: string }>;
}
```

**Form Fields:**
- 이름 (Input, 필수)

### 6.4 RenameDialog (신규, 공용)

**파일**: `src/components/records/RenameDialog.tsx`

**Props:**
```typescript
interface RenameDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;           // "파티션 이름 변경" | "폴더 이름 변경"
    currentName: string;
    onSubmit: (name: string) => Promise<{ success: boolean; error?: string }>;
}
```

**Form**: 단일 Input (기존 이름이 기본값). size="sm".

### 6.5 DeletePartitionDialog (신규)

**파일**: `src/components/records/DeletePartitionDialog.tsx`

**Pattern**: DeleteWorkspaceDialog 패턴 (AlertDialog + 통계 fetch)

**Props:**
```typescript
interface DeletePartitionDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    partition: { id: number; name: string } | null;
    onConfirm: () => Promise<void>;
}
```

**Logic:**
- open 시 `GET /api/partitions/${id}` → recordCount 가져오기
- recordCount > 0이면 경고 메시지 표시
- AlertDialog with destructive action

---

## 7. index.tsx 수정

### 7.1 상태 추가

```typescript
// 다이얼로그 상태
const [createPartitionOpen, setCreatePartitionOpen] = useState(false);
const [createFolderOpen, setCreateFolderOpen] = useState(false);
const [renameTarget, setRenameTarget] = useState<{
    type: "partition" | "folder";
    id: number;
    name: string;
} | null>(null);
const [deletePartitionTarget, setDeletePartitionTarget] = useState<{
    id: number;
    name: string;
} | null>(null);
```

### 7.2 usePartitions에서 CRUD 함수 추출

```typescript
const {
    partitionTree,
    createPartition,
    renamePartition,
    deletePartition,
    createFolder,
    renameFolder,
    deleteFolder,
} = usePartitions(workspaceId);
```

### 7.3 핸들러

```typescript
const handleRenameSubmit = async (name: string) => {
    if (!renameTarget) return { success: false };
    if (renameTarget.type === "partition") {
        return renamePartition(renameTarget.id, name);
    } else {
        return renameFolder(renameTarget.id, name);
    }
};

const handleDeletePartition = async () => {
    if (!deletePartitionTarget) return;
    const result = await deletePartition(deletePartitionTarget.id);
    if (result.success) {
        toast.success("파티션이 삭제되었습니다.");
        if (partitionId === deletePartitionTarget.id) {
            setPartitionId(null);
        }
        setDeletePartitionTarget(null);
    } else {
        toast.error(result.error || "삭제에 실패했습니다.");
    }
};

const handleDeleteFolder = async (folderId: number) => {
    const result = await deleteFolder(folderId);
    if (result.success) {
        toast.success("폴더가 삭제되었습니다.");
    } else {
        toast.error(result.error || "삭제에 실패했습니다.");
    }
};
```

---

## 8. Implementation Order

| Step | Task | File(s) | FR |
|------|------|---------|-----|
| 1 | "0" 버그 수정 | `CreateRecordDialog.tsx` | FR-01 |
| 2 | Client 타입 추가 | `src/types/index.ts` | — |
| 3 | 파티션 API (POST/PATCH/DELETE/GET stats) | `workspaces/[id]/partitions.ts`, `partitions/[id]/index.ts` | FR-02, FR-03, FR-04 |
| 4 | 폴더 API (POST/PATCH/DELETE) | `workspaces/[id]/folders.ts`, `folders/[id].ts` | FR-05, FR-06 |
| 5 | usePartitions Hook 확장 | `hooks/usePartitions.ts` | — |
| 6 | CreatePartitionDialog | `components/records/CreatePartitionDialog.tsx` | FR-02 |
| 7 | CreateFolderDialog | `components/records/CreateFolderDialog.tsx` | FR-05 |
| 8 | RenameDialog | `components/records/RenameDialog.tsx` | FR-03 |
| 9 | DeletePartitionDialog | `components/records/DeletePartitionDialog.tsx` | FR-04 |
| 10 | PartitionNav 수정 (DropdownMenu + 생성 버튼) | `components/records/PartitionNav.tsx` | FR-07 |
| 11 | index.tsx 통합 (상태 + 핸들러 + 다이얼로그) | `pages/index.tsx` | — |
| 12 | Build 검증 | `pnpm build` | — |

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-02-12 | Initial draft | AI |
