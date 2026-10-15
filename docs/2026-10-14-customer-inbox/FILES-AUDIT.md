# 상담 파일과 변경 이력

## 사용 흐름

고객 위젯과 상담원 입력창의 **파일 첨부**에서 파일을 선택한다. 메시지 없이 파일만 보내거나 본문과 함께 보낼 수 있다. 한 메시지에 최대 5개, 파일 하나는 20MiB 이하다. 파일은 전송을 누를 때 업로드하며, 선택만 하고 떠나면 빈 상담이나 저장 파일을 만들지 않는다. 업로드 실패 시 선택 파일과 본문을 유지한다. 업로드 완료 뒤 메시지 응답을 잃어도 같은 번호로 재전송하면 중복 메시지·첨부를 만들지 않는다.

선택 파일은 현재 창에서만 유지한다. 새로고침하거나 다른 회원으로 전환하면 다시 선택해야 한다. 상담원 답변과 내부 메모의 파일 초안은 따로 유지한다. 업로드 후 전송하지 않은 파일은 삭제 버튼으로 취소할 수 있다. 24시간 지난 미전송 첨부는 전송할 수 없고, 해당 사업의 다음 업로드에서 원본을 회수한다. 별도 주기 청소 작업과 보존 정책은 R14 후속이다.

대화의 파일 카드에서 다운로드하고 PNG/JPEG/GIF/WebP는 미리보기를 펼친다. 파일 형식은 서버가 원본 서명을 확인한다. HTML/SVG 등은 일반 다운로드 파일로 취급한다. 내부 메모 첨부는 고객 메시지 목록에 없고 고객의 직접 다운로드도 차단한다. 첨부 원본은 공개 이미지 URL로 제공하지 않는다.

상담 상세 아래 **변경 이력**에서 담당자·상태·중요 표시·태그·CRM 연결의 실제 변경 전후, 작성자, 시각을 확인한다. 고객의 재문의로 다시 열리는 변경도 기록한다. 상담창 설정에도 이름·인사말·색상·도메인·사용 상태 이력이 있다. 마이그레이션 이전의 과거 변경은 추정해 채우지 않는다.

태그나 CRM 연결을 작성하는 동안 다른 사람이 정보를 바꾸면 오래된 저장을 거절하고 작성 중인 내용을 보존한다. **최신 태그·연결 정보 불러오기**로 현재 정보를 확인한 뒤 다시 편집한다. 즉시 실행하는 담당자·상태 버튼도 조회한 버전으로 변경한다. 개인 멘션·앱 알림은 [MENTIONS.md](MENTIONS.md), 접속·응대 상태는 [PRESENCE.md](PRESENCE.md)의 추가 구현을 따른다. 외부 알림·교대표는 후속이다.

## API 계약

| 용도 | 직원 UI | 서비스 서버 | 고객 위젯/직접 API |
|---|---|---|---|
| 업로드·초안 취소 | POST `/api/inbox/conversations/{id}/attachments` | POST `/api/v1/inbox/conversations/{id}/attachments` | POST `/api/messenger/{key}/attachments` |
| 바이너리 다운로드 | GET `/api/inbox/attachments/{id}` | GET `/api/v1/inbox/attachments/{id}` | GET `/api/messenger/{key}/attachments/{id}` |
| 상담 변경 이력 | GET `/api/inbox/conversations/{id}/audit` | GET `/api/v1/inbox/conversations/{id}/audit` | 제공하지 않음 |
| 상담창 설정 이력 | GET `/api/inbox/channels/{id}/audit` | 직원 화면에서 조회 | 제공하지 않음 |

업로드는 multipart의 `file` 1개, UUID `clientId`, `kind`(`customer`/`reply`/`note`)를 보낸다. 고객은 `customer`만 가능하다. 서버는 본문 스트림을 제한하고 Content-Length만 신뢰하지 않는다. JSON 응답은 `{success:true,data:{id,fileName,contentType,size}}`다. 회원 JWT 갱신 후에도 소유권을 유지하며 아직 대화를 시작하지 않은 회원도 첨부를 준비할 수 있다.

