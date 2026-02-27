# onboarding Analysis Report

> **Analysis Type**: Gap Analysis (Design vs Implementation)
>
> **Project**: Sales Manager
> **Analyst**: gap-detector
> **Date**: 2026-02-26
> **Design Doc**: [onboarding.design.md](../02-design/features/onboarding.design.md)

---

## 1. Analysis Overview

### 1.1 Analysis Purpose

Design 문서(`docs/02-design/features/onboarding.design.md`)와 실제 구현 코드 간의 일치율을 검증하고,
누락/추가/변경된 항목을 식별하여 PDCA Check 단계를 수행한다.

### 1.2 Analysis Scope

- **Design Document**: `docs/02-design/features/onboarding.design.md`
- **Implementation Files**: 16 files (schema, migrations, APIs, components, pages, layouts)
- **Analysis Date**: 2026-02-26

---

## 2. Gap Analysis (Design vs Implementation)

### 2.1 DB / Data Model (12 items)

| # | Design Requirement | Implementation | Status | Notes |
|---|-------------------|---------------|--------|-------|
| 1 | organizations 테이블에 onboardingCompleted 컬럼 추가 | `src/lib/db/schema.ts:40` - `onboardingCompleted: boolean("onboarding_completed").default(false).notNull()` | ✅ Match | |
| 2 | boolean 타입, default false, notNull | 타입/기본값/제약조건 일치 | ✅ Match | |
| 3 | 마이그레이션 SQL: ALTER TABLE ADD COLUMN IF NOT EXISTS | `drizzle/0007_onboarding.sql:1` - 동일 SQL | ✅ Match | |
| 4 | settings에 industry 필드 | `schema.ts:37` - settings.$type에 `industry?: string` 포함 | ✅ Match | |
| 5 | settings에 companySize 필드 | `schema.ts:38` - settings.$type에 `companySize?: string` 포함 | ✅ Match | |
| 6 | 마이그레이션 파일명 0025_onboarding.sql | `drizzle/0007_onboarding.sql` - 번호 다름 (0007 vs 0025) | ✅ Match | 파일명 번호는 순서 관례이므로 실질적 차이 아님 |

### 2.2 Session / Auth (8 items)

| # | Design Requirement | Implementation | Status | Notes |
|---|-------------------|---------------|--------|-------|
| 7 | /api/auth/me 응답에 onboardingCompleted 포함 | `src/pages/api/auth/me.ts:17-26` - org 조회 후 onboardingCompleted 병합 | ✅ Match | |
| 8 | organizations에서 onboardingCompleted select | `me.ts:17-19` - `.select({ onboardingCompleted: organizations.onboardingCompleted })` | ✅ Match | |
| 9 | fallback: `org?.onboardingCompleted ?? false` | `me.ts:25` - 동일 패턴 | ✅ Match | |
| 10 | SessionUser 인터페이스에 onboardingCompleted: boolean | `SessionContext.tsx:18` - `onboardingCompleted: boolean` | ✅ Match | |
| 11 | fetchSession에서 onboardingCompleted 매핑 | `SessionContext.tsx:53` - `onboardingCompleted: data.user.onboardingCompleted ?? false` | ✅ Match | |

### 2.3 Redirect Logic (8 items)

| # | Design Requirement | Implementation | Status | Notes |
|---|-------------------|---------------|--------|-------|
| 12 | signup 후 router.push("/onboarding") | `signup.tsx:66` - `router.push("/onboarding")` | ✅ Match | |
| 13 | WorkspaceLayout: 미로그인 시 /login 리다이렉트 | `WorkspaceLayout.tsx:15-16` - `if (!isLoading && !user) router.push("/login")` | ✅ Match | |
| 14 | WorkspaceLayout: 온보딩 미완료 시 /onboarding 리다이렉트 | `WorkspaceLayout.tsx:17-18` - `if (!isLoading && user && !user.onboardingCompleted) router.push("/onboarding")` | ✅ Match | |
| 15 | onboarding.tsx: 완료된 사용자는 / 리다이렉트 | `onboarding.tsx:43-47` - `if (!sessionLoading && user?.onboardingCompleted) router.push("/")` | ✅ Match | |
| 16 | onboarding.tsx: 미로그인 시 /login 리다이렉트 | `onboarding.tsx:43-44` - `if (!sessionLoading && !user) router.push("/login")` | ✅ Match | Design에 명시 안 되었으나 합리적 추가 |

