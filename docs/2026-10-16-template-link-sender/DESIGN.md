# DESIGN — 템플릿 자동발송 연결에 발신 프로필(묶음) 선택 추가

- **사이클**: `2026-10-16-template-link-sender` (track Full)
- **근거**: `PLAN.md`(승인됨), `behaviors.json`(B1~B27)
- **사용자 결정**
  - Q1=(a): `SendEmailDialog`와 `api/email/send`는 바꾸지 않는다.
  - Q2=(a): 반복 메일도 회차마다 연결 묶음에서 주소를 고른다.

## 0. 결정 요약

| | 결정 | 이유 |
|---|---|---|
| D1 | 반복 대기열 막힘을 **연결 id 단위**로 적는다. 키는 `link:{templateLinkId}\|{inbound\|bulk}`이고, 첫 메일 줄과 반복 줄 모두 이 키를 쓴다. 함께 미루는 UPDATE에는 `template_link_id = 그 연결` 조건을 더한다. | 새 조건은 옛 조건에 하나를 더한 것이라, 미뤄지는 줄은 늘 예전 범위 안에 있다(새로 잘못 미뤄지는 줄이 없다). AI 발송 대기열도 규칙별로 막힘을 적는다(`src/lib/email-send-queue.ts:758-809`). |
| D2 | `SenderPoolField`에 `showBulkScheduleNotice?: boolean` prop을 더한다(기본값 `true`). | 템플릿에 안 맞는 문구는 :110-112 안내 하나뿐이고, 기본값이 지금 동작이라 AI 화면은 그대로다. |
| D3 | 상태 훅 `useRuleSenderPool(saved?)` → `{ ids, setIds }`(위치: `sender-profiles/hooks/`). 카드와 요약은 `src/components/email/template-links/ui/` 아래 조각 2개로 뺀다. 수동 연결은 카드에 안내 문구만 보이고, 저장 본문에서 발신 칸을 뺀다. | 훅은 "고치기 전에는 저장된 값"으로 파생해 useEffect가 없다(react-hooks v7 `set-state-in-effect`를 피한다). 두 page의 같은 마크업을 한 곳에 둔다. |
| D4 | 발송 옵션 조립을 순수 함수 `templateClaimOptions(link, purpose, config)`로 뺀다(`email-sender-limit-paths.ts`). node:test에서 `pickSenderCandidates`와 엮어 고정한다. | DB와 NHN 없이 B10~B12를 "실제로 고를 주소"까지 확인할 수 있다. |
| 의존성 | 새로 더하지 않는다. | |

## 1. 접근법과 트레이드오프

### 1-1. 전체 방식

| 안 | 내용 | 장점 | 대가 |
|---|---|---|---|
| **A (택함)** | AI 규칙의 묶음 장치(두 칸, `resolveRuleSenderPool`, `linkSenderPool`, `claimSender` pool, `SenderPoolField`)를 그대로 쓴다. | 저장 검증·주소 선택·화면을 AI와 같은 코드로 쓴다. "미선택이면 지금과 같은 주소"는 기존 W1 테스트가 이미 보장한다. | 반복 대기열의 "템플릿 = 기본 주소" 가정을 걷어 내야 한다(D1). |
| B | 템플릿 메일을 AI 발송 대기열로 옮긴다. | AI와 완전히 같아진다. | PLAN이 범위 밖으로 둔 "큐 이전"이다. |
| C | 공용 묶음 표를 새로 만든다. | 묶음을 다시 쓸 수 있다. | 지금 요구에는 과하다. |

React Testing Library를 넣지 않는다. 그래서 훅과 카드의 렌더 분기는 화면 확인(ego-browser)으로만 검증한다. 대신 계산 부분은 순수 함수(`formSenderIds`, `templateLinkSenderBody`)로 빼서 node:test로 고정한다.

### 1-2. D1 막힘 범위

