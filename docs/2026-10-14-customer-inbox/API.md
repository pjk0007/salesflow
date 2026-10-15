# 두 사이트의 API/SDK 통합

현재 SDK는 샌드비 저장소에 포함된 소스다. 별도 npm 패키지로 배포하지 않았다. 서비스 서버용 `sdk/server.ts`는 Node의 fetch를 사용하며, 브라우저 SDK는 배포 서버의 `/sendb-sdk.js`에서 제공한다. 기존 한 줄 설치 `/sendb-chat.js`도 계속 동작한다.

## 직원과 서비스 키의 사업 권한

상담팀 CRUD·팀원·선택 자동 배정과 기존 상담의 `teamId`/`filter=myTeams`, native/서비스 API와 서버 SDK는 [ROUTING.md](ROUTING.md)를 따른다. 팀 구성이 직원 권한을 부여하지 않는다. 0107의 선택 `requireAvailable`은 현재 접속과 응대 가능 상태도 확인한다. 직원의 접속/작성·개인 상태 API와 서비스 키의 조회 SDK는 [PRESENCE.md](PRESENCE.md)를 따른다. 자동 배정과 접속 필터는 기본 꺼짐이다.0108의 직원별 자동 배정 한도/진행중 수·대기열 재처리 native/서비스 API와 SDK는 [CAPACITY.md](CAPACITY.md)를 따른다. 큐 워커는 기본 꺼짐이며 한도는 기본 무제한이다.

고객 플랫폼 직원 업무는 사업별 열람/응대·편집/운영 관리 역할을 사용한다. 일반 직원의 초기 접근은 없으며 조직 관리자가 고객 상담 → 직원 권한에서 배정한다. 서비스 API 키의 기존 읽기·생성·수정 범위는 발급자의 현재 사업 역할과 함께 확인하며, 설정 변경에는 사업 운영 관리가 필요하다. 조직 관리자 발급 키도 토큰 범위를 넘지 못한다. 직원 권한 배정 API에는 직원의 조직 관리자 세션만 사용할 수 있다. 계약·회수/준비 중 이메일·Google/자동화 처리·마이그레이션 0102 배포 순서는 [ACCESS.md](ACCESS.md)를 따른다.

## 설치 순서

이메일 여러 참여자와 답장/전체 회신/직접 지정은 [EMAIL-RECIPIENTS.md](EMAIL-RECIPIENTS.md)를 따른다. 상세 API/SDK의 최신 sourceMessageId와 replyTo/replyAllTo/replyAllCc를 확인한 뒤 reply의 마지막 emailReply 인자로 선택을 전달한다. 자체 메일 발송 어댑터도 claim의 recipientTo/recipientCc를 사용하도록 갱신한다. 마이그레이션 0104가 선행되어야 한다.

고객·회사 상세/필드 이력·버전 편집·보관/복구는 [CUSTOMER-RECORDS.md](CUSTOMER-RECORDS.md)를 따른다. 연동 upsert의 속성 병합은 유지하며 id PATCH의 attributes는 전체 교체다. 보관은 사업 운영 관리와 키 delete 범위, 복구는 운영 관리와 update 범위가 필요하다. 마이그레이션 0103을 앱보다 먼저 적용한다.

1. 관리자가 고객 상담 → 사이트 상담창에서 디자이너하이어와 백오피스랩 각각의 워크스페이스·설치 출처·환영 문구를 저장하고 켠다. 출처는 `https://site.example` 형식이며 경로를 넣지 않는다.
2. 기존 API 토큰 설정에서 사업별 워크스페이스 범위의 토큰을 만든다. 고객/회사 upsert와 회원 인증에는 읽기·생성·수정 권한이 필요하다. 다른 사업의 토큰을 공유하지 않는다.
3. 토큰은 **사이트 서버의 환경 변수**에 넣는다. 브라우저, HTML, 위젯 공개 키 또는 URL에 넣지 않는다.
4. 사이트 서버에서 검증된 로그인 세션을 읽어 고객·회사 정보를 동기화하고, 샌드비 회원 인증을 발급한다.
5. 브라우저는 자기 사이트의 인증 발급 경로를 호출하는 `getIdentityToken`을 넘긴다. 로그인 계정 전환·로그아웃 시 `shutdown()` 후 새 설정으로 `boot()`한다.

운영 사이트에는 운영 반영 검토 이후의 서버 주소·채널 키를 사용한다. 개발 서버의 채널 키를 운영 사이트에 설치하지 않는다.

## 사이트 서버 예시

