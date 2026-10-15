# 내부 메모에서 팀원 호출하기

2026-10-15 · R06/R13의 개인 멘션과 샌드비 앱 알림을 구현했다. 상담·고객·거래·업무가 같은 고객 문맥을 공유한다는 제공 리서치의 원칙을 유지한다. 고객에게 보내는 답변과 직원 협업 메모는 구분한다.

## 사용 방법

1. 상담을 열고 **내부 메모 → 팀원 멘션**을 펼친다. 이름을 검색해 필요한 팀원을 선택한다. 같은 사업을 볼 수 있는 활성 직원만 나오며 한 메모에 최대 20명이다. 열람 직원도 받을 수 있지만 메모 작성에는 응대 권한이 필요하다.
2. 메모를 작성하고 **메모 저장**을 누른다. 선택한 사람의 이름을 메모 아래에 표시하고 그 사람에게 개인 상담 알림을 저장한다. 고객 답변으로 전환했다 돌아오거나 페이지를 새로고침해도 메모 초안과 선택은 보존된다. 저장에 실패해도 남고 성공하면 비운다.
3. 받은 사람은 상단 **상담 알림 → 내부 메모 멘션**을 누른다. 상담과 함께 **알림으로 연 내부 메모**를 보여준다. 이후 메시지가 100건 넘게 쌓여도 원문과 보호 첨부를 바로 조회한다.
4. **나를 멘션한 상담**에서 자신이 호출된 상담을 찾는다. 검색·상태 탭·전체 건수·다음 페이지는 서버 전체 자료를 기준으로 한다. 알림을 읽어도 이 목록에서 지워지지 않는다. 고객 메시지 읽음은 멘션 알림의 읽음을 대신하지 않는다.

이름을 본문에 타이핑하는 자동완성은 아니다. 선택한 팀원 칩이 실제 알림 대상이다. 권한을 잃은 초안 대상은 ‘접근 권한 확인이 필요한 팀원’으로 표시하며 제거하거나 대상을 다시 확인한다. 팀 단위 호출·접속 상태·분배 규칙·OS/이메일/Google Chat 알림은 후속이다.

## API와 SDK

직원 세션의 `/api/inbox`와 사업 범위 서비스 토큰의 `/api/v1/inbox`가 같은 저장 로직을 사용한다. 서비스 키는 발급자의 현재 사업 권한을 넘지 못한다.

- `GET /api/v1/inbox/channels/{channelId}/teammates`: 현재 사업을 열람할 수 있는 `{id,name}[]`. 네이티브 화면은 bootstrap의 `mentionMembers`를 사용한다. 응대 담당자 후보인 기존 `members`와 구분한다.
- `POST /api/v1/inbox/conversations/{id}/messages`: `{kind:"note",body,clientId,attachmentIds?,mentionedUserIds:UUID[]}`. UUID는 중복 없이 최대 20개다. 공개 답변에 멘션을 붙이면 거절한다. 방문자 API는 직원 호출 기능을 제공하지 않는다.
- `GET /api/v1/inbox/conversations/{id}?focusMessageId=N`: 해당 상담의 내부 메모만 `focusedMessage`로 반환한다. 기본 `messages`의 최신 100건과 별도로 원문을 찾는다. 다른 상담/사업/조직의 번호나 공개 메시지는 거절한다. 기존 `before` 메시지 커서와 함께 사용할 수 있다.
- 상담 목록 `filter=mentioned`: 현재 인증된 직원 자신이 멘션된 상담이다. 다른 직원 ID를 입력해 목록을 바꿀 수 없다.
- 알림은 `type:"mentioned"`, `messageId:number`를 포함한다. 기존 개인 알림 조회·읽음 API를 재사용한다.

```ts
const teammates = await client.mentionTeammates(channelId);
await client.note(conversationId, "제안 내용을 확인해 주세요.", clientId, {
    mentionedUserIds: [teammates[0].id],
});
const detail = await client.inboxConversation(conversationId, undefined, messageId);
// detail.focusedMessage: 알림에 연결된 내부 메모
```

위 예제는 대상 존재와 사업 권한을 확인한 뒤 호출한다. 첨부 ID는 기존 상담 첨부 계약을 따른다.

