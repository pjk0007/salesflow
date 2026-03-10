import type { AiClient } from "./client";
import { callGeminiJson } from "./gemini";
import { extractJson } from "./json-utils";

interface GenerateWebFormInput {
    prompt: string;
    workspaceFields?: Array<{ key: string; label: string }>;
}

interface GenerateWebFormField {
    label: string;
    description: string;
    placeholder: string;
    fieldType: string;
    linkedFieldKey: string;
    isRequired: boolean;
    options: string[];
}

interface GenerateWebFormResult {
    name: string;
    title: string;
    description: string;
    fields: GenerateWebFormField[];
    usage: { promptTokens: number; completionTokens: number };
}

function buildWebFormSystemPrompt(workspaceFields?: Array<{ key: string; label: string }>): string {
    let prompt = `당신은 웹폼 필드 설계 전문가입니다.
사용자의 요청에 맞는 웹 폼을 설계하세요.

반드시 다음 JSON 형식으로 응답하세요:
{
  "name": "폼 관리용 이름 (짧고 간결하게, 예: 무료체험 신청)",
  "title": "폼 제목 (사용자에게 보이는 제목)",
  "description": "폼 설명",
  "fields": [
    {
      "label": "필드 이름",
      "description": "",
      "placeholder": "플레이스홀더",
      "fieldType": "text",
      "linkedFieldKey": "",
      "isRequired": true,
      "options": []
    }
  ]
}

규칙:
- fieldType은 text, email, phone, textarea, select, checkbox, date 중 하나만 사용
- 이메일 수집 필드는 반드시 fieldType: "email" 사용
- 전화번호는 fieldType: "phone" 사용
- select 타입은 options 배열 필수, 나머지는 빈 배열 []
- 한국어로 작성
- 5~10개 적절한 필드 생성
- JSON만 반환하세요`;

    if (workspaceFields && workspaceFields.length > 0) {
        prompt += `\n\n[워크스페이스 필드 목록]\n이 필드들과 매핑 가능한 폼 필드는 linkedFieldKey에 해당 key를 설정하세요.`;
        for (const f of workspaceFields) {
            prompt += `\n- ${f.key} (${f.label})`;
        }
    }

    return prompt;
}

export async function generateWebForm(
    client: AiClient,
    input: GenerateWebFormInput
): Promise<GenerateWebFormResult> {
    const systemPrompt = buildWebFormSystemPrompt(input.workspaceFields);
    const pattern = /\{[\s\S]*"title"[\s\S]*"fields"[\s\S]*\}/;

    const { content, usage } = await callGeminiJson(client, systemPrompt, input.prompt);
    const parsed = extractJson(content, pattern);
    const fields = (parsed.fields as any[] || []).map((f: any) => ({
        label: f.label || "",
        description: f.description || "",
        placeholder: f.placeholder || "",
        fieldType: f.fieldType || "text",
        linkedFieldKey: f.linkedFieldKey || "",
        isRequired: !!f.isRequired,
        options: Array.isArray(f.options) ? f.options : [],
    }));

    return {
        name: parsed.name as string || "",
        title: parsed.title as string || "",
        description: parsed.description as string || "",
        fields,
        usage,
    };
}
