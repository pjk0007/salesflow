# Design: 방문자-레코드 다중 연결 (Visitor Multi-Record Link)

> **Plan**: `docs/01-plan/features/visitor-multi-record.plan.md`
> **Project**: Sendb (Salesflow)
> **Author**: jaehun
> **Date**: 2026-05-20
> **Status**: Draft

---

## 0. 확정 결정 (Plan Q1~Q3)
- **Q1**: journey 기본 = **통합(visitor 경유 연결 record 다 합침)**, `?merge=none`으로 단일 모드
- **Q2**: 링크 누적은 **신뢰 키만**(click_id / matchField / email). **phone 매칭은 링크 X**(대표 record_id만, 오연결 방지)
- **Q3**: 기존 record_id 있는 visitor **전부 백필**

---

## 1. 데이터 모델

### 1.1 마이그레이션 — `drizzle/0050_visitor_record_links.sql`
```sql
CREATE TABLE IF NOT EXISTS "visitor_record_links" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL,
    "visitor_id" integer NOT NULL REFERENCES "tracker_visitors"("id") ON DELETE CASCADE,
    "record_id" integer NOT NULL REFERENCES "records"("id") ON DELETE CASCADE,
    "source" varchar(30) NOT NULL DEFAULT 'identify_match',
    "linked_at" timestamptz NOT NULL DEFAULT now(),
    UNIQUE ("visitor_id", "record_id")
);
CREATE INDEX IF NOT EXISTS "vrl_visitor_idx" ON "visitor_record_links" ("visitor_id");
CREATE INDEX IF NOT EXISTS "vrl_record_idx" ON "visitor_record_links" ("record_id");

-- 백필: 기존 visitor.record_id → 링크
INSERT INTO "visitor_record_links" ("org_id","visitor_id","record_id","source")
SELECT "org_id","id","record_id",'backfill'
FROM "tracker_visitors"
WHERE "record_id" IS NOT NULL
ON CONFLICT ("visitor_id","record_id") DO NOTHING;
```
**journal**: `{ "idx": 50, "version":"7", "when": 1770951300000, "tag":"0050_visitor_record_links", "breakpoints": true }`

### 1.2 schema.ts
```ts
export const visitorRecordLinks = pgTable("visitor_record_links", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id").notNull(),
    visitorId: integer("visitor_id")
        .references(() => trackerVisitors.id, { onDelete: "cascade" }).notNull(),
    recordId: integer("record_id")
        .references(() => records.id, { onDelete: "cascade" }).notNull(),
    source: varchar("source", { length: 30 }).default("identify_match").notNull(),
    linkedAt: timestamptz("linked_at").defaultNow().notNull(),
}, (table) => [
    unique().on(table.visitorId, table.recordId),
    index("vrl_visitor_idx").on(table.visitorId),
    index("vrl_record_idx").on(table.recordId),
]);
export type VisitorRecordLink = typeof visitorRecordLinks.$inferSelect;
```

### 1.3 기존 record_id
유지 — "현재 대표 record"(마지막 신뢰 식별). 목록/요약 표시용. 링크는 거쳐간 전체 이력.

---

## 2. 공용 헬퍼 — `src/lib/visitor-links.ts` (신규)
```ts
import { db, visitorRecordLinks } from "@/lib/db";

// visitor↔record 링크 upsert (멱등 — unique 충돌 무시)
export async function linkVisitorRecord(args: {
    orgId: string; visitorId: number; recordId: number; source: string;
}) {
    await db.insert(visitorRecordLinks)
        .values(args)
        .onConflictDoNothing({ target: [visitorRecordLinks.visitorId, visitorRecordLinks.recordId] });
}
```

---

## 3. 매칭 로직 변경

### 3.1 collect — `tracker/collect/route.ts` (L120~129)
click_id로 record 매칭 시:
```ts
if (match?.recordId && match.recordWorkspaceId === site.workspaceId) {
    // 링크 누적 (신뢰 키 click_id)
    await linkVisitorRecord({ orgId: site.orgId, visitorId: visitor.id, recordId: match.recordId, source: "click_id" });
    // 대표 record_id 비었으면 set
    if (!visitor.recordId) {
        await db.update(trackerVisitors).set({ recordId: match.recordId }).where(eq(trackerVisitors.id, visitor.id));
        visitor.recordId = match.recordId;
    }
}
```
> 기존 "비었을 때만 set"은 대표값에만 적용. 링크는 항상 누적.

