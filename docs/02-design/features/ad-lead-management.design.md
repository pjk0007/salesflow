# 광고 리드 관리 시스템 Design Document

> **Summary**: 멀티 조직 기반 광고 플랫폼 연동 및 리드 자동 수집 — DB 스키마, API, UI, Webhook 상세 설계
>
> **Project**: Sendb (Salesflow)
> **Author**: jaehun
> **Date**: 2026-03-31
> **Status**: Draft
> **Planning Doc**: [ad-lead-management.plan.md](../01-plan/features/ad-lead-management.plan.md)

---

## 1. Overview

### 1.1 Design Goals

- 기존 프로젝트 패턴(alimtalkConfigs, emailConfigs)과 일관된 구조
- Wedly Meta 연동 코드를 멀티테넌트로 확장 (조직별 OAuth 토큰)
- 플랫폼 추가가 쉬운 확장 가능한 아키텍처 (Meta → Google → Naver)
- 기존 레코드/자동화 시스템과 자연스러운 통합

### 1.2 Design Principles

- **조직 격리**: 모든 데이터는 orgId로 격리, 크로스 조직 접근 불가
- **기존 패턴 준수**: auth, API 응답, SWR 훅, UI 컴포넌트 기존 패턴 그대로
- **플랫폼 추상화**: 공통 인터페이스 + 플랫폼별 어댑터 패턴
- **Webhook 신뢰성**: 즉시 200 응답 + 비동기 처리 + 로그 기록

---

## 2. Architecture

### 2.1 전체 구조

```
Organization (매치스플랜)
│
├── ad_platforms[]                          ← 신규 테이블 (OAuth 연결)
│   ├── Meta (accessToken, pageTokens)
│   └── Google (refreshToken)               ← 2차
│
├── Workspaces[] (기존 — 사업/브랜드 단위)
│   ├── 디자이너하이어
│   │   ├── ad_accounts[]                   ← 신규 (workspaceId로 연결)
│   │   │   └── act_123 (Meta)
│   │   └── Partitions[]
│   │       ├── 메타광고 리드 ← ad_lead_integrations (리드폼A → 여기로)
│   │       └── 직접유입
│   └── 백오피스랩
│       ├── ad_accounts[]
│       │   └── act_456 (Meta)
│       └── Partitions[]
│           └── 광고리드 ← ad_lead_integrations (리드폼B → 여기로)
```

### 2.2 리드 수집 Data Flow

```
[Meta 광고] → 유저가 리드폼 작성
      ↓
[Meta 서버] → POST /api/webhooks/meta
      ↓
즉시 200 응답 (Meta 타임아웃 방지)
      ↓ (비동기)
form_id로 ad_lead_integrations 조회 (isActive=1)
      ↓
ad_platforms에서 accessToken 조회
      ↓
Meta Graph API로 리드 상세 조회 (GET /{leadgen_id})
      ↓
fieldMappings 적용 → defaultValues 적용 → 전화번호 정규화
      ↓
records 테이블에 INSERT (대상 partition)
      ↓
ad_lead_logs에 로그 INSERT
      ↓
기존 on_create 트리거 → 알림톡/이메일 자동 발송
```

### 2.3 Dependencies

| Component | Depends On | Purpose |
|-----------|-----------|---------|
| ad_platforms | organizations | 조직별 플랫폼 인증 |
| ad_accounts | ad_platforms, workspaces | 광고 계정 ↔ 워크스페이스 연결 |
| ad_lead_integrations | ad_accounts, partitions | 리드폼 → 파티션 매핑 |
| ad_lead_logs | ad_lead_integrations, records | 수집 로그 |
| Webhook handler | ad_lead_integrations, ad_platforms | 리드 수신 처리 |
| 기존 알림톡/이메일 자동화 | records (on_create) | 리드 수신 시 자동 알림 |

---

## 3. Data Model

### 3.1 ad_platforms 테이블

조직별 광고 플랫폼 OAuth 연결.

```typescript
export const adPlatforms = pgTable("ad_platforms", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    platform: varchar("platform", { length: 20 }).notNull(), // 'meta' | 'google' | 'naver'
    name: varchar("name", { length: 200 }).notNull(),
    credentials: jsonb("credentials").$type<AdPlatformCredentials>().notNull(),
    status: varchar("status", { length: 20 }).default("connected").notNull(),
    // 'connected' | 'expired' | 'error' | 'disconnected'
    lastSyncAt: timestamptz("last_sync_at"),
    createdBy: uuid("created_by")
        .references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
}, (table) => ({
    orgPlatformNameUnique: unique().on(table.orgId, table.platform, table.name),
}));
```

