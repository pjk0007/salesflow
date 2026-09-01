# REPORT — role 변경 즉시 반영 (tokenVersion)

- **사이클 ID**: `2026-09-01-token-version-revocation`
- **track**: Full (PLAN → DESIGN → DO → GAP → REVIEW)
- **완료일**: 2026-09-01

## 한 일

조직 멤버의 role이 바뀌면 **재로그인 없이 즉시 반영**되게 했다.

기존에는 `role`이 로그인 시점에 JWT payload로 구워지고 토큰 수명이 **30일**이라, 관리자가 admin을 member로 강등해도 그 사람이 로그아웃하지 않으면 최대 30일간 관리자 권한이 그대로 유지됐다. 승격은 불편한 정도지만 강등은 보안 문제다.

`organization_members.token_version` 컬럼을 두고 role이 바뀔 때 같은 UPDATE에서 증가시킨다. JWT에도 발급 시점의 값을 담아 관리자 경로에서 대조한다. 최종 behavior 13/13 통과, 테스트 116개 GREEN.

**커밋하지 않았다** — 변경 전체가 uncommitted 상태다.

## 핵심 설계 결정 3가지

**(a) `organization_members`에 저장** — `users`가 아니라. role 자체가 거기 살고, `requireAdmin`이 role과 버전을 **한 쿼리로** 읽을 수 있다(`users`면 2쿼리). 다중 조직 사용자가 생겨도 A조직 강등이 B조직 세션을 끊지 않는다.

**(b) 관리자 경로만 검증** — `getUserFromNextRequest`는 동기 함수이고 **164개 파일**이 쓴다. 여기에 DB 조회를 넣으면 전부 async 전환 + 모든 요청에 쿼리 1개다. role이 실제로 의미를 갖는 관리자 경로에만 비동기 헬퍼를 쓴다.

**(c) 기존 토큰은 `undefined`를 `0`으로 취급** — 전부 거부하면 전원 강제 로그아웃, 전부 통과시키면 배포 직전 토큰이 영원히 무효화를 피한다. `undefined = 0`이면 로그아웃 없이 구멍도 닫힌다(강등되면 DB가 1이 되어 `0 ≠ 1`).

부수 결정: `requireAdmin`이 role을 **JWT가 아니라 DB에서 다시 읽는다.** 이미 멤버십 행을 읽으므로 추가 쿼리 0이고, 호출부의 세부 분기(`user.role === "admin"` 같은 비즈니스 규칙)가 자동으로 최신 값을 본다.

## Gap이 잡아낸 결함 2건 — 이번 사이클의 본론

**둘 다 이번 작업의 목적 자체를 무력화하는 경로**였고, 커밋 전에 닫았다.

### 🔴 1. `users/[id]`가 role을 바꾸면서 무효화하지 않았다

`organization_members.role`을 UPDATE하는 **두 번째 경로**를 놓쳤다. 이 경로로 강등하면 버전이 그대로라 옛 토큰이 통과한다 — **B1이 여기서는 성립하지 않았다.** 게다가 이 route는 `owner` 승격까지 허용한다.

원인: DESIGN §8이 "무효화가 일어나지 않는 경로"를 3개 열거했지만 이건 목록에 없었다. **role 변경 경로 조사를 `org/members/*` 디렉토리로 한정한 것.**

수정 후 실측: `PATCH /api/users/{id} {role:admin}` → `token_version 0→1`. B12로 고정.

### 🔴 2. owner/admin 게이트 7곳이 조사에서 통째로 빠졌다

DESIGN §9의 분모가 `role === "member"` **한 문자열만** 실측해서, 같은 의미를 다르게 쓴 `role !== "owner" && role !== "admin"` 표기를 놓쳤다. `api-tokens` 4핸들러 + `users` 3핸들러.

특히 `api-tokens`가 심각하다. 강등된 admin이 옛 토큰으로 거기서 **조직 전체 스코프 API 토큰을 발급하면 role 무효화를 영구히 우회하는 자격증명**을 스스로 만들 수 있었다.

