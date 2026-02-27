# Plan: webform-ux (웹 폼 UI/UX 개선)

## Overview
웹 폼 편집을 다이얼로그(max-w-6xl)에서 전용 페이지로 전환. 좁은 다이얼로그에서 FormBuilder + FormPreview를 억지로 grid-cols-2로 배치하던 구조를 넓은 페이지 레이아웃으로 개선.

## 현재 문제점
1. **편집 다이얼로그 너비 부족**: `max-w-6xl max-h-[90vh]` 다이얼로그 안에서 FormBuilder + FormPreview를 grid-cols-2로 배치 → 각 패널이 좁아서 필드 편집이 불편
2. **상태 관리 복잡**: `web-forms.tsx` 페이지에 `fb*` 상태 15개가 뒤섞여 있음
3. **생성 후 편집 흐름 단절**: 생성 다이얼로그에서 생성 → 바로 편집 다이얼로그 오픈 → URL 변경 없음 → 새로고침 시 편집 상태 소실

## 변경 범위

### 1. 새 페이지: `/web-forms/new` (생성)
- 생성 다이얼로그 제거 → 전용 페이지
- WorkspaceLayout 안에서 폼 이름, 제목, 파티션 선택 후 생성
- 생성 후 `/web-forms/[id]` 편집 페이지로 router.push

### 2. 새 페이지: `/web-forms/[id]` (편집)
- 편집 다이얼로그 제거 → 전용 페이지
- 풀 너비 레이아웃: 좌측 FormBuilder (flex-1) + 우측 FormPreview (w-[400px] sticky)
- 상단 헤더: 뒤로가기 + 폼 이름 + 저장 버튼 + 임베드/링크 버튼
- 모든 `fb*` 상태를 이 페이지로 이동
- API로 폼 데이터 fetch → 상태 초기화

### 3. 관리 페이지 정리: `/web-forms` (목록)
- 편집 다이얼로그 관련 코드 전부 제거 (`editFormId`, `fb*` 상태, `loadFormForEdit`, `handleSave` 등)
- 생성 다이얼로그 제거 → "새 폼 만들기" 버튼은 `/web-forms/new`로 Link
- 카드 편집 버튼: `router.push(/web-forms/${id})`로 변경
- 임베드 다이얼로그는 유지 (작은 다이얼로그로 적합)

### 4. FormBuilder 컴포넌트 유지
- 기존 props 인터페이스 그대로 재사용
- 변경 없음

### 5. FormPreview 컴포넌트 유지
- 기존 그대로 재사용
- 변경 없음

## 예상 파일

| 유형 | 파일 | 설명 |
|------|------|------|
| 신규 | `src/pages/web-forms/new.tsx` | 생성 페이지 |
| 신규 | `src/pages/web-forms/[id].tsx` | 편집 페이지 |
| 수정 | `src/pages/web-forms.tsx` → `src/pages/web-forms/index.tsx` | 목록 페이지 (다이얼로그 제거, 라우팅 변경) |
| 유지 | `src/components/web-forms/FormBuilder.tsx` | 변경 없음 |
| 유지 | `src/components/web-forms/FormPreview.tsx` | 변경 없음 |
| 유지 | `src/components/web-forms/EmbedCodeDialog.tsx` | 변경 없음 |

## 검증
- `pnpm build` 성공
- 폼 목록 → 생성 → 편집 → 저장 흐름 정상 동작
