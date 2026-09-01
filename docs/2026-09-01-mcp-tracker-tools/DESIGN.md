# DESIGN — MCP 트래커 툴 추가

- **사이클 ID**: `2026-09-01-mcp-tracker-tools`
- **근거**: `PLAN.md`(승인됨), `behaviors.json` B1~B13
- **선행 참조**: `docs/archive/2026-09/token-version-revocation/` (순수 판정 + DB 어댑터 이분, `-rules.ts` 분리 이유), 같은 REPORT "배운 것" 1·2항 — **분모는 특정 문자열이 아니라 그 값으로 분기하는 모든 표기로 잡는다** / **이 상태를 바꾸는 경로가 몇 개인가를 먼저 센다**

## 0. 실측으로 확정된 사실 (설계의 전제)

| # | 사실 | 근거 | 영향 |
|---|---|---|---|
| F1 | **`tracker_sites`는 워크스페이스당 정확히 1개** | `schema.ts:1345` `unique("tracker_sites_workspace_unique")` | 스코프→워크스페이스 해석이 곧 **스코프→사이트 해석**. 매핑 테이블 불필요 |
| F2 | `tracker_sites`가 `orgId`·`workspaceId`를 **둘 다** 가짐 | `schema.ts:1326-1331` | org 경계는 컬럼 하나로 끝. 조인 불필요 |
| F3 | `folders.workspaceId` notNull | `schema.ts:158-167` | folder 스코프 → DB 1회 조회 |
| F4 | `partitions.workspaceId` notNull | `schema.ts:172-178` | partition 스코프 → DB 1회 조회 |
| F5 | `rangeBounds`가 **4개 route에 중복** | funnel·overview·engagement·ad-performance | 공유 헬퍼로 정리 가능. 단 §5에서 범위 제한 |
| F6 | `notExcludedExpr`/`deviceFilterSql`/`sessionInFilterSql`이 funnel·overview에 **동일 구현 중복** | 각 route 상단 | funnel 추출 시 자연히 공유됨 |
| F7 | funnel의 `notExcludedExpr`과 overview 버전이 **문자 단위 동일** | 실측 | 공유해도 수치 불변 (B4의 전제) |
| F8 | MCP 기존 툴 10개는 **전부 `ok()` = `JSON.stringify(data, null, 2)`** | `tools.ts:22-24` | 신규 7개도 JSON. 요약 텍스트로 이탈하지 않음 |
| F9 | `checkTokenAccess`는 org 경계를 **scope 종류와 무관하게 먼저** 검사 | `auth.ts:214-215` | 같은 2단 구조를 트래커에 복제 |
| F10 | `api/v1/partitions/route.ts:47-57`에 **이미 scope 기반 목록 필터 존재** | 해당 파일 | 바퀴 재발명 금지 — 같은 규칙을 순수 함수로 승격 |
| F11 | **`pages` route에는 날짜 필터가 없다** (전 기간 TOP 100) | `pages/route.ts:31-46` | PLAN 표가 `from?`/`to?`를 적었으나 웹에 없음 → §8.6에서 해결 |

**F11이 첫 번째 함정이다.** 그대로 만들면 "웹과 같은 수치"가 성립하지 않는다.

## 1. 접근법 — 네 층으로 가른다

층 경계의 기준은 **DB를 아느냐**와 **웹과 공유하느냐** 둘이다.

```
① 순수 규칙   src/lib/tracker/site-access-rules.ts    DB ✗  node:test로 고정
② DB 어댑터   src/lib/tracker/site-access.ts           DB ✓  ①을 호출해 사이트 목록을 낸다
③ 집계 코어   src/lib/tracker/analytics-*.ts           DB ✓  웹·MCP 공유  ← 회귀 위험 전부 여기
④ 어댑터      웹 route(JWT) / MCP tracker-tools(토큰)   각자 인증만 하고 ③을 부른다
```

핵심은 **③이 인증을 모른다**는 점이다. `siteId`를 받되 접근 가능 여부는 검사하지 않는다. 검사는 ②(MCP)와 기존 `eq(trackerSites.orgId, user.orgId)`(웹)가 각자 한다. 이렇게 갈라야 웹 route의 diff가 "쿼리 블록 → 함수 호출" 치환으로 끝나고, B10 회귀 검증에서 원인을 분리할 수 있다.

### 기각한 대안

| 대안 | 기각 이유 |
|---|---|
| 집계 함수가 `tokenInfo`/`user`를 받아 인증까지 | 웹은 JWT, MCP는 API 토큰이라 시그니처가 갈라진다. ③이 두 인증 축을 다 알면 테스트 불가 |
| MCP가 웹 API를 HTTP로 호출 | 자기 자신에게 fetch(쿠키 없음 → 401), 배포 URL 의존, 레이턴시 2배. MCP 토큰을 JWT로 바꿀 방법도 없다 |
| MCP 전용 집계를 새로 작성 | PLAN의 "복제하지 않는다" 위반. 퍼널 수치가 두 벌이면 어느 쪽이 맞는지 판정 불가 |
| `checkTokenAccess` 재사용 | 시그니처가 `partitionId`를 받는다. 트래커엔 파티션이 없다. 억지로 넘기면 파티션 0개 워크스페이스에서 조용히 false |

## 2. 결정 ① — 스코프 → workspaceId 해석기 (가장 중요)

### 2.1 "org 스코프의 전체"를 어떻게 표현하는가

