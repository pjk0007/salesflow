# REVIEW — 파티션별 멤버 권한

- **사이클 ID**: `2026-09-01-partition-member-permissions`
- **리뷰일**: 2026-09-01
- **범위**: uncommitted diff 전체 — 수정 21개 + 신규 10개

## 요약

🔴 4 · 🟡 6 · 🟢 3 지적. 이 중 **이번 변경이 만든 결함 7건은 커밋 전에 수정**했고, 기존 결함 5건(우회 경로)은 후속 사이클로 넘긴다.

## 🔴 수정 완료

### 1. 구조 변경에 allow 기본이 번져 member가 파티션을 삭제할 수 있었다

`partitions/[id]`의 member 차단을 걷어내면서 생성만 allow 기본에서 빼고 수정·삭제는 빼지 않았다. **권한 행 0건(= 모든 조직의 기본 상태)에서 임의 member가 임의 파티션을 삭제**할 수 있었다. 실측으로 200 + 행 삭제 확인.

→ `canAccessPartition`에 `denyByDefault` 추가, 구조 변경 경로에 적용. B21로 고정. 수정 후 403 + 행 보존 확인.

### 2. `folderId` 무검증 → 자기 권한 상승

`PATCH /api/partitions/[id]`가 `folderId`를 검증 없이 UPDATE했다. member가 자기 파티션을 자신이 folder scope를 가진 폴더로 옮겨 **스스로 권한을 만들어낼 수 있었다.** 같은 사이클의 생성 경로는 이 검증을 하는데 수정 경로만 빠져 있었다.

구버전은 member 차단 뒤에 있어 admin만 도달 가능했으나, 이번에 차단을 걷어내며 노출면이 새로 생겼다.

→ 같은 워크스페이스 소속 검증 추가. B22로 고정. 400 + `folder_id` 유지 확인.

### 3. 폴더 이름 노출

`workspaces/[id]/partitions` GET이 파티션은 필터하면서 `folderList`는 그대로 반환했다. 접근 불가 파티션만 담긴 폴더가 `partitions: []`로 남아 **폴더 이름이 노출**됐다.

→ member에게는 볼 수 있는 파티션이 하나도 없는 폴더를 제외. 원래 비어 있던 폴더는 그대로 노출(정상).

### 4. `revokeScope` 실패를 조용히 삼킴

`useMemberScopeTree`의 하위 정리 루프가 반환값을 버렸다. 실패 시 토스트도 없이 상위 부여 + 하위 잔존 상태가 남는다 — 주석이 스스로 우려한 바로 그 상태. CLAUDE.md "에러 swallow 금지" 위반.

→ `toast.error` + 조기 반환.

## 🟡 수정 완료

### 5. scope 부여에 트랜잭션 부재

`POST /api/member-scopes`가 for 루프로 upsert해 중간 실패 시 부분 적용이 남았다. 권한은 부분 적용이 가장 위험한 축이다.

→ `db.transaction()`으로 감쌈.

### 6. UI가 폴더 "생성"을 실제와 다르게 표시

`canCreateInWorkspace`는 workspace scope만 인정하는데, UI는 폴더·파티션에도 "모든 권한(생성 포함)"을 똑같이 보여줬다. 폴더에 full 권한을 받은 member가 그 안에 파티션을 못 만드는데 화면은 만들 수 있다고 말한다.

→ `createHint()` 추가 — scope 유형별로 "생성"의 의미를 구분해 안내.

### 7. 미사용 코드 2건

- `DELETE /api/member-scopes?userId=` — 사용처 0건, DESIGN 계약에도 없음 (GAP 1회차 지적) → 제거
- `partitions/route.ts`의 미사용 import `folders` → 제거

## 🟡 후속 사이클로 이관

### 8. 우회 경로 5건 (기존 결함)

GAP 1회차 §3과 동일. `bulk-delete` · `records/[id]/{memos,journey,events,visitor-activity}` · `email/send`·`alimtalk/send`의 org 미검증 · `sse` · `auto-enrich`.

이번 변경이 만든 것이 아니고 diff에도 없다. 다만 **§1 수정 전까지는 우선순위가 올라가 있었다** — 이제 구조 변경이 막혔으므로 1회차 판단(후속 대상)으로 되돌아간다.

특히 `email/send`·`alimtalk/send`의 org 미검증은 권한 축과 무관한 **테넌트 격리 결함**이라 별건으로 처리하는 편이 낫다.

### 9. `scheduled-registration`의 느슨한 검증

`/^\d{2}:\d{2}$/`가 `"99:99"`를 통과시키고 `countPerDay`에 상한이 없다. 기존 PATCH 로직을 그대로 옮긴 것이라 회귀는 아니지만, member에게 열린 `config` 경로가 새로 생겨 **도달 가능한 주체가 넓어졌다.** 후속에서 범위 검사 추가.

### 10. `inheritedFrom`이 org scope를 반영하지 않음

UI에서 org scope를 부여하지 않기로 했으나(DESIGN §15), API로 직접 부여된 org scope가 있으면 트리는 "권한 없음"으로 그린다. 표시 결함이라 P2.

## 🟢 확인했고 문제없음

- **`requireFolderAccess`의 `id: -1` 트릭** — 3중 방어로 매칭 불가능(쿼리가 partition scope를 안 뽑음 / `validateMemberScopes`가 실존 파티션만 저장 / serial PK는 음수 불가). 근거를 주석으로 명시했다.
- **`findRedundantScopes`의 과잉 삭제 없음** — workspace 부여 시 해당 트리에서만, folder 부여 시 그 폴더의 파티션만 대상.
- **N+1 억제** — 목록 API는 `loadOrgScopes` 1회 + 메모리 필터로 파티션 수와 무관하게 쿼리 1개. 판정 경로는 member만 +1쿼리, 관리자는 +0.

## 남은 부채

| 항목 | 판단 |
|---|---|
| `partition-access.ts` 400줄 (200줄 가이드 초과) | 순수부는 이미 분리됐다. `validateMemberScopes`/`validateScopeTarget`을 한 번 더 뺄지는 후속에서 |
| `findRedundantScopes`·`permissionsToLevel`이 순수 함수인데 테스트 0건 | 훅 파일 안에 있어 React import를 끌고 온다. 별 파일로 빼면 node:test로 고정 가능 |
| `drizzle` 제약 이름 불일치 | SQL은 `member_scopes_org_user_scope_unique`, schema.ts는 이름 생략(Drizzle 기본값). 향후 `drizzle-kit generate`가 drop/create diff를 낼 수 있다 |
