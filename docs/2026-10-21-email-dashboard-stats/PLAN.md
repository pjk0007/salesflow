# PLAN — 이메일 대시보드 재구성: 영업·리드 핵심 지표 + 일별 집계로 2초 안 로딩

- **track**: Full
- **사이클 ID**: `2026-10-21-email-dashboard-stats`

경로는 저장소 루트(`/Users/jaehun/Projects/salesflow`) 기준이고, 줄 번호는 2026-10-21 main 기준이다. 직전 사이클 문서는 `docs/archive/2026-10/email-open-pixel/`로 옮겨져 있다.

Full로 판정한 이유는 정해야 할 설계가 남아 있어서다. 지표 정의, 집계 표 구조, 갱신 정책, API, 화면 배치가 그것이다.

운영 DB는 아래 원칙을 지킨다.
- 측정용 읽기 조회(EXPLAIN 포함)는 사용자가 요청할 때만 한다.
- 운영 DB에 새 표를 만들고 집계 줄을 쓰는 일은 앱이 한다. 사용자가 요청한 운영 반영(main push) 뒤에만 일어난다.
- 그 밖의 운영 DB 쓰기·삭제는 하지 않는다.
- 커밋은 사용자 확인 뒤에 한다.

## 목표

/email 대시보드 탭을 다시 짠다. B2B 아웃바운드 영업·리드 회사가 매일 보는 지표를 한 화면에서 직전 기간과 비교해 본다. 대상 지표는 발송, 도달, 반송, 수신거부, 사람 오픈, 사람 클릭, CTOR, 회신, 메일 유입 방문, 핵심 리드다. 각 지표는 캠페인·후속 단계·명단·발신 주소·발신 도메인별로 나눠 볼 수 있다.

속도 문제도 같이 고친다. 지금은 화면 요청마다 원본 큰 표(`email_send_logs`)를 훑는다. 이를 **발송별 귀속 표 + 일별 집계 표 + 증분 갱신 워커** 구조로 바꾼다. 목표는 30일·90일 첫 로딩 2초 안이며, 직전 기간 비교를 포함한다. 홈 "발송 분석"의 이메일 숫자도 같은 집계 표를 읽어 함께 빨라진다.

기존 지표 정의는 바꾸지 않고 재사용한다. 사람 클릭(R6), 오픈(F1B), 발신 건강 갈래가 그 대상이다.

## 배경 (운영 실측: 2026-10-21, 매치스플랜 `d3adb8d3`, 30일)

- **응답 시간**
  - trends 28.6초, summary 27.6초다.
  - email-daily는 15.9초인데, summary가 끝난 뒤에야 시작한다. 그래서 날짜별 표가 보이기까지 약 45초가 걸린다.
  - 나머지 API는 0.7초 이하다.
- **원인**
  - `email_send_logs`의 heap이 748MB(본문 포함 넓은 행), 39.8만 행이다.
  - 30일치 5.8만 행이 2.3만 블록에 흩어져 있다. 그래서 Bitmap Heap Scan이 디스크에서 2.26만 블록을 읽는다(블록당 약 1ms).
  - shared_buffers가 128MB라 거의 매번 콜드 상태다.
  - 오픈·클릭 하위 질의(3~15ms)는 원인이 아니다.
- **90일**: 최대 조직이 15.8만 행이다(`docs/archive/2026-10/email-open-pixel/PROGRESS.md:9`). 같은 방식이면 1분을 넘는다(추정).

## 조사 결과

1. **요청이 직렬이다.** `EmailDashboard.tsx:78,95-102`는 summary·trends를 기다리는 동안 스피너만 그린다. `DailyEmailTable`(`:269`)은 그 뒤에야 마운트되어 email-daily를 부른다.
2. **홈도 같은 무거운 라우트를 반복해서 부른다.**
   - `useAnalytics.ts:69-82`가 trends·summary·templates를 60초마다 부른다. SWR 기본값이라 탭에 포커스가 올 때마다 다시 부른다.
   - summary는 질의 6개를 동시에 돌린다(`summary/route.ts:57-119`). 그래서 연결 풀(기본 20, `src/lib/db/index.ts:15-21`)에서 최대 6개를 쥔다.
   - 결국 열린 탭 수만큼 발송 워커와 연결·캐시를 다툰다.
3. **라우트별 비용**
   - trends: 발송 행마다 클릭 EXISTS를 돈다(`trends/route.ts:52`).
   - templates: 클릭 LEFT JOIN에 `count(distinct)`를 쓴다(`templates/route.ts:49-72`).
   - email-daily: 후속 메일의 캠페인을 찾으려고 부모 행을 재귀로 읽는다(`email-daily/route.ts:37-93`). 부모 행은 heap에서 무작위로 읽힌다.
4. **기간 경계가 화면마다 다르다.**
   - 화면은 UTC 날짜로 기간을 만든다(`EmailDashboard.tsx:63-76`, `useAnalytics.ts:44-53`).
   - summary·trends는 시작을 UTC 자정(KST 09시)으로, 끝을 서버 시간대로 읽는다(`summary/route.ts:47-49`).
   - email-daily만 KST다(`email-daily/route.ts:27-30`).
   - 그래서 같은 기간인데 카드 합계와 날짜별 표 합계가 어긋날 수 있다.
5. **색인 현황**
   - `email_send_logs`: pkey, `unsubscribe_token`(0060), 부팅 뒤 CONCURRENTLY로 만드는 `(org_id, sent_at)`·`request_id`(`send-log-indexes.ts:19-28`)뿐이다.
   - `records`: `(org_id)`만 있다(`schema.ts:299-303`).
   - `alimtalk_send_logs`: 기간 색인이 없다(`schema.ts:588-613`, 마이그레이션에도 없음).
   - 그래서 summary의 신규 레코드·알림톡 질의도 느릴 수 있다. 측정이 필요하다.