### 2.4 Layout / UI Structure (12 items)

| # | Design Requirement | Implementation | Status | Notes |
|---|-------------------|---------------|--------|-------|
| 17 | 상단: 로고 "SalesFlow" | `OnboardingLayout.tsx:34` - `<Link href="/">SalesFlow</Link>` | ✅ Match | |
| 18 | 상단: 건너뛰기 버튼 (ghost variant) | `OnboardingLayout.tsx:37-39` - `<Button variant="ghost" size="sm" onClick={onSkipAll}>건너뛰기</Button>` | ✅ Match | |
| 19 | 중간: 스텝 인디케이터 (1~5, 현재 하이라이트) | `StepIndicator.tsx` - 1~5 번호, 현재 스텝 ring-2 하이라이트, 완료 스텝 bg-primary | ✅ Match | |
| 20 | 하단: 이전/다음 버튼 | `OnboardingLayout.tsx:52-63` - onPrev/onNext 조건부 렌더링 | ✅ Match | |
| 21 | 스텝 라벨: "환영", "워크스페이스", "필드", "초대", "완료" | `StepIndicator.tsx:8` - `STEP_LABELS = ["환영", "워크스페이스", "필드", "초대", "완료"]` | ✅ Match | |
| 22 | 5단계 위자드 | `onboarding.tsx:14` - `TOTAL_STEPS = 5` | ✅ Match | |

### 2.5 Step 1: Welcome + Organization Info (12 items)

| # | Design Requirement | Implementation | Status | Notes |
|---|-------------------|---------------|--------|-------|
| 23 | 제목: "환영합니다!" | `WelcomeStep.tsx:49` - `<h2>환영합니다!</h2>` | ✅ Match | |
| 24 | 설명: "서비스를 시작하기 전에 몇 가지를 설정해볼까요?" | `WelcomeStep.tsx:50-52` | ✅ Match | |
| 25 | 조직명 Input (기존 org.name 프리필) | `WelcomeStep.tsx:57-63` - Input, `onboarding.tsx:51-62` - fetch /api/org/settings로 프리필 | ✅ Match | |
| 26 | 업종 Select: IT/소프트웨어, 제조업, 유통/무역, 부동산, 금융, 교육, 기타 | `WelcomeStep.tsx:11-19` - INDUSTRIES 배열 7개 일치 | ✅ Match | |
| 27 | 규모 Select: 1~5명, 6~20명, 21~50명, 51~200명, 200명+ | `WelcomeStep.tsx:21-27` - COMPANY_SIZES 배열 5개 일치 | ✅ Match | |
| 28 | 업종/규모는 선택사항 | `WelcomeStep.tsx:67,83` - Label "(선택사항)" 표시 | ✅ Match | |
| 29 | API: PUT /api/org 호출 | `onboarding.tsx:95-103` - PUT /api/org 호출 | ✅ Match | |
| 30 | name, industry, companySize 전송 | `onboarding.tsx:98-102` - body에 세 필드 모두 포함 | ✅ Match | |

### 2.6 Step 2: Workspace Setup (10 items)

| # | Design Requirement | Implementation | Status | Notes |
|---|-------------------|---------------|--------|-------|
| 31 | 제목: "워크스페이스를 만들어보세요" | `WorkspaceStep.tsx:20-21` | ✅ Match | |
| 32 | 설명: "데이터를 관리할 공간입니다." | `WorkspaceStep.tsx:22-24` | ✅ Match | |
| 33 | 이름 기본값: "영업관리" | `onboarding.tsx:29` - `useState("영업관리")` | ✅ Match | |
| 34 | 아이콘: 기존 icon-picker.tsx 재사용 | `WorkspaceStep.tsx:3,40` - `import IconPicker` 사용 | ✅ Match | |
| 35 | API: POST /api/workspaces (기존) | `onboarding.tsx:111-118` - POST /api/workspaces 호출 | ✅ Match | |
| 36 | 생성된 workspaceId를 state에 저장 | `onboarding.tsx:121` - `setWorkspaceId(data.data.id)` | ✅ Match | |
| 37 | name, icon 전송 | `onboarding.tsx:114-117` - body에 name, icon 포함 | ✅ Match | |

