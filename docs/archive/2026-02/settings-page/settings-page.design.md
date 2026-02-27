# Design: 설정 페이지 통합 및 사이드바 개선

> **Summary**: 사이드바 업무/관리 영역 분리 + `/settings` 통합 페이지 (워크스페이스, 조직, 사용자 탭)
>
> **Project**: Sales Manager
> **Date**: 2026-02-12
> **Status**: Draft
> **Planning Doc**: [settings-page.plan.md](../../01-plan/features/settings-page.plan.md)

---

## 1. 설계 목표

- 사이드바를 B2B SaaS 표준에 맞게 업무/관리 영역 분리
- member 역할은 관리 메뉴를 볼 수 없도록 역할 기반 필터링
- `/workspace-settings` + `/org-settings` + `/users` → `/settings` 단일 페이지 탭으로 통합
- 기존 alimtalk.tsx 탭 패턴과 동일한 구조 적용
- DB 마이그레이션 없이 기존 JSONB 필드 활용

---

## 2. 아키텍처

### 2.1 컴포넌트 다이어그램

```
┌────────────────────────────────────────────────────────┐
│  WorkspaceLayout (수정)                                 │
│  ├── 사이드바                                           │
│  │   ├── MAIN_NAV (업무) — 모든 역할                    │
│  │   │   ├── 레코드 (/)                                │
│  │   │   └── 알림톡 (/alimtalk)                        │
│  │   ├── Separator + "관리" 라벨 — admin/owner만        │
│  │   └── ADMIN_NAV (관리) — admin/owner만               │
│  │       └── 설정 (/settings)                          │
│  └── 메인 콘텐츠                                        │
├────────────────────────────────────────────────────────┤
│  /settings (SettingsPage)                               │
│  ├── Tabs                                              │
│  │   ├── [탭] 워크스페이스 — WorkspaceSettingsTab       │
│  │   │   └── useWorkspaceSettings(workspaceId)         │
│  │   ├── [탭] 조직 — OrgSettingsTab                    │
│  │   │   └── useOrgSettings()                          │
│  │   └── [탭] 사용자 — UsersTab                        │
│  │       └── useUsers() (기존 재사용)                   │
│  └── URL query: ?tab=workspace|org|users               │
└────────────────────────────────────────────────────────┘
```

### 2.2 데이터 흐름

```
[SettingsPage]
   │
   ├── useOrgSettings()
   │       ├── GET /api/org/settings ──→ DB (organizations)
   │       └── updateOrg() ──→ PATCH /api/org/settings ──→ DB update + mutate
   │
   ├── useWorkspaceSettings(id)
   │       └── updateWorkspace() ──→ PATCH /api/workspaces/[id]/settings ──→ DB update + mutate
   │
   ├── useWorkspaces() (기존) ──→ GET /api/workspaces ──→ 워크스페이스 목록
   │
   └── useUsers() (기존) ──→ 사용자 관리 기능 그대로
```

---

## 3. 데이터 모델

### 3.1 기존 스키마 활용 (변경 없음)

```typescript
// organizations 테이블 — branding, settings는 JSONB
organizations.branding: { logo?: string; primaryColor?: string; companyName?: string }
organizations.settings: { timezone?: string; locale?: string; dateFormat?: string }

// workspaces 테이블 — settings는 JSONB
workspaces.settings: { defaultVisibleFields?: string[]; duplicateCheckField?: string }
```

### 3.2 클라이언트 타입 (추가)

