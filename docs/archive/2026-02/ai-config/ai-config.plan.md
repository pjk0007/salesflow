# Plan: AI 설정 (ai-config)

## 개요

조직 설정에 AI API 키를 저장하여 AI 모델(OpenAI, Anthropic 등)을 사용할 수 있도록 하는 기능.
향후 AI 이메일 생성, AI 레코드 요약 등 AI 기반 기능의 기반 인프라.

## 배경

- 제품 카탈로그(product-catalog)가 완성되어 AI 이메일 작성 시 참고할 제품 정보가 준비됨
- AI 기능을 사용하려면 조직별로 API 키를 설정해야 함
- 기존 alimtalk_configs, email_configs와 동일한 패턴으로 ai_configs 테이블 추가

## 기능 요구사항

### FR-01: AI 설정 테이블
- 조직별 1개의 AI 설정 (orgId unique)
- provider: 사용할 AI 제공자 (openai, anthropic)
- apiKey: API 키 (암호화 저장은 추후, 현재는 DB 직접 저장 + GET 시 마스킹)
- model: 기본 모델명 (예: gpt-4o, claude-sonnet-4-20250514)
- isActive: 활성/비활성

### FR-02: AI 설정 API
- GET /api/ai/config — 현재 조직의 AI 설정 조회 (apiKey 마스킹)
- POST /api/ai/config — AI 설정 저장 (upsert: 없으면 insert, 있으면 update)
- admin/owner만 수정 가능, member는 조회 가능

### FR-03: AI 설정 UI
- 설정 페이지에 "AI" 탭 추가 (5번째 탭)
- Card 구성:
  - AI 제공자 선택 (Select: OpenAI / Anthropic)
  - API 키 입력 (password type input, 저장 후 마스킹 표시)
  - 기본 모델 선택 (provider에 따라 옵션 변경)
  - 활성/비활성 토글
  - 연결 테스트 버튼 (선택 — 간단한 API 호출로 키 유효성 확인)

### FR-04: 연결 테스트
- POST /api/ai/test — apiKey + provider로 간단한 API 호출 테스트
- OpenAI: models.list 또는 간단한 completion
- Anthropic: messages API로 짧은 테스트
- 성공/실패 결과 반환

## 기술 설계

### DB 스키마 (ai_configs)
```
ai_configs:
  id: serial PK
  orgId: uuid FK(organizations.id) UNIQUE NOT NULL
  provider: varchar(50) NOT NULL — "openai" | "anthropic"
  apiKey: varchar(500) NOT NULL
  model: varchar(100) — 기본 모델명
  isActive: integer DEFAULT 1 NOT NULL
  createdAt: timestamptz DEFAULT now()
  updatedAt: timestamptz DEFAULT now()
```

### API 패턴
- alimtalk/config.ts 패턴 동일: maskSecret + upsert
- 권한: getUserFromRequest() → member도 GET 가능, POST는 admin/owner

### UI 위치
- settings.tsx에 "AI" TabsTrigger 추가 (value="ai")
- 새 컴포넌트: AiConfigTab.tsx

## 구현 파일

| # | 파일 | 작업 |
|---|------|------|
| 1 | `src/lib/db/schema.ts` | aiConfigs 테이블 + AiConfig 타입 추가 |
| 2 | `src/pages/api/ai/config.ts` | GET/POST API (maskSecret + upsert) |
| 3 | `src/pages/api/ai/test.ts` | POST 연결 테스트 API |
| 4 | `src/hooks/useAiConfig.ts` | SWR 훅 (GET + save mutation) |
| 5 | `src/components/settings/AiConfigTab.tsx` | AI 설정 UI (Card + form) |
| 6 | `src/pages/settings.tsx` | "AI" 탭 추가 |

## 구현 순서
1. DB 스키마 추가 + db:push
2. API 엔드포인트 (config GET/POST)
3. 연결 테스트 API
4. SWR 훅
5. UI 컴포넌트
6. 설정 페이지 탭 연결

## 검증
- `pnpm build` 성공
- AI 설정 저장 → GET에서 마스킹된 키 확인
- 연결 테스트 성공/실패 토스트 확인
- member 접근 시 읽기만 가능 확인

## 참고
- 기존 패턴: `src/pages/api/alimtalk/config.ts` (maskSecret, upsert)
- 기존 패턴: `src/hooks/useOrgSettings.ts` (SWR hook)
- 제공자별 모델 목록은 하드코딩 (향후 동적 fetch 가능)