```ts
import { SendbClient, createMemberIdentityHandler } from "./sdk/server";

const client = new SendbClient({
    apiBase: process.env.SENDB_API_BASE!,
    apiToken: process.env.SENDB_SERVICE_API_TOKEN!,
});

export const POST = createMemberIdentityHandler({
    client,
    workspaceId: Number(process.env.SENDB_WORKSPACE_ID),
    channelId: Number(process.env.SENDB_CHANNEL_ID),
    authenticate: async request => {
        const member = await readVerifiedSiteSession(request); // 사이트의 기존 인증 함수
        if (!member) return null;
        return {
            id: member.id, name: member.name, email: member.email,
            company: member.company && { id: member.company.id, name: member.company.name },
            attributes: { plan: member.plan },
        };
    },
});
```

`readVerifiedSiteSession`은 예시 이름이다. 실제 로그인 검증 함수를 연결해야 한다. 요청 JSON의 고객 ID·이메일을 그대로 반환하는 방식은 사용하지 않는다. 인증 발급 경로는 POST이며 같은 사이트 출처만 허용한다. 응답의 회원 인증은 15분 유효하고, 고객 이력 조회 전 서버에서 서명·만료·채널·고객 범위를 확인한다.

## 브라우저 위젯

```html
<script src="https://your-sendb-server.example/sendb-sdk.js"></script>
<script>
async function startMemberChat(channelKey) {
    await SendbChat.boot({
        apiBase: "https://your-sendb-server.example",
        channelKey,
        getIdentityToken: async () => {
            const response = await fetch("/api/chat-identity", { method: "POST" });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error);
            return result.data;
        },
    });
}
</script>
```

| 메서드 | 동작 |
|---|---|
| `boot(options)` | 연결 완료까지 Promise 대기. 시작만으로 빈 회원 상담을 만들지 않는다 |
| `show()` / `hide()` | 상담창 열기/닫기 |
| `showLauncher()` / `hideLauncher()` | SDK 1.2.0: 상담 열기 버튼만 표시/숨김. 상담창 열기/닫기와 독립적 |
| `getSessionType()` | SDK 1.2.0: 로컬 연결 진행 상태 `uninitialized` / `anonymous` / `member`. 서버 인증·접근 권한을 증명하지 않음 |
| `setDraft(message)` | SDK 1.3.0: 5,000자 이내 입력 초안을 제안. 기존 문장을 덮지 않고 사람의 교체 선택 제공. 전송하지 않음 |
| `updateVisitorProfile({name,email?})` | SDK 1.3.0: 현재 비회원 입력 정보만 갱신하는 Promise. 첫 문의 전에는 입력란만 준비하며 빈 상담을 만들지 않음 |
| `shutdown()` | iframe·버튼·현재 인증·사이트의 익명 세션 제거. 서버 대화 기록은 보존 |
| `identify(identityToken)` | 새 인증이 확인될 때까지 Promise 대기. 같은 회원 인증 갱신은 입력 초안 보존 |
| `trackEvent(name, properties?, eventId?)` | 확인된 회원의 행동 이벤트 저장. 재시도에는 같은 UUID 사용 |
| `on(event, handler)` | 구독 해제 함수를 반환. ready/show/hide/shutdown/error/unreadCountChange 사용 |

SDK 1.2.0의 `boot({ hideLauncher: true, ... })`는 버튼을 처음 추가할 때부터 숨긴다. 사이트의 일반 `button` CSS가 HTML hidden을 덮어도 inline display로 숨김을 유지한다. 페이지·가이드 등 여러 숨김 이유의 조합은 설치 어댑터가 관리한다. `hideLauncher()`는 이미 열린 상담창을 닫지 않으므로 필요하면 `hide()`도 호출한다. 디하 실제 소스의 연결·인증 재시도·로그아웃·중첩 숨김과 검수 한계는 [DESIGNER-SITE.md](DESIGNER-SITE.md)를 따른다.

SDK 1.3.0의 비회원 정보 갱신은 이미 있는 익명 증명만 `POST /api/messenger/{key}`의 `{action:"profile",name,email?}`에 전달한다. 해당 상담의 이름/이메일·버전·감사/outbox만 바꾸며 메시지나 기존 CRM 회원을 만들거나 연결하지 않는다. 이메일 생략은 기존 값 보존, 빈 문자열은 삭제다. 회원 JWT·회원에게 연결된 옛 익명 증명·다른 채널/추가 ID 필드는 거절한다. 같은 값 재시도는 변경 이력을 중복 생성하지 않는다. 백오랩 신청 후 초안/재연결 UX·실제 소스 검수는 [BACKOFFICE-SITE.md](BACKOFFICE-SITE.md)를 따른다.

