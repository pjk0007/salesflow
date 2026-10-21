# DESIGN — 이메일 대시보드 재구성: 영업·리드 지표 + 일별 집계

- **track**: Full · **사이클 ID**: `2026-10-21-email-dashboard-stats`
- **근거**: `PLAN.md`(승인, 끝 절 "결정 (사용자 답)" Q1~Q4), `behaviors.json` B1~B30
- **사용자 결정**
  - Q1: KPI는 8개다(발송·도달률·사람 오픈율·사람 클릭률(CTOR)·메일 유입 방문·회신율·핵심 리드·수신거부율). 회신율은 첫 메일 기준이다.
  - Q2: 기간은 7·30·90일(기본 30) + 직접 지정이다. 직전 같은 길이 기간과 비교한다. 숫자는 최대 15분 늦고, 화면에 "집계 기준 HH:MM"을 보인다. "지금 갱신" 버튼으로 오늘·어제를 바로 다시 센다(2026-10-21 사용자 결정, 7-8절).
  - Q3: 워크스페이스 선택을 둔다(기본 전체). 숨긴 워크스페이스는 목록에서만 빼고 전체 합계에는 넣는다.
  - Q4: 비용 지표는 넣지 않는다.
- **마이그레이션**: `drizzle/0121_email_stats.sql`, journal idx 122, when `1792692000000`이다. 현재 최대값 `1792605600000`에 하루를 더했다(0118~0120이 하루 간격이다). 검색 사이클(`2026-10-21-send-log-search`)은 마이그레이션을 쓰지 않는다. 그 색인은 `send-log-indexes.ts` 경로로 만든다.
- **새 의존성**: 없다.
- **반영**: 커밋은 사용자 확인 뒤에 한다. main push가 곧 운영 배포이므로 사용자가 요청할 때만 한다. 운영 DB 읽기 조회도 사용자가 요청할 때만 한다.
- 경로는 저장소 루트 기준이고, 줄 번호는 2026-10-21 main 기준이다. **[미확인]**은 코드나 운영으로 확인하지 못한 것이다.

## 0. 원칙

1. 화면 요청은 집계 표와 작은 이름 표만 읽는다. `email_send_logs`·`email_click_logs`·`email_open_logs`는 워커만 읽는다.
2. 지표 정의를 새로 쓰지 않는다. 기존 조각을 그대로 끼운다.
   - `openBaseSql`·`openedSendSql`(`src/lib/email-open-sql.ts:5-15`)
   - `acceptedSendConditionSql`(`src/lib/email-send-log-status.ts:51-53`)
   - `HEALTH_CATEGORY_SQL`(`src/lib/sender-health-rules.ts:230-240`)
   - `ruleOf`(`src/lib/email-reply-rules.ts:1571-1575`)
   - `openRatePercent`·`openRateText`(`src/components/email/opens/utils/openRate.ts:2-7`)
3. 날짜는 모두 KST 달력 날짜다. 메일 지표는 발송일 코호트, 핵심 리드는 판정일 기준이다.
4. 집계는 멱등 재계산이다. 입력이 같으면 같은 줄이 나오고, 바뀐 줄만 쓴다.
5. 워커가 실패해도 서버와 발송은 그대로다. 숫자만 멈추고, 화면은 기준 시각으로 그 사실을 알린다.

## 1. 결정 요약

| # | 질문 | 결정 |
|---|---|---|
| D1 | 집계 방식 | PLAN (b)다. 귀속 표 + 일별 집계 표 + 증분 워커를 쓰고, (c) 커버링 색인은 하지 않는다. |
| D2 | 표 | 새 표 4개를 만든다. `email_stats_send_attr`(발송 1줄), `email_stats_daily`(축 묶음별 하루 합계), `email_stats_lead_days`(핵심 리드 고객·일), `email_stats_state`(조직별 진행·워터마크) |
| D3 | 축 묶음 | 한 표에 `grain` 칸으로 5묶음을 담는다: total·campaign(+단계)·partition·sender(+도메인)·trigger. 모든 축을 곱하지 않는다. |
| D4 | 쓰기 | 계산 결과를 현재 줄과 비교해 바뀐 줄만 upsert하고, 사라진 조합은 DELETE한다. 이 전부를 한 문장으로 한다. |
| D5 | 귀속 | id 순서로 부모 귀속을 물려받는다(TS 순수 함수). 부모 귀속이 없을 때만 loadChains와 같은 사슬 SQL로 보충한다. |
| D6 | 창 | 15분마다 최근 8일(T-7~T)을 다시 센다. 야간(01시 이후)에는 9~35일째(T-34~T-8)를 센다. 그보다 오래된 날은 워터마크로 찾은 날만 센다. |
| D7 | 백필 | 커서 `filled_from`을 최신에서 과거로 2일씩 옮긴다. T-59까지는 언제든, 그보다 앞은 발송 창 밖에서만 한다. |
| D8 | 실행 위치 | instrumentation 안의 정기 회차가 주 경로다(`createJourneyScheduler` 틀). CRON_SECRET POST는 수동·예비 경로다. |
| D9 | 잠금·제한 | advisory `0x5c4edf18`, 예약 연결 1개, `statement_timeout 120s`·`lock_timeout 5s`, 회차 예산 120초 |
| D10 | sendb-dev | 돌린다(외부 효과가 없다). `EMAIL_STATS_WORKER=off`로 끌 수 있다. |
| D11 | API | GET `/api/analytics/email-stats?view=kpi\|trend\|compare`. 섹션마다 따로 부른다. asOf·coverage·connections를 함께 준다. |
| D12 | 홈 | summary·trends·templates의 이메일 부분만 집계 표로 바꾸고, 응답 모양은 그대로 둔다. 알림톡·레코드는 단계 0 결과에 따라 분기한다. |
| D13 | 화면 | `src/components/email/dashboard/` 아래에 새로 짠다. 섹션마다 SWR을 따로 두고, 15분마다 새로 고치며, 포커스 때 다시 부르지 않는다. |
| D14 | 회신율 | KPI는 첫 메일 기준(`seq_replied ÷ first_sent`)이다. 후속 단계·발송 유형 축은 통당 기준이다. |
| D15 | 도달률 분모 | 발신 쪽 실패와 SST5를 **넣는다**(3절). |

## 2. 접근법과 트레이드오프

### 2-1. 집계 방식 (PLAN 3절 확정 + 라이브러리 안)

| 안 | 장점 | 대가 |
|---|---|---|
| **A. 귀속 표 + 일별 집계 + 증분 워커 (택함)** | 화면은 수백 페이지만 읽는다(B17). 회신·방문 같은 새 지표도 워커가 한 번만 계산한다. | 숫자가 최대 15분 늦다. 35일 넘은 발송의 상태·분류 변경은 따라가지 못한다. 회차·잠금·이어하기를 직접 짠다(기존 틀을 재사용해도 lib 약 1,500줄). |
| B. 커버링 색인 | 실시간이다. | 90일+직전과 후속 귀속을 2초 안에 맞추기 어렵다. 넓은 색인이 128MB 캐시를 다툰다. |
| C. 작업 큐 라이브러리(pg-boss·graphile-worker, 새 의존성·승인 필요) + A | 예약·재시도·단일 실행을 라이브러리에 맡긴다. | 자체 스키마 표가 생긴다. 이미 10곳 넘게 쓰는 "advisory 잠금 + 예약 연결 + 타이머" 틀과 갈래가 둘이 된다. 집계 SQL·창·워터마크는 어차피 직접 짠다. 아끼는 것은 예약 코드 50줄 정도다. |
| D. materialized view·응답 캐시 | — | PLAN 3절에서 탈락했다(매번 전체 재계산, 첫 로딩이 그대로 느림). |

### 2-2. 표 모양 (PLAN "축 묶음별로 나눌지")

| 안 | 장점 | 대가 |
|---|---|---|
| **A. 한 표 + `grain` 5묶음 (택함)** | upsert·삭제·읽기 경로가 하나다. 묶음끼리 합 대조(B5)가 쉽다. 조직·날짜당 150~200줄(추정)이다. | 묶음마다 안 쓰는 키 칸이 기본값(0·''·-1)으로 찬다. 묶음이 한 힙에 섞이므로, INSERT를 grain·날짜 순서로 넣어 같은 묶음끼리 붙인다. |
| B. 묶음별 물리 표 5개 | 칸이 정확하고 물리적으로 모인다. | DDL·upsert·삭제·스키마가 5벌이 된다. |
| C. 모든 축을 곱한 한 표 | 어떤 조합으로든 다시 묶을 수 있다. | 발신 주소 순환 때문에 하루 약 900줄(조직 A 추정)이 된다. 180일 KPI 읽기가 약 5천 페이지라 B17을 넘는다. |

### 2-3. 귀속 계산

| 안 | 장점 | 대가 |
|---|---|---|
| **A. TS 순수 함수(id 순 상속) + 빠진 부모만 사슬 SQL (택함)** | 상속 규칙을 TDD로 고정한다(B2). 부모 귀속이 대개 이미 표에 있어 큰 표의 부모 행을 읽지 않는다. | 귀속이 없는 새 발송을 앱으로 한 번 가져온다(회차당 수백 줄). |
| B. SQL 재귀 한 문장 | 왕복이 없다. | 상속·보충·조직 확인이 한 문장에 얽혀 시험하기 어렵다. |
| C. 지금처럼 읽을 때마다 재귀(`email-daily/route.ts:37-93`) | 표가 필요 없다. | 부모 행을 heap에서 무작위로 읽는다(지금 15.9초). |

### 2-4. 바뀐 줄만 쓰기

| 안 | 장점 | 대가 |
|---|---|---|
| **A. 현재 줄과 비교해 바뀐 줄만 INSERT…ON CONFLICT DO UPDATE, 사라진 조합 DELETE — 한 문장 (택함)** | 바뀐 것이 없으면 쓰기와 행 잠금이 모두 0이다(B6). 원자적이다. | 문장이 길다(CTE 10개 안팎). |
| B. `ON CONFLICT … DO UPDATE WHERE … IS DISTINCT FROM` | 짧다. | WHERE가 거짓이어도 충돌한 행은 잠근다. 행 잠금이 페이지와 WAL에 기록되므로 B6의 "쓰기 0"이 아니다. |
| C. 날짜 범위 DELETE 뒤 INSERT | 가장 단순하다. | 15분마다 8일치를 전부 다시 쓴다(죽은 줄·WAL이 생긴다). |

### 2-5. 실행 위치

| 안 | 장점 | 대가 |
|---|---|---|
| **A. instrumentation 안의 정기 회차 + CRON_SECRET POST (택함)** | 배포만 하면 돈다. CloudType 스케줄러 설정이 필요 없다. 고객 여정·예약 전송과 같은 틀이다. | 웹 프로세스 안에서 돈다. 다만 일은 DB가 하고, Node는 귀속 계산만 한다. 인스턴스가 여럿이면 잠금으로 하나만 돈다. |
| B. CloudType 정기 호출만(발신 건강·결과 맞추기 방식) | 웹 프로세스와 떨어져 돈다. | 사람이 CloudType에 작업을 등록해야 한다. 빠뜨리면 숫자가 멈춘다. HTTP 시간 제한이 긴 백필과 맞지 않는다. |

### 2-6. API 나누기

| 안 | 장점 | 대가 |
|---|---|---|
| **A. 한 라우트를 view=kpi·trend·compare로 3번 부른다 (택함)** | 섹션이 서로 기다리지 않는다(B23). 비교 축을 바꿔도 KPI를 다시 읽지 않는다. | 요청이 3개다(각각 수십 ms). |
| B. 한 번에 모두 받는다 | 요청이 1개다. | 가장 느린 부분을 모두 기다린다. 축을 바꿀 때 전부 다시 읽는다. |
| C. 라우트 3개 | 경로가 분명하다. | 검증과 봉투가 3벌이 된다. |

### 2-7. 핵심 리드 수

| 안 | 장점 | 대가 |
|---|---|---|
| **A. `email_stats_lead_days`(조직·날짜·사업·고객 키) + 읽을 때 고유 고객 수 (택함)** | 기간 안의 고유 고객을 정확히 센다. 화면은 작은 표만 읽는다. | 표가 하나 는다. `customer_journey_alerts`에 (org_id, created_at) 색인이 없어서 워커가 회차마다 조직의 알림을 모두 읽는다(지금 수백~수천 줄 [미확인]). |
| B. API가 `customer_journey_alerts`를 직접 읽는다 | 표가 필요 없다. | 화면을 열 때마다 jsonb를 풀어 읽는다. 1만 줄이 되면 B17을 넘는다. |
| C. 일별 표에 판정 건수를 둔다 | 날짜끼리 더하기 쉽다. | 같은 고객이 여러 날 판정되면 여러 번 센다. |

### 2-8. 쓰지 않기로 한 기존 화면 조각

- **`KpiCards`**(`src/components/tracker/ui/widgets/KpiCards.tsx`)
  - 안쪽 `Card`가 export되지 않는다. 트래커 문구(이탈률 툴팁 `:41`, 일평균 줄 `:47-49`)도 박혀 있다.
  - 그래서 모양(클래스·증감 색·아이콘 규칙)만 따라 `KpiCard.tsx`를 새로 만든다. 트래커 위젯은 고치지 않는다(PLAN: 트래커 화면 그대로).
- **`ComparisonSelector`**
  - 문구가 트래커용이다(방문자·세션·페이지뷰, `:31-36`). 비교 기간을 직접 고르는 기능도 연다.
  - Q2는 직전 같은 길이 기간만 쓴다. 그래서 비교 기간은 "비교: 08-23 ~ 09-21 (직전 30일)" 한 줄 글자로만 보인다.
- **`RangeSelector`**
  - 1일 프리셋과 앞뒤 이동 버튼이 있다. B24는 7·30·90 + 직접 지정이다.
  - `DateRangePicker`(`src/components/ui/date-range-picker.tsx`)만 재사용한다.

## 3. 지표 정의서

**공통 규칙**
- **코호트**: 메일 지표는 발송일(`sent_at`의 KST 날짜) 기준이다. 그날 보낸 메일이 나중에 받은 반응까지 센다. 핵심 리드는 판정일(`customer_journey_alerts.created_at`의 KST 날짜) 기준이다.
- **기간**: `[from 00:00, to+1일 00:00) +09:00`이다. B5의 `.999`와 같은 달력 날짜이고, 23:59:59.999 이후 발송도 빠지지 않는다.
- **제외(B3)**: 아래 중 하나라도 맞으면 어떤 수에도 넣지 않는다.
  - `COALESCE(trigger_type,'') LIKE 'test%'`
  - `trigger_type = 'journey_demo'`
  - `status IN ('demo','cancelled')`
  - cancelled는 insert 뒤에 바뀌는 상태다(`email-followup.ts:701,935`, `email-automation.ts:216`). 그래서 귀속 표에 저장하지 않고 재계산 때마다 판단한다.