메시지 전송 본문에는 기존 `clientId`, `body`, 상담원 `kind`와 `attachmentIds` UUID 배열을 넣는다. 본문과 첨부 중 하나는 필요하다. 메시지와 첨부 연결은 같은 트랜잭션이다. 메시지 목록에도 `attachments` 배열이 추가된다. 저장 경로·소유권 해시·파일 해시는 DTO에 없다. 취소는 같은 업로드 URL에 `{action:"cancel",id}`를 JSON으로 보낸다. 이미 전송한 파일은 초안 취소로 지울 수 없다.

업로드는 사업 API create, 다운로드·감사는 read 권한을 확인한다. 고객은 자신의 대화에 속한 공개 파일만 읽는다. 성공 다운로드는 JSON이 아닌 바이트이며 UTF-8 파일명과 attachment Content-Disposition을 사용한다. 실패는 기존 JSON 오류 계약이다. 고객 경로는 등록 출처 CORS를 적용하며 토큰을 URL에 넣지 않는다.

상담 DTO에 `version`이 추가된다. PATCH에 조회한 version을 넣으면 충돌 시 409다. 기존 연동 호환 때문에 API 생략은 허용하나 동시 편집 보호를 받으려면 반드시 전달한다. 감사 조회는 `{rows,hasMore}`, 최대 100건이며 `?before={마지막 감사 UUID}`로 이전 내용을 읽는다. 다른 사업·상담 커서는 사용할 수 없다.

```ts
const file = await client.uploadAttachment(conversationId, new Blob([bytes]), "제안서.pdf", fileClientId, "reply");
await client.reply(conversationId, "자료를 보내드립니다.", messageClientId, "reply", [file.id]);
const downloaded = await client.downloadAttachment(file.id); // ArrayBuffer
const history = await client.conversationAudit(conversationId);
```

## 저장·마이그레이션·검증 한계

`0092_inbox_files_audit.sql`은 상담 version과 첨부 메타데이터·별도 bytea 원본·감사 테이블을 추가한다. 기존 공개 R2 이미지 저장 동작을 사용하지 않는다. 상담 파일은 인증 API로 읽는 PostgreSQL 원본으로 시작한다. 사업별 기본 한도 2GiB, `INBOX_ATTACHMENT_QUOTA_MB`로 20~102400MiB 범위에서 조정하며 미전송 파일은 소유자당 20개다. 업로드 시 사업 상담창 행을 잠가 용량·초안 수를 검사한다. 큰 파일은 DB·백업 용량을 늘리므로 실제 전환 전 예상 사용량과 부하를 확인하고 필요하면 비공개 객체 저장 어댑터로 이전해야 한다. 대규모 첨부 성능 검수는 아직 남아 있다.

`node --import tsx scripts/check-inbox-files.cjs`: 플랫폼 11·영업 13·공통 활동 7개에 파일/감사 18개를 추가한다. 원본 bytea/SHA256, 파일만 전송, SDK·공개 multipart, 다운로드 바이트, 재시도, 내부 메모 격리, 사업/조직/계정 범위, JWT 갱신, 익명, 취소/만료 회수, 용량/초안 제한, 원자적 거절, 버전 충돌/무변경, 재문의 감사와 100건 커서를 격리 PGlite로 확인했다. 실제 R2·운영 DB·고객 발송은 없다.

브라우저에서 로컬 API로 준비한 가상 파일의 수신·이미지 미리보기, 고객의 내부 파일 비노출, 다운로드 원본 SHA256 일치, 담당 변경 이력, 두 화면 간 오래된 태그 저장 거절·초안 보존·최신 정보 복원을 확인했다.

