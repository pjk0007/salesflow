# Design: weldy-features (Weldy 기능 이관)

> Plan: `docs/01-plan/features/weldy-features.plan.md`

## 구현 순서

| # | Feature | 신규 파일 | 수정 파일 | DB 변경 |
|---|---------|----------|----------|---------|
| 1 | 배분/라운드로빈 | 2 | 2 | 없음 (컬럼 존재) |
| 2 | 실시간 SSE | 3 | 3 | 없음 |
| 3 | 웹 폼 | 10 | 2 | 2 테이블 |
| 4 | 대시보드 위젯 | 14 | 2 | 2 테이블 |

---

## Feature 1: 배분/라운드로빈 할당

### 1.1 현재 상태 분석

`partitions` 테이블에 이미 컬럼 존재:
```
useDistributionOrder  integer  default(0)
maxDistributionOrder  integer  default(5)
lastAssignedOrder     integer  default(0)
distributionDefaults  jsonb    Record<number, { field: string; value: string }[]>
```

현재 records POST (`src/pages/api/partitions/[id]/records.ts` L236-247)에 배분 로직이 있지만:
- **Race condition**: partition을 먼저 SELECT한 후 별도 UPDATE → 동시 요청 시 같은 순번 할당 가능
- **distributionDefaults 미적용**: 순번별 기본값을 record.data에 병합하지 않음

### 1.2 설계: `src/lib/distribution.ts` (신규)

```typescript
interface DistributionResult {
  distributionOrder: number;
  defaults: Record<string, unknown>;
}

/**
 * 원자적 라운드로빈 할당.
 * UPDATE + RETURNING으로 단일 쿼리에서 처리하여 race condition 방지.
 */
async function assignDistributionOrder(
  tx: Transaction,
  partitionId: number
): Promise<DistributionResult | null>
```

핵심 SQL:
```sql
UPDATE partitions
SET last_assigned_order = (last_assigned_order % max_distribution_order) + 1
WHERE id = $1 AND use_distribution_order = 1
RETURNING last_assigned_order, distribution_defaults
```

반환된 `distributionDefaults[order]`에서 해당 순번의 기본값 추출 → `{ field, value }[]`를 `Record<string, unknown>`로 변환하여 반환.

### 1.3 설계: records POST 수정 (`src/pages/api/partitions/[id]/records.ts`)

트랜잭션 내부에서 기존 분배 로직(L236-247) 교체:

```typescript
// 기존: partition.lastAssignedOrder에서 계산 (race condition)
// 변경: assignDistributionOrder() 호출
const distribution = await assignDistributionOrder(tx, partition.id);
let distributionOrder: number | null = null;
let finalData = recordData;

if (distribution) {
  distributionOrder = distribution.distributionOrder;
  // defaults를 recordData에 병합 (빈 필드만)
  finalData = { ...distribution.defaults };
  for (const [k, v] of Object.entries(recordData)) {
    if (v !== undefined && v !== null && v !== "") finalData[k] = v;
  }
}
```

### 1.4 설계: DistributionSettings UI (`src/components/partitions/DistributionSettings.tsx`, 신규)

파티션 설정에서 사용하는 배분 설정 컴포넌트:

```
Props: {
  partition: Partition;
  fields: FieldDefinitionRow[];   // 워크스페이스 필드 정의
  onSave: (settings: DistributionSettingsData) => Promise<void>;
}
```

UI 구성:
```
┌─────────────────────────────────────────┐
│ [Switch] 자동 분배 활성화               │
│                                         │
│ 분배 순번 수: [___3___] (1~99)          │
│ ※ 1~3 순환 배정                         │
│                                         │
│ ▼ 순번 1 기본값 (2개 설정)              │
│   ├ [필드 선택 ▼] [값 입력___]  [✕]    │
│   ├ [필드 선택 ▼] [값 입력___]  [✕]    │
│   └ [+ 기본값 추가]                     │
│                                         │
│ ▼ 순번 2 기본값 (1개 설정)              │
│   ├ [필드 선택 ▼] [값 입력___]  [✕]    │
│   └ [+ 기본값 추가]                     │
│                                         │
│ ▶ 순번 3 기본값 (0개 설정)              │
│                                         │
│                        [저장]           │
└─────────────────────────────────────────┘
```