**credentials JSONB 구조** (타입별):

```typescript
// src/types/index.ts에 추가
type MetaCredentials = {
    type: "meta";
    accessToken: string;        // System User Token 또는 User Token
    appId: string;
    appSecret: string;
    pageAccessTokens: Record<string, string>;  // { pageId: pageAccessToken }
};

type GoogleCredentials = {
    type: "google";
    refreshToken: string;
    clientId: string;
    clientSecret: string;
    developerToken: string;
};

type NaverCredentials = {
    type: "naver";
    apiKey: string;
    secretKey: string;
    customerId: string;
};

type AdPlatformCredentials = MetaCredentials | GoogleCredentials | NaverCredentials;
```

> **보안**: credentials는 DB에 평문 JSONB로 저장하되, API 응답 시 토큰/시크릿을 마스킹 처리. 향후 필요시 AES-256 암호화 레이어 추가 가능. (기존 alimtalkConfigs.secretKey와 동일 패턴)

### 3.2 ad_accounts 테이블

플랫폼 하위의 개별 광고 계정. 워크스페이스(사업 단위)에 연결합니다.

```typescript
export const adAccounts = pgTable("ad_accounts", {
    id: serial("id").primaryKey(),
    adPlatformId: integer("ad_platform_id")
        .references(() => adPlatforms.id, { onDelete: "cascade" })
        .notNull(),
    workspaceId: integer("workspace_id")
        .references(() => workspaces.id, { onDelete: "set null" }),
    externalAccountId: varchar("external_account_id", { length: 100 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    currency: varchar("currency", { length: 10 }),
    status: varchar("status", { length: 20 }).default("active").notNull(),
    // 'active' | 'paused' | 'disabled'
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    lastSyncAt: timestamptz("last_sync_at"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
}, (table) => ({
    platformAccountUnique: unique().on(table.adPlatformId, table.externalAccountId),
}));
```

### 3.3 ad_lead_integrations 테이블

리드폼 → 파티션 매핑 (Wedly의 `meta_lead_integrations` 확장).

```typescript
export const adLeadIntegrations = pgTable("ad_lead_integrations", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    adAccountId: integer("ad_account_id")
        .references(() => adAccounts.id, { onDelete: "cascade" })
        .notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    platform: varchar("platform", { length: 20 }).notNull(), // denormalized for webhook lookup
    partitionId: integer("partition_id")
        .references(() => partitions.id, { onDelete: "set null" }),
    formId: varchar("form_id", { length: 200 }).notNull(),
    formName: varchar("form_name", { length: 200 }),
    fieldMappings: jsonb("field_mappings").$type<Record<string, string>>().notNull(),
    // { "full_name": "companyName", "phone_number": "representativePhone" }
    defaultValues: jsonb("default_values").$type<Record<string, unknown>>(),
    // { "progressStatus": "신규", "source": "메타광고" }
    isActive: integer("is_active").default(1).notNull(),
    createdBy: uuid("created_by")
        .references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
}, (table) => ({
    accountFormUnique: unique().on(table.adAccountId, table.formId),
    formIdIdx: index("ad_lead_integrations_form_id_idx").on(table.formId),
    platformIdx: index("ad_lead_integrations_platform_idx").on(table.platform),
}));
```

> **주의**: `formId`에 인덱스 필요. Webhook에서 form_id로 빠르게 조회해야 함.

### 3.4 ad_lead_logs 테이블

리드 수집 로그/감사.

```typescript
export const adLeadLogs = pgTable("ad_lead_logs", {
    id: serial("id").primaryKey(),
    integrationId: integer("integration_id")
        .references(() => adLeadIntegrations.id, { onDelete: "cascade" })
        .notNull(),
    externalLeadId: varchar("external_lead_id", { length: 200 }),
    recordId: integer("record_id"),
    rawData: jsonb("raw_data").$type<Record<string, unknown>>(),
    status: varchar("status", { length: 20 }).default("success").notNull(),
    // 'success' | 'failed' | 'duplicate' | 'skipped'
    errorMessage: text("error_message"),
    processedAt: timestamptz("processed_at").defaultNow(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
}, (table) => ({
    integrationCreatedIdx: index("ad_lead_logs_integration_created_idx")
        .on(table.integrationId, table.createdAt),
    externalLeadIdx: index("ad_lead_logs_external_lead_idx")
        .on(table.externalLeadId),
}));
```

