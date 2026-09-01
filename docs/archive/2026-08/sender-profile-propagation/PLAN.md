# PLAN — 테스트/후속 메일이 발신 프로필·서명 설정을 따르도록 수정

- **track**: Full
- **사이클 ID**: `2026-08-07-sender-profile-propagation`

## 목표

수동 캠페인 발송과 AI 개인화 최초 발송은 사용자가 고른 발신 프로필·서명으로 나가지만, **테스트 발송과 후속(팔로우업) 발송은 전부 org 기본 프로필로만 나간다.** 원인은 `resolveDefaultSender()`/`resolveDefaultSignature()`가 "org 기본값"만 해석하도록 설계됐는데 테스트·후속 경로가 전부 이 리졸버만 호출하기 때문이다. 스팸 회피를 위해 발신 도메인을 바꿔가며 운영하는 현장에서, 후속 메일이 몰래 옛 도메인으로 나가면 캠페인 효율에 직접 타격이 간다. 이 사이클은 **발신자 선택값이 테스트·후속까지 끝까지 전파되도록** 리졸버를 일반화하고, 각 경로가 자기 맥락의 선택값을 넘기게 한다. 템플릿 후속은 원본 발신자 정보가 어디에도 남아있지 않으므로 `email_send_logs`에 발신자 컬럼을 추가해 원본을 따라가게 한다.

## 현재 상태 (탐색 결과)

| 경로 | sendEachMail 위치 | 프로필 | 서명 |
|---|---|---|---|
| 수동 캠페인 | `api/email/send/route.ts:188` | ✅ `senderProfileId` | ✅ `signatureId` |
| AI 개인화 최초 | `lib/auto-personalized-email.ts:297` | ✅ `link.senderProfileId` | ✅ `link.signatureId` |
| 템플릿 자동발송 | `lib/email-automation.ts:138` | ❌ 기본만 | ⚠️ 기본만 |
| **템플릿 테스트** | `api/email/test-send/route.ts:68` | ❌ 기본만 | ❌ **미적용** |
| **AI 테스트** | `api/email/auto-personalized/test-send/route.ts:163` | ❌ link 무시 | ⚠️ link 무시 |
| **후속 테스트** | `api/email/auto-personalized/test-followup/route.ts:204` | ❌ link 무시 | ⚠️ link 무시 |
| **템플릿 후속** | `lib/email-followup.ts:413` | ❌ 기본만 | ⚠️ 기본만 |
| **AI 후속** | `lib/email-followup.ts:597` | ❌ link 무시 | ⚠️ link 무시 |

- `cs@pixlnlogic.kr`은 하드코딩이 아니라 DB `email_sender_profiles.is_default = true` 행의 값이다. env/코드에 from 주소 하드코딩은 없다.
- `email_send_logs`(`schema.ts:663-690`)에 발신자 관련 컬럼이 **없다** → 템플릿 후속이 원본 발신자를 알 방법이 현재 없음.
- `email_template_links`(`schema.ts:622-658`)에도 `senderProfileId`가 없다. 수동 발송은 요청 body로만 받는다.
- 재사용 가능한 자산: `useSenderProfiles()`(`src/hooks/useSenderProfiles.ts`), `useSignatures()`(`src/hooks/useSignatures.ts`), `appendSignature()`(`lib/nhn-email.ts`). 신규 훅 만들지 않는다.
- 테스트 러너 존재: `pnpm test` → `tsx --test "src/**/*.test.ts"` (node:test). 기존 예시 `src/lib/attribution/parse-params.test.ts`.

## 단계별 작업

