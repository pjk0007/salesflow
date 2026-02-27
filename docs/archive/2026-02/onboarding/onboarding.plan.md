# Plan: onboarding (유저 시작 프로세스 안내)

## 배경
현재 회원가입 후 바로 빈 대시보드(/)로 이동하여, 신규 사용자가 다음에 무엇을 해야 할지 알 수 없습니다. 조직 설정, 워크스페이스 생성, 필드 정의, 멤버 초대 등의 단계를 안내하는 온보딩 프로세스가 필요합니다.

## 목표
신규 가입 사용자를 단계별로 안내하여, 서비스를 빠르게 시작할 수 있도록 온보딩 위자드를 제공합니다.

## 기능 요구사항

### FR-01: 온보딩 완료 상태 추적
- organizations 테이블에 `onboardingCompleted` 컬럼 추가 (boolean, default false)
- 온보딩 완료 시 true로 업데이트
- 이미 온보딩 완료된 조직은 온보딩 스킵

### FR-02: 온보딩 페이지
- `/onboarding` 라우트 신규 생성
- 회원가입 후 자동 리다이렉트 (signup → /onboarding)
- 로그인 시에도 onboardingCompleted가 false면 /onboarding으로 리다이렉트
- 단계별 위자드 UI

### FR-03: 온보딩 단계
1. **환영 + 조직 정보** (Step 1)
   - 환영 메시지
   - 조직명 확인/수정
   - 업종/규모 선택 (선택사항)

2. **워크스페이스 설정** (Step 2)
   - 워크스페이스 이름 입력 (기본값: "영업관리")
   - 아이콘 선택 (기존 workspace-icon-picker 재사용)
   - 워크스페이스 자동 생성

3. **필드 설정** (Step 3)
   - 기본 필드 템플릿 선택 (영업관리, 고객관리, 프로젝트 등)
   - 또는 "직접 설정" → 스킵하고 나중에 설정
   - 선택한 템플릿의 필드 자동 생성

4. **멤버 초대** (Step 4)
   - 이메일로 팀원 초대 (최대 3명)
   - "나중에 하기" 스킵 가능
   - 기존 invitation API 재사용

5. **완료** (Step 5)
   - "설정 완료!" 메시지
   - "시작하기" 버튼 → `/` (대시보드)
   - onboardingCompleted = true 업데이트

### FR-04: 스킵 가능
- 각 단계에서 "건너뛰기" 가능
- 전체 온보딩 "건너뛰기" 버튼 (우상단)
- 스킵해도 onboardingCompleted = true

### FR-05: 필드 템플릿
- 영업관리: 회사명, 담당자명, 직함, 이메일, 전화번호, 영업단계, 예상매출, 메모
- 고객관리: 회사명, 담당자명, 이메일, 전화번호, 주소, 등급, 메모
- 프로젝트: 프로젝트명, 담당자, 시작일, 종료일, 상태, 예산, 메모

## 비기능 요구사항

### NFR-01: 기존 API 재사용
- 워크스페이스 생성: `POST /api/workspaces`
- 필드 생성: `POST /api/workspaces/[id]/fields/bulk`
- 멤버 초대: `POST /api/org/invitations`
- 신규 API 최소화

### NFR-02: 프로그레스 표시
- 상단에 단계 인디케이터 (1/5, 2/5, ...)
- 현재 단계 하이라이트

## 변경 파일 목록

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 1 | `src/lib/db/schema.ts` | organizations에 onboardingCompleted 컬럼 |
| 2 | `drizzle/XXXX_onboarding.sql` | 마이그레이션 |
| 3 | `src/pages/onboarding.tsx` | 신규: 온보딩 위자드 페이지 |
| 4 | `src/pages/api/auth/signup.ts` | 가입 후 리다이렉트 변경 |
| 5 | `src/components/layouts/WorkspaceLayout.tsx` | 온보딩 미완료 시 리다이렉트 |
| 6 | `src/lib/onboarding-templates.ts` | 신규: 필드 템플릿 정의 |
| 7 | `src/pages/api/org/onboarding-complete.ts` | 신규: 온보딩 완료 API |

## 구현 순서

| # | 작업 | 검증 |
|---|------|------|
| 1 | DB 스키마 + 마이그레이션 | drizzle-kit push |
| 2 | 필드 템플릿 정의 | 타입 에러 없음 |
| 3 | 온보딩 페이지 (5단계 위자드) | UI 렌더링 |
| 4 | 리다이렉트 로직 (signup, WorkspaceLayout) | 온보딩 플로우 동작 |
| 5 | 온보딩 완료 API | `pnpm build` 성공 |

## 우선순위: 3
## 의존성: 없음 (기존 API 재사용)
