# GAP — MCP 트래커 툴 추가

- **사이클**: `2026-09-01-mcp-tracker-tools`
- **분모**: `behaviors.json` B1~B15 (B14·B15는 Gap·Review가 발견한 결함을 고정하며 추가)
- **분석일**: 2026-09-01

```
1회차: unproven 2  (B7·B10)  → 보완 후 unproven 0 (15/15)
```

## 검증 실행 기록

| 항목 | 결과 |
|---|---|
| `npx tsx --test --experimental-test-coverage ... "src/**/*.test.ts"` | tests 169 / pass 169 / fail 0 |
| 커버리지 | tracker-format 98.85% · date-range 97.18% · site-access-rules 98.95% |
| `verify-evidence.mjs` | unresolved 0 · uncited 0 · no-cmd-match 0 · uncovered 0 · dead-branch 3 |
| `npx tsc --noEmit` / `npx next build` | 클린 / ✓ |

### dead-branch 3건 — 계측 아티팩트 (판정에 반영하지 않음)

lcov 원본에서 taken=0인 것이 **서로 무관한 세 파일에서 같은 branch id(2, 7)** 로 나온다. 지목된 소스 라인은 전부 JSDoc 한가운데나 `interface` 선언부다. 직접 실행으로 해당 분기가 정상 동작함을 확인했다:

```
biggest 초기화: s2 / biggest 갱신: s3 / clampPageSize NaN: 20
partition 있음: [5] / partition 없음: []
previousRange: 2026-07-01~2026-07-31 / isValidYmd 윤년: true false
```

앞 사이클(`token-version-revocation`)에서 확인한 tsx 트랜스파일 행 번호 어긋남과 같은 현상이다.

## 1. 1회차에서 발견된 결함 2건

### 🔴 1. B7 — 직전 기간이 웹과 하루씩 달랐다

**이번 사이클에서 가장 중요한 발견이다.**

웹 overview는 직전 기간을 route 안에서 인라인 계산하고 있었다:

```ts
// overview/route.ts:52-57 (추출에서 누락됐던 부분)
const toDate = new Date(`${toYmd}T23:59:59+09:00`);   // ← .999 없음
const lengthDays = Math.max(1, Math.round((toDate - fromDate) / DAY_MS));
```

`.999`가 없어 `Math.round`가 길이를 1일 크게 잡는다. 실측 대조:

| 조회 기간 | 웹(수정 전) | `previousRange()` |
|---|---|---|
| 2026-08-01~08-31 | 2026-**06-30**~07-31 | 2026-**07-01**~07-31 |
| 2026-05-18~06-29 | 2026-**04-04**~05-17 | 2026-**04-05**~05-17 |

**즉 웹이 직전 기간을 하루 넓게 잡는 기존 버그였다.**

내가 만든 `previousRange`는 **mechanical move가 아니었다** — 웹 어디에서도 쓰이지 않던 것을 새로 작성했는데, 커밋 메시지에는 "4곳 중복이던 것"으로 적었다. 사실과 다르다. 그래서 "본문 한 글자도 안 고친다"는 회귀 방어를 받지 못했다.

**B7의 evidence가 이를 못 잡은 이유**: 대조 대상을 `current{visitors,sessions,pageviews,avgDwell}`로 잡았는데 이건 `aggregateRange`(진짜 mechanical move)라 당연히 일치한다. `previous`·`deltaPct`는 대조 범위 밖이었다.

**조치(사용자 결정)**: 웹도 `previousRange()`를 쓰도록 고쳤다. 양쪽이 같은 함수를 호출하므로 구조적으로 일치가 보장된다. `resolveRange`도 함께 적용해 기간 기본값 계산까지 통일했다.

수정 후 재검증: 현재 기간 KPI 3종(overview/mobile/site5) 전부 동일, 퍼널·pages도 동일. `deltaPct`는 의도된 변경이다.

### 🔴 2. 분모 조사가 틀렸다 — 같은 실수의 재현

DESIGN §4.3이 스스로 지시했다: *"`Grep "T00:00:00+09:00"`를 돌려 4건 이상이면 조사가 틀린 것이므로 즉시 보고"*

실제로 돌리니 **6건**(테스트 제외 5건)이었다:

| 위치 | DESIGN이 셌나 |
|---|---|
| `date-range.ts:43` | 추출 결과물 |
| `engagement/route.ts:18` | ✅ 남김(의도) |
| `ad-performance/route.ts:14` | ✅ 남김(의도) |
| **`overview/route.ts:52`** | ❌ **누락 — 위 B7의 원인** |
| **`analytics/email-daily/route.ts:28`** | ❌ 누락 (트래커 밖) |

