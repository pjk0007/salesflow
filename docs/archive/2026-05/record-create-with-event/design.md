# Design: 레코드 작업 시 이벤트 동시 기록 (Record with Event)

> **Project**: Sendb (Salesflow)
> **Author**: jaehun
> **Date**: 2026-05-20
> **Status**: Draft
> **Related**: record-events (archive/2026-05/record-events)

---

## 0. 핵심 — 외부 API 명세를 둘로 통일

외부 고객사가 알아야 할 건 **두 개뿐**. event는 선택. 무슨 일이 일어났는지 이력으로 남기고 싶으면 끼워 넣는다.

```
레코드 만들 때:  POST /api/v1/records       { partitionId, data, event? }
레코드 바꿀 때:  PUT  /api/v1/records/:id    { data, event? }

event = { type, label, occurredAt?, meta? }   // 옵션
```

→ 두 가지 패턴을 한 명세로:
- **생성 + 이력** (백오피스랩 도입상담): `POST` + event
- **업데이트 + 이력** (디하 매칭 단계 변경): `PUT` + event

별도 `POST /records/:id/events`는 남겨두되(data 변경 없이 이벤트만 추가하는 특수 케이스), **권장 경로는 POST/PUT + event**.

---

## 1. 개요

`POST /api/v1/records`와 `PUT /api/v1/records/:id`에 **선택적 `event` 파라미터**를 추가한다. 외부가 한 번만 호출하면 sendb가 record 작업(생성/수정)과 record_events 기록을 함께 처리한다.

### 1.1 배경 — 지금의 문제
백오피스랩 도입상담은 record 생성 후 events API를 **별도로 또 호출**(2회 왕복). record는 생겼는데 이벤트만 실패할 여지도 있음.

### 1.2 목표
```
외부 → POST /api/v1/records { partitionId, data, event?: {type, label, occurredAt?, meta?} }
        ↓ sendb
   1. record 생성/병합 (기존 로직: reject|allow|merge|delete_old|신규)
   2. event 있으면 → 최종 record에 record_events INSERT
   3. 같은 트랜잭션 (원자적)
        ↓
   응답에 record + (이벤트 기록 결과)
```

- 외부는 **1회 호출**
- record가 신규든 merge든, **그 결과 record_id에** 이벤트가 달림
- `event` 없으면 기존과 100% 동일 (하위 호환)

### 1.3 별도 events API는 유지
`POST /api/v1/records/:id/events`는 그대로 둔다. "나중에 단계 변경 시 이벤트 추가"(디하 매칭 단계)는 생성과 시점이 다르므로 둘 다 필요.
- 생성과 동시 → `POST /records` + event
- 나중에 추가 → `POST /records/:id/events`

---

## 2. API 스펙 변경

### 2.1 Request (event 추가)
```json
POST /api/v1/records
{
  "partitionId": 19,
  "data": { "name": "...", "email": "...", ... },
  "event": {                          // 선택
    "type": "consult",
    "label": "도입상담 신청",
    "occurredAt": "2026-05-20T...",   // 선택, 없으면 now()
    "meta": { "source": "website" }   // 선택
  }
}
```

### 2.2 event 검증 (events API와 동일 규칙)
- `event` 없으면 무시 (기존 동작)
- 있으면: `type` 필수(≤50자), `label` 필수(≤100자), `occurredAt` 파싱 가능해야, `meta`는 object
- 검증 실패 시 **400** (record 생성 전에 검증 → record만 생기고 이벤트 실패하는 일 방지)

### 2.3 어느 record에 이벤트를 다나 (분기별)
| 중복 action | 이벤트 대상 record |
|---|---|
| 신규 생성 | 새 record |
| `merge` | 병합된 기존 record (재신청 = 같은 사람 두 번째 이벤트로 이력 누적) ✅ |
| `allow` | 새로 생성된 record |
| `delete_old` | 새로 생성된 record (기존 삭제 후 생성) |
| `reject` | 이벤트 기록 안 함 (record 생성 자체가 거부됨, 409) |

### 2.4 응답
```json
// 신규 (201)
{ "success": true, "data": <record>, "event": <recordEvent or null> }
// merge (200)
{ "success": true, "data": <merged>, "merged": true, "event": <recordEvent or null> }
```
> 기존 응답에 `event` 필드만 추가 (하위 호환).

---

## 3. 구현

### 3.1 파일
`src/app/api/v1/records/route.ts` (handlePost)