- **비율**: 소수 첫째 자리 %다. 분모가 0이면 null이고 화면은 "—"다.
- **증감률(B12)**: `(현재 − 직전) ÷ 직전 × 100`, 소수 첫째 자리.
  - 직전 값이 0이거나 null이면 null이다.
  - 비율 지표는 반올림 전 비율로 계산한다. -0은 0으로 둔다.
  - 어느 한 기간이라도 집계가 다 채워지지 않았으면 null이다(툴팁 "비교 기간 집계 준비 중").
- **연동 안 됨(B14)**: 해당하면 0% 대신 "연동 안 됨"을 보인다.
  - 회신: `isReplyScopeOrg(orgId)`가 거짓(`src/lib/email-reply-list.ts:37-39`)
  - 방문: 범위(조직 또는 고른 워크스페이스)에 `tracker_sites.is_active = 1`인 사이트가 없음
  - 핵심 리드: 범위의 워크스페이스가 `journeyAlertConfig(env).ids`(`customer-journey-alert-config.ts:7-31`)에 없거나 모드가 off

**집계 칸** (`email_stats_daily`, 제외되지 않은 발송 1건씩 센다)

| 칸 | 뜻 | 근거 |
|---|---|---|
| total | 제외되지 않은 발송 | |
| accepted | NHN 접수 | `acceptedSendConditionSql` |
| sent | status = 'sent' | |
| failed | status IN ('failed','rejected') | summary 현행 |
| pending | status IN ('pending','uncertain') | uncertain = 방문 감사 메일 전송 응답 대기(`email-visit-ack-delivery.ts:211`) |
| delivered | 갈래 success | `HEALTH_CATEGORY_SQL` |
| bounced | 갈래 failed + dsn_only | 〃 |
| bounced_hard | bounced 중 `delivery_status_code LIKE '5%'` | `schema.ts:767` |
| sender_side | 갈래 sender_side(SST7·8·인증) | 〃 |
| nhn_unsub | 갈래 nhn_unsub(SST5) | 〃 |
| send_reject | 갈래 send_reject(NHN 미접수) | 〃 |
| unconfirmed | 갈래 unknown(결과 대기) | 〃 |
| open_base | open_tracked AND sent | `openBaseSql` |
| opened | open_base 중 사람 오픈 ∪ 사람 클릭 | `openedSendSql` |
| clicked | 사람 클릭(is_bot = false)이 1건 이상. 상태와 무관하다(현행 그대로) | `trends/route.ts:52` |
| opened_clicked | open_base AND 사람 클릭 | |
| replied | 이 발송에 이어진 사람 회신(kind human, matched) | `schema.ts:1955,1961` |
| auto_replied | 이 발송에 이어진 자동응답(kind auto_reply, matched) | |
| first_accepted | 단계 0 AND accepted | |
| first_sent | 단계 0 AND sent | |
| seq_replied | 단계 0 AND sent AND 같은 시퀀스(같은 root)의 어느 발송에든 사람 회신 | Q1 |
| unsubscribed | 발송에 연결된 수신거부(source link·one_click) | `email-unsubscribe.ts:137-159` |
| complained | 스팸 신고(`email_bounce_signals.kind = 'complaint'`) | `schema.ts:2083` |
| visited | 사람 클릭의 click_id에 이어진 같은 조직 사이트 세션이 있음 | `customer-journey-source.ts:37-41` |
| site_actions | visited 중 그 세션에 CLICK·CUSTOM 이벤트가 있음 | `email-click-signals.ts:23-32` |

**비율과 KPI**

| 지표 | 분자 | 분모 | 비고 |
|---|---|---|---|
| 발송 (KPI) | accepted | — | 보조 "첫 메일 n"(first_accepted) |
| 도달률 (KPI) | delivered | 확정 = delivered + bounced + sender_side + nhn_unsub | 결과 대기·접수 거절은 분모 밖 |
| 반송률 | bounced | 확정 | 낮을수록 좋다 |
| 발신 쪽 실패율 | sender_side | 확정 | 주소·도메인 축에만 |
| 사람 오픈율(추정) (KPI) | opened | open_base | 0120 이후 발송만 |
| 사람 클릭률 (KPI) | clicked | sent | 현행 그대로 |
| CTOR | opened_clicked | opened | open_tracked 발송만(B13) |
| 회신율 (KPI, 첫 메일) | seq_replied | first_sent | 자동응답 제외 |
| 회신율(통당) | replied | sent | 단계·유형 축 |
| 수신거부율 (KPI) | unsubscribed | sent | 낮을수록 좋다. 수동 등록은 발송 연결이 없어 빠진다 |
| 스팸 신고 | complained (수) | — | 수신거부율 카드 보조 줄 |
| 메일 유입 방문 (KPI) | visited (수) | — | 보조 "행동 n · 방문율"(visited ÷ sent) |
| 핵심 리드 (KPI) | 기간 안에 긴급·주목 판정을 1번 이상 받은 (워크스페이스, 고객 키) 수 | — | 보조 "긴급·주목·미처리" |

- **도달률 분모 결정**: 발신 쪽 실패와 SST5를 넣는다.
  - 대시보드의 도달률은 "NHN이 받아 간 메일 중 실제로 닿은 몫"이다.
  - 발신 건강이 이 둘을 빼는 것은 명단 품질을 재기 위해서다(`sender-health-rules.ts:213-215`). 대시보드에서 빼면 인증 장애로 못 닿은 메일이 보이지 않는다.
  - 최근 하루 이틀은 결과가 확정된 메일이 적어 표본이 작다. 툴팁에 "결과 대기 n"을 보인다.
- **핵심 리드 판정 조건**은 `customer-journey-leads.ts:23-41`과 같다.
  - status ≠ 'skipped', `journeyPriority.version = '1'`, `rankEligible = 'true'`, tier ∈ (urgent, highlight)
  - 레코드가 같은 조직·사업에 있어야 한다.
  - 한 고객이 기간 안에 두 tier를 다 받았으면 긴급으로 센다.
  - 미처리 = 지금 `journey_lead_followups`에 줄이 없거나 status가 'new'(미확인, `lead-followup/types/index.ts:1-3`).
  - 목록(`LeadInbox`)은 읽을 때 `summarizeJourney`로 다시 확인하지만, KPI는 하지 않는다. 그래서 라벨로 기준을 구분한다.
- **방문은 사람 클릭만 본다.** 발송 이력 배지의 `hasSiteAction`은 봇 클릭의 click_id도 본다(표시용, `email-click-signals.ts:11-12`). KPI는 "사람" 지표라서 다르게 간다.

## 4. 데이터 모델

### 4-1. `drizzle/0121_email_stats.sql` (전문)

```sql
-- 0121 이메일 통계 집계 표 (docs/2026-10-21-email-dashboard-stats/DESIGN.md 4절)
-- 새 표 4개만 만든다. email_send_logs 등 기존 표에는 ALTER·FK·색인을 걸지 않는다. 다시 돌아도 같다(IF NOT EXISTS).
-- FK는 organizations(작은 표)에만 건다(email_health_daily 선례). 발송 id에는 FK가 없다(email_replies·email_bounce_signals 관례).
-- 잠금: 새 표 생성과 organizations의 SHARE ROW EXCLUSIVE(잠깐)뿐이다. 5초 안에 못 얻으면 55P03 → migrate.ts가 다시 시도한다.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_stats_send_attr" (
    "send_log_id" integer PRIMARY KEY,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "stat_date" date NOT NULL,
    "workspace_id" integer NOT NULL DEFAULT 0,
    "partition_id" integer NOT NULL DEFAULT 0,
    "trigger_type" varchar(30) NOT NULL DEFAULT '',
    "campaign_kind" varchar(10) NOT NULL,
    "campaign_id" integer NOT NULL DEFAULT 0,
    "root_log_id" integer NOT NULL,
    "step_index" smallint NOT NULL,
    "sender_profile_id" integer NOT NULL DEFAULT 0,
    "sender_domain" varchar(200) NOT NULL DEFAULT '',
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "email_stats_send_attr_kind_chk" CHECK ("campaign_kind" IN ('ai','template','manual'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_stats_send_attr_org_date_idx" ON "email_stats_send_attr" ("org_id", "stat_date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_stats_daily" (
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "grain" varchar(10) NOT NULL,
    "stat_date" date NOT NULL,
    "workspace_id" integer NOT NULL DEFAULT 0,
    "campaign_kind" varchar(10) NOT NULL DEFAULT '',
    "campaign_id" integer NOT NULL DEFAULT 0,
    "step_index" smallint NOT NULL DEFAULT -1,
    "partition_id" integer NOT NULL DEFAULT 0,
    "sender_profile_id" integer NOT NULL DEFAULT 0,
    "sender_domain" varchar(200) NOT NULL DEFAULT '',
    "trigger_type" varchar(30) NOT NULL DEFAULT '',
    "total" integer NOT NULL DEFAULT 0,
    "accepted" integer NOT NULL DEFAULT 0,
    "sent" integer NOT NULL DEFAULT 0,
    "failed" integer NOT NULL DEFAULT 0,
    "pending" integer NOT NULL DEFAULT 0,
    "delivered" integer NOT NULL DEFAULT 0,
    "bounced" integer NOT NULL DEFAULT 0,
    "bounced_hard" integer NOT NULL DEFAULT 0,
    "sender_side" integer NOT NULL DEFAULT 0,
    "nhn_unsub" integer NOT NULL DEFAULT 0,
    "send_reject" integer NOT NULL DEFAULT 0,
    "unconfirmed" integer NOT NULL DEFAULT 0,
    "open_base" integer NOT NULL DEFAULT 0,
    "opened" integer NOT NULL DEFAULT 0,
    "clicked" integer NOT NULL DEFAULT 0,
    "opened_clicked" integer NOT NULL DEFAULT 0,
    "replied" integer NOT NULL DEFAULT 0,
    "auto_replied" integer NOT NULL DEFAULT 0,
    "first_accepted" integer NOT NULL DEFAULT 0,
    "first_sent" integer NOT NULL DEFAULT 0,
    "seq_replied" integer NOT NULL DEFAULT 0,
    "unsubscribed" integer NOT NULL DEFAULT 0,
    "complained" integer NOT NULL DEFAULT 0,
    "visited" integer NOT NULL DEFAULT 0,
    "site_actions" integer NOT NULL DEFAULT 0,
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "email_stats_daily_pkey" PRIMARY KEY ("org_id", "grain", "stat_date", "workspace_id", "campaign_kind", "campaign_id", "step_index", "partition_id", "sender_profile_id", "sender_domain", "trigger_type"),
    CONSTRAINT "email_stats_daily_grain_chk" CHECK ("grain" IN ('total','campaign','partition','sender','trigger'))
) WITH (fillfactor = 80);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_stats_lead_days" (
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "stat_date" date NOT NULL,
    "workspace_id" integer NOT NULL,
    "customer_key" varchar(64) NOT NULL,
    "tier" varchar(10) NOT NULL,
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "email_stats_lead_days_pkey" PRIMARY KEY ("org_id", "stat_date", "workspace_id", "customer_key"),
    CONSTRAINT "email_stats_lead_days_tier_chk" CHECK ("tier" IN ('urgent','highlight'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_stats_state" (
    "org_id" uuid PRIMARY KEY REFERENCES "organizations"("id") ON DELETE CASCADE,
    "first_send_date" date,
    "filled_from" date,
    "backfill_done_at" timestamptz,
    "recent_done_at" timestamptz,
    "nightly_date" date,
    "nightly_next" date,
    "wm_open_id" integer NOT NULL DEFAULT 0,
    "wm_click_id" integer NOT NULL DEFAULT 0,
    "wm_reply_id" integer NOT NULL DEFAULT 0,
    "wm_unsub_id" integer NOT NULL DEFAULT 0,
    "wm_complaint_id" integer NOT NULL DEFAULT 0,
    "last_error" text,
    "last_error_at" timestamptz,
    "manual_refreshed_at" timestamptz,          -- 수동 갱신 쿨다운 (7-8)
    "stats" jsonb,
    "updated_at" timestamptz NOT NULL DEFAULT now()
);
```

- `customer_key`는 이메일의 sha256(`customer-journey-priority.ts:37-39`)이다. 개인정보 원문이 아니다.
- 집계 표에 주소·본문은 없다.

### 4-2. `drizzle/meta/_journal.json` (idx 121 다음)

```json
{ "idx": 122, "version": "7", "when": 1792692000000, "tag": "0121_email_stats", "breakpoints": true }
```

- drizzle은 마지막으로 적용된 when보다 뒤인 것만 적용한다. 그래서 앞 번호 항목 모두보다 when이 커야 한다.
- 기존 `src/lib/email-open-migration.test.ts:26-28`은 "0120이 가장 늦다"를 단정한다. 0121이 생기면 깨진다.
  - 이 단정을 "0120보다 앞 번호의 when은 모두 0120보다 작다"로 완화한다.
  - 0120이 하나뿐이고 when이 `1792605600000`이라는 단정은 그대로 둔다.

### 4-3. 스키마 — `src/lib/db/email-stats-schema.ts` (새 파일)

- 4개 표를 pgTable로 옮긴다. `organizations`는 `./schema`에서 import한다(선례 `customer-sales-schema.ts:16`).
- 날짜 칸은 `date(..., { mode: "string" })`로 둔다.
- PK 이름은 SQL 이름과 맞춘다. 다르면 drizzle-kit이 PK를 다시 만들려 한다(`schema.ts:2191` 주석).
- `src/lib/db/schema.ts`의 export 목록(`:23-44`)에 `export * from "./email-stats-schema";` 한 줄을 더한다.

### 4-4. 크기와 읽기 경로

- **attr**: 발송 1줄 약 60B다. 운영 40만 줄이면 약 30MB이고, 워커만 읽는다.
- **daily**: 조직·날짜당 150~200줄이다. 1년 3개 조직이면 약 20만 줄·40~50MB다 [미확인 — fixture로 확인].
  - 화면은 PK 앞부분(org, grain, 날짜 범위)만 읽는다.
  - fillfactor 80: 최근 8일 줄의 잦은 UPDATE가 같은 페이지 안(HOT)에서 끝나게 한다.
  - INSERT를 grain·날짜 순서로 넣어 같은 묶음 줄이 붙게 한다.
- **lead_days·state**: 작다.

## 5. 귀속 — `email_stats_send_attr`

### 5-1. 칸

| 칸 | 값 |
|---|---|
| stat_date | `(sent_at AT TIME ZONE 'Asia/Seoul')::date` |
| workspace_id | 그 발송 명단의 `partitions.workspace_id`. 없으면 0이다. 회신 귀속과 같다(`email-reply-sync.ts:366-370`). |
| partition_id·trigger_type·sender_profile_id | 그 발송의 값. 없으면 0 또는 '' |
| sender_domain | `lower(split_part(COALESCE(sender_email,''),'@',2))`. 발신 건강과 같은 식이다(`sender-health.ts:365`). |
| campaign_kind·campaign_id | 사슬 첫 메일의 `ruleOf`. manual이면 id에 첫 메일의 `email_template_id`(없으면 0)를 넣는다(이름 표시용). |
| root_log_id·step_index | 사슬 첫 메일 id와 깊이(0 = 첫 메일) |

