# 기존 고객 자료 이전 · UX와 API

직원/API 키 권한은 [사업별 역할 기준](ACCESS.md)을 따른다. 이 문서의 설정 관리자는 해당 사업의 운영 관리 역할 또는 조직 관리자이며, 일반 직원은 배정받은 사업 역할에 맞는 업무를 사용한다.

2026-10-14~15 구현. R11의 기본 이전 경로다. 0111에 [과거 상담 파일 원본 이전/복구](IMPORT-FILES.md)를 추가했다. 2026-10-16 실제 디하 원본 수집과 개발 DB 복사본 검수 결과는 아래 최신 기록을 따른다. 활성 사이트 상담 채널 전환과 운영 자료 적용은 별도 단계다.

2026-10-15 재이전 보완: CRM 고객의 이름/이메일 갱신을 가져온 과거 상담 원본에 자동 전파하지 않는다. 이 전파가 같은 가져오기 작업의 상담 지문을 바꿔 후속 처리를 실패시키던 오류를 수정했다. 현재 상담의 프로필/CRM 연결 갱신은 유지한다. 채널톡 고객26명과25행 묶음 경계·동일 원본·원본 상담/메시지/첨부 보존·부모 결과의 새 지문·직접 편집 보호를 전용7개 검사로 확인했다. `scripts/check-channel-contact-reimport.cjs`와 `evidence-manifest.json`의 `channelContactReimportQa`를 따른다.

## 사용 흐름

### 2026-10-16 실제 자료 검수

사용자 승인으로 디하 채널톡의 공식 연락처 내보내기와 읽기 전용 API를 사용했다. 현재 연락처 2,634명(전체 59열), 상담 3,779건, 메시지 88,139개(내부 메모 20,588개), 첨부 2,211개의 원본을 보존했다. 첨부 바이트 10,362,083,075개는 파일별 원본 크기와 저장 후 SHA-256까지 대조했다. 원본·키·덤프는 비공개 작업 폴더에만 두며 Git에 넣지 않는다. 이 로그인에서는 백오피스랩 채널톡 원본 채널을 확인하지 못했으므로 백오랩 원본 이전까지 완료한 것으로 해석하지 않는다.

과거 상담의 참조 고객 2,551개 중 926개는 현재 API에서 조회됐고 1,625개는 404였다. 전체 연락처 파일에도 없는 1,625개 ID에는 연락처·실명·회원 연결을 추정하지 않고 **원본 고객 정보 조회 불가** 표시와 원본 ID/조회 결과를 남겼다. 해당 고객은 inactive이며 기존 리드와 이름·이메일로 합치지 않는다. 총 4,259개의 이전 고객 개체 중 1,625개가 이 상태다. 삭제됐다고 단정하거나 실제 고객 상세가 복구됐다고 표시하지 않는다. 작성자 5개(상담원 3·봇 2)의 상세도 원본에서 조회되지 않아 종류·ID·원문을 보존하고 이름을 만들지 않는다.

원래 CLI 수집기의 첫 고객 404 오류 상태는 `failed`로 보존했다. 메시지 수집 완료, 전체 연락처 파일, 참조 고객별 GET 결과, 봇 상세 보충을 별도 대조해 이전 묶음을 만들었다. `allowUnavailableAuthorProfiles:true`는 명시적으로 조회 불가한 상담원/봇 상세만 허용하며 메시지·상담·고객 ID 관계 누락을 우회하지 않는다. 상담이 있다고 표시되지만 전체 상담 목록에 없는 현재 고객 14개는 고객별 상담 API도 확인했고 추가 상담은 0개였다.

승인된 CloudType 개발 DB를 읽기 전용 덤프로 내려받아 loopback PostgreSQL에 복원했다. 원격 개발 DB와 운영 DB에는 가져오기를 실행하지 않았다. 복사본의 기존 159개 테이블 건수와 중요 6개 테이블 내용 지문을 확인했고 기존 CRM records 348,873개를 보존했다. 실제 고객·상담·메시지 전체를 디하 사업에 넣어 원문·작성자·시각·파일 메타데이터·원본 지문·읽기 전용 표시·다른 사업 보존을 대조했다. 대표 고객/첫·마지막 메시지 묶음의 재이전 미리보기는 재사용만 발생했다. 외부 발송/자동화 작업 증가는 0개다. 모든 실제 이전은 `verifiedCustomerHistory:false`로 직원 전용이며 고객 본인 공개 승인이 아니다.

