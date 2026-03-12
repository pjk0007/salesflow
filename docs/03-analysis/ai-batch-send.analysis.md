# Gap Analysis: ai-batch-send

## 1. 분석 개요

| 항목 | 값 |
|------|------|
| Feature | ai-batch-send |
| Plan | `docs/01-plan/features/ai-batch-send.plan.md` |
| 구현 파일 | `src/app/api/partitions/[id]/records/bulk-import/route.ts` |
| 분석일 | 2026-03-12 |
| Match Rate | **100%** |

## 2. 항목별 비교

### 2.1 변경 범위 (Plan 5절)

| # | Plan 항목 | 구현 | Status |
|---|-----------|------|--------|
| 1 | `bulk-import/route.ts` 변경 | 130-145행 배치 처리로 교체 | Match |
| 2 | 빌드 검증 (`npx next build`) | 빌드 성공 확인 | Match |

### 2.2 배치 처리 구현 (Plan 5절 TO-BE 코드)

| # | Plan 스펙 | 구현 (route.ts:130-145) | Status |
|---|-----------|-------------------------|--------|
| 1 | IIFE 패턴 유지 | `(async () => { ... })();` | Match |
| 2 | `BATCH_SIZE = 5` | `const BATCH_SIZE = 5;` (132행) | Match |
| 3 | `BATCH_DELAY_MS = 1000` | `const BATCH_DELAY_MS = 1000;` (133행) | Match |
| 4 | `for` loop with `i += BATCH_SIZE` | `for (let i = 0; i < ...; i += BATCH_SIZE)` (134행) | Match |
| 5 | `slice(i, i + BATCH_SIZE)` | `result.insertedRecords.slice(i, i + BATCH_SIZE)` (135행) | Match |
| 6 | `Promise.allSettled` | `await Promise.allSettled(batch.map(...))` (136-140행) | Match |
| 7 | `processAutoPersonalizedEmail` 호출 파라미터 | `{ record, partitionId, triggerType: "on_create", orgId: user.orgId }` | Match |
| 8 | 마지막 배치 후 딜레이 스킵 | `if (i + BATCH_SIZE < result.insertedRecords.length)` (141행) | Match |
| 9 | `setTimeout` 딜레이 | `await new Promise(r => setTimeout(r, BATCH_DELAY_MS))` (142행) | Match |

### 2.3 비변경 사항 (Plan 8절)

| # | Plan 항목 | 구현 | Status |
|---|-----------|------|--------|
| 1 | `processAutoPersonalizedEmail` 함수 미변경 | 변경 없음 | Match |
| 2 | 알림톡/이메일/보강 fire-and-forget 유지 | 123-129행 기존 패턴 유지 | Match |
| 3 | 단건 `dispatchAutoTriggers` 미변경 | 다른 route 파일 변경 없음 | Match |

### 2.4 코멘트 업데이트

| # | 항목 | 구현 | Status |
|---|------|------|--------|
| 1 | import 코멘트 | `batched AI email (rate limit safe)` (8행) | Match |
| 2 | IIFE 코멘트 | `배치 병렬 실행 (5건/배치, 1초 딜레이로 rate limit 준수)` (130행) | Match |

## 3. 결과 요약

| 카테고리 | 총 항목 | Match | Gap |
|----------|---------|-------|-----|
| 변경 범위 | 2 | 2 | 0 |
| 배치 처리 구현 | 9 | 9 | 0 |
| 비변경 사항 | 3 | 3 | 0 |
| 코멘트 | 2 | 2 | 0 |
| **합계** | **16** | **16** | **0** |

## 4. Match Rate

**16/16 = 100%**

## 5. Gap 목록

없음.
