# landing-page-v2 Design Document

> **Summary**: adion 수준의 프로페셔널 랜딩페이지 전면 리디자인 (12개 컴포넌트)
>
> **Plan Reference**: `docs/01-plan/features/landing-page-v2.plan.md`
> **Date**: 2026-02-27
> **Status**: Draft

---

## 1. 파일 변경 총괄

| # | 파일 | 상태 | 예상 LOC |
|---|------|------|----------|
| 1 | `src/styles/globals.css` | 수정 (키프레임 추가) | +15 |
| 2 | `src/components/landing/AnimateOnScroll.tsx` | 신규 | ~35 |
| 3 | `src/components/landing/LandingNavbar.tsx` | 신규 (LandingHeader 교체) | ~80 |
| 4 | `src/components/landing/HeroSection.tsx` | 교체 | ~130 |
| 5 | `src/components/landing/SocialProofSection.tsx` | 신규 | ~150 |
| 6 | `src/components/landing/ProductPreviewSection.tsx` | 신규 | ~160 |
| 7 | `src/components/landing/HowItWorksSection.tsx` | 신규 | ~70 |
| 8 | `src/components/landing/FeaturesSection.tsx` | 교체 | ~80 |
| 9 | `src/components/landing/PricingSection.tsx` | 교체 | ~130 |
| 10 | `src/components/landing/FaqSection.tsx` | 신규 | ~90 |
| 11 | `src/components/landing/CtaSection.tsx` | 교체 | ~40 |
| 12 | `src/components/landing/LandingFooter.tsx` | 교체 | ~60 |
| 13 | `src/components/landing/LandingPage.tsx` | 수정 (섹션 구성) | ~25 |
| - | `src/components/landing/LandingHeader.tsx` | 삭제 | - |
| | **합계** | | **~1,065** |

---

## 2. CSS 키프레임 (`src/styles/globals.css`)

`@layer base` 블록 뒤에 추가:

```css
@keyframes fade-slide-up {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
}

@keyframes marquee {
    from { transform: translateX(0); }
    to { transform: translateX(-50%); }
}

.animate-fade-slide-up {
    animation: fade-slide-up 0.8s ease-out both;
}

.animate-marquee {
    animation: marquee 30s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
    .animate-fade-slide-up,
    .animate-marquee {
        animation: none !important;
        opacity: 1 !important;
        transform: none !important;
    }
}
```

---

## 3. 컴포넌트 상세 설계

### 3.1 AnimateOnScroll.tsx (신규 유틸리티)

IntersectionObserver 기반 스크롤 진입 애니메이션 래퍼.

```tsx
interface Props {
    children: ReactNode;
    className?: string;
    delay?: number; // stagger delay in ms (0, 100, 200...)
}
```

- `useRef` + `useEffect`로 IntersectionObserver 생성
- threshold: 0.1, rootMargin: "0px 0px -60px 0px"
- 진입 시 `opacity: 1, translateY(0)` 트랜지션 적용
- `triggerOnce: true` (한 번만 애니메이션)
- 초기 상태: `opacity: 0, translateY(20px)`
- 전환: `transition-all duration-700 ease-out`
- delay prop으로 stagger 지원: `transition-delay: ${delay}ms`

### 3.2 LandingNavbar.tsx (LandingHeader 교체)

```
Header (sticky, backdrop-blur, z-50)
├── Logo "SalesFlow" (Link href="/")
├── Desktop Nav (hidden lg:flex)
│   ├── 기능 (anchor #features, smooth scroll)
│   ├── 요금 (anchor #pricing)
│   └── FAQ (anchor #faq)
├── Desktop CTA
│   ├── 로그인 (ghost button → /login)
│   └── 무료로 시작하기 (default button → /signup)
└── Mobile Menu (lg:hidden)
    └── Sheet (side="right")
        ├── Nav links (기능, 요금, FAQ)
        ├── 로그인 Button
        └── 무료로 시작하기 Button
```

- 스크롤 감지: `useEffect` + `scroll` event, scrollY > 50 → `shadow-sm` + `bg-background/95`
- `scroll-behavior: smooth`는 html 태그에 적용 (globals.css에 추가)

### 3.3 HeroSection.tsx (교체)

```
Section (py-20 lg:py-28, container)
├── AnimateOnScroll
│   ├── Badge (animate-ping dot + "영업 자동화 플랫폼")
│   ├── h1: "영업의 모든 것을 / 한 곳에서 관리하세요"
│   ├── p: 서브카피
│   ├── CTA 버튼 2개 (무료로 시작하기 + 자세히 알아보기)
│   └── Trust text: "신용카드 없이 무료로 시작 · 설정 5분"
└── AnimateOnScroll (delay=200)
    └── Dashboard Mockup (HTML/CSS 렌더링)
        ├── Header bar (dots + title)
        ├── Stats row (3개 KPI 카드: 신규고객, 전환율, 매출)
        └── Table rows (3줄 더미 데이터 라인)
```