```typescript
// src/types/index.ts 에 추가

export interface OrgBranding {
    logo?: string;
    primaryColor?: string;
    companyName?: string;
}

export interface OrgSettings {
    timezone?: string;
    locale?: string;
    dateFormat?: string;
}

export interface OrgInfo {
    id: number;
    name: string;
    slug: string;
    branding: OrgBranding | null;
    integratedCodePrefix: string;
    settings: OrgSettings | null;
}

export interface UpdateOrgInput {
    name?: string;
    branding?: OrgBranding;
    settings?: OrgSettings;
    integratedCodePrefix?: string;
}

export interface WorkspaceSettings {
    defaultVisibleFields?: string[];
    duplicateCheckField?: string;
}

export interface WorkspaceDetail {
    id: number;
    name: string;
    description: string | null;
    icon: string | null;
    settings: WorkspaceSettings | null;
}

export interface UpdateWorkspaceInput {
    name?: string;
    description?: string;
    icon?: string;
}
```

---

## 4. API 명세

### 4.1 엔드포인트 목록

| Method | Path | 설명 | 인증 | 권한 |
|--------|------|------|------|------|
| GET | `/api/org/settings` | 조직 정보 조회 | JWT | owner/admin |
| PATCH | `/api/org/settings` | 조직 정보 수정 | JWT | owner |
| PATCH | `/api/workspaces/[id]/settings` | 워크스페이스 정보 수정 | JWT | owner/admin |

### 4.2 GET `/api/org/settings`

**Response (200):**
```json
{
    "success": true,
    "data": {
        "id": 1,
        "name": "ABC 주식회사",
        "slug": "abc-corp",
        "branding": { "companyName": "ABC", "primaryColor": "#3B82F6" },
        "integratedCodePrefix": "SALES",
        "settings": { "timezone": "Asia/Seoul", "locale": "ko", "dateFormat": "yyyy-MM-dd" }
    }
}
```

**구현 세부:**
- `getUserFromRequest(req)` JWT 검증
- `user.role`이 `owner` 또는 `admin`이 아니면 403
- `user.orgId`로 조직 조회
- `integratedCodeSeq`는 응답에 포함하지 않음 (내부용)

### 4.3 PATCH `/api/org/settings`

**Request Body:**
```json
{
    "name": "string (선택)",
    "branding": { "companyName?": "string", "primaryColor?": "string", "logo?": "string" },
    "settings": { "timezone?": "string", "locale?": "string", "dateFormat?": "string" },
    "integratedCodePrefix": "string (선택)"
}
```

**Response (200):**
```json
{
    "success": true,
    "data": { "id": 1, "name": "수정된 이름", "slug": "abc-corp", "branding": {...}, "integratedCodePrefix": "NEW", "settings": {...} }
}
```

**Error Responses:**
- `401`: 미인증
- `403`: owner가 아님
- `400`: name이 빈 문자열

**구현 세부:**
- owner만 수정 가능 (admin은 GET만 허용)
- JSONB 부분 업데이트: 기존 값을 먼저 읽고 `{ ...existing, ...input }` 머지
- `integratedCodePrefix`: 빈 문자열이면 무시, trim 적용
- `name`: 빈 문자열이면 400
- `updatedAt`을 현재 시간으로 업데이트
- 응답에서 `integratedCodeSeq` 제외

### 4.4 PATCH `/api/workspaces/[id]/settings`

**Request Body:**
```json
{
    "name": "string (선택)",
    "description": "string (선택)",
    "icon": "string (선택)"
}
```

**Response (200):**
```json
{
    "success": true,
    "data": { "id": 1, "name": "수정된 워크스페이스", "description": "설명", "icon": "briefcase" }
}
```

**Error Responses:**
- `401`: 미인증
- `403`: owner/admin이 아님
- `404`: 워크스페이스 없음 (같은 조직)
- `400`: name이 빈 문자열

**구현 세부:**
- owner/admin 모두 수정 가능
- 같은 조직(`orgId`)의 워크스페이스만 수정
- `name`: 빈 문자열이면 400
- `updatedAt`을 현재 시간으로 업데이트

---

## 5. SWR Hook 설계

### 5.1 useOrgSettings