| 안 | 키 | 장점 | 대가 |
|---|---|---|---|
| **(가) 연결 id (택함)** | `link:{id}\|{목적}` | 단순하고, 막히는 범위가 예전보다 좁아지기만 한다. 회차 중에 묶음이 바뀌어도 키가 그대로다. | 같은 주소를 쓰는 연결이 여럿이면, 그 연결 수만큼 `claimSender`를 더 부른다. |
| (나) 묶음 | 조직 + 후보 집합 + 목적 | 같은 묶음을 쓰는 연결끼리 헛조회가 없다. | "같은 묶음" 판정이 어렵고(지운 id, `[]`, NULL이 모두 같은 뜻이다), 틀리면 다른 연결 발송이 잘못 미뤄진다(B17 위반). |
| (다) 혼합 | 묶음이 빈 연결만 조직 단위 | | 분기가 둘이 되고 (나)의 판정 문제도 남는다. |

막힘 기록은 최적화일 뿐이고, 실제로 보낼지는 `claimSender`의 원자적 자리 잡기가 정한다. 그래서 덜 묶는 쪽의 대가는 조회 몇 번이고, 더 묶는 쪽의 대가는 메일이 하루 밀리는 것이다.

### 1-3. D2·D3·D4

- **D2**: `variant` prop이나 안내 문구를 바깥으로 빼는 방식보다 boolean 하나가 가장 작다.
- **D3**: page에 useState와 useEffect를 두면 `.tsx`에 로직을 넣는 규칙 위반이고 eslint 오류도 난다. 페이지 전체를 리팩터하는 것은 범위 밖이다. 그래서 effect 없는 훅과 조각 2개로 한다. 초기화는 `useState<number[] | null>(null)` 하나로 하고, 고치기 전에는 저장된 묶음을 보여 준다.
- **D4**: `sendEmailSingle`을 mock으로 테스트하려면 틀이 없고 node:test의 mock.module은 실험 기능이다. 그래서 순수 함수로 빼서 테스트한다. 실제로 이 함수를 부르는지는 코드 확인과 로컬 발송(B16)으로 본다.

## 2. 데이터 흐름

```
[화면] src/app/email/links/new/page.tsx · [id]/page.tsx   (조립만)
  ├ const sender = useRuleSenderPool(link?)            sender-profiles/hooks (.ts) → formSenderIds (utils, 순수)
  ├ <TemplateLinkSenderCard triggerType value onChange/>        template-links/ui
  │     isManualTrigger(triggerType) ? 안내 문구 : <SenderPoolField showBulkScheduleNotice={false}/>
  ├ <TemplateLinkSenderSummary triggerType ids/>                template-links/ui
  │     SenderPoolSummary · RuleQueueSummary(linkId 없이 → "오늘 용량"만) · ReplyToSummaryRow
  └ handleSave → createLink / updateLink({ ...기존, ...templateLinkSenderBody(triggerType, sender.ids) })
[API]  POST /api/email/template-links · PUT /api/email/template-links/[id]
  └ resolveRuleSenderPool(user.orgId, { senderProfileId, senderProfileIds })  → 400 | value(null = 칸을 건드리지 않음)
[DB]   email_template_links.sender_profile_id · sender_profile_ids   (0088)
[발송] processEmailAutoTrigger / processRepeatItem → sendTemplateFirst → sendEmailSingle
  └ claimSender(orgId, templateClaimOptions(link, purpose, config))     pool, linkSenderPool(link)
[반복 대기열] processRepeatItem: activeBlock(purposeBlockKey(link.id, 목적)) · markLinkBlocked(연결 범위)
[후속] handleTemplateFollowup: fixed, ids = followupSenderOrder(parentLog.senderProfileId, link)
[수동] api/email/send — 바꾸지 않음 (요청의 senderProfileId가 우선)
```

조직 격리는 두 겹이다. 저장할 때 `resolveRuleSenderPool`이 검사하고, 보낼 때 `loadProfilesAndUsage`가 org_id로 조회한다.

## 3. D1 상세

### 3-1. 키와 시그니처 (`src/lib/email-sender-limit-paths.ts`)

```ts
export function purposeBlockKey(templateLinkId: number, purpose: SendPurpose): string
//   → `link:${templateLinkId}|${purpose}`
export function recordPurposeBlock(blockedUntil: Map<string, Date>, templateLinkId: number, purpose: SendPurpose, retryAt: Date): void
//   동작은 그대로: inbound → inbound·bulk 두 키, bulk → bulk 키. 더 늦게까지 막힌 기록은 당기지 않는다
activeBlock / templateFirstKindsBlockedBy — 변경 없음
```

