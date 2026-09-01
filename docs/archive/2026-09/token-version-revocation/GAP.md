# GAP — role 변경 즉시 반영 (tokenVersion)

- **사이클**: `2026-09-01-token-version-revocation`
- **분모**: `behaviors.json` B1~B13 (13건, B12·B13은 Gap 중 발견된 결함을 고정하며 추가) + DESIGN §10 파일 계획 + §9 전수 조사 계약
- **분석일**: 2026-09-01

```
unproven: 0   (13/13)
```

behaviors 기준 통과. 다만 **이번 회차의 본론은 분모 밖에서 발견된 결함 2건**이고, 둘 다 이번 사이클의 목적 자체를 무력화하는 경로였다. 커밋 전에 닫았다.

## 검증 실행 기록

| 항목 | 결과 |
|---|---|
| `npx tsx --test --experimental-test-coverage ... "src/**/*.test.ts"` | tests 116 / pass 116 / fail 0 |
| 커버리지 `auth-admin-rules.ts` | line **100.00** / branch 95.83 / funcs **100.00** |
| `node verify-evidence.mjs` | unresolved 0 · uncited 0 · no-cmd-match 0 · no-receipt 0 · uncovered 0 · dead-branch 0 |
| `npx tsc --noEmit` | exit 0 |
| `npx next build` | ✓ Compiled successfully |

## 1. behaviors 대조 — ✅ 13

| id | 대조 위치 |
|---|---|
| B1 | `auth-admin.ts` — `checkTokenVersion` → `!isTokenVersionAcceptable` → 401. 무효화는 `org/members/[id]`의 `set({ role, tokenVersion: sql\`+1\` })` |
| B2 | `auth/login`이 현재 버전을 담고 `requireAdmin`이 **DB role**로 판정 → member면 403(401 아님) |
| B3 | UPDATE가 방향 무관하게 `+1`. role 비교 분기 없음 |
| B4 | UPDATE의 WHERE가 `(userId=targetId, organizationId=user.orgId)` 복합 조건 |
| B5 | `checkTokenVersion(n, n) → "ok"` |
| B6 | `auth-admin-rules.ts`의 `undefined` 분기가 DESIGN §4-(c)와 문자 일치 |
| B7 | `Grep "generateToken(" src/app/api` → **정확히 8건**, 각 payload에 `tokenVersion` 존재 (8/8 대조표) |
| B8 | 일반 route가 `getUserFromNextRequest` 유지 — 의도된 지연 (§3 참조) |
| B9 | `org/members/[id]`의 기존 가드 3중(owner 대상 403 / role 허용값 제한 / 자기 자신 차단). 코드 추가 없음 |
| B10 | 순수 함수 18케이스 GREEN. DESIGN §13의 표와 테스트명이 1:1 |
| B11 | `auth/me`가 `myOrgs`에서 현재 조직 role을 뽑아 반환. 추가 쿼리 0 |
| B12 | `users/[id]`의 role UPDATE에 `sql\`+1\`` 추가 (아래 §2) |
| B13 | `api-tokens`·`users` 7핸들러를 `requireAdmin`으로 전환 (아래 §2) |

## 2. 🔴 분모 밖에서 발견된 결함 2건 (수정 완료)

### 2.1 `users/[id]`가 role을 바꾸면서 무효화하지 않았다

`src/app/api/users/[id]/route.ts`가 `organization_members.role`을 UPDATE하는 **두 번째 경로**인데 `token_version`을 올리지 않았다.

```ts
await db.update(organizationMembers)
    .set({ role })          // ← tokenVersion 증가 없음
```

영향:
- 이 경로로 강등하면 버전이 그대로라 `checkTokenVersion`이 `"ok"`를 내고 `requireAdmin`이 통과시킨다. **B1이 이 경로에서는 성립하지 않았다.**
- 이 route는 `role`을 `["owner","admin","member"]`로 받아 **owner 승격까지 가능**하다. `org/members/[id]`가 막는 owner 축을 여기선 열어둔다.

원인: DESIGN §8이 "무효화가 일어나지 않는 경로"를 3개 열거했지만 이 경로는 목록에 없었다. **role 변경 경로 조사를 `org/members/*` 디렉토리로 한정한 것.**

수정: 같은 UPDATE에 `tokenVersion: sql\`+1\`` 합침. `Grep "update(organizationMembers)"` → 3건 중 role을 바꾸는 2건 모두 적용 확인. B12로 고정.

실측: `PATCH /api/users/{id} {role:admin}` → `token_version 0→1`

### 2.2 owner/admin 게이트 7곳이 조사에서 통째로 빠졌다

DESIGN §9의 분모가 `role === "member"` **한 문자열만** 실측해서, 같은 의미를 다르게 쓴 `role !== "owner" && role !== "admin"` 표기를 놓쳤다.

