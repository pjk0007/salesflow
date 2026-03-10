export interface AiClient {
    apiKey: string;
    model: string;
}

export function getAiClient(): AiClient | null {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    return { apiKey, model: "gemini-2.5-flash" };
}