1. **리졸버 일반화** — `email-sender-resolver.ts`에 `resolveSender(orgId, opts)` / `resolveSignature(orgId, opts)` 추가. `profileId`/`signatureId`가 주어지면 org 소유권 검증 후 그것을 쓰고, 없거나 조회 실패면 기존 기본값 체인으로 fallback. 기존 `resolveDefaultSender`/`resolveDefaultSignature`는 새 함수를 호출하는 얇은 래퍼로 남겨 기존 호출부를 깨지 않는다.
2. **순수 함수 분리 + TDD** — 우선순위 결정 로직(명시값 → 기본 프로필 → 레거시 config → null)을 DB에서 떼어낸 순수 함수 `pickSender()`/`pickSignature()`로 뽑고 테스트 먼저 작성. `signatureId === null`(명시적 "서명 없음")과 `undefined`(미지정 → 기본값)의 구분이 핵심 계약.
3. **AI 테스트/후속에 link 값 전파** — `auto-personalized/test-send`, `auto-personalized/test-followup`, `email-followup.ts`의 AI 분기가 `link.senderProfileId`/`link.signatureId`를 리졸버에 넘기도록 변경.
4. **DB 마이그레이션** — `email_send_logs`에 `sender_profile_id integer` 추가(`drizzle/0064_email_send_log_sender.sql` + `meta/_journal.json` 등록 + `schema.ts` 반영).
5. **발송 로그에 발신자 기록** — 수동 발송·AI 최초 발송·후속 발송이 로그 insert 시 `senderProfileId`를 남긴다. 이게 6번의 입력이 된다.
6. **템플릿 후속이 원본 발신자 상속** — `email-followup.ts` 템플릿 분기가 `parentLog.senderProfileId`를 우선 사용한다. 단 **그 프로필이 현재도 존재할 때만** 쓰고, 삭제됐거나(구 데이터라 null이거나) 하면 현재 기본 프로필 → 레거시 config로 fallback한다. 스팸 처리된 도메인을 갈아탄 경우 옛 프로필을 지우면 후속이 자동으로 새 도메인을 따라가는 게 이 정책의 노림수다. AI 후속도 `link` 값이 없을 때 `parentLog`를 2순위로 본다.
7. **템플릿 테스트 발송 UI/API** — `EmailTestSendDialog`에 발신 프로필·서명 Select 추가(기존 훅 재사용, `SendEmailDialog` 패턴 그대로), `test-send/route.ts`가 `senderProfileId`/`signatureId`를 받아 리졸버에 위임 + `appendSignature()` 적용(현재 서명이 아예 안 붙는 버그도 같이 해결).

## 건드릴 파일

| 파일 | 변경 요지 |
|---|---|
| `src/lib/email-sender-resolver.ts` | `resolveSender`/`resolveSignature` 신규(명시 ID 우선 + 소유권 검증), 순수 `pickSender`/`pickSignature` 분리, 기존 두 함수는 래퍼로 유지 |
| `src/lib/email-sender-resolver.test.ts` | **신규** — 우선순위/`null` vs `undefined` 계약 테스트 (TDD) |
| `src/lib/db/schema.ts` | `emailSendLogs`에 `senderProfileId` 컬럼 추가 |
| `drizzle/0064_email_send_log_sender.sql` | **신규** — `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` |
| `drizzle/meta/_journal.json` | idx 64 엔트리 추가 |
| `src/lib/email-followup.ts` | 템플릿 분기(`:355-359`)는 `parentLog.senderProfileId` 상속, AI 분기(`:493-497`)는 `link` → `parentLog` → 기본. 두 분기 로그 insert에 `senderProfileId` 기록 |
| `src/app/api/email/auto-personalized/test-send/route.ts` | `:77-82`가 `link.senderProfileId`/`link.signatureId` 전달 |
| `src/app/api/email/auto-personalized/test-followup/route.ts` | `:172-179`가 `link` 값 전달 + 로그에 `senderProfileId` 기록 |
| `src/app/api/email/test-send/route.ts` | body에서 `senderProfileId`/`signatureId` 수신, 인라인 조회(`:34-55`) 제거하고 리졸버 위임, `appendSignature()` 적용 |
| `src/components/email/EmailTestSendDialog.tsx` | 발신 프로필·서명 Select 추가 (기존 훅 재사용). 로직은 훅/유틸로 분리해 `.tsx`는 렌더 중심 유지 |
| `src/app/api/email/send/route.ts` | 인라인 결정 블록(`:31-85`)을 리졸버 호출로 교체, 로그 insert에 `senderProfileId` 기록 |
| `src/lib/auto-personalized-email.ts` | 로그 insert에 `senderProfileId` 기록 |

## behavior 목록