### 3.2 event 검증 헬퍼 (events route와 중복 → 공용 함수로 추출 권장)
`src/lib/record-events.ts` (신규) 또는 route 내 inline:
```ts
type EventInput = { type: string; label: string; occurredAt?: string; meta?: Record<string, unknown> };

function parseEventInput(raw: unknown):
    | { ok: true; value: { type: string; label: string; occurredAt: Date; meta: Record<string, unknown> | null } }
    | { ok: false; error: string } {
    if (raw === undefined || raw === null) return { ok: true, value: null as never }; // 호출측에서 없으면 skip
    if (typeof raw !== "object") return { ok: false, error: "event must be an object." };
    const e = raw as Record<string, unknown>;
    const type = typeof e.type === "string" ? e.type.trim() : "";
    const label = typeof e.label === "string" ? e.label.trim() : "";
    if (!type || type.length > 50) return { ok: false, error: "event.type is required (max 50)." };
    if (!label || label.length > 100) return { ok: false, error: "event.label is required (max 100)." };
    let occurredAt = new Date();
    if (e.occurredAt !== undefined && e.occurredAt !== null) {
        const p = new Date(e.occurredAt as string);
        if (isNaN(p.getTime())) return { ok: false, error: "event.occurredAt is invalid." };
        occurredAt = p;
    }
    let meta: Record<string, unknown> | null = null;
    if (e.meta !== undefined && e.meta !== null) {
        if (typeof e.meta !== "object" || Array.isArray(e.meta)) return { ok: false, error: "event.meta must be an object." };
        meta = e.meta as Record<string, unknown>;
    }
    return { ok: true, value: { type, label, occurredAt, meta } };
}
```
> 기존 `/records/[id]/events/route.ts`의 검증과 동일 → 공용화하면 events route도 이걸 쓰게 리팩터.

### 3.3 handlePost 흐름 변경
```ts
const { partitionId, data: recordData, event } = await req.json();

// (A) event 사전 검증 — record 만들기 전에. 실패 시 400 (record 안 만듦)
const parsed = parseEventInput(event);
if (event !== undefined && event !== null && !parsed.ok) {
    return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
}
const eventInput = (event && parsed.ok) ? parsed.value : null;

// ... 기존 권한/중복 체크 ...

// (B) merge 분기: 병합 후 그 record에 이벤트
case "merge": {
    const [merged] = await db.update(records).set({...}).where(...).returning();
    const ev = eventInput ? await insertRecordEvent(merged, eventInput) : null;
    return NextResponse.json({ success: true, data: merged, merged: true, event: ev });
}

// (C) 신규 생성: 트랜잭션 안에서 record + event 함께 INSERT (원자적)
const result = await db.transaction(async (tx) => {
    // ... record INSERT (newRecord) ...
    let createdEvent = null;
    if (eventInput) {
        [createdEvent] = await tx.insert(recordEvents).values({
            orgId: tokenInfo.orgId, recordId: newRecord.id,
            type: eventInput.type, label: eventInput.label,
            occurredAt: eventInput.occurredAt, meta: eventInput.meta,
        }).returning();
    }
    return { record: newRecord, event: createdEvent };
});
return NextResponse.json({ success: true, data: result.record, event: result.event }, { status: 201 });
```

> 신규 경로는 트랜잭션 안에 넣어 원자성 확보. merge/allow/delete_old는 기존 트랜잭션 밖 처리라 이벤트도 그 직후 INSERT(별도지만 실패해도 record는 유지 — 도입상담 수준에선 허용).

### 3.4 헬퍼
```ts
async function insertRecordEvent(record: { id: number; orgId: string }, ev: {...}) {
    const [e] = await db.insert(recordEvents).values({
        orgId: record.orgId, recordId: record.id, type: ev.type, label: ev.label,
        occurredAt: ev.occurredAt, meta: ev.meta,
    }).returning();
    return e;
}
```

---

## 3.5 PUT /api/v1/records/:id 에도 event 추가

`src/app/api/v1/records/[id]/route.ts` PUT 핸들러:
```ts
const { data: newData, event } = await req.json();

// event 사전 검증 (record 수정 전)
const parsed = parseEventInput(event);
if (event != null && !parsed.ok) {
    return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
}
const eventInput = (event != null && parsed.ok) ? parsed.value : null;

// ... 기존 record 수정 (updated) ...

// 이벤트 기록
let ev = null;
if (eventInput) {
    [ev] = await db.insert(recordEvents).values({
        orgId: tokenInfo.orgId, recordId, type: eventInput.type, label: eventInput.label,
        occurredAt: eventInput.occurredAt, meta: eventInput.meta,
    }).returning();
}
return NextResponse.json({ success: true, data: updated, event: ev });
```

