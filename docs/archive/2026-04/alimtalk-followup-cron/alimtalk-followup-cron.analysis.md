# Gap Analysis — alimtalk-followup-cron

> 참조 Plan: [docs/01-plan/features/alimtalk-followup-cron.plan.md](../01-plan/features/alimtalk-followup-cron.plan.md)
> 참조 Design: [docs/02-design/features/alimtalk-followup-cron.design.md](../02-design/features/alimtalk-followup-cron.design.md)

## 1. Analysis Overview

- **Feature**: alimtalk-followup-cron (알림톡 후속발송 cron + 시간단위 + 동시성 안전장치)
- **Date**: 2026-04-28
- **Verified Implementation Files**:
  - `src/lib/alimtalk-automation.ts`
  - `src/app/api/alimtalk/automation/process-followups/route.ts`
  - `src/lib/db/schema.ts`
  - `drizzle/0036_alimtalk_followup.sql`
  - `src/app/alimtalk/links/new/page.tsx`
  - `src/app/alimtalk/links/[id]/page.tsx`
  - `src/components/alimtalk/AlimtalkTemplateLinkList.tsx`
  - `src/components/ui/toggle-group.tsx`, `toggle.tsx` (신규)

## 2. FR-01 ~ FR-08 매핑

### FR-01. 후속발송 cron 엔드포인트 통일 — Match

| 요구 | Design | 구현 | Status |
|------|--------|------|--------|
| `POST /api/alimtalk/automation/process-followups` | O | route.ts | Match |
| `x-secret`/`Bearer`/`?secret=` 인증 | O | 3가지 모두 지원 | Match |
| `processAlimtalkFollowupQueue` 호출 | O | route.ts | Match |
| 기존 GET endpoint 삭제 | O | 부재 확인 | Match |

### FR-02. 시간 단위 후속발송 지원 — Match (의식적 변경 1건)

| 요구 | Design | 구현 | Status |
|------|--------|------|--------|
| `delayHours` 타입 추가 | O | schema.ts followupConfig | Match |
| `delayMinutes` 타입 추가 | O | schema.ts followupConfig | Match (백엔드만) |
| `computeFollowupSendAt` 헬퍼 | O | alimtalk-automation.ts | Match |
| 큐 등록 시 헬퍼 사용 | O | `processAutoTrigger` 안 | Match |
| UI 단위 선택 (분/시/일) | O | 시/일만 (사용자 결정) | **Intentional Diff** |
| UI 기본 단위 = "일" | O (하위호환) | `useState<"hours"\|"days">("days")` | Match |
| 기존 `delayDays` 데이터 로드 | O | edit page 단위 자동 감지 | Match |

### FR-03. 외부 cron 등록 — Out of Code Scope

운영 작업(클라우드타입 스케줄러 등록)이라 코드 검증 대상 아님. 엔드포인트는 POST + `X-Secret` 패턴 수용 가능 상태.

### FR-04. 인덱스 추가 — Intentional Diff (Risk Note)

| 요구 | Design | 구현 | Status |
|------|--------|------|--------|
| `(status, send_at)` partial index `WHERE status IN ('pending','processing')` | O | 기존 `0036`의 일반 인덱스 `alfq_status_send_idx` 사용, 추가 안 함 | **Intentional Diff** |

- 사유: 0036 마이그레이션 시점에 일반 인덱스가 이미 있어 추가 마이그레이션 생략
- 운영 영향: 큐 누적되어 `sent`/`failed`가 다수가 되면 인덱스 크기 증가 + 픽업 효율 partial 대비 저하. 단기 무관, 장기 시점에 partial 교체 권장
- 우선순위: **Low**

### FR-05. 동시성 안전장치 — Match (구현 차이 3건)

| 항목 | Design | 구현 | Status |
|------|--------|------|--------|
| 5-1. atomic 픽업 (`UPDATE...RETURNING + FOR UPDATE SKIP LOCKED`) | O | 구현됨 | Match |
| 5-2. 좀비 청소 (`processing` 10분 초과 → `pending`) | O | 구현됨 | Match |
| 5-2. 좀비 복구 rowCount 로그 | O | 제거됨 (drizzle/postgres-js 호환성) | **Intentional Diff** |
| 5-3. 멱등성 체크 (1시간 윈도우) | O | 구현됨 | Match |
| 5-4. advisory lock | O | 구현됨 | Match |
| 5-4. lock 키 표현: `hashtext('alimtalk-followup-cron')` | O | 정수 상수 `0x4f57a70b` 사용 | **Intentional Diff** |
| 5-5. 8분 타임아웃 | O | 구현됨 | Match |
| `try/finally`로 lock 해제 | O | 구현됨 | Match |