6. **늦게 바뀌는 값이 있다.**
   - NHN 결과 동기화는 처음 8일 창(`schema.ts:2204-2205`)에서 sent→failed를 쓴다(`email-status-sync.ts:608-668`).
   - 반송 안내는 7일 안에서 대체 짝짓기를 한다(`email-bounce-signal.ts:67,114-141`).
   - 오픈·클릭·회신·수신거부는 며칠에서 몇 주 뒤에도 온다.
7. **발송 종류와 상태**
   - trigger_type: `manual`·`auto`·`repeat`·`ai_auto`·`followup`·`ai_followup`·`visit_ack`, 그리고 시험용 `test_followup`, 가상 자료용 `journey_demo`(status `demo`, `inbox-journey/demo/route.ts:36`)가 있다.
   - status에는 `cancelled`(방문으로 후속 중단, `email-followup.ts:701,935`)와 `uncertain`도 있다.
   - 지금 대시보드는 시험·데모·취소 발송을 그대로 센다.
   - `followup`·`visit_ack`은 화면 라벨이 없다(`EmailDashboard.tsx:48-55`).
8. **재사용할 것**
   - 오픈 분자·분모: `openBaseSql`·`openedSendSql`(`email-open-sql.ts:5-15`)
   - NHN 접수 조건: `acceptedSendConditionSql`(`email-send-log-status.ts:51-53`)
   - 도달 갈래: `HEALTH_CATEGORY_SQL`(`sender-health-rules.ts:230-240`)
   - 캠페인·단계 귀속: `loadChains`·`ruleOf`(`email-reply-sync.ts:1080-1105`, `email-reply-rules.ts:1571-1575`)
   - 사이트 행동: `hasSiteAction`(`email-click-signals.ts:23-32`)
   - 회신 대상 조직: `isReplyScopeOrg`(`email-reply-list.ts:37-39`)
   - 직전 기간: `previousRange`·`rangeBounds`·`resolveComparisonPeriod`(`src/lib/tracker/date-range.ts:41-57`, `src/lib/tracker/comparison.ts:9-30`)
   - 증감 카드 모양: `src/components/tracker/ui/widgets/KpiCards.tsx`
   - 정기 작업 틀: `createJourneyScheduler`(`customer-journey-scheduler.ts:23-69`)
   - 일별 덮어쓰기 표 선례: `email_health_daily`(`schema.ts:2167-2193`)

## 1. 지표 매핑 — 영업·리드 회사가 보는 지표와 이 저장소의 데이터

- **상태**: 있음 / 부분(조직·사업·시점 한정) / 없음
- **자리**: KPI(상단 카드), 비교(축별 표), 추세, 운영(기존 카드), 밖(범위 밖)