- 첫 인자의 형을 string(조직 id)에서 number(연결 id)로 바꾼다. 조직 id를 넘기는 곳이 남아 있으면 tsc가 잡는다.
- 설명 주석 :173-176, :212-216, :231-234의 "조직"을 "연결"로 고친다.

### 3-2. 줄 종류별 동작 (`processRepeatItem`)

| kind | 볼 키 | 막혔을 때 | 함께 미루는 줄 |
|---|---|---|---|
| `first` | `link:{id}\|inbound` (:629) | `markLinkBlocked` (:642) | 같은 조직·같은 연결의 기한 된 `first`·`first_bulk` |
| `first_bulk` | `link:{id}\|bulk` (:629) | `markLinkBlocked` (:642) | 같은 조직·같은 연결의 기한 된 `first_bulk` |
| `repeat` | `link:{id}\|bulk` (:690) | `recordPurposeBlock(link.id, "bulk")` (:720) | 없음(지금과 같음) |

`RepeatRunState`(:581-589)의 모양은 그대로 두고 설명만 고친다.

### 3-3. `markOrgBlocked` → `markLinkBlocked` (:759-792)

```ts
async function markLinkBlocked(
    run: RepeatRunState,
    block: { orgId: string; templateLinkId: number; purpose: SendPurpose; retryAt: Date; exceptId: number },
): Promise<number>
```

UPDATE는 drizzle 빌더로 쓴다. 의미는 아래 SQL과 같다.

```sql
UPDATE email_automation_queue
   SET next_run_at = $retryAt, updated_at = $now
 WHERE org_id = $orgId
   AND template_link_id = $templateLinkId     -- 새 조건 (D1)
   AND kind IN ($kinds)                       -- templateFirstKindsBlockedBy(purpose)
   AND status = 'pending'
   AND next_run_at <= $runStart
   AND id <> $exceptId
RETURNING id;
```

- 색인 `eq_template_record_idx (template_link_id, record_id)`를 탄다.
- 로그: `[EmailRepeat] link ${templateLinkId} (org ${orgId}): 발신 주소가 막혀(${purpose}) 첫 메일 ${n}줄을 함께 미룸`.

### 3-4. 기존 테스트 변경 (`email-sender-limit-paths.test.ts:250-311`)

- 조직 키 `"o1"`/`"o2"`를 연결 id `15`/`16`으로 바꾼다. "다른 조직은 그대로" 단언은 "다른 연결은 그대로"(B17)로 바꾼다.
- `purposeBlockKey` 모양을 확인하는 테스트를 하나 더한다.
- `"o1"`을 그대로 두면 tsc가 실패하므로 반드시 바꾼다.

## 4. 타입·시그니처

```ts
// schema.ts emailTemplateLinks (followupConfig 뒤)
senderProfileId: integer("sender_profile_id"),
senderProfileIds: jsonb("sender_profile_ids").$type<number[]>(),

// email-sender-limit-paths.ts (순수)
export interface TemplateClaimOptions { mode: "pool"; ids: number[]; config: LegacyEmailConfig | null; spreadDeferrals: true; purpose: SendPurpose }
export function templateClaimOptions(
    link: { senderProfileId: number | null; senderProfileIds: number[] | null },
    purpose: SendPurpose,
    config: LegacyEmailConfig | null,
): TemplateClaimOptions
// email-automation.ts:159-165 → claimSender(orgId, templateClaimOptions(link, purpose, config))
// email-followup.ts:652-660 → ids: followupSenderOrder(parentLog.senderProfileId, link)

// sender-profiles/types/index.ts
export interface SavedSenderPool { senderProfileId: number | null; senderProfileIds: number[] | null }
export interface RuleSenderPool { ids: number[]; setIds: (ids: number[]) => void }
// sender-profiles/utils/senderPool.ts (순수)
export function formSenderIds(edited: number[] | null, saved: SavedSenderPool | null | undefined): number[]
// sender-profiles/hooks/useRuleSenderPool.ts ("use client", useEffect 없음)
export function useRuleSenderPool(saved?: SavedSenderPool | null): RuleSenderPool
// template-links/utils/templateLinkSender.ts (순수)
export function isManualTrigger(triggerType: string): boolean
export function templateLinkSenderBody(triggerType: string, ids: readonly number[]): { senderProfileIds?: number[] }
//   자동 → { senderProfileIds: [...ids] } (빈 배열 포함) / 수동 → {}
// SenderPoolField props += showBulkScheduleNotice?: boolean (기본 true)
// TemplateLinkSenderCard { triggerType; value; onChange } · TemplateLinkSenderSummary { triggerType; ids }
// useEmailTemplateLinks createLink·updateLink 인자 += senderProfileId?: number | null; senderProfileIds?: number[] | null
```

