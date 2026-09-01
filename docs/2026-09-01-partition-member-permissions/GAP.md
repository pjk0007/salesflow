# GAP — 파티션별 멤버 권한

- **사이클 ID**: `2026-09-01-partition-member-permissions`
- **분석일**: 2026-09-01
- **분모**: `behaviors.json` B1~B15 (15항목, 증감 없음)

## 결론

```
unproven: 0   (Match Rate 100% · 참고 수치)
```

**behaviors.json 기준 통과.** 15/15 전부 코드로 대조됐고 실행 근거가 있다.

다만 통과와 별개로 **behaviors 밖에 우회 경로 5건**이 남았다. PLAN §목표가 선언한 "member가 조직 내 모든 파티션의 레코드를 읽고·쓰고·삭제할 수 있는 구멍"이 완전히는 메워지지 않았다 — §3 참조. 원인은 구현 실수가 아니라 **DESIGN 단계의 route 전수 조사가 `/api/partitions/*`와 `/api/records/[id]`에 한정됐던 것**이다.

## 검증 실행 기록

| 검증 | 결과 |
|---|---|
| `npx tsx --test --experimental-test-coverage --test-reporter=spec --test-reporter-destination=stdout --test-reporter=lcov --test-reporter-destination=.devkit/lcov.info "src/**/*.test.ts"` | **tests 91 / pass 91 / fail 0** |
| 커버리지 `partition-access-rules.ts` | line 98.04% / branch 94.12% / **funcs 100%** |
| `node /Users/jaehun/Projects/devkit/scripts/verify-evidence.mjs` | **unresolved 0 · uncited 0 · no-cmd-match 0 · no-receipt 0** / uncovered 2 · dead-branch 2 |
| `npx tsc --noEmit` | exit 0 |
| `npx next build` | ✓ Compiled successfully, 신규 route 3개 포함 |

## 1. behaviors 대조 — ✅ 15 / ⚠️ 0 / ❌ 0

| id | 판정 | 대조 위치 |
|---|---|---|
| B1 | ✅ | `return !covered` — `partition-access-rules.ts:82` |
| B2 | ✅ | `covered = true` 후 미매칭 → false (rules.ts:76-82), route가 403 변환 (`partition-access.ts:134`) |
| B3 | ✅ | `scope.userId === user.userId && scope.permissions[permission]` — rules.ts:79 |
| B4 | ✅ | 비트 인덱싱이 "그 비트"만 검사 rules.ts:79 + records POST가 `"create"` 전달 |
| B5 | ✅ | rules.ts:72 role 분기 + `partition-access.ts:122`가 member 아니면 scope 조회 skip |
| B6 | ✅ | `scopeCoversPartition` workspace 분기 rules.ts:51-52 |
| B7 | ✅ | folder 분기 + `folderId !== null` 명시 배제 rules.ts:53-55 |
| B8 | ✅ | `validateMemberScopes`의 `workspaces.orgId` 조인 검증 `partition-access.ts:239-259` + `validateScopeTarget`(:275-295) |
| B9 | ✅ | PUT이 POST와 **동일한** `validateMemberScopes` 호출 — `member-scopes/[id]/route.ts:39-49` |
| B10 | ✅ | `requireRecordAccess`가 `workspaces.orgId`로 검증, GET/PATCH/DELETE 3개 전부 적용 |
| B11 | ✅ | `partitions/route.ts:33-39`(folderId select 추가 확인) + `workspaces/[id]/partitions/route.ts:49` 그룹핑 전 필터 |
| B12 | ✅ | `config/route.ts:30` — `requirePartitionAccess(..., "update")` |
| B13 | ✅ | `.set({ scheduledRegistrationConfig, updatedAt })` 하드코딩, 본문에서 키 하나만 추출 — 구조적 보장 |
| B14 | ✅ | 관리 API 5개 핸들러 전부 상단 role 체크 |
| B15 | ✅ | `OrgTeamTab` → `MemberScopeDialog` → `useMemberScopeEditor` → 모든 변이가 `await mutate()` 재검증 |

**unproven: 0.**

### uncovered 2 / dead-branch 2 — 계측 아티팩트로 판정