회원 인증은 메모리에만 두고 URL이나 사이트 저장소에 남기지 않는다. 제공한 갱신 함수로 만료 전에 재발급한다. 익명 상담은 사이트 출처의 저장소에 세션을 보존하여 새로고침을 지원한다. 저장소가 제한된 환경에서는 현재 열린 창에서만 이어진다. 익명→회원 연결은 로그인 완료 시 명시적으로 identify(token,{mergeAnonymous:true})를 호출한다. 일반 계정 전환에는 병합하지 않는다. IDENTITY.md의 서버 확인 계약을 따른다.

서명/갱신 실패는 `error` 이벤트 및 연결 Promise 오류로 표시한다. 유효하지 않은 회원 인증을 익명으로 자동 강등하지 않는다. 위젯 조회는 열린 상태 3초, 닫힌 상태 최대 15초 간격이다. 실시간 push 방식은 후속 확장이다.

## 서비스 서버 REST API

모두 `Authorization: Bearer <서비스 API 토큰>`과 `{success,data}` / `{success:false,error}` 응답을 사용한다. 회원 인증 JWT로 서비스 서버 API나 직원 UI에 로그인할 수 없다.

| 경로 | 메서드와 계약 |
|---|---|
| `/api/v1/crm/contacts` | GET `workspaceId,before?`, POST 고객 upsert |
| `/api/v1/crm/companies` | GET `workspaceId,before?`, POST 회사 upsert |
| `/api/v1/crm/contacts/{id}/events` | GET `workspaceId,before?`, POST `workspaceId,eventId,name,properties?,occurredAt?` |
| `/api/v1/crm/contacts/{id}/activity` | GET `workspaceId,before?` → 상담 공개 메시지·딜·업무·고객 이벤트 공통 타임라인. 시각/ID 커서의 마지막 활동 id를 before로 사용 |
| `/api/v1/inbox/channels` | GET `workspaceId`, POST 상담창 설정 |
| `/api/v1/inbox/sessions` | POST `channelId,contactId` → `identityToken,expiresAt,channelKey` |
| `/api/v1/inbox/conversations` | GET `channelId,q?,status?,filter?,before?,beforeId?` |
| `/api/v1/inbox/conversations/{id}` | GET 상세·메시지, PATCH 상태/담당/중요/태그, POST 답변/내부 메모 |
| `/api/v1/crm/pipelines`, `/deals`, `/tasks` | GET 목록·POST 생성, `/{id}` GET 상세·PATCH 수정. 계약·SDK·UX는 [영업 흐름 가이드](SALES.md) 참고 |

고객/회사 upsert는 `workspaceId,externalId,name`이 필수다. 같은 워크스페이스의 외부 ID를 다시 보내면 갱신하고, 다른 워크스페이스의 동일 ID는 별도 고객이다. 생략 필드는 보존한다. `attributes`는 최상위 키를 병합하고 같은 키는 새 값으로 바꾼다. 고객의 `companyIds`는 생략 시 보존, 명시하면 해당 회사 목록으로 교체하며 `[]`는 연결 해제다. 관계/CRM `recordId`는 같은 사업만 허용한다.

목록은 최대 100건이다. 고객·회사·이벤트는 마지막 `id`를 `before`로 전달한다. UUID 순서는 시간순 계약이 아니다. 상담은 최신 메시지 시각·ID 내림차순이며 마지막 `lastMessageAt`과 `id`를 `before`·`beforeId`로 함께 보낸다. 메시지는 정수 ID의 `before`를 사용한다. 딱 100건이면 다음 페이지를 조회하고 빈 목록이면 종료한다.

`q`는 최대 200자의 문자 부분 검색이다. 이름·이메일·태그·최근 내용·과거 대화 본문을 서버 전체에서 찾는다. 직원의 내부 메모도 검색 대상이고 고객 API에는 공개하지 않는다. `status`는 open/snoozed/closed, `filter`는 all/mine/unassigned/unread/priority다. `mine`/`unread`는 토큰을 만든 직원 기준이다.

이벤트의 `eventId`와 메시지의 `clientId`는 UUID다. 같은 ID·같은 내용의 재전송은 기존 결과를 돌려주고, 다른 내용이면 409로 거절한다. 미확인 전송을 새로운 ID로 무조건 재시도하지 않는다.

## 자체 화면용 고객 API

