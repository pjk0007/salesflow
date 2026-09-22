# REVIEW — docs/2026-09-22-ai-quota-bigint/ · 2026-09-22 (1회차)

범위: working tree 미커밋 변경분 6개 파일
- `drizzle/0069_ai_usage_quotas_bigint.sql` (신규)
- `drizzle/meta/_journal.json`
- `src/lib/db/schema.ts`
- `src/lib/ai/quota-limits.ts` (신규)
- `src/lib/ai/quota-limits.test.ts` (신규)
- `src/lib/ai/quota.ts`

판정: 🔴 1 · 🟡 3 · 🟢 2 · 확인 필요 2

검증 통과 항목(문제 없음): journal 정합성, bigint 정밀도, SQL 문법, 테스트 컨벤션, `any` 부재, 보안. 근거는 맨 아래 "검증 통과" 절에 정리.

## 🔴 버그 (1)

- `src/lib/ai/quota-limits.ts:11` + `src/lib/db/migrate.ts:110-112` — **마이그레이션이 실패해도 앱이 뜨고, 그 상태에서 Enterprise 조직의 AI 라우트가 전부 500이 된다.** 실패 체인을 한 줄씩 확인했다:
  1. `migrate.ts:110-112`가 `console.error`만 하고 rethrow하지 않는다 → 0069가 실패해도 부팅은 성공, `total_tokens`/`quota_limit`는 int4로 남는다.
  2. `quota.ts:31-35` — Enterprise 조직의 첫 AI 호출에서 기존 행의 `quotaLimit`(10억) ≠ 코드값(50억)이므로 **반드시** `UPDATE ... SET quota_limit = 5000000000`이 실행된다.
  3. int4 컬럼에 5e9 → PostgreSQL `22003 integer out of range` → `checkTokenQuota()`가 throw.
  4. `src/app/api/ai/generate-email/route.ts:13`의 `await checkTokenQuota(user.orgId)`는 **try 블록 밖**이다(generate-alimtalk·generate-webform·generate-product·generate-email-stream·research-company 모두 동일 패턴). unhandled throw → Next.js 기본 500. CLAUDE.md의 `{ success: false, error }` 응답 규약도 깨지고, 한국어 에러 메시지도 안 나간다.

  즉 이 변경은 "마이그레이션이 반드시 성공한다"를 무언의 전제로 삼는데, 바로 그 전제를 `migrate.ts`가 보장하지 않는다. 실패해도 부팅 로그의 `[migrate] 마이그레이션 에러:` 한 줄 외에는 신호가 없어 **배포 직후가 아니라 Enterprise 고객의 첫 AI 호출 시점에 터진다.**

  제안(택1): (a) `migrate.ts:111`에서 `throw err`로 바꿔 스키마 불일치 상태로는 뜨지 않게 하거나, (b) 0069를 먼저 단독 배포해 적용을 확인한 뒤 코드(50억)를 배포하는 2단계 배포로 순서를 강제한다. `quota-limits.ts:4-6` JSDoc이 이 위험을 정확히 서술해두고도 코드로는 아무 대비가 없다.

## 🔴 보안 (0)

이상 없음. 구체적으로 확인한 것:
- `src/app/api/ai/usage/route.ts:6-9` — 인증 후 `user.orgId`로만 조회. 요청 본문/쿼리의 orgId를 받지 않아 IDOR 없음.
- `getQuotaLimitForOrg()`의 모든 쿼리가 `eq(subscriptions.orgId, orgId)` 등 drizzle 바인딩. 문자열 결합·사용자 입력 없음 → injection 없음.
- 한도 상향의 자가 권한 상승 경로 확인: `plans` 테이블에 쓰는 API/스크립트가 **없고**(전수 grep), `src/app/api/billing/subscribe/route.ts:8-10`은 `requireAdmin` + 유료 플랜은 빌링키 필수(`:66-72`) + 금액은 DB의 `targetPlan.price`. 사용자가 임의로 Enterprise가 될 수 없다.

## 🟡 컨벤션 (3)

