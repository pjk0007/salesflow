# DESIGN — 고객 여정 방문자 매칭 조회 속도 개선 (records 'email' 표현식 인덱스)

- **track**: Full · **사이클 ID**: `2026-10-22-journey-email-index`
- **근거**: `PLAN.md`(승인됨, P2 깊이 알림 포함), `behaviors.json` B1~B15
- **새 의존성**: 없다. PGlite(`@electric-sql/pglite` 0.5.10)는 이미 devDependency다.
- **마이그레이션·journal**: 건드리지 않는다. 인덱스는 `send-log-indexes.ts` 경로로 만든다(부팅 뒤 CONCURRENTLY).
- **운영 DB 접근**: Claude만 읽기 전용으로 한다(0단계, B12). Codex는 PGlite와 로컬 QA DB(`sendb_email_stats_qa`)만 쓴다.
- **반영**: 커밋·푸시·배포는 사용자 확인 뒤에 한다.
- **[미확인]** 표시는 코드나 운영에서 확인하지 못한 내용이다.

## 0. 원칙

1. **찾는 레코드 집합은 한 건도 바꾸지 않는다.** 고친 문장은 모두 "바꾸기 전 문장을 그대로 옮긴 것"(oracle)과 같은 데이터에서 결과를 비교해 증명한다.
2. **인덱스 식의 정본은 `src/lib/db/records-email-index.ts` 한 곳이다.** 같은 글자가 다른 파일에 있으면 테스트가 글자 단위까지 지킨다.
3. **인덱스는 속도만 바꾼다.** 인덱스가 없거나 INVALID여도 결과는 같고 느릴 뿐이다.
4. **바꾸는 범위는 좁다.** 읽기 문장 두 개(고객 여정 `related`, 깊이 알림 `grec`)와 인덱스 선언만 바꾼다. 쓰기 경로와 스키마는 그대로다.

## 1. 결정 요약

| # | 질문 | 결정 |
|---|---|---|
| D1 | 트림 리터럴을 어떻게 공유할지 | 정본은 공유 모듈의 문자열이다. postgres-js 태그 템플릿 안에는 **글자 그대로 인라인**하고, 정적 테스트가 정본과 같은지 본다. `conn.unsafe` 조각은 쓰지 않는다. 표기는 `chr()` 이어 붙이기다(ASCII만, 역슬래시 없음). |
| D2 | 인덱스 키 길이 | `left(정규화값, 200)`. 이름은 `records_workspace_email_norm_idx`, 열은 `(workspace_id, left(…))`. 쿼리는 인덱스 조건으로 찾고 예전 비교로 다시 확인한다. |
| D3 | `related` 모양 | `r.id = ANY(ARRAY(SELECT … UNION ALL …))`. 'email' 갈래와 나머지 키 갈래는 매개변수 조건(관문)으로 막아서 문장 하나를 유지한다. |
| D4 | 결과 동일 테스트 하네스 | PGlite에 drizzle 스키마로 표를 만든다(고객 여정 15개 / 깊이 알림 5개). postgres-js 태그 템플릿을 흉내 내는 어댑터를 둔다(`$n` 이어 붙이기, 조각 보간은 거부). 바꾸기 전 문장(oracle)은 `*-legacy.test-helper.ts`에 둔다. facts 조회 함수는 export하지 않고 어댑터가 받은 줄로 비교한다. generic plan은 `PREPARE` + `plan_cache_mode`로 본다. |
| D5 | 깊이 알림 | 이번 범위에 넣는다. 재료 문장 조립을 DB를 모르는 새 모듈 `deep-visitor-alert-guards-sql.ts`로 옮긴다. `grec`도 `ANY(ARRAY(...))` 모양으로 바꾸고, `email_match`는 예전 조각 그대로 계산한다. B14는 "문장 결과 4칸이 예전과 같다"로 고정한다. |
| D6 | 'email' 밖의 메일 칸 | 예전 비교를 그대로 쓴다. 그 경우만 예전처럼 워크스페이스를 훑는다. |
| D7 | 성능 증거 | QA DB 10만 행에서 실제 postgres-js를 쓴다. 문장은 `debug` 훅으로 잡는다. 7번 연속 호출하고, PREPARE generic/custom으로 `EXPLAIN (ANALYZE, BUFFERS)`를 남긴다. |
| D8 | cjs 검사 스크립트 | `check-customer-journey-priority.cjs`의 PGlite require를 devDependency로 바꾼다. 이 체크아웃에는 `.testenv`가 없다. |

## 2. 설계 질문 5개 — 결정과 근거

### 2-1. 트림 SQL 리터럴 공유 (D1)

**postgres-js 3.4.8 소스로 확인한 것** (`node_modules/.pnpm/postgres@3.4.8/node_modules/postgres/src/`)
- `index.js:119-127`: `unsafe(string, args=[])`는 `new Query([string], args, …, { prepare: false, simple: args.length === 0 })`를 돌려준다. 이 Query는 then/catch/execute를 부를 때만 실행된다(`query.js:139-150`).
- `types.js:98-120`: 태그 템플릿을 문자열로 만들 때 보간 값이 `Query`면 `fragment()`가 그 글자를 그대로 끼워 넣는다. 그 밖의 값은 모두 `$n` 매개변수가 된다.
- `connection.js:224-241`: 이름 붙은 문장으로 보낼지는 바깥 문장의 옵션이 정한다. 태그 템플릿은 기본 `prepare: true`다.
- 정리: 운영 드라이버에서는 `${conn.unsafe(상수)}`가 의도대로 리터럴이 된다.

**하지만 가짜 conn과는 맞지 않는다.** `scripts/check-customer-journey-priority.cjs:42-54`의 conn은 `strings`를 `$1…$n`으로만 이어 붙이고 보간 값을 전부 매개변수로 넘긴다. `conn.unsafe`도 없다.

| 안 | 장점 | 대가 |
|---|---|---|
| A. 공유 상수 + `${conn.unsafe(상수)}` 조각 | 글자가 한 곳에만 있다. | cjs 가짜 conn과 테스트 어댑터가 조각 끼워 넣기를 흉내 내야 한다. 그러면 테스트가 드라이버가 아니라 흉내를 검사하게 된다. |
| **B. 공유 모듈이 정본, 태그 템플릿 안은 글자 그대로 인라인 + 정적 테스트 (택함)** | 소스에 보이는 글자가 곧 PG가 받는 글자다. 가짜 conn을 고치지 않아도 된다. 문장 글자가 고정이라 이름 붙은 문장 하나로 남는다. | 글자가 두 곳에 있다. T9(소스에 정본 글자가 정확히 한 번)와 B4(EXPLAIN이 실제로 인덱스 사용)로 막는다. |
| C. drizzle `sql` + `runSql`(이름 없는 문장)로 옮김 | 매번 custom plan이라 매개변수 트림도 상수로 접힌다. | 호출 방식이 바뀌고, OR 구조 문제는 그대로 남는다. |