- 각 순번은 Collapsible 섹션
- 필드 선택은 워크스페이스 fieldDefinitions에서 select/text/phone 등 선택
- select 타입 필드는 options에서 값 선택, 그 외는 텍스트 입력

### 1.5 설계: 파티션 설정 API 수정 (`src/pages/api/partitions/[id]/index.ts`)

PATCH 핸들러 확장:
```typescript
// 기존: name만 수정
// 추가: useDistributionOrder, maxDistributionOrder, distributionDefaults
const {
  name,
  useDistributionOrder,
  maxDistributionOrder,
  distributionDefaults,
} = req.body;
```

유효성 검사:
- `maxDistributionOrder`: 1~99 범위
- `maxDistributionOrder` 감소 시 `lastAssignedOrder`가 초과하면 0으로 리셋
- `distributionDefaults`: 각 순번의 field가 실제 fieldDefinition에 존재하는지 검증

### 1.6 파일 목록

| 유형 | 파일 경로 | 변경 |
|------|----------|------|
| 신규 | `src/lib/distribution.ts` | 원자적 할당 함수 |
| 신규 | `src/components/partitions/DistributionSettings.tsx` | 배분 설정 UI |
| 수정 | `src/pages/api/partitions/[id]/records.ts` | POST에서 assignDistributionOrder 호출 |
| 수정 | `src/pages/api/partitions/[id]/index.ts` | PATCH 배분 설정 저장 |

---

## Feature 2: 실시간 SSE 동기화

### 2.1 설계: SSE 서버 유틸 (`src/lib/sse.ts`, 신규)

```typescript
// 글로벌 클라이언트 맵 (dev 모드에서 globalThis 사용)
type SSEClient = {
  res: ServerResponse;
  sessionId: string;
};

const clients: Map<string, Set<SSEClient>>; // key: partitionId

function addClient(partitionId: string, client: SSEClient): void;
function removeClient(partitionId: string, client: SSEClient): void;

/**
 * 특정 파티션에 이벤트 브로드캐스트.
 * senderSessionId를 제외하여 자기 자신에게는 전송하지 않음.
 */
function broadcastToPartition(
  partitionId: number,
  event: RecordEventType,
  data: RecordEventData,
  senderSessionId?: string
): void;
```

이벤트 타입:
```typescript
type RecordEventType =
  | "record:created"
  | "record:updated"
  | "record:deleted"
  | "record:bulk-updated"
  | "record:bulk-deleted";

interface RecordEventData {
  partitionId: number;
  recordId?: number;
  recordIds?: number[];
}
```

### 2.2 설계: SSE 엔드포인트 (`src/pages/api/sse.ts`, 신규)

```
GET /api/sse?partitionId=123&sessionId=abc
```

- auth 필수 (`getUserFromRequest`)
- SSE 헤더: `text/event-stream`, `no-cache`, `keep-alive`, `X-Accel-Buffering: no`
- 연결 시 `event: connected` + `data: { clientId }` 전송
- 30초 heartbeat (`: heartbeat\n\n`)
- `res.on("close")` → `removeClient()`
- Next.js config: `export const config = { api: { bodyParser: false } }`가 아닌, response buffering만 비활성화

### 2.3 설계: SSE 클라이언트 훅 (`src/hooks/useSSE.ts`, 신규)

```typescript
interface UseSSEOptions {
  partitionId: number | null;
  enabled?: boolean;
  onRecordCreated?: (data: RecordEventData) => void;
  onRecordUpdated?: (data: RecordEventData) => void;
  onRecordDeleted?: (data: RecordEventData) => void;
  onAnyChange?: () => void;
}

function useSSE(options: UseSSEOptions): {
  isConnected: boolean;
  reconnect: () => void;
}
```

구현:
- `sessionId`: `useRef(crypto.randomUUID())` — 탭별 고유
- `EventSource` 생성: `/api/sse?partitionId=${id}&sessionId=${sessionId}`
  - `withCredentials: true` (쿠키 JWT 인증)
- 이벤트 리스너: `record:created`, `record:updated`, `record:deleted` 등
- `onAnyChange` 콜백 → SWR `mutate()` 호출에 사용
- 재연결: 지수 백오프 `Math.min(1000 * 2^attempt, 30000)`, 최대 5회
- `useEffect` cleanup: EventSource.close(), disconnect API 호출 불필요 (close 이벤트로 서버측 자동 정리)

### 2.4 설계: records API에 broadcast 추가

