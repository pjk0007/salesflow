# Report: 고객 여정 시각화 v2 (customer-journey-v2)

> **Date**: 2026-05-21
> **Branch**: feat/customer-journey
> **Status**: 완료
> **Match Rate**: 93%
> **Gap Analysis**: docs/archive/2026-05/customer-journey-v2/customer-journey-v2.analysis.md

---

## 요약

고객 여정 MVP(v1)의 시각 약점을 개선한 v2. 유입 경로 세분(6채널), 채널 가로 타임라인(스윔레인), First/Last touch 어트리뷰션, 룰 기반 다음 액션 제안을 추가했다. claude design 시안(A 세로상세 + B 가로레인) 기반으로 Tailwind로 구현. tsc 통과, 더미 데이터 e2e 검증 완료.

---

## 구현 완료 항목

### 유입 경로 분류 (`src/components/journey/utils/referrer.ts`)
- `InflowChannel` 7종: 메타 광고 / 구글 검색광고 / 구글 검색 / 네이버 / 메일 / 직접 / 기타
- `classifyInflow(referrer, landingPage)` — utm + referrer 복합 우선순위 분류
- `parseUtm` — utm_source/medium/campaign, gclid, fbclid 추출
- Design 명세 대비 instagram/fb.com 패턴 추가 강화

### Journey API 확장 (`src/app/api/records/[id]/journey/route.ts`)
- 세션 normalize: `classifyInflow` 결과를 label(`"메타 광고로 사이트 방문 N페이지"`)과 `meta.inflowChannel`에 저장
- `josaRo()` — 받침 유무에 따른 "로/으로" 자동 선택
- `buildAttribution()` — firstTouch / lastTouch / path(gapText 포함) 계산
- `buildNextActions()` — 4개 룰 (가입48h 온보딩콜 / 요금제2회 결정확인 / 14일 무활동 재접촉 / 구독중 업셀)
- `convertedAt`: stageOrder 없을 때 reachedStages 마지막으로 폴백
- `firstChannel`: 첫 tracker 세션 inflowChannel

### 타입 확장 (`src/components/journey/types/index.ts`)
- `JourneyAttribution`, `AttributionTouch`, `NextAction` 추가
- `JourneyData` — attribution / nextActions 포함

### 신규 컴포넌트
| 파일 | 역할 |
|------|------|
| `JourneyHeader.tsx` | 현재단계 배지 + 첫유입 채널 배지 |
| `AttributionCard.tsx` | 유입 경로 세로 흐름 (First→터치→전환, gapText) |
| `NextActionCard.tsx` | urgent/important/info 3단 액션 제안 카드 |
| `ChannelSwimlane.tsx` | 날짜컬럼 그리드, 4레인, 무반응 음영, hover→상세, +N 축약 |

### 수정 컴포넌트
| 파일 | 변경 내용 |
|------|-----------|
| `JourneySummaryBar.tsx` | 지표 4개(아이콘+큰숫자) + 퍼널 + 이탈경고 |
| `JourneyTimeline.tsx` | 날짜별 그룹, 집중일 강조, 세션 펼침 |
| `JourneyEventDetail.tsx` | 채널배지/페이지칩/메일 제목·URL/유입채널, JSON 제거 |
| `JourneyPage.tsx` | 2단(메인+사이드 340px), max-w-7xl, 채널필터 클라이언트, 기본 첫이벤트 카드 |

---

## 검증

| 항목 | 결과 |
|------|------|
| "메타 광고로 사이트 방문" 유입 라벨 | 더미로 확인 |
| 어트리뷰션 First=메타광고 / Last=CS메일 / 전환=가입 | 더미로 확인 |
| 액션 제안 (가입 직후 → 온보딩 콜) | 더미로 확인 |
| 스윔레인 채널 교차 표시 + hover | 더미로 확인 |
| 전환 소요 11일 / 단계 소요 (매칭3일·테스트3일) | 더미로 확인 |
| tsc | 통과 |
| 페이지 로드 | 200 |

---

## 미결 / 후속 과제

| # | 내용 | 우선순위 |
|---|------|---------|
| v2.1 | 스윔레인 클릭 → 세로 타임라인 `scrollIntoView` 연동 | 낮음 (현재 preview 카드로 대체) |
| 추후 | 페이지 관여도 순위 (`pageEngagement`) — Out of Scope로 결정됨 | 별도 |
| 추후 | 분석 대시보드(시안 C) — 다음 워크스페이스 대시보드 작업으로 분리 | 별도 |
| 추후 | 실데이터 유입+단계 record 축적 후 검증 | 기능 배포 후 |

---

## Out of Scope (확정)

- 분석 대시보드(C) — 별도 워크스페이스 대시보드
- 페이지 관여도 순위 — 여유 시 추가
