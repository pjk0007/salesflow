# PLAN — MCP 트래커 툴 추가

- **track**: Full
- **사이클 ID**: `2026-09-01-mcp-tracker-tools`

## 목표

MCP 서버(`/api/mcp`)에 **트래커 축**을 노출해, Claude가 퍼널 전환·이탈과 방문자 행동을 직접 조회할 수 있게 한다.

현재 MCP 툴 10개는 전부 레코드·발송로그·기본 집계뿐이다. 트래커 데이터(`tracker_sites`·`tracker_funnels`·`tracker_events`·`tracker_sessions`·`tracker_visitors`)는 웹 UI에만 있고 MCP에는 통째로 빠져 있어서, "구독신청 과정에서 어디서 이탈해?" 같은 질문에 답할 수 없다.

실제로 조직에는 **"구독신청 과정" · "구독 전환" · "구독 전환 흐름"** 퍼널이 정의돼 있고 이벤트도 4만 건 넘게 쌓여 있다.

## 핵심 설계 결정

**집계 로직을 복제하지 않는다.** 이미 `src/lib/tracker/`에 `funnel-analytics.ts`·`session-filter.ts`·`page-path.ts`가 분리돼 있다. 다만 **route 안에 남아 있는 부분**이 상당하다:

| route | 줄 수 | 상태 |
|---|---|---|
| `analytics/funnel` | 162 | 집계 컨텍스트(StageContext) 구성이 route 안에 |
| `analytics/overview` | 588 | 대부분 route 안에 |
| `analytics/pages` | 56 | 얇음 — 재사용 쉬움 |
| `records/[id]/journey` | 335 | 대부분 route 안에 |

따라서 이번 작업의 실제 비용은 **MCP 툴 작성이 아니라 route에서 로직을 추출하는 것**이다. 추출한 함수는 웹 route와 MCP가 공유하므로, 웹 UI 동작이 바뀌면 안 된다(회귀 위험이 여기 있다).

**권한은 워크스페이스 축으로 매핑한다 (결정됨).** 트래커는 도메인(사이트) 단위라 파티션과 축이 맞지 않는다. 다만 `tracker_sites.workspaceId`가 있으므로 API 토큰 스코프를 이렇게 해석한다:

| 토큰 스코프 | 접근 가능한 사이트 |
|---|---|
| `org` | 조직 전체 |
| `workspace` | 그 워크스페이스의 사이트 |
| `folder` / `partition` | **그 대상이 속한 워크스페이스의 사이트** (상위로 타고 올라감) |

파티션 스코프에서 상위로 올라가는 것은 의도된 선택이다 — 파티션은 워크스페이스 안에서 데이터를 세부 관리하는 단위이고, 트래커 데이터는 결국 그 리드들이 만든 것이므로 "파티션을 볼 수 있으면 그 유입 경로도 본다"가 일관된다. 실사용도 대부분 org 스코프 토큰이다.

**퍼널·도메인이 추가돼도 코드 수정이 필요 없다.** 툴이 목록을 조회하는 형태라 새 퍼널·새 사이트가 자동으로 나온다. 하드코딩 금지가 이 사이클의 제약이다.

## 단계별 작업

1. **로직 추출** — `analytics/funnel`의 컨텍스트 구성을 `src/lib/tracker/funnel-context.ts`로, `pages`·`overview`의 집계를 `src/lib/tracker/analytics-queries.ts`로. 웹 route는 추출한 함수를 호출하도록 바꾼다
2. **journey 추출** — `records/[id]/journey`의 조회·조립을 `src/lib/tracker/journey.ts`로
3. **MCP 툴 정의** — `TOOL_DEFINITIONS`에 7개 추가
4. **MCP 핸들러** — `createMcpToolHandlers`에 7개 추가. 전부 스코프→워크스페이스 해석을 거친다
5. **웹 회귀 확인** — 추출 후 기존 화면이 그대로 동작하는지

## 건드릴 파일

### 신규

| 파일 | 요지 |
|---|---|
| `src/lib/tracker/funnel-context.ts` | 퍼널 집계 컨텍스트 구성 (route에서 추출) |
| `src/lib/tracker/analytics-queries.ts` | overview·pages 집계 (route에서 추출) |
| `src/lib/tracker/journey.ts` | 리드 여정 조립 (route에서 추출) |
| `src/lib/mcp/tracker-tools.ts` | 트래커 툴 정의 + 핸들러 (tools.ts가 402줄이라 분리) |
| `src/lib/mcp/tracker-tools.test.ts` | 순수 변환부 테스트 |

### 수정

| 파일 | 변경 |
|---|---|
| `src/lib/mcp/tools.ts` | 트래커 툴 7개를 정의·핸들러에 병합 |
| `src/app/api/tracker/analytics/funnel/route.ts` | 추출한 함수 호출로 대체 |
| `src/app/api/tracker/analytics/pages/route.ts` | 동일 |
| `src/app/api/tracker/analytics/overview/route.ts` | 동일 (588줄 — 부분 추출) |
| `src/app/api/records/[id]/journey/route.ts` | 동일 |

