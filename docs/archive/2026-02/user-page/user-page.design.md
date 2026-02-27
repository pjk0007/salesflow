# Design: 사용자 페이지 개발

> **Summary**: 조직 내 사용자 관리 (목록 조회, 생성, 수정, 역할 변경, 비활성화) 페이지 및 API
>
> **Project**: Sales Manager
> **Date**: 2026-02-12
> **Status**: Draft
> **Planning Doc**: [user-page.plan.md](../../01-plan/features/user-page.plan.md)

---

## 1. 설계 목표

- 기존 프로젝트 패턴(SWR Hook + ShadCN Dialog + WorkspaceLayout)과 일관된 구조
- owner/admin만 접근 가능한 권한 기반 페이지
- DB 마이그레이션 없이 기존 `users` 테이블 활용
- 안전한 사용자 관리 (본인 비활성화/역할 변경 방지, password 노출 방지)

---

## 2. 아키텍처

### 2.1 컴포넌트 다이어그램

```
┌─────────────────────────────────────────────────────────┐
│  /users (UsersPage)                                     │
│  ├── WorkspaceLayout (기존)                              │
│  │   └── 권한 체크: member → "/" 리다이렉트               │
│  ├── UserToolbar                                        │
│  │   ├── Search Input (debounce 300ms)                  │
│  │   └── "사용자 추가" Button → CreateUserDialog         │
│  ├── UserTable                                          │
│  │   ├── Table (ShadCN Table)                           │
│  │   ├── RoleBadge (역할별 색상)                         │
│  │   ├── StatusBadge (활성/비활성)                       │
│  │   ├── 역할 변경 DropdownMenu                         │
│  │   ├── 활성화/비활성화 Switch                          │
│  │   ├── 수정 Button → EditUserDialog                   │
│  │   └── Pagination                                     │
│  ├── CreateUserDialog                                   │
│  └── EditUserDialog                                     │
└─────────────────────────────────────────────────────────┘
```

### 2.2 데이터 흐름

```
[UsersPage]
   │
   ├── useUsers(page, search) ──→ GET /api/users ──→ DB (users table)
   │       │
   │       ├── createUser()  ──→ POST /api/users ──→ DB insert + mutate
   │       └── updateUser()  ──→ PATCH /api/users/[id] ──→ DB update + mutate
   │
   └── useSession() ──→ 현재 사용자 정보 (역할 확인, 본인 여부 판단)
```

---

## 3. 데이터 모델

### 3.1 기존 스키마 활용 (변경 없음)

```typescript
// src/lib/db/schema.ts - users 테이블 (이미 존재)
export const users = pgTable("users", {
    id: serial("id").primaryKey(),
    orgId: integer("org_id").references(() => organizations.id).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    password: varchar("password", { length: 255 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    role: varchar("role", { length: 20 }).default("member").notNull(),
    phone: varchar("phone", { length: 20 }),
    isActive: integer("is_active").default(1).notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
}, (table) => ({
    orgEmailUnique: unique().on(table.orgId, table.email),
}));
```

### 3.2 클라이언트 타입 (추가)

```typescript
// src/types/index.ts 에 추가
export interface UserListItem {
    id: number;
    orgId: number;
    email: string;
    name: string;
    role: OrgRole;
    phone: string | null;
    isActive: number;  // 0 | 1
    createdAt: string;
    updatedAt: string;
}
// password 필드는 포함하지 않음
```

---

## 4. API 명세

### 4.1 엔드포인트 목록

| Method | Path | 설명 | 인증 | 권한 |
|--------|------|------|------|------|
| GET | `/api/users` | 사용자 목록 조회 | JWT | owner/admin |
| POST | `/api/users` | 사용자 생성 | JWT | owner/admin |
| PATCH | `/api/users/[id]` | 사용자 수정 | JWT | owner/admin |

### 4.2 GET `/api/users`

**Query Parameters:**

| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| page | number | 1 | 페이지 번호 |
| pageSize | number | 20 | 페이지 크기 |
| search | string | - | 이름/이메일 검색 |

