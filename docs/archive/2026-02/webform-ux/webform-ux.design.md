# Design: webform-ux (웹 폼 UI/UX 개선)

## Plan 참조
- `docs/01-plan/features/webform-ux.plan.md`

## 아키텍처 개요

다이얼로그 기반 편집(max-w-6xl)을 전용 페이지로 전환. Pages Router 파일 기반 라우팅 활용.

```
/web-forms          → index.tsx (목록)
/web-forms/new      → new.tsx (생성)
/web-forms/[id]     → [id].tsx (편집)
```

기존 패턴 참조: `src/pages/email/templates/new.tsx`, `src/pages/email/templates/[id].tsx`

## 변경 파일 상세

### 1. `src/pages/web-forms/index.tsx` (수정 — 기존 `web-forms.tsx` 이동)

**목적**: 목록 전용 페이지. 생성/편집 다이얼로그 제거, 라우팅으로 전환.

**제거 항목**:
- 생성 다이얼로그 상태: `createOpen`, `newName`, `newTitle`, `newPartitionId`
- 편집 다이얼로그 상태: `editFormId`, `editLoading`, `fb*` 상태 10개
- 함수: `handleCreate`, `loadFormForEdit`, `handleEditOpen`, `handleSave`
- JSX: 생성 Dialog(L320-369), 편집 Dialog(L371-430)
- 불필요 임포트: `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `FormBuilder`, `FormPreview`, `Input`, `Label`, `Textarea` (FormBuilder 전용)

**유지 항목**:
- `WorkspaceLayout`, `useWorkspaces`, `usePartitions`, `useWebForms`
- 워크스페이스 선택, 카드 목록, `handleDelete`, `handleToggleActive`
- `EmbedCodeDialog` + `embedSlug` 상태 (임베드 다이얼로그는 적합)

**변경 내용**:
```tsx
// 상단 "새 폼 만들기" 버튼
import Link from "next/link";
import { useRouter } from "next/router";

// Button onClick → Link href
<Button asChild>
  <Link href="/web-forms/new">
    <Plus className="h-4 w-4 mr-1" /> 새 폼 만들기
  </Link>
</Button>

// 카드 편집 버튼
const router = useRouter();

<Button variant="outline" size="sm"
  onClick={() => router.push(`/web-forms/${form.id}`)}>
  <Pencil className="h-3 w-3 mr-1" /> 편집
</Button>
```

**임포트 정리**:
```tsx
import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { usePartitions } from "@/hooks/usePartitions";
import { useWebForms } from "@/hooks/useWebForms";
import EmbedCodeDialog from "@/components/web-forms/EmbedCodeDialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Pencil, Link2, Trash2, Eye, EyeOff } from "lucide-react";
```

### 2. `src/pages/web-forms/new.tsx` (신규)

**목적**: 폼 생성 전용 페이지. 이름/제목/파티션 입력 후 생성 → 편집 페이지로 이동.

**상태**:
```tsx
const [name, setName] = useState("");
const [title, setTitle] = useState("");
const [partitionId, setPartitionId] = useState<number | null>(null);
const [creating, setCreating] = useState(false);
```

**데이터 소스**:
- `useWorkspaces()` → 워크스페이스 선택 (1개면 자동 선택)
- `usePartitions(workspaceId)` → 파티션 목록
- `useWebForms(workspaceId).createForm` → 생성 API

**레이아웃**:
```
WorkspaceLayout
  └─ div.p-6.max-w-lg.mx-auto
       ├─ 뒤로가기 버튼 (← 웹 폼 목록)
       ├─ h1: "새 웹 폼"
       ├─ Card
       │   ├─ 폼 이름 Input
       │   ├─ 폼 제목 Input
       │   ├─ 파티션 Select
       │   └─ 생성 Button (disabled: !name || !title || !partitionId || creating)
       └─
