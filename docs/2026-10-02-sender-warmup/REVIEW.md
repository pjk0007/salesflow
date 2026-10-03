# REVIEW — 발신 주소 웜업·하루 한도·분산 발송

- **사이클 ID**: 2026-10-02-sender-warmup
- **방법**: 다섯 관점(규칙 충실도 / 동시성 / 발송 경로 / 보안·멀티테넌시 / 화면)으로 리뷰 → 지적마다 독립 검증 3회(반박 시도) → 2표 이상 확인된 것만 수정. 수정 전에 지적마다 코드를 다시 읽어 실제로 일어나는지 확인했다
- **결과**: 확인된 지적 17건(같은 결함을 여러 관점이 짚은 것을 묶으면 13건) 모두 수정. 코드를 읽고 틀렸다고 결론 낸 확인 지적은 없다
- **바뀐 계약**: export 시그니처는 그대로다. 선택 인자만 더했다 (`claimSender`의 `spreadDeferrals`, `processAutoPersonalizedEmail`의 `skipLinkIds`, `SkipReason`의 `"retry_exhausted"`). 마이그레이션 0071에 `email_send_queue` 칸 두 개를 더했다

## 확인되어 고친 것

| 관점 | 심각도 | 지적 | 고친 방법 | 시험 |
|---|---|---|---|---|
| 규칙 F1 · 동시성 F3 · 경로 F1 (같은 결함) | 중 | 대기열에서 앞 규칙 실패 + 뒤 규칙 미룸이 `error`로 접혀, 같은 회차에 몇 초 만에 시도 3회를 쓰고 `failed`로 닫힘. 미룬 규칙의 메일이 사라짐 (기능 전에는 뒤 규칙이 바로 나갔으므로 회귀) | 줄 처리 결과를 순수 함수 `planQueueRow`가 정한다. 시도가 남았으면 예전처럼 바로 다시 시도한다 (앞 규칙의 재시도는 뒤 규칙 한도와 상관없다). 시도를 다 썼는데 미룸이 있으면 `failed`로 닫지 않는다. 이번에 실패한 규칙을 `exhausted_link_ids`에 넣고 시도를 0으로, `scheduled_at = retryAt`. 다음에 꺼낼 때 그 규칙은 `skipLinkIds`로 넘겨 `retry_exhausted`로 건너뛴다 — 실패 규칙의 AI 생성·발송은 처음 3번으로 끝나고 미룬 규칙만 다시 시도된다. 새로 뺄 규칙이 없으면 `failed` (규칙 수만큼만 되풀이). `processRow`는 이제 error여도 `deferredUntil`·`failedLinkIds`를 넘긴다 | `email-send-queue-rules.test.ts` (실패 + 미룸 흐름: pending → pending → pending@retry → sent, 시도 MAX에서 failed가 아님, 새로 뺄 규칙 없으면 failed), `auto-personalized-email-outcome.test.ts` (`failedLinkIds`, `retry_exhausted` + 미룸 = defer) — W21 |
| 규칙 F2 | 중 | `normalizeSenderPool`이 길이 확인 전에 O(n²) 중복 제거를 돌려, 로그인한 멤버가 큰 배열 한 번으로 서버 전체를 멈출 수 있음 | 배열 길이 `MAX_SENDER_POOL_INPUT`(1000)을 다른 무엇보다 먼저 보고 넘으면 바로 400. 중복 제거를 `Set`으로 바꿔 O(n) (넣은 순서 유지) | 10만 개 배열이 200ms 안에 거절, 상한 안의 중복은 통과, 순서 유지 — W26 |
| 규칙 F3 | 하 | W14(미룬 줄은 시도 횟수를 쓰지 않음)가 SQL에만 있고 시험이 없음 | 미룸 처리(상태·시도·`scheduled_at`)를 `planQueueRow`로 빼고, 워커는 결과를 절대값으로 쓴다 | 미루면 -1, 0 아래로 안 감, 열 번 미뤄도 0으로 돌아오고 그 뒤 일시 오류는 재시도, 시도를 다 쓴 줄을 미뤄도 pending |
| 규칙 F4 | 하 | W1 "고르는 주소가 `pickSender`와 같음"을 확인하는 시험이 없음 (`pickCandidates`가 비공개) | `pickSenderCandidates`로 순수 모듈(`email-sender-limit-paths.ts`)에 옮겨 export. `pickSender`는 `email-sender-pick.ts`에서 직접 가져와 시험이 DB를 열지 않는다 | 단일 주소, 빈 묶음, 지운·다른 조직 id, 레거시 설정만, 주소 없음, fixed `[null, id]`, fixed 선호 id 없음, pool과 fixed 차이 — 9개 |
| 동시성 F1 · 경로 F3 | 중 | 고르게 나눠 보내기의 간격 미룸이 모두 같은 retryAt으로 몰려, 간격마다 밀린 줄 전부가 깨어나 한 통만 나가고 다시 미뤄짐 (줄마다 쿼리 10여 개) | `claimSender`에 `spreadDeferrals` 선택 인자. 간격으로 막히면 같은 묶음·같은 retryAt으로 미뤄지는 k번째 메일을 `retryAt + k × 묶음 간격`으로 펼친다. 묶음 간격은 `poolSpacingStepMs` — 주소마다 1/간격을 더해 뒤집는다 (주소 하나 간격으로 펼치면 묶음이 보낼 수 있는 양보다 늦게 깨워 발송이 느려진다). 시간대를 넘겨 다음 날로 밀린 주소는 세지 않는다. 기록은 프로세스 안에서만 이어지고 지난 retryAt은 버린다. AI 첫 메일·후속 둘·템플릿이 켜고, 수동 발송은 안내 문구에 실제 열리는 시각을 보여야 해서 켜지 않는다 | `poolSpacingStepMs`(주소 둘 → 절반, 한도·정지·중복 제외, 다음 날로 밀린 것은 0), `spreadSpacingRetry`(순번 펼치기, 키 분리, 지난 기록 버리기, 간격 0이면 그대로) — W22 |
| 동시성 F2 | 중 | 반복 대기열이 회차당 정렬 없는 100줄 고정이라, 웜업 주소로 큰 업로드를 하면 'first' 줄이 쌓여 다른 조직의 반복 메일이 며칠씩 밀림 | 반복 대기열 워커를 다시 짰다. 잠금 `0x5c4edf06`(회차가 겹치면 뒤 회차는 건너뜀), 8분 예산 동안 회차를 시작한 시각까지 기한이 된 줄을 id 순으로 100줄씩 한 번씩만 본다 (던진 줄·간격 0인 반복이 같은 회차에 거듭 나가지 않게). 한 조직의 기본 주소가 막히면 그 조직의 기한 된 `kind='first'` 줄을 한 문장으로 retryAt에 옮기고, 그 조직의 반복 줄은 중단 조건만 본 뒤 발송 준비 없이 옮긴다 (템플릿 메일은 늘 조직의 기본 주소로 나간다). 한 줄이 던져도 회차를 멈추지 않는다 (예전에는 회차 전체가 멈췄다) | `activeBlock` (회차 안 조직별 막힘 기록) |
| 동시성 F4 | 하 | 후속 취소와 워커의 미룸이 겹치면 취소한 줄이 pending으로 되살아나 나중에 나감 | 취소 API는 `status='pending'`일 때만 바꾸고(조직 조건 포함) 0줄이면 409와 이유. 화면은 사유를 토스트로 보이고 목록을 다시 읽는다. `deferQueueItem`은 취소된 줄을 되살리지 않는다 | (DB 경로라 순수 시험 없음) |
| 동시성 F5 | 하 | 워커가 처리 중인 줄과 바로 보내는 경로의 미룸이 겹치면 미룸이 조용히 버려짐 (워커가 고치기 전 레코드로 skipped를 씀) | `email_send_queue.requeue_at` 칸. `enqueueDeferredSend`가 processing 줄이면 상태·시도·잠금은 두고 `requeue_at`(이른 쪽)만 남긴다. 워커의 마지막 쓰기(`applyPlan`)는 한 문장 안에서 이 값을 본다 — skipped·failed로 끝내려던 줄은 끝내지 않고 그 시각에 다시 꺼낸다(시도 0, 빼 둔 규칙 비움), sent면 버린다(쿨다운이 원래 막았을 두 번째 메일이 나중에 나가지 않게), pending이면 이른 시각 | `revivesOnRequeue` — W23 |
| 경로 F2 | 중 | `resend-unsent`가 대기열에 미뤄 둔 레코드도 대상으로 삼고 다시 돌리라고 안내해 같은 사람에게 AI 첫 메일이 두 번 나감 | 대상 쿼리에서 발송 대기열에 pending·processing 줄이 있는 레코드를 뺀다 (트리거 종류 무관). 미룬 건은 `enqueue-unsent.ts --partitions=… --since=… --apply`로 대기열에 넣으라고만 안내한다 | (스크립트, DB 경로) |
| 보안 SEC-1 | 상 (기존 문제) | 수동 발송·템플릿 자동·템플릿 후속이 템플릿을 조직 조건 없이 id로 읽음. 연결 API가 남의 템플릿 id를 그대로 저장해 다른 조직 템플릿 내용을 받아 볼 수 있음 | 세 조회에 `emailTemplates.orgId` 조건 (수동은 404). 근본 원인으로 `POST /api/email/template-links`와 `PUT …/[id]`가 `emailTemplateId`와 `followupConfig`의 `onClicked/onNotClicked.templateId`가 모두 이 조직 것인지 확인하고 아니면 400 (`collectLinkTemplateIds` → `checkLinkTemplatesOwned`) | `email-template-link-rules.test.ts` 6개 — W24 |
| 보안 SEC-2 (2/3) | 중 | 한도·사용량이 프로필 id에 걸려, 멤버가 한도 칸 없이 같은 주소로 프로필을 더 만들거나 주소를 바꾸거나 지워서 관리자가 건 한도를 피해 감 | 한도 칸이 없어도 관리자 확인: 한도가 켜진 다른 프로필과 같은 주소(공백·대소문자 무시)로 만들기·바꾸기, 한도가 켜진 프로필의 주소 바꾸기, 한도가 켜진 프로필 지우기. 403이면 이유 문구. 한도가 없는 주소끼리는 예전처럼 누구나. 주소를 바꾸면 웜업이 켜져 있을 때 시작일을 오늘(KST)로 — 새 주소는 0일째부터 | `senderProfileChangeNeedsAdmin`·`senderProfileDeleteNeedsAdmin`·`restartedWarmupStartedOn`·`normalizeSenderAddress` 6개 — W25 |
| 보안 SEC-3 | 하 (기존 문제) | AI 테스트 발송 500 응답에 원래 오류 문구가 그대로 나가 SQL과 매개변수가 드러남 | 500은 고정 문구, 원래 오류는 서버 로그에만. `linkId`·`recordId`가 양의 정수가 아니면 400 | (라우트) |
| 보안 SEC-4 · 화면 ui-clone-deleted-sender | 하 | 지운 발신 프로필 id가 남은 규칙은 복제가 늘 400으로 실패하고 화면에는 이유 없는 문구만 뜸 | 복제할 때 지금 프로필 목록에 있는 id만 보내고 몇 개 뺐는지 알린다 (다 빠지면 기본 발신 프로필이라고 알림). 목록을 못 읽었으면 거르지 않는다. 실패하면 서버의 한국어 사유를 보인다 | `splitKnownSenderIds` 3개 |

