# PLAN — 고객 여정 방문자 매칭 조회 속도 개선 (records 'email' 표현식 인덱스)

- **track**: Full
- **사이클 ID**: `2026-10-22-journey-email-index`

## 목표

`loadJourneyAudience`(src/lib/customer-journey-audience.ts)의 `related` CTE는 "수신 주소와 같은 메일 값을 가진 레코드"를 찾으려고 같은 워크스페이스의 records를 전부 읽는다(워크스페이스 8은 11.7만 행). 그래서 한 번에 20~30초, 디스크 경쟁 때는 7분까지 걸린다(2026-10-22 운영).

이 함수는 `enrichedInput`을 거쳐 여러 곳에서 쓴다.
- 고객 여정 알림 워커
- 후속 재알림
- CRM 핵심 리드(`/api/analytics/key-leads`)
- 레코드 후속 대응(`/api/records/[id]/lead-followup`)
- 방문 감사 메일(capture·delivery)

풀 연결에는 statement_timeout 60초가 걸려 있다(d4a98c6). 레코드가 늘면 이 조회가 60초를 넘겨 알림과 화면이 실패한다.

**찾는 레코드 집합은 한 건도 바꾸지 않고**, `(workspace_id, 정규화한 'email' 값)` 표현식 인덱스로 찾게 해서 이 조회를 1초 안으로 줄인다. 같은 패턴인 깊이 알림 `grec`도 같은 인덱스로 고친다(P2).

## 조사 결과

### 1. emailKeys는 대상 레코드 값에 따라 호출마다 달라진다

- **칸 목록**: `loadCandidates`가 `field_definitions`에서 읽는다(customer-journey-source.ts:30-31). 대상 워크스페이스의 칸과, `COALESCE(파티션 field_type_id, 워크스페이스 기본 field_type_id)` 칸이다.
- **값**: `cardInput`(customer-journey-source.ts:94-95)이 칸마다 값을 채운다.
  - `_`로 시작하는 키와 file 형식은 뺀다.
  - 값은 **대상 레코드**의 `data[key]`를 String으로 바꾼 것이다.
  - JS trim 뒤 빈 칸은 버린다.
- **판정**: `emailKeys = fields.filter(contactKindOf(f) === "email")`(customer-journey-audience.ts:52). `contactKindOf`(deep-visitor-alert-rules.ts:1108-1121) 규칙은 이렇다.
  - field_type이 'email'이면 값과 상관없이 email이다.
  - 'text'이면 이름·회사 규칙에 걸리지 않아야 한다. 그다음 키·라벨이 `/(메일|e-?mail)/i`에 맞고 값이 메일 모양일 때만 email이다.
- **운영 실측(2026-10-22, 읽기 전용)**
  - field_type='email'인 칸은 키가 모두 `email`이다(29곳).
  - 'text'면서 키·라벨에 메일 힌트가 있는 칸은 4개다.
    - `email`(ft13): 키가 같아서 인덱스 갈래에 들어간다.
    - `adName`(유입 메일), `emailConf`(이메일_신뢰도) 2개: 값이 메일 모양일 때만 들어가므로 드물다.
  - 고객 여정 알림 대상 워크스페이스는 8과 9 두 곳이다.
  - 결론: 사실상 모든 호출이 'email' 키 하나로 끝난다. 그 밖의 키는 드문 예외라 지금처럼 비교해도 된다.

### 2. 인덱스만 만들어서는 해결되지 않는다

- **비교 키가 변수**: 키가 `unnest(배열)`의 열(`k.key`)이라 어떤 표현식 인덱스와도 식이 같아질 수 없다.
- **OR 구조**: `r.id = $ OR r.id IN (links) OR r.id IN (identities) OR EXISTS(...)`에는 인덱스로 풀 수 없는 갈래가 섞여 있다. 그래서 BitmapOr를 못 쓰고 워크스페이스 전체를 읽으며 거른다.
- **파라미터 vs 상수**: 이 조회는 reserve 연결의 태그 템플릿이라 이름 붙은 prepared statement로 간다. generic plan에서는 `$n`이 상수로 접히지 않아 인덱스 식과 맞지 않는다. 같은 문제가 deep-visitor-alert.ts:125-128에 기록돼 있다.
  - 결정: **'email' 키와 트림 문자는 SQL 리터럴로 쓰고**, 비교값과 workspace_id만 파라미터로 둔다.