| 표현 | 치명적 문제 |
|---|---|
| (a) `null` = 전체 | **`if (ids)`로 쓰면 `null`(전체)과 `[]`(없음)이 둘 다 falsy로 뭉개진다.** `session-filter.ts`가 이미 `null = 필터 미적용` 규약이라 같은 코드베이스에서 두 `null`의 의미가 충돌 |
| (b) 특수값 `-1`/`0` | `inArray(ids, [-1, 3])`이 되어 SQL이 조용히 틀린다. 마법의 수 |
| **(c) 판별 유니온** | `if (r.kind === "all")`을 **안 쓰면 타입 에러**. 컴파일러가 분기 누락을 잡는다 |

**(c)를 택한다.** 테넌트 격리가 걸린 값에서 "실수하면 조용히 넓어지는" 표현을 쓰면 안 된다.

### 2.2 순수부와 DB부를 가르는 선 = "scopeId가 workspaceId인가"

| scopeType | 분류 |
|---|---|
| `org` | **순수** (전체) |
| `workspace` | **순수** (scopeId가 곧 workspaceId) |
| `folder` | DB (`folders.workspace_id` 조회) |
| `partition` | DB (`partitions.workspace_id` 조회) |

순수 함수는 **이미 해석된 상위 매핑을 인자로 받는다.** 직전 사이클의 `canAccessPartition(…, orgScopes)`와 같은 형태다.

### 2.3 시그니처 — `src/lib/tracker/site-access-rules.ts` (DB import 금지)

```ts
export interface TokenScopeLike {
    scopeType: string;   // DB varchar. 미지 값은 default에서 fail-closed
    scopeId: number;
    permissions: ScopePermissions;
}

/** folder/partition scope의 scopeId → 그 대상이 속한 workspaceId. DB 어댑터가 채운다. */
export interface ScopeWorkspaceLookup {
    folderWorkspaceId: ReadonlyMap<number, number>;
    partitionWorkspaceId: ReadonlyMap<number, number>;
}

/**
 * null이나 특수값을 쓰지 않는 이유: "전체"와 "없음"이 falsy로 뭉개지면 안 된다.
 * 판별 유니온이면 분기를 빠뜨렸을 때 컴파일이 실패한다.
 */
export type WorkspaceScopeResult =
    | { kind: "all" }
    | { kind: "some"; ids: ReadonlySet<number> };

export function resolveScopeWorkspaces(
    scopes: readonly TokenScopeLike[],
    lookup: ScopeWorkspaceLookup,
    permission: Permission = "read",
): WorkspaceScopeResult;

export function scopeAllowsWorkspace(result: WorkspaceScopeResult, workspaceId: number): boolean;

export function filterAccessibleSites<T extends { workspaceId: number }>(
    sites: readonly T[], result: WorkspaceScopeResult,
): T[];
```

### 2.4 `resolveScopeWorkspaces` 계약 — 못 박는 것 5개

```
ids = new Set<number>()
for (scope of scopes):
    if (!scope.permissions[permission]) continue        // ① 권한 비트가 먼저
    switch (scope.scopeType):
        case "org":       return { kind: "all" }        // ② 즉시 반환
        case "workspace": ids.add(scope.scopeId); break
        case "folder":    w = lookup.folderWorkspaceId.get(scope.scopeId)
                          if (w !== undefined) ids.add(w); break      // ③ 없으면 버림
        case "partition": w = lookup.partitionWorkspaceId.get(scope.scopeId)
                          if (w !== undefined) ids.add(w); break
        default:          break                          // ④ 미지 scopeType 무시
return { kind: "some", ids }                             // ⑤ scope 0개 = 아무것도 못 봄
```

1. **권한 비트 검사가 scopeType 분기보다 먼저다.** `checkTokenAccess:218`과 같은 순서. read 없는 org 스코프가 전체를 열면 안 된다.
2. **org는 즉시 반환.** 이미 최대 범위라 뒤를 볼 필요 없다.
3. **lookup에 없는 folder/partition은 조용히 버린다.** 폴더가 지워진 경우다. 예외를 던지면 "폴더 하나 지웠더니 MCP 전체가 500"이 되고, 전체를 열면 격리가 깨진다. **버리는 게 유일하게 안전하다.**
4. **미지 scopeType은 fail-closed.** `scopeCoversPartition`과 동일.
5. **scope 0개면 `{some, ∅}`.** 빈 배열을 "전체"로 읽는 실수를 타입이 막는다.

### 2.5 DB 어댑터 — `src/lib/tracker/site-access.ts`

```ts
export type SiteResolution =
    | { ok: true; site: TrackerSite }
    | { ok: false; reason: "not_found" | "forbidden" };

export async function listAccessibleTrackerSites(tokenInfo: ApiTokenInfo): Promise<TrackerSite[]>;
export async function resolveTrackerSiteForToken(tokenInfo: ApiTokenInfo, siteId: number): Promise<SiteResolution>;
export async function loadScopeWorkspaceLookup(scopes: readonly TokenScopeLike[]): Promise<ScopeWorkspaceLookup>;
```

```
resolveTrackerSiteForToken:
  ① SELECT * FROM tracker_sites WHERE id = ? AND org_id = tokenInfo.orgId
     └ 없으면 not_found                            ← B5가 여기서 끝난다
  ② lookup = loadScopeWorkspaceLookup(scopes)
  ③ scope  = resolveScopeWorkspaces(scopes, lookup, "read")   ← 순수
  ④ scopeAllowsWorkspace(scope, site.workspaceId) ? ok : forbidden
```

**쿼리 수**: org 스코프 토큰(실사용 대부분)은 ①만 → **1회**. folder/partition 스코프가 있어야 ②에서 최대 2회 추가. `listAccessibleTrackerSites`도 lookup을 한 번 만들어 재사용 → **N+1 없음**.

