# Completion Report: alimtalk-followup-multistep (알림톡 후속발송 다단계 체인)

> Date: 2026-04-28 | Match Rate: 98% | Status: Completed (운영 검증 완료)

## PDCA Cycle Summary

```
[Plan] ✅ → [Design] ✅ → [Do] ✅ → [Check] ✅ (98%) → [Report] ✅
```

## 1. Feature Overview

기존 1단계만 가능했던 알림톡 후속발송을 **N단계 체인 (최대 5단계)** 으로 확장. 이메일 후속발송 패턴 기반.

**시나리오 예시**:
```
자동발송(BOL-1, 즉시) → 후속1(BOL-2, 3시간) → 후속2(BOL-3, 10일) → ...
```

각 단계마다 다른 템플릿 / 다른 변수 매핑 / 다른 대기 시간 가능.

## 2. Deliverables

### 2.1 DB Layer
| File | Change |
|------|--------|
| `drizzle/0041_alimtalk_followup_multistep.sql` | step_index 컬럼 + UNIQUE 인덱스 추가 |
| `drizzle/meta/_journal.json` | journal에 0041 등록 (자동 마이그레이션 트리거) |

### 2.2 Schema
| File | Change |
|------|--------|
| `src/lib/db/schema.ts` | alimtalkFollowupQueue 객체 형태 + stepIndex + UNIQUE, alimtalkSendLogs.stepIndex, followupConfig 배열\|객체\|null |

### 2.3 Core Logic
| File | Change |
|------|--------|
| `src/lib/alimtalk-automation.ts` | 다단계 체인 로직 |

세부:
- `FollowupStep` 타입 정의 (Plan 결정 사항 반영: delayDays/delayHours/delayMinutes 다 지원)
- `normalizeFollowupConfig` (단일 객체 → 배열 정규화, 하위호환)
- `enqueueFollowupStep` (UNIQUE INDEX `onConflictDoNothing`로 중복 방지)
- `sendSingle` 시그니처에 `stepIndex` 추가 (default 0)
- `processAutoTrigger`: 첫 step만 등록
- `processFollowupItem`: 발송 후 다음 step 자동 큐 등록 + step 단위 멱등성

### 2.4 UI
| File | Change |
|------|--------|
| `src/components/alimtalk/FollowupStepsForm.tsx` | **신규** — 카드 리스트, 추가/삭제, 최대 5개 |
| `src/app/alimtalk/links/new/page.tsx` | 단일 state → 배열 (followupSteps) |
| `src/app/alimtalk/links/[id]/page.tsx` | 동일 + 단일 객체/배열 자동 변환 로드 |
| `src/components/alimtalk/AlimtalkTemplateLinkList.tsx` | 자연어 체인 표시 (`3시간 → 10일`, 4개 이상 `+N`) |
| `src/hooks/useAlimtalkTemplateLinks.ts` | followupConfig 타입 배열 허용 |

### 2.5 Documentation
| File | Status |
|------|--------|
| `docs/01-plan/features/alimtalk-followup-multistep.plan.md` | 작성 완료 |
| `docs/02-design/features/alimtalk-followup-multistep.design.md` | 작성 완료 |
| `docs/03-analysis/alimtalk-followup-multistep.analysis.md` | Match Rate 98% |
| `docs/04-report/features/alimtalk-followup-multistep.report.md` | 본 문서 |

## 3. Intentional Diff (Design vs 구현)