## 제안과 다르게 고친 것

- **실패 + 미룸 (규칙 F1 등)**: "error이고 미룸이 있으면 늘 `scheduled_at = retryAt`"은 그대로 쓰지 않았다. 시도가 남은 동안에도 그렇게 하면 앞 규칙의 일시 오류 재시도가 뒤 규칙의 한도(다음 날일 수 있다)에 묶인다. 또 그것만으로는 retryAt에 다시 미뤄지면 며칠 뒤 같은 방식으로 사라진다(검증자 지적). "미룸이 있으면 절대 닫지 않기"도 쓰지 않았다 — 계속 실패하는 앞 규칙이 깨어날 때마다 AI 생성을 다시 해 토큰이 끝없이 든다(간격 몰림과 겹치면 분 단위). 실패한 규칙만 줄에서 빼는 방식이 두 문제를 다 막는다
- **간격 몰림 (동시성 F1)**: 발송 대기열에서 "같은 조직·주소의 pending 줄을 한 번에 미루기"는 쓰지 않았다. 대기열 줄에는 주소·규칙이 없고 레코드마다 맞는 규칙(묶음)이 달라, 다른 주소로 지금 나갈 줄까지 막힌다. 대신 미룰 때 순번으로 펼친다. 반복 대기열은 템플릿 메일이 늘 조직의 기본 주소로 나가므로 한꺼번에 미루기를 썼고, 검증자 권고대로 `kind='first'`로 한정했다
- **후속 취소 (동시성 F4)**: `updateQueueStatus`에 `status='processing'` 조건은 넣지 않았다. 30분 회수 뒤 늦게 끝난 워커의 `sent` 기록이 0줄이 되어 같은 메일이 두 번 나갈 수 있다(검증자 지적). 취소 쪽 조건만으로 경합이 닫힌다
- **한도 우회 (SEC-2)**: `(org_id, lower(from_email))` 유니크 인덱스와 주소 단위 카운터는 하지 않았다. 기존 조직에 같은 주소 프로필이 있으면 마이그레이션이 실패하고(개발 DB가 실제 고객 데이터다), 표시 이름만 다른 정상 사용도 깨진다. 주소 단위 합계는 DESIGN 10절의 범위 밖 항목과 같은 결정이 필요하다

