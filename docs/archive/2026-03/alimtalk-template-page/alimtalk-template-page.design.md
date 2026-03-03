# Design: alimtalk-template-page

## 1. 파일 변경 목록

| # | 파일 | 작업 | LOC |
|---|------|------|-----|
| 1 | `src/lib/ai.ts` | `generateAlimtalk()` + `buildAlimtalkSystemPrompt()` 추가 | +80 |
| 2 | `src/app/api/ai/generate-alimtalk/route.ts` | 새 파일 — AI 알림톡 생성 API | ~60 |
| 3 | `src/components/alimtalk/AiAlimtalkPanel.tsx` | 새 파일 — AI 프롬프트 입력 UI | ~100 |
| 4 | `src/app/alimtalk/templates/new/page.tsx` | 새 파일 — 생성 페이지 | ~80 |
| 5 | `src/app/alimtalk/templates/[templateCode]/page.tsx` | 새 파일 — 수정 페이지 | ~90 |
| 6 | `src/components/alimtalk/TemplateList.tsx` | 버튼 → 페이지 이동, 다이얼로그 제거 | ~-30 |
| 7 | `src/components/alimtalk/TemplateCreateDialog.tsx` | 삭제 | -172 |

## 2. 상세 설계

### 2-1. `src/lib/ai.ts` — generateAlimtalk()

```typescript
// ---- 알림톡 생성 ----

interface GenerateAlimtalkInput {
    prompt: string;
    product?: Product | null;
    tone?: string;
}

interface GenerateAlimtalkResult {
    templateName: string;
    templateContent: string;
    templateMessageType: string;
    buttons: Array<{ type: string; name: string; linkMo?: string; linkPc?: string }>;
    usage: { promptTokens: number; completionTokens: number };
}

function buildAlimtalkSystemPrompt(input: GenerateAlimtalkInput): string {
    // 역할: 카카오 알림톡 템플릿 전문가
    // 제약: 본문 1300자 이내, #{변수명} 변수 문법
    // 메시지 타입: BA(기본형), EX(부가정보형), AD(광고추가형), MI(복합형)
    // 버튼 타입: WL(웹링크), AL(앱링크), BK(봇키워드), MD(메시지전달), AC(채널추가)
    // JSON 응답: { templateName, templateContent, templateMessageType, buttons }
    // product 정보 포함 (있을 경우)
    // tone 옵션 (있을 경우)
}

export async function generateAlimtalk(
    client: AiClient,
    input: GenerateAlimtalkInput
): Promise<GenerateAlimtalkResult> {
    // 기존 generateWebForm() 패턴과 동일:
    // 1. buildAlimtalkSystemPrompt()
    // 2. OpenAI (json_object 모드) / Anthropic 분기
    // 3. extractJson()으로 파싱
    // 4. 결과 매핑 반환
}
```

**시스템 프롬프트 핵심 내용:**
```
당신은 카카오 알림톡 템플릿 전문가입니다.
사용자의 요청에 맞는 알림톡 템플릿을 작성하세요.

반드시 다음 JSON 형식으로 응답하세요:
{
  "templateName": "템플릿 이름",
  "templateContent": "본문 내용 (최대 1300자)",
  "templateMessageType": "BA",
  "buttons": [
    { "type": "WL", "name": "버튼명", "linkMo": "https://...", "linkPc": "https://..." }
  ]
}

규칙:
- templateContent는 반드시 1300자 이내
- 변수는 #{변수명} 형식 (예: #{고객명}, #{주문번호})
- templateMessageType: BA(기본형), EX(부가정보형) 중 적절히 선택
- 버튼 type: WL(웹링크), BK(봇키워드), MD(메시지전달) 중 선택
- 버튼은 0~5개, WL 타입은 linkMo 필수
- 한국어로 작성
- JSON만 반환하세요
```

### 2-2. `src/app/api/ai/generate-alimtalk/route.ts`

```typescript
// 기존 generate-email/route.ts 패턴 그대로:
// 1. getUserFromNextRequest(req) — 인증 체크
// 2. getAiClient(user.orgId) — AI 설정 조회
// 3. req.json()에서 { prompt, productId, tone } 추출
// 4. productId → products 테이블 조회 (선택)
// 5. generateAlimtalk(client, { prompt, product, tone })
// 6. logAiUsage({ purpose: "alimtalk_generation" })
// 7. 응답: { success: true, data: { templateName, templateContent, templateMessageType, buttons } }
```

### 2-3. `src/components/alimtalk/AiAlimtalkPanel.tsx`

기존 `AiEmailPanel` 패턴 참고. 차이점: CTA URL/recordId 불필요, 스트리밍 불필요.

```typescript
interface AiAlimtalkPanelProps {
    onGenerated: (result: {
        templateName: string;
        templateContent: string;
        templateMessageType: string;
        buttons: Array<{ type: string; name: string; linkMo?: string; linkPc?: string }>;
    }) => void;
}

// UI 구조:
// - Textarea: 프롬프트 입력 (placeholder: "예: 주문 완료 안내 알림톡 만들어줘")
// - Select 2개: 제품 선택(optional) + 톤 선택
// - Button: "AI로 생성" (Sparkles 아이콘)
// - 로딩 상태: Loader2 spinner

// 호출: POST /api/ai/generate-alimtalk
// 응답 성공 → onGenerated(data) 콜백
```

### 2-4. `src/app/alimtalk/templates/new/page.tsx`