- `src/lib/ai/quota-limits.ts:10-12` — 분기 키가 `plans.name`인데 이건 **표시용 컬럼**이다(`schema.ts:1091` `varchar(50)`, UNIQUE 없음). 안정 식별자는 `plans.slug`(`schema.ts:1092`, `.unique()`)이고 실제로 `billing/subscribe/route.ts:24`도 slug로 조회한다. 플랜 표시명을 `'Enterprise'` → `'Enterprise 플랜'` 같이 바꾸는 순간 Enterprise 고객이 **조용히** Free 한도(1천만)로 떨어져 AI가 막힌다. 로직을 새 모듈로 분리한 지금이 `slug` 기준(`getQuotaLimitForPlanSlug` + `'enterprise'`/`'pro'`)으로 바꿀 타이밍이다.
- `src/lib/ai/quota.ts:12` — 한도 상수가 두 곳에 흩어졌다. 플랜별 한도는 `quota-limits.ts`로 뽑았는데 "활성 구독 없음 → `100_000`"만 `quota.ts`에 인라인으로 남아 테스트도 없다. 게다가 의미가 역전돼 있다: 구독 없음 = 10만인데 **알 수 없는 플랜명 = 1천만**(`quota-limits.ts:13`)으로 100배 관대하다. 같은 "폴백"인데 값이 100배 차이나는 건 의도인지 확인이 필요하고, 의도라면 두 값 모두 `quota-limits.ts`에 모으는 게 맞다.
- `src/lib/ai/quota-limits.ts:4-6` — JSDoc이 `drizzle/0069_ai_usage_quotas_bigint.sql:1-6`의 주석과 같은 내용(마이그레이션 번호·int4 상한·실패 시 증상)을 중복 서술한다. 마이그레이션이 스쿼시되거나 번호가 바뀌면 이쪽이 먼저 썩는다. "bigint 컬럼을 전제한다" 정도의 불변 사실만 남기고 번호는 SQL 파일 쪽에 두는 편이 낫다. (JSDoc 자체는 규칙에 부합 — 호출부에서 안 보이는 계약이고 TS 타입 재기술도 없다. `@returns`의 "토큰 수" 단위도 타입에 없는 정보라 정당하다.)

## 🟢 nit (2)

- `src/components/settings/AiUsageTab.tsx:27-30` — `formatTokens()`에 B(십억) 단위가 없어 Enterprise 한도가 `5000.0M`으로 찍힌다. 변경분 밖이지만 이 작업이 만든 숫자라 같이 보는 게 맞고, GAP.md의 B8 미증명 지점과 동일하다. `>= 1_000_000_000` 분기 추가면 끝난다.
- `drizzle/0069_ai_usage_quotas_bigint.sql:1-6` — 주석 6줄이 SQL 2줄보다 길다. 내용 자체는 전부 why(왜 두 컬럼인지, 왜 한 문장인지, 리라이트가 왜 싼지)라 규칙 위반은 아니나, 3-4행의 `getQuotaLimitForOrg()` 동작 설명은 코드 쪽 JSDoc과 겹쳐 한쪽만 남겨도 된다.

## 확인 필요

- `drizzle/0069_ai_usage_quotas_bigint.sql:7-9` — `ALTER COLUMN ... TYPE`은 ACCESS EXCLUSIVE 락 + 테이블 리라이트이고, drizzle 마이그레이터는 **대기 중인 모든 마이그레이션을 단일 트랜잭션**으로 실행한다(`node_modules/drizzle-orm/pg-core/dialect.js:60`). `lock_timeout` 설정이 없어, 배포 중 구버전 인스턴스가 `ai_usage_quotas`에 트랜잭션을 잡고 있으면 ALTER가 무한 대기하고 그 뒤 모든 접근이 락 큐에 밀린다. SQL 주석의 "행 수가 org × 월 수라 ms 단위"는 리라이트 시간에 대해선 맞지만 **락 획득 대기**는 별개다. 운영 인스턴스 수와 롤링 배포 방식에서 무시 가능한지 확인 바란다. (`SET lock_timeout = '3s';`를 앞에 두면 최악의 경우 마이그레이션만 실패하고 락 폭주는 막는다 — 단 그 실패가 🔴 항목의 침묵 경로를 탄다.)
- `src/lib/ai/quota.ts:51-56` ↔ `:58-82` — `checkTokenQuota()`와 `updateTokenUsage()` 사이에 원자성이 없어, 동시 AI 요청이 각자 한도 통과 후 누적하면 한도를 넘길 수 있다. **변경분 밖의 기존 문제**이고 이번 변경으로 악화되지는 않지만(초과 폭은 한도 크기가 아니라 동시 요청 수에 비례), 쿼터가 비용 통제 수단이라 알고 남겨두는 것인지 확인해둘 값어치는 있다.

## 검증 통과 (문제 없음 — 근거)

지시받은 4개 항목은 전부 실제로 확인했고 결함이 없다. 억지로 지적하지 않는다.

