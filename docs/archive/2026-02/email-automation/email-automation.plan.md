# email-automation Planning Document

> **Summary**: NHN Cloud Email API를 활용한 이메일 발송 시스템 — 설정, 템플릿 관리, 수동/자동 발송, 발송 로그
>
> **Project**: Sales Manager
> **Author**: AI
> **Date**: 2026-02-13
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

영업 관리 시스템에 이메일 발송 기능을 추가한다. 알림톡과 동일한 UX 패턴으로 NHN Cloud Email API를 통해 이메일을 발송하고, 템플릿-파티션 연결 + 자동 발송까지 지원한다. 기존 `emailConfigs`, `emailTemplates` 스키마를 NHN Cloud 용으로 확장한다.

### 1.2 Background

- 알림톡은 카카오톡 채널이 없는 고객에게 도달 불가
- 이메일은 비용이 낮고 HTML 리치 콘텐츠 가능
- NHN Cloud Email API는 이미 Notification Hub에 포함 (동일 콘솔, 동일 인증 방식)
- 기존 emailConfigs/emailTemplates 테이블이 SMTP 기반으로 정의되어 있으나, NHN Cloud 방식으로 전환

### 1.3 Related Documents

- 알림톡 아카이브: `docs/archive/2026-02/alimtalk/`
- 알림톡 자동화 아카이브: `docs/archive/2026-02/alimtalk-automation/`
- NHN Cloud Email API: `https://docs.nhncloud.com/ko/Notification/Email/ko/api-guide/`

---

## 2. Scope

### 2.1 In Scope

- [ ] emailConfigs 스키마 변경: SMTP → NHN Cloud (appKey/secretKey)
- [ ] NHN Cloud Email API 클라이언트 (`src/lib/nhn-email.ts`)
- [ ] 이메일 설정 페이지 (API 키 등록, 발신 이메일 설정)
- [ ] 이메일 템플릿 CRUD (DB 기반, HTML 본문 + 변수 `##key##`)
- [ ] 이메일 템플릿-파티션 연결 (emailTemplateLinks — 알림톡과 동일 패턴)
- [ ] 수동 이메일 발송 (레코드 선택 → 템플릿 선택 → 발송)
- [ ] 자동 이메일 발송 (on_create/on_update 트리거)
- [ ] 반복 이메일 발송 (repeatConfig, automation queue 재활용)
- [ ] 이메일 발송 로그 (emailSendLogs 테이블)
- [ ] 발송 결과 동기화 (NHN Cloud에서 상태 조회)
- [ ] 이메일 대시보드 페이지 (설정, 템플릿, 연결, 로그 탭)

### 2.2 Out of Scope

- 첨부파일 발송 (향후 확장)
- 광고 메일 (수신 동의 관리 필요)
- 이메일 수신 트래킹 (오픈율, 클릭률) — NHN Cloud 자체 통계 활용
- SMTP 직접 발송 (NHN Cloud API로 통일)

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | NHN Cloud Email API 키 설정 (appKey + secretKey + 발신주소) | High | Pending |
| FR-02 | 이메일 템플릿 생성/수정/삭제 (이름, 제목, HTML 본문, `##변수##`) | High | Pending |
| FR-03 | 템플릿-파티션 연결 (emailTemplateLinks) — 수신 이메일 필드 매핑 | High | Pending |
| FR-04 | 수동 발송: 레코드 선택 → 템플릿 → 변수 매핑 → 발송 | High | Pending |
| FR-05 | 자동 발송: on_create / on_update 트리거 + 조건 (field/operator/value) | Medium | Pending |
| FR-06 | 반복 발송: intervalHours, maxRepeat, stopCondition | Medium | Pending |
| FR-07 | 발송 로그 기록 (emailSendLogs) + NHN Cloud 결과 동기화 | High | Pending |
| FR-08 | 이메일 대시보드 페이지 (설정/템플릿/연결/로그 탭) | High | Pending |
| FR-09 | 발송 방식 Badge 표시 (수동/자동/반복) | Low | Pending |
| FR-10 | 중복 발송 방지 (cooldown) | Medium | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| Performance | 자동 발송 처리 — fire-and-forget, API 지연 없음 | API 응답 시간 |
| Reliability | 이메일 발송 실패 시 레코드 API 영향 없음 | 에러 로그 |
| Scalability | 배치 발송 최대 1000건/회 (NHN Cloud 제한) | 로그 카운트 |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] NHN Cloud Email API 키 설정 및 연결 확인
- [ ] 이메일 템플릿 CRUD 동작
- [ ] 템플릿-파티션 연결 + 수동 발송
- [ ] on_create/on_update 자동 발송
- [ ] 반복 발송 큐 처리
- [ ] 발송 로그 + NHN Cloud 결과 동기화
- [ ] `npx next build` 성공

### 4.2 Quality Criteria

- [ ] Zero lint errors
- [ ] Build succeeds
- [ ] 알림톡과 동일한 UX 패턴

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| NHN Cloud Email appKey가 알림톡 appKey와 다를 수 있음 | Medium | High | emailConfigs에 별도 appKey/secretKey 저장 |
| 이메일 응답 구조가 알림톡과 다름 (body.data vs root level) | Medium | High | Email API는 `body.data` 구조 — 별도 클라이언트 구현 |
| 대량 발송 시 rate limit | Medium | Low | 배치 사이즈 1000건 제한, 큐 처리 |
| HTML 본문 XSS | High | Medium | 서버에서 sanitize 없이 저장 (관리자만 작성), 렌더링 시 주의 |

