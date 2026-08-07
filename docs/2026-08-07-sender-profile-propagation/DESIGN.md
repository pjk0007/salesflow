# DESIGN — 테스트/후속 메일이 발신 프로필·서명 설정을 따르도록 수정

- **사이클 ID**: `2026-08-07-sender-profile-propagation`
- **근거 문서**: `PLAN.md`(승인됨), `behaviors.json` (B1~B16)

> **착수 전 확인 항목 해소됨 (2026-08-07)**: `emailAutoPersonalizedLinks.senderProfileId` / `.signatureId`는 `schema.ts:798-799`에 **이미 선언돼 있다.** `auto-personalized-email.ts:143-160`의 `(link as Record<string, unknown>)` 캐스팅은 불필요한 레거시 코드이며 이번 리팩토링에서 제거된다. 스키마 추가 작업 없음.

## 1. 접근법 요약

문제의 본질은 **"기본값 해석기"밖에 없는데 7개 발송 경로가 전부 그걸 부른다**는 것이다. 각 경로가 자기 맥락(요청 body / `link` 행 / `parentLog` 행)에서 가진 선택값을 리졸버에 넘길 방법 자체가 없다.

세 겹으로 나눈다.

1. **순수 판정 계층** — `pickSender()` / `pickSignature()`. "후보들이 주어졌을 때 무엇을 고를 것인가"만 결정. DB를 모른다. TDD 대상.
2. **DB 조회 계층** — `resolveSender()` / `resolveSignature()`. orgId + 후보 ID를 받아 org 스코프로 조회하고 순수 함수에 넘긴다. 소유권 검증(B6)이 여기 산다.
3. **호출부** — 7개 경로가 각자 맥락의 ID를 `opts`로 넘긴다. 인라인 3단 로직(`send/route.ts:31-85`, `test-send/route.ts:34-55`, `auto-personalized-email.ts:140-166`)은 전부 리졸버 호출로 대체.

템플릿 후속은 상속할 원본 정보가 **DB에 없으므로** `email_send_logs.sender_profile_id`를 추가해 발송 시점의 실제 프로필을 남긴다. 후속은 이 값을 후보로 넘긴다.

핵심: **우선순위 체인을 한 군데로 모으고, 각 경로는 후보 ID만 공급한다.** 지금은 체인이 4벌 복붙돼 있고 그중 2벌은 단이 빠져 있다.

## 2. 핵심 트레이드오프

### (a) 리졸버 시그니처 — opts 객체 + 순수 함수는 "이미 조회된 행"만 받는다

opts 객체를 쓴다. 개별 위치 인자는 후속 상속으로 후보가 2개(`link.senderProfileId` → `parentLog.senderProfileId`)가 되면서 인자가 4개로 늘고, 호출부마다 `undefined`를 자리 채우기로 넘겨야 한다. 특히 `signatureId`는 `null`/`undefined` 구분이 계약인데 위치 인자로는 "안 넘김"과 "명시적 null"이 시각적으로 구분되지 않는다.

경계선은 **"DB를 때리느냐"** 하나로 긋는다. `resolve*`는 `db.select()` + org 필터, `pick*`은 I/O 없음.

*버린 대안*: 순수 함수에 조회 함수를 주입(`pickSender(ids, { fetchProfile })`)하면 org 격리까지 순수 테스트로 커버 가능하지만 순수 함수가 async가 되고 mock 비용이 붙는다. YAGNI — B6는 "WHERE에 `orgId`가 있다"는 코드 사실이고, 조회 결과가 비면 `pick*`이 fallback한다는 게 이미 B2로 커버된다.

### (b) 순수 함수 입력 — 정규화된 최소 형태

`$inferSelect` 행을 그대로 받으면 테스트마다 `name`/`createdAt`/`updatedAt`을 채워야 한다(전부 notNull). `pick*`이 실제 쓰는 필드는 4개뿐이므로 `SenderCandidate`로 정규화한다. 픽스처가 한 줄로 끝나고, 스키마에 컬럼이 붙어도 순수 함수와 테스트가 안 흔들린다.

