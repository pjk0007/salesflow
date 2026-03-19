# Design: duplicate-prevention (중복 방지 기능)

> Plan 참조: `docs/01-plan/features/duplicate-prevention.plan.md`

## 1. DB 스키마 변경

### 1-1. emailTemplateLinks: preventDuplicate 추가

```typescript
// src/lib/db/schema.ts — emailTemplateLinks 테이블
preventDuplicate: integer("prevent_duplicate").default(0).notNull(),
// isActive 바로 위에 추가
```

```sql
ALTER TABLE email_template_links ADD COLUMN prevent_duplicate INTEGER DEFAULT 0 NOT NULL;
```

### 1-2. emailAutoPersonalizedLinks: preventDuplicate 추가

```typescript
// src/lib/db/schema.ts — emailAutoPersonalizedLinks 테이블
preventDuplicate: integer("prevent_duplicate").default(0).notNull(),
// isActive 바로 위에 추가
```

```sql
ALTER TABLE email_auto_personalized_links ADD COLUMN prevent_duplicate INTEGER DEFAULT 0 NOT NULL;
```

### 1-3. partitions: duplicateConfig 추가

```typescript
// src/lib/db/schema.ts — partitions 테이블
duplicateConfig: jsonb("duplicate_config").$type<{
    field: string;
    action: "reject" | "allow" | "merge" | "delete_old";
    highlightEnabled: boolean;
    highlightColor: string; // hex, e.g. "#FEF3C7"
} | null>(),
// duplicateCheckField 바로 아래에 추가
```

```sql
ALTER TABLE partitions ADD COLUMN duplicate_config JSONB;
```

### 1-4. types/index.ts 타입 확장

```typescript
// Partition 타입에 추가
export interface DuplicateConfig {
    field: string;
    action: "reject" | "allow" | "merge" | "delete_old";
    highlightEnabled: boolean;
    highlightColor: string;
}
```

---

## 2. Feature A: 이메일 중복 발송 방지

### 2-1. 중복 체크 함수 (email-automation.ts)

```typescript
// src/lib/email-automation.ts — checkEmailCooldown 아래에 추가

async function checkDuplicateRecipient(
    templateLinkId: number,
    recipientEmail: string
): Promise<boolean> {
    const [existing] = await db
        .select({ id: emailSendLogs.id })
        .from(emailSendLogs)
        .where(
            and(
                eq(emailSendLogs.templateLinkId, templateLinkId),
                eq(emailSendLogs.recipientEmail, recipientEmail),
                eq(emailSendLogs.status, "sent")
            )
        )
        .limit(1);
    return !existing; // true = 발송 가능
}
```

**호출 위치**: `sendEmailSingle()` 함수 내부, 쿨다운 체크 직후

```typescript
// sendEmailSingle 내부 — 쿨다운 체크 이후
if (link.preventDuplicate) {
    const recipientEmail = record.data[link.recipientField] as string;
    if (recipientEmail) {
        const canSend = await checkDuplicateRecipient(link.id, recipientEmail);
        if (!canSend) {
            console.log(`[EmailAuto] Duplicate recipient skipped: linkId=${link.id}, email=${recipientEmail}`);
            return;
        }
    }
}
```

### 2-2. 중복 체크 함수 (auto-personalized-email.ts)

```typescript
// src/lib/auto-personalized-email.ts — checkCooldown 아래에 추가

async function checkDuplicateRecipient(
    linkId: number,
    recipientEmail: string
): Promise<boolean> {
    const [existing] = await db
        .select({ id: emailSendLogs.id })
        .from(emailSendLogs)
        .where(
            and(
                eq(emailSendLogs.triggerType, "ai_auto"),
                eq(emailSendLogs.recipientEmail, recipientEmail),
                eq(emailSendLogs.status, "sent"),
                // linkId는 emailSendLogs에 templateLinkId가 없으므로
                // partitionId + triggerType 기반으로 체크
                eq(emailSendLogs.partitionId, linkId) // 주의: 아래 참고
            )
        )
        .limit(1);
    return !existing;
}
```

**수정**: AI auto에는 `templateLinkId`가 없으므로, `partitionId + recipientEmail + triggerType="ai_auto"` 조합으로 체크.