`loadScopeWorkspaceLookup`은 folder/partition scope가 없으면 **쿼리를 건너뛴다.** 이 조기 반환이 "실사용은 대부분 org 스코프"를 공짜로 만든다.

### 2.6 에러 문구 — `forbidden`을 왜 구별하는가

| reason | 문구 |
|---|---|
| `not_found` (타 조직 / 없는 id) | `"트래커를 찾을 수 없습니다."` |
| `forbidden` (같은 org, 스코프 밖) | `"이 트래커에 대한 접근 권한이 없습니다."` |

같은 조직 안의 스코프 제한은 토큰 설정으로 해결 가능하니 정확한 안내가 유용하다. 반대로 타 조직 siteId에 "권한 없음"을 주면 **그 id가 실재한다는 사실이 새어 나간다**(존재 탐침). `not_found`가 org 경계를 흡수한다. 기존 웹 route도 org 밖에 404 `"트래커를 찾을 수 없습니다."`를 주므로 문구가 일치한다.

## 3. 결정 ② — `overview` 588줄의 추출 범위

### 3.1 588줄의 구성 (읽고 나눈 결과)

| 블록 | 줄 | MCP가 필요한가 |
|---|---|---|
| 헬퍼 6종(`rangeBounds`/`pct`/`notExcludedExpr`/…) | 39 | **날짜 규약이 필수**(B12) |
| `aggregateRange` — KPI 7종 | 87 | **핵심** |
| 인증·파라미터 파싱 | 49 | ✗ |
| `Promise.all` 13갈래 | **262** | 일부만 |
| `paidCount` | 28 | ✗ |
| JS 후처리 + 조립 | 92 | ✗ |

**262줄 `Promise.all`이 몸통이고 13갈래는 서로 독립**(각각 대시보드 위젯 하나).

### 3.2 판단: **`aggregateRange`만 추출** (부분 추출)

| 범위 | 웹 diff | 회귀 위험 | 판단 |
|---|---|---|---|
| **(A) `aggregateRange` + 헬퍼** | -125줄, **호출 시그니처 무변경** | **낮음** — 함수 이동. 인자·반환 타입 불변이라 컴파일러가 전부 잡는다 | ✅ |
| (B) `Promise.all` 13갈래까지 | -390줄, 13함수 신설 | **높음** — `devFilterTv`/`sessFilterEv` 같은 **클로저 변수가 인자로 승격**된다. 한 곳만 잘못 넘겨도 그 위젯만 조용히 틀린다 | ❌ |
| (C) 전체 | route 20줄 | 매우 높음 + MCP 응답 수백 KB | ❌ |

**(B)를 기각하는 결정적 이유는 diff 크기가 아니라 검증 가능성이다.** (A)는 반환값 7개 숫자만 대조하면 동일성이 증명된다. (B)는 13위젯 × 세그먼트 조합을 전부 대조해야 하고 자동화 수단이 없다(DB 의존). **검증할 수 없는 추출은 하지 않는다.**

부수 효과로 `popularPages`를 MCP에 못 주지만, `get_page_analytics`가 그 답을 이미 준다 — 툴 7개 전체로 보면 구멍이 없다.

### 3.3 추출 후에도 465줄로 200줄 가이드를 넘는다

**이번 사이클에서 더 쪼개지 않는다.** 더 쪼개려면 (B)여야 하는데 기각했다. **회귀 위험을 감수하며 줄 수를 맞추는 것은 본말전도다.** REPORT에 후속 후보로 기록한다.

## 4. 결정 ③ — 추출의 안전성 보장 (B4·B10)

REPORT "배운 것" 2항의 트래커판. 여기서 셀 것은 **"이 수치를 만드는 경로가 몇 개인가"**다.

### 4.1 세 겹의 방어

**1겹 — 이동은 이동만 한다 (mechanical move).** 함수 본문을 **한 글자도 고치지 않는다.** 개선하고 싶은 것(§15의 leads 불일치 등)이 눈에 띄어도 **이번 커밋에서 고치지 않는다.** 고치면 "추출 때문에 바뀐 것"과 "고쳐서 바뀐 것"을 구별할 수 없다.

**2겹 — 커밋을 물리적으로 가른다.**

```
커밋 1  추출만       — 웹 route 4개 + 신규 lib 6개. MCP 코드 0줄
커밋 2  스코프 해석  — site-access*.ts + 테스트. 기존 코드 참조 0
커밋 3  MCP 툴       — tracker-tools.ts + tools.ts 병합. 웹 route 수정 0줄
```

커밋 1 직후 §4.2를 돌린다. 수치가 틀리면 **원인은 반드시 추출**이다 — MCP 코드가 없으므로 다른 후보가 없다. 이 순서가 B10을 검증 가능하게 만드는 유일한 장치다.

**3겹 — 실데이터 JSON 대조.**

### 4.2 검증 절차 (실행 가능한 형태)

```bash
COOKIE="token=<JWT>";  MCP_TOKEN="<api token>";  BASE="http://localhost:3000"
SITE=<siteId>;  FROM=2026-08-01;  TO=2026-08-31   # TO는 반드시 어제 이전
```

**단계 A — 추출 전 스냅샷** (커밋 1 이전)
```bash
mkdir -p /tmp/tracker-baseline
for q in \
  "analytics/funnel?siteId=$SITE&from=$FROM&to=$TO" \
  "analytics/funnel?siteId=$SITE&from=$FROM&to=$TO&device=mobile" \
  "analytics/funnel?siteId=$SITE&from=$FROM&to=$TO&channelMode=paid" \
  "analytics/overview?siteId=$SITE&from=$FROM&to=$TO" \
  "analytics/overview?siteId=$SITE&from=$FROM&to=$TO&device=mobile" \
  "analytics/pages?siteId=$SITE" ; do
  curl -s -H "Cookie: $COOKIE" "$BASE/api/tracker/$q" | jq -S . > "/tmp/tracker-baseline/$(echo "$q" | md5).json"
done
```