*비용*: drizzle 타입과의 연결이 자동 보장되지 않음 → `resolve*`의 반환 타입을 명시해 tsc가 잡게 한다.

### (c) `test-send` 인라인 제거 시 레거시 config fallback 보존 — `config`를 필수 키로

가장 위험한 지점. `test-send`는 `defaultProfile` 없으면 `getEmailConfig()`를 부르는 3단을 인라인으로 갖고 있고, 이걸 `resolveSender()`로 갈아끼울 때 config를 안 넘기면 **프로필 테이블 없이 `email_configs`만 쓰는 org의 테스트 발송이 전부 죽는다.**

`config?:`로 두면 빠뜨려도 컴파일이 통과하고 그 org만 조용히 죽는다 — 정확히 PLAN의 "레거시 config 상실" 리스크. **`config: LegacyEmailConfig | null`을 optional 없이 필수 키로** 두면 빠뜨린 호출부를 tsc가 잡고, 넘길 게 없으면 `null`을 의식적으로 써야 한다.

*버린 대안*: `resolve*` 내부에서 `getEmailConfig(orgId)` 직접 호출 — 이미 config를 조회한 호출부(`send/route.ts:26`, `email-followup.ts:356`, `test-send:75`)에서 같은 쿼리가 두 번 나가고, 발송 루프 안에서는 레코드마다 중복된다.

## 3. 파일별 변경 계획

### 3-1. `src/lib/email-sender-resolver.ts` — 핵심

기존 `resolveDefaultSender` / `resolveDefaultSignature`는 **삭제하지 않고** 새 함수를 부르는 얇은 래퍼로 남긴다 (`email-automation.ts` 등 범위 밖 호출부 보호).

```typescript
export interface SenderCandidate {
    id: number;
    fromEmail: string;
    fromName: string;
    isDefault: boolean;
}

export interface SignatureCandidate {
    id: number;
    signature: string;
    isDefault: boolean;
}

/** 레거시 email_configs */
export interface LegacyEmailConfig {
    fromEmail?: string | null;
    fromName?: string | null;
    signatureEnabled?: boolean | null;
    signature?: string | null;
}

export interface ResolvedSender {
    fromEmail: string | null;
    fromName?: string;
    /** 로그 기록용. 레거시 config로 떨어졌거나 미해결이면 null */
    profileId: number | null;
}

// ── 순수 함수 (TDD 대상) ──

/**
 * preferredIds: 우선순위 높은 순서의 후보 ID 배열.
 *   수동 발송   [body.senderProfileId]
 *   AI 후속     [link.senderProfileId, parentLog.senderProfileId]
 *   템플릿 후속  [parentLog.senderProfileId]
 * null/undefined 원소는 무시. candidates에 없는 id는 삭제됐거나 타 org → 다음 후보로.
 */
export function pickSender(input: {
    preferredIds: ReadonlyArray<number | null | undefined>;
    candidates: ReadonlyArray<SenderCandidate>;
    config: LegacyEmailConfig | null;
}): ResolvedSender;

/**
 * requestedId 3-state가 계약의 핵심:
 *   number    → 그 서명. 없으면 기본 서명으로 fallback
 *   null      → 명시적 "서명 없음". fallback 금지
 *   undefined → 미지정. 기본 서명 → 레거시 config 순
 */
export function pickSignature(input: {
    requestedId: number | null | undefined;
    candidates: ReadonlyArray<SignatureCandidate>;
    config: LegacyEmailConfig | null;
}): string | null;

// ── DB 계층 ──

export interface ResolveSenderOpts {
    preferredIds?: ReadonlyArray<number | null | undefined>;
    config: LegacyEmailConfig | null;   // 필수 키 — 레거시 유실 방지
}
export async function resolveSender(orgId: string, opts: ResolveSenderOpts): Promise<ResolvedSender>;

export interface ResolveSignatureOpts {
    requestedId?: number | null;
    config: LegacyEmailConfig | null;
}
export async function resolveSignature(orgId: string, opts: ResolveSignatureOpts): Promise<string | null>;

// ── 하위호환 래퍼 (기존 시그니처 그대로) ──
export async function resolveDefaultSender(
    orgId: string, fallbackConfig?: LegacyEmailConfig | null
): Promise<{ fromEmail: string | null; fromName?: string }>;

export async function resolveDefaultSignature(
    orgId: string, fallbackConfig?: LegacyEmailConfig | null
): Promise<string | null>;
```

