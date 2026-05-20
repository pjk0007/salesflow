# Plan: 고객 여정 인텔리전스 (Customer Journey Intelligence)

> **Summary**: 한 고객(record)에게 일어난 모든 이벤트 — 비즈니스 이벤트(record_events) + 사이트 행동(tracker_events) + 메일 클릭/발송(email logs) — 를 시간순으로 통합해 "여정"을 시각화한다. "한눈에 이해" + "전문가 상세 지표"를 depth 위계로 함께 제공한다.
>
> **Project**: Sendb (Salesflow)
> **Author**: jaehun
> **Date**: 2026-05-20
> **Status**: Draft
> **Related**: record-events, field-history-tracking, record-create-with-event, tracker (archive/2026-05)

---

## 0. 작업 원칙 (중요)

이 Plan은 **끝까지 세세하게** 짠다. 단계로 나눠 진행하되 **모든 단계가 이 문서에 명시**되어 있어, 중간에 빠뜨리지 않는다. "다 끝났다" 착각 방지 — §11 완료 정의(DoD)를 모두 충족해야 완료.

---

## 1. Overview

### 1.1 Purpose
지금까지 데이터를 쌓아온 **최종 목적**. record_events에 외부(디하/백오피스랩) + sendb UI 변경이 다 모이고, tracker_events에 사이트 행동이, email logs에 메일 반응이 쌓인다. 이걸 **한 사람 기준 시간순으로 통합**해 "이 고객이 어떤 경로로 전환했나"를 본다.

### 1.2 그동안 쌓은 데이터 소스 (이미 존재)
| 소스 | 내용 | record 연결 |
|---|---|---|
| `record_events` | 비즈니스 이벤트(단계/상담/status 변경) | `record_id` (FK) |
| `tracker_events` | 사이트 행동(페이지뷰/체류/이벤트) | `tracker_visitors.record_id` → visitor → events |
| `email_send_logs` | 메일 발송 | `record_id` |
| `email_click_logs` | 메일 클릭 | `send_log_id` → send_log.record_id |

→ **모든 소스가 record로 귀결**된다. 통합의 축 = `record`.

### 1.3 사용자 요구 (예전 논의 종합)
1. x축 = 시간
2. **퍼널 단계축** 도 보고 싶음 (신청→테스트→구독 같은 계단)
3. **관여도 그래프** 도 (얼마나 활발히 움직였나)
4. **채널** 묶기 (메일/사이트/직접 등)
5. **단계 묶기**
6. ⭐ **"한눈에 이해" 최우선, 단 전문가적 상세 지표가 누락되면 안 됨**

→ 핵심 설계 원칙: **depth 위계**. 첫 화면은 한눈에, 파고들면 전문가 지표.

---

## 2. Scope

### 2.1 In Scope (전체 — 단계로 구현하되 다 포함)

**A. 데이터 통합 API**
- [ ] `GET /api/records/:id/journey` — record 1명의 모든 이벤트를 시간순 통합 반환
  - record_events + tracker_events + email logs를 normalize해 단일 타임라인 배열로
  - 각 이벤트: `{ at, source, type, label, channel, meta }`

**B. 여정 페이지 (별도)**
- [ ] `/journey/:recordId` (또는 `/records/:id/journey`) 별도 페이지
- [ ] 진입 동선: record 상세 / 트래커 visitor 상세에서 "여정 보기" 링크

**C. 시각화 — depth 위계**
- [ ] **L1 한눈에**: 퍼널 단계 진행 + 핵심 요약(전환 여부, 소요일, 총 활동수)
- [ ] **L2 타임라인**: 시간축 통합 이벤트 (채널별 색/아이콘, 단계 마커)
- [ ] **L3 관여도**: 시간대별 활동량 그래프 (engagement)
- [ ] **L4 상세**: 이벤트 클릭 시 meta 전체 (전문가 지표)

