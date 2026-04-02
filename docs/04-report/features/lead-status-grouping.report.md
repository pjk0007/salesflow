# Completion Report: 리드 상태별 그룹 뷰

> Feature: `lead-status-grouping`
> Date: 2026-04-02

## 1. 요약

레코드(리드) 목록을 상태별로 그룹핑하여 노션 데이터베이스 스타일로 보여주는 기능을 구현했다. 기존 플랫 테이블 뷰와 그룹 뷰를 토글로 전환할 수 있다.

| 항목 | 결과 |
|------|------|
| Match Rate | **94%** |
| 반복 횟수 | 0 (1차 구현으로 통과) |
| 빌드 | TypeScript + Next.js 빌드 통과 |
| API 변경 | 없음 |
| DB 변경 | 없음 |

## 2. PDCA 진행 이력

| Phase | 상태 | 내용 |
|-------|------|------|
| Plan | ✅ | 요구사항 분석, 범위 정의, 접근 방식 결정 |
| Design | ✅ | 컴포넌트 설계, props 인터페이스, 데이터 흐름, UI/UX 상세 |
| Do | ✅ | 5개 파일 구현 (2 신규 + 3 수정) |
| Check | ✅ | Gap Analysis 94% (PASS) |
| Act | - | 불필요 (>= 90%) |

## 3. 구현 산출물

### 신규 파일 (2개)

| 파일 | 줄 수 | 역할 |
|------|-------|------|
| `src/components/records/GroupedRecordView.tsx` | ~170 | 그룹 뷰 컨테이너 — 레코드를 상태별 그룹핑, 페이지네이션 |
| `src/components/records/RecordGroup.tsx` | ~115 | 개별 그룹 — 헤더(접기/펼치기) + 테이블 + 신규 추가 버튼 |

### 수정 파일 (3개)

| 파일 | 변경 내용 |
|------|----------|
| `src/components/records/RecordTable.tsx` | `compact` prop 추가 — 그룹 내 사용 시 페이지네이션/빈 상태 숨김 |
| `src/components/records/RecordToolbar.tsx` | 뷰 모드 토글 버튼 (List/LayoutList 아이콘) + props 3개 추가 |
| `src/app/records/page.tsx` | viewMode 상태, statusField 자동 탐지, 조건부 렌더링 |

## 4. 주요 기능

- **상태별 그룹핑**: `field.options` 배열 순서대로 그룹 생성
- **접기/펼치기**: 각 그룹 독립적 토글 (ChevronDown/Right)
- **그룹 헤더**: 색상 도트 + 상태명 + 건수
- **뷰 모드 전환**: 플랫 ↔ 그룹 토글 (localStorage 저장)
- **+ 신규 Item**: 각 그룹 하단에 레코드 추가 버튼
- **미분류 그룹**: 상태값이 없는 레코드 자동 분류
- **0건 그룹 숨김**: 레코드가 없는 상태 그룹 미표시

## 5. 기술적 결정

| 결정 | 이유 |
|------|------|
| 클라이언트 사이드 그룹핑 | API 변경 없이 빠르게 구현, 기존 페이지네이션 유지 |
| RecordTable 재사용 | compact prop만 추가하여 기존 테이블 로직 100% 재사용 |
| statusField 자동 탐지 확장 | `selectWithStatusBg` 외에 `select + key="status"` 폴백 추가 (실제 DB에 cellType이 select로 저장) |

## 6. 미해결 Gap (낮은 우선순위)

| Gap | 영향 | 비고 |
|-----|------|------|
| `hideHeader` prop 미구현 | Low | 각 그룹마다 테이블 헤더가 반복되지만 UX상 문제 없음 |
| `onCreateWithStatus` 상태값 미전달 | Medium | `+ 신규 Item` 클릭 시 CreateRecordDialog에 상태 기본값 세팅 필요 → 추후 개선 |

## 7. 변경하지 않은 것

- API 엔드포인트 (변경 없음)
- DB 스키마 (변경 없음)
- useRecords 훅 (변경 없음)
- 기존 플랫 뷰 동작 (변경 없음)
- 인라인 편집 로직 (변경 없음)
- CellRenderer (변경 없음)
