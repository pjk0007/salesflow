# Design: 워크스페이스 관리 (CRUD)

> **Summary**: 설정 > 워크스페이스 탭에서 워크스페이스 목록 조회, 생성, 수정, 삭제 기능
>
> **Project**: Sales Manager
> **Date**: 2026-02-12
> **Status**: Draft
> **Planning Doc**: [workspace-management.plan.md](../../01-plan/features/workspace-management.plan.md)

---

## 1. 설계 목표

- 기존 `WorkspaceSettingsTab`을 카드 기반 목록 + 상세 편집 구조로 확장
- 워크스페이스 생성(POST)과 삭제(DELETE) API 추가
- `useWorkspaces` 훅을 CRUD 지원으로 확장 (create, delete + mutate)
- 삭제 시 하위 데이터 건수를 표시하여 실수 방지
- 최소 1개 워크스페이스 유지 규칙 적용
- DB 마이그레이션 없이 기존 schema 활용

---

## 2. 아키텍처

### 2.1 컴포넌트 다이어그램

```
┌────────────────────────────────────────────────────────┐
│  /settings?tab=workspace (WorkspaceSettingsTab 개선)     │
│                                                        │
│  ┌── WorkspaceSettingsTab (수정) ────────────────────┐ │
│  │                                                    │ │
│  │  ┌─ 워크스페이스 카드 목록 ────────────────────┐  │ │
│  │  │ [Card1] [Card2] ... [+ 추가 카드]           │  │ │
│  │  └────────────────────────────────────────────┘  │ │
│  │                                                    │ │
│  │  ┌─ 선택된 워크스페이스 상세 편집 ──────────────┐  │ │
│  │  │ 이름, 설명, 아이콘 폼 + [저장] [삭제]       │  │ │
│  │  └────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────┘ │
│                                                        │
│  ┌── CreateWorkspaceDialog ──┐  ┌─ DeleteWorkspaceDialog ┐│
│  │ 이름, 설명, 아이콘 입력   │  │ 확인 + 하위 데이터 경고 ││
│  │ [취소] [생성]             │  │ [취소] [삭제]           ││
│  └───────────────────────────┘  └─────────────────────────┘│
└────────────────────────────────────────────────────────┘
```

### 2.2 데이터 흐름

```
[WorkspaceSettingsTab]
   │
   ├── useWorkspaces() (확장)
   │       ├── GET  /api/workspaces ─────────→ DB (workspaces) → 목록
   │       ├── createWorkspace()
   │       │       └── POST /api/workspaces ─→ DB INSERT → mutate
   │       └── deleteWorkspace()
   │               └── DELETE /api/workspaces/[id] ─→ DB DELETE → mutate
   │
   ├── useWorkspaceSettings(selectedId)
   │       ├── GET   /api/workspaces/[id]/settings ──→ 상세 조회
   │       └── PATCH /api/workspaces/[id]/settings ──→ 수정 + mutate
   │
   └── DELETE /api/workspaces/[id] ──→ 삭제 전 하위 건수 조회 포함
```

---

## 3. 데이터 모델

### 3.1 기존 스키마 활용 (변경 없음)

```typescript
// workspaces 테이블 (schema.ts)
workspaces: {
    id: serial PK,
    orgId: integer FK → organizations.id (CASCADE),
    name: varchar(200) NOT NULL,
    description: text,
    icon: varchar(50),
    settings: jsonb,
    createdAt: timestamptz,
    updatedAt: timestamptz,
}

// CASCADE 관계 (삭제 시 자동 제거)
workspaces.id ← fieldDefinitions.workspaceId (CASCADE)
workspaces.id ← folders.workspaceId (CASCADE)
workspaces.id ← partitions.workspaceId (CASCADE)
workspaces.id ← workspacePermissions.workspaceId (CASCADE)
workspaces.id ← statusOptionCategories.workspaceId (CASCADE)
```

### 3.2 클라이언트 타입 (추가)

```typescript
// src/types/index.ts 에 추가

export interface CreateWorkspaceInput {
    name: string;
    description?: string;
    icon?: string;
}
```

> 기존 타입 `UpdateWorkspaceInput`, `WorkspaceDetail` 등은 settings-page에서 이미 추가되어 있으므로 변경 없음.

---

## 4. API 명세

### 4.1 엔드포인트 목록

