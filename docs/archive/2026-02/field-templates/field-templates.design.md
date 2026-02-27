# Design: field-templates — 속성 템플릿

> **Plan 문서**: [field-templates.plan.md](../../01-plan/features/field-templates.plan.md)
> **Date**: 2026-02-19

## 1. 개요

사전 정의된 세일즈 속성 템플릿 4종을 제공하여, 워크스페이스 생성 시 또는 설정 페이지에서 한 번에 필요한 속성들을 일괄 생성할 수 있도록 한다.

## 2. 파일별 상세 설계

### File 1: `src/lib/field-templates.ts` (신규)

**역할**: 4종 템플릿 상수 정의

```typescript
import type { FieldType } from "@/types";

export interface FieldTemplateItem {
    key: string;
    label: string;
    fieldType: FieldType;
    category?: string;
    isRequired?: boolean;
    options?: string[];
}

export interface FieldTemplate {
    id: string;
    name: string;
    description: string;
    icon: string;       // lucide-react 아이콘 이름
    fields: FieldTemplateItem[];
}

export const FIELD_TEMPLATES: FieldTemplate[] = [
    {
        id: "b2b-sales",
        name: "B2B 영업",
        description: "기업 대상 영업 관리에 필요한 기본 속성",
        icon: "Building2",
        fields: [
            { key: "companyName", label: "회사명", fieldType: "text", isRequired: true },
            { key: "contactName", label: "담당자명", fieldType: "text", isRequired: true },
            { key: "contactTitle", label: "직책", fieldType: "text" },
            { key: "phone", label: "전화번호", fieldType: "phone" },
            { key: "email", label: "이메일", fieldType: "email" },
            { key: "address", label: "회사주소", fieldType: "text" },
            { key: "salesStage", label: "영업단계", fieldType: "select", options: ["리드", "미팅", "제안", "협상", "계약", "완료", "실패"] },
            { key: "expectedAmount", label: "예상금액", fieldType: "currency" },
            { key: "memo", label: "메모", fieldType: "textarea" },
        ],
    },
    {
        id: "b2c-sales",
        name: "B2C 영업",
        description: "개인 고객 대상 영업 관리",
        icon: "UserRound",
        fields: [
            { key: "customerName", label: "고객명", fieldType: "text", isRequired: true },
            { key: "phone", label: "전화번호", fieldType: "phone", isRequired: true },
            { key: "email", label: "이메일", fieldType: "email" },
            { key: "address", label: "주소", fieldType: "text" },
            { key: "interest", label: "관심상품", fieldType: "text" },
            { key: "status", label: "상태", fieldType: "select", options: ["상담중", "구매예정", "구매완료", "이탈"] },
            { key: "memo", label: "메모", fieldType: "textarea" },
        ],
    },
    {
        id: "real-estate",
        name: "부동산",
        description: "부동산 매물 및 고객 관리",
        icon: "Home",
        fields: [
            { key: "customerName", label: "고객명", fieldType: "text", isRequired: true },
            { key: "phone", label: "전화번호", fieldType: "phone", isRequired: true },
            { key: "email", label: "이메일", fieldType: "email" },
            { key: "region", label: "관심지역", fieldType: "text" },
            { key: "budget", label: "예산", fieldType: "currency" },
            { key: "propertyType", label: "매물유형", fieldType: "select", options: ["아파트", "빌라", "오피스텔", "상가", "토지", "기타"] },
            { key: "contractStatus", label: "계약상태", fieldType: "select", options: ["상담", "매물확인", "계약진행", "계약완료", "취소"] },
            { key: "memo", label: "메모", fieldType: "textarea" },
        ],
    },
    {
        id: "hr-management",
        name: "인력 관리",
        description: "직원 및 인력 정보 관리",
        icon: "Users",
        fields: [
            { key: "name", label: "이름", fieldType: "text", isRequired: true },
            { key: "phone", label: "전화번호", fieldType: "phone" },
            { key: "email", label: "이메일", fieldType: "email" },
            { key: "department", label: "소속", fieldType: "text" },
            { key: "position", label: "직급", fieldType: "text" },
            { key: "joinDate", label: "입사일", fieldType: "date" },
            { key: "status", label: "상태", fieldType: "select", options: ["재직", "휴직", "퇴직"] },
            { key: "memo", label: "메모", fieldType: "textarea" },
        ],
    },
];
```

