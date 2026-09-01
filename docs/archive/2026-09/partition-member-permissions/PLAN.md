# PLAN — 파티션별 멤버 권한

- **track**: Full
- **사이클 ID**: `2026-09-01-partition-member-permissions`

## 목표

조직 `member` 역할 사용자에게 **파티션 단위로** 접근/편집 권한을 부여할 수 있게 한다. 현재는 조직 3단계 role(owner/admin/member)만 있어서, member는 파티션 구조 변경(생성·수정·삭제)만 막히고 **조직 내 모든 파티션의 레코드를 읽고·쓰고·전체 삭제할 수 있다.** 이 구멍을 파티션 단위 권한으로 메운다.

기본 정책은 **allow 기본**이다. 권한 행이 하나도 없는 파티션은 지금과 똑같이 모든 member가 접근할 수 있고, 관리자가 특정 파티션에 권한을 명시적으로 설정한 순간부터 그 파티션은 명시된 사용자에게만 열린다. 기존 사용자 동작이 바뀌지 않고 데이터 마이그레이션도 필요 없다.

권한 판정 로직은 이미 성숙한 `checkTokenAccess`(`src/lib/auth.ts:197-226`)의 계층 상속 모델(org→workspace→folder→partition, read/create/update/delete 4비트)을 사용자 권한으로 옮겨 재사용한다.

## 핵심 설계 결정

**기존 `partition_permissions` 테이블은 폐기하고 새 테이블을 만든다.** 이 테이블(`src/lib/db/schema.ts:308-326`)은 초기 마이그레이션부터 있었지만 `src/` 전체에서 참조가 0건인 죽은 테이블이다. `permissionType varchar(20)` 단일값 모델이라 read/create/update/delete 조합을 표현할 수 없고, `api_token_scopes`의 jsonb 4비트 모델과도 불일치한다. 컬럼을 갈아엎느니 `api_token_scopes`와 같은 형태의 새 테이블 `member_scopes`를 만드는 편이 낫다. 기존 `partition_permissions`·`workspace_permissions`는 이번 사이클에서 손대지 않고 그대로 둔다(삭제는 범위 밖).

**allow 기본의 판정 규칙** — 특정 파티션에 대해:
1. `owner`/`admin`은 항상 통과 (파티션 권한 무관)
2. 해당 파티션에 걸린 제한이 하나도 없으면 → 통과 (allow 기본)
3. 제한이 있으면 → 그 사용자에게 해당 permission 비트가 있는 scope가 있을 때만 통과

여기서 "해당 파티션에 걸린 제한"은 그 파티션을 덮는 scope(파티션 자신 / 상위 폴더 / 상위 워크스페이스)가 조직 내에 한 행이라도 존재하는지로 판단한다. 즉 **파티션 하나에 권한을 걸면 그 파티션만 제한 모드로 전환**되고 나머지 파티션은 여전히 allow다.

## 단계별 작업

1. **스키마 + 마이그레이션** — `member_scopes` 테이블 추가, drizzle SQL 작성, `meta/_journal.json` 등록
2. **권한 판정 코어** — `src/lib/partition-access.ts` 신규. `checkMemberPartitionAccess(user, partitionId, permission)` + scope 검증 헬퍼. 순수 판정 로직은 DB와 분리해 테스트 가능하게 둔다
3. **route-local 헬퍼 통합** — 7곳에 복붙된 `verifyOwnership`/`verifyPartitionAccess`/`verifyPartition`을 공통 함수로 승격하고 권한 체크를 그 안에 삽입
4. **API 권한 적용** — 파티션 데이터 접근 route에 permission 매핑 적용 (아래 파일 계획)
5. **레코드 우회 경로 차단** — `/api/records/[id]` GET/PATCH/DELETE는 role 체크가 전혀 없고 파티션을 경유하지 않고 레코드에 직접 접근한다. 여기를 막지 않으면 UI만 가린 껍데기가 된다
6. **권한 관리 API** — 조회/부여/수정/삭제
7. **권한 관리 UI** — `OrgTeamTab` 멤버 행 드롭다운 + `PartitionNav` 컨텍스트 메뉴, 같은 다이얼로그를 다른 초기 필터로 재사용
8. **예약 등록 설정 접근 완화** — 이번 사이클을 촉발한 실제 문제. `PATCH /api/partitions/[id]`가 파티션 전반을 바꾸는 API라 member에게 통째로 열 수 없으므로, `scheduledRegistrationConfig` 전용 경로를 분리해 `update` 권한이 있는 member가 쓸 수 있게 한다