**D. 묶기/필터**
- [ ] 채널 필터 (메일/사이트/비즈니스 이벤트)
- [ ] 단계 묶기 (퍼널 단계별 그룹)

### 2.2 Out of Scope
- ❌ 여러 record 통합 분석(코호트/집계 대시보드) — 후속
- ❌ 회사 단위 묶기 — record(개인) 단위
- ❌ 실시간 갱신(SSE) — 최초엔 조회 시점 스냅샷

### 2.3 단계 분할 (구현 순서, 전부 이 Plan 범위)
- **Phase 1**: 통합 API + L1(퍼널 요약) + L2(타임라인). 진입 동선.
- **Phase 2**: L3(관여도 그래프) + 채널/단계 필터.
- **Phase 3**: L4 상세 패널 + 전문가 지표(체류시간, 클릭률, 단계별 소요).
> Phase는 구현 순서일 뿐 **모두 완료해야 DoD 충족**(§11).

---

## 3. Goals

### 3.1 Primary
1. record 1명의 전 채널 여정을 한 화면에서 시간순으로 본다
2. "한눈에"(퍼널/요약)와 "전문가 상세"(meta/지표)를 depth로 양립
3. 어떤 행동 패턴이 전환으로 이어지는지 읽힌다

### 3.2 Success Criteria
- 디하 고객 1명 열면: 도입상담→테스트→구독중 단계가 계단으로, 그 사이 사이트 방문/메일클릭이 타임라인에 보임
- 채널 필터로 "메일만" / "사이트만" 골라봄
- 이벤트 클릭 시 from/to·체류시간 등 상세 meta 표시
- 전환까지 소요일, 총 활동수 같은 요약 지표 상단에 표시

---

## 4. 데이터 모델 (통합 — 신규 테이블 없음)

신규 저장 없음. **조회 시점에 4개 소스를 normalize**해 합친다.

### 4.1 통합 이벤트 형태 (API 응답 단위)
```ts
interface JourneyEvent {
  at: string;          // ISO 시각 (정렬 기준)
  source: 'business' | 'tracker' | 'email';  // 원천
  channel: string;     // '단계' | '상태' | '상담' | '사이트' | '메일'
  type: string;        // record_events.type / tracker eventType / 'email_click' 등
  label: string;       // 표시 라벨
  meta: Record<string, unknown>;  // 상세 (from/to, pageUrl, 체류, url 등)
}
```

### 4.2 소스별 매핑
| 소스 | source | channel | label 예 | meta |
|---|---|---|---|---|
| record_events (type=match_stage) | business | 단계 | "구독중" | {from,to} |
| record_events (type=status) | business | 상태 | "연락중" | {from,to,by} |
| record_events (type=consult) | business | 상담 | "도입상담 신청" | {source} |
| tracker_events (PAGE_VIEW) | tracker | 사이트 | "/pricing 방문" | {pageUrl,title,duration} |
| email_send_logs | email | 메일 | "메일 발송: {제목}" | {subject} |
| email_click_logs | email | 메일 | "메일 링크 클릭" | {url} |

### 4.3 join 경로 (API 내부)
```
record(:id)
 ├─ record_events WHERE record_id=:id
 ├─ tracker_visitors WHERE record_id=:id → ids → tracker_events WHERE visitor_id IN (...)
 └─ email_send_logs WHERE record_id=:id (+ email_click_logs via send_log_id)
→ 전부 { at } 로 normalize → 시간순 merge
```

### 4.4 퍼널 단계 정의 (L1 계단) — 사용자 지정
- record_events의 `type='match_stage'`(디하) / `type='consult'`(상담) / `type='status'`(상태)를 단계로
- **단계 순서를 사용자가 지정** (확정): 파티션/속성 설정에서 단계 순서를 정의한다.
  - 추적 select 필드(field-history-tracking)의 옵션 순서를 **퍼널 순서로 사용** — 옵션 정의 순서 = 단계 순서
  - 또는 별도 "퍼널 단계 설정"으로 순서 지정 (§10 Q1에서 방식 확정)
