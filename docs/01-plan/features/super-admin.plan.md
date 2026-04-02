# Plan: Super Admin

## 1. 개요

플랫폼 전체를 관리하는 Super Admin 기능. 모든 조직을 넘나들며 사용자/조직/플랜/시스템을 관리할 수 있는 관리자 페이지.

## 2. 현재 상태

- 역할 체계: 조직 단위 `owner | admin | member` (organizationMembers.role)
- 플랫폼 레벨 관리자 개념 없음
- 사용자 정지: `users.isActive` 필드 존재하나 관리 UI 없음
- 플랜/구독: `plans`, `subscriptions`, `payments` 테이블 존재

## 3. 요구사항

### 3-1. Super Admin 식별
- `users` 테이블에 `is_super_admin` INTEGER DEFAULT 0 추가
- 초기 super admin: `cto@matchesplan.com`
- JWT에 `isSuperAdmin` 플래그 포함 → 클라이언트에서 admin 메뉴 노출 판단

### 3-2. 접근 제어
- `/admin` 경로: super admin만 접근 가능
- `/api/admin/*` API: `isSuperAdmin` 체크 미들웨어
- 일반 사용자 접근 시 404 (존재 자체를 숨김)

### 3-3. 기능 목록

| 기능 | 설명 |
|------|------|
| **시스템 대시보드** | 전체 조직 수, 사용자 수, 구독 현황, 최근 가입 추이 |
| **조직 목록** | 모든 조직 조회, 검색, 플랜 확인, 멤버 수 |
| **조직 상세** | 조직 정보, 멤버 목록, 워크스페이스 목록, 구독/결제 이력 |
| **사용자 목록** | 모든 사용자 조회, 검색, 상태(활성/정지) |
| **사용자 관리** | 활성/정지 토글 (isActive), super admin 지정/해제 |
| **플랜 변경** | 조직의 구독 플랜 강제 변경 |

## 4. 구현 범위

### Phase 1: 인프라 (DB + Auth + 라우팅)
- 마이그레이션: `users.is_super_admin` 컬럼
- schema.ts: `isSuperAdmin` 필드
- auth.ts: JWT payload에 `isSuperAdmin` 추가
- 로그인 API: super admin 플래그 JWT에 포함
- SessionContext: `isSuperAdmin` 노출
- 시드: `cto@matchesplan.com` → `is_super_admin = 1`

### Phase 2: API
- `GET /api/admin/stats` — 시스템 통계
- `GET /api/admin/organizations` — 조직 목록 (검색, 페이지네이션)
- `GET /api/admin/organizations/[id]` — 조직 상세 (멤버, 워크스페이스, 구독)
- `GET /api/admin/users` — 사용자 목록 (검색, 페이지네이션)
- `PATCH /api/admin/users/[id]` — 사용자 상태 변경 (isActive, isSuperAdmin)
- `PATCH /api/admin/organizations/[id]/subscription` — 플랜 강제 변경

### Phase 3: UI
- `/admin` 페이지 (탭: 대시보드 / 조직 / 사용자)
- 사이드바에 admin 링크 (super admin만 보임)
- 각 탭 컴포넌트: AdminDashboard, AdminOrganizations, AdminUsers

## 5. 구현 순서

1. DB 마이그레이션 + schema.ts
2. auth.ts + JWT + SessionContext
3. 시드 마이그레이션 (cto@matchesplan.com)
4. API 엔드포인트 6개
5. UI 페이지 + 사이드바 링크

## 6. 영향 받는 파일

| 파일 | 변경 |
|------|------|
| `src/lib/db/schema.ts` | users.isSuperAdmin |
| `src/types/index.ts` | JWTPayload.isSuperAdmin |
| `src/lib/auth.ts` | getUserFromNextRequest 반환 타입 |
| `src/app/api/auth/login/route.ts` | JWT에 isSuperAdmin 포함 |
| `src/contexts/SessionContext.tsx` | isSuperAdmin 노출 |
| `src/components/dashboard/sidebar.tsx` | admin 링크 |
| `drizzle/0033_super_admin.sql` | ALTER TABLE |
| `src/app/admin/page.tsx` | 신규 |
| `src/app/api/admin/**` | 신규 (6개 엔드포인트) |
| `src/components/admin/**` | 신규 (3개 컴포넌트) |

## 7. 예상 규모

- 마이그레이션: 1개 SQL (2 ALTER)
- API: 6개 엔드포인트
- UI: 4개 컴포넌트
- 기존 수정: 5개 파일
- 예상 LOC: ~600
