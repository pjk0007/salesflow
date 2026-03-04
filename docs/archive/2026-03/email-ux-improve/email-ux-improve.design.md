# email-ux-improve Design Document

> **Summary**: AI 이메일 자연스러운 톤 개선 + 이메일 서명 기능
>
> **Project**: SalesFlow
> **Date**: 2026-03-03
> **Plan**: [email-ux-improve.plan.md](../../01-plan/features/email-ux-improve.plan.md)

---

## 1. 기능 A — AI 이메일 자연스러운 톤

### 1.1 현재 문제

`src/lib/ai.ts` L47-51의 `buildSystemPrompt`에서:
```
htmlBody는 깔끔한 HTML 이메일이어야 합니다. 인라인 스타일을 사용하세요.
```
→ AI가 테이블 레이아웃, 배경색, 큰 CTA 버튼 등 광고성 HTML을 생성

### 1.2 변경 (FR-01)

**파일**: `src/lib/ai.ts` — `buildSystemPrompt()` L48-51

기존:
```typescript
let prompt = `당신은 B2B 영업/마케팅 이메일 전문가입니다.
사용자의 지시에 따라 이메일을 작성해주세요.
반드시 JSON 형식으로 응답하세요: { "subject": "이메일 제목", "htmlBody": "<html>...</html>" }
htmlBody는 깔끔한 HTML 이메일이어야 합니다. 인라인 스타일을 사용하세요.`;
```

변경:
```typescript
let prompt = `당신은 B2B 영업/마케팅 이메일 전문가입니다.
사용자의 지시에 따라 이메일을 작성해주세요.
반드시 JSON 형식으로 응답하세요: { "subject": "이메일 제목", "htmlBody": "<html>...</html>" }

[스타일 규칙 — 반드시 준수]
- 사람이 직접 작성한 것처럼 자연스러운 플레인 텍스트 스타일로 작성하세요.
- 허용 서식: <b>, <u>, <mark>(하이라이트), <br>, <a>, <p> 태그만 사용
- 금지: 배경색, 테이블 레이아웃, 큰 CTA 버튼, 이미지, 헤더/푸터 디자인, 컬러 박스
- CTA는 텍스트 링크(<a> 태그)로만 표현하세요 (버튼 스타일 금지)
- htmlBody는 <div style="font-family: sans-serif; font-size: 14px; line-height: 1.6; color: #222;"> 안에 작성`;
```

---

## 2. 기능 B — 이메일 서명

### 2.1 DB 스키마 (FR-02)

**파일**: `src/lib/db/schema.ts` — emailConfigs 테이블 (L429-442)

추가 컬럼:
```typescript
signature: text("signature"),                                    // 서명 내용 (텍스트)
signatureEnabled: boolean("signature_enabled").default(false).notNull(),  // 서명 On/Off
```

### 2.2 마이그레이션 (FR-02)

**파일**: `drizzle/0017_email_signature.sql` (새 파일)

```sql
ALTER TABLE "email_configs" ADD COLUMN IF NOT EXISTS "signature" text;
ALTER TABLE "email_configs" ADD COLUMN IF NOT EXISTS "signature_enabled" boolean DEFAULT false NOT NULL;
```

**파일**: `drizzle/meta/_journal.json` — idx 17 추가
```json
{
  "idx": 17,
  "version": "7",
  "when": 1770948000000,
  "tag": "0017_email_signature",
  "breakpoints": true
}
```

### 2.3 API 수정 (FR-05)

**파일**: `src/app/api/email/config/route.ts`

**GET** — response data에 추가:
```typescript
signature: config.signature,
signatureEnabled: config.signatureEnabled,
```

**POST** — body에서 추가 필드 수용:
```typescript
const { appKey, secretKey, fromName, fromEmail, signature, signatureEnabled } = await req.json();
```
- insert/update에 `signature`, `signatureEnabled` 포함

### 2.4 Hook 수정

**파일**: `src/hooks/useEmailConfig.ts`

`EmailConfigData` 인터페이스에 추가:
```typescript
signature: string | null;
signatureEnabled: boolean;
```

`saveConfig` 파라미터에 추가:
```typescript
signature?: string;
signatureEnabled?: boolean;
```

