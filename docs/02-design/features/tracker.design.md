# Design: 트래커 기능 (Visitor Behavior Tracker)

> Plan 참조: `docs/01-plan/features/tracker.plan.md`

## 0. 설계 원칙 요약

- **추적 대상**: 모든 방문자 (익명 + 식별)
- **데이터 저장**: 별도 테이블 4개 (records 사용 X)
- **리드 연결**: `tracker_visitors.record_id` (FK → records.id, NULLABLE)
- **식별 트리거 3종**: 이메일 클릭 / 폼 제출 / SDK identify
- **UI**: 별도 메뉴 (사이드바에 "트래커" 항목, 파티션 형태로 노출)
- **adion 차용**: `tracker.js` 자동 추적 로직, collect API 패턴
- **adion 변경**: conversion_goals 제거 / sendb records 연결 추가 / `sendb_cid` 처리 추가

---

## 1. DB 스키마 (4개 테이블)

### 1-1. `tracker_sites` (트래커 등록)

```typescript
// src/lib/db/schema.ts
export const trackerSites = pgTable("tracker_sites", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    workspaceId: integer("workspace_id")
        .references(() => workspaces.id, { onDelete: "cascade" })
        .notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    apiKey: varchar("api_key", { length: 64 }).notNull().unique(),
    domains: jsonb("domains").$type<string[]>().notNull().default([]),
    isActive: integer("is_active").default(1).notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
}, (table) => ({
    workspaceUnique: unique().on(table.workspaceId),  // 워크스페이스당 1개
    apiKeyIdx: uniqueIndex("tracker_sites_api_key_idx").on(table.apiKey),
}));

export type TrackerSite = typeof trackerSites.$inferSelect;
```

### 1-2. `tracker_visitors` (방문자, browser 단위)

```typescript
export const trackerVisitors = pgTable("tracker_visitors", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    siteId: integer("site_id")
        .references(() => trackerSites.id, { onDelete: "cascade" })
        .notNull(),
    visitorId: varchar("visitor_id", { length: 64 }).notNull(),

    // 리드 연결 (식별되면 채워짐)
    recordId: integer("record_id"),  // FK는 deferred로 application 단에서 검증

    // 캐싱된 식별 정보 (records에서 join 안 하고도 바로 보이게)
    email: varchar("email", { length: 200 }),
    name: varchar("name", { length: 100 }),
    phone: varchar("phone", { length: 20 }),

    // 시간
    firstSeenAt: timestamptz("first_seen_at").defaultNow().notNull(),
    lastSeenAt: timestamptz("last_seen_at").defaultNow().notNull(),

    // 카운터 (사전 집계로 통계 빠르게)
    totalVisits: integer("total_visits").default(1).notNull(),
    totalPageviews: integer("total_pageviews").default(0).notNull(),
    totalEvents: integer("total_events").default(0).notNull(),

    // 디바이스
    deviceType: varchar("device_type", { length: 20 }),     // desktop|mobile|tablet
    browser: varchar("browser", { length: 50 }),
    os: varchar("os", { length: 50 }),

    // 유입 (최초 + 마지막)
    firstUtmSource: varchar("first_utm_source", { length: 100 }),
    firstUtmMedium: varchar("first_utm_medium", { length: 100 }),
    firstUtmCampaign: varchar("first_utm_campaign", { length: 200 }),
    lastUtmSource: varchar("last_utm_source", { length: 100 }),
    lastUtmMedium: varchar("last_utm_medium", { length: 100 }),
    lastUtmCampaign: varchar("last_utm_campaign", { length: 200 }),
    firstReferrer: text("first_referrer"),
    lastReferrer: text("last_referrer"),

    // 마지막 활동 (UI 노출용)
    lastPage: text("last_page"),
    lastEvent: varchar("last_event", { length: 100 }),
    lastEventAt: timestamptz("last_event_at"),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
}, (table) => ({
    siteVisitorIdx: uniqueIndex("tracker_visitors_site_visitor_idx").on(table.siteId, table.visitorId),
    recordIdIdx: index("tracker_visitors_record_id_idx").on(table.recordId),
    emailIdx: index("tracker_visitors_email_idx").on(table.email),
    siteLastSeenIdx: index("tracker_visitors_site_last_seen_idx").on(table.siteId, table.lastSeenAt),
}));

export type TrackerVisitor = typeof trackerVisitors.$inferSelect;
```

> `recordId` 는 FK constraint 안 검 (deferred). 이유: records 삭제 시 visitor 보존(NULLify) 정책을 application 단에서 결정.

### 1-3. `tracker_sessions` (방문 1회)

```typescript
export const trackerSessions = pgTable("tracker_sessions", {
    id: serial("id").primaryKey(),
    siteId: integer("site_id")
        .references(() => trackerSites.id, { onDelete: "cascade" })
        .notNull(),
    visitorId: integer("visitor_id")  // tracker_visitors.id (FK)
        .references(() => trackerVisitors.id, { onDelete: "cascade" })
        .notNull(),
    sessionKey: varchar("session_key", { length: 64 }).notNull(),

    startedAt: timestamptz("started_at").defaultNow().notNull(),
    endedAt: timestamptz("ended_at"),
    duration: integer("duration"),  // seconds

    landingPage: text("landing_page"),
    exitPage: text("exit_page"),
    pageCount: integer("page_count").default(0).notNull(),

    trafficSource: varchar("traffic_source", { length: 20 }),  // DIRECT|PAID|SOCIAL|EMAIL|ORGANIC|REFERRAL
    referrer: text("referrer"),
    utmSource: varchar("utm_source", { length: 100 }),
    utmMedium: varchar("utm_medium", { length: 100 }),
    utmCampaign: varchar("utm_campaign", { length: 200 }),
    utmTerm: varchar("utm_term", { length: 200 }),
    utmContent: varchar("utm_content", { length: 200 }),
    clickId: varchar("click_id", { length: 64 }),  // sendb_cid (이메일 클릭)

    isFirstVisit: integer("is_first_visit").default(0).notNull(),
}, (table) => ({
    siteSessionKeyIdx: uniqueIndex("tracker_sessions_session_key_idx").on(table.siteId, table.sessionKey),
    visitorIdx: index("tracker_sessions_visitor_idx").on(table.visitorId),
    startedIdx: index("tracker_sessions_started_idx").on(table.siteId, table.startedAt),
    clickIdIdx: index("tracker_sessions_click_id_idx").on(table.clickId),
}));

export type TrackerSession = typeof trackerSessions.$inferSelect;
```

