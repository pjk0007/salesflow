# PLAN — AI 토큰 월 한도 Enterprise 50억 상향 + ai_usage_quotas bigint 전환

- **track**: Quick
- **사이클 ID**: `2026-09-22-ai-quota-bigint`

판정 근거: 답해야 할 설계 질문이 남지 않는다. drizzle 컬럼 mode(`number`), 마이그레이션 문장 형태(단일 `ALTER TABLE` 두 subcommand), journal `when` 값(1773200000000), 테스트를 위한 순수 함수 분리 위치까지 아래에서 확정한다. 변경 파일 6개(신규 3개 포함), 기존 호출부 수정 0개.

## 목표

Enterprise 플랜의 월 AI 토큰 한도를 10억에서 50억으로 올려, 2026-09에 한도를 소진한 운영 org "매치스플랜"(plan_id=3)의 AI 개인화 발송·테스트발송·팔로업 차단을 푼다. 단 `ai_usage_quotas.total_tokens`/`quota_limit`가 int4(최대 2,147,483,647)라 50억을 담을 수 없으므로 두 컬럼을 bigint로 전환하는 마이그레이션 `0069`를 함께 배포한다. 2026-09 누적 사용량(1,000,000,593)은 보존하며, 운영 DB 직접 쓰기는 하지 않는다 — 반영은 코드 + 배포(부팅 시 `runMigrations()` 자동 적용)로만 한다.

## 사전 조사 결론 (구현 전 확정 사항)

1. **마이그레이션 관례** — 손으로 쓴 `0064`/`0066`/`0068`은 한국어 `--` 주석으로 "왜"를 먼저 쓰고, 식별자는 큰따옴표, 타입명은 소문자, subcommand는 4칸 들여쓰기. `--> statement-breakpoint`는 drizzle-kit이 생성한 `0067`에만 있고 손글씨 파일은 `;`로 나열한다(`0034`·`0058`·`0060` 운영 적용 실적 있음). 컬럼 타입 변경 선례는 없다.
2. **_journal.json** — `version:"7"`·`breakpoints:true` 고정, `when`은 실제 시각이 아니라 손으로 부여한 단조증가 값(`0067`=1772370000000, `0068`=1773100000000). 마이그레이터는 `when > DB의 마지막 created_at`인 항목만 실행하므로 **0069의 when이 작으면 조용히 건너뛴다**.
3. **bigint 선례 없음** — `schema.ts`에 `bigint` 사용·import 모두 없다. `drizzle-orm@0.45.1`에서 `import { bigint } from "drizzle-orm/pg-core"`, 호출은 `bigint("total_tokens", { mode: "number" })` (mode는 필수 인자).
4. **TS 타입 영향 없음** — `mode: "number"`면 `PgBigInt53.mapFromDriverValue`가 `Number()`로 변환해 select 결과가 number로 유지된다. `quota.ts`·`useAiUsage.ts`·`AiUsageTab.tsx` 수정 불필요. `mode: "bigint"`는 `quotaLimit - totalTokens`·`Math.round`·`NextResponse.json`(BigInt 직렬화 불가)을 전부 깨뜨리므로 배제.
5. **실패 모드 정정** — `src/lib/db/migrate.ts:110-112`가 마이그레이션 에러를 `console.error`로 삼키고 rethrow하지 않는다. SQL이 틀려도 "부팅 실패"가 아니라 **구 스키마로 정상 부팅 → `UPDATE quota_limit=5e9`가 `integer out of range` → AI 기능 500**이 실제 실패 모드다.

## 단계별 작업