## 기각된 것

- 조율 단계에서 넘어온 기각 목록이 비어 있다 (모든 지적이 2표 이상 확인됨)
- SEC-2는 검증 1표가 "설계 범위 안의 동작"으로 반박했지만 2표가 확인해 고쳤다. 고친 범위는 기존 멤버 흐름을 깨지 않는 관리자 확인으로 좁혔다
- 일부 지적의 결과 서술은 검증에서 과장으로 정정됐다 — 규칙 F3의 "한도에 3회 막힌 줄이 failed"(실제로는 `nextStatus("defer")`가 늘 pending), 규칙 F1의 "dispatch 경로도 똑같이 유실"(대개 retryAt에 뒤 규칙이 나간다). 결함 자체는 사실이라 고쳤다

## 관문 (수정 뒤)

- `TSX_DISABLE_CACHE=1 tsx --test "src/**/*.test.ts"`: 475 통과, 실패 0 (수정 전 421 — 54개 추가)
- `tsc --noEmit --incremental false`: 종료 코드 0
- `eslint` 기능 파일 54개: 문제 4건, 모두 원래 있던 것 (`SendEmailDialog.tsx`의 `react-hooks/set-state-in-effect` 오류 2, `ai-auto/new`·`ai-auto/[id]` 페이지의 `Textarea` 미사용 경고 2). 새 문제 0
- `next build` (`DATABASE_URL=postgres://build:build@127.0.0.1:1/build`, `JWT_SECRET=build-only-dummy`): 성공
- 바뀐 파일의 줄 끝: 기존 파일은 CRLF 그대로, 새 파일은 같은 기능의 다른 새 파일처럼 LF. 섞인 파일 없음

