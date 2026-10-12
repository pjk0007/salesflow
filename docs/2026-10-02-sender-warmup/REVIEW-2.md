# REVIEW 2 — 발신 묶음·대기열 정책 (DESIGN-2) 검증과 수정

- **사이클 ID**: 2026-10-04-sender-queue-policy (DESIGN-2-queue-policy.md)
- **방법**: 로컬 시험 환경에서 DESIGN-2 4절① 시나리오를 실제 앱 코드 경로로 돌린 검증 보고(S1 실패) + 두 관점(정책 충실도 / 안전·회귀) 리뷰 → 지적마다 독립 검증 3회 → 2표 이상 확인된 것만 고침. 고친 뒤 시나리오를 모두 다시 돌리고, 확인 지적마다 새 시나리오(S7·S8·S9)를 더했다
- **결과**: 검증 버그 2건 + 확인 지적 9건(같은 결함을 두 관점이 짚은 것을 묶으면 7건) 모두 고침. 다시 돌리다 2건을 더 찾아 고침(배치 `RETURNING` 순서, 앞 칸을 문의에 내준 대량 줄이 계속 밀림). 최종 실행에서 시나리오 10개 모두 주 판정·추가 판정 통과
- **바뀐 계약**: export 시그니처는 그대로다. 선택 인자만 더했다 — `processAutoPersonalizedEmail`의 `claimTurn`, `processEmailAutoTrigger`의 `purpose`(기본 `"inbound"`), `bulkCapForNow`·`capForPurpose`의 주소 설정(생략하면 15:00, 예전과 같다). 새 대기열 줄 kind `first_bulk`(varchar(10) 안). 0072에 멱등 백필 한 문장
- 화면 문구·설계 문서는 바뀐 동작에 맞췄다 (DESIGN-2 1·2·3·4·5·6절, Q10~Q14 추가)

## 검증한 것

- **환경**: 로컬 시험 환경만 썼다 — Next 개발 서버 `localhost:3100`, 내장 Postgres `127.0.0.1:54329/salesflow_test`, 가짜 NHN·구글 챗·Anthropic(그 밖의 바깥 요청은 막힘). 개발·운영 서버와 CloudType은 건드리지 않았다
- **시각**: 시나리오 실행기(`.testenv/qp-run.ts`)가 가짜 시계(`qp-fakeclock.mjs` + DB `testclock.now()`, 하네스 접속에만)로 평일 KST 시각(2026-10-06 화 ~ 10-08 목)을 만든다. 앱 서버를 거치는 단계(S3A 문의 API, S5 통계 API·화면)는 실제 시각이다. 실행이 끝나면 `email_send_queue.scheduled_at` 기본값을 `now()`로 되돌리고 `testclock` 스키마를 지운다 (둘 다 확인함)
- **경로**: 가져오기(`insertImportedRecords` + `dispatchImportTriggers` → `enqueueSends`), 한 건 생성(`dispatchAutoTriggers`), 대기열 워커(`processEmailSendQueue`), 반복 대기열 워커(`processEmailRepeatQueue`), 앱 API `POST /api/partitions/{id}/records`, `GET /api/email/send-queue/stats`
- **공통 판정 (모든 시나리오)**: 한 통에 보낸 주소 하나, 레코드마다 많아야 한 통, 발송 이력의 보낸 주소 = 가짜 NHN이 받은 보낸 주소, 모든 메일이 그 규칙 묶음의 주소에서 나감, 주소별·날짜별 한도 초과 0통, 바깥 요청 0건
- **화면**: 규칙 화면 묶음 칸(설명 문구·↑↓ 없음·주소마다 남은 통수·합계 줄·문의 몫 안내 — 브라우저 시계 10:00도), 요약 칸, 규칙 목록 카드 배지, 메일 대시보드 대기열 카드, 발송 이력 "보낸 주소" 칸
- **0072 백필**: 시험 DB에서 트랜잭션 안에 on_update pending·on_create pending·on_update sent 줄을 넣고 0072 전체를 두 번 돌린 뒤 되돌렸다 (`.testenv/gate-0072-backfill.ts`) — on_update pending만 0→1, 나머지 그대로, 두 번째도 같음

