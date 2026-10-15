# 고객의 문의 목록·새 문의·읽음

2026-10-15 · 샌드비 `dev` 검토용 구현이다. 운영·실서버·고객 DB에 반영하지 않았다. 디하·백오랩의 공통 상담창과 자체 화면용 고객 API를 함께 제공한다.

## 고객이 사용하는 흐름

1. 로그인한 고객이 상담창의 **내 문의 목록**을 연다. 첫 질문·최근 공개 메시지·상태·시각·안 읽은 답변 수를 보고 문의를 선택한다.
2. 다른 주제는 **새 문의**에서 작성한다. 화면만 열거나 목록으로 돌아가면 빈 문의가 생기지 않는다. 첫 메시지와 문의를 같은 트랜잭션으로 저장한다.
3. 기존 웹 문의를 선택하면 그 문의에만 답변한다. 완료된 웹 문의에 다시 보내면 재개하고, 새 문의를 만들더라도 기존 문의의 담당·상태는 그대로 둔다. 가져온 과거 상담은 읽기 전용이며 재개하지 않는다.
4. 이 창 안에서 문의별 문장·제안 초안·첨부를 보관한다. 첫 조회 중에는 문의 ID를 확인할 때까지 전환/전송을 잠시 제한하며 입력은 보관한다. 문의가 없는 회원의 최초 초안은 새 문의로 이어진다. 토큰 갱신과 SDK 재연결은 현재 문의와 초안을 유지한다. 전체 페이지 새로고침·창 종료·로그아웃 이후의 영구 초안 저장은 제공하지 않는다.
5. 목록을 보기만 하면 답변을 읽음 처리하지 않는다. 열린 현재 웹 문의의 공개 메시지를 확인한 위치와 병합 세대를 서버에 저장한다. 다른 기기에서도 같은 확인 상태를 조회한다. 과거 상담은 미확인 수에 포함하지 않고 읽음 위치를 저장하지 않는다.

비회원은 현재 익명 세션의 문의만 이어간다. 회원 전체 목록과 복수 새 문의 기능은 로그인 후 사용할 수 있다. 비회원 문의를 명시적으로 회원에게 연결하면 회원의 현재 문의와 합치며 이전 별도 문의는 유지한다. 이때 미전송 파일은 다시 선택해야 한다는 기존 안내를 유지한다.

이 목록은 현재 회원의 **웹 상담**과 조건을 충족한 **본인의 과거 채널톡 공개 상담**을 구분해 제공한다. 과거 상담은 관리자가 원본 계정과 회원 ID 체계의 일치를 확인해 `verifiedCustomerHistory`로 승인한 경우에만 읽기 전용으로 표시한다. 기본값은 `false`이며 직원 메모·다른 고객/사업·이메일 상담·미승인 과거 상담·병합된 원본 행은 제외한다. [관리자 사용법·인증과 회수의 한계](CUSTOMER-IMPORT-HISTORY.md)를 따른다.

과거 기록을 왕복해도 현재/새 문의의 문장·선택 파일을 보존한다. 과거 기록에서 받은 사이트 `setDraft()` 문구는 새 문의용으로 따로 보관하고 사람이 **새 문의 초안 열기**로 확인한다. 기존 새 문의 문장을 자동으로 덮거나 전송하지 않는다.

## 브라우저 SDK

SDK1.4.0과 같은 버전의 위젯을 함께 사용한다. 사이트의 인증 연결이 완료된 뒤 `showConversations()`, `showNewConversation()`, `showConversation(id)`를 호출한다. 실패 복구는 현재 iframe을 유지하는 `await reconnect()`를 사용한다. 준비 전이나 인증 전환 중의 탐색을 나중에 자동 재생하지 않는다.

설정별 `configurationId`와 실제 조회 완료 ACK, 최초 준비 실패·회원 연결 실패의 재시도 계약은 [CUSTOMER-HISTORY-SDK.md](CUSTOMER-HISTORY-SDK.md)에 있다. 구 SDK나 구 위젯 한쪽만 설치하면 준비 확인이 실패할 수 있다. 기존 `/sendb-chat.js` 설치는 ID 없는 기존 계약을 유지한다.

