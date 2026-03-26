# Plan: 속성별 정렬 가능 스위치

## 개요

워크스페이스 속성 관리 다이얼로그(EditFieldDialog)에 **"정렬 가능"** 스위치를 추가하여,
해당 스위치가 켜진 필드만 레코드 테이블(RecordTable)에서 컬럼 헤더 클릭으로 소팅이 가능하도록 한다.

## 배경

- 현재 RecordTable에서는 "통합코드" 컬럼만 정렬 가능
- 나머지 동적 필드(displayFields)는 정렬 UI(아이콘/클릭)가 없음
- 속성마다 정렬 의미가 없는 경우도 있으므로(파일, 장문텍스트 등), 관리자가 선택적으로 정렬을 활성화할 수 있어야 함

## 요구사항

### FR-01: DB 스키마에 `isSortable` 컬럼 추가
- `field_definitions` 테이블에 `is_sortable` integer 컬럼 추가 (default: 0)
- 마이그레이션 생성 및 적용

### FR-02: 타입/API 업데이트
- `FieldDefinition` 인터페이스에 `isSortable: boolean` 추가
- `UpdateFieldInput` 인터페이스에 `isSortable?: boolean` 추가
- GET `/api/workspaces/[id]/fields` 응답에 `isSortable` 포함
- PATCH `/api/fields/[id]`에서 `isSortable` 업데이트 지원

### FR-03: EditFieldDialog에 정렬 가능 스위치 추가
- "필수 항목" 체크박스 아래에 Switch 컴포넌트로 "정렬 가능" 토글 추가
- 기존 필드의 `isSortable` 값을 초기값으로 로드
- 저장 시 `isSortable` 값을 API로 전송

### FR-04: RecordTable에서 정렬 가능 필드만 소팅 UI 표시
- `field.isSortable === true`인 필드만 헤더에 정렬 아이콘 표시 및 클릭 핸들러 연결
- `isSortable === false`인 필드는 기존처럼 라벨만 표시 (클릭 불가)

### FR-05: FieldManagementTab 속성 목록에 정렬 가능 표시
- 속성 목록 테이블에 "정렬" 컬럼 추가 (필수 컬럼 옆)
- 정렬 가능 여부를 시각적으로 표시

## 영향 범위

| 레이어 | 파일 | 변경 내용 |
|--------|------|-----------|
| DB | `src/lib/db/schema.ts` | `isSortable` 컬럼 추가 |
| DB | 마이그레이션 파일 | ALTER TABLE 마이그레이션 |
| 타입 | `src/types/index.ts` | `FieldDefinition`, `UpdateFieldInput` 수정 |
| API | `src/app/api/workspaces/[id]/fields/route.ts` | GET 응답에 포함 |
| API | `src/app/api/fields/[id]/route.ts` | PATCH에서 업데이트 지원 |
| UI | `src/components/settings/EditFieldDialog.tsx` | Switch 추가 |
| UI | `src/components/settings/FieldManagementTab.tsx` | 정렬 컬럼 표시 |
| UI | `src/components/records/RecordTable.tsx` | 조건부 정렬 UI |

## 비기능 요구사항

- 기존 필드의 `isSortable` 기본값은 0(false)으로 하여 기존 동작 유지
- 통합코드 컬럼은 기존처럼 항상 정렬 가능 (속성 스위치와 무관)
