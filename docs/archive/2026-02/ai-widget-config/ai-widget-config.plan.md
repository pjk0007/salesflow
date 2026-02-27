# Plan: ai-widget-config (AI 위젯 설정 도우미)

## 배경
현재 위젯을 추가하거나 설정할 때, 사용자가 직접 위젯 타입, 데이터 컬럼, 집계 방식, 그룹 기준 등을 선택해야 합니다. 기술적 배경이 없는 일반 사용자에게는 "스코어카드 vs 막대 차트", "COUNT vs SUM", "그룹 기준 컬럼" 같은 개념이 직관적이지 않습니다.

기존에 AI 대시보드 자동 생성 기능(`/api/ai/generate-dashboard`)이 있지만, 이는 대시보드 전체를 한번에 생성하는 것이고, 개별 위젯 단위로 AI 도움을 받을 수는 없습니다.

## 목표
WidgetConfigDialog에 AI 도우미를 추가하여, 사용자가 자연어로 "이번 달 회사별 영업 건수" 같이 입력하면 AI가 적절한 위젯 설정(타입, 컬럼, 집계, 그룹)을 추천하고 폼을 자동 채워주는 기능.

## 기능 요구사항

### FR-01: AI 프롬프트 입력
- WidgetConfigDialog 상단에 AI 도우미 영역 추가
- 자연어 입력 필드 + "AI 추천" 버튼
- 예시 placeholder: "월별 영업 건수를 막대 차트로 보고 싶어요"

### FR-02: AI 위젯 설정 생성 API
- `POST /api/ai/generate-widget` 엔드포인트 신규
- 입력: `{ prompt, workspaceFields }` (기존 대시보드 생성과 동일 패턴)
- 출력: 단일 위젯 설정 `{ title, widgetType, dataColumn, aggregation, groupByColumn, stackByColumn }`
- 시스템 컬럼(`_sys:registeredAt`, `_sys:createdAt`, `_sys:updatedAt`) 정보도 AI에 전달

### FR-03: 폼 자동 채우기
- AI 응답 수신 시 WidgetConfigDialog의 모든 필드를 자동 설정
- title, widgetType, dataColumn, aggregation, groupByColumn, stackByColumn
- 사용자가 AI 추천 후에도 수동으로 수정 가능 (덮어쓰기, 잠금 아님)

### FR-04: 로딩 상태
- AI 호출 중 "추천 중..." 로딩 표시
- 버튼 disabled 처리

### FR-05: AI 미설정 시 비활성화
- AI 설정이 없는 조직은 AI 도우미 영역 숨김 (기존 패턴: aiConfigs 테이블)

## 비기능 요구사항

### NFR-01: 기존 패턴 재사용
- `src/lib/ai.ts`에 `generateWidget()` 함수 추가 (기존 `generateDashboard()`와 동일 구조)
- `getAiClient()`, `logAiUsage()` 재사용

### NFR-02: 시스템 컬럼 지원
- AI 프롬프트에 시스템 필드(등록일시, 생성일시, 수정일시)도 포함하여 날짜 기반 차트 추천 가능

## 변경 파일 목록

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 1 | `src/lib/ai.ts` | `generateWidget()` 함수 + `buildWidgetSystemPrompt()` 추가 |
| 2 | `src/pages/api/ai/generate-widget.ts` | 신규 API 엔드포인트 |
| 3 | `src/components/dashboard/WidgetConfigDialog.tsx` | AI 도우미 UI (프롬프트 입력 + 자동 채우기) |

## 구현 순서

| # | 작업 | 검증 |
|---|------|------|
| 1 | `ai.ts`에 `generateWidget()` 추가 | 타입 에러 없음 |
| 2 | `/api/ai/generate-widget` API 생성 | 타입 에러 없음 |
| 3 | `WidgetConfigDialog`에 AI 도우미 UI 추가 | `pnpm build` 성공 |

## 검증
- `pnpm build` 성공
- AI 설정 있는 조직: 프롬프트 입력 → AI 추천 → 폼 자동 채우기
- AI 설정 없는 조직: AI 도우미 영역 미표시
- AI 추천 후 수동 수정 가능