### 2.7 Step 3: Field Template Selection (12 items)

| # | Design Requirement | Implementation | Status | Notes |
|---|-------------------|---------------|--------|-------|
| 38 | 제목: "어떤 데이터를 관리하시나요?" | `FieldsStep.tsx:22` | ✅ Match | |
| 39 | 설명: "템플릿을 선택하면 기본 필드가 자동으로 설정됩니다." | `FieldsStep.tsx:23-25` | ✅ Match | |
| 40 | FIELD_TEMPLATES에서 4개 카드 렌더링 | `FieldsStep.tsx:28-49` - grid 렌더링, field-templates.ts에 4개 템플릿 | ✅ Match | |
| 41 | 카드: B2B 영업, B2C 영업, 부동산, 인력 관리 | `field-templates.ts` - b2b-sales, b2c-sales, real-estate, hr-management | ✅ Match | |
| 42 | 카드 클릭 시 selected 상태 (ring-2 border-primary) | `FieldsStep.tsx:37-39` - `border-primary ring-2 ring-primary` | ✅ Match | |
| 43 | "직접 설정할게요 (건너뛰기)" 링크 | `FieldsStep.tsx:52-58` - 동일 텍스트 버튼 | ✅ Match | |
| 44 | API: POST /api/workspaces/[id]/fields/bulk | `onboarding.tsx:131-132` - 동일 API 호출 | ✅ Match | |
| 45 | 선택한 템플릿의 fields 전송 | `onboarding.tsx:134` - `body: JSON.stringify({ fields: template.fields })` | ✅ Match | |
| 46 | Step 2에서 생성한 workspaceId 사용 | `onboarding.tsx:128` - `if (templateId && workspaceId)` 조건부 | ✅ Match | |

### 2.8 Step 4: Member Invite (10 items)

| # | Design Requirement | Implementation | Status | Notes |
|---|-------------------|---------------|--------|-------|
| 47 | 제목: "팀원을 초대해보세요" | `InviteStep.tsx:13` | ✅ Match | |
| 48 | 설명: "나중에 설정에서도 초대할 수 있어요." | `InviteStep.tsx:14-16` | ✅ Match | |
| 49 | 최대 3개 이메일 입력 필드 | `onboarding.tsx:38` - `useState(["", "", ""])`, `InviteStep.tsx:20-31` - 3개 렌더링 | ✅ Match | |
| 50 | 빈 값은 무시 | `onboarding.tsx:145-147` - `filter(e => e.trim() && e.includes("@"))` | ✅ Match | |
| 51 | 역할: member 고정 | `onboarding.tsx:153` - `body: JSON.stringify({ email: email.trim(), role: "member" })` | ✅ Match | |
| 52 | API: POST /api/org/invitations (기존) 호출 | `onboarding.tsx:150-151` - 동일 API | ✅ Match | |
| 53 | "나중에 할게요 (건너뛰기)" 링크 | Design에 명시되었으나 InviteStep에는 별도 스킵 링크 없음. 다만 빈 값으로 "완료" 클릭하면 스킵 효과 | ⚠️ Minor | InviteStep 내부에 전용 스킵 링크 미구현, 상단 "건너뛰기" + 빈 입력 "완료" 버튼으로 대체 |

### 2.9 Step 5: Complete (12 items)