일반 파일 가져오기는 20MiB 제한이다. 실제 첨부 중 2,149개(1,751,213,985바이트)는 복사본에서 저장·권한 다운로드·해시·중복 재시도를 확인했다. 나머지 62개(8,610,869,090바이트)는 이 제한을 넘으며 원본은 모두 보관했다. 0114의 비공개 객체 저장소 경로로 대용량 파일을 별도 검수한다([파일 원본 이전](IMPORT-FILES.md)). 원격 저장소 연결 전에는 대용량 첨부까지 운영에서 이용할 수 있다고 표시하지 않는다.

후속 검수: 추가 로컬 복사본과 loopback S3 호환 저장소에서 **2,211개 전체**를 스트리밍 이전하고 상담 권한 다운로드를 모두 SHA-256으로 대조했다. 62개 대용량과 최대 769,703,730바이트 파일도 통과했다. 새 파일 바이트는 DB에 추가하지 않았으며 앞선 로컬 DB 첨부 검수의 2,149개 바이트는 원래 복사본과 추가 시험 복사본에 보존했다. 실제 R2 연결·버킷 공개 차단 설정 검수·운영 파일 이전은 아직 실행하지 않았다.

DB 검수 중 PostgreSQL 드라이버가 날짜 비교 SQL 값을 전달하는 문제를 고쳐 실제 네이티브 PostgreSQL에서 회원 이력 600개×10메시지 페이지 검사를 통과했다. 서버 관리 도구의 가져오기 묶음은 최대 250행을 선택할 수 있고 기본 HTTP/SDK 단계는 기존 25행을 유지한다. 261개 가상 자료에서 250행 경계와 후속 묶음 전체 롤백·직접 수정 보호도 확인했다. 파일 작업은 같은 권한/잠금을 유지하며 대용량 원본 JSON 전체를 요청마다 읽지 않도록 필요한 작업 소유 정보만 조회한다.

개발 DB 복사본에는 기존 114개 마이그레이션이 이미 적용돼 있었다. 이 검수는 정확한 현재 운영 DB에서 0088~0113을 새로 적용한 실증이 아니다. 운영 스키마 사전 확인과 백업·비공개 파일 저장소 연결·배포 후 직원 검수는 별도 진행한다. 채널톡이 계속 운영 중이므로 실제 사이트 전환 직전에는 수집 이후 추가/변경 상담을 재대조해야 한다.

### 화면에서 가져오기

고객 관리 → **기존 자료 이전**(`/customer-imports`)에서 관리자가 사업을 선택한다.

1. 원본 서비스와 **원본 계정 이름**을 지정한다. 재이전할 때도 같은 계정 이름을 사용한다. 사업·서비스·계정·자료 종류·원본 ID를 함께 식별하므로 사업 간 같은 ID도 구분한다.
2. JSON 묶음 또는 CSV를 파일/텍스트로 입력한다. 파일 20MB·내용 500만자·10,000행까지다. 큰 자료는 나누되 계정/원본 ID를 유지한다. API 키를 자료에 넣지 않는다.
3. CSV는 자료 종류와 원본 ID·이름·이메일·관계 열을 매핑한다. 관계에는 이메일/회사 이름 대신 **원본 ID**를 사용한다. 회사·파이프라인을 먼저 이전한 뒤 고객·딜을 추가할 수 있다. 이름 열은 `First + Last`, 회사 ID·태그는 `;`, 단계 배열은 JSON을 지원한다.
4. **매핑·중복 미리보기 만들기**에서 생성/기존 연결/재사용/갱신, 건수·오류·관계·원본 필드를 검토한다. 이 단계는 고객 자료를 바꾸지 않는다. 원본/매핑 편집은 화면의 이전 승인을 해제한다.
5. 오류를 해결하고 사업·원본·건수·기존 연결·첨부 누락을 확인한 뒤 **검토한 자료 가져오기**를 누른다. 원본과 검토 대상이 고정되며, 미리보기 이후 대상/관계가 바뀌면 새 미리보기를 요구한다.
6. 25행씩 저장한다. 실패한 묶음 전체를 롤백하고 이전 완료 행은 보존한다. 일시 중지·재개·중단과 감사 이력을 제공한다. 중단은 이미 저장한 자료의 삭제가 아니다. 화면을 닫으면 최근 작업에서 계속하며 서버에서도 SDK로 단계를 호출할 수 있다.
7. 결과 표의 **가져온 과거 상담 열기** 또는 인박스 **이전 상담 기록**에서 원본 상담별 시각·메모·첨부 정보를 읽는다. 같은 고객의 회사·딜·후속 업무·타임라인도 연결된다.