## 시나리오 결과 (최종: 2026-10-04 17:01~17:05 KST, 모두 시도 1번, 다른 작업 끼어듦 0건)

| 시나리오 | 주 판정 | 추가 판정 | 근거 숫자 (고치기 전 → 뒤) |
|---|---|---|---|
| S1 주소 3개(한도 4·4·없음), 화 10:00·수 15:30 대량 12통씩 | 통과 18/18 | — | 합계 오전 3·3·6, 오후 4·4·4. 배치별 보낸 주소 수가 "한 통씩 가장 오래 쉰 주소부터(한도 안)" 고른 결과와 같다: 오전 a2·b2·c1 / c3·a1·b1 / c2, 오후 a2·b2·c1 / c2·a2·b1 / b1·c1 (전: 오후 첫 배치 a4·b1·c0) |
| S2 한도 10, 오전 대량 11통 | 통과 13/13 | 2/2 | 오전 9통 = s2-01~09, 14:59 0통, 15:00 s2-10, 수 09:00 s2-11, 화요일 사용량 10 (전: s2-06 대신 s2-10이 오전에, s2-11이 15:00에) |
| S3 대량 20 뒤 문의 2건 | 통과 16/16 | 3/3 | 문의 1건째 11:00 바로, 2건째 우선 1·수 09:00 → 그날 첫 배치 첫 줄. 대량은 화 01~09, 수 10~17, 수 15:05 18 — 먼저 들어온 순 그대로 (전: s3bulk-16이 두 번 밀려 목요일로) |
| S3A 실제 앱 API로 문의 2건 | 통과 16/16 | — | 응답 201·201, 1건째 바로, 2건째 다음 날 09:00 첫 배치, 카드 "대기 1통 · 내일까지 다 나감", 요약 칸 문의 1통 · 대량 0통 |
| S4 밀린 15통 + 다음 날 25통 | 통과 17/17 | 5/5 | 새 25줄 예정 수 09:00, 어제 줄 배치 1~3·새 줄 배치 4. 워커마다 남은 줄의 앞 k개: 화 s4d1-01~20, 수 09:00 s4d1-21~s4d2-03, 수 15:05 s4d2-04~05, 목 09:00 s4d2-06~23, 목 15:05 s4d2-24~25 (전: 수 15:05에 07·08이 먼저) |
| S6 한도 없는 주소만 2개 | 통과 10/10 | 2/2 | 대량 배치 u1u2u1u2u1 / u2u1u2u1u2 / u1u2, 합계 7·7, 문의 2건 바로 (전: u1u1u1u2u1, 앞선 실행 9·5) |
| S7 고르게(54분) + 대량 대기 + 문의 (새, 정책 F2) | 통과 12/12 | — | 09:00 대량 1통, 29줄은 09:54부터 54분씩 펼침. 09:06 문의 → 우선 1·09:54 예정 (예전 코드면 펼친 29줄 뒤 — 계산상 10/7 12:00 무렵), 09:55 문의가 그 칸으로 나감, 대량은 01·02·03·04 순, 메일 사이 55·55·56·56분 |
| S8 규칙 둘 — 묶음이 다름 (새, 안전 F1) | 통과 14/14 | — | A(병원, a1 한도 3)가 2줄을 15:00까지 미룬 11:00에 일반 6줄을 넣으면 예정 11:00으로 들어가 바로 b1로 나감. A가 1줄을 수 09:00까지 미룬 16:00에 일반 5줄도 16:00으로 들어가 바로 나감. 병원 2+1+1, 일반 6+5 |
| S9 템플릿 첫 메일 (새, 안전 F4) | 통과 14/14 | — | 기본 주소 한도 10. 가져오기 12통 → 9통 + `first_bulk` 3줄(화 15:00), 문의 1건째 11:00 바로, 2건째 `first` 수 09:00. 화 15:05 0통(한도 다 씀) → `first_bulk` 수 09:00, 수 09:00 4통, 반복 대기열 모두 끝남 (전: 가져오기가 문의 몫까지 10통을 써 11:00 문의가 다음 날로) |
| S5 3일치 경고 + 실제로 흘려 보기 | 통과 20/20 | 2/2 | ① 대기 32·하루 용량 8·4일치 경고, ② 1.11일치 경고 없음, ③ 제한 없음, 합계 92·경고 1개(카드·요약 칸·대시보드). 예상 소진일 = 실제로 다 나간 날: ① 10/8 = 10/8, ② 10/5 = 10/5 (전: ② 예상 10/6, 실제 10/5) |

