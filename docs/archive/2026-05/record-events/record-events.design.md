# Design: 레코드 이벤트 (Record Events)

> **Plan**: `docs/01-plan/features/record-events.plan.md`
> **Project**: Sendb (Salesflow) + designer-hire-server
> **Author**: jaehun
> **Date**: 2026-05-19
> **Status**: Draft

---

## 1. 개요

레코드(리드/고객)에 일어난 비즈니스 이벤트를 시간순으로 쌓는 범용 이벤트 시스템.
이 문서는 Plan을 구현 가능한 수준으로 구체화한다 — 마이그레이션 SQL, schema.ts, API 스펙, 디하 트리거 변경, 작업 분해.

### 1.1 아키텍처 한눈에

```
[디하 server 트리거]                    [sendb]
createProposal  ─┐
createMatch     ─┤  appendRecordEvent(uuid, {type,label,meta})
updateMatch     ─┘            │
                              ▼
              POST /api/v1/records/:id/events  (토큰 인증 + CORS)
                              │
                              ▼
                     record_events INSERT (append-only)
                              │
[sendb UI] ◀── GET /api/records/:id/events ◀──┘
```

---

## 2. 데이터 모델

### 2.1 마이그레이션 SQL — `drizzle/0046_record_events.sql`

```sql
CREATE TABLE "record_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"record_id" integer NOT NULL,
	"type" varchar(50) NOT NULL,
	"label" varchar(100) NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "record_events" ADD CONSTRAINT "record_events_record_id_records_id_fk"
	FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "record_events_record_occurred_idx" ON "record_events" ("record_id","occurred_at");
--> statement-breakpoint
CREATE INDEX "record_events_org_type_idx" ON "record_events" ("org_id","type");
```

**`drizzle/meta/_journal.json`에 항목 추가**:
```json
{ "idx": 46, "version": "7", "when": 1770950900000, "tag": "0046_record_events", "breakpoints": true }
```

> 배포 시 `instrumentation.ts`가 자동 적용. (0045 다음 번호 — main 머지 충돌 시 재조정 필요)

### 2.2 schema.ts 추가 — `src/lib/db/schema.ts`

`trackerEvents` 정의 바로 아래(L1307 이후)에 추가. `records` 테이블이 위에 정의돼 있어 FK 참조 가능.

```ts
// ============================================
// 레코드 이벤트 (비즈니스 이벤트 이력)
// ============================================
export const recordEvents = pgTable("record_events", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id").notNull(),
    recordId: integer("record_id")
        .references(() => records.id, { onDelete: "cascade" })
        .notNull(),
    type: varchar("type", { length: 50 }).notNull(),
    label: varchar("label", { length: 100 }).notNull(),
    occurredAt: timestamptz("occurred_at").defaultNow().notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
}, (table) => [
    index("record_events_record_occurred_idx").on(table.recordId, table.occurredAt),
    index("record_events_org_type_idx").on(table.orgId, table.type),
]);

export type RecordEvent = typeof recordEvents.$inferSelect;
export type NewRecordEvent = typeof recordEvents.$inferInsert;
```

> `index` 콜백 형식은 `trackerEvents`와 동일하게 배열 반환 스타일을 따른다.

### 2.3 db export 확인

`src/lib/db/index.ts`(또는 schema re-export 지점)에서 `records`처럼 `recordEvents`가 export되는지 확인. schema.ts를 `export *` 하면 자동.

---

## 3. API 스펙

### 3.1 `POST /api/v1/records/[id]/events` — 이벤트 추가 (외부)

**파일**: `src/app/api/v1/records/[id]/events/route.ts` (신규)

기존 `/api/v1/records/route.ts`의 인증·CORS 패턴을 그대로 재사용한다.

#### 인증
- `authenticateExternalRequest(req)` — `Authorization: Bearer <token>` → `ApiTokenInfo`
- record를 조회해 `record.orgId === tokenInfo.orgId` 검증 (조직 격리)
- `checkTokenAccess(tokenInfo, record.partitionId, "create")` — 쓰기 권한 확인

#### Request Body
```json
{
  "type": "match_stage",
  "label": "구독중",
  "occurredAt": "2026-05-10T12:00:00.000Z",
  "meta": { "from": "테스트", "to": "구독중" }
}
```

| 필드 | 필수 | 검증 |
|---|---|---|
| `type` | ✅ | non-empty string, ≤ 50자 |
| `label` | ✅ | non-empty string, ≤ 100자 |
| `occurredAt` | ❌ | ISO 문자열. 없으면 서버 `now()`. 파싱 실패 시 400 |
| `meta` | ❌ | object (배열/원시값이면 400) |

