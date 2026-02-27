# Plan: 워크스페이스 관리 (CRUD)

> **Summary**: 설정 > 워크스페이스 탭에서 워크스페이스 목록 조회, 생성, 수정, 삭제 기능 구현
>
> **Project**: Sales Manager
> **Date**: 2026-02-12
> **Status**: Draft

---

## 1. 개요

### 1.1 목적

설정 페이지의 워크스페이스 탭에서 워크스페이스를 완전히 관리(CRUD)할 수 있도록 확장한다.
현재는 기존 워크스페이스의 이름, 설명, 아이콘만 수정 가능하며, 생성과 삭제가 불가능하다.

### 1.2 배경

- 현재 `WorkspaceSettingsTab.tsx`는 기존 워크스페이스의 속성 수정만 지원
- 워크스페이스 생성은 DB 직접 조작으로만 가능 → 관리자가 UI에서 생성할 수 있어야 함
- 사용하지 않는 워크스페이스를 삭제할 수단이 없음
- settings-page PDCA의 Out-of-Scope에서 "워크스페이스 생성/삭제 기능 (별도 PDCA)"로 명시됨

### 1.3 관련 문서

- Settings Page PDCA: `docs/archive/2026-02/settings-page/`

---

## 2. 범위

### 2.1 In-Scope

- [ ] 워크스페이스 목록 조회 UI (카드/리스트 형태)
- [ ] 워크스페이스 생성 다이얼로그 (이름, 설명, 아이콘)
- [ ] 워크스페이스 수정 폼 (기존 기능 유지 + UI 개선)
- [ ] 워크스페이스 삭제 (확인 다이얼로그 포함)
- [ ] POST `/api/workspaces` (생성 API)
- [ ] DELETE `/api/workspaces/[id]` (삭제 API)
- [ ] `useWorkspaces` 훅 CRUD 확장 (create, delete + mutate)

### 2.2 Out-of-Scope

- 워크스페이스 순서 변경 (드래그&드롭)
- 워크스페이스 복제
- 워크스페이스 아카이브/비활성화
- 워크스페이스별 권한 관리 UI (workspacePermissions 테이블 존재하나 별도 PDCA)
- 워크스페이스 settings JSONB 상세 관리 (defaultVisibleFields, duplicateCheckField)

---

## 3. 요구사항

### 3.1 기능 요구사항

| ID | 요구사항 | 우선순위 | 상태 |
|----|----------|----------|------|
| FR-01 | 워크스페이스 목록을 카드 형태로 조회 (이름, 설명, 아이콘 표시) | P0 | Pending |
| FR-02 | "워크스페이스 추가" 버튼으로 생성 다이얼로그 표시 | P0 | Pending |
| FR-03 | 생성 시 이름(필수), 설명(선택), 아이콘(선택) 입력 | P0 | Pending |
| FR-04 | 카드 클릭 시 수정 폼 표시 (기존 기능) | P0 | Pending |
| FR-05 | 삭제 버튼 클릭 시 확인 다이얼로그 표시 후 삭제 | P0 | Pending |
| FR-06 | 삭제 시 하위 데이터(파티션, 레코드 등) 존재하면 경고 표시 | P1 | Pending |
| FR-07 | owner/admin만 워크스페이스 CRUD 가능 (member 차단) | P0 | Pending |
| FR-08 | 워크스페이스가 1개뿐일 때 삭제 불가 (최소 1개 유지) | P1 | Pending |

### 3.2 비기능 요구사항

| 카테고리 | 기준 | 검증 방법 |
|----------|------|-----------|
| 성능 | 목록 조회 200ms 이내 | 기존 GET /api/workspaces 활용 |
| 보안 | owner/admin 인증 필수 | JWT 기반 role 체크 |
| UX | 삭제 시 이중 확인 (AlertDialog) | 실수로 삭제 방지 |

---

## 4. 사용자 스토리

| ID | 역할 | 스토리 | 우선순위 |
|----|------|--------|----------|
| US-01 | owner/admin | 설정 워크스페이스 탭에서 전체 워크스페이스 목록을 볼 수 있다 | P0 |
| US-02 | owner/admin | "워크스페이스 추가" 버튼으로 새 워크스페이스를 만들 수 있다 | P0 |
| US-03 | owner/admin | 워크스페이스 카드를 클릭해 이름, 설명, 아이콘을 수정할 수 있다 | P0 |
| US-04 | owner/admin | 워크스페이스를 삭제할 수 있다 (확인 후) | P0 |
| US-05 | owner/admin | 하위 데이터가 있는 워크스페이스 삭제 시 경고 메시지를 확인할 수 있다 | P1 |

---

## 5. API 설계 요약