| 파일 | 핸들러 | 성격 |
|---|---|---|
| `api-tokens/route.ts` | 2 | **조직 전체 스코프 API 토큰 발급·조회** |
| `api-tokens/[id]/route.ts` | 2 | 토큰 수정·폐기 |
| `users/route.ts` | 2 | 사용자 목록·생성 |
| `users/[id]/route.ts` | 1 | 사용자 수정 |

특히 `api-tokens`가 심각하다. 강등된 admin이 옛 토큰으로 여기 들어가 **조직 전체 스코프 토큰을 발급하면 role 무효화를 영구히 우회하는 자격증명을 스스로 만들 수 있다.** DESIGN이 "일반 데이터 관리"로 분류한 27파일과 성격이 다르다 — 조직 관리에 준한다.

수정: 7핸들러 전부 `requireAdmin`으로 전환. B13으로 고정.

실측:
```
강등 전: /api-tokens 200 · /users 200 · /org/settings 200
강등 후: /api-tokens 401 · /users 401 · /org/settings 401
```

### 공통 원인

**선행 사이클 REPORT "배운 것" 3항("100%는 분모의 함수다")이 지목한 것과 같은 실패 형태다.** 조사 대상을 한 문자열 패턴·한 디렉토리로 한정하면 같은 의미의 다른 표기를 반드시 놓친다. 이번엔 그 교훈을 알고도 같은 실수를 반복했다 — DESIGN §9가 "전수 조사"를 명시적 산출물로 요구했는데, 정작 그 조사의 **쿼리 자체가 좁았다.**

## 3. ⚠️ B8 잔여 리스크 — 실제 노출 범위 (수정 후 갱신)

PLAN·DESIGN이 "강등된 admin이 파티션 판정에서 전체 허용으로 최대 30일 남는다"고 명시했는데, 코드로 확인한 실제 범위는 이렇다:

| 축 | 파일 수 | 강등 반영 |
|---|---|---|
| 파티션 판정 (`user.role !== "member"` → 전체 허용) | 17 | 지연 (문서에 명시됨) |
| `role === "member"` 하드 게이트 (워크스페이스·필드·제품·트래커·광고) | 27 | 지연 (DESIGN §9가 범위 밖으로 인지) |
| ~~owner/admin 게이트~~ | ~~4~~ | **→ 이번에 닫음 (§2.2)** |

즉 §2.2를 고친 뒤 남는 것은 **파티션 데이터 축 + 일반 데이터 관리 27파일**이고, 이는 PLAN·DESIGN이 의도적으로 범위 밖에 둔 영역과 일치한다.

## 4. DESIGN 대비 이탈

### ✅ 파일 계획 일치 — 스코프 크립 0

신규 4개, 스키마·타입 3개, 발급 8곳, 관리자 13곳, `auth/me`. `git status`의 변경 집합이 DESIGN §10과 완전 일치했다. (§2의 수정으로 `users`·`api-tokens` 4파일이 추가됐고, 이는 Gap이 발견한 결함 대응이라 정당한 확대다.)

### ➕ 설계보다 나은 초과 구현 2건

- **`org/settings` DELETE·`billing/cancel`의 403 문구 보존** — DESIGN §7 표는 403을 일률적으로 `"접근 권한이 없습니다."`로 정했으나, 구현은 `auth.status === 403`일 때만 기존 문구(`"조직 삭제는 소유자만 가능합니다."`)로 되돌린다. 회귀 방지로 옳다.
- **`auth/profile`의 jwt.sign 예외 수정** — DESIGN은 "확인만" 하기로 했으나 실제로는 `{...currentUser}`가 `iat`/`exp`를 넘겨 **항상 실패하던 기존 버그**였다. 발급 8곳 중 하나가 동작하지 않으면 B7이 성립할 수 없으므로 필수 확대.

### 문서 부정합 (정정 완료)

`PROGRESS.md`의 "관리자 route 13곳 전환(17개 핸들러)" — 실제 `requireAdmin(` 호출은 19곳이었다. 코드는 정상이고 기록만 틀렸다.

## 5. 후속 대상

1. **B8의 남은 지연 영역** — 파티션 축(17파일)과 일반 데이터 관리(27파일). 완화 옵션 두 가지가 DESIGN §16에 있고, 그중 **`requirePartitionAccess`가 이미 async이므로 거기서 DB role을 읽는 방법**이 diff 대비 효과가 가장 크다.
2. **분모 정의 방식의 개선** — 다음에 접근 제어를 다룰 때는 조사 쿼리를 `role === "member"` 같은 한 문자열이 아니라 **"JWT의 role로 분기하는 모든 표기"**로 잡아야 한다. 이번에 `role !== "owner" && role !== "admin"`를 놓친 것이 근거다.
3. **`auth/me`의 폴백** — `myOrgs`에 현재 orgId가 없으면(조직에서 제거됨) JWT의 옛 role로 폴백한다. 관리자 route는 401로 막히므로 권한 구멍은 아니고 UI 표시만의 문제. DESIGN §16의 "401 시 로그아웃 유도"와 같은 항목.