| 파일 | 위치 | 이벤트 |
|------|------|--------|
| `partitions/[id]/records.ts` | POST 성공 후 (L279) | `record:created` |
| `records/[id].ts` | PATCH 성공 후 (L64) | `record:updated` |
| `records/[id].ts` | DELETE 성공 후 (L93) | `record:deleted` |
| `records/bulk-delete.ts` | 성공 후 | `record:bulk-deleted` |

broadcast 호출은 `await` 없이 fire-and-forget:
```typescript
broadcastToPartition(partitionId, "record:created", {
  partitionId, recordId: result.id
}, req.headers["x-session-id"] as string);
```

클라이언트에서 `x-session-id` 헤더 전송 → 자기 자신 이벤트 무시.

### 2.5 설계: records 페이지에서 SSE 연동

`src/pages/records.tsx`에서:
```typescript
const { mutate } = useRecords({ partitionId, ... });

useSSE({
  partitionId,
  enabled: !!partitionId,
  onAnyChange: () => mutate(),
});
```

### 2.6 파일 목록

| 유형 | 파일 경로 | 변경 |
|------|----------|------|
| 신규 | `src/lib/sse.ts` | 서버 유틸 (클라이언트 관리, broadcast) |
| 신규 | `src/pages/api/sse.ts` | SSE 엔드포인트 |
| 신규 | `src/hooks/useSSE.ts` | 클라이언트 훅 |
| 수정 | `src/pages/api/partitions/[id]/records.ts` | POST broadcast |
| 수정 | `src/pages/api/records/[id].ts` | PATCH/DELETE broadcast |
| 수정 | `src/pages/records.tsx` | useSSE 연동 |

---

## Feature 3: 웹 폼 (리드 캡처)

### 3.1 DB 스키마

```typescript
// schema.ts에 추가

export const webForms = pgTable("web_forms", {
  id: serial("id").primaryKey(),
  orgId: uuid("org_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  workspaceId: integer("workspace_id")
    .references(() => workspaces.id, { onDelete: "cascade" })
    .notNull(),
  partitionId: integer("partition_id")
    .references(() => partitions.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  slug: varchar("slug", { length: 100 }).unique().notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  // 완료 화면
  completionTitle: varchar("completion_title", { length: 200 })
    .default("제출이 완료되었습니다"),
  completionMessage: text("completion_message"),
  completionButtonText: varchar("completion_button_text", { length: 100 }),
  completionButtonUrl: text("completion_button_url"),
  // 기본값
  defaultValues: jsonb("default_values")
    .$type<{ field: string; value: string }[]>(),
  isActive: integer("is_active").default(1).notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamptz("created_at").defaultNow().notNull(),
  updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

export const webFormFields = pgTable("web_form_fields", {
  id: serial("id").primaryKey(),
  formId: integer("form_id")
    .references(() => webForms.id, { onDelete: "cascade" })
    .notNull(),
  label: varchar("label", { length: 200 }).notNull(),
  description: text("description"),
  placeholder: varchar("placeholder", { length: 200 }),
  fieldType: varchar("field_type", { length: 20 }).default("text").notNull(),
  // text | email | phone | textarea | select | checkbox | date
  linkedFieldKey: varchar("linked_field_key", { length: 100 }),
  // fieldDefinitions.key에 매핑 → records.data[key]에 저장
  isRequired: integer("is_required").default(0).notNull(),
  options: jsonb("options").$type<string[]>(),
  // select 타입용
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamptz("created_at").defaultNow().notNull(),
  updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});
```

마이그레이션: `drizzle/XXXX_web_forms.sql`
```sql
CREATE TABLE IF NOT EXISTS "web_forms" ( ... );
CREATE TABLE IF NOT EXISTS "web_form_fields" ( ... );
CREATE UNIQUE INDEX IF NOT EXISTS "web_forms_slug_unique" ON "web_forms" ("slug");
```

### 3.2 API 설계

#### `GET/POST /api/web-forms` (인증 필요)
- GET: orgId 필터, 폼 목록 반환
- POST: `{ name, workspaceId, partitionId, title, description? }` → slug 자동 생성 (nanoid 8자)

#### `GET/PUT/DELETE /api/web-forms/[id]` (인증 필요)
- GET: 폼 + 필드 목록 반환
- PUT: 폼 메타데이터 + 필드 일괄 업데이트 (fields 배열 포함)
- DELETE: 폼 삭제

