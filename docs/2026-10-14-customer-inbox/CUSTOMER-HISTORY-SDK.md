# 회원 문의 목록·새 문의를 여는 브라우저 SDK

샌드비 `dev`의 `/sendb-sdk.js`를 **1.4.0**으로 확장한다. 기존 `boot`, `show/hide`, launcher 제어, `identify`, 비회원 입력·초안 API를 유지한다. 운영 설치·설정·배포는 수행하지 않는다.

## 사이트에서 사용

```js
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

SendbChat.showConversations(); // 확인된 현재 회원의 문의 목록
SendbChat.showNewConversation(); // 첫 전송 전에는 문의를 생성하지 않는 작성 화면
SendbChat.showConversation(conversationId); // 현재 회원에게 속한 문의 상세
```

| 메서드 | SDK가 전달하는 화면 | 사전 조건 |
|---|---|---|
| `showConversations()` | `list` | 회원 연결 준비 완료 |
| `showNewConversation()` | `new` | 회원 연결 준비 완료 |
| `showConversation(id)` | `thread`, UUID `conversationId` | 회원 연결 준비 완료·유효한 UUID |
| `reconnect()` | 현재 인증과 iframe의 설정 재검증 | iframe 생성 완료·진행 중인 준비/인증 작업 없음 |

세 메서드는 동기 호출이다. 연결 전·준비 전·인증 전환/갱신 중에는 예외를 던지며, 비회원에게는 로그인한 회원용 기능이라는 오류를 반환한다. 비회원은 기존 `show()`로 현재 문의를 계속 사용할 수 있다. 올바르지 않은 문의 ID도 전송 전에 거절한다. 이 오류 경로에서는 iframe·창 표시·현재 인증·작성 문구를 변경하지 않는다.

탐색 호출을 대기열에 저장하지 않는다. 준비 전에 실패한 요청이나 A 회원의 요청을 B 회원이 연결된 뒤 자동 재생하지 않으며, `await boot/identify/reconnect` 완료 후 새로 호출해야 한다. 성공한 탐색은 기존 iframe을 재사용하고 숨긴 launcher 상태도 유지한다. `setDraft()`와 탐색은 별개이며 SDK가 작성 중인 문장을 다시 보내거나 전송하지 않는다. 화면 전환 시 문구·첨부 보존과 이동 확인은 위젯이 담당한다.

과거 채널톡 상담도 `showConversation(id)`로 열지만 서버의 `historyOnly/readOnly`에 따라 읽기 전용으로 표시한다. 과거 기록의 `setDraft()`는 새 문의용으로 보관하고 명시적으로 새 문의를 열어 확인한다. 현재/새 문의의 문장·첨부를 보존하며 과거 상담으로 전송하거나 재개하지 않는다. [공개 승인·본인 확인 정책](CUSTOMER-IMPORT-HISTORY.md)을 따른다.

반환은 화면 이동 요청을 보냈다는 뜻이다. 고객·채널 범위, 기록 존재 여부, 실제 읽음 처리는 서버/위젯에서 확인한다. `getSessionType()`은 이전 버전과 같이 SDK 로컬 연결 상태이며 접근 권한의 증거가 아니다. 회원 인증은 URL·영구 저장소·탐색 메시지에 넣지 않는다.

## iframe 메시지 계약

기존 `post(state, ...)`를 이용해 현재 iframe의 `contentWindow`와 샌드비 API의 정확한 origin으로 아래 메시지를 보낸 다음, 기존 `sendb:visibility`의 `opened: true`를 보낸다. `list/new`에는 `conversationId`를 넣지 않는다.

```js
{ type: "sendb:navigate", key: channelKey, configurationId, view: "list" }
{ type: "sendb:navigate", key: channelKey, configurationId, view: "new" }
{ type: "sendb:navigate", key: channelKey, configurationId, view: "thread", conversationId }
{ type: "sendb:visibility", key: channelKey, opened: true }
```

`sendb:navigate`는 HTTP 생성/전송 요청이 아니다. 새 문의는 사람이 첫 메시지를 전송할 때 컬렉션 API로 만든다. 선택한 문의가 없거나 다른 고객 소유이면 서버가 거절하고 위젯이 오류를 보여주어야 한다. 기존 `sendb:error`→SDK `error` 이벤트 계약을 사용하며 별도 탐색 성공 ACK는 요구하지 않는다. 부모 창 메시지의 출처·source·채널 확인은 위젯에서 기존 계약을 유지한다.

