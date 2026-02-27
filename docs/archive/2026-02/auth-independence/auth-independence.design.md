# Design: auth-independence

> Plan 참조: `docs/01-plan/features/auth-independence.plan.md`

## 1. API 설계

### 1-1. POST /api/auth/signup (재작성)

**요청**:
```typescript
interface SignupRequest {
    orgName: string;    // 조직 이름 (1~200자)
    slug: string;       // 조직 slug (2~100자, 영문소문자+숫자+하이픈)
    email: string;      // 관리자 이메일
    password: string;   // 비밀번호 (6자 이상)
    name: string;       // 관리자 이름 (1~100자)
}
```

**응답 (200)**:
```json
{ "success": true, "user": { "userId": "uuid", "orgId": "uuid", "email": "...", "name": "...", "role": "owner" } }
```

**에러 응답**:
| 코드 | 조건 | 메시지 |
|------|------|--------|
| 400 | 필수 필드 누락 | "모든 필드를 입력해주세요." |
| 400 | 비밀번호 < 6자 | "비밀번호는 6자 이상이어야 합니다." |
| 400 | slug 형식 부적합 | "슬러그는 영문 소문자, 숫자, 하이픈만 사용 가능합니다." |
| 409 | slug 중복 | "이미 사용 중인 슬러그입니다." |
| 409 | 이메일 중복 | "이미 등록된 이메일입니다." |
| 405 | POST 외 메소드 | "Method not allowed" |

**로직 순서**:
1. `req.method !== "POST"` → 405
2. 입력값 검증 (orgName, slug, email, password, name)
3. slug 정규식 검증: `/^[a-z0-9][a-z0-9-]*[a-z0-9]$/` (2자 이상)
4. slug 중복 체크: `organizations` 테이블
5. 이메일 중복 체크: `users` 테이블 (전체, orgId 무관)
6. `hashPassword(password)` (bcrypt 10 rounds, 기존 auth.ts 활용)
7. `db.insert(organizations)` → org 생성
8. `db.insert(users)` → owner 유저 생성
9. `generateToken()` → JWT 생성
10. Set-Cookie 설정 (기존 login.ts 패턴 동일)
11. 200 응답

### 1-2. POST /api/auth/login (재작성)

**요청**: 변경 없음
```typescript
interface LoginRequest {
    email: string;
    password: string;
}
```

**응답**: 기존과 동일 구조

**변경 로직**:
```
[기존] adionDb → adionUsers → adionOrgMembers → adionOrganizations → Sales DB provision → JWT
[변경] db → users (with org JOIN) → bcrypt verify → JWT
```

**상세 순서**:
1. `req.method !== "POST"` → 405
2. email/password 필수 체크
3. Sales DB에서 유저 조회: `users` 테이블에서 email로 검색
4. 유저 없음 → 401
5. `password === "ADION_SSO"` → 401 + 특별 메시지: "비밀번호 재설정이 필요합니다."
6. `verifyPassword(password, user.password)` → 실패 시 401
7. `user.isActive !== 1` → 403: "비활성 계정입니다."
8. `generateToken()` → JWT (기존 JWTPayload 구조 유지)
9. Set-Cookie + 200 응답

## 2. 페이지 설계

### 2-1. signup.tsx (신규)

**레이아웃**: `login.tsx`와 동일한 2분할 레이아웃 (좌: 브랜드 패널, 우: 폼)

**폼 필드**:
| 필드 | 라벨 | 타입 | placeholder | 검증 |
|------|------|------|-------------|------|
| orgName | 조직 이름 | text | "회사 또는 팀 이름" | 필수 |
| slug | 조직 슬러그 | text | "my-company" | 필수, 영문소문자+숫자+하이픈 |
| name | 이름 | text | "이름을 입력하세요" | 필수 |
| email | 이메일 | email | "이메일을 입력하세요" | 필수 |
| password | 비밀번호 | password | "6자 이상" | 필수, 6자 이상 |

**동작**:
- Submit → `POST /api/auth/signup`
- 성공 시 `refreshSession()` → `router.push("/")`
- 실패 시 에러 메시지 표시
- 하단에 "이미 계정이 있으신가요? 로그인" 링크

**slug 도우미**:
- orgName 입력 시 자동으로 slug 제안 (한글 제거, 공백→하이픈, 소문자)
- slug 필드는 수동 편집 가능

### 2-2. login.tsx (수정)

**변경 사항**:
- 폼 하단에 "계정이 없으신가요? 회원가입" 링크 추가
- `<Link href="/signup">` 사용

## 3. 삭제 파일 목록

| # | 파일 | 삭제 이유 |
|---|------|-----------|
| 1 | `src/lib/db/adion.ts` | Adion DB 연결 완전 제거 |
| 2 | `src/pages/api/org/adion-info.ts` | Adion 조직 정보 API |
| 3 | `src/hooks/useAdionOrgInfo.ts` | Adion 정보 SWR 훅 |

## 4. UI 수정

### 4-1. OrgGeneralTab.tsx

**제거 대상**:
- `import { useAdionOrgInfo } from "@/hooks/useAdionOrgInfo"` 삭제
- `const { adionOrg } = useAdionOrgInfo()` 삭제
- `{adionOrg && ( ... )}` Adion 정보 Card 전체 블록 삭제 (line 152~186 영역)
- `import { Badge } from "@/components/ui/badge"` — Adion Card에서만 사용 중이면 삭제

## 5. 구현 순서

| # | 작업 | 파일 | 의존성 |
|---|------|------|--------|
| 1 | signup API 작성 | `src/pages/api/auth/signup.ts` | 없음 |
| 2 | signup 페이지 작성 | `src/pages/signup.tsx` | Step 1 |
| 3 | login API 재작성 | `src/pages/api/auth/login.ts` | 없음 |
| 4 | login 페이지에 가입 링크 | `src/pages/login.tsx` | Step 2 |
| 5 | Adion 파일 삭제 | 3개 파일 | Step 3 완료 후 |
| 6 | OrgGeneralTab Adion Card 제거 | `src/components/settings/OrgGeneralTab.tsx` | Step 5 |
| 7 | 빌드 검증 | — | 전체 완료 후 |

## 6. 데이터 모델

### 기존 스키마 활용 (변경 없음)

**organizations** 테이블 — 그대로 사용:
- `id`: uuid (defaultRandom)
- `name`: varchar(200)
- `slug`: varchar(100), unique
- `branding`: jsonb (optional)
- `integratedCodePrefix`: varchar(20), default "SALES"
- `settings`: jsonb (optional)

**users** 테이블 — 그대로 사용:
- `id`: uuid (defaultRandom)
- `orgId`: uuid (FK → organizations)
- `email`: varchar(255)
- `password`: varchar(255) — bcrypt 해시 저장
- `name`: varchar(100)
- `role`: varchar(20) — "owner" | "admin" | "member"
- `isActive`: integer, default 1
- unique constraint: (orgId, email)

> DB 스키마 변경 없음. 기존 테이블 그대로 활용.

## 7. 보안 고려사항

- 비밀번호: bcrypt 10 rounds (기존 `hashPassword()` 사용)
- JWT: 30일 만료 (기존 설정 유지)
- Cookie: HttpOnly, SameSite=Lax, Secure(production)
- slug 정규식으로 XSS/injection 방지
- 이메일 중복은 전체 users 테이블 기준 체크 (orgId 무관)
