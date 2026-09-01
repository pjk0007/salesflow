# REVIEW — role 변경 즉시 반영 (tokenVersion)

- **사이클 ID**: `2026-09-01-token-version-revocation`
- **리뷰일**: 2026-09-01
- **범위**: uncommitted diff — 수정 27개 + 신규 4개

## 요약

**🔴 0 · 🟡 3 · 🟢 3.** 보안·동시성·회귀·마이그레이션에서 실제 결함 0건. 지적된 3건은 전부 정리 수준이고 커밋 전에 처리했다.

## 🔴 보안 — 우회 경로 없음 (확인 완료)

| 항목 | 근거 |
|---|---|
| 테넌트 격리 | 멤버십 조회가 `and(organizationId = payload.orgId, userId = payload.userId)` 복합 조건. `payload`는 서명 검증을 통과한 값이라 orgId 위조는 키 없이 불가능하고, `(organization_id, user_id)` unique로 행이 최대 1개 |
| role 판정 | `payload.role`이 아니라 `membership.role`(DB 값)로 판정. JWT의 role은 권한 판정에 **전혀 쓰이지 않는다** |
| fail-closed | `hasMinRole("guest","member")` → `false` (`?? -1`). `api-handler.ts`의 `?? 0`과 의도적으로 다르고 테스트로 고정 |
| `isSuperAdmin` 우회 | `/api/admin/**`는 `isSuperAdmin` 별개 축. `requireAdmin`은 super admin을 특별 취급하지 않아 조직 role이 member면 403. **변경으로 넓어지지 않았다** |
| `org/switch` 세탁 | 전환 대상 조직의 현재 role·version을 DB에서 다시 읽어 담는다. 강등된 사람이 switch해도 **role이 member로 갱신**되므로 권한 상승 없음. 실측 확인: `role = member, tokenVersion = 1` |

## 🔴 동시성 — 문제 없음

- `sql\`tokenVersion + 1\``이 단일 UPDATE 안에서 평가되어 PostgreSQL이 행 락을 잡고 원자적으로 증가시킨다. 두 관리자가 동시에 바꿔도 증가가 유실되지 않는다(+2). 최종 role은 나중 트랜잭션 값이지만 **어느 쪽이 이기든 두 옛 토큰이 모두 무효화**되어 안전한 방향으로 수렴한다.
- `requireAdmin` 조회와 role 변경 사이의 TOCTOU는 최대 1요청, 밀리초 단위. 없애려면 요청 전체를 직렬화해야 하므로 수용한다.

## 🔴 회귀 — 13파일 전수 확인

13개 파일 전부 `getUserFromNextRequest` 0건, 인증/인가 게이트 잔존 0건. 남은 `user.role` 참조는 전부 **비즈니스 규칙**이고 이제 DB 값이라 오히려 정확해졌다:

- `org/members/[id]:50,55,117` — admin의 승격/동급 변경 제한
- `org/invitations:89` — admin 초대는 owner만

호출부가 쓰는 필드(`userId`/`orgId`/`email`/`name`/`role`)는 `{...payload, role: DB값}` 반환으로 전부 보존된다. `org/settings`의 3핸들러 분리(GET·PATCH=admin, DELETE=owner)도 누락 없음.

## 🔴 `auth/profile` 수정 — 필드 누락 없음

`JWTPayload` 7개 필드를 전부 나열했고, required 누락은 tsc가 구조적으로 잡는다. `...(currentUser.isSuperAdmin && { isSuperAdmin: true })` 조건부 전개는 `login/route.ts:83`의 기존 패턴과 동일.

## 🔴 마이그레이션 — 안전

`ADD COLUMN IF NOT EXISTS ... integer DEFAULT 0 NOT NULL`은 PG 11+에서 테이블 rewrite 없는 fast path(행 수 11이라 어차피 무의미). journal `idx:66`/`when:1770952900000`이 단조 증가하고 tag가 파일명과 일치. 배포 순서(마이그레이션 먼저)는 DESIGN §16에 명시.

## 🟡 지적 3건 — 전부 처리 완료

| # | 내용 | 처리 |
|---|---|---|
| 1 | `org/settings/route.ts:4` import 포맷 오타 (`import {generateToken`) — 미사용 import를 정리하는 스크립트가 만든 것 | 수정 |
| 2 | `isTokenVersionAcceptable`이 `result !== "stale"` 블랙리스트 — union이 3개로 닫혀 있어 실질 위험은 0이지만, fail-closed를 자처하는 함수라 값이 늘면 조용히 통과한다 | 화이트리스트(`=== "ok" \|\| === "missing"`)로 변경 |
| 3 | `bumpTokenVersion` 사용처 0곳 — DESIGN이 "role 변경 없이 세션만 끊는 경우"용으로 정의했으나 그런 호출자가 없다. YAGNI 위반 | 제거 |

## 🟢 nit — 기록만

- `auth/me:42`의 `currentMembership?.role ?? user.role` 폴백 — `myOrgs`에 현재 orgId가 없다는 건 조직에서 제거됐다는 뜻인데 JWT의 옛 role로 폴백한다. 관리자 route는 `requireAdmin`이 401로 막으므로 **권한 구멍은 아니고 UI 표시만의 문제**. DESIGN §16의 "401 시 로그아웃 유도"와 같은 항목으로 후속.
- `drizzle/meta/_journal.json` 파일 끝 개행 없음 — 기존 상태이며 마이그레이션마다 diff 노이즈로 남는다.
- `org/settings`·`billing/cancel`의 `auth.status === 403` 문구 분기가 두 곳에 복제 — 지금은 2곳뿐이라 추상화하지 않는 게 맞다. **3번째가 생기면** `requireAdmin`에 `forbiddenMessage` 옵션을 넣는 편이 낫다.

## 컨벤션

`any` 0건, 빈 catch 0건, 한국어 에러 메시지 유지, `{success,data}`/`{success,error}` 준수, 신규 파일 최장 95줄, `.tsx` 변경 없음, 신규 `console.log` 0건.

## 특기 — 가정을 검증했더니 가정이 틀렸던 사례

DESIGN §6-#3이 `auth/profile`의 `{...currentUser}` 스프레드를 두고 "현재 동작 중이므로 새 위험은 아니다"라고 가정했다. 구현 중 실제로 돌려보니 **`iat`/`exp`가 함께 스프레드되어 `jwt.sign`이 항상 예외를 던지던 상태**였다:

```
재발급 실패: Bad "options.expiresIn" option the payload already has an "exp" property.
```

즉 이름 변경 시 JWT 재발급이 한 번도 성공한 적이 없다. 이번 사이클이 만든 버그가 아니지만 발견해 명시적 필드 나열로 고쳤다.

## 남은 부채

| 항목 | 판단 |
|---|---|
| 13곳 분모의 지속성 | 앞으로 추가되는 관리자 API가 `requireAdmin`을 안 쓰면 조용히 구멍이 된다. lint 규칙 없이 목록 관리에만 의존한다 — DESIGN §9가 인정한 한계 |
| `role === "member"` 남은 27파일 | B8이 명시한 의도된 지연 영역. 이번 범위 밖이 맞다 |
| `scripts/resend-unsent.ts` untracked | 이번 사이클과 무관한 기존 파일. 커밋 시 분리 필요 |
