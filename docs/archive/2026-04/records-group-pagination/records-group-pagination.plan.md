# 레코드 그룹뷰 페이지네이션 개선

> **Plan 단계** — 이 문서는 요구사항/범위/우선순위 정의용. 구현 세부 설계는 Design 단계에서.

## 1. 배경 (Why)

현재 레코드 페이지는 **플랫뷰 / 그룹뷰** 두 가지 보기 모드를 제공한다.

- 플랫뷰: 서버 페이지네이션 (page/pageSize, 50건 단위) — **정상 동작**
- 그룹뷰: select 타입 + `isGroupable` 필드 기준으로 클라이언트에서 그룹핑 — **페이지네이션 비정상**

### 정확한 원인
1. `useRecords` 훅이 파티션 전체 기준 `?page=X&pageSize=50`로 단일 호출
2. `GroupedRecordView`는 받아온 50건을 클라이언트에서 `groupRecordsByStatus()`로 분류만 함
3. 결과: 그룹뷰에서 보는 "신규 23건"은 **현재 페이지 50건 안에 우연히 들어있는 23건**일 뿐, 그 그룹의 전체가 아님
4. 하단 페이지네이션이 "다음 페이지"로 가면 → 다른 그룹의 레코드들로 모두 갈아엎힘 → 사용자에겐 페이지네이션이 깨진 것처럼 보임

### 사용자 요구
- 그룹뷰일 때는 **하단 페이지네이션 숨김**
- 그룹별로 **"더 불러오기" 버튼** 또는 **그룹 영역 스크롤 도달 시 자동 추가 로드**
- 각 그룹은 독립적으로 페이징 (서버에서 그룹별로 limit/offset 적용)

## 2. 목표 (What)

| ID | 요구사항 | 우선순위 |
|----|---------|---------|
| FR-1 | 그룹뷰에서 하단 전체 페이지네이션 UI 숨김 | P0 |
| FR-2 | 그룹별로 독립적인 "더 보기" 동작 (서버에서 해당 그룹 값 필터 + offset/limit) | P0 |
| FR-3 | 각 그룹 헤더 옆 카운트는 **그룹 전체 개수** (현재 로드된 개수가 아님) | P0 |
| FR-4 | "더 보기" 버튼 + IntersectionObserver 기반 무한 스크롤 (**둘 다 지원**) | P0 |
| FR-5 | 그룹별 로딩 상태 표시 (스피너 또는 스켈레톤) | P1 |
| FR-6 | 검색/필터/정렬 변경 시 모든 그룹 페이지 상태 리셋 | P0 |
| FR-7 | **그룹별 페이지 사이즈 = 50건** (한 번에 50개씩 추가 로드) | P0 |
| FR-8 | status 필드 변경(그룹 간 이동) 시 → 전체 그룹 mutate (단순 처리) | P1 |

### 비목표 (Out of Scope)
- 플랫뷰 페이지네이션 변경 (현 동작 유지)
- 그룹 간 드래그 앤 드롭으로 status 변경 (별도 기능)
- 그룹 펼침/접힘 상태 영속화 (별도 기능)
- **status 변경에 대한 낙관적 그룹 간 이동** — 단순 전체 mutate로 처리 (FR-8)

## 3. 사용자 시나리오

1. 사용자가 레코드 페이지 진입 → 플랫뷰 (기본)
2. 우상단 뷰 토글에서 그룹뷰 클릭
3. 화면에 그룹별 섹션이 표시됨. 각 그룹 헤더에는 **"신규 247", "진행중 89", "완료 1,034"** 같은 **전체 개수**
4. 각 그룹은 처음 50건만 로드된 상태. 그룹 끝에 "더 보기 (47건 더)" 버튼
5. 버튼 클릭 또는 스크롤이 그 영역에 도달 → 그 그룹의 다음 50건 추가 로드
6. 하단 전체 페이지네이션은 보이지 않음
7. 검색어 입력 → 모든 그룹 페이지 상태 초기화, 다시 처음부터

## 4. 기술 접근 (개략)

> 세부 구현은 Design 단계에서 확정.

### 옵션 A: API 신설 — `/api/partitions/[id]/records/grouped`
- 그룹 카운트 + 각 그룹 첫 페이지를 한 번에 반환
- 추가 로드 시 기존 records API에 `groupBy` + `groupValue` 쿼리 파라미터 추가하여 호출

### 옵션 B: 기존 records API 확장만
- `groupBy`, `groupValue` 쿼리 파라미터 추가 → 해당 그룹만 limit/offset
- 그룹 전체 카운트는 별도 카운트 API (`/api/partitions/[id]/records/group-counts`)

**추천**: **옵션 B** (기존 API 재사용성 ↑, 새 라우트 최소화)

### 클라이언트
- `useGroupedRecords(params)` 신규 훅: 그룹별 SWR 캐시 키 분리
- `GroupedRecordView`: 그룹별 `page` state 관리 + IntersectionObserver

## 5. 영향 범위

### 변경 대상
- [src/app/api/partitions/[id]/records/route.ts](src/app/api/partitions/[id]/records/route.ts) — `groupBy`, `groupValue` 파라미터 추가
- [src/app/api/partitions/[id]/records/group-counts/route.ts](src/app/api/partitions/[id]/records/group-counts/route.ts) — **신규** (그룹별 카운트)
- [src/hooks/useRecords.ts](src/hooks/useRecords.ts) — 또는 신규 `useGroupedRecords.ts`
- [src/components/records/GroupedRecordView.tsx](src/components/records/GroupedRecordView.tsx) — 페이지네이션 제거, 그룹별 상태 관리
- [src/components/records/RecordGroup.tsx](src/components/records/RecordGroup.tsx) — "더 보기" 버튼 + observer
- [src/app/records/page.tsx](src/app/records/page.tsx) — 그룹뷰일 때 다른 데이터 소스 사용

### 영향 없음
- 플랫뷰 (`RecordTable`) 동작
- 레코드 CRUD API
- 자동화/필드 정의

## 6. 리스크 / 고려사항

1. **검색/필터 변경 시 그룹별 페이지 리셋** 잊으면 다음 페이지부터 보일 수 있음 → 의존성 배열로 자동 리셋 필수
2. **그룹 카운트 쿼리 비용** — JSONB `data->>{key}` GROUP BY 인덱스 없으면 느림. 카운트는 디바운스 + SWR 캐시
3. **그룹뷰 → 플랫뷰 전환 시 페이지 상태** — 분리된 상태 (서로 영향 X)
4. **무한 스크롤 + 버튼 동시 지원**: observer가 먼저 트리거하면 버튼 비활성화 처리
5. **레코드 수정으로 status 변경 시** — 그룹 간 이동 처리 (mutate 전략 결정 필요, P2)

## 7. 성공 기준

- [ ] 그룹뷰에서 각 그룹 헤더 카운트가 **그룹 전체 개수**와 일치
- [ ] 각 그룹 "더 보기" 클릭 시 그 그룹 레코드만 추가 (다른 그룹 영향 X)
- [ ] 스크롤이 그룹 끝에 닿으면 자동 로드 (옵션 ON일 때)
- [ ] 하단 전체 페이지네이션은 그룹뷰에서 숨김
- [ ] 검색/필터/정렬 변경 시 모든 그룹 페이지 리셋
- [ ] 플랫뷰 동작 회귀 없음

## 8. 다음 단계

→ `/pdca design records-group-pagination`
