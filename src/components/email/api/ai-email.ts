export interface GenerateEmailInput {
    prompt: string;
    productId?: number;
    recordId?: number;
    tone?: string;
    ctaUrl?: string;
    model?: string;
}

export interface GeneratedEmail { subject: string; htmlBody: string }
export type EmailGenerationResult = { success: boolean; data?: GeneratedEmail; error?: string };
export const EMAIL_GENERATION_CANCELLED = "요청이 취소되었습니다.";

function parseEmail(text: string): GeneratedEmail | null {
    const code = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    const json = code?.[1] ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    try {
        const value = JSON.parse(json);
        return typeof value.subject === "string" && value.subject.trim() &&
            typeof value.htmlBody === "string" && value.htmlBody.trim()
            ? { subject: value.subject, htmlBody: value.htmlBody } : null;
    } catch { return null; }
}

/** 네트워크 청크 경계와 SSE 이벤트 경계는 다르다. done 전 연결 종료는 성공이 아니다. */
export async function readAiEmailStream(
    response: Response,
    signal: AbortSignal,
    onChunk: (text: string) => void,
): Promise<EmailGenerationResult> {
    signal.throwIfAborted();
    if (!response.ok) {
        const body = await response.json().catch(() => null);
        signal.throwIfAborted();
        return { success: false, error: typeof body?.error === "string" && /[가-힣]/.test(body.error)
            ? body.error : "AI 이메일 생성에 실패했습니다." };
    }
    if (!response.body) return { success: false, error: "AI 응답을 읽지 못했습니다." };
    const reader = response.body.getReader();
    const abort = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener("abort", abort, { once: true });
    const decoder = new TextDecoder();
    let buffer = "", event = "", payload: string[] = [], text = "";
    try {
        while (true) {
            const next = await reader.read();
            signal.throwIfAborted();
            if (next.done) break;
            buffer += decoder.decode(next.value, { stream: true });
            let newline: number;
            while ((newline = buffer.indexOf("\n")) !== -1) {
                const line = buffer.slice(0, newline).replace(/\r$/, "");
                buffer = buffer.slice(newline + 1);
                if (line.startsWith("event:")) event = line.slice(6).trim();
                else if (line.startsWith("data:")) payload.push(line.slice(5).trimStart());
                else if (line === "") {
                    if (payload.length) {
                        let value;
                        try { value = JSON.parse(payload.join("\n")); }
                        catch { return { success: false, error: "AI 응답을 읽지 못했습니다." }; }
                        if (!value || typeof value !== "object") return { success: false, error: "AI 응답을 읽지 못했습니다." };
                        if (event === "error") return { success: false, error: typeof value.error === "string" && /[가-힣]/.test(value.error) ? value.error : "AI 이메일 생성에 실패했습니다." };
                        if (event === "chunk" && typeof value.text === "string") {
                            text += value.text;
                            onChunk(text);
                            signal.throwIfAborted();
                        }
                        if (event === "done") {
                            const data = parseEmail(text);
                            return data ? { success: true, data } : { success: false, error: "AI 응답을 파싱할 수 없습니다." };
                        }
                    }
                    event = "";
                    payload = [];
                }
            }
        }
        return { success: false, error: "AI 응답이 완료되기 전에 연결이 끊겼습니다. 다시 시도해주세요." };
    } finally {
        signal.removeEventListener("abort", abort);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}