1. **journal 정합성 ✅** — `_journal.json` 신규 엔트리 `idx: 69` / `version: "7"` / `when: 1773200000000` / `tag: "0069_ai_usage_quotas_bigint"` / `breakpoints: true`. tag가 파일명과 정확히 일치하고(`readMigrationFiles`가 `${folder}/${tag}.sql`로 해석 — `node_modules/drizzle-orm/migrator.js:14`), `when`이 0068의 `1773100000000`보다 크다. 실행 게이트는 `Number(lastDbMigration.created_at) < migration.folderMillis`(`pg-core/dialect.js:62`)이므로 조용한 skip은 일어나지 않는다. version/breakpoints도 기존 68개 엔트리와 동일 포맷.
2. **bigint 정밀도 ✅** — `mode: "number"`는 `PgBigInt53`으로 매핑되고 읽기 시 `Number(value)`만 한다(`pg-core/columns/bigint.js:20-25`, 오버플로 가드 없음). 다만 한도 5e9는 `Number.MAX_SAFE_INTEGER`(≈9.007e15)보다 6자릿수 아래라 안전 마진이 충분하다. 증분 UPDATE `quota.ts:71`의 `${totalTokens} + ${tokens}`는 **PostgreSQL 안에서 bigint 산술**로 계산되고 JS는 결과를 읽기만 하므로 누적 경로에도 정밀도 손실이 없다. `getUsageData()`의 뺄셈·나눗셈(`quota.ts:106-107`)도 같은 범위. `aiUsageLogs`의 `SUM()`은 `Number(b.totalPrompt)`로 명시 변환돼 있다(`:110`).
3. **SQL 문법·정합 ✅** — 두 subcommand를 한 `ALTER TABLE`로 묶어 리라이트 1회. int4 → bigint는 PostgreSQL의 binary-coercible 확대 변환이라 `USING` 절이 불필요하고, NOT NULL과 DEFAULT(`0`, `100000`)는 타입 변경 시 자동 캐스팅되어 보존된다(`0018_ai_usage_quotas.sql:5-6`의 원 정의와 대조). 문장이 하나라 `--> statement-breakpoint` 부재도 정상.
4. **스키마-DB 불일치 시 읽기 경로 ✅** — 마이그레이션 미적용 DB에 붙어도 **읽기는 깨지지 않는다.** int4 컬럼은 드라이버가 number로 주고 `Number(number)`는 항등이다. 깨지는 건 오직 int4 범위를 넘는 **쓰기**뿐이고, 그게 🔴 항목의 내용이다.
5. **컨벤션 ✅** — 변경 6개 파일에 `any` 0건, 빈 catch 0건, 신규 `console.log` 0건, 200줄 초과 파일 0건. `quota-limits.test.ts`는 `node:test` + `assert` + 한국어 테스트명 + `(B1)` 태그로 `models.test.ts` 등 기존 13개 테스트 파일과 스타일이 동일하고 `pnpm test` 스크립트(`tsx --test "src/**/*.test.ts"`)에 자동 포함된다. 네이밍도 camelCase 함수 / kebab-case 파일로 규칙에 맞다.
6. **직접 실행 확인** — `pnpm exec tsc --noEmit` exit 0, `pnpm exec tsx --test src/lib/ai/quota-limits.test.ts` 4/4 pass.

---

## 조치 내역 (2026-09-22, 사용자 결정 후)

| 항목 | 결정 | 조치 |
|---|---|---|
| 🔴 마이그레이션 침묵 실패 | **2단계 배포**로 순서 강제 | `migrate.ts`는 건드리지 않고(범위 밖 유지), 커밋을 둘로 분리. ① 0069 + schema.ts bigint만 먼저 배포해 적용 확인 → ② 한도 50억 코드 배포. 이 순서면 "int4 컬럼에 5e9 UPDATE"가 성립할 수 없다. |
| 🟡 `plans.name` 분기 | **slug로 전환** | `getQuotaLimitForPlanName` → `getQuotaLimitForPlanSlug`, 분기값 `'enterprise'`/`'pro'`. `quota.ts`도 `plans.slug`를 select. 운영·로컬 모두 slug가 `free`/`pro`/`enterprise`임을 확인. 표시명을 넣으면 폴백되는 것을 테스트로 고정(B2, 테스트 5건으로 증가). |
| 🟡 JSDoc 중복 | 정리 | `quota-limits.ts` JSDoc에서 마이그레이션 번호를 빼고 "bigint 전환이 전제" 불변 사실만 남김. slug를 쓰는 이유(name은 표시용)를 대신 기록. |
| 🟢 SQL 주석 길이 | 정리 | 6줄 → 3줄. `getQuotaLimitForOrg()` 동작 설명은 코드 쪽에만 남김. |
| 🟡 구독없음 10만 vs 미지 플랜 1천만 | **보류** | 기존 동작이고 이번 변경으로 악화되지 않음. 별도 사이클 대상. |
| 🟢 `formatTokens` B 단위 | **보류** | 표시 개선, PLAN의 범위 밖. |
| 확인필요 `lock_timeout` | **보류** | 2단계 배포로 실패 시 영향이 "①만 실패"로 축소됨. 운영 `ai_usage_quotas`는 11행/120kB. |
| 확인필요 check↔update 원자성 | **보류** | 변경분 밖 기존 문제. 초과 폭은 동시 요청 수에 비례. |

재검증(조치 후): `pnpm test` 202/202 pass · `tsc --noEmit` exit 0 · 변경 4파일 `eslint` exit 0 · 로컬 DB 재실행으로 B4~B7 동일 결과 · `verify-evidence` unresolved 0 / uncited 0.