| 묶음 | 지표 | 정의(요지) | 데이터·근거 | 상태 | 자리 |
|---|---|---|---|---|---|
| 발송 | 발송(NHN 접수) | NHN이 받아 간 메일 수. 시험·데모·취소는 뺀다 | `acceptedSendConditionSql`(`email-send-log-status.ts:51-53`) | 있음 | KPI |
| | 신규 컨택(첫 메일) | 단계 0 발송 수 | `parent_log_id` 사슬(`schema.ts:748`, `email-reply-sync.ts:1080-1105`) | 있음 | KPI 보조 |
| | 실패·대기·접수 거절 | failed·rejected / pending / NHN 미접수(`send_reject`) | `HEALTH_CATEGORY_SQL` | 있음 | 비교 |
| 도달 | 도달률 | 배달 확정 ÷ 확정 발송. 갈래는 발신 건강과 같다 | `nhn_status_code`·`delivery_fail_*`(`schema.ts:759-769`) | 있음(NHN 결과가 온 발송만 확정) | KPI |
| | 반송률(하드·소프트) | SST3 + 반송 안내(dsn) | `delivery_status_code`, `email_bounce_signals.kind`(`schema.ts:2066-2099`) | 있음(하드·소프트 구분은 반송 안내가 온 것만) | 비교·추세 |
| | 발신 쪽 실패 | SST7·8·SPF·DKIM·DMARC | `delivery_fail_side`(`schema.ts:769`) | 있음 | 비교(주소·도메인) |
| | NHN 수신거부 | SST5(이미 NHN 거부 목록에 있는 주소) | `sender-health-rules.ts:221` | 있음 | 비교 |
| 거부·불만 | 수신거부율 | 발송에 연결된 수신거부(link·one_click) ÷ 성공 | `email_unsubscribes.send_log_id·source`(`schema.ts:824-840`, `email-unsubscribe.ts:137-159`) | 있음(수동 등록은 발송 연결이 없다) | KPI |
| | 스팸 신고 | `kind='complaint'` | `email_bounce_signals`(`schema.ts:2083`) | 부분(회신 읽기 대상 조직만) | KPI 보조 |
| 반응 | 사람 오픈율 | (사람 오픈 ∪ 사람 클릭) ÷ open_tracked 성공 | `email_open_logs`, `email-open-sql.ts:5-15` | 부분(0120, 2026-10-21 이후 발송만) | KPI |
| | 사람 클릭률 | 사람 클릭이 있는 발송 ÷ 성공(현행 유지) | `email_click_logs.is_bot`(`schema.ts:782-799`) | 있음 | KPI |
| | CTOR | 오픈 대상 중 사람 클릭 ÷ 오픈 | 위 두 표 | 부분(0120 이후) | KPI 보조·비교 |
| | 회신율 | 사람 회신(`human`, `matched`). 기준은 Q1 | `email_replies.kind·match_status·send_log_id·root_log_id·step_index`(`schema.ts:1923-1997`) | 부분(회신 읽기 대상 조직만) | KPI |
| | 자동응답 | `kind='auto_reply'` | 같은 표 | 부분 | 비교 |
| | 긍정 회신(관심) | 회신 의도 분류 | 실험 결과의 `intent`만 있다(`email-experiments/results.ts:181-195`) | 없음 | 밖 |
| 사이트·리드 | 메일 유입 방문 | 사람 클릭의 `click_id`로 이어진 같은 조직 사이트 세션이 있는 발송 | `tracker_sessions.click_id`(`schema.ts:1744,1750`), `customer-journey-source.ts:37-41` | 부분(트래커를 설치한 사업만) | KPI |
| | 사이트 행동 | 그 세션의 CLICK·CUSTOM 이벤트 | `email-click-signals.ts:23-32` | 부분 | KPI 보조·비교 |
| | 깊이 방문 | deep·intent 알림이 난 발송 | `deep_visitor_alerts.send_log_id·level`(`schema.ts:1837-1866`) | 부분 | 비교 |
| | 핵심 리드 | 고객 여정 판정이 urgent·highlight인 고객(판정일 기준) | `customer_journey_alerts`(`schema.ts:1873-1891`), `customer-journey-leads.ts:16-41` | 부분(여정 알림을 켠 사업) | KPI |
| | 핵심 리드 응대 | 처리 상태·기한 | `journey_lead_followups`(`schema.ts:1894-1916`) | 있음 | 운영(기존 목록) |
| | 웹폼 제출 | 제출하면 레코드가 생긴다. 메일 귀속은 `adName`에 제목 문자열만 남는다 | `forms/[slug]/submit/route.ts:73-83`, `attribution/resolve-attribution.ts:21-44` | 부분(발송 id가 남지 않는다) | 밖 |
| | 상담 시작 | 경로가 연결된 상담(세션→클릭→발송) | `inbox_conversations.journey_context·record_id`(`inbox-schema.ts:101-148`), `inbox-journey/context.ts:5-13` | 부분(운영 사용량 미확인) | 밖 |
| | 가입 | `record_events.type='signup'` | `tracker/analytics-queries.ts:115-121` | 부분(이벤트를 보내는 사이트만) | 밖(트래커 화면) |
| | 신규 레코드 | 기간 안에 생성된 레코드. 가져오기 포함이고 출처 칸이 없다 | `records.created_at`(`schema.ts:283-304`) | 있음(리드와 구분할 수 없다) | 홈 카드 유지 |
| 성과 | 미팅 | 실험 결과의 `meeting`만 있다 | `results.ts:185` | 없음 | 밖 |
| | 딜·성사·매출 | 단계 won/lost, 금액 | `crm_deals`(`customer-sales-schema.ts:18-22,60-88`) ↔ `crm_contacts.record_id`(`customer-platform-schema.ts:58`) | 부분(표는 있지만 운영 사용량·메일 귀속 미확인) | 밖 |
| | 비용(CPL·회신당) | 발송비·광고비 | 지출 칸이 없다(`ad_*`, `schema.ts:1420-1513`). AI 문구 생성 비용만 있다(`ai-copy-schema.ts:191`) | 없음 | Q4 |
| 비교 축 | 캠페인 | 첫 메일의 AI 규칙·템플릿 연결·수동. 후속은 부모에서 물려받는다 | `ruleOf`(`email-reply-rules.ts:1571-1575`) | 있음 | 비교 |
| | 후속 단계 | 사슬 깊이(0 = 첫 메일) | `loadChains`, `email_followup_queue.step_index`(`schema.ts:956`) | 있음 | 비교 |
| | 명단·제품 | `partition_id`→파티션·워크스페이스, AI 규칙의 `product_id` | `schema.ts:734`, `email-daily/route.ts:46-52` | 있음(제품은 AI 규칙만) | 비교 |
| | 발신 주소·도메인 | `sender_profile_id`, `sender_email`의 도메인 | `schema.ts:754-756`, `sender-health.ts:365` | 있음(0073 이전 로그는 주소를 모른다) | 비교 |
| | 발송 유형 | `trigger_type` | `schema.ts:744` | 있음 | 비교 |
| | 문구 실험 | arm별 결과 | `email_copy_assignments`(`email-experiment-schema.ts:78-122`), 실험 탭 | 있음 | 링크 |
| 운영 | 발신 건강·대기열 | 명단·주소 실패율, 대기 | `email_health_daily`, 기존 카드 | 있음 | 운영(그대로) |
| 기간 | 직전 기간 비교 | 같은 길이의 직전 기간 대비 증감 | `tracker/date-range.ts:49-57`, `tracker/comparison.ts:9-30` | 있음(재사용) | KPI 증감 |

## 2. 정보 구조 제안

1. **상단 KPI 8칸**
   - 깔때기 순서로 놓고, 직전 기간 대비 증감을 붙인다. 카드마다 분자·분모 툴팁을 단다.
   - 순서: 발송(NHN 접수, 첫 메일 n) → 도달률(반송 n) → 사람 오픈율(추정) → 사람 클릭률(CTOR) → 메일 유입 방문(행동 n) → 회신율(자동응답 제외) → 핵심 리드(긴급·주목, 미처리 n) → 수신거부율(스팸 신고 n)
   - 수신거부율은 낮을수록 좋다.
   - 최종 구성은 Q1에서 확정한다.
2. **비교 표**
   - 축을 바꿔 보고, 열로 정렬한다.
   - 축: 캠페인(후속 포함, 기본), 후속 단계, 명단, 발신 주소, 발신 도메인, 발송 유형, 날짜
   - 열: 발송, 도달률, 반송률, 오픈율, 클릭률, CTOR, 회신율, 수신거부율, 방문
   - 지금의 `DailyEmailTable`과 "발송 유형별 성과" 표는 이 표의 날짜 축·발송 유형 축으로 흡수한다.
3. **추세**
   - 일별 발송량은 막대로, 오픈율·클릭률·회신율은 선으로 그린다.
   - 보조 탭에 반송률·수신거부율을 둔다.
   - 최근 3일은 "반응이 쌓이는 중"으로 표시한다.