```

**생성 후 흐름**:
```tsx
const handleCreate = async () => {
  setCreating(true);
  const result = await createForm({ name, workspaceId, partitionId, title });
  if (result.success) {
    router.push(`/web-forms/${result.data.id}`);
  } else {
    toast.error(result.error || "생성에 실패했습니다.");
    setCreating(false);
  }
};
```

### 3. `src/pages/web-forms/[id].tsx` (신규)

**목적**: 폼 편집 전용 페이지. 풀 너비 레이아웃으로 FormBuilder + FormPreview 배치.

**상태** (기존 `web-forms.tsx`의 `fb*` 상태를 이동):
```tsx
// 폼 데이터
const [loading, setLoading] = useState(true);
const [saving, setSaving] = useState(false);
const [formName, setFormName] = useState("");
const [formTitle, setFormTitle] = useState("");
const [formDescription, setFormDescription] = useState("");
const [completionTitle, setCompletionTitle] = useState("");
const [completionMessage, setCompletionMessage] = useState("");
const [completionButtonText, setCompletionButtonText] = useState("");
const [completionButtonUrl, setCompletionButtonUrl] = useState("");
const [defaultValues, setDefaultValues] = useState<{ field: string; value: string }[]>([]);
const [formFields, setFormFields] = useState<FormFieldItem[]>([]);
const [slug, setSlug] = useState("");
```

**데이터 로드**:
```tsx
const router = useRouter();
const formId = Number(router.query.id);

useEffect(() => {
  if (!formId) return;
  (async () => {
    const res = await fetch(`/api/web-forms/${formId}`);
    const json = await res.json();
    if (json.success) {
      const form = json.data;
      setFormName(form.name);
      setFormTitle(form.title);
      setFormDescription(form.description || "");
      setCompletionTitle(form.completionTitle || "제출이 완료되었습니다");
      setCompletionMessage(form.completionMessage || "");
      setCompletionButtonText(form.completionButtonText || "");
      setCompletionButtonUrl(form.completionButtonUrl || "");
      setDefaultValues(form.defaultValues || []);
      setSlug(form.slug);
      setFormFields(
        (form.fields || []).map((f: any) => ({
          tempId: crypto.randomUUID(),
          label: f.label,
          description: f.description || "",
          placeholder: f.placeholder || "",
          fieldType: f.fieldType,
          linkedFieldKey: f.linkedFieldKey || "",
          isRequired: !!f.isRequired,
          options: f.options || [],
        }))
      );
    } else {
      toast.error("폼을 찾을 수 없습니다.");
      router.push("/web-forms");
    }
    setLoading(false);
  })();
}, [formId]);
```

**저장**:
```tsx
const { updateForm } = useWebForms(/* workspaceId 불필요 - 직접 API 호출 */);

const handleSave = async () => {
  setSaving(true);
  const result = await updateForm(formId, {
    name: formName,
    title: formTitle,
    description: formDescription,
    completionTitle,
    completionMessage,
    completionButtonText,
    completionButtonUrl,
    defaultValues,
    fields: formFields.map((f) => ({
      label: f.label,
      description: f.description,
      placeholder: f.placeholder,
      fieldType: f.fieldType,
      linkedFieldKey: f.linkedFieldKey,
      isRequired: f.isRequired,
      options: f.options,
    })),
  });
  if (result.success) {
    toast.success("폼이 저장되었습니다.");
  } else {
    toast.error(result.error || "저장에 실패했습니다.");
  }
  setSaving(false);
};
```

참고: `useWebForms`에서 `updateForm`은 `id`를 직접 받으므로 `workspaceId` 없이도 호출 가능. 단, SWR 키가 null이라 mutate가 안 되지만 편집 페이지에서는 목록 갱신 불필요.

**레이아웃** (핵심 변경):
```
WorkspaceLayout
  └─ div.flex.flex-col.h-[calc(100vh-64px)]
       ├─ 헤더 (border-b px-6 py-3 flex items-center justify-between)
       │   ├─ 좌: 뒤로가기 + 폼 이름
       │   └─ 우: 임베드/링크 버튼 + 저장 버튼
       └─ 본문 (flex flex-1 overflow-hidden)
            ├─ FormBuilder (flex-1 overflow-y-auto p-6)
            └─ FormPreview (w-[400px] border-l p-6 overflow-y-auto sticky top-0)