**조회 전략**: `where(eq(orgId, orgId))` 하나로 org의 전체 프로필을 한 번에 가져온다. `preferredIds`마다 개별 쿼리를 날리면 후보 2개일 때 최대 3쿼리. 발신 프로필은 org당 수 개라 전량 조회가 싸고, org 필터가 WHERE에 딱 한 번만 등장해 격리(B6)를 리뷰하기 쉽다.

> `preferredIds`에 있는데 조회 결과에 없는 id = 삭제됐거나 타 org → 자동으로 다음 후보로 흐른다. **B6와 B16이 같은 메커니즘 하나로 해결된다.** `isActive` 컬럼 불필요(사용자 확정).

**래퍼 주의**: `resolveDefaultSignature`는 내부에서 `requestedId`를 **넘기지 않아야** 한다. `null`을 넘기면 기존 호출부 전부가 "서명 없음"이 되어 서명이 사라진다.

### 3-2. `src/lib/email-sender-pick.ts` — 신규 (순수 함수)

`pick*`을 `email-sender-resolver.ts`에 두면 테스트가 그 파일을 import할 때 상단의 `@/lib/db` import가 딸려와 커넥션이 열린다. **별도 파일로 분리하고 `email-sender-resolver.ts`가 re-export**한다. DB import 없음.

### 3-3. `src/lib/email-sender-pick.test.ts` — 신규 (TDD)

`node:test` + `node:assert`, `src/lib/attribution/parse-params.test.ts` 형식. 케이스는 6절 22개.

### 3-4. `src/lib/db/schema.ts`

`emailSendLogs`의 `unsubscribeToken` 다음:

```typescript
senderProfileId: integer("sender_profile_id"),  // 후속이 원본 발신자를 상속하기 위한 값. 마이그레이션 이전 로그는 null
```

**FK를 붙이지 않는다.** 정책의 핵심이 "프로필을 삭제하면 후속이 새 도메인으로 옮겨간다"인데 `cascade`면 로그가 날아가고 `set null`이면 삭제 이력이 사라진다. FK 없이 두면 죽은 id가 남아 있어도 리졸버가 "후보에 없음 → 기본값"으로 자연 처리한다(B16). 같은 파일의 `parentLogId`/`partitionId`/`recordId`(`:670-671, 684`)가 이미 FK 없는 선례다.

### 3-5. `drizzle/0064_email_send_log_sender.sql` + `meta/_journal.json`

SQL은 7절. 저널 엔트리는 `idx: 64`, `when: 1770952700000`, `tag: "0064_email_send_log_sender"`.

### 3-6. `src/app/api/email/send/route.ts` — 수동 캠페인

- `:31-85` 인라인 55줄 → 리졸버 호출:
  ```typescript
  const sender = await resolveSender(user.orgId, { preferredIds: [senderProfileId], config });
  if (!sender.fromEmail) return 400 "발신 이메일 주소를 설정해주세요.";
  const signatureJson = await resolveSignature(user.orgId, { requestedId: signatureId, config });
  ```
  `senderProfileId`/`signatureId`는 body에서 받은 값을 **변형 없이** 넘긴다. `?? undefined`나 `|| null`을 넣는 순간 B4가 깨진다.
- 로그 insert(`:171-184`)에 `senderProfileId: sender.profileId` (B13).
- 루프 진입 전 `const fromEmail = sender.fromEmail;`로 narrowing (`!` 단언 금지).
- `emailSenderProfiles`/`emailSignatures` import 제거.

### 3-7. `src/app/api/email/test-send/route.ts` — 템플릿 테스트 (B7, B8)