2026-10-15 추가 검수: 별도 격리 Chrome에서 **실제 고객 ChatWidget·첨부 UI와 실제 messenger routes·메모리 PGlite**로 14개 시나리오를 통과했다. 공식 FileChooser API로 PDF/PNG 선택 취소·삭제/재선택, 기존/새 문의 사이 문장·File 객체 보존, 전송 전 빈 문의/업로드 없음, 실제 multipart 전송과 메시지 연결, PNG 미리보기, 다운로드4개의 원본 바이트/SHA256 일치, 480×820/390×844 표시를 확인했다. 관련 소스19개는 검수 전후와 현재가 일치하며 JS 오류·외부 요청은 없었다. 본인 브라우저/서버/PGlite 종료도 확인했다. 재현 스크립트와 결과의 경로·해시는 `evidence-manifest.json`의 `filePickerQa.groups.customerWidget`에 기록한다.

사용자 Chrome 확장의 파일 URL 설정은 변경하지 않았다. 이 결과는 네이티브 Windows 파일 탐색기의 수동 조작이나 직원 입력창까지 검수한 증거로 확대하지 않는다. 자료 이전 관리자의 선택기는 [IMPORT-FILES.md](IMPORT-FILES.md)의 별도14개 검수 범위를 따른다. 고객 위젯의 실제 페이지 첨부 요청은 200이며 추가 backend401은 페이지 trace에 없는 관측 도구 재조회로 추정한다. 원래 요청 헤더가 저장되지 않아 그 원인을 확정하지 않는다.

직원 선택기는 별도 Chrome에서 **실제 ConversationPane·API·메모리 PGlite**로 14개 시나리오를 검수했다. 공개 답변/내부 메모 각각 PDF·PNG 선택 취소·제거/재선택, 모드 사이 문장·File 초안 분리, 실제 multipart 전송·이미지 미리보기, 직원 다운로드4개/고객 공개 다운로드2개의 원본 해시 일치, 고객 응답에서 메모 본문/파일 ID 제외와 직접 메모/타 고객 다운로드404·비로그인 업로드/다운로드401을 확인했다. 소스159개 전후/현재 일치, JS 오류·외부 요청0, 격리 서버/브라우저 종료를 확인했다. 결과·해시는 `filePickerQa.staff`에 있다. 전체 InboxPage와 네이티브 Explorer는 실행하지 않았다.

2026-10-15 후속 변경: 직원의 실제 InboxPage가 문의별 답변/메모의 문장·File·업로드 결과와 전송 요청 ID를 소유해 입력창 remount 후에도 이어서 사용한다. 저장 후 응답 유실 시 직접 재시도는 같은 ID를 사용하고 자동 재전송하지 않는다. 조직·계정 전환 시작/사업 변경·권한 회수·상담함 이탈·새로고침은 파일을 비우며 현재 상담함 20개/100MiB 한도를 적용한다. 기존 localStorage 문장 정책은 유지한다. 실제 부모 UI/API/메모리 PGlite16개와 고객 공용 훅 회귀17개를 독립 검수했고 통합 소스225개/19개의 일치를 확인했다. 이전 14개 검수는 당시 소스의 증거로 보존하며 현재 코드의 근거는 `staffDraftSessionQa`로 구분한다. [사용 범위·증거·한계](STAFF-DRAFTS.md). 전체 WorkspaceLayout·실제 조직 생성/AI·메일 조합·네이티브 Explorer·실제 팀의 전체 업무·대용량/동시 첨부·보존 정책 검수는 남는다.


개인 내부 메모 멘션·앱 알림·나를 멘션한 상담·오래된 원문 조회와 회원 연결 보존은 0105에 추가했다. 고객 읽음/메일 발송과 구분한다. [MENTIONS.md](MENTIONS.md)에 UX·API/SDK·권한·SQL/API19·Chrome 검수와 남은 팀 협업 범위를 기록했다.