4. **운영 상태**: 지금 카드를 그대로 둔다(이미 0.7초 이하). 발신 건강 띠·카드, 발송 대기열, 핵심 리드 목록(`KeyLeadsCard`)이다.
5. **링크**: 문구 실험(진행 중 n개), 회신 탭, 발송 이력으로 보낸다. 결과 화면을 새로 만들지 않는다.
6. **안내 줄**
   - 집계 기준 시각
   - 연동이 안 된 지표는 사유를 적는다("회신 연동 안 됨", "사이트 연동 안 됨").
   - 기존 오픈 추정 안내(`OpenRateNotice`)를 그대로 쓴다.

## 3. 속도: 접근법 비교와 추천

아래 수치는 추정이다(DESIGN에서 fixture로 확인). 가장 큰 조직, 콜드 캐시, 블록당 약 1ms를 가정했다.

| 기준 | (a) 커버링 색인 (INCLUDE status·trigger_type·open_tracked·…) | (b) 일별 집계 + 증분 워커 | (c) 둘 다 |
|---|---|---|---|
| 화면 요청이 읽는 양 | 30일 약 1.2천, 90일+직전 약 6~7천 색인 페이지. 최근 8일은 상태 갱신으로 visibility map이 비어 heap 확인이 붙는다. 콜드 1~7초 | 집계 표만 읽는다. KPI·추세는 수백 줄, 비교 표는 수만 줄 이하(수백 페이지). 콜드 0.3초 안 | (b)와 같다 |
| 2초 목표 | 30일 단독이면 가능하다. 90일+직전과 후속의 캠페인 귀속(부모 무작위 읽기)은 어렵다 | 충족 | 충족 |
| 운영 메모리(128MB) | 넓은 색인 50~70MB가 캐시를 다툰다 | 집계 표 수 MB. 귀속 표 수십 MB는 워커만 읽는다 | 둘 다 |
| 쓰기 부하 | 모든 insert와 상태 갱신(발송당 2~4회)이 넓은 색인 줄을 더 쓴다 | 새 발송마다 귀속 1줄, 5분마다 바뀐 집계 줄만 | 둘 다 |
| 정확성 | 실시간이고 정확하다 | 최근 8일은 최대 5분, 9~35일은 최대 하루 늦다. 35일 넘은 발송의 상태 변경은 따라가지 못한다(드묾) | (b)와 같다 |
| 새 지표(회신·수신거부·방문) | 요청마다 행별 하위 질의가 다시 돈다 | 워커가 한 번 계산한다 | (b)와 같다 |
| 마이그레이션 위험 | 748MB 표에 CONCURRENTLY로 만든다. 전체를 한 번 읽고, 실패하면 INVALID 재시도(기존 관례로 가능) | 작은 새 표만 만든다. 백필이 원본을 한 번 읽는다(조각·쉼·이어하기) | 둘 다 |
| 되돌리기 | `DROP INDEX CONCURRENTLY` | 코드만 되돌린다. 표는 남아도 무해하다 | 둘 다 |

**추천: (b).**
- 메모리, 쓰기, 90일+직전 2초, 새 지표 확장 모두에서 (b)가 앞선다.
- 잃는 것은 최대 5분의 신선도(Q2)와, 35일 넘은 발송의 드문 늦은 변경이다.
- 원본을 읽는 무거운 일의 시점이 바뀐다. 지금은 화면 요청마다(홈은 60초마다) 일어난다. (b)에서는 5분마다 최근 8일, 하루 한 번 35일만 읽는다.
- (c)는 지금 하지 않는다. fixture에서 워커 회차나 야간 재계산이 기준을 넘을 때만, 워커 전용의 좁은 색인을 별건으로 검토한다.
- 택하지 않은 다른 안도 있다.
  - materialized view: REFRESH 때마다 전체를 다시 계산한다.
  - 응답 캐시: 첫 로딩과 캐시 만료 때 같은 무거운 질의가 돈다. 캐시도 인스턴스마다 따로다.
  - 본문 분리·TOAST 조정: 근본 원인을 고치지만 큰 표를 다시 써야 한다(별건).

**(b)의 구성** (이름과 칸은 DESIGN에서 확정)
- **발송 귀속 표**: 발송 1건당 1줄이다. 바뀌지 않는 속성을 한 번 계산해 둔다.
  - 담는 것: KST 발송일, 워크스페이스, 명단, 유형, 캠페인 종류·id, 단계, 발신 프로필·도메인, open_tracked, 제외 여부
  - id 순서로 채운다. 부모 id가 늘 더 작으므로, 후속은 부모의 귀속 줄을 물려받으면 된다. 그래서 부모 행을 heap에서 무작위로 읽지 않는다.
- **일별 집계 표**: (조직, KST 날짜, 축) 단위로 더할 수 있는 수를 담는다.
  - 성공, 도달 갈래, 오픈 대상·오픈, 클릭, 오픈 중 클릭, 회신·자동응답, 첫 메일 시퀀스 회신, 수신거부, 스팸 신고, 방문·행동
  - 축 조합이 폭증하지 않게 축 묶음별로 나눌지는 DESIGN에서 정한다.
- **집계 상태 표**: 조직별 기준 시각, 채운 범위, 워터마크, 마지막 오류를 담는다.
- **워커**
  - 기존 스케줄러 틀을 쓰고, advisory 잠금과 예약 연결 1개, 문장 시간 제한을 둔다.
  - 수동·정기 실행 경로(`CRON_SECRET`)를 둔다.
- **읽기**: 대시보드 API와 홈 3개 라우트의 이메일 부분은 집계 표와 작은 이름 표만 읽는다.