#### `GET /api/public/forms/[slug]` (인증 불필요)
- 공개 폼 조회: isActive 확인, 필드 목록 포함
- orgId 검증 없음 (공개)

#### `POST /api/public/forms/[slug]/submit` (인증 불필요)
- 제출 흐름:
  1. slug로 폼 조회 + isActive 확인
  2. 필드 목록 조회 → required 검증
  3. defaultValues 적용 (빈 필드만)
  4. linkedFieldKey 기반으로 `records.data` 구성
  5. `assignDistributionOrder()` 호출 (Feature 1 활용)
  6. 통합코드 발번 + 레코드 생성
  7. `processAutoTrigger()` + `processEmailAutoTrigger()` 호출
  8. `broadcastToPartition()` 호출 (Feature 2 활용)
  9. 성공 응답

### 3.3 SWR 훅: `src/hooks/useWebForms.ts`

```typescript
function useWebForms(workspaceId?: number): {
  forms: WebForm[];
  isLoading: boolean;
  createForm: (input: CreateFormInput) => Promise<Result>;
  updateForm: (id: number, input: UpdateFormInput) => Promise<Result>;
  deleteForm: (id: number) => Promise<Result>;
  mutate: KeyedMutator;
}
```

### 3.4 UI 컴포넌트

#### FormBuilder (`src/components/web-forms/FormBuilder.tsx`)

폼 편집 메인 컴포넌트. 3-탭 구조:

```
[질문 편집] [폼 설정] [완료 화면]
```

**질문 편집 탭**:
```
┌────────────────────────────────────────────┐
│ [+ 필드 추가]                              │
│                                            │
│ ┌──────────────────────────────────┐       │
│ │ ☰ 이름 (text) *필수              │ [✕]  │
│ │   연결 필드: customerName         │       │
│ └──────────────────────────────────┘       │
│ ┌──────────────────────────────────┐       │
│ │ ☰ 이메일 (email) *필수           │ [✕]  │
│ │   연결 필드: email                │       │
│ └──────────────────────────────────┘       │
│ ┌──────────────────────────────────┐       │
│ │ ☰ 문의 내용 (textarea)           │ [✕]  │
│ │   연결 필드: inquiry              │       │
│ └──────────────────────────────────┘       │
│                                            │
│ ※ 드래그로 순서 변경 (@dnd-kit)            │
└────────────────────────────────────────────┘
```

- 필드 추가 시: 워크스페이스 fieldDefinitions에서 선택 또는 커스텀 필드 생성
- linkedFieldKey: records.data에 저장될 key
- @dnd-kit/sortable로 드래그 순서 변경

**폼 설정 탭**: title, description, 공유 링크 복사, defaultValues 설정
**완료 화면 탭**: completionTitle, completionMessage, 버튼 텍스트/URL

#### FormPreview (`src/components/web-forms/FormPreview.tsx`)

FormBuilder 우측에 실시간 미리보기. 공개 폼과 동일한 렌더링.

#### EmbedCodeDialog (`src/components/web-forms/EmbedCodeDialog.tsx`)

iframe 삽입 코드 생성:
```html
<iframe src="https://domain.com/f/SLUG" width="100%" height="600" frameborder="0"></iframe>
```

### 3.5 공개 폼 페이지: `src/pages/f/[slug].tsx`

- auth 불필요 → `_app.tsx` 레이아웃 건너뛰기 (별도 최소 레이아웃)
- `getServerSideProps`로 폼 데이터 프리페치 (SEO meta tags)
- 7개 필드 타입 렌더링:
  - text/email: `<Input type="text|email" />`
  - phone: `<Input />` + 자동 하이픈 포맷 (`010-1234-5678`)
  - textarea: `<Textarea />`
  - select: `<Select />` with options
  - checkbox: `<Checkbox />` + label
  - date: `<Input type="date" />` 또는 DatePicker
- 제출 후 완료 화면 표시 (completionTitle, completionMessage, 버튼)

### 3.6 웹 폼 관리 페이지: `src/pages/web-forms.tsx`