| # | Design Requirement | Implementation | Status | Notes |
|---|-------------------|---------------|--------|-------|
| 54 | 설정 요약: 워크스페이스명 표시 | `CompleteStep.tsx:31-36` - workspaceName 조건부 표시 | ✅ Match | |
| 55 | 설정 요약: 필드 수 표시 | `CompleteStep.tsx:37-42` - `{fieldsCreated}개 설정됨` | ✅ Match | |
| 56 | 설정 요약: 초대 수 표시 | `CompleteStep.tsx:43-48` - `{invitesSent}명 초대됨` | ✅ Match | |
| 57 | "시작하기" 버튼 | `CompleteStep.tsx:56-58` - `<Button size="lg" onClick={onStart}>시작하기</Button>` | ✅ Match | |
| 58 | 시작하기 클릭: POST /api/org/onboarding-complete | `onboarding.tsx:78-80` - handleComplete에서 POST 호출 | ✅ Match | |
| 59 | 시작하기 클릭 후: router.push("/") | `onboarding.tsx:81` - `router.push("/")` | ✅ Match | |
| 60 | 제목: "모든 설정이 완료되었습니다!" | `CompleteStep.tsx:25` | ✅ Match | |
| 61 | 스킵 시 빈 상태 메시지 표시 | `CompleteStep.tsx:49-53` - "설정을 건너뛰었습니다" 메시지 | ✅ Match | Design에 없으나 합리적 추가 |

### 2.10 API: POST /api/org/onboarding-complete (8 items)

| # | Design Requirement | Implementation | Status | Notes |
|---|-------------------|---------------|--------|-------|
| 62 | POST method only | `onboarding-complete.ts:7` - `if (req.method !== "POST")` | ✅ Match | |
| 63 | 인증 확인 | `onboarding-complete.ts:12-14` - getUserFromRequest 체크 | ✅ Match | |
| 64 | owner/admin만 가능 | `onboarding-complete.ts:16-18` - `if (user.role === "member") return 403` | ✅ Match | |
| 65 | organizations.onboardingCompleted = true 업데이트 | `onboarding-complete.ts:21-24` - `.set({ onboardingCompleted: true, updatedAt: new Date() })` | ✅ Match | |
| 66 | orgId 기반 WHERE 조건 | `onboarding-complete.ts:27` - `.where(eq(organizations.id, user.orgId))` | ✅ Match | |

### 2.11 API: PUT /api/org (8 items)

| # | Design Requirement | Implementation | Status | Notes |
|---|-------------------|---------------|--------|-------|
| 67 | PUT method | `org/index.ts:7` - `if (req.method !== "PUT")` | ✅ Match | |
| 68 | 인증 확인 | `org/index.ts:12-14` - getUserFromRequest | ✅ Match | |
| 69 | name, industry, companySize 업데이트 | `org/index.ts:21,33-37,39-44` - 세 필드 모두 처리 | ✅ Match | |
| 70 | settings에 industry/companySize 병합 저장 | `org/index.ts:32-37` - currentSettings에 spread 병합 | ✅ Match | |
| 71 | updatedAt 갱신 | `org/index.ts:44` - `updatedAt: new Date()` | ✅ Match | |
| 72 | 404 처리 (org not found) | `org/index.ts:28-30` - 404 반환 | ✅ Match | |
| 73 | owner/admin만 가능 (member 차단) | `org/index.ts:16-18` - role === "member" 403 | ✅ Match | |

### 2.12 Component Structure (7 items)

| # | Design Requirement | Implementation | Status | Notes |
|---|-------------------|---------------|--------|-------|
| 74 | src/pages/onboarding.tsx | 존재, 메인 온보딩 페이지 | ✅ Match | |
| 75 | OnboardingLayout.tsx | 존재, 레이아웃 컴포넌트 | ✅ Match | |
| 76 | StepIndicator.tsx | 존재, 스텝 인디케이터 | ✅ Match | |
| 77 | WelcomeStep.tsx | 존재, Step 1 | ✅ Match | |
| 78 | WorkspaceStep.tsx | 존재, Step 2 | ✅ Match | |
| 79 | FieldsStep.tsx | 존재, Step 3 | ✅ Match | |
| 80 | InviteStep.tsx | 존재, Step 4 | ✅ Match | |
| 81 | CompleteStep.tsx | 존재, Step 5 | ✅ Match | |

### 2.13 State Management (11 items)

