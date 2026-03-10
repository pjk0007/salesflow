# Plan: email-followup (이메일 후속 발송)

## 개요
이메일 전송 후 N일 뒤 수신자가 메일을 **읽었는지/읽지 않았는지** 조건에 따라 미리 세팅해둔 후속 이메일을 자동 발송하는 기능. **연결 관리**(템플릿 기반)와 **AI 자동 발송**(AI 생성 기반) 모두 지원.

## 문제 정의
현재 이메일 시스템에는:
- 읽음 추적(`isOpened`/`openedAt`)이 존재 (NHN API 연동)
- 반복 발송(`repeatConfig` + `emailAutomationQueue`)이 존재
- **하지만** "읽었을 때 / 읽지 않았을 때" 조건 분기에 따른 후속 이메일 발송 기능은 없음

영업 워크플로에서 핵심 니즈:
- 첫 이메일 발송 → 3일 후 미읽음 → 리마인더 발송
- 첫 이메일 발송 → 읽었으면 → 감사/다음 단계 이메일 발송
- 조건별로 다른 템플릿 또는 다른 AI 지시사항을 사용해야 함

## 기능 요구사항

### FR-01: 연결 관리 — 후속 규칙 (템플릿 기반)
- `EmailTemplateLinkDialog`에 후속 발송 섹션 추가
- 규칙 구성:
  - **대기 일수** (N일): 원본 이메일 발송 후 몇 일 뒤 체크할지
  - **읽음 시 후속 템플릿**: 읽었을 때 발송할 이메일 템플릿 선택 (선택사항)
  - **미읽음 시 후속 템플릿**: 읽지 않았을 때 발송할 이메일 템플릿 선택 (선택사항)
- 읽음/미읽음 중 하나만 설정하거나 둘 다 설정 가능
- `emailTemplateLinks.followupConfig` JSON 컬럼에 저장

### FR-02: AI 자동 발송 — 후속 규칙 (AI 지시사항 기반)
- `AutoPersonalizedEmailConfig` Dialog에 후속 발송 섹션 추가
- 규칙 구성:
  - **대기 일수** (N일)
  - **읽음 시 AI 지시사항**: 읽었을 때 AI에게 줄 프롬프트 (선택사항)
  - **미읽음 시 AI 지시사항**: 읽지 않았을 때 AI에게 줄 프롬프트 (선택사항)
- AI가 후속 이메일을 생성할 때 원본 이메일 내용도 컨텍스트로 제공
- `emailAutoPersonalizedLinks.followupConfig` JSON 컬럼에 저장

### FR-03: 후속 발송 큐
- 이메일 발송 성공 시 → 후속 규칙이 있으면 → `emailFollowupQueue`에 등록
- 큐 항목: 원본 로그 ID, 소스 타입(template/ai), 소스 ID, 체크 예정 시각, 상태
- 크론이 주기적으로 큐를 처리:
  1. 체크 시각이 된 항목 조회
  2. 원본 이메일의 읽음 상태 최신 동기화 (NHN API)
  3. 조건 매칭: `isOpened` 확인
  4. 읽음 → 읽음 후속 발송 / 미읽음 → 미읽음 후속 발송
  5. 해당 조건의 후속 설정이 없으면 → skipped
- 후속 발송 triggerType: `"followup"` (템플릿), `"ai_followup"` (AI)

### FR-04: 발송 로그 연동
- 후속 발송 로그에 triggerType="followup" 또는 "ai_followup" 기록
- `parentLogId` 컬럼으로 원본 이메일과의 관계 추적
- 기존 발송 이력/분석에 followup 타입 자연스럽게 통합

### FR-05: UI — 후속 규칙 폼
- **연결 관리 Dialog**: RepeatConfigForm 아래에 FollowupConfigForm 추가
  - 후속 발송 활성화 토글
  - 대기 일수 입력 (1~30일)
  - "읽었을 때" 섹션: 후속 템플릿 Select
  - "읽지 않았을 때" 섹션: 후속 템플릿 Select
- **AI 자동 발송 Dialog**: 하단에 FollowupConfigForm 추가
  - 후속 발송 활성화 토글
  - 대기 일수 입력 (1~30일)
  - "읽었을 때" 섹션: AI 지시사항 Textarea
  - "읽지 않았을 때" 섹션: AI 지시사항 Textarea

## 비기능 요구사항

### NFR-01: 성능
- 크론 처리: 한 번에 최대 100건 배치 처리
- 읽음 상태 동기화는 배치 단위로 한 번만 수행

### NFR-02: 안정성
- 원본 이메일/레코드가 삭제된 경우 → 후속 발송 스킵 (cancelled)
- 동일 원본 로그에 동일 소스의 중복 큐 방지

## 기존 시스템 활용

| 기존 리소스 | 활용 방식 |
|------------|----------|
| `emailSendLogs.isOpened/openedAt` | 읽음 조건 판단의 데이터 소스 |
| `sendEmailSingle()` | 템플릿 기반 후속 발송에 재사용 |
| `processAutoPersonalizedEmail()` 패턴 | AI 후속 발송 로직 참고 |
| `email/logs/sync` API 로직 | 크론에서 읽음 상태 최신화에 활용 |
| `email-sender-resolver` | 발신자/서명 해석 재사용 |
| `process-repeats` 크론 패턴 | 후속 발송 크론의 참고 모델 |
| `EmailTemplateLinkDialog` | 후속 규칙 폼 삽입 위치 |
| `AutoPersonalizedEmailConfig` | AI 후속 규칙 폼 삽입 위치 |

## 제외 범위
- 다단계 체인 (후속의 후속) — v1에서는 1단계만 지원
- 알림톡 후속 발송 — 이메일만 대상
- 수동 발송(SendEmailDialog)의 후속 — 연결 관리/AI 자동발송에 설정된 규칙만 동작

## 용어 정의

| 용어 | 설명 |
|------|------|
| 원본 이메일 | 최초 발송된 이메일 (수동/자동/AI 모두 가능) |
| 후속 규칙 (followup config) | 읽음/미읽음 조건에 따른 후속 발송 설정 |
| 후속 발송 큐 (followup queue) | 후속 발송 대기열 |
| 체크 시각 (checkAt) | 원본 발송 시각 + 대기 일수 |
| 소스 타입 | template (연결 관리) 또는 ai (AI 자동 발송) |

## 예상 규모
- 새 테이블: 1개 (후속 발송 큐)
- 기존 테이블 수정: 2개 (emailTemplateLinks + emailAutoPersonalizedLinks에 followupConfig 추가)
- 새 API: 1개 (크론 처리)
- 새 UI 컴포넌트: 1개 (FollowupConfigForm — 두 곳에서 재사용)
- 기존 수정: 이메일 발송 로직 2곳 + UI Dialog 2곳 + 로그 테이블
- 예상 파일: ~5개 신규, ~8개 수정