### 1-4. `tracker_events` (시계열 raw 로그)

```typescript
export const trackerEvents = pgTable("tracker_events", {
    id: serial("id").primaryKey(),
    siteId: integer("site_id")
        .references(() => trackerSites.id, { onDelete: "cascade" })
        .notNull(),
    sessionId: integer("session_id")
        .references(() => trackerSessions.id, { onDelete: "cascade" })
        .notNull(),
    visitorId: integer("visitor_id")
        .references(() => trackerVisitors.id, { onDelete: "cascade" })
        .notNull(),

    eventType: varchar("event_type", { length: 30 }).notNull(),  // PAGE_VIEW|CLICK|CUSTOM|PURCHASE
    eventName: varchar("event_name", { length: 100 }),
    pageUrl: text("page_url"),
    pageTitle: text("page_title"),
    properties: jsonb("properties"),
    revenue: numeric("revenue", { precision: 14, scale: 2 }),

    occurredAt: timestamptz("occurred_at").defaultNow().notNull(),
}, (table) => ({
    visitorOccurredIdx: index("tracker_events_visitor_occurred_idx").on(table.visitorId, table.occurredAt),
    siteOccurredIdx: index("tracker_events_site_occurred_idx").on(table.siteId, table.occurredAt),
    typeIdx: index("tracker_events_type_idx").on(table.siteId, table.eventType),
}));

export type TrackerEvent = typeof trackerEvents.$inferSelect;
```

### 1-5. emailClickLogs에 click_id 추가

```typescript
// 기존 schema.ts:646 emailClickLogs에 컬럼 추가
clickId: varchar("click_id", { length: 64 }).unique(),
```

이 `clickId`가 트래커의 `sendb_cid` 와 매칭되는 토큰. nanoid로 발급.

### 1-6. 마이그레이션 SQL: `0043_tracker.sql`

```sql
-- 1) tracker_sites
CREATE TABLE IF NOT EXISTS "tracker_sites" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "name" varchar(200) NOT NULL,
    "api_key" varchar(64) NOT NULL UNIQUE,
    "domains" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "is_active" integer NOT NULL DEFAULT 1,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    UNIQUE ("workspace_id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "tracker_sites_api_key_idx" ON "tracker_sites" ("api_key");

-- 2) tracker_visitors
CREATE TABLE IF NOT EXISTS "tracker_visitors" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "site_id" integer NOT NULL REFERENCES "tracker_sites"("id") ON DELETE CASCADE,
    "visitor_id" varchar(64) NOT NULL,
    "record_id" integer,  -- soft FK
    "email" varchar(200),
    "name" varchar(100),
    "phone" varchar(20),
    "first_seen_at" timestamptz NOT NULL DEFAULT now(),
    "last_seen_at" timestamptz NOT NULL DEFAULT now(),
    "total_visits" integer NOT NULL DEFAULT 1,
    "total_pageviews" integer NOT NULL DEFAULT 0,
    "total_events" integer NOT NULL DEFAULT 0,
    "device_type" varchar(20),
    "browser" varchar(50),
    "os" varchar(50),
    "first_utm_source" varchar(100),
    "first_utm_medium" varchar(100),
    "first_utm_campaign" varchar(200),
    "last_utm_source" varchar(100),
    "last_utm_medium" varchar(100),
    "last_utm_campaign" varchar(200),
    "first_referrer" text,
    "last_referrer" text,
    "last_page" text,
    "last_event" varchar(100),
    "last_event_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "tracker_visitors_site_visitor_idx"
    ON "tracker_visitors" ("site_id", "visitor_id");
CREATE INDEX IF NOT EXISTS "tracker_visitors_record_id_idx"
    ON "tracker_visitors" ("record_id");
CREATE INDEX IF NOT EXISTS "tracker_visitors_email_idx"
    ON "tracker_visitors" ("email");
CREATE INDEX IF NOT EXISTS "tracker_visitors_site_last_seen_idx"
    ON "tracker_visitors" ("site_id", "last_seen_at" DESC);

-- 3) tracker_sessions
CREATE TABLE IF NOT EXISTS "tracker_sessions" (
    "id" serial PRIMARY KEY,
    "site_id" integer NOT NULL REFERENCES "tracker_sites"("id") ON DELETE CASCADE,
    "visitor_id" integer NOT NULL REFERENCES "tracker_visitors"("id") ON DELETE CASCADE,
    "session_key" varchar(64) NOT NULL,
    "started_at" timestamptz NOT NULL DEFAULT now(),
    "ended_at" timestamptz,
    "duration" integer,
    "landing_page" text,
    "exit_page" text,
    "page_count" integer NOT NULL DEFAULT 0,
    "traffic_source" varchar(20),
    "referrer" text,
    "utm_source" varchar(100),
    "utm_medium" varchar(100),
    "utm_campaign" varchar(200),
    "utm_term" varchar(200),
    "utm_content" varchar(200),
    "click_id" varchar(64),
    "is_first_visit" integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS "tracker_sessions_session_key_idx"
    ON "tracker_sessions" ("site_id", "session_key");
CREATE INDEX IF NOT EXISTS "tracker_sessions_visitor_idx"
    ON "tracker_sessions" ("visitor_id");
CREATE INDEX IF NOT EXISTS "tracker_sessions_started_idx"
    ON "tracker_sessions" ("site_id", "started_at" DESC);
CREATE INDEX IF NOT EXISTS "tracker_sessions_click_id_idx"
    ON "tracker_sessions" ("click_id");

-- 4) tracker_events
CREATE TABLE IF NOT EXISTS "tracker_events" (
    "id" serial PRIMARY KEY,
    "site_id" integer NOT NULL REFERENCES "tracker_sites"("id") ON DELETE CASCADE,
    "session_id" integer NOT NULL REFERENCES "tracker_sessions"("id") ON DELETE CASCADE,
    "visitor_id" integer NOT NULL REFERENCES "tracker_visitors"("id") ON DELETE CASCADE,
    "event_type" varchar(30) NOT NULL,
    "event_name" varchar(100),
    "page_url" text,
    "page_title" text,
    "properties" jsonb,
    "revenue" numeric(14, 2),
    "occurred_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "tracker_events_visitor_occurred_idx"
    ON "tracker_events" ("visitor_id", "occurred_at" DESC);
CREATE INDEX IF NOT EXISTS "tracker_events_site_occurred_idx"
    ON "tracker_events" ("site_id", "occurred_at" DESC);
CREATE INDEX IF NOT EXISTS "tracker_events_type_idx"
    ON "tracker_events" ("site_id", "event_type");

-- 5) emailClickLogs에 click_id 컬럼 추가
ALTER TABLE "email_click_logs"
    ADD COLUMN IF NOT EXISTS "click_id" varchar(64) UNIQUE;
CREATE INDEX IF NOT EXISTS "email_click_logs_click_id_idx"
    ON "email_click_logs" ("click_id");
```

