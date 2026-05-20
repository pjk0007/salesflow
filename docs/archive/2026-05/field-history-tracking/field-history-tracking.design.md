# Design: 필드 변경 이력 추적 (Field History Tracking)

> **Plan**: `docs/01-plan/features/field-history-tracking.plan.md`
> **Project**: Sendb (Salesflow)
> **Author**: jaehun
> **Date**: 2026-05-20
> **Status**: Draft

---

## 1. 개요

필드 정의에 "변경 이력 추적" 토글(`track_history`)을 추가한다. 추적 켜진 필드가 sendb UI에서 바뀌면 PATCH `/api/records/:id`가 변경을 감지해 record_events에 자동 기록한다.

이벤트 형태(Plan D1~D3):
```
{ type: field.key, label: 새값, meta: { field, from, to, by } }
```

---

## 2. 데이터 모델

### 2.1 마이그레이션 — `drizzle/0049_field_track_history.sql`
```sql
ALTER TABLE "field_definitions" ADD COLUMN IF NOT EXISTS "track_history" integer DEFAULT 0 NOT NULL;
```
**journal**: `{ "idx": 49, "version":"7", "when": 1770951200000, "tag":"0049_field_track_history", "breakpoints": true }`
> 0048 다음. main 머지 충돌 시 재조정.

### 2.2 schema.ts — `fieldDefinitions`
```ts
// systemColumn 아래
trackHistory: integer("track_history").default(0).notNull(),
```

---

## 3. 타입 (src/types/index.ts)

```ts
// FieldDefinition
trackHistory: boolean;

// CreateFieldInput
trackHistory?: boolean;

// UpdateFieldInput
trackHistory?: boolean;
```
> DB는 integer(0/1), 타입/UI는 boolean. API 경계에서 변환(`? 1 : 0`).

---

## 4. UI

> **노출 조건 (확정): "변경 이력 추적" 토글은 `fieldType === "select"`일 때만 보인다.**
> status/단계/상담상태 등 추적 대상은 거의 select 타입. 텍스트/숫자는 추적 의미 없어 노출 안 함 → UI 단순.

### 4.1 CreateFieldDialog
select 타입 선택 시에만 체크박스 노출 (옵션 입력 블록 근처):
```tsx
const [trackHistory, setTrackHistory] = useState(false);
// resetForm에 setTrackHistory(false)

{fieldType === "select" && (
  <div className="flex items-center gap-2">
    <Checkbox id="trackHistory" checked={trackHistory}
      onCheckedChange={(c) => setTrackHistory(c === true)} />
    <Label htmlFor="trackHistory">변경 이력 추적</Label>
  </div>
)}
// 안내: "이 필드가 바뀌면 변경 이력(타임라인)에 기록됩니다."

// 커스텀 submit 페이로드에 trackHistory 추가 (fieldType==='select'일 때만 의미)
```
> 시스템 필드(systemColumn)는 select 아니므로 자연히 노출 안 됨.

### 4.2 EditFieldDialog
- `field.fieldType === "select"`일 때만 "변경 이력 추적" 체크박스 (field.trackHistory 초기값)

---

## 5. API

### 5.1 필드 생성 — `field-types/[id]/fields/route.ts` POST
```ts
const { ..., trackHistory } = await req.json();
// INSERT values에:
trackHistory: trackHistory ? 1 : 0,
```
> 시스템 필드 경로는 trackHistory 무시(0) — 시스템 값은 sendb UI 변경 대상 아님.

### 5.2 필드 수정 — `fields/[id]/route.ts` PATCH
```ts
if (typeof trackHistory === "boolean") updateData.trackHistory = trackHistory ? 1 : 0;
```

### 5.3 레코드 변경 감지 — `records/[id]/route.ts` PATCH (핵심)