지목 위치는 `rules.ts:76`(`continue`)과 `:78`(`return true`). lcov의 `SF:` 블록이 **트랜스파일 결과 기준**이라 행 번호가 소스와 어긋난다. 근거:

- lcov `FN:` 목록에 `__export`·`__copyProps`·`__toCommonJS` 등 esbuild CJS 래퍼가 있다 — 소스에 없는 함수다.
- 같은 함수가 두 번 등록된다: `FN:40,canAccessPartition` / `FN:55,canAccessPartition`.
- `FNH:13 / FNF:13` — **함수 커버리지 100%**, `canAccessPartition`은 `FNDA:24`(24회 실행).

직접 실행으로도 확인했다:
```
내-scope-매칭(return true) 경로 → true | 기대 true
덮지않음(continue) 경로 → true | 기대 true
```

판정에 반영하지 않는다. 다만 **이 러너 조합(tsx + node:test)에서 lcov 행 번호를 신뢰할 수 없다**는 사실은 남는다 — 앞으로 `target` 라인 근거로 lcov를 쓰면 위양성이 계속 난다.

## 2. DESIGN 이탈

### ✅ `partition-access-rules.ts` 분리 — 타당

DESIGN §11이 이미 예고했다("200줄 근접 시 순수부를 분리 후 re-export"). 실제 사유(테스트가 `@/lib/db`를 끌고 오면 node:test에서 못 돎)는 더 강한 근거다. `partition-access.ts:22-34`가 전부 re-export하므로 **DESIGN이 명시한 import 경로(`@/lib/partition-access`)가 그대로 유효**하고, route 13곳이 전부 그 경로를 쓴다. 파일 크기 103줄 / 296줄로 200줄 가이드에 맞다.

### ✅ 파일 계획 대조 — 누락 0

신규 8개 전부 존재, 수정 대상 13개 route 전부 가드 삽입. 스키마·journal(`idx:65`, `when:1770952800000`)이 DESIGN §3과 문자 단위 일치.

### ✅ `PartitionNav` 제외 — B15에 영향 없음

B15의 계약은 "부여하면 목록에 반영된다"이지 "진입점이 2개"가 아니다. 오히려 DESIGN §15가 걱정하던 "`PartitionNav`가 role을 몰라 member에게 메뉴가 보이는 사고" 리스크가 통째로 사라졌다.

### ⚠️ B15의 육안 검증 미완 — behaviors.json이 스스로 밝힘

DESIGN §13이 B15를 "육안"으로 정의했으므로 계약대로면 미완이다. Playwright 부재로 다이얼로그 열림 상태의 렌더는 확인하지 못했다. UI 마크업은 유닛 테스트 대상이 아니라는 원칙에 따라 ❌로 잡지 않되, **한계로 남긴다.** 대체 근거: API 흐름 전량(POST→GET→PUT→DELETE) 실증 + `next build` ✓ + `tsc` 0 + `/settings/organization?tab=team` 200.

## 3. ❗ 권한 체크 누락 경로 — 후속 사이클 대상

`/api/v1/*`(API 토큰 축, PLAN 범위 밖)·webhook·public form을 제외하고, **사용자 JWT로 도달 가능한 구멍 5건**.

### 🔴 A. `POST /api/records/bulk-delete` — B10과 같은 등급

`src/app/api/records/bulk-delete/route.ts:19-22`

```ts
const deleted = await db
    .delete(records)
    .where(and(inArray(records.id, ids), eq(records.orgId, user.orgId)))
    .returning({ id: records.id, partitionId: records.partitionId });
```

role 체크 0건, 파티션 권한 0건. **`orgId`만 맞으면 조직 내 임의 파티션의 레코드를 id 배열로 무제한 삭제**한다. B10이 `/api/records/[id]` DELETE를 막았는데 이 route가 같은 일을 일괄로 해준다 — `delete-all`과 `records/[id]` DELETE를 동시에 우회하는 최단 경로이고 **파괴적 작업**이라 우선순위 최상.

DESIGN §11 파일 계획에 이 route가 아예 등장하지 않는다.

### 🟠 B. `/api/records/[id]/*` 형제 경로 5개

