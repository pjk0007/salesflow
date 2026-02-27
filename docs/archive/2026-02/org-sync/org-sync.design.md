# Design: org-sync

> 조직 설정을 Adion 스타일로 리뉴얼 — OrgGeneralTab + OrgTeamTab

## 1. 구현 범위

Plan 문서 기반, 총 6개 Task:

| # | Task | 유형 | 예상 LOC |
|---|------|------|----------|
| 1 | DB 스키마: organizationInvitations 테이블 | 수정 | ~25 |
| 2 | 멤버 관리 API (목록/역할변경/제거) | 신규 | ~120 |
| 3 | 초대 시스템 API (생성/목록/취소/수락) | 신규 | ~180 |
| 4 | SWR 훅 (useOrgMembers, useOrgInvitations) | 신규 | ~90 |
| 5 | OrgGeneralTab 리뉴얼 | 수정 | ~250 |
| 6 | OrgTeamTab + settings.tsx 탭 구조 변경 | 신규+수정 | ~350 |

**총 ~1,015 LOC**, 13개 파일

## 2. DB 스키마 변경

### 2.1 organizationInvitations 테이블 추가

`src/lib/db/schema.ts`에 추가:

```typescript
export const organizationInvitations = pgTable("organization_invitations", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    role: varchar("role", { length: 20 }).default("member").notNull(),
    token: varchar("token", { length: 64 }).unique().notNull(),
    status: varchar("status", { length: 20 }).default("pending").notNull(), // pending | accepted | cancelled
    invitedBy: uuid("invited_by")
        .references(() => users.id)
        .notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
});
```

타입 추출 추가:
```typescript
export type OrganizationInvitation = typeof organizationInvitations.$inferSelect;
export type NewOrganizationInvitation = typeof organizationInvitations.$inferInsert;
```

### 2.2 마이그레이션
- 기존 테이블 변경 없음 (organizations, users 등 그대로)
- 새 테이블만 추가 → `drizzle-kit push` 또는 migration generate

## 3. API 설계

### 3.1 멤버 관리 API

#### GET /api/org/members
멤버 목록 조회. admin 이상 접근.

**파일**: `src/pages/api/org/members.ts`

```
Request: GET /api/org/members
Auth: JWT (admin+)

Response 200:
{
  success: true,
  data: [
    {
      id: "uuid",
      name: "홍길동",
      email: "hong@example.com",
      role: "admin",
      phone: "010-1234-5678" | null,
      isActive: 1,
      createdAt: "2026-02-12T00:00:00Z"
    }
  ]
}
```

구현:
```typescript
// getUserFromRequest(req) → JWTPayload
// role check: admin | owner
// SELECT * FROM users WHERE org_id = ? ORDER BY role DESC, created_at ASC
// password 필드 제외
```

#### PATCH /api/org/members/[id]
멤버 역할 변경. admin 이상.

**파일**: `src/pages/api/org/members/[id].ts`

```
Request: PATCH /api/org/members/{userId}
Body: { role: "admin" | "member" }
Auth: JWT (admin+)

Response 200: { success: true, data: { id, role } }
Response 403: { error: "권한이 없습니다" }
```

권한 규칙:
- owner: 모든 멤버의 역할 변경 가능 (owner 제외)
- admin: member만 변경 가능 (admin 승격 불가)
- 자기 자신 역할 변경 불가
- owner 역할은 변경 대상에서 제외

#### DELETE /api/org/members/[id]
멤버 제거 (soft delete: isActive = 0). admin 이상.

**파일**: `src/pages/api/org/members/[id].ts` (PATCH와 동일 파일)

```
Request: DELETE /api/org/members/{userId}
Auth: JWT (admin+)

Response 200: { success: true }
Response 403: { error: "권한이 없습니다" }
```

권한 규칙:
- owner: owner 외 모든 멤버 제거 가능
- admin: member만 제거 가능
- 자기 자신 제거 불가

### 3.2 초대 시스템 API

#### GET /api/org/invitations
대기 중인 초대 목록. admin 이상.

**파일**: `src/pages/api/org/invitations.ts`

```
Request: GET /api/org/invitations
Auth: JWT (admin+)

Response 200:
{
  success: true,
  data: [
    {
      id: 1,
      email: "new@example.com",
      role: "member",
      status: "pending",
      invitedBy: { id: "uuid", name: "관리자" },
      expiresAt: "2026-02-20T00:00:00Z",
      createdAt: "2026-02-13T00:00:00Z"
    }
  ]
}
```