- 결과 원본 `F:/Temp/sendb-testenv/ux/queue-policy-results.json`, 실행 기록 `F:/Temp/sendb-testenv/ux/queue-policy-review2-run.log`·`queue-policy-logs/`, 가짜 메일함 `F:/Temp/sendb-testenv/ux/fake-inbox-{S1…S9,S3A}.html`, 화면 29장 `F:/Temp/sendb-testenv/shots/queue-policy/`. `queue-policy-results.md`는 고치기 전 검증 보고다
- 하네스: `F:/Temp/sendb-testenv/ux/queue-scenarios.mjs` (S7·S8·S9 추가, 판정 기준 하나 고침 — 아래), 실행기 `F:/Temp/sendb-dev/.testenv/qp-run.ts`

## 확인되어 고친 것

| 지적 | 심각도 | 내용 | 고친 방법 | 시험 |
|---|---|---|---|---|
| 검증 버그 1·2 = 정책 F1 = 안전 F2 | 상 | 워커가 꺼낸 5줄을 `Promise.allSettled`로 함께 처리해, 다섯 줄이 같은 순간의 사용량을 읽고 같은 "가장 오래 쉰 주소"를 고름 → 묶음이 돌지 않고 한 주소에 몰림. 한도·문의 몫·간격의 마지막 한 칸을 먼저 닿은 줄이 가져가 먼저 들어온 순·문의 먼저가 깨짐. 간격 미룸 순번도 끝난 순서로 매겨짐 | `createClaimTurns`(순수): 줄 i의 첫 자리 잡기는 앞 줄들이 첫 자리 잡기를 마쳤거나 처리를 끝낸 뒤에, 모든 자리 잡기는 한 번에 하나. `processAutoPersonalizedEmail`의 `claimSender`만 이 차례로 감싸고(`claimTurn` 선택 인자) AI 생성·NHN 호출은 그대로 겹친다. `runBatch`는 줄마다 처리가 끝나면 `done()`. 재처리 스크립트도 같은 차례 | `createClaimTurns` 3개(늦게 닿은 앞 줄 기다림·한 번에 하나, `done`·던짐이 차례를 넘김, 두 번째 자리 잡기는 다시 기다리지 않음), 배치 모델(함께 = 11111, 차례 = 12121). S1·S2·S3·S4·S6 |
| 재검증에서 찾음 (위와 같은 결함의 나머지) | 상 | 차례를 넣어도 S2에서 s2-06 대신 s2-10이 나감 — `pickBatch`의 `UPDATE … RETURNING`은 하위 쿼리 `ORDER BY`를 지키지 않고 표에 놓인 순서로 돌려준다 | 꺼낸 뒤 `sortPickedRows`로 배치 안 차례를 문의 먼저(`priority DESC`), 먼저 들어온 순(`id`)으로 다시 세운다 | `sortPickedRows` 2개. S2·S3·S4 엄밀 FIFO |
| 재검증에서 찾음 (S7) | 중 | 고르게 나눠 보내기에서 앞 칸(09:54)을 문의에 내준 대량 줄이 "마지막 발송 + 간격"(10:49)으로 다시 미뤄져, 미리 펼친 다음 줄(10:48)보다 늦다. 배치 안 차례가 예정 시각 순이면 칸마다 다음 줄에 밀려 하루 끝까지 처진다 (첫 재실행에서 02 대신 03이 나감) | 배치에 든 줄은 모두 꺼낼 때가 된 줄이므로 배치 안 차례는 예정 시각이 아니라 `id`(위와 같은 함수). 어느 줄을 꺼낼지는 그대로 `priority DESC, scheduled_at, id`(색인 순서) | 같은 시험. S7 대량 01·02·03·04 |
| 정책 F2 | 중 | 간격 미룸 펼치기 기록(`spacingSpreadMemo`) 키에 목적이 없어, 대량 N줄을 펼친 직후 들어온 문의가 base + N·간격(200줄이면 일주일 넘게)으로 밀림 | 키를 `spacingSpreadKey(주소들, 목적)`로. 문의는 문의끼리 순번을 매긴다 — 그 칸에서는 우선 1이라 먼저 나간다 | `spacingSpreadKey`, 대량 200줄 펼친 뒤 문의가 base(09:54)·두 번째 문의는 다음 칸. S7 |
| 정책 F4 = 안전 F3 | 하 | 시간대가 15시 전에 끝나는 주소(9~15시, 9~12시)는 15:00이 시간대 밖이라 문의 몫이 끝내 풀리지 않아 문의가 없는 날마다 한도의 10%를 버림 | `reserveReleaseHour(설정)`: 시간대 끝이 15시 이하이면 시간대 마지막 한 시간(끝 − 1, 시작보다 이르지 않게)에 푼다, 아니면 15시. `bulkCapForNow`·`capForPurpose`·`decideSlot`·자리 잡기 SQL의 `$cap`·통계(`poolRemainingToday`·`poolTodayBulkCap`)·화면 안내(`inboundReserveNote`)가 같은 함수를 쓴다 | `reserveReleaseHour`(9~15→14, 9~12→11, 9~10→9, 9~16·시간대 없음·16~20→15), `decideSlot` 9~14시 → 13:00에 다시·13:00에 통과·평일만 금요일도 그날, Q2 9~13시 하루 10통, 통계·화면 안내 각 1 |
| 정책 F5 (검증 관찰 3) | 하 | 예상 소진일이 앞날을 대량 몫으로만 세어 대량만 쌓인 규칙이 하루 늦게 나옴 (S5② 예상 10/6, 실제 10/5) | 새 문의가 없다고 보는 추정이므로 날마다 문의가 먼저 쓰고 대량이 나머지(한도 − 문의)를 다 쓴다고 센다 — 몫은 풀리는 시각(시간대 안)에 대량이 쓴다. 경고 분모(`backlogDays`)는 대량 몫 그대로(보수적) | `estimateDrainDate` 기대값 고침(한도 10·대량 10 → 오늘), 9~13시 주소. S5 예상 = 실제 |
| 정책 F6 (= 안전 F4의 두 번째 절반) | 하 | `scripts/resend-unsent.ts`가 purpose 없이 불러 대량 재처리가 문의 몫을 씀 | `purpose: "bulk"`와 자리 잡기 차례를 넘긴다 | 타입 검사 (스크립트) |
| 안전 F1 | 중 | 새 대량 줄의 선입선출 하한이 다른 규칙·옛 설정 때문에 미뤄 둔 줄까지 따라가, 다른 묶음으로 바로 나갈 가져오기를 하루 가까이 묶음 | 하한을 좁혔다: ① 미룬 줄이 **오늘(KST)** 다시 열릴 때만 (내일 이후면 새 줄도 꺼내자마자 같은 이유로 같은 시각에 미뤄져 순서가 지켜진다) ② 그 파티션·트리거의 켜진 AI 규칙이 모두 같은 발신 묶음일 때만 (`sharesOneSenderPool`) ③ 한도·시간대·정지 미룸만 세고 간격 미룸은 빼기 | `bulkFifoScheduledAt` 내일 이후·KST 날짜 경계, `sharesOneSenderPool` 6가지, `FIFO_FLOOR_DEFER_REASONS`. S8(묶음이 다른 규칙 — 오늘·내일 미룸 둘 다), S4(묶음 하나 — 밤사이 하한은 그대로) |
| 안전 F4 (2/3, 정책 F3은 기각) | 하 | 가져오기·예약 등록 명단의 템플릿 첫 메일이 `inbound`로 나가 오전에 문의 몫까지 써서 폼 문의가 다음 날로 밀림 | `processEmailAutoTrigger`에 `purpose`(기본 `inbound`). `dispatchImportTriggers`는 `bulk`. 막힌 줄은 kind `first_bulk`로 넣고 다시 꺼낼 때도 `bulk`로 잡는다. 반복 대기열은 막힘을 목적별로 적어 문의가 막히면 `first`·`first_bulk`를, 대량만 막히면 `first_bulk`만 함께 미룬다. 같은 규칙·레코드의 첫 메일 줄은 둘 중 한 줄만 기다린다 | `templateFirstKind`·`templateFirstPurpose`·`templateFirstKindsBlockedBy`. S9 |
| 안전 F5 | 하 | 0072가 기존 줄을 모두 0으로 두어, 배포 때 기다리던 on_update 줄(모두 문의)이 대량으로 다뤄지고 다시 올려지지도 않음 | 0072에 멱등 백필: `trigger_type='on_update' AND status IN ('pending','processing') AND priority=0` → 1 | 시험 DB 트랜잭션 점검(되돌림) |