- 모두 insert 때 정해지고 바뀌지 않는 값이다.
- 발송 갱신은 status와 결과 칸만 쓴다(`email-followup.ts:724-731`, `email-status-sync.ts:641-657`, `email-bounce-signal.ts:128-131`, cancelled 갱신들).
- 그래서 귀속은 한 번만 쓴다(`ON CONFLICT DO NOTHING`).

### 5-2. 상속 규칙 — `resolveAttribution(rows, parents)` (`attribution.ts`, 순수)

```ts
export type CampaignKind = "ai" | "template" | "manual";
export interface SendAttrInput {
    id: number; orgId: string; statDate: string;
    workspaceId: number | null; partitionId: number | null; triggerType: string | null;
    parentLogId: number | null; autoPersonalizedLinkId: number | null; templateLinkId: number | null;
    emailTemplateId: number | null; senderProfileId: number | null; senderDomain: string;
}
export interface ParentAttr { sendLogId: number; orgId: string; rootLogId: number; stepIndex: number; campaignKind: CampaignKind; campaignId: number }
export interface SendAttr { sendLogId: number; orgId: string; statDate: string; workspaceId: number; partitionId: number;
    triggerType: string; campaignKind: CampaignKind; campaignId: number; rootLogId: number; stepIndex: number;
    senderProfileId: number; senderDomain: string }
export function resolveAttribution(rows: readonly SendAttrInput[], parents: ReadonlyMap<number, ParentAttr | "missing">): SendAttr[];
export function isExcludedSend(s: { triggerType: string | null; status: string }): boolean; // 3절 제외의 TS 거울
```

- 입력을 id 오름차순으로 본다. 부모 id는 늘 자식보다 작다.
- 부모가 없으면(parent_log_id NULL) 자기가 첫 메일이다. root는 자기, step은 0, 캠페인은 자기 링크다.
- 부모를 같은 묶음(앞서 계산함)이나 `parents`에서 찾았고 같은 조직이면 물려받는다.
  - root와 캠페인은 부모 것을 쓰고, step은 부모 step + 1이다.
  - 자기 `template_link_id`는 보지 않는다. 템플릿 후속은 자기 행에도 연결 id가 있지만(`email-followup.ts:681`) 캠페인은 첫 메일 기준이다.
- 부모가 "missing"이거나 다른 조직이면 자기가 첫 메일이다. loadChains도 같은 조직만 잇는다(`email-reply-sync.ts:1091`).
- `parents`에 없는 부모 id는 "missing"으로 본다.

### 5-3. 귀속 채우기 — `fillAttribution(conn, orgId, range)` (`attribution-store.ts`)

1. 창에서 귀속이 없는 발송만 읽는다(회차마다 새 발송 수백 줄).
   ```sql
   SELECT l.id, l.parent_log_id, l.auto_personalized_link_id, l.template_link_id, l.email_template_id,
          l.partition_id, p.workspace_id, l.trigger_type, l.sender_profile_id,
          lower(split_part(COALESCE(l.sender_email, ''), '@', 2)) AS sender_domain,
          (l.sent_at AT TIME ZONE 'Asia/Seoul')::date::text AS stat_date
   FROM email_send_logs l LEFT JOIN partitions p ON p.id = l.partition_id
   WHERE l.org_id = $org AND l.sent_at >= $from AND l.sent_at < $to
     AND NOT EXISTS (SELECT 1 FROM email_stats_send_attr a WHERE a.send_log_id = l.id)
   ORDER BY l.id
   ```
2. 묶음 밖 부모 id는 attr에서 찾는다: `WHERE send_log_id = ANY($ids)`.
3. 그래도 없으면 loadChains(`email-reply-sync.ts:1080-1105`)와 같은 사슬로 부모의 root·깊이·첫 메일 링크를 구한다. 백필 초기와 오래된 첫 메일을 둔 후속에서만 돈다.
   ```sql
   WITH RECURSIVE chain AS (
       SELECT l.id AS start_id, l.id, l.parent_log_id, l.org_id, 0 AS depth
       FROM email_send_logs l WHERE l.id = ANY($ids) AND l.org_id = $org
       UNION ALL
       SELECT c.start_id, p.id, p.parent_log_id, p.org_id, c.depth + 1
       FROM chain c JOIN email_send_logs p ON p.id = c.parent_log_id AND p.org_id = c.org_id
       WHERE c.depth < 10                                   -- CHAIN_MAX_DEPTH (email-reply-rules.ts:90)
   )
   SELECT DISTINCT ON (c.start_id) c.start_id, c.id AS root_id, c.depth,
          r.auto_personalized_link_id, r.template_link_id, r.email_template_id
   FROM chain c JOIN email_send_logs r ON r.id = c.id
   ORDER BY c.start_id, c.depth DESC
   ```
   - 찾지 못한 부모는 "missing"이다.
   - 부모의 ParentAttr = { root: root_id, step: depth, 캠페인: 첫 메일 링크의 ruleOf }다.
4. `resolveAttribution`의 결과를 1천 줄씩 `jsonb_to_recordset` + `ON CONFLICT (send_log_id) DO NOTHING`으로 넣는다(`applyNhnStatuses`와 같은 방식, `email-status-sync.ts:629-633`).

### 5-4. loadChains와 같은 점과 다른 점 (B2)

- **같다**: 깊이 10 이하 사슬에서 root, 깊이, `ruleOf(root)`의 kind와 id(ai·template).
- **다르다**(알고 둔다):
  1. 깊이 10을 넘는 사슬: loadChains는 10에서 끊고 그 조상을 root로 본다. 귀속은 진짜 첫 메일까지 간다 [미확인 — 운영에는 없다고 본다].
  2. 규칙을 지우면 FK가 발송 칸을 NULL로 바꾼다(`schema.ts:730-733,749-752`).
     - 귀속은 지우기 전 값을 지키므로 "(삭제됨)"으로 보인다(B21).
     - 회신 귀속은 지운 뒤에 다시 읽으면 manual로 본다.
  3. manual: ruleOf의 id는 null이지만, 귀속은 템플릿 id를 넣는다(이름용). 대조에서는 manual의 kind만 비교한다.

## 6. 일별 재계산 — `recomputeRange(conn, orgId, { from, to })`

순서는 귀속 채우기 → 메일 집계 문장 → 핵심 리드 문장이다. 셋 모두 같은 예약 연결에서 돈다.

### 6-1. 메일 집계 문장 (`sql.ts`가 조립, `rollup.ts`가 실행)

```sql
WITH s AS (       -- ① 창의 발송. 별칭 없이 읽어 기존 조각을 그대로 쓴다
    SELECT email_send_logs.id, email_send_logs.status, email_send_logs.trigger_type, email_send_logs.request_id,
           email_send_logs.nhn_status_code, email_send_logs.delivery_fail_source, email_send_logs.delivery_fail_side,
           email_send_logs.delivery_status_code,
           (${accepted}) AS accepted,                                         -- acceptedSendConditionSql() 주입
           (${openBaseSql("email_send_logs")}) AS open_base,
           (${openedSendSql("email_send_logs", { orgId, since: fromIso })}) AS opened
    FROM email_send_logs
    WHERE email_send_logs.org_id = $org AND email_send_logs.sent_at >= $fromIso AND email_send_logs.sent_at < $toIso
),
hc  AS (SELECT c.send_log_id, c.click_id FROM email_click_logs c
        WHERE c.org_id = $org AND c.is_bot = false AND c.clicked_at >= $fromIso),
vis AS (SELECT hc.send_log_id,
               bool_or(EXISTS (SELECT 1 FROM tracker_events te WHERE te.session_id = ts.id AND te.event_type IN ('CLICK','CUSTOM'))) AS acted
        FROM hc JOIN tracker_sessions ts ON ts.click_id = hc.click_id
                JOIN tracker_sites st ON st.id = ts.site_id AND st.org_id = $org
        GROUP BY hc.send_log_id),
rep AS (SELECT r.send_log_id, bool_or(r.kind = 'human') AS human, bool_or(r.kind = 'auto_reply') AS auto
        FROM email_replies r
        WHERE r.org_id = $org AND r.match_status = 'matched' AND r.kind IN ('human','auto_reply')
          AND r.send_log_id IS NOT NULL AND r.received_at >= $fromIso
        GROUP BY r.send_log_id),
seq AS (SELECT DISTINCT COALESCE(r.root_log_id, ra.root_log_id) AS root_id   -- 회신 sync가 남긴 root 우선
        FROM email_replies r LEFT JOIN email_stats_send_attr ra ON ra.send_log_id = r.send_log_id
        WHERE r.org_id = $org AND r.match_status = 'matched' AND r.kind = 'human' AND r.received_at >= $fromIso),
uns AS (SELECT DISTINCT u.send_log_id FROM email_unsubscribes u
        WHERE u.org_id = $org AND u.source IN ('link','one_click') AND u.send_log_id IS NOT NULL),
cmp AS (SELECT DISTINCT b.send_log_id FROM email_bounce_signals b
        WHERE b.org_id = $org AND b.kind = 'complaint' AND b.send_log_id IS NOT NULL AND b.received_at >= $fromIso),
f AS (            -- ② 귀속·갈래·반응. 별칭 l = HEALTH_CATEGORY_SQL의 약속
    SELECT a.stat_date, a.workspace_id, a.partition_id, a.trigger_type, a.campaign_kind, a.campaign_id, a.step_index,
           a.sender_profile_id, a.sender_domain, l.status, l.accepted, l.open_base, l.opened, l.delivery_status_code,
           (${HEALTH_CATEGORY_SQL}) AS cat,
           l.id IN (SELECT send_log_id FROM hc) AS clicked,
           v.send_log_id IS NOT NULL AS visited, COALESCE(v.acted, false) AS acted,
           COALESCE(rep.human, false) AS replied, COALESCE(rep.auto, false) AS auto_replied,
           l.id IN (SELECT root_id FROM seq) AS seq_hit,
           l.id IN (SELECT send_log_id FROM uns) AS unsubscribed,
           l.id IN (SELECT send_log_id FROM cmp) AS complained
    FROM s l
    JOIN email_stats_send_attr a ON a.send_log_id = l.id AND a.org_id = $org AND a.stat_date BETWEEN $d1 AND $d2
    LEFT JOIN vis v ON v.send_log_id = l.id
    LEFT JOIN rep ON rep.send_log_id = l.id
    WHERE NOT (COALESCE(l.trigger_type,'') LIKE 'test%' OR COALESCE(l.trigger_type,'') = 'journey_demo'
               OR l.status IN ('demo','cancelled'))                              -- EXCLUDED_SQL
),
agg AS (          -- ③ 5묶음을 한 번에
    SELECT CASE WHEN GROUPING(campaign_kind) = 0 THEN 'campaign' WHEN GROUPING(partition_id) = 0 THEN 'partition'
                WHEN GROUPING(sender_profile_id) = 0 THEN 'sender' WHEN GROUPING(trigger_type) = 0 THEN 'trigger'
                ELSE 'total' END AS grain,
           stat_date, workspace_id,
           COALESCE(campaign_kind,'') AS campaign_kind, COALESCE(campaign_id,0) AS campaign_id, COALESCE(step_index,-1) AS step_index,
           COALESCE(partition_id,0) AS partition_id, COALESCE(sender_profile_id,0) AS sender_profile_id,
           COALESCE(sender_domain,'') AS sender_domain, COALESCE(trigger_type,'') AS trigger_type,
           count(*)::int AS total,
           count(*) FILTER (WHERE accepted)::int AS accepted,
           count(*) FILTER (WHERE status = 'sent')::int AS sent,
           count(*) FILTER (WHERE status IN ('failed','rejected'))::int AS failed,
           count(*) FILTER (WHERE status IN ('pending','uncertain'))::int AS pending,
           count(*) FILTER (WHERE cat = 'success')::int AS delivered,
           count(*) FILTER (WHERE cat IN ('failed','dsn_only'))::int AS bounced,
           count(*) FILTER (WHERE cat IN ('failed','dsn_only') AND delivery_status_code LIKE '5%')::int AS bounced_hard,
           count(*) FILTER (WHERE cat = 'sender_side')::int AS sender_side,
           count(*) FILTER (WHERE cat = 'nhn_unsub')::int AS nhn_unsub,
           count(*) FILTER (WHERE cat = 'send_reject')::int AS send_reject,
           count(*) FILTER (WHERE cat = 'unknown')::int AS unconfirmed,
           count(*) FILTER (WHERE open_base)::int AS open_base,
           count(*) FILTER (WHERE opened)::int AS opened,
           count(*) FILTER (WHERE clicked)::int AS clicked,
           count(*) FILTER (WHERE open_base AND clicked)::int AS opened_clicked,
           count(*) FILTER (WHERE replied)::int AS replied,
           count(*) FILTER (WHERE auto_replied)::int AS auto_replied,
           count(*) FILTER (WHERE step_index = 0 AND accepted)::int AS first_accepted,
           count(*) FILTER (WHERE step_index = 0 AND status = 'sent')::int AS first_sent,
           count(*) FILTER (WHERE step_index = 0 AND status = 'sent' AND seq_hit)::int AS seq_replied,
           count(*) FILTER (WHERE unsubscribed)::int AS unsubscribed,
           count(*) FILTER (WHERE complained)::int AS complained,
           count(*) FILTER (WHERE visited)::int AS visited,
           count(*) FILTER (WHERE acted)::int AS site_actions
    FROM f
    GROUP BY GROUPING SETS ((stat_date, workspace_id),
                            (stat_date, workspace_id, campaign_kind, campaign_id, step_index),
                            (stat_date, workspace_id, partition_id),
                            (stat_date, workspace_id, sender_profile_id, sender_domain),
                            (stat_date, workspace_id, trigger_type))
),
cur AS (SELECT * FROM email_stats_daily d
        WHERE d.org_id = $org AND d.grain IN ('total','campaign','partition','sender','trigger') AND d.stat_date BETWEEN $d1 AND $d2),
changed AS (SELECT a.* FROM agg a LEFT JOIN cur d USING (grain, stat_date, workspace_id, campaign_kind, campaign_id,
                                                         step_index, partition_id, sender_profile_id, sender_domain, trigger_type)
            WHERE d.org_id IS NULL OR (a.total, …25칸) IS DISTINCT FROM (d.total, …25칸)),
ins AS (INSERT INTO email_stats_daily (org_id, …키 10칸, …25칸, updated_at)
        SELECT $org, …, now() FROM changed ORDER BY grain, stat_date, workspace_id, …
        ON CONFLICT ON CONSTRAINT email_stats_daily_pkey DO UPDATE SET total = EXCLUDED.total, …, updated_at = EXCLUDED.updated_at
        RETURNING 1),
del AS (DELETE FROM email_stats_daily d
        WHERE d.org_id = $org AND d.grain IN ('total','campaign','partition','sender','trigger') AND d.stat_date BETWEEN $d1 AND $d2
          AND NOT EXISTS (SELECT 1 FROM agg a WHERE (a.grain, a.stat_date, a.workspace_id, …키) = (d.grain, d.stat_date, d.workspace_id, …키))
        RETURNING 1)
SELECT (SELECT count(*) FROM ins)::int AS written, (SELECT count(*) FROM del)::int AS deleted;
```

### 6-2. 문장 규칙

