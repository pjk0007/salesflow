# auth-integration Planning Document

> **Summary**: Sales 프로젝트를 Adion 인증 시스템과 통합 — 공유 계정/조직으로 SSO 로그인
>
> **Project**: sales-manager
> **Version**: 0.1.0
> **Author**: AI
> **Date**: 2026-02-13
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

Sales 프로젝트(영업 CRM)와 Adion 프로젝트(마케팅 플랫폼)가 동일한 사용자 계정과 조직을 공유하여, 한 번 로그인으로 두 서비스를 이용할 수 있게 한다.

### 1.2 Background

- Sales와 Adion은 같은 도메인의 서브도메인으로 운영 예정 (`app.adion.com` / `sales.adion.com`)
- 같은 고객사(조직)의 마케팅팀은 Adion, 영업팀은 Sales를 사용
- 장기적으로 Adion의 Meta 광고 리드를 Sales의 고객 레코드로 전달하는 연동 계획
- 현재 두 프로젝트는 완전히 별도의 DB/인증 시스템을 사용 중

### 1.3 현재 구조 비교

| | Sales (현재) | Adion (대상) |
|---|---|---|
| DB | `localhost:5432/sales` | `localhost:5432/adion` |
| PK 타입 | `serial` (integer) | `uuid` |
| 인증 | 자체 JWT (jsonwebtoken) | NextAuth v5 + JWT |
| 해싱 | bcryptjs 10 rounds | bcryptjs 12 rounds |
| 쿠키 | `token` (HttpOnly, 12h) | `next-auth.session-token` |
| JWT Secret | `JWT_SECRET` env | `NEXTAUTH_SECRET` env |
| 유저-조직 | 1:1 직접 FK (`users.orgId`) | N:N 중간 테이블 (`organizationMembers`) |
| 역할 | owner/admin/member | owner/admin/member/viewer |
| orgId 타입 | integer | uuid (string) |

### 1.4 Related Documents

- Adion auth: `/Users/jake/project/adion/lib/auth/index.ts`
- Sales auth: `/Users/jake/project/sales/src/lib/auth.ts`
- Sales schema: `/Users/jake/project/sales/src/lib/db/schema.ts`
- Adion schema: `/Users/jake/project/adion/lib/db/schema.ts`

---

## 2. Scope

### 2.1 In Scope

- [ ] Sales DB 스키마를 uuid PK로 마이그레이션
- [ ] Sales 인증을 Adion DB 참조로 전환 (로그인 시 Adion users 조회)
- [ ] JWT payload를 uuid 기반으로 변경 (userId: string, orgId: string)
- [ ] 모든 API 라우트의 타입을 number → string으로 변경
- [ ] SessionContext의 타입 변경
- [ ] seed.ts를 Adion 계정 기반으로 재작성
- [ ] Sales DB에서 users/organizations 테이블 데이터 제거 (스키마는 유지하되 Adion과 동기화)
- [ ] 개발환경에서 두 프로젝트 간 인증 연동 동작 확인

### 2.2 Out of Scope

- Adion 코드 수정 (Sales 쪽만 변경)
- NextAuth 도입 (Sales는 자체 JWT 유지, Adion DB만 참조)
- 프로덕션 쿠키 공유 설정 (서브도메인 쿠키는 배포 시 설정)
- Adion 리드 → Sales 레코드 연동 (별도 PDCA)
- organizationMembers 중간 테이블 도입 (Sales는 1:1 유지, Adion에서 orgId를 받아옴)

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | Sales login API가 Adion DB의 users 테이블에서 이메일/비밀번호 인증 | High | Pending |
| FR-02 | 인증 성공 시 Adion의 organizationMembers에서 소속 조직 조회 | High | Pending |
| FR-03 | Sales DB에 해당 유저/조직이 없으면 자동 생성 (auto-provision) | High | Pending |
| FR-04 | Sales DB의 모든 PK/FK를 uuid로 마이그레이션 | High | Pending |
| FR-05 | JWTPayload 타입을 `{ userId: string, orgId: string, ... }`로 변경 | High | Pending |
| FR-06 | 35개 API 라우트의 orgId/userId 타입을 string으로 변경 | High | Pending |
| FR-07 | SessionContext의 SessionUser 타입을 uuid 기반으로 변경 | High | Pending |
| FR-08 | seed.ts를 Adion 계정 연동 테스트용으로 재작성 | Medium | Pending |
| FR-09 | signup API를 제거하거나 비활성화 (Adion에서만 가입) | Medium | Pending |
| FR-10 | Adion 유저의 role 매핑: Adion organizationRole → Sales OrgRole | Medium | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| 성능 | 로그인 시 Adion DB 조회 추가에도 응답 < 500ms | 수동 테스트 |
| 보안 | Adion DB는 읽기 전용 접근 (SELECT only) | DB 권한 설정 |
| 안정성 | Adion DB 연결 실패 시 적절한 에러 메시지 | 에러 핸들링 |
| 호환성 | 기존 Sales 기능 (알림톡, 레코드, 설정) 모두 정상 작동 | Build + 수동 테스트 |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] Adion에 가입된 계정으로 Sales에 로그인 가능
- [ ] 로그인 후 기존 기능 (레코드, 알림톡, 설정) 모두 정상 동작
- [ ] Sales DB의 모든 테이블이 uuid PK 사용
- [ ] `pnpm build` 성공 (타입 에러 없음)
- [ ] seed.ts로 테스트 데이터 생성 후 전체 흐름 동작 확인

### 4.2 Quality Criteria