---

### File 2: `src/pages/api/workspaces/[id]/fields/bulk.ts` (신규)

**역할**: 속성 일괄 생성 API

- **Method**: POST
- **Auth**: getUserFromRequest + role !== "member"
- **Body**: `{ fields: Array<{ key, label, fieldType, category?, isRequired?, options? }> }`

**구현 사양**:

```typescript
import type { NextApiRequest, NextApiResponse } from "next";
import { db, workspaces, fieldDefinitions, partitions } from "@/lib/db";
import { eq, and, max } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";
```

1. POST 전용, 405 for 기타 메서드
2. getUserFromRequest → 401, role === "member" → 403
3. workspaceId = Number(req.query.id), !workspaceId → 400
4. `const { fields } = req.body` — `!Array.isArray(fields) || fields.length === 0` → 400
5. 워크스페이스 소유권 검증: db.select workspaces where id = workspaceId AND orgId = user.orgId → 404
6. 기존 key 목록 조회: `db.select({ key: fieldDefinitions.key }).from(fieldDefinitions).where(eq(fieldDefinitions.workspaceId, workspaceId))` → `existingKeys: Set<string>`
7. 현재 max sortOrder 조회: `db.select({ maxSort: max(fieldDefinitions.sortOrder) }).from(fieldDefinitions).where(...)`
8. FIELD_TYPE_TO_CELL_TYPE 매핑 (기존 fields.ts와 동일 상수)

```typescript
const FIELD_TYPE_TO_CELL_TYPE: Record<string, string> = {
    text: "editable", number: "editable", currency: "currency",
    date: "date", datetime: "date", select: "select",
    phone: "phone", email: "email", textarea: "textarea",
    checkbox: "checkbox", file: "file", formula: "formula",
    user_select: "user_select",
};
const VALID_FIELD_TYPES = Object.keys(FIELD_TYPE_TO_CELL_TYPE);
```

9. 유효한 필드 필터링:
   - `key`가 existingKeys에 있으면 skip (중복)
   - `fieldType`이 VALID_FIELD_TYPES에 없으면 skip
   - `!key || !label` 이면 skip
   - key 정규식 검증: `/^[a-zA-Z][a-zA-Z0-9]*$/` 실패 시 skip
10. 필터링 결과: `fieldsToCreate` 배열 + `skippedCount`
11. `fieldsToCreate`가 비어있으면 → `{ success: true, data: { created: 0, skipped: skippedCount, total: fields.length } }`
12. `db.transaction` 내에서 순차 insert:
    ```typescript
    let currentSort = (maxResult?.maxSort ?? -1) + 1;
    const createdKeys: string[] = [];

    await db.transaction(async (tx) => {
        for (const f of fieldsToCreate) {
            await tx.insert(fieldDefinitions).values({
                workspaceId,
                key: f.key.trim(),
                label: f.label.trim(),
                fieldType: f.fieldType,
                cellType: FIELD_TYPE_TO_CELL_TYPE[f.fieldType] || "editable",
                category: f.category?.trim() || null,
                isRequired: f.isRequired ? 1 : 0,
                isSystem: 0,
                sortOrder: currentSort,
                defaultWidth: 120,
                minWidth: 80,
                options: f.fieldType === "select" && f.options?.length ? f.options : null,
            });
            createdKeys.push(f.key.trim());
            currentSort++;
        }
    });
    ```
13. 트랜잭션 후 파티션 visibleFields 동기화:
    ```typescript
    const partitionList = await db
        .select({ id: partitions.id, visibleFields: partitions.visibleFields })
        .from(partitions)
        .where(eq(partitions.workspaceId, workspaceId));

    for (const p of partitionList) {
        const current = (p.visibleFields as string[]) || [];
        const newKeys = createdKeys.filter((k) => !current.includes(k));
        if (newKeys.length > 0) {
            await db.update(partitions).set({
                visibleFields: [...current, ...newKeys],
                updatedAt: new Date(),
            }).where(eq(partitions.id, p.id));
        }
    }
    ```
