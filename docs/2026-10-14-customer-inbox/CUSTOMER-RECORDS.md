# 고객·회사 정보 이력과 보관

고객 관리의 **고객 / 회사**에서 추가 속성을 편집하고, 누가 어떤 값을 바꿨는지 확인하며, 사용하지 않는 정보를 보관·복구할 수 있다. 제공 리서치의 공통 고객·회사·관계·활동 모델(R04)과 보존·복구(R14)를 기존 샌드비 PostgreSQL/API에 확장했다. 전체 고객 플랫폼 대체나 실제 계정 전환 완료를 뜻하지 않는다.

## 화면에서 사용하는 순서

1. 고객 관리에서 사업을 선택하고 **고객** 또는 **회사**를 연다. 기본 목록은 사용 중인 정보이며 **보관함 / 전체** 필터로 보관 정보를 찾는다. 검색과 이어 조회에도 같은 필터가 적용된다.
2. 항목을 열어 이름·회사 관계·단계와 **추가 속성**을 수정한다. 문자·숫자·예/아니요·빈 값·JSON을 구분하며 `0`, `false`, `null`을 보존한다. 복잡한 기존 JSON도 유지된다. 속성 이름 중복, 잘못된 숫자·JSON과 합계 12,000자 초과를 검사한다.
3. **저장**하면 버전이 증가하고 수정자·직접 편집/API/자동화/가져오기/이메일 출처, 필드별 이전 값·새 값, 시각을 남긴다. 속성 삭제는 ‘미설정’, 명시적 null은 ‘비어 있음’으로 구분한다. 고객 정보의 변경은 상담과 고객 관리의 공통 고객 타임라인에도 표시된다. 회사 변경은 회사 이력과 회사 활동으로 기록한다.
4. 다른 화면에서 먼저 저장했다면 오래된 버전의 저장은 409로 거절한다. 입력 중인 초안은 유지한다. 필요한 내용을 복사한 뒤 **최신 내용 불러오기**로 서버의 값을 불러온다. 이 버튼은 현재 입력을 최신 값으로 바꾸므로 초안을 먼저 확인한다.
5. 사업 운영 관리자/조직 관리자는 **보관하기**에서 연결 상담·보관하지 않은 거래·예정 업무와 대기 자동화 건수를 확인하고 사유를 남길 수 있다. 입력 중인 내용은 먼저 저장한다. **보관 실행**은 현재 저장된 버전에 적용된다.
6. 보관된 항목은 수정할 수 없다. **보관 복구 → 복구 실행**으로 다시 사용한다. 중단했던 예전 자동화는 재개하지 않으며 이후 새 이벤트부터 판단한다.

보관은 고객 계정 정지나 영구 삭제가 아니다. 같은 외부 회원 ID, 회사 연결, 상담·메시지·파일·거래·업무를 유지한다. 고객이 다시 문의하면 같은 고객으로 응대한다. 기존 업무는 자동 취소하지 않는다. 새 거래·업무·회사 관계의 연결 후보에서는 보관 항목을 제외하고 기존 연결은 유지할 수 있다. 목록 첫 100건 밖의 기존 연결도 편집 폼에서 임의로 해제하지 않는다.

## 서버 API와 SDK

직원 API는 `/api/customer-crm/{contacts|companies}` 및 `/{id}`, 서비스 API는 `/api/v1/crm/{contacts|companies}` 및 `/{id}`를 사용한다. 상세/변경 요청에는 `workspaceId`가 필요하다. 직원은 현재 사업 역할을, 서비스 키는 발급자의 현재 사업 역할과 해당 사업의 키 권한을 함께 확인한다.

| 작업 | 계약 | 역할 / 서비스 키 |
|---|---|---|
| 목록 GET | `workspaceId`, 선택 `q`, `before`, `archived=false|true|all` (기본 false) | 열람 이상 / read |
| 상세 GET | `workspaceId`, 선택 `before` (이력 커서) | 열람 이상 / read |
| 생성·연동 POST collection | 기존 외부 ID 멱등 upsert, 선택 `version` | 응대 이상 / create 또는 update |
| 편집 PATCH id | `workspaceId`, 필수 `version`, 변경할 필드 | 응대 이상 / update |
| 보관 POST id | `workspaceId`, `action: "archive"`, `version`, 선택 `reason` | 운영 관리 / delete |
| 복구 POST id | `workspaceId`, `action: "restore"`, `version`, 선택 `reason` | 운영 관리 / update |

상세 응답은 `{ item, history, hasMore, creationTracked, impact }`이다. 이력은 시각·UUID 내림차순 50건이며 마지막 행 ID를 `before`로 전달한다. 원래 생성 시각을 포함한 레코드는 유지하지만 마이그레이션 전 존재하지 않던 감사 이력을 만들지 않는다. `creationTracked=false`이면 추적 시작 전 생성 정보임을 화면에 알린다.

PATCH의 `externalId`, `id`, `orgId`, 출처·수정자·보관 시각 등은 변경할 수 없다. `attributes`를 보내면 전체 교체하며 빠진 키를 삭제한다. 보내지 않은 필드는 유지한다. 기존 collection upsert는 속성 병합을 유지한다. 두 방식 모두 최종 속성 크기를 검사한다. 연동 upsert는 보관된 고객을 동기화할 수 있지만 자동으로 복구하지 않는다. 명시적인 id PATCH는 보관된 항목에 409를 반환한다. 실제 값이 같거나 키/회사 배열의 순서만 달라지면 버전·이력·이벤트를 추가하지 않는다.

