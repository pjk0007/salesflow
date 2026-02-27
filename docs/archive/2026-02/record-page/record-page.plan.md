# record-page Planning Document

> **Summary**: 레코드 페이지 개선 — 파티션 관리(CRUD) 추가 + "0" 버그 수정
>
> **Project**: sales-manager
> **Version**: 0.1.0
> **Author**: AI
> **Date**: 2026-02-12
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

레코드 페이지의 완성도를 높이기 위한 개선 작업:
1. **파티션 CRUD 관리** — 현재 파티션 조회만 가능하고 생성/수정/삭제가 없음
2. **"0" 렌더링 버그 수정** — 필드 라벨 옆에 "0"이 표시되는 React 조건부 렌더링 버그

### 1.2 Background

- 워크스페이스는 설정 탭에서 CRUD가 완성됨 (workspace-management)
- 그러나 파티션은 seed 스크립트로만 생성 가능하며 UI에서 관리할 수 없음
- 레코드 등록 다이얼로그에서 `{field.isRequired && <span>*</span>}` 패턴이 DB의 integer(0) 값을 "0" 텍스트로 렌더링하는 버그 존재

### 1.3 관련 버그: "진행상태0" "상호명0" 원인 분석

**근본 원인**: `field_definitions.is_required` 컬럼이 PostgreSQL integer 타입 (0/1)

**발생 위치**: `CreateRecordDialog.tsx:197`
```tsx
{field.isRequired && (
    <span className="text-destructive ml-1">*</span>
)}
```

**메커니즘**:
- API가 DB의 raw integer 값(`0`)을 변환 없이 반환
- React에서 `{0 && <JSX>}` → 숫자 `0`을 텍스트로 렌더링
- 결과: "진행상태" + "0" → "진행상태0"

**수정 방법**: `{field.isRequired && ...}` → `{!!field.isRequired && ...}` 또는 `{field.isRequired ? ... : null}`

---

## 2. Scope

### 2.1 In Scope

- [ ] "0" 렌더링 버그 수정 (CreateRecordDialog)
- [ ] 파티션 생성 기능 (API + UI)
- [ ] 파티션 수정 기능 (이름, 설정)
- [ ] 파티션 삭제 기능 (하위 레코드 경고)
- [ ] 폴더 생성/삭제 기능 (파티션 그룹핑)
- [ ] 파티션 관리 UI 위치: 레코드 페이지 좌측 PartitionNav에 통합

### 2.2 Out of Scope

- 파티션 간 레코드 이동
- 파티션 권한 관리 (partitionPermissions)
- 필드 정의 관리 (별도 PDCA)
- 파티션 설정 상세 (visibleFields, distributionOrder, duplicateCheckField — 별도 PDCA)

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | "0" 렌더링 버그 수정 — isRequired/isSystem integer 값이 JSX에서 "0" 텍스트로 표시되는 문제 | High | Pending |
| FR-02 | 파티션 생성 — 이름 입력으로 새 파티션 생성 (폴더 선택 가능) | High | Pending |
| FR-03 | 파티션 이름 수정 — 인라인 또는 다이얼로그로 파티션 이름 변경 | Medium | Pending |
| FR-04 | 파티션 삭제 — 하위 레코드 수 경고 후 삭제 (최소 1개 보호) | High | Pending |
| FR-05 | 폴더 생성 — 파티션을 그룹핑할 폴더 생성 | Medium | Pending |
| FR-06 | 폴더 삭제 — 빈 폴더 삭제 (하위 파티션은 미분류로 이동) | Medium | Pending |
| FR-07 | PartitionNav에 관리 UI 통합 — 컨텍스트 메뉴(우클릭)로 수정/삭제 접근 | High | Pending |
| FR-08 | 파티션 생성 시 기본 visibleFields 설정 — 워크스페이스의 전체 필드를 기본 할당 | Low | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| Performance | 파티션 트리 렌더링 < 100ms | 브라우저 DevTools |
| UX | 파티션 CRUD 작업 후 트리 즉시 갱신 (SWR mutate) | 수동 테스트 |
| 안전성 | 삭제 시 하위 레코드 수 표시 및 확인 | 수동 테스트 |