수정 후 실측:
```
강등 전: /api-tokens 200 · /users 200 · /org/settings 200
강등 후: /api-tokens 401 · /users 401 · /org/settings 401
```
B13으로 고정.

### 공통 원인 — 같은 교훈을 알고도 반복했다

선행 사이클 REPORT "배운 것" 3항이 **"100%는 분모의 함수다"**라고 적었고, 그 대응으로 DESIGN §9가 "전수 조사"를 명시적 산출물로 요구했다. 그런데 **정작 그 조사의 쿼리 자체가 좁았다.** 교훈을 문서에 적는 것과 실제로 적용하는 것은 다르다는 걸 확인한 사례다.

## REVIEW — 🔴 0 · 🟡 3 · 🟢 3

보안·동시성·회귀·마이그레이션에서 실제 결함 0건. 확인된 것들:

| 항목 | 결과 |
|---|---|
| 테넌트 격리 | 멤버십 조회가 `(orgId, userId)` 복합 조건. orgId 위조는 서명 검증이 막는다 |
| role 판정 | JWT의 role은 권한 판정에 **전혀 쓰이지 않는다**(DB 값만) |
| `isSuperAdmin` 우회 | `/api/admin/**`는 별개 축. `requireAdmin`은 특별 취급하지 않아 조직 role이 member면 403 |
| `org/switch` 세탁 | 새 토큰이 나오지만 **role이 member로 갱신**되어 권한 상승 없음(실측 확인) |
| 동시성 | `sql\`+1\``이 단일 UPDATE 안에서 원자적. 동시 변경 시 둘 다 반영되어 두 옛 토큰이 모두 무효화 |
| 회귀 | 13파일 전부 `getUserFromNextRequest` 0건, 게이트 잔존 0건. 남은 `user.role`은 전부 비즈니스 규칙 |

지적 3건은 전부 처리: import 포맷 오타, `isTokenVersionAcceptable`을 블랙리스트→화이트리스트, 미사용 `bumpTokenVersion` 제거(YAGNI).

## 덤으로 찾은 기존 버그

`auth/profile`의 이름 변경 재발급이 **한 번도 성공한 적이 없었다.**

```
Bad "options.expiresIn" option the payload already has an "exp" property.
```

`{...currentUser}` 스프레드가 `iat`/`exp`까지 넘겨 `jwt.sign`이 항상 예외를 던지고 있었다. DESIGN §6-#3이 "현재 동작 중이므로 새 위험은 아니다"라고 **가정**했는데, 구현 중 실제로 돌려보니 그 가정이 틀렸다. 명시적 필드 나열로 고쳤다.

## 검증

| 검증 | 결과 |
|---|---|
| `pnpm test` | **tests 116 / pass 116 / fail 0** |
| 커버리지 `auth-admin-rules.ts` | line **100%** / branch 95.83% / funcs **100%** |
| `npx tsc --noEmit` | exit 0 |
| `npx next build` | ✓ Compiled successfully |
| `verify-evidence.mjs` | unresolved 0 · uncited 0 · no-cmd-match 0 · uncovered 0 · dead-branch 0 |

**테스트 범위의 한계**: 자동 테스트는 순수 판정부(18케이스)뿐이다. `requireAdmin`·발급 8곳·route 26곳은 유닛 테스트가 없고 **curl 수동 실증**에 의존했다. 실제로 결함 2건이 유닛 테스트가 아니라 Gap 단계의 코드 조사에서 나왔다.

## 남은 것

### B8 잔여 리스크 — 데이터 축은 여전히 지연 반영

강등된 admin이 파티션 판정에서 "전체 허용"으로 최대 30일 남는다.

| 축 | 파일 수 | 상태 |
|---|---|---|
| 파티션 판정 | 17 | 지연 (의도됨) |
| `role === "member"` 게이트 (워크스페이스·필드·제품·트래커·광고) | 27 | 지연 (의도됨) |
| ~~owner/admin 게이트~~ | ~~7~~ | **이번에 닫음** |

