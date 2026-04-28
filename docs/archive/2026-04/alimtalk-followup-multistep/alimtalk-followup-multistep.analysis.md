# Gap Analysis — alimtalk-followup-multistep

> 참조 Plan: [docs/01-plan/features/alimtalk-followup-multistep.plan.md](../01-plan/features/alimtalk-followup-multistep.plan.md)
> 참조 Design: [docs/02-design/features/alimtalk-followup-multistep.design.md](../02-design/features/alimtalk-followup-multistep.design.md)

## 1. Analysis Overview

- **Feature**: alimtalk-followup-multistep (알림톡 후속발송 다단계 체인 — 최대 5단계)
- **Date**: 2026-04-28
- **Verified Implementation Files**:
  - `drizzle/0041_alimtalk_followup_multistep.sql`
  - `src/lib/db/schema.ts` (alimtalkFollowupQueue / alimtalkSendLogs / alimtalkTemplateLinks)
  - `src/lib/alimtalk-automation.ts`
  - `src/components/alimtalk/FollowupStepsForm.tsx` (신규)
  - `src/components/alimtalk/AlimtalkTemplateLinkList.tsx`
  - `src/app/alimtalk/links/new/page.tsx`
  - `src/app/alimtalk/links/[id]/page.tsx`
  - `src/hooks/useAlimtalkTemplateLinks.ts`

운영 검증: BOL-1 (auto, step=0) → BOL-2 (followup, step=1, 1시간) → BOL-3 (followup, step=2, 10일) 체인 실제 발송 성공 확인됨.

## 2. FR-01 ~ FR-07 매핑

### FR-01. followupConfig 배열 확장 — Match

| 요구 | Design | 구현 | Status |
|------|--------|------|--------|
| `FollowupStep` 타입 정의 | O | alimtalk-automation.ts | Match |
| 단일 객체 ↔ 배열 양립 (하위호환) | O | schema.ts (`Array<...> \| {...} \| null`) | Match |
| `normalizeFollowupConfig` 헬퍼 | O | alimtalk-automation.ts | Match |
| 훅 타입에서도 배열 허용 | (Plan/Design 미명시) | useAlimtalkTemplateLinks.ts | Match (보강) |

### FR-02. 큐 테이블 step_index 컬럼 — Match

| 요구 | Design | 구현 | Status |
|------|--------|------|--------|
| `alimtalk_followup_queue.step_index integer DEFAULT 0 NOT NULL` | O | 0041 SQL | Match |
| `(parent_log_id, step_index)` UNIQUE INDEX | O | 0041 + schema.ts | Match |
| `alimtalk_send_logs.step_index integer DEFAULT 0 NOT NULL` | O | 0041 + schema.ts | Match |
| 마이그레이션 멱등성 (`DO $$ ... duplicate_column ...`) | (Design은 `IF NOT EXISTS`) | DO 블록 사용 | Match (다른 표현, 동일 효과) |

### FR-03. processAutoTrigger — 첫 step만 등록 — Match

| 요구 | Design | 구현 | Status |
|------|--------|------|--------|
| 배열 정규화 후 `steps[0]`만 등록 | O | alimtalk-automation.ts | Match |
| `enqueueFollowupStep` 헬퍼 (`onConflictDoNothing`) | O | 헬퍼 신설 | Match |
| `stepIndex: 0` 명시 | O | OK | Match |
| 0건이면 스킵 | O | `if (steps.length > 0)` 가드 | Match |

### FR-04. processFollowupItem — 발송 후 다음 step 체인 — Match

| 요구 | Design | 구현 | Status |
|------|--------|------|--------|
| 현재 step 조회 (`steps[item.stepIndex]`) | O | OK | Match |
| step 누락 시 fail close + skip | O | OK | Match |
| 후속발송용 link 가공 (templateCode/매핑 덮어쓰기) | O | OK | Match |
| `sendSingle` 호출 시 `targetStepIndex` 전달 (step+1) | O | OK | Match |
| 발송 성공 시 다음 step 큐 등록 (parentLogId = 이번 logId) | O | OK | Match |
| 발송 실패 시 체인 중단 | O | OK | Match |

### FR-05. 멱등성 체크 (step 단위) — Match

| 요구 | Design | 구현 | Status |
|------|--------|------|--------|
| `send_logs.step_index = item.stepIndex + 1` 컨벤션 | O | OK | Match |
| 멱등성 WHERE에 `step_index` 포함 | O | OK | Match |
| 1시간 윈도우 유지 | O | `IDEMPOTENCY_WINDOW_MS` | Match |
| `["sent", "pending"]` 두 상태 차단 | O | OK | Match |
| 중복 시 큐를 `sent`로 닫고 `stats.skipped++` | (Design 본문 미명시) | OK | Match (좋은 보강) |