`jq -S`(키 정렬)가 필수 — 객체 리터럴 키 순서가 바뀌어도 오탐이 안 난다.

**단계 B — 추출 후 diff** (커밋 1 직후)
```bash
diff -r /tmp/tracker-baseline /tmp/tracker-after && echo "B10 PASS"
```

**빈 diff가 B10의 evidence다.** 하나라도 다르면 되돌리고 원인부터 찾는다.

> ⚠️ **시간 의존 필드**: `TO`를 어제 이전으로 잡아 새 이벤트 유입을 배제한다. journey의 `summary.inactivity.daysSince`는 `Date.now()` 의존이라 `jq 'del(.data.summary.inactivity)'`로 제외하고 비교한다.

**단계 C — MCP vs 웹 대조** (커밋 3 직후, B4)
```bash
call() {
  curl -s -X POST "$BASE/api/mcp" -H "Authorization: Bearer $MCP_TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2}}" \
    | jq -r '.result.content[0].text'
}
diff <(call get_funnel_analytics "{\"siteId\":$SITE,\"from\":\"$FROM\",\"to\":\"$TO\"}" \
        | jq -S '{funnel, range, stages: [.stages[] | {key, label, visitors}]}') \
     <(curl -s -H "Cookie: $COOKIE" "$BASE/api/tracker/analytics/funnel?siteId=$SITE&from=$FROM&to=$TO" \
        | jq -S '.data | {funnel, range, stages: [.stages[] | {key, label, visitors}]}') \
  && echo "B4 PASS"
```

`key/label/visitors`만 뽑는 이유: MCP는 `conversionRate`·`dropOff`를 **덧붙여** 반환한다(웹에 없는 필드). 공통 부분집합 비교가 정확하다. 덧붙인 필드는 §12의 순수 함수 테스트가 별도로 고정한다.

### 4.3 분모 — "이 수치를 만드는 경로" 전수

| 조각 | 현재 정의 | 추출 후 |
|---|---|---|
| `rangeBounds` | funnel·overview·engagement·ad-performance (**4곳**) | `date-range.ts` → funnel·overview·MCP **3곳 공유**. engagement·ad-performance는 **손대지 않음**(§5.3) |
| `notExcludedExpr` | funnel·overview (**2곳**, 동일 구현) | `sql-filters.ts` → 2곳 공유 |
| `deviceFilterSql`/`sessionInFilterSql` | funnel·overview·engagement (**3곳**) | `sql-filters.ts` → funnel·overview 2곳 |
| `aggregateRange` | overview (1곳, 내부 2회 호출) | `analytics-queries.ts` → overview 2회 + MCP |

**구현 시 재조사 지시**: 커밋 1 직전에 `Grep "T00:00:00+09:00"`(rangeBounds의 의미적 지문)를 돌려 **4건 이상이면 DESIGN의 조사가 틀린 것이므로 즉시 보고.** 문자열 `rangeBounds`가 아니라 그 함수가 만드는 값으로 찾는 것이 REPORT 1항의 요구다.

## 5. 결정 ④ — 날짜 규약 (B12)

### 5.1 규약 — 한 글자도 바꾸지 않는다

```
from 미지정 → ymd(now - 30일) ;  to 미지정 → ymd(now)
ymd(d)  → d.toISOString().slice(0, 10)        // UTC 기준
fromIso → `${fromYmd}T00:00:00+09:00`         // KST 자정
toIso   → `${toYmd}T23:59:59.999+09:00`
```

> **`ymd`가 UTC라 KST 오전 9시 이전에는 "어제"가 나온다.** 기존 버그일 수 있으나 **그대로 옮긴다.** 고치면 웹 수치가 바뀌어 B10 diff가 깨진다. §15 열린 질문.

### 5.2 `src/lib/tracker/date-range.ts` (신규, 순수)

```ts
export const DEFAULT_RANGE_DAYS = 30;
export function resolveRange(from, to, now?: Date): { fromYmd, toYmd };   // now 주입 = 테스트 가능
export function rangeBounds(fromYmd, toYmd): { fromIso, toIso };
export function previousRange(fromYmd, toYmd): { fromYmd, toYmd };
export function isValidYmd(value: string): boolean;                      // ← 신규
```

`isValidYmd`가 웹에 없던 요소다. 웹은 날짜 피커라 형식이 보장되지만 **MCP는 Claude가 `"지난달"` 같은 문자열을 넣을 수 있다.** 검증 없이 넘기면 `"지난달T00:00:00+09:00"`이 되어 Postgres 예외 → `-32603`. **MCP 어댑터에서만** 검증한다(웹 동작 불변).

### 5.3 치환 범위 — 의도적으로 중복 2건을 남긴다

| route | 치환 | 이유 |
|---|---|---|
| funnel · overview | ✅ | 추출 대상 |
| pages | — | 날짜를 안 씀(F11) |
| journey | — | ISO timestamp라 규약이 다름 |
| **engagement · ad-performance** | ❌ | 범위 밖. **"지나가는 김에 정리"가 B10 검증 범위를 넓히고 원인 분리를 망가뜨린다** |

## 6. 결정 ⑤ — 응답 크기 상한

**상한 없는 툴은 만들지 않는다.**