- 목업: `rounded-2xl border shadow-2xl bg-background` 안에 HTML 요소로 표현
- 배지: `rounded-full border px-3 py-1 text-xs` + `animate-ping` 인디케이터 dot
- 반응형: 목업은 `hidden md:block` 또는 축소

### 3.4 SocialProofSection.tsx (신규)

```
Section (py-16, bg-muted/30)
├── Metrics Row (grid 2x2 → 4x1)
│   ├── "1,000+" 고객사 (Building2 icon)
│   ├── "50%" 업무 시간 절감 (Clock icon)
│   ├── "10초" AI 분석 응답 (Zap icon)
│   └── "99.9%" 서비스 가동률 (Shield icon)
│
├── Divider (border-t my-12)
│
└── Testimonials Marquee
    └── 무한 스크롤 컨테이너 (overflow-hidden)
        └── flex (animate-marquee)
            ├── 후기카드 x 6 (이름, 직함, 회사, 별점, 인용)
            └── 후기카드 x 6 (복제본 - 무한루프)
    └── 양쪽 gradient fade (absolute, from-background)
```

- 6개 고객 후기 (한국 이름/회사명)
- 카드: `min-w-[300px] rounded-xl border p-5`
- 별점: 5개 `Star` 아이콘 (text-yellow-400 fill-yellow-400)
- 마퀴: `hover:paused` (`:hover` 시 `animation-play-state: paused`)
- gradient mask: `absolute inset-y-0 w-20 from-background` 양쪽

### 3.5 ProductPreviewSection.tsx (신규)

```
Section (py-20)
├── Title: "하나의 플랫폼에서 모든 것을"
├── Tab bar (4개 탭 버튼)
│   ├── 고객 관리 (Users icon)
│   ├── 이메일 자동화 (Mail icon)
│   ├── 대시보드 (BarChart3 icon)
│   └── AI 도우미 (Sparkles icon)
└── Preview area (AnimateOnScroll)
    └── Active tab의 목업 + 설명
        ├── Left: 설명 텍스트 (title, description, 3 bullet points)
        └── Right: HTML/CSS 목업 (rounded-2xl border shadow-lg)
```

- `useState`로 activeTab 관리
- 각 탭마다 고유 목업:
  - 고객 관리: 테이블 목업 (이름, 회사, 상태, 연락처)
  - 이메일 자동화: 이메일 리스트 목업 (제목, 상태 badge, 발송일)
  - 대시보드: 차트 카드 목업 (바 차트 CSS)
  - AI 도우미: 채팅 UI 목업 (AI 메시지 버블)
- 탭 전환 시 fade 트랜지션: `transition-opacity duration-300`
- 반응형: lg에서 2컬럼 (설명+목업), md이하 1컬럼

### 3.6 HowItWorksSection.tsx (신규)

```
Section (py-20)
├── Title: "시작하기 쉬워요"
└── 4 Steps (grid 1 → 4 cols)
    ├── Step 1: UserPlus icon + "회원가입" + "이메일만으로 30초면 완료"
    ├── Step 2: Settings icon + "워크스페이스 설정" + "팀에 맞는 필드와 파이프라인 구성"
    ├── Step 3: Upload icon + "데이터 등록" + "기존 고객 데이터 CSV 가져오기"
    └── Step 4: TrendingUp icon + "분석 시작" + "AI 대시보드로 인사이트 확인"
```

- 각 step: `AnimateOnScroll` + stagger delay (0, 100, 200, 300)
- Step 카드: `text-center` + 아이콘 원형 배경 (`rounded-full bg-primary/10 p-4`)
- Step 번호: 아이콘 위 `text-xs font-bold text-primary` "STEP 1"
- 데스크톱에서 step 사이 커넥터 라인 (`hidden lg:block` + `border-t border-dashed`)

### 3.7 FeaturesSection.tsx (교체)

기존 구조 유지하되 AnimateOnScroll 적용:

```
Section (py-20, id="features")
├── Title + Description (AnimateOnScroll)
└── Grid 1→2→4 cols
    ├── Feature Card 1 (AnimateOnScroll delay=0)
    ├── Feature Card 2 (AnimateOnScroll delay=100)
    ├── Feature Card 3 (AnimateOnScroll delay=200)
    └── Feature Card 4 (AnimateOnScroll delay=300)
```

- 기존 FEATURES 데이터 유지
- 카드에 `hover:shadow-lg hover:-translate-y-1 transition-all` 추가
- 아이콘 배경: `rounded-lg bg-primary/10 p-2.5` (현재는 아이콘만)

### 3.8 PricingSection.tsx (교체)

기존 PLANS 데이터 유지, AnimateOnScroll 적용:

```
Section (py-20, bg-muted/30, id="pricing")
├── Title + Description (AnimateOnScroll)
└── Grid 1→3 cols (AnimateOnScroll stagger)
    ├── Free card (delay=0)
    ├── Pro card (delay=100, highlighted)
    └── Enterprise card (delay=200)
```

- 기존 디자인 유지 + AnimateOnScroll 래핑만 추가

### 3.9 FaqSection.tsx (신규)