| Method | Path | 설명 | 인증 | 권한 | 상태 |
|--------|------|------|------|------|------|
| GET | `/api/workspaces` | 목록 조회 | JWT | 모든 역할 | 기존 |
| GET | `/api/workspaces/[id]/settings` | 상세 조회 | JWT | owner/admin | 기존 |
| PATCH | `/api/workspaces/[id]/settings` | 수정 | JWT | owner/admin | 기존 |
| POST | `/api/workspaces` | **생성** | JWT | owner/admin | **신규** |
| DELETE | `/api/workspaces/[id]` | **삭제** | JWT | owner/admin | **신규** |

### 4.2 POST `/api/workspaces` (신규)

**파일**: `src/pages/api/workspaces/index.ts` (기존 파일에 POST 핸들러 추가)

**Request Body:**
```json
{
    "name": "새 워크스페이스",
    "description": "설명 (선택)",
    "icon": "briefcase (선택)"
}
```

**Response (201 Created):**
```json
{
    "success": true,
    "data": {
        "id": 3,
        "name": "새 워크스페이스",
        "description": "설명",
        "icon": "briefcase"
    }
}
```

**Error Responses:**
- `401`: 미인증
- `403`: member 역할 (owner/admin만 생성 가능)
- `400`: name이 빈 문자열 또는 누락

**구현 세부:**
- `getUserFromRequest(req)` JWT 검증
- `user.role === "member"` → 403
- `name` 필수, trim 후 빈 문자열이면 400
- `description`, `icon`은 선택 (없으면 null)
- `db.insert(workspaces).values({ orgId: user.orgId, name, description, icon }).returning()`
- 응답에서 id, name, description, icon 반환

### 4.3 DELETE `/api/workspaces/[id]` (신규)

**파일**: `src/pages/api/workspaces/[id]/index.ts` (신규 파일)

**Response (200 OK):**
```json
{
    "success": true
}
```

**Error Responses:**
- `401`: 미인증
- `403`: member 역할
- `400`: 잘못된 ID / 마지막 워크스페이스 삭제 시도
- `404`: 워크스페이스 없음 (다른 조직)

**구현 세부:**
- `getUserFromRequest(req)` JWT 검증
- `user.role === "member"` → 403
- `workspaceId = Number(req.query.id)` — NaN이면 400
- 같은 조직(`orgId`) 확인 — 다르면 404
- 해당 조직의 워크스페이스 수 조회 — 1개이면 400 "마지막 워크스페이스는 삭제할 수 없습니다."
- `db.delete(workspaces).where(eq(workspaces.id, workspaceId))` — CASCADE로 하위 데이터 자동 삭제
- 삭제 전 하위 데이터 건수 조회는 프론트엔드에서 별도 호출하지 않음 → **DELETE API 응답에 포함하거나, GET API에 건수를 포함하는 방식 대신, 삭제 확인 다이얼로그를 여는 시점에 건수를 fetch**

### 4.4 GET `/api/workspaces/[id]/stats` (신규 - 삭제 확인용)

**파일**: `src/pages/api/workspaces/[id]/index.ts` (같은 파일에 GET 핸들러)

**Response (200):**
```json
{
    "success": true,
    "data": {
        "partitionCount": 3,
        "recordCount": 152
    }
}
```

**구현 세부:**
- GET 요청 시 해당 워크스페이스의 하위 데이터 건수 반환
- `SELECT COUNT(*) FROM partitions WHERE workspace_id = ?`
- `SELECT COUNT(*) FROM records WHERE workspace_id = ?`
- 삭제 확인 다이얼로그에서 경고 메시지로 사용

---

## 5. SWR Hook 설계

### 5.1 useWorkspaces (확장)

```typescript
// src/hooks/useWorkspaces.ts (수정)

interface WorkspaceItem {
    id: number;
    name: string;
    description: string | null;
    icon: string | null;
}

export function useWorkspaces() {
    const { data, error, isLoading, mutate } = useSWR<ApiResponse<WorkspaceItem[]>>(
        "/api/workspaces",
        fetcher
    );

    const createWorkspace = async (input: CreateWorkspaceInput) => {
        const res = await fetch("/api/workspaces", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const deleteWorkspace = async (id: number) => {
        const res = await fetch(`/api/workspaces/${id}`, {
            method: "DELETE",
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        workspaces: data?.data ?? [],
        isLoading,
        error,
        mutate,
        createWorkspace,
        deleteWorkspace,
    };
}
```

---

## 6. UI 컴포넌트 설계

### 6.1 WorkspaceSettingsTab (수정)

**파일**: `src/components/settings/WorkspaceSettingsTab.tsx` (수정)

