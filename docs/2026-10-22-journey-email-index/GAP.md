# GAP — 2026-10-22-journey-email-index

## 1회차 (2026-10-22)

**unproven 0 · unresolved 0 · Match Rate 93%(참고, 14/15 — B12는 배포 전 pending)**

### 실행한 것

- **단위 테스트(PGlite)**: `node --import tsx --test src/lib/customer-journey-audience.test.ts src/lib/db/records-email-index.test.ts src/lib/db/send-log-indexes.test.ts src/lib/deep-visitor-alert-guards-sql.test.ts`
  - 결과: 18 tests, 18 pass, 0 fail(T1~T11 + 기존 S2 계약)
  - gap-detector가 커버리지 포함으로 6파일 51 tests를 별도로 돌렸고, 모두 통과했다. lcov는 `.devkit/lcov.info`에 있다.
  - 커버리지:

    | 파일 | line % |
    |---|---|
    | records-email-index.ts | 100 |
    | deep-visitor-alert-guards-sql.ts | 100 |
    | customer-journey-audience.ts | 99.25 |
- **QA DB(로컬 sendb_email_stats_qa, PG 17.7)**: `customer-journey-audience.db.test.ts`
  - 결과: 1 pass
  - 인덱스가 부팅 경로로 생성됐다("새로 1개", `indisvalid=true`).
  - 실제 드라이버로 7번 연속 호출했다(1.8~8.7ms).
  - EXPLAIN ANALYZE 전후:

    | 쿼리 | 전 | 후 |
    |---|---|---|
    | 고객 여정 | 64~68ms (Seq Scan) | generic 3.4ms / custom 0.17ms |
    | grec | 약 64ms | 0.08ms |
  - records 통째 읽기는 0개다.
- **회귀 확인**
  - `scripts/check-customer-journey-priority.cjs`: 22 scenarios passed
  - `tsc --noEmit`: exit 0
  - 바꾼 파일 eslint: exit 0
  - 직렬 전체: 1609 tests, 1603 pass, 0 fail, 6 skip
- **evidence 검증**(`verify-evidence.mjs`): unresolved 0, uncited 0, no-cmd-match 0, no-receipt 0, uncovered 0, dead-branch 0
  - 1차에서는 Codex 터미널 실행분 14건이 no-cmd-match였다. Claude가 같은 테스트를 리다이렉트 없이 다시 실행해 cmd를 맞췄다.

### 항목별

| B | 판정 | 근거 |
|---|---|---|
| B1 | ✅ | T6(DDL·schema 선언·마이그레이션 없음), T4(DDL 실제 실행) |
| B2 | ✅ | T12: QA에서 `ensureSendLogIndexes` 뒤 `indisvalid=true` |
| B3 | ✅ | T1: `chr()` 사슬을 평가한 값이 `EMAIL_TRIM_CHARS`와 같다. `\v` 함정 대조, `normalizeEmail`과 일치 |
| B4 | ✅ | T8a: generic·custom 모두 Index Cond에 이메일 식이 있다. 트림을 매개변수로 둔 대조군은 generic에서 인덱스를 못 쓴다 |
| B5 | ✅ | T3, T9: emailKeys 줄이 그대로다 |
| B6 | ✅ | T7: 5×5×3 조합이 oracle과 같다. `_fixture` 집합을 직접 단언한다 |
| B7 | ✅ | T7: facts canonical과 반환값이 같다. 권한 없음은 reject된다 |
| B8 | ✅ | T8b: 관문이 막는 갈래는 실행되지 않는다. `work_email` 대조군은 스캔한다 |
| B9 | ✅ | T7을 인덱스 없음, valid, INVALID 세 상태로 반복했다 |
| B10 | ✅ | T5: 자르지 않은 인덱스는 54000으로 실패하고, left 200 인덱스는 30KB INSERT·UPDATE가 성공한다 |
| B11 | ✅ | T12: 12만 행 QA에서 1초 안이고 records 통째 읽기 0개 |
| B12 | pending | 배포 전. 운영 기준선은 `evidence/stage0-prod.txt`(PG 16.15, UTF8, Seq Scan) |
| B13 | ✅ (예외 명시) | 직렬 전체 0 fail. 기본 병렬은 범위 밖 기존 불안정 테스트 1건이 간헐적으로 실패한다(아래 참고) |
| B14 | ✅ | T10: 문장 결과 4칸이 oracle과 같다. 짝 의미와 조직 격리를 확인했다 |
| B15 | ✅ | T11: custom에서 이메일 식 인덱스를 쓰고 통째 읽기가 0개다 |

### B13 예외

- **대상**: `src/lib/channel-source-export/output.test.ts`의 `실제 collector deadline 후 늦은 archive callback…`
  - 40ms deadline에 의존하는 테스트다.
  - 이전 사이클(`docs/archive/2026-10/email-dashboard-stats/evidence/flaky-output-test.txt`)에도 불안정 이력이 있다.
  - 이번 diff와 무관하다.
- **결과**: 단독 12/12, 직렬 0 fail. 기본 병렬은 2회 중 1회 실패했다.
- **환경 문제**: 이 머신의 기본 TMPDIR(`/var` symlink)에서는 같은 파일의 realpath 단언 19건이 별도로 실패한다. 그래서 evidence는 TMPDIR을 지정해 돌렸다. 이것도 이번 변경과 무관하다.

### DESIGN 대비

- **파일 계획**: 15개가 모두 존재한다. 새 파일은 최대 133줄이다.
- **계약**: T1~T12 모두 대응하는 테스트가 있다.
- **"바꾸지 않을 것"(9절) 위반**: 없다.
  - `deep-visitor-alert-rules.ts`, `customer-journey-source.ts`, `db/index.ts`, drizzle 마이그레이션과 journal은 변경되지 않았다.
  - `loadJourneyAudience`는 `related`와 변수 2개만 바뀌었다.
  - 깊이 알림은 입력 계산과 후처리가 그대로다.
- **승인된 설계 변경**: `evidence/design-clarifications.txt`와 PROGRESS.md에 기록돼 있고, DESIGN.md 2-3에도 반영했다.
  - related의 `JOIN own`을 스칼라 조건으로 교체
  - T5에 SQLSTATE 54000 허용
  - T8 fixture에 filler와 ANALYZE 추가
  - `executedFullScans` 강화
- **➕ 설계 밖**: 계획 판독기 단위 테스트를 추가했다. 판정기 오류를 막는 용도다.

### 다음 액션

1. `/review`
2. 커밋, 푸시, 배포(사용자 확인 뒤, 평일 18시 이후 권장)
3. 배포 뒤 운영 EXPLAIN으로 B12를 채운다(`evidence/b12-prod.txt`).