- **리터럴 함정**: `EMAIL_TRIM_CHARS`(deep-visitor-alert-rules.ts:834)는 10글자이고 `\v`를 포함한다. Postgres `E''`는 `\v`를 모르고 'v' 글자로 읽는다. 그러면 메일 끝의 v가 지워진다. 따라서 `\x0B`, `U&'\000B'`, 실제 문자 중 하나로 쓰고, PG에서 평가한 값을 테스트로 고정한다.

### 3. 같은 패턴이 있는 곳

**이번 인덱스로 함께 고칠 대상**
- **src/lib/customer-journey-audience.ts:73-77**: 이번 대상이다.
- **src/lib/deep-visitor-alert.ts:1940-1946(`sameEmailSql`) + 2019-2026(`grec`)** (P2)
  - 정규화 방식이 같다.
  - OR 구조 때문에 조직 전체 records를 읽는다.
  - 탐지(1453)와 보내기 직전 재확인(1001)이 모두 이 쿼리를 쓴다.

**후속 후보 (범위 밖)**
- **src/lib/tracker/match-record.ts:146-150**: btrim 없이 `lower`만 쓴다. 정규화가 달라서 이번 인덱스를 그대로 못 쓴다.
- **src/app/api/tracker/identify/route.ts:93-98**: 정규화가 없다. LIMIT 1에 ORDER BY가 없어 "같은 결과"부터 정의해야 한다.
- **src/lib/email-visit-ack.ts:50-56**: PK로 레코드를 찾은 뒤 거르는 구조라 같은 문제가 아니다.

### 4. 후보 비교 → (b) 추천

- **(a) 정규화 칼럼이나 조회 표**
  - STORED 생성 칼럼은 557MB 표를 다시 써서 그동안 표가 잠긴다.
  - 앱 코드로 칼럼을 유지하면 쓰기 경로 하나만 빠져도 값이 어긋난다.
  - 트리거와 백필 방식은 정확하지만, 키가 사실상 'email' 하나뿐인 지금 데이터에는 과하다.
- **(b) 표현식 인덱스 + 쿼리 재작성 (추천)**
  - DB가 값을 계산하므로 쓰기 경로와 어긋나지 않는다.
  - 부팅 후 CONCURRENTLY로 만드는 관례(send-log-indexes.ts)를 그대로 쓴다.
  - 'email' 키만 인덱스로 찾고, 나머지 키는 지금처럼 비교한다.
- **(c) 발송·방문 이력으로 먼저 좁히기 (불가)**
  - 발송이나 방문 이력이 없는 같은 주소 레코드(폼 가입 등)를 놓친다. 결과가 바뀐다.

### 5. 테스트

- `pnpm test`는 `tsx --test "src/**/*.test.ts"`다.
- QA DB 테스트는 `EMAIL_STATS_TEST_URL`(127.0.0.1/sendb_email_stats_qa)이 있을 때만 돈다.
- `@electric-sql/pglite`가 이미 devDependency이고 esign 테스트가 쓰고 있다. 외부 DB 없이 결과 동일 테스트를 만들 수 있다.
- 제안: 예전 SQL을 테스트에 oracle로 고정하고, 같은 PGlite 데이터에서 새 결과와 비교한다.
- 인덱스 매칭은 EXPLAIN으로 본다. `enable_seqscan=off`, 그리고 `PREPARE` + `plan_cache_mode=force_generic_plan`으로 generic plan도 확인한다.

## 단계별 작업

구현(1~5단계)은 DESIGN 승인 뒤 Codex에 위임한다.

0. **"전" 증거 남기기**
   - 운영에서 워크스페이스 8의 실제 대상 하나로 지금 쿼리를 `EXPLAIN`(ANALYZE 없이, 읽기 전용)한다.
   - 깊이 알림 `grec`도 같은 방식으로 본다. 느리지 않으면 5단계는 다음 사이클로 미룬다.
1. **기준선 테스트**
   - PGlite 하네스(schema 기반 DDL + 가짜 conn)와 경계 사례 fixture를 만든다.
   - "예전 SQL oracle == 지금 함수 결과"가 녹색인지 확인한다.
2. **트림 리터럴과 인덱스 계약**
   - 공유 SQL 리터럴 모듈을 만든다(B3).
   - `SEND_LOG_INDEXES`와 schema.ts에 records 인덱스를 선언하고, 계약 테스트를 둔다(B1).
   - 키 길이 제한 방식은 DESIGN에서 정한다(B10).