| 툴 | 기본 | 최대 | 근거 |
|---|---|---|---|
| `list_tracker_sites` | — | 전체 | F1로 워크스페이스당 1개 |
| `list_funnels` | — | 전체 | 사이트당 현재 3개 |
| `get_funnel_analytics` | — | 단계 수 | 사람이 정의하므로 10개 미만 |
| `get_tracker_overview` | — | 고정 8필드 | §3.2에서 `aggregateRange`만 뽑은 **부수 이득** |
| `get_page_analytics` | 20 | 100 | 웹은 100 고정. Claude는 보통 상위 몇 개만 필요 |
| `list_tracker_events` | **20** | **100** | 기존 툴 3개가 전부 `Math.min(pageSize ?? 20, 100)`. **같은 규약** |
| `get_record_journey` | 100 | 200 | 리드당 수백 건 가능 |

`list_tracker_events`에는 **집계 필드를 함께 준다.** 4만 건 중 20건만 주면 "얼마나 일어났나"에 답할 수 없다:

```jsonc
{ "totalCount": 41203, "eventNameCounts": [{ "eventName": "...", "count": 1832 }],
  "page": 1, "pageSize": 20, "events": [ /* 20건 */ ] }
```

이게 상한의 진짜 대가를 없애는 장치다 — 대부분의 질문이 1페이지에서 끝난다.

## 7. 결정 ⑥ — 응답 형태

**JSON 그대로.** 기존 툴 10개가 전부 `ok(data)`이고(F8), 툴마다 형식이 다르면 Claude가 파싱 전략을 바꿔야 한다.

다만 **JSON 안에 사람이 읽을 값을 미리 계산해 넣는다.** Claude가 전환율을 직접 나누게 두면 산술 실수가 사용자에게 그대로 간다.

```jsonc
{
  "funnel": { "id": 12, "name": "구독신청 과정", "kind": "event" },
  "range": { "from": "2026-08-01", "to": "2026-08-31" },
  "stages": [
    { "key": "visit", "label": "방문", "visitors": 4210, "isAuto": true,
      "conversionRate": null, "dropOff": null, "dropOffRate": null },
    { "key": "step1", "label": "신청 시작", "visitors": 892,
      "conversionRate": 21.2, "dropOff": 3318, "dropOffRate": 78.8 }
  ],
  "overallConversionRate": 7.4,
  "biggestDropOff": { "fromKey": "visit", "toKey": "step1", "dropOff": 3318, "dropOffRate": 78.8 }
}
```

**`biggestDropOff`가 PLAN의 발단 질문("구독신청 과정에서 어디서 이탈해?")에 한 필드로 답한다.** 이 필드 하나가 이 툴의 존재 이유다.

**첫 단계 `conversionRate`를 `0`이 아니라 `null`로** 두는 것이 계약의 핵심이다. `0`이면 Claude가 "방문 전환율 0%"로 읽고 잘못 보고한다.

계산은 전부 **순수 함수** `computeFunnelMetrics(stages)` — §12의 TDD 대상.

## 8. 결정 ⑦ — 7개 툴 스펙

### 8.1 `list_tracker_sites` (B1·B13)
출력: `[{ id, name, workspaceId, workspaceName, domains, isActive, conversionStage, createdAt }]`
**`apiKey`는 절대 포함하지 않는다** — 수집 엔드포인트 인증 키. `db.select()` 대신 컬럼 명시로 구조적 차단.

### 8.2 `list_funnels` (B2)
`siteId?` 생략 시 접근 가능한 모든 사이트의 퍼널.
출력: `[{ id, siteId, siteName, name, kind, isDefault, stageCount, stages: [{ key, label, matchType }] }]`

**B2는 코드 추가로 보장되는 게 아니라 하드코딩을 안 해서 보장된다.** `WHERE site_id IN (접근 사이트)` 한 문장이고 퍼널명·개수가 코드에 없다.

`match`를 통째로 안 주고 `matchType`만 주는 이유: `match.value`에 고객사 내부 필드값이 들어 있어 컨텍스트를 채운다.

### 8.3 `get_funnel_analytics` (B3·B4·B11·B12)
인자: `siteId*`, `funnelId?`, `from?`, `to?`, `device?`

`device`를 넣는 이유 — 추출한 `buildFunnelContext`가 이미 받으므로 비용 0이고 "모바일에서만 이탈하나?"는 실제 질문이다. `channel`/`channelMode`는 **넣지 않는다**(§15).

**B11**: `funnelId` 미지정 → `is_default=1 ORDER BY created_at DESC LIMIT 1`. 없으면 `funnel:{id:null}` + 자동 단계만 — 웹과 동일, 에러 아니다.

**`funnelId`가 타 사이트 것이면 명시적으로 거부한다** — 웹은 조용히 기본 동작하지만, MCP는 Claude가 임의 id를 넣을 수 있고 **조용히 다른 퍼널 수치를 반환하면 사용자가 잘못된 결론을 얻는다.**

### 8.4 `get_record_journey` (B6)
**권한 축이 다르다.** 사이트가 아니라 레코드를 다루므로 **기존 `checkTokenAccess(tokenInfo, record.partitionId, "read")`를 그대로 쓴다**(`get_record`와 동일). 워크스페이스 해석기를 끌어들이지 않는다 — 레코드는 파티션에 속하고 그 축은 이미 정확하다.

**`meta`·`children`·`nextActions`를 뺀다.** `meta.properties`는 임의 JSON이라 상한이 없고, `children`은 세션당 페이지뷰가 통째로 들어온다. `nextActions`(룰 기반 제안)는 **어설픈 룰이 Claude의 판단을 오염시킨다.**