```typescript
async function checkDuplicateRecipientForAiAuto(
    partitionId: number,
    recipientEmail: string
): Promise<boolean> {
    const [existing] = await db
        .select({ id: emailSendLogs.id })
        .from(emailSendLogs)
        .where(
            and(
                eq(emailSendLogs.partitionId, partitionId),
                eq(emailSendLogs.recipientEmail, recipientEmail),
                eq(emailSendLogs.triggerType, "ai_auto"),
                eq(emailSendLogs.status, "sent")
            )
        )
        .limit(1);
    return !existing;
}
```

**호출 위치**: `processAutoPersonalizedEmail()` → 각 link 순회 내, 쿨다운 체크 직후

```typescript
if (link.preventDuplicate) {
    const recipientEmail = record.data[link.recipientField] as string;
    if (recipientEmail) {
        const canSend = await checkDuplicateRecipientForAiAuto(link.partitionId, recipientEmail);
        if (!canSend) {
            console.log(`[AutoEmail] Duplicate recipient skipped: partitionId=${link.partitionId}, email=${recipientEmail}`);
            continue;
        }
    }
}
```

### 2-3. API 수정

#### POST /api/email/template-links (생성)

```typescript
// src/app/api/email/template-links/route.ts — POST body에서 추출
const { ..., preventDuplicate = 0 } = await req.json();

// insert values에 추가
.values({
    ...,
    preventDuplicate: preventDuplicate ? 1 : 0,
})
```

#### PUT /api/email/template-links/[id] (수정)

```typescript
// src/app/api/email/template-links/[id]/route.ts — destructuring에 추가
const { ..., preventDuplicate } = await req.json();

// updateData에 추가
if (preventDuplicate !== undefined) updateData.preventDuplicate = preventDuplicate ? 1 : 0;
```

#### POST /api/email/auto-personalized (생성)

```typescript
// src/app/api/email/auto-personalized/route.ts — POST body에서 추출
const { ..., preventDuplicate = 0 } = await req.json();

// insert values에 추가
preventDuplicate: preventDuplicate ? 1 : 0,
```

#### PUT /api/email/auto-personalized/[id] (수정)

```typescript
// src/app/api/email/auto-personalized/[id]/route.ts — destructuring에 추가
const { ..., preventDuplicate } = body;

// updateData에 추가
if (preventDuplicate !== undefined) updateData.preventDuplicate = preventDuplicate ? 1 : 0;
```

#### GET /api/email/auto-personalized (조회)

```typescript
// select에 preventDuplicate 추가
preventDuplicate: emailAutoPersonalizedLinks.preventDuplicate,
```

### 2-4. UI: 템플릿 자동발송 Switch

**파일**: `src/components/email/EmailTemplateLinkList.tsx`

규칙 생성/수정 폼에 Switch 추가:

```tsx
<div className="flex items-center justify-between">
    <Label htmlFor="preventDuplicate">중복 발송 방지</Label>
    <Switch
        id="preventDuplicate"
        checked={formData.preventDuplicate === 1}
        onCheckedChange={(checked) =>
            setFormData({ ...formData, preventDuplicate: checked ? 1 : 0 })
        }
    />
</div>
<p className="text-xs text-muted-foreground">
    같은 수신자에게 이미 발송된 이력이 있으면 재발송하지 않습니다.
</p>
```

### 2-5. UI: AI 자동발송 Switch

**파일**: `src/app/email/ai-auto/[id]/page.tsx` 또는 `src/app/email/ai-auto/new/page.tsx`

설정 폼 내 Switch 추가 (2-4와 동일한 패턴):

```tsx
<div className="flex items-center justify-between">
    <Label htmlFor="preventDuplicate">중복 발송 방지</Label>
    <Switch
        id="preventDuplicate"
        checked={formData.preventDuplicate === 1}
        onCheckedChange={(checked) =>
            setFormData({ ...formData, preventDuplicate: checked ? 1 : 0 })
        }
    />
</div>
<p className="text-xs text-muted-foreground">
    같은 수신자에게 이미 AI 이메일이 발송된 이력이 있으면 재발송하지 않습니다.
</p>
```

---

## 3. Feature B: 파티션 중복 관리

### 3-1. 레코드 생성 API — 액션 분기

**파일**: `src/app/api/partitions/[id]/records/route.ts`