### 3.5 Entity Relationships

```
Organization (1) ──── (N) ad_platforms
ad_platforms  (1) ──── (N) ad_accounts
workspaces    (1) ──── (N) ad_accounts (optional)
ad_accounts   (1) ──── (N) ad_lead_integrations
partitions    (1) ──── (N) ad_lead_integrations
ad_lead_integrations (1) ──── (N) ad_lead_logs
records       (1) ──── (N) ad_lead_logs (optional)
```

---

## 4. API Specification

### 4.1 Endpoint List

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| **Ad Platforms** | | | |
| GET | `/api/ad-platforms` | 플랫폼 연결 목록 | Required |
| POST | `/api/ad-platforms` | 플랫폼 연결 (OAuth 콜백 후) | Required (admin+) |
| GET | `/api/ad-platforms/[id]` | 플랫폼 상세 | Required |
| PATCH | `/api/ad-platforms/[id]` | 플랫폼 수정 (토큰 갱신 등) | Required (admin+) |
| DELETE | `/api/ad-platforms/[id]` | 플랫폼 연결 해제 | Required (admin+) |
| POST | `/api/ad-platforms/[id]/sync` | 광고 계정 동기화 | Required (admin+) |
| **Ad Accounts** | | | |
| GET | `/api/ad-accounts` | 광고 계정 목록 (?platformId=) | Required |
| PATCH | `/api/ad-accounts/[id]` | 계정 수정 (워크스페이스 연결 등) | Required (admin+) |
| **Ad Lead Integrations** | | | |
| GET | `/api/ad-lead-integrations` | 연동 목록 (?accountId=) | Required |
| POST | `/api/ad-lead-integrations` | 연동 생성 | Required (admin+) |
| GET | `/api/ad-lead-integrations/[id]` | 연동 상세 | Required |
| PATCH | `/api/ad-lead-integrations/[id]` | 연동 수정 | Required (admin+) |
| DELETE | `/api/ad-lead-integrations/[id]` | 연동 삭제 | Required (admin+) |
| **Ad Lead Logs** | | | |
| GET | `/api/ad-lead-logs` | 수집 로그 (?integrationId=&status=) | Required |
| GET | `/api/ad-lead-logs/stats` | 수집 통계 | Required |
| **Meta 전용** | | | |
| GET | `/api/meta/auth-url` | OAuth 인증 URL 생성 | Required (admin+) |
| GET | `/api/meta/callback` | OAuth 콜백 처리 | - (Meta redirect) |
| GET | `/api/meta/pages` | 연결된 페이지 목록 (?platformId=) | Required |
| GET | `/api/meta/lead-forms` | 리드 폼 목록 (?pageId=) | Required |
| GET | `/api/meta/lead-form-fields` | 폼 필드 목록 (?formId=) | Required |
| GET | `/api/meta/ad-accounts` | 광고 계정 목록 (from Meta API) | Required |
| **Webhooks** | | | |
| GET | `/api/webhooks/meta` | Meta Webhook 검증 | - (Meta verify) |
| POST | `/api/webhooks/meta` | Meta 리드 이벤트 수신 | - (Meta callback) |

### 4.2 Detailed Specifications

#### `POST /api/ad-platforms`

OAuth 콜백 후 토큰과 함께 플랫폼 연결을 저장합니다.

**Request:**
```json
{
    "platform": "meta",
    "name": "매치스플랜 메타 광고",
    "credentials": {
        "type": "meta",
        "accessToken": "EAAxx...",
        "appId": "123456",
        "appSecret": "abc...",
        "pageAccessTokens": {}
    }
}
```

**Response (201):**
```json
{
    "success": true,
    "data": {
        "id": 1,
        "platform": "meta",
        "name": "매치스플랜 메타 광고",
        "status": "connected",
        "credentials": {
            "type": "meta",
            "accessToken": "EAAx...****",
            "appId": "123456",
            "appSecret": "abc...****",
            "pageAccessTokens": {}
        },
        "createdAt": "2026-03-31T00:00:00Z"
    }
}
```

> **마스킹 규칙**: GET 응답에서 토큰/시크릿은 앞 4자 + `****` 형태로 마스킹. POST/PATCH 시에만 전체 값 전송.

#### `POST /api/ad-platforms/[id]/sync`

Meta Graph API로 광고 계정 목록을 가져와 `ad_accounts`에 upsert합니다.