| # | Design | 구현 | 사유 | 영향 |
|---|--------|------|------|------|
| 1 | Step별 senderKey 가능 | UI 노출되지만 저장/사용 안 함 | 1차는 link 공통 senderKey (Plan Out of Scope) | UX 혼선 가능 — Medium |
| 2 | 폼 하단 체인 미리보기 (선택) | 미구현, Summary에 `N단계` Badge만 | 우선순위 낮음 | UX 약화 — Low |
| 3 | UI 단위 분/시/일 (백엔드 타입 보유) | UI는 시/일만 | 이전 followup-cron PDCA 결정 계승 | 분 데이터 환산 손실 가능 — Low |
| 4 | 마이그레이션 SQL `IF NOT EXISTS` | `DO $$ ... duplicate_column ...` | 동일 효과, 더 보수적 | 무문제 — Info |
| 5 | UNIQUE 충돌 처리 | 멱등성 충돌 시 큐를 `sent`로 닫고 `stats.skipped++` | 좀비 방지 + 관측성 | 양호 — 보강 |

## 4. Bug Fixes / 기술 결정 During Implementation

| Issue | Cause | Fix |
|---|---|---|
| `useAlimtalkTemplateLinks` 훅 타입 에러 (followupConfig 배열) | `Record<string, unknown> \| null`만 허용 | `Record<string, unknown>[] \| Record<string, unknown> \| null`로 확장 |
| `processAlimtalkFollowupQueue` 픽업 row에 stepIndex 누락 | raw SQL 반환 타입에 `step_index` 미정의 | 타입 정의 추가 + camelCase 매핑 (`stepIndex: row.step_index ?? 0`) |
| 운영 자동 마이그레이션 메커니즘 인지 누락 | `instrumentation.ts.register()` → `runMigrations()` 자동 동작 | `_journal.json`에 추가만 하면 자동 적용 |

## 5. Quality Metrics

### Match Rate: **98%**

| FR | Score | Note |
|----|-------|------|
| FR-01 followupConfig 배열 확장 | 1.00 | Match |
| FR-02 step_index 컬럼 + UNIQUE | 1.00 | Match |
| FR-03 processAutoTrigger 첫 step | 1.00 | Match |
| FR-04 processFollowupItem 체인 등록 | 1.00 | Match |
| FR-05 멱등성 step 단위 | 1.00 | Match |
| FR-06 UI 다단계 폼 | 0.90 | senderKey UI 미사용 (의식적) + 미리보기 미구현 (선택) |
| FR-07 List 자연어 라벨 | 1.00 | Match |
| FR-08 검증 SQL | 1.00 | 운영 검증 결과로 갈음 |

### 정량 지표

- 신규 파일: 3 (마이그레이션, FollowupStepsForm, plan/design/analysis/report 문서)
- 변경 파일: 6 (schema, automation, hook, list, new page, edit page)
- 변경 라인: +525 / -262
- TypeScript: `pnpm tsc --noEmit` EXIT=0
- Lint: `pnpm lint` 0 warnings on changed files
- 운영 검증: BOL-1 → BOL-2 → BOL-3 체인 3건 모두 NHN SUCCESS

### 운영 검증 (실제 발송 결과)

| 단계 | 시각 | 템플릿 | trigger_type | step_index | result |
|---|---|---|---|---|---|
| 0 | 16:56 | BOL-1 (서비스 소개서) | auto | 0 | sent (즉시) |
| 1 | 17:00 | BOL-2 (3일 무료 쿠폰) | followup | 1 | sent (NOW로 당김) |
| 2 | 17:20 | BOL-3 | followup | 2 | sent (NOW로 당김) |

체인 추적: `parent_log_id` 96 → 97 → 98 (정상 연결).

## 6. 운영 반영 가이드

### 6.1 자동 마이그레이션 동작

`instrumentation.ts.register()` 가 Next.js 부팅 시 호출되어 `runMigrations()`이 0041 자동 적용. **수동 SQL 불필요**.

확인 SQL:
```sql
SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 5;
-- 0041에 해당하는 hash row 존재
```

### 6.2 운영 검증 SQL