**Response (200):**
```json
{
    "success": true,
    "data": [
        {
            "id": 1,
            "orgId": 1,
            "email": "user@example.com",
            "name": "홍길동",
            "role": "member",
            "phone": "010-1234-5678",
            "isActive": 1,
            "createdAt": "2026-02-12T00:00:00Z",
            "updatedAt": "2026-02-12T00:00:00Z"
        }
    ],
    "total": 25,
    "page": 1,
    "pageSize": 20,
    "totalPages": 2
}
```

**구현 세부:**
- `getUserFromRequest(req)`로 JWT 검증
- `user.role`이 `owner` 또는 `admin`이 아니면 403
- `user.orgId`와 같은 조직의 사용자만 조회
- search: `users.name ILIKE %search%` OR `users.email ILIKE %search%`
- password 필드 제외 (select에서 명시적으로 제외)
- 정렬: `created_at DESC`

### 4.3 POST `/api/users`

**Request Body:**
```json
{
    "name": "string (필수)",
    "email": "string (필수)",
    "password": "string (필수, 6자 이상)",
    "role": "owner | admin | member (선택, 기본: member)",
    "phone": "string (선택)"
}
```

**Response (201):**
```json
{
    "success": true,
    "data": {
        "id": 2,
        "email": "new@example.com",
        "name": "새 사용자",
        "role": "member"
    }
}
```

**Error Responses:**
- `400`: 필수 필드 누락, 비밀번호 6자 미만
- `403`: 권한 없음 (member)
- `409`: 이메일 중복

**구현 세부:**
- admin은 member만 생성 가능 (owner/admin 역할 부여 불가)
- owner는 모든 역할 생성 가능
- `hashPassword()`로 비밀번호 해싱
- 응답에 password 미포함

### 4.4 PATCH `/api/users/[id]`

**Request Body (부분 업데이트):**
```json
{
    "name": "string (선택)",
    "phone": "string (선택)",
    "role": "owner | admin | member (선택)",
    "isActive": 0 | 1
}
```

**Response (200):**
```json
{
    "success": true,
    "data": {
        "id": 1,
        "name": "수정된 이름",
        "role": "admin",
        "isActive": 1
    }
}
```

**Error Responses:**
- `400`: 유효하지 않은 역할 값
- `403`: 권한 없음 / 본인 역할 변경 시도 / 본인 비활성화 시도
- `404`: 사용자 없음 (같은 조직)

**비즈니스 규칙:**
- 본인 ID와 대상 ID가 같으면 `role`, `isActive` 변경 불가 (403)
- admin은 member만 수정 가능 (다른 admin/owner 수정 불가)
- owner는 모든 사용자 수정 가능
- `updatedAt`을 현재 시간으로 업데이트

---

## 5. SWR Hook 설계

### 5.1 useUsers

```typescript
// src/hooks/useUsers.ts
interface UseUsersParams {
    page?: number;
    pageSize?: number;
    search?: string;
}

interface UsersResponse {
    success: boolean;
    data: UserListItem[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

export function useUsers(params: UseUsersParams) {
    // SWR key: /api/users?page=1&pageSize=20&search=...
    const { data, error, isLoading, mutate } = useSWR<UsersResponse>(key, fetcher);

    const createUser = async (userData: CreateUserInput) => {
        const res = await fetch("/api/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(userData),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const updateUser = async (id: number, userData: UpdateUserInput) => {
        const res = await fetch(`/api/users/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(userData),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        users: data?.data ?? [],
        total: data?.total ?? 0,
        page: data?.page ?? 1,
        pageSize: data?.pageSize ?? 20,
        totalPages: data?.totalPages ?? 0,
        isLoading,
        error,
        mutate,
        createUser,
        updateUser,
    };
}
```

### 5.2 타입 정의

```typescript
// src/hooks/useUsers.ts 내부 또는 src/types/index.ts

interface CreateUserInput {
    name: string;
    email: string;
    password: string;
    role?: OrgRole;
    phone?: string;
}