### 2.5 UI (FR-03)

**파일**: `src/components/email/EmailConfigForm.tsx`

기존 Card 아래에 **이메일 서명** Card 추가:
- `Switch` 컴포넌트 — signatureEnabled 토글
- `Textarea` — 서명 텍스트 입력 (signatureEnabled=true일 때만 표시)
- placeholder: `홍길동 | 영업팀 매니저\n전화: 010-1234-5678\nemail@company.com`
- 저장 버튼 기존 handleSave에 signature, signatureEnabled 포함

### 2.6 서명 삽입 유틸 (FR-04)

**파일**: `src/lib/nhn-email.ts` — 함수 추가

```typescript
export function appendSignature(htmlBody: string, signature: string): string {
    const sigHtml = `<div style="margin-top:24px; padding-top:16px; border-top:1px solid #e5e5e5; font-size:13px; color:#666; white-space:pre-line;">${escapeHtml(signature)}</div>`;

    // </body> 태그 앞에 삽입, 없으면 끝에 추가
    if (htmlBody.includes("</body>")) {
        return htmlBody.replace("</body>", sigHtml + "</body>");
    }
    return htmlBody + sigHtml;
}
```

`escapeHtml`: `<`, `>`, `&`, `"` 이스케이프 (XSS 방지)

### 2.7 발송 지점 수정 (FR-04)

서명 삽입은 **발송 직전** body에 적용. 3곳 모두 동일 패턴:

#### A. 수동 발송 — `src/app/api/email/send/route.ts`

L93-99 부근, `substitutedBody` 생성 후:
```typescript
let finalBody = substitutedBody;
if (config.signatureEnabled && config.signature) {
    finalBody = appendSignature(finalBody, config.signature);
}
// sendEachMail에 body: finalBody
```

#### B. 자동 발송 — `src/lib/email-automation.ts`

`sendEmailSingle()` L66 부근, `substitutedBody` 생성 후:
```typescript
let finalBody = substitutedBody;
if (config.signatureEnabled && config.signature) {
    finalBody = appendSignature(finalBody, config.signature);
}
// sendEachMail에 body: finalBody
```

`appendSignature` import 추가: `from "@/lib/nhn-email"`

#### C. AI 자동 발송 — `src/lib/auto-personalized-email.ts`

L148 부근, `emailResult.htmlBody` 사용 전:
```typescript
let finalBody = emailResult.htmlBody;
if (emailConfig.signatureEnabled && emailConfig.signature) {
    finalBody = appendSignature(finalBody, emailConfig.signature);
}
// sendEachMail에 body: finalBody
```

`appendSignature` import 추가: `from "@/lib/nhn-email"`

---

## 3. 구현 순서

| # | 파일 | 검증 |
|---|------|------|
| 1 | `src/lib/ai.ts` — 프롬프트 스타일 제약 | 타입 에러 없음 |
| 2 | `src/lib/db/schema.ts` + `drizzle/0017_*.sql` + `_journal.json` | drizzle-kit push |
| 3 | `src/app/api/email/config/route.ts` — GET/POST 수정 | 타입 에러 없음 |
| 4 | `src/hooks/useEmailConfig.ts` — 타입 확장 | 타입 에러 없음 |
| 5 | `src/components/email/EmailConfigForm.tsx` — 서명 UI | 타입 에러 없음 |
| 6 | `src/lib/nhn-email.ts` — `appendSignature()` + `escapeHtml()` | 타입 에러 없음 |
| 7 | `src/app/api/email/send/route.ts` — 수동 발송 서명 삽입 | 타입 에러 없음 |
| 8 | `src/lib/email-automation.ts` — 자동 발송 서명 삽입 | 타입 에러 없음 |
| 9 | `src/lib/auto-personalized-email.ts` — AI 자동 발송 서명 삽입 | `pnpm build` 성공 |

---

## 4. 검증

- `pnpm build` 성공
- AI 이메일 생성 → 플레인 텍스트 스타일 (테이블/버튼 없음)
- 서명 Off → 이메일에 서명 미포함
- 서명 On + 서명 입력 → 모든 이메일 하단에 서명 구분선 + 텍스트 추가