**변경사항:**
- 기존 Select 드롭다운 방식 → 카드 그리드 목록으로 변경
- "추가" 카드 클릭 시 `CreateWorkspaceDialog` 열기
- 카드 선택 시 하단에 편집 폼 표시
- 삭제 버튼 추가 (편집 폼 하단)

**레이아웃:**
```
<div className="space-y-6">
    {/* 카드 그리드 */}
    <div>
        <div className="flex items-center justify-between mb-3">
            <Label>워크스페이스 목록</Label>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {workspaces.map(ws => (
                <Card
                    key={ws.id}
                    className={cn("cursor-pointer hover:border-primary/50 transition-colors",
                        selectedId === ws.id && "border-primary ring-1 ring-primary")}
                    onClick={() => setSelectedId(ws.id)}
                >
                    <CardContent className="p-4">
                        <div className="font-medium truncate">{ws.name}</div>
                        <div className="text-sm text-muted-foreground truncate">{ws.description || "설명 없음"}</div>
                    </CardContent>
                </Card>
            ))}
            {/* 추가 카드 */}
            <Card
                className="cursor-pointer hover:border-primary/50 transition-colors border-dashed"
                onClick={() => setCreateOpen(true)}
            >
                <CardContent className="p-4 flex items-center justify-center text-muted-foreground">
                    <Plus className="h-4 w-4 mr-1" /> 추가
                </CardContent>
            </Card>
        </div>
    </div>

    {/* 선택된 워크스페이스 편집 폼 */}
    {selectedId && (
        <>
            <Separator />
            <div className="space-y-4 max-w-lg">
                {/* name, description, icon 폼 - 기존과 동일 */}
                <div className="flex gap-2">
                    <Button onClick={handleSave} disabled={isSubmitting}>
                        {isSubmitting ? "저장 중..." : "저장"}
                    </Button>
                    {workspaces.length > 1 && (
                        <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                            삭제
                        </Button>
                    )}
                </div>
            </div>
        </>
    )}

    <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} onSubmit={createWorkspace} />
    <DeleteWorkspaceDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        workspace={selectedWorkspace}
        onConfirm={handleDelete}
    />
</div>
```

**상태 관리:**
- `selectedId: number | null` — 선택된 워크스페이스 ID
- `createOpen: boolean` — 생성 다이얼로그 열림
- `deleteOpen: boolean` — 삭제 다이얼로그 열림
- `name, description, icon` — 편집 폼 값 (기존 유지)
- `isSubmitting` — 저장 중 상태

**동작 흐름:**
1. 워크스페이스 목록 카드 렌더링 (useWorkspaces)
2. 첫 번째 워크스페이스 자동 선택
3. 카드 클릭 → selectedId 변경 → useWorkspaceSettings로 상세 로드 → 폼 초기화
4. "추가" 카드 → CreateWorkspaceDialog → createWorkspace → mutate → 새 워크스페이스 자동 선택
5. "삭제" → DeleteWorkspaceDialog → deleteWorkspace → mutate → 첫 번째 워크스페이스 선택
6. "저장" → 기존 PATCH 로직 유지

### 6.2 CreateWorkspaceDialog (신규)

**파일**: `src/components/settings/CreateWorkspaceDialog.tsx`

**Props:**
```typescript
interface CreateWorkspaceDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (input: CreateWorkspaceInput) => Promise<{ success: boolean; error?: string; data?: { id: number } }>;
}
```

**폼 필드:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|:----:|------|
| name | Input text | O | 워크스페이스 이름 |
| description | Textarea | - | 설명 |
| icon | Input text | - | 아이콘 이름 |

**동작:**
1. Dialog 열기 시 폼 초기화
2. name 필수 검증
3. onSubmit 호출 → toast.success/error
4. 성공 시 Dialog 닫기 + 폼 초기화

**구조:**
```
Dialog
└── DialogContent (max-w-md)
    ├── DialogHeader → "워크스페이스 추가"
    ├── 폼 (name, description, icon)
    └── DialogFooter → [취소] [생성]
```

### 6.3 DeleteWorkspaceDialog (신규)

**파일**: `src/components/settings/DeleteWorkspaceDialog.tsx`

**Props:**
```typescript
interface DeleteWorkspaceDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    workspace: { id: number; name: string } | null;
    onConfirm: () => Promise<void>;
}
```

**동작:**
1. Dialog 열릴 때 GET `/api/workspaces/[id]`로 하위 데이터 건수 fetch
2. 건수가 있으면 경고 메시지 표시
3. "삭제" 클릭 → onConfirm 호출

