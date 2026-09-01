# REVIEW — MCP 트래커 툴 추가

- **사이클**: `2026-09-01-mcp-tracker-tools`
- **리뷰일**: 2026-09-01
- **범위**: `git diff 20a67a6~1..HEAD` — 커밋 4개, 22파일, +2778/-589

## 요약

**🔴 1 · 🟡 4 · 🟢 3.** 🔴 1건과 🟡 2건은 커밋 전에 수정했다.

## 🔴 파티션 경계 우회 (수정 완료 · B14)

`get_record_journey`가 `checkTokenAccess(tokenInfo, record.partitionId, "read")`로 **진입 레코드 한 건의 파티션만** 검사한 뒤 `buildRecordJourney`를 `merge` 기본값(true)으로 호출했다.

그 경로는 주석이 명시하듯 visitor 링크를 1-hop 타고 **"파티션 경계 넘어 통합"** 한다. `journey.ts`의 격리는 `eq(records.orgId, orgId)` — **org 경계만** 막고 파티션은 안 막는다.

결과적으로 파티션 A 스코프 토큰이 같은 visitor에 엮인 **파티션 B 레코드의 이벤트·메일 이력·요약까지** 받았다.

웹 route는 세션 유저 기준이라 이 동작이 의도된 것이지만, MCP는 파티션 스코프 토큰이 존재하므로 같은 함수가 권한 우회가 된다. 실피해는 partition 스코프 토큰에 한정되고 실사용은 대부분 org 스코프지만, **격리를 코드가 아니라 운영 관행이 지탱하는 상태**였다.

→ `merge: false` 고정. 사유를 주석으로 남겼다.

## 🟡 정확성 (2건 수정 완료 · B15)

- **역전 범위를 아무도 거부하지 않았다.** `isValidYmd`는 형식·실재만 보고 대소를 안 본다. `from=2026-06-01, to=2026-01-01`이면 집계가 조용히 0건이 되고 `previousRange`가 **미래 구간**을 만들어 `deltaPct`가 말이 안 되는 값을 내는데 에러가 아니라 정상 응답으로 나갔다. → `parseRange`와 `get_page_analytics` 둘 다 거부.
- **`get_page_analytics`가 `from`만 받으면 응답의 `to`가 사라졌다.** 내부적으로는 `2999-12-31`을 쓰는데 원본 인자를 그대로 돌려줘서 Claude가 집계 범위를 알 수 없었다. → 실제 적용 경계를 노출.

## 🟡 성능 (2건 · 기록만)

- `loadScopeWorkspaceLookup`이 툴 호출마다 재실행된다. org/workspace 스코프만 있으면 쿼리 0회라 실피해는 없고, 스코프 전체를 `inArray`로 한 번에 조회하므로 N+1도 아니다.
- `list_tracker_events`의 3중 쿼리와 `get_tracker_overview`의 8쿼리는 전부 `Promise.all` 병렬이라 직렬 대기가 없다. `eventNameCounts`는 `.limit(20)`으로 상한이 있다.

## 🟢 확인했고 문제없음

| 항목 | 근거 |
|---|---|
| **SQL 인젝션** | `deviceFilterSql`이 `sql.raw`를 쓰지만 MCP 유입 경로가 `parseDevice`의 3값 화이트리스트 하나뿐. 호출부 전수 확인 결과 나머지도 같은 화이트리스트를 거친다. `visitorAlias`는 하드코딩 리터럴, `sessionInFilterSql`은 DB에서 온 number[]를 파라미터 바인딩 |
| **apiKey 누출** | `SITE_COLUMNS`가 명시적 allowlist고 타입에도 필드가 없다. 핸들러가 재차 필드를 명시 |
| **org 경계** | `resolveTrackerSiteForToken`·`listAccessibleTrackerSites` 둘 다 `eq(trackerSites.orgId, ...)`를 WHERE에 직접 걸고 그다음 스코프를 본다. 타 조직 id에 `not_found`를 주는 것(존재 탐침 차단)도 옳다 |
| **7개 툴 게이팅** | 전부 첫 줄에서 권한 검사. `list_funnels`는 스코프로 거른 목록 안에서만 조회 |
| **fail-closed** | 권한 비트를 scopeType 분기보다 먼저 본다. 미지 scopeType·lookup 미스는 버린다. 판별 유니온이라 "전체"와 "없음"이 falsy로 뭉개지지 않는다 |
| **추출 정확성** | journey는 들여쓰기 정규화 + `user.orgId`→`orgId` 치환 5곳 외에 로직 차이 0 |

## 🟢 컨벤션

`any` 없음, 에러 swallow 없음, `console.log` 잔존 없음. `num`·`str`은 `unknown` + narrowing.

`journey.ts` 337줄 / `overview/route.ts` 470줄은 200줄 초과지만 **DESIGN §3.3의 의도적 유보**다. mechanical move 중에 분할을 겸하면 회귀 원인이 둘이 되므로 이번에 안 쪼갠 선택이 옳다. 후속 부채로 기록.

## 남은 지적 (수정 안 함)

- **`sql-filters.ts`의 `sql.raw`가 패턴만 보면 인젝션처럼 읽힌다.** 지금은 호출부 화이트리스트로 안전하지만 방어가 함수 자체에 없다. 나중에 누가 검증 안 된 값을 넘기면 즉시 취약해진다. → 함수 안에서 화이트리스트를 재확인하면 호출부와 무관하게 안전해진다. `DEVICES` 상수를 공유 위치로 옮겨야 해서 이번 범위 밖.
- **`selectFunnel`의 원본 주석이 틀렸었다.** `funnel/route.ts`는 "기본 = marketing 한정"이라 적었으나 쿼리는 `is_default=1`만 보고 `kind`를 안 본다. 추출하며 주석을 코드에 맞게 고쳤고 쿼리는 동일하다 — 동작 변화 없음. `is_default=1`인 event 퍼널이 있으면 원 주석 의도와 다르게 선택되는데, 이는 추출 이전부터의 상태다.