**갱신 규칙**
- **5분마다**: 최근 8일(오늘 포함)을 다시 계산한다. 이 창은 NHN 동기화 창(8일)과 반송 짝짓기(7일)를 덮는다.
- **야간, 발송 창 밖**
  - 9~35일을 다시 계산한다.
  - 35일보다 오래된 발송에 늦은 오픈·클릭·회신·수신거부가 왔으면 그 (조직, 날짜)만 다시 계산한다. 감지는 각 표의 id 워터마크로 한다.
- **백필**: 배포 직후 최근 60일(30일 화면 + 직전 비교)을 먼저 채운다. 나머지는 발송 창 밖에서 조각으로 이어 채운다.
- **코호트**: 메일 지표는 발송일 기준 코호트다. 그 기간에 보낸 메일이 이후에 받은 반응까지 센다. 핵심 리드는 판정일 기준이다.

## 단계별 작업

0. **운영 기준선** — 읽기 전용이고, 사용자가 요청할 때만, 발송 창 밖에서 한다.
   - d3adb8d3의 30일·90일로 4개 라우트를 `EXPLAIN (ANALYZE, BUFFERS)`한다. summary의 신규 레코드·알림톡 하위 질의도 포함한다.
   - `email_send_logs`·`records`·`alimtalk_send_logs`의 relpages·relallvisible·dead tuple·autovacuum 상태를 본다.
   - 설정값을 본다: server_version, shared_buffers, effective_cache_size, work_mem.
   - `crm_deals`·경로 연결 상담·여정 알림이 실제로 얼마나 있는지 센다.
1. **DESIGN**
   - Q1~Q4 답을 반영한다.
   - 지표 정의서, 표·워커·API·화면 설계, fixture와 성능 관문, TDD 계약, Codex 구현 단위를 쓴다.
   - 구현은 DESIGN 승인 뒤 Codex에 넘길지 사용자에게 묻는다.
2. **운영 규모 fixture**: 만들고, 옛 라우트의 2만 블록대 읽기를 재현한다. → B17 기준
3. **순수 규칙 TDD**: `src/lib/email-stats/rules.ts`에 KST 기간·직전 기간, 재계산 창, 비율·증감(null 규칙), 시험·데모·취소 제외, 귀속 상속을 둔다. → B3·B5·B13·B24
4. **스키마**: 0121, journal, 스키마 파일, 정적 테스트. → B1
5. **귀속 채우기 + 일별 재계산 SQL + 동등성 테스트**. → B2·B4
6. **워커**: 5분 회차, 야간, 백필, 늦은 이벤트, 상태 표, 잠금, 수동 실행 경로, instrumentation. → B6~B10
7. **대시보드 API**: 정적 테스트, fixture 성능. → B11~B17
8. **홈**: 3개 라우트의 이메일 부분을 집계 표로 바꾸고 응답 모양은 유지한다. 자동 새로고침 주기도 바꾼다. 새로고침 주기 변경은 먼저 따로 내보낼 수 있다. → B26·B27
9. **화면**: `src/components/email/dashboard/`로 새로 짜고, 대체된 날짜별 표·훅·라우트를 지운다. → B20~B25·B29
10. **검증**: 아래 검증 방법대로 한다. → B18·B28·B30
11. **반영**
    - 커밋은 사용자 확인 뒤에 한다.
    - 운영 반영(main push)은 사용자가 요청할 때만 한다.
    - 반영 뒤 백필 진행을 확인한다.
    - 운영 측정과 화면 확인은 사용자가 요청할 때 한다. → B19

## 건드릴 파일

**새 파일** (이름은 DESIGN에서 확정)
- `drizzle/0121_email_stats.sql`: 귀속·일별 집계·상태 표. journal idx 122, when은 1792605600000보다 크게.
- `src/lib/db/email-stats-schema.ts`
- `src/lib/email-stats/rules.ts`(+test): 순수 규칙
- `src/lib/email-stats/sql.ts`(+test): 지표 SQL 조각. 기존 오픈·도달 조각을 재사용한다.
- `src/lib/email-stats/attribution.ts`: 귀속 채우기(부모 상속)
- `src/lib/email-stats/rollup.ts`: (조직, 날짜) 재계산, 바뀐 줄만 쓰기
- `src/lib/email-stats/worker.ts`: 회차·야간·백필·잠금
- `src/lib/email-stats/read.ts`: 집계 표 읽기
- `src/lib/email-stats/static.test.ts`, `src/lib/email-stats/migration.test.ts`
- `src/app/api/analytics/email-stats/route.ts`: GET
- `src/app/api/analytics/email-stats/process/route.ts`: POST, `CRON_SECRET`
- `src/components/email/dashboard/{types,api,hooks,utils}/…`(utils는 +test)
- `src/components/email/dashboard/ui/{EmailDashboard,KpiGrid,CompareTable,TrendPanel,StatsFreshness}.tsx`
- `docs/{사이클}/evidence/`: fixture SQL, 측정 기록

**고칠 파일**
- `src/instrumentation.ts`: 워커 시작 한 줄
- `src/lib/db/schema.ts`: export 한 줄
- `drizzle/meta/_journal.json`
- `src/app/email/page.tsx`: import 경로만 바꾼다(조립 유지)
- `src/app/api/analytics/{summary,trends,templates}/route.ts`: 이메일 부분을 `read.ts`로
- `src/hooks/useAnalytics.ts`: KST 날짜, 새로고침 주기
- `src/lib/email-open-sql.ts`: 필요하면 `SendLogRef`에 참조 이름만 더한다. 정의는 그대로다.

**지울 파일**: 새 화면으로 대체된다. 다른 참조가 없는지 grep으로 확인한 뒤 지운다.
- `src/components/email/EmailDashboard.tsx`(dashboard/ui로 옮긴다)
- `src/components/email/DailyEmailTable.tsx`
- `src/hooks/useEmailAnalytics.ts`, `src/hooks/useEmailDaily.ts`
- `src/app/api/analytics/email-daily/route.ts`

