# 과거 상담 첨부파일 원본 이전

2026-10-15 기본 구현, 2026-10-16 실제 원본/복사본 검수와 0114 비공개 보관 저장소 추가. 원격 운영·개발 DB에 실제 원본을 적용한 상태는 아니다. [기존 자료 이전](IMPORTS.md)의 상담 파일 단계이며 실제 사이트 전환 완료를 뜻하지 않는다.

D1 후속으로 [채널톡 보관 첨부 일괄 보충](FILE-TRANSFER.md)을 추가했다. 원본 manifest/바이트와 기존 파일 목록으로 검토 계획을 만들고, 승인된 SHA에 대해서만 아래 단건 API를 순차 호출한다. 보호 다운로드로 실제 대상 바이트를 확인하며 서버·DB·SDK 계약과 0111 마이그레이션은 변경하지 않는다.

## 관리자 사용 흐름

1. 기존 자료 이전에서 원본 서비스·계정·사업을 확인하고 상담 정보 가져오기를 승인한다. 메시지 저장 트랜잭션에서 파일 목록을 등록하며 파일 다운로드는 시작하지 않는다.
2. **과거 상담 첨부파일 원본**에서 전체·완료·대기·확인 필요를 확인한다. 이전 버전으로 저장한 작업은 **기존 이전 작업의 첨부 목록 준비**를 누른다. 원본이 이미 갱신된 행은 제외하므로 오래된 작업으로 최신 파일을 되돌리지 않는다.
3. **현재 페이지의 대기 파일 가져오기** 또는 파일별 **파일 가져오기/다시 시도**를 누른다. 100개씩 페이지를 나누며 파일별로 한 번씩 처리한다. 실패한 파일의 자동 무한 재시도는 하지 않는다.
4. 401/403/404/410 응답이면 **원본 주소 갱신**에서 새 HTTPS 다운로드 주소를 저장한 뒤 다시 가져온다. 원본 API 키를 입력하는 곳이 아니다. 보관 파일이 있으면 **보관 파일로 보충**에서 하나를 선택한다. 원본과 같은 이름·알려진 바이트 크기·SHA-256을 확인한다. 잘못된 원본 메타데이터는 수정한 자료를 새 미리보기로 검토해야 한다.
5. **현재 파일 후 중지**는 추가 다운로드를 중지하고 현재 요청과 완료 파일을 보존한다. 화면을 닫은 뒤 최근 작업에서 다시 열어 이어서 처리할 수 있다. 서버가 중단되어 가져오는 상태가 남으면 60초 임대 만료 후 재시도할 수 있다.
6. 결과 표의 **가져온 과거 상담 열기**에서 파일을 다운로드하고 PNG/JPEG/GIF/WebP는 미리보기로 확인한다. 내부 메모 파일은 고객에게 노출하지 않는다. 과거 상담의 답변·새 첨부 제한은 유지한다.

고객 공개는 파일 보충과 별도다. [관리자가 본인 공개를 승인한 채널톡 기록](CUSTOMER-IMPORT-HISTORY.md)의 현재 유효한 공개 첨부만 확인된 고객 본인이 읽을 수 있다. 내부 메모·메모 파일과 미승인 기록은 직원 전용이며, 다운로드에서도 현재 원본 관계와 승인을 검사한다. 아래 기존 파일 이전/선택기 증거는 당시 소스의 결과로 보존한다.

화면 업로드·원본 URL 가져오기는 파일당 0바이트 초과~20MiB, 사업별 DB 파일 저장 한도(기본 2GiB)를 적용한다. MIME은 실제 바이트로 판별한다. 다른 형식도 원본 바이트를 보관하지만 자동 실행/이미지 미리보기는 제공하지 않는다. 20MiB를 넘는 이전 첨부는 화면에 관리자의 비공개 저장소 이전이 필요한 것으로 표시하고 일반 가져오기에서 제외한다. 빈 파일·1GiB 초과·잘못된 크기/해시는 이전 불가로 남기며 조용히 누락하지 않는다. 원본에 크기/해시가 없으면 해당 항목의 원본 대조를 증명할 수 없으므로 수동 확인이 필요하다.