## 자체 고객 화면 API

설치 출처와 서버가 확인한 회원 JWT를 사용한다. 아래 API에 서비스 키를 브라우저에서 전달하지 않는다. 기존 `{success,data}` 응답 형식을 유지한다.

| 호출 | 계약 |
|---|---|
| `GET /api/messenger/{key}/conversations?before=...` | `rows,hasMore,nextBefore,unreadCount`. 행의 `historyOnly,readOnly`로 과거 상담을 구분. 최대50건, 정렬 시각/ID 내림차순. 다음 요청은 응답의 불투명 `nextBefore`를 그대로 사용 |
| `POST /api/messenger/{key}/conversations` | `{clientId,body,attachmentIds?}` → `{conversationId,id,clientId}`. 첫 공개 메시지와 새 문의를 함께 저장 |
| `GET /api/messenger/{key}?conversationId=...&before=...` | 해당 문의의 공개 메시지 최대100개·프로필·`conversationId,historyOnly,readOnly,readRevision,hasOlder,status,aiState`. 메시지 이전 커서는 정수 ID이며 과거 기록은 원래 시각/ID 순서로 조회 |
| `POST /api/messenger/{key}?conversationId=...` | 선택한 쓰기 가능한 현재 웹 문의에 기존 메시지 입력 계약으로 전송. 과거 상담은 거절 |
| `POST /api/messenger/{key}/conversations/{id}/read` | `{lastMessageId,readRevision?}` → `{lastMessageId,readRevision,unread}`. 현재 웹 문의는 상세 응답의 세대를 전달. 과거 공개 메시지는 읽음 행을 쓰지 않고 세대/미확인 수 0을 반환 |
| `POST /api/messenger/{key}/attachments?newConversation=1` | 아직 생성하지 않은 새 문의의 고객 첨부 준비. 첫 메시지에서 결합 |
| `POST /api/messenger/{key}/attachments?conversationId=...` | 선택한 현재 웹 문의의 첨부 준비/취소. 과거 상담에 새 첨부 불가 |
| `GET /api/messenger/{key}/attachments/{id}?conversationId=...` | 선택한 문의의 현재 유효한 공개 첨부 다운로드. 과거 기록도 본인 관계·공개 승인 재확인 |

`conversationId`를 생략한 기존 조회/전송은 서버의 기본 현재 웹 문의를 사용한다. 자체 화면은 첫 조회로 확인한 ID를 고정해야 다른 기기에서 새 문의를 시작해도 작성 중인 문장의 대상이 바뀌지 않는다. 같은 생성 요청 재시도는 같은 `clientId`를 사용한다. 이미 성공한 이전 생성 요청을 다시 보내도 나중에 만든 문의의 기본 설정을 되돌리지 않는다.

목록 커서는 고정 ISO 시각+UUID를 포함한 문자열이다. 경계 문의에 새 답변이 도착해도 조회 시점마다 경계 시각을 다시 읽지 않는다. 예전 UUID 입력도 호환하지만 새 화면은 `nextBefore`를 직접 해석하지 않는다. 이는 데이터 전체 스냅샷을 고정하는 계약은 아니다.

읽음 위치는 뒤로 가지 않는다. 비회원 병합으로 낮은 ID의 답변이 이동하면 별도 미확인 ID와 `readRevision`을 보관한다. 병합 전의 늦은 요청은 새 답변을 읽음 처리하지 못한다. 새 상세 조회의 세대가 바뀌면 같은 최종 ID라도 다시 읽음 요청을 보내야 한다. 목록/새 문의/숨긴 창에서는 읽음 요청을 보내지 않는다.

## 고객용 TypeScript SDK

`sdk/messenger.ts`는 서비스 서버 SDK와 별도다. `getToken`은 사이트 서버가 검증해 발급한 현재 고객 JWT를 반환한다.