### FR-06. UI 다단계 폼 — Match (의식적 변경 1건, 미세 차이 1건)

| 요구 | Design | 구현 | Status |
|------|--------|------|--------|
| 카드 리스트 + 추가/삭제 | O | FollowupStepsForm.tsx | Match |
| 최대 5개 step 제한 | O | `MAX_STEPS = 5` | Match |
| 시간 단위 토글 (시간/일) | O | OK | Match |
| 변수 매핑 (template variables 기반) | O | OK | Match |
| 호환성: 단일 객체 → 배열 자동 변환 (편집) | O | OK | Match |
| 단위 자동 감지 (delayHours/delayMinutes/delayDays) | O | OK | Match |
| 폼 하단 체인 자연어 미리보기 | O (선택) | 미구현, Summary에 `N단계` Badge만 | **Light Diff (Low)** |
| Step별 발신 프로필 필드 노출 | O | UI에 노출되지만 저장/사용 안 함 | **Intentional Diff (Medium)** |
| 순서 변경 (drag-and-drop) | X (Out of scope) | 미구현 | Match |
| 활성/비활성 토글 | X (Out of scope) | 미구현 | Match |

#### 6-A. 폼 하단 체인 자연어 미리보기 누락

- Design: "체인 미리보기: 폼 하단에 자연어 표현 `자동발송 → 3시간 → 1일` (선택)"
- 구현: 우측 Summary에 `N단계` Badge만
- List 화면(`AlimtalkTemplateLinkList`)에는 자연어 표시 → 폼 안에서만 누락
- 영향: UX 약간 저하. List에 동일 표현 있어 운영 무문제
- 우선순위: **Low**

#### 6-B. Step별 senderKey UI 노출 vs 저장 시 사용 안 함

- Plan/Design Section 8 Out of Scope: "Step별 발신자 다르게 (1차 link.senderKey 공통 사용)"
- 구현:
  - `FollowupStepsForm.tsx`의 `StepCard`에 발신 프로필 Select 노출
  - 저장 변환에 `senderKey` 미포함
  - `processFollowupItem` 발송 시 `link.senderKey`만 사용
- UI에는 보이지만 동작 안 함 → 사용자 혼선 가능
- 권장: (a) UI 임시 숨김 (b) placeholder 안내 (c) 정식 지원 (FR 추가)
- 우선순위: **Medium**

### FR-07. List 자연어 라벨 — Match

| 요구 | Design | 구현 | Status |
|------|--------|------|--------|
| `formatStepDelay(s)` 분/시/일 분기 | O | OK | Match |
| 체인 join `→` | O | OK | Match |
| 4개 이상 앞 3 + `+N` | O | OK | Match |
| 단일/null 처리 | O | OK | Match |

### FR-08. 검증 SQL — Out of code scope

운영 검증 결과로 갈음 (BOL-1 → BOL-2 → BOL-3 성공).

## 3. 의식적 변경 / Out of Scope 적정성

| # | 항목 | 분류 | 적정성 |
|---|------|------|--------|
| 1 | drag-and-drop 순서 변경 | Out of Scope (v1) | OK |
| 2 | step별 활성/비활성 | Out of Scope | OK |
| 3 | 조건부 분기 / 읽음 분기 / AI step | Out of Scope | OK |
| 4 | step별 senderKey 분리 (UI엔 있지만 사용 X) | Out of Scope | OK 하지만 UI 처리 필요 (6-B) |
| 5 | 기존 데이터 마이그레이션 SQL 미작성 | Plan 결정사항 | OK (런타임 정규화) |
| 6 | UI 단위 분(minute) 미노출 | followup-cron 결정 계승 | OK |

## 4. 추가로 발견한 부수적 이슈

| # | 이슈 | 우선순위 | 비고 |
|---|------|----------|------|
| 4.1 | `[id]/page.tsx` partitionId 탐색 N+1 호출 | Low | 기존 부채 (본 PDCA와 무관) |
| 4.2 | `MAX_STEPS = 5` 컴포넌트 내부 상수 | Low | 환경변수화는 후속 요청 시 |
| 4.3 | `enqueueFollowupStep`이 충돌 여부 무관 항상 로그 | Low | drizzle 한계 (followup-cron 5-2 동일) |
| 4.4 | `stats.skipped` 카운터 추가 활용 | Info | 응답 노출 OK |
| 4.5 | `processRepeatQueue`의 sendSingle 호출 호환 | Info | default 0 OK |
| 4.6 | `processAutoTrigger`도 stepIndex 명시 안 함 | Info | default 0 의도대로 |
| 4.7 | repeatConfig ↔ followupConfig 동시 사용 차단 토글 | Info | 합리적 UX |