구현:
```typescript
// SELECT invitations JOIN users(invitedBy)
// WHERE org_id = ? AND status = 'pending' AND expires_at > NOW()
// ORDER BY created_at DESC
```

#### POST /api/org/invitations
초대 생성. admin 이상.

**파일**: `src/pages/api/org/invitations.ts` (GET과 동일 파일)

```
Request: POST /api/org/invitations
Body: { email: string, role: "admin" | "member" }
Auth: JWT (admin+)

Response 201: { success: true, data: { id, email, role, token, expiresAt } }
Response 400: { error: "이미 조직에 소속된 이메일입니다" }
Response 400: { error: "이미 대기 중인 초대가 있습니다" }
```

구현:
```typescript
// 1. 이메일 중복 체크 (users 테이블에 같은 orgId+email 존재)
// 2. 기존 pending 초대 체크
// 3. admin 역할 초대는 owner만 가능
// 4. token: crypto.randomUUID() (64자 아닌 36자 UUID도 가능)
// 5. expiresAt: 7일 후
// 6. INSERT INTO organization_invitations
```

#### DELETE /api/org/invitations/[id]
초대 취소. admin 이상.

**파일**: `src/pages/api/org/invitations/[id].ts`

```
Request: DELETE /api/org/invitations/{id}
Auth: JWT (admin+)

Response 200: { success: true }
```

구현:
```typescript
// UPDATE status = 'cancelled' WHERE id = ? AND org_id = ?
```

#### POST /api/org/invitations/accept
초대 수락. 토큰 기반 (인증 불요).

**파일**: `src/pages/api/org/invitations/accept.ts`

```
Request: POST /api/org/invitations/accept
Body: { token: string, name: string, password: string }
Auth: 없음 (토큰 기반)

Response 200: { success: true, data: { userId, orgId } }
Response 400: { error: "만료되었거나 유효하지 않은 초대입니다" }
```

구현:
```typescript
// 1. token으로 invitation 조회 (status=pending, expires_at > now)
// 2. 이미 orgId+email로 users에 존재하면 에러
// 3. INSERT INTO users (orgId, email, name, password: hashed, role)
// 4. UPDATE invitation status = 'accepted'
// 5. JWT 생성하여 반환 (선택적)
```

## 4. SWR 훅 설계

### 4.1 useOrgMembers

**파일**: `src/hooks/useOrgMembers.ts`

```typescript
interface UseOrgMembersReturn {
    members: MemberItem[];
    isLoading: boolean;
    error: Error | undefined;
    updateRole: (userId: string, role: OrgRole) => Promise<ApiResponse>;
    removeMember: (userId: string) => Promise<ApiResponse>;
}
```

패턴: 기존 `useUsers` 참고
- fetcher: `/api/org/members`
- updateRole: `PATCH /api/org/members/{id}` + `mutate()`
- removeMember: `DELETE /api/org/members/{id}` + `mutate()`

### 4.2 useOrgInvitations

**파일**: `src/hooks/useOrgInvitations.ts`

```typescript
interface UseOrgInvitationsReturn {
    invitations: InvitationItem[];
    isLoading: boolean;
    error: Error | undefined;
    createInvitation: (email: string, role: OrgRole) => Promise<ApiResponse>;
    cancelInvitation: (id: number) => Promise<ApiResponse>;
}
```

패턴:
- fetcher: `/api/org/invitations`
- createInvitation: `POST /api/org/invitations` + `mutate()`
- cancelInvitation: `DELETE /api/org/invitations/{id}` + `mutate()`

## 5. UI 컴포넌트 설계

### 5.1 OrgGeneralTab 리뉴얼

**파일**: `src/components/settings/OrgGeneralTab.tsx` (기존 `OrgSettingsTab.tsx` 대체)

**ShadCN 컴포넌트**: Card, Input, Label, Select, Button, AlertDialog, Badge

**레이아웃 구조**:

```
Card: 기본 정보
├── 조직명 (Input + 저장 버튼)
├── Slug (읽기 전용 + 복사 버튼)
├── 표시 회사명 (Input)
├── 브랜드 색상 (Input + 프리뷰)
├── 통합 코드 접두어 (Input)
├── 타임존 (Select)
├── 로케일 (Select)
└── 날짜 형식 (Select)

Card: 위험 영역 (owner만, border-destructive)
└── 조직 삭제 (AlertDialog 확인)
    └── 조직명 입력으로 확인
```

