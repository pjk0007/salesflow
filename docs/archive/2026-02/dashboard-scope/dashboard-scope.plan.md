# Plan: dashboard-scope (대시보드 데이터 범위 설정)

## 개요
대시보드가 워크스페이스의 모든 파티션 데이터를 집계하는 대신, 사용자가 특정 폴더/파티션만 선택하여 데이터 범위를 좁힐 수 있는 기능.

## 배경 및 목적

### 문제
- 현재 대시보드는 워크스페이스의 **모든 파티션** 레코드를 집계
- 사용자가 특정 팀/지역/카테고리 등 일부 데이터만 분석하고 싶을 때 방법이 없음

### 목표
- 대시보드 단위로 파티션 범위를 설정 가능
- 폴더 단위 일괄 선택 지원 (폴더 → 하위 파티션 전체)
- 미설정 시 기존 동작(전체 워크스페이스) 유지

## 요구사항

### 기능 요구사항 (FR)

| # | 요구사항 | 우선순위 |
|---|----------|----------|
| FR-01 | dashboards 테이블에 partitionIds (jsonb) 컬럼 추가 | P0 |
| FR-02 | partitionIds가 설정되면 해당 파티션만 집계, null이면 전체 | P0 |
| FR-03 | 대시보드 생성/수정 API에서 partitionIds 수락 | P0 |
| FR-04 | 툴바에 "데이터 범위" Popover UI 제공 | P0 |
| FR-05 | 폴더 체크 시 하위 파티션 전체 선택/해제 | P0 |
| FR-06 | 폴더 부분 선택 시 indeterminate 상태 표시 | P1 |
| FR-07 | 범위 변경 시 대시보드 데이터 자동 갱신 | P0 |

### 비기능 요구사항 (NFR)

| # | 요구사항 |
|---|----------|
| NFR-01 | 기존 대시보드 동작 유지 (하위 호환) — null = 전체 |
| NFR-02 | 마이그레이션은 ADD COLUMN IF NOT EXISTS로 안전하게 |

## 기술 범위

### 변경 파일

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 1 | `src/lib/db/schema.ts` | dashboards 테이블에 `partitionIds` jsonb 컬럼 추가 |
| 2 | `drizzle/0006_dashboard_partition_ids.sql` | ALTER TABLE 마이그레이션 |
| 3 | `src/pages/api/dashboards/index.ts` | POST에 partitionIds 파라미터 수락 |
| 4 | `src/pages/api/dashboards/[id].ts` | PUT에 partitionIds 업데이트 지원 |
| 5 | `src/pages/api/dashboards/[id]/data.ts` | partitionIds 기반 데이터 범위 필터링 |
| 6 | `src/pages/dashboards.tsx` | 데이터 범위 Popover UI + 폴더/파티션 체크박스 |

### 재사용 리소스
- `usePartitions` hook — 폴더/파티션 트리 조회
- `useDashboards` hook — updateDashboard로 partitionIds 저장
- ShadCN Popover, Checkbox 컴포넌트

## 구현 순서

| # | 작업 | 검증 |
|---|------|------|
| 1 | schema.ts + migration SQL | drizzle-kit push |
| 2 | dashboards/index.ts (POST) + [id].ts (PUT) | 타입 에러 없음 |
| 3 | dashboards/[id]/data.ts 범위 필터링 | 타입 에러 없음 |
| 4 | dashboards.tsx UI (Popover + 체크박스) | pnpm build 성공 |

## 상태
- **구현 완료**: 모든 파일 변경 및 DB 마이그레이션 적용됨
- **빌드**: pnpm build 성공 확인
