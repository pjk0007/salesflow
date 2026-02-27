# Plan: landing-page (랜딩 페이지)

## 배경
현재 `index.tsx`는 인증된 사용자의 대시보드이며, 비로그인 사용자가 접속할 수 있는 공개 랜딩 페이지가 없습니다. 클라우드타입 배포 시 첫 방문자가 서비스를 이해하고 회원가입할 수 있는 마케팅 페이지가 필요합니다.

## 목표
비로그인 사용자를 위한 서비스 소개 랜딩 페이지를 만들어 서비스 가치를 전달하고, 회원가입/로그인으로 유도합니다.

## 기능 요구사항

### FR-01: 랜딩 페이지 라우트
- `/` (index.tsx) 변경: 비로그인 시 랜딩 페이지, 로그인 시 기존 대시보드
- 또는 `/landing` 별도 페이지 + index에서 분기

### FR-02: 히어로 섹션
- 서비스명 + 핵심 가치 제안 (한줄 카피)
- CTA 버튼: "무료로 시작하기" → `/signup`
- 서브 CTA: "로그인" → `/login`

### FR-03: 기능 소개 섹션
- 주요 기능 3-4개 카드 레이아웃
  - CRM / 고객관리
  - 대시보드 / 데이터 시각화
  - 이메일 / 알림톡 자동화
  - AI 도우미
- 아이콘 + 제목 + 설명 구조

### FR-04: 요금제 섹션
- 요금제 카드 (billing 기능과 연동 예정)
- 우선 Free / Pro / Enterprise 3단계 표시
- 각 요금제별 기능 목록
- CTA: "시작하기" 버튼

### FR-05: 푸터
- 회사 정보, 이용약관, 개인정보처리방침 링크
- 저작권 표시

### FR-06: 반응형 디자인
- 모바일/태블릿/데스크톱 대응
- 기존 Tailwind CSS 4 + ShadCN UI 활용

## 비기능 요구사항

### NFR-01: SSG (정적 생성)
- 랜딩 페이지는 서버 데이터 불필요 → 정적 HTML로 빌드
- SEO 최적화: title, meta description, OG tags

### NFR-02: 인증 분기
- `getUserFromRequest()` 또는 클라이언트 세션 체크로 로그인 여부 판단
- 로그인 상태면 기존 대시보드로 redirect

## 변경 파일 목록

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 1 | `src/pages/index.tsx` | 비로그인 시 랜딩 페이지 렌더, 로그인 시 기존 대시보드 |
| 2 | `src/components/landing/HeroSection.tsx` | 신규: 히어로 섹션 |
| 3 | `src/components/landing/FeaturesSection.tsx` | 신규: 기능 소개 |
| 4 | `src/components/landing/PricingSection.tsx` | 신규: 요금제 |
| 5 | `src/components/landing/Footer.tsx` | 신규: 푸터 |

## 구현 순서

| # | 작업 | 검증 |
|---|------|------|
| 1 | index.tsx 인증 분기 로직 | 로그인/비로그인 분기 동작 |
| 2 | HeroSection + FeaturesSection | UI 렌더링 |
| 3 | PricingSection + Footer | UI 렌더링 |
| 4 | 반응형 + SEO 메타태그 | `pnpm build` 성공 |

## 우선순위: 1 (배포 전 필수)