- `sql.ts`는 `@/lib/db`를 import하지 않는다. 순수 테스트가 불러야 하기 때문이다.
  - `email-send-log-status.ts`는 db를 import한다. 그래서 `accepted` 조각은 `rollup.ts`가 `acceptedSendConditionSql()`을 넘겨 주입한다.
  - 발송 경로가 쓰는 그 파일은 고치지 않는다.
- `s`는 별칭 없이 `email_send_logs`를 읽는다.
  - `acceptedSendConditionSql()`은 칸을 `"email_send_logs"."status"` 꼴로 그리고, `openedSendSql("email_send_logs", …)`도 표 이름을 쓴다. 별칭이 있으면 둘 다 깨진다.
  - 바깥 `f`에서 별칭 `l`을 붙여 `HEALTH_CATEGORY_SQL`을 쓴다. 그래서 `email-open-sql.ts`는 바꿀 필요가 없다.
- 귀속과는 inner join이다. 귀속 채우기와 집계 사이에 들어온 발송은 다음 회차에 들어간다. 모든 묶음에서 똑같이 빠지므로 B5가 유지된다.
- 실행: `new PgDialect().sqlToQuery(fragment)` → `conn.unsafe(sql, params)`(조각 렌더링은 `email-open-sql.test.ts`와 같은 방식). 조직 id·날짜는 매개변수로만 넘긴다.
- 사라진 조합은 지운다. 예를 들어 후속이 cancelled가 되어 그 캠페인·단계 조합이 0이 되면 줄을 지운다. 0인 줄은 남기지 않는다.

### 6-3. 불변식 (B5)

- 같은 (org, 날짜, 워크스페이스)에서 각 grain의 줄을 다 더하면 total 줄과 같다. 25칸 모두 성립한다.
- KPI·추세·비교 표는 모두 이 표의 합이다.

### 6-4. 핵심 리드 문장 (`leads.ts`)

```sql
WITH src AS (
    SELECT (a.created_at AT TIME ZONE 'Asia/Seoul')::date AS stat_date, a.workspace_id,
           a.message->'journeyPriority'->>'customerKey' AS customer_key,
           CASE WHEN bool_or(a.message->'journeyPriority'->>'tier' = 'urgent') THEN 'urgent' ELSE 'highlight' END AS tier
    FROM customer_journey_alerts a
    JOIN workspaces w ON w.id = a.workspace_id AND w.org_id = a.org_id
    JOIN records r ON r.id = a.record_id AND r.org_id = a.org_id AND r.workspace_id = a.workspace_id
    WHERE a.org_id = $org AND a.created_at >= $fromIso AND a.created_at < $toIso AND a.status <> 'skipped'
      AND a.message->'journeyPriority'->>'version' = '1' AND a.message->'journeyPriority'->>'rankEligible' = 'true'
      AND a.message->'journeyPriority'->>'tier' IN ('urgent','highlight')
    GROUP BY 1, 2, 3
)  -- 이후 6-1과 같은 changed → ins → del (키: stat_date, workspace_id, customer_key / 값: tier)
```

### 6-5. 쓰기 0 (B6)

- 바뀐 줄이 없으면 INSERT·DELETE에 가는 줄이 없고, 행 잠금도 없다. daily·lead_days·attr 모두 해당한다.
- state의 한 줄(asOf)만 회차마다 바뀐다. 신선도를 보이기 위해서다.

## 7. 워커

### 7-1. 회차 흐름 — `runEmailStats(opts)` (`worker.ts`)

1. 예약 연결 1개(`queryClient.reserve()`)를 잡고 `pg_try_advisory_lock(0x5c4edf18)`을 시도한다. 못 잡으면 `{ skipped: "locked" }`.
2. 같은 연결에 `SET statement_timeout = '120s'`, `SET lock_timeout = '5s'`.
3. `SEND_LOG_INDEXES_READY_SQL`(`send-log-indexes.ts:40-48`)이 2 미만이면 `{ skipped: "index_pending" }`. 큰 표를 통째로 훑지 않으려는 것이다(`sender-health.ts:182-186`과 같다).
4. 조직 목록은 `SELECT org_id FROM email_configs UNION SELECT org_id FROM email_stats_state`.
5. 조직마다 다음을 한다. 오류는 조직 안에서 잡아 `last_error`에 남기고 다음 조직으로 간다.
   - state가 없으면 만든다(7-7).
   - 최근 8일을 다시 센다.
   - asOf를 적는다.
6. 야간이 할 때면, 조직마다 늦은 이벤트를 먼저 처리하고 9~35일째를 3일 조각으로 센다.
7. 백필이 할 때면, 조직마다 2일 조각으로 채우고 조각 사이에 300ms 쉰다.
8. 6·7은 회차 예산 120초 안에서만 새 조각을 시작한다. 남은 일은 다음 회차가 이어 한다.
9. finally에서 설정 두 개를 RESET하고, 잠금을 풀고, 연결을 돌려준다.
   - 로그는 한 줄이다: `[email-stats] orgs=… recent=…/… nightly=… backfill=… ms=…`
   - 오류는 `describeReplyError`로 짧게 남긴다(매개변수·주소 없음).

```ts
type StatsConn = Pick<postgres.Sql, "unsafe">;   // 예약 연결·시험 연결이 같이 맞는다
export interface EmailStatsRunStats {
    orgs: number; errors: number; durationMs: number; skipped?: "locked" | "index_pending" | "off";
    recent: { attrInserted: number; written: number; deleted: number };
    nightly: { orgs: number; days: number; lateDays: number };
    backfill: { days: number; doneOrgs: number };
}
export async function runEmailStats(opts?: { now?: Date; env?: Record<string, string | undefined>; force?: "nightly"; budgetMs?: number }): Promise<EmailStatsRunStats>;
export async function recomputeRange(conn: StatsConn, orgId: string, range: { from: string; to: string }): Promise<{ attrInserted: number; written: number; deleted: number }>;
```

### 7-2. 창과 시각 (T = KST 오늘, 모두 `rules.ts`)

| 일 | 창 | 언제 |
|---|---|---|
| 최근 | T-7 ~ T (8일) | 매 회차. 기본 15분이고 `EMAIL_STATS_INTERVAL_MS`로 바꾼다. |
| 늦은 이벤트 | T-35 이전 중 워터마크로 찾은 날 | 야간 시작 때, 창보다 먼저 |
| 야간 | T-34 ~ T-8 (27일), 3일 조각 | `nightlyDue` = nightly_date < T AND KST 01시 이후 AND 발송 창 밖. 서버가 밤에 꺼져 있었으면 그날 18시 뒤에 돈다. |
| 백필 우선 | filled_from이 T-59보다 늦은 동안 | 언제든 |
| 백필 나머지 | 첫 발송 날짜까지 | 발송 창 밖(`isBusinessHours`가 거짓, `src/lib/kst.ts:84-88`) |

- 근거: 결과 동기화의 첫 창이 8일이고(`schema.ts:2204-2205`), 반송 짝짓기가 7일이다(`email-bounce-signal.ts:67`). 최근 8일 창이 둘 다 덮는다.
- filled_from보다 이른 날은 야간·늦은 이벤트에서 건너뛴다. 그 날은 백필이 센다.

### 7-3. 워터마크 (B8)

- state에 조직별로 `wm_open_id`·`wm_click_id`·`wm_reply_id`·`wm_unsub_id`·`wm_complaint_id`를 둔다.
- state를 만들 때 각 표의 현재 `max(id)`로 시작한다. 그 전 이벤트는 백필이 원본에서 센다.
- 야간 시작 때 할 일:
  1. 각 표의 max(id)를 스냅숏한다.
  2. (wm, 스냅숏] 사이의 이벤트를 모은다: 사람 오픈, 사람 클릭, matched human·auto_reply 회신, link·one_click 수신거부, complaint.
  3. 이벤트를 발송 귀속 날짜로 바꾼다. 회신은 시퀀스 root의 날짜(`COALESCE(r.root_log_id, attr.root_log_id)`)도 넣는다.
  4. T-35 이전이면서 filled_from 이후인 날만 남긴다.
  5. 이어진 날짜는 묶어(`mergeDateRanges`) 다시 센다.
  6. wm을 스냅숏 값으로 옮긴다.
- 창 재계산보다 먼저 하는 이유: 창을 도는 동안 온 이벤트는 스냅숏 뒤 id라 다음 밤에 잡힌다. 순서를 바꾸면 창의 가장 오래된 날에 빈틈이 생긴다.
- 한계: 커밋 순서가 id 순서와 뒤집힌 줄은 빠질 수 있다. 35일 넘은 발송의 늦은 이벤트에만 해당하고, 극히 드물다.
- 따라가지 않는 것: 35일 넘은 발송의 sent→failed, 회신 분류·짝 변경, 수신거부 삭제.

### 7-4. 백필 (B9)

- 커서는 하나다. `filled_from` = "이 날부터 오늘까지 이어서 집계됨". 첫 회차가 T-7로 둔다.
- 다음 조각은 `[max(first_send_date, filled_from-2), filled_from-1]`이다. 조각을 커밋하면 filled_from을 조각 시작으로 옮긴다.
- 최신에서 과거로 가므로 채운 구간이 늘 이어진다. 그래서 coverage를 한 줄로 표현할 수 있다.
- filled_from ≤ first_send_date(또는 발송 없음)이면 끝이다. backfill_done_at을 적고, coverage.from은 null(처음부터 모두)이 된다.
- 배포·오류·예산으로 중단되면 커서에서 이어 한다. 조각은 멱등이라 한 번 더 돌아도 결과가 같다.
- 과거로 가므로 후속의 부모에 아직 귀속이 없는 경우가 많다. 이때 5-3의 사슬 보충이 돈다(한 번뿐, 나머지는 발송 창 밖).

### 7-5. 잠금·시간 제한·실패 격리 (B10)

- advisory 키 `0x5c4edf18`. `0x5c4edf01~14·16·17`은 이미 쓰고 있다(grep 2026-10-21).
- 예약 연결 1개만 쥔다. 풀은 20개다(`src/lib/db/index.ts:15-21`).
- `statement_timeout 120s`. 조각 문장은 수 초를 예상한다. 넘으면 57014가 나고, 그 조직의 오류로 남긴 뒤 다음 회차에 다시 한다.
- `lock_timeout 5s`. 집계 표만 쓰므로 경합은 없고, 안전장치다.
- 발송 경로와 겹치는 것은 큰 표 읽기뿐이다. MVCC 읽기라 쓰기를 막지 않는다.
- 회차는 완료 뒤에 다음 회차를 예약하므로 겹치지 않는다. 실패해도 다음 회차가 온다(`customer-journey-scheduler.ts:23-50`).
- 집계 표가 아직 없으면(마이그레이션 전) 42P01이 난다. 로그 한 줄만 남기고 다음 회차에 다시 한다.

### 7-6. 실행 위치·켜고 끄기·sendb-dev

- `src/lib/email-stats/scheduler.ts`의 `startEmailStatsScheduler()`
  - globalThis로 프로세스당 한 번만 시작한다(`__sendbEmailStatsScheduler`).
  - 첫 회차는 30초 뒤다. 이후에는 완료 뒤 `EMAIL_STATS_INTERVAL_MS`(기본 900000, 60000~3600000)를 기다린다.
- `createJourneyScheduler`를 쓴다.
  - 지금은 결과 타입·간격·실패 문구가 고객 여정용으로 박혀 있다.
  - 그래서 제네릭 `<T = JourneyAlertStats>`와 선택 옵션 `intervalMs`·`firstDelayMs`·`failureLabel`을 더한다.
  - 기본값은 지금 값이라 고객 여정 동작과 테스트는 그대로다.
- 켜기 조건(`emailStatsSchedulerEnabled(env)`): `EMAIL_STATS_WORKER`가 on이면 켜고, off면 끈다. 비어 있으면 `NODE_ENV === "production"`일 때 켠다.
- `src/instrumentation.ts`: `void ensureSendLogIndexes();`(:18) 다음, sendb-dev 조기 반환(:20-23) **앞**에 한 줄을 넣는다.
  - 이 집계는 외부 효과(발송·AI·웹훅)가 없어 체험 서버에서도 돌린다.
  - 체험 서버에서는 개발 DB(운영 복사본)를 한 번 백필한다. 끄려면 `EMAIL_STATS_WORKER=off`.
- POST `/api/analytics/email-stats/process`(CRON_SECRET)도 같은 `runEmailStats()`를 부른다.
  - `?force=nightly`면 시각 조건 없이 야간 일을 한다(복구용).
  - CloudType 등록은 필요 없다. 예비 경로일 뿐이다.

### 7-7. state 쓰기 규칙

- **만들 때**
  - `first_send_date` = 조직 `min(sent_at)`의 KST 날짜. (org_id, sent_at) 색인으로 빠르다.
  - 워터마크 = 각 표의 max(id)
- **최근 재계산 성공**
  - `recent_done_at` = 그 조직 재계산 직전 시각(asOf)
  - `filled_from` = `least(coalesce(filled_from, T-7), T-7)`
  - `last_error` = null
- **야간**: 진행 중에는 `nightly_next`에 다음 날짜를 적는다. 끝나면 `nightly_date = T`, `nightly_next = null`.
- **오류**: `last_error`(짧게), `last_error_at`.
- **coverage 계산**(API): `{ from: backfill_done_at ? null : filled_from, to: KST 날짜(recent_done_at) }`. state가 없으면 null이다.

### 7-8. 비용 예상 (14절 fixture로 확정한다)

| 일 | 읽는 것 | 예상 |
|---|---|---|
| 최근 8일, 가장 큰 조직 | 운영 약 1.5만 발송 → heap 6~8천 블록(대개 캐시) + 작은 표들 | 데운 상태 1~3초, 콜드 6~8초 |
| 야간, 전체 조직 | 27일 약 6만 발송 → 콜드 2.5만 블록 | 30초~1분 |
| 백필, 전체 | 748MB 한 번 + 사슬 보충 | 2~5분, 발송 창 밖 |

### 7-8. 수동 갱신 — POST `/api/analytics/email-stats/refresh` (2026-10-21 추가, B31)