**표기는 `chr()` 이어 붙이기로 정한다.** 확정 값:

```text
chr(32)||chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(160)||chr(12288)||chr(65279)||chr(8203)
```

| 표기 | 판단 |
|---|---|
| `E'…\x0B…'` | `\v` 함정이 있고, 태그 템플릿 안에서 JS가 역슬래시를 먼저 해석해 소스 글자와 SQL 글자가 달라진다(선례 `src/lib/ai/company-research-cache.ts:38-43`). |
| `U&'…'` | 역슬래시 문제가 같고 `standard_conforming_strings`에 기댄다. |
| 실제 문자 | NBSP·BOM·폭 없는 공백이 보이지 않아 검토할 수 없고, 도구가 바꿀 수 있다. |
| **`chr()` (택함)** | ASCII만 쓰고 역슬래시·`$`·백틱이 없다. 코드 포인트가 그대로 보여 `deep-visitor-alert-rules.ts:832`와 1:1로 대조된다. `chr`와 텍스트 이어 붙이기는 IMMUTABLE이라 인덱스 식에 쓸 수 있다(T4가 증명). |

- 플래너는 인덱스 식과 쿼리 조건을 상수 접기한 뒤 비교한다. `chr(…)` 사슬은 generic plan에서도 Const 하나로 접힌다. 반면 `$n`은 generic plan에서 접히지 않는다. 그래서 **키 이름·트림 문자·길이는 리터럴**, **비교값과 workspace_id만 매개변수**로 둔다.
- `chr(160)` 이상은 서버 인코딩이 UTF8이어야 한다. 0단계에서 `SHOW server_encoding`으로 확인한다.

**모듈 `src/lib/db/records-email-index.ts`는 import가 없다.**
- schema.ts가 상대 경로(`./records-email-index`)로 import한다. drizzle-kit, cjs(tsx), Next 모두 상대 경로 TS를 읽는다.
- 깊이 알림 쪽은 drizzle을 쓰므로 `sql.raw(recordEmailIndexKeySql("rm.data"))`로 가져다 쓴다.

### 2-2. 인덱스 키 길이 (D2)

| 안 | 장점 | 대가 |
|---|---|---|
| **A. `left(정규화값, 200)` (택함)** | 항목 크기가 약 800B로 한도 2704B보다 훨씬 작다. 키가 사람이 읽을 수 있는 값이다. 200글자 이하 값은 키가 곧 전체 값이다. | 200글자가 넘는 값은 앞부분이 같으면 같은 키가 된다. 재확인 비교로 걸러낸다. |
| B. `md5(정규화값)` | 키가 32바이트로 고정된다. | 모든 쓰기마다 해시를 계산하고, FIPS 빌드 PG에서는 오류가 난다. 보통 주소보다 오히려 길다. |
| C. `hashtext()` | 키가 4바이트다. | PG 버전 간 값이 같다는 보장이 없다. |
| D. 자르지 않음 | 식이 짧다. | 2.7KB 넘는 값이 하나라도 있으면 인덱스 생성과 이후 쓰기가 실패한다(B10). |

- **N = 200인 이유**: 결과 정확성은 재확인 비교가 책임진다. 비교값은 모두 `recipient_email varchar(200)`(`schema.ts:761`)에서 온다. 맞을 수 있는 레코드는 키가 전체 값과 같다.
- **쿼리 조건 두 개**
  - 인덱스 조건: `left(정규화식, 200) = left($메일, 200)`
  - 재확인: `lower(btrim(data->>'email', $트림)) = $메일` — 예전 비교 그대로다. 재확인이 참이면 앞 200글자도 같으므로 결과는 예전과 같다.
- **식을 바꾸면 인덱스 이름도 바꾼다.** `IF NOT EXISTS`가 이름이 같은 옛 인덱스를 그대로 두기 때문이다. 모듈 머리 주석에 이 규칙을 적고, T6이 DDL 전체 문자열을 고정한다.

**확정 계약**

| 항목 | 값 |
|---|---|
| 인덱스 이름 | `records_workspace_email_norm_idx` |
| `RECORD_EMAIL_KEY` | `"email"` |
| `EMAIL_TRIM_SQL` | 위 `chr()` 사슬 |
| `RECORD_EMAIL_PREFIX` | `200` |

`recordEmailIndexKeySql("rm.data")`의 정확한 출력(T2):
```text
left(lower(btrim(rm.data->>'email', chr(32)||chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(160)||chr(12288)||chr(65279)||chr(8203))), 200)
```

`SEND_LOG_INDEXES` 맨 끝 항목:
- why 주석: "고객 여정·깊이 알림이 받는 메일이 같은 레코드를 찾으려고 워크스페이스 records를 통째로 읽었다 (2026-10-22 운영 20~30초)"
- `name`: `"records_workspace_email_norm_idx"`
- `ddl`: ``` `CREATE INDEX CONCURRENTLY IF NOT EXISTS "records_workspace_email_norm_idx" ON "records" ("workspace_id", (${recordEmailIndexKeySql('"data"')}))` ```
- 결과 문자열(T6):
```text
CREATE INDEX CONCURRENTLY IF NOT EXISTS "records_workspace_email_norm_idx" ON "records" ("workspace_id", (left(lower(btrim("data"->>'email', chr(32)||chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(160)||chr(12288)||chr(65279)||chr(8203))), 200)))
```

schema.ts records `(table) => ({ … })`에 한 줄을 더한다.
- why 주석: "마이그레이션에는 없다 — 부팅 뒤 CONCURRENTLY로 만든다(send-log-indexes.ts). 식의 정본은 records-email-index.ts"
- import: `import { recordEmailIndexKeySql } from "./records-email-index";`
- 선언(T6이 이 글자를 찾는다):
```text
emailNormIdx: index("records_workspace_email_norm_idx").on(table.workspaceId, sql.raw(recordEmailIndexKeySql('"data"'))),
```

### 2-3. `related` 재구성 (D3)

| 안 | 장점 | 대가 |
|---|---|---|
| A. id 합집합 CTE + `r.id IN (SELECT id FROM related_ids)` | 읽기 쉽다. | 세미 조인 방식을 플래너가 고른다. 통계가 낡으면 records 전체 Seq Scan + Hash Semi Join이 다시 나올 수 있다(1f3143f의 nested loop 오판). |
| **B. `r.id = ANY(ARRAY(SELECT … UNION ALL …))` (택함)** | ARRAY 부분은 상관없는 InitPlan이라 한 번만 돈다. 바깥은 `id = ANY($n)`이 records_pkey 인덱스 조건이 되어 통계와 상관없이 PK 조회를 고른다. 깊이 알림에 같은 꼴이 이미 있다. | 갈래에서 찾은 행을 바깥에서 PK로 한 번 더 읽는다(몇 페이지). |
| C. JS에서 필요한 갈래 조각만 골라 조립 | 필요 없는 갈래가 문장에 없다. | 중첩 조각이 필요해 가짜 conn과 맞지 않고, 경우마다 이름 붙은 문장이 따로 생긴다. |

