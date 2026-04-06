# Plan: 알림톡 연결관리 페이지 전환 + 후속발송

## 1. 개요

알림톡 연결관리(template links)를 다이얼로그 → 전용 페이지로 전환하고, 이메일과 동일한 후속발송(followup) 기능을 추가한다.

## 2. 현재 상태

- **UI**: `/alimtalk` 탭 내 다이얼로그(`AlimtalkTemplateLinkDialog.tsx`)로 생성/수정
- **스키마**: `alimtalkTemplateLinks` — triggerType, triggerCondition, repeatConfig, preventDuplicate
- **자동화**: `alimtalk-automation.ts` — processAutoTrigger, processRepeatQueue
- **후속발송**: 없음 (이메일만 지원: emailFollowupQueue + email-followup.ts)

## 3. 요구사항

### 3-1. 페이지 전환
- `/alimtalk/links/new` — 새 연결 생성 페이지
- `/alimtalk/links/[id]` — 연결 수정 페이지
- `AlimtalkTemplateLinkList.tsx` — "새 연결" 클릭 시 페이지 이동
- 기존 `AlimtalkTemplateLinkDialog.tsx` 삭제

### 3-2. 후속발송 기능
- `alimtalkTemplateLinks`에 `followupConfig` JSONB 추가
- `alimtalkFollowupQueue` 테이블 생성
- 후속발송 로직: 알림톡 발송 후 → 지정 시간 뒤 후속 알림톡 발송
- 후속발송 설정 UI: FollowupConfigForm 재사용 (이메일과 동일 패턴)

### 3-3. 후속발송 구조 (이메일과 다른 점)
- 이메일: 읽음(opened)/안읽음(not_opened) 조건 분기
- 알림톡: 읽음 확인 불가 → **무조건 발송** (delayDays 후 다른 템플릿으로)
- followupConfig: `{ delayDays: number; templateCode: string; templateName?: string }`

## 4. 구현 범위

### Phase 1: DB
- 마이그레이션: alimtalkTemplateLinks + followupConfig, alimtalkFollowupQueue 테이블
- schema.ts 업데이트

### Phase 2: 후속발송 로직
- `alimtalk-automation.ts`에 enqueueAlimtalkFollowup, processAlimtalkFollowupQueue 추가
- processAutoTrigger에서 followupConfig 있으면 enqueue
- 크론 API: `/api/cron/alimtalk-followup`

### Phase 3: 페이지 UI
- `/alimtalk/links/new/page.tsx` — 전체 폼 (이메일 링크 페이지 패턴)
- `/alimtalk/links/[id]/page.tsx` — 수정 폼
- `AlimtalkTemplateLinkList.tsx` 수정 — 행 클릭/버튼으로 페이지 이동
- `AlimtalkTemplateLinkDialog.tsx` 삭제
- FollowupConfigForm 알림톡 버전 추가

## 5. DB 변경

```sql
-- alimtalkTemplateLinks에 followupConfig 추가
ALTER TABLE alimtalk_template_links ADD COLUMN followup_config jsonb;

-- 알림톡 후속발송 큐
CREATE TABLE alimtalk_followup_queue (
    id serial PRIMARY KEY,
    parent_log_id integer NOT NULL REFERENCES alimtalk_send_logs(id) ON DELETE CASCADE,
    template_link_id integer NOT NULL REFERENCES alimtalk_template_links(id) ON DELETE CASCADE,
    org_id uuid NOT NULL,
    send_at timestamptz NOT NULL,
    status varchar(20) DEFAULT 'pending' NOT NULL,
    processed_at timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX alfq_status_send_idx ON alimtalk_followup_queue (status, send_at);
```

## 6. 영향 받는 파일

| 파일 | 변경 |
|------|------|
| `src/lib/db/schema.ts` | followupConfig, alimtalkFollowupQueue |
| `drizzle/0034_alimtalk_followup.sql` | 마이그레이션 |
| `src/lib/alimtalk-automation.ts` | enqueue + processFollowup |
| `src/app/api/cron/alimtalk-followup/route.ts` | 신규 |
| `src/app/alimtalk/links/new/page.tsx` | 신규 |
| `src/app/alimtalk/links/[id]/page.tsx` | 신규 |
| `src/components/alimtalk/AlimtalkTemplateLinkList.tsx` | 페이지 이동으로 수정 |
| `src/components/alimtalk/AlimtalkTemplateLinkDialog.tsx` | 삭제 |
| `src/app/api/alimtalk/template-links/route.ts` | followupConfig 반영 |
| `src/app/api/alimtalk/template-links/[id]/route.ts` | followupConfig 반영 |
| `src/hooks/useAlimtalkTemplateLinks.ts` | 타입 업데이트 |

## 7. 예상 규모

- 마이그레이션: 1개 SQL
- API: 1개 신규 (cron), 2개 수정 (CRUD)
- UI: 2개 신규 페이지, 1개 수정, 1개 삭제
- 로직: ~100 LOC (followup enqueue + process)
- 예상 총 LOC: ~500