**화면 조각**
- `TemplateLinkSenderCard`
  - `Card id="section-sender"`, 제목 "발신 설정".
  - 설명: "자동 발송 메일을 보낼 발신 프로필 (고르지 않으면 기본 발신 프로필)".
  - 자동 연결: Label "발신 프로필" + `SenderPoolField showBulkScheduleNotice={false}`.
  - 수동 연결: "수동 발송은 발송 창에서 고른 발신자로 나갑니다"와 "발송 방식을 '생성 시'나 '수정 시'로 바꾸면 여기서 발신 프로필을 고릅니다." 두 줄.
- `TemplateLinkSenderSummary`
  - 자동 연결: 발신(`SenderPoolSummary`), 오늘 용량(`RuleQueueSummary ids`, **linkId를 넘기지 않는다**), 답장(`ReplyToSummaryRow`) 세 줄.
  - 수동 연결: "발신 — 발송 창에서 선택" 한 줄.
- 두 page는 발송 방식을 `triggerType` 상태(`"manual" | "on_create" | "on_update"`, 기본값 "manual")로 들고 있다. 편집 화면은 :100에서 저장된 값으로 채운다.

## 5. 마이그레이션 SQL 전문

`drizzle/0088_template_link_sender_pool.sql`:

```sql
-- 템플릿 자동발송 연결의 발신 주소 묶음 (docs/2026-10-16-template-link-sender/DESIGN.md)
-- AI 규칙(email_auto_personalized_links)과 같은 두 칸이다. sender_profile_id = 묶음의 첫 주소, sender_profile_ids = 고른 순서의 묶음.
-- 외래 키를 두지 않는다 (AI 규칙과 같음) — 프로필을 지워도 연결은 남고, 발송 때 이 조직에 없는 id는 빠져 기본 주소로 나간다.
-- 두 칸 모두 NULL 허용·기본값 없음이라 표를 다시 쓰지 않는다. 기존 연결은 두 칸이 NULL = 지금처럼 기본 발신 주소.
-- 잠금을 5초 안에 못 얻으면 55P03으로 되돌리고 migrate.ts가 다시 시도한다 (0075·0078·0080·0082와 같은 값). 다시 돌려도 같다 (IF NOT EXISTS).
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "email_template_links" ADD COLUMN IF NOT EXISTS "sender_profile_id" integer;
--> statement-breakpoint
ALTER TABLE "email_template_links" ADD COLUMN IF NOT EXISTS "sender_profile_ids" jsonb;
```

`_journal.json`에 `{ "idx": 88, "version": "7", "when": 1775100000000, "tag": "0088_template_link_sender_pool", "breakpoints": true }`를 더한다. `schema.ts`와 같은 커밋으로 넣는다.

## 6. API 계약

- **POST**
  - 받는 값: `senderProfileIds: number[] | null`, `senderProfileId: number | "3" | null`(예전 방식, ids가 있으면 무시). 둘 다 선택 사항이다.
  - 처리 순서: 인증 → 필수 칸 → 파티션 소유 → 템플릿 소유 → **`resolveRuleSenderPool` (실패 시 400)** → insert.
  - 응답 201: `data`에 두 칸이 들어 있다.
- **PUT**: 두 칸이 모두 없으면 묶음을 건드리지 않는다(B6). `senderPool.value`가 있을 때만 두 칸을 함께 쓴다.
- **오류 (400, POST·PUT 공통)**
  - `선택한 발신 주소를 찾을 수 없습니다.`
  - `발신 주소 묶음은 목록(배열)이어야 합니다.`
  - `발신 주소 id는 양의 정수여야 합니다.`
  - `발신 주소는 최대 50개까지 묶을 수 있습니다.`
  - 검사는 저장 전에 끝나므로, 오류가 나면 연결은 만들어지지도 바뀌지도 않는다.
- **GET**: 바꾸지 않는다. `select()`로 모든 칸을 읽으므로 두 칸이 그대로 나간다(B9).