```ts
const detail = await client.contact(workspaceId, contactId);
await client.updateContact(contactId, {
    workspaceId,
    version: detail.item.version,
    attributes: { plan: "pro", score: 0, vip: false },
});
const latest = await client.contact(workspaceId, contactId);
await client.archiveContact(workspaceId, contactId, latest.item.version, "사용 종료 정리");
const archived = await client.contact(workspaceId, contactId);
await client.restoreContact(workspaceId, contactId, archived.item.version, "재개 요청");
await client.listContacts(workspaceId, { archived: "all", q: "가상 고객" });
```

회사에는 `company`, `updateCompany`, `archiveCompany`, `restoreCompany`, `listCompanies`를 사용한다. `listContacts/listCompanies`의 기존 before 문자열 인자도 호환된다. 모든 응답은 기존 `{success,data}` 계약을 유지한다. 서비스 API의 보관은 복구 가능하더라도 **delete 범위가 필요**하므로 기존 update 전용 키가 자동으로 보관 권한을 얻지 않는다.

## 자동화와 원자성

고객·회사 생성/편집/보관/복구는 원본, 필드 감사, 공통 활동, outbox를 같은 트랜잭션으로 저장한다. 출처는 서버에서 결정하며 호출자가 staff/API 출처나 수정자를 위조할 수 없다. 회사 관계 변경의 회사명은 수정 당시 값으로 보존한다.

자동화 실행에는 이벤트에서 확인한 고객/회사 ID를 기록한다. 보관은 같은 사업 잠금 안에서 관련 `queued`, `running`, `waiting`, `retry`를 cancelled로 바꾸고 임대를 해제한다. 워커가 먼저 조회했더라도 실제 행동 전 보관을 재확인한다. 보관/복구 관리 이벤트는 외부 outbox 이력에는 남지만 새로운 고객 자동화를 시작하지 않는다. 보관 중 고객/회사가 연결된 새 자동화와 모의 실행은 제외한다. 복구 후 중단 실행을 다시 실행하지 않는다.

이미 끝난 행동을 되돌리거나 전달 완료된 메시지를 회수하는 기능은 아니다. 고객/회사 보관으로 관련없는 전체 사업 자동화를 중단하지 않는다. 영구 삭제, 보존 기간/자동 파기, 전체 객체 복원은 별도 정책·구현 대상이다.

## 마이그레이션과 검토

`0103_crm_object_lifecycle.sql`을 앱보다 먼저 적용한다. 기존 고객·회사에 version 1, archived_at null을 추가하고 감사 테이블 및 자동화 실행의 subject ID를 만든다. 기존 실행은 저장 이벤트의 고객/회사/거래/업무/상담 관계에서 같은 조직·사업의 유효한 UUID만 연결한다. 잘못된 첫 후보 뒤의 유효한 후보도 확인하며, 확인 불가능한 관계를 추정해 연결하지 않는다.

현재는 dev 코드와 초안 PR 검토 대상이다. **실제 dev/운영 DB 마이그레이션·직원 배정·사이트 설치·운영 배포는 수행하지 않았다.** 사업 권한 0102가 선행되어야 한다. 보존 기간, 영구 파기 및 실제 데이터 전환 검수는 R14/R16에 남는다.

## 검증과 근거

- `node --import tsx scripts/check-customer-records.cjs`: SQL/API/SDK 19개. 필드/속성 이력·동시 수정·no-op·출처·역할/키 범위·사업 격리·50건 이력/100건 목록 커서·자동화 subject 이관·보관 경쟁/취소·복구 비재개·회원/메일/파일/거래/업무 연속성과 트랜잭션 롤백을 검사했다.
- 새 순수 단위 10개를 포함한 전체 1,085개, 기존 14개 회귀 검사, 타입·기능 lint·격리 빌드를 통과했다.
- Chrome에서 디하 속성 수정/삭제(0/false 포함)→필드 이력/공통 활동→보관 전 영향→대기 1건 중단→보관함/읽기 전용→복구, 두 화면 충돌/최신 불러오기, 회사 수정/보관/복구 및 백오랩의 별도 보관/복구·중단 실행을 확인했다. 직원 열람/응대와 관리 버튼 분리 및 응대 직원의 수정자 이력도 확인했다. 가상 고객·격리 PGlite만 사용하고 외부 발송은 없다.
- 구현 해시·로그·화면 증거는 `evidence-manifest.json`의 `customerRecordsQa`에 보존한다.

기존 리서치의 [Atomic CRM 스키마](https://github.com/marmelab/atomic-crm/blob/ec21c1ccaf97f1434d8f5faa6bec119e3df09644/supabase/schemas/01_tables.sql)와 [HubSpot 객체/관계 설명](https://knowledge.hubspot.com/records/understand-objects)을 공통 정보/활동 경계의 참고로 사용한다. [HubSpot의 복구 안내](https://knowledge.hubspot.com/records/restore-deleted-records)와 샌드비의 되돌릴 수 있는 영업 정보 보관 정책은 동일한 기능이라고 주장하지 않는다. 샌드비에 타사의 보존 기간을 임의로 적용하지 않았다. 원본 코드 복사가 아닌 독립 구현이다.