### 3.2 identify — `tracker/identify/route.ts` (L71~123)
- matchField/email로 매칭된 recordId → **링크 누적** + 대표 record_id 갱신
- phone fallback으로 매칭된 recordId → 대표 record_id만(링크 X, Q2)
```ts
let recordId = visitor.recordId;
let matchedBy: "trust" | "phone" | null = null;

// 1) matchField (신뢰)
if (site.matchField && user_id) { ... if (matched[0]) { recordId = matched[0].id; matchedBy = "trust"; } }
// 2) email (신뢰)
if (!recordId && email) { ... matchedBy = "trust"; }
// 3) phone (비신뢰)
if (!recordId && !site.matchField && phone) { ... matchedBy = "phone"; }

// 링크: 신뢰 매칭만
if (recordId && matchedBy === "trust") {
    await linkVisitorRecord({ orgId: site.orgId, visitorId: visitor.id, recordId, source: "identify_match" });
}
// 대표 record_id 갱신 (기존대로)
await db.update(trackerVisitors).set({ recordId, email: ..., ... }).where(...);
```
> matchField 재매칭(덮어쓰기)은 유지 — 대표는 최신 신뢰값. 이전 record도 링크엔 남아있음(누적).

---

## 4. journey API 확장 — `records/[id]/journey/route.ts`

### 4.1 통합 모드 (기본)
`?merge=none`이 아니면 통합:
```ts
const merge = sp.get("merge") !== "none";

// 대상 record id 집합 구하기
let recordIds = [recordId];
if (merge) {
    // 이 record에 연결된 visitor들 → 그 visitor들이 연결된 모든 record
    const directVisitors = await db.select({ visitorId: visitorRecordLinks.visitorId })
        .from(visitorRecordLinks).where(eq(visitorRecordLinks.recordId, recordId));
    // + tracker_visitors.record_id 직접 연결분도 포함 (대표값)
    const vIds = unique([...directVisitors.map(v=>v.visitorId)]);
    if (vIds.length) {
        const linked = await db.select({ recordId: visitorRecordLinks.recordId })
            .from(visitorRecordLinks).where(inArray(visitorRecordLinks.visitorId, vIds));
        recordIds = unique([recordId, ...linked.map(l=>l.recordId)]);
    }
}
// orgId 검증: recordIds 전부 user.orgId인지 확인 (아니면 제외)
```

### 4.2 이벤트 수집 (recordIds 기반)
- record_events: `WHERE record_id IN (recordIds)`
- email: `WHERE record_id IN (recordIds)`
- tracker: recordIds에 연결된 모든 visitor → tracker_events/sessions
  - visitorIds = (tracker_visitors WHERE record_id IN recordIds) ∪ (links WHERE record_id IN recordIds)
- 나머지 normalize/정렬/summary는 기존 그대로

### 4.3 summary 영향
- stages/단계는 통합 record들의 business 이벤트 합산 → 메일파티션+회원가입 단계가 한 퍼널로
- currentStage: 대표 record(또는 가장 최근 단계 이벤트)
- 권한: recordIds 전부 orgId 검증 (다른 org 섞임 방지)

---

## 5. 작업 분해

### DB
- [ ] `0050_visitor_record_links.sql` (+백필) + journal
- [ ] schema.ts visitorRecordLinks + 타입

### lib
- [ ] `lib/visitor-links.ts` linkVisitorRecord 헬퍼

### API
- [ ] collect — click_id 매칭 시 링크 누적
- [ ] identify — 신뢰 매칭만 링크, phone 제외, 대표 갱신
- [ ] journey — merge 모드(visitor 경유 record 통합) + orgId 검증

### 검증 (로컬)
- [ ] 메일파티션 record collect → 링크 1건
- [ ] 같은 visitor identify(다른 파티션 uuid) → 링크 2건, 대표 record_id 갱신
- [ ] journey 통합 모드 → 두 record 이벤트 한 타임라인 / merge=none → 단일
- [ ] phone 매칭 → 링크 안 생김(대표만)
- [ ] 백필 후 기존 visitor 연결 보존
- [ ] 기존 단일 record 여정 회귀 없음
- [ ] tsc

---

## 6. 검증 기준 (Plan §3.2)
| 기준 | 검증 |
|---|---|
| visitor 거쳐간 record 보존 | 링크 2건 확인 |
| 파티션 넘어 여정 통합 | journey 통합 모드 두 record 합산 |
| 기존 단일 여정 회귀 없음 | merge=none + 기존 동작 |

---

## 7. Open Questions (Design)
- **Q1.** 통합 시 currentStage를 어느 record 기준? → 대표 record_id의 단계 필드값, 없으면 최근 단계 이벤트.
- **Q2.** journey 통합이 깊어질 수 있음(visitor↔record 체인) → 1-hop만(이 record의 visitor들 → 그 visitor들의 record들). 재귀 안 함.
- **Q3.** collect는 site.orgId 사용 가능? → site 로드 시 orgId 있음. 확인 후 사용.