## 바뀐 파일

- 마이그레이션·스키마: `drizzle/0071_email_sender_limits.sql`, `src/lib/db/schema.ts` (`emailSendQueue.exhaustedLinkIds`, `requeueAt`)
- 대기열·결과: `src/lib/email-send-queue.ts`, `src/lib/email-send-queue-rules.ts`(+시험), `src/lib/auto-personalized-email-outcome.ts`(+시험), `src/lib/auto-personalized-email.ts`
- 한도·발신자: `src/lib/email-sender-limit.ts`, `src/lib/email-sender-limit-rules.ts`(+시험), `src/lib/email-sender-limit-paths.ts`(+시험)
- 템플릿·후속: `src/lib/email-automation.ts`, `src/lib/email-followup.ts`, 새 파일 `src/lib/email-template-link-rules.ts`(+시험), `src/lib/email-template-ownership.ts`
- API: `src/app/api/email/send/route.ts`, `template-links/route.ts`, `template-links/[id]/route.ts`, `followup-queue/[id]/route.ts`, `sender-profiles/route.ts`, `sender-profiles/[id]/route.ts`, `auto-personalized/test-send/route.ts`
- 화면: `src/components/email/AutoPersonalizedEmailConfig.tsx`, `FollowupQueueTable.tsx`, `src/hooks/useFollowupQueue.ts`, 새 파일 `src/components/email/sender-profiles/utils/senderPool.ts`(+시험)
- 스크립트: `scripts/resend-unsent.ts`
- 문서: `DESIGN.md` (3·4·5·6·7·8·9·11절, W14 보강, W21~W26 추가), 이 문서