고객 공개는 기본 꺼짐이다. 채널톡 JSON의 원본 계정(`namespace`)과 `memberId`가 대상 사업 사이트의 확인된 회원 ID와 같은 체계임을 관리자가 확인한 경우에만 **확인된 회원 ID 기준 과거 상담 공개 확인**을 선택한다. `verifiedCustomerHistory` 기본값은 `false`이며 원본·사업·계정 등이 바뀌면 확인 선택을 다시 한다. 기존 미승인 작업은 새 미리보기/재이전 전까지 직원 전용이다. CSV는 이번 고객 공개 대상이 아니다. [본인 열람 조건·읽기 전용·토큰/회수 한계](CUSTOMER-IMPORT-HISTORY.md)를 따른다.

## 지원 원본

| 원본 | JSON 배열/구조 | 적용 |
|---|---|---|
| 채널톡 | `users`, `managers`·`bots`(선택), `userChats`, `messages` | profile/확인된 회원 ID, title·상태, plainText, 작성자·시각, private 메모·파일 정보 |
| 인터컴 | `contacts`, `companies`, **상세** `conversations` | 외부 회원/회사 관계, source와 conversation_parts, note·원래 시각. `display_as=plaintext` 권장 |
| 허브스팟 | `companies`, `contacts`, `pipelines`, `deals`, `tasks`의 API results 또는 CSV | properties·관계 원본 ID·영업 단계·금액/통화·업무. 통화는 `deal_currency_code` 또는 묶음 `defaultCurrency` 필요 |
| 공통 형식 | 아래 배열의 JSON 또는 자료 종류별 CSV | 명시적으로 매핑한 이전 모델 |

공통 JSON 배열은 `companies`, `contacts`, `pipelines`, `deals`, `tasks`, `conversations`, `messages`다. 각 행은 문자열 `id`(원본 ID)를 포함한다. 실행 가능한 영업/상담 전체 예제는 화면의 **가상 예제 자료 불러오기**와 `src/components/customer-imports/utils/example.ts`에 있다.

```json
{
  "companies": [{"id":"co-1","name":"예제 회사"}],
  "contacts": [{"id":"customer-1","name":"예제 고객","companyIds":["co-1"]}],
  "conversations": [{"id":"chat-1","contactId":"customer-1","name":"도입 문의","status":"closed","createdAt":"2024-05-08T01:00:00.000Z"}],
  "messages": [{"id":"msg-1","conversationId":"chat-1","messageKind":"customer","body":"도입 방법이 궁금합니다.","authorName":"예제 고객","createdAt":"2024-05-08T01:00:00.000Z"}]
}
```

누락 관계·원본 ID 중복·잘못된 필드/길이·남은 API 페이지·원본 예상 건수(`expectedCounts`) 불일치는 오류다. 인터컴 500개 부분 제한에 도달하면 전체 자료 확인을 요구하고, 명시적으로 **부분 이전**을 선택한 경우에만 주의사항으로 승인한다. 이 선택이 전체 대화 확보를 증명하지는 않는다. 관리 화면의 가져오기는 원본 파일을 입력받으며, 채널톡 페이지 수집은 아래 별도 CLI에서 수행한다.

여러 참여자/고객·회사 관계는 현 모델의 대표 관계를 사용하며 나머지는 원본 JSON에 보존하고 경고한다. HTML은 실행하지 않고 문자로 표시한다. 필드를 조용히 잘라서 가져오지 않는다.