| id | behavior | 우선순위 |
|---|---|---|
| B1 | `pickSender`: 명시 profileId가 유효하면 그 프로필을 반환한다 | P1 |
| B2 | `pickSender`: 명시 profileId가 없으면 org 기본 프로필로 fallback한다 | P1 |
| B3 | `pickSender`: 기본 프로필도 없으면 레거시 `emailConfigs.fromEmail`로 fallback하고, 그것도 없으면 `fromEmail: null` | P1 |
| B4 | `pickSignature`: `signatureId === null`이면 "서명 없음"으로 확정하고 기본 서명으로 fallback하지 않는다 | P1 |
| B5 | `pickSignature`: `signatureId === undefined`면 기본 서명 → 레거시 config 순으로 fallback한다 | P1 |
| B6 | `resolveSender`: 다른 org 소유의 profileId를 넘기면 그 프로필을 쓰지 않고 기본값으로 fallback한다 (org 격리) | P1 |
| B7 | 템플릿 테스트 발송이 다이얼로그에서 고른 발신 프로필로 나간다 | P1 |
| B8 | 템플릿 테스트 발송에 선택한 서명이 본문에 붙는다 (현재 아예 미적용) | P1 |
| B9 | AI 테스트 발송이 규칙의 `link.senderProfileId`로 나간다 | P1 |
| B10 | AI 후속 발송이 규칙의 `link.senderProfileId`로 나간다 | P1 |
| B11 | 후속 테스트 발송(`test-followup`)이 규칙의 `link.senderProfileId`로 나간다 | P2 |
| B12 | 템플릿 후속 발송이 원본 메일의 `parentLog.senderProfileId`를 상속한다 | P1 |
| B16 | 상속할 `senderProfileId`가 가리키는 프로필이 삭제된 경우 현재 기본 프로필로 fallback한다 | P1 |
| B13 | 발송 로그(`email_send_logs`)에 실제 사용된 `senderProfileId`가 기록된다 | P1 |
| B14 | `senderProfileId`가 null인 기존 로그의 후속은 기본 프로필로 나가며 에러 없이 동작한다 (하위호환) | P2 |
| B15 | 마이그레이션 0064가 멱등하게 재실행 가능하다 (`IF NOT EXISTS`) | P2 |

## 리스크/불확실성

- **운영 데이터 하위호환**: 마이그레이션 이전에 발송된 로그는 `sender_profile_id`가 null이다. B14로 fallback 경로를 반드시 살려둔다. 컬럼은 nullable로만 추가하고 backfill은 하지 않는다.
- **죽은 도메인 상속 위험**: 후속 발신자 정책은 "원본 상속 + 프로필 비활성 시 기본값"으로 확정됐다(2026-08-07 사용자 결정). 스팸 처리된 도메인을 갈아탈 때 **옛 프로필을 삭제해야만** 후속이 새 도메인을 따라간다 — 프로필을 남겨두면 후속은 계속 옛 주소로 나간다. 이 운영 전제를 REPORT에 명시한다. B16이 삭제 시 fallback을 보장한다.
  - 참고: `email_sender_profiles`에 `isActive` 류 컬럼이 없으므로 "비활성"의 판정은 **행의 존재 여부**(삭제됨)로 한다. 별도 플래그를 추가하지 않는다.
- **레거시 config 경로 상실 주의**: 프로필 테이블을 아직 안 쓰고 `email_configs`만 쓰는 org가 있을 수 있다. 3단 fallback의 마지막 단을 리팩토링 중 떨어뜨리면 그 org는 발송이 전부 막힌다. B3가 이걸 지킨다.
- **`signatureId` null/undefined 구분**: JSON body를 거치면 `null`과 키 부재가 섞이기 쉽다. 이 구분이 무너지면 "서명 없음"을 고른 사용자에게 기본 서명이 붙는다. B4/B5로 고정.
- **실제 SMTP 검증 불가**: NHN Cloud Email API 실발송은 자동 테스트로 확인할 수 없다. 순수 로직은 자동 테스트, 발송 경로는 코드 추적 + 수동 발송 검증으로 나눈다.
- `email_template_links`에는 발신 프로필 컬럼이 없어 **템플릿 자동발송(`email-automation.ts`)은 여전히 기본값**이다 — 이번 범위 밖(아래 참조).

## 검증 방법

- **자동**: `pnpm test` — `src/lib/email-sender-resolver.test.ts`가 B1~B6을 커버. 순수 함수라 DB 없이 검증 가능.
- **타입/린트**: `npx tsc --noEmit`으로 스키마 변경 여파 확인. (기존 lint 에러 44건은 이번 범위 밖 — 신규 에러만 본다.)
- **마이그레이션**: 로컬 DB에 `0064` 적용 후 `\d email_send_logs`로 컬럼 확인, 재실행해 멱등성 확인(B15).
- **수동**: 기본이 아닌 발신 프로필을 골라 ① 템플릿 테스트 발송 ② AI 테스트 발송 ③ 후속 테스트 발송 → 수신 메일함의 From 헤더가 선택값과 일치하는지 확인(B7~B11). 후속 큐는 로그 테이블의 `sender_profile_id`로 확인(B12/B13).

## 범위 밖

- 템플릿 자동발송(`email-automation.ts`)에 발신 프로필 선택 추가 — `email_template_links` 스키마 변경이 추가로 필요. 별도 사이클.
- 기존 lint 에러 44건 수정 (사용자가 "린트는 놔둬"로 명시).
- 발신 프로필 도메인 인증/SPF/DKIM 관련 기능.
- 기존 발송 로그의 `sender_profile_id` backfill.
- `nodemailer` 미사용 의존성 정리.