전부 `records.orgId` 단독 검증만 한다 — B10이 본체를 막아도 부속 데이터로 우회된다.

| route | 메서드 | 노출 |
|---|---|---|
| `records/[id]/memos/route.ts:26,73` | GET/POST | 제한 파티션 레코드의 메모 조회·작성 |
| `records/[id]/memos/[memoId]/route.ts:28` | DELETE | 메모 삭제 |
| `records/[id]/journey/route.ts:70` | GET | 여정 전체(트래커 방문·이메일 로그 조인) |
| `records/[id]/events/route.ts:33` | GET | 이벤트 이력 |
| `records/[id]/visitor-activity/route.ts:27` | GET | 방문자 활동 |

### 🟠 C. `email/send` · `alimtalk/send` — **파티션 권한 이전에 org 경계 결함**

`src/app/api/email/send/route.ts:102`, `src/app/api/alimtalk/send/route.ts:59`

```ts
const recordList = await db.select().from(records)
    .where(inArray(records.id, recordIds));    // ← org 필터가 아예 없다
```

templateLink는 `workspaces.orgId`로 검증하면서 정작 레코드는 org 검증이 통째로 빠졌다. **이번 사이클이 만든 게 아닌 기존 결함**이며, 파티션 권한 축과 무관한 **테넌트 격리 문제**라 별건으로 더 급할 수 있다. f894553이 고친 것과 같은 계열이다.

### 🟡 D. `GET /api/sse?partitionId=`

`src/app/api/sse/route.ts:13-18` — 로그인만 확인하고 `partitionId`를 문자열 그대로 `addClient`에 넘긴다. org 검증조차 없어 임의 파티션의 실시간 이벤트를 구독할 수 있다.

### 🟡 E. `/api/records/auto-enrich`

GET/POST는 `workspaces.orgId`로 파티션 존재만 확인하고 파티션 권한이 없다. `auto-enrich/[id]` PUT/DELETE는 `recordAutoEnrichRules.orgId`만 보고 파티션을 경유조차 안 한다.

### 지금 사고가 안 나는 이유

**allow 기본 덕분에 오늘은 무해하다.** 권한 행이 0건이면 전부 기존과 동일하게 동작한다. 문제는 관리자가 **첫 권한을 거는 순간** — 그때 `/api/partitions/*`와 `/api/records/[id]`는 403을 내는데 A~E는 200을 낸다. 권한이 걸린 파티션일수록 우회로의 가치가 커진다.

### 권장 처리 순서

1. **A(bulk-delete)** — 파괴적이라 최우선. id별 `requireRecordAccess`는 N+1이니 `records ⋈ partitions`로 partitionId 집합을 뽑아 파티션 단위로 `"delete"` 검사.
2. **B** — `requireRecordAccess(user, recordId, "read"|"update"|"delete")` 기계적 교체. 함수가 이미 있어 diff가 작다.
3. **C** — 권한과 무관한 테넌트 격리 버그로 떼어 별건 처리.
4. D·E는 P2.

## 4. ➕ 설계 밖 구현

| 항목 | 위치 | 평가 |
|---|---|---|
| `DELETE /api/member-scopes?userId=` (사용자별 전체 회수) | `member-scopes/route.ts:156-182` | DESIGN §9의 API 계약 4개에 없다. role 체크·org 필터는 제대로 걸려 안전하지만 **문서에도 behaviors에도 없고 `useMemberScopes`에서 호출하지 않아 사용처 0건** — YAGNI 위반. 제거 검토 대상 |
| `validateScopeTarget` | `partition-access.ts:275-295` | DESIGN §8 본문이 예고한 검증. 별도 함수로 뺀 것은 구현 재량 — ➕ 아님 |

**미사용 import 1건**: `partitions/route.ts:2`의 `folders`. `tsc`는 통과, lint 대상(품질 이슈라 `/review` 몫).

## 5. 범위 밖 준수 — ✅ 전량