### 설정별 준비 확인과 실패 복구

SDK는 `sendb:configure`를 보낼 때마다 iframe 안에서 증가하는 `configurationId`를 함께 보낸다. 위젯은 **해당 설정/현재 인증에 대한 새 조회가 성공한 결과**에서만 같은 ID의 `sendb:ready`를 보낸다. SDK는 현재 ID의 활성 준비 대기에서만 ACK를 수락한다. ID가 없거나 다른 ID, 타임아웃으로 끝난 대기, 옛 iframe에서 온 응답은 준비를 해제하지 않는다. SDK1.4와 이 ACK를 제공하는 위젯을 함께 설치해야 한다.

```js
{ type: "sendb:configure", key: channelKey, configurationId, identityToken /* ... */ }
{ type: "sendb:ready", key: channelKey, configurationId }
```

`reconnect()`는 Promise를 반환하며 iframe·현재 인증·창 표시와 작성 문구를 보존한 채 새 configure/ready 확인만 수행한다. 첫 부팅의 준비 확인이 15초를 넘어 실패한 뒤에도 **이미 생성된 iframe이 있으면** 재시도할 수 있다. SDK 부팅 전이나 최초 토큰을 받는 중이라 iframe이 없을 때는 거절한다. 진행 중인 부팅/identify/refresh/reconnect와 중복 실행하지 않는다.

이미 한 번 준비된 연결의 `identify`가 타임아웃되어 `ready=false`가 남아도 다음 `identify`를 허용한다. 타임아웃은 대기를 종료하고 현재 프레임/토큰을 유지한다. 재시도는 새 ID를 사용하므로 이전 응답을 새 인증의 성공으로 오인하지 않는다. `boot()`로 계정을 바꾸거나 `shutdown()`하면 이전 연결의 준비 Promise는 종료된다. 인증 갱신도 같은 ACK/타임아웃을 적용하며 실패를 비회원 연결로 바꾸지 않는다. 현재 ID와 다른 설정의 `sendb:error`도 무시한다.

회원 JWT는 15분 동안 유효하다. `shutdown()`은 해당 창의 연결을 정리하지만 발급된 JWT를 서버에서 즉시 폐기하지 않는다. 공개 승인·관계 철회는 다음 API 조회에서 재검사하며, 아직 조회하지 않은 이전 목록 페이지 캐시까지 즉시 모두 회수하지 않는다.

## 디자이너하이어 어댑터 검토

SDK 담당은 공통 배포 SDK·가상 DOM/교차 검사·이 문서만 변경한다. 디하 웹 `codex/sendb-support-integration`의 실제 `SupportController`, loader, types와 별도 서버의 회원 인증 발급 소스를 읽어 호환을 확인했다. 사이트 코드는 별도 검토 채팅 담당이 controller/types/loader와 관련 검사 소유권을 받아 수정한다. SDK 담당은 두 사이트 저장소의 소스를 편집하지 않는다.

- 현재 문의 버튼은 `SupportController.open()`→SDK `show()`를 호출한다. SDK 1.4가 기존 메서드를 그대로 제공하므로 이 흐름을 유지한다. 새 회원 문의 목록·작성 화면의 기본 표시와 동작은 공통 위젯을 따른다.
- 컨트롤러는 SDK의 준비 Promise를 기다리며, 비회원 첫 로그인만 명시적으로 병합하고 A→B·로그아웃은 종료한다. 같은 회원 갱신은 `identify`, 기존 비회원 준비 재시도는 `reconnect`를 사용할 수 있다. 새 탐색 메서드도 반드시 이 준비 완료 상태에서 호출해야 한다.
- 디하 서버는 기존 Firebase 검증→CRM 고객 upsert→회원 JWT 발급 계약을 사용한다. 조회·새 문의 권한은 같은 회원 JWT를 사용하므로 이번 SDK 확장 때문에 서버 교환 경로를 바꿀 필요는 없다. 실제 Firebase 로그인·배포 검수는 별도다.
- 기존 디하 loader의 `?v=1.2.0` 고정과 새 API 기능 확인 부족을 공유했다. 별도 담당이 이를 `/sendb-sdk.js?v=1.4.0` 및 `reconnect` 확인으로 보강해 디하 개발 커밋 `23f27cc3`/초안 PR25에 반영했다. 샌드비 SDK 버전도 **1.4.0**으로 맞춘다. 실제 사이트 배포 캐시나 서버 설정을 바꾼 것은 아니다. 사이트 코드에서 새 탐색 API를 직접 사용하려면 그 메서드도 존재하는지 확인해야 한다.