기존 `duplicateCheckField` 로직(213~236행)을 `duplicateConfig` 우선 → fallback으로 교체:

```typescript
// 중복 체크 (duplicateConfig 우선, fallback to duplicateCheckField)
const dupConfig = partition.duplicateConfig;
const dupField = dupConfig?.field || partition.duplicateCheckField;

if (dupField) {
    const checkValue = recordData[dupField];
    if (checkValue) {
        const [duplicate] = await db
            .select({ id: records.id, data: records.data })
            .from(records)
            .where(
                and(
                    eq(records.partitionId, partitionId),
                    sql`${records.data}->>${dupField} = ${String(checkValue)}`
                )
            )
            .limit(1);

        if (duplicate) {
            const action = dupConfig?.action || "reject";

            switch (action) {
                case "reject":
                    return NextResponse.json({
                        success: false,
                        error: `중복된 데이터가 존재합니다. (${dupField}: ${checkValue})`,
                    }, { status: 409 });

                case "allow":
                    // 그대로 진행 (중복 허용)
                    break;

                case "merge":
                    // 기존 레코드에 새 데이터 병합
                    const mergedData = { ...(duplicate.data as Record<string, unknown>), ...recordData };
                    await db
                        .update(records)
                        .set({ data: mergedData, updatedAt: new Date() })
                        .where(eq(records.id, duplicate.id));
                    return NextResponse.json({
                        success: true,
                        data: { ...duplicate, data: mergedData },
                        merged: true,
                    });

                case "delete_old":
                    // 기존 삭제 후 아래 생성 로직 진행
                    await db.delete(records).where(eq(records.id, duplicate.id));
                    break;
            }
        }
    }
}
```

### 3-2. 외부 API 동일 적용

**파일**: `src/app/api/v1/records/route.ts`

POST 핸들러의 중복 체크 로직(195~213행)을 3-1과 동일 패턴으로 교체.

### 3-3. 파티션 설정 API — duplicateConfig 반영

**파일**: `src/app/api/partitions/[id]/route.ts` — PATCH 핸들러

```typescript
// 75행 destructuring에 추가
const { name, folderId, useDistributionOrder, maxDistributionOrder, distributionDefaults, duplicateConfig } = await req.json();

// updateData에 추가 (116행 이후)
if (duplicateConfig !== undefined) {
    updateData.duplicateConfig = duplicateConfig;
    // duplicateCheckField도 동기화 (하위호환)
    updateData.duplicateCheckField = duplicateConfig?.field || null;
}
```

### 3-4. RecordTable 행 색상 표시

**파일**: `src/components/records/RecordTable.tsx`

Props 추가:

```typescript
interface RecordTableProps {
    // ... 기존 props
    duplicateConfig?: DuplicateConfig | null;
    duplicateRecordIds?: Set<number>; // 중복 레코드 ID 집합
}
```

TableRow에 조건부 배경색:

```tsx
<TableRow
    key={record.id}
    className={cn(
        "cursor-pointer hover:bg-muted/50",
        selectedIds.has(record.id) && "bg-muted"
    )}
    style={
        duplicateConfig?.highlightEnabled &&
        duplicateRecordIds?.has(record.id)
            ? { backgroundColor: duplicateConfig.highlightColor + "33" } // 20% opacity
            : undefined
    }
>
```

### 3-5. 중복 레코드 감지 로직

**파일**: `src/app/records/page.tsx`

레코드 목록 로드 후, `duplicateConfig.field` 기준으로 중복 ID를 계산:

```typescript
const duplicateRecordIds = useMemo(() => {
    if (!currentPartition?.duplicateConfig?.highlightEnabled) return new Set<number>();
    const field = currentPartition.duplicateConfig.field;
    const valueMap = new Map<string, number[]>();

    for (const record of allRecords) {
        const val = String(record.data?.[field] ?? "");
        if (!val) continue;
        const ids = valueMap.get(val) || [];
        ids.push(record.id);
        valueMap.set(val, ids);
    }

    const dupIds = new Set<number>();
    for (const ids of valueMap.values()) {
        if (ids.length > 1) ids.forEach((id) => dupIds.add(id));
    }
    return dupIds;
}, [allRecords, currentPartition?.duplicateConfig]);
```

RecordTable에 전달:

```tsx
<RecordTable
    // ... 기존 props
    duplicateConfig={currentPartition?.duplicateConfig}
    duplicateRecordIds={duplicateRecordIds}
/>
```

### 3-6. 파티션 설정 UI — 중복 설정 폼

**파일**: `src/app/records/page.tsx` — 파티션 설정 영역 (또는 별도 컴포넌트)

기존 파티션 설정에 중복 설정 섹션 추가:

```tsx
// DuplicateConfigSection (인라인 또는 별도 컴포넌트)
<div className="space-y-3">
    <Label>중복 관리</Label>

    {/* 중복 체크 필드 선택 */}
    <Select
        value={dupConfig.field || ""}
        onValueChange={(v) => setDupConfig({ ...dupConfig, field: v })}
    >
        <SelectTrigger><SelectValue placeholder="중복 기준 필드 선택" /></SelectTrigger>
        <SelectContent>
            {fields.map((f) => (
                <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
            ))}
        </SelectContent>
    </Select>

    {/* 중복 시 액션 */}
    {dupConfig.field && (
        <Select
            value={dupConfig.action}
            onValueChange={(v) => setDupConfig({ ...dupConfig, action: v as DuplicateConfig["action"] })}
        >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
                <SelectItem value="reject">거부 (409 에러)</SelectItem>
                <SelectItem value="allow">허용 (중복 그대로)</SelectItem>
                <SelectItem value="merge">병합 (기존에 덮어쓰기)</SelectItem>
                <SelectItem value="delete_old">교체 (기존 삭제 후 신규)</SelectItem>
            </SelectContent>
        </Select>
    )}

    {/* 행 색상 표시 */}
    {dupConfig.field && (
        <div className="flex items-center gap-3">
            <Switch
                checked={dupConfig.highlightEnabled}
                onCheckedChange={(v) => setDupConfig({ ...dupConfig, highlightEnabled: v })}
            />
            <Label>중복 행 색상 표시</Label>
            {dupConfig.highlightEnabled && (
                <input
                    type="color"
                    value={dupConfig.highlightColor || "#FEF3C7"}
                    onChange={(e) => setDupConfig({ ...dupConfig, highlightColor: e.target.value })}
                    className="w-8 h-8 rounded border cursor-pointer"
                />
            )}
        </div>
    )}
</div>
```

---

## 4. 구현 순서 체크리스트

```
Phase 1: Email Dedup
  [ ] 1. schema.ts — emailTemplateLinks.preventDuplicate 추가
  [ ] 2. schema.ts — emailAutoPersonalizedLinks.preventDuplicate 추가
  [ ] 3. drizzle migration 실행
  [ ] 4. email-automation.ts — checkDuplicateRecipient() 함수 + 호출
  [ ] 5. auto-personalized-email.ts — checkDuplicateRecipientForAiAuto() 함수 + 호출
  [ ] 6. API: template-links POST/PUT — preventDuplicate 반영
  [ ] 7. API: auto-personalized POST/PUT/GET — preventDuplicate 반영
  [ ] 8. UI: EmailTemplateLinkList — Switch 추가
  [ ] 9. UI: ai-auto/[id] & ai-auto/new — Switch 추가

Phase 2: Partition Dedup
  [ ] 10. schema.ts — partitions.duplicateConfig 추가
  [ ] 11. types/index.ts — DuplicateConfig 타입
  [ ] 12. drizzle migration 실행
  [ ] 13. API: partitions/[id]/records POST — 액션 분기 로직
  [ ] 14. API: v1/records POST — 동일 적용
  [ ] 15. API: partitions/[id] PATCH — duplicateConfig 반영
  [ ] 16. UI: records/page.tsx — duplicateRecordIds 계산
  [ ] 17. UI: RecordTable — 행 색상 표시
  [ ] 18. UI: 파티션 설정 — 중복 설정 폼
```

## 5. 하위 호환

| 항목 | 처리 |
|------|------|
| `duplicateCheckField` | 유지. `duplicateConfig` 없으면 기존 로직 그대로 작동 |
| `preventDuplicate` 미설정 | 기본값 0 = 기존 쿨다운만 적용 |
| `duplicateConfig` null | 기존 `duplicateCheckField` + reject 동작 |
| bulk-import | `duplicateConfig` 적용은 추후 확장 (현재 `duplicateCheckField` 유지) |
