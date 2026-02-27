# layout-fix Design Document

> **Summary**: layout-sync 이후 망가진 페이지 UI/기능 복구
>
> **Plan**: `docs/01-plan/features/layout-fix.plan.md`
> **Date**: 2026-02-13
> **Status**: Draft

---

## 1. Design Overview

DashboardShell의 `main` 영역에서 패딩과 `max-w-7xl` wrapper를 제거하고, 각 페이지가 자체적으로 레이아웃을 제어하도록 변경한다.

### 1.1 Before (현재 - 문제)

```
DashboardShell
  └─ main.flex-1.overflow-y-auto.p-4.sm:p-6.bg-muted/30
      └─ div.mx-auto.max-w-7xl     ← wrapper
          └─ {children}
```

### 1.2 After (수정)

```
DashboardShell
  └─ main.flex-1.overflow-y-auto.bg-muted/30
      └─ {children}                 ← 직접 전달
```

---

## 2. Component Changes

### 2.1 dashboard-shell.tsx

**파일**: `src/components/dashboard/dashboard-shell.tsx`

**변경 전:**
```tsx
<main className="flex-1 overflow-y-auto p-4 sm:p-6 bg-muted/30">
    <div className="mx-auto max-w-7xl">
        {children}
    </div>
</main>
```

**변경 후:**
```tsx
<main className="flex-1 overflow-auto bg-muted/30">
    {children}
</main>
```

**변경 사항:**
- `p-4 sm:p-6` 패딩 제거 (페이지별로 PageContainer에서 처리)
- `div.mx-auto.max-w-7xl` wrapper 제거
- `overflow-y-auto` → `overflow-auto` (가로 스크롤도 허용)

### 2.2 page-container.tsx

**파일**: `src/components/common/page-container.tsx`

**변경 전:**
```tsx
export function PageContainer({ children, className }: PageContainerProps) {
    return <div className={cn("space-y-6", className)}>{children}</div>;
}
```

**변경 후:**
```tsx
export function PageContainer({ children, className }: PageContainerProps) {
    return (
        <div className={cn("mx-auto max-w-7xl p-4 sm:p-6 space-y-6", className)}>
            {children}
        </div>
    );
}
```

**변경 사항:**
- `mx-auto max-w-7xl` 추가 (DashboardShell에서 이전)
- `p-4 sm:p-6` 패딩 추가 (DashboardShell에서 이전)

### 2.3 index.tsx (레코드 페이지)

**파일**: `src/pages/index.tsx`

**현재 구조 유지, wrapper만 수정:**

```tsx
<WorkspaceLayout>
    <div className="flex h-full">
        <PartitionNav ... />
        <div className="flex-1 flex flex-col min-w-0">
            {partitionId ? (
                <>
                    <RecordToolbar ... />
                    <RecordTable ... />
                </>
            ) : (
                <EmptyState />
            )}
        </div>
    </div>
    {/* 다이얼로그들 */}
</WorkspaceLayout>
```

**변경 없음** — DashboardShell에서 패딩/wrapper가 제거되면 `h-full`이 정상 동작하므로 index.tsx 자체 수정 불필요.

### 2.4 alimtalk.tsx

**파일**: `src/pages/alimtalk.tsx`

**변경 전:**
```tsx
<WorkspaceLayout>
    <div className="p-6">
        <div className="mb-6">
            <h1 className="text-2xl font-bold">알림톡</h1>
            <p className="text-muted-foreground">...</p>
        </div>
        <Tabs ...>
```

**변경 후:**
```tsx
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";

<WorkspaceLayout>
    <PageContainer>
        <PageHeader
            title="알림톡"
            description="카카오 알림톡을 발송하고 관리합니다."
        />
        <Tabs ...>
```

**변경 사항:**
- `<div className="p-6">` 제거 → `PageContainer`가 패딩 담당
- 인라인 h1/p 제거 → `PageHeader` 사용
- `<div className="mb-6">` 제거 → `PageContainer`의 `space-y-6`이 간격 담당

### 2.5 settings.tsx

**파일**: `src/pages/settings.tsx`

**변경 전:**
```tsx
<WorkspaceLayout>
    <div className="p-6">
        <div className="mb-6">
            <h1 className="text-2xl font-bold">설정</h1>
            <p className="text-muted-foreground">...</p>
        </div>
        <Tabs ...>
```

**변경 후:**
```tsx
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";

<WorkspaceLayout>
    <PageContainer>
        <PageHeader
            title="설정"
            description="워크스페이스, 조직, 사용자를 관리합니다."
        />
        <Tabs ...>
```

**변경 사항:**
- alimtalk.tsx와 동일한 패턴 적용

---

## 3. Implementation Order

| Step | File | Action | LOC |
|------|------|--------|-----|
| 1 | `src/components/dashboard/dashboard-shell.tsx` | main 영역 패딩/wrapper 제거 | ~5 |
| 2 | `src/components/common/page-container.tsx` | 패딩/max-w 추가 | ~5 |
| 3 | `src/pages/alimtalk.tsx` | PageContainer/PageHeader 적용 | ~10 |
| 4 | `src/pages/settings.tsx` | PageContainer/PageHeader 적용 | ~10 |
| 5 | 빌드 확인 | `pnpm build` | - |

**총 변경량:** ~30 LOC, 4개 파일

---

## 4. What Does NOT Change

- `src/pages/index.tsx` — DashboardShell 수정으로 자동 해결
- `src/components/dashboard/sidebar.tsx` — 변경 없음
- `src/components/dashboard/header.tsx` — 변경 없음
- `src/components/common/page-header.tsx` — 현재 구조 그대로 사용
- `src/components/records/*` — 변경 없음
- `src/components/alimtalk/*` — 변경 없음
- `src/components/settings/*` — 변경 없음

---

## 5. Verification Criteria

| ID | 검증 항목 | 방법 |
|----|----------|------|
| V-01 | 레코드 페이지: 2패널이 전체 높이 차지 | `h-full` → main이 flex container이므로 동작 |
| V-02 | 레코드 테이블: 내부 스크롤 정상 | RecordTable의 `overflow-auto` 확인 |
| V-03 | 알림톡 페이지: 이중 패딩 없음 | PageContainer만 패딩 적용 |
| V-04 | 설정 페이지: 이중 패딩 없음 | PageContainer만 패딩 적용 |
| V-05 | 빌드 성공 | `pnpm build` 에러 0건 |
| V-06 | 사이드바/헤더 기능 유지 | layout-sync 결과물 보존 |