```
┌─────────────────────────────────────────────────┐
│ 웹 폼                         [+ 새 폼 만들기]  │
├─────────────────────────────────────────────────┤
│ ┌──────────────┐ ┌──────────────┐               │
│ │ 신규 문의     │ │ 상담 신청     │               │
│ │              │ │              │               │
│ │ 파티션: ...  │ │ 파티션: ...  │               │
│ │ 제출: 142건  │ │ 제출: 38건   │               │
│ │              │ │              │               │
│ │ [편집] [링크] │ │ [편집] [링크] │               │
│ └──────────────┘ └──────────────┘               │
└─────────────────────────────────────────────────┘
```

- 카드 그리드로 폼 목록
- 각 카드: 이름, 연결된 파티션, 제출 건수, 활성 상태 배지
- 편집 클릭 → 폼 빌더 dialog 또는 별도 페이지
- 링크 클릭 → 공유 URL 복사 + 임베드 코드 dialog

### 3.7 네비게이션 추가

`src/components/dashboard/sidebar.tsx` navItems에 추가:
```typescript
{ href: "/web-forms", label: "웹 폼", icon: FileText },
```
제품 관리(`/products`) 아래에 배치.

### 3.8 파일 목록

| 유형 | 파일 경로 | 변경 |
|------|----------|------|
| 수정 | `src/lib/db/schema.ts` | webForms, webFormFields 테이블 + 타입 |
| 신규 | `drizzle/XXXX_web_forms.sql` | 마이그레이션 |
| 신규 | `src/pages/api/web-forms/index.ts` | GET/POST |
| 신규 | `src/pages/api/web-forms/[id].ts` | GET/PUT/DELETE |
| 신규 | `src/pages/api/public/forms/[slug].ts` | 공개 폼 조회 |
| 신규 | `src/pages/api/public/forms/[slug]/submit.ts` | 폼 제출 |
| 신규 | `src/hooks/useWebForms.ts` | SWR 훅 |
| 신규 | `src/components/web-forms/FormBuilder.tsx` | 폼 빌더 |
| 신규 | `src/components/web-forms/FormPreview.tsx` | 실시간 미리보기 |
| 신규 | `src/components/web-forms/EmbedCodeDialog.tsx` | 임베드 코드 |
| 신규 | `src/pages/web-forms.tsx` | 관리 페이지 |
| 신규 | `src/pages/f/[slug].tsx` | 공개 폼 페이지 |
| 수정 | `src/components/dashboard/sidebar.tsx` | 네비게이션 추가 |

---

## Feature 4: 대시보드 위젯 시스템

### 4.1 DB 스키마

```typescript
// schema.ts에 추가

export const dashboards = pgTable("dashboards", {
  id: serial("id").primaryKey(),
  orgId: uuid("org_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  workspaceId: integer("workspace_id")
    .references(() => workspaces.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  slug: varchar("slug", { length: 100 }).unique().notNull(),
  description: text("description"),
  globalFilters: jsonb("global_filters").$type<DashboardFilter[]>(),
  refreshInterval: integer("refresh_interval").default(60).notNull(),
  // 30~300초
  isPublic: integer("is_public").default(0).notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamptz("created_at").defaultNow().notNull(),
  updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

export const dashboardWidgets = pgTable("dashboard_widgets", {
  id: serial("id").primaryKey(),
  dashboardId: integer("dashboard_id")
    .references(() => dashboards.id, { onDelete: "cascade" })
    .notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  widgetType: varchar("widget_type", { length: 20 }).notNull(),
  // scorecard | bar | bar_horizontal | bar_stacked | line | donut
  dataColumn: varchar("data_column", { length: 100 }).notNull(),
  // records.data의 필드 key
  aggregation: varchar("aggregation", { length: 20 }).default("count").notNull(),
  // count | sum | avg
  groupByColumn: varchar("group_by_column", { length: 100 }),
  // 차트 X축 (scorecard는 불필요)
  stackByColumn: varchar("stack_by_column", { length: 100 }),
  // bar_stacked 전용 2차 그룹핑
  widgetFilters: jsonb("widget_filters").$type<DashboardFilter[]>(),
  // 위젯별 추가 필터
  layoutX: integer("layout_x").default(0).notNull(),
  layoutY: integer("layout_y").default(0).notNull(),
  layoutW: integer("layout_w").default(4).notNull(),
  layoutH: integer("layout_h").default(3).notNull(),
  createdAt: timestamptz("created_at").defaultNow().notNull(),
  updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});
```