---

## 2. API 스펙

### 2-1. `POST /api/tracker/collect` (이벤트 수집, public)

**Request**:
```http
POST /api/tracker/collect?key={apiKey}
Content-Type: application/json
Origin: https://customer-site.com

{
  "visitor_id": "vis_abc123",
  "session_key": "ses_xyz789",
  "click_id": "clk_xxx",   // optional, sendb_cid (URL에서 발견된 경우)
  "event": {
    "type": "PAGE_VIEW" | "CUSTOM" | "PURCHASE",
    "name": "signup_completed",
    "page_url": "https://...",
    "page_title": "...",
    "properties": { ... }
  },
  "session": {  // 세션 시작 시 1회
    "landing_page": "...",
    "referrer": "...",
    "traffic_source": "PAID",
    "utm_source": "...",
    "utm_medium": "...",
    "utm_campaign": "...",
    "utm_term": "...",
    "utm_content": "..."
  },
  "device": { "type": "desktop", "browser": "Chrome", "os": "macOS" }
}
```

**처리 흐름**:
```
1. apiKey로 tracker_sites 조회 (is_active=1)
2. Origin → site.domains 매칭
3. payload size 10KB 검증
4. rate limit (분당 200 by apiKey)
5. visitor UPSERT (site_id + visitor_id 기준)
   - 없으면 INSERT
   - 있으면 last_seen_at, last_*, total_* 갱신
6. (있으면) click_id로 emailClickLogs → emailSendLogs.recordId 조회
   → visitor.record_id NULL이면 채움 + email/name도 채움
7. session UPSERT (site_id + session_key 기준)
   - 없으면 INSERT (is_first_visit 판정)
   - 있으면 ended_at, page_count++, exit_page 갱신
8. event INSERT (HEARTBEAT/SESSION_END는 session 갱신만, event 저장 X)
9. visitor.total_pageviews/total_events 카운터 증가
10. 200 OK
```

**Response**:
```json
{ "ok": true, "visitor_id": 123, "record_id": 42 }
```

**에러**:
- 401: invalid apiKey
- 403: origin not allowed
- 400: invalid payload
- 413: payload too large
- 429: rate limit

### 2-2. `OPTIONS /api/tracker/collect` (CORS preflight)

표준 CORS 응답.

### 2-3. `POST /api/tracker/sites` (트래커 생성, withAuth)

**Request**:
```json
{ "name": "Main Site", "domains": ["example.com"] }
```

**Response**:
```json
{
  "success": true,
  "data": {
    "id": 1,
    "apiKey": "ak_...",
    "embedScript": "<script ...></script>"
  }
}
```

### 2-4. `GET /api/tracker/sites/:id`, `PATCH`, `DELETE`

표준 CRUD. PATCH로 도메인 추가/제거.

### 2-5. `GET /api/tracker/visitors`

**Query Params**:
- `siteId` (required)
- `cursor` (pagination)
- `q` (이메일/이름 검색)
- `hasRecord` (true/false): 식별 여부 필터

**Response**:
```json
{
  "data": [
    {
      "id": 1,
      "visitorId": "abc",
      "recordId": 42,
      "email": "alice@...",
      "name": "Alice",
      "totalVisits": 5,
      "lastSeenAt": "...",
      "deviceType": "desktop",
      "lastUtmSource": "google"
    }
  ],
  "nextCursor": "..."
}
```

### 2-6. `GET /api/tracker/visitors/:id`

visitor 1명 + 최근 sessions/events 페이지네이션 포함.

### 2-7. `GET /api/records/:id/visitor-activity` ⭐ (리드 상세화면용)

**Query**:
```
GET /api/records/42/visitor-activity?eventLimit=10
```

**처리**:
```sql
-- 1. record_id로 연결된 visitor들 (다중 디바이스)
SELECT * FROM tracker_visitors WHERE record_id = 42;

-- 2. 집계
SELECT
  SUM(total_visits) as total_visits,
  SUM(total_pageviews) as total_pageviews,
  MIN(first_seen_at) as first_seen,
  MAX(last_seen_at) as last_seen,
  COUNT(*) as device_count
FROM tracker_visitors WHERE record_id = 42;

-- 3. 최근 이벤트 (모든 visitor 합쳐서 시간순)
SELECT e.*
FROM tracker_events e
WHERE e.visitor_id IN (SELECT id FROM tracker_visitors WHERE record_id = 42)
ORDER BY e.occurred_at DESC
LIMIT 10;
```

**Response**:
```json
{
  "summary": {
    "totalVisits": 8,
    "totalPageviews": 45,
    "deviceCount": 2,
    "firstSeen": "2026-04-15T...",
    "lastSeen": "2026-05-06T...",
    "devices": [
      { "type": "desktop", "browser": "Chrome", "lastSeen": "..." },
      { "type": "mobile", "browser": "Safari", "lastSeen": "..." }
    ]
  },
  "recentEvents": [
    {
      "id": 1234,
      "type": "PAGE_VIEW",
      "name": null,
      "pageUrl": "/pricing",
      "occurredAt": "2026-05-06T14:25:00Z"
    }
  ]
}
```

### 2-8. `POST /api/tracker/identify` (SDK용 endpoint)

`sendb.identify({ email, userId, name })` 호출 시 사용.

**Request**:
```json
{
  "apiKey": "...",
  "visitor_id": "abc",
  "email": "alice@example.com",
  "user_id": "u_99",
  "name": "Alice"
}
```

