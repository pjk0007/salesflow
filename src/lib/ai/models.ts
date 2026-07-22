// 선택 가능한 AI 모델 정의 (검색 미사용 텍스트 생성용)
// 검색 기반 생성(제품/회사 리서치)은 Gemini 고정이라 이 목록을 쓰지 않는다.

export type AiProvider = "gemini" | "deepseek";

export interface AiModelOption {
    id: string;
    label: string;
    provider: AiProvider;
}

export const AI_MODELS: AiModelOption[] = [
    { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite", provider: "gemini" },
    { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", provider: "deepseek" },
];

export const DEFAULT_MODEL_ID = "gemini-3.5-flash-lite";

// 검색 기반 생성에 강제되는 모델 (Gemini만 웹검색 그라운딩 지원)
export const SEARCH_MODEL_ID = "gemini-3.5-flash-lite";

export function resolveModel(model?: string): AiModelOption {
    const found = AI_MODELS.find((m) => m.id === model);
    if (found) return found;
    return AI_MODELS.find((m) => m.id === DEFAULT_MODEL_ID)!;
}