**갈래 관문 (B8)**
- 'email' 갈래: `${keys.indexed}::boolean AND …`
- 나머지 키 갈래: `cardinality(${keys.others}::text[]) > 0 AND …`
- 둘 다 표의 열을 참조하지 않는 조건이다. generic plan에서는 Result(One-Time Filter)가 되어 거짓이면 아래 스캔을 부르지 않는다. custom plan에서는 false로 접혀 스캔이 계획에서 빠진다. 깊이 알림 `fev`가 같은 관문을 쓴다(`deep-visitor-alert.ts:2031`).

**최종 SQL 초안** — `${…}`만 매개변수다. 나머지 CTE와 바깥 SELECT는 한 글자도 바꾸지 않는다.

문장 앞 JS:
```ts
const emailKeys = target.fields.filter((f) => contactKindOf(f) === "email").map((f) => f.key);  // 52줄 그대로
const keys = splitEmailKeys(emailKeys);
const email = normalizeEmail(target.recipientEmail);
```

새 `related` CTE:
```sql
), related AS MATERIALIZED (
    -- (2026-10-22 구현 중 수정) JOIN own 대신 스칼라 조건: own이 바깥 루프를 몰아 ws 인덱스로 훑는 계획을 막는다.
    -- own은 최대 1행이고 0행이면 스칼라가 NULL이라 결과가 비므로 JOIN과 같다
    SELECT r.id, r.data FROM records r
    WHERE r.workspace_id = (SELECT workspace_id FROM own) AND r.org_id = (SELECT org_id FROM own)
      AND r.id = ANY(ARRAY(
        SELECT ${target.recordId}::int
        UNION ALL SELECT record_id FROM links
        UNION ALL SELECT record_id FROM identities
        UNION ALL SELECT rm.id FROM records rm
            WHERE ${keys.indexed}::boolean AND rm.workspace_id = ${target.workspaceId}
              AND left(lower(btrim(rm.data->>'email', chr(32)||chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(160)||chr(12288)||chr(65279)||chr(8203))), 200) = left(${email}, 200)
              AND lower(btrim(rm.data->>'email', ${EMAIL_TRIM_CHARS})) = ${email}
        UNION ALL SELECT ro.id FROM records ro
            WHERE cardinality(${keys.others}::text[]) > 0 AND ro.workspace_id = ${target.workspaceId}
              AND EXISTS (SELECT 1 FROM unnest(${keys.others}::text[]) AS k(key)
                  WHERE lower(btrim(ro.data->>k.key, ${EMAIL_TRIM_CHARS})) = ${email})
    ))
), funnel AS (
```
- `identifiedEmails`는 지금처럼 **전체** `${emailKeys}`를 쓴다. `unsubscribed` 비교식도 그대로다.
- 쿼리 위 why 주석: "'email' 칸만 records_workspace_email_norm_idx로 찾는다 — 식은 records-email-index.ts와 글자까지 같아야 하고(T9), 리터럴이라 공용 계획에서도 인덱스와 맞는다."

**결과가 같은 이유**
- 예전 related = { r | r.ws=W ∧ r.org=O ∧ (r.id=대상 ∨ r.id∈links ∨ r.id∈identities ∨ emailKeys 중 어떤 k에서 norm_k(r)=email) }.
- 바깥 스칼라 조건(`workspace_id = (SELECT … FROM own)`, `org_id = (SELECT … FROM own)`)이 r.ws=W ∧ r.org=O를 그대로 건다(구현 중 `JOIN own`에서 바꿈 — own은 최대 1행, 0행이면 NULL이라 결과 동일). 갈래가 돌려주는 값은 PK라 바깥의 같은 행을 가리키고, 다른 조직 행은 바깥에서 빠진다.
- T5의 SQLSTATE 54000 허용, T8 fixture filler 2,000행 + ANALYZE, `executedFullScans`의 workspace/org-only Index Cond·Bitmap Recheck Cond 포함은 `evidence/design-clarifications.txt`를 따른다.
- 'email' 갈래 ∪ 나머지 갈래 = 예전 EXISTS 조건이다(emailKeys = {'email'} ∪ others, B5).
- `->>`가 NULL이면 예전과 새 문장 모두 맞지 않는다. `= ANY` 배열의 중복은 결과를 바꾸지 않는다.

### 2-4. 결과 동일 테스트 하네스 (D4)

**PGlite에 만드는 표** — drizzle 스키마로 DDL을 만든다(cjs `ddl()`과 같은 규칙: 열·PK·NOT NULL·DEFAULT만).
- 고객 여정 15개: `workspaces`, `trackerSites`, `trackerSessions`, `trackerVisitors`, `visitorRecordLinks`, `trackerEvents`, `trackerFunnels`, `emailSendLogs`, `emailClickLogs`, `emailUnsubscribes`, `emailSenderProfiles`, `records`, `recordEvents`, `users`, `organizationMembers`
- 깊이 알림 5개: `records`, `trackerVisitors`, `visitorRecordLinks`, `emailUnsubscribes`, `recordEvents`
- records에는 PK와 경우에 따라 새 인덱스만 둔다. 그래야 "새 인덱스를 썼는가"가 헷갈리지 않는다.
- 새 인덱스는 `SEND_LOG_INDEXES`의 ddl 문자열을 그대로 실행해 만든다. PGlite가 `CONCURRENTLY`를 거부하면 테스트 도우미에서만 그 단어를 빼고 만든다(미리 정한 대체라 Codex가 묻지 않아도 된다).

**어댑터 `pgliteTag(pg, log)`**
- `strings`를 `$1…$n`으로 이어 붙인다(cjs 가짜 conn과 같은 규칙).
- 보간 값이 함수, Promise, 배열·Date가 아닌 객체, `undefined`면 오류를 던진다. 조각 보간을 막는다.
- `pg.query(text, params)` 결과 줄을 돌려주고 `{ text, params, rows }`를 `log`에 쌓는다.
- 호출하는 곳에서 `asConnection(tag)`로 한 번만 형을 바꾼다(`tag as unknown as Parameters<typeof loadJourneyAudience>[0]`, 선례 `src/lib/email-stats/fixture-guard.test.ts:8-10`). `any`는 쓰지 않는다.