| PLAN "범위 밖" | 확인 |
|---|---|
| `partition_permissions`·`workspace_permissions` 삭제 | ✅ `schema.ts:289,308` 그대로 |
| 조직 role 체계 변경 | ✅ 변경 0 |
| `api_token_scopes` 로직 변경 | ✅ `src/lib/auth.ts`·`api-tokens/` diff 0바이트 |
| 파티션 무관 route 47곳의 member 차단 | ✅ 손대지 않음 |
| `withAuth` 전면 마이그레이션 | ✅ 사용처 여전히 0건 |
| 엑셀 일괄 초대 | ✅ 없음 |

DESIGN §15의 org scope 결정도 지켜졌다 — `MemberScopeType`은 `"workspace" | "folder" | "partition"`으로 **UI에서 org 제외**(`useMemberScopes.ts:4`), 스키마·`scopeCoversPartition`·`validateMemberScopes`는 org를 그대로 지원.

## 다음

**unproven 0 → 재분석 불필요.** `/review`로 진행.

§3은 이번 사이클의 미달이 아니라 **후속 사이클 대상**이다. behaviors가 아니라 설계 단계의 route 조사 범위가 원인이므로, 다음 사이클은 "파티션 데이터에 도달하는 모든 경로 전수 차단"을 명시적 목표로 잡아야 한다.


---

# 2회차 — B16~B22 (구조 변경 권한) + UI 개편

- **분석일**: 2026-09-01 (2회차)
- **분모**: `behaviors.json` B1~B22 (22항목). 1회차 B1~B15는 회귀만 확인.

## 결론

```
unproven: 0   (22/22)
```

이번 회차의 본론은 통과 여부가 아니라 **발견된 결함 2건과 그 수정**이다. 둘 다 이번 변경이 만든 것이고, 커밋 전에 고쳤다.

## 검증 실행 기록

| 검증 | 결과 |
|---|---|
| `npx tsx --test --experimental-test-coverage ... "src/**/*.test.ts"` | **tests 102 / pass 102 / fail 0** (1회차 91 → 102) |
| `node verify-evidence.mjs` | unresolved 0 · uncited 0 · no-cmd-match 0 · no-receipt 0 · uncovered 0 · dead-branch 0 |

## 2.1 B16~B20 대조 — ✅ 전부 구현

| id | 대조 위치 |
|---|---|
| B16 | `canCreateInWorkspace` — `partition-access-rules.ts` |
| B17 | 같은 함수의 `permissions.create` + scopeType 화이트리스트가 partition/folder scope를 구조적으로 배제 |
| B18 | `partitions/[id]/route.ts` GET `read` / PATCH `update` / DELETE `delete` |
| B19 | 생성 = `requireWorkspaceCreateAccess`, 수정/삭제 = `requireFolderAccess` |
| B20 | `canCreateInWorkspace`에는 `covered` 변수 자체가 없다 — allow 기본이 원리적으로 들어올 자리가 없음 |

## 2.2 🔴 발견 1 — 구조 변경에 allow 기본이 번졌다 (수정 완료)

`partitions/[id]`의 `role === "member"` 차단 3곳을 제거하면서 **생성만** allow 기본에서 빼내고 **수정·삭제는 빼지 않았다.** 그 결과:

> **권한 행이 0건인 상태 — 즉 모든 조직의 기본 상태 — 에서 임의의 member가 임의의 파티션을 삭제할 수 있었다.**

실측(수정 전):
```
DELETE /api/partitions/48  (권한 행 0건, member 토큰)
→ {"success":true}  http=200
→ DB 행 수: 0        ← 실제로 삭제됨
```

파티션 삭제는 하위 레코드까지 CASCADE로 날아가는 비가역 작업이라, 1회차 §3-A(`bulk-delete`)와 같은 등급이거나 그 이상이다. 판정 축이 1회차와 정반대로 뒤집혔던 셈이다 — 1회차는 "권한을 걸어야 노출"(미래 리스크), 이 결함은 "권한을 안 걸어야 노출"(현재 리스크).

**수정**: `canAccessPartition`에 `denyByDefault` 옵션을 추가하고 구조 변경 경로(파티션 PATCH·DELETE, 폴더 수정·삭제)에 적용. B21로 계약 고정.