1. **마이그레이션 SQL 작성** — `drizzle/0069_ai_usage_quotas_bigint.sql` (신규)
   - 첫머리에 한국어 `--` 주석으로 이유(int4 상한 < Enterprise 50억, `getOrCreateQuota()`가 코드값으로 DB를 덮어써서 DB만 고쳐선 안 됨, `UNIQUE(org_id, month)`라 행 수가 작아 리라이트 비용 무시 가능).
   - 본문은 **단일 문장**으로 두 컬럼을 한 번에 바꾼다(리라이트 1회):
     `ALTER TABLE "ai_usage_quotas"` / `    ALTER COLUMN "total_tokens" TYPE bigint,` / `    ALTER COLUMN "quota_limit" TYPE bigint;`
   - `--> statement-breakpoint` 미사용(단일 문장). `IF EXISTS`는 이 문법에 없고, 마이그레이터가 이력을 기록해 재실행되지 않으며 재실행돼도 동일 타입 ALTER는 무해하므로 `DO $$` 래핑도 하지 않는다.
   - `DEFAULT`와 `NOT NULL`은 PG가 타입 변경 시 새 타입으로 자동 유지하므로 재선언하지 않는다(B3에서 확인).
2. **journal 등록** — `drizzle/meta/_journal.json`의 `entries` 끝에 추가:
   `{ "idx": 69, "version": "7", "when": 1773200000000, "tag": "0069_ai_usage_quotas_bigint", "breakpoints": true }`
   - `when`은 직전 0068(1773100000000)보다 크고 오늘 `Date.now()`보다 작게 — 기존 관례대로 +100,000,000.
3. **스키마 반영** — `src/lib/db/schema.ts`
   - `drizzle-orm/pg-core` import 목록에 `bigint` 추가.
   - 988~989행을 `bigint("total_tokens", { mode: "number" }).default(0).notNull()`, `bigint("quota_limit", { mode: "number" }).default(100000).notNull()`로 교체.
4. **한도 상향 + 순수 함수 분리** — `src/lib/ai/quota-limits.ts` (신규), `src/lib/ai/quota.ts`
   - 신규 파일에 `getQuotaLimitForPlanName(planName: string | undefined): number` 하나만 둔다. Enterprise → `5_000_000_000`, Pro → `100_000_000`(불변), 그 외/undefined → `10_000_000`(Free, 불변). DB import 없음.
   - `quota.ts`의 `getQuotaLimitForOrg()`는 활성 구독 없음 → `100_000` 분기를 그대로 두고, 플랜 이름 분기만 위 함수 호출로 교체. "int4라 bigint 전환 필요" 주석은 사실이 아니게 되므로 삭제.
   - 분리 이유: `quota.ts`는 `@/lib/db`를 import하고 `src/lib/db/index.ts`는 `DATABASE_URL`이 없으면 import 시점에 throw하므로 테스트에서 직접 import할 수 없다. 프로젝트 관례(`models.ts`+`models.test.ts`)가 정확히 이 패턴이다. 그 외 리팩토링은 하지 않는다.
5. **테스트 추가** — `src/lib/ai/quota-limits.test.ts` (신규): `node:test` + `node:assert`, 테스트명 끝에 `(B1)`·`(B2)` 표기(기존 `models.test.ts` 관례).
6. **로컬 검증** — 아래 검증 1~7. 이 worktree에 `node_modules`가 없으므로 먼저 `pnpm install`.
7. **배포 전 운영 조회(읽기 전용)** — 검증 8. 운영 DB 쓰기는 하지 않는다.
8. **배포 후 확인** — 검증 9.

## 건드릴 파일

| 파일 | 변경 요지 |
|---|---|
| `drizzle/0069_ai_usage_quotas_bigint.sql` | **신규**. 사유 주석 + 단일 `ALTER TABLE ... TYPE bigint` 2개 subcommand |
| `drizzle/meta/_journal.json` | idx 69 엔트리 추가 (`when: 1773200000000`) |
| `src/lib/db/schema.ts` | import에 `bigint` 추가; `aiUsageQuotas` 두 컬럼(988~989행)을 `bigint(..., { mode: "number" })`로 |
| `src/lib/ai/quota-limits.ts` | **신규**. `getQuotaLimitForPlanName()` 순수 함수 (Enterprise 5e9 / Pro 1e8 / 그 외 1e7) |
| `src/lib/ai/quota.ts` | `getQuotaLimitForOrg()`의 플랜 분기를 위 함수 호출로 교체, int4 주석 삭제. 나머지 함수 무수정 |
| `src/lib/ai/quota-limits.test.ts` | **신규**. B1·B2 테스트 |