공통 타입:
```typescript
interface DashboardFilter {
  field: string;
  operator: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "like" | "in" | "date_preset";
  value: string;
}
```

마이그레이션: `drizzle/XXXX_dashboards.sql`

### 4.2 API 설계

#### `GET/POST /api/dashboards` (인증)
- GET: `?workspaceId=N` 필터, orgId 격리
- POST: `{ name, workspaceId, description? }` → slug 자동 생성

#### `GET/PUT/DELETE /api/dashboards/[id]` (인증)
- GET: 대시보드 + 위젯 목록 반환
- PUT: name, description, globalFilters, refreshInterval, isPublic 수정
- DELETE: 삭제 (cascade로 위젯도 삭제)

#### `GET/POST/PUT /api/dashboards/[id]/widgets` (인증)
- GET: 위젯 목록 (layoutY, layoutX 순 정렬)
- POST: 위젯 추가 `{ title, widgetType, dataColumn, aggregation, ... }`
- PUT: 위젯 일괄 업데이트 `{ widgets: [{ id, layoutX, layoutY, layoutW, layoutH, ... }] }`

#### `GET /api/dashboards/[id]/data` (인증 or 공개)
- 모든 위젯 데이터를 한 번에 집계하여 반환
- `isPublic=1`인 경우 인증 없이 접근 가능
- globalFilters + widgetFilters 병합 후 WHERE 조건 구성

집계 로직 (records.data JSONB 기반):
```sql
-- scorecard (COUNT)
SELECT COUNT(*) FROM records WHERE partition_id IN (...) AND [filters]

-- scorecard (SUM)
SELECT COALESCE(SUM((data->>'{column}')::numeric), 0) FROM records WHERE ...

-- bar/line/donut (GROUP BY)
SELECT data->>'{groupByColumn}' as label, COUNT(*)|SUM(...)
FROM records WHERE ...
GROUP BY data->>'{groupByColumn}'

-- bar_stacked (2D GROUP BY)
SELECT data->>'{groupByColumn}' as label,
       data->>'{stackByColumn}' as stack,
       COUNT(*)|SUM(...)
FROM records WHERE ...
GROUP BY data->>'{groupByColumn}', data->>'{stackByColumn}'
```

파티션 범위: 해당 워크스페이스의 모든 파티션 records에서 집계.

#### `GET /api/public/dashboards/[slug]` (인증 불필요)
- `isPublic=1` 확인
- 대시보드 + 위젯 목록 + 데이터 반환

### 4.3 SWR 훅

```typescript
// src/hooks/useDashboards.ts
function useDashboards(workspaceId?: number): {
  dashboards: Dashboard[];
  isLoading: boolean;
  createDashboard: (input) => Promise<Result>;
  updateDashboard: (id, input) => Promise<Result>;
  deleteDashboard: (id) => Promise<Result>;
  mutate: KeyedMutator;
}

// src/hooks/useDashboardData.ts
function useDashboardData(dashboardId: number | null): {
  widgetData: Record<number, WidgetData>; // widgetId → data
  isLoading: boolean;
  mutate: KeyedMutator;
}
```

### 4.4 UI 컴포넌트

#### DashboardGrid (`src/components/dashboard/DashboardGrid.tsx`)

react-grid-layout 기반 위젯 그리드:
- 12 컬럼 레이아웃
- 드래그 & 리사이즈 가능 (편집 모드)
- 뷰 모드에서는 static
- 레이아웃 변경 시 500ms 디바운스로 PUT 호출

#### WidgetCard (`src/components/dashboard/WidgetCard.tsx`)

각 위젯 카드:
```
┌─────────────────────────────┐
│ 위젯 제목            [⚙] [✕]│
├─────────────────────────────┤
│                             │
│   [차트 / 스코어카드]       │
│                             │
└─────────────────────────────┘
```

- 헤더: 제목 + 설정(⚙) + 삭제(✕) 버튼 (편집 모드)
- 바디: widgetType에 따라 적절한 차트 렌더링
- 로딩: 스켈레톤 + Loader2 스피너

#### WidgetConfigDialog (`src/components/dashboard/WidgetConfigDialog.tsx`)