**구조:**
```
AlertDialog
└── AlertDialogContent
    ├── AlertDialogHeader
    │   ├── AlertDialogTitle → "워크스페이스 삭제"
    │   └── AlertDialogDescription → 경고 메시지 + 하위 건수
    └── AlertDialogFooter → [취소] [삭제 (destructive)]
```

**하위 데이터 경고:**
```
"{워크스페이스명}" 워크스페이스를 삭제합니다.
하위 파티션, 레코드 등 모든 데이터가 영구적으로 삭제됩니다.

⚠ 파티션 {n}개, 레코드 {n}개가 삭제됩니다.  (건수가 있을 때만)
```

---

## 7. 에러 처리

| 상황 | API | 코드 | 메시지 | UI 처리 |
|------|-----|------|--------|---------|
| 미인증 | 공통 | 401 | "인증이 필요합니다." | 로그인 리다이렉트 |
| member 역할 | 공통 | 403 | "접근 권한이 없습니다." | toast.error |
| name 누락 | POST | 400 | "이름을 입력해주세요." | 폼 검증 에러 |
| 마지막 WS 삭제 | DELETE | 400 | "마지막 워크스페이스는 삭제할 수 없습니다." | toast.error |
| WS 없음 | DELETE | 404 | "워크스페이스를 찾을 수 없습니다." | toast.error |
| 서버 오류 | 공통 | 500 | "서버 오류가 발생했습니다." | toast.error |

---

## 8. 보안

- [x] JWT 인증 필수 (`getUserFromRequest()`)
- [x] 역할 기반 접근 제어 (owner/admin만 CRUD)
- [x] 같은 조직의 워크스페이스만 조작 가능 (orgId 필터)
- [x] 최소 1개 워크스페이스 유지 규칙 (DELETE 시 체크)
- [x] 삭제 전 이중 확인 (AlertDialog)

---

## 9. 파일 구조

### 9.1 신규 생성 파일

```
src/
├── pages/api/
│   └── workspaces/
│       └── [id]/
│           └── index.ts                          # GET (stats) + DELETE
└── components/
    └── settings/
        ├── CreateWorkspaceDialog.tsx              # 생성 다이얼로그 (신규)
        └── DeleteWorkspaceDialog.tsx              # 삭제 확인 다이얼로그 (신규)
```

### 9.2 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/types/index.ts` | `CreateWorkspaceInput` 타입 추가 |
| `src/pages/api/workspaces/index.ts` | POST 핸들러 추가 (기존 GET 유지) |
| `src/hooks/useWorkspaces.ts` | `createWorkspace`, `deleteWorkspace`, `mutate` 추가 |
| `src/components/settings/WorkspaceSettingsTab.tsx` | 카드 목록 UI + 생성/삭제 통합 |

### 9.3 변경 없는 파일

| 파일 | 이유 |
|------|------|
| `src/lib/db/schema.ts` | 기존 테이블 그대로 (CASCADE 설정 이미 있음) |
| `src/pages/api/workspaces/[id]/settings.ts` | 기존 GET + PATCH 그대로 유지 |
| `src/hooks/useWorkspaceSettings.ts` | 기존 상세 조회/수정 Hook 그대로 |
| `src/pages/settings.tsx` | 탭 구조 변경 없음 |
| `src/components/layouts/WorkspaceLayout.tsx` | 사이드바 변경 없음 |

---

## 10. 구현 순서

1. [ ] **타입 추가** — `src/types/index.ts`에 `CreateWorkspaceInput` 추가
2. [ ] **API: POST 워크스페이스 생성** — `src/pages/api/workspaces/index.ts`에 POST 핸들러 추가
3. [ ] **API: GET stats + DELETE 워크스페이스** — `src/pages/api/workspaces/[id]/index.ts` 신규 생성
4. [ ] **Hook: useWorkspaces 확장** — `src/hooks/useWorkspaces.ts`에 create, delete, mutate 추가
5. [ ] **CreateWorkspaceDialog** — `src/components/settings/CreateWorkspaceDialog.tsx` 신규 생성
6. [ ] **DeleteWorkspaceDialog** — `src/components/settings/DeleteWorkspaceDialog.tsx` 신규 생성
7. [ ] **WorkspaceSettingsTab 수정** — 카드 목록 + 생성/삭제 통합
8. [ ] **빌드 검증** — `pnpm build`

---

## 버전 이력

| 버전 | 날짜 | 변경사항 | 작성자 |
|------|------|----------|--------|
| 0.1 | 2026-02-12 | 초안 작성 | AI |