- body에 `senderProfileId?: number`, `signatureId?: number | null` 수신.
- `:34-55` 인라인 → `resolveSender`. `getEmailConfig(user.orgId)`를 **함수 상단으로 끌어올려** config 확보 — (c) 트레이드오프의 그 지점. 놓치면 config-only org의 테스트 발송이 죽는다.
- **서명 신규 적용(B8)**: `resolveSignature()` + `appendSignature()`. `@/lib/nhn-email`에서 import 추가(현재 없음).
- 순서: **변수 치환 → 서명 붙이기**. 반대로 하면 서명 안 텍스트까지 `replaceAll` 대상.
- 이 라우트는 로그를 안 남기므로 B13 대상 아님.

### 3-8. `src/components/email/EmailTestSendDialog.tsx` — UI (B7 진입점)

`SendEmailDialog.tsx:46-62, 75-80` 패턴 그대로. **신규 훅 금지** — `useSenderProfiles()`, `useSignatures()` 재사용.

- state 2개: `selectedProfileId`, `selectedSigId` (둘 다 string — Radix Select value)
- `useEffect`로 기본값 초기화 (선례와 동일한 "비어있을 때만" 가드)
- body 전송 규약:
  ```
  senderProfileId: selectedProfileId ? Number(selectedProfileId) : undefined,
  signatureId: selectedSigId === "none" ? null : selectedSigId ? Number(selectedSigId) : undefined,
  ```
  서명 Select에 `value="none"` = "서명 없음" 옵션. 이게 B4의 UI 진입점.
- `handleOpenChange`에서 닫을 때 선택값 초기화.

**`.tsx` 로직 금지 규칙 적용**: 이번에 추가되는 건 Select 2개 + 선례와 동일한 초기화 `useEffect`로 계산 로직이 아니라 폼 상태다. 현재 155줄이라 임계에 여유가 있어 선례와 같은 수준을 유지한다. **단 Select 추가 후 200줄을 넘기면** `handleSend` + 상태를 `useEmailTestSend` 훅(`src/components/email/hooks/`)으로 추출한다.

### 3-9. `src/app/api/email/auto-personalized/test-send/route.ts` — AI 테스트 (B9)

`:77-82`만 교체:
```typescript
const sender = await resolveSender(user.orgId, {
    preferredIds: [link.senderProfileId],
    config: emailConfig,
});
const signatureJson = await resolveSignature(user.orgId, {
    requestedId: link.signatureId ?? undefined,   // DB null = 미지정 (10절)
    config: emailConfig,
});
```

### 3-10. `src/app/api/email/auto-personalized/test-followup/route.ts` — 후속 테스트 (B11)

- POST 핸들러가 현재 `link`를 직접 조회하지 않는다(`generateAiFollowupPreview` 내부에서만 사용). `linkId`로 org 스코프 조회를 추가하거나, `parentLog` 조회(`:146-150`)의 select에 `senderProfileId`를 넣어 2순위로 쓴다.
  ```typescript
  const sender = await resolveSender(user.orgId, {
      preferredIds: [link.senderProfileId, parentLog?.senderProfileId],
      config: emailConfig,
  });
  ```
  조회 추가 시 **`eq(orgId, user.orgId)`를 반드시 WHERE에** 넣을 것.
- 로그 insert(`:189-200`)에 `senderProfileId: sender.profileId` (B13).
- `generateAiFollowupPreview()` 내부(`email-followup.ts:109`)의 서명도 `link.signatureId`를 반영하도록 같이 수정. 안 하면 **미리보기 서명과 실제 발송 발신자가 어긋난다.**

### 3-11. `src/lib/email-followup.ts` — 템플릿/AI 후속 (B10, B12, B13, B14, B16)