2026-10-15 최신 채널톡 응답 호환: `title`을 이전 `name`보다 먼저 사용하며, 작성자 종류별로 고객/상담원/봇 이름을 구분한다. `queued`·`initial`·`missed`는 보관 화면의 `open`으로 변환하고 원본 상태와 변환 경고를 보존한다. 보관 상담을 실제로 재개하는 동작은 아니다. 알 수 없는 상태는 오류로 막으며 `next`·`nextCursor`·`hasNext:true`가 남은 자료는 부분 이전 선택으로 우회할 수 없다. 회원 종류가 확인되지 않거나 `veilId`와 같은 `memberId`는 외부 회원 ID 후보로 사용하지 않는다. 확인된 회원의 명시적 외부 ID는 같은 사업의 기존 CRM 연결 후보가 되며 미리보기에서 검토한다. 나머지는 서비스/계정/원본 ID로 구분한다. 일반 가져오기만으로 사이트 회원의 과거 이력을 공개하지 않는다. 위의 명시적 본인 공개 승인과 원본 관계 검사를 모두 충족해야 한다. 텍스트 없는 블록 메시지와 작성자 상세 누락은 원본 보존과 화면 표시 한계를 구분해 알린다.

## 중복·기존 자료·과거 상담

- 이메일로 합치지 않는다. 명시적 `externalId`가 같은 기존 자료에는 이름·연락처·속성을 보존하고 이력/검토한 회사 관계를 연결한다. 외부 ID가 없으면 원본 서비스/계정 ID로 별도 식별한다.
- 원본 키·자료/대상 해시·행별 전후 결과를 보관한다. 같은 원본은 재사용하며 변경 원본은 **이전 자료 갱신**으로 다시 검토한다. 샌드비에서 수정한 대상은 덮어쓰지 않는다. 같은 작업 위치 재시도는 중복 적용하지 않는다.
- 과거 상담은 `history_only=true`로 분리한다. 현재 문의·미확인 수와 구분하고 답변/상태 변경/새 첨부/AI 초안을 막는다. 승인 조건을 충족한 본인의 공개 채널톡 기록만 회원 위젯에 이전 상담·읽기 전용으로 표시한다. 원본에서 열려 있던 상태는 보존하되 해당 서비스로 답변할 수 있다는 뜻은 아니다.
- 원래 시각·ID와 상담 구분을 유지하고, 오래된 메시지를 나중에 추가해도 시각/ID 커서로 읽는다. 공개 기록은 CRM 타임라인에 연결하고 메모는 제외한다. 첨부 목록/원본 JSON을 먼저 보존하며, 관리자가 별도 파일 이전 단계에서 바이트를 가져오거나 보관 파일로 보충한다. [파일 이전/복구와 재이전](IMPORT-FILES.md) 참고.
- 가져오기 문맥에서는 플랫폼 outbox·웹훅·자동화 등록을 차단하며 과거 메시지는 AI 큐를 거치지 않는다. CRM 활동에는 이전 작업을 표시한다. 기존 메일/Google Chat 고객 여정 정책은 변경하지 않는다.

## 채널톡 내보내기 CLI

`scripts/export-channel-source.cjs`는 기존 Node/tsx 의존성으로 직접 실행한다. 기본 검수는 다음 허구 자료를 사용한다. 출력 위치는 비어 있는 새 폴더여야 한다.

```sh
node scripts/export-channel-source.cjs --fixture scripts/fixtures/channel-source-export-fictional.json --out .testenv/channel-export-demo --channel-id qa-fictional-channel-export --namespace fictional-demo --workspace-id 8 --page-size 2 --include-files
```

공식 API 버전과 채널 ID를 고정하고 6개 상담 상태, 상담별 메시지 페이지, 참조된 고객 상세를 수집한다. 커서 순환·내용이 다른 동일 ID·잘못된 페이지 종료·채널 불일치·인증 실패를 완료로 처리하지 않는다. 429/일시 오류에는 제한된 재시도를 적용하며 서버의 최소 대기시간이 상한을 넘으면 조기에 재호출하지 않고 보류한다. HTTP 연결 오류와 timeout만 해당 재시도 오류로 변환한다. 응답 형식·버전·원본 보관 실패는 중단한다.

