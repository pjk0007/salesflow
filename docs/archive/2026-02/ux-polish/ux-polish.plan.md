# UX Polish Planning Document

> **Summary**: 랜딩페이지 보강, 로그인→랜딩 네비게이션 추가, 서비스명 SalesFlow 통일
>
> **Project**: Sales Manager
> **Date**: 2026-02-26
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

3가지 UX 문제를 일괄 수정하여 서비스 완성도를 높인다:
1. 랜딩페이지가 너무 짧음 — 섹션 보강 필요
2. 로그인/회원가입 페이지에서 랜딩페이지로 돌아가는 링크가 없음
3. 서비스 이름이 "Sales Manager"와 "SalesFlow" 혼용 — SalesFlow로 통일

### 1.2 Background

- 랜딩페이지: Hero + Features(4개) + Pricing 3개 섹션만 존재 → 신뢰도/전환율 부족
- 로그인/회원가입: 좌측 브랜드 패널에 "Sales Manager" 표시, 랜딩으로 돌아가는 링크 없음
- 사이드바, _app.tsx 등에 "Sales Manager"가 남아있어 브랜딩 불일치

---

## 2. Scope

### 2.1 In Scope

- [ ] 랜딩페이지에 CTA 섹션 추가 (최하단, Footer 바로 위)
- [ ] 로그인/회원가입 페이지에서 랜딩("/" )으로 돌아가는 링크 추가
- [ ] "Sales Manager" → "SalesFlow" 이름 통일 (전체 소스 코드)

### 2.2 Out of Scope

- 랜딩페이지 디자인 전면 리뉴얼
- 고객 후기, 블로그 등 콘텐츠 페이지 추가
- SEO 최적화 (별도 피처)

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | 랜딩페이지에 CTA 섹션 추가 (Pricing 아래, Footer 위) | High | Pending |
| FR-02 | 로그인 페이지 좌측 패널 상단 로고에 `/` 링크 추가 | High | Pending |
| FR-03 | 회원가입 페이지 좌측 패널 상단 로고에 `/` 링크 추가 | High | Pending |
| FR-04 | 모든 "Sales Manager" 텍스트 → "SalesFlow" 변경 | High | Pending |
| FR-05 | 사이드바 collapsed 상태 "SM" → "SF" 변경 | Medium | Pending |

---

## 4. 변경 대상 파일

### 4.1 서비스명 통일 (Sales Manager → SalesFlow)

| # | 파일 | 현재 | 변경 |
|---|------|------|------|
| 1 | `src/pages/_app.tsx:14` | `<title>Sales Manager</title>` | `<title>SalesFlow</title>` |
| 2 | `src/pages/login.tsx:54` | `Sales Manager` (브랜드 패널) | `SalesFlow` + Link to `/` |
| 3 | `src/pages/login.tsx:66` | `© 2026 Sales Manager` | `© 2026 SalesFlow` |
| 4 | `src/pages/signup.tsx:81` | `Sales Manager` (브랜드 패널) | `SalesFlow` + Link to `/` |
| 5 | `src/pages/signup.tsx:93` | `© 2026 Sales Manager` | `© 2026 SalesFlow` |
| 6 | `src/components/dashboard/sidebar.tsx:128` | `collapsed ? "SM" : "Sales Manager"` | `collapsed ? "SF" : "SalesFlow"` |
| 7 | `src/components/dashboard/sidebar.tsx:179` | `Sales Manager` (모바일) | `SalesFlow` |

### 4.2 랜딩페이지 CTA 섹션

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 1 | `src/components/landing/CtaSection.tsx` (신규) | "영업 성과를 높일 준비가 되셨나요?" CTA 섹션 |
| 2 | `src/components/landing/LandingPage.tsx` | CtaSection import 및 추가 |

### 4.3 로그인/회원가입 랜딩 링크

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 1 | `src/pages/login.tsx` | 좌측 패널 로고를 Link href="/"로 감싸기 |
| 2 | `src/pages/signup.tsx` | 좌측 패널 로고를 Link href="/"로 감싸기 |

---

## 5. Success Criteria

- [ ] 모든 페이지에서 "Sales Manager" 텍스트 0건
- [ ] 로그인/회원가입 좌측 로고 클릭 시 `/` (랜딩)으로 이동
- [ ] 랜딩페이지 섹션: Header + Hero + Features + Pricing + CTA + Footer (6개)
- [ ] `pnpm build` 성공

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-02-26 | Initial draft | AI |