```typescript
// src/hooks/useOrgSettings.ts

export function useOrgSettings() {
    const { data, error, isLoading, mutate } = useSWR<ApiResponse<OrgInfo>>(
        "/api/org/settings",
        fetcher
    );

    const updateOrg = async (input: UpdateOrgInput) => {
        const res = await fetch("/api/org/settings", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        org: data?.data ?? null,
        isLoading,
        error,
        updateOrg,
    };
}
```

### 5.2 useWorkspaceSettings

```typescript
// src/hooks/useWorkspaceSettings.ts

export function useWorkspaceSettings(workspaceId: number | null) {
    const { data, error, isLoading, mutate } = useSWR<ApiResponse<WorkspaceDetail>>(
        workspaceId ? `/api/workspaces/${workspaceId}/settings` : null,
        fetcher
    );

    const updateWorkspace = async (input: UpdateWorkspaceInput) => {
        if (!workspaceId) return { success: false, error: "워크스페이스를 선택해주세요." };
        const res = await fetch(`/api/workspaces/${workspaceId}/settings`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        workspace: data?.data ?? null,
        isLoading,
        error,
        updateWorkspace,
    };
}
```

---

## 6. UI 컴포넌트 설계

### 6.1 WorkspaceLayout 수정

**파일**: `src/components/layouts/WorkspaceLayout.tsx` (수정)

**변경사항:**
- `NAV_ITEMS` 배열을 `MAIN_NAV`(업무)와 `ADMIN_NAV`(관리)로 분리
- 관리 영역은 `user.role !== "member"` 조건으로 표시
- 관리 영역 위에 Separator + "관리" 텍스트 라벨
- `/users`, `/workspace-settings`, `/org-settings` 제거 → `/settings` 하나로 대체

```typescript
const MAIN_NAV = [
    { href: "/", icon: LayoutDashboard, label: "레코드" },
    { href: "/alimtalk", icon: MessageSquare, label: "알림톡" },
];

const ADMIN_NAV = [
    { href: "/settings", icon: Settings, label: "설정" },
];
```

**렌더링 구조:**
```
<nav>
    {MAIN_NAV.map(...)}                    ← 모든 역할
    {user.role !== "member" && (
        <>
            <Separator className="my-2" />
            <p className="px-3 text-xs font-medium text-muted-foreground mb-1">관리</p>
            {ADMIN_NAV.map(...)}
        </>
    )}
</nav>
```

### 6.2 SettingsPage

**파일**: `src/pages/settings.tsx`

**구조:**
```typescript
export default function SettingsPage() {
    const router = useRouter();
    const { user } = useSession();
    const tabFromQuery = (router.query.tab as string) || "workspace";
    const [activeTab, setActiveTab] = useState(tabFromQuery);

    // member 접근 차단
    useEffect(() => {
        if (user && user.role === "member") router.push("/");
    }, [user, router]);

    // URL query sync
    const handleTabChange = (tab: string) => {
        setActiveTab(tab);
        router.replace({ pathname: "/settings", query: { tab } }, undefined, { shallow: true });
    };

    // ...렌더링
}
```

**레이아웃:**
```
WorkspaceLayout
└── div.p-6
    ├── 헤더 (h1 "설정" + 설명)
    └── Tabs (value={activeTab} onValueChange={handleTabChange})
        ├── TabsList
        │   ├── TabsTrigger "워크스페이스"
        │   ├── TabsTrigger "조직"
        │   └── TabsTrigger "사용자"
        ├── TabsContent "workspace" → <WorkspaceSettingsTab />
        ├── TabsContent "org" → <OrgSettingsTab />
        └── TabsContent "users" → <UsersTab />
```

### 6.3 WorkspaceSettingsTab

**파일**: `src/components/settings/WorkspaceSettingsTab.tsx`

**동작:**
- `useWorkspaces()`로 워크스페이스 목록 가져옴
- 첫 번째 워크스페이스 자동 선택 (여러 개인 경우 Select로 전환)
- `useWorkspaceSettings(workspaceId)`로 상세 정보 로드

