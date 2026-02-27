# Plan: AI 제품 생성 (ai-product-generation)

## 배경

현재 제품 등록은 사용자가 직접 모든 필드(이름, 소개, 설명, 카테고리, 가격)를 수동 입력해야 한다.
AI를 활용하면 제품명이나 URL만 입력하고 웹 검색을 통해 제품 정보를 자동으로 조사 + 생성할 수 있다.

기존 AI 인프라(`src/lib/ai.ts`, `aiConfigs`, `aiUsageLogs`)를 재사용한다.

## 기능 요구사항

### FR-01: AI 제품 정보 생성
- 사용자가 프롬프트(제품명, URL, 또는 설명 키워드)를 입력
- AI가 **웹 검색**으로 해당 제품/서비스의 최신 정보를 조사
- 조사 결과를 바탕으로 name, summary, description, category, price 자동 생성
- 생성된 내용을 ProductDialog의 각 필드에 자동 채움 → 사용자가 수정 후 저장

### FR-02: 웹 검색 통합
- **Anthropic**: `web_search_20250305` 서버 도구 (Claude가 자동으로 검색 실행)
- **OpenAI**: Chat Completions의 `gpt-4o-search-preview` 모델 (웹 검색 내장)
- 검색 비용: Anthropic $10/1000건, OpenAI는 tool call 비용
- 웹 검색 결과의 출처(URL)를 사용자에게 표시

### FR-03: UI 통합
- ProductDialog에 "AI로 생성" 토글 버튼 추가 (EmailTemplateDialog 패턴 동일)
- AI 패널: 프롬프트 입력 + 생성 버튼
- 생성 결과 → 폼 필드 자동 채움 (name, summary, description, category, price)
- 출처 URL 표시 (웹 검색 결과 기반)

### FR-04: 사용량 로깅
- 기존 `aiUsageLogs` 테이블 재사용, purpose = "product_generation"

## 기술 분석

### 웹 검색 API 구조

**Anthropic (서버 도구 방식)**:
```
POST /v1/messages
tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }]
→ Claude가 자동으로 웹 검색 실행
→ 응답에 citations 포함 (url, title, cited_text)
```

**OpenAI (검색 전용 모델)**:
```
POST /v1/chat/completions
model: "gpt-4o-search-preview"
web_search_options: { user_location: { type: "approximate", country: "KR" } }
→ 응답 annotations에 URL 인라인 포함
```

### 기존 ai.ts 확장 필요
- `callOpenAI`, `callAnthropic` 함수는 현재 이메일 전용
- 범용 AI 호출 함수를 추가하거나, 제품 전용 함수를 별도 추가
- 웹 검색은 provider별로 활성화 방식이 다르므로 분기 처리 필요

### 영향 범위

| 파일 | 변경 |
|------|------|
| `src/lib/ai.ts` | generateProduct 함수 + 웹 검색 통합 추가 |
| `src/pages/api/ai/generate-product.ts` | 신규 API 엔드포인트 |
| `src/hooks/useAiProduct.ts` | 신규 훅 |
| `src/components/products/AiProductPanel.tsx` | 신규 AI 패널 |
| `src/components/products/ProductDialog.tsx` | AI 토글 버튼 추가 |

## 비기능 요구사항

- 웹 검색 max_uses 제한 (Anthropic: 3회, OpenAI: 모델 자체 제어)
- AI 미설정 조직에서는 AI 버튼 미표시
- 타임아웃: 웹 검색 포함 시 최대 30초 허용
- 토큰 사용량 기록 (aiUsageLogs)

## V1 범위

- ProductDialog에서만 AI 제품 생성 지원
- 웹 검색 필수 (제품 정보 조사는 최신 데이터 필요)
- 출처 URL 표시 (Anthropic citations / OpenAI annotations)
- imageUrl은 AI가 찾은 URL이 있으면 채우되, 보장하지 않음