```sql
-- step별 큐 분포
SELECT step_index, status, COUNT(*) FROM alimtalk_followup_queue GROUP BY step_index, status;

-- 체인 추적
SELECT id, parent_log_id, trigger_type, step_index, template_code, status, sent_at
FROM alimtalk_send_logs WHERE record_id = ?
ORDER BY sent_at;

-- 멱등성 위반 (24시간 내 같은 record+link+step 2건 이상)
SELECT record_id, template_link_id, step_index, COUNT(*)
FROM alimtalk_send_logs
WHERE trigger_type = 'followup' AND sent_at >= NOW() - INTERVAL '24 hours'
GROUP BY record_id, template_link_id, step_index HAVING COUNT(*) > 1;

-- 좀비 큐
SELECT COUNT(*) FROM alimtalk_followup_queue
WHERE status = 'processing' AND processed_at < NOW() - INTERVAL '15 minutes';
```

운영 점검 결과 (검증 직후): 좀비 0, 끊긴 체인 없음.

### 6.3 사용 방법 (운영자/사용자)

1. 알림톡 링크 편집 페이지 → "후속 발송 사용" 토글 ON
2. Step 1 카드: 대기 시간 + 단위(시간/일) + 후속 템플릿 + 변수 매핑
3. "Step 추가" 버튼으로 최대 5개까지 단계 추가
4. 저장 → 다음 레코드 생성 시 자동으로 N단계 체인 작동

## 7. Out of Scope (별도 plan 가능)

| 항목 | 사유 |
|---|---|
| Step 순서 drag-and-drop | 5개 한도라 추가/삭제로 충분 |
| Step별 활성/비활성 | YAGNI |
| 조건부 분기 / 읽음 분기 / AI step | 알림톡 한계 또는 다른 기능 |
| Step별 senderKey 정식 지원 | UI는 보이지만 미사용 → Short-term 정리 권장 |
| `delayMinutes` UI 노출 | followup-cron PDCA 결정 계승 |
| `MAX_STEPS` 환경변수화 | 요청 들어오면 |

## 8. Lessons Learned

### 8.1 자동 마이그레이션 시스템의 위력
`instrumentation.ts.register()` + drizzle migrator 조합으로 코드 push만으로 운영 DB 자동 마이그레이션. 수동 SQL 실행 없이 안전. `_journal.json`만 정확히 등록하면 됨.

### 8.2 단일 객체 ↔ 배열 호환성 패턴
이메일 후속발송에 이미 있던 `normalizeFollowupConfig` 패턴을 그대로 적용. 데이터 마이그레이션 SQL 없이 런타임 정규화로 해결 → 안전하고 단순.

### 8.3 step_index 컨벤션 (auto=0, followup N=N+1)
`alimtalk_send_logs.step_index`에 단계 의미 통일. SQL 조회 시 직관적 (`WHERE step_index = 2` = "2번째 후속발송").

### 8.4 UNIQUE INDEX + onConflictDoNothing
`(parent_log_id, step_index)` UNIQUE로 같은 부모에 같은 step 두 번 등록 방지. 동시성 안전성 + 코드 단순함.

### 8.5 운영 검증 시 send_at NOW로 당기기
실제 1시간 / 10일 기다리지 않고 SQL로 `send_at = NOW()` 변경 → 다음 cron 사이클(매 10분)에 즉시 발송 → 30분 안에 3단계 체인 전체 검증 완료. 효율적.

### 8.6 raw SQL 반환 타입 매핑
drizzle/postgres-js의 `db.execute()` 결과는 snake_case row 배열. 컬럼 추가 시 타입 정의 + camelCase 매핑 둘 다 손봐야 함. 빠뜨리면 타입 에러 즉시 발생.

## 9. Next Steps (사용자 / 운영 작업)

- [x] Git commit & push (운영 자동 배포)
- [x] 운영 DB 자동 마이그레이션 적용
- [x] 운영 환경에서 다단계 체인 발송 검증
- [ ] (선택) Step별 senderKey UI 처리 일관화 (Medium)
- [ ] (선택) 폼 하단 체인 자연어 미리보기 추가 (Low)

## 10. Archive

운영 검증 완료. 아카이빙 준비 완료. `/pdca archive alimtalk-followup-multistep`로 진행 가능.
