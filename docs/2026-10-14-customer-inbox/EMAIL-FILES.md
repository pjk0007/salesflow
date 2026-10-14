# 이메일 첨부 · 수신/답장과 복구

2026-10-15. 이메일 상담의 이름만 보이던 첨부를 실제 비공개 파일 저장·다운로드·답장 MIME 발송으로 연결했다. 전용 메일함의 기본 설치 계약은 [EMAIL.md](EMAIL.md)를 따른다. 실제 계정/고객 메일은 사용하지 않고 격리 PGlite·가상 Gmail HTTP·Chrome에서 확인했다.

## 사용하는 흐름

- 수신 메일은 본문을 먼저 보여주고 파일별로 **가져오기 대기 / 완료 / 실패 / 파일 제한**을 표시한다. 파일 다운로드 실패로 문의 본문을 숨기지 않는다. 완료된 파일은 기존 보호 다운로드·이미지 미리보기를 사용한다.
- 실패 파일에서 **가져오기 재요청**을 누르면 대기로 바뀐다. 연결 서버가 원본 파일을 다시 가져와 저장하면 다운로드 버튼이 나타난다. 완료 후 늦게 도착한 실패 결과는 완료를 덮어쓰지 않는다. 서버가 동작하지 않으면 대기 상태로 남는다.
- **고객응대**에서 파일을 선택하고 **메일 발송 예약**을 누르면 답장·첨부 연결·발송 대기열을 함께 저장한다. 최대 5개, 합계 20MiB다. 합계 초과는 업로드 전에 안내하고 서버 API도 같은 제한을 검사한다. 내부 메모 첨부는 고객에게 보내지 않는다.
- 연결 서버가 임대한 답장의 첨부를 모두 내려받아 크기·SHA256을 확인한 뒤 발송을 시작한다. 누락·변경·다운로드 오류는 **발송 전 실패**로 남기고 상담원이 재시도한다. 일부 파일을 빼고 성공으로 처리하지 않는다.

수신은 최대 50개 파일의 원본 정보를 보존하고 파일당 20MiB를 지원한다. 비어 있거나 한도보다 큰 파일은 원본 메일함에서 확인하도록 표시한다. 기존 사업별 저장 한도(기본 2GiB)·파일 이름 정리·내용 기반 형식 판별·비공개 blob 저장을 재사용한다. 기존 서비스 자료 이전(R11)의 과거 첨부 바이트를 가져오는 기능과는 별도다.

최초 `message.created`의 이메일 메시지는 `sourceAttachmentCount`로 원본 파일 수를 전달한다. 이때 `attachments`는 저장 완료된 파일 목록이므로 아직 비어 있을 수 있다. CRM 활동의 첨부 수 역시 원본 수를 기록하고, 각 파일 저장 완료는 `conversation.updated`의 `action=email.attachment.received`와 별도 고객 활동으로 전달한다. 기존 웹 상담의 이벤트 필드는 변경하지 않는다.

## API/SDK

| API | 계약 |
|---|---|
| `GET /api/v1/email/receipts/:id/files` | 수신 번호의 파일 ID·순서·원본 번호·상태. 사업 read 권한 |
| `GET /api/v1/email/mailboxes/:id/files?before=…` | 대기/실패 파일 50개씩. 원본 메시지 ID와 UUID 커서·hasMore 제공 |
| `POST /api/v1/email/files/:id` multipart | `file`, `clientId=:id`, `kind=customer`. read+create 권한. 원본 이름/크기와 수신 상담에 연결 |
| 같은 URL의 JSON POST | `{"action":"failed","errorCode":"download_failed"}`. read+update 권한. download_failed/source_missing/size_mismatch만 저장하며 오류 원문/인증값을 넣지 않음 |
| `POST /api/email-files/:id` | 직원 세션의 `{"action":"retry"}`. 같은 조직의 실패 첨부만 대기로 전환 |
| `GET /api/v1/email/deliveries/:id/files/:fileId` | read+update와 `X-Sendb-Email-Lease` 증명. 활성/같은 설정 버전·만료 전 leased 상태의 해당 공개 답장 첨부만 다운로드 |

서버 SDK: `emailReceiptFiles`, `pendingEmailFiles`, `uploadEmailFile`, `failEmailFile`, `downloadEmailDeliveryFile`. 기존 `uploadAttachment`, `reply(..., attachmentIds)`, `downloadAttachment`는 계속 사용한다. 발송 임대 응답의 `attachments`에 ID·이름·형식·크기·SHA256을 제공한다.

`prepare_failed` 결과는 leased 상태의 유효한 작업자만 기록한다. 오류는 attachment_download/attachment_changed/mime_invalid/mailbox_mismatch 중 하나이며 발송 시작 횟수는 늘리지 않는다. 성공/실패/확인 필요와 마찬가지로 같은 결과 등록의 재시도는 중복 저장하지 않는다. 설정 중지 뒤의 이전 작업자 다운로드/발송 시작과 다른 사업·내부 메모 파일은 거부한다.