**Response (200):**
```json
{
    "success": true,
    "data": {
        "synced": 3,
        "created": 1,
        "updated": 2,
        "accounts": [
            { "id": 1, "externalAccountId": "act_123", "name": "DH 광고", "status": "active" },
            { "id": 2, "externalAccountId": "act_456", "name": "BOL 광고", "status": "active" }
        ]
    }
}
```

#### `POST /api/ad-lead-integrations`

**Request:**
```json
{
    "adAccountId": 1,
    "name": "DH 리드폼 연동",
    "partitionId": 5,
    "formId": "1234567890",
    "formName": "디자이너 문의 폼",
    "fieldMappings": {
        "full_name": "companyName",
        "phone_number": "representativePhone",
        "email": "email"
    },
    "defaultValues": {
        "progressStatus": "신규",
        "source": "메타광고"
    }
}
```

#### `GET /api/webhooks/meta` (Webhook 검증)

Meta가 Webhook 등록 시 호출. 기존 Wedly 패턴 동일.

```
GET /api/webhooks/meta?hub.mode=subscribe&hub.verify_token=TOKEN&hub.challenge=CHALLENGE
→ 200: CHALLENGE (plain text)
```

#### `POST /api/webhooks/meta` (리드 이벤트 수신)

```json
{
    "object": "page",
    "entry": [{
        "id": "page_id",
        "time": 1711843200,
        "changes": [{
            "field": "leadgen",
            "value": {
                "leadgen_id": "lead_123",
                "form_id": "form_456",
                "ad_id": "ad_789",
                "page_id": "page_id",
                "created_time": 1711843200
            }
        }]
    }]
}
```

**처리 로직** (비동기):
1. `form_id`로 `ad_lead_integrations` 조회 (`isActive=1`, `platform='meta'`)
2. 매칭 없으면 → `ad_lead_logs`에 `skipped` 기록하고 종료
3. `ad_accounts` → `ad_platforms`에서 `accessToken` 조회
4. Meta Graph API: `GET /v21.0/{leadgen_id}?access_token=TOKEN`
5. 응답에서 필드 데이터 추출 → `fieldMappings` 적용 → `defaultValues` 적용
6. 전화번호 정규화 (`+82` → `0` 형식)
7. `externalLeadId`로 중복 체크 (이미 처리된 리드면 `duplicate` 로그)
8. `records` INSERT → `ad_lead_logs` INSERT (`success`)
9. 실패 시 → `ad_lead_logs` INSERT (`failed`, errorMessage)

#### `GET /api/ad-lead-logs/stats`

**Query Params:** `?integrationId=&period=7d|30d|90d`

**Response:**
```json
{
    "success": true,
    "data": {
        "total": 150,
        "success": 142,
        "failed": 3,
        "duplicate": 5,
        "skipped": 0,
        "byDate": [
            { "date": "2026-03-30", "count": 12 },
            { "date": "2026-03-31", "count": 8 }
        ]
    }
}
```

---

## 5. UI/UX Design

### 5.1 메뉴 구조 변경

기존 설정 페이지에 **광고 연동** 탭 추가:

```
/settings/organization
├── 일반 (General)
├── 팀 (Team)
├── AI (AI Usage)
├── API 토큰 (API Tokens)
└── 광고 연동 (Ad Integration)  ← 신규 탭
```

### 5.2 광고 연동 탭 레이아웃