**바꾸지 않음**
- 발송 7경로
- 클릭·오픈 기록과 판정(R6, F1B)
- 발신 건강, 결과 동기화, 회신 읽기
- `SendHealthBanner`·`SendHealthCard`·`SendQueueOverviewCard`·`KeyLeadsCard`
- 트래커 화면, MCP
- 새 의존성은 없다.

## behavior 목록

- B1 — 마이그레이션 0121은 새 집계 표만 만든다. `email_send_logs` 등 기존 큰 표에는 ALTER·FK·색인을 걸지 않고, 재부팅해도 다시 돌지 않는다 (P1)
- B2 — 발송마다 귀속(KST 발송일·워크스페이스·명단·유형·캠페인 종류/id·단계·발신 프로필·도메인)이 한 번 정해진다. 후속은 부모의 캠페인을 물려받고 단계가 1 늘어나며, 회신 귀속(`loadChains`·`ruleOf`)과 결과가 같다 (P1)
- B3 — 시험(`test…`)·데모(`journey_demo`/`demo`)·취소(`cancelled`) 발송은 발송·비율 지표에 들어가지 않는다 (P1)
- B4 — 일별 집계의 모든 지표가 같은 조건의 원본 직접 집계(참조 SQL)와 fixture에서 한 건도 다르지 않다. 대상은 접수·성공·실패·대기, 도달 갈래, 오픈 대상·오픈, 사람 클릭, 오픈 중 클릭, 회신·자동응답·시퀀스 회신, 발송 연결 수신거부, 스팸 신고, 방문·행동이다 (P1)
- B5 — 모든 지표의 기간 경계는 KST 달력 날짜(00:00:00~23:59:59.999 +09:00)다. 같은 기간이면 KPI 합계, 추세 합계, 비교 표 합계가 같다 (P1)
- B6 — 워커는 5분마다(설정값) 최근 8일(오늘 포함)을 다시 계산하고, 값이 바뀐 줄만 쓴다. 바뀐 것이 없으면 쓰기가 0이다 (P1)
- B7 — 늦게 온 사람 오픈·클릭·회신·수신거부와 sent→failed 변경이 반영된다. 8일 안 발송이면 다음 회차에, 9~35일 발송이면 다음 야간 재계산에 반영된다 (P1)
- B8 — 35일보다 오래된 발송에 새 사람 오픈·클릭·회신·수신거부가 오면, 그 (조직, 날짜)만 야간에 다시 계산된다 (P2)
- B9 — 백필은 최근 60일을 먼저 조각으로 채우고, 나머지는 발송 창(평일 09~18시 KST) 밖에서 이어 채운다. 중단돼도 이어서 끝난다 (P1)
- B10 — 워커는 advisory 잠금으로 한 인스턴스에서만 돈다. 예약 연결 하나와 문장 시간 제한을 쓴다. 실패해도 서버와 발송 경로에 영향이 없고, 다음 회차에 다시 한다 (P1)
- B11 — 대시보드 API(GET)는 로그인과 조직 격리를 지키고 집계 표(+작은 이름 표)만 읽는다. `email_send_logs`·`email_click_logs`·`email_open_logs`를 읽지 않으며(정적 테스트), 오류는 `{ success:false, error }` 한국어로 준다 (P1)
- B12 — API가 현재 기간과 직전 같은 길이 기간의 KPI, 증감률(비교값이 0이면 null), 일별 추세, 축별 비교, 기준 시각(asOf), 채워진 기간을 준다 (P1)
- B13 — 비율은 DESIGN 정의서의 식과 같다. 오픈율·CTOR은 open_tracked 발송만 센다. 클릭률은 현행(사람 클릭 ÷ 성공)을 유지한다. 도달·반송은 `HEALTH_CATEGORY_SQL` 갈래를 쓴다. 분모가 0이면 null이고 화면은 "—"다 (P1)
- B14 — 회신 읽기 대상이 아닌 조직의 회신 지표와, 트래커 사이트가 없는 범위의 방문 지표는 0%가 아니라 "연동 안 됨"으로 보인다 (P1)
- B15 — (Q3) workspaceId를 주면 그 워크스페이스의 발송만, 주지 않으면 조직 전체를 센다. 다른 조직의 workspaceId를 주면 400이다 (P1)
- B16 — 화면에 집계 기준 시각과 채워진 기간이 보인다. 채워지기 전 날짜는 "집계 준비 중"이다. 기준 시각이 30분 넘게 지나면 경고가 보인다 (P2)
- B17 — 운영 규모 fixture에서 대시보드 API의 30일·90일(+직전) 질의가 읽는 블록(hit+read)은 1,500 이하이고, 데운 상태 응답은 300ms 이하다 (P1)
- B18 — 같은 fixture에서 워커 최근 8일 회차는 가장 큰 조직 5초, 야간 재계산은 전체 10분 이내이고 백필은 끝까지 간다. 수치는 DESIGN에서 확정한다 (P2)
- B19 — 운영 반영 뒤 /email 대시보드 30일·90일 첫 KPI 화면이 2초 안에 그려진다(ego-browser 네트워크 기록) (P1)
- B20 — 상단 KPI 카드(Q1 확정안)가 직전 기간 대비 증감과 함께 보인다. 낮을수록 좋은 지표(반송·수신거부)는 증감 색이 반대다. 카드마다 분자·분모 툴팁이 있다 (P1)
- B21 — 비교 표는 축을 바꿔 보고 열 머리로 정렬할 수 있다. 캠페인 이름은 AI 규칙·템플릿 연결·템플릿 이름에서 가져오고, 지워진 캠페인은 "(삭제됨)"으로 보인다 (P1)
- B22 — 추세는 일별 발송량과 오픈율·클릭률·회신율 선을 보여 주고, 최근 3일에 "반응이 쌓이는 중" 표시가 있다 (P2)
- B23 — KPI, 추세, 비교 표, 운영 카드(발신 건강·대기열·핵심 리드)가 서로를 기다리지 않고 각자 로딩 표시 뒤 그려진다 (P1)
- B24 — (Q2) 기간은 7·30·90일 프리셋(기본 30일)과 직접 지정이다. 날짜는 KST로 계산하고 오늘을 포함한다 (P1)
- B25 — 대시보드 `.tsx`에는 상태·계산·페칭이 없고(hooks·utils로 분리), 새 파일은 200줄 이하다(정적 테스트) (P1)
- B26 — 홈 발송 분석의 이메일 숫자(카드·추세·규칙별 Top10)가 같은 집계 표에서 온다. `/api/analytics/{summary,trends,templates}`의 응답 모양은 그대로이고, 규칙별은 후속을 포함한 캠페인 귀속으로 센다 (P1)
- B27 — 홈과 대시보드의 자동 새로고침이 60초에서 집계 주기(5분)로 바뀌고, 탭 포커스마다 다시 요청하지 않는다 (P2)
- B28 — 클릭률·오픈율 정의, R6, 오픈 판정·기록, 발송 경로는 바뀌지 않고 기존 테스트가 통과한다 (P1)
- B29 — email-daily 라우트, `DailyEmailTable`, `useEmailDaily`, `useEmailAnalytics`가 지워지고 참조가 남지 않는다 (P2)
- B30 — `pnpm test`, `pnpm exec tsc --noEmit`, 바꾼 파일 eslint가 통과한다 (P1)

