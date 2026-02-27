# Plan: analytics-dashboard — 통합 통계 대시보드

## 1. 개요

### 배경
현재 대시보드(index.tsx)는 조직 레벨의 간단한 KPI만 표시한다 (전체 레코드 수, 오늘의 발송 현황, 최근 로그).
알림톡/이메일 각각의 대시보드 탭에도 기간별 집계(today/week/month)가 있지만, 일별 추이 차트나 채널 비교, 템플릿별 성과 분석은 없다.

### 기존 인프라
- **dashboard/summary API**: recordCount, workspaceCount, partitionCount + alimtalk/email 오늘 집계
- **alimtalk/stats API**: period(today/week/month) 기반 집계 (total/sent/failed/pending + recentLogs)
- **alimtalkSendLogs / emailSendLogs 테이블**: status, sentAt, completedAt, triggerType, partitionId, templateName/subject
- **unified logs API**: alimtalk + email UNION ALL 쿼리 (채널/상태/기간 필터)
- **SWR hook pattern**: fetcher + useSWR + refreshInterval
- **ShadCN UI**: Card, Badge, Table 등 이미 사용 중

### 목표
1. 일별/주별 발송 추이 차트 (Line Chart)
2. 채널별(알림톡/이메일) 성공률 비교
3. 템플릿별 발송 성과 (Top N)
4. 기간 선택 (7일/30일/90일/커스텀)
5. 기존 홈 대시보드(`index.tsx`)에 통합 — 별도 페이지 아닌 기존 대시보드 확장

### 범위
- 통합 통계 API 신규 (일별 추이 + 채널 비교 + 템플릿 성과)
- 차트 라이브러리 도입 (recharts — React 기반, 가벼움, ShadCN과 호환)
- HomeDashboard 컴포넌트 확장 (차트 섹션 추가)
- SWR 훅 신규

### 범위 제외
- 레코드 필드별 분포 분석 (JSONB 집계 복잡도 높음, 별도 피처로)
- 실시간 갱신 WebSocket (SWR refreshInterval로 충분)
- PDF/이미지 내보내기
- 커스텀 대시보드 위젯 드래그앤드롭
- 파티션별/워크스페이스별 필터 (조직 전체 기준, 향후 확장)

## 2. 기능 요구사항

### FR-01: 통합 통계 API — 일별 추이
- `GET /api/analytics/trends`
- 쿼리 파라미터: `startDate`, `endDate`, `channel` (all/alimtalk/email)
- 응답: `{ success, data: Array<{ date: string, alimtalkSent: number, alimtalkFailed: number, emailSent: number, emailFailed: number }> }`
- alimtalkSendLogs + emailSendLogs를 각각 GROUP BY date_trunc('day', sentAt)
- 날짜 범위 내 빈 날짜는 0으로 채움 (클라이언트에서 처리)
- 조직 전체 기준 (orgId)

### FR-02: 통합 통계 API — 채널 요약
- `GET /api/analytics/summary`
- 쿼리 파라미터: `startDate`, `endDate`
- 응답:
  ```json
  {
    "success": true,
    "data": {
      "alimtalk": { "total": 150, "sent": 130, "failed": 15, "pending": 5 },
      "email": { "total": 200, "sent": 180, "failed": 10, "pending": 10 },
      "totalRecords": 5000,
      "newRecordsInPeriod": 120
    }
  }
  ```
- 기존 dashboard/summary와 다른 점: 기간 선택 가능, 오늘만이 아닌 임의 기간

### FR-03: 통합 통계 API — 템플릿 성과
- `GET /api/analytics/templates`
- 쿼리 파라미터: `startDate`, `endDate`, `channel` (all/alimtalk/email), `limit` (기본 10)
- 응답: `{ success, data: Array<{ name: string, channel: "alimtalk"|"email", total: number, sent: number, failed: number, successRate: number }> }`
- alimtalkSendLogs.templateName / emailSendLogs.subject 기준 GROUP BY
- total DESC 정렬