```
Section (py-20, id="faq")
├── Title: "자주 묻는 질문"
└── Accordion (max-w-3xl mx-auto)
    ├── Q1: SalesFlow는 무료로 사용할 수 있나요?
    ├── Q2: 기존 고객 데이터를 가져올 수 있나요?
    ├── Q3: 팀원은 몇 명까지 추가할 수 있나요?
    ├── Q4: AI 기능은 어떤 것들이 있나요?
    ├── Q5: 이메일 자동화는 어떻게 설정하나요?
    ├── Q6: 알림톡 발송도 가능한가요?
    ├── Q7: 데이터는 안전하게 보호되나요?
    └── Q8: 플랜을 변경하려면 어떻게 하나요?
```

- ShadCN `Accordion` 컴포넌트 사용 (이미 설치됨)
- `type="single" collapsible`
- `AnimateOnScroll` 래핑

### 3.10 CtaSection.tsx (교체)

```
Section (py-20)
├── AnimateOnScroll
│   ├── h2: "영업 성과를 높일 준비가 되셨나요?"
│   ├── p: "지금 무료로 시작하세요. 신용카드 없이 바로 사용할 수 있습니다."
│   └── CTA 버튼 (무료로 시작하기)
```

- 기존과 유사하되 AnimateOnScroll 적용 + 버튼 1개로 간소화 (기존 2개 → 1개)

### 3.11 LandingFooter.tsx (교체)

```
Footer (border-t, py-12)
└── Container (grid 1→4 cols)
    ├── Col 1: Brand
    │   ├── "SalesFlow" (font-bold)
    │   └── "스마트 영업 관리 플랫폼"
    ├── Col 2: 제품
    │   ├── 기능
    │   ├── 요금제
    │   └── FAQ
    ├── Col 3: 지원
    │   ├── 문의하기
    │   ├── 이용약관
    │   └── 개인정보처리방침
    └── Col 4: 연결
        ├── 블로그 (placeholder)
        └── GitHub (placeholder)
    ─── Copyright bar (border-t, mt-8 pt-8)
```

### 3.12 LandingPage.tsx (수정)

```tsx
import LandingNavbar from "./LandingNavbar";
import HeroSection from "./HeroSection";
import SocialProofSection from "./SocialProofSection";
import ProductPreviewSection from "./ProductPreviewSection";
import HowItWorksSection from "./HowItWorksSection";
import FeaturesSection from "./FeaturesSection";
import PricingSection from "./PricingSection";
import FaqSection from "./FaqSection";
import CtaSection from "./CtaSection";
import LandingFooter from "./LandingFooter";

export default function LandingPage() {
    return (
        <div className="min-h-screen flex flex-col">
            <LandingNavbar />
            <main className="flex-1">
                <HeroSection />
                <SocialProofSection />
                <ProductPreviewSection />
                <HowItWorksSection />
                <FeaturesSection />
                <PricingSection />
                <FaqSection />
                <CtaSection />
            </main>
            <LandingFooter />
        </div>
    );
}
```

---

## 4. 삭제 파일

| 파일 | 이유 |
|------|------|
| `src/components/landing/LandingHeader.tsx` | LandingNavbar로 교체 |

---

## 5. 구현 순서

| # | 파일 | 의존성 |
|---|------|--------|
| 1 | globals.css (키프레임) | 없음 |
| 2 | AnimateOnScroll.tsx | 없음 |
| 3 | LandingNavbar.tsx | Sheet UI |
| 4 | HeroSection.tsx | AnimateOnScroll |
| 5 | SocialProofSection.tsx | AnimateOnScroll, marquee CSS |
| 6 | ProductPreviewSection.tsx | AnimateOnScroll |
| 7 | HowItWorksSection.tsx | AnimateOnScroll |
| 8 | FeaturesSection.tsx | AnimateOnScroll |
| 9 | PricingSection.tsx | AnimateOnScroll |
| 10 | FaqSection.tsx | Accordion UI |
| 11 | CtaSection.tsx | AnimateOnScroll |
| 12 | LandingFooter.tsx | 없음 |
| 13 | LandingPage.tsx | 모든 컴포넌트 |
| 14 | LandingHeader.tsx 삭제 | LandingPage에서 제거 후 |
| 15 | `pnpm build` | 전체 |

---

## 6. 검증 체크리스트

- [ ] 12개 컴포넌트 모두 구현
- [ ] LandingHeader.tsx 삭제됨
- [ ] AnimateOnScroll 스크롤 애니메이션 동작
- [ ] 마퀴 후기 캐러셀 동작
- [ ] 모바일 Sheet 메뉴 동작
- [ ] Navbar 스크롤 shadow 동작
- [ ] ProductPreview 탭 전환 동작
- [ ] FAQ Accordion 동작
- [ ] anchor link smooth scroll (#features, #pricing, #faq)
- [ ] prefers-reduced-motion 시 애니메이션 비활성화
- [ ] 반응형: 모바일/태블릿/데스크톱
- [ ] `pnpm build` 성공
