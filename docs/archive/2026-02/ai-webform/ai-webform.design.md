# Design: ai-webform (AI 웹폼 필드 자동 생성)

## Plan 참조
- `docs/01-plan/features/ai-webform.plan.md`

## 아키텍처 개요

기존 AI 생성 패턴(`getAiClient` → callOpenAI/callAnthropic → `extractJson` → `logAiUsage`)을 따라 웹폼 필드 자동 생성 기능 추가. 웹 검색 불필요 → 일반 `callOpenAI`/`callAnthropic` 사용 (검색 API가 아닌 일반 chat completion).

```
[편집 페이지] → "AI 생성" 버튼 → Popover (프롬프트 입력)
                                    ↓
                         POST /api/ai/generate-webform
                                    ↓
                         getAiClient → callOpenAI/callAnthropic
                                    ↓
                         { title, description, fields[] } JSON
                                    ↓
                         setFormTitle, setFormDescription, setFormFields
```

## 변경 파일 상세

### 1. `src/lib/ai.ts` — `generateWebForm()` 함수 추가

**위치**: `logAiUsage()` 바로 위, `generateCompanyResearch()` 아래

**타입**:
```tsx
interface GenerateWebFormInput {
    prompt: string;
    workspaceFields?: Array<{ key: string; label: string }>;
}

interface GenerateWebFormResult {
    title: string;
    description: string;
    fields: Array<{
        label: string;
        description: string;
        placeholder: string;
        fieldType: string;
        linkedFieldKey: string;
        isRequired: boolean;
        options: string[];
    }>;
    usage: { promptTokens: number; completionTokens: number };
}
```

**시스템 프롬프트** (`buildWebFormSystemPrompt`):
```
당신은 웹폼 필드 설계 전문가입니다.
사용자의 요청에 맞는 웹 폼을 설계하세요.

반드시 다음 JSON 형식으로 응답하세요:
{
  "title": "폼 제목",
  "description": "폼 설명",
  "fields": [
    {
      "label": "필드 이름",
      "description": "필드 설명 (선택)",
      "placeholder": "플레이스홀더",
      "fieldType": "text|email|phone|textarea|select|checkbox|date",
      "linkedFieldKey": "워크스페이스 필드 키 (매핑 가능하면)",
      "isRequired": true/false,
      "options": ["select 타입일 때 옵션 배열"]
    }
  ]
}

규칙:
- fieldType은 text, email, phone, textarea, select, checkbox, date 중 하나
- 이메일 수집 필드는 반드시 fieldType: "email" 사용
- 전화번호는 fieldType: "phone" 사용
- select 타입은 options 배열 필수, 나머지는 빈 배열 []
- 한국어로 작성
- 5~10개 적절한 필드 생성
```

워크스페이스 필드 목록이 있으면 시스템 프롬프트에 추가:
```
[워크스페이스 필드 목록]
이 필드들과 매핑 가능한 폼 필드는 linkedFieldKey에 해당 key를 설정하세요.
- name (이름)
- email (이메일)
- company (회사)
...
```

**함수 구현** — 웹 검색 불필요, 일반 callOpenAI/callAnthropic 사용:
```tsx
export async function generateWebForm(
    client: AiClient,
    input: GenerateWebFormInput
): Promise<GenerateWebFormResult> {
    const systemPrompt = buildWebFormSystemPrompt(input.workspaceFields);
    const pattern = /\{[\s\S]*"title"[\s\S]*"fields"[\s\S]*\}/;

    // 일반 호출 (웹 검색 불필요)
    if (client.provider === "openai") {
        // callOpenAI 재사용하되 response_format json_object 적용
        const response = await fetch("https://api.openai.com/v1/chat/completions", { ... });
        // extractJson으로 파싱
    } else {
        // callAnthropic 재사용
        const response = await fetch("https://api.anthropic.com/v1/messages", { ... });
        // extractJson으로 파싱
    }

    return { title, description, fields, usage };
}
```

참고: 기존 `callOpenAI`와 `callAnthropic`은 이메일 전용(`GenerateEmailResult` 반환)이므로, 범용 버전을 만들거나 직접 fetch 호출. 가장 단순한 방식: `generateWebForm` 내에서 직접 fetch + extractJson 호출 (기존 패턴 복사).

### 2. `src/pages/api/ai/generate-webform.ts` (신규)

**패턴**: `generate-product.ts`와 동일 구조