## 추가할 툴 7개

| 툴 | 인자 | 답할 수 있게 되는 질문 |
|---|---|---|
| `list_tracker_sites` | — | 어떤 사이트를 추적 중인가 |
| `list_funnels` | `siteId?` | 어떤 퍼널이 있나 (새 퍼널 자동 포함) |
| `get_funnel_analytics` | `siteId`, `funnelId?`, `from?`, `to?` | 단계별 전환율·이탈 지점 |
| `get_record_journey` | `recordId` | 이 리드가 무엇을 보고 신청했나 |
| `get_tracker_overview` | `siteId`, `from?`, `to?` | 방문·세션 추이 |
| `get_page_analytics` | `siteId`, `from?`, `to?` | 어떤 페이지가 성과가 좋나 |
| `list_tracker_events` | `siteId`, `eventName?`, `from?`, `to?` | 특정 행동이 얼마나 일어났나 |

## behavior 목록

| id | 설명 | priority |
|---|---|---|
| B1 | `list_tracker_sites`가 토큰 스코프로 접근 가능한 사이트만 반환한다 | P1 |
| B2 | `list_funnels`가 새로 추가된 퍼널을 코드 수정 없이 반환한다 | P1 |
| B3 | `get_funnel_analytics`가 단계별 방문자 수와 전환율을 반환한다 | P1 |
| B4 | `get_funnel_analytics`가 웹 UI(`/api/tracker/analytics/funnel`)와 같은 수치를 낸다 | P1 |
| B5 | 타 조직의 siteId를 넘기면 거부한다 (테넌트 격리) | P1 |
| B6 | `get_record_journey`가 리드의 방문 이력을 시간순으로 반환한다 | P1 |
| B7 | `get_tracker_overview`가 방문·세션 집계를 반환한다 | P2 |
| B8 | `get_page_analytics`가 페이지별 성과를 반환한다 | P2 |
| B9 | `list_tracker_events`가 이벤트를 조회하고 `eventName`으로 필터된다 | P2 |
| B10 | 로직 추출 후에도 웹 UI의 퍼널·개요·페이지·여정 화면이 동일하게 동작한다 (회귀) | P1 |
| B11 | `funnelId`를 생략하면 사이트의 기본 퍼널을 쓴다 | P2 |
| B12 | 날짜 인자를 생략하면 최근 30일이 적용된다 | P2 |
| B13 | 토큰 스코프에 따라 접근 가능한 사이트가 제한된다 (org=전체, workspace=해당, folder/partition=상위 워크스페이스) | P1 |

## 리스크/불확실성

- **회귀가 가장 큰 위험이다.** 추출한 함수를 웹 route와 MCP가 공유하므로, 추출 과정에서 동작이 미묘하게 달라지면 **기존 대시보드가 조용히 틀린 수치를 보여준다.** B4·B10이 이걸 겨냥한다 — 추출 전후로 같은 입력에 같은 출력이 나오는지 실제 데이터로 대조해야 한다.
- **`overview` 588줄** — 통째로 추출하면 diff가 크고 위험하다. MCP가 실제로 필요한 부분만 잘라내는 편이 안전한지 DESIGN에서 판단한다.
- **응답 크기** — MCP 응답이 너무 크면 Claude 컨텍스트를 잡아먹는다. `list_tracker_events`는 수만 건이 나올 수 있어 기본 페이지 크기와 상한이 필요하다.
- **스코프 → 워크스페이스 해석의 구현 비용** — `checkTokenAccess`는 파티션 id를 받는 형태라 그대로 못 쓴다. 토큰 스코프에서 접근 가능한 workspaceId 집합을 구하는 헬퍼가 새로 필요하다. 이 헬퍼가 틀리면 테넌트 격리가 깨지므로 순수 함수로 분리해 테스트로 고정한다.
- **날짜 처리** — 웹 route가 `from`/`to`를 YMD 문자열로 받고 기본값이 30일이다. MCP도 같은 규약을 써야 수치가 일치한다.

## 검증 방법

- **순수 변환부** — MCP 응답 포맷팅(집계 결과 → 텍스트)은 DB 없이 테스트 가능. `node:test`로 고정
- **수치 일치(B4·B10)** — 같은 파라미터로 웹 API와 MCP 툴을 각각 호출해 결과를 대조. **이게 이번 사이클의 핵심 검증이다**
- **MCP 프로토콜** — 실제 토큰으로 `tools/list`·`tools/call`을 호출해 응답 확인
- **회귀** — `pnpm test`, `npx tsc --noEmit`, `npx next build`

## 범위 밖

- 트래커 데이터 쓰기(이벤트 생성·퍼널 편집) — 조회 전용
- `analytics/engagement`·`ad-performance` 툴화 (필요하면 후속)
- 트래커의 파티션 단위 권한 — 트래커는 도메인 단위라 축이 다르다(워크스페이스로 매핑)
- 웹 UI 변경
- 앞 사이클이 남긴 데이터 축 지연 반영 문제
