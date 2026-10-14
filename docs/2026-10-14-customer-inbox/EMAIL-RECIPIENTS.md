# 이메일 여러 참여자와 회신 대상

같은 메일함의 동일 제공자 스레드에서 여러 사람이 회신해도 같은 상담으로 받는다. 상담원은 **답장 / 전체 회신 / 받는 사람 직접 지정** 중 하나를 선택하고 받는 사람·참조를 확인한 뒤 발송 예약한다. R08의 실제 이메일 상담 대체를 위한 확장이다. 실제 Google 계정 연결이나 고객 발송은 수행하지 않았다.

## 사용하는 순서

1. 고객 상담에서 사업과 이메일 상담을 선택한다. 각 수신 메시지의 **메일 발신·수신 정보**를 펼치면 실제 발신자·받는 사람·참조·Reply-To를 확인한다.
2. 작성란의 기본 **답장**은 최신 수신 메일의 Reply-To(없으면 발신자)로 보낸다. **전체 회신**은 이 주소들과 최신 메일의 보이는 To/Cc를 포함한다. 현재 상담 메일함 자신과 중복 주소는 제외한다. Delivered-To/숨은참조 및 예전 메일에서만 등장한 주소를 추가하지 않는다.
3. **받는 사람 직접 지정**은 현재 대상에서 시작하며 주소를 추가·제거할 수 있다. 받는 사람은 한 명 이상, To/Cc 합계 최대 30명이다. 쉼표·세미콜론·줄바꿈으로 구분한다. To/Cc 중복은 To를 우선한다. 현재 상담 메일함 자신에게는 보낼 수 없다. 숨은참조 발송은 지원하지 않는다.
4. 작성 중 새 수신 메일이 도착하면 본문·직접 입력한 주소 초안은 유지한다. **최신 회신 대상으로 변경**으로 새 대상을 확인하기 전에는 예약을 거절한다. 이 버튼은 회신 방식/주소를 최신 메일의 기본 답장으로 바꾸므로 직접 지정한 주소를 먼저 확인한다. 성공한 답장 뒤에는 다음 메일을 기본 답장으로 시작한다.
5. **메일 발송 예약**은 메시지·첨부·수신자 목록을 원자 저장한다. 각 답장에서 실제로 예약된 To/Cc와 서비스 접수/실패/확인 필요를 확인한다. 내부 메모에는 외부 수신자 폼이 없으며 발송하지 않는다.

처음 문의한 발신자를 기본 CRM 고객으로 유지한다. 다른 참여자의 메시지에 그 사람의 발신 주소와 원본을 남기고, 상담 상단에는 최초 주소와 최신 발신자가 다르다는 안내를 표시한다. 고객 정보의 이메일은 ‘상담 시작 주소’로 표시한다. 참여자를 별도 CRM 고객으로 자동 병합하거나 최초 고객의 이름·이메일을 덮어쓰지 않는다. 필요한 CRM 연결은 사람이 확인한다. 동일 발신자의 다른 스레드나 다른 메일함의 같은 제공자 스레드는 별도 상담이다.

## API와 서버 SDK

기존 직원/서비스 상담 POST에 선택 `emailReply`를 추가한다. 직원은 현재 사업의 응대 권한, 서비스 키는 해당 사업의 create 권한과 발급자의 현재 응대 권한을 확인한다. 이메일 답장은 사람이 검토하는 기존 정책을 유지한다.

```ts
const detail = await client.inboxConversation(conversationId);
const context = detail.conversation.emailContext!;
await client.reply(conversationId, "안내드린 내용을 확인해주세요.", crypto.randomUUID(),
    "reply", [], undefined,
    { mode: "reply_all", sourceMessageId: context.sourceMessageId! });

// 직접 지정할 때만 to/cc를 전달한다.
await client.reply(conversationId, "담당자에게 안내드립니다.", crypto.randomUUID(),
    "reply", [], undefined,
    { mode: "custom", sourceMessageId: context.sourceMessageId!,
      to: ["owner@example.test"], cc: ["reviewer@example.test"] });
```

`GET /api/v1/inbox/conversations/:id`의 `conversation.emailContext`는 기존 `subject,recipient,from,enabled`와 `sourceMessageId,sender,primarySender,replyTo,replyAllTo,replyAllCc`를 제공한다. 서비스 SDK는 `inboxConversation()`을 추가했다. `reply()`의 마지막 인자와 수신 `replyTo[]`는 선택 항목이어서 기존 호출을 유지할 수 있다. 기존 선택 없는 호출은 큐 저장 시점 최신 메일에 기본 답장한다. 새 UI/클라이언트는 원본 번호를 전달해 동시 도착을 확인한다.

