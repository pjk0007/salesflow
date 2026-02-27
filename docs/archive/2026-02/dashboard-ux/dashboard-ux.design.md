# Design: dashboard-ux (대시보드 UX 개선 + AI 생성)

## Plan 참조
- `docs/01-plan/features/dashboard-ux.plan.md`

## 아키텍처 개요

대시보드 생성 Dialog 제거 → 인라인 생성 영역으로 변경. AI 프롬프트 입력 시 대시보드 이름 + 위젯 구성 자동 생성. 기존 AI 패턴(`getAiClient` → fetch → `extractJson` → `logAiUsage`)을 따름.

```
[대시보드 페이지] → "새 대시보드" 버튼 → 인라인 입력 (이름 + AI 프롬프트)
                                          ↓ (AI 프롬프트 있으면)
                               POST /api/ai/generate-dashboard
                                          ↓
                               getAiClient → callOpenAI/callAnthropic
                                          ↓
                               { name, widgets[] } JSON
                                          ↓
                               createDashboard → 위젯 일괄 POST → 선택
```

## 변경 파일 상세

### 1. `src/lib/ai.ts` — `generateDashboard()` 함수 추가

**위치**: `generateWebForm()` 아래, `logAiUsage()` 위

**타입**:
```tsx
interface GenerateDashboardInput {
    prompt: string;
    workspaceFields: Array<{ key: string; label: string; fieldType: string }>;
}

interface GenerateDashboardWidget {
    title: string;
    widgetType: string;
    dataColumn: string;
    aggregation: string;
    groupByColumn: string;
    stackByColumn: string;
}

interface GenerateDashboardResult {
    name: string;
    widgets: GenerateDashboardWidget[];
    usage: { promptTokens: number; completionTokens: number };
}
```

**시스템 프롬프트** (`buildDashboardSystemPrompt`):
```
당신은 데이터 대시보드 설계 전문가입니다.
사용자의 요청에 맞는 대시보드를 설계하세요.

반드시 다음 JSON 형식으로 응답하세요:
{
  "name": "대시보드 이름",
  "widgets": [
    {
      "title": "위젯 제목",
      "widgetType": "scorecard|bar|bar_horizontal|bar_stacked|line|donut",
      "dataColumn": "워크스페이스 필드 key",
      "aggregation": "count|sum|avg",
      "groupByColumn": "그룹 기준 필드 key (차트 타입일 때)",
      "stackByColumn": "스택 기준 필드 key (bar_stacked일 때만)"
    }
  ]
}

규칙:
- widgetType: scorecard, bar, bar_horizontal, bar_stacked, line, donut 중 하나
- scorecard는 groupByColumn 빈 문자열 ""
- bar_stacked만 stackByColumn 사용, 나머지는 빈 문자열 ""
- dataColumn과 groupByColumn은 반드시 아래 워크스페이스 필드 목록의 key 값 사용
- aggregation: count, sum, avg 중 하나
- 3~8개 적절한 위젯 생성
- 첫 위젯은 scorecard로 전체 건수 요약 권장
- 한국어로 작성
- JSON만 반환하세요
```

워크스페이스 필드 목록 추가:
```
[워크스페이스 필드 목록]
- status (상태) [select]
- amount (금액) [number]
- source (유입 경로) [select]
...
```

**함수 구현** — 웹 검색 불필요, 일반 callOpenAI/callAnthropic 사용:
```tsx
export async function generateDashboard(
    client: AiClient,
    input: GenerateDashboardInput
): Promise<GenerateDashboardResult> {
    const systemPrompt = buildDashboardSystemPrompt(input.workspaceFields);
    const pattern = /\{[\s\S]*"name"[\s\S]*"widgets"[\s\S]*\}/;

    // generateWebForm과 동일한 패턴: provider 분기 → fetch → extractJson
    // OpenAI: response_format json_object
    // Anthropic: max_tokens 4096

    const parsed = extractJson(content, pattern);
    const widgets = (parsed.widgets as any[] || []).map((w: any) => ({
        title: w.title || "",
        widgetType: w.widgetType || "scorecard",
        dataColumn: w.dataColumn || "",
        aggregation: w.aggregation || "count",
        groupByColumn: w.groupByColumn || "",
        stackByColumn: w.stackByColumn || "",
    }));

    return { name: parsed.name as string || "", widgets, usage };
}
```

### 2. `src/pages/api/ai/generate-dashboard.ts` (신규)

**패턴**: `generate-webform.ts`와 동일 구조

```tsx
import type { NextApiRequest, NextApiResponse } from "next";
import { getUserFromRequest } from "@/lib/auth";
import { getAiClient, generateDashboard, logAiUsage } from "@/lib/ai";

export default async function handler(req, res) {
    // POST only
    // getUserFromRequest → 401
    // getAiClient → 400 "AI 설정이 필요합니다"
    // req.body.prompt 필수 검증
    // req.body.workspaceFields 필수

    try {
        const result = await generateDashboard(client, {
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
            purpose: "dashboard_generation",
        });

        return res.json({
            success: true,
            data: {
                name: result.name,
                widgets: result.widgets,
            },
        });
    } catch (error) {
        console.error("AI dashboard generation error:", error);
        const message = error instanceof Error ? error.message : "AI 대시보드 생성에 실패했습니다.";
        return res.status(500).json({ success: false, error: message });
    }
}
```

### 3. `src/pages/dashboards.tsx` — Dialog 제거 + 인라인 생성 + AI

