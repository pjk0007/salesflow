# 웹폼 유입 리드에 캠페인 출처 남기기

- **track**: Full

## 문제

메일 CTA로 들어와 폼을 제출한 리드가 CRM 레코드에 `source: "웹사이트"` 하나만 남는다. 어느 캠페인·어느 수신자에서 왔는지가 사라져서, 매칭을 이메일 도메인 대조로 손수 해야 했다.

운영 DB 확인 결과:

| 항목 | 실측 |
|---|---|
| 발송 본문에 UTM 존재 | 110,069 / 242,727건 |
| 클릭 추적 기록 | 17,410건 (발송 5,097건, `click_id` 11,308건) |
| `source: "웹사이트"` 레코드 | 26건 (파티션 19/38/23) |
| 그 26건의 캠페인 필드 | **전무** |
| 방문자 UTM 보유 | 16,161 / 29,011명 |

메타 광고 리드는 `campaignName`/`adName`이 들어가는데(`webhooks/meta/route.ts:223-225`) 웹폼만 비어 있다. 파티션 38은 6/24~8/6까지 유입이 이어지는 진행 중 파티션이라 지금 고치면 바로 효과가 있다.

## 원인

**UTM은 유실되지 않았다. 폼이 그걸 집어들지 않을 뿐이다.**

이미 동작하는 것:
- 발송 경로 6개 전부 `wrapTrackingUrls`로 링크를 무조건 래핑 (플래그 없음)
- 클릭 시 `/api/track/click`이 `email_click_logs`에 기록하고 `clk_<nanoid21>` 발급
- 원래 URL에 `?sendb_cid=clk_xxx` 붙여 302 리다이렉트 (`email-click-tracking.ts:97-106`)
- 랜딩의 `tracker.js`가 `sendb_cid`를 읽어 방문자에 저장 (`tracker.js:86`, `:537`)
- `linkVisitorByFormSubmit`이 방문자↔레코드를 연결 (`match-record.ts:59`)

끊기는 곳은 한 군데다. `f/[slug]/page.tsx:89-95`가 `visitorId`를 `window.sendb.getVisitorId()`로만 얻는데, `/f/[slug]`는 샌드비가 서빙하는 페이지라 고객사 `tracker.js`가 없다. 따라서 `window.sendb`가 없고 `visitorId`는 거의 항상 `undefined`, 연결 분기(`submit/route.ts:142`)가 통째로 안 탄다.

즉 연결 메커니즘은 이미 있고, **입력값이 안 들어오는 것**이 문제다.

## 방침

`sendb_cid`를 1순위로 쓴다. UTM은 캠페인까지만 알려주지만 `sendb_cid`는 발송 건 → 수신자 개인까지 특정한다. UTM은 보조로 같이 저장한다.

새로 심을 UTM은 없다. 이미 링크에 붙어 있다.

## 범위

### 포함

1. **폼 페이지가 URL 파라미터를 수집** — `sendb_cid`, `utm_*` 5종을 `location.search`에서 읽어 submit body에 실어 보낸다.
2. **submit API가 그 값을 레코드에 저장** — 메타 광고와 같은 키(`campaignName`/`adName`)로 맞춰 화면 일관성을 유지한다.
3. **`sendb_cid`로 발송 건 역추적** — `email_click_logs.click_id` → `send_log_id` → 수신자/캠페인을 끌어와 레코드에 채운다. 이게 도메인 대조를 대체하는 핵심.
4. **iframe 임베드 대응** — 부모 페이지 URL의 파라미터를 iframe이 못 읽는 문제. `EmbedCodeDialog.tsx:24`가 만드는 스니펫이 현재 `src`에 파라미터를 안 넘긴다.

### 제외

