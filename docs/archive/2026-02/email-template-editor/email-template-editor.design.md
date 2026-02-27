# Design: 이메일 템플릿 편집기 개선 (email-template-editor)

> Plan 참조: `docs/01-plan/features/email-template-editor.plan.md`

## 변경 파일 1개

### `src/components/email/EmailTemplateDialog.tsx` — 전면 재작성

#### Props (변경 없음)

```typescript
interface EmailTemplateDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    template: EmailTemplate | null;  // null = 생성, 객체 = 편집
    onSave: (data: { name: string; subject: string; htmlBody: string; templateType?: string }) => Promise<void>;
}
```

#### 상태 관리

```typescript
// 기존 유지
const [name, setName] = useState("");
const [subject, setSubject] = useState("");
const [htmlBody, setHtmlBody] = useState("");
const [templateType, setTemplateType] = useState("");
const [saving, setSaving] = useState(false);
const [showAiPanel, setShowAiPanel] = useState(false);

// 신규 추가
const [editMode, setEditMode] = useState<"visual" | "code">("visual");
const editorRef = useRef<HTMLDivElement>(null);
```

#### 전체화면 레이아웃 구조

```
DialogContent className="max-w-[95vw] w-full h-[90vh] flex flex-col p-0"
├── Header (고정, h-14)
│   ├── 좌측: DialogTitle "새 템플릿" / "템플릿 편집"
│   └── 우측: [AI 토글] [취소] [저장]
│
├── Body (flex-1, overflow hidden)
│   ├── 좌측 패널 (w-1/2, flex flex-col, border-r)
│   │   ├── 메타 정보 영역 (shrink-0, p-4)
│   │   │   ├── 이름 + 유형 (grid-cols-2)
│   │   │   └── 제목 (full width)
│   │   │
│   │   ├── AI 패널 (접이식, showAiPanel 시)
│   │   │   └── <AiEmailPanel onGenerated={...} />
│   │   │
│   │   ├── 편집 모드 탭 (shrink-0, border-b)
│   │   │   └── [비주얼] [코드] 탭 버튼
│   │   │
│   │   └── 편집 영역 (flex-1, overflow-auto)
│   │       ├── editMode === "visual":
│   │       │   <div ref={editorRef}
│   │       │        contentEditable
│   │       │        className="prose max-w-none p-4 min-h-full outline-none"
│   │       │        onInput={handleVisualInput}
│   │       │        dangerouslySetInnerHTML={{ __html: htmlBody }} />
│   │       │   (초기 로드 시만 dangerouslySetInnerHTML, 이후 onInput으로 동기화)
│   │       │
│   │       └── editMode === "code":
│   │           <textarea
│   │               className="w-full h-full font-mono text-sm p-4 resize-none"
│   │               value={htmlBody}
│   │               onChange={e => setHtmlBody(e.target.value)} />
│   │
│   └── 우측 패널 (w-1/2, flex flex-col)
│       ├── 헤더 (shrink-0, p-2, border-b)
│       │   └── "미리보기" 라벨
│       │
│       ├── iframe 영역 (flex-1)
│       │   └── <iframe
│       │           srcDoc={previewHtml}
│       │           sandbox=""
│       │           className="w-full h-full border-0" />
│       │
│       └── 변수 영역 (shrink-0, p-3, border-t)
│           └── 감지된 변수 Badge 목록
```

#### 핵심 로직

##### 1. contenteditable 동기화

```typescript
const handleVisualInput = useCallback(() => {
    if (editorRef.current) {
        setHtmlBody(editorRef.current.innerHTML);
    }
}, []);
```

- `onInput` 이벤트에서 `innerHTML` 추출 → `htmlBody` 상태 반영
- 비주얼 → 코드 전환 시: 현재 `htmlBody` 그대로 textarea에 표시
- 코드 → 비주얼 전환 시: `editorRef.current.innerHTML = htmlBody`

##### 2. 모드 전환

```typescript
const handleModeChange = useCallback((mode: "visual" | "code") => {
    if (mode === "visual" && editorRef.current) {
        // 코드 → 비주얼: innerHTML 갱신
        editorRef.current.innerHTML = htmlBody;
    } else if (mode === "code" && editorRef.current) {
        // 비주얼 → 코드: innerHTML에서 최신 상태 추출
        setHtmlBody(editorRef.current.innerHTML);
    }
    setEditMode(mode);
}, [htmlBody]);
```