```ts
import { SendbMessengerClient } from "./sdk/messenger";

const messenger = new SendbMessengerClient({
    apiBase: "https://your-sendb-server.example",
    channelKey,
    getToken: () => currentMemberIdentityToken,
});
const page = await messenger.conversations();
const inquiry = await messenger.conversation(page.rows[0].id);
// 해당 문의를 실제로 표시하고 확인했을 때만 호출한다.
const lastId = inquiry.messages.at(-1)?.id;
if (inquiry.conversationId && lastId && !inquiry.historyOnly && !inquiry.readOnly)
    await messenger.markRead(inquiry.conversationId, lastId, inquiry.readRevision);

const input = { clientId: crypto.randomUUID(), body: "새 주제로 문의합니다." };
const created = await messenger.createConversation(input);
// 결과가 불확실한 재시도에서는 input을 보존한다.
await messenger.sendMessage(created.conversationId, {
    clientId: crypto.randomUUID(), body: "추가 질문입니다.",
});
```

## 마이그레이션·검증·한계

아래는 기존 0112 문의 기능의 당시 검증 기록이다. 새 고객 과거 상담 정책의 검증 결과로 바꾸지 않으며, 후속 기능의 진행 상태는 [CUSTOMER-IMPORT-HISTORY.md](CUSTOMER-IMPORT-HISTORY.md)에 구분한다.

0112를 앱보다 먼저 적용하는 변경으로 검토한다. 기존 기본 문의에는 `is_current=true`를 유지하고 복수 문의·생성 요청 키·읽음 테이블/병합 세대를 추가한다. 과거 상담의 이전 지문은 새 운영용 컬럼을 제외해 이전에 완료한 가져오기 기록을 무효화하지 않는다. 실제 DB에는 적용하지 않았다.

- 고객 API PGlite 기능26+기본 플랫폼11·별도 PostgreSQL 기능26+기본 플랫폼11, 회원 연결12: 생성/멱등/롤백·파일 소유권·사업/고객 분리·공개 메시지·늦은 읽음·페이지 경계·실제 다중 연결의 생성/회원 연결/읽음 잠금 순서.
- 기존 0111 데이터에서 실제 0112 SQL로 업그레이드12: 15개 테이블의 기존 행/컬럼과 공개/메모 첨부10개의 바이트·해시·관계 보존.
- 공통 UI/API/첨부 그룹 단위14, SDK VM23, 실제 디하 loader/controller/API와 공통 SDK 교차 VM6. 디하 별도 개발 브랜치에서는 전체75·타입·격리30페이지 빌드도 통과.
- 통합 전체 단위1,119·타입·lint·격리 Next 빌드, 파일/활동/영업/플랫폼 회귀·기존 이전15·첨부 이전23을 검수했다. 작성 중인 직원이 있어도 고객의 상담원 요청/첨부가 취소되지 않는 별도 회귀4를 포함한다.
- Chrome15개 흐름: 두 사업 문의 생성/전환, 문장 보존, 전송 전 빈 문의 없음, 전체 미확인/선택 읽음, 회원 변경, 비회원/명시적 회원 연결, 실제 API503/준비 타임아웃 후 복구와 초기10초 조회 지연/문의 없는 회원의 초안 보존을 확인했다. 원본 화면·로그·소스 해시는 `evidence-manifest.json`의 `customerHistoryQa`에 기록한다.
- 가상 문의10,000개·메시지100,170개·2사업20회원의 전체 목록/검색/읽음 정확성과 로컬 지연은 PGlite/독립 PostgreSQL에서 추가 검수했다. [방법·수치·한계](CUSTOMER-HISTORY-SCALE.md).

고객 위젯 파일 선택→문의 전환/초안 보존→multipart 전송→미리보기/다운로드는 별도 격리 Chrome의 공식 FileChooser API로 14개 시나리오를 추가 통과했다. 소스19개 전후/현재 일치, 다운로드4개의 원본 SHA256 일치와 두 화면 크기를 확인했다. 네이티브 Windows 파일 탐색기나 직원 첨부 UI 검수는 포함하지 않는다. [범위·한계](FILES-AUDIT.md), `evidence-manifest.json`의 `filePickerQa.groups.customerWidget`을 따른다. 실제 Firebase·사이트 도메인·고객 데이터·기기 간 실제 세션·운영 동시 부하와 직원 업무 검수는 이 결과로 완료 선언하지 않는다. 전체 전환 상태는 [REPLACEMENT.md](REPLACEMENT.md)를 따른다.