`truncated: true` + `totalEvents`가 있어야 Claude가 "일부만 봤다"를 안다. 없으면 412건 중 100건 보고 "이게 전부"라고 결론 낸다.

### 8.5 `get_tracker_overview` (B7·B12)
`aggregateRange`를 현재/직전 2회 호출 + `rates`·`deltaPct`. `deltaPct`는 웹의 `pct()`와 **같은 함수**(추출 공유). `prev === 0`이면 `null`.

### 8.6 `get_page_analytics` (B8) — F11의 해결

| 안 | 결과 |
|---|---|
| (a) 날짜 안 받음 | 웹과 100% 일치하나 "지난달 인기 페이지"에 답 못 함 |
| (b) MCP만 날짜 받음 | 웹과 동작이 갈라져 공유 전제가 깨짐 |
| **(c) 함수에 optional 날짜, 웹은 안 넘김** | **웹 동작 무변경** + MCP는 기간 조회 가능 |

```ts
export async function queryPageAnalytics(args: {
    siteId: number;
    range?: { fromIso: string; toIso: string };   // 미지정 = 전 기간 (웹 기존 동작)
    limit?: number;
}): Promise<Array<{ path: string; title: string | null; views: number }>>;
```

`range`가 `undefined`면 SQL에 날짜 조건을 안 붙인다 → 웹 route는 `queryPageAnalytics({ siteId })` 한 줄이 되고 **생성 SQL이 문자 단위로 동일**하다. B10이 통과할 수밖에 없다.

> ⚠️ **이 툴만 날짜 기본값이 전 기간이다** (B12의 예외). description에 명시하고 REPORT에 근거를 기록한다. 억지로 30일을 적용하면 웹과 갈라진다.

### 8.7 `list_tracker_events` (B9)
인자: `siteId*`, `eventName?`, `eventType?`, `from?`, `to?`, `page?`, `pageSize?`
출력: §6.

**이 툴은 추출 대상이 없다** — 웹에 대응 route가 없는 신규 쿼리다. 회귀 위험 0이고, `tracker_events_site_occurred_idx`·`tracker_events_type_idx`가 이미 있어 성능도 확보된다.

## 9. 파일 배치

`tools.ts` 402줄 + 7개 = 700줄 초과 → **분리한다.**

```
src/lib/mcp/
├── tools.ts               (수정, 402 → ~410)  import 1줄 + 전개 2곳
├── types.ts               (신규, ~20)         ToolResult/ToolHandler/ok/err
├── tracker-tools.ts       (신규, ~190)        정의 7 + 핸들러 7 (DB)
├── tracker-format.ts      (신규, ~70)         순수 변환. DB import 금지
└── tracker-format.test.ts (신규, ~120)
```

`ok`/`err`/타입이 현재 `tools.ts`에 비공개다. `tools.ts`에서 export하면 **순환 참조**(tools → tracker-tools → tools)라 읽는 사람이 헷갈린다. **`types.ts`로 빼고 양쪽이 import** — 방향이 단방향.

`tracker-format.ts`를 별 파일로 두는 것이 **필수다.** `tracker-tools.ts`가 `@/lib/db`를 import하고 `db/index.ts`가 모듈 로드 시점에 postgres 커넥션을 만든다. `tsx --test`가 그걸 끌고 오면 DB 없이 테스트가 못 돈다 — 직전 두 사이클과 **같은 이유·같은 규칙**.

## 10. 파일 계획

### 신규

| 파일 | 역할 | DB | 예상 |
|---|---|---|---|
| `tracker/site-access-rules.ts` | 순수 스코프 해석 3함수 (§2.3) | ✗ | ~70 |
| `tracker/site-access.ts` | DB 어댑터 3함수 (§2.5) | ✓ | ~90 |
| `tracker/site-access.test.ts` | 순수부. import는 `-rules`에서만 | ✗ | ~140 |
| `tracker/date-range.ts` | 날짜 4함수 (§5.2) | ✗ | ~40 |
| `tracker/date-range.test.ts` | B12 | ✗ | ~60 |
| `tracker/sql-filters.ts` | funnel·overview에서 **문자 그대로** 이동(F6·F7) | ✗ | ~35 |
| `tracker/funnel-context.ts` | `buildFunnelContext` | ✓ | ~90 |
| `tracker/analytics-queries.ts` | `aggregateRange` + `queryPageAnalytics` + `pct` | ✓ | ~150 |
| `tracker/journey.ts` | `buildRecordJourney` | ✓ | ~180 |
| `mcp/types.ts` | 공용 타입 | ✗ | ~20 |
| `mcp/tracker-tools.ts` | 툴 7 + 핸들러 7 | ✓ | ~190 |
| `mcp/tracker-format.ts` | 순수 변환 | ✗ | ~70 |
| `mcp/tracker-format.test.ts` | B3·B7·B9 | ✗ | ~120 |

**200줄 초과 없음.**

### 수정

| 파일 | 변경 |
|---|---|
| `mcp/tools.ts` | import 1줄 + 전개 2곳 |
| `tracker/analytics/funnel/route.ts` | 162 → ~85 |
| `tracker/analytics/overview/route.ts` | 588 → ~465 (§3.3) |
| `tracker/analytics/pages/route.ts` | 56 → ~30 |
| `records/[id]/journey/route.ts` | 335 → ~70 |

**DB 마이그레이션 없음.** 조회 전용.

### 커밋 분할

| # | 내용 | 검증 |
|---|---|---|
| 1 | 추출만. **MCP 코드 0줄** | §4.2 A/B의 **빈 diff (B10)** |
| 2 | 스코프 해석 + 테스트 | `pnpm test` (B13) |
| 3 | MCP 툴 | §4.2 C (B4·B7) + `tools/call` 실호출 |

