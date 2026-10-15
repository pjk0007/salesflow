# 기존 고객 자료 이전 · UX와 API

직원/API 키 권한은 [사업별 역할 기준](ACCESS.md)을 따른다. 이 문서의 설정 관리자는 해당 사업의 운영 관리 역할 또는 조직 관리자이며, 일반 직원은 배정받은 사업 역할에 맞는 업무를 사용한다.

2026-10-14~15 구현. R11의 기본 이전 경로다. 0111에 [과거 상담 파일 원본 이전/복구](IMPORT-FILES.md)를 추가했다. 실제 계정 전체 추출·대용량/CRM 파일 관계·활성 상담 채널 전환은 아직 완료하지 않았다.

## 사용 흐름

고객 관리 → **기존 자료 이전**(`/customer-imports`)에서 관리자가 사업을 선택한다.

1. 원본 서비스와 **원본 계정 이름**을 지정한다. 재이전할 때도 같은 계정 이름을 사용한다. 사업·서비스·계정·자료 종류·원본 ID를 함께 식별하므로 사업 간 같은 ID도 구분한다.
2. JSON 묶음 또는 CSV를 파일/텍스트로 입력한다. 파일 20MB·내용 500만자·10,000행까지다. 큰 자료는 나누되 계정/원본 ID를 유지한다. API 키를 자료에 넣지 않는다.
3. CSV는 자료 종류와 원본 ID·이름·이메일·관계 열을 매핑한다. 관계에는 이메일/회사 이름 대신 **원본 ID**를 사용한다. 회사·파이프라인을 먼저 이전한 뒤 고객·딜을 추가할 수 있다. 이름 열은 `First + Last`, 회사 ID·태그는 `;`, 단계 배열은 JSON을 지원한다.
4. **매핑·중복 미리보기 만들기**에서 생성/기존 연결/재사용/갱신, 건수·오류·관계·원본 필드를 검토한다. 이 단계는 고객 자료를 바꾸지 않는다. 원본/매핑 편집은 화면의 이전 승인을 해제한다.
5. 오류를 해결하고 사업·원본·건수·기존 연결·첨부 누락을 확인한 뒤 **검토한 자료 가져오기**를 누른다. 원본과 검토 대상이 고정되며, 미리보기 이후 대상/관계가 바뀌면 새 미리보기를 요구한다.
6. 25행씩 저장한다. 실패한 묶음 전체를 롤백하고 이전 완료 행은 보존한다. 일시 중지·재개·중단과 감사 이력을 제공한다. 중단은 이미 저장한 자료의 삭제가 아니다. 화면을 닫으면 최근 작업에서 계속하며 서버에서도 SDK로 단계를 호출할 수 있다.
7. 결과 표의 **가져온 과거 상담 열기** 또는 인박스 **이전 상담 기록**에서 원본 상담별 시각·메모·첨부 정보를 읽는다. 같은 고객의 회사·딜·후속 업무·타임라인도 연결된다.

## 지원 원본

| 원본 | JSON 배열/구조 | 적용 |
|---|---|---|
| 채널톡 | `users`, `managers`(선택), `userChats`, `messages` | profile/memberId, 상태, plainText, 작성자·시각, private 메모·파일 정보 |
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

누락 관계·원본 ID 중복·잘못된 필드/길이·남은 API 페이지·원본 예상 건수(`expectedCounts`) 불일치는 오류다. 인터컴 500개 부분 제한에 도달하면 전체 자료 확인을 요구하고, 명시적으로 **부분 이전**을 선택한 경우에만 주의사항으로 승인한다. 이 선택이 전체 대화 확보를 증명하지는 않는다. 실제 API 페이지를 수집하는 기능은 포함하지 않는다.

여러 참여자/고객·회사 관계는 현 모델의 대표 관계를 사용하며 나머지는 원본 JSON에 보존하고 경고한다. HTML은 실행하지 않고 문자로 표시한다. 필드를 조용히 잘라서 가져오지 않는다.

## 중복·기존 자료·과거 상담