**처리**:
```
1. apiKey로 site 조회
2. visitor 조회 (visitor_id로)
3. 이메일로 records 조회
   - 있으면 → visitor.record_id = 그 record.id
   - 없으면 → 정책에 따라:
     a. 새 record 생성 후 연결 (옵션, 기본 OFF)
     b. visitor에 email/name만 채우고 record_id NULL 유지 (기본)
4. visitor.email/name UPDATE
```

**옵션 (Site별 설정)**:
- `auto_create_record_on_identify`: true면 4-a, false면 4-b (기본 false)

### 2-9. 폼 제출 시 visitor_id 처리

기존 `POST /api/public/forms/[slug]/submit` 확장:

```typescript
// req.body 추가
{
  data: { ... },
  visitor_id?: string  // 신규
}
```

**처리 추가**:
```
... 기존 record 생성 ...

if (visitor_id && form.workspaceId 트래커 사이트 존재) {
    UPDATE tracker_visitors
    SET record_id = newRecord.id,
        email = recordData.email ?? email,
        name = recordData.name ?? name
    WHERE site_id = trackerSite.id AND visitor_id = $1;
}
```

폼 HTML에는 자동으로 hidden input 추가:
```html
<input type="hidden" name="visitor_id" id="sendb_visitor_id" />
<script>
  // 페이지 로드 시 tracker.js의 visitor_id를 hidden에 채움
  if (window.sendb) {
    document.getElementById("sendb_visitor_id").value = window.sendb.getVisitorId();
  }
</script>
```

---

## 3. tracker.js (`/public/tracker.js`)

adion 코드를 가져와 변형. 핵심 차이:

### 3-1. 공개 API (window.sendb)

```js
window.sendb = {
    track: function (eventName, properties) {
        sendEvent({
            type: "CUSTOM",
            name: eventName,
            page_url: location.href,
            page_title: document.title,
            properties: properties || null,
        });
    },

    identify: function (options) {
        var props = {};
        if (typeof options === "string") {
            props.email = options;
        } else if (options && typeof options === "object") {
            if (options.email) props.email = options.email;
            if (options.userId) props.user_id = options.userId;
            if (options.name) props.name = options.name;
            if (options.phone) props.phone = options.phone;
        }
        // identify는 별도 endpoint
        sendIdentify(props);
    },

    trackPurchase: function (revenue, properties) {
        sendEvent({
            type: "PURCHASE",
            name: "purchase",
            revenue: revenue,
            page_url: location.href,
            properties: properties || null,
        });
    },

    getVisitorId: function () {
        return getVisitorId();
    },
};
```

### 3-2. click_id 처리 (추가)

```js
function getClickId() {
    var sp = new URLSearchParams(location.search);
    var fromUrl = sp.get("sendb_cid");

    if (fromUrl) {
        try {
            localStorage.setItem("sendb_cid", fromUrl);
            localStorage.setItem("sendb_cid_ts", String(Date.now()));
        } catch (e) {}
        return fromUrl;
    }

    try {
        var stored = localStorage.getItem("sendb_cid");
        var ts = parseInt(localStorage.getItem("sendb_cid_ts") || "0", 10);
        // 30일 만료 (이메일 캠페인 사이클 고려)
        if (stored && Date.now() - ts < 30 * 24 * 60 * 60 * 1000) {
            return stored;
        }
    } catch (e) {}

    return null;
}
```

### 3-3. 변경 요약 (adion 대비 diff)

| 항목 | adion | sendb |
|---|---|---|
| 추적 게이트 | `if (!clickId) return` (이메일 클릭자만) | **모든 방문자 추적** ⭐ |
| Storage prefix | `adion_*` | `sendb_*` |
| API endpoint | `/api/tracker/collect` | 동일 |
| identify | `__identify` 특수 이벤트 | **별도 endpoint `/api/tracker/identify`** |
| 광고 파라미터 | gclid/fbclid/네이버 등 풍부 | 표준 utm_* + sendb_cid만 (Phase 1) |
| Public API | `window.adion` | `window.sendb` |
| 클릭 룰 | 3-tier 지원 | Phase 1 미지원 (Phase 4) |
| Conversion goal | 있음 | 제거 |

### 3-4. init 흐름 (sendb 버전)

```js
function init() {
    // config 파싱
    var scripts = document.getElementsByTagName("script");
    for (var i = 0; i < scripts.length; i++) {
        var s = scripts[i];
        if (s.getAttribute("data-api-key")) {
            config.apiKey = s.getAttribute("data-api-key") || "";
            config.endpoint = s.getAttribute("data-endpoint") || "";
            break;
        }
    }
    if (!config.apiKey) return;

    // click_id 잡되, 없어도 추적은 진행
    config.clickId = getClickId();

    getVisitorId();
    getSessionKey();
    trackPageView();
    setupSpaTracking();
    setupHeartbeat();
}
```

---

## 4. 이메일 발송 측 변경 (`sendb_cid` 부착)

### 4-1. emailClickLogs.click_id 발급

```ts
// src/lib/email-click-tracking.ts
import { nanoid } from "nanoid";

export async function recordClick(
    sendLogId: number,
    url: string,
    ip?: string,
    userAgent?: string,
): Promise<{ logId: number; clickId: string } | null> {
    const [log] = await db.select({ orgId: emailSendLogs.orgId })
        .from(emailSendLogs)
        .where(eq(emailSendLogs.id, sendLogId))
        .limit(1);
    if (!log) return null;

    const clickId = `clk_${nanoid(21)}`;
    const [inserted] = await db.insert(emailClickLogs).values({
        orgId: log.orgId,
        sendLogId,
        url,
        clickId,
        ip: ip || null,
        userAgent: userAgent || null,
    }).returning({ id: emailClickLogs.id });

    return { logId: inserted.id, clickId };
}
```

### 4-2. `/api/track/click` 라우트에서 sendb_cid 부착

```ts
// 기존 라우트에서 redirect 직전에:
const result = await recordClick(sendLogId, url, ip, userAgent);
if (!result) return NextResponse.redirect(targetUrl);

const redirectUrl = new URL(targetUrl);
redirectUrl.searchParams.set("sendb_cid", result.clickId);

return NextResponse.redirect(redirectUrl.toString());
```

→ alice가 메일 클릭하면 도착지 URL에 `?sendb_cid=clk_xxx` 가 자동 부착됨.

---

## 5. 핵심 collect 로직 (의사 코드)