- [ ] Zero lint errors
- [ ] Build succeeds
- [ ] 기존 35개 API 라우트 모두 정상 응답

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| uuid 마이그레이션 시 기존 데이터 손실 | High | Medium | 개발환경이므로 seed로 재생성. 프로덕션은 마이그레이션 스크립트 별도 작성 |
| Adion DB 연결 실패 시 Sales 서비스 중단 | High | Low | Adion DB 연결 실패 시 명확한 에러 반환, Health check 추가 |
| 35개 API 라우트 수정 시 타입 누락 | Medium | Medium | TypeScript strict 모드로 컴파일 에러 확인, Gap analysis로 검증 |
| OrgRole 매핑 불일치 (viewer 역할 없음) | Low | High | Adion viewer → Sales member로 매핑 |
| 두 DB 간 데이터 불일치 | Medium | Medium | Auto-provision으로 첫 로그인 시 Sales DB에 유저/조직 자동 생성 |

---

## 6. Architecture

### 6.1 통합 인증 흐름

```
[사용자] → Sales Login → Adion DB (users 조회 + password 검증)
                       → Adion DB (organizationMembers 조회)
                       → Sales DB (유저/조직 auto-provision)
                       → Sales JWT 생성 (uuid 기반)
                       → Cookie 설정
                       → 로그인 완료
```

### 6.2 DB 연결 구조

```
Sales 서비스
├── Sales DB (PRIMARY) — workspaces, records, fields, alimtalk, ...
│   └── users, organizations (auto-provisioned from Adion)
└── Adion DB (READ-ONLY) — 인증 시에만 접근
    └── users, organization_members, organizations
```

### 6.3 Auto-Provision 로직

```
1. Adion DB에서 유저 인증 (email + password)
2. Adion DB에서 organizationMembers 조회 → 소속 조직 확인
3. Sales DB에서 해당 uuid로 organization 존재 확인
   └── 없으면 → INSERT organizations (Adion org 데이터 복사)
4. Sales DB에서 해당 uuid로 user 존재 확인
   └── 없으면 → INSERT users (Adion user 데이터 + orgId 매핑)
5. Sales JWT 생성 (userId: uuid, orgId: uuid)
```

### 6.4 환경 변수

| Variable | Purpose | 값 |
|----------|---------|---|
| `DATABASE_URL` | Sales DB (기존) | `postgresql://...localhost:5432/sales` |
| `ADION_DATABASE_URL` | Adion DB (신규, 읽기전용) | `postgresql://...localhost:5432/adion` |
| `JWT_SECRET` | Sales JWT 서명 (기존) | (유지) |

---

## 7. 변경 영향도

### 7.1 스키마 변경 (uuid 마이그레이션)

**organizations.id**: serial → uuid (6개 테이블 FK 영향)
**users.id**: serial → uuid (6개 테이블 FK 영향)

| 테이블 | FK 컬럼 | 참조 대상 | 변경 |
|--------|---------|-----------|------|
| users | orgId | organizations.id | integer → uuid |
| workspaces | orgId | organizations.id | integer → uuid |
| apiTokens | orgId | organizations.id | integer → uuid |
| alimtalkConfigs | orgId | organizations.id | integer → uuid |
| emailConfigs | orgId | organizations.id | integer → uuid |
| emailTemplates | orgId | organizations.id | integer → uuid |
| records | orgId | (denormalized) | integer → uuid (string) |
| alimtalkSendLogs | orgId | (denormalized) | integer → uuid (string) |
| memos | createdBy | users.id | integer → uuid |
| workspacePermissions | userId, grantedBy | users.id | integer → uuid |
| partitionPermissions | userId, grantedBy | users.id | integer → uuid |
| apiTokens | createdBy | users.id | integer → uuid |
| alimtalkTemplateLinks | createdBy | users.id | integer → uuid |
| alimtalkSendLogs | sentBy | users.id | integer → uuid |

### 7.2 코드 변경

| 영역 | 파일 수 | 변경 내용 |
|------|---------|-----------|
| Schema | 1 | 전체 PK/FK uuid 전환 |
| Types | 1 | JWTPayload, UserListItem 등 number → string |
| Auth | 2 | auth.ts, login.ts — Adion DB 연동 |
| API Routes | ~35 | orgId/userId 타입 변경 (대부분 자동 — 타입만 바뀌면 됨) |
| SessionContext | 1 | SessionUser.id, orgId: string |
| DB connection | 1 | adion DB 연결 추가 |
| Seed | 1 | Adion 연동용 재작성 |
| Signup | 1 | 비활성화/제거 |

---

## 8. 구현 순서 (예상)

1. `.env.local`에 `ADION_DATABASE_URL` 추가
2. Adion DB 연결 모듈 생성 (`src/lib/db/adion.ts`)
3. `src/lib/db/schema.ts` — 전체 uuid 마이그레이션
4. `src/types/index.ts` — JWTPayload, UserListItem 등 타입 변경
5. `src/lib/auth.ts` — JWT payload 타입 반영
6. `src/pages/api/auth/login.ts` — Adion DB 인증 + auto-provision
7. `src/pages/api/auth/signup.ts` — 비활성화
8. `src/pages/api/auth/me.ts` — 타입 반영
9. `src/contexts/SessionContext.tsx` — SessionUser 타입 변경
10. API 라우트 일괄 수정 (타입 변경에 따른 파싱 수정)
11. `scripts/seed.ts` — Adion 연동 테스트용 재작성
12. `pnpm build` 검증

---

## 9. Next Steps

1. [ ] Write design document (`auth-integration.design.md`)
2. [ ] Team review and approval
3. [ ] Start implementation

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-02-13 | Initial draft | AI |