## 11. behavior → 구현 매핑

| id | 담당 | 검증 |
|---|---|---|
| B1 | `listAccessibleTrackerSites` + `filterAccessibleSites` | curl |
| B2 | `list_funnels` — 퍼널명 하드코딩 0 | 새 퍼널 생성 후 재호출 |
| B3 | `computeFunnelMetrics` (순수) | **node:test** + curl |
| B4 | 커밋 1의 추출 + `funnel-context.ts` 공유 | §4.2 C diff |
| B5 | `resolveTrackerSiteForToken` ① (`orgId` 조건) | curl — 타 조직 siteId |
| B6 | `buildRecordJourney` + `checkTokenAccess` | curl + 웹 대조 |
| B7 | `aggregateRange`(이동) 2회 + `pct` | §4.2 C |
| B8 | `queryPageAnalytics` | curl + 웹 상위 20건 대조 |
| B9 | `list_tracker_events` (신규 쿼리) | curl |
| B10 | **커밋 1 자체** | §4.2 A/B **빈 diff** |
| B11 | `buildFunnelContext`의 기본 퍼널 선택 | curl — funnelId 유/무 동일 |
| B12 | `resolveRange` (순수) | **node:test** + curl |
| B13 | `resolveScopeWorkspaces` (순수) + `loadScopeWorkspaceLookup` | **node:test** + 토큰 6종 curl |

## 12. TDD 계약 (약 58건)

전부 DB를 모르는 순수 함수. import를 `-rules`/`format`/`date-range`로 한정.

### 12.1 `resolveScopeWorkspaces` — B13 (14건)

lookup 고정: `{ folder: {7→3}, partition: {100→5} }`

| # | 테스트명 | 기대 |
|---|---|---|
| S-1 | org 스코프는 조직 전체를 연다 | `{kind:"all"}` |
| S-2 | workspace 스코프는 그 워크스페이스만 연다 | `{some,{3}}` |
| S-3 | folder 스코프는 상위 워크스페이스로 올라간다 | `{some,{3}}` |
| S-4 | partition 스코프도 상위 워크스페이스로 올라간다 | `{some,{5}}` |
| S-5 | 여러 스코프의 워크스페이스가 합쳐진다 | `{some,{3,5}}` |
| S-6 | org가 하나라도 있으면 나머지와 무관하게 전체다 | `{kind:"all"}` |
| S-7 | read 권한 없는 org 스코프는 전체를 열지 않는다 | `{some,∅}` |
| S-8 | read 권한 없는 workspace 스코프는 무시된다 | `{some,∅}` |
| S-9 | 스코프가 없으면 아무것도 열지 않는다 | `{some,∅}` |
| S-10 | lookup에 없는 folder 스코프는 조용히 버려진다 | `{some,∅}` |
| S-11 | lookup에 없는 partition 스코프도 버려진다 | `{some,∅}` |
| S-12 | 알 수 없는 scopeType은 무시된다 (fail-closed) | `{some,∅}` |
| S-13 | 같은 워크스페이스 중복 스코프는 한 번만 센다 | `ids.size===1` |
| S-14 | 권한 종류를 바꾸면 판정도 바뀐다 | `{some,∅}` |

### 12.2 `scopeAllowsWorkspace`/`filterAccessibleSites` (7건)

**A-4 "빈 목록은 전체가 아니라 아무것도 아니다"가 핵심** — §2.1에서 `null`을 기각한 이유를 실행 가능한 형태로 못 박는다.

### 12.3 `computeFunnelMetrics` — B3 (12건)

| # | 테스트명 | 기대 |
|---|---|---|
| F-2 | 첫 단계의 전환율은 0이 아니라 null이다 | `null` |
| F-4 | 가장 큰 이탈 구간을 찾는다 | `toKey==="s3"` |
| F-5 | 이탈이 동률이면 앞선 구간을 고른다 | `toKey==="s2"` |
| F-7 | 방문자 0인 단계 뒤는 0으로 나누지 않는다 | `null` (NaN·Infinity 아님) |
| F-11 | 단계 수가 늘어도(역증가) 음수 이탈로 만들지 않는다 | `dropOff===0` |

**F-7·F-8이 필수인 이유**: `Infinity`가 JSON에 실리면 `JSON.stringify`가 `null`로 바꿔 조용한 손실이 된다. **F-11**은 event 퍼널이 cumulative 역산을 안 해서 **뒤 단계가 앞보다 클 수 있다**는 실제 코드 사실을 겨냥한다.

### 12.4 `pct` — B7 (6건) — 이동해 온 함수라 회귀 테스트이기도 하다
### 12.5 `resolveRange`/`isValidYmd` — B12 (10건)

**V-4 "존재하지 않는 날짜를 거부한다"(`2026-02-30`)** 가 형식 정규식만으로 끝내지 않게 만든다.

### 12.6 `clampPageSize` (5건)

## 13. TDD 밖 검증 (curl)

1. **커밋 1 전** — 스냅샷 (`TO`는 어제 이전)
2. **커밋 1 후** — `diff -r` → **빈 diff (B10)**
3. **커밋 2 후** — `pnpm test` 신규 58건 (B13)
4. **커밋 3 후** — `tools/list`가 **17개**(10+7)
5. **B4** — 퍼널 diff / 6. **B7** — overview KPI diff
7. **B3** — `biggestDropOff`가 손계산과 일치
8. **B11** — funnelId 유/무 응답 동일
9. **B12** — 생략 시 `range`가 오늘-30일~오늘
10. **B5** — 타 조직 siteId → `"트래커를 찾을 수 없습니다."` + `isError`
11. **B13 — 스코프별 토큰 6종** (가장 손이 많이 감):