```ts
// src/app/api/tracker/collect/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { trackerSites, trackerVisitors, trackerSessions, trackerEvents, emailClickLogs, emailSendLogs } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { collectEventSchema } from "@/lib/validations";
import { rateLimit } from "@/lib/rate-limit";

function corsHeaders(origin: string) {
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
        "Access-Control-Max-Age": "86400",
    };
}

function matchesDomain(origin: string, domains: string[]): boolean {
    if (!origin) return true;
    try {
        const host = new URL(origin).hostname;
        return domains.some(d => host === d || host === `www.${d}` || `www.${host}` === d);
    } catch { return false; }
}

export async function OPTIONS(req: NextRequest) {
    const origin = req.headers.get("origin") || "*";
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(req: NextRequest) {
    const origin = req.headers.get("origin") || "";
    const apiKey = req.headers.get("x-api-key") || req.nextUrl.searchParams.get("key") || "";

    if (!apiKey) return cors(401, { error: "API key required" }, origin);

    const { allowed } = rateLimit(`tracker:${apiKey}`, { maxRequests: 200, windowMs: 60_000 });
    if (!allowed) return cors(429, { error: "Too many requests" }, origin);

    const site = await db.query.trackerSites.findFirst({
        where: and(eq(trackerSites.apiKey, apiKey), eq(trackerSites.isActive, 1)),
    });
    if (!site) return cors(401, { error: "Invalid API key" }, origin);

    if (origin && !matchesDomain(origin, site.domains)) {
        return cors(403, { error: "Origin not allowed" }, origin);
    }

    const cl = req.headers.get("content-length");
    if (cl && parseInt(cl) > 10240) return cors(413, { error: "Payload too large" }, origin);

    const body = await req.json().catch(() => null);
    const parsed = collectEventSchema.safeParse(body);
    if (!parsed.success) return cors(400, { error: "Invalid payload" }, origin);

    const { visitor_id, session_key, click_id, event, session, device } = parsed.data;

    try {
        const result = await db.transaction(async (tx) => {
            // 1. visitor UPSERT
            const visitor = await upsertVisitor(tx, site, visitor_id, click_id, device, session);

            // 2. session UPSERT
            const trackerSession = await upsertSession(tx, site, visitor.id, session_key, session, click_id);

            // 3. HEARTBEAT/SESSION_END는 session 갱신만
            if (event.type === "HEARTBEAT" || event.type === "SESSION_END") {
                return { visitor, trackerSession };
            }

            // 4. event INSERT
            await tx.insert(trackerEvents).values({
                siteId: site.id,
                sessionId: trackerSession.id,
                visitorId: visitor.id,
                eventType: event.type,
                eventName: event.name || null,
                pageUrl: event.page_url || null,
                pageTitle: event.page_title || null,
                properties: event.properties || null,
                revenue: event.revenue ? String(event.revenue) : null,
            });

            // 5. visitor 카운터/마지막 활동 갱신
            await tx.update(trackerVisitors)
                .set({
                    lastSeenAt: new Date(),
                    lastPage: event.page_url ?? visitor.lastPage,
                    lastEvent: event.type === "CUSTOM" ? event.name : event.type,
                    lastEventAt: new Date(),
                    totalPageviews: event.type === "PAGE_VIEW" ? sql`${trackerVisitors.totalPageviews} + 1` : trackerVisitors.totalPageviews,
                    totalEvents: sql`${trackerVisitors.totalEvents} + 1`,
                })
                .where(eq(trackerVisitors.id, visitor.id));

            return { visitor, trackerSession };
        });

        return cors(200, {
            ok: true,
            visitor_id: result.visitor.id,
            record_id: result.visitor.recordId
        }, origin);
    } catch (err) {
        console.error("Tracker collect error:", err);
        return cors(500, { error: "Internal error" }, origin);
    }
}

function cors(status: number, body: any, origin: string) {
    return NextResponse.json(body, { status, headers: corsHeaders(origin || "*") });
}
```

### 5-1. upsertVisitor 헬퍼

```ts
async function upsertVisitor(tx, site, visitor_id, click_id, device, session) {
    let visitor = await tx.query.trackerVisitors.findFirst({
        where: and(
            eq(trackerVisitors.siteId, site.id),
            eq(trackerVisitors.visitorId, visitor_id),
        ),
    });

    if (!visitor) {
        // INSERT
        const [created] = await tx.insert(trackerVisitors).values({
            orgId: site.orgId,
            siteId: site.id,
            visitorId: visitor_id,
            deviceType: device?.type ?? null,
            browser: device?.browser ?? null,
            os: device?.os ?? null,
            firstUtmSource: session?.utm_source ?? null,
            firstUtmMedium: session?.utm_medium ?? null,
            firstUtmCampaign: session?.utm_campaign ?? null,
            lastUtmSource: session?.utm_source ?? null,
            lastUtmMedium: session?.utm_medium ?? null,
            lastUtmCampaign: session?.utm_campaign ?? null,
            firstReferrer: session?.referrer ?? null,
            lastReferrer: session?.referrer ?? null,
        }).returning();
        visitor = created;
    } else {
        // UPDATE last_*
        if (session?.utm_source) {
            await tx.update(trackerVisitors).set({
                lastSeenAt: new Date(),
                lastUtmSource: session.utm_source,
                lastUtmMedium: session.utm_medium ?? null,
                lastUtmCampaign: session.utm_campaign ?? null,
                lastReferrer: session.referrer ?? null,
            }).where(eq(trackerVisitors.id, visitor.id));
        }
    }

    // click_id가 있고 visitor.recordId가 NULL이면 → 자동 매칭
    if (click_id && !visitor.recordId) {
        const clickLog = await tx.query.emailClickLogs.findFirst({
            where: eq(emailClickLogs.clickId, click_id),
            with: { sendLog: true },  // join emailSendLogs
        });
        if (clickLog?.sendLog?.recordId) {
            const recordId = clickLog.sendLog.recordId;
            const recipientEmail = clickLog.sendLog.recipientEmail;

            await tx.update(trackerVisitors).set({
                recordId,
                email: visitor.email ?? recipientEmail,
            }).where(eq(trackerVisitors.id, visitor.id));

            visitor.recordId = recordId;
            visitor.email = visitor.email ?? recipientEmail;
        }
    }

    return visitor;
}
```

### 5-2. upsertSession 헬퍼

