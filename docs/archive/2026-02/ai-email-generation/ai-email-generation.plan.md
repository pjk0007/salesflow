# Plan: AI 이메일 생성 (ai-email-generation)

## 개요

AI를 활용하여 레코드(고객) 정보와 제품 카탈로그를 기반으로 맞춤형 이메일 본문을 자동 생성하는 기능.
사용자는 간단한 지시(프롬프트)만 입력하면 AI가 수신자 정보, 제품 정보를 조합하여 마케팅/영업 이메일을 작성한다.

## 배경

- **ai-config**: 조직별 AI API 키 설정 완료 (OpenAI/Anthropic)
- **product-catalog**: 제품/서비스 정보 저장 완료 (name, summary, description, price)
- **email 시스템**: NHN Cloud Email API 연동, 템플릿 + 변수 치환 + 수동/자동 발송 구현 완료
- 현재: 사용자가 HTML 이메일 템플릿을 직접 작성해야 함 → AI로 자동 생성

## 기능 요구사항

### FR-01: AI 이메일 생성 API
- POST /api/ai/generate-email
- 입력: prompt (사용자 지시), productId (선택), recordId (선택), tone (선택)
- 출력: subject (제목), htmlBody (HTML 본문)
- AI가 조직의 제품 정보 + 레코드 데이터를 컨텍스트로 사용
- ai_configs에서 provider/apiKey/model 조회 → 해당 AI API 호출

### FR-02: 이메일 템플릿 다이얼로그에 AI 생성 버튼 추가
- 기존 EmailTemplateDialog에 "AI로 생성" 버튼 추가
- 클릭 시 AI 생성 패널 표시:
  - 프롬프트 입력 (Textarea): "신규 고객에게 제품 소개 이메일을 작성해줘"
  - 제품 선택 (Select, 선택): product-catalog에서 선택
  - 톤 선택 (Select, 선택): 공식적 / 친근한 / 전문적
- AI 생성 결과 → subject, htmlBody 필드에 자동 채움
- 사용자가 수정 후 저장

### FR-03: 레코드 발송 다이얼로그에 AI 생성 옵션
- 기존 SendEmailDialog에 "AI 이메일 직접 작성" 모드 추가
- 템플릿 선택 대신 AI로 일회성 이메일 생성 → 바로 발송
- 선택된 레코드 정보를 AI 컨텍스트에 포함

### FR-04: AI 사용량 로깅
- ai_usage_logs 테이블에 호출 기록 저장
- orgId, userId, model, promptTokens, completionTokens, purpose, createdAt
- 설정 페이지에서 간단한 사용량 표시 (이번 달 총 토큰 수)

## 기술 설계

### AI 호출 서버사이드 유틸리티
```
src/lib/ai.ts:
  - getAiClient(orgId): ai_configs 조회 → OpenAI/Anthropic 클라이언트 반환
  - generateEmail(client, { prompt, product, record, tone }): 이메일 생성
  - 시스템 프롬프트: 영업 이메일 전문가 역할, 제품/수신자 정보 포함
```

### DB 스키마 (ai_usage_logs)
```
ai_usage_logs:
  id: serial PK
  orgId: uuid FK NOT NULL
  userId: uuid FK NOT NULL
  provider: varchar(50) NOT NULL
  model: varchar(100) NOT NULL
  promptTokens: integer NOT NULL
  completionTokens: integer NOT NULL
  purpose: varchar(50) NOT NULL — "email_generation"
  createdAt: timestamptz DEFAULT now()
```

### 시스템 프롬프트 구조
```
당신은 B2B 영업/마케팅 이메일 전문가입니다.
다음 정보를 기반으로 이메일을 작성해주세요.

[제품 정보]
- 이름: {product.name}
- 소개: {product.summary}
- 상세: {product.description}
- 가격: {product.price}

[수신자 정보] (있는 경우)
- 이름: {record.name}
- 회사: {record.company}
...

[톤] {tone}

사용자 지시: {prompt}

JSON 형식으로 응답:
{ "subject": "이메일 제목", "htmlBody": "<html>...</html>" }
```

## 구현 파일

| # | 파일 | 작업 |
|---|------|------|
| 1 | `src/lib/db/schema.ts` | aiUsageLogs 테이블 추가 |
| 2 | `src/lib/ai.ts` | AI 클라이언트 유틸리티 (신규) |
| 3 | `src/pages/api/ai/generate-email.ts` | AI 이메일 생성 API (신규) |
| 4 | `src/hooks/useAiEmail.ts` | AI 이메일 생성 SWR 훅 (신규) |
| 5 | `src/components/email/AiEmailPanel.tsx` | AI 생성 패널 컴포넌트 (신규) |
| 6 | `src/components/email/EmailTemplateDialog.tsx` | AI 생성 버튼 추가 (수정) |
| 7 | `src/components/records/SendEmailDialog.tsx` | AI 직접 작성 모드 추가 (수정) |

## 구현 순서
1. DB 스키마 (ai_usage_logs) + db:push
2. AI 유틸리티 (src/lib/ai.ts)
3. API 엔드포인트 (generate-email)
4. SWR 훅
5. AI 생성 패널 컴포넌트
6. EmailTemplateDialog 통합
7. SendEmailDialog 통합

## 의존성
- ai-config (완료): AI API 키 설정
- product-catalog (완료): 제품 정보 조회
- email 시스템 (완료): 이메일 템플릿/발송

## 검증
- `pnpm build` 성공
- AI 이메일 생성 → subject + htmlBody 반환 확인
- 생성된 내용이 제품 정보를 반영하는지 확인
- ai_usage_logs에 기록 확인
- AI 미설정 시 적절한 에러 메시지