`--max-requests 5`처럼 요청 상한에 도달하면 원본과 체크포인트를 남긴다. 같은 폴더·채널·namespace·사업·페이지 크기를 유지하고 `--resume`을 추가해 계속한다. 상한으로 멈췄다면 재개 시 요청 상한도 충분히 높여야 한다. 다른 실행이 살아 있는 폴더는 열지 않으며 종료된 실행의 잠금 복구는 `--resume --recover-stale-lock`으로 명시한다.

- `pages/`·`pages-index.json`: 성공한 전체 원본 응답과 조회 범위/내용 해시. canonical 배열에 없는 태그·세션 등도 보존한다. 같은 페이지 내용이 바뀌면 이전 파일을 덮지 않고 변경 버전을 기록한다.
- `raw/`·`checkpoint.json`: 조립한 원본과 엔드포인트별 완료/다음 커서. 원자 저장이 끝난 페이지부터 재개한다. 완료 커서의 원본 페이지가 없거나 손상되면 재개를 거절한다.
- `chunks/`: 실제 importer의10,000행·500만 문자·20MiB 이내인 고객→상담→메시지 묶음. 관련 고객/상담과 작성자가 반복될 수 있어 고유 원본 건수와 반복 의존 행을 별도 집계한다.
- `bytes/`·`files.json`·`files-checkpoint.json`: 선택한 첨부 원본의 바이트/크기/SHA-256·공개/메모 구분과 상태. 서명 주소는 매 시도 새로 받고, 재개 시 검증된 파일은 다시 다운로드하지 않는다. 불일치·누락·미지원·중단은 파일별 상태에 남긴다. 손상된 보관 바이트를 자동 덮어쓰지 않는다.
- `manifest.json`: `sourceStatus`, `importStatus`, `importReady`, 파일 백업 상태와 각 묶음의 `expectedCounts`. 빈 완성 원본은 `no-import-data`이며 가져오기 준비 완료가 아니다. `migrationApplied:false`는 이 도구가 CRM 가져오기나 운영 반영을 실행하지 않았다는 뜻이다.

자료를 검토한 뒤 `chunks/`의 파일을 번호 순서로 같은 namespace와 사업에 가져온다. 파일별 `expectedCounts`는 manifest의 값을 입력한다. 바이트 백업은 기존 파일 보충/연결과 별도이며, `bytes/<hash>.bin`을 그대로 골라 넣는 것만으로 원본 파일 이름·관계가 자동 연결되지는 않는다. 원본의 상담/메시지/파일 식별·이름·크기/해시와 대조해 [파일 보충 단계](IMPORT-FILES.md)를 사용한다. D1 후속의 [보관 첨부 일괄 보충 CLI](FILE-TRANSFER.md)는 검증된 원본과 기존 대상 파일 목록을 유일 매칭한 계획을 만들고, 명시적으로 승인한 SHA의 계획만 기존 단건 API로 순차 실행한다. 대상 보호 다운로드의 바이트 검증과 중단/응답 유실 재개를 포함하며 메타데이터 가져오기나 파일 목록 준비를 자동 실행하지 않는다.

실계정 조회는 `--fixture` 대신 명시적인 `--run`, 사업 ID와 `CHANNEL_SOURCE_ACCESS_KEY`·`CHANNEL_SOURCE_ACCESS_SECRET` 환경변수가 필요하다. 도구는 `.env`를 읽거나 키를 출력하지 않는다. 이 개발 검수에서는 `--run`·실제 키·고객 API·실제 고객 파일을 사용하지 않았다. 실제 API에서 보이는 전체 범위·삭제/보관 만료·상담 없는 고객·수집 중 시점 일관성과 실제 원본 건수는 아직 증명되지 않았다.