3. **`related` 재구성**
   - emailKeys를 'email'과 나머지 키로 나눈다.
   - related를 PK 조회로 바꾼다. 찾는 id는 대상 id, links, identities, 'email' 인덱스 갈래, 나머지 키 갈래의 합집합이다.
   - `JOIN own`(조직·워크스페이스 확인)은 유지한다.
4. **성능 증거**
   - QA DB에 10만 행 fixture를 만든다.
   - 전후 `EXPLAIN (ANALYZE, BUFFERS)`를 저장한다(B11).
   - `ensureSendLogIndexes()`로 인덱스가 valid가 되는지 확인한다(B2).
5. **(P2) 깊이 알림 `grec`**
   - 같은 방식으로 재구성한다(B14·B15).
6. **회귀 확인**
   - `pnpm test`, `tsc --noEmit`, 바꾼 파일 eslint를 돌린다.
   - `scripts/check-customer-journey-priority.cjs`가 PASS하는지 본다(B13).
7. **반영**
   - 커밋, 푸시, 배포는 사용자 확인 후에 한다. 부팅 때 557MB를 두 번 읽으므로 한가한 시간에 배포한다.
   - 배포 뒤 운영 EXPLAIN으로 인덱스를 쓰는지 확인한다(B12).

## 건드릴 파일

- **src/lib/customer-journey-audience.ts**: `related` 재구성, emailKeys 나누기, 리터럴 적용.
- **src/lib/db/send-log-indexes.ts**: records 인덱스 1개와 사유 주석 추가.
- **src/lib/db/schema.ts**: 같은 이름의 records 인덱스 선언.
- **src/lib/db/send-log-indexes.test.ts**: 새 인덱스 계약 테스트.
- **(새) 트림 SQL 리터럴 모듈**: 이름과 위치는 DESIGN에서 정한다. `@/` import가 없어야 한다.
- **(새) src/lib/customer-journey-audience.test.ts**: PGlite로 결과 동일, 인덱스 매칭, 리터럴, 긴 값을 확인한다.
- **(새, 필요하면) PGlite 테스트 도우미 `*.test-helper.ts`**
- **(P2) src/lib/deep-visitor-alert.ts**: `sameEmailSql`/`grec` 재구성.
- **(조건부) scripts/check-customer-journey-priority.cjs**: PGlite require 경로 수정.
- **건드리지 않음**: deep-visitor-alert-rules.ts, customer-journey-source.ts, db/index.ts, drizzle 마이그레이션.
- 새 의존성은 없다.

## behavior 목록

- **B1**: `SEND_LOG_INDEXES`에 records 'email' 정규화 표현식 인덱스가 `CREATE INDEX CONCURRENTLY IF NOT EXISTS`로 있다. schema.ts에 같은 이름이 선언돼 있고, 마이그레이션 SQL에는 없다. (P1)
- **B2**: QA DB에서 `ensureSendLogIndexes()`를 돌리면 새 인덱스가 `indisvalid = true`로 생긴다. (P1)
- **B3**: 트림 SQL 리터럴을 PG에서 평가한 값이 `EMAIL_TRIM_CHARS`(10글자, `\v` 포함)와 정확히 같다. (P1)
- **B4**: 'email' 갈래가 custom plan과 generic plan 모두에서 새 인덱스를 쓴다. (P1)
- **B5**: emailKeys 산출 규칙은 그대로다. 'email'과 나머지 키로 나눈 결과를 합치면 원래 emailKeys와 같다. (P1)
- **B6**: 같은 데이터와 대상에서 새 `related` 레코드 집합이 예전 SQL 결과와 같다. 다음 경우를 모두 확인한다. (P1)
  - 대소문자 차이
  - 앞뒤 트림 문자 10종 각각
  - 가운데 공백, 트림 집합 밖 공백
  - 값이 JSON 숫자·배열·null이거나 키가 없음
  - 같은 주소의 다른 워크스페이스·다른 조직 레코드
  - emailKeys가 `[]`, `['email']`, `['email','work_email']`, `['work_email']`
  - 대상 'email' 칸이 비어 있음
  - 대상·links·identities로만 잡히는 레코드