## Gmail 어댑터와 재시도

[공식 MessagePartBody 계약](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages.attachments)에 따라 `data`가 있으면 inline base64url, `attachmentId`가 있으면 [attachments.get](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages.attachments/get)으로 별도 다운로드한다. 원본 크기와 실제 바이트를 대조한다. 알려진 수신 번호의 파일은 메일이 보관 처리된 뒤에도 메시지 ID로 다시 조회한다. Gmail 읽음·라벨·삭제는 변경하지 않는다.

별도 다운로드로 주어지는 텍스트 본문은 파트당 최대 400,000바이트를 받아 기존 charset 변환을 적용하며 최종 본문 100,000자 제한을 유지한다. 이름 없는 바이너리·attachment disposition·첨부된 메일은 본문에 섞지 않는다. 전체 JSON 응답도 크기를 제한하며 한도를 넘는 원본은 오류로 남긴다.

답장은 multipart/mixed·base64 파일 파트·Unicode 파일명(RFC2231 연속 파라미터)으로 만든다. 고정 Message-ID와 원래 스레드/제목·참조를 보존한다. 발송 POST는 한 번만 하고 불명확한 결과는 자동 재발송하지 않는다. 읽기 GET의 401은 해당 인증의 접근 토큰만 버리고 한 번 갱신해 다시 읽는다. 발송 POST의 401은 자동 반복하지 않고 확실한 실패로 처리한다.

```sh
# 새 메일 본문과 첨부 수신
node --import tsx examples/email-relay/run.ts receive
# 알려진 미완료 파일만 재시도 (보관된 메일 포함)
node --import tsx examples/email-relay/run.ts files
# 대기 답장 한 건과 첨부 발송
node --import tsx examples/email-relay/run.ts send
```

files 모드는 대기/실패를 50개씩 한 번 순회한다. 실제 계정/서버 설정은 설치하지 않았다. 외부 relay를 쓰면 receive/files/send를 명시 실행하며, 샌드비 내 Google 연결·자동 워커 설치는 [GOOGLE-CONNECTION.md](GOOGLE-CONNECTION.md)를 따른다. 파일 소스 다운로드·DB 저장은 멱등이므로 둘 이상의 작업자가 재조회해도 파일/활동을 중복 생성하지 않는다. Gmail history와 영속 수신 체크포인트는 위 가이드로 확장했다. push·실제 부하 검증은 후속이다.

## 검증과 남은 일

새 체크아웃에서는 프로젝트 루트에서 다음으로 같은 격리 SQL/API 검증을 재현할 수 있다. PGlite 0.5.8은 이번 검증에 사용한 고정 버전이며 `.testenv`는 Git에서 제외된다. 검사 스크립트가 DB를 PGlite로 바꾸고 외부 PostgreSQL 주소를 접속 불가능한 로컬 주소로 강제하므로 개발/운영 DB 설정을 넣지 않는다.

```sh
npm ci
npm install --prefix .testenv/test-runtime --no-save @electric-sql/pglite@0.5.8
node --import tsx scripts/check-inbox-email-files.cjs
npm test
```

- `scripts/check-inbox-email-files.cjs` 11개: 원본 상태/긴 ID·중복, 실제 바이트/해시/비공개 다운로드·다른 사업/웹 회원 차단, 실패 재요청과 늦은 실패, 크기/저장 트랜잭션 롤백, 답장 MIME와 내부 메모 첨부 격리, 발송 전 준비 실패·재시도, 외부/inline/별도 본문과 보관 메일 재시도, 연결 중지, 실제 20MiB 초과·저장 한도, 기존 메타데이터 마이그레이션, 100개 커서/사업 격리.
- 기존 이메일 14개와 플랫폼 11개를 함께 실행한다. Gmail MIME·읽기 401 단위 9개, 전체 단위 1,067개, 기존 파일18·상담22·회원연결12·자료이전15·자동화15, 타입/lint/격리 빌드 확인.
- 두 사업 Chrome 화면에서 파일 상태·실패 재요청→다운로드 가능한 상태·보호 미리보기를 확인했다. 디하 실제 다운로드 파일은 68바이트 원본과 SHA256이 일치했다. 브라우저 download 이벤트 관찰은 시간 초과했으나 실제 저장 파일의 시각/바이트/해시로 완료를 확인했다.
- Chrome 파일 선택기는 확장 프로그램의 **Allow access to file URLs** 권한이 꺼져 있어 선택부터 전송까지 미확인이다. API multipart 업로드→답장 MIME/발송과 보호 다운로드는 검증했다. 권한 변경은 수행하지 않았다.

실제 Google 계정/OAuth 설치·대용량 동시 부하·모니터링·공급자 배달/반송 확인·발신 별칭·모든 원본 MIME 보존·다른 채널·R11 과거 파일 이전·실제 사이트 전환은 남아 있다. 전체 대체 완료나 운영 배포를 의미하지 않는다.