**oracle은 `*-legacy.test-helper.ts`에 둔다**(테스트 glob에 걸리지 않음).
- `src/lib/customer-journey-audience-legacy.test-helper.ts`: 지금 `loadJourneyAudience`의 emailKeys 줄과 문장(54-113줄)을 글자 그대로 옮긴 `legacyJourneyFacts(conn, target, now)`, fixture, `canonical()`, `asConnection`
- `src/lib/deep-visitor-alert-guards-legacy.test-helper.ts`: 지금 `sameEmailSql`(1934-1946)과 4절 문장(1996-2040)을 옮긴 `legacyAudienceGuardsSql(input)`, fixture
- 머리 주석: "2026-10-22 바꾸기 전 문장 그대로 — 결과 동일 비교의 기준. 결과를 의도적으로 바꾸는 변경이 아니면 고치지 않는다."

**facts 조회 함수는 export하지 않는다.**
- 어댑터 `log.at(-1).rows[0]`이 곧 새 facts다. 타입은 `Parameters<typeof summarizeJourneyAudience>[0]`.
- B7: `canonical(새 facts) == canonical(예전 facts)`, 그리고 `loadJourneyAudience` 반환값 == `summarizeJourneyAudience(예전 facts, …)`.
- `canonical()`: 배열은 원소의 `JSON.stringify` 순 정렬, 객체는 키 정렬, Date는 ISO 문자열.
- fixture 레코드 data마다 `"_fixture": <id>`를 넣어 relatedRecords의 다중집합으로 id 집합을 비교한다. `_` 키는 칸 목록·깔때기 판정에 쓰이지 않는다.

**generic plan 확인 절차** (B4·B8·B15)
1. 함수를 한 번 불러 `log`에서 `{ text, params }`를 얻는다. 깊이 알림은 `PgDialect.sqlToQuery`로 얻는다.
2. `SET enable_seqscan = off`
3. `PREPARE q AS <text>` (매개변수 형은 적지 않는다. postgres-js도 형 0으로 보낸다)
4. `plan_cache_mode = force_generic_plan`과 `force_custom_plan`으로 각각 `EXPLAIN (FORMAT JSON) EXECUTE q(<리터럴 인자>)`. B8·B15는 `ANALYZE`를 더한다. 깊이 알림은 custom만 본다(운영 `runSql`이 이름 없는 문장).
5. EXECUTE 인자는 `sqlLiteral()`로 리터럴로 쓴다(숫자 그대로, 문자열 `'…'`, 불리언 `true/false`, 배열 `ARRAY[…]`, 빈 배열 `'{}'`).
6. finally에서 `DEALLOCATE`와 `RESET`.

**계획 판독 도우미**
- `planNodes(root)`: JSON 계획을 평평한 목록으로 펼친다(InitPlan·SubPlan 포함).
- `usesIndex(root, name)`: "Index Name"이 name인 노드가 있는지.
- `executedFullScans(root, "records")`: Relation Name이 records이고, Seq Scan이거나 Index Cond 없는 Index Scan / Index Only Scan이며, Actual Loops > 0인 노드.

### 2-5. 깊이 알림 `grec` (D5)

**분리 방식** — `loadAudienceGuardsMany`는 그대로 두고 문장 조립만 새 모듈로 옮긴다.
- 새 모듈 `src/lib/deep-visitor-alert-guards-sql.ts` (db를 import하지 않음)
  - `audienceGuardsSql(input)`: 지금 1994-2040의 문장
  - `GuardRecordJson`, `AudienceGuardsRow` 타입: 1924-1932, 1996-2000에서 옮김
  - 내부 `pairsMatchSql(alias, pairs)`: 지금 `sameEmailSql`과 같은 조각, 별칭만 인자로
- `deep-visitor-alert.ts`: 입력 계산(1966-1993)은 그대로, 문장은 `runSql<AudienceGuardsRow>(exec, audienceGuardsSql({...}))`로 부른다. 후처리(2042 이후)는 그대로. `sameEmailSql`과 안 쓰는 import는 지운다.

**새 `grec`** — 나머지 CTE와 바깥 SELECT는 글자 그대로.

```ts
const pairs = emailPairsByKey(input.specs);
const indexed = pairs.get(RECORD_EMAIL_KEY);
const others = new Map([...pairs].filter(([key]) => key !== RECORD_EMAIL_KEY));
```

```sql
grec AS MATERIALIZED (
    SELECT r.id, r.workspace_id, r.partition_id, r.integrated_code, r.created_at, r.data,
           (${pairsMatchSql("r", pairs)}) AS email_match
    FROM records r
    WHERE r.org_id = ${orgId}::uuid
      AND r.id = ANY(ARRAY(
          SELECT unnest(${sql.param(itemRecordIds)}::int[])
          UNION ALL SELECT record_id FROM linked
          -- indexed가 있을 때만
          UNION ALL SELECT rm.id
              FROM unnest(${sql.param(indexed.ws)}::int[], ${sql.param(indexed.emails)}::text[]) AS p(ws, email)
              JOIN records rm ON rm.workspace_id = p.ws
               AND ${sql.raw(recordEmailIndexKeySql("rm.data"))} = left(p.email, 200)
               AND lower(btrim(rm.data->>'email', ${EMAIL_TRIM_CHARS}::text)) = p.email
          -- others.size > 0일 때만
          UNION ALL SELECT ro.id FROM records ro
              WHERE ro.org_id = ${orgId}::uuid AND (${pairsMatchSql("ro", others)})
      ))
),
```
- `200`은 `RECORD_EMAIL_PREFIX`에서 가져온다(`sql.raw`). 갈래는 JS에서 넣거나 뺀다(`sql.empty()`). drizzle·이름 없는 문장 경로라 가짜 conn 제약이 없다.
- `email_match`는 찾은 줄에만 예전 조각으로 계산한다. 줄 집합이 같으므로 값도 같다.
- (워크스페이스, 주소) 짝 의미를 유지한다. ws 9 레코드의 주소가 ws 8 수신 주소와 같아도 잡지 않는다.
- 운영에서는 나머지 갈래가 사실상 생기지 않는다(`emailKeysOf`가 'email'을 항상 넣고, email 형식 칸의 키는 모두 'email').

**B14 확인 경로** — `loadAudienceGuardsMany`는 export하지 않는다.
- 문장 결과 4칸(linked·unsub·records·funnel_events)이 예전 문장과 같으면 후처리도 같은 결과를 낸다. records·linked는 순서까지, unsub·funnel_events는 다중집합으로 비교한다.
- 테스트는 `new PgDialect().sqlToQuery(audienceGuardsSql(input))`를 `pg.query(sql, params)`로 돌린다. 운영 `runSql`의 `exec.unsafe(q.sql, q.params)`와 같은 문장·매개변수다.

## 3. 아키텍처