**템플릿 분기 (`:355-359`)**:
```typescript
const sender = await resolveSender(item.orgId, {
    preferredIds: [parentLog.senderProfileId],   // B12
    config: emailConfig,
});
if (!sender.fromEmail) return false;
const signatureJson = await resolveSignature(item.orgId, { config: emailConfig });
```
`parentLog.senderProfileId`가 null(구 로그, B14)이면 무시되고 기본 프로필로 흐른다. 프로필이 삭제됐으면 후보에 없어 역시 기본(B16). **분기문 없이 우선순위 배열 하나로 세 behavior가 처리된다.**
`emailTemplateLinks`에 `signatureId`가 없어 템플릿 후속 서명은 기본값 유지(범위 밖).
insert(`:395-409`)에 `senderProfileId: sender.profileId` → 후속의 후속(체인 `:437-450`)도 이어받는다.

**AI 분기 (`:493-497`)**:
```typescript
const sender = await resolveSender(item.orgId, {
    preferredIds: [link.senderProfileId, parentLog.senderProfileId],  // B10 + 2순위 상속
    config: emailConfig,
});
const signatureJson = await resolveSignature(item.orgId, {
    requestedId: link.signatureId ?? undefined,
    config: emailConfig,
});
```
insert(`:581-593`)에 `senderProfileId: sender.profileId`.

### 3-12. `src/lib/auto-personalized-email.ts` — AI 최초 발송

- `:140-166` 인라인 블록(불필요한 `as Record<string, unknown>` 캐스팅 포함)을 리졸버 호출로 교체. 캐스팅 제거가 부수 이득.
- insert(`:281-293`)에 `senderProfileId: sender.profileId` (B13). **이게 AI 후속의 2순위 상속 입력이 된다.**
- 기존 버그 동봉: `:164` `if (!signatureJson)`은 선택한 서명이 빈 문자열이면 기본 서명으로 덮어쓴다. 리졸버의 3-state 계약이 정리한다.

## 4. 데이터 타입 / 함수 시그니처

전체는 3-1. 요점:

- `any` 없음. `req.json()` 결과는 라우트 경계에서 타입 주석으로 좁힌다:
  ```typescript
  const { templateLinkId, recordIds, senderProfileId, signatureId } = await req.json() as {
      templateLinkId?: number;
      recordIds?: unknown;
      senderProfileId?: number;
      signatureId?: number | null;
  };
  ```
  (기존 `send/route.ts`는 구조분해만 해서 암묵적 any — 이번에 주석을 붙인다. `recordIds`는 기존 `Array.isArray` 가드가 있으므로 `unknown`.)
- `ReadonlyArray`는 `pick*`이 입력을 변형하지 않음을 시그니처로 못 박는다.
- `ResolvedSender.fromName`이 `string | undefined`인 건 NHN `sendEachMail`의 `senderName?: string`에 그대로 넘기기 위함. `null`로 바꾸지 않는다.

## 5. behavior별 구현 위치 매핑

| id | 구현 위치 (behaviors.json `target`) | 검증 |
|---|---|---|
| B1 | `email-sender-pick.ts` → `pickSender` | 자동 |
| B2 | `email-sender-pick.ts` → `pickSender` | 자동 |
| B3 | `email-sender-pick.ts` → `pickSender` | 자동 |
| B4 | `email-sender-pick.ts` → `pickSignature` | 자동 |
| B5 | `email-sender-pick.ts` → `pickSignature` | 자동 |
| B6 | `email-sender-resolver.ts` → `resolveSender`(WHERE orgId) + `pickSender`(후보 부재 fallback) | 부분 자동 + 코드 리뷰 |
| B7 | `EmailTestSendDialog.tsx` + `api/email/test-send/route.ts` | 수동 발송 |
| B8 | `api/email/test-send/route.ts` (`appendSignature` 신규) | 수동 발송 |
| B9 | `api/email/auto-personalized/test-send/route.ts:77-82` | 수동 발송 |
| B10 | `email-followup.ts` → AI 분기 `:493-497` | 코드 추적 + 큐 실행 |
| B11 | `api/email/auto-personalized/test-followup/route.ts:172-179` | 수동 발송 |
| B12 | `email-followup.ts` → 템플릿 분기 `:355-359` | 로그 테이블 확인 |
| B13 | insert 5곳: `send/route.ts`, `auto-personalized-email.ts`, `email-followup.ts`(2), `test-followup/route.ts` | `select sender_profile_id from email_send_logs` |
| B14 | `pickSender` (preferredIds의 null 무시) — 별도 분기 없음 | 자동 + 구 로그 후속 실행 |
| B15 | `drizzle/0064_email_send_log_sender.sql` | psql 2회 실행 |
| B16 | `pickSender`(후보에 없는 id 건너뜀) + `resolveSender` 전량 조회 | 자동 + 프로필 삭제 후 후속 |