## 저장·읽음·회원 연결

메모·첨부 연결·대상 목록·개인 알림을 한 트랜잭션에 저장한다. 이름은 저장 당시 값을 보존한다. 같은 `clientId`의 본문·첨부·대상 집합이 같으면 재시도 결과를 재사용한다. 대상 순서만 달라도 동일하고, 내용/대상 변경은 409다. 저장 전 역할이 바뀌면 전체 저장을 취소한다. 알림을 모두에게 대신 보내지 않는다.

직원 메모와 멘션은 공개 고객 이력·고객 활동·고객 메시지 순번·웹훅 공개 메시지·이메일 발송 대기열에 들어가지 않는다. 내부 고객 제외 규칙은 고객 성과 알림에 유지하면서 직원이 직접 선택한 협업 알림은 받을 수 있게 한다. 자신의 알림만 현재 사업 권한으로 조회한다. 비활성화/사업 권한 회수 후에는 대상·알림·상담 조회에서 제외한다.

비회원→회원 이력 병합은 메모 ID를 유지하며 멘션 관계와 개인 알림을 새 상담으로 함께 옮긴다. 미확인 멘션을 고객 읽음으로 일괄 처리하지 않는다. 이전 상담 번호로 원문을 열어도 병합된 상담에 연결한다. 사용자 실제 삭제 시 FK 정리까지 영구 보존한다고 보장하지 않는다.

## 검증과 배포 범위

- `node --import tsx scripts/check-inbox-mentions.cjs`: SQL/API 19개. 사업/조직/역할·중복/변경 재시도·트랜잭션 실패/첨부 롤백·공개 격리·읽음 분리·오래된 원문·이력 병합·권한 회수·메일 발송 없음·20명·알림/상담 커서를 검사한다.
- 전체 단위 1,093개, 기존 기능 회귀 16묶음, 최종 타입·기능 lint·격리 Next 빌드 확인. 각 결과와 원본 파일 해시는 `evidence-manifest.json`의 `mentionsQa`에 기록한다.
- Chrome에서 디하 팀원 선택→답변/메모 전환 초안 보존→저장→열람 직원 알림→110개 뒤의 옛 메모 원문, 읽은 뒤 멘션 목록 유지와 백오랩 별도 대상/알림을 검수한다. 증거는 가상 고객과 로컬 PGlite/HTTP만 사용한다.

`0105_inbox_mentions.sql`을 앱보다 먼저 적용해야 한다. 이 검증은 실제 dev/운영 DB 적용·직원 배정·운영 배포·실제 고객 알림을 수행한 것이 아니다. 실제 사이트 로그인 설치·전체 자료 이전·팀 업무/부하·전환 검수는 전체 대체 목표에 남는다.

참고: [Intercom 팀원 호출](https://www.intercom.com/help/en/articles/6525765-loop-teammates-or-teams-into-conversations), 기존 고정 Chatwoot 대화 모델과 Opencom 기능 목록. 공개 문서의 사용자 흐름을 참고해 기존 샌드비 DB/API에 독립 구현했다. 타 서비스 내부 서버를 관찰했다고 주장하지 않는다.

## 실제 사이트 연결 확인

확인한 `F:/Users/PW1234/Documents/projects/designer-hire-desktop`은 `designer-hire.com/login`을 여는 Electron 앱이다. 기존 `partners/package.json` 수정은 보존했고 이 저장소는 수정하지 않았다. 연결된 `isaackimmatches/goal-designer-hire-com-4-qa`는 QA 보고서·이미지 등 244개 파일이며 실제 웹 서버/로그인 소스가 아니다. 후속으로 기존 Git 로그인에서 `matches-plan` 비공개 저장소를 찾았다. `new-designer-hire`의 Firebase 회원 인증·채널톡 hook, `back-office-lab`의 채널톡·기존 Sendb 문의 저장, `designer-hire-server` Cloud Functions를 확인했다. [SITE-SOURCES.md](SITE-SOURCES.md)에 고정 소스와 남은 설치 검수를 기록했다. 해당 저장소를 수정하거나 실제 사이트에 배포하지 않았으며 로컬 예제를 실제 서비스 설치 완료로 취급하지 않는다.
