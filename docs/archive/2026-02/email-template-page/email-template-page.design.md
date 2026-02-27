# Design: 이메일 템플릿 편집 페이지 (email-template-page)

## 개요
이메일 템플릿 생성/편집을 다이얼로그에서 별도 페이지로 전환.
기존 `EmailTemplateDialog`의 편집 UI를 `EmailTemplateEditor` 컴포넌트로 추출하여 페이지에서 사용.

## 파일 구조

```
src/
  components/email/
    EmailTemplateEditor.tsx   ← 신규 (Dialog에서 편집 UI 추출)
    EmailTemplateList.tsx     ← 수정 (router.push로 변경)
    EmailTemplateDialog.tsx   ← 삭제
  pages/
    email.tsx                 ← 기존 유지
    email/
      templates/
        new.tsx               ← 신규 (새 템플릿 생성 페이지)
        [id].tsx              ← 신규 (편집 페이지)
```

## 변경 파일 상세

### 1. `src/components/email/EmailTemplateEditor.tsx` (신규)

기존 `EmailTemplateDialog.tsx`에서 Dialog 래퍼를 제거하고 편집 UI만 추출.

#### Props
```typescript
interface EmailTemplateEditorProps {
    template: EmailTemplate | null;  // null이면 신규 생성
    onSave: (data: { name: string; subject: string; htmlBody: string; templateType?: string }) => Promise<void>;
    onCancel: () => void;
}
```

#### 상태 관리
- `name`, `subject`, `htmlBody`, `templateType` — 폼 상태
- `saving` — 저장 중 로딩
- `showAiPanel` — AI 패널 토글
- `editMode` — "visual" | "code"
- `editorRef` — contenteditable div ref

#### 레이아웃
```
┌─────────────────────────────────────────────────┐
│ 헤더: 제목("새 템플릿"/"편집") + AI/취소/저장  │
├────────────────────┬────────────────────────────┤
│ 좌측 편집          │ 우측 미리보기              │
│ ┌────────────────┐ │ ┌──────────────────────┐   │
│ │ 이름 | 유형    │ │ │ 미리보기 헤더        │   │
│ │ 제목           │ │ │                      │   │
│ ├────────────────┤ │ │ iframe srcDoc         │   │
│ │ AI 패널(접이식)│ │ │                      │   │
│ ├────────────────┤ │ │                      │   │
│ │ 비주얼 | 코드  │ │ ├──────────────────────┤   │
│ ├────────────────┤ │ │ 변수: name, email    │   │
│ │ 편집 영역      │ │ └──────────────────────┘   │
│ └────────────────┘ │                            │
├────────────────────┴────────────────────────────┤
```

- 전체 화면 높이 활용: `h-[calc(100vh-theme(spacing.14))]` (사이드바 헤더 제외)
- 좌/우 50:50 분할

#### 핵심 로직 (기존 Dialog에서 그대로 이전)
- `handleVisualInput()`: contenteditable → state 동기화
- `handleModeChange()`: visual/code 모드 전환 + innerHTML 동기화
- `handleAiGenerated()`: AI 결과 반영
- `previewHtml`: ##변수## 하이라이트 + iframe용 HTML
- `extractEmailVariables()`: 변수 추출

#### 초기화
- `template` prop이 있으면 해당 데이터로 초기화
- `template`이 null이면 빈 상태

### 2. `src/pages/email/templates/new.tsx` (신규)

```typescript
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import EmailTemplateEditor from "@/components/email/EmailTemplateEditor";
import { useEmailTemplates } from "@/hooks/useEmailTemplates";
import { useRouter } from "next/router";
import { toast } from "sonner";

export default function NewTemplatePage() {
    const router = useRouter();
    const { createTemplate } = useEmailTemplates();

    const handleSave = async (data) => {
        const result = await createTemplate(data);
        if (result.success) {
            toast.success("템플릿이 생성되었습니다.");
            router.push("/email?tab=templates");
        } else {
            toast.error(result.error || "생성에 실패했습니다.");
        }
    };

    const handleCancel = () => router.push("/email?tab=templates");

    return (
        <WorkspaceLayout>
            <EmailTemplateEditor
                template={null}
                onSave={handleSave}
                onCancel={handleCancel}
            />
        </WorkspaceLayout>
    );
}
```