**폼 필드:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|:----:|------|
| name | Input text | O | 워크스페이스 이름 |
| description | Textarea | - | 설명 |
| icon | Input text | - | 아이콘 이름 (예: "briefcase") |

**버튼:** "저장" Button (Submit)

**동작 흐름:**
1. 폼 데이터를 워크스페이스 정보로 초기화
2. 수정 후 "저장" 클릭 → `updateWorkspace()` → toast.success
3. `isSubmitting` 로딩 상태

### 6.4 OrgSettingsTab

**파일**: `src/components/settings/OrgSettingsTab.tsx`

**동작:**
- `useOrgSettings()`로 조직 정보 로드
- `useSession()`으로 현재 사용자 역할 확인
- admin은 모든 필드 `disabled` (읽기 전용)
- owner만 수정 가능

**폼 필드:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|:----:|------|
| name | Input text | O | 조직명 |
| branding.companyName | Input text | - | 표시 회사명 |
| branding.primaryColor | Input text (color) | - | 브랜드 색상 |
| integratedCodePrefix | Input text | - | 통합 코드 접두어 |
| settings.timezone | Select | - | 타임존 (Asia/Seoul 등) |
| settings.locale | Select | - | 로케일 (ko, en, ja) |
| settings.dateFormat | Select | - | 날짜 형식 (yyyy-MM-dd, MM/dd/yyyy 등) |

**타임존 Select 옵션:**
- `Asia/Seoul` (한국 표준시)
- `Asia/Tokyo` (일본 표준시)
- `America/New_York` (미국 동부)
- `America/Los_Angeles` (미국 서부)
- `Europe/London` (영국)
- `UTC`

**로케일 Select 옵션:**
- `ko` (한국어)
- `en` (English)
- `ja` (日本語)

**날짜 형식 Select 옵션:**
- `yyyy-MM-dd` (2026-02-12)
- `yyyy.MM.dd` (2026.02.12)
- `MM/dd/yyyy` (02/12/2026)
- `dd/MM/yyyy` (12/02/2026)

**버튼:** owner인 경우만 "저장" Button 표시
**읽기 전용 안내:** admin인 경우 "조직 설정은 Owner만 수정할 수 있습니다." 안내 메시지

### 6.5 UsersTab

**파일**: `src/components/settings/UsersTab.tsx`

**동작:**
- 기존 `users.tsx` 페이지의 컨텐츠를 컴포넌트로 추출
- `useUsers()`, `useSession()` 그대로 사용
- UserToolbar, UserTable, CreateUserDialog, EditUserDialog 그대로 재사용
- 페이지 래퍼(WorkspaceLayout, 헤더) 없이 순수 컨텐츠만

### 6.6 기존 페이지 정리

| 파일 | 변경 |
|------|------|
| `src/pages/users.tsx` | `/settings?tab=users`로 리다이렉트하는 간단한 페이지로 변경 |
| `src/pages/workspace-settings.tsx` | 생성 불필요 (미존재 상태 유지) |
| `src/pages/org-settings.tsx` | 생성 불필요 (미존재 상태 유지) |

---

## 7. 에러 처리

| 상황 | 코드 | 메시지 | 처리 |
|------|------|--------|------|
| 미인증 | 401 | "인증되지 않았습니다." | 로그인 리다이렉트 |
| 권한 없음 (member) | 403 | "접근 권한이 없습니다." | toast.error |
| owner가 아닌데 조직 수정 | 403 | "조직 설정은 Owner만 수정할 수 있습니다." | toast.error |
| 워크스페이스 없음 | 404 | "워크스페이스를 찾을 수 없습니다." | toast.error |
| name이 빈 문자열 | 400 | "이름을 입력해주세요." | 폼 유효성 에러 |
| 서버 오류 | 500 | "서버 오류가 발생했습니다." | toast.error |

---

## 8. 보안

