# GAP — 2026-08-07-sender-profile-propagation

**unproven: 0 → 통과** (Match Rate 78%는 참고 신호)

- **분모**: `behaviors.json` B1~B16 = 16개 (사후 증감 없음)
- **✅ 9 · ⚠️ 0 · ❌ 0 · 미검증(passes:false) 7 · ➕ 2**
- 통과 기준 `unproven == 0` 충족 — `passes:true` 9건 전부 실행 근거 확보, 근거 없는 통과 주장 0건

## 검증 실행 기록

| 명령 | 결과 |
|---|---|
| `pnpm test` | `tests 35 / pass 35 / fail 0` (기존 13 + 신규 22) |
| `npx tsc --noEmit` | exit 0, 출력 없음 |
| `npm run lint` | `100 problems (44 errors, 56 warnings)` — 착수 전 baseline과 동일, 신규 0 |
| `psql -c "\d email_send_logs"` | `sender_profile_id | integer` 존재 |
| `psql -f drizzle/0064_….sql` ×2 | 2회차 `NOTICE: already exists, skipping` |

> 커버리지(lcov)는 수집하지 않았다. `tsx --test`에 리포터를 붙이는 조합을 이 프로젝트에서 검증한 적이 없어 추측으로 수치를 만들지 않는다. 이번 판정에 커버리지 층은 반영되지 않았다.

## ✅ 구현 (9)

- **B1** 명시 profileId 우선 — `email-sender-pick.ts:52-56`
  `✔ 명시 profileId가 유효하면 그 프로필을 반환한다 (B1)` / `✔ 명시 profileId는 기본 프로필을 이긴다 (B1)`
- **B2** 명시값 없으면 org 기본 프로필 — `email-sender-pick.ts:58-59`
  `✔ 명시값이 없으면 기본 프로필로 fallback한다 (B2)` / `✔ preferredIds의 null/undefined 원소는 무시한다 (B2/B14)`
- **B3** 레거시 `emailConfigs.fromEmail` 3단 fallback — `email-sender-pick.ts:61-71` (4케이스 통과)
  **호출부 보존 확인**: 모든 리졸버 호출부가 `config`를 실인자로 전달. `ResolveSenderOpts.config`가 optional이 아니라 tsc가 강제하며, `test-send/route.ts`가 `getEmailConfig(user.orgId)`를 함수 상단으로 올려 여전히 호출한다 — DESIGN 2(c)의 최대 위험 지점이 설계대로 방어됨
- **B4** `signatureId === null` → 서명 없음 확정 — `email-sender-pick.ts:96`
  **경로 전수 확인**: HTTP body → 리졸버 경로 무변형. `send/route.ts`·`test-send/route.ts` 모두 `requestedId: signatureId` raw 전달. `useEmailTestSend.ts`의 `"none" ? null : … ? Number(…) : undefined` 규약은 DESIGN 3-8과 일치하고, `JSON.stringify`가 `undefined` 키를 드롭해 3-state가 서버까지 보존된다. `?? undefined`가 붙은 4곳은 전부 DB row의 `link.signatureId` — DESIGN 10절이 지정한 유일한 정규화 지점이라 위반 아님. `|| null`·`Number()` 오염 없음
- **B5** `undefined` → 기본 서명 → 레거시 순 — `email-sender-pick.ts:103-108` (5케이스 통과)
- **B6** org 격리 — `email-sender-resolver.ts:31-35`
  `✔ 후보에 없는 id(삭제됐거나 타 org)는 건너뛰고 기본으로 간다 (B6/B16)` + 조회가 `where(eq(orgId, orgId))` 단일 필터라 타 org id는 candidates에 존재할 수 없음. DESIGN 2(a)가 "부분 자동 + 코드 리뷰"로 명시한 형태와 일치
- **B14** 구 로그 하위호환 — `email-sender-pick.ts:53`
- **B15** 마이그레이션 멱등 — `0064_email_send_log_sender.sql:14-15`. `_journal.json`에 idx 64 등록, DESIGN 3-5 값과 일치
- **B16** 삭제된 프로필 → 기본값 — `email-sender-pick.ts:52-59`
  `✔ 1순위가 죽어도 2순위를 보고, 기본으로 바로 떨어지지 않는다 (B16)`

## ⚠️ 부분 (0) · ❌ 누락 (0)

설계 항목 중 구현이 빠진 것은 없다.

## 🔶 미검증 — `passes: false` (7) · unproven 아님

B7~B13은 코드가 존재하고 tsc를 통과하지만 **NHN 실발송 또는 후속 큐 실행이 필요해 자동 검증이 불가능**하다. `behaviors.json`에 `passes:false, evidence:null`로 남아 있다 — 통과를 주장하는데 근거가 없는 unproven이 아니라 **애초에 통과를 주장하지 않은** 항목이다. PLAN 검증방법·DESIGN 5절이 이미 "수동 발송"으로 분류했다.