### 기존 API (변경 없음)

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/workspaces` | 워크스페이스 목록 조회 |
| GET | `/api/workspaces/[id]/settings` | 워크스페이스 상세 조회 |
| PATCH | `/api/workspaces/[id]/settings` | 워크스페이스 수정 |

### 신규 API

#### POST `/api/workspaces`
- 인증: JWT (owner/admin)
- Body: `{ name: string, description?: string, icon?: string }`
- 응답: `{ success: true, data: { id, name, description, icon } }`
- 제약: name 필수, 같은 조직 내에서 생성

#### DELETE `/api/workspaces/[id]`
- 인증: JWT (owner/admin)
- 응답: `{ success: true }`
- 제약: 같은 조직의 워크스페이스만 삭제, 최소 1개 유지
- CASCADE: 하위 데이터(partitions, records, fieldDefinitions 등) DB cascade 삭제

---

## 6. UI 구조

### 워크스페이스 탭 (개선 후)

```
/settings?tab=workspace
┌─────────────────────────────────────────────────────┐
│ 설정 > 워크스페이스                                    │
│                                                     │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│ │ 📁       │ │ 📁       │ │ + 추가    │             │
│ │ 영업1팀  │ │ 영업2팀  │ │          │             │
│ │ 영업 1팀 │ │ 영업 2팀 │ │          │             │
│ │ 워크스... │ │ 워크스... │ │          │             │
│ └──────────┘ └──────────┘ └──────────┘             │
│                                                     │
│ ─────────────────── 선택된 워크스페이스 ──────────── │
│                                                     │
│ 이름 *:     [영업1팀                    ]           │
│ 설명:       [영업 1팀 워크스페이스       ]           │
│ 아이콘:     [briefcase                  ]           │
│                                                     │
│ [저장]                              [삭제]          │
└─────────────────────────────────────────────────────┘
```

### 생성 다이얼로그

```
┌─────────────────────────────────────┐
│ 워크스페이스 추가                      │
│                                     │
│ 이름 *:  [                     ]    │
│ 설명:    [                     ]    │
│ 아이콘:  [                     ]    │
│                                     │
│           [취소]  [생성]             │
└─────────────────────────────────────┘
```

### 삭제 확인 다이얼로그

```
┌─────────────────────────────────────┐
│ ⚠️ 워크스페이스 삭제                  │
│                                     │
│ "영업1팀" 워크스페이스를 삭제합니다.    │
│ 하위 파티션, 레코드 등 모든 데이터가    │
│ 영구적으로 삭제됩니다.                 │
│                                     │
│ ⚠ 파티션 3개, 레코드 152개가           │
│    삭제됩니다.  (FR-06)              │
│                                     │
│       [취소]  [삭제] (destructive)   │
└─────────────────────────────────────┘
```

---

## 7. 기술 구현 계획

### 7.1 파일 변경 목록

| 순서 | 파일 | 작업 |
|------|------|------|
| 1 | `src/types/index.ts` | `CreateWorkspaceInput` 타입 추가 |
| 2 | `src/pages/api/workspaces/index.ts` | POST 핸들러 추가 (기존 GET 유지) |
| 3 | `src/pages/api/workspaces/[id]/index.ts` | DELETE 핸들러 (신규 파일) |
| 4 | `src/hooks/useWorkspaces.ts` | createWorkspace, deleteWorkspace, mutate 추가 |
| 5 | `src/components/settings/CreateWorkspaceDialog.tsx` | 생성 다이얼로그 (신규) |
| 6 | `src/components/settings/DeleteWorkspaceDialog.tsx` | 삭제 확인 다이얼로그 (신규) |
| 7 | `src/components/settings/WorkspaceSettingsTab.tsx` | 카드 목록 + 생성/삭제 통합 |

### 7.2 ShadCN UI 컴포넌트

- Card, CardContent, CardHeader (워크스페이스 카드)
- Dialog, DialogContent, DialogHeader, DialogFooter (생성 다이얼로그)
- AlertDialog, AlertDialogContent, AlertDialogAction (삭제 확인)
- Button, Input, Label, Textarea (폼 요소, 기존 사용)

---

## 8. 권한 모델

| 역할 | 목록 조회 | 생성 | 수정 | 삭제 |
|------|:---------:|:----:|:----:|:----:|
| owner | O | O | O | O |
| admin | O | O | O | O |
| member | X (설정 페이지 자체 접근 불가) | X | X | X |

---

## 9. 성공 기준

### Definition of Done

- [ ] 워크스페이스 목록이 카드 형태로 표시됨
- [ ] 새 워크스페이스를 생성할 수 있음
- [ ] 기존 워크스페이스 이름/설명/아이콘 수정 가능
- [ ] 워크스페이스 삭제 가능 (확인 다이얼로그 포함)
- [ ] 최소 1개 워크스페이스 유지 규칙 적용
- [ ] owner/admin만 접근 가능
- [ ] 빌드 성공

---

## 10. 리스크 및 대응

| 리스크 | 영향 | 대응 |
|--------|------|------|
| 워크스페이스 삭제 시 하위 데이터 전체 삭제 | 높 | AlertDialog로 이중 확인 + 하위 데이터 건수 표시 |
| CASCADE 삭제로 대량 레코드 삭제 시 지연 | 중 | DB CASCADE 의존 (schema에서 onDelete: cascade 설정 확인) |
| 사이드바 워크스페이스 목록과 설정 탭 동기화 | 낮 | useWorkspaces SWR mutate로 자동 갱신 |

---

## 11. 다음 단계

1. [ ] Design 문서 작성 (`/pdca design workspace-management`)
2. [ ] 구현
3. [ ] Gap 분석

---

## 버전 이력

| 버전 | 날짜 | 변경사항 | 작성자 |
|------|------|----------|--------|
| 0.1 | 2026-02-12 | 초안 작성 | AI |
