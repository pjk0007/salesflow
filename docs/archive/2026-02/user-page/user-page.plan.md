# Plan: 사용자 페이지 개발

## 개요

조직(Organization) 내 사용자를 관리하는 페이지를 구현한다.
현재 사이드바 내비게이션에 `/users` 경로가 정의되어 있으나 페이지가 존재하지 않는 상태이다.
관리자(owner/admin)가 조직 멤버를 조회, 초대, 역할 변경, 비활성화할 수 있는 UI와 API를 구축한다.

> 기존 DB 스키마(`users` 테이블)를 그대로 활용하며, 회원가입 API(`/api/auth/signup`)가 이미 존재한다.

---

## 사용자 스토리

| ID | 역할 | 스토리 | 우선순위 |
|----|------|--------|----------|
| US-01 | 관리자 | 조직 내 전체 사용자 목록을 조회할 수 있다 (이름, 이메일, 역할, 상태, 가입일) | P0 |
| US-02 | 관리자 | 새 사용자를 초대(생성)할 수 있다 (이름, 이메일, 비밀번호, 역할, 전화번호) | P0 |
| US-03 | 관리자 | 사용자의 역할(owner/admin/member)을 변경할 수 있다 | P0 |
| US-04 | 관리자 | 사용자를 비활성화/활성화할 수 있다 | P0 |
| US-05 | 관리자 | 사용자의 기본 정보(이름, 전화번호)를 수정할 수 있다 | P1 |
| US-06 | 관리자 | 사용자를 검색(이름/이메일)할 수 있다 | P1 |
| US-07 | 관리자 | 비밀번호를 초기화할 수 있다 | P2 |

---

## 기능 범위

### In-Scope (이번 구현)

| ID | 기능 | 설명 |
|----|------|------|
| F-01 | 사용자 목록 페이지 | `/users` 페이지에서 조직 내 사용자 목록을 테이블로 표시 |
| F-02 | 사용자 검색 | 이름 또는 이메일로 사용자 검색 |
| F-03 | 사용자 생성 Dialog | 이름, 이메일, 비밀번호, 역할, 전화번호 입력 폼 |
| F-04 | 사용자 정보 수정 | 이름, 전화번호, 역할 인라인 또는 Dialog 수정 |
| F-05 | 사용자 활성화/비활성화 | isActive 토글 (본인 계정은 비활성화 불가) |
| F-06 | 역할 변경 | Select로 owner/admin/member 변경 (본인 역할 변경 불가) |
| F-07 | 사용자 목록 API | GET `/api/users` - 조직 내 사용자 목록 조회 (페이지네이션, 검색) |
| F-08 | 사용자 생성 API | POST `/api/users` - 새 사용자 생성 |
| F-09 | 사용자 수정 API | PATCH `/api/users/[id]` - 사용자 정보 수정 |
| F-10 | 사용자 비활성화 API | PATCH `/api/users/[id]` - isActive 변경 |

### Out-of-Scope (향후)

- 비밀번호 초기화 기능 (P2)
- 이메일 초대 발송 (이메일 설정 기능 연동 후)
- 워크스페이스/파티션 별 권한 관리 페이지 (별도 PDCA)
- 사용자 프로필 이미지 업로드
- 사용자 활동 로그 조회
- 벌크 사용자 Import/Export (CSV)

---

## 기술 스택 (기존 프로젝트 기준)

| 항목 | 기술 |
|------|------|
| Framework | Next.js 16 (Pages Router) |
| Language | TypeScript |
| UI | ShadCN UI + Tailwind CSS 4 |
| Data Fetching | SWR |
| DB | PostgreSQL + Drizzle ORM |
| 인증 | JWT (cookie 기반, `getUserFromRequest()`) |
| 패키지 매니저 | pnpm |

---

## DB 스키마 (기존 활용)

```sql
-- users 테이블 (이미 존재)
users (
  id           SERIAL PRIMARY KEY,
  org_id       INTEGER NOT NULL REFERENCES organizations(id),
  email        VARCHAR(255) NOT NULL,
  password     VARCHAR(255) NOT NULL,
  name         VARCHAR(100) NOT NULL,
  role         VARCHAR(20) DEFAULT 'member' NOT NULL,  -- owner | admin | member
  phone        VARCHAR(20),
  is_active    INTEGER DEFAULT 1 NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, email)
)
```

> 추가 마이그레이션 불필요 - 기존 스키마로 충분

---

## API 설계 요약

### GET `/api/users`
- Query: `page`, `pageSize`, `search`
- 인증: JWT (owner/admin만 접근)
- 응답: PaginatedResponse<User> (password 필드 제외)

### POST `/api/users`
- Body: `{ name, email, password, role?, phone? }`
- 인증: JWT (owner/admin만 접근)
- 유효성: 이메일 중복 체크, 비밀번호 6자 이상
- 응답: 생성된 사용자 정보

### PATCH `/api/users/[id]`
- Body: `{ name?, phone?, role?, isActive? }`
- 인증: JWT (owner/admin만 접근)
- 제약: 본인 계정 비활성화 불가, 본인 역할 변경 불가
- 응답: 수정된 사용자 정보

---

## UI 구조

```
/users (페이지)
├── UserToolbar        - 검색 입력 + 사용자 생성 버튼
├── UserTable          - 사용자 목록 테이블 (이름, 이메일, 역할, 상태, 가입일, 액션)
│   ├── RoleBadge      - 역할별 색상 Badge
│   └── StatusBadge    - 활성/비활성 Badge
├── CreateUserDialog   - 사용자 생성 폼 Dialog
└── EditUserDialog     - 사용자 수정 폼 Dialog
```

---

## 권한 모델

| 역할 | 사용자 목록 조회 | 사용자 생성 | 역할 변경 | 비활성화 |
|------|:----------------:|:-----------:|:---------:|:--------:|
| owner | O | O | O | O |
| admin | O | O | member만 | member만 |
| member | X (접근 불가) | X | X | X |

---

## 성공 기준

### Definition of Done

- [ ] 사용자 목록 페이지(`/users`)에서 조직 내 사용자 조회 가능
- [ ] 사용자 생성 Dialog로 새 사용자 추가 가능
- [ ] 사용자 역할 변경 및 비활성화 가능
- [ ] 검색 기능 동작
- [ ] owner/admin 권한 검증 (member는 접근 불가)
- [ ] 빌드 성공

---

## 리스크 및 대응

| 리스크 | 영향 | 대응 |
|--------|------|------|
| member 역할 사용자가 URL 직접 접근 | 중 | API 레벨 권한 체크 + 페이지 레벨 리다이렉트 |
| owner 계정 비활성화로 조직 잠금 | 높 | 본인 계정 비활성화 제한 + owner는 최소 1명 유지 |
| 비밀번호 평문 노출 | 높 | API 응답에서 password 필드 항상 제외 |

---

## 다음 단계

1. [ ] Design 문서 작성 (`/pdca design user-page`)
2. [ ] 구현
3. [ ] Gap 분석

---

## 버전 이력

| 버전 | 날짜 | 변경사항 | 작성자 |
|------|------|----------|--------|
| 0.1 | 2026-02-12 | 초안 작성 | AI |
