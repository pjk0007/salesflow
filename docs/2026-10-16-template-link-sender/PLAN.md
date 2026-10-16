# PLAN — 템플릿 자동발송 연결에 발신 프로필(묶음) 선택 추가

- **track**: Full
- **사이클 ID**: `2026-10-16-template-link-sender`

## 목표

템플릿 자동발송 연결(`email_template_links`)에 AI 규칙과 같은 발신 주소 묶음 칸(`sender_profile_id`, `sender_profile_ids` jsonb)을 추가한다.

- **화면**: 연결 화면에서 AI 규칙 화면의 `SenderPoolField`로 묶음을 고른다.
- **저장**: AI와 같은 `resolveRuleSenderPool`로 이 조직의 프로필인지 검사한다.
- **발송**: 템플릿 첫 메일, 미뤄 둔 첫 메일, 반복 메일이 AI 첫 메일과 같은 방식(`claimSender` pool + `linkSenderPool(link)`)으로 묶음에서 주소를 고른다.
- **미선택**: 묶음을 고르지 않으면 지금처럼 기본 프로필로 나간다.

운영 근거: 연결 15 [백오랩 구매DB html](on_create)의 최근 30일 1,512건이 모두 기본 프로필 cs@pixlnlogic.com으로 나갔다.

## 조사 결과

1. **재사용 UI**
   - `src/components/email/sender-profiles/ui/SenderPoolField.tsx`({value: number[], onChange})를 그대로 쓸 수 있다.
   - `:110-112`의 예약 안내는 AI 대량 예약 전용이라, 템플릿 화면에서는 보이지 않게 해야 한다.
   - 요약 칸은 `SenderPoolSummary`와 `ReplyToSummaryRow`를 쓴다.
   - `RuleQueueSummary`에는 `linkId`를 넘기지 않는다. 넘기면 AI 대기열 통계를 규칙 id로 찾는데, 템플릿 연결 id와 번호가 겹친다.
2. **저장 검증**
   - AI POST·PUT은 `resolveRuleSenderPool(orgId, {senderProfileId, senderProfileIds})`를 쓴다(`src/lib/email-sender-resolver.ts:112-148`).
   - 다른 조직 프로필 id가 오면 400을 돌려준다.
   - 두 값이 모두 없으면 `value: null`을 돌려주고 저장된 칸을 건드리지 않는다.
3. **AI 첫 메일의 주소 선택**: `claimSender(orgId, { mode: "pool", ids: linkSenderPool(link), config, spreadDeferrals: true, purpose })`(`src/lib/auto-personalized-email.ts:243, 271-278`).
4. **템플릿의 지금 동작**
   - `sendEmailSingle`(`src/lib/email-automation.ts:159-165`)이 `mode: "fixed", ids: []`로 불러서 늘 기본 프로필로 나간다.
   - pool에 빈 ids를 넘겨도 결과가 같다(W1 테스트).
5. **`sendEmailSingle`을 부르는 경로**
   - 첫 메일: `sendTemplateFirst`를 거친다. 문의(생성·수정 API, v1, Meta 웹훅, 공개 폼)와 대량(가져오기, 예약 등록)이 여기에 해당한다.
   - 반복 대기열: `first`·`first_bulk`·`repeat`.
   - `sendEmailSingle`을 거치지 않는 경로
     - 수동 발송 `api/email/send`: 요청의 `senderProfileId`가 우선이다.
     - 템플릿 후속: `[parentLog.senderProfileId]`로 첫 메일 주소를 이어 쓴다.
6. **반복 대기열의 막힘 기록**
   - 막힘이 조직 단위(`purposeBlockKey(orgId, 목적)`)로 기록된다.
   - `markOrgBlocked`가 그 조직의 기한 된 `first`·`first_bulk` 줄을 모두 함께 미룬다(`email-automation.ts:766-792`). "템플릿 메일은 늘 기본 주소로 나간다"는 가정이 근거다.
   - 연결마다 묶음이 생기면 이 가정이 깨지므로, 이번 작업에서 막힘 범위를 함께 좁혀야 한다.