- 지정된 순서로 계단(progress) 표시. 미지정 옵션은 등장 순서 폴백.
- 현재 단계 = record의 해당 필드 현재값 → "현재 단계 뱃지"로 강조

### 4.5 지표 계산 (전문가 지표 — 전부 포함)
조회 시점에 events 배열로부터 derive:
- **단계별 소요시간**: 단계 전이 이벤트 간 시간차 ("신청→테스트 2일, 테스트→구독 7일")
- **전환 소요일**: 첫 이벤트 ~ 전환(구독 등) 시각 차
- **첫 유입 경로**: 가장 이른 이벤트의 channel/source (메일/사이트/상담 등)
- **활동 밀도 요약**: 총 방문수, 메일 발송/클릭수, 메일 클릭률, 평균 체류, 세션 수
- **이탈 구간**: 마지막 활동 ~ 현재(now) 시간차 → N일 무활동 플래그
- **일별 활동량**: 날짜별 이벤트 카운트 (관여도 그래프 + 폭증일 강조용)

---

## 5. API 설계

### 5.1 `GET /api/records/:id/journey` (내부)
- 인증: `getUserFromNextRequest` + orgId 격리
- 처리: 4.3 join → normalize → 시간순 정렬
- 응답:
```json
{
  "success": true,
  "data": {
    "summary": {
      "firstSeenAt": "...", "convertedAt": "...|null",
      "daysToConvert": 11, "totalEvents": 23,
      "currentStage": "구독중",                          // 현재 단계 뱃지
      "stages": ["도입상담 신청","테스트","구독중"],       // 정의된 퍼널 순서
      "stageDurations": [                                // 단계별 소요시간
        { "from": "도입상담 신청", "to": "테스트", "days": 2 },
        { "from": "테스트", "to": "구독중", "days": 7 }
      ],
      "firstChannel": "메일",                            // 첫 유입 경로
      "channels": { "business": 5, "tracker": 16, "email": 2 },
      "density": {                                       // 활동 밀도 요약
        "visits": 12, "emailSent": 3, "emailClicks": 2,
        "emailClickRate": 0.67, "avgDwellSec": 95, "sessions": 4
      },
      "inactivity": { "lastActiveAt": "...", "daysSince": 5, "isStale": true },  // 이탈 구간
      "dailyActivity": [ { "date": "2026-05-02", "count": 8 }, ... ]  // 관여도 + 폭증일
    },
    "events": [ JourneyEvent, ... ]   // 시간순
  }
}
```
- 쿼리 옵션: `?channel=tracker|email|business` (필터), `?from=&to=` (기간)

### 5.2 성능
- tracker_events가 많을 수 있음(record당 수십~수백) → 페이지뷰는 기간/개수 제한 또는 세션 단위 요약 옵션. (§10 Q2)

---

## 6. UI 설계

### 6.1 페이지: `/records/:id/journey` (별도 페이지)
- 진입: RecordDetailDialog에 "여정 보기" 버튼 / 트래커 visitor 상세에 링크
- 레이아웃(위→아래, depth):

