# signup-simplify Design Document

> **Summary**: 회원가입 폼에서 조직 정보 제거, 개인 조직 자동 생성
>
> **Plan Reference**: `docs/01-plan/features/signup-simplify.plan.md`
> **Date**: 2026-02-27
> **Status**: Draft

---

## 1. 변경 개요

### Before (현재)
```
회원가입 폼: 조직이름 + 슬러그 + 이름 + 이메일 + 비밀번호 (5개 필드)
signup API: orgName, slug, email, password, name → org + user + subscription
```

### After (목표)
```
회원가입 폼: 이름 + 이메일 + 비밀번호 (3개 필드)
signup API: email, password, name → auto org + user + subscription
```

---

## 2. 변경 파일 상세 (2개)

### 2.1 `src/pages/api/auth/signup.ts` — API 수정

**제거:**
- `orgName`, `slug` 파라미터 수신
- `SLUG_REGEX` 상수 및 slug 유효성 검증
- slug 중복 체크 쿼리
- `orgName.trim()` → `name.trim()` 기반 자동 이름

**변경:**
```typescript
// 기존 (L15)
const { orgName, slug, email, password, name } = req.body;

// 변경
const { email, password, name } = req.body;
```

```typescript
// 기존 validation (L17)
if (!orgName || !slug || !email || !password || !name) {

// 변경
if (!email || !password || !name) {
```

**추가 — slug 자동생성 함수:**
```typescript
import crypto from "crypto";

function generateSlug(): string {
    return `org-${crypto.randomBytes(4).toString("hex")}`;
}
```

**변경 — 조직 생성 (L53-59):**
```typescript
// 기존
const [newOrg] = await db
    .insert(organizations)
    .values({
        name: orgName.trim(),
        slug: trimmedSlug,
    })
    .returning({ id: organizations.id });

// 변경
const [newOrg] = await db
    .insert(organizations)
    .values({
        name: `${name.trim()}의 조직`,
        slug: generateSlug(),
    })
    .returning({ id: organizations.id });
```

**제거 블록 (L7, L25-38):**
- `SLUG_REGEX` 상수 (L7)
- slug validation + slug 중복 체크 (L25-38)

### 2.2 `src/pages/signup.tsx` — 프론트엔드 UI

**제거:**
- `toSlug()` 함수 (L16-25)
- `orgName`, `slug`, `slugManual` state (L30-32)
- `handleOrgNameChange()`, `handleSlugChange()` 핸들러 (L39-49)
- 조직 이름 Input (L114-125)
- 조직 슬러그 Input + 설명 텍스트 (L126-139)

**변경 — handleSubmit body (L60):**
```typescript
// 기존
body: JSON.stringify({ orgName, slug, email, password, name }),

// 변경
body: JSON.stringify({ email, password, name }),
```

**변경 — CardDescription (L106):**
```typescript
// 기존
"조직을 만들고 관리자 계정을 생성합니다"

// 변경
"SalesFlow 계정을 생성합니다"
```

**변경 — 좌측 패널 텍스트 (L83-90):**
```tsx
// 기존
<h2>팀과 함께<br />영업을 관리하세요</h2>
<p>조직을 만들고, 팀원을 초대하여 시작하세요.</p>

// 변경
<h2>스마트한 영업 관리를<br />시작하세요</h2>
<p>무료로 가입하고 바로 시작하세요.</p>
```

**변경 — autoFocus: name Input으로 이동:**
- 기존 orgName Input의 `autoFocus` → name Input에 추가

---

## 3. 구현 순서

| # | 파일 | 작업 | 검증 |
|---|------|------|------|
| 1 | `src/pages/api/auth/signup.ts` | API 수정: 파라미터 제거 + auto slug | 타입 에러 없음 |
| 2 | `src/pages/signup.tsx` | UI 수정: org 필드 제거 | `pnpm build` 성공 |

---

## 4. 최종 signup.tsx 폼 구조

```
Card
├── CardHeader: "회원가입" / "SalesFlow 계정을 생성합니다"
├── CardContent
│   └── form
│       ├── 이름 Input (autoFocus)
│       ├── 이메일 Input
│       ├── 비밀번호 Input
│       ├── Error 메시지 (조건부)
│       ├── 회원가입 Button
│       └── 로그인 링크
```

---

## 5. 검증 체크리스트

- [ ] signup API: `email + password + name`만으로 가입 가능
- [ ] 가입 시 org 자동생성: name=`{이름}의 조직`, slug=`org-{hex8}`
- [ ] Free 구독 자동 생성 유지
- [ ] 가입 후 `/onboarding` 리다이렉트
- [ ] 온보딩에서 조직 이름 변경 가능 (기존 WelcomeStep)
- [ ] `pnpm build` 성공
- [ ] 기존 로그인 / 기타 API 영향 없음