```ts
async function upsertSession(tx, site, visitorPk, session_key, session, click_id) {
    let trackerSession = await tx.query.trackerSessions.findFirst({
        where: and(
            eq(trackerSessions.siteId, site.id),
            eq(trackerSessions.sessionKey, session_key),
        ),
    });

    if (!trackerSession) {
        // 첫 세션인지 판정
        const [{ count }] = await tx.select({ count: sql<number>`COUNT(*)::integer` })
            .from(trackerSessions)
            .where(and(
                eq(trackerSessions.siteId, site.id),
                eq(trackerSessions.visitorId, visitorPk),
            ));

        const [created] = await tx.insert(trackerSessions).values({
            siteId: site.id,
            visitorId: visitorPk,
            sessionKey: session_key,
            landingPage: session?.landing_page ?? null,
            trafficSource: session?.traffic_source ?? null,
            referrer: session?.referrer ?? null,
            utmSource: session?.utm_source ?? null,
            utmMedium: session?.utm_medium ?? null,
            utmCampaign: session?.utm_campaign ?? null,
            utmTerm: session?.utm_term ?? null,
            utmContent: session?.utm_content ?? null,
            clickId: click_id ?? null,
            isFirstVisit: count === 0 ? 1 : 0,
        }).returning();
        trackerSession = created;

        // 새 세션이면 visitor.totalVisits +1
        await tx.update(trackerVisitors)
            .set({ totalVisits: sql`${trackerVisitors.totalVisits} + 1` })
            .where(eq(trackerVisitors.id, visitorPk));
    } else {
        // 기존 session: ended_at 갱신, page_count++
        await tx.execute(sql`
            UPDATE tracker_sessions
            SET ended_at = NOW(),
                duration = EXTRACT(EPOCH FROM (NOW() - started_at))::integer,
                page_count = page_count + CASE WHEN $1 = 'PAGE_VIEW' THEN 1 ELSE 0 END,
                exit_page = COALESCE($2, exit_page)
            WHERE id = ${trackerSession.id}
        `, [session?._eventType ?? "OTHER", session?._pageUrl ?? null]);
    }

    return trackerSession;
}
```

---

## 6. 식별 흐름 통합

### 6-1. 케이스 1: 이메일 클릭 → 자동 매칭

이미 위 collect 로직에 포함됨. visitor.recordId가 NULL이고 click_id가 들어오면 자동 채움.

### 6-2. 케이스 2: 폼 제출

`POST /api/public/forms/[slug]/submit` 확장:

```ts
// 기존 트랜잭션 끝에 추가:
if (visitor_id) {
    const site = await tx.query.trackerSites.findFirst({
        where: eq(trackerSites.workspaceId, form.workspaceId),
    });
    if (site) {
        await tx.update(trackerVisitors).set({
            recordId: newRecord.id,
            email: (recordData.email as string) ?? trackerVisitors.email,
            name: (recordData.name as string) ?? trackerVisitors.name,
            phone: (recordData.phone as string) ?? trackerVisitors.phone,
        }).where(and(
            eq(trackerVisitors.siteId, site.id),
            eq(trackerVisitors.visitorId, visitor_id),
        ));
    }
}
```

폼 페이지 (`/f/[slug]`)에 hidden visitor_id input 추가:

```tsx
<input type="hidden" name="visitor_id" id="sendb_visitor_id" value="" />
<script dangerouslySetInnerHTML={{ __html: `
    (function(){
        var setId = function(){
            if (window.sendb && window.sendb.getVisitorId) {
                document.getElementById('sendb_visitor_id').value = window.sendb.getVisitorId();
            }
        };
        if (document.readyState === 'complete') setId();
        else window.addEventListener('load', setId);
    })();
` }} />
```

### 6-3. 케이스 3: SDK identify

`POST /api/tracker/identify`:

```ts
export async function POST(req: NextRequest) {
    const origin = req.headers.get("origin") || "";
    const apiKey = req.nextUrl.searchParams.get("key") || req.headers.get("x-api-key") || "";

    // ... apiKey/origin 검증 동일 ...

    const { visitor_id, email, user_id, name, phone } = await req.json();

    const visitor = await db.query.trackerVisitors.findFirst({
        where: and(
            eq(trackerVisitors.siteId, site.id),
            eq(trackerVisitors.visitorId, visitor_id),
        ),
    });
    if (!visitor) return cors(404, { error: "Visitor not found" }, origin);

    // 이메일로 records 조회 (같은 워크스페이스 안에서)
    let recordId = visitor.recordId;
    if (email && !recordId) {
        const matchedRecord = await db.execute(sql`
            SELECT id FROM records
            WHERE workspace_id = ${site.workspaceId}
              AND data->>'email' = ${email}
            LIMIT 1
        `);
        if (matchedRecord.rows[0]) {
            recordId = (matchedRecord.rows[0] as any).id;
        }
        // (옵션) 자동 record 생성 — 기본 OFF
    }

    await db.update(trackerVisitors).set({
        recordId,
        email: email ?? visitor.email,
        name: name ?? visitor.name,
        phone: phone ?? visitor.phone,
    }).where(eq(trackerVisitors.id, visitor.id));

    return cors(200, { ok: true, record_id: recordId }, origin);
}
```

---

## 7. UI 설계

### 7-1. 라우트
- `/settings/workspace/tracker` — 트래커 등록/관리
- `/tracker` — 트래커 메인 (visitor 목록)
- `/tracker/visitors/[id]` — visitor 상세 (행동 타임라인)
- 기존 `/records/[id]` 또는 record 상세 패널 → "행동 정보" 섹션 추가

### 7-2. 사이드바 추가

기존 사이드바에 트래커 항목 추가. partitions 시스템 침투 X. 별도 메뉴 그룹:

```tsx
// src/components/layout/Sidebar.tsx (기존) + 트래커 섹션 추가
<SidebarSection title="트래커">
  <NavLink to="/tracker">📊 방문자</NavLink>
</SidebarSection>
```

> 첫 단계엔 "방문자" 1개만. 나중에 "이벤트", "퍼널" 등 추가 가능.

### 7-3. 트래커 등록 (워크스페이스 설정)