**삭제할 것**:
- `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle` 임포트 제거
- `createOpen`, `setCreateOpen` 상태 제거
- 하단 `{/* 생성 다이얼로그 */}` Dialog JSX 전체 제거

**새 임포트**:
```tsx
import { Textarea } from "@/components/ui/textarea";
import { Sparkles } from "lucide-react";
```

**새 상태**:
```tsx
const [showCreate, setShowCreate] = useState(false);
const [aiPrompt, setAiPrompt] = useState("");
const [creating, setCreating] = useState(false);
```

**"새 대시보드" 버튼 변경**:
```tsx
<Button onClick={() => setShowCreate(!showCreate)}>
    <Plus className="h-4 w-4 mr-1" /> 새 대시보드
</Button>
```

**인라인 생성 영역** — 탭 아래, Toolbar 위에 조건부 렌더링:
```tsx
{showCreate && (
    <div className="border rounded-lg p-4 space-y-3">
        <div className="space-y-2">
            <Label>대시보드 이름</Label>
            <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="대시보드 이름"
            />
        </div>
        <div className="space-y-2">
            <Label className="flex items-center gap-1">
                <Sparkles className="h-4 w-4" /> AI 위젯 자동 생성
                <span className="text-muted-foreground font-normal">(선택)</span>
            </Label>
            <Textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="예: 영업 현황 대시보드, 월별 매출 분석"
                rows={2}
            />
            <p className="text-xs text-muted-foreground">
                입력하면 대시보드 이름과 위젯을 AI가 자동으로 구성합니다.
            </p>
        </div>
        <div className="flex gap-2">
            <Button
                onClick={handleCreate}
                disabled={creating || (!newName && !aiPrompt.trim())}
            >
                {creating ? (aiPrompt.trim() ? "AI 생성 중..." : "생성 중...") : (aiPrompt.trim() ? "AI로 생성" : "생성")}
            </Button>
            <Button variant="outline" onClick={() => { setShowCreate(false); setNewName(""); setAiPrompt(""); }}>
                취소
            </Button>
        </div>
    </div>
)}
```

**handleCreate 수정**:
```tsx
const handleCreate = useCallback(async () => {
    if (!workspaceId) return;
    const hasAi = !!aiPrompt.trim();
    if (!hasAi && !newName) return;
    setCreating(true);

    // 1. 대시보드 생성
    const result = await createDashboard({
        name: newName || aiPrompt.trim().slice(0, 30),
        workspaceId,
    });
    if (!result.success) {
        toast.error(result.error || "생성에 실패했습니다.");
        setCreating(false);
        return;
    }

    const dashboardId = result.data.id;

    // 2. AI 프롬프트가 있으면 위젯 자동 생성
    if (hasAi) {
        try {
            const aiRes = await fetch("/api/ai/generate-dashboard", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    prompt: aiPrompt.trim(),
                    workspaceFields: fields.map((f) => ({
                        key: f.key,
                        label: f.label,
                        fieldType: f.fieldType,
                    })),
                }),
            });
            const aiJson = await aiRes.json();
            if (aiJson.success) {
                const data = aiJson.data;
                // AI가 생성한 이름으로 대시보드 이름 업데이트
                if (data.name) {
                    await updateDashboard(dashboardId, { name: data.name });
                }
                // 위젯 일괄 추가 (순차 POST)
                for (const w of data.widgets) {
                    await fetch(`/api/dashboards/${dashboardId}/widgets`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(w),
                    });
                }
                toast.success(`${data.widgets.length}개 위젯이 AI로 생성되었습니다.`);
            } else {
                toast.error(aiJson.error || "AI 생성에 실패했습니다.");
            }
        } catch {
            toast.error("AI 생성 중 오류가 발생했습니다.");
        }
    } else {
        toast.success("대시보드가 생성되었습니다.");
    }

    // 3. 정리 + 새 대시보드 선택
    setShowCreate(false);
    setNewName("");
    setAiPrompt("");
    setCreating(false);
    setSelectedDashboardId(dashboardId);
    mutateDashboards();
}, [newName, aiPrompt, workspaceId, fields, createDashboard, updateDashboard, mutateDashboards]);
```

## 변경 없는 파일

| 파일 | 이유 |
|------|------|
| `src/components/dashboard/DashboardGrid.tsx` | props 변경 없음 |
| `src/components/dashboard/WidgetConfigDialog.tsx` | 개별 위젯 설정은 유지 |
| `src/hooks/useDashboards.ts` | 기존 createDashboard/updateDashboard 그대로 사용 |
| `src/hooks/useDashboardData.ts` | 변경 없음 |
| `src/pages/api/dashboards/**` | 기존 API 변경 없음 |
| `src/pages/dashboard/[slug].tsx` | 공개 대시보드 뷰 변경 없음 |

## 구현 순서

| # | 파일 | 작업 | 검증 |
|---|------|------|------|
| 1 | `src/lib/ai.ts` | `generateDashboard()` + `buildDashboardSystemPrompt()` 추가 | 타입 에러 없음 |
| 2 | `src/pages/api/ai/generate-dashboard.ts` | API 엔드포인트 신규 | 타입 에러 없음 |
| 3 | `src/pages/dashboards.tsx` | Dialog 제거, 인라인 생성 + AI 프롬프트 + handleCreate 수정 | `pnpm build` 성공 |

## 검증
- `pnpm build` 성공
- Dialog 없이 인라인으로 대시보드 생성
- AI 프롬프트 입력 → 대시보드 이름 + 위젯 자동 생성 → DashboardGrid에 반영