7. **목록 화면**: AI 규칙 목록에도 발신 주소 표시가 없다. `EmailTemplateLinkList`는 바꾸지 않는다.
8. **마이그레이션**
   - 마지막은 `0087`(idx 87, when 1775000000000)이고, 다음은 `0088`이다.
   - 서버가 켜질 때 한 트랜잭션으로 적용된다.
   - 관례대로 `SET LOCAL lock_timeout = '5s'`와 statement-breakpoint를 쓴다.
9. **테스트 현황**
   - 테스트가 있는 함수: `pickSender`, `pickSenderCandidates`, `followupSenderOrder`, 막힘 기록 함수들, `linkSenderPool`, `normalizeSenderPool`.
   - DB를 쓰는 `resolveRuleSenderPool`, `sendEmailSingle`, `processRepeatItem`에는 단위 테스트가 없다.

## 단계별 작업

1. **DB 칸**: 0088 마이그레이션(두 칸 모두 NULL 허용, IF NOT EXISTS), 저널 등록, `schema.ts` `emailTemplateLinks`에 칸 추가. 외래 키는 두지 않는다(AI와 같음).
2. **API**
   - POST·PUT에서 `senderProfileId`·`senderProfileIds`를 받아 `resolveRuleSenderPool`로 검사한 뒤 저장한다.
   - PUT은 값이 왔을 때만 저장한다.
   - 훅 `useEmailTemplateLinks`의 요청 본문 타입에 두 칸을 더한다.
3. **발송과 막힘 범위 (한 커밋)**
   - `sendEmailSingle`을 `mode: "pool", ids: linkSenderPool(link)`로 바꾼다.
   - 반복 대기열의 막힘 기록과 함께 미루기 범위를 조직 단위에서 연결 단위로 좁힌다(D1).
   - "템플릿 = 기본 주소" 가정이 적힌 주석과 로그를 고친다.
4. **템플릿 후속 (P2)**: `followupSenderOrder(parentLog.senderProfileId, link)`로 바꾼다. 첫 메일 주소를 먼저 쓰고, 그 주소가 없으면 묶음 → 기본 순으로 고른다.
5. **화면**
   - `SenderPoolField`에 예약 안내를 끄는 선택 prop을 더한다. 기본값은 지금 동작이다.
   - 묶음 상태는 `.ts` 훅에 둔다.
   - 새 연결·편집 화면 맨 위에 "발신 설정" 카드를 두고, 저장 본문에 `senderProfileIds`를 싣는다.
   - 요약 칸에 발신·오늘 용량·답장 줄을 더하고, 섹션 앵커도 더한다.
6. **수동 발송**: 서버는 바꾸지 않는다. 발송 창도 바꾸지 않는다(Q1=a).
7. **주석 정리**: 발신 모드 설명을 "pool = AI·템플릿 첫 메일 / fixed = 후속·수동"으로 고친다.
8. **테스트**: 막힘 범위 키와 템플릿 연결 모양의 `followupSenderOrder` 케이스를 추가한다.
9. **검증**: 아래 검증 방법대로 한다.
10. **운영 반영**: 배포하면 0088이 운영 DB에 적용된다. 연결 15의 발신 프로필은 배포 후 화면에서 정한다.

## 건드릴 파일

**DB**
- `drizzle/0088_template_link_sender_pool.sql` (새 파일): 두 칸 추가, lock_timeout 5s.
- `drizzle/meta/_journal.json`: idx 88, when 1775100000000.
- `src/lib/db/schema.ts:662-698`: `senderProfileId`, `senderProfileIds`.

**API**
- `src/app/api/email/template-links/route.ts`: POST 입력, 검사, insert.
- `src/app/api/email/template-links/[id]/route.ts`: PUT 입력, 검사, 조건부 update.
- `src/hooks/useEmailTemplateLinks.ts`: 요청 본문 타입.

**발송**
- `src/lib/email-automation.ts`
  - `:155-165`: pool로 바꾸기.
  - 막힘 범위: `:582-589`, `:627-643`, `:689-695`, `:714-721`, `:759-792`.
  - 주석.
- `src/lib/email-sender-limit-paths.ts:173-243`: 막힘 키와 범위 키, 설명.
- `src/lib/email-followup.ts:648-660`: `followupSenderOrder`.
- `src/lib/email-sender-limit.ts:74-92`, `src/lib/email-sender-pick.ts:37-42`: 주석만.