2026-10-16 대용량 수집 보완: Windows에서 파일 검사/읽기와 겹쳐 `rename`이 `EPERM`·`EACCES`·`EBUSY`로 실패하면 기존 파일을 삭제하지 않고 잠금 소유를 다시 확인하며 짧게 재시도한다. 재시도 상한 뒤에는 실패를 그대로 반환한다. `--checkpoint-every N`(1~100, 기본1)은 전체 스냅샷 저장 간격을 요청 N개로 늘린다. 성공한 원본 페이지는 계속 요청마다 저장하며 완료·오류·중단 시 최종 스냅샷을 저장한다. 강제 종료 시 마지막 N-1개 요청을 다시 조회할 수 있다. 원본 페이지 보관을 끄는 옵션이 아니다.

## 상담 없는 고객을 포함한 전체 고객 파일

채널톡 상담 API 수집은 상담에서 참조한 고객만 모은다. 전체 고객 이전에는 같은 채널의 고객 연락처 화면에서 필터를 해제하고 **검색 결과 다운로드 → 조회용 전체 데이터**도 내려받는다. 이 파일의 고객 수와 원본 ID 고유 수를 먼저 대조한다. XLSX 자체에는 채널 ID가 없으므로 상담 API와 같은 채널에서 내보낸 파일인지 확인해야 한다.

암호화 ZIP을 비공개 작업 폴더에서 푼 뒤 아래 로컬 변환을 사용한다. 원본을 수정하거나 기존 결과를 덮어쓰지 않는다. 결과 JSON은 고객 정보가 포함되므로 저장소에 커밋하지 않는다.

```sh
node scripts/convert-channel-contacts.cjs /private/contacts-full.xlsx /private/contacts-full.json
node scripts/check-channel-contacts-export.cjs
```

`User data` 시트의 원본 ID와 모든 열을 `exportRow`에 보존하며 `profile.*`, `web.*`, `mobile.*`는 중첩 객체로 복원한다. `member`·`hasChat` 등의 문자열 `false`는 실제 불리언으로 변환한다. 회원 구분이 없으면 미확인으로 처리하고 `memberId`가 있다는 이유만으로 사이트 회원으로 승격하지 않는다. 고객 태그 문자열은 쉼표가 실제 태그 이름의 일부인지 알 수 없어 원문 그대로 보존한다. 원본 SHA-256·행/열 수를 결과에 기록하며, 중복/없는 ID·잘못된 구분값/날짜·겹치는 열 이름을 오류로 막는다.

변환 결과의 `scope:contacts-only`는 상담·첨부 확보 완료를 뜻하지 않는다. 같은 사업/namespace로 고객을 먼저 가져오고 상담 API 자료를 이어서 처리한다. 같은 원본 ID의 고객 속성이 서로 다르면 두 원본을 보존하고 차이를 확인한 뒤 갱신한다. 큰 고객 파일도 `splitChannelBundle`로 실제 importer 크기 제한에 맞게 나눈다. 고객 공개는 기존과 같이 기본 꺼짐이며, 자료 이전만으로 메일·알림·상담 발송을 실행하지 않는다.

## API와 SDK

서비스 토큰의 사업 범위와 발급자의 현재 관리자 역할을 확인한다. 읽기는 `read`, 미리보기는 `create`, 실행/단계/중지/재개는 `update` 권한이 필요하다. 직원 화면도 관리자 인증을 적용한다. 응답은 기존 `{success,data}` 계약이다.

대량 이전 실행기는 `stepImport(jobId, cursor, 250)`으로 요청당 최대 250행을 처리할 수 있다. `batchSize` 생략 시 기존 25행을 유지한다. API는 정수 1~250만 허용하며 사업·관리자 권한, 커서, 원본 지문·관계와 묶음 전체 롤백 검사는 동일하다. 이미 처리한 커서의 재요청은 다시 저장하지 않는다. 250행 중 충돌이 생기면 그 묶음 전체를 취소하고 이전 커서를 유지한다.