### FR-04: 차트 UI — 일별 추이 차트
- recharts의 AreaChart (또는 LineChart)
- X축: 날짜, Y축: 건수
- 4개 시리즈: 알림톡 성공, 알림톡 실패, 이메일 성공, 이메일 실패
- 채널 필터로 알림톡만/이메일만/전체 전환
- 반응형 (ResponsiveContainer)

### FR-05: 차트 UI — 채널 요약 카드
- 기존 StatCard 패턴 확장
- 알림톡: 전체/성공/실패 + 성공률 %
- 이메일: 전체/성공/실패 + 성공률 %
- 신규 레코드 수 (기간 내)

### FR-06: 차트 UI — 템플릿 성과 테이블
- Top 10 템플릿 리스트 (Table)
- 컬럼: 순위, 템플릿명, 채널(Badge), 전체, 성공, 실패, 성공률
- 채널 필터 연동

### FR-07: 기간 선택 UI
- 프리셋 버튼: 7일 / 30일 / 90일
- DateRangePicker (ShadCN Popover + Calendar)는 범위 제외 — 프리셋만으로 충분
- 기본값: 30일

### FR-08: 홈 대시보드 통합
- 기존 HomeDashboard 아래에 "발송 분석" 섹션 추가
- 기존 StatCard/QuickActions/RecentLogs는 유지
- 새 섹션: 기간 선택 → 추이 차트 → 채널 요약 → 템플릿 성과

## 3. 기술 설계 방향

### 차트 라이브러리
- **recharts** — React 기반, SSR 호환, TypeScript 지원, ShadCN 예제에서도 사용
- AreaChart + ResponsiveContainer + XAxis + YAxis + Tooltip + Legend

### API 구조
```
GET /api/analytics/trends?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&channel=all
GET /api/analytics/summary?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
GET /api/analytics/templates?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&channel=all&limit=10
```

### 데이터 집계
- alimtalkSendLogs: `GROUP BY date_trunc('day', sent_at)` + `status`
- emailSendLogs: `GROUP BY date_trunc('day', sent_at)` + `status`
- 빈 날짜 채움: 클라이언트에서 startDate~endDate 범위의 모든 날짜를 생성하고 API 데이터를 merge

### SWR 훅
```typescript
useAnalytics({ startDate, endDate, channel }):
  - trends, summary, templates 3개 SWR 키로 병렬 fetch
  - 또는 단일 훅에서 3개 API 호출
```

## 4. 변경 파일 목록

| # | 파일 | 변경 유형 | 설명 |
|---|------|-----------|------|
| 1 | `package.json` | 수정 | recharts 의존성 추가 |
| 2 | `src/pages/api/analytics/trends.ts` | 신규 | 일별 추이 API |
| 3 | `src/pages/api/analytics/summary.ts` | 신규 | 채널 요약 API |
| 4 | `src/pages/api/analytics/templates.ts` | 신규 | 템플릿 성과 API |
| 5 | `src/hooks/useAnalytics.ts` | 신규 | SWR 훅 (3개 API 통합) |
| 6 | `src/components/dashboard/AnalyticsSection.tsx` | 신규 | 분석 섹션 (차트 + 요약 + 테이블) |
| 7 | `src/components/dashboard/TrendChart.tsx` | 신규 | recharts AreaChart 컴포넌트 |
| 8 | `src/components/dashboard/TemplateRanking.tsx` | 신규 | 템플릿 성과 테이블 |
| 9 | `src/components/dashboard/HomeDashboard.tsx` | 수정 | AnalyticsSection 렌더 추가 |

## 5. 의존성
- **recharts** (차트 라이브러리) — 신규 추가
- DB 스키마 변경 없음
- 기존 API 변경 없음 (새 엔드포인트만 추가)

## 6. 검증 기준
- `npx next build` 성공
- 홈 대시보드에 "발송 분석" 섹션 표시
- 기간 선택 (7일/30일/90일) 시 차트/요약/테이블 데이터 갱신
- 일별 추이 차트: X축 날짜, Y축 건수, 4개 시리즈 표시
- 채널 요약: 알림톡/이메일 각각 전체/성공/실패/성공률
- 템플릿 성과: Top 10 템플릿, 채널 Badge, 성공률
- 발송 이력 없는 조직에서도 빈 상태 정상 표시 (0건)