```tsx
import type { NextApiRequest, NextApiResponse } from "next";
import { getUserFromRequest } from "@/lib/auth";
import { getAiClient, generateWebForm, logAiUsage } from "@/lib/ai";

export default async function handler(req, res) {
    // POST only
    // getUserFromRequest → 401
    // getAiClient → 400 "AI 설정이 필요합니다"
    // req.body.prompt 필수 검증
    // req.body.workspaceFields (optional)

    const result = await generateWebForm(client, {
        prompt: prompt.trim(),
        workspaceFields,
    });

    await logAiUsage({
        orgId: user.orgId,
        userId: user.userId,
        provider: client.provider,
        model: client.model,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        purpose: "webform_generation",
    });

    return res.json({
        success: true,
        data: {
            title: result.title,
            description: result.description,
            fields: result.fields,
        },
    });
}
```

### 3. `src/pages/web-forms/[id].tsx` — AI 생성 UI 추가

**새 상태**:
```tsx
const [aiOpen, setAiOpen] = useState(false);
const [aiPrompt, setAiPrompt] = useState("");
const [aiGenerating, setAiGenerating] = useState(false);
```

**새 임포트**:
```tsx
import { Sparkles } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
```

**헤더 변경** — 임베드 버튼 왼쪽에 "AI 생성" 버튼 추가:
```tsx
<div className="flex items-center gap-2">
    {/* AI 생성 Popover */}
    <Popover open={aiOpen} onOpenChange={setAiOpen}>
        <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
                <Sparkles className="h-4 w-4 mr-1" /> AI 생성
            </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80">
            <div className="space-y-3">
                <p className="text-sm font-medium">AI로 폼 필드 생성</p>
                <Textarea
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="예: B2B SaaS 무료 체험 신청 폼"
                    rows={3}
                />
                <Button
                    className="w-full"
                    onClick={handleAiGenerate}
                    disabled={!aiPrompt.trim() || aiGenerating}
                >
                    {aiGenerating ? "생성 중..." : "생성"}
                </Button>
            </div>
        </PopoverContent>
    </Popover>
    {/* 기존 임베드 + 저장 버튼 */}
</div>
```

**handleAiGenerate 함수**:
```tsx
const handleAiGenerate = async () => {
    if (!aiPrompt.trim()) return;
    // 기존 필드가 있으면 확인
    if (formFields.length > 0) {
        if (!confirm("기존 필드가 AI 생성 결과로 대체됩니다. 계속하시겠습니까?")) return;
    }
    setAiGenerating(true);
    try {
        const res = await fetch("/api/ai/generate-webform", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                prompt: aiPrompt.trim(),
                workspaceFields: workspaceFields.map(f => ({ key: f.key, label: f.label })),
            }),
        });
        const json = await res.json();
        if (json.success) {
            const data = json.data;
            setFormTitle(data.title);
            setFormDescription(data.description);
            setFormFields(
                data.fields.map((f: any) => ({
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
            toast.success(`${data.fields.length}개 필드가 생성되었습니다.`);
            setAiOpen(false);
            setAiPrompt("");
        } else {
            toast.error(json.error || "AI 생성에 실패했습니다.");
        }
    } catch {
        toast.error("AI 생성 중 오류가 발생했습니다.");
    }
    setAiGenerating(false);
};
```

## 변경 없는 파일

| 파일 | 이유 |
|------|------|
| `src/components/web-forms/FormBuilder.tsx` | FormFieldItem 인터페이스 변경 없음 |
| `src/components/web-forms/FormPreview.tsx` | props 변경 없음 |
| `src/pages/web-forms/new.tsx` | 생성 페이지는 AI 불필요 (필드 없는 상태로 생성) |
| `src/pages/web-forms/index.tsx` | 목록 페이지 변경 없음 |
| `src/hooks/useWebForms.ts` | 변경 없음 |

## 구현 순서

| # | 파일 | 작업 | 검증 |
|---|------|------|------|
| 1 | `src/lib/ai.ts` | `generateWebForm()` + `buildWebFormSystemPrompt()` 추가 | 타입 에러 없음 |
| 2 | `src/pages/api/ai/generate-webform.ts` | API 엔드포인트 신규 | 타입 에러 없음 |
| 3 | `src/pages/web-forms/[id].tsx` | AI 생성 버튼 + Popover + handleAiGenerate | `pnpm build` 성공 |

## 검증
- `pnpm build` 성공
- AI 프롬프트 입력 → title/description/fields 자동 설정 → FormPreview 반영
