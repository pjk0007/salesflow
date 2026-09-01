# PLAN — role 변경 즉시 반영 (tokenVersion)

- **track**: Full
- **사이클 ID**: `2026-09-01-token-version-revocation`

## 목표

조직 멤버의 role이 바뀌면 그 사람의 기존 JWT를 무효화해 **재로그인 없이 즉시 반영**되게 한다.

현재 `role`은 로그인 시점에 `organizationMembers.role`을 읽어 JWT payload에 구워 넣는다(`src/lib/auth.ts:28`). 토큰 수명이 **30일**(`auth.ts:17`)이라, 관리자가 admin을 member로 강등해도 **그 사람이 로그아웃하지 않으면 최대 30일간 관리자 권한이 그대로 유지된다.** 승격은 불편한 정도지만 강등은 보안 문제다.

앞선 사이클(`partition-member-permissions`)에서 급한 403을 "해당 사용자에게 admin 임시 부여"로 대응했으므로, 그 부채를 회수하려면 강등이 실제로 즉시 먹혀야 한다.

파티션 권한은 매 요청 DB를 조회하므로 이미 즉시 반영된다(실측 확인). 이번 작업은 **조직 role 축만** 다룬다.

## 핵심 설계 결정

**`users.tokenVersion` 컬럼을 두고, role이 바뀌면 증가시킨다.** JWT payload에도 같은 값을 넣어, 검증 시 둘이 다르면 거부한다.

**검증은 관리자 경로에서만 한다.** `getUserFromNextRequest`는 **동기 함수**이고 **164개 파일**이 쓴다. 여기에 DB 조회를 넣으려면 전부 async로 바꿔야 해서 diff가 폭발하고, 모든 요청에 쿼리가 1개씩 늘어난다. 반면 role이 실제로 의미를 갖는 곳은 `role === "member"`로 차단하는 39개 파일뿐이고, 그중에서도 **강등 시 즉시 막아야 하는 것은 조직·빌링·권한 관리 계열**이다. 거기에만 비동기 헬퍼를 쓴다.

즉 강등당한 admin은:
- 조직 설정·멤버 관리·빌링·권한 관리 → **즉시 401** (재로그인 요구)
- 일반 데이터 조회 → 다음 로그인까지 admin으로 동작

후자가 남는 건 의도된 트레이드오프다. 데이터 접근은 이미 파티션 권한(매 요청 DB 조회)이 관장하고, 거기서 admin은 "전체 허용"이라 강등 반영이 늦으면 **접근 범위가 넓은 상태로 최대 30일** 남는다. 이 잔여 리스크는 아래 리스크 절에 명시하고 후속 판단에 맡긴다.

**owner는 강등 대상이 아니다.** `org/members/[id]` PATCH가 `target.role === "owner"`를 이미 막는다.

## 단계별 작업

1. **스키마 + 마이그레이션** — `users.tokenVersion integer not null default 0`
2. **JWT payload 확장** — `JWTPayload`에 `tokenVersion` 추가. 발급 8곳이 현재 값을 담도록 수정
3. **비동기 검증 헬퍼** — `requireAdmin(req)` — 토큰 파싱 + `tokenVersion` 대조 + role 확인을 한 번에
4. **관리자 route 전환** — 조직·빌링·권한 관리 계열 12개 파일에 헬퍼 적용
5. **role 변경 시 무효화** — `org/members/[id]` PATCH에서 대상자의 `tokenVersion` 증가
6. **기존 토큰 호환** — payload에 `tokenVersion`이 없는(이번 배포 전 발급된) 토큰 처리 방침 확정

## 건드릴 파일

### 신규

| 파일 | 요지 |
|---|---|
| `drizzle/0066_user_token_version.sql` | `users.token_version` 컬럼 |
| `src/lib/auth-admin.ts` | `requireAdmin` 비동기 헬퍼 + `bumpTokenVersion` |
| `src/lib/auth-admin.test.ts` | 순수 판정부 테스트 |

### 수정 — 토큰 발급 (8곳, `tokenVersion` 담기)

`auth/login`, `auth/signup`, `auth/profile`, `org/switch`, `org/settings`, `org/create`, `org/invite-accept`, `org/invitations/accept`

### 수정 — 관리자 검증 적용 (12곳)