**선행 사이클 REPORT가 "분모는 그 값으로 분기하는 모든 표기로 잡는다"고 적었고, 이번 DESIGN이 그에 대응해 값 기반 grep을 지시했는데, 정작 그 grep을 실행하지 않았다.** `rangeBounds(...)` 호출 형태만 세고 `new Date(\`...T00:00:00+09:00\`)` 인라인 생성을 놓쳤다.

교훈을 문서에 적는 것과 실제로 실행하는 것은 다르다 — 앞 사이클 REPORT가 같은 말을 했는데 또 반복됐다.

## 2. Review가 발견한 결함 (B14·B15로 고정)

### 🔴 B14 — `get_record_journey`가 파티션 경계를 넘었다

`buildRecordJourney`의 `merge` 기본값이 `true`인데, 이 경로는 주석이 명시하듯 **"파티션 경계 넘어 통합"** 한다. 진입 레코드의 파티션 하나만 `checkTokenAccess`로 검사했으므로, **파티션 A 스코프 토큰이 같은 visitor에 엮인 파티션 B 레코드의 이벤트·메일 이력까지** 받을 수 있었다.

웹은 세션 유저 기준이라 그 동작이 맞지만 MCP는 파티션 스코프 토큰이 존재한다. `merge: false`로 고정했다.

실피해는 partition 스코프 토큰에 한정되고 실사용은 대부분 org 스코프지만, **격리를 코드가 아니라 운영 관행이 지탱하는 상태**였다.

### 🟡 B15 — 역전 범위·응답 경계

- `from > to`를 아무도 거부하지 않아 집계가 조용히 0건이 되고 `previousRange`가 미래 구간을 만들었다 → 에러로 거부
- `get_page_analytics`가 `from`만 받으면 `to`가 응답에서 사라져 Claude가 집계 범위를 알 수 없었다 → 실제 적용 경계를 노출

## 3. ✅ 확인된 것

| 항목 | 결과 |
|---|---|
| **권한 게이팅** | 툴 7개 전부 첫 줄에서 `resolveTrackerSiteForToken` 또는 `checkTokenAccess` 호출. `list_funnels`가 siteId 없이 호출돼도 스코프로 거른 목록 안에서만 조회 |
| **apiKey 비노출** | `SITE_COLUMNS` allowlist에 없고 타입(`AccessibleSite`)에도 필드가 없다 — 구조적 배제 |
| **SQL 인젝션** | `deviceFilterSql`이 `sql.raw`를 쓰지만 MCP 유입 경로가 `parseDevice` 화이트리스트 하나뿐. 우회 없음 |
| **추출 함수 사용처** | `aggregateRange`·`queryPageAnalytics`·`computeFunnelStages`·`buildRecordJourney` 전부 웹·MCP 양쪽에서 호출. 누락 0 |
| **leads 불일치 유지** | funnel은 `visitor_record_links`까지, overview는 `record_id`만 — DESIGN §15대로 **고치지 않고 보존**. mechanical move 위반 없음 |
| **DESIGN이 남기기로 한 것** | notExcludedExpr 미통합, engagement·ad-performance 중복 2건, journey.ts 337줄, overview 470줄 — 전부 의도대로 |

## 4. B10 회귀 검증의 한계 (그대로 기록)

빈 diff는 진짜지만 **덮는 범위가 제한적이다**:

- `siteId` 1·2·5, 기간 `2026-05-18~06-29`, `device=mobile`·`channelMode=paid` 일부만
- `channel` 지정, `tablet`, `excludePaths`가 비어있지 않은 사이트 조합은 미검증
- **빈 diff는 "웹이 안 바뀌었다"만 증명한다.** "MCP가 웹과 같다"는 B4/B7의 몫인데, B7이 부분 대조라 1회차에서 뚫렸다

DESIGN §3.2의 "aggregateRange만 추출" 근거는 코드와 맞다 — `Promise.all`이 실제로 13갈래이고 `devFilterTv`/`sessFilterEv`/`sessFilterTs`가 클로저 변수라, (B)안이었다면 이들이 인자로 승격돼 검증 불가능해졌을 것이다.

## 5. 후속 대상

1. **leads 정의 통일** — funnel과 overview가 다르다. 어느 쪽이 옳은지 사용자 판단 필요
2. **`ymd()`의 UTC 기준** — KST 오전 9시 이전에는 기본 기간이 하루 밀린다. 웹 전체가 같은 방식이라 일관되긴 하다
3. **`journey.ts` 337줄 / `overview` 470줄** — 200줄 초과. 쪼개려면 회귀 검증을 다시 해야 한다
4. **세그먼트 조합 검증** — channel·tablet·excludePaths 경로
