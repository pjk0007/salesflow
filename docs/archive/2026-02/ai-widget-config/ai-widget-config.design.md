# Design: ai-widget-config (AI 위젯 설정 도우미)

## 1. 데이터 모델

DB 스키마 변경 없음. 기존 `aiConfigs` 테이블의 `getAiClient()` 재사용.

## 2. API 설계

### POST `/api/ai/generate-widget`

기존 `generate-dashboard.ts`와 동일 패턴.

**Request Body**:
```json
{
  "prompt": "월별 영업 건수를 막대 차트로 보여줘",
  "workspaceFields": [
    { "key": "companyName", "label": "회사명", "fieldType": "text" },
    { "key": "contactName", "label": "담당자명", "fieldType": "text" }
  ]
}
```

**Response (성공)**:
```json
{
  "success": true,
  "data": {
    "title": "월별 영업 건수",
    "widgetType": "bar",
    "dataColumn": "companyName",
    "aggregation": "count",
    "groupByColumn": "_sys:registeredAt",
    "stackByColumn": ""
  }
}
```

**Response (에러)**:
- `401`: 인증 필요
- `400`: AI 미설정 / 프롬프트 누락
- `500`: AI API 호출 실패

### 구현 흐름

```
1. getUserFromRequest(req) → 인증
2. getAiClient(user.orgId) → AI 클라이언트
3. generateWidget(client, { prompt, workspaceFields }) → AI 호출
4. logAiUsage(..., purpose: "widget_generation") → 사용량 기록
5. 단일 위젯 설정 JSON 반환
```

## 3. AI 함수 설계 (`src/lib/ai.ts`)

### `generateWidget()` 함수

기존 `generateDashboard()`와 동일 구조. 차이점: **단일 위젯**만 반환.

**Interface**:
```typescript
interface GenerateWidgetInput {
    prompt: string;
    workspaceFields: Array<{ key: string; label: string; fieldType: string }>;
}

interface GenerateWidgetResult {
    title: string;
    widgetType: string;
    dataColumn: string;
    aggregation: string;
    groupByColumn: string;
    stackByColumn: string;
    usage: { promptTokens: number; completionTokens: number };
}
```

### `buildWidgetSystemPrompt()` — AI 시스템 프롬프트

```
당신은 데이터 대시보드 위젯 설정 전문가입니다.
사용자의 요청에 맞는 위젯 1개를 설계하세요.

반드시 다음 JSON 형식으로 응답:
{
  "title": "위젯 제목",
  "widgetType": "bar",
  "dataColumn": "필드 key",
  "aggregation": "count",
  "groupByColumn": "필드 key",
  "stackByColumn": ""
}

규칙:
- widgetType: scorecard, bar, bar_horizontal, bar_stacked, line, donut
- scorecard: groupByColumn 빈 문자열
- bar_stacked만 stackByColumn 사용
- dataColumn/groupByColumn은 반드시 워크스페이스 필드 또는 시스템 필드 key 사용
- aggregation: count, sum, avg
- 한국어 제목
- JSON만 반환

[시스템 필드]
- _sys:registeredAt (등록일시) — 날짜 기반 그룹핑에 사용
- _sys:createdAt (생성일시)
- _sys:updatedAt (수정일시)

[워크스페이스 필드 목록]
- companyName (회사명) [text]
- contactName (담당자명) [text]
...
```

### AI 호출 로직

OpenAI/Anthropic 분기는 `generateDashboard()`와 동일. JSON 추출 패턴만 다름:

```typescript
const pattern = /\{[\s\S]*"title"[\s\S]*"widgetType"[\s\S]*\}/;
const parsed = extractJson(content, pattern);
```

## 4. UI 설계 (`WidgetConfigDialog.tsx`)

### 레이아웃 변경

Dialog 상단에 AI 도우미 영역 추가:

```
┌─────────────────────────────────────┐
│ 위젯 추가 / 위젯 설정              │
├─────────────────────────────────────┤
│ ✨ AI 도우미                        │
│ ┌─────────────────────────┐ ┌────┐ │
│ │ 월별 영업 건수 막대차트 │ │추천│ │
│ └─────────────────────────┘ └────┘ │
├─────────────────────────────────────┤
│ 제목:     [________________]        │
│ 타입:     [scorecard ▾    ]        │
│ 데이터:   [필드 선택 ▾    ]        │
│ 집계:     [COUNT ▾        ]        │
│ 그룹:     [필드 선택 ▾    ]        │
│ 스택:     [필드 선택 ▾    ]        │
├─────────────────────────────────────┤
│              [취소]  [추가/저장]     │
└─────────────────────────────────────┘
```

### 컴포넌트 상태 추가

```typescript
const [aiPrompt, setAiPrompt] = useState("");
const [aiLoading, setAiLoading] = useState(false);
```

### AI 추천 핸들러

```typescript
const handleAiSuggest = async () => {
    setAiLoading(true);
    const res = await fetch("/api/ai/generate-widget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            prompt: aiPrompt,
            workspaceFields: fields.map(f => ({
                key: f.key, label: f.label, fieldType: f.fieldType,
            })),
        }),
    });
    const json = await res.json();
    if (json.success) {
        const d = json.data;
        setTitle(d.title);
        setWidgetType(d.widgetType);
        setDataColumn(d.dataColumn);
        setAggregation(d.aggregation);
        setGroupByColumn(d.groupByColumn || "");
        setStackByColumn(d.stackByColumn || "");
    } else {
        toast.error(json.error || "AI 추천에 실패했습니다.");
    }
    setAiLoading(false);
};
```

### AI 미설정 처리

- `WidgetConfigDialog`에 `hasAi?: boolean` prop 추가
- `dashboards.tsx`에서 `/api/ai/status` 또는 간단히 generate-widget 호출 시 400 에러로 판단
- 더 간단한 방법: `hasAi` prop을 부모에서 전달 (기존 AI 대시보드 생성 때 이미 AI 호출 성공 여부를 알고 있음)
- **채택**: `hasAi` prop 없이, AI 도우미 영역은 항상 표시하되 호출 실패 시 에러 토스트로 안내 (설정 페이지 유도 메시지). 이유: 별도 상태 관리 없이 단순.

## 5. 구현 순서

| # | 파일 | 작업 | 검증 |
|---|------|------|------|
| 1 | `src/lib/ai.ts` | `generateWidget()` + `buildWidgetSystemPrompt()` 추가 | 타입 에러 없음 |
| 2 | `src/pages/api/ai/generate-widget.ts` | API 엔드포인트 (generate-dashboard.ts 복사 후 수정) | 타입 에러 없음 |
| 3 | `src/components/dashboard/WidgetConfigDialog.tsx` | AI 도우미 UI + aiPrompt 상태 + handleAiSuggest | `pnpm build` 성공 |
