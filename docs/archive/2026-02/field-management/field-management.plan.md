# field-management Planning Document

> **Summary**: 레코드 속성(필드) 관리 — 설정 페이지에서 워크스페이스 필드 CRUD 및 순서 변경
>
> **Project**: sales-manager
> **Version**: 0.1.0
> **Author**: AI
> **Date**: 2026-02-12
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

워크스페이스의 레코드 속성(필드 정의)을 설정 페이지에서 관리할 수 있도록 한다.
현재는 seed 스크립트로만 필드를 생성할 수 있으며, 운영 중 필드 추가/수정/삭제/순서 변경이 불가능하다.

### 1.2 Background

- `field_definitions` 테이블에 스키마가 완비되어 있음 (fieldType, cellType, options, isRequired 등)
- API는 GET만 존재 (`/api/workspaces/[id]/fields`) — POST/PATCH/DELETE 없음
- 설정 페이지(`/settings`)에 워크스페이스/조직/사용자 탭이 있으나 필드 관리 탭이 없음
- 레코드 등록(CreateRecordDialog), 테이블(RecordTable), 인라인 편집(InlineEditCell) 등 모든 레코드 UI가 필드 정의에 의존
- 알림톡 변수 매핑(VariableMappingEditor)도 필드 목록을 참조

### 1.3 Related Documents

- record-page: `docs/archive/2026-02/record-page/`
- DB Schema: `src/lib/db/schema.ts:86-116`
- Types: `src/types/index.ts` — `FieldDefinition`, `FieldType`, `CellType`

---

## 2. Scope

### 2.1 In Scope

- [ ] 설정 페이지에 "속성 관리" 탭 추가
- [ ] 필드 목록 조회 (워크스페이스별)
- [ ] 필드 추가 (이름, 타입, 카테고리, 필수 여부, 옵션 등)
- [ ] 필드 수정 (라벨, 카테고리, 필수 여부, 옵션 등)
- [ ] 필드 삭제 (시스템 필드 보호)
- [ ] 필드 순서 변경 (드래그 없이 위/아래 버튼으로)
- [ ] API 엔드포인트: POST/PATCH/DELETE

### 2.2 Out of Scope

- 드래그 앤 드롭 순서 변경 (별도 PDCA)
- 수식(formula) 필드 편집기 (별도 PDCA)
- 상태 옵션(statusOptionCategory) 관리 (별도 PDCA)
- 파티션별 visibleFields 편집 (별도 PDCA)
- 필드 key 변경 (기존 레코드 데이터와 불일치 위험)

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | 설정 페이지에 "속성 관리" 탭 추가 — 워크스페이스 선택 후 해당 워크스페이스의 필드 목록 표시 | High | Pending |
| FR-02 | 필드 목록 표시 — sortOrder 순으로 라벨, 타입, 카테고리, 필수 여부 표시 | High | Pending |
| FR-03 | 필드 추가 — key(영문), label(한글), fieldType, cellType, category, isRequired, options(select 타입) 입력 | High | Pending |
| FR-04 | 필드 수정 — label, category, isRequired, options, defaultWidth 변경 가능. key/fieldType은 읽기전용 | High | Pending |
| FR-05 | 필드 삭제 — isSystem=true인 시스템 필드는 삭제 불가. 삭제 전 확인 다이얼로그 | High | Pending |
| FR-06 | 순서 변경 — 위/아래 화살표 버튼으로 sortOrder 변경, API로 일괄 업데이트 | Medium | Pending |
| FR-07 | API: POST `/api/workspaces/[id]/fields` — 필드 생성 | High | Pending |
| FR-08 | API: PATCH `/api/fields/[id]` — 필드 수정 | High | Pending |
| FR-09 | API: DELETE `/api/fields/[id]` — 필드 삭제 (isSystem 체크) | High | Pending |
| FR-10 | API: PATCH `/api/workspaces/[id]/fields/reorder` — sortOrder 일괄 업데이트 | Medium | Pending |
| FR-11 | 필드 추가 시 기존 파티션의 visibleFields에 자동 추가 | Medium | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| UX | 필드 CRUD 후 목록 즉시 반영 (SWR mutate) | 수동 테스트 |
| 안전성 | 시스템 필드(integratedCode, registeredAt) 삭제 불가 | 수동 테스트 |
| 안전성 | 필드 삭제 시 확인 다이얼로그 표시 | 수동 테스트 |
| 일관성 | key 중복 검증 (워크스페이스 내 unique) | API 레벨 검증 |

---

## 4. Technical Design Summary

### 4.1 API Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/workspaces/[id]/fields` | 필드 목록 조회 (기존) |
| POST | `/api/workspaces/[id]/fields` | 필드 생성 |
| PATCH | `/api/fields/[id]` | 필드 수정 |
| DELETE | `/api/fields/[id]` | 필드 삭제 |
| PATCH | `/api/workspaces/[id]/fields/reorder` | 순서 일괄 변경 |

### 4.2 UI Design

