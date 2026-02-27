# Plan: dashboard-home — 홈 대시보드

## 1. 개요

### 배경
현재 `index.tsx`는 레코드 관리 페이지(파티션 선택 → 레코드 테이블)로 사용 중이다. 로그인 직후 전체 현황을 파악할 수 있는 홈 대시보드가 없어, 알림톡/이메일 발송 현황이나 고객 수를 확인하려면 각 페이지를 직접 방문해야 한다.

### 목표
로그인 시 가장 먼저 보이는 홈 대시보드를 만들어, 전체 통계와 최근 활동을 한눈에 파악할 수 있게 한다.

### 범위
- 홈 대시보드 페이지 신규 생성
- 통합 통계 API 1개
- 기존 레코드 페이지를 `/records` 경로로 이동
- 사이드바 네비게이션 업데이트

## 2. 기능 요구사항

### FR-01: 통계 요약 카드
- 전체 레코드 수 (조직 기준)
- 알림톡 발송 현황 (오늘): 전체/성공/실패
- 이메일 발송 현황 (오늘): 전체/성공/실패
- 워크스페이스 수, 파티션 수

### FR-02: 최근 활동
- 최근 알림톡 발송 5건 (시간, 수신번호, 템플릿명, 상태)
- 최근 이메일 발송 5건 (시간, 수신이메일, 제목, 상태)
- 시간순 역정렬

### FR-03: 빠른 액션
- "레코드 관리" 바로가기
- "알림톡 발송" 바로가기
- "이메일 발송" 바로가기

### FR-04: 레코드 페이지 분리
- 현재 `index.tsx` (레코드 관리) → `/records` 경로로 이동
- 새 `index.tsx`에 홈 대시보드 배치
- 사이드바 네비게이션 업데이트: "홈" + "레코드" 분리

## 3. 기술 설계 방향

### 페이지 구조
```
/ (index.tsx)          → 홈 대시보드 (신규)
/records (records.tsx) → 레코드 관리 (기존 index.tsx 이동)
/alimtalk             → 알림톡 (기존)
/email                → 이메일 (기존)
```

### API
```
GET /api/dashboard/summary
→ { recordCount, workspaceCount, partitionCount,
   alimtalk: { total, sent, failed, pending },
   email: { total, sent, failed, pending },
   recentAlimtalkLogs: [...5건],
   recentEmailLogs: [...5건] }
```

단일 API에서 records COUNT + alimtalkSendLogs 통계 + emailSendLogs 통계를 한번에 조회. 기존 `/api/alimtalk/stats` 로직을 재활용하되, 이메일 통계도 포함.

### SWR 훅
```
useDashboardSummary() → GET /api/dashboard/summary
```

### 컴포넌트 구조
```
src/pages/index.tsx (새 대시보드)
  └─ src/components/dashboard/HomeDashboard.tsx
       ├─ StatsSummaryCards (레코드 수 + 발송 현황)
       ├─ RecentActivitySection
       │    ├─ RecentAlimtalkLogs (5건)
       │    └─ RecentEmailLogs (5건)
       └─ QuickActions (바로가기 버튼)
```

### 사이드바 변경
```
현재:  레코드(/) → 알림톡 → 이메일
변경:  홈(/) → 레코드(/records) → 알림톡 → 이메일
```

## 4. 변경 파일 목록

| # | 파일 | 변경 유형 | 설명 |
|---|------|-----------|------|
| 1 | `src/pages/records.tsx` | 신규 | 기존 index.tsx를 records.tsx로 이동 |
| 2 | `src/pages/index.tsx` | 수정 | 홈 대시보드로 교체 |
| 3 | `src/pages/api/dashboard/summary.ts` | 신규 | 통합 통계 API |
| 4 | `src/hooks/useDashboardSummary.ts` | 신규 | SWR 훅 |
| 5 | `src/components/dashboard/HomeDashboard.tsx` | 신규 | 대시보드 메인 컴포넌트 |
| 6 | `src/components/dashboard/sidebar.tsx` | 수정 | 네비게이션 항목 추가 |

## 5. 의존성
- 외부 라이브러리 추가 없음
- 기존 DB 스키마 변경 없음
- 기존 `useAlimtalkStats` 로직 참고

## 6. 검증 기준
- `npx next build` 성공
- 홈 대시보드에서 레코드 수, 발송 현황 표시
- `/records` 경로에서 기존 레코드 관리 정상 동작
- 사이드바 "홈" / "레코드" 분리 표시
- 데이터 없을 때 빈 상태 처리 (0건 표시, "발송 이력이 없습니다" 메시지)