| API | 동작 |
|---|---|
| `GET /api/v1/imports?workspaceId=8&before=<jobId>` | 최근 50개와 커서 |
| `POST /api/v1/imports` | `{workspaceId,source,namespace,format,content,csvKind?,columns?,expectedCounts?,updateImported?,allowPartialHistory?,verifiedCustomerHistory?}` 미리보기 |
| `GET /api/v1/imports/:id?offset=100` | 행/결과 100개씩·전체 건수·오류·감사 |
| `GET /api/v1/imports/:id?source=1` | 관리자용 원본/매핑 다시 불러오기 |
| `POST /api/v1/imports/:id` | `{action:"start",version,fingerprint,acknowledge:true}` 또는 pause/resume/cancel |
| `POST /api/v1/imports/:id` | `{action:"step",cursor}` 다음 25행 원자적 적용 |

직원 API는 `/api/customer-imports`다. SDK에는 `imports`, `previewImport`, `import`, `changeImport`, `stepImport`를 추가했다. 서비스 토큰을 브라우저에 전달하지 않는다.

```ts
let job = await client.previewImport({ workspaceId: 8, source: 'portable', namespace: 'old-account', format: 'json', content: JSON.stringify(bundle) });
// 사람이 건수·관계·주의사항을 검토한 뒤
job = await client.changeImport(job.id, { action: 'start', version: job.version, fingerprint: job.fingerprint, acknowledge: true });
while (job.state === 'running') job = await client.stepImport(job.id, job.cursor);
```

## 근거·검증·남은 작업

아래 가져오기·파일 선택기 검수는 당시 소스의 근거다. 새 고객 공개 확인 UI와 정책의 최종 검수를 대신하지 않으며, 후속 결과는 [별도 상태](CUSTOMER-IMPORT-HISTORY.md)로 관리한다.

[채널톡 UserChat](https://developers.channel.io/en/articles/List-of-UserChats-a7e8e5d1)·[메시지 옵션](https://developers.channel.io/en/articles/5ed6e3c0), [인터컴 상세 대화](https://developers.intercom.com/docs/references/rest-api/api.intercom.io/conversations/retrieveconversation), [허브스팟 Exports](https://developers.hubspot.com/docs/api-reference/legacy/crm/exports/guide)를 참고해 독립 구현했다. 공개 계약·가상 응답 검증이며 비공개 내부 구현이나 실제 계정 전체 추출의 증거는 아니다. 기존 SDK REA/화면 분석은 `ANALYSIS.md`를 유지한다.

`scripts/check-customer-imports.cjs`의 격리 SQL/API 15개는 무변경 미리보기·역할/사업 범위·관계 저장·공개/메모 격리·발송 없음·중복·미리보기 충돌·누락/건수·롤백/복구·중지/재개/취소·수정 보호·두 사업·세 API 형식/SDK·과거 메시지 추가와 100건 커서·현재 회원 상담/비회원 연결 호환을 확인한다. 정규화 단위 검사는 최신 응답 호환·페이지 누락을 포함해 18개다. 브라우저에서 디하 JSON 승인/저장→과거 상담/CRM, 백오랩 CSV 매핑/저장을 확인한다. 실제 서비스 고객·운영 DB·메일/Google Chat/실제 모델은 사용하지 않는다.

현재 회원 웹 문의의 목록·새 문의·읽음은0112에 구현했다([CUSTOMER-HISTORY.md](CUSTOMER-HISTORY.md)). 고객 공개 정책은 확인된 본인과 직원의 열람으로 선택됐으며, [승인 조건과 후속 구현/검수 상태](CUSTOMER-IMPORT-HISTORY.md)를 따른다. 모든 가져온 기록을 자동 공개하지 않는다. 남은 항목은 실제 채널톡 원본 전체 추출·페이지/건수 대조, 대용량/CRM 파일 관계, 다중 참여자/관계 모델, 실제 원본 계정·회원 ID 체계 확인과 업무 인수, 활성 상담 채널 전환, 실제 운영 동시/부하 검수, 원본 보존 기간과 선택 복구 정책이다. 상담 파일 바이트/복구는0111에 구현·격리 검수했으며 관리자 JSON/보관 파일 선택→실제 ImportsPage/ImportFilesPanel·API·메모리 PGlite→다운로드를 별도 Chrome 14개로 확인했다. 전체 InboxPage·네이티브 Explorer·실제 고객 파일의 검수 증거는 아니다. 완료 전에는 R11 전체 이전·R16 전환 완료로 표시하지 않는다.
