# Plan: 이메일 템플릿 편집 페이지 (email-template-page)

## 배경
현재 이메일 템플릿 생성/편집이 다이얼로그(`EmailTemplateDialog`)로 구현되어 있다.
`max-w-[95vw] h-[90vh]`로 풀스크린에 가깝지만, 다이얼로그 특성상 브라우저 너비 제한이 있고 overlay 위에 떠 있어 불편함.
→ 별도 페이지(`/email/templates/new`, `/email/templates/[id]`)로 전환하여 전체 화면을 활용.

## 변경 범위

### 변경 파일 3개

#### 1. `src/pages/email/templates/new.tsx` — 신규 생성 페이지
- EmailTemplateDialog의 UI 로직을 페이지로 이동
- WorkspaceLayout 적용 (사이드바 유지)
- 저장 후 `/email` (templates 탭)으로 이동
- 뒤로가기 버튼

#### 2. `src/pages/email/templates/[id].tsx` — 편집 페이지
- URL 파라미터 `id`로 기존 템플릿 로드
- `useEmailTemplates()`에서 단일 템플릿 가져오기 또는 전용 API
- 나머지 UI는 new.tsx와 동일 (공통 컴포넌트 추출)

#### 3. `src/components/email/EmailTemplateList.tsx` — 라우팅 변경
- "새 템플릿" 버튼: `router.push("/email/templates/new")`
- 편집 버튼: `router.push(`/email/templates/${template.id}`)`
- EmailTemplateDialog import 및 사용 제거

### 삭제 가능 파일
- `src/components/email/EmailTemplateDialog.tsx` — 페이지로 대체되므로 삭제

### 공통 컴포넌트 추출 (선택)
- `src/components/email/EmailTemplateEditor.tsx` — new/[id] 페이지에서 공유하는 편집기 컴포넌트
  - 기존 EmailTemplateDialog의 Body 부분 (메타 정보 + AI 패널 + visual/code 에디터 + 미리보기)
  - Props: `{ template?, onSave, onCancel }`

## 구현 순서

| # | 작업 | 검증 |
|---|------|------|
| 1 | EmailTemplateEditor 공통 컴포넌트 추출 | 타입 에러 없음 |
| 2 | `/email/templates/new.tsx` 페이지 | 빌드 확인 |
| 3 | `/email/templates/[id].tsx` 페이지 | 빌드 확인 |
| 4 | EmailTemplateList 라우팅 변경 | 빌드 확인 |
| 5 | EmailTemplateDialog 삭제 | `pnpm build` 성공 |

## 검증
- `pnpm build` 성공
- 새 템플릿 → `/email/templates/new` 페이지 로드
- 기존 템플릿 편집 → `/email/templates/[id]` 페이지 로드
- 저장 후 `/email` 페이지로 복귀
