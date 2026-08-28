import { resolveModel, SEARCH_MODEL_ID, type AiProvider } from "./models";

export interface AiClient {
    provider: AiProvider;
    apiKey: string;
    model: string;
}

// 선택한 모델(model)에 맞는 provider/apiKey로 클라이언트를 구성한다.
// 지원하지 않거나 미지정 시 기본 모델로 폴백. 해당 provider의 키가 없으면 null.
export function getAiClient(model?: string): AiClient | null {
    const resolved = resolveModel(model);

    if (resolved.provider === "deepseek") {
        const apiKey = process.env.DEEPSEEK_API_KEY;
        if (!apiKey) return null;
        return { provider: "deepseek", apiKey, model: resolved.id };
    }

    if (resolved.provider === "gemini") {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return null;
        return { provider: "gemini", apiKey, model: resolved.id };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    return { provider: "claude", apiKey, model: resolved.id };
}

// 웹검색 그라운딩이 필요한 생성(제품/회사 리서치)용. SEARCH_MODEL_ID로 고정.
export function getSearchAiClient(): AiClient | null {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    return { provider: "claude", apiKey, model: SEARCH_MODEL_ID };
}
