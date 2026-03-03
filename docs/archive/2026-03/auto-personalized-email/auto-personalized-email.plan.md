# Plan: auto-personalized-email

## 요약
레코드 생성/수정 시 자동으로 회사 조사 → 제품 매칭 → AI 개인화 이메일 생성 → NHN Cloud 발송까지 완전 자동화하는 파이프라인.

## 현재 상태
- **회사 조사** (`generateCompanyResearch`): 수동 버튼 클릭 → `_companyResearch`에 저장 ✅
- **AI 이메일 생성** (`generateEmail`): 수동 UI에서 제품+레코드 선택 후 생성 ✅
- **이메일 발송** (NHN Cloud): `emailTemplateLinks` 트리거로 자동화 가능 ✅
- **제품 카탈로그** (`products` 테이블): CRUD 완료 ✅
- **문제**: 각 단계가 분리되어 있음. 통합 자동화 파이프라인이 없음

## 자동화 파이프라인

```
레코드 생성/수정 트리거
    ↓
1. 회사명 자동 감지 (record.data에서 company/회사 필드)
    ↓
2. _companyResearch 없으면 → AI 웹 검색으로 회사 조사
    ↓
3. 파티션에 연결된 제품(productId) 확인
    ↓
4. AI 개인화 이메일 생성 (제품 + 회사정보 + 레코드 데이터)
    ↓
5. NHN Cloud 이메일 발송
    ↓
6. emailSendLogs에 결과 기록
```

## 변경 사항

### 1. DB 스키마 — emailAutoPersonalizedLinks 테이블
기존 `emailTemplateLinks`는 **미리 만든 템플릿**을 변수 치환해서 보내는 방식.
AI 개인화는 레코드마다 **다른 내용**을 생성해야 하므로 새 테이블 필요.

```
emailAutoPersonalizedLinks 테이블:
- id (serial PK)
- orgId (uuid FK)
- partitionId (integer FK → partitions)
- productId (integer FK → products) — 소개할 제품
- recipientField (varchar 100) — 수신자 이메일 필드 키
- companyField (varchar 100) — 회사명 필드 키
- prompt (text) — AI에게 줄 추가 지시사항 (톤, 목적 등)
- tone (varchar 50) — "professional" | "friendly" | "formal" 등
- triggerType (varchar 20) — "on_create" | "on_update"
- triggerCondition (jsonb) — { field, operator, value } (선택)
- autoResearch (integer default 1) — 회사 조사 자동 실행 여부
- isActive (integer default 1)
- createdAt, updatedAt
```

### 2. 자동화 엔진 — `src/lib/auto-personalized-email.ts`
새 파일. 핵심 자동화 로직:

```typescript
export async function processAutoPersonalizedEmail(params: {
    record: DbRecord;
    partitionId: number;
    triggerType: "on_create" | "on_update";
    orgId: string;
}): Promise<void> {
    // 1. emailAutoPersonalizedLinks에서 매칭되는 링크 조회
    // 2. 각 링크에 대해:
    //    a. triggerCondition 평가
    //    b. 쿨다운 체크 (같은 record+link에 1시간 내 발송 이력)
    //    c. 수신자 이메일 추출 (recipientField)
    //    d. 회사명 추출 (companyField)
    //    e. _companyResearch 없으면 → generateCompanyResearch() → 레코드에 저장
    //    f. 제품 조회 (productId)
    //    g. generateEmail() — 제품 + 회사정보 + 레코드 데이터 + prompt/tone
    //    h. NHN Cloud 이메일 발송
    //    i. emailSendLogs에 기록 (triggerType: "ai_auto")
}
```

### 3. 트리거 연결 — 레코드 생성/수정 API에서 호출
기존 `processAutoTrigger` (알림톡), `processEmailAutoTrigger` (템플릿 이메일)과 동일한 패턴:

**수정 파일**: 레코드 생성/수정 API들 (4곳)
- `src/app/api/partitions/[id]/records/route.ts` — POST (내부 생성)
- `src/app/api/records/[id]/route.ts` — PATCH (내부 수정)
- `src/app/api/v1/records/route.ts` — POST (외부 생성)
- `src/app/api/v1/records/[id]/route.ts` — PUT (외부 수정)

각 파일 끝에 추가:
```typescript
processAutoPersonalizedEmail({
    record: result,
    partitionId,
    triggerType: "on_create", // or "on_update"
    orgId,
}).catch((err) => console.error("Auto personalized email error:", err));
```