## 7. 파일 계획

| 파일 | 내용 | 커밋 |
|---|---|---|
| `drizzle/0088_template_link_sender_pool.sql` (새 파일), `drizzle/meta/_journal.json`, `src/lib/db/schema.ts` | 칸 추가 | C1 |
| `src/app/api/email/template-links/route.ts`, `[id]/route.ts`, `src/hooks/useEmailTemplateLinks.ts` | 검사·저장, 요청 타입 | C2 |
| `src/lib/email-sender-limit-paths.ts`, `src/lib/email-automation.ts`, 주석(`email-sender-limit.ts`, `email-sender-pick.ts`, `email-sender-limit-rules.ts`, `email-sender-resolver.ts`), `email-sender-limit-paths.test.ts` | pool 발송, 연결 단위 막힘 | C3 |
| `src/lib/email-followup.ts`, 테스트 | 후속 주소 순서 | C4 |
| `src/components/email/sender-profiles/ui/SenderPoolField.tsx` | prop 추가 | C5 |
| `sender-profiles/types/index.ts`, `utils/senderPool.ts`(+test), `hooks/useRuleSenderPool.ts`(새 파일), `template-links/utils/templateLinkSender.ts`(+test, 새 파일), `template-links/ui/TemplateLinkSenderCard.tsx`, `TemplateLinkSenderSummary.tsx`(새 파일), `src/app/email/links/new/page.tsx`, `[id]/page.tsx` | 화면 | C6 |

바꾸지 않는 파일: `api/email/send`, `SendEmailDialog`, `EmailTemplateLinkList`, AI 규칙 page들, `RuleQueueSummary`, `SenderPoolSummary`, `ReplyToSummaryRow`.

## 8. TDD로 먼저 고정할 계약

**`src/lib/email-sender-limit-paths.test.ts` (C3, 구현 전에 먼저 실패해야 함)**
1. `purposeBlockKey`: 모양이 `"link:{id}|{목적}"`이고, 연결이나 목적이 다르면 키도 다르다.
2. `recordPurposeBlock` (고침): 문의가 막히면 같은 연결의 대량도 막히고, 다른 연결은 그대로다 (B17).
3. `recordPurposeBlock` (고침): 대량이 막혀도 같은 연결의 문의는 열려 있다.
4. `recordPurposeBlock` (고침): 더 늦게까지 막힌 기록은 당기지 않는다.
5. `templateClaimOptions`: AI와 같은 pool이다. `{8,[8,7]}` + inbound → `{mode:"pool", ids:[8,7], config, spreadDeferrals:true, purpose:"inbound"}`, bulk도 그대로 넘긴다. `{7,null}` → `[7]` (B10·B15).
6. `templateClaimOptions`: 묶음이 NULL이거나 비었으면 고른 주소가 `fixed` + `[]`와 같다(기본 프로필 5, 기본이 없으면 레거시 설정) (B11).
7. `templateClaimOptions`: 묶음의 id가 모두 지워졌거나 다른 조직 것이면 기본 프로필이고, 다른 조직 주소로 새지 않는다 (B12).
8. `templateClaimOptions`: `[99,8,7]` → 후보는 `[8,7]` (B12·B13).

**같은 파일 (C4, 기존 함수 확인)**
9. 템플릿 후속은 첫 메일 주소가 먼저다. 7 → 7, 지운 99 → 8, null에 빈 묶음 → 5 (B19).
10. 묶음이 없는 예전 연결의 후속은 예전처럼 `[첫 메일 주소]`다 (B19 회귀).

**`src/components/email/sender-profiles/utils/senderPool.test.ts` (C6)**
11. `formSenderIds`: 고치기 전에는 저장된 묶음을 쓰고, 예전 칸만 있으면 `[id]`다 (B22).
12. `formSenderIds`: 한 번 고친 값은 저장된 묶음이 다시 와도 바뀌지 않는다. 고친 값이 빈 묶음이어도 마찬가지다 (B22).
13. `formSenderIds`: 저장된 묶음이 없으면 빈 묶음이다 (B21).

**`src/components/email/template-links/utils/templateLinkSender.test.ts` (C6)**
14. `templateLinkSenderBody`: 자동 연결은 고른 묶음을 싣고, 빈 묶음도 싣는다 (B21·B22·B5).
15. `templateLinkSenderBody`: 수동 연결은 발신 칸을 싣지 않는다(`"senderProfileIds" in r`가 false) (B27·B6).
16. `isManualTrigger`: `"manual"`일 때만 true다 (B27).