```text
정본  src/lib/db/records-email-index.ts  (import 없음)
 ├─ send-log-indexes.ts             DDL 문자열 → 부팅 뒤 CONCURRENTLY (기존 경로·잠금·INVALID 재시도 그대로)
 ├─ schema.ts                       같은 이름 선언 (sql.raw). 마이그레이션은 없음
 ├─ customer-journey-audience.ts    'email' 갈래에 글자 그대로 인라인 (T9가 정본과 대조)
 └─ deep-visitor-alert-guards-sql.ts  sql.raw로 끼움

고객 여정  enrichedInput → loadJourneyAudience
           → emailKeys(그대로) → splitEmailKeys → 문장 1개(related = PK ANY(…)) → facts → summarize(그대로)
깊이 알림  loadAudienceGuardsMany → 입력 계산(그대로) → audienceGuardsSql
           → runSql(이름 없는 문장) → 후처리(그대로)
```

## 4. 파일 계획

| 파일 | 새/수정 | 역할 | 예상 줄 |
|---|---|---|---|
| `src/lib/db/records-email-index.ts` | 새 | 인덱스 식 정본, `splitEmailKeys` | ~40 |
| `src/lib/db/send-log-indexes.ts` | 수정 | 항목 1개와 why 주석 | +8 |
| `src/lib/db/schema.ts` | 수정 | records 색인 선언 1줄, import, 주석 | +3 |
| `src/lib/customer-journey-audience.ts` | 수정 | related 재구성, `keys`·`email` 변수 | ~130 |
| `src/lib/deep-visitor-alert-guards-sql.ts` | 새 | 재료 문장 조립(새 grec)과 줄 타입 | ~120 |
| `src/lib/deep-visitor-alert.ts` | 수정 | 새 모듈 호출로 교체, 옮긴 것 삭제 | −60 |
| `scripts/check-customer-journey-priority.cjs` | 수정 | PGlite require를 `require('@electric-sql/pglite')`로, 머리 주석 설치 줄 삭제 | ±3 |
| `src/lib/db/pglite-harness.test-helper.ts` | 새 | PGlite 열기, DDL, insert, 태그 어댑터, 인덱스·INVALID 만들기, EXPLAIN, 계획 판독, `sqlLiteral` | ~150 |
| `src/lib/customer-journey-audience-legacy.test-helper.ts` | 새 | 예전 문장 oracle, fixture, `canonical`, `asConnection` | ~160 |
| `src/lib/deep-visitor-alert-guards-legacy.test-helper.ts` | 새 | 예전 문장 oracle, fixture | ~120 |
| `src/lib/db/records-email-index.test.ts` | 새 | T1~T5 | ~110 |
| `src/lib/db/send-log-indexes.test.ts` | 수정 | T6 | +20 |
| `src/lib/customer-journey-audience.test.ts` | 새 | T7~T9 | ~170 |
| `src/lib/deep-visitor-alert-guards-sql.test.ts` | 새 | T10·T11 | ~130 |
| `src/lib/customer-journey-audience.db.test.ts` | 새 | T12 (`EMAIL_STATS_TEST_URL` 있을 때만, 선례 `email-stats/worker.db.test.ts:9-10`) | ~170 |

## 5. 데이터/타입

```ts
// src/lib/db/records-email-index.ts
export const RECORD_EMAIL_KEY = "email";
/** PG에서 평가하면 EMAIL_TRIM_CHARS와 같다(B3). 역슬래시·$가 없어 태그 템플릿에 그대로 붙여도 같은 SQL이다 */
export const EMAIL_TRIM_SQL: string;
export const RECORD_EMAIL_PREFIX = 200;
/** records_workspace_email_norm_idx 둘째 열과 글자까지 같다. 바꾸면 인덱스 이름도 바꾼다(IF NOT EXISTS가 옛 인덱스를 남긴다) */
export function recordEmailIndexKeySql(data: string): string;
/** others에는 'email'이 없고 중복도 없다. indexed면 'email'을 더한 집합이 keys 집합과 같다 */
export function splitEmailKeys(keys: readonly string[]): { indexed: boolean; others: string[] };

// src/lib/deep-visitor-alert-guards-sql.ts
export interface AudienceGuardsSqlInput {
    orgId: string;
    visitorIds: number[];
    itemRecordIds: number[];
    unsubWorkspaceIds: number[];
    allEmails: string[];
    allStageValues: string[];
    specs: Array<{ workspaceId: number; keys: string[]; emails: string[] }>;
}
export interface GuardRecordJson { /* 지금 1924-1932 그대로 옮김 */ }
export interface AudienceGuardsRow {
    linked: Array<{ visitor_id: number; record_id: number | null }> | null;
    unsub: Array<{ record_id: number | null; workspace_id: number | null; email: string | null }> | null;
    records: GuardRecordJson[] | null;
    funnel_events: Array<{ record_id: number; type: string | null; label: string | null }> | null;
}
/** 결과 4칸은 2026-10-22 전 문장과 같다(B14). records는 id 순 */
export function audienceGuardsSql(input: AudienceGuardsSqlInput): SQL;

// src/lib/db/pglite-harness.test-helper.ts
export type TaggedSql = <T>(strings: TemplateStringsArray, ...params: unknown[]) => Promise<T>;
export interface CapturedQuery { text: string; params: unknown[]; rows: Record<string, unknown>[] }
export interface PlanNode {
    "Node Type": string; "Relation Name"?: string; "Index Name"?: string; "Index Cond"?: string;
    "Actual Loops"?: number; Plans?: PlanNode[];
}
export function openPglite(tables: PgTable[]): Promise<PGlite>;
export function insertRow(pg: PGlite, table: string, row: Record<string, unknown>): Promise<void>;
export function createRecordEmailIndex(pg: PGlite): Promise<void>;
export function setIndexValid(pg: PGlite, name: string, valid: boolean): Promise<void>;
export function pgliteTag(pg: PGlite, log?: CapturedQuery[]): TaggedSql;
export function sqlLiteral(value: unknown): string;
export function explainPrepared(pg: PGlite, q: { text: string; params: unknown[] },
    o: { mode: "generic" | "custom"; analyze: boolean }): Promise<PlanNode>;
export function planNodes(root: PlanNode): PlanNode[];
export function usesIndex(root: PlanNode, name: string): boolean;
export function executedFullScans(root: PlanNode, relation: string): PlanNode[];
```

## 6. behavior → 구현 · 고정 수단