```
┌─ 트래커 ────────────────────────────────┐
│ [트래커 없음]                            │
│ ┌────────────────────────────────────┐ │
│ │ 트래커 시작하기                      │ │
│ │                                    │ │
│ │ 이름:    [메인 사이트         ]    │ │
│ │ 도메인:  [example.com         ] +  │ │
│ │                                    │ │
│ │       [트래커 만들기]               │ │
│ └────────────────────────────────────┘ │
└────────────────────────────────────────┘

┌─ 트래커 ────────────────────────────────┐
│ [메인 사이트]                            │
│                                         │
│ 1) head 스크립트                         │
│ <script src="..." data-api-key="..."   │
│         defer></script>          [복사] │
│                                         │
│ 2) 도메인                                │
│ • example.com  [편집]                   │
│ • www.example.com  [삭제]               │
│ [+ 도메인 추가]                          │
│                                         │
│ 3) 설치 검증                             │
│ [지금 검증하기]   (Phase 3)              │
└─────────────────────────────────────────┘
```

### 7-4. visitor 목록 화면 (`/tracker`)

```
┌─ 방문자 ────────────────────────────────────────────┐
│ [검색: 이메일/이름]  [필터: 식별됨 ✓ 미식별 ✓]      │
│                                                    │
│ 이메일/visitor_id   방문   마지막방문   디바이스  유입   리드 │
│ alice@example.com   5     5/6 14:25   desktop  google [보기→] │
│ unknown (vis_abc)   2     5/5 11:00   mobile   meta   [-]    │
│ bob@example.com     3     5/4 09:00   desktop  direct [보기→] │
│ ...                                                │
│ [더 보기]                                            │
└────────────────────────────────────────────────────┘
```

### 7-5. visitor 상세 (`/tracker/visitors/[id]`)

```
┌─ alice@example.com 상세 ─────────────────────────┐
│ visitor_id: abc                                  │
│ 연결된 리드: alice ([records로 이동])              │
│ 방문 5회 / 페이지뷰 27건 / 이벤트 3건              │
│ 디바이스: desktop (Chrome / macOS)                │
│                                                  │
│ [세션 목록]                                       │
│ • 5/6 14:20 ~ 14:30 (10분, 7페이지)               │
│   유입: google / utm_campaign=may                │
│ • 5/5 11:00 ~ 11:15 (15분, 12페이지)              │
│ ...                                              │
│                                                  │
│ [이벤트 타임라인 - 최근 50건]                      │
│ 5/6 14:25 page_view /pricing                     │
│ 5/6 14:23 custom signup_completed                │
│ 5/6 14:20 page_view /                            │
│ ...                                              │
└──────────────────────────────────────────────────┘
```

### 7-6. 리드 record 상세 → 행동 정보 패널 ⭐

기존 record 상세 화면(레코드 상세 페이지/모달)에 새 섹션 추가:

```tsx
// src/components/records/detail/RecordVisitorActivity.tsx (신규)
function RecordVisitorActivity({ recordId }: { recordId: number }) {
  const { data, isLoading } = useSWR(
    `/api/records/${recordId}/visitor-activity`,
    fetcher
  );

  if (isLoading) return <Skeleton />;
  if (!data?.summary || data.summary.deviceCount === 0) {
    return <EmptyState message="아직 사이트 방문 기록이 없습니다" />;
  }

  return (
    <Card title="행동 정보">
      <div>방문 {summary.totalVisits}회 / 페이지뷰 {summary.totalPageviews}건</div>
      <div>디바이스 {summary.deviceCount}개로 추적 중</div>
      <Timeline events={data.recentEvents} />
      <Link to={`/tracker?recordId=${recordId}`}>전체 행동 보기 →</Link>
    </Card>
  );
}
```

### 7-7. 컴포넌트 구조 (feature-based, CLAUDE.md 규칙)

```
src/components/tracker/
├── ui/
│   ├── TrackerSettingsPage.tsx       # /settings/workspace/tracker
│   ├── TrackerSetupForm.tsx           # 트래커 없을 때 셋업 폼
│   ├── TrackerEmbedScriptCard.tsx
│   ├── TrackerDomainList.tsx
│   ├── VisitorListPage.tsx            # /tracker
│   ├── VisitorListTable.tsx
│   ├── VisitorDetailPage.tsx          # /tracker/visitors/[id]
│   ├── VisitorEventTimeline.tsx
│   └── RecordVisitorActivity.tsx      # 리드 상세에 임베드되는 패널
├── hooks/
│   ├── useTrackerSite.ts
│   ├── useTrackerVisitors.ts
│   ├── useTrackerVisitor.ts
│   └── useRecordVisitorActivity.ts
├── api/
│   ├── trackerSites.ts
│   ├── trackerVisitors.ts
│   └── visitorActivity.ts
├── types/
│   └── index.ts
└── utils/
    └── embedScript.ts
```

---

## 8. 보안 / 검증

### 8-1. CORS
- preflight: `OPTIONS /api/tracker/collect`, `/api/tracker/identify`
- 응답: `Access-Control-Allow-Origin: <origin>`

### 8-2. matchesDomain
adion 로직 차용. site.domains 배열에 등록된 도메인만 허용.

### 8-3. Rate limit
- collect: 분당 200 (apiKey 기준)
- identify: 분당 50 (apiKey 기준)

### 8-4. click_id 위변조
- collect/identify 양쪽에서 emailClickLogs 실제 존재 검증
- 없는 click_id면 무시 (recordId 매칭 X), 단 visitor 자체는 익명으로 추적 진행

### 8-5. PII
- IP 주소 저장 X
- userAgent는 device 파싱 후 raw 버림

---

## 9. zod 검증 스키마 (`src/lib/validations.ts`)

```ts
export const collectEventSchema = z.object({
    visitor_id: z.string().min(1).max(64),
    session_key: z.string().min(1).max(64),
    click_id: z.string().max(64).optional().nullable(),
    event: z.object({
        type: z.enum(["PAGE_VIEW", "CUSTOM", "PURCHASE", "HEARTBEAT", "SESSION_END", "CLICK"]),
        name: z.string().max(100).optional().nullable(),
        page_url: z.string().max(2000).optional().nullable(),
        page_title: z.string().max(500).optional().nullable(),
        properties: z.record(z.unknown()).optional().nullable(),
        revenue: z.number().optional().nullable(),
    }),
    session: z.object({
        landing_page: z.string().max(2000).optional().nullable(),
        traffic_source: z.string().max(20).optional().nullable(),
        referrer: z.string().max(2000).optional().nullable(),
        utm_source: z.string().max(100).optional().nullable(),
        utm_medium: z.string().max(100).optional().nullable(),
        utm_campaign: z.string().max(200).optional().nullable(),
        utm_term: z.string().max(200).optional().nullable(),
        utm_content: z.string().max(200).optional().nullable(),
    }).optional(),
    device: z.object({
        type: z.enum(["desktop", "mobile", "tablet"]).optional(),
        browser: z.string().max(50).optional(),
        os: z.string().max(50).optional(),
    }).optional(),
});

export const identifySchema = z.object({
    visitor_id: z.string().min(1).max(64),
    email: z.string().email().max(200).optional(),
    user_id: z.string().max(100).optional(),
    name: z.string().max(100).optional(),
    phone: z.string().max(20).optional(),
}).refine(d => d.email || d.user_id, { message: "email 또는 user_id 필요" });
```