실측(수정 후):
```
DELETE /api/partitions/49  → 403 "이 파티션에 대한 권한이 없습니다." · DB 행 보존
PATCH  이름 변경           → 403
권한 부여 후 PATCH         → 200 (정상 동작 유지)
```

## 2.3 🔴 발견 2 — `folderId` 무검증으로 자기 권한 상승 (수정 완료)

`PATCH /api/partitions/[id]`가 `folderId`를 `Number()` 변환만 하고 그대로 UPDATE했다. 대상 폴더가 같은 워크스페이스인지, 같은 org인지 검증이 없었다.

같은 사이클의 **생성** 경로는 `eq(folders.workspaceId, workspaceId)`로 정확히 이걸 검증한다 — 수정 경로만 빠져 있었다.

이 코드 자체는 이전부터 있었지만, 구버전은 `role === "member"` 차단 뒤에 있어 admin만 도달 가능했다. **이번에 그 차단을 걷어내며 노출면이 새로 생겼다.**

공격 경로: member가 자기 파티션의 `folderId`를 자신이 folder scope를 가진 폴더로 바꾸면 `scopeCoversPartition`의 folder 분기가 매칭되면서 **그 파티션에 대한 권한을 스스로 만들어낸다.**

**수정**: 같은 워크스페이스 소속 폴더인지 검증. B22로 고정.

실측(수정 후):
```
PATCH {"folderId": 8}  (다른 워크스페이스의 폴더)
→ 400 "폴더를 찾을 수 없습니다." · folder_id NULL 유지
```

## 2.4 ✅ `requireFolderAccess`의 `id: -1` 트릭 — 안전

3중 방어로 매칭 불가능:
1. `requireFolderAccess`의 쿼리가 `org`/`workspace`/`folder` 3종만 SELECT — `partition` scope는 애초에 목록에 없다
2. `validateMemberScopes`가 실존 파티션만 저장하므로 `scopeId = -1` 행은 DB에 존재할 수 없다
3. serial PK는 음수가 될 수 없다

다만 안전성이 20줄 떨어진 쿼리의 암묵 계약에 걸려 있어, 그 근거를 주석으로 명시했다.

## 2.5 UI 트리 로직

- **`findRedundantScopes` 과잉 삭제 없음** — workspace 부여 시 해당 트리에서만, folder 부여 시 그 폴더의 파티션만 대상.
- **❌→✅ `revokeScope` 실패 무시 (수정 완료)** — 정리 루프가 반환값을 버려 실패해도 조용히 넘어갔다. 전역 규칙 "에러 swallow 금지" 위반. `toast.error` + 조기 반환 추가.
- **⚠️ `inheritedFrom`이 org scope를 반영하지 않는다** — UI에서 org scope를 부여하지 않기로 했으나(DESIGN §15), API로 직접 부여된 org scope가 있으면 트리는 "권한 없음"으로 그린다. 표시 결함이라 P2, 후속.

## 2.6 1회차 §3 우회 경로 5건 — ❌ 전부 그대로

A(`bulk-delete`) · B(`records/[id]/{memos,journey,events,visitor-activity}`) · C(`email/send`·`alimtalk/send` org 미검증) · D(`sse`) · E(`auto-enrich`) 전량 미조치. 1회차에서 후속 사이클 대상으로 분류한 것이라 이번 회차의 미달은 아니다.

## 2.7 문서 정합성 (조치 완료)

`DESIGN.md:450`이 "`role === "member"` 차단은 유지 — 파티션 구조 변경은 관리자 전용"이라고 적었는데 구현이 이를 뒤집었다. 사용자 요청에 의한 의도적 변경이므로 `PLAN.md`에 "2차 범위 추가" 절을 넣어 근거를 남겼다.

## 다음

이번 사이클은 여기서 종료. 후속 사이클 대상:

1. **1회차 §3 A~E 우회 경로 5건** — 특히 A(`bulk-delete`)와 C(org 미검증)
2. **role 변경의 즉시 반영** — JWT에 `role`이 구워져 있고 토큰 수명이 30일이라, 강등해도 최대 30일간 옛 권한이 유지된다. `tokenVersion` 방식으로 처리하기로 사용자와 합의
3. `inheritedFrom`의 org scope 반영 (P2)