`emailReply`의 `mode`는 `reply|reply_all|custom`, `sourceMessageId`는 최신 수신 메시지의 양수 번호다. 최신 원본이 바뀌면 409이며 메시지·첨부 연결·대기열을 저장하지 않는다. 일반/전체 회신에 임의 to/cc를 넣거나 웹 상담·내부 메모에 이메일 선택을 넣으면 거절한다. 같은 clientId의 재시도는 원래 요청의 회신 방식/원본/주소를 확인한 뒤 기존 메시지를 반환한다. 새 메일이 와도 이미 저장한 큐의 수신자·In-Reply-To는 바뀌지 않는다.

claim 및 답장 `delivery`에 `recipientTo[],recipientCc[],replyMode,sourceMessageId`를 추가한다. 기존 `recipient`는 첫 To 주소로 유지한다. **자체 외부 발송 어댑터도 새 To/Cc 배열을 전달하도록 갱신해야 한다.** 저장소의 Gmail 어댑터/자동 워커/relay 예제는 이 배열로 MIME를 만들며 헤더 줄을 접고 Bcc를 만들지 않는다. 수신·발송 설정/권한 회수, 첨부 준비, 임대/시작/접수, 확실한 실패 재시도와 결과 미확인 중복 방지 계약은 유지한다. 서비스 접수는 배달/읽음 증거가 아니다.

수신 API의 제공자 thread/message ID는 인증된 메일함 연결 서버가 실제 공급자 원본에서 가져온다. 공개 방문자가 제공한 임의 스레드 번호로 고객 이력을 연결하지 않는다. 같은 메일함·스레드의 참여자 변경은 수신할 수 있지만 다른 사업·조직이나 공개 웹 회원 이력으로 이메일을 노출하지 않는다. 이전 파서가 Reply-To를 저장하지 않은 기존 원본 재수신은 중복으로 처리하며 원래 봉투를 덮어쓰지 않는다.

## 배포와 검증

마이그레이션 **0104_email_reply_recipients.sql**을 앱보다 먼저 적용한다. 최신 수신 메시지 FK, 예약 To/Cc/회신 방식/원본/요청 fingerprint 및 수신 메시지 인덱스를 추가한다. 기존 예약은 기존 recipient 하나를 To로 복원하고, 최신 수신은 메일함·상담·저장 RFC Message-ID가 일치하는 원본으로만 백필한다. 추정으로 다른 상담을 연결하지 않는다. 마이그레이션 직후 이전 앱이 만든 단일 수신자 대기도 읽을 수 있고, 최신 원본 포인터가 없거나 오래되면 같은 상담·메일함·RFC 원본에서 회신 대상을 확인한다. 새 API 예약은 필수 To/Cc 배열을 저장한다. 실제 dev/운영 DB 마이그레이션·운영 배포·자동 워커 활성화는 미수행이다.

- `node --import tsx scripts/check-email-recipients.cjs`: SQL/API/SDK 16개. 여러 발신자/Reply-To, 실제 To/Cc MIME, 원본 경쟁·롤백, 주소/모드 변경 재시도 충돌, 입력/권한/메모·웹 격리, 사업 분리, 늦은 과거 메일, 이전 fingerprint, 예약 재시도와 기존 자료 백필을 확인한다.
- 새 순수 단위 4개를 포함한 전체 1,089개, 타입·기능 lint·격리 빌드 및 기존 15개 회귀 검사 통과. 기존 이메일 검사도 참여자 변경의 실제 원본·최초 CRM 유지와 별도 스레드를 검증하도록 갱신했다.
- Chrome에서 디하 전체 회신 To/Cc→가상 접수, 새 참여자 수신→초안 유지/대상 재확인·차단→직접 지정 접수, 백오랩 별도 전체 회신/접수 및 메모 폼 분리를 확인했다. 가상 계정·PGlite·가상 Gmail HTTP만 사용했다. 실제 고객 메일·Google 승인·운영 DB·R2 삭제는 없다.
- `evidence-manifest.json`의 `emailRecipientsQa`에 구현 해시·로그·화면 증거를 보존한다.

Gmail 공식 [발송/MIME](https://developers.google.com/workspace/gmail/api/guides/sending), [스레드](https://developers.google.com/workspace/gmail/api/guides/threads) 계약을 확인하고 기존 독립 구현을 확장했다. 별칭 주소/Reply-From 선택·반송 및 실제 배달 상태·실제 OAuth/메일함 검수·push·부하/모니터링·카카오/네이버/전화와 전체 자료 전환은 남아 있다. 전체 대체 완료로 판단하지 않는다.