**자동 테스트 범위**: 순수 로직(B1~B6, B14, B16 판정부)만 `pnpm test`. B7~B13은 NHN 실발송/큐 실행이 필요해 코드 추적 + 수동 검증.

## 6. TDD로 고정할 계약 (`email-sender-pick.test.ts`)

픽스처:
```
P1    = { id: 1, fromEmail: "sales@a.com", fromName: "A팀", isDefault: false }
P_DEF = { id: 9, fromEmail: "cs@b.com",    fromName: "고객센터", isDefault: true }
S1    = { id: 1, signature: "SIG_ONE",     isDefault: false }
S_DEF = { id: 9, signature: "SIG_DEFAULT", isDefault: true }
CFG   = { fromEmail: "legacy@c.com", fromName: "레거시", signatureEnabled: true, signature: "SIG_LEGACY" }
```

### `pickSender`

| # | behavior | given | when | then |
|---|---|---|---|---|
| 1 | B1 | candidates=[P1, P_DEF] | preferredIds=[1] | `fromEmail === "sales@a.com"`, `profileId === 1` |
| 2 | B1 | candidates=[P1, P_DEF] | preferredIds=[1] | 기본이 있어도 P1이 이긴다 (`fromEmail !== "cs@b.com"`) |
| 3 | B2 | candidates=[P1, P_DEF] | preferredIds=[] | `profileId === 9` |
| 4 | B2/B14 | candidates=[P1, P_DEF] | preferredIds=[null, undefined] | `profileId === 9` — null 원소 무시, 에러 없음 |
| 5 | B6/B16 | candidates=[P_DEF] (id 1 삭제/타 org) | preferredIds=[1] | `profileId === 9` — 없는 id는 조용히 건너뛴다 |
| 6 | B12 | candidates=[P1, P_DEF] | preferredIds=[undefined, 1] | `profileId === 1` — 1순위 비면 2순위 |
| 7 | B16 체인 | candidates=[P1, P_DEF] | preferredIds=[999, 1] | `profileId === 1` — 1순위가 죽어도 기본으로 바로 안 떨어진다 |
| 8 | B3 | candidates=[], config=CFG | preferredIds=[] | `fromEmail === "legacy@c.com"`, `fromName === "레거시"`, **`profileId === null`** |
| 9 | B3 | candidates=[], config=null | preferredIds=[] | `fromEmail === null`, `profileId === null` |
| 10 | B3 경계 | candidates=[], config={fromEmail: null} | preferredIds=[] | `fromEmail === null` |
| 11 | 우선순위 | candidates=[P1](기본 없음), config=CFG | preferredIds=[1] | `profileId === 1` — 명시값이 레거시보다 우선 |
| 12 | B3 순서 | candidates=[P_DEF], config=CFG | preferredIds=[] | `profileId === 9` — 기본 프로필이 레거시보다 우선 |
| 13 | 기본 부재 | candidates=[P1](isDefault 없음), config=null | preferredIds=[] | `fromEmail === null` — 임의 프로필을 골라 쓰지 않는다 |

> #13은 의도적 결정. `useSenderProfiles()`는 UI 편의로 `profiles[0]`을 fallback하지만, 서버 발송에서 "기본 미지정 org에 아무 프로필이나 골라 보내기"는 조용한 오배송이다.

### `pickSignature`

