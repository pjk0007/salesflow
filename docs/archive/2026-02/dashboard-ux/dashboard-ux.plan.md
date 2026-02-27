# Plan: dashboard-ux (대시보드 UX 개선 + AI 생성)

## Overview
대시보드 생성 시 팝업(Dialog) 제거 → 인라인 생성으로 변경. AI 프롬프트 입력 시 대시보드 이름 + 위젯 구성까지 자동 생성.

## 현재 상태
- 대시보드 목록: `src/pages/dashboards.tsx` — 탭 기반 대시보드 전환 + Dialog로 이름 입력하여 생성
- 위젯 추가: `WidgetConfigDialog`로 하나씩 수동 추가 (title, widgetType, dataColumn, aggregation, groupByColumn, stackByColumn)
- 위젯 타입: scorecard, bar, bar_horizontal, bar_stacked, line, donut
- 집계: count, sum, avg
- 워크스페이스 필드 기반으로 dataColumn/groupByColumn 선택

## 기능 범위

### 1. Dialog 제거 → 인라인 생성
- "새 대시보드" 버튼 클릭 시 팝업 대신 이름 입력 Input이 탭 옆에 인라인으로 나타남
- Enter 또는 확인 버튼으로 생성
- 빈 이름 + AI 프롬프트 있으면 AI가 이름도 생성

### 2. AI 대시보드 생성
- 대시보드 생성 영역에 AI 프롬프트 입력란 추가
- 프롬프트 예: "영업 현황 대시보드 만들어줘", "월별 매출 분석 대시보드"
- AI가 생성하는 것:
  - `name`: 대시보드 이름
  - `widgets`: 위젯 배열 (title, widgetType, dataColumn, aggregation, groupByColumn, stackByColumn)
- 워크스페이스 필드 목록을 AI에게 전달하여 실제 존재하는 필드 기반으로 위젯 구성

### 3. API: `POST /api/ai/generate-dashboard`
- 입력: `{ prompt, workspaceFields: { key, label, fieldType }[] }`
- AI에게 워크스페이스 필드 + 위젯 타입/집계 옵션 제공
- 출력: `{ name, widgets: [{ title, widgetType, dataColumn, aggregation, groupByColumn, stackByColumn }] }`
- 기존 AI 패턴: `getAiClient` → `generateDashboard()` → `logAiUsage`

### 4. 생성 플로우
1. "새 대시보드" 클릭 → 인라인 입력 영역 표시 (이름 + AI 프롬프트)
2. AI 프롬프트 입력 시 → 대시보드 생성 → AI 위젯 생성 → 위젯 일괄 추가 → 대시보드 선택
3. 이름만 입력 시 → 기존처럼 빈 대시보드 생성

## 예상 파일

| 유형 | 파일 | 설명 |
|------|------|------|
| 수정 | `src/lib/ai.ts` | `generateDashboard()` + 시스템 프롬프트 추가 |
| 신규 | `src/pages/api/ai/generate-dashboard.ts` | AI 대시보드 생성 엔드포인트 |
| 수정 | `src/pages/dashboards.tsx` | Dialog 제거, 인라인 생성 + AI 프롬프트 UI |

## 검증
- `pnpm build` 성공
- AI 프롬프트 입력 → 대시보드 이름 + 위젯 자동 생성 → DashboardGrid에 반영