```
┌─────────────────────────────────────────────────────────────┐
│  광고 연동                                                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  플랫폼 연결                                                │
│  ┌─────────────────────────────────────────────┐           │
│  │ 🔵 Meta (Facebook/Instagram)                │           │
│  │   상태: 연결됨 ✅    계정: 3개               │           │
│  │   마지막 동기화: 2분 전                       │           │
│  │   [계정 동기화] [연결 해제]                    │           │
│  └─────────────────────────────────────────────┘           │
│  ┌─────────────────────────────────────────────┐           │
│  │ 🔴 Google Ads                               │           │
│  │   상태: 연결 안됨                             │           │
│  │   [연결하기]                                  │           │
│  └─────────────────────────────────────────────┘           │
│  ┌─────────────────────────────────────────────┐           │
│  │ 🟢 Naver 검색광고                            │           │
│  │   상태: 연결 안됨                             │           │
│  │   [연결하기]                                  │           │
│  └─────────────────────────────────────────────┘           │
│                                                             │
│  ─────────────────────────────────────────                  │
│                                                             │
│  리드 연동                              [+ 연동 추가]        │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ 이름          │ 플랫폼 │ 폼         │ 대상 파티션 │ 상태│ │
│  │ DH 리드폼     │ Meta  │ 디자이너문의│ DH신규리드  │ 🟢 │ │
│  │ BOL 문의폼    │ Meta  │ 백오피스문의│ BOL문의     │ 🟢 │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  ─────────────────────────────────────────                  │
│                                                             │
│  최근 수집 로그                                              │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ 시간           │ 연동       │ 리드ID    │ 상태       │  │
│  │ 03/31 14:23   │ DH 리드폼  │ lead_123 │ ✅ 성공    │  │
│  │ 03/31 14:20   │ BOL 문의폼 │ lead_124 │ ✅ 성공    │  │
│  │ 03/31 14:15   │ DH 리드폼  │ lead_125 │ ⚠️ 중복   │  │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 5.3 리드 연동 생성 다이얼로그 (Multi-Step)

Wedly의 CreateIntegrationDialog 패턴을 따름:

```
Step 1: 광고 계정 + 리드 폼 선택
┌──────────────────────────────────┐
│  연동 추가 (1/4 - 광고 소스)     │
│                                  │
│  플랫폼:  [Meta ▼]               │
│  광고 계정: [DH 광고계정 ▼]      │
│  페이지: [디자이너하이어 ▼]       │
│  리드 폼:                        │
│    ○ 디자이너 문의 폼 (3개 필드)  │
│    ○ 채용 상담 폼 (5개 필드)      │
│                                  │
│         [취소]  [다음 →]          │
└──────────────────────────────────┘

Step 2: 대상 파티션 선택
┌──────────────────────────────────┐
│  연동 추가 (2/4 - 대상 파티션)   │
│                                  │
│  워크스페이스: [디자이너하이어 ▼]  │
│  (광고 계정 연결 워크스페이스 자동 선택)
│  파티션:                         │
│    ○ 메타광고 리드                │
│    ○ 직접유입                     │
│                                  │
│     [← 이전]  [다음 →]           │
└──────────────────────────────────┘

Step 3: 필드 매핑
┌──────────────────────────────────┐
│  연동 추가 (3/4 - 필드 매핑)     │
│                                  │
│  Meta 필드       →  DB 컬럼      │
│  full_name       → [회사명 ▼]    │
│  phone_number    → [전화번호 ▼]  │
│  email           → [이메일 ▼]    │
│  company_name    → [업체명 ▼]    │
│                                  │
│     [← 이전]  [다음 →]           │
└──────────────────────────────────┘

Step 4: 기본값 설정
┌──────────────────────────────────┐
│  연동 추가 (4/4 - 기본값)        │
│                                  │
│  리드 유입 시 자동 설정할 값:     │
│                                  │
│  진행상태: [신규 ▼]               │
│  유입경로: [메타광고     ]        │
│  담당자:   [자동배정 안함 ▼]      │
│                                  │
│     [← 이전]  [생성]             │
└──────────────────────────────────┘
```

### 5.4 Meta OAuth 연결 플로우

```
[연결하기] 클릭
    ↓
GET /api/meta/auth-url → Meta OAuth URL 생성
    ↓
새 창/팝업으로 Meta 로그인 페이지 열기
    ↓
사용자가 권한 승인 (pages_manage_ads, leads_retrieval, ads_read 등)
    ↓
Meta → GET /api/meta/callback?code=XXX
    ↓
서버: code → access_token 교환
    ↓
ad_platforms INSERT + 자동으로 광고 계정 동기화
    ↓