## 하네스 판정 기준을 고친 것

- S1·S6의 "배치 안 고르게" 판정이 `⌈배치 크기 ÷ 배치 시작 때 보낼 수 있는 주소 수⌉`였다. 배치 안에서 한도에 닿는 주소를 세지 못해, 고친 뒤 S1 오전 둘째 배치(A·B가 대량 몫 3통을 채워 C가 남은 3통을 받음 = `c·a·b·c·c`)를 실패로 봤다. 가짜 NHN이 받은 순서는 AI 생성이 끝난 순서라 자리 잡은 순서와 다르므로, 배치별 주소 수를 "그날 첫 발송부터 한 통씩, 한도 안의 가장 오래 쉰 주소(동점이면 묶음 순서)"로 모의한 결과와 견주게 바꿨다. 고치기 전 코드의 결과(오후 첫 배치 a4·b1·c0, S6 u1 4·u2 1)는 새 기준으로도 실패다

## 제안과 다르게 고친 것

- **차례 (정책 F1)**: `processAutoPersonalizedEmail`을 두 함수로 나누지 않았다. 자리 잡기만 차례로 감싸는 선택 인자(`claimTurn`)가 같은 효과를 내고, 한 건씩 보내는 경로·대기열 묶어 미루기(`walkQueueRow`가 그 함수의 검사 순서를 그대로 따른다)를 건드리지 않는다
- **`reserveSlot`에 last_sent_at 비교 넣기 (정책 F1의 "함께 검토")**: 하지 않았다. 판정 때 읽은 `last_sent_at`과 같을 때만 잡게 하면, 다른 프로세스(바로 보내는 경로)와 겹칠 때 진 쪽이 다시 읽기를 거듭하다 3회 상한(`MAX_CLAIM_ROUNDS`)에 걸려 1분 뒤로 미뤄진다 — 웹훅 문의가 몰릴 때 문의를 늦춘다. 한도는 지금도 조건부 upsert라 넘지 않고, 프로세스가 다를 때 남는 것은 주소 하나가 한두 통 더 받는 치우침뿐이다
- **문의 몫 해제 시각 (정책 F4)**: "몫을 0으로" 대신 시간대 마지막 한 시간에 푼다 — 15시 전에 끝나는 주소도 그 전까지는 문의 몫을 지킨다(대표 결정 ②의 취지). 시각은 대표가 바꾸고 싶으면 `reserveReleaseHour` 한 곳이다
- **예상 소진일 (정책 F5)**: 화면 문구를 "늦어도 …"로 바꾸는 대신 계산을 실제 워커에 맞췄다. 경고(3일치)는 대량 몫 기준 그대로라 경고는 여전히 보수적이다
- **선입선출 하한 (안전 F1)**: 줄에 막은 규칙 id를 남기는 방법(새 칸)은 쓰지 않았다. "오늘 다시 열림 + 묶음 하나 + 한도·시간대·정지 미룸" 세 조건으로 원래 막으려던 경우(밤사이 새 명단이 어제 밀린 줄을 앞지름)만 남는다
- **0072 (안전 F5)**: 선택 사항인 "pending 줄도 priority만 GREATEST로 올리기"는 하지 않았다. 백필 뒤에는 pending on_update 줄이 모두 1이고, on_create 문의 줄은 대량 줄과 가를 수 없다