| 토큰 | 기대 |
|---|---|
| org | 모든 사이트 |
| workspace(사이트 있음) | 1개 |
| workspace(사이트 **없음**) | **0개** |
| folder | 상위 워크스페이스 사이트 |
| partition | 상위 워크스페이스 사이트 |
| read 없는 org | **0개** (S-7의 실증) |

12. **B2** — 새 퍼널 생성 후 재호출 → 코드 수정 없이 나옴
13. **B6** — events 수가 웹 journey와 일치
14. **B9** — `eventName` 유/무로 `totalCount` 변화
15. **응답 크기** — `list_tracker_events` 기본 호출이 **50KB 초과면 기본 pageSize를 낮춘다**
16. **회귀** — `pnpm test`, `tsc`, `next build`

## 14. 도메인 체크리스트

| 영역 | 결론 |
|---|---|
| 데이터 모델 | **스키마 변경 0, 마이그레이션 0.** 필요한 컬럼이 전부 이미 있고 notNull |
| API 계약 | JSON-RPC 2.0, `{content:[{type:"text",text}]}`, 실패는 `isError:true`. 한국어. **전부 조회 전용이라 멱등** |
| 상태 관리 | 클라이언트 상태 없음. SWR 캐시 영향 없음 — 웹 응답이 바이트 단위로 같기 때문(B10) |
| 보안 | **두 겹**: ① org 경계 `eq(trackerSites.orgId, tokenInfo.orgId)` ② 스코프 `resolveScopeWorkspaces`. `get_record_journey`만 `checkTokenAccess(partitionId)`. **`apiKey` 구조적 배제**(컬럼 명시 select) |
| 동시성 | **쓰기 없음 → 경쟁 없음** |
| 성능 | 스코프 해석 최대 2쿼리(org면 0) — **N+1 없음**. overview는 8쿼리인데 웹과 동일하므로 새 부하 아님 |

## 15. 리스크 / 열린 질문

- **🔴 최대 리스크 — 추출이 웹 수치를 조용히 바꾼다 (B10).** 완화는 §4의 세 겹. **단계 B의 diff가 비지 않으면 그 자리에서 멈춘다** — "차이가 작으니 괜찮겠지"로 넘어가면 대시보드가 몇 달간 틀린 수치를 보여준다. 잔여 위험: diff는 `SITE`·기간이 덮는 경로만 검증하고 세그먼트 조합을 전부 돌지 않는다. **커버리지가 100%가 아니다** — 이것이 §3.2에서 (B)를 기각한 이유이기도 하다.

- **🔴 스코프 해석기가 틀리면 테넌트 격리가 깨진다.** 순수 함수 + 14테스트 + 토큰 6종 실증. **`{some,∅}`를 "전체"로 오해하는 것**이 유일한 치명적 실패 모드이고 판별 유니온이 컴파일 단계에서 막는다.

- **🟡 folder/partition 스코프의 권한 확대는 의도된 것이다.** 파티션 하나만 가진 토큰이 그 워크스페이스 **트래커 데이터 전부**를 본다. 즉 **"파티션 A만 준 토큰이 파티션 B 리드의 방문 기록을 볼 수 있다"**는 뜻이다. 조회 전용이라 대가가 읽기에 한정되고 실사용은 대부분 org 스코프다. REPORT에 이 문장 그대로 기록해 나중에 판단할 수 있게 한다.

- **🟡 `leads` 정의가 funnel과 overview에서 다르다 (실측 확인).** funnel은 `record_id IS NOT NULL OR EXISTS(visitor_record_links)`인데 overview는 `record_id IS NOT NULL`만 센다. **즉 overview의 `leadRate`가 funnel의 리드 단계보다 작게 나온다.** mechanical move이므로 **고치지 않는다**(고치면 B10 diff가 깨진다). **후속 사이클 1순위 후보** — 어느 쪽이 옳은지 사용자 판단 필요.

- **🟡 `ymd()`가 UTC라 KST 오전 9시 이전에는 기본 기간이 하루 밀린다.** 웹 4곳이 전부 같은 방식이라 일관되긴 하다. 그대로 옮긴다. 후속 후보.

- **🟡 `get_page_analytics`만 날짜 기본값이 전 기간이다** (B12의 예외, §8.6). description에 명시하지만 Claude가 "최근 30일 페이지 성과"를 물으면 `from`/`to`를 스스로 넣어야 한다. 대안(웹에도 30일 기본)은 B10 위반.

- **🟡 채널 필터를 노출하지 않았다.** 유효값이 `classifyInflow`가 내는 한국어 라벨 집합인데 코드에만 있어 Claude가 모른다. enum으로 박으면 **"채널이 추가돼도 코드 수정이 필요 없어야 한다"는 제약과 충돌.** 필요해지면 `list_tracker_channels` 같은 목록 조회형 툴이 제약과 일관된다.

- **🟢 툴이 17개가 된다.** `tools/list` 전체가 컨텍스트에 실리므로 비용이 있으나 17개는 충분히 작다. description을 짧게 유지.

- **🟢 engagement·ad-performance의 `rangeBounds` 중복 2건을 남긴다** (§5.3). 정리하면 B10 검증 대상이 늘어난다.

- **🟢 `overview/route.ts`가 추출 후에도 465줄** (§3.3). 더 쪼개려면 (B)여야 하는데 검증 불가라 기각. 후속 후보로만 기록.

---

**진행 순서는 반드시 커밋 1 → 2 → 3이다.** 1과 3을 섞으면 B10의 원인 분리가 불가능해진다.
