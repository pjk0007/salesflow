# DESIGN — 웹폼 유입 리드에 캠페인 출처 남기기

PLAN: [PLAN.md](./PLAN.md)

## 탐색에서 바뀐 전제

설계 중 코드를 읽고 두 가지가 PLAN 시점 가정과 달랐다.

### 1. `sendb_cid` 역추적 로직은 이미 있다 (단, 죽어 있다)

`match-record.ts:10`의 `linkVisitorByClickId`가 `emailClickLogs → emailSendLogs` 조인을 이미 한다.

```ts
.from(emailClickLogs)
.innerJoin(emailSendLogs, eq(emailClickLogs.sendLogId, emailSendLogs.id))
.where(eq(emailClickLogs.clickId, clickId))
```

**호출부가 0개다.** grep 결과 정의 한 줄 외에 아무 데서도 안 쓴다. 조인 자체를 새로 짤 필요는 없지만, 이 함수를 그대로 쓸 수는 없다 — 방향이 반대다:

| | 방향 | 우리에게 |
|---|---|---|
| `linkVisitorByClickId` | clickId → **기존** record를 visitor에 붙임 | ✗ |
| 필요한 것 | clickId → **새** record에 캠페인을 씀 | ✓ |

조인 패턴만 재사용하고 별도 함수를 만든다.

### 2. `collect/route.ts`는 이미 click_id를 처리한다

`collect/route.ts:172-197`이 `click_id`로 record를 매칭하고 `visitorRecordLinks`에 `source: "click_id"`로 누적한다. 즉 **랜딩 페이지에 tracker.js가 있으면 연결은 이미 된다.**

끊기는 건 폼 페이지뿐이다. `/f/[slug]`는 샌드비가 서빙해서 고객사 tracker.js가 없고, 따라서 `window.sendb`가 없다(`page.tsx:89-95`).

이 사실이 설계를 단순하게 만든다 — **트래커 연결 경로는 건드리지 않는다.** 폼이 자기 URL의 파라미터를 직접 읽어 submit에 실으면 된다.

## 접근

```
메일 클릭
  → /api/track/click (기록 + clk_xxx 발급)
  → 폼 URL?sendb_cid=clk_xxx&utm_campaign=job-platform   ← 리다이렉트가 붙여줌
  → 폼 페이지가 location.search에서 수집
  → submit body에 실어 전송
  → 서버가 clickId로 발송 건 역추적 → 레코드에 campaignName/adName 기록
```

`sendb_cid`가 1순위, UTM은 폴백. `sendb_cid`는 발송 건 → 수신자 개인까지 특정하고, UTM은 캠페인까지만 알려준다.

## 파일 계획

| 파일 | 변경 |
|---|---|
| `src/lib/attribution/parse-params.ts` | **신규** — URL 파라미터 파싱 (순수함수, TDD) |
| `src/lib/attribution/resolve-attribution.ts` | **신규** — clickId → 발송 건 역추적 |
| `src/app/f/[slug]/page.tsx` | 파라미터 수집해 submit body에 추가 |
| `src/app/api/public/forms/[slug]/submit/route.ts` | 수신 → 역추적 → 레코드 기록 |
| `src/components/web-forms/EmbedCodeDialog.tsx` | 임베드 스니펫에 파라미터 전달 |

기존 파싱 유틸(`journey/utils/referrer.ts`의 `parseUtm`, `ad-group.ts`의 `getUtm`, `tracker/utils/inflowDetail.ts`)은 **재사용하지 않는다.** 셋 다 트래커 저장 후 값을 *읽어 분류*하는 용도고, 우리는 `URLSearchParams`에서 *수집*한다. 입력 타입이 다르다. 다만 신규 파일을 `lib/attribution/`에 두어 4벌째 중복이 되지 않게 위치를 분리한다.

## 계약 (TDD로 고정)

### `parseAttributionParams(search: string): AttributionParams`

```ts
type AttributionParams = {
  clickId?: string;       // sendb_cid
  utmCampaign?: string;
  utmSource?: string;
  utmMedium?: string;
};
```

- 파라미터가 하나도 없으면 `{}` (빈 객체, null 아님)
- `sendb_cid` 형식이 `clk_`로 시작하지 않으면 무시 — 임의 값 주입 방지
- 값 길이 상한 200자 (DB 컬럼이 `varchar(200)`)
- 빈 문자열은 미설정과 동일 취급
- `?` 유무·중복 `?`에 관계없이 동작 (실측 데이터에 `outreach?utm_source=...` 형태 존재)

### `resolveAttribution(params): Promise<AttributionResult>`

```ts
type AttributionResult = {
  campaignName?: string;   // 레코드 필드
  adName?: string;         // 발송 제목
};
```

- `clickId` 있으면 `emailClickLogs → emailSendLogs` 조인해 `subject`를 `adName`에 넣는다
- 조인 실패(만료·위조 clickId)해도 **throw하지 않고** UTM 폴백으로 내려간다
- `campaignName`은 `utmCampaign` 우선, 없으면 발송 건에서 유추하지 않는다 (추측 금지)
- 둘 다 없으면 `{}` — 레코드에 필드를 추가하지 않는다

### 캠페인 값 정제