**화면**
- `src/components/email/sender-profiles/ui/SenderPoolField.tsx`: 선택 prop.
- `src/components/email/sender-profiles/hooks/useRuleSenderPool.ts` (새 파일): 묶음 상태와 초기화.
- `src/app/email/links/new/page.tsx`, `src/app/email/links/[id]/page.tsx`: 카드, 저장 본문, 요약 칸, 앵커.

**테스트**
- `src/lib/email-sender-limit-paths.test.ts`

## behavior 목록

- B1 — 0088이 두 칸(NULL 허용)을 더하고 저널에 idx 88로 등록된다. 다시 돌려도 오류가 없고, 기존 연결은 두 칸 모두 NULL이다 (P1)
- B2 — 스키마와 `EmailTemplateLink` 타입에 두 칸이 있어 `linkSenderPool(link)`에 형 변환 없이 넘긴다 (P1)
- B3 — POST에 이 조직 프로필 id 배열을 보내면 고른 순서(중복 제거)로 저장되고, `sender_profile_id`는 첫 원소이며, 응답에 두 칸이 있다 (P1)
- B4 — POST·PUT에 다른 조직이거나 없는 id가 하나라도 있으면 400 "선택한 발신 주소를 찾을 수 없습니다."를 돌려주고, 연결은 만들어지지도 바뀌지도 않는다 (P1)
- B5 — 빈 배열이나 null을 보내면 두 칸이 NULL로 저장된다 (P1)
- B6 — PUT에 두 값이 모두 없으면(켜기/끄기 등) 저장된 묶음이 그대로다 (P1)
- B7 — 형식이 틀린 값이나 50개를 넘는 묶음은 400이다 (P2)
- B8 — `senderProfileId` 하나만 보내도 `[id]` 묶음으로 저장된다 (P2)
- B9 — GET 응답에 두 칸이 들어 있다 (P2)
- B10 — 템플릿 첫 메일의 주소 선택이 `claimSender(orgId, { mode: "pool", ids: linkSenderPool(link), ... })`이고, 목적(inbound/bulk)은 지금과 같다 (P1)
- B11 — 묶음이 NULL이거나 빈 연결은 기본 프로필 → 레거시 설정으로 나간다 (P1)
- B12 — 묶음 id가 모두 지워졌거나 다른 조직 것이면 기본 프로필로 나가고, 다른 조직 주소로는 나가지 않는다 (P1)
- B13 — 주소가 둘 이상이면 보낼 수 있는 주소 중 가장 오래 쉰 주소로 나가고, 모두 막히면 반복 대기열에 미룬다 (P1)
- B14 — 미뤄 둔 첫 메일은 처리 시점의 연결 묶음으로 나간다 (P1)
- B15 — 반복 메일은 회차마다 묶음에서 주소를 고른다 (P1)
- B16 — 발송 로그의 `sender_profile_id`·`sender_email`이 실제로 보낸 주소다 (P1)
- B17 — 한 연결의 묶음이 막혀도, 다른 묶음을 쓰는 연결의 기한 된 줄은 그 회차에 발송을 시도한다 (P1)
- B18 — 같은 연결의 기한 된 첫 메일 줄은 지금처럼 함께 미뤄진다 (P1)
- B19 — 템플릿 후속은 첫 메일 주소를 먼저 쓰고, 그 주소가 없을 때만 묶음 → 기본 순으로 고른다 (P2)
- B20 — 수동 발송은 지금처럼 요청의 `senderProfileId`가 우선이다 (P2)
- B21 — 새 연결 화면 "발신 설정" 카드에서 프로필을 여러 개 고를 수 있고, POST 본문에 실린다 (P1)
- B22 — 편집 화면이 저장된 묶음으로 체크를 채우고, 바꾸면 PUT 본문에 실린다 (P1)
- B23 — 요약 칸에 발신·오늘 용량·답장 줄이 보이고, AI 대기열 줄은 보이지 않는다 (P2)
- B24 — 템플릿 화면에는 AI 예약 안내가 보이지 않고, AI 화면에는 그대로 보인다 (P2)
- B25 — 지운 프로필이 묶음에 남아 있으면 경고가 보이고, 그대로 저장하면 서버가 거절한다 (P2)
- B26 — 새 상태·초기화 로직은 `.ts` 훅에 있고, page.tsx는 훅 호출과 props 전달만 한다 (P2)
- B27 — 발송 방식이 '수동'인 연결 화면에는 발신 설정 칸 대신 "수동 발송은 발송 창에서 고른 발신자로 나갑니다" 안내가 보인다 (P2)