## 건드릴 파일

### 신규

| 파일 | 요지 |
|---|---|
| `src/lib/db/schema.ts` (수정) | `memberScopes` 테이블 추가 |
| `drizzle/00XX_member_scopes.sql` | 마이그레이션 |
| `src/lib/partition-access.ts` | 권한 판정 코어 + `verifyPartitionAccess` 공통 헬퍼 |
| `src/app/api/member-scopes/route.ts` | GET(목록) / POST(부여) |
| `src/app/api/member-scopes/[id]/route.ts` | PUT(수정) / DELETE(회수) |
| `src/app/api/partitions/[id]/scheduled-registrations/config/route.ts` | 예약 등록 설정 전용 PATCH |
| `src/components/settings/MemberScopeDialog.tsx` | 권한 부여/편집 다이얼로그 |
| `src/hooks/useMemberScopes.ts` | SWR 훅 |

### 수정 — 권한 체크 삽입

| 파일 | 메서드 | 요구 permission |
|---|---|---|
| `src/app/api/partitions/[id]/records/route.ts` | GET / POST | read / create |
| `src/app/api/partitions/[id]/records/group-counts/route.ts` | GET | read |
| `src/app/api/partitions/[id]/records/export/route.ts` | GET | read |
| `src/app/api/partitions/[id]/records/bulk-import/route.ts` | POST | create |
| `src/app/api/partitions/[id]/records/delete-all/route.ts` | POST | delete |
| `src/app/api/partitions/[id]/resolved-fields/route.ts` | GET | read |
| `src/app/api/partitions/[id]/scheduled-registrations/route.ts` | GET / DELETE | read / delete |
| `src/app/api/partitions/[id]/scheduled-registrations/upload/route.ts` | POST | create |
| `src/app/api/records/[id]/route.ts` | GET / PATCH / DELETE | read / update / delete |
| `src/app/api/partitions/route.ts` | GET | 목록에서 접근 불가 파티션 제외 |
| `src/app/api/workspaces/[id]/partitions/route.ts` | GET | 동일 |

### 수정 — UI

| 파일 | 요지 |
|---|---|
| `src/components/settings/OrgTeamTab.tsx` | 멤버 행 드롭다운에 "파티션 권한" + 권한 안내 문구(`:331-335` 하드코딩) 갱신 |
| `src/components/records/PartitionNav.tsx` | 컨텍스트 메뉴에 "권한 관리" |
| `src/components/records/scheduled-registration/ui/ScheduledRegistrationDialog.tsx` | 설정 저장을 신규 config 경로로 변경 |

## behavior 목록

| id | 설명 | priority |
|---|---|---|
| B1 | 권한 행이 없는 파티션은 member가 기존대로 레코드 조회 가능 (allow 기본) | P1 |
| B2 | 파티션에 다른 사용자 권한이 걸리면, 권한 없는 member의 레코드 조회가 403 | P1 |
| B3 | 권한을 받은 member는 해당 파티션 레코드 조회 가능 | P1 |
| B4 | permission 비트별 분리 — read만 가진 member의 레코드 생성(POST)은 403 | P1 |
| B5 | owner/admin은 파티션 권한과 무관하게 항상 통과 | P1 |
| B6 | workspace scope를 받은 member는 그 워크스페이스 하위 모든 파티션에 접근 (계층 상속) | P1 |
| B7 | folder scope를 받은 member는 그 폴더 하위 파티션에 접근 | P2 |
| B8 | 타 조직의 파티션 id로 scope를 만들려 하면 거부 (org 경계 검증) | P1 |
| B9 | scope 수정(PUT)도 부여(POST)와 동일한 org 경계 검증을 거친다 | P1 |
| B10 | 파티션 권한이 없는 member에게 `/api/records/[id]` PATCH·DELETE가 403 (우회 경로 차단) | P1 |
| B11 | 파티션 목록 API가 접근 불가 파티션을 제외하고 반환 | P2 |
| B12 | member가 `update` 권한으로 예약 등록 설정을 저장할 수 있다 (원래 문제 해결) | P1 |
| B13 | 예약 등록 설정 전용 경로가 `scheduledRegistrationConfig` 외 필드는 수정하지 않는다 | P1 |
| B14 | member 권한 관리 API 자체는 owner/admin만 호출 가능 | P1 |
| B15 | 권한 관리 UI에서 멤버에게 파티션 권한을 부여하면 목록에 반영된다 | P2 |

