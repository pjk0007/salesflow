# REVIEW — docs/2026-10-22-journey-email-index/ · 2026-10-22 (1회차)

범위: 작업 트리 변경분 중 지정 파일만 (수정 6개: scripts/check-customer-journey-priority.cjs, src/lib/customer-journey-audience.ts, src/lib/db/schema.ts, src/lib/db/send-log-indexes.ts(+test), src/lib/deep-visitor-alert.ts / 새 파일 9개). docs/archive와 docs/guides는 범위 밖.
판정: 🔴 0 · 🟡 2 · 🟢 5

결론: 버그·보안 문제는 찾지 못했습니다. 찾는 레코드 집합과 테넌트 격리는 예전 문장과 같습니다. 남은 것은 표류 방지를 단단히 하는 컨벤션 지적과 배포 때 확인할 운영 항목입니다.

직접 돌려 본 것:
- `node --import tsx --test` 4파일(customer-journey-audience / records-email-index / send-log-indexes / deep-visitor-alert-guards-sql): 18 중 18 통과.
- `npx drizzle-kit export`: schema.ts가 새 import로도 정상 로딩됨. `CREATE INDEX "records_workspace_email_norm_idx" ... ("workspace_id",left(lower(btrim("data"->>'email', chr(32)||…)), 200))`가 출력됨.

## 🔴 버그 (0)
이상 없음. 아래는 확인한 근거입니다.
- **related (customer-journey-audience.ts:80-94)**
  - `JOIN own` 대신 쓴 스칼라 조건 `r.workspace_id = (SELECT workspace_id FROM own) AND r.org_id = (SELECT org_id FROM own)`은 결과가 같습니다. own은 `w.id`·`site.id` PK 등호라 최대 1행이고, 0행이면 NULL이 되어 결과가 비므로 예전과 같습니다. 1행이 넘어 스칼라 서브쿼리 오류가 날 경로도 없습니다.
  - `= ANY(ARRAY(...))`는 id 중복이나 NULL(links/identities)이 있어도 행을 한 번만 돌려주고, NULL 원소에는 맞지 않습니다.
  - 'email' 갈래는 인덱스 조건 `left(…,200) = left($email,200)`로 찾고 예전 비교로 다시 확인합니다. 재확인 식이 참이면 앞 200자도 반드시 같으므로 예전 EXISTS의 'email' 키와 같은 집합입니다. 정규화하면 빈 문자열인 값, JSON 숫자·배열·null도 양쪽이 같게 동작합니다.
  - 갈래 안은 `target.workspaceId`로만 좁히지만, 바깥 조건이 own의 org·ws를 다시 겁니다. 그래서 ws는 같고 org가 다른 행(R20)은 빠집니다.
- **grec (deep-visitor-alert-guards-sql.ts:41-78)**
  - 바깥 `r.org_id = $org`가 그대로 있습니다. 인덱스 갈래 `unnest(ws[],emails[]) JOIN records rm ON rm.workspace_id = p.ws AND …`는 예전 `(r.workspace_id, norm) IN (짝)` 중 'email' 키 부분과 같습니다. 짝 의미도 유지돼, ws 9의 kim@x가 ws 8 수신 주소로 잡히지 않습니다(T10에서 확인).
  - others 갈래는 예전 조각을 그대로 쓰고, org 조건도 이중으로 걸립니다. `email_match`는 같은 조각을 찾은 행에만 계산하므로 값도 같습니다.
- **갈래 관문**: `${keys.indexed}::boolean`과 `cardinality(${keys.others}::text[]) > 0`은 표 열을 참조하지 않습니다. 그래서 generic plan에서는 One-Time Filter가 되고 custom plan에서는 false로 접힙니다(T8b).

## 🔴 보안 (0)
이상 없음.
- **인젝션**: `sql.raw`에 들어가는 것은 모두 코드 상수입니다. `recordEmailIndexKeySql("rm.data")` · `String(RECORD_EMAIL_PREFIX)` · alias 리터럴 유니언 `"r" | "ro"`가 전부입니다. `pairsMatchSql`의 key는 `${key}::text` 매개변수입니다. 고객 여정의 인라인 `chr()` 사슬은 정적 글자이고, 사용자에게서 오는 값(email·workspaceId·recordId·keys)은 모두 `$n`입니다.
- **테넌트 격리**: 위 버그 절과 같습니다. related는 own의 org·ws를 바깥에서 다시 걸고, grec는 `r.org_id`를 유지합니다.
- 새 라우트나 인가 경로 변경은 없습니다.

## 🟡 컨벤션 (2)
- **src/lib/db/records-email-index.ts:8**: `recordEmailIndexKeySql(data: string)`은 받은 글자를 그대로 SQL 식에 넣고, 그 식이 `sql.raw`와 DDL로 갑니다. 지금은 "코드 상수만"이라는 JSDoc 계약에만 기대고 있습니다.
  - 제안: 인자 타입을 `'"data"' | "rm.data"` 같은 리터럴 유니언으로 좁혀 컴파일러가 막게 합니다. guards-sql의 `alias: "r" | "ro"`와 같은 방식입니다.
- **src/lib/deep-visitor-alert-guards-sql.ts:46**: 재확인 식이 `rm.data->>'email'`을 하드코딩합니다. 바로 위 갈래 선택(`pairs.get(RECORD_EMAIL_KEY)`)과 45행 인덱스 식은 상수를 씁니다. customer-journey-audience.ts:87도 같은 하드코딩입니다.
  - 지금은 T2가 `RECORD_EMAIL_KEY === "email"`과 `PREFIX === 200`을 고정하고 있어 실제로 어긋나지는 않습니다. 다만 정본 한 곳 원칙과 어긋납니다.
  - 제안: guards 쪽은 재확인을 `${RECORD_EMAIL_KEY}::text` 매개변수로 바꿉니다. 재확인은 인덱스와 맞을 필요가 없습니다.