## 기각된 것

- **정책 F3** (가져오기·예약 등록이 일으킨 템플릿 첫 메일이 문의로 분류됨): 정책 검증 3표 중 다수가 "DESIGN-2 23행과 대표 결정 문구('form/template first mail')대로 만든 것, 설계 범위를 넓히는 제안"으로 기각했다. 같은 결함을 안전 관점이 F4로 2/3 확인했고, 작업 지시가 "확인된 지적은 모두 고친다"이므로 안전 F4로 고쳤다. 대표 결정 ②의 "대량(가져오기·예약 등록)" 쪽 취지에 맞춘 해석이다 — 대표가 "템플릿 첫 메일은 경로와 상관없이 문의"로 정하면 `record-import.ts`의 `purpose: "bulk"` 한 줄을 빼면 예전으로 돌아간다 (DESIGN-2 2절에 적음)

## 관문 (수정 뒤)

- `TSX_DISABLE_CACHE=1 tsx --test "src/**/*.test.ts"`: 639 통과, 실패 0 (이번 수정으로 18개 추가. 바뀐 동작에 맞춰 기존 시험의 기대값을 고친 곳: `decideSlot` 9~14시, `estimateDrainDate` 둘, `poolTodayBulkCap`, `poolCapacity` 모양 둘)
- `tsc --noEmit --incremental false`: 종료 코드 0 (`.testenv`·`scripts` 포함)
- `eslint` 바뀐·새 ts/tsx 40개: 문제 0
- `next build` (`DATABASE_URL=postgres://build:build@127.0.0.1:1/build`, `JWT_SECRET=build-only-dummy`): 성공. 빌드 뒤 개발 서버(3100) 정상 응답
- 줄 끝: 기존 CRLF 파일은 CRLF, 기존 LF 파일(발신 한도 모듈·발신 화면 일부 — 이번 작업 전부터 LF)은 LF, 새 파일은 LF. 섞인 파일 없음

