# UX Polish Design Document

> **Summary**: 서비스명 SalesFlow 통일, 로그인→랜딩 네비게이션, CTA 섹션 추가
>
> **Feature**: ux-polish
> **Date**: 2026-02-26
> **Status**: Draft
> **Plan Reference**: `docs/01-plan/features/ux-polish.plan.md`

---

## 1. 서비스명 통일 (Sales Manager → SalesFlow)

### 1.1 변경 목록 (10곳)

| # | 파일 | 라인 | 현재 값 | 변경 값 |
|---|------|------|---------|---------|
| 1 | `src/pages/_app.tsx` | L14 | `<title>Sales Manager</title>` | `<title>SalesFlow</title>` |
| 2 | `src/pages/login.tsx` | L54 | `<div className="text-xl font-bold">Sales Manager</div>` | `<Link href="/" className="text-xl font-bold text-primary-foreground hover:opacity-80">SalesFlow</Link>` |
| 3 | `src/pages/login.tsx` | L66 | `© 2026 Sales Manager. All rights reserved.` | `© 2026 SalesFlow. All rights reserved.` |
| 4 | `src/pages/signup.tsx` | L81 | `<div className="text-xl font-bold">Sales Manager</div>` | `<Link href="/" className="text-xl font-bold text-primary-foreground hover:opacity-80">SalesFlow</Link>` |
| 5 | `src/pages/signup.tsx` | L93 | `© 2026 Sales Manager. All rights reserved.` | `© 2026 SalesFlow. All rights reserved.` |
| 6 | `src/components/dashboard/sidebar.tsx` | L128 | `collapsed ? "SM" : "Sales Manager"` | `collapsed ? "SF" : "SalesFlow"` |
| 7 | `src/components/dashboard/sidebar.tsx` | L179 | `Sales Manager` | `SalesFlow` |
| 8 | `src/components/email/EmailConfigForm.tsx` | L113 | `placeholder="Sales Manager"` | `placeholder="SalesFlow"` |
| 9 | `src/components/products/ProductDialog.tsx` | L144 | `placeholder="예: Sales Manager Pro"` | `placeholder="예: SalesFlow Pro"` |
| 10 | `src/components/products/ProductEditor.tsx` | L136 | `placeholder="예: Sales Manager Pro"` | `placeholder="예: SalesFlow Pro"` |

### 1.2 import 추가 필요

| 파일 | 추가 import |
|------|-------------|
| `src/pages/login.tsx` | `import Link from "next/link";` (이미 있음 - 확인 필요) |
| `src/pages/signup.tsx` | `import Link from "next/link";` (이미 있음) |

---

## 2. 로그인/회원가입 → 랜딩 네비게이션

### 2.1 login.tsx 변경

**현재** (L53-54):
```tsx
<div className="text-xl font-bold">Sales Manager</div>
```

**변경 후**:
```tsx
<Link href="/" className="text-xl font-bold text-primary-foreground hover:opacity-80">
    SalesFlow
</Link>
```

- `<div>` → `<Link href="/">` 변경
- 서비스명도 동시에 변경
- `text-primary-foreground` 유지, `hover:opacity-80` 추가

### 2.2 signup.tsx 변경

login.tsx와 동일한 패턴 (L80-81)

---

## 3. 랜딩페이지 CTA 섹션

### 3.1 새 컴포넌트: `src/components/landing/CtaSection.tsx`

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function CtaSection() {
    return (
        <section className="py-20 px-4">
            <div className="container mx-auto text-center">
                <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                    영업 성과를 높일 준비가 되셨나요?
                </h2>
                <p className="mt-4 text-lg text-muted-foreground">
                    지금 무료로 시작하세요. 신용카드 없이 바로 사용할 수 있습니다.
                </p>
                <div className="mt-8 flex items-center justify-center gap-4">
                    <Button size="lg" asChild>
                        <Link href="/signup">무료로 시작하기</Link>
                    </Button>
                    <Button size="lg" variant="outline" asChild>
                        <Link href="/login">로그인</Link>
                    </Button>
                </div>
            </div>
        </section>
    );
}
```

### 3.2 LandingPage.tsx 수정

```tsx
import CtaSection from "./CtaSection";

// <PricingSection /> 아래에 추가:
<CtaSection />
```

---

## 4. 구현 순서

| # | 작업 | 파일 | 검증 |
|---|------|------|------|
| 1 | 서비스명 통일 | _app.tsx, sidebar.tsx, EmailConfigForm, ProductDialog, ProductEditor | grep "Sales Manager" = 0 |
| 2 | 로그인/회원가입 네비게이션 + 서비스명 | login.tsx, signup.tsx | 로고 클릭 → `/` 이동 |
| 3 | CTA 섹션 추가 | CtaSection.tsx (신규), LandingPage.tsx | 랜딩 6개 섹션 확인 |
| 4 | 빌드 검증 | - | `pnpm build` 성공 |

---

## 5. 검증 기준

- [ ] `grep -r "Sales Manager" src/` 결과 0건
- [ ] 로그인 페이지 좌측 패널 로고 클릭 → `/` 이동
- [ ] 회원가입 페이지 좌측 패널 로고 클릭 → `/` 이동
- [ ] 랜딩페이지: Header → Hero → Features → Pricing → CTA → Footer 순서
- [ ] CTA 섹션에 "무료로 시작하기" → `/signup`, "로그인" → `/login` 링크
- [ ] 사이드바 접힌 상태 "SF" 표시
- [ ] `pnpm build` 성공
