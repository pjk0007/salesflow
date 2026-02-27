# landing-page-v2 Planning Document

> **Summary**: adion 수준의 프로페셔널 랜딩페이지로 전면 리디자인
>
> **Project**: SalesFlow
> **Author**: Claude
> **Date**: 2026-02-27
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

현재 SalesFlow 랜딩페이지는 7개 컴포넌트 336줄의 기본적인 구조입니다.
adion 프로젝트(14개 컴포넌트, 1,760줄) 수준의 프로페셔널 B2B SaaS 랜딩페이지로 전면 리디자인합니다.

### 1.2 Background

- 현재: Hero + Features(4개 카드) + Pricing(3티어) + CTA + Footer (336 LOC)
- 목표: adion처럼 다양한 섹션, 스크롤 애니메이션, 사회적 증거, FAQ 등을 포함한 본격적인 랜딩페이지
- 참고: adion은 외부 애니메이션 라이브러리 없이 CSS + IntersectionObserver만으로 구현

### 1.3 Reference: adion 랜딩페이지 구조

```
Navbar (sticky, backdrop-blur, scroll shadow)
Hero (animated badge, headline, CTA, dashboard mockup)
AI Demo (chat simulation, typing animation)
Platforms (지원 플랫폼 쇼케이스)
Social Proof (testimonials carousel, stats count-up)
Stats (4개 주요 수치 카드)
Product Preview (탭 전환 기능 데모)
Mini CTA (중간 CTA)
How It Works (4단계 프로세스)
Pricing (4 tiers, 추천 표시)
FAQ (accordion 12개)
CTA (하단 최종)
Footer (4 컬럼)
```

---

## 2. Scope

### 2.1 In Scope

- [ ] 기존 7개 컴포넌트 → 새로운 섹션으로 교체/확장
- [ ] AnimateOnScroll 유틸리티 컴포넌트 (IntersectionObserver)
- [ ] 스크롤 트리거 애니메이션 (fade-slide-up, staggered)
- [ ] Hero 섹션 개선: 대시보드 목업, 애니메이션 배지
- [ ] Social Proof: 고객 후기 마퀴 + 핵심 수치
- [ ] Product Preview: 탭 전환 기능 쇼케이스
- [ ] How It Works: 4단계 온보딩 플로우
- [ ] FAQ: Accordion 방식 Q&A
- [ ] Navbar 개선: 스크롤 감지, 모바일 메뉴
- [ ] Footer 확장: 다중 컬럼 링크
- [ ] CSS 키프레임 애니메이션 (marquee, fade-slide-up)
- [ ] `prefers-reduced-motion` 접근성 지원

### 2.2 Out of Scope

- framer-motion 등 외부 애니메이션 라이브러리 (CSS only, adion과 동일)
- AI Demo 섹션 (SalesFlow는 AI 챗 데모 불필요)
- Platforms 섹션 (SalesFlow는 외부 플랫폼 통합 없음)
- JSON-LD 구조화 데이터 (추후 SEO 개선 시)

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-01 | Navbar: sticky, backdrop-blur, 스크롤시 shadow, 모바일 햄버거 메뉴 | High |
| FR-02 | Hero: 애니메이션 배지, 메인 헤드라인, CTA 버튼 2개, 대시보드 목업 | High |
| FR-03 | Social Proof: 핵심 수치 4개 (카운트업), 고객 후기 마퀴 캐러셀 | High |
| FR-04 | Product Preview: 탭 전환 4개 기능 데모 (고객관리, 이메일, 대시보드, AI) | High |
| FR-05 | How It Works: 4단계 프로세스 (가입→설정→데이터→분석) | Medium |
| FR-06 | Pricing: 기존 3티어 유지 + 디자인 개선 | Medium |
| FR-07 | FAQ: Accordion 형태 8-10개 Q&A | Medium |
| FR-08 | CTA: 하단 최종 전환 유도 | Medium |
| FR-09 | Footer: 3-4 컬럼 링크 구조 | Medium |
| FR-10 | AnimateOnScroll: 재사용 가능한 스크롤 애니메이션 래퍼 | High |
| FR-11 | CSS 키프레임: fade-slide-up, marquee | High |
| FR-12 | 접근성: prefers-reduced-motion 지원 | Medium |

### 3.2 Non-Functional Requirements

| Category | Criteria |
|----------|----------|
| 성능 | 외부 애니메이션 라이브러리 없음 (CSS + IntersectionObserver) |
| 반응형 | 모바일/태블릿/데스크톱 3단계 |
| 접근성 | prefers-reduced-motion, 시맨틱 HTML |
| 코드량 | 목표 ~1,200-1,500 LOC (현재 336 → 4배) |

---

## 4. 새로운 컴포넌트 구조

```
src/components/landing/
├── LandingPage.tsx          (기존 수정 - 섹션 구성 변경)
├── LandingNavbar.tsx         (기존 LandingHeader 교체)
├── HeroSection.tsx           (기존 대폭 확장)
├── SocialProofSection.tsx    (신규)
├── ProductPreviewSection.tsx (신규)
├── HowItWorksSection.tsx     (신규)
├── FeaturesSection.tsx       (기존 개선)
├── PricingSection.tsx        (기존 개선)
├── FaqSection.tsx            (신규)
├── CtaSection.tsx            (기존 개선)
├── LandingFooter.tsx         (기존 확장)
└── AnimateOnScroll.tsx       (신규 유틸리티)

src/styles/globals.css         (키프레임 추가)
```

| 상태 | 컴포넌트 수 |
|------|------------|
| 신규 | 5개 (SocialProof, ProductPreview, HowItWorks, FAQ, AnimateOnScroll) |
| 기존 교체 | 1개 (LandingHeader → LandingNavbar) |
| 기존 개선 | 5개 (LandingPage, Hero, Features, Pricing, CTA, Footer) |
| 총 | 12개 컴포넌트 |

---

## 5. Success Criteria

- [ ] 12개 컴포넌트, ~1,200+ LOC
- [ ] 스크롤 애니메이션 동작 (fade-slide-up)
- [ ] 모바일 반응형 정상
- [ ] `pnpm build` 성공
- [ ] prefers-reduced-motion 지원

---

## 6. Risks and Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| 컴포넌트 수 증가로 빌드 시간 증가 | Low | CSS only, 추가 번들 없음 |
| 목업 이미지 필요 | Medium | HTML/CSS로 목업 렌더링 (adion 방식) |
| 콘텐츠(후기, FAQ) 작성 필요 | Medium | 실제감 있는 더미 데이터 사용 |

---

## 7. Next Steps

1. [ ] Write design document (`landing-page-v2.design.md`)
2. [ ] Start implementation
3. [ ] Verify with `pnpm build`

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-02-27 | Initial draft | Claude |