#### 5-4 advisory lock 키 차이

- Plan: `pg_try_advisory_lock(hashtext('alimtalk-followup-cron'))`
- Design 본문: `0xa11ba70b`
- 실제 코드: `0x4f57a70b` ← Design 본문 상수와 다름

문제:
1. Design 본문 상수값과 실제 코드값 불일치 — Design 갱신 필요
2. `hashtext()` 미사용은 운영 무문제. 정수 상수가 결정론적이라 오히려 명확
3. PostgreSQL `pg_try_advisory_lock(bigint)` 시그니처 정상 사용

권장:
- Design 문서 상수값 갱신
- 다중 cron 추가 시 `lib/db/locks.ts` 모듈로 키 모으기 (Design 9-2)

우선순위: **Medium** (문서-코드 일치)

#### 5-2 좀비 복구 rowCount 로그 누락

- 사유: drizzle/postgres-js 조합에서 `rowCount`가 안정적이지 않아 사용자가 의식적으로 제거
- 영향: 좀비 복구 빈도/규모 추적이 로그만으론 불가, 검증 SQL로 보완

권장: 추후 별도 SELECT로 카운트 로깅 보강 가능 (비용 미미)
우선순위: **Low**

### FR-06. 처리량 확보 — Match

| 항목 | Design | 구현 | Status |
|------|--------|------|--------|
| `BATCH_SIZE = 5` | O | 적용 | Match |
| `BATCH_DELAY_MS = 1000` | O | 적용 | Match |
| `Promise.allSettled` 병렬 | O | 적용 | Match |
| 배치 간 1초 딜레이 (마지막 제외) | O | 적용 | Match |

### FR-07. 발송 완료 항목 보존 정책 — Out of Scope

이번 plan에서 명시적으로 제외. 별도 plan 필요. **Match (의도된 미구현)**.

### FR-08. 기존 GET 엔드포인트 처리 — Match

`src/app/api/cron/alimtalk-followup/route.ts` 부재 확인 → 삭제 완료.

## 3. 추가 점검

### 3.1 advisory lock 키 hashtext 미사용

운영 무문제. Design 문서값(`0xa11ba70b`)과 실제 코드값(`0x4f57a70b`) 불일치 → Design 갱신 필요.

### 3.2 `closeQueueItem` 의 status 타입에 `cancelled` 누락

- Design Section 2: `// status: 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled'`
- 실제: `closeQueueItem(id: number, status: "sent" | "failed")`
- 분석: 후속발송 큐에는 `cancelled` 사용 경로가 없음. DB는 varchar(20)이라 어떤 값이든 들어감. 타입 좁힘.
- 우선순위: **Low** (현재 미사용)

권장:
- 시그니처 확장 `"sent" | "failed" | "cancelled"` (미래 확장성)
- 또는 Design에 "후속 큐는 cancelled 사용 안 함" 명시

### 3.3 좀비 복구 rowCount 로그 누락

→ FR-05-2 분석 참조. **Low**.

## 4. 추가로 발견한 부수적 이슈

### 4.1 `db.execute` 반환 형태 — Design과 코드 차이

- Design 예시: `lockResult.rows?.[0]?.acquired`
- 실제: `lockResult[0]?.acquired`

`drizzle-orm` + `postgres-js` 조합에서는 `db.execute()`가 직접 row 배열을 반환. **Design 코드 예시 오류 → 문서 수정 필요**. 우선순위: **Low**.

### 4.2 멱등성 체크에 `pending` 포함

`inArray(alimtalkSendLogs.status, ["sent", "pending"])` — NHN 응답이 늦어 pending 상태인 발송도 "이미 발송"으로 간주. 의도된 동작. **OK**.

### 4.3 `processAutoTrigger`의 `followupConfig` 타입 캐스팅

모든 단위가 `undefined`/`0`이면 `computeFollowupSendAt`이 안전장치로 1일 기본값 사용. **OK**.

### 4.4 UI: 시간 단위 max 720시간 제한

`max={followupDelayUnit === "hours" ? 720 : 30}` — 720시간(=30일)은 일 단위 30일과 일관. **합리적**. 우선순위: **Low**.

### 4.5 분 단위 데이터의 시간 환산

`delayMinutes` 가 있으면 `Math.max(1, Math.round(fc.delayMinutes / 60))` 시간으로 변환. 정확도 손실 가능 (예: 30분 → 1시간 → 저장 시 1시간 덮어씀). 운영 DB에 분 단위 사용 실적 0이면 무시 가능. 우선순위: **Low**.