변경 없음(확인만): `src/hooks/useAiUsage.ts`, `src/components/settings/AiUsageTab.tsx`, `src/app/api/ai/usage/route.ts`, `src/lib/ai/index.ts`, `src/lib/db/migrate.ts`.

## behavior 목록

- **B1** — Enterprise 플랜 이름에 대해 월 한도가 5,000,000,000이다 (P1)
- **B2** — Pro는 100,000,000, Free/미지정은 10,000,000, 활성 구독 없음은 100,000으로 기존과 동일하다 (P1)
- **B3** — 0069 적용 후 두 컬럼의 `data_type`이 `bigint`이고 `NOT NULL`·기본값(0 / 100000)·기존 행 값이 보존된다 (P1)
- **B4** — `quota_limit=1e9`인 기존 행을 가진 Enterprise org에서 `checkTokenQuota()` 호출 시 에러 없이 DB의 `quota_limit`이 5e9로 갱신된다 (P1)
- **B5** — `total_tokens=1,000,000,593`인 Enterprise org의 `checkTokenQuota()`가 `allowed=true`, `remaining=3,999,999,407`을 반환한다 — 누적은 리셋되지 않는다 (P1)
- **B6** — `updateTokenUsage()`로 `total_tokens`가 2,147,483,647을 넘어도 에러 없이 증가한다 (P2)
- **B7** — `getUsageData()`의 `totalTokens`/`quotaLimit`/`remaining`이 JS `number`(문자열 아님)이고, 1e9/5e9일 때 `usagePercent`가 20이다 (P1)
- **B8** — `/api/ai/usage`가 정상 직렬화되어 AI 사용량 탭이 `1000.0M / 5000.0M`, 잔여 `4000.0M`, 진행바 20%를 표시한다 (P2)
- **B9** — 부팅 시 로그에 `[migrate] 마이그레이션 완료!`가 찍히고 `drizzle.__drizzle_migrations`에 0069가 `created_at=1773200000000`으로 기록되며, 재부팅 시 재실행되지 않는다 (P1)
- **B10** — 스키마 변경 후 호출부를 고치지 않고도 `tsc --noEmit`과 `pnpm lint`가 통과한다 (P1)
- **B11** — 차단됐던 세 경로가 풀린다: 테스트발송이 429가 아닌 정상 응답, 자동발송 outcome에 `quota_exceeded` skip 없음, 팔로업이 한도 초과를 반환하지 않음 (P1)

## 리스크/불확실성

- **마이그레이션 실패가 조용하다** — `migrate.ts:110-112`가 에러를 삼킨다. 실패 시 증상은 "구 스키마로 기동 → Enterprise org 첫 AI 호출에서 `integer out of range` → 현재의 skip보다 나쁜 500/큐 실패". 대응: 로컬에서 B3·B9로 검증하고 배포 직후 검증 9를 즉시 수행. `migrate.ts`를 rethrow로 바꾸는 것은 부팅 정책 변경이라 범위 밖.
- **journal `when`이 작으면 실행 자체가 건너뛰어진다** — B9가 잡는다.
- **락과 소요시간** — int4→int8은 binary-coercible이 아니라 테이블 리라이트 + ACCESS EXCLUSIVE 락. 행 수 상한은 `UNIQUE(org_id, month)`로 "AI를 쓴 org 수 × 2026-02~09 최대 8개월" — org 1,000개여도 8,000행 이하, 리라이트는 ms 단위. 유일한 악화 조건은 이 테이블에 락을 쥔 장기 트랜잭션이 있어 부팅이 락 대기로 멈추는 것인데, `lock_timeout`을 걸면 위의 "조용한 실패"로 바뀌므로 넣지 않는다.
- **0068이 운영에 미적용이면** 0069와 함께 실행된다. 0068은 `records`(약 28만행)에 인덱스를 만들어 그동안 records 쓰기를 막는다 — 0069가 만드는 리스크는 아니나 부팅이 길어진다. 검증 8로 사전 파악.
- **다중 인스턴스 동시 부팅** — 두 번째 인스턴스는 락 대기 후 동일 타입 ALTER(무해)를 재실행하고 이력 행이 중복 기록된다. 기능 영향 없음.
- **롤백 안전성** — 마이그레이션 성공 후 코드만 되돌려도 구 코드는 bigint 컬럼을 문제없이 읽고 `quota_limit`을 10억으로 낮출 뿐이다. 실패했다면 코드 되돌리기만으로 현 상태 복귀. 어느 경우도 운영 DB 수동 쓰기가 필요 없다.
- **표시 자릿수** — `formatTokens`가 M 단위까지만 있어 50억이 `5000.0M`으로 보인다. 기능 문제 없음, 범위 밖.