---

## 10. 테스트 시나리오

### 10-1. 정상 흐름 (메타광고 시나리오)
1. 트래커 생성, head 스크립트 로컬 sample 페이지에 심기
2. 시크릿 모드로 `?utm_source=meta&utm_campaign=test` 붙여 방문
   → tracker_visitors row 생성, click_id NULL, recordId NULL
3. 페이지 5번 이동 → total_pageviews 5
4. 폼 제출 (visitor_id 같이 전송)
   → records INSERT
   → tracker_visitors UPDATE (record_id 채워짐)
5. 리드 record 상세 → 행동 정보 패널에 5번 방문 표시 ✅

### 10-2. 이메일 클릭 시나리오
1. records에 alice 리드 INSERT
2. alice한테 메일 발송 (sendLog 생성, click_id 발급)
3. alice가 메일 클릭 → URL에 `?sendb_cid=clk_xxx`
4. 사이트 도착, tracker.js → collect 호출 (click_id 포함)
5. 서버: visitor INSERT + click_id로 recordId 자동 매칭
6. records 상세 → 행동 정보에 표시 ✅

### 10-3. SDK identify 시나리오
1. 익명 방문자 visitor abc로 둘러봄
2. 사이트 회원가입 후 `sendb.identify({ email: 'alice@...' })`
3. 서버: 이메일로 records 조회 → 매칭 시 recordId 채움
4. 이후 행동도 alice 리드에 누적 ✅

### 10-4. 다중 디바이스
1. alice가 데스크탑으로 방문 → visitor abc, recordId NULL
2. 폼 제출 → recordId=42
3. alice가 모바일에서 메일 클릭 → visitor xyz, recordId=42 (자동 매칭)
4. records 상세 → 행동 정보 패널: deviceCount=2, 합산 표시 ✅

### 10-5. 보안
- 다른 도메인에서 collect 호출 → 403
- 잘못된 apiKey → 401
- payload 100KB → 413
- 분당 300번 호출 → 429

---

## 11. Phase 1 작업 분해 (체크리스트)

### DB
- [ ] (1) `drizzle/0043_tracker.sql` 작성
- [ ] (2) `src/lib/db/schema.ts`에 4개 테이블 + emailClickLogs.click_id 추가
- [ ] (3) `pnpm db:push` 후 로컬 적용 확인

### 라이브러리 (lib)
- [ ] (4) `src/lib/tracker/upsert-visitor.ts` (visitor UPSERT + click_id 매칭)
- [ ] (5) `src/lib/tracker/upsert-session.ts`
- [ ] (6) `src/lib/email-click-tracking.ts`에 click_id 발급 로직 추가
- [ ] (7) `/api/track/click` 라우트에서 sendb_cid 부착
- [ ] (8) `src/lib/validations.ts`에 collectEventSchema, identifySchema 추가

### tracker.js
- [ ] (9) `public/tracker.js` 작성 (adion 변형)

### API
- [ ] (10) `src/app/api/tracker/collect/route.ts` (POST + OPTIONS)
- [ ] (11) `src/app/api/tracker/identify/route.ts` (POST + OPTIONS)
- [ ] (12) `src/app/api/tracker/sites/route.ts` (POST/GET)
- [ ] (13) `src/app/api/tracker/sites/[id]/route.ts` (PATCH/DELETE)
- [ ] (14) `src/app/api/tracker/visitors/route.ts` (GET 목록)
- [ ] (15) `src/app/api/tracker/visitors/[id]/route.ts` (GET 상세)
- [ ] (16) `src/app/api/records/[id]/visitor-activity/route.ts` (리드 상세용)
- [ ] (17) `src/app/api/public/forms/[slug]/submit/route.ts` 확장 (visitor_id 처리)

### UI
- [ ] (18) `src/components/tracker/` 폴더 + 하위 구조
- [ ] (19) `src/app/settings/workspace/tracker/page.tsx`
- [ ] (20) `src/app/tracker/page.tsx` (visitor 목록)
- [ ] (21) `src/app/tracker/visitors/[id]/page.tsx`
- [ ] (22) 사이드바에 "트래커" 메뉴 추가
- [ ] (23) record 상세 화면에 `RecordVisitorActivity` 패널 임베드
- [ ] (24) 폼 페이지(`/f/[slug]`)에 hidden visitor_id input + script

### 테스트
- [ ] (25) 로컬 sample 페이지로 5가지 시나리오 모두 검증

---

## 12. Open Questions (Design 단계 결정)

### Q1. UI 노출 = 별도 메뉴 (B안) ✅
사이드바에 "트래커" 메뉴 그룹 추가. partitions 침투 X. 향후 partitions 확장 필요해지면 그때 검토.

### Q2. 데이터 보관 기간 → **운영 결정 사안**
- visitor: 무기한 (CRM 일부)
- events: 90일 default, 워크스페이스 설정으로 조정 가능 (Phase 4에서 UI 추가)
- session: events와 동일 (cascade)

### Q3. 다중 디바이스 표시 → **합쳐서 표시** ✅
record 상세에서 SUM/MAX 집계, 디바이스별 정보는 visitor 상세 화면에서.

### Q4. SDK identify 시 record 자동 생성 → **기본 OFF, Phase 3에서 옵션 추가**
이메일이 있는데 records에 없으면 일단 visitor에만 email 채우고 record_id NULL 유지. 영업이 직접 판단.

### Q5. Heartbeat 처리 → **session 갱신만, event 저장 X** ✅
adion 패턴 동일. 30초 간격으로 ended_at만 갱신.
