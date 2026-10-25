import { useState, useRef, useCallback, useLayoutEffect } from "react";
import { apiRequest } from "@/lib/swr-fetcher";
import { readAiEmailStream, EMAIL_GENERATION_CANCELLED, type GenerateEmailInput, type EmailGenerationResult } from "@/components/email/api/ai-email";

export function useAiEmail(scopeKey = "", subscribeInvalidation?: (listener: () => void) => () => void) {
    const [isGenerating, setIsGenerating] = useState(false);
    const [streamingText, setStreamingText] = useState("");
    const abortRef = useRef<AbortController | null>(null);

    const cancelStream = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        setIsGenerating(false);
    }, []);

    useLayoutEffect(() => {
        const unsubscribe = subscribeInvalidation?.(cancelStream);
        return () => {
            unsubscribe?.();
            // 레코드·계정 전환/언마운트 후 늦은 결과는 새 작성기에 적용하지 않는다.
            cancelStream();
        };
    }, [scopeKey, subscribeInvalidation, cancelStream]);

    const run = useCallback(async (input: GenerateEmailInput, onChunk?: (text: string) => void): Promise<EmailGenerationResult> => {
        // 상태가 렌더링되기 전 같은 틱의 중복 클릭도 새 모델 호출을 만들지 않는다.
        if (abortRef.current) return { success: false, error: "이미 AI 이메일을 생성하고 있습니다." };
        const abort = new AbortController();
        abortRef.current = abort;
        setIsGenerating(true);
        setStreamingText("");
        try {
            const options = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: abort.signal };
            let result: EmailGenerationResult;
            if (onChunk) {
                const response = await fetch("/api/ai/generate-email-stream", options);
                result = await readAiEmailStream(response, abort.signal, (text) => {
                    if (abortRef.current !== abort || abort.signal.aborted) return;
                    setStreamingText(text);
                    onChunk(text);
                });
            } else {
                result = await apiRequest<EmailGenerationResult>("/api/ai/generate-email", options, 120000);
            }
            if (abortRef.current !== abort || abort.signal.aborted)
                return { success: false, error: EMAIL_GENERATION_CANCELLED };
            return result;
        } catch {
            return { success: false, error: abort.signal.aborted ? EMAIL_GENERATION_CANCELLED : "서버에 연결할 수 없습니다." };
        } finally {
            // 이전 요청의 finally가 새 요청의 취소 핸들/진행 상태를 지우면 안 된다.
            if (abortRef.current === abort) {
                abortRef.current = null;
                setIsGenerating(false);
            }
        }
    }, []);

    const generateEmail = useCallback((input: GenerateEmailInput) => run(input), [run]);
    const generateEmailStream = useCallback((input: GenerateEmailInput, onChunk: (text: string) => void) => run(input, onChunk), [run]);
    return { generateEmail, generateEmailStream, isGenerating, streamingText, cancelStream };
}
