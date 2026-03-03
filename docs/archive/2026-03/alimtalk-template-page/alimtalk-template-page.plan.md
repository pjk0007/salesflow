# Plan: alimtalk-template-page

## 요약
알림톡 템플릿 생성/수정을 다이얼로그에서 전용 페이지로 전환하고, AI 템플릿 생성 기능을 추가한다.

## 현재 상태
- 템플릿 생성/수정: `TemplateCreateDialog` 다이얼로그 (max-w-5xl, 2-column layout)
- 템플릿 목록: `TemplateList` 컴포넌트 (alimtalk 페이지 내 탭)
- AI 생성: 없음 (이메일은 `AiEmailPanel` + `/api/ai/generate-email`로 구현됨)
- 템플릿은 NHN Cloud API에 저장 (로컬 DB 테이블 없음)

## 변경 사항

### 1. 템플릿 생성 페이지 (`/alimtalk/templates/new`)
- `TemplateCreateDialog` → 전용 페이지로 전환
- 이메일 템플릿 패턴 참고: `/email/templates/new/page.tsx`
- 레이아웃: 좌측 폼 (`TemplateFormEditor`) + 우측 미리보기 (`TemplatePreview`) — 기존 2-column 유지
- senderKey는 query param으로 전달 (`/alimtalk/templates/new?senderKey=xxx`)
- 저장 후 `/alimtalk?tab=templates`로 이동

### 2. 템플릿 수정 페이지 (`/alimtalk/templates/[templateCode]`)
- URL: `/alimtalk/templates/{templateCode}?senderKey=xxx`
- NHN API에서 기존 템플릿 fetch → 폼 pre-fill
- 동일한 `TemplateFormEditor` + `TemplatePreview` 레이아웃

### 3. AI 템플릿 생성 기능
- **API**: `POST /api/ai/generate-alimtalk` — 기존 `generateEmail` 패턴 참고
- **프롬프트 입력**: 폼 상단에 AI 생성 영역 (Popover 또는 collapsible)
  - 입력: 자연어 프롬프트 ("새 상품 출시 안내 알림톡 만들어줘")
  - 선택: 제품 (products 테이블), 톤
- **AI 출력 → 폼 자동 채움**:
  - templateName, templateContent, templateMessageType
  - buttons (optional)
- **제약**: NHN 알림톡 1300자 제한, `#{변수명}` 변수 문법
- **시스템 프롬프트**: 카카오 알림톡 전문가 역할, JSON 응답 포맷
- **Provider**: OpenAI / Anthropic (기존 `getAiClient()` 재사용)

### 4. TemplateList 수정
- "템플릿 등록" 버튼 → `router.push('/alimtalk/templates/new?senderKey=...')`
- "수정" 메뉴 → `router.push('/alimtalk/templates/{code}?senderKey=...')`
- `TemplateCreateDialog` import 제거

## 파일 변경 목록

| # | 파일 | 작업 |
|---|------|------|
| 1 | `src/app/alimtalk/templates/new/page.tsx` | 새 파일 — 생성 페이지 |
| 2 | `src/app/alimtalk/templates/[templateCode]/page.tsx` | 새 파일 — 수정 페이지 |
| 3 | `src/app/api/ai/generate-alimtalk/route.ts` | 새 파일 — AI 생성 API |
| 4 | `src/lib/ai.ts` | `generateAlimtalk()` 함수 추가 |
| 5 | `src/components/alimtalk/AiAlimtalkPanel.tsx` | 새 파일 — AI 프롬프트 입력 UI |
| 6 | `src/components/alimtalk/TemplateList.tsx` | 버튼 클릭 → 페이지 이동으로 변경 |
| 7 | `src/components/alimtalk/TemplateCreateDialog.tsx` | 삭제 (페이지로 대체) |

## 구현 순서

| # | 작업 | 검증 |
|---|------|------|
| 1 | `ai.ts`에 `generateAlimtalk()` 추가 | 타입 에러 없음 |
| 2 | `/api/ai/generate-alimtalk` API | 타입 에러 없음 |
| 3 | `AiAlimtalkPanel` 컴포넌트 | — |
| 4 | `/alimtalk/templates/new` 생성 페이지 | — |
| 5 | `/alimtalk/templates/[templateCode]` 수정 페이지 | — |
| 6 | `TemplateList` 수정 + `TemplateCreateDialog` 삭제 | — |
| 7 | `pnpm build` 통과 | 빌드 성공 |

## 검증
- `pnpm build` 성공
- 템플릿 생성 페이지에서 수동 작성 → NHN API 등록 성공
- AI 프롬프트 → 폼 자동 채움 → 수정 후 등록
- 수정 페이지에서 기존 템플릿 로드 → 수정 → 저장