14. 응답: `{ success: true, data: { created: createdKeys.length, skipped: skippedCount, total: fields.length } }`
15. try-catch: console.error("Bulk fields create error:", error) → 500

---

### File 3: `src/components/settings/TemplatePickerDialog.tsx` (신규)

**역할**: 템플릿 선택 다이얼로그

**Props**:
```typescript
interface TemplatePickerDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSelect: (templateId: string) => void;
    isApplying: boolean;
}
```

**imports**:
```typescript
import { useState } from "react";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, UserRound, Home, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { FIELD_TEMPLATES } from "@/lib/field-templates";
```

**아이콘 매핑**:
```typescript
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
    Building2, UserRound, Home, Users,
};
```

**상태**: `const [selectedId, setSelectedId] = useState<string | null>(null)`

**UI 구조**:
- DialogContent className="max-w-2xl"
- DialogTitle: "속성 템플릿 선택"
- 설명 텍스트: `<p className="text-sm text-muted-foreground">` "세일즈 업무에 맞는 템플릿을 선택하면 필요한 속성이 자동으로 추가됩니다."
- 템플릿 카드 그리드: `<div className="grid grid-cols-2 gap-3">`
  - FIELD_TEMPLATES.map으로 4개 카드 렌더
  - 각 카드:
    - `<Card>` onClick={() => setSelectedId(t.id)}, cursor-pointer, hover:border-primary/50
    - 선택 시: `border-primary ring-1 ring-primary`
    - CardContent className="p-4"
      - 상단: 아이콘(h-5 w-5 text-muted-foreground) + name(font-medium)을 flex items-center gap-2로
      - 중간: description을 `text-sm text-muted-foreground mt-1`로
      - 하단: fields를 `flex flex-wrap gap-1 mt-3`으로 Badge(variant="outline") 표시, 각 Badge에 field.label 텍스트, className="text-xs"
- DialogFooter:
  - "취소" Button variant="outline", onClick={() => onOpenChange(false), disabled={isApplying}
  - "적용" Button onClick={() => selectedId && onSelect(selectedId), disabled={!selectedId || isApplying}
  - 적용 버튼 텍스트: isApplying ? "적용 중..." : "적용"

---

### File 4: `src/hooks/useFieldManagement.ts` (수정)

**변경**: `applyTemplate` 함수 추가

기존 return에 `applyTemplate` 추가:

```typescript
import { FIELD_TEMPLATES } from "@/lib/field-templates";

// 기존 createField, updateField, deleteField, reorderFields 유지

const applyTemplate = async (templateId: string) => {
    const template = FIELD_TEMPLATES.find((t) => t.id === templateId);
    if (!template) return { success: false, error: "템플릿을 찾을 수 없습니다." };

    const res = await fetch(`/api/workspaces/${workspaceId}/fields/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: template.fields }),
    });
    const result = await res.json();
    if (result.success) mutate();
    return result;
};

return { createField, updateField, deleteField, reorderFields, applyTemplate };
```

---

### File 5: `src/components/settings/FieldManagementTab.tsx` (수정)

**변경**: "템플릿으로 시작" 버튼 추가 + TemplatePickerDialog 연동

**추가 import**:
```typescript
import { LayoutTemplate } from "lucide-react";
import TemplatePickerDialog from "./TemplatePickerDialog";
import { toast } from "sonner";
```

**추가 상태**:
```typescript
const [templateOpen, setTemplateOpen] = useState(false);
const [isApplying, setIsApplying] = useState(false);
```

**useFieldManagement 디스트럭처링 수정**:
```typescript
const { createField, updateField, deleteField, reorderFields, applyTemplate } = useFieldManagement(selectedId, mutate);
```

**handleApplyTemplate 핸들러**:
```typescript
const handleApplyTemplate = async (templateId: string) => {
    setIsApplying(true);
    try {
        const result = await applyTemplate(templateId);
        if (result.success) {
            const { created, skipped } = result.data;
            if (created > 0 && skipped > 0) {
                toast.success(`${created}개 속성이 추가되었습니다. ${skipped}개는 이미 존재하여 건너뛰었습니다.`);
            } else if (created > 0) {
                toast.success(`${created}개 속성이 추가되었습니다.`);
            } else {
                toast.info("이미 모든 속성이 존재합니다.");
            }
            setTemplateOpen(false);
        } else {
            toast.error(result.error || "템플릿 적용에 실패했습니다.");
        }
    } catch {
        toast.error("서버에 연결할 수 없습니다.");
    } finally {
        setIsApplying(false);
    }
};
```

**UI 변경**: 기존 "속성 목록" 헤더 바의 버튼 영역에 "템플릿으로 시작" 버튼 추가

기존:
```tsx
<div className="flex items-center justify-between">
    <h3 className="text-lg font-medium">속성 목록</h3>
    <Button onClick={() => setCreateOpen(true)} size="sm">
        <Plus className="h-4 w-4 mr-1" />
        속성 추가
    </Button>