##### 3. 미리보기 (debounce)

```typescript
const previewHtml = useMemo(() => {
    // ##변수##를 시각적 placeholder로 대체
    const highlighted = htmlBody.replace(
        /##(\w+)##/g,
        '<span style="background:#fef3c7;padding:0 4px;border-radius:2px;color:#92400e">[$1]</span>'
    );
    return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:-apple-system,sans-serif;padding:16px;margin:0}</style>
</head><body>${highlighted}</body></html>`;
}, [htmlBody]);
```

- `useMemo`로 htmlBody 변경 시만 재계산
- iframe의 `srcDoc`에 직접 전달 (debounce 불필요 — React 렌더 사이클이 자연스러운 throttle 역할)

##### 4. AI 생성 결과 반영

```typescript
const handleAiGenerated = useCallback((result: { subject: string; htmlBody: string }) => {
    setSubject(result.subject);
    setHtmlBody(result.htmlBody);
    // 비주얼 모드에서 AI 결과 반영
    if (editorRef.current && editMode === "visual") {
        editorRef.current.innerHTML = result.htmlBody;
    }
    toast.success("AI 결과가 적용되었습니다.");
}, [editMode]);
```

##### 5. 초기화 (useEffect)

```typescript
useEffect(() => {
    if (open) {
        if (template) {
            setName(template.name);
            setSubject(template.subject);
            setHtmlBody(template.htmlBody);
            setTemplateType(template.templateType || "");
        } else {
            setName(""); setSubject(""); setHtmlBody(""); setTemplateType("");
        }
        setEditMode("visual");
        setShowAiPanel(false);
    }
}, [template, open]);

// htmlBody 초기 로드 후 contenteditable 동기화
useEffect(() => {
    if (open && editMode === "visual" && editorRef.current && htmlBody) {
        editorRef.current.innerHTML = htmlBody;
    }
}, [open]); // open 변경 시에만 (매 htmlBody 변경 시 X — 커서 리셋 방지)
```

#### Import 변경

```diff
- import { useState, useEffect } from "react";
+ import { useState, useEffect, useCallback, useMemo, useRef } from "react";
- import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
+ import { Dialog, DialogContent } from "@/components/ui/dialog";
  // DialogHeader, DialogTitle, DialogFooter는 커스텀 레이아웃으로 대체
+ import { Code, Eye } from "lucide-react";
  // 기존 Loader2, Sparkles 유지
```

#### Tailwind 클래스 참고

- 전체화면: `max-w-[95vw] w-full h-[90vh]`
- 좌우 분할: `flex` → `w-1/2` + `w-1/2`
- contenteditable 영역: `prose max-w-none` (Tailwind Typography 플러그인 있으면), 없으면 기본 스타일
- iframe: `w-full h-full border-0 bg-white`
- 탭 버튼: `inline-flex items-center gap-1 px-3 py-1.5 text-sm` + active 상태 `bg-background shadow-sm`

## 구현 순서

| # | 작업 | 검증 |
|---|------|------|
| 1 | DialogContent 전체화면 + 좌우 분할 레이아웃 | 레이아웃 확인 |
| 2 | 좌측: 메타 정보 + AI 패널 이동 | 기존 기능 동작 |
| 3 | 코드 모드 편집 (기존 Textarea 이동) | HTML 편집 가능 |
| 4 | 우측: iframe 미리보기 | 실시간 렌더링 |
| 5 | 비주얼 모드 (contenteditable) + 모드 전환 | 동기화 확인 |
| 6 | 변수 하이라이트 + Badge | 변수 감지 |
| 7 | `pnpm build` | 빌드 성공 |

## 비대상

- 외부 리치 텍스트 에디터 라이브러리 (TipTap, Quill, Slate 등)
- contenteditable 내 서식 도구바 (볼드, 이탤릭 등) — 향후 확장 가능
- 이미지 업로드/삽입 기능
- 모바일 반응형 (데스크톱 전용 기능)