**기존 OrgSettingsTab.tsx 대비 변경점**:
- Card 래퍼 추가 (기존: 단순 div)
- Slug 표시 추가 (읽기 전용 + 복사)
- 위험 영역 섹션 추가 (조직 삭제)
- admin도 기본 정보 수정 가능 (기존: owner만)
- 저장 버튼을 조직명 옆 인라인으로 배치하지 않고, 하단 통합 저장 유지

**권한 분리**:
- admin+: 기본 정보 편집 가능
- owner: 위험 영역 표시
- member: 읽기 전용

**조직 삭제 플로우**:
1. owner가 "조직 삭제" 버튼 클릭
2. AlertDialog 열림: 조직명을 정확히 입력하라는 확인
3. 입력값이 조직명과 일치해야 삭제 버튼 활성화
4. DELETE /api/org/settings (기존 API에 DELETE 핸들러 추가)
5. 성공 시 로그아웃 처리 (단일 조직이므로)

### 5.2 OrgTeamTab 신규

**파일**: `src/components/settings/OrgTeamTab.tsx`

**ShadCN 컴포넌트**: Card, Table, Button, Dialog, AlertDialog, Select, Input, Label, Badge, DropdownMenu

**레이아웃 구조**:

```
헤더 영역
├── "팀 멤버" 제목
└── "초대하기" 버튼 (admin+)

Table: 멤버 목록
├── 열: 멤버(이름+이메일) | 역할(아이콘+라벨) | 가입일 | 액션
├── 역할 아이콘: owner=Crown, admin=Shield, member=UserCircle
├── 액션 DropdownMenu (admin+):
│   ├── 역할 변경 옵션 (owner만)
│   └── 멤버 제거 (destructive)
└── 자기 자신에게는 액션 없음

Card: 대기 중인 초대 (있을 때만 표시, admin+)
├── 열: 이메일 | 역할 | 만료일 | 취소 버튼
└── 초대 링크 복사 버튼

Card: 역할별 권한 안내
└── 3열 그리드: Owner, Admin, Member 각 권한 설명

Dialog: 멤버 초대
├── 이메일 입력
├── 역할 선택 (admin은 owner만 선택 가능)
└── 초대 / 취소 버튼

AlertDialog: 멤버 제거 확인
└── "{이름}을(를) 제거하시겠습니까?"
```

**역할 아이콘/라벨**:
```typescript
const roleConfig = {
    owner:  { icon: Crown,      label: "소유자", color: "text-yellow-500" },
    admin:  { icon: Shield,     label: "관리자", color: "text-blue-500" },
    member: { icon: UserCircle, label: "멤버",   color: "text-green-500" },
};
```

**권한 분리**:
- admin+: 멤버 목록 보기, 초대하기, 멤버 제거(member만)
- owner: 역할 변경, admin 초대, admin 제거
- member: 이 탭 자체가 보이지 않음 (settings.tsx에서 차단)

**초대 플로우**:
1. "초대하기" 버튼 → Dialog 열림
2. 이메일 + 역할 입력
3. POST /api/org/invitations
4. 성공: 초대 목록 갱신 + 토큰 링크 복사 안내 toast
5. 에러: Dialog 유지 + 에러 toast

**초대 링크 복사**:
- 초대 목록에서 복사 아이콘 클릭
- `{baseUrl}/invite?token={token}` 형식으로 클립보드 복사
- toast: "초대 링크가 복사되었습니다"

### 5.3 settings.tsx 탭 구조 변경

**파일**: `src/pages/settings.tsx`

**변경 전**:
```
워크스페이스 | 조직 | 사용자 | 속성 관리
```

**변경 후**:
```
워크스페이스 | 조직 | 팀 | 속성 관리
```

- "조직" 탭 → OrgGeneralTab (기존 OrgSettingsTab 대체)
- "사용자" → "팀" 탭명 변경 + OrgTeamTab (기존 UsersTab 대체)
- "팀" 탭은 admin 이상에게만 표시 (member는 설정 페이지 접근 자체가 차단됨)

import 변경:
```typescript
// 삭제
import OrgSettingsTab from "@/components/settings/OrgSettingsTab";
import UsersTab from "@/components/settings/UsersTab";

// 추가
import OrgGeneralTab from "@/components/settings/OrgGeneralTab";
import OrgTeamTab from "@/components/settings/OrgTeamTab";
```

## 6. 타입 추가

`src/types/index.ts`에 추가:

```typescript
export interface MemberItem {
    id: string;
    name: string;
    email: string;
    role: OrgRole;
    phone: string | null;
    isActive: number;
    createdAt: string;
}

export interface InvitationItem {
    id: number;
    email: string;
    role: OrgRole;
    status: "pending" | "accepted" | "cancelled";
    token: string;
    invitedBy: { id: string; name: string };
    expiresAt: string;
    createdAt: string;
}
```