- 사용자 결정: 자동 주기를 15분으로 늦추는 대신 화면에 "지금 갱신" 버튼을 둔다.
- 권한: `getUserFromNextRequest`, `role === "member"`면 403. 자기 조직만 계산한다(본문으로 조직·기간을 받지 않는다).
- 범위: 그 조직의 오늘·어제(T-1~T)만 `recomputeRange`로 다시 센다. 백필·야간 일은 하지 않는다.
- 쿨다운: `email_stats_state.manual_refreshed_at`(timestamptz, null 허용 — 0121에 칸 추가)이 5분 안이면 429 `{ success:false, error:"N분 뒤 다시 갱신할 수 있습니다." , retryAfterSec }`.
- 동시성: 워커와 같은 advisory 잠금(`0x5c4edf18`)을 `pg_try_advisory_lock`으로 시도한다. 못 잡으면(워커 회차 중) 202 `{ success:true, data:{ queued:false, running:true } }` — 화면은 "집계 중입니다, 잠시 뒤 반영됩니다"를 보인다. 잡으면 `manual_refreshed_at`을 먼저 적고(같은 조직 동시 클릭 막기) 계산한 뒤 asOf를 갱신하고 200 `{ success:true, data:{ asOf } }`.
- 색인 준비: 이메일 필수 색인 2개와 `records_org_created_at_idx`가 **모두** valid가 아니면 503 `{ success:false, error:"집계 준비 중입니다. 잠시 뒤 다시 눌러 주세요." }`를 주고 쿨다운은 적지 않는다. 배포 직후 몇 분만 해당하므로 부분 계산 경로를 두지 않는다. (2026-10-21 Codex 질문으로 확정)
- 시간 제한: 같은 `statement_timeout 120s`. 실패하면 500 한국어 오류, 쿨다운은 그대로 둔다(연타 방지).
- 화면: KPI 카드 위 "집계 기준 HH:MM" 옆 버튼. 누르는 동안 비활성·스피너, 성공하면 세 섹션 SWR `mutate()`. 로직은 `hooks/useEmailStatsRefresh.ts`(상태·핸들러), `api/emailStatsApi.ts`(fetch)에 둔다.
- 파일: `src/app/api/analytics/email-stats/refresh/route.ts`, `src/lib/email-stats/manual-refresh.ts`(쿨다운 판정 순수 함수 `manualRefreshDecision(lastAt, now)` — TDD).
- 실행 위치(D8 재확인): 정기 회차는 `src/instrumentation.ts`가 띄우는 서버 안 스케줄러(기존 13개 스케줄러와 같은 자리)다. 버튼도 같은 프로세스가 처리한다.

## 8. API 계약 — GET `/api/analytics/email-stats`

### 8-1. 요청과 검증

- 매개변수
  - `view`: kpi | trend | compare (필수)
  - `from`·`to`: YYYY-MM-DD, KST, 양 끝 포함
  - `workspaceId`: 양의 정수(선택). 없으면 조직 전체를 센다.
  - `axis`: campaign(기본) | step | partition | sender | domain | trigger | date (compare만)
- 인증은 `getUserFromNextRequest`. 없으면 401 "인증이 필요합니다." 역할 제한은 두지 않는다(Q3).
- `parseStatsQuery(sp, now)`(`query.ts`, 순수)가 검증한다. 반환은 판별 union이다: 성공 `{ ok: true, view, from, to, days, workspaceId, axis }`(axis는 compare일 때만 의미, 기본 `campaign`), 실패 `{ ok: false, error }`(이 절의 한국어 문구). (2026-10-21 Codex 질문으로 확정)
  - 날짜 형식·실재(`isValidYmd`, `tracker/date-range.ts:66-71`)와 from ≤ to → 아니면 "조회 기간의 시작일과 종료일을 확인해 주세요."
  - to ≤ KST 오늘 → 아니면 "오늘 이후 날짜는 볼 수 없습니다."
  - 길이 ≤ 366일 → 아니면 "조회 기간은 366일까지입니다."
  - view·axis·workspaceId 형식 → 아니면 "보기 종류를 확인해 주세요." / "비교 축을 확인해 주세요." / "워크스페이스를 확인해 주세요."
- 워크스페이스가 조직 소속인지 `SELECT 1 FROM workspaces WHERE id = $ws AND org_id = $org`로 본다. 아니면 400 "워크스페이스를 확인해 주세요."(B15). 숨긴 워크스페이스도 소속이면 받는다.
- 직전 기간은 `previousRange(from, to)`(`tracker/date-range.ts:49-57`)로 구한다.
- 서버 오류는 500 "이메일 통계를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
- 응답은 `{ success: true, data }`다.

### 8-2. 타입 (`src/components/email/dashboard/types/index.ts`, lib는 type만 import — 선례 `lib/tracker/comparison.ts:3`)

- 이 타입 파일은 U9가 아니라 **U1에서 먼저** 만든다(U1의 metrics·query가 쓴다). 런타임 값(`STAT_COUNT_KEYS` 같은 키 배열)은 lib가 type만 import하므로 `src/lib/email-stats/metrics.ts`에 둔다. (2026-10-21 Codex 질문으로 확정)

```ts
export const STAT_COUNT_KEYS = ["total","accepted","sent","failed","pending","delivered","bounced","bouncedHard",
  "senderSide","nhnUnsub","sendReject","unconfirmed","openBase","opened","clicked","openedClicked","replied",
  "autoReplied","firstAccepted","firstSent","seqReplied","unsubscribed","complained","visited","siteActions"] as const;
export type StatCounts = Record<(typeof STAT_COUNT_KEYS)[number], number>;
export interface StatRates { deliveryRate: number | null; bounceRate: number | null; senderSideRate: number | null;
  openRate: number | null; clickRate: number | null; ctor: number | null; replyRate: number | null;
  replyRatePerSend: number | null; unsubscribeRate: number | null; visitRate: number | null }   // % 소수 첫째 자리
export type CompareAxis = "campaign" | "step" | "partition" | "sender" | "domain" | "trigger" | "date";
export type CoverageStatus = "full" | "partial" | "none";
export interface StatsEnvelope {
  range: { from: string; to: string; days: number };
  comparison: { from: string; to: string };
  asOf: string | null;                                  // ISO. 그 조직 최근 재계산 시각
  coverage: { from: string | null; to: string } | null; // from null = 처음부터 모두
  connections: { reply: boolean; site: boolean; journey: boolean };
}
export type KpiKey = "sent" | "deliveryRate" | "openRate" | "clickRate" | "visits" | "replyRate" | "keyLeads" | "unsubscribeRate";
export interface KpiValue { value: number | null; comparison: number | null; deltaPct: number | null }
export interface KpiData extends StatsEnvelope {
  current: StatCounts; previous: StatCounts; rates: StatRates;
  currentCoverage: CoverageStatus; previousCoverage: CoverageStatus;
  leads: { total: number; urgent: number; highlight: number; unhandled: number; previousTotal: number };
  kpi: Record<KpiKey, KpiValue>;
}
export interface TrendData extends StatsEnvelope {
  points: Array<{ date: string; counts: StatCounts; rates: StatRates; ready: boolean; maturing: boolean }>;
}
export interface CompareRow { key: string; label: string; sublabel: string | null; deleted: boolean; counts: StatCounts; rates: StatRates }
export interface CompareData extends StatsEnvelope {
  axis: CompareAxis; replyBasis: "sequence" | "perSend"; currentCoverage: CoverageStatus;
  rows: CompareRow[]; total: CompareRow; restCount: number;
}
```

### 8-3. view=kpi

- 읽는 것
  - total grain 한 문장: 직전 시작부터 현재 끝까지 읽고, `stat_date >= 현재 시작`으로 둘로 나눈다. 같은 스냅숏이다.
  - lead_days: 두 기간의 고유 (workspace, customer_key) 수와 tier.
  - `journey_lead_followups`: 미처리 수(작은 표, unique (org, ws, customer_key)).
  - state 1줄, workspaces·tracker_sites(연동 여부).
- `kpi`의 값
  - sent·visits·keyLeads는 수다.
  - 나머지는 %다. deltaPct는 반올림 전 비율로 계산한다.
  - previousCoverage가 full이 아니면 모든 deltaPct는 null이다.

### 8-4. view=trend

- 현재 기간의 모든 날짜를 0으로 채워 돌려준다.
- `ready`는 coverage 안의 날이다. `maturing`은 T-2 이후(최근 3일)다.

### 8-5. view=compare

- 축 → (읽는 grain, 묶는 칸)
  - campaign → (campaign, kind+id)
  - step → (campaign, step_index)
  - partition → (partition, partition_id)
  - sender → (sender, sender_profile_id)
  - domain → (sender, sender_domain)
  - trigger → (trigger, trigger_type)
  - date → (total, stat_date)
  - 칸 이름은 닫힌 표에서만 `sql.raw`로 넣는다.
- 기본 정렬은 accepted 내림차순이다. 500줄까지 주고, 나머지는 "그 밖 n개" 한 줄로 합쳐 합계를 지킨다(B5).
- `total`은 total grain의 합이다(= KPI 현재 값).
- `replyBasis`는 step·trigger 축이면 perSend, 그 밖이면 sequence다.
- 이름은 `names.ts`가 작은 표에서 가져온다. id를 모아 `= ANY`로 한 번에 읽고, 조직 조건을 단다.

| 축 | 이름 | 보조 | 없을 때 |
|---|---|---|---|
| campaign | ai → `email_auto_personalized_links.name`, template → `email_template_links.name`, manual → `email_templates.name` 또는 "수동 발송" | 종류, AI 규칙의 제품 이름 | "(삭제됨)", deleted true |
| step | `stepLabel(n, null, null)` ("첫 메일"·"n번째 후속", `email-reply-rules.ts:1578-1583`) | — | — |
| partition | `partitions.name`. 사업이 둘 이상이면 앞에 "[사업]" | — | 0이면 "명단 없음", 지워졌으면 "(삭제됨)" |
| sender | `email_sender_profiles.from_email` | 프로필 이름 | 0이면 "기본 주소(프로필 없음)", 지워졌으면 "(삭제됨)" |
| domain | 도메인 | — | ''이면 "(주소 기록 없음 — 0073 이전)" |
| trigger | 수동 발송·자동 발송·반복 발송·AI 자동발송·후속 발송·AI 후속발송·방문 감사 메일 | — | ''이면 "기타" |
| date | YYYY-MM-DD (요일) | — | — |

### 8-6. POST `/api/analytics/email-stats/process`

- 인증은 `x-secret`·Bearer·`?secret` 중 하나를 `CRON_SECRET`과 비교한다(`email/send-health/process/route.ts:11-23`과 같은 모양).
  - CRON_SECRET이 없으면 500, 틀리면 401이다.
- `?force=nightly`는 선택이다.
- 응답은 `{ success: true, data: EmailStatsRunStats }`다.

## 9. 홈 3라우트 (B26)

| 라우트 | 이메일 부분 (새로) | 그대로 |
|---|---|---|
| summary | `email`은 total grain 합(total·sent·failed·pending·clicked·clickRate·opened·openBase·openRate). `triggerBreakdown`은 trigger grain(''이면 'unknown') | alimtalk, newRecordsInPeriod (9-2 분기) |
| trends | 날짜별 total grain: emailSent = sent, emailFailed = failed, emailClicked = clicked, emailOpened = opened | alimtalkSent·Failed (분기) |
| templates | campaign grain에서 kind ai·template만 단계를 합친다. type은 link·ai_auto, name은 연결 이름 / "AI: " + AI 규칙 이름. 지워졌으면 "(삭제됨)" | 알림톡 템플릿 이름별 (분기) |

- **계산식**: 지금 코드의 반올림을 그대로 쓴다.
  - clickRate = sent > 0 ? round(clicked/sent×1000)/10 : 0
  - successRate(summary) = round(sent/total×1000)/10
  - successRate(templates) = round(sent/total×100)
  - openRate = `openRatePercent`
- **모양**: 응답 키와 타입은 그대로다(`useAnalytics.ts:4-40` 타입 유지).
- **바뀌는 숫자**
  - 날짜를 KST로 센다.
  - 시험·데모·취소를 뺀다.
  - 규칙별에 후속을 포함한다.
  - AI 줄의 이름이 "AI: 명단 이름"에서 "AI: 규칙 이름"으로 바뀐다.
  - summary의 `email.pending`에 `uncertain`(결과 미확정)이 더해진다.
- **날짜 해석**: startDate·endDate를 KST 날짜로 읽는다(`kstDayBounds`). 형식이 틀리면 400 "startDate, endDate는 YYYY-MM-DD 형식이어야 합니다."로 답한다(지금은 500).
- **알림톡·레코드**: 질의 모양은 그대로 두고 같은 KST 경계를 쓴다. trends의 알림톡 날짜도 `(sent_at AT TIME ZONE 'Asia/Seoul')::date`로 바꿔, 한 그래프에서 이메일과 날짜가 맞게 한다.
- **`src/hooks/useAnalytics.ts`**: 기간을 `presetRange(days, now)`(rules.ts, KST, 오늘 포함)로 만든다. SWR은 `refreshInterval: 900000`, `revalidateOnFocus: false`(B27).
- `/api/dashboard/summary`(홈의 오늘 요약)는 하루치라 범위 밖이다. 그대로 둔다.

### 9-2. 알림톡·신규 레코드 분기 (단계 0 측정 뒤 정한다)

| 단계 0 결과 (d3adb8d3, 90일, 콜드, EXPLAIN ANALYZE BUFFERS) | 할 일 |
|---|---|
| 알림톡 3질의(summary 상태별·trends 일별·templates 이름별)와 레코드 1질의가 모두 1초 이하 | **분기 A**: 질의 모양은 그대로 두고 KST 경계만 맞춘다. |
| 하나라도 1초 초과 | **분기 B**(넘은 원천만): 아래 4가지를 한다. |

분기 B에서 할 일:
1. 부팅 뒤 CONCURRENTLY 색인을 만든다. `alimtalk_send_logs (org_id, sent_at)`, `records (org_id, created_at)`를 `send-log-indexes.ts` 목록에 더한다. 큰 표 색인 관례대로 마이그레이션이 아니다. 워커가 창만 읽으려면 이 길이 있어야 한다.
2. `home_stats_daily` 표를 만든다.
   - 칸: org_id, stat_date, source('alimtalk'|'records'), template_name(알림톡만, 그 밖은 ''), total, sent, failed, pending, updated_at
   - PK: (org_id, stat_date, source, template_name)
   - 알림톡은 지금처럼 모든 상태를 센다.
3. 워커가 같은 창(최근 8일·야간·백필)과 같은 diff 쓰기로 센다.
4. 라우트가 이 표를 읽는다.

- 단계 0이 U3 전에 끝나지 않으면 분기 A로 진행한다. 필요해지면 0122로 더한다.

**단계 0 결과 (2026-10-21 16:4x KST, 운영 읽기 전용, d3adb8d3, 90일, `evidence/stage0-prod.txt`)**

| 질의 | 시간 | 블록 | 판정 |
|---|---|---|---|
| 알림톡 summary 상태별 | 200ms(콜드) | read 278 | 1초 이하 |
| 알림톡 trends 일별 | 8ms | 281 | 1초 이하 |
| 알림톡 templates 이름별 | 5ms | 281 | 1초 이하 |
| 신규 레코드 count | **5,718ms** | read 28,451 (records heap 243MB, 37.7만 행) | **1초 초과** |
| (참고) 이메일 90일 count | 7,997ms | read 84,192 — 90일이 표의 40%라 Seq Scan | 원인 재확인 |

- 결정: **알림톡은 분기 A**(질의 그대로, KST 경계만), **신규 레코드만 분기 B**.
  - `records (org_id, created_at)` 색인을 `send-log-indexes.ts` 목록에 더한다(부팅 뒤 CONCURRENTLY).
  - `home_stats_daily`는 source='records'만 쓴다(template_name '', total=그날 생성 수, sent·failed·pending 0). 0121에 함께 만든다.
  - 워커가 같은 창·diff 쓰기로 센다. summary의 `newRecordsInPeriod`는 이 표의 합이다.