**완화 1순위**: `requirePartitionAccess`가 이미 async + DB이므로, 거기서 `user.role !== "member"` 분기를 DB role로 바꾸면 데이터 축도 즉시 반영된다. 이미 도는 쿼리에 조인하면 되므로 diff 대비 효과가 압도적이다.

**대안**: `TOKEN_EXPIRY`를 30d → 1d로 줄이면 노출 창이 30배 줄고 `getUserFromNextRequest`는 그대로다.

### 기타

| 항목 | 판단 |
|---|---|
| `auth/me`의 role 폴백 | `myOrgs`에 현재 orgId가 없으면 JWT의 옛 role로 폴백. 관리자 route는 401로 막히므로 권한 구멍은 아니고 UI 표시만의 문제 |
| 26곳 분모의 지속성 | 앞으로 추가되는 관리자 API가 `requireAdmin`을 안 쓰면 조용히 구멍이 된다. lint 규칙 없이 목록 관리에만 의존 |
| `missing` 정책의 수명 | 배포 후 30일이 지나면 `tokenVersion` 없는 토큰은 존재할 수 없다. `isTokenVersionAcceptable`의 `"missing"`을 `false`로 바꾸는 게 정석이지만 안 바꿔도 위험 없음 |
| `withAuth` 통합 | `api-handler.ts`에 같은 역할 판정이 있는데 사용처 0곳. 별개 리팩터링 |

## 배운 것

**1. 교훈을 문서에 적는 것과 적용하는 것은 다르다.**

선행 사이클이 "100%는 분모의 함수다"를 REPORT에 남겼고, 이번 DESIGN §9가 그에 대응해 "전수 조사"를 명시적 산출물로 요구했다. 그런데 **조사 쿼리 자체가 `role === "member"` 한 문자열로 좁았고**, 같은 의미의 다른 표기(`role !== "owner" && role !== "admin"`)를 통째로 놓쳤다.

→ **접근 제어를 다룰 때 분모는 "특정 문자열"이 아니라 "그 값으로 분기하는 모든 표기"로 잡는다.** 문자열 grep 후 반드시 의미 기반 재조사를 한 번 더 돌린다.

**2. "이 상태를 바꾸는 경로가 몇 개인가"를 먼저 센다.**

`organization_members.role`을 UPDATE하는 곳이 2개였는데 1개만 봤다. 상태 변경 지점을 디렉토리로 추정하지 말고 **테이블·컬럼 기준으로 grep**해야 한다(`update(organizationMembers)` → 3건).

**3. 문서의 가정에 "확인만 하면 된다"고 적힌 것은 실제로 확인해야 한다.**

DESIGN이 `auth/profile`의 스프레드를 "현재 동작 중"으로 가정했는데 실제로는 항상 실패하던 코드였다. 가정을 명시한 것 자체는 좋았고, 구현 단계에서 실행해봤기에 발견했다.

**4. 관리자 경로만 막는 선택의 대가를 정확히 셌다.**

164개 파일 async 전환을 피하려고 관리자 경로만 막았고, 그 대가로 데이터 축이 지연 반영된다. PLAN·DESIGN에 명시했고 Gap이 노출 범위를 파일 수로 구체화했다(17 + 27). **범위를 좁힌 결정은 그 결정이 남기는 구멍의 크기를 수치로 적어둬야 나중에 판단할 수 있다.**

---

**주요 파일**
- 판정 코어: `src/lib/auth-admin-rules.ts`
- DB 어댑터: `src/lib/auth-admin.ts`
- 테스트: `src/lib/auth-admin.test.ts`
- 무효화 지점: `src/app/api/org/members/[id]/route.ts`, `src/app/api/users/[id]/route.ts`
- 마이그레이션: `drizzle/0066_org_member_token_version.sql`
