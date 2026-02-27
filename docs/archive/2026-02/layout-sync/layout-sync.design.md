# Design: layout-sync

> Adion 프로젝트 레이아웃 구조를 Sales에 동기화

## 1. 구현 순서

| # | 작업 | 파일 | 의존 |
|---|------|------|------|
| 1 | next-themes 설치 | package.json | - |
| 2 | globals.css 통일 | src/styles/globals.css | - |
| 3 | _document.tsx 수정 | src/pages/_document.tsx | - |
| 4 | _app.tsx ThemeProvider | src/pages/_app.tsx | #1 |
| 5 | SidebarContext | src/components/dashboard/sidebar-context.tsx | - |
| 6 | BreadcrumbContext | src/components/dashboard/breadcrumb-context.tsx | - |
| 7 | Sidebar | src/components/dashboard/sidebar.tsx | #5 |
| 8 | Header | src/components/dashboard/header.tsx | #6 |
| 9 | DashboardShell | src/components/dashboard/dashboard-shell.tsx | #5,#6,#7,#8 |
| 10 | WorkspaceLayout 교체 | src/components/layouts/WorkspaceLayout.tsx | #9 |
| 11 | 로그인 2-panel | src/pages/login.tsx | #2 |
| 12 | PageContainer | src/components/common/page-container.tsx | - |
| 13 | PageHeader | src/components/common/page-header.tsx | - |

## 2. 컴포넌트 상세 설계

### 2.1 sidebar-context.tsx

```typescript
// 모바일 사이드바 열림/닫힘 상태만 관리
interface SidebarContextType {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}
```

- 기본 상태: `open = false`
- `SidebarProvider` → children 감싸기
- `useSidebar()` hook export

### 2.2 breadcrumb-context.tsx

```typescript
interface BreadcrumbOverrides {
  [segment: string]: string;  // UUID segment → readable label
}
```

- `BreadcrumbProvider` → overrides state + setOverride callback
- `useBreadcrumbOverrides()` → { overrides, setOverride }
- `useBreadcrumb(segment, label)` → useEffect로 override 등록
- Pages Router 대응: `useRouter().asPath` 기반

### 2.3 sidebar.tsx

**Nav 항목:**
```typescript
const navItems = [
  { href: "/", label: "레코드", icon: LayoutDashboard },
  { href: "/alimtalk", label: "알림톡", icon: MessageSquare },
];

const bottomNavItems = [
  { href: "/users", label: "사용자", icon: Users },
  { href: "/settings", label: "설정", icon: Settings },
];
```

**DesktopSidebar props:**
```typescript
interface DesktopSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}
```

**구조:**
```
aside (hidden md:flex, w-60 | w-16, border-r, bg-sidebar)
├── Header (h-14) — "Sales Manager" 텍스트 (접힘: "SM")
├── Nav (flex-1, overflow-y-auto)
│   ├── navItems.map(NavLink)
│   ├── border-t separator
│   └── bottomNavItems.map(NavLink) — role !== "member" 조건
└── Toggle button (border-t) — PanelLeftClose / PanelLeftOpen
```

**NavLink 스타일 (Adion 동일):**
- Active: `bg-sidebar-accent text-sidebar-accent-foreground font-semibold` + 좌측 accent bar (`div.absolute left-0 w-0.5 h-5 bg-primary rounded-full`)
- Inactive: `text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground font-medium`
- 접힌 상태: `justify-center`, 아이콘만, Tooltip으로 label 표시

**Active 판정 (Pages Router):**
```typescript
const router = useRouter();
const isActive = item.href === "/"
  ? router.pathname === "/"
  : router.pathname.startsWith(item.href);
```

**MobileSidebar:**
```
<> (open일 때만 렌더)
├── Backdrop (fixed inset-0 z-40 bg-black/50)
└── Drawer (fixed inset-y-0 left-0 z-50 w-60 bg-sidebar shadow-lg)
    ├── Header (h-14) — "Sales Manager" + X 닫기 버튼
    ├── Nav (onNavigate → setOpen(false))
    └── (하단 토글 불필요)
```

**MobileSidebarToggle:**
- `Button variant="ghost" size="icon" className="md:hidden"` → PanelLeftOpen 아이콘
- `useSidebar().toggle` 호출

### 2.4 header.tsx

**구조:**
```
header (h-14, border-b, bg-background, px-4, flex items-center)
├── MobileSidebarToggle (md:hidden)
├── HeaderBreadcrumb (hidden sm:flex, ml-2)
├── flex-1 spacer
└── Actions
    └── DropdownMenu (유저)
        ├── Trigger: User icon + user.name (hidden sm:inline)
        └── Content:
            ├── 테마 전환 (Sun/Moon/Monitor 3버튼)
            ├── Separator
            ├── "설정" → router.push("/settings")
            └── "로그아웃" → logout()
```

**HeaderBreadcrumb:**
```typescript
const BREADCRUMB_LABELS: Record<string, string> = {
  alimtalk: "알림톡",
  settings: "설정",
  users: "사용자",
};
// "/" 경로는 Home 아이콘만
// pathname.split("/").filter(Boolean) → segments
// UUID_RE 매칭 시 "..." 표시
// overrides[segment] 우선, 없으면 BREADCRUMB_LABELS, 없으면 segment
```

**테마 전환:**
```typescript
const { theme, setTheme } = useTheme();
// Sun(light), Moon(dark), Monitor(system) 3개 아이콘 버튼
// 현재 테마: bg-primary/10 text-primary
```