### 4. 관리 API — `/api/email/auto-personalized`
CRUD API (JWT 인증):
- **GET** `/api/email/auto-personalized?partitionId=N` — 목록 조회
- **POST** `/api/email/auto-personalized` — 생성
- **PUT** `/api/email/auto-personalized/[id]` — 수정
- **DELETE** `/api/email/auto-personalized/[id]` — 삭제

### 5. 관리 UI — 이메일 설정 탭에 추가
파티션 설정 또는 이메일 설정 페이지에 "AI 개인화 발송" 섹션 추가.

```
┌──────────────────────────────────────────────┐
│ AI 개인화 이메일 자동 발송                     │
├──────────────────────────────────────────────┤
│ [+ 규칙 추가]                                 │
│                                              │
│ ┌────────────────────────────────────────┐   │
│ │ 🟢 제품: "SalesFlow Pro"               │   │
│ │ 트리거: 레코드 생성 시                   │   │
│ │ 수신: email 필드 | 회사: company 필드    │   │
│ │ 회사 자동 조사: ✅                       │   │
│ │                          [수정] [삭제]  │   │
│ └────────────────────────────────────────┘   │
└──────────────────────────────────────────────┘
```

설정 UI 요소:
- 제품 선택 (Select — products 목록)
- 트리거 유형 (on_create / on_update)
- 수신자 이메일 필드 (Select — 워크스페이스 필드 중 email 타입)
- 회사명 필드 (Select — 워크스페이스 필드)
- AI 지시사항 (Textarea — 추가 프롬프트)
- 톤 선택 (Select: 전문적/친근한/격식있는)
- 발송 조건 (선택 — 필드 + 연산자 + 값)
- 회사 자동 조사 토글 (Switch)
- 활성/비활성 (Switch)

### 6. SWR 훅 — `useAutoPersonalizedEmail.ts`

## 파일 변경 목록

| # | 파일 | 작업 |
|---|------|------|
| 1 | `src/lib/db/schema.ts` | `emailAutoPersonalizedLinks` 테이블 추가 |
| 2 | `drizzle/XXXX_email_auto_personalized.sql` | 마이그레이션 |
| 3 | `src/lib/auto-personalized-email.ts` | 자동화 엔진 (핵심 로직) |
| 4 | `src/app/api/email/auto-personalized/route.ts` | GET, POST API |
| 5 | `src/app/api/email/auto-personalized/[id]/route.ts` | PUT, DELETE API |
| 6 | `src/hooks/useAutoPersonalizedEmail.ts` | SWR 훅 |
| 7 | `src/components/email/AutoPersonalizedEmailConfig.tsx` | 관리 UI 컴포넌트 |
| 8 | 이메일 설정 페이지 (기존) | UI 탭/섹션 추가 |
| 9 | `src/app/api/partitions/[id]/records/route.ts` | 트리거 호출 추가 |
| 10 | `src/app/api/records/[id]/route.ts` | 트리거 호출 추가 |
| 11 | `src/app/api/v1/records/route.ts` | 트리거 호출 추가 |
| 12 | `src/app/api/v1/records/[id]/route.ts` | 트리거 호출 추가 |

## 구현 순서

| # | 작업 | 검증 |
|---|------|------|
| 1 | schema.ts + migration | drizzle-kit push |
| 2 | auto-personalized-email.ts (자동화 엔진) | 타입 에러 없음 |
| 3 | API routes (CRUD) | 타입 에러 없음 |
| 4 | 레코드 API 4곳에 트리거 추가 | 타입 에러 없음 |
| 5 | SWR 훅 | — |
| 6 | 관리 UI 컴포넌트 | — |
| 7 | 이메일 설정 페이지에 통합 | `pnpm build` 성공 |

## 리스크

| 리스크 | 완화 방안 |
|--------|-----------|
| AI API 비용 (레코드마다 웹 검색 + 이메일 생성) | 쿨다운 체크, 조건 필터, _companyResearch 캐싱 |
| AI 응답 속도 (회사 조사 5-10초 + 이메일 생성 3-5초) | 비동기 처리 (.catch), 레코드 API 응답 차단 안함 |
| 이메일 품질 불안정 | prompt/tone으로 조절, 발송 로그에서 확인 가능 |
| NHN Cloud 발송 제한 | 기존 쿨다운 로직 재사용 (1시간) |

## 검증
- `pnpm build` 성공
- 레코드 생성 시 자동으로: 회사 조사 → AI 이메일 생성 → 발송 → 로그 기록
- 조건 미충족 시 발송 안됨
- _companyResearch 이미 있으면 재조사 안함
- 비활성(isActive=0) 규칙은 무시됨
