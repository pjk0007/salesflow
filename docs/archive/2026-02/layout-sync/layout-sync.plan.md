# Plan: layout-sync

> Adion 프로젝트와 동일한 레이아웃 구조로 Sales 프로젝트 재구성

## 1. 배경 및 목적

Sales Manager 프로젝트의 레이아웃(사이드바, 헤더, 로그인 페이지 등)을 Adion 프로젝트와 동일한 구조로 통일한다. 두 프로젝트가 같은 조직에서 운영되므로 UI/UX 일관성이 필요하다.

## 2. 현재 상태 (Sales)

| 항목 | 현재 Sales | Adion |
|------|-----------|-------|
| **사이드바** | 고정 w-60, 접기 불가 | w-60/w-16 접기 가능, 모바일 드로어 |
| **헤더** | 없음 | h-14, breadcrumb, 유저 드롭다운, 테마 토글 |
| **로그인 페이지** | 단일 Card 중앙 정렬 | 2-panel (좌: 브랜드, 우: 폼) |
| **테마 전환** | 미지원 | light/dark/system (next-themes) |
| **모바일 대응** | 없음 (사이드바 항상 표시) | 모바일 드로어 + 햄버거 |
| **조직 전환** | 없음 (단일 조직) | 사이드바 내 OrganizationSwitcher |
| **Breadcrumb** | 없음 | 경로 기반 자동 생성 |
| **페이지 패턴** | 각 페이지 자체 스타일 | PageContainer + PageHeader 공통 컴포넌트 |
| **콘텐츠 영역** | overflow-auto, 패딩 없음 | p-4 sm:p-6, bg-muted/30, max-w-7xl |

## 3. 변경 범위

### 3.1 새로 생성할 파일

| 파일 | 설명 |
|------|------|
| `src/components/dashboard/sidebar.tsx` | DesktopSidebar + MobileSidebar + MobileSidebarToggle |
| `src/components/dashboard/sidebar-context.tsx` | 모바일 사이드바 상태 관리 Context |
| `src/components/dashboard/header.tsx` | 헤더 (breadcrumb, 유저 드롭다운, 테마 토글) |
| `src/components/dashboard/dashboard-shell.tsx` | 대시보드 쉘 (사이드바 + 헤더 + 콘텐츠 조합) |
| `src/components/dashboard/breadcrumb-context.tsx` | Breadcrumb override Context |
| `src/components/common/page-container.tsx` | 공통 페이지 컨테이너 |
| `src/components/common/page-header.tsx` | 공통 페이지 헤더 (제목 + 설명 + 액션) |

### 3.2 수정할 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/components/layouts/WorkspaceLayout.tsx` | 기존 코드를 DashboardShell 기반으로 교체 |
| `src/pages/_app.tsx` | ThemeProvider (next-themes) 추가 |
| `src/pages/_document.tsx` | html tag에 suppressHydrationWarning 추가 |
| `src/pages/login.tsx` | 2-panel 레이아웃으로 변경 |
| `src/styles/globals.css` | Adion과 동일한 CSS 변수 체계로 통일 |

### 3.3 기존 페이지 적용 (선택)

각 페이지에서 `PageContainer` + `PageHeader` 패턴을 점진적으로 적용할 수 있으나, 이번 scope에서는 레이아웃 쉘만 변경하고 개별 페이지 내용은 건드리지 않는다.

## 4. 기능 요구사항

### FR-01: 접이식 사이드바
- Desktop: w-60 (펼침) / w-16 (접힘) 토글
- 접힌 상태에서 아이콘만 표시 + Tooltip
- 하단 토글 버튼 (PanelLeftClose / PanelLeftOpen)
- transition-all duration-200 애니메이션

### FR-02: 모바일 사이드바
- md 미만에서 Desktop 사이드바 숨김 (hidden md:flex)
- 햄버거 버튼으로 드로어 열기
- 백드롭 (bg-black/50) + 좌측 슬라이드 서랍
- 네비게이션 클릭 시 자동 닫기

### FR-03: 헤더
- 높이 h-14, border-b
- 좌측: 모바일 사이드바 토글 (md:hidden)
- 중앙: Breadcrumb (sm:flex, hidden on mobile)
- 우측: 유저 드롭다운 메뉴

### FR-04: 유저 드롭다운
- 트리거: User 아이콘 + 이름
- 테마 전환 (Sun/Moon/Monitor 3버튼)
- 프로필 설정 링크
- 로그아웃

### FR-05: 테마 전환 (dark/light/system)
- next-themes 패키지 사용
- _app.tsx에 ThemeProvider 추가
- _document.tsx suppressHydrationWarning
- 유저 드롭다운에서 전환

### FR-06: Breadcrumb
- pathname 기반 자동 생성
- UUID 세그먼트 "..." 표시
- BreadcrumbContext로 동적 라벨 오버라이드
- BREADCRUMB_LABELS 맵핑 (레코드, 알림톡, 설정, 사용자)

### FR-07: 로그인 페이지 2-panel
- 좌측 (lg:w-1/2): 브랜드 패널 (Sales Manager 로고, 설명)
- 우측 (flex-1): 기존 로그인 폼
- 모바일: 우측 폼만 표시

### FR-08: 콘텐츠 영역
- p-4 sm:p-6 패딩
- bg-muted/30 배경
- max-w-7xl 센터 정렬
- overflow-y-auto 스크롤

### FR-09: 공통 페이지 컴포넌트
- PageContainer: space-y-6 래퍼
- PageHeader: 제목 + 설명 + 액션 영역

## 5. 의존 패키지

| 패키지 | 용도 | 설치 필요 |
|--------|------|-----------|
| next-themes | 테마 전환 | 예 |
| lucide-react | 아이콘 | 이미 설치됨 |
| @radix-ui/react-dropdown-menu | 드롭다운 메뉴 | 이미 설치됨 |
| @radix-ui/react-tooltip | 툴팁 | 이미 설치됨 |

## 6. 비고

- Sales는 Pages Router (Next.js)이므로 `useRouter`, `usePathname` 대신 `next/router`의 `useRouter().pathname` 사용
- Adion의 OrganizationSwitcher는 Sales에서 불필요 (단일 조직 구조)
- Adion의 Sync 버튼은 Sales에서 불필요
- nav 항목: 레코드(/), 알림톡(/alimtalk), 관리 섹션(설정/settings, 사용자/users)
- Adion의 breadcrumb에서 사용하는 `usePathname()`은 Pages Router에서는 `useRouter().pathname`으로 대체