## 비공개 객체 저장소로 원본 이전 (0114)

실제 디하 첨부 2,211개는 약 10.36GB이며 62개가 20MiB를 넘는다. 확인한 개발 DB 디스크 설정은 1GiB이므로 파일 전체를 DB 바이트 컬럼에 넣는 방식으로 운영 전환하지 않는다. 0114는 기존 첨부에 nullable `storage_object_key` 참조와 저장 방식별 크기 제약만 추가한다. 기존 자료·메일 첨부·일반 20MiB 업로드 계약을 유지한다.

관리자 서버 작업 `transferArchivedImportFile`은 파일당 1GiB까지 비공개 S3/R2 저장소에 스트리밍한다. 원본 크기/SHA-256을 검증하고, 저장소에서 다시 읽어 검증한 뒤에만 DB 첨부를 완료로 연결한다. 원문·시각·메모 구분·사업 권한·작업 버전과 임대를 확인한다. 저장소 다운로드 URL이나 키를 고객 응답에 넣지 않으며, 상담 다운로드 API에서 기존 직원/확인된 본인 권한을 검사한 뒤 서버가 스트리밍한다. 내부 메모 파일은 고객에게 제공하지 않는다. 무결성 실패는 다운로드를 중단한다.

운영에는 기존 공개 파일 버킷과 분리한 **비공개 버킷**을 사용한다. R2의 `r2.dev` 공개 주소와 공개 사용자 도메인을 활성화하지 않는다. 버킷 범위가 제한된 읽기·쓰기 자격증명을 비공개 서버 환경변수에 보관한다.