## 5. Match Rate 산정

| FR | Status | Score | Weight |
|---|---|---|---|
| FR-01 cron endpoint 통일 | Match | 1.00 | 15% |
| FR-02 시간 단위 후속발송 | Match (의식적 변경: 분 단위 UI 제외) | 0.95 | 15% |
| FR-03 외부 cron 등록 | Out of code scope | 1.00 | 5% |
| FR-04 인덱스 추가 | Intentional diff (partial → 일반) | 0.85 | 10% |
| FR-05 동시성 안전장치 | Match (key 값/log 미세 차이) | 0.95 | 25% |
| FR-06 처리량 확보 | Match | 1.00 | 15% |
| FR-07 보존 정책 | Out of scope per plan | 1.00 | 5% |
| FR-08 GET endpoint 삭제 | Match | 1.00 | 5% |
| 추가 검증(타입/UI) | Match | 0.95 | 5% |

**가중평균: 96.25 / 100**

```
┌─────────────────────────────────────────────┐
│  Overall Match Rate: 96%                    │
├─────────────────────────────────────────────┤
│  Match:                7 FR (87.5%)         │
│  Intentional Diff:     2 FR (FR-02 부분, FR-04) │
│  Missing:              0                    │
│  Risk Notes:           3 (모두 Low/Medium)   │
└─────────────────────────────────────────────┘
```

> 90% 이상 → Design과 구현 매우 잘 맞음. **Report 단계 진행 권장**.

## 6. Gap 항목 우선순위

### Medium

1. **Design 문서의 advisory lock 상수값 갱신**
   - `0xa11ba70b` → 실제 `0x4f57a70b`
   - Section 3-2, 9-2 둘 다 영향
   - 후속으로 `lib/db/locks.ts` 모듈화 검토

2. **Design 문서의 `db.execute` 예시 코드 정정**
   - `lockResult.rows?.[0]` → `lockResult[0]`
   - 픽업 쿼리도 동일

### Low

3. **`closeQueueItem` 시그니처에 `cancelled` 추가 (선택)**
4. **좀비 복구 카운트 로깅 보강 (선택)**
5. **Partial index 마이그레이션 (운영 부하 시점에)**
6. **분 단위 데이터의 시간 환산 손실 확인** (운영 DB에 분 단위 사용 실적 SQL로 체크)

## 7. Recommended Actions

### Immediate
없음. 즉시 처리 필요한 결함 없음.

### Short-term (Design 문서 갱신)
- [ ] Design 3-2: advisory lock 상수값을 `0x4f57a70b`로 수정
- [ ] Design 3-2: `lockResult.rows?.[0]` → `lockResult[0]` 예시 수정
- [ ] Design 9-2 끝부분에 "다중 cron 추가 시 `lib/db/locks.ts` 분리 권장" 보강

### Long-term (운영 모니터링)
- [ ] 좀비 복구 카운트 로깅 추가 (선택)
- [ ] `closeQueueItem` cancelled 확장 또는 Design 명시 (선택)
- [ ] 큐 누적 시 partial index 마이그레이션 (선택)

## 8. Next Steps

- Design 문서 미세 수정 (Short-term 3건)
- `/pdca report alimtalk-followup-cron`으로 완료 리포트 생성 권장 (Match Rate 96%로 임계값 충족)

## 부록: 의식적 차이(Intentional Diff)

| # | Design | 구현 | 사유 | 영향 |
|---|---|---|---|---|
| 1 | UI에 분/시/일 3종 | UI는 시/일만 (백엔드는 분 단위 타입 유지) | 사용자 요청 | 하위호환 보존 |
| 2 | partial index 신규 | 기존 일반 인덱스 재사용 | 0036에 인덱스 이미 존재 | 큐 누적 시 효율 저하 가능, 단기 무관 |
| 3 | status enum 확장 | varchar 그대로 | 코드 호환성 유지 | DB 변경 없음 |
| 4 | UI: Select 드롭다운 | shadcn ToggleGroup + 자연어 미리보기 | 사용자 요청 | UX 향상 |
| 5 | advisory lock 키 `hashtext('...')` | 정수 상수 `0x4f57a70b` | 가독성/결정성 | 운영 무문제, 단 Design 본문값(`0xa11ba70b`)과 불일치 |
| 6 | 좀비 복구 rowCount 로그 | 제거 | drizzle/postgres-js 호환성 | 관측성 약화 |