```
┌─ L1 요약 바 ───────────────────────────────────────┐
│ 현재단계: [구독중]                                   │
│ [도입상담]→[테스트]→[구독중]  · 전환 11일 · 활동 23   │
│ 첫유입: 메일 · 단계소요: 신청→테2일·테→구7일          │
│ 방문 12 · 메일클릭 2/3(67%) · 평균체류 1분35초        │
│ ⚠ 5일째 무활동                                       │
├─ L2 타임라인 ──────────────────────────────────────┤
│  5/1 ● 상담 신청                                    │
│  5/2 ○ 사이트 방문 6페이지 ▾ (세션 묶기)             │
│  5/3 ◆ 단계: 테스트                                  │
│  5/3 ✉ 메일 클릭                                    │
│  ...  (채널별 색/아이콘, 단계는 굵게)                 │
├─ L3 관여도 ────────────────────────────────────────┤
│  ▁▃█▂▁  (일별 활동량 — 폭증일 색 강조 + 수치 라벨)    │
└──────────────────────────────────────────────────────┘
[채널 필터: 전체 | 단계 | 상태 | 사이트 | 메일]
이벤트 클릭 → L4 상세 패널(meta 전체)
```
> 관여도(L3): 일별 활동량을 막대로, **활동 폭증일은 색/높이로 강조**하고 수치 라벨 표시.
> 세션 묶기: 같은 세션의 페이지뷰는 한 줄로 묶고 펼치기(▾).

### 6.2 컴포넌트 (feature 구조)
```
src/components/journey/
├── ui/
│   ├── JourneyPage.tsx          # 조립
│   ├── JourneySummaryBar.tsx    # L1
│   ├── JourneyTimeline.tsx      # L2
│   ├── JourneyEngagement.tsx    # L3 (recharts)
│   ├── JourneyEventDetail.tsx   # L4 패널
│   └── ChannelFilter.tsx
├── hooks/
│   └── useJourney.ts            # SWR GET journey
├── api/
│   └── journey.ts               # fetch
├── types/
│   └── index.ts                 # JourneyEvent 등
└── utils/
    └── normalize.ts             # (서버와 공유 불가 시 표시용 헬퍼)
```

### 6.3 "한눈에 + 전문가" depth 처리
- L1/L2 기본 노출 → 첫 화면에서 흐름 파악
- L3 관여도는 접기/펼치기
- L4는 이벤트 클릭 시 사이드 패널 → 평소엔 안 보임(노이즈 X), 필요 시 전문가 지표

---

## 7. 작업 분해 (체크리스트 — 전부)

### Phase 1 — 통합 + 요약 + 타임라인
- [ ] `GET /api/records/:id/journey` (4개 소스 join + normalize + 정렬)
- [ ] journey 타입 정의
- [ ] useJourney 훅 + journey api
- [ ] JourneyPage 라우트 (`/records/:id/journey`)
- [ ] JourneySummaryBar (L1 — 단계 계단 + 요약 지표)
- [ ] JourneyTimeline (L2 — 시간순, 채널 색/아이콘, 단계 마커)
- [ ] 진입 동선: RecordDetailDialog "여정 보기" + 트래커 visitor 상세 링크

### Phase 2 — 관여도 + 필터
- [ ] JourneyEngagement (L3 — recharts 일별/세션별 활동량)
- [ ] ChannelFilter (채널 필터)
- [ ] 단계 묶기 보기

### Phase 3 — 상세 + 전문가 지표 (전부 꼼꼼히)
- [ ] JourneyEventDetail (L4 — meta 전체 패널)
- [ ] 단계별 소요시간 (stageDurations)
- [ ] 전환 소요일 (daysToConvert)
- [ ] 첫 유입 경로 (firstChannel)
- [ ] 활동 밀도 요약 (방문/메일발송/클릭/클릭률/평균체류/세션수)
- [ ] 이탈 구간 경고 (N일 무활동, isStale)
- [ ] 현재 단계 뱃지 (currentStage)
- [ ] 일별 활동량 폭증일 강조 (dailyActivity)
- [ ] 기간 필터

### Phase 0 — 퍼널 단계 순서 설정 (사용자 지정)
- [ ] 추적 select 필드의 옵션 순서를 퍼널 순서로 사용 (또는 별도 단계 순서 설정 — §10 Q1 확정)
- [ ] journey API가 그 순서로 stages 정렬

