# Plan: ai-webform (AI 웹폼 필드 자동 생성)

## Overview
웹폼 편집 페이지(`/web-forms/[id]`)에서 AI 프롬프트를 입력하면 폼 필드(FormFieldItem[])를 자동 생성하는 기능. 기존 AI 패턴(getAiClient → API → JSON 파싱 → 사용량 로깅)을 따름.

## 현재 상태
- 웹폼 편집: `/web-forms/[id]` — FormBuilder + FormPreview 풀 너비 레이아웃
- FormBuilder: 수동으로 필드 추가 → 라벨/타입/플레이스홀더/필수여부 설정
- AI 인프라: `src/lib/ai.ts` — getAiClient, extractJson, logAiUsage 헬퍼 존재
- 기존 AI 패턴: 제품 생성(`/api/ai/generate-product`), 이메일 생성(`/api/ai/generate-email`) 등

## 기능 범위

### 1. API: `POST /api/ai/generate-webform`
- 입력: `{ prompt: string, workspaceFields?: { key, label }[] }`
- AI에게 프롬프트 + 워크스페이스 필드 목록 제공 → 폼 필드 배열 JSON 생성
- 출력: `{ success: true, data: { title, description, fields: FormFieldItem[] } }`
- `getAiClient` → OpenAI/Anthropic 호출 → `extractJson` → `logAiUsage`
- `purpose: "webform_generation"`

### 2. UI: 편집 페이지에 AI 생성 패널 추가
- 편집 페이지 헤더에 "AI 생성" 버튼 (Sparkles 아이콘)
- 클릭 시 Textarea + "생성" 버튼 표시 (팝오버 또는 인라인)
- 프롬프트 예시: "B2B SaaS 무료 체험 신청 폼 만들어줘"
- 생성 결과로 title/description/fields 상태 업데이트 (기존 필드 대체)
- 기존 필드가 있으면 확인 얼럿 후 대체

### 3. AI 시스템 프롬프트
- 역할: 웹폼 필드 설계 전문가
- 출력 JSON: `{ title, description, fields: [{ label, description, placeholder, fieldType, isRequired, options, linkedFieldKey }] }`
- fieldType 제한: text, email, phone, textarea, select, checkbox, date
- 워크스페이스 필드 목록 제공 → linkedFieldKey 자동 매핑
- 한국어 응답

## 예상 파일

| 유형 | 파일 | 설명 |
|------|------|------|
| 신규 | `src/pages/api/ai/generate-webform.ts` | API 엔드포인트 |
| 신규 | `src/lib/ai.ts` (함수 추가) | `generateWebForm()` + 시스템 프롬프트 |
| 수정 | `src/pages/web-forms/[id].tsx` | AI 생성 버튼 + 프롬프트 UI + 결과 적용 |

## 검증
- `pnpm build` 성공
- AI 프롬프트 입력 → 폼 필드 자동 생성 → FormPreview에 반영
