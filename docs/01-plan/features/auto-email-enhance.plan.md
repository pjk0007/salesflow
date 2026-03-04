# Plan: auto-email-enhance (AI 개인화 이메일 발송 규칙 고도화)

## 배경
현재 AI 개인화 이메일은 항상 **플레인 텍스트 스타일**(사람이 직접 쓴 듯한 형식)로만 발송됩니다.
실제 영업 현장에서는 두 가지 형식이 필요합니다:
1. **플레인 (plain)**: 지금처럼 간결한 텍스트 이메일 — 개인 편지 느낌
2. **디자인 (designed)**: HTML 레이아웃(헤더, CTA 버튼, 컬러 섹션) — 마케팅 뉴스레터 느낌

또한, AI가 작성한 티가 나지 않도록 **작성 스타일(writingStyle)** 옵션을 추가하여 프롬프트를 자동 조정합니다.

## 요구사항

### FR-01. 이메일 형식(format) 선택
- 규칙별로 `format` 필드 추가: `plain` (기본) | `designed`
- `plain`: 현재 시스템 프롬프트 그대로 (플레인 텍스트 스타일)
- `designed`: HTML 디자인 이메일 (헤더, CTA 버튼, 배경색, 섹션 레이아웃 허용)

### FR-02. 작성 스타일(writingStyle) 드롭다운
- 규칙별로 `writingStyle` 필드 추가
- 옵션:
  - `default` — 기본 (지금과 동일)
  - `concise` — "미사여구를 과도하게 섞지 말고 AI가 작성한 티가 나지 않게 간결하고 실제 담당자가 메일을 보내는 듯한 간결한 말투로 써줘"
  - `formal` — 격식있는 비즈니스 어투
  - `casual` — 캐주얼한 어투
- 시스템 프롬프트에 스타일별 지시사항 자동 삽입

## 현재 구조 분석

### DB: `emailAutoPersonalizedLinks` 테이블
| 컬럼 | 현재 |
|------|------|
| tone | varchar(50) — "professional", "friendly", "formal" |
| prompt | text — AI 지시사항 |

→ `tone`은 이미 있으나, `format`과 `writingStyle`은 없음

### `ai.ts` — `buildSystemPrompt()`
- 현재 시스템 프롬프트에 하드코딩:
  - "플레인 텍스트 스타일", "배경색/테이블 레이아웃/CTA 버튼 금지"
- `format`에 따라 이 스타일 규칙을 분기해야 함

### UI: `AutoPersonalizedEmailConfig.tsx`
- Dialog에 톤 Select가 있음 (TONE_OPTIONS)
- `format`과 `writingStyle` Select 추가 필요

## 변경 파일

| # | 파일 | 변경 |
|---|------|------|
| 1 | `src/lib/db/schema.ts` | `emailAutoPersonalizedLinks`에 `format`, `writingStyle` 컬럼 추가 |
| 2 | `drizzle/XXXX_auto_email_format.sql` | ALTER TABLE 마이그레이션 |
| 3 | `src/lib/ai.ts` | `buildSystemPrompt()` — format/writingStyle 분기 |
| 4 | `src/lib/auto-personalized-email.ts` | format, writingStyle을 generateEmail에 전달 |
| 5 | `src/components/email/AutoPersonalizedEmailConfig.tsx` | format, writingStyle Select 추가 |
| 6 | `src/app/api/email/auto-personalized/route.ts` | POST/PUT에서 format, writingStyle 수락 |

## 상세 설계

### 1. DB 컬럼 추가
```sql
ALTER TABLE "email_auto_personalized_links"
    ADD COLUMN IF NOT EXISTS "format" varchar(20) DEFAULT 'plain' NOT NULL;
ALTER TABLE "email_auto_personalized_links"
    ADD COLUMN IF NOT EXISTS "writing_style" varchar(30) DEFAULT 'default' NOT NULL;
```

### 2. `buildSystemPrompt()` 변경

**format = "plain" (기본, 현재와 동일)**
```
[스타일 규칙]
- 사람이 직접 작성한 것처럼 자연스러운 플레인 텍스트 스타일
- 허용: <b>, <u>, <mark>, <br>, <a>, <p>
- 금지: 배경색, 테이블, CTA 버튼, 이미지, 헤더/푸터
```

**format = "designed"**
```
[스타일 규칙]
- 전문적인 HTML 마케팅 이메일 형식으로 작성
- 허용: 헤더 섹션, CTA 버튼, 배경색, 섹션 구분, 테이블 레이아웃
- 인라인 CSS 사용 (외부 CSS 금지)
- CTA 버튼: 배경색 + 둥근 모서리 + 패딩 스타일 적용
- 모바일 반응형을 고려한 max-width: 600px 컨테이너 사용
```

**writingStyle 프롬프트**
| 값 | 프롬프트 추가 |
|---|---|
| `default` | (추가 없음) |
| `concise` | "미사여구를 과도하게 섞지 말고 AI가 작성한 티가 나지 않게 간결하고 실제 담당자가 메일을 보내는 듯한 간결한 말투로 작성하세요." |
| `formal` | "격식 있는 비즈니스 어투로 작성하세요. 경어체를 사용하고 전문적인 인사말과 맺음말을 포함하세요." |
| `casual` | "친근하고 캐주얼한 어투로 작성하세요. 딱딱한 표현을 피하고 대화하듯 자연스럽게 작성하세요." |

### 3. `GenerateEmailInput` 타입 확장
```typescript
interface GenerateEmailInput {
    prompt: string;
    product?: Product | null;
    recordData?: Record<string, unknown> | null;
    tone?: string;
    ctaUrl?: string;
    format?: "plain" | "designed";      // 추가
    writingStyle?: string;               // 추가
}
```

### 4. UI 변경
Dialog에 2개 Select 추가:
- **이메일 형식**: plain(간결한 텍스트) / designed(디자인 이메일)
- **작성 스타일**: 기본 / 간결한 담당자 말투 / 격식 비즈니스 / 캐주얼

규칙 목록에도 format/writingStyle Badge 표시

## 구현 순서

| # | 작업 | 검증 |
|---|------|------|
| 1 | schema.ts + migration SQL | 타입 에러 없음 |
| 2 | ai.ts — buildSystemPrompt + GenerateEmailInput 타입 확장 | 타입 에러 없음 |
| 3 | auto-personalized-email.ts — format, writingStyle 전달 | 타입 에러 없음 |
| 4 | auto-personalized API — format, writingStyle 수락 | 타입 에러 없음 |
| 5 | AutoPersonalizedEmailConfig.tsx — UI 추가 | `pnpm build` 성공 |

## 검증
- `pnpm build` 성공
- 기존 규칙 (format/writingStyle 미설정) → 기본값으로 동작 (하위 호환)
- format=designed → HTML 디자인 이메일 생성
- writingStyle=concise → 간결한 말투 적용
