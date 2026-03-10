import type { AiClient } from "./client";
import { callGeminiJson } from "./gemini";
import { extractJson } from "./json-utils";

// ---- 대시보드 생성 ----

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

function buildDashboardSystemPrompt(workspaceFields: Array<{ key: string; label: string; fieldType: string }>): string {
    let prompt = `당신은 데이터 대시보드 설계 전문가입니다.
사용자의 요청에 맞는 대시보드를 설계하세요.

반드시 다음 JSON 형식으로 응답하세요:
{
  "name": "대시보드 이름",
  "widgets": [
    {
      "title": "위젯 제목",
      "widgetType": "scorecard",
      "dataColumn": "필드 key",
      "aggregation": "count",
      "groupByColumn": "",
      "stackByColumn": ""
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
- JSON만 반환하세요`;

    if (workspaceFields.length > 0) {
        prompt += `\n\n[워크스페이스 필드 목록]`;
        for (const f of workspaceFields) {
            prompt += `\n- ${f.key} (${f.label}) [${f.fieldType}]`;
        }
    }

    return prompt;
}

export async function generateDashboard(
    client: AiClient,
    input: GenerateDashboardInput
): Promise<GenerateDashboardResult> {
    const systemPrompt = buildDashboardSystemPrompt(input.workspaceFields);
    const pattern = /\{[\s\S]*"name"[\s\S]*"widgets"[\s\S]*\}/;

    const { content, usage } = await callGeminiJson(client, systemPrompt, input.prompt);
    const parsed = extractJson(content, pattern);
    const widgets = (parsed.widgets as any[] || []).map((w: any) => ({
        title: w.title || "",
        widgetType: w.widgetType || "scorecard",
        dataColumn: w.dataColumn || "",
        aggregation: w.aggregation || "count",
        groupByColumn: w.groupByColumn || "",
        stackByColumn: w.stackByColumn || "",
    }));

    return {
        name: parsed.name as string || "",
        widgets,
        usage,
    };
}

// ---- 위젯 설정 생성 ----

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

function buildWidgetSystemPrompt(workspaceFields: Array<{ key: string; label: string; fieldType: string }>): string {
    let prompt = `당신은 데이터 대시보드 위젯 설정 전문가입니다.
사용자의 요청에 맞는 위젯 1개를 설계하세요.

반드시 다음 JSON 형식으로 응답하세요:
{
  "title": "위젯 제목",
  "widgetType": "bar",
  "dataColumn": "필드 key",
  "aggregation": "count",
  "groupByColumn": "필드 key 또는 빈 문자열",
  "stackByColumn": ""
}

규칙:
- widgetType: scorecard, bar, bar_horizontal, bar_stacked, line, donut 중 하나
- scorecard는 groupByColumn 빈 문자열 ""
- bar_stacked만 stackByColumn 사용, 나머지는 빈 문자열 ""
- dataColumn과 groupByColumn은 반드시 아래 필드 목록의 key 값 사용
- aggregation: count, sum, avg 중 하나
- 한국어로 제목 작성
- JSON만 반환하세요

[시스템 필드 - 날짜 기반 그룹핑에 사용]
- _sys:registeredAt (등록일시)
- _sys:createdAt (생성일시)
- _sys:updatedAt (수정일시)`;

    if (workspaceFields.length > 0) {
        prompt += `\n\n[워크스페이스 필드 목록]`;
        for (const f of workspaceFields) {
            prompt += `\n- ${f.key} (${f.label}) [${f.fieldType}]`;
        }
    }

    return prompt;
}

export async function generateWidget(
    client: AiClient,
    input: GenerateWidgetInput
): Promise<GenerateWidgetResult> {
    const systemPrompt = buildWidgetSystemPrompt(input.workspaceFields);
    const pattern = /\{[\s\S]*"title"[\s\S]*"widgetType"[\s\S]*\}/;

    const { content, usage } = await callGeminiJson(client, systemPrompt, input.prompt);
    const parsed = extractJson(content, pattern);

    return {
        title: (parsed.title as string) || "",
        widgetType: (parsed.widgetType as string) || "scorecard",
        dataColumn: (parsed.dataColumn as string) || "",
        aggregation: (parsed.aggregation as string) || "count",
        groupByColumn: (parsed.groupByColumn as string) || "",
        stackByColumn: (parsed.stackByColumn as string) || "",
        usage,
    };
}