- [x] JWT 인증 필수 (`getUserFromRequest()`)
- [x] 역할 기반 접근 제어 (사이드바: member 숨김, API: owner/admin)
- [x] 조직 수정은 owner만 가능
- [x] 같은 조직의 워크스페이스만 수정 가능 (orgId 필터)
- [x] JSONB 부분 업데이트 시 기존 데이터 유지 (spread merge)

---

## 9. 파일 구조

### 9.1 신규 생성 파일

```
src/
├── pages/
│   ├── settings.tsx                              # 설정 통합 페이지
│   └── api/
│       └── org/
│           └── settings.ts                       # GET + PATCH 조직 설정
├── hooks/
│   ├── useOrgSettings.ts                         # 조직 설정 SWR Hook
│   └── useWorkspaceSettings.ts                   # 워크스페이스 설정 SWR Hook
└── components/
    └── settings/
        ├── WorkspaceSettingsTab.tsx              # 워크스페이스 설정 탭
        ├── OrgSettingsTab.tsx                    # 조직 설정 탭
        └── UsersTab.tsx                          # 사용자 관리 탭
```

### 9.2 신규 API 파일

```
src/pages/api/
├── org/
│   └── settings.ts                               # GET + PATCH
└── workspaces/
    └── [id]/
        └── settings.ts                           # PATCH (신규)
```

### 9.3 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/components/layouts/WorkspaceLayout.tsx` | NAV_ITEMS → MAIN_NAV + ADMIN_NAV 분리, 역할별 표시 |
| `src/pages/users.tsx` | 기존 내용 제거, `/settings?tab=users` 리다이렉트로 변경 |
| `src/types/index.ts` | OrgBranding, OrgSettings, OrgInfo, UpdateOrgInput, WorkspaceSettings, WorkspaceDetail, UpdateWorkspaceInput 타입 추가 |

### 9.4 변경 없는 파일

| 파일 | 이유 |
|------|------|
| `src/lib/db/schema.ts` | 기존 테이블 그대로 활용 |
| `src/hooks/useUsers.ts` | 기존 Hook 그대로 재사용 |
| `src/hooks/useWorkspaces.ts` | 기존 Hook 그대로 재사용 (목록 조회용) |
| `src/components/users/*` | 기존 컴포넌트 그대로 재사용 |
| `src/pages/api/users/*` | 기존 API 그대로 유지 |

---

## 10. 구현 순서

1. [ ] **타입 추가** — `src/types/index.ts`에 OrgBranding, OrgSettings, OrgInfo, UpdateOrgInput, WorkspaceDetail, WorkspaceSettings, UpdateWorkspaceInput
2. [ ] **API: 조직 설정** — `src/pages/api/org/settings.ts` (GET + PATCH)
3. [ ] **API: 워크스페이스 설정** — `src/pages/api/workspaces/[id]/settings.ts` (PATCH)
4. [ ] **SWR Hook: useOrgSettings** — `src/hooks/useOrgSettings.ts`
5. [ ] **SWR Hook: useWorkspaceSettings** — `src/hooks/useWorkspaceSettings.ts`
6. [ ] **WorkspaceSettingsTab** — `src/components/settings/WorkspaceSettingsTab.tsx`
7. [ ] **OrgSettingsTab** — `src/components/settings/OrgSettingsTab.tsx`
8. [ ] **UsersTab** — `src/components/settings/UsersTab.tsx`
9. [ ] **설정 페이지** — `src/pages/settings.tsx`
10. [ ] **사이드바 수정** — `src/components/layouts/WorkspaceLayout.tsx`
11. [ ] **기존 users.tsx 리다이렉트** — `src/pages/users.tsx` 수정
12. [ ] **빌드 검증** — `pnpm build`

---

## 버전 이력

| 버전 | 날짜 | 변경사항 | 작성자 |
|------|------|----------|--------|
| 0.1 | 2026-02-12 | 초안 작성 | AI |
