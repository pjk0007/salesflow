import type { AiClient } from "./client";
import type { Product } from "@/lib/db";
import { callGeminiJson } from "./gemini";
import { extractJson } from "./json-utils";

interface GenerateAlimtalkInput {
    prompt: string;
    product?: Product | null;
    tone?: string;
}

interface GenerateAlimtalkResult {
    templateName: string;
    templateContent: string;
    templateMessageType: string;
    buttons: Array<{ ordering: number; type: string; name: string; linkMo?: string; linkPc?: string }>;
    usage: { promptTokens: number; completionTokens: number };
}

function buildAlimtalkSystemPrompt(input: GenerateAlimtalkInput): string {
    let prompt = `당신은 카카오 알림톡 템플릿 전문가입니다.
사용자의 요청에 맞는 알림톡 템플릿을 작성하세요.

반드시 다음 JSON 형식으로 응답하세요:
{
  "templateName": "템플릿 이름",
  "templateContent": "본문 내용 (최대 1300자)",
  "templateMessageType": "BA",
  "buttons": [
    { "type": "WL", "name": "버튼명", "linkMo": "https://..." }
  ]
}

규칙:
- templateContent는 반드시 1300자 이내
- 변수는 #{변수명} 형식 사용 (예: #{고객명}, #{주문번호}, #{상품명})
- templateMessageType: BA(기본형) 또는 EX(부가정보형) 중 적절히 선택
- 버튼 type: WL(웹링크), BK(봇키워드), MD(메시지전달) 중 선택
- 버튼은 0~5개, WL 타입은 linkMo 필수
- 한국어로 작성
- JSON만 반환하세요`;

    if (input.product) {
        prompt += `\n\n[제품 정보]\n- 이름: ${input.product.name}`;
        if (input.product.summary) prompt += `\n- 소개: ${input.product.summary}`;
        if (input.product.description) prompt += `\n- 상세: ${input.product.description}`;
        if (input.product.price) prompt += `\n- 가격: ${input.product.price}`;
        if (input.product.url) prompt += `\n- URL: ${input.product.url}`;
    }

    if (input.tone) {
        prompt += `\n\n[톤] ${input.tone}`;
    }

    return prompt;
}

export async function generateAlimtalk(
    client: AiClient,
    input: GenerateAlimtalkInput
): Promise<GenerateAlimtalkResult> {
    const systemPrompt = buildAlimtalkSystemPrompt(input);
    const pattern = /\{[\s\S]*"templateName"[\s\S]*"templateContent"[\s\S]*\}/;

    const { content, usage } = await callGeminiJson(client, systemPrompt, input.prompt);
    const parsed = extractJson(content, pattern);
    const buttons = (parsed.buttons as any[] || []).map((b: any, i: number) => ({
        ordering: i + 1,
        type: b.type || "WL",
        name: b.name || "",
        ...(b.linkMo && { linkMo: b.linkMo }),
        ...(b.linkPc && { linkPc: b.linkPc }),
    }));

    return {
        templateName: (parsed.templateName as string) || "",
        templateContent: (parsed.templateContent as string) || "",
        templateMessageType: (parsed.templateMessageType as string) || "BA",
        buttons,
        usage,
    };
}