## 아직 확인하지 못한 것

- **실제 DB에서 한 번도 돌리지 않았다.** 새 SQL — `applyPlan`·`enqueueDeferredSend`의 CASE 식, 반복 대기열의 조직 단위 일괄 UPDATE, 후속 취소의 RETURNING, 0071의 새 칸 두 개. 매개변수 형은 명시 캐스트(`::boolean`·`::int`·`::timestamptz`·`::jsonb`)로 정했지만 Postgres에서 확인해야 한다
- 0071은 아직 어느 DB에도 적용하지 않았다는 전제로 고쳤다. 이미 적용한 DB가 있으면 마이그레이터가 다시 돌리지 않으므로 두 `ALTER TABLE "email_send_queue" …`를 손으로 실행해야 한다
- NHN 실제 발송 없음. 개발 DB는 실제 고객 데이터라 발송이 걸린 시험은 대표 확인 뒤 시험 파티션·내부 주소로만 한다 (DESIGN 9절). 권장 시나리오: ① 같은 파티션에 AI 규칙 둘(앞 규칙 발신 주소를 일부러 NHN 미등록 주소로, 뒤 규칙 묶음 하루 한도 1)로 레코드 여러 건 → 앞 규칙 3번 실패 뒤 `exhausted_link_ids`가 채워지고 다음 날 뒤 규칙이 나가는지 ② 고르게 나눠 보내기(간격 짧게)로 수십 건 → `scheduled_at`이 간격만큼 벌어지는지 ③ 대기열 처리 중 레코드 고치기 → `requeue_at`이 남고 다시 꺼내지는지
- 간격 펼치기의 실제 부하 감소는 재지 않았다. 기록이 프로세스별이라 인스턴스가 여럿이거나 재시작하면 덜 펼쳐진다 (몰림이 조금 남을 뿐 틀리지는 않는다)
- 반복 대기열 회차가 이제 최대 8분까지 돈다. CloudType Scheduler의 요청 타임아웃이 그보다 짧으면 끊긴다 — 발송 대기열·후속과 같은 예산이니 같은 설정이면 된다
- 남은 한계 (이번 범위 밖)
  - 시도 상한에 닿은 채 processing에서 죽은 줄은 회수하지 않는 기존 동작 그대로다. 그 줄의 `requeue_at`·빼 둔 규칙도 함께 멈춘다
  - 다른 API 13곳의 `error.message` 그대로 응답, 프로필 삭제 때 규칙의 `sender_profile_id(s)` 정리, 주소(도메인) 단위 합계 한도
  - 이미 저장된 규칙 중 다른 조직 템플릿을 가리키는 것이 있으면 이제 "템플릿 없음"으로 발송이 실패한다 (정상 데이터에는 없어야 한다)
  - `loadOrgSenderProfiles`의 조직 조건은 DB 조회라 W1 순수 시험이 다루지 못한다