## 7. 초대 수락 페이지

**파일**: `src/pages/invite.tsx`

- URL: `/invite?token=xxx`
- 토큰 유효성 검사 (GET /api/org/invitations/accept?token=xxx)
- 유효: 이름, 비밀번호 입력 폼 → POST /api/org/invitations/accept
- 만료/무효: 에러 메시지 표시
- 성공 시 자동 로그인 (JWT 세팅) → "/" 이동

## 8. 파일 변경 목록

### 수정 파일
| # | 파일 | 변경 내용 |
|---|------|-----------|
| 1 | `src/lib/db/schema.ts` | organizationInvitations 테이블 + 타입 추가 |
| 2 | `src/types/index.ts` | MemberItem, InvitationItem 타입 추가 |
| 3 | `src/pages/settings.tsx` | 탭 구조 변경 (OrgGeneralTab + OrgTeamTab) |

### 신규 파일
| # | 파일 | 설명 |
|---|------|------|
| 4 | `src/pages/api/org/members.ts` | GET 멤버 목록 |
| 5 | `src/pages/api/org/members/[id].ts` | PATCH 역할변경 + DELETE 제거 |
| 6 | `src/pages/api/org/invitations.ts` | GET 목록 + POST 생성 |
| 7 | `src/pages/api/org/invitations/[id].ts` | DELETE 취소 |
| 8 | `src/pages/api/org/invitations/accept.ts` | POST 수락 |
| 9 | `src/hooks/useOrgMembers.ts` | 멤버 SWR 훅 |
| 10 | `src/hooks/useOrgInvitations.ts` | 초대 SWR 훅 |
| 11 | `src/components/settings/OrgGeneralTab.tsx` | 조직 일반 탭 |
| 12 | `src/components/settings/OrgTeamTab.tsx` | 조직 팀 탭 |
| 13 | `src/pages/invite.tsx` | 초대 수락 페이지 |

### 삭제 파일
| # | 파일 | 사유 |
|---|------|------|
| 14 | `src/components/settings/OrgSettingsTab.tsx` | OrgGeneralTab으로 대체 |
| 15 | `src/components/settings/UsersTab.tsx` | OrgTeamTab으로 대체 |

## 9. 구현 순서

```
Step 1: DB 스키마 (schema.ts + types)
Step 2: 멤버 API (members.ts, members/[id].ts)
Step 3: 초대 API (invitations.ts, invitations/[id].ts, accept.ts)
Step 4: SWR 훅 (useOrgMembers, useOrgInvitations)
Step 5: OrgGeneralTab (OrgSettingsTab 대체)
Step 6: OrgTeamTab + settings.tsx 탭 변경
Step 7: invite.tsx (초대 수락 페이지)
Step 8: OrgSettingsTab.tsx, UsersTab.tsx 삭제
Step 9: Build 확인
```

## 10. 검증 기준

| ID | 항목 | 확인 방법 |
|----|------|-----------|
| V-01 | organizationInvitations 테이블 존재 | schema.ts에 정의 확인 |
| V-02 | GET /api/org/members 동작 | 멤버 목록 반환 |
| V-03 | PATCH /api/org/members/[id] 권한 체크 | owner/admin 분기 확인 |
| V-04 | DELETE /api/org/members/[id] 자기 자신 차단 | 403 반환 |
| V-05 | POST /api/org/invitations 중복 체크 | 기존 멤버/초대 검증 |
| V-06 | POST /api/org/invitations/accept 동작 | 유저 생성 + 초대 상태 변경 |
| V-07 | OrgGeneralTab에 slug 표시 | UI에서 확인 |
| V-08 | OrgGeneralTab 위험 영역 owner만 | role 분기 확인 |
| V-09 | OrgTeamTab 멤버 테이블 표시 | UI에서 확인 |
| V-10 | OrgTeamTab 초대 Dialog 동작 | 이메일+역할 입력 → API 호출 |
| V-11 | OrgTeamTab 역할 변경 owner만 | DropdownMenu 조건부 렌더링 |
| V-12 | settings.tsx 탭명 "팀" 변경 | UI에서 확인 |
| V-13 | invite.tsx 페이지 동작 | 토큰 → 가입 → 로그인 |
| V-14 | OrgSettingsTab.tsx 삭제 | 파일 존재하지 않음 |
| V-15 | UsersTab.tsx 삭제 | 파일 존재하지 않음 |
| V-16 | Build 에러 없음 | `pnpm build` 성공 |