| # | behavior | given | when | then |
|---|---|---|---|---|
| 14 | B4 | candidates=[S1, S_DEF], config=CFG | requestedId=**null** | `=== null` — 기본·레거시 **둘 다** 안 붙는다 |
| 15 | B5 | candidates=[S1, S_DEF] | requestedId=**undefined** | `=== "SIG_DEFAULT"` |
| 16 | B5 | candidates=[], config=CFG(enabled) | requestedId=undefined | `=== "SIG_LEGACY"` |
| 17 | B5 경계 | candidates=[], config={signatureEnabled: **false**, signature:"X"} | requestedId=undefined | `=== null` |
| 18 | B5 경계 | candidates=[], config={signatureEnabled: true, signature: null} | requestedId=undefined | `=== null` |
| 19 | 명시 선택 | candidates=[S1, S_DEF] | requestedId=1 | `=== "SIG_ONE"` |
| 20 | 삭제/타 org | candidates=[S_DEF] | requestedId=1 | `=== "SIG_DEFAULT"` — 서명은 fallback해도 안전 |
| 21 | B4 vs 0 | candidates=[S1, S_DEF] | requestedId=0 | falsy 함정 — `0`은 유효 id가 아니라 후보에 없어 기본으로. `null`과 다른 경로임을 고정 |
| 22 | B5 | candidates=[], config=null | requestedId=undefined | `=== null` |

**#14가 이 사이클에서 가장 중요한 테스트다.** `if (!signatureId)`로 짜면 통과하지 못한다.

## 7. 마이그레이션 SQL 초안

`drizzle/0064_email_send_log_sender.sql`:

```sql
-- 후속(팔로우업) 메일이 원본 메일의 발신 프로필을 이어받게 하기 위한 컬럼.
--
-- 후속 발송은 원본 로그(parent_log_id)만 알고 있어서, 어떤 프로필로 첫 메일이
-- 나갔는지 되짚을 방법이 없었다. 그 결과 스팸 회피용으로 발신 도메인을 바꿔도
-- 후속은 계속 org 기본 프로필로 나갔다.
--
-- FK를 걸지 않는다: 프로필을 삭제하면 후속이 현재 기본 프로필로 옮겨가는 게
-- 의도된 동작이다. cascade면 로그가 지워지고, set null이면 삭제 이력이 사라진다.
-- 남아있는 죽은 id는 조회 시 후보에 없으므로 리졸버가 기본값으로 흘려보낸다.
--
-- 기존 로그는 null로 남기고 backfill하지 않는다 — 당시 실제 발신자를 알 수 없다.

ALTER TABLE "email_send_logs"
    ADD COLUMN IF NOT EXISTS "sender_profile_id" integer;
```

`IF NOT EXISTS`로 멱등(B15). 인덱스는 만들지 않는다 — 이 컬럼으로 조회하는 쿼리가 없다(로그 단건 조회 후 값을 읽을 뿐). YAGNI.

## 8. 구현 순서

1. **테스트 먼저** — `email-sender-pick.test.ts`에 22케이스. 미구현이라 전부 실패(RED 확인).
2. **순수 함수** — `email-sender-pick.ts`의 `pickSender`/`pickSignature` + 타입. `pnpm test` 통과(GREEN). *여기까지 tdd-driver.*
3. **DB 계층** — `resolveSender`/`resolveSignature` + 기존 두 함수를 래퍼로 전환. `npx tsc --noEmit`으로 기존 호출부 무영향 확인.
4. **스키마 + 마이그레이션** — `schema.ts` → `0064.sql` → `_journal.json`. 로컬 적용 + 재실행 멱등 확인(B15).
5. **최초 발송 + 로그 기록** — `send/route.ts`, `auto-personalized-email.ts`. **후속 상속의 데이터 공급원이므로 후속보다 먼저.**
6. **후속 경로** — `email-followup.ts` 두 분기 + `generateAiFollowupPreview` (B10, B12, B13, B14, B16).
7. **AI 테스트 경로** — `auto-personalized/test-send`, `test-followup` (B9, B11).
8. **템플릿 테스트 경로** — API 먼저(B8: 서명 미적용 버그 해결) → UI(B7). *API가 파라미터를 받을 준비 전에 UI가 보내면 조용히 무시된다.*
9. **검증** — `pnpm test`, `npx tsc --noEmit`(신규 에러만), 수동 발송 3종.