| B | 구현 | 고정(테스트·증거) | 실행 |
|---|---|---|---|
| B1 | send-log-indexes 항목, schema 선언 | T6, T4 | pnpm test |
| B2 | 코드 변경 없음(`ensureSendLogIndexes`가 만듦) | T12: QA에서 `indisvalid` | QA → evidence |
| B3 | `EMAIL_TRIM_SQL` | T1 | pnpm test |
| B4 | 'email' 갈래 리터럴 식 | T8a | pnpm test |
| B5 | `splitEmailKeys`, emailKeys 줄 그대로 | T3, T7 | pnpm test |
| B6 | related `ANY(ARRAY(...))` | T7 | pnpm test |
| B7 | 같은 문장 | T7 | pnpm test |
| B8 | 매개변수 관문 | T8b | pnpm test |
| B9 | 인덱스에 기대지 않는 문장 | T7을 인덱스 없음 / valid / INVALID로 반복 | pnpm test |
| B10 | `left(…, 200)` | T5 | pnpm test |
| B11 | 인덱스와 재구성 | T12 | QA → `evidence/b2-b11-qa.txt` |
| B12 | 배포 | 10절 운영 EXPLAIN | Claude → `evidence/b12-prod.txt` |
| B13 | 전부 | pnpm test, tsc, eslint, cjs | U6 → evidence |
| B14 | `audienceGuardsSql` | T10 | pnpm test |
| B15 | `sql.raw` 키 식 | T11 | pnpm test |

## 7. TDD로 고정할 계약

**T1 (B3) 트림 리터럴**
- PGlite에서 `SELECT <EMAIL_TRIM_SQL> AS v` → `v === EMAIL_TRIM_CHARS`(길이 10, 순서까지).
- `btrim('vkim@x.cov', <EMAIL_TRIM_SQL>)`은 'v'를 지우지 않는다(`\v` 함정 대조).
- 10글자 각각을 'Foo@Bar.com' 앞뒤에 붙여도 `lower(btrim(값, <EMAIL_TRIM_SQL>))`가 `normalizeEmail` 결과와 같다.
- 첫 테스트에서 `version()`을 출력해 둔다.

**T2 식 글자**
- `recordEmailIndexKeySql("rm.data")`가 2-2의 확정 글자와 같다.
- `EMAIL_TRIM_SQL`과 식 문자열에는 역슬래시·`$`·백틱이 없고 ASCII 출력 문자만 있다.

**T3 (B5) `splitEmailKeys`**
- `[]` → `{false, []}` · `['email']` → `{true, []}` · `['email','work_email']` → `{true, ['work_email']}` · `['work_email']` → `{false, ['work_email']}` · `['email','email','x','x']` → `{true, ['x']}`
- 성질: others에 'email'이 없고 중복이 없다. `(indexed ? ['email'] : [])` ∪ others = `new Set(keys)`.

**T4 DDL 실행**: PGlite records에 새 ddl 실행 성공, `pg_get_indexdef`에 `left(`와 `200`이 있다.

**T5 (B10) 긴 값**
- 값: 결정적 의사난수 10,000글자(한글 음절 `0xAC00 + (i*7919+13) % 11172`, 압축되지 않는 약 30KB).
- 대조: `left`를 뺀 같은 식 인덱스에서는 INSERT가 `/index row size/` 오류로 실패해야 한다. 확인 뒤 지운다.
- 새 인덱스만 있을 때는 같은 값 INSERT와 다른 10KB 값 UPDATE가 성공한다.
- 대조 INSERT가 성공하면 값이 압축된 것이니 생성기를 바꾼다.

**T6 (B1) 인덱스 계약 — 정적 검사** (`send-log-indexes.test.ts`)
- `SEND_LOG_INDEXES`에 새 이름이 정확히 하나, ddl이 2-2 문자열과 정확히 같다.
- `schema.ts`에 2-2 선언 글자가 있다. `drizzle/*.sql`에 새 이름이 없다.

**T7 (B5·B6·B7·B9) 고객 여정 결과 동일 행렬**

fixture: 조직 A에 ws 8·9, 조직 B에 ws 10. 사이트 2는 ws 8. 방문자 5, 대상 세션 50(클릭 id 있음).

| 레코드 | 내용 (따로 적지 않으면 ws 8의 `email` 칸) |
|---|---|
| R1 | 대소문자만 다름 |
| R2~R11 | 트림 문자 10종 각각(앞 2번, 뒤 1번) |
| R12 | 가운데 공백 |
| R13 | 트림 집합 밖 공백(U+2002) |
| R14 / R15 / R16 | JSON 숫자 12345 / JSON 배열 / JSON null |
| R17 | email 키 없음, `work_email`만 있음 |
| R18 | ws 9, 같은 주소 |
| R19 | 조직 B ws 10, 같은 주소 |
| R20 | ws 8인데 org_id가 B (own 확인에서 빠져야 함) |
| R21 | 250자 주소 |
| R22 | 앞 200자는 R21과 같고 꼬리가 다름 |
| R23 | links로만 잡힘 |
| R24 | `tracker_visitors.record_id`로만 잡힘 |
| R25 | `visitor_record_links`로만 잡힘 |
| R26 | 값이 '　'만 있음(정규화하면 '') |
| T | 대상 레코드(다른 주소) |

- 깔때기 단계, record_events, 수신거부 줄을 하나씩 둔다.
- 조합 축(전부 곱함)
  - emailKeys 5가지: `[]`, `['email']`, `['email','work_email']`, `['work_email']`, `['email','email']` (`work_email`은 text형, 라벨 '업무 메일', 메일 모양 값)
  - 수신 주소 5가지: `'kim@sample.co.kr'`, `'　KIM@Sample.co.kr\n'`, 250자 주소(R21), `''`, `'12345'`
  - 인덱스 상태 3가지: 없음, valid, INVALID
- 단언
  - 모든 조합에서 `canonical(새 facts) == canonical(oracle facts)`, 반환값 == `summarize(oracle facts)`.
  - 헛돌지 않게: `['email']`, `'kim@…'`, valid 조합에서 related `_fixture` 집합이 {T, R1~R11, R23, R24, R25}(oracle 기준).
  - 권한 없음: 다른 사이트를 주면 oracle은 `authorized=false`, 새 함수는 "고객 여정 대상의 조직·사이트를 확인할 수 없습니다."로 reject.

**T8 (B4·B8) 계획**
- a. 인덱스 valid, `(['email'], 'kim@…')`에서 generic·custom 모두 `usesIndex(records_workspace_email_norm_idx)`.
- a 대조: 트림을 매개변수로 둔 같은 식
  ```sql
  PREPARE ctl AS SELECT rm.id FROM records rm
      WHERE rm.workspace_id = $1 AND left(lower(btrim(rm.data->>'email', $3)), 200) = left($2, 200)
  ```
  generic에서는 인덱스를 못 쓰고 custom에서는 쓴다(generic plan 함정이 실제로 있음을 보임).
- b. `EXPLAIN ANALYZE`, generic·custom 각각:

| emailKeys | 기대 |
|---|---|
| `['email']` | `executedFullScans(records)` 0개 |
| `['email','work_email']` | 1개 이상(판정기 대조) |
| `['work_email']` | 새 인덱스 노드가 없거나 Actual Loops 0 |
| `[]` | `executedFullScans` 0개, 새 인덱스 노드도 Actual Loops 0 |