실측에서 파싱 깨진 값이 20종 확인됐다 (`outreach)` 89건, `outreach]디자이너하이어` 등). AI가 마크다운 링크를 쓰며 `)`/`]`가 딸려 들어간 것.

**저장 시점에 후행 `)`, `]`, `/`를 잘라낸다.** PLAN에서 "이중 `?` 정리는 별도 사이클"로 뺐지만, 그건 *기존 발송 데이터 소급 정리*고 이건 *신규 레코드가 오염된 값을 그대로 받지 않게 하는 것*이라 범위가 다르다. 한 줄짜리 방어이고, 없으면 첫날부터 `outreach)`가 레코드에 박힌다.

## 저장 위치

`submit/route.ts`의 `recordData` 구성 직후, `defaultValues` 적용 **전**에 넣는다.

```
recordData 구성 (linkedFieldKey)
  → attribution 병합          ← 여기
  → defaultValues 적용 (빈 필드만)
  → applyFieldDefaults
```

`defaultValues`는 `!recordData[dv.field]`일 때만 덮으므로(`submit/route.ts:70`), attribution을 먼저 넣으면 폼 기본값이 실제 캠페인을 덮어쓰지 않는다.

## 실행 시점

**트랜잭션 밖, 커밋 전 동기 호출.**

`linkVisitorByFormSubmit`은 fire-and-forget이지만(`submit/route.ts:142`) 이건 다르다. 레코드의 `data`에 들어가야 해서 insert 전에 값이 있어야 한다.

대신 실패가 폼 제출을 막으면 안 된다 — 리드 유실이 캠페인 정보 유실보다 훨씬 비싸다. 그래서:

```ts
let attribution = {};
try {
  attribution = await resolveAttribution(params);
} catch (err) {
  console.error("Attribution resolve error:", err);   // 전파하지 않음
}
```

전역 규칙이 "에러 swallow 금지"지만, 여기는 **의도적 degrade가 요구사항**이다. 캠페인 정보는 부가 데이터고 폼 제출은 핵심 경로다. 에러를 삼키되 로그는 남기고, 이 결정을 주석으로 코드에 남긴다.

## iframe 임베드

`EmbedCodeDialog.tsx:24`가 만드는 현재 스니펫:

```html
<iframe src="https://sendb.kr/f/Xgk5OL56" ...></iframe>
```

부모 URL의 `?sendb_cid=...`를 iframe이 못 읽는다. `src`가 고정이라 파라미터가 전달되지 않는다.

**택: script 스니펫으로 교체.** `postMessage`보다 단순하고, iframe 안에서 즉시 값이 잡혀 타이밍 이슈가 없다.

```html
<div id="sendb-form-Xgk5OL56"></div>
<script>
(function(){
  var s = location.search;
  var f = document.createElement('iframe');
  f.src = "https://sendb.kr/f/Xgk5OL56" + s;
  f.width = "100%"; f.height = "600"; f.frameBorder = "0";
  f.style.border = "none";
  document.getElementById('sendb-form-Xgk5OL56').appendChild(f);
})();
</script>
```

**하위호환**: 이미 배포된 iframe 스니펫은 그대로 동작한다(캠페인 정보만 안 붙음). 다이얼로그에 두 방식을 병기하고 script 쪽을 권장으로 표시한다. 기존 사용자에게 교체를 강제하지 않는다.

부모 `location.search`를 통째로 넘기므로 폼 페이지가 `sendb_cid`/`utm_*`만 골라내는 것이 중요하다 — `parseAttributionParams`가 화이트리스트 방식인 이유다.

## 검증 (behaviors.json 분모)

| # | behavior | 방법 |
|---|---|---|
| 1 | `sendb_cid` 있는 URL로 제출 → 레코드에 `campaignName`/`adName` 기록 | 통합 |
| 2 | 파라미터 없이 제출 → 제출 성공, 캠페인 필드 없음 | 통합 |
| 3 | 위조 `sendb_cid`(`clk_` 아님) → 무시, 제출 성공 | 단위 |
| 4 | 존재하지 않는 `clk_xxx` → 조인 실패해도 제출 성공 | 통합 |
| 5 | UTM만 있고 `sendb_cid` 없음 → `campaignName`에 UTM 값 | 통합 |
| 6 | `outreach)` → `outreach`로 정제 | 단위 |
| 7 | 기존 `visitor_id` 경로 회귀 없음 | 통합 |
| 8 | `defaultValues`가 attribution을 덮어쓰지 않음 | 통합 |

3·6은 순수함수라 **테스트 먼저 작성**한다. 나머지는 구현 후 고정.

프로젝트에 테스트 러너가 없다(`package.json` 확인 필요). 없으면 `node:test` 폴백을 쓸지 물어본다 — 새 의존성 추가는 승인 사항.

## 제외 (PLAN 유지)

- 기존 26건 소급 복구
- 발송 링크 UTM 자동 부착
- 기존 발송 데이터의 이중 `?` URL 소급 정리
- 레포 전역 lint 부채

## 미해결

`linkVisitorByClickId`가 죽은 코드로 남아 있다. 이번 작업으로도 호출되지 않는다. 삭제할지 나중에 쓸지는 이 사이클 범위 밖이라 손대지 않지만, 기록해둔다.