---

## 6. Architecture Considerations

### 6.1 Project Level

Dynamic (기존 유지)

### 6.2 Key Architectural Decisions

| Decision | Options | Selected | Rationale |
|----------|---------|----------|-----------|
| Email API 제공자 | SMTP / NHN Cloud / SendGrid | NHN Cloud | 알림톡과 동일 플랫폼, 인증 방식 유사 |
| 설정 저장 방식 | 기존 emailConfigs 수정 / 새 테이블 | 기존 수정 | SMTP 컬럼 제거, NHN 컬럼 추가 |
| 템플릿 관리 | NHN Cloud 서버 / Sales DB | Sales DB | 유연한 편집, 변수 매핑 제어 가능 |
| 자동화 큐 | 별도 테이블 / alimtalkAutomationQueue 확장 | 별도 emailAutomationQueue | 알림톡/이메일 독립 관리 |
| API 응답 구조 | root level / body.data | body.data | NHN Email API는 `{ header, body: { data } }` 구조 |

### 6.3 NHN Cloud Email API 주요 정보

```
Base URL: https://email.api.nhncloudservice.com
인증: X-Secret-Key 헤더 + URL에 {appKey}

개별 발송: POST /email/v2.1/appKeys/{appKey}/sender/eachMail
  - senderAddress, title, body, receiverList[].receiveMailAddr
  - receiverList[].templateParameter (##key## 치환)

발송 조회: GET /email/v2.1/appKeys/{appKey}/sender/mails
  - requestId 또는 startSendDate + endSendDate 필수

상태 업데이트: GET /email/v2.1/appKeys/{appKey}/sender/update-mails

응답 구조:
{
  header: { isSuccessful, resultCode, resultMessage },
  body: { data: { requestId, results: [...] } }
}

메일 상태: SST0(준비) → SST1(발송중) → SST2(성공) / SST3(실패) / SST5(거부)
```

### 6.4 DB 스키마 변경

```
emailConfigs 변경:
  - provider 제거 (NHN Cloud 전용)
  - smtpHost, smtpPort, smtpUser, smtpPass 제거
  + appKey: varchar(200) NOT NULL
  + secretKey: varchar(200) NOT NULL
  - fromName, fromEmail 유지
  - isActive 유지

emailTemplates: 변경 없음 (name, subject, htmlBody, templateType 그대로 활용)

신규 테이블: emailTemplateLinks (알림톡의 alimtalkTemplateLinks와 동일 패턴)
  id, partitionId, name, emailTemplateId, recipientField, variableMappings,
  triggerType, triggerCondition, repeatConfig, isActive, createdBy, timestamps

신규 테이블: emailSendLogs
  id, orgId, templateLinkId, partitionId, recordId,
  emailTemplateId, recipientEmail, subject, requestId,
  status, resultCode, resultMessage, triggerType, sentBy, sentAt, completedAt

신규 테이블: emailAutomationQueue
  id, templateLinkId, recordId, orgId,
  repeatCount, nextRunAt, status, timestamps
```

### 6.5 핵심 로직 흐름

```
[수동 발송]
  → 레코드 선택 → 템플릿 선택 → 변수 매핑 확인 → NHN Cloud eachMail API → 로그 기록

[자동 발송 — 알림톡과 동일 패턴]
  레코드 생성/수정 → processEmailAutoTrigger() → 조건 평가 → 쿨다운 체크
  → NHN Cloud eachMail API → 로그 기록 → 반복 큐 등록

[반복 발송 — 알림톡과 동일 패턴]
  Cron → processEmailRepeatQueue() → stopCondition 평가
  → NHN Cloud eachMail API → 로그 기록 → 큐 업데이트
```

---

## 7. Convention Prerequisites

### 7.1 기존 컨벤션 준수

- API 패턴: `getUserFromRequest()` → DB/NHN 작업 → JSON 응답
- SWR 훅 패턴: fetcher + mutation + mutate()
- Component 패턴: ShadCN UI + Tailwind
- NHN Cloud 클라이언트: 알림톡과 동일 패턴 (class + getClient helper)

### 7.2 신규 패턴

| Category | Convention |
|----------|-----------|
| Email 클라이언트 | `src/lib/nhn-email.ts` — NhnEmailClient class |
| Email 자동화 | `src/lib/email-automation.ts` — 알림톡 자동화와 동일 구조 |
| Email 페이지 | `src/pages/email.tsx` — 탭 구조 (설정/템플릿/연결/로그) |

---

## 8. Implementation Order

1. emailConfigs 스키마 변경 (SMTP → NHN Cloud)
2. emailSendLogs, emailTemplateLinks, emailAutomationQueue 테이블 추가
3. NHN Cloud Email API 클라이언트 (`nhn-email.ts`)
4. Email 설정 API + 훅 + UI (설정 탭)
5. Email 템플릿 CRUD API + 훅 + UI (템플릿 탭)
6. Email 템플릿-파티션 연결 API + 훅 + UI (연결 관리)
7. Email 수동 발송 API + 훅
8. Email 자동 발송 로직 (`email-automation.ts`)
9. Email 반복 발송 API (`process-email-repeats.ts`)
10. Email 발송 로그 + 결과 동기화 (로그 탭)
11. Email 대시보드 페이지 통합
12. 레코드 API에 이메일 트리거 주입
13. 빌드 검증

---

## 9. Next Steps

1. [ ] Write design document (`email-automation.design.md`)
2. [ ] Review and approval
3. [ ] Start implementation

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-02-13 | Initial draft | AI |