## 5. Match Rate 산정

| FR | Score | Weight |
|----|-------|--------|
| FR-01 followupConfig 배열 확장 | 1.00 | 12% |
| FR-02 step_index 컬럼 + UNIQUE | 1.00 | 15% |
| FR-03 processAutoTrigger 첫 step | 1.00 | 12% |
| FR-04 processFollowupItem 체인 등록 | 1.00 | 18% |
| FR-05 멱등성 step 단위 | 1.00 | 13% |
| FR-06 UI 다단계 폼 | 0.90 | 18% |
| FR-07 List 자연어 라벨 | 1.00 | 7% |
| FR-08 검증 SQL (운영 결과) | 1.00 | 5% |

**가중평균: 98.2 / 100**

```
┌─────────────────────────────────────────────┐
│  Overall Match Rate: 98%                    │
├─────────────────────────────────────────────┤
│  Match:                7 FR                 │
│  Intentional Diff:     1 FR (FR-06 senderKey)│
│  Missing:              0                    │
│  운영 검증:            BOL-1→BOL-2→BOL-3 성공│
│  Risk Notes:           모두 Low/Medium       │
└─────────────────────────────────────────────┘
```

> 90% 이상 → Design과 구현 매우 잘 맞음. **Report 단계 진행 권장**.

## 6. Gap 항목 우선순위

### Medium

1. **Step별 senderKey UI 처리 일관화** (6-B)
   - UI에 노출되지만 저장/사용 안 됨 → 사용자 혼선 방지
   - 옵션: 임시 숨김 / placeholder 안내 / 정식 지원
   - 권장: placeholder 안내(가장 저비용)

### Low

2. **폼 하단 체인 자연어 미리보기 추가** (6-A)
3. **분 단위 UI 노출 / 환산 손실 보강** (4.6)
4. **MAX_STEPS 환경변수화** (4.2)
5. **편집 페이지 N+1 파티션 탐색 리팩토링** (4.1, 별도 PDCA)

### Info

6. 0041 마이그레이션 단순화 (`ADD COLUMN IF NOT EXISTS` 컨벤션) — 다음 마이그레이션 작성 시 통일 검토

## 7. Recommended Actions

### Immediate
없음. 운영 검증으로 정상 동작 확인됨.

### Short-term
- [ ] `FollowupStepsForm.tsx` Step별 senderKey Select에 `disabled` + placeholder 안내 또는 컴포넌트에서 제거 (6-B)
- [ ] (선택) 폼 하단에 `자동발송 → 3시간 → 10일` 자연어 한 줄 추가 (6-A)

### Long-term
- [ ] `delayMinutes` 사용 실적 SQL 확인 후 UI 분 단위 노출 여부 결정
- [ ] `MAX_STEPS` 설정 추출 (요청 들어오면)
- [ ] 편집 페이지 파티션 탐색 N+1 리팩토링 (별도 PDCA)

## 8. Next Steps

- 6-B (senderKey UI 처리) 가볍게 마무리 후 Match Rate 99% 도달 가능
- 또는 현 상태로 `/pdca report alimtalk-followup-multistep`로 완료 리포트 생성 (98% 임계값 충족)

## 부록: 의식적 차이(Intentional Diff)

| # | Design | 구현 | 사유 | 영향 |
|---|--------|------|------|------|
| 1 | Step별 senderKey 가능 (Design Props) | UI 노출되지만 저장/사용 안 함 | 1차는 link 공통 senderKey (Out of Scope) | UX 혼선 가능 — Medium |
| 2 | 폼 하단 체인 미리보기 (Design "선택") | 미구현, Summary는 `N단계` Badge | 우선순위 낮음 | UX 약화 — Low |
| 3 | UI 단위 분/시/일 (백엔드 타입 보유) | UI는 시/일만 | 이전 followup-cron PDCA 결정 계승 | 분 데이터 환산 손실 가능 — Low |
| 4 | 마이그레이션 SQL 단순 `IF NOT EXISTS` | `DO $$ ... EXCEPTION duplicate_column` | 동일 효과, 더 보수적 | 무문제 — Info |
| 5 | UNIQUE 충돌 후 큐 처리 명세 | 멱등성 충돌 시 큐 row를 `sent`로 닫고 `stats.skipped++` | 좀비 방지 + 관측성 | 양호 — 보강으로 평가 |
