import type { AiClient } from "./client";
import type { Product } from "@/lib/db";
import { callGeminiEmail } from "./gemini";

interface SenderPersona {
    name: string;
    title?: string;
    company?: string;
}

export interface GenerateEmailInput {
    prompt: string;
    product?: Product | null;
    recordData?: Record<string, unknown> | null;
    tone?: string;
    ctaUrl?: string;
    format?: "plain" | "designed";
    senderPersona?: SenderPersona | null;
}

interface GenerateEmailResult {
    subject: string;
    htmlBody: string;
    usage: { promptTokens: number; completionTokens: number };
}

function buildSystemPrompt(input: GenerateEmailInput): string {
    const isDesigned = input.format === "designed";

    let prompt = `당신은 B2B 영업/마케팅 이메일 전문가입니다.
사용자의 지시에 따라 이메일을 작성해주세요.
반드시 JSON 형식으로 응답하세요: { "subject": "이메일 제목", "htmlBody": "<html>...</html>" }
중요: htmlBody 값 안의 모든 큰따옴표(")는 반드시 \\"로 이스케이프하세요. HTML 속성에는 큰따옴표 대신 작은따옴표(')를 사용하세요 (예: style='color: red').
subject는 반드시 plain text만 사용하세요. HTML 태그(<b>, <u> 등)를 절대 넣지 마세요.

[스타일 규칙 — 반드시 준수]`;

    if (isDesigned) {
        prompt += `
- 전문적인 HTML 마케팅 이메일 형식으로 작성하세요.
- 허용: 헤더 섹션, CTA 버튼(배경색+둥근 모서리+패딩), 배경색, 섹션 구분, 테이블 레이아웃
- 인라인 CSS만 사용하세요 (외부 CSS 금지)
- 모바일 반응형을 고려한 max-width: 600px 컨테이너 사용
- 깔끔한 색상 조합 사용 (과하지 않게)
- htmlBody는 완전한 HTML 이메일 구조로 작성`;
    } else {
        prompt += `
- 사람이 직접 작성한 것처럼 자연스러운 플레인 텍스트 스타일로 작성하세요.
- 허용 서식: <b>, <u>, <mark>(하이라이트), <br>, <a>, <p> 태그만 사용
- 반드시 핵심 키워드나 강조할 부분에 <b> 또는 <u> 태그를 적극 사용하세요 (서비스명, 핵심 혜택, 숫자 등)
- 문단 구조: 각 문단을 <p> 태그로 감싸세요. 2~3문장을 하나의 <p>로 묶으세요. <br><br>은 사용하지 마세요. <p> 태그의 기본 margin이 문단 간격을 만듭니다.
- 금지: 배경색, 테이블 레이아웃, 큰 CTA 버튼, 이미지, 헤더/푸터 디자인, 컬러 박스, 이모지
- CTA는 텍스트 링크(<a> 태그)로만 표현하세요 (버튼 스타일 금지)
- htmlBody는 <div style="font-family: sans-serif; font-size: 14px; line-height: 1.8; color: #222;"> 안에 작성`;
    }

    if (input.product) {
        prompt += `\n\n[제품 정보]\n- 이름: ${input.product.name}`;
        if (input.product.summary) prompt += `\n- 소개: ${input.product.summary}`;
        if (input.product.description) prompt += `\n- 상세: ${input.product.description}`;
        if (input.product.price) prompt += `\n- 가격: ${input.product.price}`;
        if (input.product.url) prompt += `\n- 사이트: ${input.product.url}`;
    }

    const ctaUrl = input.ctaUrl || input.product?.url;
    if (ctaUrl) {
        prompt += `\n\n[CTA 링크 규칙]
- 이메일의 모든 CTA 링크 href에 다음 URL을 그대로 사용하세요: ${ctaUrl}
- URL을 수정하거나 파라미터를 추가하지 마세요. 정확히 위 URL만 사용하세요.
- CTA 링크의 표시 텍스트는 반드시 자연스러운 문구를 사용하세요 (예: "자세히 알아보기", "무료 시작하기"). URL을 표시 텍스트로 쓰지 마세요.
- 미팅 예약, 캘린더 링크 등 실제로 지원하지 않는 기능을 CTA로 쓰지 마세요.`;
    }

    if (input.recordData) {
        const companyResearch = input.recordData._companyResearch as Record<string, unknown> | undefined;
        if (companyResearch && typeof companyResearch === "object") {
            prompt += "\n\n[상대 회사 정보]";
            if (companyResearch.companyName) prompt += `\n- 회사명: ${companyResearch.companyName}`;
            if (companyResearch.industry) prompt += `\n- 업종: ${companyResearch.industry}`;
            if (companyResearch.description) prompt += `\n- 소개: ${companyResearch.description}`;
            if (companyResearch.services) prompt += `\n- 주요 서비스: ${companyResearch.services}`;
            if (companyResearch.employees) prompt += `\n- 규모: ${companyResearch.employees}`;
            if (companyResearch.website) prompt += `\n- 웹사이트: ${companyResearch.website}`;
        }

        prompt += "\n\n[수신자 정보]";
        for (const [key, value] of Object.entries(input.recordData)) {
            if (key.startsWith("_")) continue;
            if (value != null && value !== "") {
                prompt += `\n- ${key}: ${String(value)}`;
            }
        }
    }

    if (input.senderPersona) {
        const p = input.senderPersona;
        prompt += `\n\n[발신자 페르소나 — 이 사람이 직접 쓴 것처럼 작성]`;
        prompt += `\n- 이름: ${p.name}`;
        if (p.title) prompt += `\n- 직함: ${p.title}`;
        if (p.company) prompt += `\n- 소속: ${p.company}`;
        prompt += `\n- 자기소개를 "${p.name}${p.title ? ` ${p.title}` : ""}입니다" 형태로 자연스럽게 작성하세요.`;
        prompt += `\n- "저희 팀", "저희 회사" 대신 1인칭("제가", "저는")을 사용하세요.`;
    }

    if (input.tone) {
        if (input.tone === "concise") {
            prompt += `\n\n[톤: 간결/실무형 — 반드시 지켜야 할 규칙]
- 전체 이메일 본문을 5~8문장 이내로 작성하세요. 절대 길게 쓰지 마세요.
- 구조: 인사(1문장) → 자기소개(1문장) → 핵심 제안(2~3문장) → CTA(1문장) → 마무리(1문장)
- 실제 영업 담당자가 직접 쓴 것처럼 자연스럽고 담백한 말투를 사용하세요.
- 금지 표현: "혁신적인", "최적의 솔루션", "귀사의 성장을 위해", "시너지", "탁월한", "차별화된", "획기적인", "파트너십을 통해", "함께 성장", "비즈니스 가치" 등 AI가 자주 쓰는 미사여구
- 금지 패턴: "~에 대한 고민이 있으실 것 같아", "~을 보며 연락드렸습니다", "~에 도움이 되고자" 등 상대 상황을 추측하는 문장 금지. 대신 자사 서비스를 직접 소개하세요.
- 회사명/서비스명은 본문에서 최대 2번만 언급하세요. 반복하지 마세요.
- 상대 회사명도 최대 1번만 언급하세요.
- 불릿 포인트는 최대 3개까지만 허용하며, 가능하면 쓰지 마세요.
- 한 문장에 한 가지 내용만 담으세요. 접속사로 문장을 늘리지 마세요.
- "~드립니다", "~하겠습니다" 대신 "~합니다", "~해요" 등 간결한 종결어미를 사용하세요.`;
        } else {
            prompt += `\n\n[톤] ${input.tone}`;
        }
    }

    return prompt;
}

export async function generateEmail(
    client: AiClient,
    input: GenerateEmailInput
): Promise<GenerateEmailResult> {
    const systemPrompt = buildSystemPrompt(input);
    const result = await callGeminiEmail(client, systemPrompt, input.prompt);

    const ctaUrl = input.ctaUrl || input.product?.url;
    if (ctaUrl && result.htmlBody) {
        const utm = "utm_source=email&utm_medium=sales&utm_campaign=outreach";
        const urlWithUtm = ctaUrl + (ctaUrl.includes("?") ? "&" : "?") + utm;
        result.htmlBody = result.htmlBody.replaceAll(ctaUrl, urlWithUtm);
    }

    return result;
}

export function buildEmailSystemPrompt(input: GenerateEmailInput): string {
    return buildSystemPrompt(input);
}