## 2차 범위 추가 (2026-09-01, 사용자 요청)

1차 구현 후 사용자가 "워크스페이스 권한을 줬으면 파티션 생성도 되어야 한다"고 요청해 범위를 넓혔다. behavior B16~B20 추가.

- **파티션·폴더 생성** — workspace scope의 `create` 비트로 판정
- **파티션·폴더 수정/삭제** — 해당 대상의 `update`/`delete` 비트로 판정 (기존 "구조 변경은 관리자 전용" 정책 변경)
- **핵심 판단**: 구조 생성은 **allow 기본을 적용하지 않는다.** 대상이 아직 존재하지 않아 "덮는 scope가 없으면 통과" 규칙을 쓸 수 없고, 적용하면 권한을 받지 않은 member 전원이 파티션을 만들 수 있게 된다.
- **UI 전면 개편** — 드롭다운 3단 콤보가 불편하다는 피드백을 받아 트리 체크박스로 교체

## 리스크/불확실성

- **allow 기본의 판정 비용** — "이 파티션에 제한이 걸려 있나"를 매 요청 확인해야 한다. 파티션 자신 + 상위 폴더 + 상위 워크스페이스를 덮는 scope 존재 여부를 한 번의 쿼리로 끝내야 한다. 요청당 쿼리가 늘어나는 건 불가피하고, JWT에 넣는 선택지는 없다(토큰 30일 만료, `src/lib/auth.ts:17`)
- **B11의 성능** — 파티션 목록에서 건별로 권한을 확인하면 N+1이 된다. 조직의 scope를 한 번에 읽어 메모리에서 필터링해야 한다
- **f894553이 고친 것과 같은 결함의 재현** — 그 커밋은 (1) org 경계 미검증 (2) 수정 API가 검증을 우회 두 건을 고쳤다. 권한 부여 API와 수정 API가 갈리므로 같은 함정이 그대로 재현될 수 있다. B8·B9가 이걸 겨냥한다
- **`withAuth` 채택 여부** — `src/lib/api-handler.ts`에 잘 만들어진 HOF가 있는데 사용처가 0건이다. 이번에 전면 마이그레이션하면 diff가 폭발하므로, 이번 사이클에서는 **채택하지 않고** 기존 route 스타일을 따른다
- **member 목록 조회 권한** — 권한 부여 UI는 멤버 목록이 필요한데 `/api/org/members`는 member를 막고 있다. 관리자만 UI를 쓰므로 문제없지만, `PartitionNav` 컨텍스트 메뉴는 member에게도 보이므로 메뉴 자체를 관리자에게만 노출해야 한다

## 검증 방법

- **순수 판정 로직** — scope 배열과 파티션 정보를 받아 boolean을 내는 함수는 DB 없이 테스트 가능하다. B1~B8을 여기서 **TDD로 먼저 고정**한다. 러너는 이미 있는 `pnpm test`(`tsx --test "src/**/*.test.ts"`, package.json:11)를 그대로 쓴다 — `node:test` 방식이고 새 의존성이 없다. 테스트 파일은 `src/lib/partition-access.test.ts`. 이 때문에 판정 코어는 DB 조회와 분리된 순수 함수로 설계해야 한다 — scope 배열과 파티션의 `{folderId, workspaceId}`를 인자로 받는 형태
- **API 레벨** — 로컬 DB에 member 계정과 파티션을 만들고 `curl`로 각 permission 조합을 확인. B9·B10·B12·B13·B14
- **UI** — member 계정으로 로그인해 예약 등록 설정 저장이 되는지 육안 확인. B15와 B12의 UI 측면

## 범위 밖

- 죽은 `partition_permissions`·`workspace_permissions` 테이블 삭제
- 조직 role 체계(owner/admin/member) 자체의 변경
- API 토큰 스코프(`api_token_scopes`) 로직 변경 — 별도 축이고 잘 동작 중
- 파티션 무관 route 47곳의 `role === "member"` 차단 (트래커·빌링·광고·제품 등)
- `withAuth` 전면 마이그레이션
- 조직 멤버 엑셀 일괄 초대 (앞선 대화에서 나온 별건)