## 바뀐 파일 (이번 수정)

- 대기열: `src/lib/email-send-queue.ts` (`runBatch` 차례, `pickBatch` 뒤 정렬, `latestDeferredBulkAt` 좁히기), `src/lib/email-send-queue-rules.ts`(+시험) (`createClaimTurns`, `sortPickedRows`, `sharesOneSenderPool`, `FIFO_FLOOR_DEFER_REASONS`, `bulkFifoScheduledAt` 오늘만)
- AI 첫 메일: `src/lib/auto-personalized-email.ts` (`claimTurn`)
- 한도: `src/lib/email-sender-limit-rules.ts`(+시험) (`reserveReleaseHour`, `bulkCapForNow`·`capForPurpose` 설정 인자, `spacingSpreadKey`), `src/lib/email-sender-limit.ts` (자리 잡기 SQL에 주소 설정, 펼치기 키에 목적)
- 템플릿: `src/lib/email-automation.ts` (`purpose`, `first_bulk`, 목적별 함께 미루기), `src/lib/email-sender-limit-paths.ts`(+시험) (`templateFirstKind` 등), `src/lib/record-import.ts` (가져오기 = `bulk`), `src/lib/db/schema.ts` (kind 주석)
- 통계·화면: `src/lib/email-send-queue-stats.ts`(+시험) (`estimateDrainDate`, `poolTodayBulkCap(주소 설정들, 지금)`, `poolRemainingToday`), `src/components/email/sender-profiles/utils/poolCapacity.ts`(+시험) (주소별 해제 시각, 안내 문구), `src/components/email/sender-profiles/types/index.ts` (주석)
- 스크립트·마이그레이션: `scripts/resend-unsent.ts`, `drizzle/0072_send_queue_priority.sql` (백필)
- 문서: `DESIGN-2-queue-policy.md`, 이 문서
- 시험 환경(저장소 밖·git 제외): `.testenv/qp-run.ts` (S7·S8·S9), `.testenv/gate-0072-backfill.ts`, `F:/Temp/sendb-testenv/ux/queue-scenarios.mjs`