```typescript
"use client";

// URL: /alimtalk/templates/new?senderKey=xxx
// useSearchParams()로 senderKey 추출 → Suspense 필요

export default function NewAlimtalkTemplatePage() {
    return (
        <WorkspaceLayout>
            <Suspense fallback={<Loader2 />}>
                <NewAlimtalkTemplateContent />
            </Suspense>
        </WorkspaceLayout>
    );
}

function NewAlimtalkTemplateContent() {
    const searchParams = useSearchParams();
    const senderKey = searchParams.get("senderKey");
    const router = useRouter();
    const [form, setForm] = useState<TemplateFormState>(defaultFormState);
    const [showAi, setShowAi] = useState(false);
    const { createTemplate } = useAlimtalkTemplateManage(senderKey);

    // AI 결과 → 폼 자동 채움
    const handleAiGenerated = (result) => {
        setForm(prev => ({
            ...prev,
            templateName: result.templateName,
            templateContent: result.templateContent,
            templateMessageType: result.templateMessageType,
            buttons: result.buttons.map((b, i) => ({
                ordering: i + 1,
                ...b,
            })),
        }));
        setShowAi(false);
    };

    // 저장
    const handleSubmit = async () => {
        // TemplateCreateDialog의 handleSubmit 로직 재사용
        // 성공 시: router.push("/alimtalk?tab=templates")
    };

    // 레이아웃:
    // - 상단: "알림톡 템플릿 등록" 제목 + "AI로 생성" 토글 버튼 + 취소/등록 버튼
    // - AI 영역 (showAi일 때): <AiAlimtalkPanel onGenerated={handleAiGenerated} />
    // - 하단: 2-column grid
    //   - 좌측: <TemplateFormEditor value={form} onChange={setForm} mode="create" />
    //   - 우측: <TemplatePreview ... />
}
```

### 2-5. `src/app/alimtalk/templates/[templateCode]/page.tsx`

```typescript
"use client";

// URL: /alimtalk/templates/{templateCode}?senderKey=xxx
// useParams()로 templateCode, useSearchParams()로 senderKey → Suspense 필요

export default function EditAlimtalkTemplatePage() {
    return (
        <WorkspaceLayout>
            <Suspense fallback={<Loader2 />}>
                <EditAlimtalkTemplateContent />
            </Suspense>
        </WorkspaceLayout>
    );
}

function EditAlimtalkTemplateContent() {
    const params = useParams();
    const searchParams = useSearchParams();
    const templateCode = params.templateCode as string;
    const senderKey = searchParams.get("senderKey");

    // NHN API에서 기존 템플릿 fetch (SWR 또는 useEffect)
    // GET /api/alimtalk/templates/{templateCode}?senderKey=xxx
    const [template, setTemplate] = useState<NhnTemplate | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!senderKey || !templateCode) return;
        fetch(`/api/alimtalk/templates/${encodeURIComponent(templateCode)}?senderKey=${encodeURIComponent(senderKey)}`)
            .then(res => res.json())
            .then(data => {
                if (data.success) setTemplate(data.data);
                setLoading(false);
            });
    }, [templateCode, senderKey]);

    // template → TemplateFormState 변환 (getInitialState 로직 재사용)
    // 나머지 레이아웃은 new 페이지와 동일 (AI 패널 포함)
    // 저장: updateTemplate(templateCode, payload)
    // 성공 시: router.push("/alimtalk?tab=templates")
}
```

### 2-6. `src/components/alimtalk/TemplateList.tsx` 수정

```diff
- import TemplateCreateDialog from "./TemplateCreateDialog";
+ import { useRouter } from "next/navigation";

  // 생성 버튼
- <Button onClick={() => setCreateDialogOpen(true)}>
+ <Button onClick={() => router.push(`/alimtalk/templates/new?senderKey=${selectedSenderKey}`)}>

  // 수정 메뉴
- onClick={() => setEditTemplate(tpl)}
+ onClick={() => router.push(`/alimtalk/templates/${encodeURIComponent(tpl.templateCode)}?senderKey=${selectedSenderKey}`)}

  // 제거할 state/다이얼로그:
- const [createDialogOpen, setCreateDialogOpen] = useState(false);
- const [editTemplate, setEditTemplate] = useState<NhnTemplate | null>(null);
- {selectedSenderKey && createDialogOpen && <TemplateCreateDialog ... />}
- {selectedSenderKey && editTemplate && <TemplateCreateDialog ... />}
```

### 2-7. `src/components/alimtalk/TemplateCreateDialog.tsx` — 삭제

페이지로 완전 대체. `getInitialState` 로직은 수정 페이지에서 인라인으로 재구현.

## 3. 구현 순서

| # | 파일 | 의존 | 검증 |
|---|------|------|------|
| 1 | `ai.ts` — generateAlimtalk() | 없음 | 타입 에러 없음 |
| 2 | `/api/ai/generate-alimtalk/route.ts` | ai.ts | 타입 에러 없음 |
| 3 | `AiAlimtalkPanel.tsx` | API route | — |
| 4 | `/alimtalk/templates/new/page.tsx` | AiAlimtalkPanel, TemplateFormEditor | — |
| 5 | `/alimtalk/templates/[templateCode]/page.tsx` | TemplateFormEditor | — |
| 6 | `TemplateList.tsx` 수정 | 페이지 존재 | — |
| 7 | `TemplateCreateDialog.tsx` 삭제 | TemplateList에서 import 제거 후 | — |
| 8 | `pnpm build` | 전체 | 빌드 성공 |