### 2.5 dashboard-shell.tsx

```typescript
export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <SidebarProvider>
      <BreadcrumbProvider>
        <div className="flex h-screen">
          <DesktopSidebar collapsed={collapsed} onToggle={() => setCollapsed(p => !p)} />
          <MobileSidebar />
          <div className="flex flex-1 flex-col overflow-hidden">
            <Header />
            <main className="flex-1 overflow-y-auto p-4 sm:p-6 bg-muted/30">
              <div className="mx-auto max-w-7xl">
                {children}
              </div>
            </main>
          </div>
        </div>
      </BreadcrumbProvider>
    </SidebarProvider>
  );
}
```

### 2.6 WorkspaceLayout.tsx 교체

**변경 전:** 직접 aside + main 렌더링
**변경 후:** DashboardShell 래핑만

```typescript
export default function WorkspaceLayout({ children }: WorkspaceLayoutProps) {
  const router = useRouter();
  const { user, isLoading, logout } = useSession();

  // 기존 로딩/인증 체크 유지
  if (isLoading) return <LoadingScreen />;
  if (!user) return null;

  return <DashboardShell>{children}</DashboardShell>;
}
```

- `useSession()`의 `user`, `logout`은 Header와 Sidebar에서 직접 호출
- WorkspaceLayout은 인증 가드 역할만 수행
- DashboardShell 내부에서 useSession() 각각 호출

### 2.7 login.tsx 2-panel

```
div (flex min-h-screen)
├── 좌측 패널 (hidden lg:flex lg:w-1/2, bg-primary, p-12, text-primary-foreground)
│   ├── 상단: "Sales Manager" 로고 텍스트
│   ├── 중앙: 히어로 텍스트 ("영업 데이터를 / 하나의 화면으로")
│   └── 하단: copyright
└── 우측 패널 (flex-1, items-center justify-center, p-4 sm:p-8)
    └── Card (max-w-md) — 기존 로그인 폼 그대로
```

### 2.8 _app.tsx

```typescript
import { ThemeProvider } from "next-themes";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <Head>...</Head>
        <Component {...pageProps} />
        <Toaster position="top-right" richColors />
      </ThemeProvider>
    </SessionProvider>
  );
}
```

### 2.9 _document.tsx

```typescript
<Html lang="ko" suppressHydrationWarning>
```

`suppressHydrationWarning`만 추가. next-themes가 초기 렌더링 시 class를 주입하므로 필요.

### 2.10 globals.css

Adion과 동일한 CSS 변수 체계 적용:
- `:root` primary 색상: `oklch(0.205 0 0)` (Adion 동일, 현재 Sales는 파란색 계열)
- `.dark` primary: `oklch(0.922 0 0)` (Adion 동일)
- sidebar 변수: Adion과 동일하게 neutral 톤
- Sales 고유 `--destructive-foreground` 제거 (Adion에는 없음)
- `--sidebar-background` → `--sidebar` 로 통일 (Adion은 `--sidebar`만 사용)

**주의:** Sales primary가 현재 파란색(`oklch(0.55 0.2 250)`)이고 Adion은 검정(`oklch(0.205 0 0)`). Adion과 동일하게 검정으로 변경한다.

### 2.11 page-container.tsx

```typescript
interface PageContainerProps {
  children: React.ReactNode;
  className?: string;
}
// cn("space-y-6", className)
```

### 2.12 page-header.tsx

```typescript
interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}
// flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between
// title: text-2xl font-bold tracking-tight
// description: text-muted-foreground
// actions: flex items-center gap-2 shrink-0
```

## 3. Adion과의 차이점 (의도적)

| 항목 | Adion | Sales | 이유 |
|------|-------|-------|------|
| OrganizationSwitcher | 있음 | 없음 | Sales는 단일 조직 |
| Sync 버튼 | 헤더에 있음 | 없음 | Sales에 동기화 기능 없음 |
| bottomNavItems 권한 | 모든 사용자 | role !== "member" | Sales 기존 정책 유지 |
| Router | App Router (usePathname) | Pages Router (useRouter) | 프레임워크 차이 |
| Logo | SVG 아이콘 + "Adion" | 텍스트 "Sales Manager" | 브랜드 차이 |
| 사이드바 헤더 높이 | h-14 | h-14 | 동일 |

## 4. 삭제할 코드

- `src/components/layouts/WorkspaceLayout.tsx` 내부의 직접 aside/main 렌더링 코드
- WorkspaceLayout에서 사용하던 Tooltip (로그아웃 버튼용) → Header 유저 드롭다운으로 이동
- globals.css의 `--sidebar-background` 변수 → `--sidebar`로 통일
- globals.css의 `--destructive-foreground` → Adion에 없으므로 제거

## 5. 파일별 LOC 예상

| 파일 | LOC |
|------|-----|
| sidebar-context.tsx | ~25 |
| breadcrumb-context.tsx | ~45 |
| sidebar.tsx | ~170 |
| header.tsx | ~120 |
| dashboard-shell.tsx | ~30 |
| page-container.tsx | ~12 |
| page-header.tsx | ~20 |
| WorkspaceLayout.tsx (수정) | ~25 |
| login.tsx (수정) | ~70 |
| _app.tsx (수정) | ~20 |
| _document.tsx (수정) | ~20 |
| globals.css (수정) | ~140 |
| **합계** | **~700** |