## 검증 방법

1. worktree에서 `pnpm install` (node_modules 부재).
2. `pnpm test`로 B1·B2 통과. `pnpm exec tsc --noEmit`·`pnpm lint` 통과(B10).
3. 로컬 DB에서 사전 상태 확인: `SELECT column_name, data_type, column_default, is_nullable FROM information_schema.columns WHERE table_name='ai_usage_quotas' AND column_name IN ('total_tokens','quota_limit');` → integer.
4. `pnpm dev` 기동으로 `runMigrations()` 적용. 로그에 `[migrate] 마이그레이션 완료!` 있고 에러 없음. 3번 재실행 → `bigint`, default·NOT NULL 유지(B3). `SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1;` → 0069 / 1773200000000. 재기동 시 재실행 없음(B9).
5. 로컬에 운영 상황 재현: Enterprise 활성 구독 org의 당월 행을 `total_tokens=1000000593, quota_limit=1000000000`으로 맞춘 뒤 `GET /api/ai/usage` → `quotaLimit=5000000000, remaining=3999999407, usagePercent=20`, 값이 모두 number(B4·B7). DB 행의 `quota_limit` 5e9 갱신 확인(B4). 설정 > AI 사용량 탭 표시 확인(B8).
6. 같은 org로 테스트발송/이메일 생성 1건 → 429 아닌 정상 응답(B11), `total_tokens` 증가. 이어서 `total_tokens=2147483000`으로 세팅 후 AI 호출 1건 → int4 상한 초과 증가(B6).
7. Pro/Free/구독없음 org로 `/api/ai/usage` → 1e8 / 1e7 / 1e5 불변(B2).
8. **배포 전 운영 조회(읽기 전용)**: `SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 2;`(0068 적용 여부), `SELECT count(*), pg_size_pretty(pg_total_relation_size('ai_usage_quotas')) FROM ai_usage_quotas;`(리라이트 규모).
9. **배포 후**: 서버 로그에서 `[migrate] 마이그레이션 완료!` 확인 → 3번 쿼리를 운영에서 읽기 전용 실행해 bigint 확인 → 매치스플랜에서 테스트발송 1건 200 확인, 해당 행이 `quota_limit=5000000000`이고 `total_tokens`가 1,000,000,593에서 이어서 증가(B5·B11).

## 범위 밖

- Pro/Free 한도 변경, 한도를 `plans` 테이블이나 환경변수로 옮기는 설계.
- 2026-09 누적 사용량 리셋·조정, 운영 DB 수동 UPDATE.
- `ai_usage_logs.prompt_tokens`/`completion_tokens`의 bigint 전환.
- `migrate.ts`의 에러 rethrow 전환, `lock_timeout` 도입.
- `formatTokens`에 B(십억) 단위 추가 등 표시 개선.
- drizzle-kit snapshot 생성이나 `db:push` 정합화.