`/api/messenger/{channelKey}`는 설치 출처에 CORS를 제공한다. 서비스 토큰을 쓰지 않는다.

- GET: 인증 없이 공개 설정. 회원 JWT 또는 익명 세션 Bearer가 있으면 해당 고객의 공개 대화·프로필만 반환한다.
- POST `{action:"session",name,email?,pageUrl?}`: 익명 세션 시작. 입력 이메일로 기존 회원 이력을 가져오지 않는다.
- POST `{clientId,body}`: Bearer가 확인된 고객의 메시지 저장. 회원은 첫 메시지에서 대화가 생성된다.
- POST `{action:"track",eventId,name,properties?,occurredAt?}`: 회원 Bearer에서 고객을 확인해 이벤트 기록.
- 내부 메모·API 토큰·세션 해시는 고객 응답에 포함하지 않는다.

## 실행 예제와 검증

`examples/customer-platform/site-server.cjs`와 `site.html`은 두 사업에 같은 계약을 적용하는 로컬 예제다. `startSite({client,workspaceId,channel,port,title,accent})`에 각 사업 설정을 넘긴다. 실행 시 TS 로더가 필요하다. 가상 HttpOnly 로그인 쿠키는 **예제 전용**이며 실제 사이트 인증으로 교체해야 한다. 회원의 자체 API 화면과 위젯은 같은 대화를 공유한다. 비회원 자체 화면은 별도 임시 세션을 사용한다. ‘비회원 상담 이어서 회원 A 로그인’은 위젯 SDK `identify(token,{mergeAnonymous:true})`와 자체 UI의 `action:identify` API로 각각의 비회원 이력을 같은 회원에게 연결한다. 일반 계정 전환과 로그아웃에서는 합치지 않는다. [연결 계약](IDENTITY.md) 참고.

격리 QA는 `node --import tsx scripts/check-customer-platform.cjs`, `node --import tsx scripts/check-inbox.cjs`다. 실제 PostgreSQL SQL을 PGlite에서 실행하며 실제 고객·외부 메시지를 전송하지 않는다. 현재 확인 결과와 남은 전체 대체 항목은 `HANDOFF.md`, `REPLACEMENT.md`를 참고한다.


상담 파일 업로드·다운로드, 메시지 attachmentIds, 변경 이력과 상담 version 계약은 [FILES-AUDIT.md](FILES-AUDIT.md)를 참고한다.

웹훅 구독·서명 검증·outbox·재시도·전달 이력 API와 서버 SDK는 [WEBHOOKS.md](WEBHOOKS.md)를 참고한다.

상담 AI 설정·승인 지식·초안/전송 연결·사람 이관 API와 서버 SDK는 [AI-SUPPORT.md](AI-SUPPORT.md)를 참고한다.

고객 자동화의 저장·모의 실행·게시·예약/복구·중단 API와 SDK는 [WORKFLOWS.md](WORKFLOWS.md)를 참고한다.

기존 서비스 JSON/CSV의 매핑·미리보기·사람 실행·묶음 처리/복구, 과거 상담 구분과 이전 API/SDK는 [IMPORTS.md](IMPORTS.md)를 참고한다.

이메일 수신·발송 대기열/결과·메일함 설정 API와 서버 SDK, Gmail 연결 예제는 [EMAIL.md](EMAIL.md)를 참고한다.

Google OAuth 관리자 UI API·서버 자동 수신/history 체크포인트·기존 이메일 API 재사용은 [GOOGLE-CONNECTION.md](GOOGLE-CONNECTION.md)를 참고한다. 기존 외부 SDK 계약에 선택 deliveredTo 주소 배열을 추가했으며 To/Cc/Delivered-To 중 등록 주소를 확인한다.

상담 개인 알림·업무시간/응대 목표 설정·사례별 상태·성과 보고의 private/native API와 서버 SDK, 공개 businessHours 계약은 [OPERATIONS.md](OPERATIONS.md)를 참고한다.


개인 내부 메모 멘션·앱 알림·나를 멘션한 상담·오래된 원문 조회와 회원 연결 보존은 0105에 추가했다. 고객 읽음/메일 발송과 구분한다. [MENTIONS.md](MENTIONS.md)에 UX·API/SDK·권한·SQL/API19·Chrome 검수와 남은 팀 협업 범위를 기록했다.

실제 디하 서버 저장소에 Firebase 회원 확인→샌드비 인증 교환을 기능 브랜치로 구현했다. 설치/운영 완료와 구분하며 [SITE-INTEGRATION.md](SITE-INTEGRATION.md)를 따른다.