### 3. `src/pages/email/templates/[id].tsx` (신규)

```typescript
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import EmailTemplateEditor from "@/components/email/EmailTemplateEditor";
import { useEmailTemplates } from "@/hooks/useEmailTemplates";
import { useRouter } from "next/router";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function EditTemplatePage() {
    const router = useRouter();
    const { id } = router.query;
    const { templates, isLoading, updateTemplate } = useEmailTemplates();
    const template = templates.find((t) => t.id === Number(id)) ?? null;

    const handleSave = async (data) => {
        if (!template) return;
        const result = await updateTemplate(template.id, data);
        if (result.success) {
            toast.success("템플릿이 수정되었습니다.");
            router.push("/email?tab=templates");
        } else {
            toast.error(result.error || "수정에 실패했습니다.");
        }
    };

    const handleCancel = () => router.push("/email?tab=templates");

    if (isLoading) {
        return (
            <WorkspaceLayout>
                <div className="flex items-center justify-center h-64">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            </WorkspaceLayout>
        );
    }

    if (!template) {
        return (
            <WorkspaceLayout>
                <div className="flex items-center justify-center h-64 text-muted-foreground">
                    템플릿을 찾을 수 없습니다.
                </div>
            </WorkspaceLayout>
        );
    }

    return (
        <WorkspaceLayout>
            <EmailTemplateEditor
                template={template}
                onSave={handleSave}
                onCancel={handleCancel}
            />
        </WorkspaceLayout>
    );
}
```

### 4. `src/components/email/EmailTemplateList.tsx` (수정)

#### 변경 사항
- `useRouter` import 추가
- `dialogOpen`, `editingTemplate` 상태 제거
- `handleCreate`: `router.push("/email/templates/new")`
- `handleEdit`: `router.push(`/email/templates/${template.id}`)`
- `handleSave` 함수 제거
- `EmailTemplateDialog` import 및 JSX 제거

### 5. `src/components/email/EmailTemplateDialog.tsx` (삭제)

페이지로 대체되므로 삭제.

### 6. `src/pages/email.tsx` (수정)

#### 변경 사항
- `activeTab` 상태를 URL query `?tab=` 와 동기화
- `/email?tab=templates`로 돌아올 때 templates 탭 활성화

```typescript
// 기존
const [activeTab, setActiveTab] = useState("dashboard");

// 변경
const router = useRouter();
const activeTab = (router.query.tab as string) || "dashboard";
const setActiveTab = (tab: string) => {
    router.replace({ pathname: "/email", query: { tab } }, undefined, { shallow: true });
};
```

## 구현 순서

| # | 파일 | 검증 |
|---|------|------|
| 1 | `src/components/email/EmailTemplateEditor.tsx` | 타입 에러 없음 |
| 2 | `src/pages/email/templates/new.tsx` | 빌드 확인 |
| 3 | `src/pages/email/templates/[id].tsx` | 빌드 확인 |
| 4 | `src/pages/email.tsx` — tab query 동기화 | 빌드 확인 |
| 5 | `src/components/email/EmailTemplateList.tsx` — 라우팅 변경 | 빌드 확인 |
| 6 | `src/components/email/EmailTemplateDialog.tsx` — 삭제 | `pnpm build` 성공 |

## 검증
- `pnpm build` 성공
- `/email/templates/new` 접속 시 전체 화면 편집기 표시
- `/email/templates/[id]` 접속 시 기존 템플릿 로드 + 편집
- 저장 후 `/email?tab=templates` 이동
- 취소 시 `/email?tab=templates` 이동
- 목록에서 "새 템플릿" → `/email/templates/new` 이동
- 목록에서 편집 아이콘 → `/email/templates/[id]` 이동