- **records 집계 계약** (2026-10-21 Codex 질문으로 확정)
  1. 7-1 조직 목록은 `SELECT id FROM organizations`(작은 표)로 바꾼다. 이메일 설정이 없는 조직도 records를 센다.
  2. `first_send_date`의 뜻을 "첫 데이터 날짜" = min(첫 발송 KST 날짜, 첫 record 생성 KST 날짜)로 넓혀 백필 공통 하한으로 쓴다. 칸 이름은 그대로 두고 주석에 적는다. 별도 커서는 두지 않는다.
  3. `SEND_LOG_INDEXES_READY_SQL`은 그대로 둔다. 워커는 `records_org_created_at_idx`의 indisvalid를 따로 본다. 준비 전이면 **records 원천만** 건너뛰고(stats에 `recordsSkipped: "index_pending"`) 이메일 집계는 그대로 돈다.
  4. records 색인이 준비되기 전 회차는 **이메일 최근 8일 계산과 `recent_done_at`만** 한다. `filled_from`·`backfill_done_at`·`nightly_date`·`nightly_next`·워터마크는 움직이지 않고 야간·백필을 보류한다. 첫 record 날짜 조회도 색인 준비 뒤에 해서 `first_send_date`를 보정하고, 그때부터 두 원천을 함께 백필한다. 공통 커서를 되감는 규칙은 두지 않는다. (색인 생성은 몇 분이라 보류해도 손해가 작다.)
  5. (리뷰 반영) 워터마크는 records와 무관하므로 state를 **만들 때 늘 각 표의 max(id)**로 시드한다(records 색인 준비 여부와 상관없음). 계약 4의 "움직이지 않는다"는 이미 만든 줄의 전진 금지다. 수동 갱신이 state를 처음 만드는 경우도 같은 `ensureState`를 거친다.
- 그 밖: 운영 PG 16.15, shared_buffers 128MB, effective_cache_size 4GB, work_mem 4MB. customer_journey_alerts는 373행이라 색인 걱정은 없다. 통계(reltuples)는 정상이다(n_live_tup는 2026-10-20 재시작으로 초기화된 값).


## 10. 화면 (B20~B25)

### 10-1. 배치 (위에서 아래로)

1. `SendHealthBanner` (그대로)
2. 도구 줄
   - `PeriodPicker`: 7·30·90일 + 직접 지정, 기본 30일
   - `WorkspaceSelect`: 전체 + 숨기지 않은 사업. `useWorkspaces().workspaces`를 쓴다(`src/hooks/useWorkspaces.ts:44-46`).
   - `StatsFreshness`: "집계 기준 HH:MM", 채운 기간, 30분 넘으면 경고
   - 비교 기간 한 줄
3. `KpiGrid`: 8칸, 데스크톱 2줄×4, 모바일 2열
4. `OpenRateNotice` (그대로)
5. `TrendPanel`
   - 탭 "반응": 막대는 발송(접수), 선은 오픈율·클릭률·회신율
   - 탭 "이탈": 반송률·수신거부율 선
   - 최근 3일에는 "반응이 쌓이는 중" 띠, 준비되지 않은 날에는 "집계 준비 중" 띠
6. `CompareTable`: 축 탭 7개, 열 머리 정렬, 합계 줄, 가로 스크롤
7. 운영 카드: `SendQueueOverviewCard` · `SendHealthCard` · `KeyLeadsCard` (그대로, 각자 로딩)
8. `DashboardLinks`: 문구 실험 · 회신(`useRepliesEnabled`가 참일 때만) · 발송 이력 · 템플릿 관리 · 연결 관리 → `onTabChange`

- 진행 중 실험 수는 넣지 않는다. 실험 API가 관리자 전용이고 페이지 단위라서(`email/experiments/route.ts:5-21`) 멤버 화면에서 셀 수 없다.

### 10-2. 파일과 줄 수 (모든 새 파일 200줄 이하)

| 파일 | 역할 | 쓰는 훅 | 예상 줄 |
|---|---|---|---|
| ui/EmailDashboard.tsx | 조립(`"use client"`). 1번 SendHealthBanner부터 8번 링크까지 순서대로 놓는다 | useDashboardFilters | 60 |
| ui/DashboardToolbar.tsx | 도구 줄 | — | 40 |
| ui/PeriodPicker.tsx | 프리셋 버튼 + DateRangePicker | — | 50 |
| ui/WorkspaceSelect.tsx | Select | useWorkspaces | 40 |
| ui/StatsFreshness.tsx | 기준 시각·채운 기간·경고 | useEmailStatsKpi(같은 키) | 40 |
| ui/KpiGrid.tsx | 8칸·준비 중 알림·오류 | useEmailStatsKpi | 50 |
| ui/KpiCard.tsx | 카드 하나(값·증감·보조·title 툴팁·연동 안 됨) | — | 70 |
| ui/TrendPanel.tsx | Tabs + 안내 | useEmailStatsTrend | 70 |
| ui/TrendChart.tsx | recharts ComposedChart + ReferenceArea | — | 100 |
| ui/CompareTable.tsx | 축 탭·머리·합계 | useEmailStatsCompare | 100 |
| ui/CompareRows.tsx | 본문 줄 | — | 70 |
| ui/DashboardLinks.tsx | 탭 이동 버튼 | useRepliesEnabled | 35 |

- `.tsx`에는 `useState`·`useEffect`·`useMemo`·`useSWR`·`fetch`·계산(`Math.`·`toFixed`·`toLocaleString`)을 두지 않는다. 커스텀 훅 호출과 렌더만 한다(B25).

### 10-3. 훅·api·utils

- `api/emailStatsApi.ts`
  - `statsUrl(view, query, axis?)`
  - `STATS_SWR = { refreshInterval: 900000, revalidateOnFocus: false, keepPreviousData: true }`
- `hooks/useDashboardFilters.ts`: 기간(프리셋·직접)과 워크스페이스 상태를 들고 `query`를 만든다.
- `hooks/useEmailStatsKpi.ts`·`useEmailStatsTrend.ts`·`useEmailStatsCompare.ts`
  - SWR로 받아 utils로 보기 모델을 만든다.
  - `success:false`면 error 문구를 돌려준다(`useKeyLeads.ts:5-8`과 같은 모양).
  - compare 훅은 축·정렬 상태를 들고 있는다.
- `utils/`(순수, 테스트 있음)
  - `period.ts`: 프리셋 → 범위, 직접 지정 → 범위(달력 날짜)
  - `format.ts`: 수, 비율(`openRateText` 재사용), 증감, 증감 색
  - `kpiCards.ts`: 응답 → 카드 8개 보기 모델
  - `compare.ts`: 축별 열, 정렬(null 비율은 늘 뒤), 회신율 기준 라벨
  - `trend.ts`: 점 → 차트 값, 준비 중·쌓이는 중 구간
  - `freshness.ts`: asOf·coverage → 글자, 30분 경고

### 10-4. KPI 카드 (B20)

| # | 카드 | 값 | 보조 줄 | 툴팁(분자·분모) | 낮을수록 좋음 | 연동 안 됨 |
|---|---|---|---|---|---|---|
| 1 | 발송 | accepted | 첫 메일 n | NHN이 받아 간 메일. 시험·데모·취소 제외. 성공·실패·대기·접수 거절 수 | | |
| 2 | 도달률 | deliveryRate | 반송 n (하드 n) | 배달 확정 ÷ 결과 확정. 결과 대기 n통은 빠짐 | | |
| 3 | 사람 오픈율(추정) | openRate | opened/openBase | 사람 오픈·클릭 ÷ 픽셀을 넣은 성공 발송 + 오픈 안내 4줄 | | |
| 4 | 사람 클릭률 | clickRate | CTOR x% | 사람 클릭 ÷ 성공. CTOR = 오픈 중 클릭 ÷ 오픈 | | |
| 5 | 메일 유입 방문 | visited(건) | 행동 n · 방문율 x% | 사람 클릭으로 사이트 방문이 이어진 발송 | | "사이트 연동 안 됨" |
| 6 | 회신율 | replyRate | 자동응답 n | 사람 회신이 온 시퀀스 ÷ 첫 메일. 통당 replied/sent | | "회신 연동 안 됨" |
| 7 | 핵심 리드 | keyLeads(명) | 긴급 n · 주목 n · 미처리 n | 판정일 기준 긴급·주목 고객(구글챗과 같은 판정). 아래 목록(최근 30일 최신 판정)과 기준이 다르다 | | "여정 알림 연동 안 됨" |
| 8 | 수신거부율 | unsubscribeRate | 스팸 신고 n | 메일 링크·원클릭 수신거부 ÷ 성공. 담당자 수동 등록은 빠짐 | ✓ | |

- 증감 줄은 "+12.3% · 08-23 ~ 09-21 대비" 꼴이다.
- 증감 색은 KpiCards와 같다(`:36,53`): 좋아지면 emerald, 나빠지면 rose, 0·null이면 muted. 다크 변형도 쓴다.

### 10-5. 비교 표 열 (B21)

| 열 | 값 | 툴팁 |
|---|---|---|
| 이름 | label + sublabel, deleted면 흐리게 | |
| 발송 | accepted | 성공·실패·대기·접수 거절 |
| 도달률 / 반송률 | deliveryRate / bounceRate | 확정 n, 하드 n |
| 발신 쪽 실패율 | senderSideRate | sender·domain 축에만 |
| 오픈율 / 클릭률 / CTOR | | opened/openBase 등 |
| 회신율 | sequence면 replyRate, perSend면 replyRatePerSend. 머리에 "(첫 메일)"·"(통당)" | 자동응답 n |
| 수신거부율 | unsubscribeRate | 스팸 신고 n |
| 방문 | visited | 행동 n |

- 연동이 안 됐으면 회신율·방문 칸은 "—"이고, 머리 툴팁에 "연동 안 됨"을 쓴다.

### 10-6. 빈 상태와 문구 (B16)

| 상황 | 보이는 것 |
|---|---|
| state 없음 | "집계 준비 중입니다. 반영 직후 몇 분 안에 최근 날짜부터 채워집니다." |
| 기간 일부가 coverage 밖 | "YYYY-MM-DD 이전 날짜는 집계 준비 중입니다. 그 날짜의 숫자는 빠져 있습니다." |
| 직전 기간 일부가 coverage 밖 | 증감 "—", 툴팁 "비교 기간 집계 준비 중" |
| asOf가 30분 넘게 지남 | 노란 경고 "집계가 멈춰 있습니다(마지막 HH:MM)" |
| 기간에 발송 0 | 비율 "—", 비교 표 "이 기간에 보낸 메일이 없습니다." |
| 요청 실패 | 섹션 안 "이메일 통계를 불러오지 못했습니다." + 다시 불러오기 |

## 11. 파일 계획

**새 파일 — lib** (`src/lib/email-stats/`, 모두 200줄 이하)

| 파일 | 역할 | DB |
|---|---|---|
| `rules.ts` | KST 오늘·프리셋·`kstDayBounds`·창·`nightlyDue`·백필 단계·조각·`mergeDateRanges` | 없음 |
| `metrics.ts` | 빈 수·합·`deriveRates`·`deltaPct`·`coverageStatus`·`isMaturing` | 없음 |
| `query.ts` | `parseStatsQuery` | 없음 |
| `attribution.ts` | `resolveAttribution`·`isExcludedSend` | 없음 |
| `sql.ts` | 집계·리드 SQL 조립(accepted 주입), `EXCLUDED_SQL`, 칸 목록 | 없음 |
| `reference-sql.ts` | 대조용 직접 집계(행마다 EXISTS + 재귀 사슬). 시험에서만 쓴다 | 있음 |
| `attribution-store.ts` | 5-3 | 있음 |
| `rollup.ts` | `recomputeRange` | 있음 |
| `leads.ts` | 6-4 | 있음 |
| `late-events.ts` | 7-3 | 있음 |
| `state.ts` | 7-7 | 있음 |
| `worker.ts` | `runEmailStats` | 있음 |
| `scheduler.ts` | `startEmailStatsScheduler`·`emailStatsSchedulerEnabled` | 없음(동적 import) |
| `connections.ts` | 회신·사이트·여정 연동 | 있음 |
| `names.ts` | 이름 표 읽기 | 있음 |
| `read-kpi.ts`·`read-series.ts` | view별 읽기 | 있음 |
| `home-map.ts` | 홈 응답 모양 변환 | 없음 |
| `home.ts` | 홈용 읽기 | 있음 |

**새 파일 — 그 밖**
- 시험: `rules`·`metrics`·`query`·`attribution`·`sql`·`home-map`·`scheduler`의 `.test.ts`, `static.test.ts`, `migration.test.ts`, `db-fixture.ts`, `rollup.db.test.ts`, `worker.db.test.ts`
- 스키마: `src/lib/db/email-stats-schema.ts`, `drizzle/0121_email_stats.sql`
- API: `src/app/api/analytics/email-stats/route.ts`(GET), `src/app/api/analytics/email-stats/process/route.ts`(POST)
- 화면: `src/components/email/dashboard/{types,api,hooks,utils,ui}/…`(10-2·10-3, utils는 `.test.ts`)
- 근거: `docs/2026-10-21-email-dashboard-stats/evidence/`(fixture SQL, 측정 스크립트·결과)

**고칠 파일**
- `drizzle/meta/_journal.json`: 항목 1개 추가
- `src/lib/db/schema.ts`: export 1줄
- `src/instrumentation.ts`: 워커 시작 1줄 + 주석(sendb-dev 반환 앞)
- `src/lib/customer-journey-scheduler.ts`: 제네릭 + 선택 옵션 3개(기본값 그대로)
- `src/lib/email-open-migration.test.ts`: "가장 늦다" 단정 완화(4-2)
- `src/app/api/analytics/{summary,trends,templates}/route.ts`: 9절
- `src/hooks/useAnalytics.ts`: KST 기간, 15분, 포커스 재요청 끔
- `src/hooks/useEmailAnalytics.ts`·`useEmailDaily.ts`: U0에서 포커스 재요청을 끄고, U9에서 지운다
- `src/app/email/page.tsx`: import 경로만(`:13`)

**지울 파일** (U9, grep으로 참조가 없는지 확인한 뒤)
- `src/components/email/EmailDashboard.tsx`
- `src/components/email/DailyEmailTable.tsx`
- `src/hooks/useEmailAnalytics.ts`, `src/hooks/useEmailDaily.ts`
- `src/app/api/analytics/email-daily/route.ts`
- 지금 이 이름들을 참조하는 곳은 서로와 `src/app/email/page.tsx`뿐이다(grep 2026-10-21).

**바꾸지 않음** (B28)
- `email-open-*.ts`·`email-click-*.ts`(R6), `email-open-sql.ts`
- 발송 7경로, `email-send-log-status.ts`
- 발신 건강·결과 동기화·회신 읽기
- 운영 카드 3개, 트래커 화면, MCP

## 12. behavior → 구현 매핑