---

## 4. Technical Design Summary

### 4.1 API Routes

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/workspaces/[id]/partitions` | 파티션 생성 |
| PATCH | `/api/partitions/[id]` | 파티션 수정 |
| DELETE | `/api/partitions/[id]` | 파티션 삭제 |
| POST | `/api/workspaces/[id]/folders` | 폴더 생성 |
| DELETE | `/api/folders/[id]` | 폴더 삭제 |

### 4.2 UI Design

**파티션 관리 위치**: 레코드 페이지 좌측 PartitionNav

```
┌─────────────────────────────────┐
│ [워크스페이스 선택 ▼]           │
├─────────────────────────────────┤
│ [+ 새 폴더]  [+ 새 파티션]     │
│                                 │
│ 📂 영업팀           [⋯]        │
│   📄 신규 고객       [⋯]       │
│   📄 기존 고객       [⋯]       │
│                                 │
│ 📂 지원팀           [⋯]        │
│   📄 AS 접수         [⋯]       │
│                                 │
│ 📄 전체 고객         [⋯]       │ ← 미분류
│                                 │
│ "파티션이 없습니다"  (빈 상태)   │
└─────────────────────────────────┘

[⋯] 클릭 시:
  - 이름 변경
  - 삭제
```

### 4.3 컴포넌트 구조

| Component | Purpose |
|-----------|---------|
| PartitionNav (수정) | 생성/관리 버튼 추가, 컨텍스트 메뉴 추가 |
| CreatePartitionDialog (신규) | 파티션 생성 다이얼로그 |
| CreateFolderDialog (신규) | 폴더 생성 다이얼로그 |
| RenameDialog (신규) | 이름 변경 다이얼로그 (파티션/폴더 공용) |
| DeletePartitionDialog (신규) | 파티션 삭제 확인 (레코드 수 표시) |

### 4.4 Hook 확장

| Hook | Changes |
|------|---------|
| usePartitions (수정) | createPartition, deletePartition, createFolder, deleteFolder, renamePartition, renameFolder, mutate 추가 |

---

## 5. Success Criteria

### 5.1 Definition of Done

- [ ] "0" 버그 수정 완료
- [ ] 파티션 CRUD 동작 확인
- [ ] 폴더 CRUD 동작 확인
- [ ] PartitionNav 관리 UI 통합
- [ ] `pnpm build` 성공

### 5.2 Quality Criteria

- [ ] Zero lint errors
- [ ] Build succeeds
- [ ] 삭제 시 안전 장치 (레코드 수 경고, 최소 1개 파티션 보호 없음 — 0개 가능)

---

## 6. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| 파티션 삭제 시 CASCADE로 레코드 대량 삭제 | High | Medium | 삭제 전 레코드 수 표시 및 2단계 확인 |
| PartitionNav 복잡도 증가 | Medium | Medium | 컨텍스트 메뉴로 관리 기능 분리 |
| 폴더 삭제 시 하위 파티션 처리 | Medium | Low | 하위 파티션을 미분류(folderId=null)로 이동 |

---

## 7. Architecture Considerations

### 7.1 Project Level

| Level | Selected |
|-------|:--------:|
| **Dynamic** | ✅ |

### 7.2 기존 패턴 준수

| Pattern | Reference |
|---------|-----------|
| SWR Hook + mutate | useWorkspaces.ts |
| Dialog/AlertDialog | CreateWorkspaceDialog, DeleteWorkspaceDialog |
| API 응답 형식 | `{ success: boolean, data?, error? }` |
| 권한 체크 | getUserFromRequest + role !== "member" |
| toast 알림 | sonner |

---

## 8. Implementation Order

1. FR-01: "0" 버그 수정 (1분)
2. API: 파티션 CRUD + 폴더 CRUD 엔드포인트
3. Hook: usePartitions 확장
4. UI: CreatePartitionDialog, CreateFolderDialog
5. UI: RenameDialog (공용)
6. UI: DeletePartitionDialog
7. UI: PartitionNav 관리 기능 통합
8. Build 검증

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-02-12 | Initial draft | AI |