위젯 설정 dialog:
```
┌─────────────────────────────────────┐
│ 위젯 설정                           │
│                                     │
│ 제목:    [________________]         │
│ 타입:    [스코어카드     ▼]         │
│ 데이터 컬럼: [매출액     ▼]         │
│ 집계:    [합계(SUM)      ▼]         │
│ 그룹:    [상태           ▼]         │
│ 필터:                               │
│   [+ 필터 추가]                     │
│                                     │
│              [취소] [저장]           │
└─────────────────────────────────────┘
```

- widgetType 선택 시 groupByColumn 필수 여부 동적 변경 (scorecard는 불필요)
- dataColumn: 워크스페이스 fieldDefinitions에서 number 타입 필드 (sum/avg) 또는 모든 필드 (count)
- groupByColumn: select/text 타입 필드

#### 차트 컴포넌트 (`src/components/dashboard/charts/`)

| 파일 | 차트 | Recharts 컴포넌트 |
|------|------|------------------|
| `ScorecardChart.tsx` | 숫자 카드 | 없음 (순수 텍스트) |
| `BarChart.tsx` | 세로/가로 막대 | `BarChart`, `Bar`, `XAxis`, `YAxis` |
| `LineChart.tsx` | 라인 차트 | `LineChart`, `Line`, `XAxis`, `YAxis` |
| `DonutChart.tsx` | 도넛 차트 | `PieChart`, `Pie` (innerRadius) |
| `StackedBarChart.tsx` | 누적 막대 | `BarChart`, `Bar` (stackId) |

모든 차트:
- ShadCN의 `ChartContainer`, `ChartTooltip` 래퍼 사용
- CSS 변수 `--chart-1` ~ `--chart-5` 컬러
- `ResponsiveContainer` 래퍼로 반응형

### 4.5 대시보드 페이지: `src/pages/dashboard.tsx`

```
┌─────────────────────────────────────────────────────┐
│ 대시보드                    [워크스페이스 ▼] [+ 새로]│
├─────────────────────────────────────────────────────┤
│ [대시보드A] [대시보드B] [대시보드C]     ← 탭 전환    │
├─────────────────────────────────────────────────────┤
│ [편집 모드 토글]    [공유 링크] [자동 갱신: 60초 ▼]  │
│                                                     │
│ ┌──────────┐ ┌──────────┐ ┌──────────────────┐     │
│ │ 총 건수   │ │ 매출 합계 │ │ 상태별 분포       │     │
│ │   1,234  │ │ ₩42.5M  │ │ [도넛 차트]       │     │
│ └──────────┘ └──────────┘ └──────────────────┘     │
│ ┌────────────────────────┐ ┌────────────────────┐  │
│ │ 월별 추이              │ │ 담당자별 실적       │  │
│ │ [라인 차트]            │ │ [막대 차트]         │  │
│ └────────────────────────┘ └────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

- 워크스페이스 필터로 대시보드 목록 조회
- 탭으로 대시보드 전환
- 편집 모드: 위젯 드래그/리사이즈/추가/삭제/설정
- 뷰 모드: 읽기 전용, 자동 갱신 (SWR refreshInterval)
- 공유: slug 기반 공개 URL 복사

### 4.6 공개 대시보드: `src/pages/dashboard/[slug].tsx`

- auth 불필요 → 별도 레이아웃
- `isPublic=1` 확인
- 뷰 모드 only (편집 불가)
- 자동 갱신

### 4.7 네비게이션 추가

`src/components/dashboard/sidebar.tsx` navItems에 추가:
```typescript
{ href: "/dashboard", label: "대시보드", icon: LayoutDashboard },
```
홈(`/`) 바로 아래에 배치.

### 4.8 파일 목록

| 유형 | 파일 경로 | 변경 |
|------|----------|------|
| 수정 | `src/lib/db/schema.ts` | dashboards, dashboardWidgets 테이블 + 타입 |
| 신규 | `drizzle/XXXX_dashboards.sql` | 마이그레이션 |
| 신규 | `src/pages/api/dashboards/index.ts` | GET/POST |
| 신규 | `src/pages/api/dashboards/[id].ts` | GET/PUT/DELETE |
| 신규 | `src/pages/api/dashboards/[id]/widgets.ts` | GET/POST/PUT |
| 신규 | `src/pages/api/dashboards/[id]/data.ts` | 집계 API |
| 신규 | `src/pages/api/public/dashboards/[slug].ts` | 공개 대시보드 |
| 신규 | `src/hooks/useDashboards.ts` | SWR 훅 |
| 신규 | `src/hooks/useDashboardData.ts` | 위젯 데이터 훅 |
| 신규 | `src/components/dashboard/DashboardGrid.tsx` | react-grid-layout 그리드 |
| 신규 | `src/components/dashboard/WidgetCard.tsx` | 위젯 카드 |
| 신규 | `src/components/dashboard/WidgetConfigDialog.tsx` | 위젯 설정 |
| 신규 | `src/components/dashboard/charts/ScorecardChart.tsx` | 숫자 카드 |
| 신규 | `src/components/dashboard/charts/BarChart.tsx` | 막대 차트 |
| 신규 | `src/components/dashboard/charts/LineChart.tsx` | 라인 차트 |
| 신규 | `src/components/dashboard/charts/DonutChart.tsx` | 도넛 차트 |
| 신규 | `src/components/dashboard/charts/StackedBarChart.tsx` | 누적 막대 |
| 신규 | `src/pages/dashboard.tsx` | 대시보드 페이지 |
| 신규 | `src/pages/dashboard/[slug].tsx` | 공개 대시보드 |
| 수정 | `src/components/dashboard/sidebar.tsx` | 네비게이션 추가 |

---

## 외부 의존성

```bash
# Feature 3: 웹 폼
pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities nanoid

