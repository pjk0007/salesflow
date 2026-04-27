# 설계-구현 갭 분석 — records-group-pagination

> Plan: [docs/01-plan/features/records-group-pagination.plan.md](../01-plan/features/records-group-pagination.plan.md)
> Design: [docs/02-design/features/records-group-pagination.design.md](../02-design/features/records-group-pagination.design.md)
> 분석일: 2026-04-27

## 종합 점수

| 카테고리 | 점수 | 상태 |
|---------|:---:|:----:|
| 설계 일치도 | 95% | OK |
| 아키텍처 준수 | 100% | OK |
| 컨벤션 준수 | 100% | OK |
| **종합 Match Rate** | **96%** | OK |

## FR 검증 결과

| FR | 요구사항 | 결과 | 위치 |
|----|---------|:---:|------|
| FR-1 | 그룹뷰에서 하단 페이지네이션 숨김 | ✅ | [page.tsx:442-484](../../src/app/records/page.tsx) — `viewMode === "grouped"`일 때 `RecordTable`(페이지네이션 포함) 미렌더 |
| FR-2 | 그룹별 독립 "더 보기" (서버 그룹 필터) | ✅ | [route.ts:81-88](../../src/app/api/partitions/[id]/records/route.ts) `data->>{key} = {value}` / 미분류 분기 |
| FR-3 | 그룹 헤더 카운트 = 그룹 전체 개수 | ✅ | [RecordGroup.tsx:178](../../src/components/records/RecordGroup.tsx) `{count.toLocaleString()}` (서버 카운트) |
| FR-4 | 더 보기 버튼 + 무한 스크롤 둘 다 | ✅ | [RecordGroup.tsx:218-238](../../src/components/records/RecordGroup.tsx) 버튼 + `useInfiniteScroll` sentinel |
| FR-5 | 그룹별 로딩 상태 | ✅ | [RecordGroup.tsx](../../src/components/records/RecordGroup.tsx) 초기 spinner / 추가 로드 spinner 분리 |
| FR-6 | 검색/필터/정렬 변경 시 모든 그룹 페이지 리셋 | ✅ | [RecordGroup.tsx:72-75](../../src/components/records/RecordGroup.tsx) 의존성 배열에 `search, filtersKey, distributionOrder, sortField, sortOrder` |
| FR-7 | 그룹별 페이지 사이즈 50건 | ✅ | [RecordGroup.tsx:12](../../src/components/records/RecordGroup.tsx) `GROUP_PAGE_SIZE = 50` |
| FR-8 | status 변경 시 전체 그룹 mutate | ✅ | [RecordGroup.tsx](../../src/components/records/RecordGroup.tsx) → [GroupedRecordView.tsx](../../src/components/records/GroupedRecordView.tsx) `globalMutate` |

## Design과 다른 더 나은 구현 (Gap 아님)

| 항목 | Design | 실제 구현 | 평가 |
|------|--------|----------|------|
| 페이지네이션 방식 | `pageSize = 50 × loadedPages` 단일 호출 | page별 개별 fetch + `accumulated` state 누적 | ✅ SWR 키 전환 시 빈 화면/스크롤 점프 회피 — 사용자 피드백 반영 |
| group-counts GROUP BY | `GROUP BY data->>{groupBy}` 표현식 | `GROUP BY 1` (alias 위치) | ✅ Drizzle `sql` 노드 재작성 이슈 회피 |
| pageSize 상한 | "1000으로 완화" | `Math.min(1000, ...)` | ✅ Design 일치 |

## 의도적 비활성 (Design 11. 후속작업)

- `duplicateHighlight` 그룹뷰 비활성화 ([RecordGroup.tsx](../../src/components/records/RecordGroup.tsx) `duplicateHighlight={null}`) — Design에 명시됨

## 권장 개선 (P3, 현재 동작 영향 없음)

1. **search/filter where-builder 헬퍼 추출**
   [route.ts](../../src/app/api/partitions/[id]/records/route.ts)의 switch 블록과 [group-counts/route.ts](../../src/app/api/partitions/[id]/records/group-counts/route.ts)의 switch가 동일(~50줄). 새 operator 추가 시 한쪽 누락 위험. `src/lib/records/buildWhereConditions.ts`로 추출 권장 (Design 2.2에 이미 옵션 명시).

2. **`onCreateWithStatus` TODO 마무리**
   [page.tsx:458-461](../../src/app/records/page.tsx) — 현재 statusValue를 받지만 CreateRecordDialog에 기본값 전달 안 함. 그룹의 "+ 신규 Item" 클릭 시 자동 status 설정 기능 미완성.

3. **타입 공유 위치**
   `GroupCountsResponse`가 `useGroupCounts.ts` 내부에만 존재. 외부 참조 필요 시 `src/components/records/types/index.ts`로 분리.

## 결론

Match Rate **96%** — Report 단계 진행 가능.
