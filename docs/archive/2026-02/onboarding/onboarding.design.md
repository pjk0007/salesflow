# Design: onboarding (유저 시작 프로세스 안내)

## 1. DB 변경

### organizations 테이블 — onboardingCompleted 컬럼

```typescript
// src/lib/db/schema.ts — organizations 테이블에 추가
import { boolean } from "drizzle-orm/pg-core";

onboardingCompleted: boolean("onboarding_completed").default(false).notNull(),
```

### 마이그레이션

```sql
-- drizzle/0025_onboarding.sql
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "onboarding_completed" boolean DEFAULT false NOT NULL;
```

## 2. SessionContext 확장

`/api/auth/me` 응답에 `onboardingCompleted` 필드를 추가하여 클라이언트에서 분기.

```typescript
// src/pages/api/auth/me.ts — 응답에 onboardingCompleted 포함
const [org] = await db
    .select({ onboardingCompleted: organizations.onboardingCompleted })
    .from(organizations)
    .where(eq(organizations.id, user.orgId));

return res.status(200).json({
    success: true,
    user: { ...user, onboardingCompleted: org?.onboardingCompleted ?? false },
});
```

```typescript
// src/contexts/SessionContext.tsx — SessionUser에 추가
interface SessionUser {
    // ...기존 필드
    onboardingCompleted: boolean;
}

// fetchSession에서 매핑 추가
onboardingCompleted: data.user.onboardingCompleted,
```

## 3. 리다이렉트 로직

### 3-1. signup.tsx — 가입 후 /onboarding으로 이동

```typescript
// 변경: router.push("/") → router.push("/onboarding")
if (data.success) {
    await refreshSession();
    router.push("/onboarding");
}
```

### 3-2. WorkspaceLayout.tsx — 온보딩 미완료 시 리다이렉트

```typescript
useEffect(() => {
    if (!isLoading && !user) {
        router.push("/login");
    } else if (!isLoading && user && !user.onboardingCompleted) {
        router.push("/onboarding");
    }
}, [isLoading, user, router]);
```

### 3-3. onboarding.tsx — 온보딩 완료된 사용자는 /로 리다이렉트

```typescript
// 이미 완료된 경우 대시보드로 보내기
useEffect(() => {
    if (!isLoading && user?.onboardingCompleted) {
        router.push("/");
    }
}, [isLoading, user, router]);
```

## 4. 온보딩 페이지 — 5단계 위자드

### 4-0. 레이아웃

```
┌─────────────────────────────────────────────────┐
│  SalesFlow                        [건너뛰기]    │
├─────────────────────────────────────────────────┤
│                                                 │
│           ● ─ ● ─ ○ ─ ○ ─ ○                   │
│           1   2   3   4   5                     │
│                                                 │
│  ┌───────────────────────────────────────┐      │
│  │                                       │      │
│  │         현재 스텝 컴포넌트            │      │
│  │                                       │      │
│  └───────────────────────────────────────┘      │
│                                                 │
│              [이전]    [다음]                    │
│                                                 │
└─────────────────────────────────────────────────┘
```

- 상단: 로고 + 전체 건너뛰기 버튼 (ghost)
- 중간: 스텝 인디케이터 (1~5, 현재 하이라이트)
- 하단: 이전/다음 버튼

### 4-1. Step 1: 환영 + 조직 정보

```
┌───────────────────────────────────┐
│  🎉 환영합니다!                    │
│  서비스를 시작하기 전에            │
│  몇 가지를 설정해볼까요?          │
│                                   │
│  조직 이름: [██████████████]      │
│  (가입 시 입력한 값 기본)         │
│                                   │
│  업종:  [선택 ▾]  (선택사항)      │
│  규모:  [선택 ▾]  (선택사항)      │
└───────────────────────────────────┘
```

- 조직명: 기존 org.name 프리필
- 업종: select (IT/소프트웨어, 제조업, 유통/무역, 부동산, 금융, 교육, 기타)
- 규모: select (1~5명, 6~20명, 21~50명, 51~200명, 200명+)
- 업종/규모는 `organizations.settings.industry`, `organizations.settings.companySize`에 저장
- API: `PUT /api/org` (기존 조직 수정 API 재사용 또는 신규)

### 4-2. Step 2: 워크스페이스 설정

```
┌───────────────────────────────────┐
│  워크스페이스를 만들어보세요       │
│  데이터를 관리할 공간입니다.      │
│                                   │
│  이름: [영업관리          ]       │
│  아이콘: [📊 선택]  (IconPicker)  │
│                                   │
└───────────────────────────────────┘
```

- 이름 기본값: "영업관리"
- 아이콘: 기존 `icon-picker.tsx` 재사용
- API: `POST /api/workspaces` (기존)
- 생성된 workspaceId를 state에 저장 (Step 3에서 사용)

### 4-3. Step 3: 필드 설정 (템플릿 선택)

```
┌───────────────────────────────────┐
│  어떤 데이터를 관리하시나요?      │
│  템플릿을 선택하면 기본 필드가    │
│  자동으로 설정됩니다.             │
│                                   │
│  ┌────────┐ ┌────────┐           │
│  │ B2B    │ │ B2C    │           │
│  │ 영업   │ │ 영업   │           │
│  └────────┘ └────────┘           │
│  ┌────────┐ ┌────────┐           │
│  │ 부동산 │ │ 인력   │           │
│  │        │ │ 관리   │           │
│  └────────┘ └────────┘           │
│                                   │
│  [직접 설정할게요 (건너뛰기)]     │
└───────────────────────────────────┘
```