설정 근거는 Cloudflare의 [비공개/공개 버킷](https://developers.cloudflare.com/r2/buckets/public-buckets/)과 [버킷별 S3 자격증명](https://developers.cloudflare.com/r2/get-started/s3/) 문서를 따른다.

- `INBOX_ARCHIVE_S3_ENDPOINT`: HTTPS S3 호환 API 주소
- `INBOX_ARCHIVE_S3_BUCKET`: 비공개 전용 버킷
- `INBOX_ARCHIVE_S3_ACCESS_KEY_ID` / `INBOX_ARCHIVE_S3_SECRET_ACCESS_KEY`: 서버 전용 자격증명
- `INBOX_ARCHIVE_S3_REGION`: 기본 `auto`
- `INBOX_ARCHIVE_QUOTA_MB`: 사업별 객체 저장소 첨부 한도, 기본 102400MiB(100GiB)

DB 파일 한도와 객체 파일 한도는 분리한다. 파일 이전 도구는 새 객체 이름을 사용하며 덮어쓰기·자동 삭제를 하지 않는다. 업로드 뒤 DB 충돌/쿼터 초과가 나면 연결되지 않은 객체가 남을 수 있다. 원본·재시도 증거를 보존하고, 운영자의 별도 정리 정책 없이 제거하지 않는다. 전체 파일 저장소와 DB의 백업·복구는 함께 인수한다.

원격 DB에 직접 접속하지 않고도 관리자 SDK로 운영 자료를 연결할 수 있다. 먼저 기존 가져오기로 메시지·첨부 목록을 적용한 뒤 `planArchiveImportFile(jobId,id,version,{size,sha256})`에서 해당 조직·사업·파일 작업·버전·해시에 고정된 객체 이름을 받는다. 관리 도구가 자기 비공개 자격증명으로 그 이름에 원본을 업로드한 다음 `connectArchiveImportFile`을 호출한다. 서버는 자신이 계산한 같은 이름에서 파일을 읽고 원본 크기/해시를 검증한 뒤 연결한다. HTTP 입력으로 객체 이름·URL·자격증명을 받지 않는다. 준비는 DB/저장소를 수정하지 않으며, 이미 완료한 연결 요청은 같은 첨부를 반환한다. 읽기 전용 키·다른 사업 키는 사용할 수 없다.

두 SDK 메서드는 기존 `POST /api/v1/imports/:id/files`의 `archive_plan`·`archive_attach` 작업을 사용한다. 업무용 화면의 일반 업로드 제한을 확대하거나 저장소 자격증명을 브라우저에 전달하지 않는다. 확인된 회원의 공개 과거 첨부 다운로드, 같은 상담의 내부 메모 차단, 다른 회원·사업 차단과 SDK 준비/연결/다운로드를 네이티브 API 검수에 포함한다.

가상 네이티브 PostgreSQL + loopback S3 호환 서버로 20MiB 초과 스트리밍 PUT/GET, 원본/저장 바이트 변조, 크기 불일치, 재시도, 다른 조직·사업 차단, 메모 공개 차단, 한도와 일반 업로드 제한을 검수한다. `scripts/check-inbox-private-archive.cjs`를 사용한다. Node24/tsx의 시험 서버 의존성 호환을 위해 `node --no-experimental-require-module --require tsx/cjs scripts/check-inbox-private-archive.cjs`로 실행한다. 시험 서버는 `.testenv/archive-storage-qa`의 `s3rver@3.7.1`이며 운영 의존성이 아니다. 이 시험은 실제 R2 버킷의 공개 차단 설정을 증명하지 않는다. 운영 버킷/자격증명 연결과 공개 접근 차단 확인 전에는 운영 파일 이전을 시작하지 않는다.

실제 원본 2,211개 전체(10,362,083,075바이트), 대용량 62개, 최대 769,703,730바이트 파일의 로컬 객체 이전·상담 권한 다운로드 SHA-256 대조를 통과했다. 이전된 DB를 별도 새 PostgreSQL에 복원해 159개 테이블 건수와 7개 중요 테이블 내용 지문이 일치함을 확인했다. 파일 저장소도 종료 후 다시 열어 최대 파일의 크기·해시를 대조했다. 이 검수는 로컬 복사본과 loopback 저장소이며 실제 R2/운영 반영 완료 증거는 아니다.

### 비공개 보관 파일 실행 도구

`scripts/migrate-private-archive-files.cjs`는 위 SDK 경로를 사용하는 운영자 도구다. CRM/메시지 가져오기와 파일 목록 준비를 먼저 마친 후 사용한다. 기존 D1 multipart 도구와 별도이며, 파일 전체를 Buffer에 담지 않고 1GiB까지 스트리밍한다. `.env`·DB URL·공급자 API 키를 읽거나 애플리케이션 워커를 시작하지 않는다.

입력은 원본 관계를 보존한 canonical 채널톡 JSON과 검증한 바이트 보관 폴더다. 보관 manifest는 `version:1`, `scope:"all-customer-attachment-originals"`, `messageSourceComplete:true`이며 파일별 상담/메시지 ID·sourceKey·원본 정보 지문·이름·크기·공개/메모 구분·저장 SHA-256·`bytes/<hash>.bin` 경로를 포함한다. 원래 20MiB 한도로 계산한 대용량 descriptor 지문도 같은 원본에서 재계산해 대조한다. 원본 수집 전체 완료와 고객정보 복구 여부를 바꾸지 않으며 계획의 coverage/limitations에 그대로 남긴다. `complete`는 검토한 묶음의 첨부 범위만 뜻한다.

먼저 읽기 전용으로 대상 관계·원본 바이트를 대조해 계획을 만든다. 프로세스 환경에 `SENDB_FILE_TRANSFER_API_TOKEN`을 제공하며 키를 인수/문서에 넣지 않는다. 저장소 주소와 버킷은 서버에 설정한 비공개 전용 저장소와 같아야 한다.

```sh
node scripts/migrate-private-archive-files.cjs --online --bundle /private/canonical-channel-bundle.json --archive-dir /private/closed-byte-archive --out /private/new-file-review --api-base https://sendb.example.com --workspace-id 8 --namespace source-account --channel-id source-channel --storage-endpoint https://account.r2.cloudflarestorage.com --storage-bucket sendb-private-archive
```

검토 계획에는 정확한 API origin·저장소 endpoint/bucket/region, 원본 파일 해시·수집 한계, 사업·계정, 메시지 원본 지문·공개 구분, 파일 관계·버전을 포함한다. `GET /api/v1/imports/:id/files?fileId=<id>`와 SDK `importFile`은 원문/서명 주소 없이 이 관계를 검증한다. 원본 메시지가 직접 바뀌었거나 부모 연결·권한이 달라지면 막는다. 큰 가져오기 JSON 전체를 파일마다 불러오지 않도록 인증은 작업의 사업 정보만 조회한다.

이미 허가받은 이전 범위와 계획을 확인한 운영자는 같은 인수에 `--execute --approve-sha256 <plan.json의 sha256>`을 추가한다. 이 플래그는 다른 사업·저장소·원본으로 바뀐 계획을 그대로 실행하지 않도록 고정하는 장치다. 실행에는 `INBOX_ARCHIVE_S3_ACCESS_KEY_ID`·`INBOX_ARCHIVE_S3_SECRET_ACCESS_KEY`가 추가로 필요하다. 계정/환경 설정의 별도 승인을 대신하지 않는다.

파일별 현재 원본 지문과 CAS 버전을 재확인하고, 기존 객체가 있으면 먼저 내용을 검증한다. 새 업로드에는 `If-None-Match: *`를 사용해 동시 실행이 기존 객체를 덮어쓰지 않게 한다([R2 조건부 쓰기](https://developers.cloudflare.com/r2/api/s3/api/)). 저장소 내용을 검증한 뒤 연결하고, 완료 응답 이후 보호 다운로드도 별도로 SHA/크기를 대조한다. 이미 완료한 파일에도 이 검증을 적용한다.

중단 후에는 같은 계획·SHA에 `--resume`을 추가한다. 연결 후 응답 유실은 현재 ready와 실제 바이트로 확인하며 새 첨부를 중복 생성하지 않는다. 다른 작업이 파일/사업/원본/버전을 바꾸면 최신 버전을 임의 채택하지 않고 새 검토를 요구한다. 결과의 `newAttachmentsCreated`는 정확한 생성 주체를 추정하지 않고 `null`로 둔다. 경로 이탈·링크·열린 보관 잠금·해시 불일치는 전송 전에 막고, 원본 파일과 저장소 객체를 삭제하지 않는다. 작업 폴더 잠금과 원자 체크포인트는 기존 이전 도구와 같은 규칙을 따른다.

가상 PostgreSQL·loopback S3에서 검토 중 원격 쓰기 0건, 20MiB 초과 공개/메모 파일, 대상 주소 변경 차단, 재개 중복 0건을 확인한다. 실제 자식 CLI 프로세스와 HTTP/SDK 보호 다운로드도 검수하며, 이 자식에는 잘못된 DB URL과 빈 객체 자격증명을 주어 ready 검증이 DB 직접 접속/재업로드 없이 작동함을 확인한다. `scripts/check-private-archive-migration-cli.cjs`를 사용한다. `--local-qa`는 API와 저장소가 모두 loopback일 때만 HTTP 저장소를 허용한다.

실제 자료 복원본에서도 별도 자식 CLI와 읽기 전용 로컬 API 키로 같은 경로를 검수했다. 2,211개 전체·10,362,083,075바이트·최대 769,703,730바이트 파일의 보호 HTTP 다운로드 해시가 일치했다. GET 6,673회, POST 시도 0회, 새 첨부 0개이며 기존 records 348,873개·다른 사업·발송 큐를 보존했다. 자식에 유효한 DB URL이나 객체 자격증명을 주지 않았다. 이 검사는 완료된 원본의 재검증이며 실제 R2 업로드나 운영 자료 적용 증거로 확대하지 않는다.

## 원본 주소와 재이전

- 채널톡 File의 `key`만 있는 내보내기는 새 서명 주소가 필요하다. 기존 [v5 UserChat 파일 주소 안내](https://developers.channel.io/en/articles/Get-a-file-url-in-a-UserChat-bff12f64)는 `/open/v5/.../messages/file?key=...`와15분 유효기간을 설명한다. 새 [내보내기 CLI](IMPORTS.md#채널톡-내보내기-cli)는 [현재 공식 계약](https://api-doc.channel.works/docs/openapi.en.yaml)의 `/open/user-chats/{userChatId}/messages/file?key=...`, `Channel-Version: 2026-06-01`, `{result: string}`을 사용하며 v5 유효기간을 최신 계약의 확정값으로 취급하지 않는다. 바이트 백업 뒤 기존 파일 보충/연결을 별도로 승인하며 [D1 일괄 보충 CLI](FILE-TRANSFER.md)에서도 원본 식별과 검증된 파일만 사용한다. 샌드비 서버가 원본 계정의 인증키를 저장하거나 상시 수집하는 기능은 추가하지 않았다.
- 인터컴은 Part의 `name`, `url`, `filesize`, `content_type`을 사용한다. [공식 첨부 안내](https://www.intercom.com/help/en/articles/2339426-control-how-attachments-are-uploaded-and-used)에 따라 만료 주소는 원본 REST 조회로 새로 확보한다. [Part 모델](https://developers.intercom.com/docs/references/rest-api/api.intercom.io/models/conversation_part)의 첨부 배열을 보존한다. 실제 계정/전체 페이지 추출은 별도 작업이다.
- 공통 JSON은 `files:[{id,name,size?,sha256?,url?}]`를 사용한다. 100개 첨부를 현행 새 메시지의 5개 제한으로 잘라내지 않는다. 허브스팟의 CRM 파일·노트·다중 객체 파일 관계 전체 이전은 이번 범위에 포함하지 않는다.
- 파일 ID/key와 메타데이터 버전으로 식별하고 만료되는 URL은 버전 해시에서 제외한다. 주소만 바뀐 재이전은 완료 바이트를 재사용한다. ID/key가 없으면 배열 위치를 식별에 사용하므로 순서 변경 시 원본 검토가 필요하다.
- 이름·크기·해시·유형이 바뀌거나 첨부가 제거되면 과거 바이트를 삭제하지 않고 **이전 원본 파일**로 표시한다. 동일 원본 버전을 다시 추가하면 보관 바이트를 재사용한다. 원본 ID/메타데이터가 그대로인데 내용만 바뀐 경우는 자동 판별할 수 없으므로 올바른 해시 또는 새 원본 ID로 다시 내보내야 한다.
- 이전 원본도 저장 한도에 포함한다. 파일 등록/저장/실패는 임대·버전 비교로 보호하며 최신 원본이 바뀐 동안 도착한 오래된 다운로드 결과는 저장하지 않는다. 파일 처리는 메시지 본문/원래 시각·자동화·AI·외부 발송을 만들지 않는다.

## API와 SDK

직원 `/api/customer-imports/:jobId/files`, 서비스 `/api/v1/imports/:jobId/files`를 제공한다. 현재 사업의 운영 관리 역할을 요구하며 서비스 키의 사업 범위와 GET `read`, POST `update` 권한도 검사한다. 응답은 `{success,data}`이며 목록에 서명 URL·임대 토큰을 반환하지 않는다. 키는 사이트 서버에만 보관한다.

| 요청 | 입력/결과 |
|---|---|
| GET `?offset=0` | 파일 100개·전체 건수·상태 집계·hasMore, 원본 locator·호스트·version·중단 상태 |
| POST JSON | `{action:"prepare",offset:0}` → nextOffset/hasMore/skipped; 이미 저장한 메시지의 최신 원본만 등록 |
| POST JSON | `{action:"fetch",id,version}` → 해당 파일 바이트 이전/완료 상태 |
| POST JSON | `{action:"source",id,version,url}` → 주소 저장, 다운로드는 별도 호출 |
| POST multipart | `id`, `version`, `file` 하나 → 보관 파일로 보충 |

SDK는 `importFiles`, `prepareImportFiles`, `fetchImportFile`, `refreshImportFileSource`, `uploadImportFile`이며 타입은 `sdk/import-file-types.ts`다. 명시적 API 호출로 시작하고 현재 요청당 파일 한 개, 최대 15초 다운로드/3회 이동을 적용한다. 예약/상시 파일 이전 워커는 추가하지 않았다.

```ts
const page = await client.importFiles(jobId);
const file = page.rows.find(f => f.active && f.state === 'pending');
if (file) await client.fetchImportFile(jobId, file.id, file.version);
// 새 원본 주소 freshUrl을 원본 서비스에서 확보한 경우
const missing = page.rows.find(f => f.active && f.state === 'needs_source');
if (missing) {
  const refreshed = await client.refreshImportFileSource(jobId, missing.id, missing.version, freshUrl);
  await client.fetchImportFile(jobId, refreshed.id, refreshed.version);
}
// 보관 파일로 보충할 때는 uploadImportFile(jobId, id, version, blob, originalName)
```

## 검증과 남은 항목

`scripts/check-customer-import-files.cjs`는 가상 데이터의 실제 metadata/blob SQL과 native/v1/SDK를 검사한다. 독립 loopback PostgreSQL17.11의 23개: 바이트/다운로드·사업/권한·메모 격리·주소 만료/CAS·해시/크기·동시 확보·임대 만료·재이전/이전 원본·진행 중 원본 변경·잘못된 정보·기존 작업 준비·용량·101개 페이지·발송 없음·두 사업을 확인했다. 전송 단위10개는 DNS 고정·이동·시간/크기/빈/잘린 응답·만료 상태·메타데이터 계약을 가짜 HTTPS 전송기로 검사한다. 실제 원본 서비스에 접속한 결과는 아니다.

Chrome에서 JSON 텍스트 입력→미리보기→사람 승인→일괄 처리/403→주소 갱신→3파일 확보→과거 상담의 이미지 로딩을 확인했다. PDF 다운로드 버튼이 생성한 43바이트 파일의 SHA-256은 fixture와 일치했다.

2026-10-15 추가 검수: 별도 격리 Chrome에서 **실제 ImportsPage·ImportFilesPanel·API와 메모리 PGlite**로 공식 FileChooser API를 사용한 14개 시나리오를 통과했다. JSON 선택 취소/선택→실제 미리보기/사람 실행, 보관 파일 보충 취소, 다른 이름/크기 거절409와 정상 재선택, 중복 제어, 보호된 PDF/PNG 다운로드의 원본 바이트/SHA256 일치를 확인했다. 실제 페이지 다운로드 GET3개는200이며 명시적으로 세션 없이 보낸 별도 요청만401이었다. 소스23개는 전후와 현재가 일치하고 JS 오류·외부 요청은 없으며 본인 브라우저/서버/PGlite 종료를 확인했다. 재현·결과·소스 해시는 `evidence-manifest.json`의 `filePickerQa.groups.importAdmin`에 기록한다.

네이티브 Windows 탐색기의 수동 조작, 실제 원본 계정이나 고객 파일은 검수하지 않았다. 다운로드 UI는 실제 AttachmentList를 최소 호스트에 조립한 범위이며 전체 InboxPage를 실행한 결과로 확장하지 않는다. 고객 상담창 선택기는 [FILES-AUDIT.md](FILES-AUDIT.md)의 별도 검수를 따른다. 사용자 Chrome 확장 설정은 변경하지 않았다.

1105 단위·상담22·메일 첨부11·기존 자료 이전15 회귀, 변경 소스 lint·타입 포함 격리 전체 빌드를 확인한다. 실제 원본 계정 전체 추출/건수 대조·대용량 파일 정책·허브스팟 파일 관계·다중 참여자·원본 보존/영구 파기·활성 채널/실제 팀 전환·부하는 남는다. 전체 R11/R16과 대체 목표는 미완료다. 기존 REA 증거 범위는 [ANALYSIS.md](ANALYSIS.md)를 유지한다.