## 아직 확인하지 못한 것

- **실제 NHN 발송**: 모든 확인은 가짜 NHN으로 했다. 실제 도착, 실제 받은 메일함의 보낸 사람, NHN의 발송 속도 제한·거절은 확인하지 않았다. DESIGN-2 4절③ 실제 발송 시험(개발 서버, 직원 주소 5건, 주소 2~3개·하루 2통)은 대표 승인 뒤에 한다 — 실행 전 대상 주소 목록과 규칙을 보여 드려야 한다
- **개발·운영 서버**: 이번 수정은 서버에 올리지 않았다 (커밋·푸시 없음). 0072는 아직 어디에도 적용되지 않았다 — 개발 서버에는 ed2eee8만 있다
- **프로세스가 다를 때의 순서**: 차례는 한 워커 배치 안에서만 맞춘다. 바로 보내는 경로(앱 요청)와 워커가 같은 순간에 같은 묶음을 잡으면 주소가 한두 통 치우칠 수 있다 (한도는 넘지 않는다). 간격 펼치기 기록도 프로세스 안에서만 이어진다 (예전과 같음)
- **배포 전 on_create 문의 줄**: 0072 뒤에도 0(대량)이다 — 대량 줄과 가를 정보가 없다. 배포 시점에 한도를 켠 주소가 없으면(기본값) 해당 줄이 없다
- **반복 대기열의 순서**: 템플릿 첫 메일 대기열(`email_automation_queue`)은 우선순위 없이 id 순이다 — 같은 시각에 열린 `first`(문의)와 `first_bulk`(대량) 중 먼저 들어온 줄이 먼저다. 문의 몫(15:00 전 10%)은 지켜지므로 문의가 몫 안에서 밀리지는 않지만, DESIGN-2 Q5("같은 시각이면 문의 먼저")는 AI 대기열에만 걸려 있다. 이번 지적 범위 밖이라 남겼다
- **간격 펼치기는 시간대를 넘겨 펼친다** (예전부터): S7에서 29줄이 다음 날 11:06까지 펼쳐졌다. 시간대 밖 칸에 깬 줄은 다음 보낼 수 있는 날 시작으로 함께 미뤄지고 거기서 먼저 들어온 순으로 나간다
- 같은 저장소에 다른 작업의 `DESIGN-3-reply-to.md`가 새로 생겼다 (16:37). 이 작업은 건드리지 않았다