## 🟢 nit (5)
- **src/lib/deep-visitor-alert-guards-sql.ts:34**: `/** 결과 4칸은 변경 전과 같다 … */`의 "변경 전과 같다"는 이력이라 시간이 지나면 의미가 없어집니다. 호출부가 알아야 할 계약인 "records는 id 순, linked는 src·ord 순"만 남기는 편이 낫습니다.
- **src/lib/deep-visitor-alert-guards-sql.ts:26**: 지운 `sameEmailSql`의 why가 함께 사라졌습니다. 내용은 "Postgres trim()은 공백만 지워 JS와 어긋나 btrim(EMAIL_TRIM_CHARS)를 쓴다"와 "(ws, 주소) 짝으로 비교"였습니다. 한 줄 why로 남기는 것을 권합니다.
- **src/lib/db/records-email-index.ts:14**: boolean `indexed`가 `is/has*` 규칙에 맞지 않습니다(예: `hasEmailKey`). DESIGN이 확정한 이름이라 바꾸려면 DESIGN도 같이 고쳐야 합니다.
- **src/lib/deep-visitor-alert-guards-sql.test.ts:38 · src/lib/deep-visitor-alert-guards-legacy.test-helper.ts:59-60**: 코드 중간에 `import`가 있습니다. 파일 맨 위로 올리면 됩니다.
- **src/lib/customer-journey-audience.ts:125**: `unsubscribed` 비교가 `normalizeEmail(target.recipientEmail)`을 다시 계산합니다. 위에 같은 값인 `email` 변수가 있습니다. DESIGN 9절이 "글자 그대로"로 묶어 둔 자리라 지금은 둬도 됩니다.
- (사소) **src/lib/db/send-log-indexes.test.ts:44**: 테스트 이름만 영어입니다(같은 파일의 S2는 한국어).

## 확인 필요
- **배포 때 I/O와 60초 시간 제한이 겹침**
  - 인덱스 생성 연결은 `SET statement_timeout = 0`이라 생성 자체는 끊기지 않습니다(send-log-indexes.ts:104).
  - 하지만 CONCURRENTLY가 557MB를 두 번 읽고 정렬하는 동안(`maintenance_work_mem` 기본값이면 디스크로 넘침), 인덱스가 아직 INVALID라 고객 여정과 grec는 예전처럼 통째로 읽습니다.
  - d4a98c6의 풀 연결 60초 제한과 디스크 경쟁이 겹치면 이 시간대 조회가 시간 초과로 실패할 수 있습니다. 계획대로 한가한 시간에 배포하고 부팅 로그 "새로 1개"를 확인해야 합니다.
  - 필요하면 그 연결에서만 `SET maintenance_work_mem`을 올리는 방안도 있습니다.
- **중간에 끊기면 남는 INVALID 인덱스**: 배포나 재시작으로 생성이 끊기면 INVALID 인덱스가 남습니다. 이 인덱스는 indisready 상태라 쓰기 때마다 계속 갱신됩니다. 다음 부팅에 DROP 후 다시 만드는 기존 경로로 회복되지만, 그때까지 쓰기 비용만 늘어납니다.
- **표현식 통계 공백**: CREATE INDEX는 표현식 통계를 모으지 않아 다음 자동 ANALYZE까지 기본 선택도로 추정합니다. 배포 뒤 B12 운영 EXPLAIN에서 인덱스를 쓰는지 확인해야 합니다(DESIGN 열린 질문 3).
- **drizzle-kit push/generate**: schema.ts에 선언만 하고 마이그레이션은 없는 구조라, `db:push`나 `drizzle-kit generate`를 돌리면 CONCURRENTLY가 아닌 일반 CREATE INDEX가 나옵니다. records에 그렇게 만들면 생성 내내 쓰기가 막힙니다.
  - `records_org_created_at_idx` 등 기존 부팅 생성 인덱스도 같은 구조이고, meta 스냅샷이 0000뿐이라 새로 생긴 위험은 아닙니다.
  - 그래도 이번 대상이 557MB 표라 개발·운영 DB에 push를 쓰지 않는다는 점을 다시 확인해 두면 좋겠습니다.

참고 경로: /Users/jaehun/Projects/salesflow/src/lib/customer-journey-audience.ts, /Users/jaehun/Projects/salesflow/src/lib/deep-visitor-alert-guards-sql.ts, /Users/jaehun/Projects/salesflow/src/lib/db/records-email-index.ts, /Users/jaehun/Projects/salesflow/src/lib/db/send-log-indexes.ts, /Users/jaehun/Projects/salesflow/src/lib/db/schema.ts

---

# REVIEW (2회차) — 2026-10-23

판정: 🔴 0 · 🟡 0 · 🟢 5(그대로 둠)

- 🟡 `records-email-index.ts:8`: 인자를 `'"data"' | "rm.data"` 리터럴 유니언으로 좁혔다. 생성되는 SQL은 같다.
- 🟡 `deep-visitor-alert-guards-sql.ts:46`: 재확인 키를 `${RECORD_EMAIL_KEY}::text` 매개변수로 바꿨다. 인덱스 조건(45행)은 그대로라 인덱스 사용에 영향이 없다.
- 🟢 nit 5건은 동작 영향이 없어 이번에는 남긴다. `customer-journey-audience.ts:87`의 하드코딩은 인덱스 식과 같은 줄 구조를 유지하려고 둔다(T2가 값을 고정).

재확인: `tsc --noEmit` exit 0 · 4파일 단위 테스트 18/18 · QA DB 테스트 1/1 · 바꾼 2파일 eslint exit 0.