팝업 닫기 + 메인 페이지 SWR mutate
```

### 5.5 Component List

| Component | Location | Responsibility |
|-----------|----------|----------------|
| `AdIntegrationTab` | `src/components/settings/AdIntegrationTab.tsx` | 광고 연동 탭 메인 |
| `AdPlatformList` | `src/components/ad/AdPlatformList.tsx` | 플랫폼 연결 목록 |
| `MetaOAuthButton` | `src/components/ad/MetaOAuthButton.tsx` | Meta 연결 버튼 |
| `AdLeadIntegrationList` | `src/components/ad/AdLeadIntegrationList.tsx` | 리드 연동 목록 |
| `CreateIntegrationDialog` | `src/components/ad/CreateIntegrationDialog.tsx` | 4단계 연동 생성 |
| `FieldMappingEditor` | `src/components/ad/FieldMappingEditor.tsx` | 필드 매핑 UI |
| `DefaultValueEditor` | `src/components/ad/DefaultValueEditor.tsx` | 기본값 설정 UI |
| `AdLeadLogTable` | `src/components/ad/AdLeadLogTable.tsx` | 수집 로그 테이블 |

### 5.6 Hook List

| Hook | Location | Responsibility |
|------|----------|----------------|
| `useAdPlatforms` | `src/hooks/useAdPlatforms.ts` | 플랫폼 연결 CRUD |
| `useAdAccounts` | `src/hooks/useAdAccounts.ts` | 광고 계정 목록/수정 |
| `useAdLeadIntegrations` | `src/hooks/useAdLeadIntegrations.ts` | 리드 연동 CRUD |
| `useAdLeadLogs` | `src/hooks/useAdLeadLogs.ts` | 수집 로그 조회 |
| `useMetaPages` | `src/hooks/useMetaPages.ts` | Meta 페이지 목록 |
| `useMetaLeadForms` | `src/hooks/useMetaLeadForms.ts` | Meta 리드 폼 목록 |

---

## 6. 리드 수집 방식 — 플랫폼별 비교

### 6.0 플랫폼별 수집 방식 요약

| 플랫폼 | 수집 방식 | 실시간 | 우리가 설정할 것 | 구현 시기 |
|--------|----------|:------:|-----------------|:---------:|
| **Meta** | Webhook (push) | O | Meta Developer 앱에서 Webhook URL 등록 + 페이지별 `subscribed_apps` 구독 | **1차** |
| **Google Ads** | Polling 또는 Pub/Sub | X | Cron 스케줄러 (5분 간격 등), Google Cloud Pub/Sub 설정 | 2차 |
| **Naver** | Polling 또는 웹폼 | X | Cron 스케줄러 또는 기존 웹폼 기능 활용 | 2차 |

**Meta (1차 구현):**
- Meta가 리드 발생 시 우리 Webhook URL로 자동 POST
- Meta Developer 앱 1개로 모든 조직의 리드를 수신, `form_id`로 조직/연동 분기
- 설정: Meta 앱 > Webhooks > `leadgen` 구독 + 각 페이지 `subscribed_apps` 활성화

**Google Ads (2차):**
- Webhook 없음. Google Ads API로 주기적 폴링 필요
- 또는 Google Cloud Pub/Sub 연동 (준 실시간, 인프라 추가 필요)
- `ad_lead_integrations.lastPolledAt` 필드로 마지막 조회 시점 관리

**Naver (2차):**
- Webhook 없음. Naver 검색광고 API로 전환 데이터 주기적 조회
- 네이버 리드폼 기능이 약해서, 실제로는 랜딩페이지 → 기존 Sendb 웹폼으로 수집하는 경우가 더 현실적
- 전환 추적용으로만 연동할 가능성 높음

> **2차 구현 시 고려사항**: Polling 방식은 `lastPolledAt` 타임스탬프 + cron 스케줄러가 필요하므로, `ad_lead_integrations`에 `collectionMethod` ('webhook' | 'polling') 필드와 `lastPolledAt` 필드를 2차 때 추가해야 함

---

### 6.1 Meta Webhook (`/api/webhooks/meta/route.ts`)

```typescript
// GET: 검증
export async function GET(req: NextRequest) {
    const mode = req.nextUrl.searchParams.get("hub.mode");
    const token = req.nextUrl.searchParams.get("hub.verify_token");
    const challenge = req.nextUrl.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
        return new Response(challenge, { status: 200 });
    }
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// POST: 리드 이벤트 처리
export async function POST(req: NextRequest) {
    const body = await req.json();

    // 즉시 200 응답 (Meta 타임아웃 방지)
    // Next.js에서는 waitUntil 또는 별도 비동기 처리
    processMetaWebhook(body); // fire-and-forget

    return NextResponse.json({ success: true });
}
```

### 6.2 processMetaWebhook 핵심 로직

```typescript
// src/lib/meta-webhook.ts
async function processMetaWebhook(body: MetaWebhookBody) {
    for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
            if (change.field !== "leadgen") continue;

            const { leadgen_id, form_id } = change.value;

            // 1. 연동 찾기
            const integration = await db.select()
                .from(adLeadIntegrations)
                .where(and(
                    eq(adLeadIntegrations.formId, form_id),
                    eq(adLeadIntegrations.platform, "meta"),
                    eq(adLeadIntegrations.isActive, 1)
                ))
                .limit(1);

            if (!integration.length) {
                // 매칭 안됨 — 로그만 남기고 종료
                return;
            }

            // 2. 중복 체크
            const existing = await db.select()
                .from(adLeadLogs)
                .where(eq(adLeadLogs.externalLeadId, leadgen_id))
                .limit(1);

            if (existing.length) {
                await insertLog(integration[0].id, leadgen_id, null, null, "duplicate");
                return;
            }

            // 3. 액세스 토큰 조회
            const account = await db.select()
                .from(adAccounts)
                .innerJoin(adPlatforms, eq(adPlatforms.id, adAccounts.adPlatformId))
                .where(eq(adAccounts.id, integration[0].adAccountId));

            const { accessToken } = account[0].ad_platforms.credentials as MetaCredentials;

            // 4. Meta API로 리드 상세 조회
            const leadData = await fetchMetaLead(leadgen_id, accessToken);

            // 5. 필드 매핑 + 기본값 적용 + 전화번호 정규화
            const recordData = applyFieldMappings(
                leadData,
                integration[0].fieldMappings,
                integration[0].defaultValues
            );

            // 6. 레코드 생성
            const record = await createRecord(
                integration[0].orgId,
                integration[0].partitionId,
                recordData
            );

            // 7. 성공 로그
            await insertLog(
                integration[0].id, leadgen_id, record.id, leadData, "success"
            );
        }
    }
}
```

### 6.3 전화번호 정규화 (Wedly 패턴 재사용)

```typescript
function normalizeKoreanPhone(phone: string): string {
    if (!phone) return phone;
    // +82 10-1234-5678 → 010-1234-5678
    let normalized = phone.replace(/^\+82\s?/, "0");
    // 하이픈 없으면 추가
    if (/^0\d{9,10}$/.test(normalized)) {
        if (normalized.length === 11) {
            normalized = normalized.replace(/(\d{3})(\d{4})(\d{4})/, "$1-$2-$3");
        } else if (normalized.length === 10) {
            normalized = normalized.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3");
        }
    }
    return normalized;
}
```

---

## 7. Security Considerations

- [x] **조직 격리**: 모든 API에서 orgId 검증 (기존 패턴 동일)
- [x] **Webhook 검증**: META_WEBHOOK_VERIFY_TOKEN으로 검증
- [x] **토큰 마스킹**: GET 응답에서 credentials 마스킹
- [ ] **OAuth Scope 최소화**: 필요 권한만 요청 (pages_manage_ads, leads_retrieval, ads_read)
- [ ] **Rate Limiting**: Webhook 엔드포인트 rate limit (Meta는 자체 제어하지만 안전장치)
- [ ] **CSRF 보호**: Webhook은 예외, 나머지 API는 기존 JWT 인증
- [ ] **토큰 만료 감지**: ad_platforms.status를 'expired'로 자동 업데이트

---

## 8. Error Handling

### 8.1 Webhook 에러 처리

| 상황 | 처리 | 로그 status |
|------|------|------------|
| form_id 매칭 안됨 | 무시 (다른 앱의 이벤트일 수 있음) | - |
| 중복 리드 | 스킵 + 로그 | `duplicate` |
| Meta API 조회 실패 | 로그 + 에러 기록 | `failed` |
| 필드 매핑 실패 | 가능한 필드만 매핑 + 경고 로그 | `success` (partial) |
| 레코드 생성 실패 | 로그 + 에러 기록 | `failed` |
| 파티션 삭제됨 | 스킵 + 로그 | `skipped` |

### 8.2 OAuth 에러 처리

| 상황 | 처리 |
|------|------|
| 토큰 만료 | status → 'expired', UI에 경고 배지 |
| 권한 부족 | OAuth 재연결 안내 |
| API rate limit | 429 감지 시 지수 백오프 retry |

---

## 9. Migration Plan

### 9.1 Drizzle Migration Files

```
drizzle/
├── 0031_create_ad_platforms.sql
├── 0032_create_ad_accounts.sql
├── 0033_create_ad_lead_integrations.sql
└── 0034_create_ad_lead_logs.sql
```

### 9.2 Migration Order

1. `ad_platforms` — organizations FK만
2. `ad_accounts` — ad_platforms FK, workspaces FK (기존 테이블)
3. `ad_lead_integrations` — ad_accounts, partitions FK
4. `ad_lead_logs` — ad_lead_integrations FK

---

## 10. File Structure

```
src/
├── app/
│   ├── api/
│   │   ├── ad-platforms/
│   │   │   ├── route.ts                    # GET, POST
│   │   │   └── [id]/
│   │   │       ├── route.ts                # GET, PATCH, DELETE
│   │   │       └── sync/
│   │   │           └── route.ts            # POST (계정 동기화)
│   │   ├── ad-accounts/
│   │   │   ├── route.ts                    # GET
│   │   │   └── [id]/
│   │   │       └── route.ts                # PATCH
│   │   ├── ad-lead-integrations/
│   │   │   ├── route.ts                    # GET, POST
│   │   │   └── [id]/
│   │   │       └── route.ts                # GET, PATCH, DELETE
│   │   ├── ad-lead-logs/
│   │   │   ├── route.ts                    # GET
│   │   │   └── stats/
│   │   │       └── route.ts                # GET
│   │   ├── meta/
│   │   │   ├── auth-url/route.ts           # GET (OAuth URL 생성)
│   │   │   ├── callback/route.ts           # GET (OAuth 콜백)
│   │   │   ├── pages/route.ts              # GET (페이지 목록)
│   │   │   ├── lead-forms/route.ts         # GET (리드 폼 목록)
│   │   │   ├── lead-form-fields/route.ts   # GET (폼 필드)
│   │   │   └── ad-accounts/route.ts        # GET (Meta 광고 계정)
│   │   └── webhooks/
│   │       └── meta/
│   │           └── route.ts                # GET (verify), POST (event)
│   └── settings/
│       └── organization/
│           └── page.tsx                    # 탭 추가: ad-integration
├── components/
│   └── ad/
│       ├── AdIntegrationTab.tsx            # 메인 탭 컴포넌트
│       ├── AdPlatformList.tsx              # 플랫폼 연결 카드 목록
│       ├── MetaOAuthButton.tsx             # Meta OAuth 연결 버튼
│       ├── AdLeadIntegrationList.tsx       # 리드 연동 테이블
│       ├── CreateIntegrationDialog.tsx     # 4단계 연동 생성 다이얼로그
│       ├── FieldMappingEditor.tsx          # 필드 매핑 에디터
│       ├── DefaultValueEditor.tsx          # 기본값 에디터
│       └── AdLeadLogTable.tsx              # 수집 로그 테이블
├── hooks/
│   ├── useAdPlatforms.ts
│   ├── useAdAccounts.ts
│   ├── useAdLeadIntegrations.ts
│   ├── useAdLeadLogs.ts
│   ├── useMetaPages.ts
│   └── useMetaLeadForms.ts
├── lib/
│   ├── meta-api.ts                         # Meta Graph API 클라이언트
│   ├── meta-webhook.ts                     # Webhook 처리 로직
│   └── phone-normalize.ts                  # 전화번호 정규화
└── types/
    └── index.ts                            # AdPlatformCredentials 등 타입 추가
