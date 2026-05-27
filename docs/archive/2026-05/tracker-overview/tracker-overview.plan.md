# Plan: tracker-overview (트래커 사이트 분석 개요 탭)

> 작성일: 2026-05-26
> Phase: Plan

## 1. 배경 / 문제

현재 트래커 페이지는 **방문자 596명의 평면 리스트**가 첫 화면이다. 영업/운영이 사이트 운영 큰 그림(트래픽 추세, 인기 페이지, 유입 채널, 디바이스 분포)을 보려면 GA/애디온 같은 외부 도구를 따로 봐야 한다.

### 사용자 발화 (요지)
- "방문자 리스트 페이지를 뒷단으로 빼고 앞에는 개요가 제일 먼저 나오게"
- "탭 스타일도 애디온처럼 언더바(밑줄형)로"
- 추구하는 모델: 애디온 사이트 분석 화면 (개요/전환/마케팅/퍼널/비교/디버그 + 기간 선택/필터)

### 핵심 문제
1. **큰 그림 부재**: 추세/분포/순위가 없어 "사이트 어떻게 돌아가는지" 모름
2. **첫 화면이 디테일**: 596명 리스트로 시작해 한눈에 안 들어옴
3. **탭 스타일이 캡슐형**: 탭이 늘어나면 답답 (애디온 같은 밑줄형이 적합)

## 2. 목표 (Goal)

트래커 페이지 진입 시 **사이트 분석 개요**가 먼저 보이게 한다. 기존 방문자 리스트/설정은 보존하되 위치만 뒤로.

## 3. 범위 (이번 PDCA)

**1차에 만들 것**:
- **탭 재구성**: [**개요** (default) · 방문자 · 설정] — 개요가 첫 화면
- **탭 스타일**: 캡슐형 → **밑줄형(underline)** 전환 (애디온/Vercel 스타일)
- **개요 탭 위젯 (1차 6개)**:
  1. **KPI 카드 6개**: 방문자 / 세션 / 페이지뷰 / 평균 체류 / 바운스율 / 전환율 (각각 전기 대비 ±% 표시)
  2. **일별 페이지뷰 차트** (recharts area)
  3. **인기 페이지 TOP10**
  4. **최근 방문 세션** (방문자·소스·랜딩·시간)
  5. **유입 채널 분포** (광고/자연/직접/메일 — 도넛 또는 가로바)
  6. **디바이스 분포** (desktop/mobile/tablet — 도넛)
- **기간 필터**: 최근 7일 / 30일 / 90일 / 사용자 지정 (기본 = **30일**)

**비범위 (다음 PDCA)**:
- 전환/마케팅/퍼널/비교/디버그 탭
- 실시간(자동 새로고침) 모드
- 추적이력 필드 표시·필터 (record 정보 노출)
- 방문자 리스트 페이지 자체 개편

## 4. 데이터 가용성 (확인됨)

| 위젯 | 소스 | 비고 |
|------|------|------|
| 방문자/세션/PV | tracker_visitors / sessions / events | 기간 필터 OK |
| 평균 체류 | sessions.duration 평균 | |
| 바운스율 | sessions where page_count=1 / 전체 | |
| 전환율 | visitor 중 record_id NOT NULL / 전체 (또는 signup 이벤트 기반) | 정의 Design에서 확정 |
| 전기 대비 ±% | 같은 길이의 직전 기간과 비교 | |
| 일별 PV | events GROUP BY occurred_at::date | |
| 인기 페이지 | events.page_url GROUP BY (utm 제거한 경로) | |
| 최근 세션 | sessions ORDER BY started_at DESC LIMIT N | |
| 유입 채널 | sessions의 referrer+landingPage → classifyInflow | 이미 존재 유틸 |
| 디바이스 | visitors.device_type / browser / os | |

## 5. 해결 방안

| 방안 | 내용 | 평가 |
|------|------|------|
| **A. 새 API + 새 컴포넌트** | `/api/tracker/analytics/overview` 신규 + `OverviewTab.tsx` | 권장 — 클린, 위젯 추가 용이 |
| B. 기존 visitors API 확장 | 응답에 분석 데이터 끼워넣기 | 비추 — 책임 분리 깨짐, 응답 비대 |

**권장: A**. 분석은 별도 엔드포인트 (요청 시 기간 파라미터 전달).

## 6. 영향 범위

- `src/app/tracker/page.tsx` — 탭 추가, 첫 탭=개요
- `src/components/tracker/ui/VisitorListPage.tsx` — 기존 탭(방문자/설정)을 새 구조로 이관 또는 분해
- `src/components/tracker/ui/OverviewTab.tsx` — **신규**
- `src/components/tracker/ui/widgets/` (서브) — KPI/Chart/PopularPages/RecentSessions/InflowChannels/DeviceBreakdown 6개 위젯 — **신규**
- `src/app/api/tracker/analytics/overview/route.ts` — **신규** (기간 파라미터로 모든 위젯 데이터 통합 응답)
- `src/components/ui/tabs.tsx` 또는 트래커 전용 래퍼 — 밑줄형 탭 스타일 (전역 영향 최소화)

## 7. 결정 사항 (Design에서 확정)

1. **밑줄 탭 스타일**: 전역 `tabs.tsx` 변경 vs 트래커 전용 변형 (다른 페이지 영향 최소화 위해 후자 권장)
2. **전환율 정의**: visitor 중 record 연결된 비율 vs signup record_event 발생한 visitor 비율 — 어느 쪽이 사용자가 보고 싶은 "전환"인가
3. **차트 라이브러리**: recharts 그대로 (이미 journey에서 사용 중)
4. **응답 캐싱**: 페이지 로드마다 집계 쿼리 6개 — 1차는 캐싱 없이, 느리면 추가
5. **multi-site 처리**: 워크스페이스에 사이트 여러 개일 때 합산 vs 사이트 선택 드롭다운 (1차는 active site 합산 추천)

## 8. Definition of Done

- [ ] 트래커 진입 시 **개요** 탭이 default로 표시
- [ ] 탭 스타일 밑줄형 적용 (개요 · 방문자 · 설정 순서)
- [ ] KPI 6개 정확히 계산 (방문자/세션/PV/체류/바운스/전환율 + 전기 대비 ±%)
- [ ] 일별 PV 차트, 인기 페이지 TOP10, 최근 세션, 유입 채널 분포, 디바이스 분포 표시
- [ ] 기간 필터 (7/30/90일/사용자지정) 동작, 기본 30일
- [ ] 빈 데이터(신규 사이트) 상태 처리 — "데이터 없음" 메시지
- [ ] tsc 통과
- [ ] gap-detector Match Rate ≥ 90%

## 9. 리스크 / 주의

- **집계 쿼리 성능**: 운영 데이터 규모(visitor 578/sessions 1.5K/events 2.9K)는 현재는 가벼움. 미래 10배 되면 인덱스/머터리얼라이즈드뷰 검토 — 이번 범위는 raw 집계.
- **밑줄 탭 전역 변경 리스크**: 다른 페이지(레코드 상세, journey 등) 영향 가능 → 트래커 전용 스타일로 격리 권장.
- **multi-site**: 한 워크스페이스에 사이트 여러 개일 때 1차는 합산. 사이트별 분리는 다음 단계.