# Feature 4: 대시보드
pnpm add react-grid-layout recharts
pnpm add -D @types/react-grid-layout
```

## 전체 구현 순서 (세부)

### Phase 1: 배분/라운드로빈 (수정 2 + 신규 2 = 4파일)
1. `src/lib/distribution.ts` — 원자적 할당 함수
2. `src/pages/api/partitions/[id]/records.ts` — POST 수정
3. `src/pages/api/partitions/[id]/index.ts` — PATCH 배분 설정
4. `src/components/partitions/DistributionSettings.tsx` — 설정 UI
5. 빌드 확인

### Phase 2: 실시간 SSE (신규 3 + 수정 3 = 6파일)
1. `src/lib/sse.ts` — 서버 유틸
2. `src/pages/api/sse.ts` — SSE 엔드포인트
3. `src/hooks/useSSE.ts` — 클라이언트 훅
4. `src/pages/api/partitions/[id]/records.ts` — broadcast 추가
5. `src/pages/api/records/[id].ts` — broadcast 추가
6. `src/pages/records.tsx` — useSSE 연동
7. 빌드 확인

### Phase 3: 웹 폼 (신규 10 + 수정 2 = 12파일)
1. `src/lib/db/schema.ts` — webForms, webFormFields
2. `drizzle/XXXX_web_forms.sql` — 마이그레이션
3. `src/pages/api/web-forms/index.ts` + `[id].ts` — CRUD API
4. `src/pages/api/public/forms/[slug].ts` + `submit.ts` — 공개 API
5. `src/hooks/useWebForms.ts` — SWR 훅
6. `src/components/web-forms/FormBuilder.tsx` — 폼 빌더
7. `src/components/web-forms/FormPreview.tsx` — 미리보기
8. `src/components/web-forms/EmbedCodeDialog.tsx` — 임베드
9. `src/pages/web-forms.tsx` — 관리 페이지
10. `src/pages/f/[slug].tsx` — 공개 폼
11. `src/components/dashboard/sidebar.tsx` — 네비게이션
12. 빌드 확인

### Phase 4: 대시보드 (신규 14 + 수정 2 = 16파일)
1. `src/lib/db/schema.ts` — dashboards, dashboardWidgets
2. `drizzle/XXXX_dashboards.sql` — 마이그레이션
3. `src/pages/api/dashboards/` — CRUD + widgets + data API
4. `src/pages/api/public/dashboards/[slug].ts` — 공개 API
5. `src/hooks/useDashboards.ts` + `useDashboardData.ts` — SWR 훅
6. `src/components/dashboard/charts/` — 5개 차트 컴포넌트
7. `src/components/dashboard/DashboardGrid.tsx` + `WidgetCard.tsx` + `WidgetConfigDialog.tsx`
8. `src/pages/dashboard.tsx` + `dashboard/[slug].tsx`
9. `src/components/dashboard/sidebar.tsx` — 네비게이션
10. 빌드 확인

## 검증
- 각 Phase 완료 후 `pnpm build` 성공
- Phase 3 완료 후 `drizzle-kit push` 실행
- Phase 4 완료 후 `drizzle-kit push` 실행