## 리스크/불확실성

- **막힘 범위**: 발송 변경과 함께 고치지 않으면 한 연결의 하루 한도가 다른 연결의 발송까지 막는다. 그래서 한 커밋으로 묶는다.
- **자동 멈춤**: 발신 건강 자동 멈춤은 기본 주소를 건너뛴다. 연결이 기본이 아닌 주소 하나만 묶으면, 그 주소가 멈췄을 때 문의 첫 메일도 미뤄진다. AI 규칙과 같은 성질이다.
- **남는 가정**: "템플릿 = 기본 주소"를 전제한 문구 3곳과, 발신 건강 알림 대상 찾기 2곳(템플릿 연결이 빠진다)은 이번에 고치지 않는다.
- **공용 컴포넌트**: `SenderPoolField`를 고치면 AI 화면이 바뀔 수 있다. prop 기본값을 지금 동작으로 둔다.
- **운영 DDL**: NULL 칸 추가라 표를 다시 쓰지 않는다. 잠금 5초를 넘기면 다시 시도한다.
- **이미 대기 중인 줄**: 처리할 때 연결을 다시 읽으므로, 묶음을 정한 뒤 처리되는 줄부터 새 주소로 나간다.
- **개발 서버**: 개발 DB에는 운영 데이터 복사본이 있다. 발송 시험은 본인 주소로만 한다.

## 검증 방법

- `pnpm test`, `npx tsc --noEmit`, 바꾼 파일 eslint.
- 로컬 DB: 마이그레이션 적용과 칸 확인.
- API(로컬): B3~B9 시나리오.
- 발송(로컬 또는 본인 주소): 묶음 [X] 연결의 로그가 X 주소인지, NULL 연결이 기본 주소인지.
- 반복 대기열: 연결 A(막힘)와 B(정상)의 줄을 만들고 한 회차를 돌려 B17·B18을 확인한다.
- 화면(ego-browser): 카드, 체크, 경고, 요약 칸, AI 화면 회귀.
- 커밋 전 사용자 확인.

## 범위 밖

- 미선택 규칙 경고와 기본값 제거
- 오픈 픽셀
- 대량 on_create 템플릿 발송의 큐 이전(무작위 예약 포함)
- 템플릿 연결의 서명 선택
- 템플릿 목록의 발신 건강 배지와 대기 배지
- "템플릿 = 기본 주소" 문구 3곳과 알림 대상 찾기 2곳
- 기존 버그: PUT이 `emailTemplateId`를 저장하지 않는다(`src/app/api/email/template-links/[id]/route.ts:36`)
- 연결 화면 page.tsx 전체를 훅으로 옮기는 리팩터
- 수동 발송에서 묶음 돌려 쓰기

## DESIGN에서 정할 것

- D1 — 막힘 범위 키: (가) 연결 id 단위(권장) / (나) 묶음 단위
- D2 — `SenderPoolField`에 더할 prop의 이름과 모양
- D3 — 상태 훅의 이름·위치·반환 모양, 카드를 ui 조각으로 뺄지
- D4 — B10~B12 검증 방법(발송 옵션 조립을 순수 함수로 뺄지)

## 결정 (2026-10-16 사용자)

- Q1 → (a): 수동 발송 창은 지금처럼 기본 프로필을 먼저 고른다(서버는 요청 값 우선). 연결 화면에서 발송 방식이 '수동'이면 발신 설정 칸 대신 "수동 발송은 발송 창에서 고른 발신자로 나갑니다" 안내를 둔다. `SendEmailDialog`는 바꾸지 않는다.
- Q2 → (a): 반복 발송 회차마다 연결 묶음에서 다시 고른다(AI 첫 메일과 같음). D5는 필요 없다.