```

---

## 11. Implementation Order

### Phase 1: DB + Meta 플랫폼 연결 (기반)

1. [ ] schema.ts에 ad_platforms, ad_accounts, ad_lead_integrations, ad_lead_logs 추가
2. [ ] Drizzle 마이그레이션 생성/실행
3. [ ] types/index.ts에 타입 추가 (AdPlatformCredentials 등)
4. [ ] 설정 페이지에 "광고 연동" 탭 추가
5. [ ] Meta OAuth URL 생성 API + 콜백 API
6. [ ] Ad Platforms CRUD API
7. [ ] useAdPlatforms 훅
8. [ ] AdPlatformList + MetaOAuthButton UI
9. [ ] 광고 계정 동기화 API (sync)
10. [ ] useAdAccounts 훅
11. [ ] 계정 목록 UI (워크스페이스 연결)

### Phase 2: 리드 연동 + Webhook

12. [ ] meta-api.ts (페이지/폼/리드 조회)
13. [ ] Meta 페이지/폼 조회 API + useMetaPages, useMetaLeadForms 훅
14. [ ] Ad Lead Integrations CRUD API
15. [ ] useAdLeadIntegrations 훅
16. [ ] CreateIntegrationDialog (4단계: 계정→폼→파티션→매핑)
17. [ ] FieldMappingEditor + DefaultValueEditor
18. [ ] meta-webhook.ts (Webhook 처리 로직)
19. [ ] Webhook 엔드포인트 (`/api/webhooks/meta`)
20. [ ] phone-normalize.ts

### Phase 3: 로그 + 모니터링

21. [ ] Ad Lead Logs API + 통계 API
22. [ ] useAdLeadLogs 훅
23. [ ] AdLeadLogTable UI
24. [ ] AdLeadIntegrationList에 활성/비활성 토글

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-03-31 | Initial draft | jaehun |
| 0.2 | 2026-03-31 | brands 테이블 제거, 기존 워크스페이스 활용으로 변경 | jaehun |
