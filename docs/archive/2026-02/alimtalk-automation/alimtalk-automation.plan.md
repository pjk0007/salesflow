# alimtalk-automation Planning Document

> **Summary**: 레코드 생성/수정 시 조건 기반 알림톡 자동 발송 + 반복 발송 시스템
>
> **Project**: Sales Manager
> **Author**: AI
> **Date**: 2026-02-13
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

현재 알림톡은 수동 발송만 지원한다. 사용자가 레코드를 선택하고, 템플릿을 골라, "발송" 버튼을 눌러야 한다. 이 기능은 레코드가 생성되거나 수정될 때 조건에 맞으면 자동으로 알림톡을 발송하고, 특정 상태에 도달할 때까지 주기적으로 반복 발송하는 시스템을 구현한다.

### 1.2 Background

영업 프로세스에서 리드가 유입되면 즉시 환영 메시지를 보내고, 상태가 변경되면 안내 메시지를 보내는 작업이 반복된다. 이를 수동으로 하면 놓치는 경우가 많고, 적시 대응이 어렵다. 자동화를 통해:
- 리드 유입 즉시 환영 알림톡 발송
- 상태 변경 시 안내 알림톡 발송
- 미응답 고객에게 주기적 리마인드 발송

### 1.3 Related Documents

- 기존 구현: [alimtalk archive](../../archive/2026-02/alimtalk/)
- 스키마: `alimtalkTemplateLinks.triggerType`, `triggerCondition` 컬럼 (이미 존재)

---

## 2. Scope

### 2.1 In Scope

- [ ] 트리거 타입 확장: manual → manual / on_create / on_update
- [ ] 트리거 조건 설정 UI (어떤 필드가 어떤 값일 때)
- [ ] 레코드 생성/수정 API에 자동 발송 로직 주입
- [ ] 반복 발송 설정 (interval, stopCondition)
- [ ] 반복 발송 실행을 위한 Cron/Scheduler API
- [ ] 자동 발송 로그 추적 (triggerType: "auto", "repeat")

### 2.2 Out of Scope

- 외부 Webhook 트리거 (향후 lead-collection에서 처리)
- 실시간 WebSocket 알림 (불필요한 복잡도)
- 사용자별 발송 제한/쿼터 시스템
- 다단계 시퀀스 (email-automation에서 처리)

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | templateLink 생성/수정 시 triggerType (manual/on_create/on_update) 선택 | High | Pending |
| FR-02 | triggerCondition 설정: field + operator + value (예: 상태 = "신규") | High | Pending |
| FR-03 | 레코드 생성(POST) 시 on_create 트리거 매칭 → 자동 발송 | High | Pending |
| FR-04 | 레코드 수정(PATCH) 시 on_update 트리거 매칭 → 자동 발송 | High | Pending |
| FR-05 | 반복 발송 설정: intervalHours, maxRepeat, stopCondition (field=value) | Medium | Pending |
| FR-06 | 반복 발송 스케줄러: /api/alimtalk/automation/process-repeats 엔드포인트 | Medium | Pending |
| FR-07 | 자동 발송 내역을 sendLogs에 triggerType="auto"/"repeat"로 기록 | High | Pending |
| FR-08 | 템플릿 연결 UI에서 트리거 설정 (triggerType + condition) 폼 추가 | High | Pending |
| FR-09 | 자동 발송 ON/OFF 토글 (isActive로 제어) | Medium | Pending |
| FR-10 | 중복 발송 방지: 같은 record + templateLink에 대해 최근 N시간 내 재발송 방지 | Medium | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| Performance | 자동 발송 처리 < 3초 (레코드 생성/수정 응답 지연 최소화) | API 응답 시간 측정 |
| Reliability | 자동 발송 실패 시 레코드 작업은 영향 없음 (fire-and-forget) | 에러 로그 확인 |
| Scalability | 반복 발송 배치 최대 100건/회 처리 | 로그 카운트 |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] on_create 트리거로 레코드 생성 시 자동 알림톡 발송
- [ ] on_update 트리거로 레코드 수정 시 조건부 자동 발송
- [ ] 반복 발송 설정 후 스케줄러 호출 시 조건 미충족 레코드에 재발송
- [ ] TemplateLinkDialog에서 트리거/조건/반복 설정 가능
- [ ] 발송 로그에 triggerType 정확히 기록
- [ ] `npx next build` 성공

### 4.2 Quality Criteria

- [ ] Zero lint errors
- [ ] Build succeeds
- [ ] 자동 발송 실패 시 레코드 API 정상 응답 보장

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| 자동 발송이 레코드 생성/수정 응답 지연시킴 | High | Medium | fire-and-forget 패턴 사용 (await 안 함, catch로 에러만 로깅) |
| NHN Cloud API 장애 시 자동 발송 누락 | Medium | Low | sendLogs에 "pending" 상태로 기록, 재시도 가능 |
| 반복 발송 무한루프 | High | Low | maxRepeat 상한선 강제 (최대 10회), stopCondition 필수 |
| 동일 레코드에 중복 발송 | Medium | Medium | 최근 발송 시간 체크 (cooldown) |

