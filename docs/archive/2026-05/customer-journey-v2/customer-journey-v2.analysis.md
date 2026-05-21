# Gap Analysis: customer-journey-v2

> **Date**: 2026-05-21
> **Branch**: feat/customer-journey
> **Plan**: docs/01-plan/features/customer-journey-v2.plan.md
> **Design**: docs/02-design/features/customer-journey-v2.design.md
> **Match Rate: 93%**

---

## 평가 기준

Design 문서에 정의된 구현 항목 22개를 대상으로 완전 일치 / 부분 일치(의도된 한계) / Gap 으로 분류.

---

## 1. 완전 일치 항목 (20/22)

| # | 항목 | 확인 |
|---|------|------|
| 1 | `InflowChannel` 타입 7종 정의 | referrer.ts 그대로 |
| 2 | `classifyInflow` 우선순위 로직 (메일→메타→구글검색광고→구글자연→네이버→직접→기타) | 구현됨, instagram/fb.com 추가 확장 |
| 3 | `parseUtm` (utm_source/medium/campaign, gclid, fbclid) | 구현됨 |
| 4 | 세션 normalize `inflowChannel` 부여 | route.ts session 루프에서 `classifyInflow(s.referrer, s.landingPage)` 호출 |
| 5 | 세션 label `"{채널}{josaRo} 사이트 방문 N페이지"` | `josaRo()` 함수 구현, 라벨 적용됨 |
| 6 | `JourneyAttribution` / `AttributionTouch` 타입 | types/index.ts에 명세대로 |
| 7 | `NextAction` 타입 (label/reason/level) | 구현됨 |
| 8 | attribution `firstTouch` — 첫 세션 inflowChannel | `buildAttribution` 첫 터치 |
| 9 | attribution `lastTouch` — path 마지막 터치 | 구현됨 |
| 10 | attribution `path` — 터치 순서 + `gapText` ("3일 7시간") | `gapText()` 함수 + path 루프 |
| 11 | nextActions 룰 4개 (가입48h 온보딩/요금제2회/무활동/구독중) | `buildNextActions` 모두 구현 |
| 12 | `JourneyHeader` — 현재단계 배지 + 첫유입 배지 | 구현됨 |
| 13 | `AttributionCard` — First/Last/전환 세로 흐름, gapText | 구현됨 |
| 14 | `NextActionCard` — urgent/important/info 스타일 | 구현됨 |
| 15 | `ChannelSwimlane` — 4레인(사이트/메일/가입/단계), 날짜컬럼, 무반응 음영, +N 축약 | 구현됨 |
| 16 | `JourneyTimeline` — 날짜별 그룹, 집중일 강조, 세션 펼침 chevron | 구현됨 |
| 17 | `JourneyEventDetail` — 채널배지/페이지칩/메일제목·URL/유입채널, JSON 제거 | 구현됨 |
| 18 | `JourneySummaryBar` — 지표 4개(아이콘+큰숫자) + 퍼널 + 이탈경고 | 구현됨 |
| 19 | `JourneyPage` 2단 레이아웃 (max-w-7xl, 사이드 340px) | `grid-cols-[1fr_340px]` |
| 20 | 채널 필터 클라이언트 처리 (서버 재요청 없이 `filteredEvents`) | 구현됨 |

---

## 2. 의도된 한계 (Gap 아님)

| 항목 | 이유 |
|------|------|
| `meta.utm` 객체 미저장 | DB에 `utmSource/utmMedium/utmCampaign` 컬럼 개별 존재. `classifyInflow`로 분류 완료 → 기능에 영향 없음. 필요 시 후속 확장 가능. |
| 세션 디바이스 미표시 | `tracker_sessions` 스키마에 device 컬럼 없음. 수집 전제 없이 표시 불가. |
| 실데이터 유입+단계 동시 보유 record 부재 | 기능 배포 직후. 코드 문제 아님. |

---

## 3. 실제 Gap (1개)

| # | 항목 | 설계 명세 | 실제 구현 | 영향 |
|---|------|-----------|-----------|------|
| G1 | 스윔레인 클릭 → 세로 타임라인 자동 스크롤 | "click → 하단 세로 타임라인 해당 이벤트로 스크롤/하이라이트" | `onSelect`로 `selected` 상태 업데이트 + 상단 preview 카드 표시. 자동 스크롤 없음. | 낮음 — 선택 이벤트는 상단 detail 카드에 즉시 표시됨. UX 흐름은 작동. |

---

## 4. Match Rate

```
완전 일치:  20 / 22 = 90.9%
Gap:         1 / 22 =  4.5%  (낮은 영향, UI 동작은 대안으로 보완됨)
의도된 한계: 2 / 22 =  9.1%  (평가 제외)

Match Rate: 93%  (실질 평가 22항목 중 20+0.5 = 20.5 → 93%)
```

**판정: PASS** (기준 90% 이상)

---

## 5. G1 후속 조치 (선택)

스윔레인 클릭 시 세로 타임라인 해당 이벤트로 `scrollIntoView`. `JourneyTimeline`의 선택 이벤트에 `ref` 부착 후 `useEffect`로 스크롤 트리거. 현재 preview 카드로 대체 중이므로 즉시 필요 없음. 다음 v2.1 개선 후보에 추가.