```

**헤더 JSX**:
```tsx
<div className="border-b px-6 py-3 flex items-center justify-between">
  <div className="flex items-center gap-3">
    <Button variant="ghost" size="sm" onClick={() => router.push("/web-forms")}>
      <ArrowLeft className="h-4 w-4 mr-1" /> 목록
    </Button>
    <span className="text-lg font-semibold">{formName || "새 폼"}</span>
  </div>
  <div className="flex items-center gap-2">
    {slug && (
      <Button variant="outline" size="sm" onClick={() => setEmbedOpen(true)}>
        <Link2 className="h-4 w-4 mr-1" /> 임베드
      </Button>
    )}
    <Button onClick={handleSave} disabled={saving}>
      {saving ? "저장 중..." : "저장"}
    </Button>
  </div>
</div>
```

**본문 JSX**:
```tsx
<div className="flex flex-1 overflow-hidden">
  <div className="flex-1 overflow-y-auto p-6">
    <FormBuilder
      name={formName} onNameChange={setFormName}
      title={formTitle} onTitleChange={setFormTitle}
      description={formDescription} onDescriptionChange={setFormDescription}
      completionTitle={completionTitle} onCompletionTitleChange={setCompletionTitle}
      completionMessage={completionMessage} onCompletionMessageChange={setCompletionMessage}
      completionButtonText={completionButtonText} onCompletionButtonTextChange={setCompletionButtonText}
      completionButtonUrl={completionButtonUrl} onCompletionButtonUrlChange={setCompletionButtonUrl}
      defaultValues={defaultValues} onDefaultValuesChange={setDefaultValues}
      fields={formFields} onFieldsChange={setFormFields}
      workspaceFields={fields}
      slug={slug}
    />
  </div>
  <div className="w-[400px] border-l p-6 overflow-y-auto">
    <h3 className="text-sm font-medium mb-3">미리보기</h3>
    <FormPreview
      title={formTitle}
      description={formDescription}
      fields={formFields}
    />
  </div>
</div>
```

**임베드 다이얼로그**: 편집 페이지 내 `EmbedCodeDialog` 사용
```tsx
const [embedOpen, setEmbedOpen] = useState(false);
// ...
{slug && (
  <EmbedCodeDialog
    open={embedOpen}
    onOpenChange={setEmbedOpen}
    slug={slug}
  />
)}
```

**워크스페이스 필드**: `useFields` 훅 필요. formId의 workspaceId를 API 응답에서 추출.
```tsx
// API 응답의 form.workspaceId 사용
const [wsId, setWsId] = useState<number | null>(null);
const { fields } = useFields(wsId);

// useEffect 내 form 로드 시:
setWsId(form.workspaceId);
```

### 4. 기존 파일 삭제

- `src/pages/web-forms.tsx` → 삭제 (index.tsx로 대체)

### 5. 변경 없는 파일

| 파일 | 이유 |
|------|------|
| `src/components/web-forms/FormBuilder.tsx` | props 인터페이스 그대로 사용 |
| `src/components/web-forms/FormPreview.tsx` | props 인터페이스 그대로 사용 |
| `src/components/web-forms/EmbedCodeDialog.tsx` | 다이얼로그로 적합, 그대로 사용 |
| `src/hooks/useWebForms.ts` | CRUD 함수 그대로 사용 |
| `src/pages/api/web-forms/[id].ts` | API 변경 없음 |
| `src/pages/api/web-forms/index.ts` | API 변경 없음 |

## 구현 순서

| # | 파일 | 작업 | 검증 |
|---|------|------|------|
| 1 | `src/pages/web-forms/new.tsx` | 신규 생성 페이지 | 빌드 확인 |
| 2 | `src/pages/web-forms/[id].tsx` | 신규 편집 페이지 | 빌드 확인 |
| 3 | `src/pages/web-forms.tsx` → `src/pages/web-forms/index.tsx` | 목록 페이지 정리 + 원본 삭제 | `pnpm build` 성공 |

## 검증
- `pnpm build` 성공
- `/web-forms` 목록 → "새 폼 만들기" → `/web-forms/new` 이동
- `/web-forms/new` 생성 → `/web-forms/[id]` 편집 페이지 이동
- `/web-forms/[id]` 편집 → FormBuilder + FormPreview 풀 너비 표시
- 저장, 임베드 링크, 뒤로가기 정상 동작
