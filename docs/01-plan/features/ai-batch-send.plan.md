# Plan: AI 자동발송 배치 처리 (ai-batch-send)

## 1. 개요

bulk-import 시 AI 자동발송(processAutoPersonalizedEmail)이 현재 순차 실행되어, 3,000건 기준 약 25시간 소요. 배치 병렬 처리로 처리 속도를 대폭 개선한다.

## 2. 현황 (As-Is)

### 현재 코드 (`bulk-import/route.ts:131-139`)
```ts
(async () => {
    for (const record of result.insertedRecords) {
        try {
            await processAutoPersonalizedEmail({ record, partitionId, triggerType: "on_create", orgId: user.orgId });
        } catch (err) {
            console.error("Bulk import: auto personalized email error:", err);
        }
    }
})();
```

### 문제점
- **순차 처리**: 한 건당 ~30초 (AI 생성 + NHN 발송) → 3,000건 = ~25시간
- **Gemini API rate limit**: 순차로 해둔 이유지만, RPM(분당 요청) 기준이므로 동시 처리해도 일정 수 이하면 문제없음
- **NHN 이메일 API**: 개별 발송 기준 rate limit 없음 (대량발송 API가 아닌 sendEachMail)

## 3. 목표 (To-Be)

- 배치 단위(예: 5건)로 `Promise.allSettled` 병렬 처리
- 배치 간 딜레이(1초)로 rate limit 준수
- 3,000건 기준: ~25시간 → ~5시간 (5배 개선)
- 기존 fire-and-forget 패턴 유지

## 4. 핵심 제약

| 제약 | 설명 |
|------|------|
| Gemini API RPM | Free tier: 15 RPM, Paid: 1,000+ RPM |
| 회사 조사 | `autoResearch=1`이면 AI 호출 2회 (조사 + 이메일 생성) |
| 쿨다운 | 같은 record + ai_auto에 1시간 내 중복 방지 (기존 로직) |
| NHN sendEachMail | 분당 제한 없으나 동시 대량은 자제 |

## 5. 변경 범위

| # | 파일 | 변경 |
|---|------|------|
| 1 | `src/app/api/partitions/[id]/records/bulk-import/route.ts` | 순차 IIFE → 배치 병렬 처리 유틸 호출 |
| 2 | 빌드 검증 | `npx next build` |

### 변경 상세

`bulk-import/route.ts`의 AI 자동발송 IIFE(131-139행)를 배치 처리로 교체:

```ts
// AS-IS: 순차
(async () => {
    for (const record of result.insertedRecords) {
        await processAutoPersonalizedEmail({...});
    }
})();

// TO-BE: 배치 병렬
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

## 6. 배치 사이즈 결정 근거

- **5건/배치, 1초 딜레이**: 초당 최대 5건 = 분당 300건 → Gemini Paid RPM(1,000+) 안전 범위
- `autoResearch` 활성 시 2배 API 호출 → 분당 600건 → 여전히 안전
- Free tier(15 RPM)에서도 5건/배치 + 1초 딜레이면 배치당 12초 이상 소요(AI 처리 시간) → 실질적으로 RPM 초과 불가
- NHN 이메일도 분당 5건 수준이라 과부하 없음

## 7. 리스크

| 리스크 | 완화 |
|--------|------|
| Gemini rate limit 초과 | processAutoPersonalizedEmail 내부 개별 에러 처리(try/catch)로 실패 건만 스킵 |
| 메모리 | 기존과 동일 (레코드 참조만 유지) |
| NHN 동시 요청 | 5건/배치로 충분히 안전 |

## 8. 비변경 사항

- `processAutoPersonalizedEmail` 함수 자체는 변경하지 않음
- 알림톡/이메일 자동화/보강은 기존 fire-and-forget 유지 (이미 병렬)
- 단건 생성(`dispatchAutoTriggers`)은 변경 없음
