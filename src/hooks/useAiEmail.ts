import { useState, useRef, useCallback } from "react";

interface GenerateEmailInput {
    prompt: string;
    productId?: number;
    recordId?: number;
    tone?: string;
    ctaUrl?: string;
}

interface GenerateEmailResult {
    subject: string;
    htmlBody: string;
}

export function useAiEmail() {
    const [isGenerating, setIsGenerating] = useState(false);
    const [streamingText, setStreamingText] = useState("");
    const abortRef = useRef<AbortController | null>(null);

    const generateEmail = async (input: GenerateEmailInput): Promise<{
        success: boolean;
        data?: GenerateEmailResult;
        error?: string;
    }> => {
        setIsGenerating(true);
        try {
            const res = await fetch("/api/ai/generate-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(input),
            });
            return await res.json();
        } catch {
            return { success: false, error: "서버에 연결할 수 없습니다." };
        } finally {
            setIsGenerating(false);
        }
    };

    const generateEmailStream = useCallback(async (
        input: GenerateEmailInput,
        onChunk: (fullText: string) => void,
    ): Promise<{
        success: boolean;
        data?: GenerateEmailResult;
        error?: string;
    }> => {
        // 이전 요청 취소
        if (abortRef.current) abortRef.current.abort();
        const abort = new AbortController();
        abortRef.current = abort;

        setIsGenerating(true);
        setStreamingText("");
        let fullText = "";

        try {
            const res = await fetch("/api/ai/generate-email-stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(input),
                signal: abort.signal,
            });

            if (!res.ok) {
                const json = await res.json().catch(() => ({}));
                return { success: false, error: json.error || "AI 이메일 생성에 실패했습니다." };
            }

            const reader = res.body!.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith("event: ")) {
                        const eventType = trimmed.slice(7);
                        // 다음 줄이 data:
                        const dataIdx = lines.indexOf(line) + 1;
                        if (dataIdx < lines.length) {
                            // 실제로는 같은 루프에서 처리하므로 아래서 별도 처리
                        }
                        void eventType; // handled in data parsing
                    }
                    if (trimmed.startsWith("data: ")) {
                        const dataStr = trimmed.slice(6);
                        try {
                            const parsed = JSON.parse(dataStr);
                            if (parsed.text) {
                                fullText += parsed.text;
                                setStreamingText(fullText);
                                onChunk(fullText);
                            }
                            if (parsed.error) {
                                return { success: false, error: parsed.error };
                            }
                        } catch {
                            // 파싱 실패 무시
                        }
                    }
                }
            }

            // 스트리밍 완료 — 전체 텍스트에서 JSON 추출
            const result = parseEmailFromStream(fullText);
            if (result) {
                return { success: true, data: result };
            }
            return { success: false, error: "AI 응답을 파싱할 수 없습니다." };
        } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") {
                return { success: false, error: "요청이 취소되었습니다." };
            }
            return { success: false, error: "서버에 연결할 수 없습니다." };
        } finally {
            setIsGenerating(false);
            abortRef.current = null;
        }
    }, []);

    const cancelStream = useCallback(() => {
        if (abortRef.current) {
            abortRef.current.abort();
            abortRef.current = null;
        }
        setIsGenerating(false);
    }, []);

    return { generateEmail, generateEmailStream, isGenerating, streamingText, cancelStream };
}

function parseEmailFromStream(text: string): { subject: string; htmlBody: string } | null {
    try {
        // 코드블록 내 JSON
        const codeBlock = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
        if (codeBlock) {
            const parsed = JSON.parse(codeBlock[1].trim());
            if (parsed.subject && parsed.htmlBody) return parsed;
        }

        // 직접 JSON 매칭
        const jsonMatch = text.match(/\{[\s\S]*"subject"[\s\S]*"htmlBody"[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.subject && parsed.htmlBody) return parsed;
        }

        // brace-balanced 파싱
        const startIdx = text.indexOf("{");
        if (startIdx !== -1) {
            let depth = 0;
            for (let i = startIdx; i < text.length; i++) {
                if (text[i] === "{") depth++;
                else if (text[i] === "}") depth--;
                if (depth === 0) {
                    const parsed = JSON.parse(text.substring(startIdx, i + 1));
                    if (parsed.subject && parsed.htmlBody) return parsed;
                    break;
                }
            }
        }
    } catch {
        // 파싱 실패
    }
    return null;
}