interface UpdateUserInput {
    name?: string;
    phone?: string;
    role?: OrgRole;
    isActive?: number;
}
```

---

## 6. UI 컴포넌트 설계

### 6.1 페이지: `/users`

**파일**: `src/pages/users.tsx`

```typescript
export default function UsersPage() {
    const { user } = useSession();
    const router = useRouter();
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState("");
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<UserListItem | null>(null);

    const { users, total, totalPages, isLoading, createUser, updateUser } = useUsers({
        page,
        search: search || undefined,
    });

    // member는 접근 불가 → 리다이렉트
    useEffect(() => {
        if (user && user.role === "member") {
            router.push("/");
        }
    }, [user, router]);

    // ...렌더링
}
```

**레이아웃 구조:**
```
WorkspaceLayout
└── div.p-6
    ├── 헤더 (h1 "사용자 관리" + 설명)
    ├── UserToolbar
    ├── UserTable
    ├── CreateUserDialog
    └── EditUserDialog
```

### 6.2 UserToolbar

**파일**: `src/components/users/UserToolbar.tsx`

**Props:**
```typescript
interface UserToolbarProps {
    onSearch: (keyword: string) => void;
    onCreateClick: () => void;
}
```

**구현:**
- 검색 Input (Search 아이콘 + debounce 300ms) — RecordToolbar 패턴 동일
- "사용자 추가" Button (Plus 아이콘)

### 6.3 UserTable

**파일**: `src/components/users/UserTable.tsx`

**Props:**
```typescript
interface UserTableProps {
    users: UserListItem[];
    currentUserId: number;
    currentUserRole: OrgRole;
    isLoading: boolean;
    onUpdateUser: (id: number, data: UpdateUserInput) => Promise<ApiResponse>;
    onEditClick: (user: UserListItem) => void;
    page: number;
    totalPages: number;
    total: number;
    pageSize: number;
    onPageChange: (page: number) => void;
}
```

**테이블 컬럼:**

| 컬럼 | 너비 | 렌더링 |
|------|------|--------|
| 이름 | auto | text |
| 이메일 | auto | text |
| 역할 | 120px | Badge (owner: default, admin: secondary, member: outline) |
| 상태 | 100px | Switch (isActive) |
| 가입일 | 120px | yyyy-MM-dd 형식 |
| 액션 | 80px | DropdownMenu (수정, 역할 변경) |

**역할 Badge 색상:**
- owner: `bg-primary text-primary-foreground`
- admin: `variant="secondary"`
- member: `variant="outline"`

**Switch 비활성화 조건:**
- 본인 계정 (`user.id === currentUserId`)
- admin이 owner/admin을 수정하려는 경우

**DropdownMenu 항목:**
- "정보 수정" → `onEditClick(user)`
- "역할 변경" → 서브메뉴: owner / admin / member (현재 역할은 체크 표시)
- 조건에 따라 비활성화

**Pagination:**
- RecordTable과 동일한 패턴 (이전/다음 Button + "N / M 페이지" 텍스트)

### 6.4 CreateUserDialog

**파일**: `src/components/users/CreateUserDialog.tsx`

**Props:**
```typescript
interface CreateUserDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    currentUserRole: OrgRole;
    onSubmit: (data: CreateUserInput) => Promise<ApiResponse>;
}
```

**폼 필드:**

| 필드 | 타입 | 필수 | 유효성 |
|------|------|:----:|--------|
| name | Input text | O | 1자 이상 |
| email | Input email | O | 이메일 형식 |
| password | Input password | O | 6자 이상 |
| role | Select | - | admin인 경우 member만 선택 가능 |
| phone | Input tel | - | - |

**동작:**
- Dialog 열릴 때 폼 초기화
- 제출 시 유효성 검증 → createUser → 성공 시 toast + 닫기
- admin은 role Select에서 member만 표시
- owner는 owner/admin/member 모두 표시

### 6.5 EditUserDialog

**파일**: `src/components/users/EditUserDialog.tsx`

**Props:**
```typescript
interface EditUserDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    user: UserListItem | null;
    onSubmit: (id: number, data: UpdateUserInput) => Promise<ApiResponse>;
}
```

**폼 필드:**

| 필드 | 타입 | 수정 가능 |
|------|------|:---------:|
| email | 표시만 (readonly) | X |
| name | Input text | O |
| phone | Input tel | O |

**동작:**
- `user` prop이 변경되면 폼 데이터 초기화
- 이름, 전화번호만 수정 가능 (역할은 테이블에서 직접 변경)
- 제출 시 updateUser → 성공 시 toast + 닫기

---

## 7. 에러 처리

| 상황 | 코드 | 메시지 | 처리 |
|------|------|--------|------|
| 미인증 | 401 | "인증되지 않았습니다." | 로그인 페이지 리다이렉트 |
| 권한 없음 (member) | 403 | "접근 권한이 없습니다." | toast.error |
| 본인 비활성화 시도 | 403 | "본인 계정은 비활성화할 수 없습니다." | toast.error |
| 본인 역할 변경 시도 | 403 | "본인의 역할은 변경할 수 없습니다." | toast.error |
| 권한 초과 수정 | 403 | "해당 사용자를 수정할 권한이 없습니다." | toast.error |
| 이메일 중복 | 409 | "이미 등록된 이메일입니다." | 폼 에러 표시 |
| 사용자 없음 | 404 | "사용자를 찾을 수 없습니다." | toast.error |
| 필수 필드 누락 | 400 | "{필드}을(를) 입력해주세요." | 폼 유효성 표시 |
| 비밀번호 짧음 | 400 | "비밀번호는 6자 이상이어야 합니다." | 폼 에러 표시 |

---

## 8. 보안

- [x] API 응답에서 `password` 필드 항상 제외 (select columns 명시)
- [x] JWT 인증 필수 (`getUserFromRequest()`)
- [x] 역할 기반 접근 제어 (owner/admin만)
- [x] 본인 계정 보호 (비활성화/역할 변경 불가)
- [x] admin의 권한 범위 제한 (member만 관리)
- [x] 비밀번호 해싱 (`hashPassword()` - bcryptjs)
- [x] 같은 조직 내 사용자만 조회/수정 가능 (orgId 필터)

---

## 9. 파일 구조

### 9.1 신규 생성 파일

```
src/
├── pages/
│   ├── users.tsx                          # 사용자 관리 페이지
│   └── api/
│       └── users/
│           ├── index.ts                   # GET (목록) + POST (생성)
│           └── [id].ts                    # PATCH (수정)
├── hooks/
│   └── useUsers.ts                        # SWR Hook
└── components/
    └── users/
        ├── UserToolbar.tsx                # 검색 + 추가 버튼
        ├── UserTable.tsx                  # 사용자 목록 테이블
        ├── CreateUserDialog.tsx           # 사용자 생성 Dialog
        └── EditUserDialog.tsx             # 사용자 수정 Dialog