## 9. 주의점 / 함정

1. **`null` vs `undefined`를 중간에서 뭉개지 마라.** `signatureId ?? undefined`, `|| null`, `Number(signatureId)` 전부 B4 킬러다. **HTTP body → 리졸버 경로에서는 변형 금지.** `Number(null) === 0`이므로 #21이 이 실수를 잡는다.
2. **`resolveDefaultSignature` 래퍼가 `requestedId: null`을 넘기면 안 된다.** 넘기는 순간 `email-automation.ts` 등 기존 경로의 서명이 전부 사라진다.
3. **`config` 조달을 빠뜨리지 마라.** `test-send/route.ts`는 `getEmailConfig`를 인라인 블록 안에서만 부른다(`:47`). 블록을 지우며 호출도 지우면 레거시 org가 죽는다. `config` 필수 키가 이걸 tsc로 잡는 장치다.
4. **`appendSignature` 순서** — `test-send`에서 변수 치환을 서명 뒤에 하면 서명 내용까지 `replaceAll` 대상이 된다. 치환 먼저.
5. **`ResolvedSender.profileId`는 실제 사용한 프로필만 담는다.** 레거시로 떨어졌으면 `null`. 여기에 "요청된 id"를 넣으면 삭제된 id가 로그에 남아 다음 후속이 또 죽은 id를 상속한다.
6. **후속 체인의 상속 깊이** — 후속의 후속(`enqueueFollowup:437-450`)은 후속 로그를 parent로 삼는다. 5번 규칙과 8절 5단계가 지켜져야 체인 전체가 같은 발신자를 유지한다. 5단계를 건너뛰면 B12가 체인 2단계부터 무너진다.
7. **운영 전제** — "스팸 처리된 도메인을 갈아탈 때는 **옛 발신 프로필을 삭제해야** 후속이 새 도메인으로 옮겨간다. 남겨두면 후속은 계속 옛 주소로 나간다." `isActive` 플래그가 없어 삭제가 유일한 비활성화 수단이다. REPORT에 명시.
8. **`email-automation.ts`는 안 건드린다.** `email_template_links`에 `senderProfileId`가 없어 선택값 자체가 없다(범위 밖). 래퍼 덕분에 동작은 그대로.
9. **테스트 파일에서 `@/lib/db`를 import하지 마라.** 3-2의 파일 분리가 이걸 위한 것. 1단계에서 `tsx --test`로 실제 확인.

## 10. 리스크 / 열린 질문

- **[결정] AI 규칙의 `link.signatureId === null` 해석.** DB에서 `null`은 "서명 미지정"인데 `pickSignature` 계약상 `null`은 "서명 없음 확정"이다. 그대로 넘기면 기존 AI 규칙 전부에서 서명이 사라진다(현재 `auto-personalized-email.ts:158`은 falsy면 기본값으로 흘림). **방침: DB row에서 온 값만 `?? undefined`로 정규화한다. HTTP body에서 온 값은 절대 정규화하지 않는다.** 정규화 지점은 "DB row → 리졸버" 경계 한 곳뿐. 이 비대칭을 코드 주석으로 남긴다.
- **[미검증] NHN 실발송 결과.** 자동 테스트 범위 밖. From 헤더 확인은 수동 발송으로만.
- **후속 큐의 시차** — `checkAt`이 며칠 뒤라 B12/B16을 즉시 검증하기 어렵다. 큐 행의 `check_at`을 과거로 UPDATE한 뒤 크론을 수동 실행해 검증한다.
- **`test-followup`의 `link` 조회 추가**(3-10) — 조회 추가 시 org 스코프를 반드시 WHERE에. `generateAiFollowupPreview`가 org 검증을 하지만 그 결과가 POST 핸들러로 전달되지 않는다.