#### 처리 흐름
```
1. 인증 (실패 401)
2. params.id로 record 조회 (없으면 404)
3. record.orgId !== tokenInfo.orgId → 404 (존재 노출 안 함)
4. checkTokenAccess(create) 실패 → 403
5. body 검증 (실패 400)
6. record_events INSERT { orgId: record.orgId, recordId, type, label, occurredAt, meta }
7. 201 { success: true, data: <inserted row> }
```

#### 응답
```json
// 201
{ "success": true, "data": { "id": 1, "recordId": 42, "type": "match_stage", "label": "구독중", "occurredAt": "...", "meta": {...}, "createdAt": "..." } }
// 400 / 401 / 403 / 404
{ "success": false, "error": "<영문 메시지>" }
```

#### CORS
`/api/v1/records/route.ts`와 동일. `OPTIONS` 핸들러 + `POST` 래퍼에서 헤더 주입.
```ts
const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
};
```

#### 구현 스케치
```ts
// src/app/api/v1/records/[id]/events/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db, records, recordEvents } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getApiTokenFromNextRequest, resolveApiToken, checkTokenAccess } from "@/lib/auth";

const CORS_HEADERS = { /* 위와 동일 */ };

async function handlePost(req: NextRequest, recordId: number) {
    const tokenStr = getApiTokenFromNextRequest(req);
    const tokenInfo = tokenStr ? await resolveApiToken(tokenStr) : null;
    if (!tokenInfo) {
        return NextResponse.json({ success: false, error: "Invalid or missing API token." }, { status: 401 });
    }

    const [record] = await db.select().from(records).where(eq(records.id, recordId));
    if (!record || record.orgId !== tokenInfo.orgId) {
        return NextResponse.json({ success: false, error: "Record not found." }, { status: 404 });
    }

    const hasAccess = await checkTokenAccess(tokenInfo, record.partitionId, "create");
    if (!hasAccess) {
        return NextResponse.json({ success: false, error: "Access denied for this record." }, { status: 403 });
    }

    const body = await req.json();
    const type = typeof body.type === "string" ? body.type.trim() : "";
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!type || type.length > 50) {
        return NextResponse.json({ success: false, error: "type is required (max 50 chars)." }, { status: 400 });
    }
    if (!label || label.length > 100) {
        return NextResponse.json({ success: false, error: "label is required (max 100 chars)." }, { status: 400 });
    }

    let occurredAt = new Date();
    if (body.occurredAt !== undefined) {
        const parsed = new Date(body.occurredAt);
        if (isNaN(parsed.getTime())) {
            return NextResponse.json({ success: false, error: "occurredAt is invalid." }, { status: 400 });
        }
        occurredAt = parsed;
    }

    let meta: Record<string, unknown> | null = null;
    if (body.meta !== undefined && body.meta !== null) {
        if (typeof body.meta !== "object" || Array.isArray(body.meta)) {
            return NextResponse.json({ success: false, error: "meta must be an object." }, { status: 400 });
        }
        meta = body.meta;
    }

    const [event] = await db
        .insert(recordEvents)
        .values({ orgId: record.orgId, recordId, type, label, occurredAt, meta })
        .returning();

    return NextResponse.json({ success: true, data: event }, { status: 201 });
}

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const recordId = Number(id);
    let res: NextResponse;
    if (!recordId) {
        res = NextResponse.json({ success: false, error: "Invalid record id." }, { status: 400 });
    } else {
        try {
            res = await handlePost(req, recordId);
        } catch (error) {
            console.error("Record event create error:", error);
            res = NextResponse.json({ success: false, error: "Internal server error." }, { status: 500 });
        }
    }
    for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
    return res;
}
```

> Next.js 16에서 `params`는 Promise. `await params`로 풀어야 한다.

### 3.2 `GET /api/records/[id]/events` — 이벤트 조회 (내부)

**파일**: `src/app/api/records/[id]/events/route.ts` (신규)

sendb UI가 record 상세에서 타임라인을 보여줄 때 사용. 내부 인증.

#### 인증
- `getUserFromNextRequest(req)` → `{ userId, orgId, ... }`
- record 조회 후 `record.orgId === user.orgId` 검증 (없으면 404)

#### Request
`GET /api/records/42/events`

#### 처리
```
1. 내부 인증 (실패 401)
2. record 조회 + orgId 검증 (404)
3. record_events SELECT WHERE record_id = :id ORDER BY occurred_at DESC
4. 200 { success: true, data: RecordEvent[] }
```