| B | 구현 | 확인 |
|---|---|---|
| B1 | 0121 SQL·journal | migration.test(T5), 빈 QA DB 두 번 부팅 |
| B2 | `resolveAttribution` + `fillAttribution` | T4, db 시험 D1 |
| B3 | `EXCLUDED_SQL`·`isExcludedSend` | T1, T6, D2 |
| B4 | `sql.ts` 집계 문장 | D2(reference와 차이 0) |
| B5 | `kstDayBounds`, GROUPING SETS 불변식, compare "그 밖" 줄 | T1, D2 |
| B6 | changed CTE | D3(두 번째 실행 written 0·deleted 0) |
| B7 | 최근·야간 창 | D4 |
| B8 | `late-events.ts` | D5 |
| B9 | 백필 커서 | T1, D7, 14절 |
| B10 | 잠금·예약 연결·시간 제한·조직별 catch | T6(정적), D8 |
| B11 | route + `read-*.ts` | T6(정적), T3, curl |
| B12 | `read-kpi.ts`·`read-series.ts`·`deltaPct` | T2, curl |
| B13 | 조각 재사용 + `deriveRates` | T2, T6 |
| B14 | `connections.ts` + 카드 보기 모델 | T8, ego-browser |
| B15 | 소속 확인 → 400 | curl |
| B16 | state·`freshness.ts` | T8, ego-browser |
| B17 | 읽기 질의 | 14절 관문 |
| B18 | 워커 | 14절 관문 |
| B19 | 운영 | 16절 |
| B20 | KpiGrid·KpiCard·`kpiCards.ts` | T8, ego-browser |
| B21 | CompareTable·`names.ts`·`compare.ts` | T8, ego-browser |
| B22 | TrendPanel·`trend.ts` | T8, ego-browser |
| B23 | 섹션별 SWR | ego-browser 네트워크 기록 |
| B24 | `presetRange`·PeriodPicker | T1, T8 |
| B25 | 화면 구조 | T6(정적) |
| B26 | `home.ts`·`home-map.ts`·3라우트 | T7, 응답 키 비교 |
| B27 | STATS_SWR·useAnalytics | T6(정적) |
| B28 | 손대지 않음 | 기존 테스트, git diff |
| B29 | 삭제 | T6(정적) |
| B30 | 마무리 | pnpm test·tsc·eslint |

## 13. TDD로 고정할 계약

`node:test`와 `node:assert/strict`를 쓰고, 테스트 이름은 `"B…: …"` 꼴이다. 구현 전에 RED를 확인한다. **순수 시험은 `@/lib/db`를 부르는 파일을 import하지 않는다.** 기준 시각은 `NOW = 2026-10-21T03:00:00Z`(KST 수요일 12:00, T = 2026-10-21)다.

**T1 `rules.test.ts`**

| 함수 | 입력 | 기대 |
|---|---|---|
| kstToday | 2026-10-20T15:00:00Z / 14:59:59.999Z | "2026-10-21" / "2026-10-20" |
| presetRange | 7 / 30 / 90 | from 10-15 / 09-22 / 07-24, to 10-21 |
| previousRange(재사용) | 09-22~10-21 | 08-23~09-21 |
| kstDayBounds | 10-15~10-21 | "2026-10-15T00:00:00+09:00", "2026-10-22T00:00:00+09:00" |
| kstDayBounds | 12-31~12-31 | 끝 "2027-01-01T00:00:00+09:00" |
| recentWindow / nightlyWindow / lateCutoff / priorityFloor | T | 10-14~10-21 / 09-17~10-13 / 09-16 / 08-23 |
| nightlyDue | nightly 10-20, KST 수 00:30 / 01:05 / 10:00 / 19:00, 토 11:00 | false / true / false / true / true |
| nightlyDue | nightly 10-21, KST 19:00 | false |
| backfillPhase | filled 10-14·first 03-01 / filled 08-23 / filled 03-01 / first null | priority / rest / done / done |
| backfillAllowed | rest: 수 10:00 / 수 18:00 / 토 11:00, priority: 수 10:00 | false / true / true / true |
| nextBackfillChunk | filled 10-14·first 10-01 / filled 10-02·first 10-01 | 10-12~10-13 / 10-01~10-01 |
| nightlyChunks(3일) | next null, filled 09-01 / filled 10-01 | 첫 조각 10-11~10-13, 끝 09-17 / 끝 10-01 |
| mergeDateRanges | [09-03, 09-01, 09-02, 09-10] | [09-01~09-03, 09-10~09-10] |

**T2 `metrics.test.ts`**
- 수: delivered 90·bounced 5·senderSide 3·nhnUnsub 2·sent 100·firstSent 40·seqReplied 3·replied 2·unsubscribed 1·visited 4·openBase 0
  → deliveryRate 90, bounceRate 5, senderSideRate 3, openRate null, ctor null, replyRate 7.5, replyRatePerSend 2, unsubscribeRate 1, visitRate 4
- 반올림: ratePercent(1, 3) = 33.3, (0, 0) = null, (2, 2) = 100 (`openRatePercent`와 같다)

| deltaPct 입력 | 기대 |
|---|---|
| (110, 100) | 10 |
| (90, 100) | -10 |
| (5, 0) | null |
| (0, 0) | null |
| (null, 5) | null |
| (5, null) | null |
| (100, 100) | 0 (-0이 아님) |
| (1/3, 1/4) | 33.3 |

- coverageStatus(범위 09-22~10-21)

| coverage | 기대 |
|---|---|
| {08-23, 10-21} | full |
| {null, 10-21} | full |
| {10-14, 10-21} | partial |
| {08-23, 10-20} | partial |
| null | none |

- isMaturing: 10-19 → true, 10-18 → false

**T3 `query.test.ts`**
- 400이 되는 것: from > to, to = 10-22, 367일, "2026-02-30", view "x", axis "x", workspaceId "abc"·"0"·"-1"·"1.5"
- workspaceId ""는 null이다. compare에 axis가 없으면 campaign이다.
- 오류 글자는 8-1과 정확히 같아야 한다.

**T4 `attribution.test.ts`** (org O, 다른 org X)

| 발송 | 입력 | 기대 (kind/id, root, step) |
|---|---|---|
| 101 | 첫 메일, AI 7 | ai/7, 101, 0 |
| 102 | 부모 101, 자기 template 9 | ai/7, 101, 1 |
| 103 | 부모 102 | ai/7, 101, 2 |
| 201 | 첫 메일, template 5 | template/5, 201, 0 |
| 301 | 링크 없음, email_template 12 | manual/12, 301, 0 |
| 302 | 링크·템플릿 없음 | manual/0, 302, 0 |
| 401 | 부모 9999 = "missing" | 자기 링크, 401, 0 |
| 402 | 부모 88 = {O, root 80, step 1, template/3} | template/3, 80, 2 |
| 403 | 부모 89 = {X, …} | 자기 링크, 403, 0 |

- 입력 순서를 섞어도 결과가 같다.
- null인 workspace·partition·sender는 0, trigger는 ''가 된다.
- `isExcludedSend`

| 입력 | 기대 |
|---|---|
| (test_followup, sent), ("testX", sent) | 제외 |
| (journey_demo, demo), (manual, demo), (followup, cancelled) | 제외 |
| (null, sent), (ai_auto, failed), (visit_ack, uncertain) | 포함 |

**T5 `migration.test.ts`** (`flat` = 주석을 지우고 공백을 하나로)
- `SET LOCAL lock_timeout = '5s';`로 시작한다.
- 4-1의 CREATE TABLE·INDEX 문장이 모두 들어 있다.
- 다음에 맞지 않는다: `/ALTER\s+TABLE|UPDATE\s|DROP\s/i`, `/CREATE INDEX[^;]*ON "(?!email_stats_)/`, `/REFERENCES "(?!organizations")/`
- journal: tag `0121_email_stats`는 1개, idx 122, when 1792692000000, breakpoints true, 앞 번호 항목 모두보다 when이 크다.

**T6 `sql.test.ts`·`static.test.ts`** (파일·렌더 결과를 문자열로 본다)
- `sql.test.ts`
  - 렌더한 SQL에 `email_send_logs.open_tracked AND email_send_logs.status = 'sent'`(openBaseSql), 주입한 표지 `(ACCEPTED_MARK)`, `HEALTH_CATEGORY_SQL` 원문, GROUPING SETS 5개, 제외 술어 세 줄이 있다.
  - params에 조직 id와 날짜가 있고, SQL 글자에는 없다.
  - `ON CONFLICT ON CONSTRAINT email_stats_daily_pkey`와 changed·del CTE가 있다.
- `static.test.ts`
  - B10: `worker.ts`에 `pg_try_advisory_lock`, `queryClient.reserve()`, `statement_timeout`, `RESET statement_timeout`, `release()`가 있다. `instrumentation.ts`에서 `startEmailStatsScheduler`가 `isDevelopmentPreviewRuntime`보다 앞에 있다.
  - B11: GET route, `read-*.ts`·`names.ts`·`connections.ts`·`home.ts`, 3라우트에 `/email_send_logs|email_click_logs|email_open_logs|emailSendLogs|emailClickLogs|emailOpenLogs/`가 없다.
  - B25: `dashboard/ui/*.tsx`에 `/\buse(State|Effect|Memo|Callback|Reducer|Ref)\b|useSWR|\bfetch\(|Math\.|toFixed\(|toLocaleString\(/`가 없다. `dashboard/**`·`email-stats/**`·새 route의 시험 아닌 파일은 200줄 이하다.
  - B27: `api/emailStatsApi.ts`와 `useAnalytics.ts`에 `refreshInterval: 900000`(또는 900_000)과 `revalidateOnFocus: false`가 있다.
  - B29: 지울 파일 5개가 없고, src(시험 제외)에 `email-daily|DailyEmailTable|useEmailDaily|useEmailAnalytics|components/email/EmailDashboard`가 없다.

**T7 `home-map.test.ts`**
- 같은 수를 넣으면 summary·trends·templates의 키 집합과 반올림이 지금 코드 식과 같다.
- clickRate는 sent가 0이면 0이고, (1, 3)이면 33.3이다.
- triggerType ''는 'unknown'이 된다.
- templates는 manual을 빼고, 이름은 "AI: 규칙명"이며, 지운 규칙은 "(삭제됨)"이다.

**T8 UI utils `*.test.ts`**
- kpiCards
  - 순서 8개가 Q1과 같다. 수신거부율만 lowerIsBetter다.
  - connections가 false면 각 카드 값이 "회신 연동 안 됨"·"사이트 연동 안 됨"·"여정 알림 연동 안 됨"이다.
  - previousCoverage가 partial이면 증감이 "—"다.
- compare
  - null 비율은 오름·내림 정렬 모두 뒤에 간다.
  - step·trigger 축은 "(통당)", 그 밖은 "(첫 메일)"이다.
  - sender·domain 축에만 발신 쪽 실패율 열이 있다.
- trend: ready false인 날은 비율이 null(선이 끊긴다)이고, maturing 구간은 T-2~T다.
- freshness: asOf 31분 전이면 경고, 29분 전이면 경고 없음. coverage.from이 null이면 "전체 기간 집계됨"이다.
- period: 7·30·90 프리셋이 T1과 같다. 직접 지정은 달력 날짜를 쓴다.

**T9 `scheduler.test.ts`** + 기존 `customer-journey-scheduler.test.ts`(그대로 통과)
- intervalMs 60000이면 두 번째 예약 delay가 60000이다.
- 실패하면 state.lastError가 failureLabel이다.
- `emailStatsSchedulerEnabled`

| env | 기대 |
|---|---|
| {NODE_ENV: production} | true |
| {NODE_ENV: production, EMAIL_STATS_WORKER: off} | false |
| {NODE_ENV: development} | false |
| {NODE_ENV: development, EMAIL_STATS_WORKER: on} | true |

**T10 DB 시험** (`rollup.db.test.ts`·`worker.db.test.ts`)
- `EMAIL_STATS_TEST_URL`이 없으면 skip한다.
- URL이 `postgresql://…@127.0.0.1:<port>/sendb_email_stats_qa`가 아니면 throw한다(선례 `esign/native-postgres.test.ts:10-12`).
- 모듈은 테스트 안에서 동적 import한다. 그 전에 `DATABASE_URL`을 QA URL로 두고 `runMigrations()`로 스키마를 만든다.
- fixture(`db-fixture.ts`): 조직 3개, 발송 약 60건.
  - 3단 사슬, 다른 조직 부모, 없는 부모, 깊이 4 사슬
  - 상태·NHN 코드·dsn, 오픈(기계 포함), 클릭(봇 포함)·세션·이벤트
  - 사람·자동·반송 회신(root_log_id 일부 NULL), link·manual 수신거부, complaint
  - 시험·데모·취소 발송, 여정 알림·후속 상태

| # | 시나리오 | 기대 |
|---|---|---|
| D1 | 귀속 채우기 | 모든 발송이 loadChains 같은 사슬과 root·깊이·kind(ai·template은 id까지) 일치 |
| D2 | 모든 날짜 재계산 | 모든 (grain, 날짜, 키, 25칸)이 reference와 차이 0. 묶음 합 = total. 제외 발송 0 |
| D3 | 같은 범위 다시 | written 0, deleted 0 |
| D4 | 3일·20일 전 발송에 사람 오픈·클릭·회신·수신거부 추가, 3일 전 발송 sent→failed(SST3) → 회차 | 3일 날만 바뀌고 reference 일치. 다음 날 01:30 야간 → 20일 날 일치 |
| D5 | 50일 전 발송에 이벤트 추가 → 야간 | 그 날만 바뀐다(다른 옛 날 updated_at 그대로) |
| D6 | 후속 하나를 cancelled로 | 그 campaign·단계 줄이 지워진다 |
| D7 | 예산 0으로 백필 한 조각 뒤 멈춤 → 다시 | 커서에서 이어 끝나고 backfill_done_at이 찬다 |
| D8 | runEmailStats 두 개를 동시에 | 하나는 `skipped: "locked"` |
| D9 | 리드 | lead_days 고유 고객 수가 reference와 같다 |

## 14. fixture·성능 관문

**QA 클러스터** (로컬, 루프백 전용)
- port 15474, db `sendb_email_stats_qa`
- `shared_buffers = 128MB`, `shared_preload_libraries = 'pg_stat_statements'`
- 주 버전은 운영과 같게 한다 [미확인 — 단계 0의 server_version]
- 실제 NHN 키가 있는 로컬 `salesflow` DB는 쓰지 않는다.
- (2026-10-21 정정) U3~U9의 DB 시험은 기존 로컬 서버(localhost:5432)의 **`sendb_email_stats_qa` DB만** 쓴다(만들고 지워도 된다). 별도 클러스터(15474, shared_buffers 128MB)는 U10 성능 측정 때 Claude가 만든다. 운영 주 버전은 16.15다(단계 0).

**운영 규모 fixture** (`evidence/fixture/perf-fixture.sql`, `random()` 없이 `hashint4(g)`로 결정적)
- 발송 40만 건, 180일, id 순서 = 시각 순서
- 조직 A 60%·B 25%·C 15%
  - A는 하루 약 1,333통이다. 운영 최대(약 1,930통/일)의 70%라서, 블록 수는 1.45배로 환산해 판정한다.