## 리스크/불확실성

- **신선도**
  - 숫자가 최대 5분 늦다.
  - 워커가 멈추면 숫자도 멈춘다. 그래서 기준 시각을 보이고 30분 넘으면 경고한다(B16).
- **숫자가 바뀐다** — 반영 전에 팀에 알린다.
  - 기간 경계가 KST로 바뀐다.
  - 시험·데모·취소를 뺀다.
  - 홈 규칙별이 후속을 포함한다.
  - 도달률이 확정 기준이다.
- **코호트 성숙**: 최근 며칠은 회신·클릭률이 낮게 보인다.
- **늦은 변경 누락**: 35일 넘은 발송에 대한 수동 "결과 확인"이나 회신 분류 변경은 반영되지 않는다(드묾).
- **백필 I/O**: 원본 전체를 한 번 읽는다(수 분, 추정). 그래서 최근 60일만 바로 채우고 나머지는 발송 창 밖에서 채운다.
- **워커 비용**
  - 최근 8일은 상태 동기화가 늘 건드리는 페이지라 캐시에 있을 가능성이 높다(미검증).
  - 야간 9~35일은 콜드로 읽는다. 가장 큰 조직이 2만 블록 안팎이다(추정).
  - fixture에서 기준을 넘으면 (c)를 검토한다.
- **차원 폭증**: 모든 축을 한 표에 곱하면 줄이 커진다. 축 묶음별로 표를 나누는 것을 DESIGN에서 정한다.
- **연동 한정 지표**
  - 회신·스팸 신고는 회신 읽기 대상 조직에서만 의미가 있다.
  - 방문은 트래커를 설치한 사업, 핵심 리드는 여정 알림을 켠 사업에서만 의미가 있다.
  - 오픈율은 0120 이후 발송만이라 당분간 표본이 작다.
- **홈의 알림톡·신규 레코드 질의**: 색인이 없어 느릴 수 있다.
  - 단계 0에서 측정한다.
  - 1초를 넘으면 같은 일별 집계에 알림톡·레코드 일별 수를 더하는 것을 기본안으로 DESIGN에서 정한다.
- **핵심 리드 수**: KPI(판정 고객 수)와 `LeadInbox` 목록 수가 기준이 달라 어긋날 수 있다. 라벨로 구분한다.
- **sendb-dev**: 워커가 돌지 않아 대시보드가 비어 보일 수 있다. 외부 발송이 없는 집계 워커만 허용할지 DESIGN에서 정한다.
- **로컬 측정**: macOS의 OS 캐시 때문에 콜드 시간이 운영보다 짧게 나온다. 그래서 읽은 블록 수로 판정한다.
- **운영 반영**: main push가 곧 운영 배포다. 새 표만 만들고 큰 표에는 FK를 걸지 않는다(`email_replies`·`email_bounce_signals` 관례). 그래서 잠금 위험은 낮다.

## 검증 방법

1. `pnpm test`: TDD 대상은 구현 전에 RED를 확인한다. `tsc --noEmit`과 바꾼 파일 eslint도 돌린다. → B25·B28·B30
2. 0121: 빈 DB로 부팅해 표를 확인한다. 재부팅하면 다시 돌지 않는지 보고, 큰 표 DDL이 없는지 정적 테스트로 본다. → B1
3. **동등성**
   - fixture에 아래를 넣는다.
     - 상태·NHN 코드·반송 안내
     - 오픈, 봇을 포함한 클릭
     - 사람·자동·반송 회신
     - link·manual 수신거부
     - 세션·이벤트
     - 3단 후속 사슬
     - 시험·데모·취소 발송
   - 워커를 한 번 돌린다.
   - 모든 (조직, 날짜, 축, 지표)를 참조 SQL과 대조해 차이가 0이어야 한다. → B2~B5
4. **늦은 변경**
   - 3일·20일·50일 전 발송에 사람 오픈·클릭·회신·수신거부를 더한다.
   - 3일 전 발송을 sent→failed로 바꾼다.
   - 5분 회차, 야간, 늦은 이벤트 경로를 거친 뒤 기대값이 나오는지 본다. → B6~B8
