# Design: landing-page (랜딩 페이지)

## 1. 라우팅 설계

### index.tsx 인증 분기 (Option A)

`useSession()` 훅으로 분기. WorkspaceLayout을 조건부로 사용.

```typescript
// src/pages/index.tsx
import { useSession } from "@/contexts/SessionContext";

export default function HomePage() {
    const { user, isLoading } = useSession();

    if (isLoading) return <LoadingScreen />;
    if (!user) return <LandingPage />;

    return (
        <WorkspaceLayout>
            <HomeDashboard />
        </WorkspaceLayout>
    );
}
```

- `isLoading` 중: 로딩 스피너 (깜빡임 방지)
- `!user`: 랜딩 페이지 렌더
- `user`: 기존 대시보드 (WorkspaceLayout 포함)

## 2. 컴포넌트 구조

```
src/pages/index.tsx          — 인증 분기 (landing vs dashboard)
src/components/landing/
  ├── LandingPage.tsx        — 전체 랜딩 페이지 조합
  ├── LandingHeader.tsx      — 상단 네비게이션 (로고 + 로그인/가입)
  ├── HeroSection.tsx        — 히어로 영역
  ├── FeaturesSection.tsx    — 기능 소개 4개 카드
  ├── PricingSection.tsx     — 요금제 3단계
  └── LandingFooter.tsx      — 푸터
```

## 3. 각 섹션 상세 설계

### 3-1. LandingHeader

```
┌─────────────────────────────────────────────┐
│  SalesFlow           [로그인]  [무료 시작]   │
└─────────────────────────────────────────────┘
```

- 좌측: 서비스 로고/이름 ("SalesFlow")
- 우측: 로그인 (ghost button → /login) + 무료로 시작하기 (primary → /signup)
- `sticky top-0` 고정 헤더
- 모바일: 동일 레이아웃 (간결하므로 햄버거 불필요)

### 3-2. HeroSection

```
┌─────────────────────────────────────────────┐
│                                             │
│     영업의 모든 것을 한 곳에서              │
│     고객 관리부터 자동화까지,               │
│     AI가 함께하는 스마트 영업 플랫폼        │
│                                             │
│     [무료로 시작하기]   [자세히 알아보기]    │
│                                             │
└─────────────────────────────────────────────┘
```

- 중앙 정렬, 큰 타이포그래피
- 메인 CTA: "무료로 시작하기" → `/signup` (primary)
- 서브 CTA: "자세히 알아보기" → 스크롤 to features (outline)
- 배경: gradient 또는 subtle pattern
- `min-h-[80vh]` 풀 뷰포트 높이감

### 3-3. FeaturesSection

4개 카드 그리드 (`grid-cols-1 md:grid-cols-2 lg:grid-cols-4`):

| 아이콘 | 제목 | 설명 |
|--------|------|------|
| Users | 고객 관리 | 고객 정보를 체계적으로 관리하고 영업 기회를 놓치지 마세요 |
| BarChart3 | 대시보드 | 실시간 데이터 시각화로 영업 현황을 한눈에 파악하세요 |
| Mail | 자동화 | 이메일, 알림톡을 자동으로 발송하고 업무 효율을 높이세요 |
| Sparkles | AI 도우미 | AI가 이메일 작성, 기업 조사, 대시보드 설계를 도와줍니다 |

- 각 카드: 아이콘 (lucide-react) + 제목 + 설명 2줄
- 호버 효과: `hover:shadow-lg transition`

### 3-4. PricingSection

3개 요금제 카드 (`grid-cols-1 md:grid-cols-3`):

**Free**:
- 가격: 무료
- 기능: 워크스페이스 1개, 레코드 500건, 멤버 2명, 기본 대시보드
- CTA: "무료로 시작" → /signup

**Pro** (추천 배지):
- 가격: ₩29,000/월
- 기능: 워크스페이스 3개, 레코드 10,000건, 멤버 10명, AI 기능, 이메일/알림톡 자동화
- CTA: "Pro 시작하기" → /signup
- 테두리 강조 (`border-primary ring-2`)

**Enterprise**:
- 가격: ₩99,000/월
- 기능: 무제한 워크스페이스, 무제한 레코드, 무제한 멤버, 우선 지원, 전용 온보딩
- CTA: "문의하기" → /signup

각 카드: 요금제명 + 가격 + 기능 목록 (Check 아이콘) + CTA 버튼

### 3-5. LandingFooter

```
┌─────────────────────────────────────────────┐
│  SalesFlow                                  │
│  스마트 영업 관리 플랫폼                    │
│                                             │
│  이용약관  |  개인정보처리방침  |  문의      │
│  © 2026 SalesFlow. All rights reserved.     │
└─────────────────────────────────────────────┘
```

- 배경: `bg-muted`
- 간결한 1단 레이아웃

## 4. SEO 메타태그

```typescript
// index.tsx Head 태그 (user가 없을 때)
<Head>
    <title>SalesFlow - 스마트 영업 관리 플랫폼</title>
    <meta name="description" content="고객 관리부터 이메일 자동화, AI 도우미까지. 영업의 모든 것을 한 곳에서 관리하세요." />
    <meta property="og:title" content="SalesFlow - 스마트 영업 관리 플랫폼" />
    <meta property="og:description" content="고객 관리부터 이메일 자동화, AI 도우미까지." />
    <meta property="og:type" content="website" />
</Head>
```

## 5. 구현 순서

| # | 파일 | 작업 | 검증 |
|---|------|------|------|
| 1 | `src/components/landing/LandingPage.tsx` | 전체 조합 컴포넌트 | 타입 에러 없음 |
| 2 | `src/components/landing/LandingHeader.tsx` | 헤더 (로고 + 버튼) | 타입 에러 없음 |
| 3 | `src/components/landing/HeroSection.tsx` | 히어로 (카피 + CTA) | 타입 에러 없음 |
| 4 | `src/components/landing/FeaturesSection.tsx` | 기능 4카드 그리드 | 타입 에러 없음 |
| 5 | `src/components/landing/PricingSection.tsx` | 요금제 3카드 | 타입 에러 없음 |
| 6 | `src/components/landing/LandingFooter.tsx` | 푸터 | 타입 에러 없음 |
| 7 | `src/pages/index.tsx` | 인증 분기 + Head SEO | `pnpm build` 성공 |
