# 이메일 상담 연결 · R08 기본 구현

직원/API 키 권한은 [사업별 역할 기준](ACCESS.md)을 따른다. 이 문서의 설정 관리자는 해당 사업의 운영 관리 역할 또는 조직 관리자이며, 일반 직원은 배정받은 사업 역할에 맞는 업무를 사용한다.

2026-10-15. 웹 상담과 같은 인박스에서 이메일 문의·상담원 답장/첨부·내부 메모·고객 타임라인을 함께 관리한다. API 계약과 Gmail 어댑터를 격리 환경에서 확인했다. 실제 메일함 OAuth 연결이나 운영 발송은 수행하지 않았다.

## 적용한 리서치

Chatwoot의 채널/대화/메시지 분리와 제공 리서치의 공통 고객·활동 흐름을 참고해 독립 구현했다. 웹 채팅과 이메일은 같은 직원 화면을 쓰되 수신 채널·참여자·발송 결과를 구분한다. 기존 읽기 전용 마케팅 회신 조회에 발송 권한을 추가하지 않았다.

- [Chatwoot Email 채널 모델](https://github.com/chatwoot/chatwoot/blob/develop/app/models/channel/email.rb): 이메일 채널과 수신함 연결. IMAP/SMTP·OAuth 전체를 샌드비로 이식하지 않았다.
- [Gmail 발송 계약](https://developers.google.com/workspace/gmail/api/guides/sending): RFC MIME를 base64url `raw`로 보내고 결과의 제공자 메시지 ID를 기록한다.
- [Gmail 스레드 계약](https://developers.google.com/workspace/gmail/api/guides/threads): `threadId`, 일치하는 제목, `In-Reply-To`/`References`를 사용한다. 메일 서비스 접수는 상대방 도착·읽음의 증거가 아니다.

## 사용자 흐름

1. 사업의 상담함을 먼저 만들고 **고객 상담 → 이메일 연결**에서 메일함 이름·주소를 등록한다. 최초에는 중지 상태다. 주소 등록만으로 Google 계정에 연결되지 않는다.
2. 개발자가 아래 별도 메일 연결 서버를 설정하고 해당 메일함의 수신·발송을 켠다. 사업별로 독립 연결 ID·서비스 토큰·Gmail 인증을 사용한다. 같은 조직의 동일 주소는 중복 등록하지 못한다.
3. 메일이 들어오면 이메일 표시가 붙은 상담이 생성된다. 발신자·제목·원본 수신 시각·참조·첨부 상태와 완료 파일을 보며 고객·영업 패널에서 딜·후속 업무를 연결한다.
4. **메일 발송 예약**을 누르면 답장·첨부 연결과 대기열이 같은 트랜잭션에 저장된다. 전송 취소·확실한 실패의 수동 재시도와 서비스 접수 상태를 답장별로 확인한다. 내부 메모와 내부 메모 첨부는 발송하지 않는다.
5. 수신·발송 중지는 아직 시작하지 않은 대기/준비 답장을 취소한다. 이미 메일 서비스에 요청한 발송은 되돌리지 않으며 결과 확인을 계속 받아들인다.

## API와 서버 SDK

| API | 역할/권한 |
|---|---|
| `GET /api/v1/email/mailboxes?workspaceId=…` | 사업 read 권한으로 메일함 조회 |
| `POST /api/v1/email/mailboxes` | 관리자 발급 create 권한으로 `{workspaceId,address,name}` 등록 |
| `POST /api/v1/email/mailboxes/:id` | 관리자 발급 update 권한으로 `{version,enabled}` 적용 |
| `POST /api/v1/email/mailboxes/:id/receive` | create 권한으로 정규화한 수신 메일 등록 |
| `POST /api/v1/email/mailboxes/:id/claim` | read+update 권한으로 답장 한 건 임대 |
| `POST /api/v1/email/deliveries/:id` | read+update 권한으로 begin/sent/failed/uncertain/retry/cancel |

같은 함수의 직원 세션용 메일함/전달 API도 제공한다. 브라우저는 수신 원본·발송 성공을 임의 등록할 수 없다. `sdk/server.ts`에 `emailMailboxes`, `createEmailMailbox`, `changeEmailMailbox`, `receiveEmail`, `claimEmail`, `changeEmailDelivery`를 제공한다. 타입은 `sdk/email-types.ts`다.

수신 필드: `providerMessageId`, `providerThreadId`, RFC `rfcMessageId`, 단일 `from`, 선택 `fromName`, `to[]`, 선택 `cc[]`, `deliveredTo[]`, `subject`, 텍스트 `body`, ISO `receivedAt`, 선택 `autoSubmitted`, `precedence`, `files[]` 메타데이터. `to`·`cc`·신뢰한 원본의 `deliveredTo` 중 등록 주소가 있어야 한다. 동일 제공자 메시지 ID+동일 내용은 재사용하고 내용이 다르면 409로 차단한다. 같은 스레드에서 외부 발신자가 바뀌면 자동 합치지 않고 별도 확인을 요구한다.

메일함+발신자 전용 CRM 고객 ID를 만들며 기존 사이트 회원을 이메일 일치만으로 합치지 않는다. 같은 발신자의 서로 다른 이메일 스레드는 별도 상담을 유지한다. 웹 회원의 상담 조회·비회원→회원 병합 대상은 `medium=web`이며 이메일을 공개하지 않는다. 자동 회신·단체 메일·자기 발신은 수신 번호만 기록하고 상담/자동 답장을 만들지 않는다.

## 발송 상태와 장애 복구

`queued → leased → sending → sent | failed | uncertain`

임대는 120초다. `begin` 전에는 설정 세대와 활성 상태를 다시 확인한다. 준비 중 만료는 다른 작업자가 재획득할 수 있다. 발송을 시작한 뒤 만료된 작업은 다음 claim에서 `uncertain`으로 바뀌며 자동 재전송하지 않는다. 원래 작업자의 늦은 성공 결과는 같은 임대 증명으로 등록할 수 있다.

Gmail 어댑터는 발송 POST를 한 번만 한다. 400/401/403/404/429는 실패로, 네트워크·5xx·성공 응답에 메시지 ID가 없는 경우는 확인 필요로 기록한다. 결과 등록 API만 최대 3회 반복하며 메일을 다시 보내지는 않는다. 실패는 사람이 재시도하고, 확인 필요는 보낸 편지함에서 확인한다. 제공자 성공 ID를 알고 있다면 기존 임대 토큰의 `sent` 결과로 조정할 수 있다. 알 수 없는 발송의 강제 재시도는 지원하지 않는다. 지속적인 relay/모니터링이 없으면 만료 상태의 확정이 지연될 수 있다.

상담 메시지·대기열·공통 고객 활동은 원자 저장한다. 발송 대기와 서비스 접수/실패/확인 필요를 타임라인에 구분해 기록한다. 공개 `message.created`는 메시지 저장 이벤트이며 이메일 도착 증거가 아니다. 결과는 `conversation.updated`의 `action=email.sent|email.failed|email.uncertain`으로 추가 전달한다.

## Gmail 어댑터 실행

`src/lib/inbox-email/gmail.ts`는 기존 비밀값 출력 제거·OAuth 접근 토큰 갱신 함수와 MIME 문자/HTML 변환 함수를 재사용한다. 기존 마케팅 회신 설정은 읽거나 변경하지 않는다. 전용 Gmail 인증은 `gmail.readonly`와 `gmail.send`를 별도로 승인받아 준비한다. 현재 어댑터는 계정 기본 주소를 확인하며 발신 별칭을 지원하지 않는다.

`examples/email-relay/run.ts`에 독립 실행 예제가 있다. 일반 `.env`나 운영 환경 파일을 자동 로드하지 않는다. 별도 배포 환경에 다음 값을 제공한다.

- `SENDB_EMAIL_RELAY_ENABLED=on`
- `SENDB_EMAIL_API_BASE`, `SENDB_EMAIL_API_TOKEN`
- `SENDB_EMAIL_WORKSPACE_ID`, `SENDB_EMAIL_MAILBOX_ID`
- `SENDB_EMAIL_GOOGLE_CLIENT_ID`, `SENDB_EMAIL_GOOGLE_CLIENT_SECRET`, `SENDB_EMAIL_GOOGLE_REFRESH_TOKEN`
- `SENDB_EMAIL_RECEIVE_SINCE`: 명시적인 수신 시작 ISO 시각

```sh
node --import tsx examples/email-relay/run.ts receive
node --import tsx examples/email-relay/run.ts send
```

receive는 시작일 이후 INBOX를 50개씩 끝까지 읽어 수신 번호로 중복을 막는다. Gmail 읽음/라벨/삭제를 변경하지 않는다. 외부 서버에서 명시 실행하는 예제다. 샌드비 서버의 자동 처리에는 아래 Google 연결·영속 history 대기열을 사용한다. send는 대기 답장 한 건을 처리한다. 운영 서비스에 자동 워커를 켜거나 계정을 연결하지 않았다. 외부 서버에서 함수/SDK를 호출할 수도 있다.

## 검증과 남은 일

- `scripts/check-inbox-email.cjs` SQL/API 14개: 사업/조직/토큰·기본 중지·회원 혼입 방지, 수신/답장 멱등·CRM, 참여자 변경·재문의, 자동 회신, 내부 메모, 임대/시작/성공, 만료와 늦은 성공, 실패 재시도·중지, 원자 롤백, Gmail 수신 형식/페이지·발송 MIME/단일 POST, 웹 이력/자동 답장 제외.
- MIME/한글/HTML/charset/첨부 메일 격리/헤더/자동 회신 단위 검증 6개. 전체 단위 검증 1,064개 통과.
- 브라우저 QA는 두 사업의 가상 메일함과 가상 Gmail transport만 사용한다. 실제 고객 메일·Google Chat·운영 DB 접근은 없다.

첨부 수신/비공개 다운로드·실패 재요청·답장 MIME와 발송 전 해시 검증을 추가했다. [EMAIL-FILES.md](EMAIL-FILES.md)에 한도·API·복구와 추가 SQL/API 11개·전체 단위 1,067개 검증을 정리했다. 지원 한도를 넘는 파일/본문은 원본 메일함에서 확인하도록 표시한다. 여러 참여자·참조 전체 회신, 메일 별칭, 반송 후 배달 상태, 공급자 성공 결과 자동 재조정, push·운영 모니터링·부하·실제 계정 검수는 후속이다. Google OAuth 설치 UX와 영속 history/자동 수신·파일·발송 워커는 [GOOGLE-CONNECTION.md](GOOGLE-CONNECTION.md)에 추가했다. 파일 재시도는 예제의 files 모드와 추가 SDK로 지원한다. 이메일 AI 자동 발송/초안은 현재 차단하고 상담원이 직접 답장한다. 카카오·네이버·전화 어댑터도 R08 미완료 항목으로 유지한다.