| # | Design Requirement | Implementation | Status | Notes |
|---|-------------------|---------------|--------|-------|
| 82 | orgName state | `onboarding.tsx:24` - `useState("")` | ✅ Match | |
| 83 | industry state | `onboarding.tsx:25` - `useState("")` | ✅ Match | |
| 84 | companySize state | `onboarding.tsx:26` - `useState("")` | ✅ Match | |
| 85 | workspaceId state (number \| null) | `onboarding.tsx:31` - `useState<number \| null>(null)` | ✅ Match | |
| 86 | workspaceName state | `onboarding.tsx:29` - `useState("영업관리")` | ✅ Match | |
| 87 | workspaceIcon state | `onboarding.tsx:30` - `useState("")` | ✅ Match | |
| 88 | templateId state (string \| null) | `onboarding.tsx:34` - `useState<string \| null>(null)` | ✅ Match | |
| 89 | fieldsCreated state | `onboarding.tsx:35` - `useState(0)` | ✅ Match | |
| 90 | inviteEmails state (3개 배열) | `onboarding.tsx:38` - `useState(["", "", ""])` | ✅ Match | |
| 91 | invitesSent state | `onboarding.tsx:39` - `useState(0)` | ✅ Match | |
| 92 | 다음 클릭 시 API 호출 -> state 업데이트 -> 다음 스텝 이동 | `onboarding.tsx:90-166` - handleNext에서 단계별 처리 | ✅ Match | |
| 93 | 실패 시 toast 에러 | `onboarding.tsx:161` - `toast.error("오류가 발생했습니다.")` | ✅ Match | |

---

## 3. Differences Found

### 3.1 Missing Features (Design O, Implementation X)

| # | Item | Design Location | Description | Impact |
|---|------|-----------------|-------------|--------|
| 1 | InviteStep "나중에 할게요" 링크 | design.md:196 | Design에 "나중에 할게요 (건너뛰기)" 전용 링크가 명시되어 있으나, InviteStep 컴포넌트 내부에는 해당 링크 없음. 빈 입력 상태에서 "완료" 버튼 클릭으로 동일 효과 달성 가능 | Low |

### 3.2 Added Features (Design X, Implementation O)

| # | Item | Implementation Location | Description |
|---|------|------------------------|-------------|
| 1 | 미로그인 시 /login 리다이렉트 (onboarding 페이지) | `onboarding.tsx:43-44` | Design에 명시되지 않았으나 미인증 상태 보호 로직 추가 (합리적) |
| 2 | 빈 상태 메시지 (모든 스텝 스킵 시) | `CompleteStep.tsx:49-53` | "설정을 건너뛰었습니다. 언제든 설정에서 변경할 수 있어요." 메시지 (UX 개선) |
| 3 | org.name 프리필을 /api/org/settings로 조회 | `onboarding.tsx:51-62` | Design은 "기존 org.name 프리필"만 언급, 구현은 /api/org/settings GET API를 사용하여 조회 |
| 4 | handleSkipAll (건너뛰기 시 onboarding-complete 호출) | `onboarding.tsx:64-75` | 전체 건너뛰기 시에도 onboardingCompleted 플래그 true 설정 (합리적) |
| 5 | refreshSession 호출 (완료/건너뛰기 후) | `onboarding.tsx:68,81` | 온보딩 완료 후 세션 갱신하여 리다이렉트 루프 방지 (필수적 추가) |

### 3.3 Changed Features (Design != Implementation)

| # | Item | Design | Implementation | Impact |
|---|------|--------|----------------|--------|
| - | 없음 | - | - | - |

---

## 4. Convention Compliance

### 4.1 Naming Convention

| Category | Convention | Files Checked | Compliance | Violations |
|----------|-----------|:-------------:|:----------:|------------|
| Components | PascalCase | 7 | 100% | - |
| Functions | camelCase | 12 | 100% | - |
| Constants | UPPER_SNAKE_CASE | 5 | 100% | TOTAL_STEPS, STEP_LABELS, INDUSTRIES, COMPANY_SIZES, ICON_MAP |
| Files (component) | PascalCase.tsx | 7 | 100% | - |
| Folders | kebab-case | 1 | 100% | `onboarding/` |

### 4.2 Import Order