> 페이지네이션 없음 — record당 이벤트가 수십 건 수준이라 전체 반환. (폭증 시 후속 Plan에서 처리)

### 3.3 라우트 위치 정리

| 메서드 | 경로 | 인증 | 용도 |
|---|---|---|---|
| POST | `/api/v1/records/[id]/events` | 외부 토큰 | 디하 등 외부에서 이벤트 기록 |
| GET | `/api/records/[id]/events` | 내부 세션 | sendb UI 타임라인 조회 |

> `/api/v1/*` = 외부 공개 API, `/api/*` = 내부. 기존 컨벤션 유지.

---

## 4. 디하 서버 연동

### 4.1 `util/sendb.ts` — `appendRecordEvent` 헬퍼 추가

기존 `findRecordByUuid`를 재사용한다.

```ts
/**
 * sendb 레코드에 비즈니스 이벤트를 추가한다 (append-only).
 * record_events 테이블에 한 줄 INSERT — matchStep 덮어쓰기와 별개.
 */
export async function appendRecordEvent(
    uuid: string,
    event: { type: string; label: string; occurredAt?: string; meta?: Record<string, unknown> }
): Promise<void> {
    try {
        const recordId = await findRecordByUuid(uuid);
        if (!recordId) {
            console.log(`sendb record not found for uuid: ${uuid}`);
            return;
        }
        const response = await fetch(`${SENDB_BASE_URL}/records/${recordId}/events`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SENDB_TOKEN}`,
            },
            body: JSON.stringify(event),
        });
        const result = await response.json() as { success: boolean };
        if (!result.success) {
            console.error('sendb appendRecordEvent failed:', result);
        }
    } catch (error) {
        console.error('sendb appendRecordEvent error:', error);
    }
}
```

> `updateSendbRecord`와 동일한 패턴(uuid → recordId → fetch). 실패 시 조용히 skip — 디하 본 로직을 막지 않음.

### 4.2 단계 label 상수 (표기 일관성)

Plan §8.5 대응. 디하 트리거 곳곳에 흩어진 `matchStepMap`을 하나로 모아 label 일관성 보장.

```ts
// util/sendb.ts
export const MATCH_STAGE_LABELS: Record<string, string> = {
    seek: '신청완료',
    test: '테스트',
    proceed: '구독중',
    end: '종료',
};
```

### 4.3 트리거별 변경

#### createProposal.ts — `status === 'seek'` 블록

```ts
if (proposal.status === 'seek' && proposal.startDate && user.phone) {
    updateSendbRecord(proposal.userId, {
        hasTempProposal: false,
        matchStep: '신청완료',
    });
    // ▼ 추가
    appendRecordEvent(proposal.userId, {
        type: 'match_stage',
        label: MATCH_STAGE_LABELS.seek,
    });
    clientTok.subscribeComplete({ receiver: user.phone });
    ...
}
```

#### createMatch.ts — `matchStepMap[match.status]` 블록

```ts
if (matchStepMap[match.status]) {
    updateSendbRecord(match.host, { matchStep: matchStepMap[match.status], ... });
    // ▼ 추가
    appendRecordEvent(match.host, {
        type: 'match_stage',
        label: matchStepMap[match.status],   // '테스트' | '구독중'
        meta: { trigger: 'createMatch', status: match.status },
    });
}
```

> 기존 `matchStepMap`(test/proceed)을 그대로 label로 재사용. createMatch는 from이 없으므로 `meta.from` 생략.

#### updateMatch.ts — `beforeMatch.status !== afterMatch.status` 블록

```ts
if (beforeMatch.status !== afterMatch.status) {
    const matchStepMap: Record<string, string> = {
        test: '테스트', proceed: '구독중', end: '종료',
    };
    if (matchStepMap[afterMatch.status]) {
        updateSendbRecord(afterMatch.host, { matchStep: matchStepMap[afterMatch.status] });
        // ▼ 추가 — from/to 둘 다 기록 (역행 추적의 핵심)
        appendRecordEvent(afterMatch.host, {
            type: 'match_stage',
            label: matchStepMap[afterMatch.status],
            meta: {
                trigger: 'updateMatch',
                from: matchStepMap[beforeMatch.status] ?? beforeMatch.status,
                to: matchStepMap[afterMatch.status],
            },
        });
    }
}
```

> updateMatch는 status 전이가 있으므로 `meta.from`/`meta.to`를 기록 → "구독중 → 테스트" 역행이 이벤트에 명시적으로 남는다.

### 4.4 이벤트 정의 종합

| 트리거 | 조건 | type | label | meta |
|---|---|---|---|---|
| createProposal | status `seek` | `match_stage` | 신청완료 | — |
| createMatch | status `test` | `match_stage` | 테스트 | `{trigger,status}` |
| createMatch | status `proceed` | `match_stage` | 구독중 | `{trigger,status}` |
| updateMatch | status 전이 | `match_stage` | 전이 후 label | `{trigger,from,to}` |

> 모든 디하 이벤트 `type='match_stage'`. sendb는 이 문자열의 의미를 모름 — 디하의 선택.

---

## 5. (선택) sendb record 상세 — 이벤트 타임라인

Plan Q2 대응. 검증/디버깅용 **단순 목록**만. 시각화는 후속 Plan.

- 위치: record 상세 화면 (기존 메모 탭 옆 등 — 구현 시 확인)
- 컴포넌트: `src/components/records/ui/RecordEventTimeline.tsx` (신규, 폴더 구조 준수)
- 훅: `src/components/records/hooks/useRecordEvents.ts` — SWR로 `GET /api/records/:id/events`
- 표시: `occurred_at` 역순, 각 행 `[시각] label` + meta가 있으면 `from→to` 정도. 차트 없음.

> 이번 범위에서 우선순위 낮음. API + 디하 연동 검증이 먼저. 시간 남으면 추가.

---

## 6. 작업 분해 (체크리스트)

### Phase A — sendb 스키마/API
- [ ] `drizzle/0046_record_events.sql` 작성
- [ ] `drizzle/meta/_journal.json`에 idx 46 등록
- [ ] `schema.ts`에 `recordEvents` + 타입 추가
- [ ] `recordEvents`가 `@/lib/db`에서 export되는지 확인
- [ ] `POST /api/v1/records/[id]/events` 구현 (인증·검증·CORS)
- [ ] `GET /api/records/[id]/events` 구현 (내부 인증)
- [ ] 로컬에서 마이그레이션 적용 (`drizzle-kit` 또는 instrumentation)

### Phase B — 디하 server
- [ ] `util/sendb.ts`에 `appendRecordEvent` + `MATCH_STAGE_LABELS` 추가
- [ ] `createProposal.ts` — 신청완료 이벤트
- [ ] `createMatch.ts` — 테스트/구독중 이벤트
- [ ] `updateMatch.ts` — 전이 이벤트 (from/to meta)

### Phase C — (선택) UI
- [ ] `useRecordEvents` 훅
- [ ] `RecordEventTimeline` 컴포넌트
- [ ] record 상세에 배치

### Phase D — 검증
- [ ] sendb API 단독: curl로 POST → record_events 행 생성 확인
- [ ] orgId 격리: 다른 org 토큰으로 POST → 404 확인
- [ ] 디하 로컬/스테이징: 단계 변경 → record_events 이력 확인
- [ ] 역행 케이스: 구독중 → 테스트 → record_events에 from/to 남는지

---

## 7. 배포 순서 (Plan §8.1)

```
1. sendb 배포   — 마이그레이션 자동 적용 + API 라이브
2. 디하 배포    — appendRecordEvent 호출 (1 완료 후여야 호출 성공)
```

> 순서 어기면: 디하가 먼저 배포돼도 POST가 404/연결실패 → `appendRecordEvent`가 조용히 skip. 이벤트만 유실되고 디하 본 동작은 안 깨짐. 그래도 sendb 먼저 권장.

---

## 8. 검증 기준 (Plan §3.2 매핑)

| Plan 성공 기준 | 검증 방법 |
|---|---|
| 역행 회사 이벤트 4건 시간순 | Phase D 역행 케이스 |
| "테스트만 종료" vs "구독 후 종료" 구분 | record_events label 시퀀스로 판별 |
| API가 type 무관하게 동일 처리 | `type` 검증에 화이트리스트 없음 — 코드 리뷰 |
| 디하 트리거가 기존 matchStep 안 깸 | `updateSendbRecord` 호출 유지 — Phase D |

---

## 9. Open Questions (Design 단계)

- **Q1.** `GET /api/records/[id]/events`의 라우트가 기존 `/api/records/[id]/*`와 충돌 없는지 — 구현 시 디렉토리 확인.
- **Q2.** `appendRecordEvent`를 `updateSendbRecord` 내부에서 부르지 않고 트리거에서 따로 부르는 이유: matchStep 갱신과 이벤트 기록은 의미가 다르고(현재값 vs 이력), 모든 `updateSendbRecord` 호출이 이벤트는 아님(hasTempProposal 등). → 트리거에서 명시적 호출 유지.
- **Q3.** UI(Phase C)를 이번 PR에 포함할지 별도로 뺄지 — API·디하 검증 후 결정.