- `FIELD_TEMPLATES` 배열에서 4개 카드 렌더링
- 카드 클릭 시 selected 상태 (ring-2 border-primary)
- "직접 설정할게요" 링크: 스킵하고 다음 단계
- API: `POST /api/workspaces/[id]/fields/bulk` (기존) — 선택한 템플릿의 fields 전송
- Step 2에서 생성한 workspaceId 필요 → Step 2 미완료면 이 단계 비활성

### 4-4. Step 4: 멤버 초대

```
┌───────────────────────────────────┐
│  팀원을 초대해보세요              │
│  나중에 설정에서도 초대할 수 있어요│
│                                   │
│  이메일 1: [                  ]   │
│  이메일 2: [                  ]   │
│  이메일 3: [                  ]   │
│                                   │
│  [나중에 할게요 (건너뛰기)]       │
└───────────────────────────────────┘
```

- 최대 3개 이메일 입력 필드 (빈 값은 무시)
- 역할: member 고정 (온보딩에서는 간단하게)
- API: `POST /api/org/invitations` (기존) × 유효한 이메일 수
- "나중에 할게요" 링크

### 4-5. Step 5: 완료

```
┌───────────────────────────────────┐
│                                   │
│           🎉                      │
│     모든 설정이 완료되었습니다!   │
│                                   │
│   워크스페이스: 영업관리          │
│   필드: 9개 설정됨               │
│   초대: 2명 초대됨               │
│                                   │
│        [시작하기 →]               │
│                                   │
└───────────────────────────────────┘
```

- 설정 요약 표시 (워크스페이스명, 필드 수, 초대 수)
- "시작하기" 버튼: `POST /api/org/onboarding-complete` → `router.push("/")`

## 5. API 신규

### POST /api/org/onboarding-complete

```typescript
// src/pages/api/org/onboarding-complete.ts
// 인증 확인 → organizations.onboardingCompleted = true 업데이트
// owner/admin만 가능
```

### PUT /api/org (조직 정보 수정 — Step 1용)

기존에 없으면 신규 생성. organizations 테이블의 name, settings(industry, companySize) 업데이트.

```typescript
// src/pages/api/org/index.ts
// PUT: 조직 정보 수정 (name, settings)
```

## 6. 컴포넌트 구조

```
src/pages/onboarding.tsx              — 메인 온보딩 페이지
src/components/onboarding/
  ├── OnboardingLayout.tsx            — 레이아웃 (로고 + 건너뛰기 + 스텝바)
  ├── StepIndicator.tsx               — 스텝 인디케이터 (1~5)
  ├── WelcomeStep.tsx                 — Step 1: 환영 + 조직 정보
  ├── WorkspaceStep.tsx               — Step 2: 워크스페이스 생성
  ├── FieldsStep.tsx                  — Step 3: 필드 템플릿 선택
  ├── InviteStep.tsx                  — Step 4: 멤버 초대
  └── CompleteStep.tsx                — Step 5: 완료
```

## 7. 상태 관리

온보딩 페이지 내부에서 `useState`로 관리:

```typescript
interface OnboardingState {
    orgName: string;
    industry: string;      // 선택사항
    companySize: string;    // 선택사항
    workspaceId: number | null;
    workspaceName: string;
    workspaceIcon: string;
    templateId: string | null;
    fieldsCreated: number;
    inviteEmails: string[];
    invitesSent: number;
}
```

각 스텝에서 "다음" 클릭 시:
1. 해당 스텝의 API 호출 (있는 경우)
2. 성공 시 state 업데이트 + 다음 스텝 이동
3. 실패 시 toast 에러

## 8. 구현 순서

| # | 파일 | 작업 | 검증 |
|---|------|------|------|
| 1 | `src/lib/db/schema.ts` | onboardingCompleted 컬럼 추가 | 타입 에러 없음 |
| 2 | `drizzle/0025_onboarding.sql` | 마이그레이션 SQL | psql 실행 |
| 3 | `src/pages/api/auth/me.ts` | onboardingCompleted 응답 추가 | 타입 에러 없음 |
| 4 | `src/contexts/SessionContext.tsx` | SessionUser에 onboardingCompleted 추가 | 타입 에러 없음 |
| 5 | `src/pages/api/org/index.ts` | PUT 조직 수정 API | 타입 에러 없음 |
| 6 | `src/pages/api/org/onboarding-complete.ts` | 온보딩 완료 API | 타입 에러 없음 |
| 7 | `src/components/onboarding/*.tsx` | 6개 컴포넌트 | 타입 에러 없음 |
| 8 | `src/pages/onboarding.tsx` | 온보딩 페이지 | 타입 에러 없음 |
| 9 | `src/pages/signup.tsx` | 리다이렉트 /onboarding 변경 | 타입 에러 없음 |
| 10 | `src/components/layouts/WorkspaceLayout.tsx` | 온보딩 미완료 리다이렉트 | 타입 에러 없음 |
| 11 | `pnpm build` | 최종 빌드 검증 | 빌드 성공 |