- **B7**: `AudienceFacts` 전체와 `loadJourneyAudience` 반환값이 예전 SQL로 만든 값과 같다(배열 순서는 무시). (P1)
- **B8**: 나머지 키가 없으면 그 갈래는 records를 읽지 않는다. 있으면 예전과 같은 비교로 찾는다. (P1)
- **B9**: 새 인덱스가 없거나 INVALID여도 오류 없이 같은 결과를 낸다. (P1)
- **B10**: 새 인덱스가 있어도 'email' 값이 아주 긴(10KB) 레코드의 INSERT·UPDATE가 성공한다. (P1)
- **B11**: QA DB 10만 행 fixture에서 새 조회에 records 전체 읽기가 없고 1초 안에 끝난다. 전후 증거를 저장한다. (P1)
- **B12**: 배포 뒤 운영 EXPLAIN(읽기 전용)에서 워크스페이스 8 대상 조회가 새 인덱스를 쓴다. (P1)
- **B13**: `pnpm test`, `tsc --noEmit`, 바꾼 파일 eslint가 통과하고, `check-customer-journey-priority.cjs`가 PASS한다. (P1)
- **B14**: 깊이 알림 `loadAudienceGuardsMany` 결과가 예전 SQL과 같다. (P2)
- **B15**: 깊이 알림 `grec`의 'email' 갈래가 새 인덱스를 쓴다. (P2)

## 리스크와 불확실성

- **'email' 밖 키**: 'email' 밖의 메일 키가 들어간 드문 대상은 지금처럼 워크스페이스를 훑는다. 결과는 같고 그 경우만 느리다. 운영 실측으로는 해당 칸이 2종이고 값이 메일 모양일 때만 들어간다.
- **식 불일치**: 리터럴 바이트 차이, `\v` 함정, 파라미터 바인딩 중 하나라도 어긋나면 인덱스를 조용히 쓰지 않는다. B3·B4로 막고 운영 EXPLAIN으로 최종 확인한다.
- **btree 항목 크기 한도(약 2.7KB)**: 아주 긴 값이 있으면 인덱스 생성이 실패하고, 생성 뒤에는 그런 값을 쓰는 쓰기가 실패할 수 있다. 길이를 제한한 키로 막는다(B10).
- **배포 직후**: 인덱스를 만드는 동안 557MB를 두 번 읽는다. 그동안 조회는 예전처럼 느리고 I/O 부하가 생긴다.
- **쓰기 비용**: data를 바꿀 때마다 인덱스 항목이 하나 늘어난다. data를 참조하는 인덱스가 이미 있어서 HOT 손실이 새로 생기지는 않는다.
- **통계 공백**: 다음 ANALYZE 전까지 새 표현식에는 통계가 없다. 운영 EXPLAIN으로 인덱스를 쓰는지 확인한다.
- **PG 버전 차이**: PGlite와 운영의 PG 버전이 다를 수 있다. 최종 판단은 운영 EXPLAIN으로 한다.
- **깊이 알림 영향 범위**: P2는 탐지와 재확인에 모두 영향을 준다. B14 없이는 넣지 않는다.

## 검증 방법

- **`pnpm test`**: B1, B3~B10, B14·B15. 외부 DB 없이 PGlite로 돈다.
- **QA DB**(sendb_email_stats_qa): B2, B11.
- **명령**: `npx tsc --noEmit`, `npx eslint <바꾼 파일>`, `node --import tsx scripts/check-customer-journey-priority.cjs`(B13).
- **운영(배포 뒤, 읽기 전용)**: 부팅 로그와 EXPLAIN(B12).

## 범위 밖

- tracker 경로(match-record.ts, identify/route.ts)와 email-visit-ack.ts
- matchField·전화 JSON 조회
- email_send_logs·email_unsubscribes 쪽 정규화 비교
- `contactKindOf` 판정 규칙 변경, (a)·(d) 방식
- 다른 느린 쿼리 일반 튜닝, DB 메모리 증설, statement_timeout 값 변경
- 운영 데이터 수정·ANALYZE·REINDEX·DROP INDEX (사용자 요청 시에만)

## 트랙 판단

Full이다. DESIGN에서 정할 설계 질문이 남아 있다.
- 트림 리터럴을 공유하는 방식
- 인덱스 키 길이 제한 방식(`left` vs `md5`)
- `related` 재구성 모양(id 합집합 vs `ANY(ARRAY(...))`)
- 결과 동일 테스트 하네스 구성
- 깊이 알림을 이번 범위에 넣을지