- A의 구성: 사업 3, 명단 30, 템플릿 연결 20, AI 규칙 15(제품 연결), 발신 프로필 12(도메인 3)
- 본문 1,500~1,900자(md5 이어 붙임). 행이 2KB 미만이라 압축 없이 인라인으로 남아 heap이 약 750MB가 된다(`pg_relation_size`로 확인).
- 사슬: 첫 메일 70%, 후속 1·2·3단 20·7·3%. 부모보다 3~7일 뒤에 같은 수신자·명단·주소로 보낸다.
- 첫 메일 유형: ai_auto 50·auto 30·manual 10·repeat 10%
- 상태: sent 90·failed 5(절반 SST3, 절반 접수 거절)·pending 1·cancelled 1·uncertain 0.2·test_followup 0.5·journey_demo 0.1%
- NHN 코드: SST2 85·SST3 3·SST5 0.5·SST7/8 0.3%. 마지막 2일은 대부분 NULL. dsn_only 0.5%
- open_tracked는 최근 30일. 그중 25%에 오픈 1~3건(30%는 기계)
- 클릭은 발송의 3%(10%는 봇). 사람 클릭의 30%는 세션이 있고, 그 절반은 CLICK·CUSTOM 이벤트가 있다. C는 사이트가 없다(연동 안 됨 확인용).
- A만 회신 대상 조직이다(QA env의 `REPLY_WORKSPACE_IDS`). 첫 메일 시퀀스 2%에 사람 회신, 1%에 자동응답
- 수신거부 0.3%(link·one_click) + 수동 0.1%, complaint 0.02%
- 여정 알림 200건(A, 60일), 후속 상태 일부

**측정 방법**
- 콜드 = 클러스터 재시작 직후, 데운 상태 = 바로 이어서. 각각 3번 재고 중앙값을 쓴다.
- 블록 = `pg_stat_statements_reset()` 뒤 그 요청에 쓰인 문장들의 `shared_blks_hit + shared_blks_read` 합
- 응답 시간 = 로컬 `next start`(QA DB)에 가상 조직 토큰으로 `curl -w '%{time_total}'`
- 옛 라우트(summary·trends·templates·email-daily) EXPLAIN (ANALYZE, BUFFERS) 30·90일을 먼저 기록한다. 기대: 조직 A 30일 1.5~2.5만 블록(재현).

**관문**

| 관문 | 기준 | B |
|---|---|---|
| kpi·trend·compare(축 7개) 30일·90일(+직전) | 요청 1건의 블록 합 1,500 이하 | B17 |
| 데운 응답 | 3회 중앙값 300ms 이하 | B17 |
| 최근 8일 회차, 조직 A | 데운 상태 5초 이하. 블록은 기록하고, 1.45배 환산값이 1.2만 이하 | B18 |
| 바뀐 것 없는 회차 | written 0, deleted 0 | B6 |
| 야간, 전체 조직(콜드) | 10분 이하 | B18 |
| 백필 180일 전체 | 끝까지 간다. 중간에 프로세스를 죽였다 살리면 이어서 끝난다. 조각 문장 30초 이하 | B9, B18 |
| 동등성(작은 fixture 전체 + 큰 fixture 조직별 무작위 3일) | 차이 0 | B2~B5 |

- 넘으면 멈추고 보고한다. 대안 후보:
  - 최근 회차: 창을 나눈다(오늘·어제는 15분, 3~8일은 1시간)
  - 읽기: grain별 물리 표로 나눈다
  - 워커 전용 좁은 색인((c), 별건)

## 15. Codex 구현 단위

지시문에 **"설계와 어긋나면 지어내지 말고 멈춰서 물어라"**를 넣는다. 답이 설계를 바꾸면 이 문서를 먼저 고친다. Codex는 운영·개발 DB에 접속하지 않고 QA 클러스터만 쓴다.

| # | 내용 | 먼저 RED | B | 통과 조건 |
|---|---|---|---|---|
| U0 | 새로 고침 15분·포커스 재요청 끔: `useAnalytics`·`useEmailAnalytics`·`useEmailDaily` | — | B27(일부) | tsc·eslint. 따로 먼저 내보낼 수 있다 |
| U1 | `rules.ts`·`metrics.ts`·`query.ts` | T1·T2·T3 | B5·B12·B13(식)·B24 | GREEN, db import 없음 |
| U2 | `attribution.ts` | T4 | B2(순수)·B3 | GREEN |
| U3 | 0121·journal·`email-stats-schema.ts`·schema export·0120 시험 완화 | T5 | B1 | GREEN, tsc, 빈 QA DB 부팅 2번(두 번째에 마이그레이션 없음) |
| U4 | `sql.ts`·`reference-sql.ts` | T6(sql) | B4·B13 준비 | GREEN |
| U5 | `attribution-store.ts`·`rollup.ts`·`leads.ts`·`db-fixture.ts`·`rollup.db.test.ts` | D1·D2·D3·D6·D9 | B2~B6 | QA DB에서 차이 0 |
| U6 | `state.ts`·`late-events.ts`·`worker.ts`·`scheduler.ts`·스케줄러 제네릭·process 라우트·instrumentation·`worker.db.test.ts` | T9·D4·D5·D7·D8·T6(B10) | B6~B10 | GREEN, tsc |
| U7 | `connections.ts`·`names.ts`·`read-kpi.ts`·`read-series.ts`·GET 라우트·수동 갱신(`manual-refresh.ts`·refresh 라우트, 7-8) | T6(B11)·T3 | B11~B16 | GREEN, curl 표(16절) |
| U8 | `home-map.ts`·`home.ts`·3라우트·useAnalytics KST (분기 B면 색인·표·워커 원천 추가) | T7 | B26 | GREEN, 응답 키 비교 |
| U9 | dashboard types·api·hooks·utils·ui, page import, 옛 파일 삭제 | T8·T6(B25·B27·B29) | B20~B25·B27·B29 | GREEN, tsc, eslint. 화면은 Claude가 ego-browser로 본다 |
| U10 | 성능 fixture·측정 스크립트(evidence) | — | B9·B17·B18 | 14절 관문. 측정과 판정은 Claude가 한다 |
| U11 | 마무리 | — | B28·B30 | `pnpm test`·`pnpm exec tsc --noEmit`·바꾼 파일 eslint, R6·오픈 파일 git diff 없음 |

- **순서**: U1 → U2 → U3 → U4 → U5 → U6 → U7 → U8 → U9 → U10 → U11. U0은 아무 때나 해도 된다. 단계 0 측정은 U3 전에 끝나야 분기 B를 0121에 넣을 수 있다.
- **커밋 제안** (각각 사용자 확인 뒤)
  - [U0] 새로 고침 주기
  - [U1–U4] 규칙·귀속·스키마·SQL
  - [U5–U6] 집계 채우기·워커
  - [U7–U8] API·홈
  - [U9] 화면 + 옛 파일 삭제
  - [U10–U11] 측정 근거·마무리

## 16. 운영 반영과 확인

- **1차 반영** (U0~U6, 사용자 요청 때, 평일 18시 이후 권장)
  - 표·워커만 나가고 화면은 그대로다.
  - 그날 밤 백필이 끝난다. 낮에 반영하면 T-60보다 앞 날짜가 18시까지 비어 홈 90일 수가 작게 보인다.
  - 확인 방법:
    - 로그 `[email-stats]` 줄
    - 사용자가 요청하면 state 읽기 조회(recent_done_at, filled_from, backfill_done_at)
- **2차 반영** (U7~U9): 모든 조직의 backfill_done_at을 확인한 뒤 한다. 그 전에 팀에 바뀌는 숫자를 알린다.
  - KST 경계
  - 시험·데모·취소 제외
  - 규칙별에 후속 포함, AI 이름이 규칙 이름으로
  - 도달률이 확정 기준
- **로컬 curl 표** (U7, QA 서버)

| 요청 | 기대 |
|---|---|
| 토큰 없음 | 401 |
| from > to | 400과 그 글자 |
| A 토큰 + B의 workspaceId | 400 "워크스페이스를 확인해 주세요." |
| A kpi 30일 | connections 모두 true |
| C kpi 30일 | reply false, site false |
| state.filled_from을 옮긴 뒤 | currentCoverage partial |

- **B19**: 2차 반영 뒤 ego-browser로 /email 30·90일 첫 KPI가 2초 안에 그려지는지 네트워크 기록으로 본다.
- **대조**: 사용자가 요청하면, 발송 창 밖에 1~2일치를 원본과 읽기 조회로 맞춰 본다.

## 17. 도메인 체크리스트

| 영역 | 결과 |
|---|---|
| 데이터 모델 | 새 표 4개다. 키는 NOT NULL에 0·''·-1 기본값을 쓴다. FK는 organizations cascade만 건다. 큰 표에는 칸·FK·색인이 없다. 원본이 지워지면 다음 재계산(35일 안)에서 줄이 사라지고, 귀속 고아 줄은 무해하다. |
| API 계약 | GET은 멱등이다. 오류는 `{ success:false, error }` 한국어로 준다. 페이징은 없고 500줄 + "그 밖" 줄이다. 홈 3라우트는 모양을 유지한다. |
| 상태 관리 | SWR 서버 상태만 쓴다. 15분마다 새로 고치고, 포커스 재요청은 끄고, 이전 데이터를 유지한다. 낙관적 업데이트는 없다. |
| 보안 | 인증은 route의 `getUserFromNextRequest`가 본다. 모든 읽기에 org 조건을 단다. 워크스페이스 소속을 확인한다(400). 이름 표도 org 조건으로 거른다. 입력은 `parseStatsQuery`가 검증한다. process는 CRON_SECRET으로 지키고 값을 찍지 않는다. 오류 로그에 매개변수를 남기지 않는다. |
| 동시성 | advisory 잠금으로 한 인스턴스만 돈다. 조각은 한 문장(원자적)이다. 재계산은 멱등이다. 귀속 채우기 뒤 들어온 발송은 다음 회차에 들어간다. 섹션 요청 사이에 워커가 커밋하면 섹션끼리 최대 한 회차 어긋날 수 있다. |
| 성능 | 화면은 PK 범위 읽기만 한다(B17). 워커는 창만 읽는다. 이름은 `= ANY` 한 번으로 읽어 N+1이 없다. 번들에는 recharts(기존)만 쓴다. |

## 18. PLAN과 어긋나는 곳

1. 마이그레이션 번호는 0121이다(조정자 재정정 반영, PLAN과 같다). 0120 시험의 "가장 늦다" 단정을 완화한다.
2. 표가 4개다. 핵심 리드의 고유 고객 수를 세려고 `email_stats_lead_days`를 더했다.
3. 기간 끝을 `.999` 대신 `< 다음 날 00:00`으로 쓴다. 같은 달력 날짜이고 빈틈이 없다.
4. `ComparisonSelector`·`RangeSelector`·`KpiCards` 컴포넌트를 재사용하지 않는다(2-8). `DateRangePicker`·`previousRange`·`OpenRateNotice`·`openRate` 유틸은 재사용한다.
5. `customer-journey-scheduler.ts`를 고친다. PLAN의 파일 목록에는 없지만 제네릭과 선택 옵션만 더하고 기본값은 그대로다.
6. `email-open-sql.ts`는 고치지 않는다. 별칭 없는 CTE로 해결했다.
7. 새 lib 파일이 PLAN 목록보다 많다(metrics·query·attribution-store·leads·late-events·state·scheduler·connections·names·read-*·home·home-map·reference-sql). 200줄 기준에 맞추려는 것이다.
8. 알림톡·신규 레코드도 KST 경계로 맞춘다. 질의 모양은 그대로다.
9. 진행 중 실험 수는 보이지 않는다. 링크만 둔다(10-1).
10. PLAN 1절의 "깊이 방문"·"자동응답" 비교 열은 넣지 않는다. 2절 열 목록과 B4에 없다. 자동응답은 툴팁에만 보인다.
11. 홈 규칙별의 AI 줄 이름이 명단 이름에서 규칙 이름으로 바뀐다(캠페인 귀속의 결과).

## 19. 리스크와 열린 질문

**리스크**
- **최근 회차의 캐시 압박**
  - 15분마다 가장 큰 조직의 최근 8일 heap 6~8천 블록(약 50~60MB)을 건드린다. 128MB shared_buffers의 절반 가까이다.
  - 상태 동기화가 늘 건드리는 페이지라 이미 캐시에 있을 수 있다 [미확인].
  - 운영에서 다른 질의가 느려지면 창 나누기(14절)로 간다.
- **신선도**: 숫자가 최대 15분(+회차 시간) 늦다. 급하면 "지금 갱신" 버튼을 쓴다. 워커가 멈추면 30분 뒤 경고가 뜬다.
- **35일 넘은 발송**: 상태·회신 분류·짝 변경, 수신거부 삭제는 반영하지 않는다.
- **사슬·규칙**: 깊이 10 초과 사슬과 지운 규칙은 회신 귀속과 다르게 보인다(5-4).
- **핵심 리드**: KPI와 목록(LeadInbox)의 기준이 달라 수가 다를 수 있다. 라벨로 구분한다. `customer_journey_alerts`에 (org_id, created_at) 색인이 없어 워커가 조직의 알림을 매번 다 읽는다. 1만 줄이 넘으면 색인을 별건으로 검토한다 [미확인 — 단계 0의 건수].
- **방문**: 사람 클릭만 본다. 발송 이력의 "사이트 행동" 배지(봇 포함)와 수가 다를 수 있다.
- **반영 순서**: 낮에 1차 반영하면 홈 90일 수가 18시까지 작게 보인다. 2차를 백필 뒤로 미루는 이유다.
- **첫 부팅 I/O**: 검색 사이클의 수신자 색인(부팅 뒤 CONCURRENTLY, heap 전체 읽기)과 백필이 첫 반영 때 겹칠 수 있다. 우선 백필만 낮에도 돌고 나머지는 발송 창 밖이다.
- **sendb-dev**: 워커가 개발 DB를 한 번 백필한다. 끄려면 `EMAIL_STATS_WORKER=off`.
- **워터마크**: 커밋 순서가 뒤집힌 극히 드문 줄은 빠질 수 있다.
- **분기 B 시점**: U3 뒤에 결정되면 0122가 필요하다.

**[미확인]**
- 운영 server_version·effective_cache_size·work_mem, 실제 캐시 적중률(단계 0)
- daily 표의 실제 크기
- 운영 인스턴스 수. 하나든 여럿이든 잠금으로 안전하다.
- 깊이 10 넘는 사슬의 존재
- 알림톡·레코드 질의 시간(단계 0)

**열린 질문 (사용자 결정)**
1. 단계 0(운영 기준선, 읽기 전용, 발송 창 밖) 측정을 U3 전에 할지. 하지 않으면 분기 A로 간다.
2. 운영 반영을 두 번(1차 표·워커, 2차 화면·홈)으로 나누고 평일 18시 이후에 할지. 권장안이다.
3. sendb-dev에서도 워커를 켤지. 기본안은 켜는 것이다.

---

이 DESIGN으로 진행한다. 계약이 있는 로직(U1·U2·U4~U8: 규칙·지표·귀속·SQL·워커·API·홈 변환)은 `/tdd`로, 화면 조립(U9)은 feature-builder로 한다. 구현을 Codex에 넘기기 전에 사용자에게 "Codex에 넘길까요? 기존 탭 / 새 탭"을 한 번 확인받는다.