## 검증 범위

아래 23개·교차 VM6 및 어댑터 기록은 기존 SDK1.4 검수 당시 근거다. 고객 과거 상담 후속 소스에서도 SDK VM **24개**와 사이트 어댑터 교차 VM **6개** 통과를 확인했다. 실제 SDK·위젯·API를 사용한 가상 호스트 UI 검수와 PDF 저장·신규 파일 선택의 미검증 범위는 [후속 검수 기록](CUSTOMER-IMPORT-HISTORY.md)에 별도로 적는다. 실제 사이트 로그인·설치 완료로 해석하지 않는다.

`node scripts/check-chat-sdk.cjs`는 실제 `public/sendb-sdk.js`를 VM의 가상 브라우저에서 실행한다. 기존 lifecycle·launcher·비회원 profile/draft에 탐색·설정 ACK·복구 검사를 더해 총 **23개**를 확인했다.

- 연결 전/준비 전/종료 후, 비회원, 잘못된 UUID에서 화면·메시지 불변.
- 회원의 목록/새 문의/개별 문의 메시지와 정확한 대상 origin, 탐색→표시 순서, iframe 재사용·숨긴 launcher 유지.
- 비회원 병합 중과 회원 인증 갱신 중 차단, 준비 뒤 명시적 새 호출만 전달, SDK 초안 메시지 보존.
- 늦은 A 인증 응답·옛 iframe의 준비 메시지가 B 새 연결에 탐색이나 인증을 전달하지 않음.
- 누락/오래된/타임아웃된 설정 ACK, 최초 준비 실패·identify/reconnect 실패 뒤 복구, 중복 준비 거절, 토큰 수신 중 프레임 없는 상태, 계정 변경 중 대기 종료.
- 갱신 함수 없는 회원 오류의 수동 identify 복구와 만료된 비회원 증명 제거·재검증.

기존 디하 컨트롤러/API 관련 검사 17개를 먼저 확인했다. 이어서 SDK mock의 한계를 보완하기 위해 **실제 디하 loader/controller/API TypeScript 소스와 실제 배포 SDK**를 함께 실행하는 별도 교차 VM 검사를 추가했다.

```sh
node --import ./src/test-alias-resolver-register.mjs --test src/components/support-chat/sendb/controller.test.ts
# 샌드비 저장소에서 실제 디하 웹 소스 경로를 지정
node scripts/check-customer-history-sdk.cjs F:/Dev/sendb-sites/new-designer-hire
```

교차 VM **6개 통과**: 비회원 연결/열기/숨김, 첫 로그인 병합과 같은 iframe의 회원 탐색, 같은 회원 준비 실패 뒤 초안을 유지한 재시도, 늦은 A 인증→B 연결·로그아웃 경계, 비회원 첫 준비 실패의 같은 프레임 복구, 비회원 재연결 중 로그인 대기·명시적 병합을 확인한다. SDK/검사 소유 파일 ESLint도 통과했다. 사이트 변경 후 최신 관련 타입/단위/격리 빌드는 별도 사이트 담당이 수행한다.

VM·가상 인증 교환만 사용하며 실제 고객 메시지, 운영 서버·DB, Firebase 계정이나 키 설정에 접근하지 않는다. 교차 VM은 TypeScript를 메모리에서 변환하며 사이트의 빌드 출력을 만들거나 바꾸지 않는다. 이 결과는 root 담당의 위젯 화면·실제 API/SQL·브라우저 통합 검수를 대신하지 않는다. 전체 샌드비 빌드·전체 회귀와 통합 PR 갱신은 root에서 한 번 묶어 수행한다.