API 라우트, UPDATE SQL, 발송 배선은 로컬 시나리오로, 화면은 ego-browser로 확인한다.

## 9. 구현 순서

| # | 내용 | behavior | 통과 조건 |
|---|---|---|---|
| C1 | 0088 마이그레이션, 저널, schema | B1·B2 | tsc 통과, 로컬 `\d email_template_links`에 두 칸 |
| C2 | API 검사·저장 | B3~B9 | tsc 통과, 로컬 API 시나리오 |
| C3 | 테스트 1~8 → paths.ts → automation.ts → 주석 | B10~B18 | pnpm test, tsc, 로컬 발송·대기열 시나리오 |
| C4 | 테스트 9~10 → email-followup.ts | B19 | pnpm test, tsc |
| C5 | `SenderPoolField` prop | B24 | tsc, eslint |
| C6 | 테스트 11~16 → 유틸·타입·훅 → ui 조각 → page 두 곳 | B21~B23, B25~B27 | pnpm test, tsc, eslint, ego-browser |

C3는 반드시 한 커밋으로 낸다. C6은 C2·C3·C5 뒤에 낸다. 커밋 전에 사용자 확인을 받는다.

## 10. behavior별 검증

| B | 검증 |
|---|---|
| B1 | 로컬 서버를 켜서 마이그레이션 → `\d email_template_links`에 두 칸 → psql로 한 번 더 돌려도 오류 없음 → 두 칸에 값이 있는 행 0건 |
| B2 | tsc |
| B3 | 로컬 API에 `[B,A,B]` → 201, `senderProfileIds`=`[B,A]`, `senderProfileId`=B |
| B4 | 다른 조직 id나 999999 → 400. 연결 행 수가 그대로이고, PUT이면 name도 바뀌지 않음 |
| B5 | `[]` 또는 null → 두 칸 NULL |
| B6 | `{ isActive: 0 }`만 PUT → 묶음 그대로 |
| B7 | 기존 `normalizeSenderPool` 테스트 + 로컬 API에 `"3"`, `[0]`, `[1.5]`, 51개 → 400 |
| B8 | `senderProfileId: A`만 보냄 → `[A]` |
| B9 | GET 응답에 두 칸 |
| B10 | 테스트 5 + `rg 'mode: "fixed"' src/lib/email-automation.ts` 결과 0건 |
| B11 | 테스트 6 + 로컬: 묶음이 NULL인 연결의 발송 로그가 기본 주소 |
| B12 | 테스트 7·8 |
| B13 | 테스트 8 + 기존 W9 + 로컬: 묶음 [X,Y]로 두 건 → 주소가 갈림. 둘 다 정지 → `first` 줄로 미뤄짐 |
| B14 | 로컬: 미뤄진 줄을 둔 채 묶음을 [Y]로 바꾸고 회차 실행 → 발송 로그가 Y |
| B15 | 테스트 5(bulk) + 코드 확인 |
| B16 | B11·B13 로컬 시나리오에서 발송 로그의 `sender_profile_id`·`sender_email` |
| B17·B18 | 대기열 시나리오(아래) |
| B19 | 테스트 9·10 + 코드 확인 |
| B20 | `git diff --stat`에 `api/email/send`, `SendEmailDialog`가 없음 |
| B21 | 테스트 13·14 + ego-browser: 새 연결 → 생성 시 → 2개 체크 → 저장 → GET에 두 칸 |
| B22 | 테스트 11·12 + ego-browser: 편집 화면에서 체크 상태 확인 → 바꿔 저장 → PUT 본문 확인 |
| B23 | ego-browser: 요약 칸에 발신·오늘 용량·답장 세 줄, AI 대기열 줄은 없음 |
| B24 | ego-browser: 템플릿 화면엔 예약 안내가 없고, AI 화면엔 있음 |
| B25 | 로컬 DB에서 묶음을 `[999999]`로 바꿈 → 편집 화면에 경고 → 저장 시 토스트 |
| B26 | page.tsx diff에 useState·useEffect·새 함수 정의가 없음 |
| B27 | 테스트 15·16 + ego-browser: 수동 연결에 안내 → "생성 시"로 바꾸면 선택 칸 |