```

### 9.2 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/types/index.ts` | `UserListItem`, `CreateUserInput`, `UpdateUserInput` 타입 추가 |

### 9.3 변경 없는 파일

| 파일 | 이유 |
|------|------|
| `src/lib/db/schema.ts` | 기존 users 테이블 그대로 활용 |
| `src/lib/auth.ts` | 기존 `getUserFromRequest()` 그대로 사용 |
| `src/components/layouts/WorkspaceLayout.tsx` | `/users` 네비게이션 이미 존재 |
| `src/contexts/SessionContext.tsx` | 기존 `useSession()` 그대로 사용 |

---

## 10. 구현 순서

1. [ ] **타입 추가** — `src/types/index.ts`에 `UserListItem`, `CreateUserInput`, `UpdateUserInput`
2. [ ] **API: GET + POST** — `src/pages/api/users/index.ts`
3. [ ] **API: PATCH** — `src/pages/api/users/[id].ts`
4. [ ] **SWR Hook** — `src/hooks/useUsers.ts`
5. [ ] **UserToolbar** — `src/components/users/UserToolbar.tsx`
6. [ ] **UserTable** — `src/components/users/UserTable.tsx`
7. [ ] **CreateUserDialog** — `src/components/users/CreateUserDialog.tsx`
8. [ ] **EditUserDialog** — `src/components/users/EditUserDialog.tsx`
9. [ ] **페이지** — `src/pages/users.tsx`
10. [ ] **빌드 검증** — `pnpm build`

---

## 버전 이력

| 버전 | 날짜 | 변경사항 | 작성자 |
|------|------|----------|--------|
| 0.1 | 2026-02-12 | 초안 작성 | AI |