기존 흐름에 추적 필드 diff 감지 추가:
```ts
import { insertRecordEvent } from "@/lib/record-events";
import { fieldDefinitions, partitions } from "@/lib/db";

// existing 조회 후, record UPDATE 전/후 어디서든 가능 (트랜잭션 권장)
// 1. 이 record의 추적 필드 목록
const resolvedTypeId = ... ; // partition.fieldTypeId ?? workspace.defaultFieldTypeId
const trackedFields = await db
    .select({ key: fieldDefinitions.key })
    .from(fieldDefinitions)
    .where(and(
        resolvedTypeId
            ? eq(fieldDefinitions.fieldTypeId, resolvedTypeId)
            : eq(fieldDefinitions.workspaceId, existing.workspaceId),
        eq(fieldDefinitions.trackHistory, 1),
    ));

// 2. before/after 비교 → 바뀐 추적 필드만 이벤트
const before = existing.data as Record<string, unknown>;
for (const { key } of trackedFields) {
    if (!(key in sanitized)) continue;            // 이번 PATCH에 없으면 skip
    const fromVal = before[key];
    const toVal = sanitized[key];
    if (toVal === fromVal) continue;              // 같으면 skip
    if (toVal === undefined) continue;
    await insertRecordEvent({
        orgId: existing.orgId,
        recordId,
        event: {
            type: key,
            label: String(toVal ?? ""),
            occurredAt: new Date(),
            meta: { field: key, from: fromVal ?? null, to: toVal ?? null, by: user.userId },
        },
    });
}

// 3. 기존 record UPDATE
```

#### partition 정보 필요
추적 필드 조회에 `field_type_id`가 필요 → existing record로부터 partition 조회. 기존 PATCH는 partition을 안 읽으므로 추가 쿼리 1번:
```ts
const [partition] = await db
    .select({ fieldTypeId: partitions.fieldTypeId, workspaceId: partitions.workspaceId })
    .from(partitions).where(eq(partitions.id, existing.partitionId));
// resolvedTypeId = partition.fieldTypeId ?? (워크스페이스 defaultFieldTypeId 조회 필요 시)
```
> 최적화: 추적 필드가 하나도 없는 워크스페이스가 대부분이면, 먼저 trackedFields 조회 후 비어있으면 즉시 skip. (partition→type 한 번, fieldDefs 한 번)

### 5.4 적용 위치 — UPDATE 전후
- record UPDATE와 이벤트 INSERT를 한 트랜잭션에 묶으면 원자적. 단 기존 PATCH가 트랜잭션 아님 → 묶을지(권장) 별도일지 구현 시 결정. 최소: UPDATE 성공 후 이벤트 best-effort.

---

## 6. 작업 분해 (체크리스트)

### DB/타입
- [ ] `0049_field_track_history.sql` + journal
- [ ] schema.ts trackHistory
- [ ] FieldDefinition/CreateFieldInput/UpdateFieldInput에 trackHistory

### UI
- [ ] CreateFieldDialog 체크박스 (커스텀 영역)
- [ ] EditFieldDialog 체크박스 (시스템 필드 제외)

### API
- [ ] 필드 생성 POST — trackHistory 저장
- [ ] 필드 수정 PATCH — trackHistory 갱신
- [ ] records PATCH — 추적 필드 diff 감지 → insertRecordEvent

### 검증 (로컬, 운영 복원본)
- [ ] status에 추적 켜고 신규→연락중 → record_events 기록 (type=status, from/to/by)
- [ ] 추적 안 켠 필드 변경 → 이력 없음
- [ ] 셀 인라인 편집 / 상세 수정 둘 다 기록
- [ ] 같은 값 저장 → 이력 안 쌓임
- [ ] 추적 필드 없는 워크스페이스 → 추가 부하/오류 없음

---

## 7. 검증 기준 (Plan §3.2)

| Plan 기준 | 검증 |
|---|---|
| status 변경 시 이력 + from/to | 로컬 PATCH 후 record_events 확인 |
| 추적 안 켠 필드 무시 | 이름 변경 → 이력 0 |
| 셀/상세 모두 잡힘 | 두 경로 PATCH 확인 |

---

## 8. 결정사항 (확정)

- **D-Q1.** record UPDATE + 이벤트 INSERT를 **트랜잭션으로 묶는다** (원자적). PATCH를 `db.transaction`으로 감싼다.
- **D-Q2.** partition.fieldTypeId가 null이면 워크스페이스 `defaultFieldTypeId` 폴백 — records 목록 API의 resolvedTypeId 패턴 재사용.
- **D-Q3.** select 값(저장된 문자열) 그대로 label.
- **D-UI.** "변경 이력 추적" 토글은 `fieldType === "select"`일 때만 노출.