코드 존재는 확인했다(동작 근거 아님):

| id | 코드 위치 | 확인 |
|---|---|---|
| B7 | `test-send/route.ts:41-48` + `EmailTestSendDialog.tsx` | body 수신 → `preferredIds: [senderProfileId]`, UI Select 존재 |
| B8 | `test-send/route.ts:51-70` | `resolveSignature` + `appendSignature`. **치환 뒤 서명** 순서 준수 |
| B9 | `auto-personalized/test-send/route.ts:78-88` | `preferredIds: [link.senderProfileId]` |
| B10 | `email-followup.ts:499-509` | `preferredIds: [link.senderProfileId, parentLog.senderProfileId]` |
| B11 | `test-followup/route.ts:174-186` | `link` 조회 신규 추가 후 2단 우선순위 |
| B12 | `email-followup.ts:358-367` | `preferredIds: [parentLog.senderProfileId]`. `parentLog`가 projection 없는 `select()`라 컬럼 포함 — 체인 성립 |
| B13 | insert 5곳 | **DESIGN 지정 5곳 전수 확인, 누락 0** |

**B13 insert 5곳 대조**: `send/route.ts` · `auto-personalized-email.ts` · `email-followup.ts` 템플릿 · `email-followup.ts` AI · `test-followup/route.ts` — 전부 `senderProfileId: sender.profileId`. "요청된 id"가 아니라 실제 사용한 프로필을 넣어 DESIGN 9절 5번(죽은 id 상속 방지)을 지켰다. `test-send/route.ts`는 로그를 안 남겨 대상 아님.

## ➕ 설계 밖 (2) — 감점 아님

1. **`test-followup/route.ts`의 `parentLog` 조회에 orgId 필터 추가** — DESIGN 3-10은 "새 조회 추가 시 org 스코프 필수"만 언급했고 기존 조회의 누락은 지적하지 않았다. 구현이 이 IDOR성 결함을 함께 고쳤다. 보안 개선이나 설계 문서에 없던 변경이라 별도 집계.
2. **`hooks/useEmailTestSend.ts` 신규 (105줄)** — DESIGN 3-8의 조건부 지시("Select 추가 후 200줄 초과 시 훅 추출")가 217줄 도달로 발동한 결과다. 설계가 예견한 분기이며 `.tsx`는 167줄 렌더 전용으로 남았다.

## 파일 계획 대조

PLAN "건드릴 파일" **12개 전부 변경됨. 미착수 0건.** 신규 2개(`email-sender-pick.ts`는 DESIGN 3-2가 지정, `useEmailTestSend.ts`는 3-8 조건 발동).

`email-sender-resolver.test.ts` → `email-sender-pick.test.ts` 경로 변경은 DESIGN 3-2/3-3이 `@/lib/db` 커넥션 회피를 위해 결정한 사항으로 PROGRESS에 기록돼 있다.

## 함정 회피 확인 (DESIGN 9절)

| # | 함정 | 결과 |
|---|---|---|
| 1 | `null`/`undefined` 뭉개기 | ✅ HTTP body 무변형, DB row만 정규화 |
| 2 | `resolveDefaultSignature`가 `requestedId: null` 전달 | ✅ `{ config }`만 넘겨 키 부재 유지 — 기존 호출부 서명 보존 |
| 3 | `config` 조달 누락 | ✅ 전 호출부 전달, 필수 키로 tsc 강제 |
| 4 | `appendSignature` 순서 | ✅ 치환 → 서명 |
| 5 | `profileId`에 요청 id 넣기 | ✅ 레거시 fallback 시 `profileId: null`, 테스트로 고정 |
| 6 | 후속 체인 상속 깊이 | ✅ 후속 insert 2곳도 기록 |
| 7 | 운영 전제 명시 | ⏳ REPORT 대상 |
| 8 | `email-automation.ts` 미변경 | ✅ diff 없음, 래퍼로 동작 유지 |
| 9 | 테스트에서 `@/lib/db` import | ✅ `./email-sender-pick`만 import, DB 없이 완주 |

## 범위 밖 준수

- ✅ `email-automation.ts` 무변경 · ✅ 기존 lint 에러 미수정(총계 동일) · ✅ backfill 없음 · ✅ `email_template_links` 미변경 · ✅ `nodemailer` 미정리

## 남은 조치 (gap 아님 — 수동 검증 대기)

1. B7~B11 — 기본이 아닌 프로필을 골라 ① 템플릿 테스트 ② AI 테스트 ③ 후속 테스트 발송 후 수신함 From 헤더 대조
2. B12/B13 — 큐 행의 `check_at`을 과거로 UPDATE → 크론 수동 실행 → `select sender_profile_id from email_send_logs` 확인
3. REPORT에 운영 전제 명시: 스팸 도메인을 갈아탈 때는 **옛 발신 프로필을 삭제해야** 후속이 새 도메인을 따라간다