- 기존 26건 소급 복구 — 클릭 로그와 레코드를 시간·이메일로 추정 매칭해야 해서 정확도를 보장 못 한다. 별건.
- 발송 링크에 UTM 자동 부착 — 이미 손으로 넣고 있고 잘 동작한다. 불필요.
- 이중 `?` URL 정리 (`...outreach?utm_source=...` 형태) — 실존하는 데이터 품질 문제지만 이번 범위 밖. 별도 사이클.
- 레포 전역 lint 부채 44건 — 무관.

## 미확정 (DESIGN에서 결정)

1. **iframe 파라미터 전달 방식** — 임베드 스니펫이 부모 `location.search`를 읽어 iframe `src`에 붙이는 방식(스니펫을 script 태그로 교체)과, 부모→iframe `postMessage` 방식 중 택일. 전자가 단순하지만 이미 배포된 임베드 코드는 갱신 전까지 혜택을 못 받는다. 하위호환 처리 필요.

2. ~~**레코드 필드 키**~~ — **확정: `campaignName`/`adName` 재사용.**

   운영 DB 실측으로 결정했다. `utm_source`는 `email`/`owned` 2종, `utm_medium`은 `sales`/`ai-email` 2종으로 사실상 상수고, 실질 구분은 전부 `utm_campaign`(14종)이 한다:

   | utm_campaign | 발송 |
   |---|---|
   | `outreach` | 89,846 |
   | `job-platform` | 12,167 |
   | `job-platform-followup-d3` | 4,106 |
   | `t2-pain` | 2,119 |
   | `job-platform-followup-d7` | 1,546 |
   | `youtuber` | 533 |
   | 나머지 8종 | ~800 |

   의미 있는 값이 하나뿐이라 필드도 하나면 충분하다. `utmSource`/`utmMedium`을 따로 두면 `owned`/`ai-email`만 반복 저장하는 낭비다. 메타 광고가 이미 `campaignName`을 쓰므로(`webhooks/meta/route.ts:223-225`) 재사용하면 기존 "광고" 컬럼이 컬럼 추가 없이 그대로 그린다. 메타 광고 리드와의 구분은 `source` 필드("메타 광고" vs "웹사이트")가 이미 한다.

   `adName` 자리에는 `sendb_cid`로 역추적한 **발송 제목**(`email_send_logs.subject`)을 넣어 "어느 메일에서 왔는지"까지 보이게 한다.

3. **`sendb_cid` 역추적 시점** — submit 트랜잭션 안에서 동기로 조회할지, 커밋 후 fire-and-forget으로 채울지. 후자가 폼 제출 실패 위험이 없다(기존 `linkVisitorByFormSubmit`도 그렇게 한다).

## 검증

`behaviors.json`으로 고정할 것:

- `sendb_cid`가 붙은 URL로 폼 제출 시 레코드에 캠페인 정보가 남는다
- `sendb_cid` 없이 직접 방문해 제출해도 폼 제출이 실패하지 않는다 (회귀 방지)
- 잘못된/만료된 `sendb_cid`를 보내도 제출은 성공하고 캠페인 필드만 빈다
- UTM만 있고 `sendb_cid`가 없으면 UTM 값이 저장된다
- 기존 `visitor_id` 경로가 여전히 동작한다

순수 함수(URL 파라미터 파싱)는 테스트 먼저 작성한다.

## 영향 파일 (예상)

- `src/app/f/[slug]/page.tsx` — 파라미터 수집
- `src/app/api/public/forms/[slug]/submit/route.ts` — 수신·저장
- `src/lib/tracker/match-record.ts` 또는 신규 — `sendb_cid` 역추적
- `src/components/web-forms/EmbedCodeDialog.tsx` — 임베드 스니펫

파싱 유틸은 기존 것을 먼저 찾는다. `journey/utils/referrer.ts`(`parseUtm`), `journey/utils/ad-group.ts`(`getUtm`), `tracker/utils/inflowDetail.ts`에 이미 3벌이 중복돼 있고 `overview/route.ts:221-236`에 SQL 버전이 4벌째다. 새로 만들지 말고 재사용하거나 일반화한다.