---

## 6. Architecture Considerations

### 6.1 Project Level

Dynamic (기존 프로젝트 레벨 유지)

### 6.2 Key Architectural Decisions

| Decision | Options | Selected | Rationale |
|----------|---------|----------|-----------|
| 트리거 실행 방식 | DB Trigger / API 레벨 후킹 / Queue | API 레벨 후킹 | Next.js Pages Router에서 가장 단순한 방식 |
| 반복 발송 스케줄러 | Cron Job / API 엔드포인트 | API 엔드포인트 | 외부 cron (Vercel Cron/시스템 cron)에서 호출 |
| 자동 발송 처리 | 동기 (await) / 비동기 (fire-and-forget) | 비동기 | 레코드 API 응답 지연 방지 |
| 중복 발송 방지 | DB 유니크 제약 / 시간 기반 체크 | 시간 기반 체크 | 유연한 cooldown 설정 가능 |

### 6.3 DB 스키마 변경

```
기존 alimtalkTemplateLinks:
  triggerType: varchar (manual/on_create/on_update) ← 이미 존재
  triggerCondition: jsonb ({field, value}) ← 이미 존재, 구조 확장

변경:
  triggerCondition 구조 확장:
    {
      field: string,        // 필드 키
      operator: "eq" | "ne" | "contains",  // 비교 연산자
      value: string         // 비교 값
    }

신규 컬럼 추가:
  repeatConfig: jsonb
    {
      intervalHours: number,     // 반복 간격 (시간)
      maxRepeat: number,         // 최대 반복 횟수 (1~10)
      stopCondition: {           // 중단 조건
        field: string,
        operator: "eq" | "ne",
        value: string
      }
    }

신규 테이블: alimtalk_automation_queue
  id: serial PK
  templateLinkId: FK → alimtalk_template_links
  recordId: FK → records
  orgId: uuid
  repeatCount: integer (현재까지 반복 횟수)
  nextRunAt: timestamptz (다음 실행 시각)
  status: varchar (pending/completed/cancelled)
  createdAt: timestamptz
  updatedAt: timestamptz
```

### 6.4 핵심 로직 흐름

```
[레코드 생성/수정]
    ↓
[해당 파티션의 triggerType 매칭되는 templateLinks 조회]
    ↓
[triggerCondition 평가 (field + operator + value)]
    ↓ (조건 충족)
[중복 발송 체크 (최근 1시간 내 동일 record+link 발송 이력)]
    ↓ (중복 아님)
[NHN Cloud API 호출 (fire-and-forget)]
    ↓
[sendLog 기록 (triggerType: "auto")]
    ↓ (repeatConfig 있으면)
[automation_queue에 등록 (nextRunAt = now + intervalHours)]

[Cron → /api/alimtalk/automation/process-repeats]
    ↓
[nextRunAt <= now & status=pending 큐 조회]
    ↓
[stopCondition 평가 → 충족 시 completed 처리]
    ↓ (미충족)
[NHN Cloud API 호출]
    ↓
[sendLog 기록 (triggerType: "repeat")]
    ↓
[repeatCount++, maxRepeat 초과 시 completed]
    ↓
[nextRunAt 갱신]
```

---

## 7. Convention Prerequisites

### 7.1 기존 프로젝트 컨벤션 준수

- API 패턴: `getUserFromRequest()` → DB/NHN 작업 → JSON 응답
- SWR 훅 패턴: fetcher + mutation + mutate()
- Component 패턴: ShadCN UI + Tailwind
- 스키마 패턴: Drizzle ORM pgTable

### 7.2 신규 패턴

| Category | Convention |
|----------|-----------|
| 자동 발송 함수 | `src/lib/alimtalk-automation.ts` 에 트리거 실행 로직 분리 |
| 큐 처리 | `src/pages/api/alimtalk/automation/process-repeats.ts` |
| Cron 보안 | API key 또는 Bearer token으로 스케줄러 엔드포인트 보호 |

---

## 8. Implementation Order

1. DB 스키마 변경 (repeatConfig 컬럼 + automation_queue 테이블)
2. 자동 발송 핵심 로직 (`src/lib/alimtalk-automation.ts`)
3. 레코드 생성 API 수정 (트리거 호출 주입)
4. 레코드 수정 API 수정 (트리거 호출 주입)
5. TemplateLinkDialog UI 수정 (트리거/조건/반복 설정)
6. 반복 발송 스케줄러 API
7. 대시보드/로그에서 자동 발송 필터링

---

## 9. Next Steps

1. [ ] Write design document (`alimtalk-automation.design.md`)
2. [ ] Review and approval
3. [ ] Start implementation

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-02-13 | Initial draft | AI |
