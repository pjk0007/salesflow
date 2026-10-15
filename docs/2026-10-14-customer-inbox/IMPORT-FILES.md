# 과거 상담 첨부파일 원본 이전

2026-10-15 · 개발 브랜치 전용. 0111 마이그레이션을 추가했으며 실제 서버·운영/개발 고객 DB에는 적용하지 않았다. [기존 자료 이전](IMPORTS.md)의 상담 파일 단계이며 실제 원본 계정 전체 추출이나 전체 서비스 전환 완료를 뜻하지 않는다.

## 관리자 사용 흐름

1. 기존 자료 이전에서 원본 서비스·계정·사업을 확인하고 상담 정보 가져오기를 승인한다. 메시지 저장 트랜잭션에서 파일 목록을 등록하며 파일 다운로드는 시작하지 않는다.
2. **과거 상담 첨부파일 원본**에서 전체·완료·대기·확인 필요를 확인한다. 이전 버전으로 저장한 작업은 **기존 이전 작업의 첨부 목록 준비**를 누른다. 원본이 이미 갱신된 행은 제외하므로 오래된 작업으로 최신 파일을 되돌리지 않는다.
3. **현재 페이지의 대기 파일 가져오기** 또는 파일별 **파일 가져오기/다시 시도**를 누른다. 100개씩 페이지를 나누며 파일별로 한 번씩 처리한다. 실패한 파일의 자동 무한 재시도는 하지 않는다.
4. 401/403/404/410 응답이면 **원본 주소 갱신**에서 새 HTTPS 다운로드 주소를 저장한 뒤 다시 가져온다. 원본 API 키를 입력하는 곳이 아니다. 보관 파일이 있으면 **보관 파일로 보충**에서 하나를 선택한다. 원본과 같은 이름·알려진 바이트 크기·SHA-256을 확인한다. 잘못된 원본 메타데이터는 수정한 자료를 새 미리보기로 검토해야 한다.
5. **현재 파일 후 중지**는 추가 다운로드를 중지하고 현재 요청과 완료 파일을 보존한다. 화면을 닫은 뒤 최근 작업에서 다시 열어 이어서 처리할 수 있다. 서버가 중단되어 가져오는 상태가 남으면 60초 임대 만료 후 재시도할 수 있다.
6. 결과 표의 **가져온 과거 상담 열기**에서 파일을 다운로드하고 PNG/JPEG/GIF/WebP는 미리보기로 확인한다. 내부 메모 파일은 고객에게 노출하지 않는다. 과거 상담의 답변·새 첨부 제한은 유지한다.

파일당 0바이트 초과~20MiB, 사업별 상담 파일 저장 한도(기본 2GiB)를 적용한다. MIME은 실제 바이트로 판별한다. 다른 형식도 원본 바이트를 보관하지만 자동 실행/이미지 미리보기는 제공하지 않는다. 큰 파일·빈 파일은 실패 사유로 남기며 조용히 누락하지 않는다. 원본에 크기/해시가 없으면 해당 항목의 원본 대조를 증명할 수 없으므로 수동 확인이 필요하다.

## 원본 주소와 재이전

- 채널톡 File의 `key`만 있는 내보내기는 새 서명 주소가 필요하다. 공식 [UserChat 파일 주소 API](https://developers.channel.io/en/articles/Get-a-file-url-in-a-UserChat-bff12f64)는 `GET /open/v5/user-chats/{userChatId}/messages/file?key=...`로 15분 유효 주소를 제공한다. 목록의 원본 상담 ID·파일 key를 사용해 원본 서비스에서 받은 주소를 갱신한다. 샌드비가 원본 계정의 인증키를 저장하거나 그 API를 자동 호출하지는 않는다.
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