**위치**: 설정 페이지 > "속성 관리" 탭

```
┌──────────────────────────────────────────────────────┐
│ 설정                                                  │
│ [워크스페이스] [조직] [사용자] [속성 관리]              │
├──────────────────────────────────────────────────────┤
│                                                      │
│ 워크스페이스: [영업 관리 ▼]         [+ 속성 추가]     │
│                                                      │
│ ┌────┬───────────┬──────┬────────┬──────┬─────────┐  │
│ │ 순서│ 라벨      │ key  │ 타입   │ 필수 │ 작업    │  │
│ ├────┼───────────┼──────┼────────┼──────┼─────────┤  │
│ │ ↑↓ │ 통합코드  │ inte.│ text   │      │ 🔒시스템│  │
│ │ ↑↓ │ 등록일    │ regi.│ datet. │      │ 🔒시스템│  │
│ │ ↑↓ │ 진행상태  │ prog.│ select │      │ ✏️ 🗑️  │  │
│ │ ↑↓ │ 상호명    │ comp.│ text   │      │ ✏️ 🗑️  │  │
│ │ ↑↓ │ 대표자명  │ repr.│ text   │      │ ✏️ 🗑️  │  │
│ │ ↑↓ │ 대표 연락처│repr.│ phone  │      │ ✏️ 🗑️  │  │
│ │ ...│           │      │        │      │         │  │
│ └────┴───────────┴──────┴────────┴──────┴─────────┘  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### 4.3 컴포넌트 구조

| Component | Purpose |
|-----------|---------|
| FieldManagementTab (신규) | 속성 관리 탭 — 워크스페이스 선택 + 필드 목록 테이블 |
| CreateFieldDialog (신규) | 필드 생성 다이얼로그 |
| EditFieldDialog (신규) | 필드 수정 다이얼로그 |
| DeleteFieldDialog (신규) | 필드 삭제 확인 다이얼로그 |

### 4.4 Hook 확장

| Hook | Changes |
|------|---------|
| useFields (수정) | mutate 반환 추가 |
| useFieldManagement (신규) | createField, updateField, deleteField, reorderFields |

### 4.5 FieldType → CellType 기본 매핑

필드 추가 시 fieldType 선택에 따라 cellType 자동 설정:

| fieldType | Default cellType |
|-----------|-----------------|
| text | editable |
| number | editable |
| currency | currency |
| date | date |
| datetime | date |
| select | select |
| phone | phone |
| email | email |
| textarea | textarea |
| checkbox | checkbox |
| file | file |

---

## 5. Success Criteria

### 5.1 Definition of Done

- [ ] 설정 페이지에 "속성 관리" 탭 표시
- [ ] 필드 추가/수정/삭제 동작 확인
- [ ] 시스템 필드 삭제 보호 확인
- [ ] 순서 변경 동작 확인
- [ ] `pnpm build` 성공

### 5.2 Quality Criteria

- [ ] Zero lint errors
- [ ] Build succeeds
- [ ] 기존 레코드 페이지 동작에 영향 없음

---

## 6. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| 필드 삭제 시 기존 레코드 데이터 orphan | Medium | High | 삭제 확인 다이얼로그에 경고 표시, 레코드 data는 JSONB이므로 키만 남게 됨 (데이터 손실 없음) |
| key 중복 생성 | Low | Low | DB unique constraint + API 레벨 검증 |
| 필드 추가 후 기존 파티션에 미표시 | Medium | Medium | FR-11: 필드 추가 시 기존 파티션 visibleFields에 자동 추가 |

---

## 7. Architecture Considerations

### 7.1 Project Level

| Level | Selected |
|-------|:--------:|
| **Dynamic** | ✅ |

### 7.2 기존 패턴 준수

| Pattern | Reference |
|---------|-----------|
| SWR Hook + mutate | useWorkspaces.ts, useFields.ts |
| Dialog 패턴 | CreatePartitionDialog, RenameDialog |
| API 응답 형식 | `{ success: boolean, data?, error? }` |
| 권한 체크 | getUserFromRequest + role !== "member" |
| toast 알림 | sonner |
| form onSubmit 패턴 | 최근 수정한 `<form onSubmit>` 패턴 준수 |

---

## 8. Implementation Order

1. API: POST `/api/workspaces/[id]/fields` (필드 생성)
2. API: PATCH/DELETE `/api/fields/[id]` (필드 수정/삭제)
3. API: PATCH `/api/workspaces/[id]/fields/reorder` (순서 변경)
4. Hook: useFields mutate 추가 + useFieldManagement 생성
5. UI: FieldManagementTab (필드 목록 + 순서 변경)
6. UI: CreateFieldDialog
7. UI: EditFieldDialog
8. UI: DeleteFieldDialog
9. 설정 페이지에 "속성 관리" 탭 추가
10. 필드 추가 시 파티션 visibleFields 자동 추가 (FR-11)
11. Build 검증

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-02-12 | Initial draft | AI |