**대기열 시나리오 (B17·B18)**
- 준비
  - NHN 설정이 있는 로컬 조직이 필요하다. 없으면 개발 서버를 쓰고, 수신 주소는 본인 주소만 쓴다.
  - 발신 프로필 X(`is_paused=true`)와 Y(한도 없음)를 만든다.
  - 연결 A는 묶음 [X], 연결 B는 묶음 [Y]로 만든다(on_create).
  - 기한이 된 `first` 줄을 A에 2개 넣고, 그다음 B에 1개 넣는다.
- 실행: `process-repeats`를 부른다.
- 기대 결과
  - A의 두 줄은 함께 미뤄진다(`link A … 1줄을 함께 미룸` 로그).
  - B의 줄은 Y로 발송되고 completed가 된다.
  - 통계는 deferred=2, sent=1이다. 고치기 전 코드라면 sent=0이 나온다.

**공통**: `pnpm test`, `npx tsc --noEmit`, 바꾼 파일 eslint(기준선과 비교).

## 11. PLAN과 어긋나는 곳

1. 새 파일이 늘었다: `template-links/` 아래 ui 2개와 utils(+테스트), `senderPool.ts` 함수, types. 같은 마크업이 두 번 생기는 것을 막고 `.tsx` 로직 금지 규칙을 지키기 위해서다.
2. 테스트 파일이 2개 더 생긴다.
3. `sendEmailSingle`은 `templateClaimOptions`를 거쳐 pool로 바꾼다. 결과는 PLAN과 같다.
4. 수동 연결은 저장 본문에서 발신 칸을 뺀다(B6·B27과 맞춘 것이다).
5. 훅 초기화는 effect가 아니라 파생으로 한다.
6. 이름: `markOrgBlocked`를 `markLinkBlocked`로 바꾸고, `purposeBlockKey`·`recordPurposeBlock`은 첫 인자의 형만 바꾼다.
7. 막힘 범위 키를 만드는 별도 순수 함수는 두지 않는다. SQL WHERE와 `templateFirstKindsBlockedBy`로 충분하다.
8. B9는 코드를 바꿀 필요가 없다.
9. B26 예외: page.tsx에 앵커 버튼 1개(기존 인라인 onClick과 같은 형태)와 handleSave의 펼치기 한 줄이 들어간다.
10. 새 연결 화면에 힌트 한 줄을 더한다. 기본 발송 방식이 '수동'이라 카드가 처음에 안내 문구로 보이기 때문이다.

## 12. 리스크와 열린 질문

- **이미 다음 날로 미뤄진 줄**: 그 시각까지 기다린다(지금도 같다). 당기려면 운영 DB UPDATE가 필요하고, 사용자 승인을 받아야 한다.
- **회차 중에 묶음을 바꾸면**: 그 회차의 막힘 기록은 옛 묶음 기준이다. 다음 retryAt부터 새 묶음을 쓴다(B14).
- **같은 주소를 쓰는 연결이 여럿일 때**: 그 수만큼 자리 잡기를 더 부른다.
- **eslint 기준선**: `[id]/page.tsx:94-108`의 effect 안 setState는 원래 있던 코드다. 기준선과 비교해 새로 생긴 경고만 본다.
- **page 크기**: 두 page는 이미 450줄대이고 약 12줄 늘어난다.
- **편집 화면 첫 렌더**: 처음 한 번은 안내 문구가 잠깐 보일 수 있다.
- **범위 밖**: "템플릿 = 기본 주소"라고 적힌 문구 3곳(`sender-health-rules.ts:1256`, `SendHealthCard.tsx:185`, `SenderLimitSection.tsx:244`), 알림 대상 찾기 2곳(`partition-hold.ts:339-345`, `sender-health.ts:944-963`), PUT의 `emailTemplateId` 버그.
- **O1 (기본안)**: 연결을 수동으로 바꿔도 저장된 묶음은 그대로 둔다. 다시 자동으로 바꾸면 되살아난다.
- **O2 (기본안)**: 카드는 맨 위에 두고 힌트 한 줄을 더한다.
- **O3 (기본안)**: 수동 연결의 요약은 "발신 — 발송 창에서 선택" 한 줄이다.