`org/route.ts`, `org/settings`, `org/onboarding-complete`, `org/members`, `org/members/[id]`, `org/invitations`, `org/invitations/[id]`, `billing/issue-billing-key`, `billing/subscribe`, `billing/delete-billing-key`, `member-scopes`, `member-scopes/[id]`

### 수정 — 기타

| 파일 | 요지 |
|---|---|
| `src/lib/db/schema.ts` | `tokenVersion` 컬럼 |
| `src/types/index.ts` | `JWTPayload.tokenVersion` |
| `src/lib/auth.ts` | 발급 시 payload 통과 (기존 시그니처 유지) |

## behavior 목록

| id | 설명 | priority |
|---|---|---|
| B1 | admin을 member로 강등하면 그 사람의 기존 토큰으로 관리자 API가 401 | P1 |
| B2 | 강등 후 재로그인하면 정상 동작하고, 새 토큰은 member 권한을 갖는다 | P1 |
| B3 | member를 admin으로 승격해도 기존 토큰은 무효화된다 (양방향) | P1 |
| B4 | role을 바꾸지 않은 다른 멤버의 토큰은 영향받지 않는다 | P1 |
| B5 | `tokenVersion`이 일치하면 관리자 API가 정상 통과한다 | P1 |
| B6 | payload에 `tokenVersion`이 없는 기존 토큰의 처리가 방침대로 동작한다 | P1 |
| B7 | 토큰 발급 8곳이 전부 현재 `tokenVersion`을 담는다 | P1 |
| B8 | 강등된 admin도 일반 데이터 조회는 계속 가능하다 (의도된 범위 제한의 명시) | P2 |
| B9 | owner는 role 변경 대상이 아니므로 무효화가 발생하지 않는다 | P2 |
| B10 | 판정 순수 함수가 버전 비교를 정확히 한다 (같음/다름/미보유) | P1 |

## 리스크/불확실성

- **잔여 리스크 — 데이터 접근은 여전히 지연 반영된다.** 강등된 admin이 파티션 권한 판정에서 "전체 허용"으로 남는다(최대 30일). 관리자 경로만 막는 이번 선택의 대가이고, 완전히 없애려면 `getUserFromNextRequest`를 async로 전환해야 한다. **이 잔여분을 수용할지는 구현 후 재판단한다.**
- **기존 토큰 호환** — 배포 시점에 이미 발급된 토큰에는 `tokenVersion`이 없다. 전부 거부하면 모든 사용자가 강제 로그아웃되고, 전부 통과시키면 배포 직전 발급된 토큰이 30일간 무효화를 피한다. 어느 쪽을 택할지 DESIGN에서 확정한다.
- **다중 조직** — `organizationMembers`는 사용자가 여러 조직에 속할 수 있다. `tokenVersion`을 `users`에 두면 A조직에서 강등당한 사람이 B조직 세션까지 끊긴다. 조직별로 두려면 `organizationMembers.tokenVersion`이 맞는데, 그러면 JWT의 `orgId`와 함께 봐야 한다. DESIGN에서 확정한다.
- **`org/switch`의 재발급** — 조직 전환 시 새 토큰을 발급하므로 전환 대상 조직의 버전을 담아야 한다.
- **검증 누락 위험** — 관리자 route 12곳에만 적용하므로, 앞으로 추가되는 관리자 API가 이 헬퍼를 안 쓰면 조용히 구멍이 된다. 앞 사이클의 교훈("가드를 제거·추가할 때 목록을 1:1 대조")을 여기에도 적용해야 한다.

## 검증 방법

- **순수 판정 로직** — 버전 비교 함수(토큰 값 vs DB 값, 미보유 케이스)를 `node:test`로 먼저 고정. B10
- **API 레벨** — 로컬에서 admin 토큰을 발급받아 관리자 API 200 확인 → 강등 → 같은 토큰으로 401 확인 → 재로그인 후 정상 확인. B1~B7, B9
- **회귀** — `pnpm test` 기존 102개 유지, `npx tsc --noEmit`, `npx next build`

## 범위 밖

- 멤버 제거 시 토큰 무효화 (사용자 결정: role 변경만)
- 비밀번호 변경 시 다른 기기 세션 종료
- refresh 토큰 도입 / 토큰 수명 단축
- `getUserFromNextRequest`의 async 전환 및 164개 파일 마이그레이션
- 파티션 권한 축 (이미 즉시 반영됨)
- 앞 사이클이 남긴 우회 경로 5건(bulk-delete 등) — 별도 사이클
