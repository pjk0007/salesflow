# Completion Report: ai-batch-send

## 1. 개요

| 항목 | 값 |
|------|------|
| Feature | AI 자동발송 배치 처리 |
| 시작일 | 2026-03-12 |
| 완료일 | 2026-03-12 |
| Match Rate | 100% (16/16) |
| Iteration | 0회 |
| 변경 파일 | 1개 |
| 변경 LOC | ~15 LOC (교체) |

## 2. 문제 및 해결

### 문제
bulk-import 시 AI 자동발송(`processAutoPersonalizedEmail`)이 순차 실행되어 3,000건 기준 약 25시간 소요.

### 해결
5건/배치 `Promise.allSettled` 병렬 처리 + 1초 딜레이로 교체. 예상 5배 속도 개선 (~5시간).

## 3. 구현 내용

### 변경 파일

| 파일 | 변경 내용 | LOC |
|------|-----------|-----|
| `src/app/api/partitions/[id]/records/bulk-import/route.ts` | 순차 IIFE → 배치 병렬 IIFE | ~15 |

### 핵심 코드 (route.ts:130-145)

```ts
// AI 자동발송은 배치 병렬 실행 (5건/배치, 1초 딜레이로 rate limit 준수)
(async () => {
    const BATCH_SIZE = 5;
    const BATCH_DELAY_MS = 1000;
    for (let i = 0; i < result.insertedRecords.length; i += BATCH_SIZE) {
        const batch = result.insertedRecords.slice(i, i + BATCH_SIZE);
        await Promise.allSettled(
            batch.map(record =>
                processAutoPersonalizedEmail({ record, partitionId, triggerType: "on_create", orgId: user.orgId })
            )
        );
        if (i + BATCH_SIZE < result.insertedRecords.length) {
            await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
        }
    }
})();
```

## 4. 설계 결정

| 결정 | 근거 |
|------|------|
| `BATCH_SIZE = 5` | Gemini Paid RPM 1,000+ 대비 분당 최대 300건으로 안전 |
| `BATCH_DELAY_MS = 1000` | 배치 간 1초 쿨링으로 burst 방지 |
| `Promise.allSettled` | 일부 실패해도 나머지 계속 처리 (vs `Promise.all`은 하나 실패 시 전체 중단) |
| fire-and-forget 유지 | API 응답은 즉시 반환, 배치 처리는 백그라운드 |

## 5. 미변경 사항

- `processAutoPersonalizedEmail` 함수 내부 로직 변경 없음
- 알림톡/이메일 자동화/보강: 기존 fire-and-forget 패턴 유지
- 단건 생성(`dispatchAutoTriggers`): 변경 없음
- 프론트엔드: 변경 없음

## 6. Gap 분석 결과

| 카테고리 | 항목 수 | Match | Gap |
|----------|---------|-------|-----|
| 변경 범위 | 2 | 2 | 0 |
| 배치 처리 구현 | 9 | 9 | 0 |
| 비변경 사항 | 3 | 3 | 0 |
| 코멘트 | 2 | 2 | 0 |
| **합계** | **16** | **16** | **0** |

## 7. 성능 예상

| 시나리오 | Before (순차) | After (배치) | 개선 |
|----------|---------------|--------------|------|
| 100건 | ~50분 | ~10분 | 5x |
| 1,000건 | ~8.3시간 | ~1.7시간 | 5x |
| 3,000건 | ~25시간 | ~5시간 | 5x |

※ 건당 평균 ~30초 기준 (AI 생성 + NHN 발송). 실제 시간은 AI 응답 속도에 따라 변동.

## 8. 빌드 검증

- `npx next build`: 성공