**T9 정적 검사**
- `customer-journey-audience.ts` 소스에 `recordEmailIndexKeySql("rm.data")`의 출력 글자 + ` = left(${email}, 200)`가 정확히 한 번 있다.
- 같은 파일에 `.unsafe(`가 없다.

**T10 (B14) 깊이 알림 결과 동일**
- fixture: 조직 A(ws 8 사이트 있음, ws 9), 조직 B(ws 10). linked 방문자, 수신거부, record_events(signup 1개, 단계 라벨 1개).
- 입력 묶음
  1. 짝 의미: specs = ws 8 `['email']`/`['kim@x']`, ws 9 `['email','work_email']`/`['lee@y']`. ws 9의 `email='kim@x'`는 안 잡히고, ws 8의 `email='lee@y'`도 안 잡히고, ws 9의 `work_email='lee@y'`는 잡힌다.
  2. 주소 없는 워크스페이스(keys `[]`)
  3. visitorIds 빈 배열
  4. 같은 주소를 가진 조직 B 레코드(빠져야 함)
  5. 트림·대소문자가 다른 값, 250자 값
  6. allStageValues 있음/없음
- 비교: records(순서와 `email_match` 포함)·linked(순서 포함)가 같고, unsub·funnel_events는 다중집합이 같다.
- 헛돌지 않게: 1번에서 `email_match=true`인 id 집합을 직접 단언한다.

**T11 (B15) 깊이 알림 계획**
- 인덱스 valid, custom에서 `usesIndex`가 참.
- `EXPLAIN ANALYZE`: keys가 `['email']`뿐이면 `executedFullScans(records)` 0개, `work_email`이 있으면 1개 이상(대조).

**T12 (B2·B11) QA** — `EMAIL_STATS_TEST_URL`이 있을 때만.
- 준비: `openQa()`(QA DB만 허용)로 마이그레이션·잠금, DB 이름 확인 뒤 TRUNCATE(records 포함). ws 8에 records 100,000행(`generate_series`, email과 약 600B 채움, 대상 주소는 일부만), 다른 ws에 2만 행. 조직·파티션·사이트·방문자·세션·클릭·발송 기록도 만든다.
- B2: `ensureSendLogIndexes(QA URL)` 뒤 새 인덱스 `indisvalid = true`, 그다음 `ANALYZE records`.
- B11: 실제 postgres-js(`debug` 훅으로 문장·매개변수 캡처)와 `reserve()` 연결
  - 전: `legacyJourneyFacts` 1번, 잡은 문장으로 PREPARE generic·custom `EXPLAIN (ANALYZE, BUFFERS)` 출력.
  - 후: 같은 연결에서 `loadJourneyAudience`를 7번 연속(6번째부터 generic 가능). 각 호출 1초 안.
  - 후: generic·custom `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`에서 `executedFullScans` 0개, `records_workspace_idx`·`records_org_idx` 사용 노드 없음, Execution Time < 1000ms. TEXT 형식도 출력.
  - grec 전·후 EXPLAIN도 증거로 출력.
- finally에서 TRUNCATE, `release()`, `end()`.

## 8. 구현 순서 — Codex에 넘길 단위

모든 지시문 공통: "설계와 어긋나면 지어내지 말고 멈춰서 물어라" · 운영·개발 DB 접속 금지(PGlite·로컬 QA DB만) · 새 의존성·마이그레이션·journal 금지 · 주석은 why만, export 위 `/** */`는 호출부에서 안 보이는 계약만 · `any` 금지 · 파일 200줄 이하.

| # | 내용 | 먼저 RED | B | 통과 조건 |
|---|---|---|---|---|
| U0 (Claude) | 0단계 운영 읽기 전용 증거(10절) | — | B12 전 증거 | `evidence/stage0-prod.txt` |
| U1 | pglite-harness, 고객 여정 legacy helper, T7(인덱스 없음 상태만) | — | B6·B7 기준선 | **지금 코드에서 GREEN.** 실패하면 oracle·하네스를 고치고 제품 코드는 건드리지 않는다 |
| U2 | `records-email-index.ts` | T1·T2·T3 | B3·B5 | GREEN |
| U3 | send-log-indexes 항목, schema 선언, `createRecordEmailIndex` | T4·T5·T6 | B1·B10 | GREEN, tsc |
| U4 | related 재구성 | T7(세 상태)·T8·T9 | B4~B9 | GREEN |
| U5a | `deep-visitor-alert-guards-sql.ts`로 예전 문장 그대로 옮기기, legacy helper, T10 | — (옮긴 뒤 T10 GREEN) | B14 기준선 | GREEN, tsc |
| U5b | 새 grec | T11 (T10 계속 GREEN) | B14·B15 | GREEN |
| U6 | cjs require 수정과 회귀 | — | B13 | pnpm test, `tsc --noEmit`, 바꾼 파일 eslint, `node --import tsx scripts/check-customer-journey-priority.cjs` PASS |
| U7 | `customer-journey-audience.db.test.ts` | T12 | B2·B11 | QA에서 GREEN, 출력 전문 |
| U8 (Claude) | 커밋·배포(사용자 확인 뒤), 운영 확인 | — | B12 | `evidence/b12-prod.txt` |

- 순서: U0은 U1과 나란히. 그 뒤 U1 → U2 → U3 → U4 → U5a → U5b → U6 → U7 → U8. U5는 U0의 grec 결과로 열린 질문 1을 정한 뒤에 한다.
- 커밋 제안(각각 사용자 확인 뒤): [U1–U3] 인덱스 계약과 시험 하네스 · [U4] 고객 여정 조회 · [U5] 깊이 알림 · [U6–U7] 회귀와 QA 증거

## 9. 바꾸지 않을 것

- **파일 전체**: `deep-visitor-alert-rules.ts`(`EMAIL_TRIM_CHARS`, `normalizeEmail`, `contactKindOf`), `customer-journey-source.ts`, `db/index.ts`(풀 크기, statement_timeout), `drizzle/*.sql`, `drizzle/meta/_journal.json`
- **`loadJourneyAudience`**: export 시그니처와 `Connection` 형, emailKeys 산출 줄(52), own·visits·links·identities·funnel CTE, 바깥 SELECT 모든 칸(`identifiedEmails`는 전체 emailKeys, `unsubscribed` 비교식 그대로), `summarizeJourneyAudience`, `isJourneyInternalEmail`
- **깊이 알림**: `loadAudienceGuardsMany`의 입력 계산(1966-1993)과 후처리(2042-2112), linked·unsub·fev CTE와 바깥 SELECT 글자, `email_match` 의미, `runSql`, `emailPairsByKey`, `emailKeysOf`, `contextsSql`
- **인덱스 관련**: `ensureSendLogIndexes` 흐름과 잠금 키, 기존 7개 항목, `SEND_LOG_INDEXES_READY_SQL`, `RECORDS_INDEX_READY_SQL`, schema.ts 기존 records 색인 4개와 다른 표
- **cjs 검사 스크립트**: require 줄과 머리 주석 말고는 그대로(가짜 conn 포함)
- **범위 밖 경로**: `tracker/match-record.ts`, `api/tracker/identify/route.ts`, `email-visit-ack.ts`, email_unsubscribes·email_send_logs 쪽 정규화 비교
- **운영 데이터**: ANALYZE·REINDEX·DROP INDEX는 사용자 요청 시에만