- 이메일로 합치지 않는다. 명시적 `externalId`가 같은 기존 자료에는 이름·연락처·속성을 보존하고 이력/검토한 회사 관계를 연결한다. 외부 ID가 없으면 원본 서비스/계정 ID로 별도 식별한다.
- 원본 키·자료/대상 해시·행별 전후 결과를 보관한다. 같은 원본은 재사용하며 변경 원본은 **이전 자료 갱신**으로 다시 검토한다. 샌드비에서 수정한 대상은 덮어쓰지 않는다. 같은 작업 위치 재시도는 중복 적용하지 않는다.
- 과거 상담은 `history_only=true`로 분리한다. 현재 상담의 미확인 수나 회원 위젯에 섞지 않고 답변/상태 변경/새 첨부/AI 초안을 막는다. 원본에서 열려 있던 상태는 보존하되 해당 서비스로 답변할 수 있다는 뜻은 아니다.
- 원래 시각·ID와 상담 구분을 유지하고, 오래된 메시지를 나중에 추가해도 시각/ID 커서로 읽는다. 공개 기록은 CRM 타임라인에 연결하고 메모는 제외한다. 첨부 목록/원본 JSON을 먼저 보존하며, 관리자가 별도 파일 이전 단계에서 바이트를 가져오거나 보관 파일로 보충한다. [파일 이전/복구와 재이전](IMPORT-FILES.md) 참고.
- 가져오기 문맥에서는 플랫폼 outbox·웹훅·자동화 등록을 차단하며 과거 메시지는 AI 큐를 거치지 않는다. CRM 활동에는 이전 작업을 표시한다. 기존 메일/Google Chat 고객 여정 정책은 변경하지 않는다.

## API와 SDK

서비스 토큰의 사업 범위와 발급자의 현재 관리자 역할을 확인한다. 읽기는 `read`, 미리보기는 `create`, 실행/단계/중지/재개는 `update` 권한이 필요하다. 직원 화면도 관리자 인증을 적용한다. 응답은 기존 `{success,data}` 계약이다.

| API | 동작 |
|---|---|
| `GET /api/v1/imports?workspaceId=8&before=<jobId>` | 최근 50개와 커서 |
| `POST /api/v1/imports` | `{workspaceId,source,namespace,format,content,csvKind?,columns?,expectedCounts?,updateImported?,allowPartialHistory?}` 미리보기 |
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

[채널톡 UserChat](https://developers.channel.io/en/articles/List-of-UserChats-a7e8e5d1)·[메시지 옵션](https://developers.channel.io/en/articles/5ed6e3c0), [인터컴 상세 대화](https://developers.intercom.com/docs/references/rest-api/api.intercom.io/conversations/retrieveconversation), [허브스팟 Exports](https://developers.hubspot.com/docs/api-reference/legacy/crm/exports/guide)를 참고해 독립 구현했다. 공개 계약·가상 응답 검증이며 비공개 내부 구현이나 실제 계정 전체 추출의 증거는 아니다. 기존 SDK REA/화면 분석은 `ANALYSIS.md`를 유지한다.

`scripts/check-customer-imports.cjs`의 격리 SQL/API 15개는 무변경 미리보기·역할/사업 범위·관계 저장·공개/메모 격리·발송 없음·중복·미리보기 충돌·누락/건수·롤백/복구·중지/재개/취소·수정 보호·두 사업·세 API 형식/SDK·과거 메시지 추가와 100건 커서·현재 회원 상담/비회원 연결 호환을 확인한다. 정규화 단위 검사는 7개다. 브라우저에서 디하 JSON 승인/저장→과거 상담/CRM, 백오랩 CSV 매핑/저장을 확인한다. 실제 서비스 고객·운영 DB·메일/Google Chat/실제 모델은 사용하지 않는다.

남은 항목은 실제 원본 계정 전체 추출·페이지/건수 대조, 대용량/허브스팟 CRM 파일 관계, 다중 참여자/관계 모델, 검증된 회원에게 공개할 과거 대화 정책·위젯의 대화 목록, 활성 상담 채널 전환, 대규모 PostgreSQL 동시/부하 검수, 원본 보존 기간과 선택 복구 정책이다. 상담 파일 바이트/복구는 0111에 구현·격리 검수했으나 파일 선택기 업로드부터의 브라우저 경로는 Chrome 확장 권한을 포함한 수동 재검수 항목이다. 완료 전에는 R11 전체 이전·R16 전환 완료로 표시하지 않는다.
