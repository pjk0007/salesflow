# Plan: 발송 결과 분석 (email-analytics)

## 배경
AI 자동발송으로 대량 이메일을 보내고 있지만, 발송 성공률과 읽음률을 한눈에 파악할 수 있는 분석 화면이 없다. 현재 EmailDashboard는 전체/성공/실패/대기 건수만 보여주고, 읽음 추적 데이터(isOpened, openedAt)는 로그 테이블에서만 개별 확인 가능하다.

## 현재 상태
- `emailSendLogs` 테이블에 `isOpened` (0/1), `openedAt` 컬럼 존재
- NHN Cloud API 동기화로 읽음 상태 추적 중 (`/api/email/logs/sync`)
- 기존 분석 API: `/api/analytics/summary`, `/api/analytics/trends`, `/api/analytics/templates`
- 기존 EmailDashboard: 전체/성공/실패/대기 4개 카드만 표시

## 목표
1. EmailDashboard에 **읽음률** 통계 추가
2. **triggerType별 분석** (수동/자동/AI자동 비교)
3. **일별 추세** 차트에 읽음률 포함
4. **대량 발송 결과 요약** (CSV import 단위별 성공/실패/읽음)

## 주요 변경

### 1. 분석 API 확장
- `/api/analytics/summary` — 읽음 건수(openedCount), 읽음률(openRate) 추가
- `/api/analytics/summary` — triggerType별 breakdown 추가
- `/api/analytics/trends` — 일별 읽음 건수 추가

### 2. EmailDashboard UI 개선
- 기존 4개 카드 + **읽음률 카드** 추가 (읽음/전체 sent, 퍼센트)
- **triggerType별 성과 테이블**: 수동/자동/반복/AI자동 각각의 발송수, 성공률, 읽음률
- **일별 추세 차트**: 발송수 + 읽음수 라인 차트 (기존 trends API 활용)

### 3. NHN 동기화 개선
- 현재 7일간 미읽음만 체크 → 동기화 주기/범위 검토

## 비기능 요구사항
- 대시보드 로딩 1초 이내
- 기존 EmailDashboard 컴포넌트 확장 (새 파일 최소화)

## 범위 제외
- 실시간 알림 (이메일 읽음 시 알림)
- A/B 테스트 분석
- 클릭 추적 (NHN Cloud에서 미지원)