## 10. 운영 반영과 확인 (Claude)

**0단계** — U4 전, 읽기 전용, 발송 시간대 밖 권장
- `SHOW server_version`, `SHOW server_encoding`(UTF8이어야 함)
- records 상태: `pg_relation_size`, `pg_total_relation_size`, 인덱스 목록, `n_tup_upd`, `n_tup_hot_upd`, `last_autoanalyze`
- 고객 여정 "전" 계획: 워크스페이스 8 최근 대상 1건으로 문장을 잡아(실행하지 않는 캡처 함수) 아래 순서로 실행(ANALYZE 없음)
  ```sql
  BEGIN READ ONLY;
  SET LOCAL statement_timeout = '30s';
  PREPARE j AS <문장>;
  SET LOCAL plan_cache_mode = force_generic_plan;
  EXPLAIN EXECUTE j(<리터럴 인자>);
  SET LOCAL plan_cache_mode = force_custom_plan;
  EXPLAIN EXECUTE j(<리터럴 인자>);
  ROLLBACK;
  ```
- grec "전" 계획: 같은 조직 최근 깊이 알림 입력으로 `EXPLAIN <문장>`(custom).

**배포** — 사용자 요청 시, 평일 18시 이후 권장
- 부팅 로그 `[indexes] … 색인 준비됨 (…, 새로 1개)` 확인. 실패하면 다음 부팅에 다시 만든다.
- 인덱스를 만드는 동안은 INVALID라 예전 경로로 동작한다(B9).

**B12** — 배포 뒤, 읽기 전용
- 새 인덱스 `indisvalid = true`.
- 0단계와 같은 문장의 generic·custom EXPLAIN에 `records_workspace_email_norm_idx`가 나온다. 나오지 않으면 열린 질문 3으로 간다.

## 11. 도메인 체크리스트

| 영역 | 결과 |
|---|---|
| 데이터 모델 | 칼럼·스키마·마이그레이션 변경 없음. records 표현식 인덱스 1개. 크기 약 20MB 추정 [미확인]. |
| API 계약 | 응답 모양 그대로. 레코드 집합이 같아 알림·재알림·key-leads·lead-followup·방문 감사 결과가 같다. |
| 상태 관리 | 해당 없음. |
| 보안·테넌트 격리 | related는 `JOIN own` 유지, 인덱스 갈래는 workspace_id로 좁히고 바깥에서 org 재확인. grec는 `r.org_id = $org` 유지. 인라인·`sql.raw`에는 코드 상수만, 값은 모두 매개변수. |
| 동시성 | CONCURRENTLY, advisory 잠금, INVALID 재시도는 기존 그대로. |
| 성능 | 한 문장 구조 유지(N+1 없음). 쓰기는 행마다 식 계산과 인덱스 항목 1개 증가. HOT은 기존 data 표현식 인덱스(drizzle/0068) 때문에 이미 막혀 있어 새로 잃지 않는다. |

## 12. PLAN과 어긋나는 곳

1. 트림 리터럴 표기: `\x0B`·`U&`·실제 문자 대신 `chr()` 이어 붙이기(2-1).
2. 리터럴은 인덱스 조건 쪽에만 쓰고, 재확인은 예전 비교(매개변수 트림) 그대로다.
3. 새 제품 파일 `deep-visitor-alert-guards-sql.ts`를 만든다(B14를 db 없는 모듈로 시험).
4. B14는 `loadAudienceGuardsMany` 반환값이 아니라 문장 결과 4칸으로 고정한다.
5. 테스트 도우미 셋(하네스 하나, oracle 둘)과 QA 시험 파일 하나(200줄 기준).
6. 공유 모듈 위치를 `src/lib/db/records-email-index.ts`로 정했다.
7. cjs require 경로는 조건부가 아니라 이번에 고친다(`.testenv`가 없음).
8. B11에 실제 드라이버 7번 연속 호출 시간도 본다(generic plan 전환까지 덮음).

## 13. 리스크와 열린 질문

**리스크**
- **통계 공백**: 새 식은 다음 ANALYZE까지 통계가 없다. 바깥은 PK `ANY`라 무관하고, 'email' 갈래는 두 열 등호라 기본 추정으로도 인덱스가 선택될 것으로 본다 [미확인 — B12에서 확인].
- **PG 버전 차이**: PGlite, QA 17, 운영 16.15가 다르다. 최종 판정은 B12.
- **배포 직후 I/O**: 인덱스를 만드는 동안 heap을 두 번 읽고 정렬한다. 그동안 조회 속도는 예전과 같다.
- **식 표류**: 정본 모듈, T6, T9, B4로 막는다. 식을 바꿀 때는 인덱스 이름도 바꾼다.
- **'email' 밖 키**: 예전처럼 워크스페이스를 훑는다. 드문 경우다.
- **하네스 충실도**: 어댑터는 PGlite 직렬화를 쓴다. T12가 실제 드라이버로 보완한다. 결과를 의도적으로 바꾸는 변경을 하면 oracle도 함께 고쳐야 한다.
- **P2 영향 범위**: 깊이 알림은 탐지와 보내기 전 재확인 둘 다에 영향. T10 없이는 넣지 않는다.

**[미확인]**: PGlite의 `CONCURRENTLY` 지원(대체 방법 정해 둠), PGlite의 PG 버전, 운영 server_encoding, 운영 records 전체 크기와 새 인덱스 크기, 배포 뒤 통계 전 플래너 선택.

**열린 질문 (사용자 결정)**
1. 0단계 grec 계획에 records 통째 읽기가 없으면 U5를 다음 사이클로 미룰까? 기본안: 승인대로 이번에 포함.
2. 배포 시각. 권장: 평일 18시 이후.
3. B12에서 새 인덱스를 안 쓰고 원인이 통계 공백이면 `ANALYZE records`를 할까? 데이터는 바뀌지 않지만 PLAN 범위 밖이라 요청 시에만.
4. B12에 `EXPLAIN ANALYZE`(실제 실행, 읽기 전용)를 더할까? 기본안: 하지 않음.