</div>
```

변경 후:
```tsx
<div className="flex items-center justify-between">
    <h3 className="text-lg font-medium">속성 목록</h3>
    <div className="flex gap-2">
        <Button variant="outline" onClick={() => setTemplateOpen(true)} size="sm">
            <LayoutTemplate className="h-4 w-4 mr-1" />
            템플릿으로 시작
        </Button>
        <Button onClick={() => setCreateOpen(true)} size="sm">
            <Plus className="h-4 w-4 mr-1" />
            속성 추가
        </Button>
    </div>
</div>
```

**TemplatePickerDialog 렌더**: 기존 다이얼로그들 아래에 추가
```tsx
<TemplatePickerDialog
    open={templateOpen}
    onOpenChange={setTemplateOpen}
    onSelect={handleApplyTemplate}
    isApplying={isApplying}
/>
```

---

### File 6: `src/components/settings/CreateWorkspaceDialog.tsx` (수정)

**변경**: 워크스페이스 생성 후 템플릿 선택 단계 추가

**추가 import**:
```typescript
import { FIELD_TEMPLATES } from "@/lib/field-templates";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, UserRound, Home, Users } from "lucide-react";
import { cn } from "@/lib/utils";
```

**Props 변경**: onSubmit의 반환 타입에 `data?: { id: number }` 이미 포함되어 있음 (그대로 유지)

**추가 상태**:
```typescript
const [step, setStep] = useState<"info" | "template">("info");
const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
const [createdWorkspaceId, setCreatedWorkspaceId] = useState<number | null>(null);
```

**resetForm 수정**: 기존 + `setStep("info"); setSelectedTemplate(null); setCreatedWorkspaceId(null);`

**아이콘 매핑** (TemplatePickerDialog와 동일):
```typescript
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
    Building2, UserRound, Home, Users,
};
```

**handleSubmit 수정**: step에 따라 분기

```typescript
const handleSubmit = async () => {
    if (step === "info") {
        // 기존 워크스페이스 생성 로직
        if (!name.trim()) { toast.error("이름을 입력해주세요."); return; }
        setIsSubmitting(true);
        try {
            const result = await onSubmit({ name: name.trim(), description: description.trim() || undefined, icon: icon.trim() || undefined });
            if (result.success && result.data?.id) {
                setCreatedWorkspaceId(result.data.id);
                setStep("template");
            } else {
                toast.error(result.error || "생성에 실패했습니다.");
            }
        } catch { toast.error("서버에 연결할 수 없습니다."); }
        finally { setIsSubmitting(false); }
    } else {
        // 템플릿 적용 후 닫기
        if (selectedTemplate && createdWorkspaceId) {
            setIsSubmitting(true);
            try {
                const template = FIELD_TEMPLATES.find((t) => t.id === selectedTemplate);
                if (template) {
                    const res = await fetch(`/api/workspaces/${createdWorkspaceId}/fields/bulk`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ fields: template.fields }),
                    });
                    const result = await res.json();
                    if (result.success) {
                        toast.success(`워크스페이스가 생성되었습니다. ${result.data.created}개 속성이 추가되었습니다.`);
                    }
                }
            } catch { /* ignore */ }
            finally { setIsSubmitting(false); }
        } else {
            toast.success("워크스페이스가 생성되었습니다.");
        }
        resetForm();
        onOpenChange(false);
    }
};
```

**UI 변경**: DialogContent 내부를 step에 따라 분기

step === "info" 일 때: 기존 폼 (이름, 설명, 아이콘) 그대로

step === "template" 일 때:
```tsx
<div className="space-y-4">
    <p className="text-sm text-muted-foreground">
        속성 템플릿을 선택하면 필요한 속성이 자동으로 추가됩니다.
        건너뛰기를 클릭하면 빈 상태로 시작합니다.
    </p>
    <div className="grid grid-cols-2 gap-3">
        {FIELD_TEMPLATES.map((t) => {
            const Icon = ICON_MAP[t.icon];
            return (
                <Card
                    key={t.id}
                    className={cn(
                        "cursor-pointer hover:border-primary/50 transition-colors",
                        selectedTemplate === t.id && "border-primary ring-1 ring-primary"
                    )}
                    onClick={() => setSelectedTemplate(t.id)}
                >
                    <CardContent className="p-4">
                        <div className="flex items-center gap-2">
                            {Icon && <Icon className="h-5 w-5 text-muted-foreground" />}
                            <span className="font-medium">{t.name}</span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{t.description}</p>
                        <div className="flex flex-wrap gap-1 mt-3">
                            {t.fields.map((f) => (
                                <Badge key={f.key} variant="outline" className="text-xs">
                                    {f.label}
                                </Badge>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            );
        })}
    </div>
</div>
```

**DialogTitle**: step === "info" ? "워크스페이스 추가" : "속성 템플릿 선택"

**DialogFooter**: step에 따라 분기

step === "info":
```tsx
<Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>취소</Button>
<Button onClick={handleSubmit} disabled={isSubmitting}>{isSubmitting ? "생성 중..." : "다음"}</Button>
```

step === "template":
```tsx
<Button variant="outline" onClick={() => { resetForm(); onOpenChange(false); }} disabled={isSubmitting}>건너뛰기</Button>
<Button onClick={handleSubmit} disabled={isSubmitting}>{isSubmitting ? "적용 중..." : selectedTemplate ? "적용" : "건너뛰기"}</Button>
```

**DialogContent**: className을 `step === "template" ? "max-w-2xl" : "max-w-md"` 로 동적 변경

---

## 3. 구현 순서

| # | 파일 | 의존성 |
|---|------|--------|
| 1 | `src/lib/field-templates.ts` | 없음 |
| 2 | `src/pages/api/workspaces/[id]/fields/bulk.ts` | field-templates.ts (검증 참조), schema |
| 3 | `src/hooks/useFieldManagement.ts` | bulk API, field-templates.ts |
| 4 | `src/components/settings/TemplatePickerDialog.tsx` | field-templates.ts |
| 5 | `src/components/settings/FieldManagementTab.tsx` | TemplatePickerDialog, useFieldManagement |
| 6 | `src/components/settings/CreateWorkspaceDialog.tsx` | bulk API, field-templates.ts |

## 4. 검증 기준

| # | 항목 | 방법 |
|---|------|------|
| V-01 | `npx next build` 성공 | 빌드 |
| V-02 | B2B 영업 템플릿 적용 시 9개 속성 생성 | 설정 > 속성 관리 > 템플릿으로 시작 |
| V-03 | 중복 key skip | 이미 속성이 있는 워크스페이스에 템플릿 재적용 |
| V-04 | 워크스페이스 생성 시 템플릿 선택 → 속성 자동 추가 | 워크스페이스 추가 다이얼로그 |
| V-05 | 건너뛰기 시 빈 상태로 워크스페이스 생성 | 건너뛰기 버튼 |
| V-06 | 4종 템플릿 카드 렌더 + 속성 미리보기 | TemplatePickerDialog |
| V-07 | 파티션 visibleFields에 새 속성 포함 | bulk 생성 후 파티션 확인 |
| V-08 | toast 메시지 정확 | 생성/skip/전체skip 각 케이스 |
