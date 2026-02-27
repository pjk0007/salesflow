# signup-simplify Planning Document

> **Summary**: 회원가입과 조직 생성을 분리하여 가입 단계 간소화
>
> **Project**: SalesFlow
> **Author**: Claude
> **Date**: 2026-02-27
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

현재 회원가입 시 조직 이름 + 슬러그 + 이메일 + 비밀번호 + 이름을 한 번에 입력해야 합니다.
조직 생성을 가입 이후로 분리하여, 가입 단계를 간소화하고 adion 프로젝트와 동일한 패턴을 적용합니다.

### 1.2 Background

- 현재 flow: 회원가입 → orgName + slug + email + password + name 입력 → org + user + subscription 한번에 생성 → 온보딩
- 목표 flow: 회원가입 → email + password + name만 입력 → user만 생성 → 대시보드에서 조직 생성/초대 수락
- 참고: `~/project/adion` 프로젝트에서는 가입과 조직 생성이 완전히 분리됨

### 1.3 Key Constraint: `users.orgId NOT NULL`

현재 `users` 테이블에서 `orgId`는 `NOT NULL + FK`입니다.
이를 nullable로 변경하면 82개 API 전체에서 `user.orgId` null 처리가 필요해 사실상 리빌드입니다.

**해결 접근**: `users.orgId`를 nullable로 만들지 않고, 회원가입 시 **개인 조직(personal org)**을 자동 생성합니다.
가입 직후 slug 자동생성된 1인 조직이 만들어지고, 이후 온보딩/대시보드에서 조직 정보를 세팅합니다.

---

## 2. Scope

### 2.1 In Scope

- [ ] 회원가입 폼: orgName + slug 필드 제거 → email + password + name만
- [ ] signup API: 개인 조직 자동 생성 (이름=유저이름, slug=auto-generated)
- [ ] 온보딩 Step 1(WelcomeStep)에서 조직 이름/업종/규모 입력 (기존 flow 유지)
- [ ] slug 자동생성 로직 (random hex suffix로 고유성 보장)
- [ ] 기존 82개 API: 변경 없음 (orgId는 여전히 NOT NULL)

### 2.2 Out of Scope

- `users.orgId` nullable 변경 (대규모 리팩토링 필요)
- 복수 조직 소속 (organizationMembers 패턴)
- 조직 전환 기능
- 초대 수락 시 조직 이동

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | 회원가입 폼에서 orgName, slug 필드 제거 | High | Pending |
| FR-02 | signup API에서 개인 조직 자동 생성 (name=유저이름 + "의 조직", slug=auto) | High | Pending |
| FR-03 | slug 자동생성: `user-{randomHex8}` 형식 | High | Pending |
| FR-04 | Free 구독 자동 생성 유지 | High | Pending |
| FR-05 | 가입 후 온보딩으로 리다이렉트 (기존 유지) | Medium | Pending |
| FR-06 | 온보딩 WelcomeStep에서 조직 이름 변경 가능 (기존 유지) | Medium | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria |
|----------|----------|
| 호환성 | 기존 82개 API 변경 없음 |
| 호환성 | 기존 JWT 구조 (userId, orgId, email, name, role) 변경 없음 |
| UX | 가입 폼 필드: 3개 (name, email, password) |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] 회원가입 폼에 orgName, slug 필드 없음
- [ ] 가입 시 org 자동 생성됨
- [ ] 온보딩에서 조직 이름 설정 가능
- [ ] 기존 모든 기능 정상 동작
- [ ] `pnpm build` 성공

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| slug 중복 | Medium | Low | randomHex8 충돌 확률 극히 낮음, 중복 시 재시도 |
| 온보딩 스킵 시 조직이름이 "홍길동의 조직" | Low | Medium | 설정에서 변경 가능, 실사용에 문제 없음 |

---

## 6. 변경 파일 목록

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 1 | `src/pages/signup.tsx` | orgName, slug 관련 state/UI 제거, name+email+password만 |
| 2 | `src/pages/api/auth/signup.ts` | orgName/slug 파라미터 제거, 자동 생성 로직 |
| 3 | `src/components/landing/CtaSection.tsx` | (변경 불필요 - 이미 /signup 링크) |

총 **2개 파일** 수정

---

## 7. Next Steps

1. [ ] Write design document (`signup-simplify.design.md`)
2. [ ] Start implementation
3. [ ] Verify with `pnpm build`

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-02-27 | Initial draft | Claude |