## 3.6 공용 검증 헬퍼 — `src/lib/record-events.ts` (신규)
`parseEventInput` + `insertRecordEvent`를 여기 두고 POST/PUT/events route 셋이 공용. 중복 제거.

---

## 4. 외부 단순화

### 4.1 백오피스랩 createLead (생성 + 이력)
별도 events 호출 제거 → `POST /records`에 `event` 포함:
```ts
body: JSON.stringify({
    partitionId: 19,
    data: { name, companyName, phone, email, source, note },
    event: { type: 'consult', label: '도입상담 신청', meta: { source: data.source ?? 'website' } },
}),
// 이후 별도 events fetch 제거
```

### 4.2 디하 updateSendbRecord (업데이트 + 이력)
`util/sendb.ts`의 `updateSendbRecord`에 선택적 event 인자 추가:
```ts
export async function updateSendbRecord(
    uuid: string,
    data: Record<string, unknown>,
    event?: { type: string; label: string; meta?: Record<string, unknown> }
): Promise<void> {
    const recordId = await findRecordByUuid(uuid);
    if (!recordId) return;
    await fetch(`${SENDB_BASE_URL}/records/${recordId}`, {
        method: 'PUT', headers: {...},
        body: JSON.stringify({ data, ...(event ? { event } : {}) }),  // event 같이
    });
}
```
→ 트리거에서 `appendRecordEvent` 별도 호출 제거, updateSendbRecord 한 번에:
```ts
// 지금 (2번 — 각자 findRecordByUuid)
await updateSendbRecord(host, {...});
await appendRecordEvent(host, {...});

// 바뀜 (1번 — findRecordByUuid 1회 + PUT 1회)
await updateSendbRecord(host, {...}, { type:'match_stage', label:'구독중', meta:{...} });
```

**디하 트리거 수정 대상**: createMatch, updateMatch, updateProposal, createProposal — `updateSendbRecord(...)` + `appendRecordEvent(...)` 쌍을 `updateSendbRecord(..., event)` 하나로.

> 단, createProposal/updateProposal의 신청완료는 record가 이미 있으니 PUT 경로(updateSendbRecord+event)로 통일 가능. `appendRecordEvent` 헬퍼는 남겨둠(매칭 단계 외 순수 이벤트용 여지).

별도 events 호출 제거 → record 생성에 `event` 포함:
```ts
const sendbPromise = fetch(`${sendbBaseUrl}/api/v1/records`, {
    method: 'POST',
    headers: {...},
    body: JSON.stringify({
        partitionId: 19,
        data: { name, companyName, phone, email, source, note },
        event: {
            type: 'consult',
            label: '도입상담 신청',
            meta: { source: data.source ?? 'website' },
        },
    }),
});
// 이후 별도 events fetch 제거
```
→ 1회 호출로 record + 이벤트 동시.

---

## 5. 작업 분해

### sendb
- [ ] `parseEventInput` 검증 헬퍼 (route inline 또는 lib 공용)
- [ ] handlePost: event 사전 검증(400) → merge/신규 분기에 이벤트 INSERT
- [ ] 신규 생성은 트랜잭션 안에서 record+event 원자적
- [ ] 응답에 `event` 필드 추가
- [ ] (선택) events route와 검증 로직 공용화

### 백오피스랩
- [ ] createLead: 별도 events 호출 제거, record 생성에 `event` 포함

### 검증 (로컬)
- [ ] event 포함 호출 → record + record_events 동시 생성
- [ ] event 없는 호출 → 기존과 동일 (하위 호환)
- [ ] event 검증 실패 → 400, record 안 만들어짐
- [ ] merge 케이스 → 기존 record에 이벤트 누적
- [ ] 백오피스랩 도입상담 → consult 이벤트 1회 호출로 기록

---

## 6. Open Questions

- **Q1.** merge/allow/delete_old 경로의 이벤트 INSERT는 트랜잭션 밖(별도)이라 record는 되고 이벤트만 실패할 미세한 여지 있음. 신규 경로만 원자적. → 도입상담 수준에선 허용. 완전 원자성 원하면 전 경로를 트랜잭션으로 감싸야 함(리팩터 큼). 이번엔 신규만 원자적, 나머지는 best-effort.
- **Q2.** 검증 로직 공용화 범위 — 이번에 events route까지 리팩터할지, record route에만 inline 둘지. 중복 최소화 위해 공용화 권장하나 범위 늘어남.
- **Q3.** 응답 `event: null`(이벤트 없거나 실패) vs 필드 생략 — null 명시가 일관적.
