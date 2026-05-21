# Design: 고객 여정 시각화 v2

> **Plan**: docs/01-plan/features/customer-journey-v2.plan.md
> **Base**: 기존 journey API/컴포넌트(feat/customer-journey)를 확장. 신규 테이블 없음.

---

## 1. 유입 경로 분류 (referrer + utm → 채널)

### 1.1 분류 유틸 — `src/components/journey/utils/referrer.ts` (신규)
세션의 `referrer` + `landingPage`(utm 포함)를 사람이 읽는 유입 채널로.
```ts
export type InflowChannel =
  | "메타 광고" | "구글 검색광고" | "구글 검색" | "네이버"
  | "메일" | "직접" | "기타";

export function classifyInflow(referrer: string | null, landingPage: string | null): InflowChannel {
    const url = landingPage ?? "";
    const ref = (referrer ?? "").toLowerCase();
    const utm = parseUtm(url); // utm_source, utm_medium, utm_campaign, gclid, fbclid

    // 우선순위
    if (utm.source === "email" || ref === "email" || utm.medium === "email") return "메일";
    if (utm.fbclid || /facebook|instagram|meta/.test(ref) || utm.source === "meta" || utm.source === "facebook") return "메타 광고";
    if (utm.gclid || (/google/.test(ref) && (utm.medium === "cpc" || utm.medium === "paid"))) return "구글 검색광고";
    if (/google/.test(ref)) return "구글 검색";
    if (/naver/.test(ref)) return "네이버";
    if (!ref || isSameHost(ref, url)) return "직접";
    return "기타";
}
```
> utm 파싱: landingPage의 쿼리스트링에서 utm_source/medium/campaign, gclid, fbclid 추출.

### 1.2 적용
journey API의 tracker 세션 normalize에서:
- 세션 이벤트 label: `"{유입채널}로 사이트 방문 N페이지"` (예: "메타 광고로 사이트 방문 2페이지")
- meta에 `inflowChannel`, `utm` 추가

---

## 2. journey API summary 확장

### 2.1 어트리뷰션 (firstTouch/lastTouch/conversionPath)
```ts
interface Attribution {
  firstTouch: { channel: string; at: string } | null;   // 가장 이른 이벤트의 유입채널
  lastTouch: { channel: string; at: string } | null;     // 전환 직전 마지막 마케팅 터치
  conversionAt: string | null;                            // 전환(가입 or 마지막 단계)
  path: { channel: string; at: string; gapText: string }[]; // 터치 순서 + 간격
}
```
- firstTouch: 첫 사이트 세션의 inflowChannel (없으면 첫 이벤트 채널)
- lastTouch: 전환(가입/구독) 직전의 마지막 메일/광고 터치
- path: 마케팅 터치(사이트 유입/메일)만 추려 순서 + "3일 7시간" 같은 간격

### 2.2 다음 액션 제안 (룰)
```ts
interface NextAction { label: string; reason: string; level: "urgent" | "important" | "info"; }
```
룰 예시 (서버 derive):
- 가입 후 48시간 이내 & 단계 미진행 → "온보딩 콜 제안" (urgent)
- 요금제 페이지 2회+ 방문 → "결정 기준 확인 / 사례 발송" (important)
- N일 무활동(isStale) → "재접촉 메일" (info)
- 구독중 도달 → "업셀/후기 요청" (info)

### 2.3 페이지 관여도 (선택)
```ts
pageEngagement?: { path: string; visits: number; totalDwellSec: number }[]  // 누적 체류 순
```

---

## 3. UI (시안 A+B 결합)

`src/components/journey/ui/JourneyPage.tsx` 레이아웃 재구성:

```
┌─ 헤더: 고객명 · 회사 · [현재단계 뱃지] · 첫유입 배지 ─────┐
├─ 요약 카드 줄: 전환 N일 / 클릭률 / 세션 / 평균체류 ──────┤
├─ 어트리뷰션: First → Re-engage → Last → 전환 (간격 표시) ─┤
├─ 다음 액션 제안 카드 (urgent/important) ─────────────────┤
├─ ★ 상단: 채널 가로 타임라인(스윔레인) ──────────────────┤
│   레인: 사이트 / 메일 / 가입 / 단계                      │
│   x축 시간, 점=이벤트, hover/click 연동                  │
├─ 일별 활동량 (폭증 강조) ────────────────────────────────┤
├─ 채널 필터 ──────────────────────────────────────────────┤
└─ ★ 하단: 세로 상세 타임라인 ────────────────────────────┘
    이벤트별 상세(메일 제목/CTA, 페이지별 체류, UTM, 디바이스)
    클릭 시 펼침
```

### 3.1 신규/수정 컴포넌트
```
journey/ui/
├── JourneyHeader.tsx          # 고객명+현재단계+첫유입배지 (신규)
├── AttributionCard.tsx        # First/Last/전환 경로 (신규)
├── NextActionCard.tsx         # 액션 제안 (신규)
├── ChannelSwimlane.tsx        # 상단 가로 채널 타임라인 (신규, 시안B)
├── JourneyTimeline.tsx        # 세로 상세 — 강화 (메일/페이지 상세 펼침)
├── JourneyEngagement.tsx      # 유지 (폭증 강조 이미 있음)
├── JourneySummaryBar.tsx      # 헤더로 일부 흡수 / 지표카드 분리
└── FunnelSteps.tsx            # 유지
```

### 3.2 ChannelSwimlane (핵심 신규)
- 가로축 = 시간(첫 이벤트~마지막). 세로 = 채널 레인 4개(사이트/메일/가입/단계)
- 각 이벤트를 해당 레인 시간 위치에 점. 색=채널.
- 점 hover → 툴팁(라벨/시각), click → 하단 세로 타임라인 해당 이벤트로 스크롤/하이라이트
- 데이터 적으면 자동 축소, 폭증일 구간 음영

### 3.3 세로 타임라인 상세 강화
- 메일: 제목/발신/템플릿/CTA/클릭위치
- 사이트: 페이지별 목록 + 체류(이미 children) + 유입채널/디바이스/UTM
- 단계: from→to, 소요
- 전환(가입/구독): 강조 배경

---

## 4. 작업 분해
- [ ] referrer.ts 유입 분류 유틸 + utm 파서
- [ ] journey API: 세션 inflowChannel 부여 + summary에 attribution/nextActions/(pageEngagement)
- [ ] journey types 확장 (Attribution, NextAction, inflowChannel)
- [ ] JourneyHeader / AttributionCard / NextActionCard / ChannelSwimlane (신규)
- [ ] JourneyTimeline 상세 강화
- [ ] JourneyPage 레이아웃 재조립
- [ ] 로컬 검증 (더미 데이터로 — 이미 있음)

## 5. 검증 (로컬 더미)
- [ ] "메타 광고로 사이트 방문" 유입 라벨 표시
- [ ] 어트리뷰션 First=메타광고 / Last=CS메일 / 전환=가입
- [ ] 액션 제안 (가입 직후 → 온보딩콜)
- [ ] 가로 스윔레인에 채널 교차 표시 + 세로 연동
- [ ] tsc

## 6. Open Questions
- Q1. utm 없는 기존 세션 다수 → "직접/기타"로. 디하 실데이터엔 utm 있음(메일 클릭). OK.
- Q2. 스윔레인 가로 폭/스크롤 — 데스크탑 기준, 모바일은 세로만 폴백.
- Q3. 액션 제안 룰 위치 — 서버(journey API)에서 derive (클라 중복 방지).
