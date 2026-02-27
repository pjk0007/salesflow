# layout-fix Planning Document

> **Summary**: layout-sync 이후 망가진 페이지 UI/기능 복구 (레코드 페이지 중심)
>
> **Project**: Sales Manager
> **Version**: 0.1.0
> **Author**: AI
> **Date**: 2026-02-13
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

layout-sync PDCA 사이클에서 Adion 프로젝트의 레이아웃(사이드바, 헤더, DashboardShell)을 가져오면서 기존 페이지의 UI와 기능이 깨졌다. 특히 레코드 페이지(`/`)가 완전히 작동하지 않으며, 다른 페이지들도 기존 레이아웃과 새 DashboardShell 간의 구조 충돌이 발생했다.

### 1.2 Background

- layout-sync에서 DashboardShell 도입: `h-screen` flex 레이아웃 + `main` 영역에 `p-4 sm:p-6` 패딩과 `max-w-7xl` wrapper 추가
- 레코드 페이지(`/`)는 전체 높이를 사용하는 2패널 레이아웃 (좌: PartitionNav w-60 + 우: RecordTable flex-1)인데, DashboardShell의 `main` 패딩과 `max-w-7xl` wrapper가 이 구조와 충돌
- 알림톡/설정 페이지는 자체적으로 `p-6` 패딩을 적용하고 있어 DashboardShell의 `p-4 sm:p-6`과 이중 패딩 발생

### 1.3 Related Documents

- Archive: `docs/archive/2026-02/layout-sync/`
- Dashboard Shell: `src/components/dashboard/dashboard-shell.tsx`

---

## 2. Scope

### 2.1 In Scope

- [x] FR-01: 레코드 페이지(`/`) 전체 높이 레이아웃 복구
- [x] FR-02: DashboardShell main 영역 구조 수정 (패딩/wrapper 충돌 해결)
- [x] FR-03: 알림톡/설정 페이지 이중 패딩 제거
- [x] FR-04: PageContainer/PageHeader 공통 컴포넌트 적용
- [x] FR-05: 레코드 테이블 스크롤 동작 정상화

### 2.2 Out of Scope

- DashboardShell/사이드바/헤더 자체의 구조 변경 (layout-sync 결과물 유지)
- 새로운 기능 추가
- API/DB 변경

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | 레코드 페이지: PartitionNav(w-60) + RecordTable(flex-1) 2패널 레이아웃이 DashboardShell 내에서 전체 높이를 차지해야 함 | High | Pending |
| FR-02 | DashboardShell: children이 전체 높이를 사용할 수 있도록 main 영역 구조 수정. 패딩은 페이지별로 제어 | High | Pending |
| FR-03 | 알림톡/설정 페이지: 이중 패딩 제거. PageContainer 사용으로 통일 | Medium | Pending |
| FR-04 | PageContainer/PageHeader를 모든 일반 페이지에 적용 (알림톡, 설정) | Medium | Pending |
| FR-05 | RecordTable: 스크롤 영역이 main 영역 내에서 올바르게 작동 | High | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| 호환성 | 빌드 에러 0건 | `pnpm build` |
| UI 일관성 | Adion과 동일한 레이아웃 구조 유지 | 시각적 비교 |

---

## 4. Problem Analysis

### 4.1 레코드 페이지 (`/`) — 핵심 문제

**현재 구조:**
```
DashboardShell
  └─ div.flex.h-screen
      ├─ DesktopSidebar
      └─ div.flex.flex-1.flex-col.overflow-hidden
          ├─ Header (h-14)
          └─ main.flex-1.overflow-y-auto.p-4.sm:p-6.bg-muted/30
              └─ div.mx-auto.max-w-7xl     ← 문제 1: max-w 제한
                  └─ index.tsx children
                      └─ div.flex.h-full   ← 문제 2: h-full이 auto 높이 부모에서 무의미
                          ├─ PartitionNav (w-60, flex flex-col)
                          └─ RecordArea (flex-1)
```

**문제점:**
1. `max-w-7xl` wrapper: 레코드 페이지는 전체 폭을 사용해야 하는데 1280px로 제한됨
2. `h-full` 미전파: `max-w-7xl` div의 높이가 auto(내용 기반)이므로 자식의 `h-full`이 작동 안 함
3. `p-4 sm:p-6` 패딩: 레코드 페이지 자체가 패딩 없이 전체 영역을 써야 함
4. `overflow-y-auto`: main에 스크롤이 있는데, 레코드 페이지 내부에도 자체 스크롤 영역이 있어 충돌

### 4.2 알림톡/설정 페이지

**현재 구조:**
```
main.p-4.sm:p-6          ← DashboardShell 패딩
  └─ div.max-w-7xl
      └─ div.p-6          ← 페이지 자체 패딩 (이중)
          ├─ h1, p
          └─ Tabs
```

**문제점:**
- 이중 패딩 (DashboardShell p-6 + 페이지 p-6 = 실질 p-12)
- PageContainer/PageHeader 미사용으로 일관성 부족

### 4.3 해결 전략

**접근법: DashboardShell의 main 영역을 심플하게 변경**

- `main`에서 패딩과 `max-w-7xl` wrapper를 제거
- 각 페이지가 `PageContainer`를 사용해 자체 패딩/max-width 제어
- 레코드 페이지처럼 전체 높이/폭이 필요한 경우 패딩 없이 바로 사용

**변경 후 구조:**
```
DashboardShell
  └─ main.flex-1.overflow-y-auto.bg-muted/30
      └─ {children}  ← 패딩/max-width 없이 바로 전달

일반 페이지 (알림톡, 설정):
  └─ PageContainer (p-4 sm:p-6 + max-w-7xl + mx-auto)
      └─ PageHeader + 콘텐츠

레코드 페이지:
  └─ div.flex.h-full  ← main이 flex-1이므로 h-full 작동
      ├─ PartitionNav
      └─ RecordArea
```

---

## 5. Success Criteria

### 5.1 Definition of Done

- [x] 레코드 페이지: 2패널 레이아웃이 전체 높이로 동작
- [x] 레코드 테이블: 내부 스크롤이 정상 작동
- [x] 알림톡/설정 페이지: 이중 패딩 없이 정상 표시
- [x] 빌드 에러 0건
- [x] 사이드바/헤더 기능 유지 (layout-sync 결과물 보존)

### 5.2 Quality Criteria

- [x] Zero lint errors
- [x] Build succeeds
- [x] 모든 페이지에서 반응형 동작 유지

---

## 6. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| DashboardShell 변경이 다른 페이지에 영향 | Medium | Medium | 모든 페이지 확인 후 수정 |
| 레코드 페이지 높이 계산 실패 | High | Low | flex 기반으로 h-full 체인 검증 |

---

## 7. Implementation Files

| File | Action | Description |
|------|--------|-------------|
| `src/components/dashboard/dashboard-shell.tsx` | 수정 | main에서 패딩/max-w-7xl wrapper 제거 |
| `src/components/common/page-container.tsx` | 수정 | p-4 sm:p-6 + max-w-7xl 패딩 추가 |
| `src/pages/index.tsx` | 수정 | h-full 레이아웃 확인, 불필요한 wrapper 제거 |
| `src/pages/alimtalk.tsx` | 수정 | PageContainer/PageHeader 적용, 자체 p-6 제거 |
| `src/pages/settings.tsx` | 수정 | PageContainer/PageHeader 적용, 자체 p-6 제거 |

---

## 8. Next Steps

1. [x] Design 문서 작성 (`layout-fix.design.md`)
2. [x] 구현
3. [x] Gap 분석

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-02-13 | Initial draft | AI |