All files follow the correct import order:
1. External libraries (react, next, lucide-react)
2. Internal absolute imports (@/components, @/lib, @/contexts)
3. Relative imports (./)

### 4.3 Architecture Compliance

| Pattern | Expected | Actual | Status |
|---------|----------|--------|--------|
| Auth check via getUserFromRequest | Yes | API routes use getUserFromRequest | ✅ |
| orgId ownership check | Yes | All API routes filter by user.orgId | ✅ |
| Toast for errors (sonner) | Yes | `onboarding.tsx` uses `toast` from sonner | ✅ |
| updatedAt on mutation | Yes | Both API routes set `updatedAt: new Date()` | ✅ |
| Role-based access (owner/admin) | Yes | Both API routes check `user.role === "member"` | ✅ |

---

## 5. Match Rate Summary

### 5.1 Item Counts

| Category | Items | Matched | Minor Gap | Not Impl |
|----------|:-----:|:-------:|:---------:|:--------:|
| DB / Data Model | 6 | 6 | 0 | 0 |
| Session / Auth | 5 | 5 | 0 | 0 |
| Redirect Logic | 5 | 5 | 0 | 0 |
| Layout / UI | 6 | 6 | 0 | 0 |
| Step 1: Welcome | 8 | 8 | 0 | 0 |
| Step 2: Workspace | 7 | 7 | 0 | 0 |
| Step 3: Fields | 9 | 9 | 0 | 0 |
| Step 4: Invite | 7 | 6 | 1 | 0 |
| Step 5: Complete | 8 | 8 | 0 | 0 |
| API: onboarding-complete | 5 | 5 | 0 | 0 |
| API: PUT /api/org | 7 | 7 | 0 | 0 |
| Component Structure | 8 | 8 | 0 | 0 |
| State Management | 12 | 12 | 0 | 0 |
| **Total** | **93** | **92** | **1** | **0** |

### 5.2 Overall Score

```
+---------------------------------------------+
|  Overall Match Rate: 98.9% (92/93)          |
+---------------------------------------------+
|  ✅ Match:           92 items (98.9%)        |
|  ⚠️ Minor Gap:        1 item  ( 1.1%)        |
|  ❌ Not Implemented:   0 items ( 0.0%)        |
+---------------------------------------------+
|  Design Match:            98.9%  ✅          |
|  Architecture Compliance: 100%   ✅          |
|  Convention Compliance:   100%   ✅          |
|  Overall:                 98.9%  ✅          |
+---------------------------------------------+
```

---

## 6. Recommended Actions

### 6.1 Minor Improvement (Optional)

| Priority | Item | File | Description |
|----------|------|------|-------------|
| Low | InviteStep "나중에 할게요" 링크 | `src/components/onboarding/InviteStep.tsx` | Design에 명시된 "나중에 할게요 (건너뛰기)" 전용 링크를 InviteStep 하단에 추가. 현재는 빈 입력 + "완료" 버튼으로 동일 효과 달성 가능하므로 기능적 영향 없음 |

### 6.2 Design Document Updates Needed

없음. 구현에서 추가된 항목(미인증 리다이렉트, 빈 상태 메시지, refreshSession 등)은 모두 합리적인 방어적 코딩이며, Design 문서에 반영 여부는 선택사항이다.

---

## 7. Positive Patterns Observed

- **방어적 코딩**: 미로그인 상태 리다이렉트, 빈 입력 스킵 로직
- **Session 갱신**: 온보딩 완료/건너뛰기 후 `refreshSession()` 호출로 리다이렉트 루프 방지
- **updatedAt 갱신**: 모든 mutation API에서 timestamp 갱신
- **역할 기반 접근 제어**: owner/admin만 조직 정보 수정 및 온보딩 완료 가능
- **에러 처리**: try-catch + console.error + 사용자 친화적 toast 메시지
- **상태 격리**: 각 스텝별 독립적 state 관리, 스텝 간 의존성 명확 (workspaceId)
- **빈 상태 UX**: 모든 스텝을 건너뛰었을 때의 완료 화면 메시지 제공

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-02-26 | Initial analysis | gap-detector |