### 검증 (로컬, 운영 복원본)
- [ ] 디하 고객(예: #148374 노트킹) 여정 — 단계 계단 + 사이트/메일 섞여 시간순
- [ ] record #159755 (consult + status) 여정 표시
- [ ] 채널 필터 동작
- [ ] tracker_events 많은 record에서 성능/렌더 확인
- [ ] 이벤트 클릭 → 상세 meta

---

## 8. 기술 스택
- recharts (이미 사용 중) — 관여도 그래프
- SWR — 데이터 페칭
- 신규 라이브러리 없음(타임라인은 커스텀 또는 기존 UI 조합)

---

## 9. Risks & Considerations

### 9.1 tracker_events 볼륨
record당 페이지뷰 수십~수백 → 타임라인 폭주 가능. 세션 단위 묶기 또는 기간/개수 제한 필요(§10 Q2).

### 9.2 단계 순서 정의
퍼널 "계단"은 단계 순서를 알아야 함. 조직마다 다름. 최초엔 등장 순서로 추론, 명시 정의는 후속(§10 Q1).

### 9.3 데이터 없는 record
메일/트래커 연결 없는 record도 많음 → 빈 상태 UI 처리(이벤트 없으면 "아직 활동 없음").

### 9.4 시각 정렬 일관성
4개 소스의 시각 컬럼(occurred_at / occurredAt / clickedAt / sentAt) 타임존 통일 — 전부 timestamptz라 OK, normalize 시 ISO로.

### 9.5 권한
journey API도 orgId 격리 필수. tracker/email join 시 다른 org 데이터 안 섞이게.

---

## 10. Open Questions

### Q1. 퍼널 단계 순서 — 사용자 지정 (확정), 방식만 선택
사용자 지정으로 확정. 구현 방식 둘 중:
- **A. select 필드 옵션 순서 재사용**: 추적 켠 select 필드(예: status)의 옵션 정의 순서 = 퍼널 순서. 추가 설정 UI 없음, 이미 옵션 순서 편집 가능.
- B. 별도 "퍼널 단계 설정" UI: 단계와 순서를 따로 정의 (디하 match_stage처럼 외부 type도 포함하려면 필요)
- → A를 기본, 디하 단계(match_stage)처럼 select 아닌 것도 묶으려면 B 보완. design에서 확정.

### Q2. tracker_events 타임라인 표시 단위?
- A. 모든 페이지뷰 개별 표시 (상세하나 폭주)
- B. 세션 단위로 묶고 펼치기 ("5/2 사이트 방문 6페이지 ▾")
- → B 권장 (한눈에 + 펼치면 상세). Phase 1에서 결정 필요.

### Q3. 진입 동선 우선순위?
- record 상세 vs 트래커 visitor 상세 — 둘 다 넣되 어디가 메인?
- → record 상세가 메인(여정의 축이 record). 트래커 visitor 상세엔 보조 링크.

---

## 11. 완료 정의 (DoD) — 이거 다 되어야 "완료"
- [ ] journey API가 4개 소스를 시간순 통합 반환
- [ ] 퍼널 단계 순서 사용자 지정 + 그 순서로 계단 표시
- [ ] L1 퍼널 요약 + L2 타임라인 + L3 관여도 + L4 상세 모두 동작
- [ ] 채널 필터 + 단계 묶기 + 세션 묶기 동작
- [ ] 전문가 지표 전부: 단계별 소요시간, 전환 소요일, 첫 유입 경로, 활동 밀도(방문/클릭/클릭률/체류/세션), 현재 단계 뱃지
- [ ] 이탈 구간 경고(N일 무활동)
- [ ] 일별 활동량 폭증일 강조
- [ ] record 상세 + 트래커 visitor 상세에서 진입 가능
- [ ] 로컬 검증(실데이터) 통과
- [ ] 빈 상태/대용량/권한 처리

---

## 12. Next Step
- [ ] Plan 검토 + Q1~Q3 결정
- [ ] `/pdca design customer-journey` — API 스펙, normalize 로직, 컴포넌트별 상세, 시각화 라이브러리 적용
