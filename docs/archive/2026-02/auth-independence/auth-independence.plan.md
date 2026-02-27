# Plan: auth-independence

> Sales 서비스의 Adion DB 의존성을 제거하고, 자체 회원가입/로그인 시스템을 구축한다.

## 1. 배경 및 목표

### 현재 상태
- 로그인(`login.ts`)이 Adion DB를 직접 조회하여 인증 후 Sales DB에 유저/조직을 auto-provision
- 회원가입(`signup.ts`)은 410 반환하며 "Adion에서 가입하세요" 안내
- `adion.ts`(Adion DB 연결), `adion-info.ts`(Adion 조직 정보 API), `useAdionOrgInfo.ts`(SWR 훅), `OrgGeneralTab.tsx`(Adion 정보 Card) 등 6개 파일이 Adion에 의존
- 초대 수락(`invitations/accept.ts`)은 이미 Sales DB에 독립적으로 유저 생성

### 목표
- Sales 서비스가 Adion 없이 독립적으로 동작
- 자체 조직 생성 + 회원가입 + 로그인 플로우 구축
- Adion 관련 코드/환경변수 완전 제거
- 기존 초대 기반 유저 가입 플로우는 유지

## 2. 요구사항

### 필수 (Must Have)
- [x] R1: 자체 회원가입 (조직 생성 + owner 계정 생성)
- [x] R2: 자체 로그인 (Sales DB에서 직접 인증)
- [x] R3: Adion DB 연결 코드 제거 (`src/lib/db/adion.ts`)
- [x] R4: Adion 정보 API/훅/UI 제거 (`adion-info.ts`, `useAdionOrgInfo.ts`, OrgGeneralTab의 Adion Card)
- [x] R5: 기존 초대 수락 플로우 유지 (변경 없음)

### 선택 (Nice to Have)
- [ ] R6: 이메일 인증 (추후 구현 가능, 초기에는 없이 진행)
- [ ] R7: 비밀번호 찾기/재설정

## 3. 영향 범위

### 수정 대상 파일

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 1 | `src/pages/api/auth/login.ts` | Adion DB 조회 제거 → Sales DB에서 직접 이메일/비밀번호 인증 |
| 2 | `src/pages/api/auth/signup.ts` | 410 반환 → 실제 회원가입 로직 (조직+유저 생성) |
| 3 | `src/pages/login.tsx` | 회원가입 링크 추가 |
| 4 | `src/pages/signup.tsx` | 신규 — 회원가입 페이지 (조직명, 이메일, 비밀번호, 이름) |

### 삭제 대상 파일

| # | 파일 | 이유 |
|---|------|------|
| 1 | `src/lib/db/adion.ts` | Adion DB 연결 + 테이블 정의 |
| 2 | `src/pages/api/org/adion-info.ts` | Adion 조직 정보 API |
| 3 | `src/hooks/useAdionOrgInfo.ts` | Adion 정보 SWR 훅 |

### UI 수정

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 1 | `src/components/settings/OrgGeneralTab.tsx` | Adion 정보 Card 제거 (import + JSX), useAdionOrgInfo import 제거 |

### 환경변수

| 변수 | 변경 |
|------|------|
| `ADION_DATABASE_URL` | 삭제 |

### 변경 없는 파일
- `src/lib/auth.ts` — 이미 Sales 전용, Adion 의존 없음
- `src/pages/api/org/invitations/accept.ts` — 이미 Sales DB 독립
- `src/pages/invite.tsx` — 초대 수락 UI, 변경 불필요

## 4. 회원가입 플로우 설계

```
[signup 페이지]
  ↓ POST /api/auth/signup
  ↓ { orgName, slug, email, password, name }
  ↓
  1. 입력값 검증
  2. 이메일 중복 체크 (Sales DB)
  3. slug 중복 체크 (organizations 테이블)
  4. organization 생성
  5. user 생성 (role: "owner", bcrypt 해시)
  6. JWT 생성 + 쿠키 설정
  7. 자동 로그인 → 대시보드 이동
```

## 5. 로그인 플로우 변경

```
[현재] login.ts
  ↓ Adion DB에서 유저 조회 + 비밀번호 검증
  ↓ Adion DB에서 조직 멤버십 조회
  ↓ Sales DB auto-provision
  ↓ JWT 생성

[변경 후] login.ts
  ↓ Sales DB에서 이메일로 유저 조회
  ↓ bcrypt 비밀번호 검증
  ↓ JWT 생성 + 쿠키 설정
```

## 6. 기존 유저 마이그레이션 고려

현재 Adion에서 auto-provision된 유저들은 `password: "ADION_SSO"` 로 저장됨.
- 이 유저들은 비밀번호로 로그인 불가 → 비밀번호 재설정 필요
- 초기 방안: 로그인 실패 시 "비밀번호를 재설정해주세요" 안내 표시
- 향후 R7(비밀번호 찾기) 구현 시 이메일 기반 재설정 플로우 추가

## 7. 구현 순서

1. `signup.ts` API 재작성 (조직+유저 생성)
2. `signup.tsx` 페이지 생성
3. `login.ts` API 재작성 (Sales DB 직접 인증)
4. `login.tsx`에 회원가입 링크 추가
5. Adion 파일 삭제 (`adion.ts`, `adion-info.ts`, `useAdionOrgInfo.ts`)
6. `OrgGeneralTab.tsx`에서 Adion Card + import 제거
7. 빌드 검증

## 8. 리스크

| 리스크 | 대응 |
|--------|------|
| 기존 ADION_SSO 유저 로그인 불가 | 안내 메시지 + 향후 비밀번호 재설정 기능 |
| Adion 정보 Card 제거로 요금제 정보 미표시 | Sales 자체 요금제 시스템은 별도 기능으로 추후 구현 |
| slug 충돌 | 가입 시 실시간 slug 중복 체크 |