5. **성능** (로컬, 운영 규모 fixture)
   - fixture 구성: 발송 40만, 본문 1.5~2KB(heap 약 750MB), 3개 조직을 시간순으로 섞어 넣는다(큰 조직 60%). 180일, 후속 30%, shared_buffers 128MB.
   - 옛 라우트를 `EXPLAIN (ANALYZE, BUFFERS)`로 돌려 2만 블록대 읽기를 재현한다.
   - 새 API를 30·90일(+직전)로 잰다. 블록 수와 시간을 재시작 직후와 데운 뒤 각각 3회씩 재고 중앙값을 쓴다.
   - 워커 회차, 야간 재계산, 백필의 시간과 블록도 기록한다. → B9·B17·B18
6. **운영** (사용자가 요청할 때만, 읽기 전용, 발송 창 밖)
   - 반영 전: 기준선 EXPLAIN과 카탈로그 통계(단계 0)
   - 반영 뒤: 백필 완료와 워커 회차 시간을 로그로 확인한다.
   - 1~2일치 집계를 원본과 읽기 조회로 대조한다. → B10·B19
7. **ego-browser**: 로컬 fixture DB와 운영 반영 뒤 /email·홈에서 아래를 본다. → B14~B16·B19~B24·B26·B27
   - 30·90일 첫 로딩 시간(네트워크 기록)
   - KPI 증감과 툴팁
   - 축 전환과 정렬
   - 추세
   - "연동 안 됨"과 "집계 준비 중"
   - 다크 모드

## 범위 밖

- 미팅·딜·매출의 메일 귀속, 긍정 회신 분류, 비용(CPL, Q4)
- 웹폼 제출에 발송 id 남기기, 상담 시작·가입 지표
- 고유 수신자 수: 일별로 더할 수 없다. 첫 메일 수로 대신한다.
- 요일·시간대 분석, 받는 쪽 메일 서비스(gmail·naver 등) 축
- 알림톡 지표 개편, 트래커 화면, MCP 툴, 문구 실험 결과 화면(링크만 둔다)
- `email_send_logs` 본문 분리·TOAST 조정·파티셔닝: 근본 원인이므로 별건으로 제안한다.
- 커버링 색인((c)): 측정 결과에 따라 별건으로 다룬다.
- 멤버 권한별 숫자 제한, CSV 내보내기, 정기 리포트 메일
- 발송 이력 표, 발신 건강·대기열·핵심 리드 카드 변경

## DESIGN에서 정할 것

1. **지표 정의서**
   - 분자·분모·코호트·제외·null 규칙(Q1 반영)
   - 도달률 분모에 발신 쪽 실패와 SST5를 넣을지
2. **표 설계**
   - 귀속 표, 일별 집계 표, 상태 표의 칸·키·색인
   - 축 묶음별로 표를 나눌지
   - 바뀐 줄만 쓰는 upsert, 사라진 조합 정리
3. **워커**
   - 주기, 창(8·35일), 야간 시각
   - 워터마크, 백필 순서·조각·쉼
   - 잠금, 시간 제한
   - 실행 위치(instrumentation 회차 또는 CloudType 정기 호출), sendb-dev에서 실행할지
4. **API 계약**: 한 번에 받을지 나눠 받을지, 응답 모양, asOf·coverage
5. **홈**: 3개 라우트 내부를 바꾸는 방식, 알림톡·신규 레코드 처리(단계 0 결과에 따라)
6. **화면**: 배치, 200줄 기준의 컴포넌트 분할, 재사용(`KpiCards` 모양, `ComparisonSelector`, `date-range-picker`), 빈 상태 문구
7. fixture 설계, 성능 관문 수치, TDD 계약 표, Codex 구현 단위

## 결정 (사용자 답)

- **Q1** — **결정**: 상단 KPI는 2절의 8개(발송·도달률·사람 오픈율·사람 클릭률(CTOR)·메일 유입 방문·회신율·핵심 리드·수신거부율)로 확정한다. 회신율 분모는 첫 메일 기준(그 사람에게 간 시퀀스에서 사람 회신이 1건이라도 오면 1)이다. (2026-10-21 사용자 "추천대로")
  - 추천: 8개 그대로, 회신율은 첫 메일 기준으로 한다.
  - 이유: 아웃바운드는 보통 "연락한 사람 중 몇 %가 답했나"로 본다. 후속이 많을수록 메일 한 통 기준은 낮게 왜곡된다.
  - 메일 한 통 기준 값은 후속 단계 축 표에서 보인다.
- **Q2** — **결정**: 기간은 기본 30일, 7·30·90일 + 직접 지정, 직전 같은 길이 기간 대비 증감이다. 숫자는 최대 15분 늦게 반영되고(2026-10-21 설계 검토에서 5분→15분으로 바꿈) 화면에 "집계 기준 HH:MM"과 "지금 갱신" 버튼을 둔다. (2026-10-21 사용자 "추천대로")
  - 추천: 예.
  - "오늘"만 원본에서 바로 세는 안도 가능하다. 다만 계산 경로가 둘이 되어 숫자가 어긋날 위험이 생겨 권하지 않는다.
- **Q3** — **결정**: 워크스페이스(사업) 선택을 더한다. 기본은 "전체"다. (2026-10-21 사용자 "추천대로")
  - 추천: 워크스페이스 선택을 더한다(기본 "전체").
  - 숨긴 워크스페이스는 선택 목록에서만 빼고 "전체" 합계에는 넣는다.
  - 멤버 권한별 제한은 지금처럼 두지 않는다.
- **Q4** — **결정**: 리드당·회신당 비용(CPL)은 이번에 넣지 않는다. (2026-10-21 사용자 "추천대로")
  - 추천: 이번엔 넣지 않는다.
  - 이유: 비용 데이터가 AI 문구 생성 비용뿐이라 반쪽이다.
  - 필요하면 다음 사이클에 조직 설정(메일 1통 단가·월 고정비)부터 만든다.

